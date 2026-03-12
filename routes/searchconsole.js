const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';
function auth(req, res, next) { try { const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return res.status(401).json({ error: 'No token' }); req.user = jwt.verify(token, AUTH_SECRET); next(); } catch { res.status(401).json({ error: 'Invalid token' }); } }
router.get('/status', auth, (req, res) => res.json({ success: true, connected: false, message: 'Search Console integration coming soon' }));
router.get('/keywords', auth, (req, res) => res.json({ success: true, keywords: [], message: 'Connect your Search Console property to see keyword data' }));
module.exports = router;
