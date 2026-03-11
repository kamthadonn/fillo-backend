const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Price IDs
const PRICES = {
  starter_monthly: 'price_1T9Zr53eFtSO3FCMQMpcfYVY',
  starter_yearly: 'price_1T9Zwk3eFtSO3FCMk3YDBdNr',
  pro_monthly: 'price_1T9ZtN3eFtSO3FCMCgpHLj5k',
  pro_yearly: 'price_1T9Zx93eFtSO3FCME3Vig4AD',
  enterprise_monthly: 'price_1T9Ztp3eFtSO3FCMEum2rtep',
  enterprise_yearly: 'price_1T9Zxb3eFtSO3FCM4fCn8q9S',
  voucher_monthly: 'price_1T9ZvD3eFtSO3FCMTK0RGEsK',
  voucher_yearly: 'price_1T9Zv43eFtSO3FCM6K7FqFUR',
};

// POST /api/stripe/checkout
// Body: { plan: 'starter', billing: 'monthly' }
router.post('/checkout', async (req, res) => {
  try {
    const { plan, billing } = req.body;

    const key = `${plan}_${billing}`;
    const priceId = PRICES[key];

    if (!priceId) {
      return res.status(400).json({ error: `Invalid plan or billing: ${key}` });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/index.html#pricing`,
      metadata: { plan, billing },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stripe/webhook
// Stripe sends events here after payment
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle successful payment
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { plan, billing } = session.metadata;
    const customerEmail = session.customer_details?.email;

    console.log(`✅ New subscriber: ${customerEmail} — ${plan} (${billing})`);
    // TODO: create user account, send welcome email
  }

  // Handle cancelled subscription
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    console.log(`❌ Subscription cancelled: ${subscription.id}`);
    // TODO: revoke access
  }

  res.json({ received: true });
});

// GET /api/stripe/plans
// Returns all available plans for the frontend
router.get('/plans', (req, res) => {
  res.json({
    plans: [
      {
        id: 'starter',
        name: 'Starter',
        monthly: 297,
        yearly: 2497,
        description: '1 venue, all 5 pillars',
      },
      {
        id: 'pro',
        name: 'Pro',
        monthly: 597,
        yearly: 4997,
        description: 'Up to 3 venues, social APIs',
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        monthly: 1200,
        yearly: 9997,
        description: 'Unlimited venues, white label',
      },
      {
        id: 'voucher',
        name: 'Beta Voucher',
        monthly: 147,
        yearly: 1297,
        description: 'Founding member rate — locked for life',
      },
    ],
  });
});

module.exports = router;




