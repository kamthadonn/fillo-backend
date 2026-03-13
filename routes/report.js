const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

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

// GET /api/report/weekly
router.get('/weekly', authMiddleware, async (req, res) => {
  try {
    const supabase = getSupabase();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: audits } = await supabase.from('audit_trail').select('*')
      .eq('user_id', req.user.userId).gte('created_at', sevenDaysAgo).order('created_at', { ascending: false });
    const { data: venues } = await supabase.from('venues').select('*').eq('user_id', req.user.userId);

    res.json({
      success: true,
      report: {
        period: '7 days',
        total_changes: audits?.length || 0,
        venues_active: venues?.length || 0,
        changes: audits || [],
        generated_at: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/report/summary
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: venues } = await supabase.from('venues').select('*').eq('user_id', req.user.userId);
    const { data: audits } = await supabase.from('audit_trail').select('*')
      .eq('user_id', req.user.userId).order('created_at', { ascending: false }).limit(50);

    res.json({
      success: true,
      summary: {
        venues: venues?.length || 0,
        total_actions: audits?.length || 0,
        recent_actions: audits?.slice(0, 5) || [],
        generated_at: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;