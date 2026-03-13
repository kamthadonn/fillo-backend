const express  = require('express');
const router   = express.Router();
const Stripe   = require('stripe');
const jwt      = require('jsonwebtoken');

const stripe   = new Stripe(process.env.STRIPE_SECRET_KEY);
const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function getUserFromReq(req) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return null;
    return jwt.verify(token, AUTH_SECRET);
  } catch { return null; }
}

// ── Stripe price IDs ──────────────────────────────────────────────────
const PRICES = {
  starter_monthly:    'price_1T9Zr53eFtSO3FCMQMpcfYVY',
  starter_yearly:     'price_1T9Zwk3eFtSO3FCMk3YDBdNr',
  pro_monthly:        'price_1T9ZtN3eFtSO3FCMCgpHLj5k',
  pro_yearly:         'price_1T9Zx93eFtSO3FCME3Vig4AD',
  enterprise_monthly: 'price_1T9toc3eFtSO3FCM6r1vE6O3',
  enterprise_yearly:  'price_1T9Zxb3eFtSO3FCM4fCn8q9S',
  voucher_monthly:    'price_1T9ZvD3eFtSO3FCMTK0RGEsK',
  voucher_yearly:     'price_1T9Zv43eFtSO3FCM6K7FqFUR',
};

// ── POST /api/stripe/checkout ─────────────────────────────────────────
router.post('/checkout', async (req, res) => {
  try {
    const { plan, billing, voucher } = req.body;
    const planKey = voucher ? 'voucher' : (plan || 'pro');
    const billingKey = billing || 'monthly';
    const priceId = PRICES[`${planKey}_${billingKey}`];

    if (!priceId) {
      return res.status(400).json({ error: `Invalid plan/billing: ${planKey}_${billingKey}` });
    }

    const user = getUserFromReq(req);

    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&plan=${planKey}&billing=${billingKey}`,
      cancel_url:  `${process.env.FRONTEND_URL}/index.html#pricing`,
      metadata: {
        plan:    planKey,
        billing: billingKey,
        user_id: user?.userId || user?.id || '',
      },
    };

    if (user?.email) {
      sessionParams.customer_email = user.email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });

  } catch (err) {
    console.error('Checkout error:', err.message);
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

  const supabase = getSupabase();

  // ── checkout.session.completed ────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { plan, billing, user_id } = session.metadata;
    const customerEmail = session.customer_email || session.customer_details?.email;
    const stripeCustomerId = session.customer;
    const stripeSubscriptionId = session.subscription;

    console.log(`✅ Payment complete: ${customerEmail} — ${plan} (${billing})`);

    const updatePayload = {
      plan,
      billing,
      status: 'active',
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
    };

    // Priority 1: update by user_id (most reliable — set during checkout)
    if (user_id) {
      const { error } = await supabase.from('users').update(updatePayload).eq('id', user_id);
      if (!error) {
        console.log(`✅ Updated plan by user_id: ${user_id} → ${plan}`);
        return res.json({ received: true });
      }
      console.warn('user_id update failed, falling back to email:', error.message);
    }

    // Priority 2: update by email
    if (customerEmail) {
      const { data: existing } = await supabase.from('users').select('id').eq('email', customerEmail).maybeSingle();

      if (existing) {
        await supabase.from('users').update(updatePayload).eq('email', customerEmail);
        console.log(`✅ Updated plan by email: ${customerEmail} → ${plan}`);
      } else {
        // No account yet — this shouldn't happen with new flow but handle gracefully
        console.warn(`⚠️ No user found for email: ${customerEmail}`);
      }
    }

    return res.json({ received: true });
  }

  // ── customer.subscription.deleted ────────────────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    await supabase.from('users')
      .update({ status: 'cancelled', plan: 'cancelled' })
      .eq('stripe_subscription_id', sub.id);
    console.log(`❌ Subscription cancelled: ${sub.id}`);
    return res.json({ received: true });
  }

  // ── invoice.payment_failed ────────────────────────────────────────
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    await supabase.from('users')
      .update({ status: 'past_due' })
      .eq('stripe_subscription_id', invoice.subscription);
    console.log(`⚠️ Payment failed: ${invoice.subscription}`);
    return res.json({ received: true });
  }

  // ── invoice.payment_succeeded (renewals) ─────────────────────────
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    if (invoice.billing_reason === 'subscription_cycle') {
      await supabase.from('users')
        .update({ status: 'active' })
        .eq('stripe_subscription_id', invoice.subscription);
      console.log(`🔄 Renewal succeeded: ${invoice.subscription}`);
    }
    return res.json({ received: true });
  }

  res.json({ received: true });
});

// ── GET /api/stripe/plans ─────────────────────────────────────────────
router.get('/plans', (req, res) => {
  res.json({
    plans: [
      { id: 'starter',    name: 'Starter',    monthly: 197, yearly: 1997, yearlyPerMonth: 164 },
      { id: 'pro',        name: 'Pro',         monthly: 250, yearly: 2497, yearlyPerMonth: 208 },
      { id: 'enterprise', name: 'Enterprise',  monthly: 450, yearly: 4497, yearlyPerMonth: 374 },
    ]
  });
});

// ── POST /api/stripe/portal — open Stripe billing portal ─────────────
router.post('/portal', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const jwt = require('jsonwebtoken');
    const user = jwt.verify(token, process.env.AUTH_SECRET || 'fillo-super-secret-2026');
    const { data: userData } = await supabase.from('users').select('stripe_customer_id,email').eq('id', user.userId).single();
    if (!userData?.stripe_customer_id) return res.status(400).json({ error: 'No billing account found' });
    const session = await stripe.billingPortal.sessions.create({
      customer: userData.stripe_customer_id,
      return_url: process.env.FRONTEND_URL + '/dashboard.html',
    });
    res.json({ url: session.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;