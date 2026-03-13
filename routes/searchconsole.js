const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

function authMiddleware(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });
    req.user = jwt.verify(token, AUTH_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// GET /api/searchconsole/status
router.get('/status', authMiddleware, async (req, res) => {
  res.json({ success: true, connected: false, message: 'Search Console integration coming soon' });
});

// GET /api/searchconsole/keywords
router.get('/keywords', authMiddleware, async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_SEARCH_CONSOLE_KEY;
    if (!apiKey) return res.status(503).json({ error: 'Search Console not configured' });
    res.json({ success: true, keywords: [], message: 'Connect your Search Console property to see keyword data' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;