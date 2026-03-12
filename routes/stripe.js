const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

const PRICES = {
  starter_monthly:    'price_1T9Zr53eFtSO3FCMQMpcfYVY',
  starter_yearly:     'price_1T9Zwk3eFtSO3FCMk3YDBdNr',
  pro_monthly:        'price_1T9ZtN3eFtSO3FCMCgpHLj5k',
  pro_yearly:         'price_1T9Zx93eFtSO3FCME3Vig4AD',
  enterprise_monthly: 'price_1T9Ztp3eFtSO3FCMEum2rtep',
  enterprise_yearly:  'price_1T9Zxb3eFtSO3FCM4fCn8q9S',
  voucher_monthly:    'price_1T9ZvD3eFtSO3FCMTK0RGEsK',
  voucher_yearly:     'price_1T9Zv43eFtSO3FCM6K7FqFUR',
};

function getUserFromReq(req) {
  try {
    const header = req.headers.authorization;
    if (!header) return null;
    const token = header.replace('Bearer ', '').trim();
    return jwt.verify(token, AUTH_SECRET);
  } catch { return null; }
}

router.post('/checkout', async (req, res) => {
  try {
    const { plan, billing, voucher } = req.body;
    const planKey = voucher ? 'voucher' : plan;
    const priceId = PRICES[`${planKey}_${billing}`];
    if (!priceId) return res.status(400).json({ error: `Invalid plan: ${planKey}_${billing}` });
    const user = getUserFromReq(req);
    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&plan=${planKey}`,
      cancel_url:  `${process.env.FRONTEND_URL}/index.html#pricing`,
      metadata: { plan: planKey, billing, user_id: user?.id || '' },
    };
    if (user?.email) sessionParams.customer_email = user.email;
    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { plan, billing, user_id } = session.metadata;
    const customerEmail = session.customer_details?.email;
    const stripeCustomerId = session.customer;
    const stripeSubscriptionId = session.subscription;
    try {
      if (user_id) {
        await supabase.from('users').update({ plan, status: 'active', stripe_customer_id: stripeCustomerId, stripe_subscription_id: stripeSubscriptionId }).eq('id', user_id);
      } else {
        const { data: existing } = await supabase.from('users').select('id').eq('email', customerEmail).maybeSingle();
        if (existing) {
          await supabase.from('users').update({ plan, status: 'active', stripe_customer_id: stripeCustomerId, stripe_subscription_id: stripeSubscriptionId }).eq('id', existing.id);
        } else {
          const bcrypt = require('bcryptjs');
          const passwordHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12);
          await supabase.from('users').insert([{ email: customerEmail, password_hash: passwordHash, token: crypto.randomBytes(32).toString('hex'), plan, status: 'active', stripe_customer_id: stripeCustomerId, stripe_subscription_id: stripeSubscriptionId, first_name: '', last_name: '', venue_name: '' }]);
        }
      }
    } catch (err) { console.error('Webhook error:', err.message); }
  }
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    await supabase.from('users').update({ status: 'cancelled', plan: 'cancelled' }).eq('stripe_subscription_id', subscription.id);
  }
  res.json({ received: true });
});

router.get('/plans', (req, res) => {
  res.json({ plans: [
    { id: 'starter',    name: 'Starter',    monthly: 197, yearly: 1997, yearlyMonthly: 164, venues: 1,           wasMonthly: 297,  description: '1 venue · All 5 pillars' },
    { id: 'pro',        name: 'Pro',        monthly: 250, yearly: 2497, yearlyMonthly: 208, venues: 3,           wasMonthly: 697,  description: 'Up to 3 venues · X signals · Auto CMS' },
    { id: 'enterprise', name: 'Enterprise', monthly: 450, yearly: 4497, yearlyMonthly: 374, venues: 'Unlimited', wasMonthly: 1500, description: 'Unlimited venues · White label · Reports' },
  ]});
});

module.exports = router;
