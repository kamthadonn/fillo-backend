const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

// ── PRICE IDs ─────────────────────────────────────────────────────────
// UPDATE THESE after creating new prices in Stripe dashboard
const PRICES = {
  starter_monthly:    'price_1T9Zr53eFtSO3FCMQMpcfYVY',
  starter_yearly:     'price_1T9Zwk3eFtSO3FCMk3YDBdNr',
  pro_monthly:        'price_1T9ZtN3eFtSO3FCMCgpHLj5k',  // ⚠️ UPDATE to $697 price ID
  pro_yearly:         'price_1T9Zx93eFtSO3FCME3Vig4AD',  // ⚠️ UPDATE to $5,997 price ID
  enterprise_monthly: 'price_1T9Ztp3eFtSO3FCMEum2rtep',  // ⚠️ UPDATE to $1,500 price ID
  enterprise_yearly:  'price_1T9Zxb3eFtSO3FCM4fCn8q9S',  // ⚠️ UPDATE to $12,997 price ID
  voucher_monthly:    'price_1T9ZvD3eFtSO3FCMTK0RGEsK',
  voucher_yearly:     'price_1T9Zv43eFtSO3FCM6K7FqFUR',
};

// Pull user from Bearer token if present
function getUserFromReq(req) {
  try {
    const header = req.headers.authorization;
    if (!header) return null;
    const token = header.replace('Bearer ', '').trim();
    return jwt.verify(token, AUTH_SECRET);
  } catch {
    return null;
  }
}

// ── POST /api/stripe/checkout ─────────────────────────────────────────
router.post('/checkout', async (req, res) => {
  try {
    const { plan, billing, voucher } = req.body;

    // Map voucher to voucher price
    const planKey = voucher ? 'voucher' : plan;
    const priceId = PRICES[`${planKey}_${billing}`];

    if (!priceId) {
      return res.status(400).json({ error: `Invalid plan or billing: ${planKey}_${billing}` });
    }

    // Get logged-in user if available
    const user = getUserFromReq(req);

    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&plan=${planKey}`,
      cancel_url:  `${process.env.FRONTEND_URL}/index.html#pricing`,
      metadata: {
        plan: planKey,
        billing,
        user_id: user?.id || '',
      },
    };

    // Pre-fill email if user is logged in
    if (user?.email) {
      sessionParams.customer_email = user.email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });

  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/stripe/webhook ──────────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

  // ── Payment succeeded ────────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { plan, billing, user_id } = session.metadata;
    const customerEmail = session.customer_details?.email;
    const stripeCustomerId = session.customer;
    const stripeSubscriptionId = session.subscription;

    console.log(`✅ New subscriber: ${customerEmail} — ${plan} (${billing})`);

    try {
      // If we have user_id from metadata, update that user directly
      if (user_id) {
        await supabase
          .from('users')
          .update({
            plan,
            status: 'active',
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: stripeSubscriptionId,
          })
          .eq('id', user_id);

        console.log(`✅ Linked plan ${plan} to user ${user_id}`);
        return res.json({ received: true });
      }

      // Otherwise fall back to email lookup
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('email', customerEmail)
        .maybeSingle();

      if (existing) {
        // Existing user — update plan
        await supabase
          .from('users')
          .update({
            plan,
            status: 'active',
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: stripeSubscriptionId,
          })
          .eq('id', existing.id);

        console.log(`✅ Updated plan for ${customerEmail} → ${plan}`);
      } else {
        // Brand new user from Stripe — create account with temp password
        // They'll use "forgot password" to set their real password
        const tempPassword = crypto.randomBytes(16).toString('hex');
        const bcrypt = require('bcryptjs');
        const passwordHash = await bcrypt.hash(tempPassword, 12);
        const token = crypto.randomBytes(32).toString('hex');

        await getSupabase().from('users').insert([{
          email:                   customerEmail,
          password_hash:           passwordHash,
          token,
          plan,
          status:                  'active',
          stripe_customer_id:      stripeCustomerId,
          stripe_subscription_id:  stripeSubscriptionId,
          first_name:              '',
          last_name:               '',
          venue_name:              '',
        }]);

        console.log(`✅ Auto-created account for ${customerEmail} — they need to set password`);
      }
    } catch (err) {
      console.error('Webhook account error:', err.message);
    }
  }

  // ── Subscription cancelled ───────────────────────────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    try {
      await supabase
        .from('users')
        .update({ status: 'cancelled', plan: 'cancelled' })
        .eq('stripe_subscription_id', subscription.id);
      console.log(`❌ Cancelled subscription: ${subscription.id}`);
    } catch (err) {
      console.error('Cancellation error:', err.message);
    }
  }

  // ── Payment failed ───────────────────────────────────────────────────
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    try {
      await supabase
        .from('users')
        .update({ status: 'past_due' })
        .eq('stripe_subscription_id', invoice.subscription);
      console.log(`⚠️ Payment failed for subscription: ${invoice.subscription}`);
    } catch (err) {
      console.error('Payment failed handler error:', err.message);
    }
  }

  res.json({ received: true });
});

// ── GET /api/stripe/plans ─────────────────────────────────────────────
// Used by frontend to display correct prices
router.get('/plans', (req, res) => {
  res.json({
    plans: [
      {
        id: 'starter',
        name: 'Starter',
        monthly: 297,
        yearly: 2497,
        yearlyMonthly: 208,
        venues: 1,
        description: '1 venue · All 5 pillars · No X signals',
      },
      {
        id: 'pro',
        name: 'Pro',
        monthly: 697,
        yearly: 5997,
        yearlyMonthly: 498,
        venues: 3,
        description: 'Up to 3 venues · X signals · Auto CMS publish',
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        monthly: 1500,
        yearly: 12997,
        yearlyMonthly: 1083,
        venues: 'Unlimited',
        description: 'Unlimited venues · White label · Weekly reports',
      },
      {
        id: 'voucher',
        name: 'Beta Voucher',
        monthly: 147,
        yearly: 1297,
        yearlyMonthly: 108,
        venues: 3,
        description: 'Founding member rate — locked for life',
      },
    ],
  });
});

module.exports = router;