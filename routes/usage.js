const express = require('express');
const router = express.Router();
const { getUsageSummary, addOverageBlock, PLAN_LIMITS } = require('../services/xusage');
const jwt = require('jsonwebtoken');

// Auth middleware
function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.AUTH_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// GET /api/usage/x — get current user's X usage summary
router.get('/x', authRequired, async (req, res) => {
  try {
    const summary = await getUsageSummary(req.user.id, req.user.plan || 'starter');
    res.json({ success: true, ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/usage/x/limits — get plan limits (public)
router.get('/x/limits', (req, res) => {
  res.json({ success: true, limits: PLAN_LIMITS, overageBlock: 500000, overagePrice: 350 });
});

// POST /api/usage/x/overage — add overage block (called after Stripe overage payment)
router.post('/x/overage', authRequired, async (req, res) => {
  try {
    if (req.user.plan !== 'enterprise') {
      return res.status(403).json({ error: 'Overage blocks are only available on Enterprise.' });
    }
    await addOverageBlock(req.user.id);
    const summary = await getUsageSummary(req.user.id, req.user.plan);
    res.json({ success: true, message: 'Overage block added.', ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
