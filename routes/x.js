// routes/x.js — X/Twitter preferences + usage API
// GET  /api/x/preferences    — load user's X preferences
// POST /api/x/preferences    — save user's X preferences
// GET  /api/x/usage          — get this month's X usage summary

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { getXPreferences, saveXPreferences, calculateBudgetAllocation } = require('../services/x_preferences');
const { getUsageSummary } = require('../services/xusage');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    req.user = jwt.verify(token, AUTH_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// GET /api/x/preferences
router.get('/preferences', auth, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const plan   = req.user.plan || 'pro';
    const prefs  = await getXPreferences(userId);
    const alloc  = calculateBudgetAllocation(plan, plan === 'enterprise' ? 500000 : 150000, prefs);
    res.json({ success: true, preferences: prefs, budgetAllocation: alloc, plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/x/preferences
router.post('/preferences', auth, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { preferences } = req.body;

    // Validate percentages sum to 100
    const pctFields = ['posts_read', 'trends', 'news', 'profile_read', 'spaces'];
    const total = pctFields.reduce((sum, k) => sum + (preferences[k] || 0), 0);
    if (total !== 100) {
      return res.status(400).json({ error: `Budget allocations must sum to 100% (got ${total}%)` });
    }

    await saveXPreferences(userId, preferences);
    res.json({ success: true, message: 'X preferences saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/x/usage
router.get('/usage', auth, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const plan   = req.user.plan || 'pro';
    const summary = await getUsageSummary(userId, plan);
    res.json({ success: true, ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;