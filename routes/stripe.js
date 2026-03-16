const express    = require('express');
const router     = express.Router();
const Stripe     = require('stripe');
const jwt        = require('jsonwebtoken');

const stripe     = new Stripe(process.env.STRIPE_SECRET_KEY);
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

// ─── PRICE IDS ────────────────────────────────────────────────────────────────
// Base plans (existing)
const PRICES = {
  // ── Subscriptions ──────────────────────────────────────────────────────────
  starter_monthly:    'price_1T9Zr53eFtSO3FCMQMpcfYVY',
  starter_yearly:     'price_1T9Zwk3eFtSO3FCMk3YDBdNr',
  pro_monthly:        'price_1T9ZtN3eFtSO3FCMCgpHLj5k',
  pro_yearly:         'price_1T9Zx93eFtSO3FCME3Vig4AD',
  enterprise_monthly: 'price_1T9Ztp3eFtSO3FCMEum2rtep',
  enterprise_yearly:  'price_1T9Zxb3eFtSO3FCM4fCn8q9S',
  voucher_monthly:    'price_1T9ZvD3eFtSO3FCMTK0RGEsK',
  voucher_yearly:     'price_1T9Zv43eFtSO3FCM6K7FqFUR',

  // ── One-time overage blocks (create these in Stripe Dashboard) ─────────────
  // Stripe Dashboard → Products → Add product → One time price
  // Name each exactly as shown, set the price, copy the price_1... ID here
  instagram_overage:  process.env.STRIPE_PRICE_INSTAGRAM_OVERAGE  || null, // $49 — 50k Instagram requests
  x_overage:          process.env.STRIPE_PRICE_X_OVERAGE          || null, // $35 — 500k X/Twitter tweets
  scan_overage:       process.env.STRIPE_PRICE_SCAN_OVERAGE        || null, // $29 — 50 extra scans/mo
  serpapi_upgrade:    process.env.STRIPE_PRICE_SERPAPI_UPGRADE     || null, // $19 — SerpAPI boost (extra 500 calls)
};

// What each add-on unlocks (for webhook handler)
const ADDON_ACTIONS = {
  instagram_overage: { table: 'instagram_usage', field: 'overage_blocks' },
  x_overage:         { table: 'x_usage',         field: 'overage_blocks' },
  scan_overage:      { table: 'scan_usage',       field: 'overage_blocks' },
  serpapi_upgrade:   { table: 'feature_addons',   field: 'serpapi_blocks' },
};

// ─── POST /api/stripe/checkout — subscription plans ──────────────────────────
router.post('/checkout', async (req, res) => {
  try {
    const { plan, billing, voucher } = req.body;
    const planKey    = voucher ? 'voucher' : (plan || 'pro');
    const billingKey = billing || 'monthly';
    const priceId    = PRICES[`${planKey}_${billingKey}`];

    if (!priceId) {
      return res.status(400).json({ error: `Invalid plan: ${planKey}_${billingKey}` });
    }

    const user = getUserFromReq(req);

    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&plan=${planKey}&billing=${billingKey}`,
      cancel_url:  `${process.env.FRONTEND_URL}/index.html#pricing`,
      metadata: {
        plan:      planKey,
        billing:   billingKey,
        user_id:   user?.userId || user?.id || '',
        type:      'subscription',
      },
    };

    if (user?.email) sessionParams.customer_email = user.email;

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });

  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/stripe/addon — one-time add-on purchases ──────────────────────
// Called when user hits a limit and wants to buy more
// Body: { addon: 'instagram_overage' | 'x_overage' | 'scan_overage' | 'serpapi_upgrade' }
router.post('/addon', async (req, res) => {
  try {
    const user = getUserFromReq(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { addon } = req.body;
    const priceId = PRICES[addon];

    if (!priceId) {
      return res.status(400).json({
        error: `Add-on "${addon}" not yet configured. Add the Stripe price ID to Railway env vars.`,
        missingEnvVar: `STRIPE_PRICE_${addon.toUpperCase()}`,
      });
    }

    const ADDON_META = {
      instagram_overage: { name: '50,000 Instagram Requests',    price: '$49' },
      x_overage:         { name: '500,000 X/Twitter Tweets',     price: '$35' },
      scan_overage:      { name: '50 Extra Scans This Month',     price: '$29' },
      serpapi_upgrade:   { name: '500 Extra Google Trend Calls',  price: '$19' },
    };

    const meta = ADDON_META[addon] || { name: addon, price: '' };

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/dashboard.html?addon_success=${addon}`,
      cancel_url:  `${process.env.FRONTEND_URL}/dashboard.html?addon_cancelled=1`,
      metadata: {
        addon,
        user_id: user.userId || user.id || '',
        type:    'addon',
      },
      customer_email: user.email,
    });

    res.json({ url: session.url, addon, name: meta.name, price: meta.price });

  } catch (err) {
    console.error('Addon checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/stripe/upgrade — switch subscription plan ─────────────────────
router.post('/upgrade', async (req, res) => {
  try {
    const user = getUserFromReq(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { plan, billing } = req.body;
    const priceId = PRICES[`${plan}_${billing || 'monthly'}`];
    if (!priceId) return res.status(400).json({ error: 'Invalid plan' });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/success.html?plan=${plan}&billing=${billing}&upgrade=1`,
      cancel_url:  `${process.env.FRONTEND_URL}/dashboard.html`,
      metadata: {
        plan,
        billing: billing || 'monthly',
        user_id: user.userId || user.id || '',
        type:    'upgrade',
      },
      customer_email: user.email,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/stripe/webhook ─────────────────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook sig error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const supabase = getSupabase();

  // ── checkout.session.completed ────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { type, addon, plan, billing, user_id } = session.metadata;
    const customerEmail    = session.customer_email || session.customer_details?.email;
    const stripeCustomerId = session.customer;

    console.log(`✅ Payment: ${customerEmail} — type=${type} plan=${plan} addon=${addon}`);

    // ── SUBSCRIPTION (new plan or upgrade) ───────────────────────────────────
    if (type === 'subscription' || type === 'upgrade' || !type) {
      const updatePayload = {
        plan,
        billing,
        status: 'active',
        stripe_customer_id:      stripeCustomerId,
        stripe_subscription_id:  session.subscription,
      };

      if (user_id) {
        const { error } = await supabase.from('users').update(updatePayload).eq('id', user_id);
        if (!error) {
          console.log(`✅ Plan updated: user ${user_id} → ${plan}`);
          return res.json({ received: true });
        }
      }
      if (customerEmail) {
        await supabase.from('users').update(updatePayload).eq('email', customerEmail);
        console.log(`✅ Plan updated: email ${customerEmail} → ${plan}`);
      }
      return res.json({ received: true });
    }

    // ── ONE-TIME ADD-ON ───────────────────────────────────────────────────────
    if (type === 'addon' && addon) {
      const action = ADDON_ACTIONS[addon];
      if (action && user_id) {
        const month = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;

        if (action.table === 'feature_addons') {
          // Generic feature addons table
          const { data: existing } = await supabase
            .from('feature_addons')
            .select('id, serpapi_blocks')
            .eq('user_id', user_id)
            .maybeSingle();

          if (existing) {
            await supabase.from('feature_addons')
              .update({ [action.field]: (existing[action.field] || 0) + 1 })
              .eq('id', existing.id);
          } else {
            await supabase.from('feature_addons')
              .insert({ user_id, [action.field]: 1 });
          }
        } else {
          // Usage tables (instagram_usage, x_usage, scan_usage)
          const { data: existing } = await supabase
            .from(action.table)
            .select('id, overage_blocks')
            .eq('user_id', user_id)
            .eq('month', month)
            .maybeSingle();

          if (existing) {
            await supabase.from(action.table)
              .update({ overage_blocks: (existing.overage_blocks || 0) + 1 })
              .eq('id', existing.id);
          } else {
            await supabase.from(action.table)
              .insert({ user_id, month, overage_blocks: 1, requests_used: 0 });
          }
        }

        console.log(`✅ Add-on applied: ${addon} for user ${user_id}`);
      }
      return res.json({ received: true });
    }
  }

  // ── customer.subscription.deleted ─────────────────────────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    await supabase.from('users')
      .update({ status: 'cancelled', plan: 'cancelled' })
      .eq('stripe_subscription_id', sub.id);
    return res.json({ received: true });
  }

  // ── invoice.payment_failed ────────────────────────────────────────────────
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    await supabase.from('users')
      .update({ status: 'past_due' })
      .eq('stripe_subscription_id', invoice.subscription);
    return res.json({ received: true });
  }

  // ── invoice.payment_succeeded (renewals) ──────────────────────────────────
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    if (invoice.billing_reason === 'subscription_cycle') {
      await supabase.from('users')
        .update({ status: 'active' })
        .eq('stripe_subscription_id', invoice.subscription);
    }
    return res.json({ received: true });
  }

  res.json({ received: true });
});

// ─── GET /api/stripe/plans ────────────────────────────────────────────────────
router.get('/plans', (req, res) => {
  res.json({
    plans: [
      { id: 'starter',    name: 'Starter',    monthly: 197,  yearly: 1997, yearlyPerMonth: 164 },
      { id: 'pro',        name: 'Pro',         monthly: 250,  yearly: 2497, yearlyPerMonth: 208 },
      { id: 'enterprise', name: 'Enterprise',  monthly: 450,  yearly: 4497, yearlyPerMonth: 374 },
    ],
    addons: [
      { id: 'instagram_overage', name: '50k Instagram Requests',   price: 49,  description: 'One-time overage block for Enterprise' },
      { id: 'x_overage',         name: '500k X/Twitter Tweets',    price: 35,  description: 'One-time overage block for Enterprise' },
      { id: 'scan_overage',      name: '50 Extra Scans',           price: 29,  description: 'Available on all plans' },
      { id: 'serpapi_upgrade',   name: '500 Google Trends Calls',  price: 19,  description: 'Boost for any plan' },
    ],
  });
});

// ─── POST /api/stripe/portal ─────────────────────────────────────────────────
router.post('/portal', async (req, res) => {
  try {
    const user = getUserFromReq(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = getSupabase();
    const { data: userData } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.userId)
      .single();

    if (!userData?.stripe_customer_id) {
      return res.status(400).json({ error: 'No billing account found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   userData.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/dashboard.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;