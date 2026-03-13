const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

// Returns the account owner's ID — team members share owner's data
function getAccountId(req) {
  return req.user.ownerId || req.user.userId;
}

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, AUTH_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// POST /api/scans — save a scan result
router.post('/', authRequired, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { venue_id, fomo_score, trends, drafts, insight } = req.body;
    const { data, error } = await supabase.from('scans').insert({
      user_id: getAccountId(req),
      venue_id: venue_id || null,
      fomo_score: fomo_score || 0,
      trends: JSON.stringify(trends || []),
      drafts: JSON.stringify(drafts || []),
      insight: insight || '',
      created_at: new Date().toISOString()
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, scan: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scans/latest — get most recent scan for user
router.get('/latest', authRequired, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('scans')
      .select('*')
      .eq('user_id', getAccountId(req))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, scan: data || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scans — get scan history
router.get('/', authRequired, async (req, res) => {
  try {
    const supabase = getSupabase();
    const limit = parseInt(req.query.limit) || 30;
    const { data, error } = await supabase
      .from('scans')
      .select('*')
      .eq('user_id', getAccountId(req))
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, scans: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;