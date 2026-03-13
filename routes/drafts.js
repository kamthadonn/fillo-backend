const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

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

// GET /api/drafts — get pending drafts for user
router.get('/', authRequired, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('drafts')
      .select('*')
      .eq('user_id', getAccountId(req))
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, drafts: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/drafts — save a new draft
router.post('/', authRequired, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { venue_id, type, title, content, source, scan_id } = req.body;
    const { data, error } = await supabase.from('drafts').insert({
      user_id: getAccountId(req),
      venue_id: venue_id || null,
      scan_id: scan_id || null,
      type: type || 'social',
      title: title || '',
      content: content || '',
      source: source || '',
      status: 'pending',
      created_at: new Date().toISOString()
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, draft: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/drafts/:id — approve or reject
router.patch('/:id', authRequired, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { status, edited_content } = req.body; // status: 'approved' | 'rejected'
    const update = { status, updated_at: new Date().toISOString() };
    if (edited_content) update.content = edited_content;
    const { data, error } = await supabase
      .from('drafts')
      .update(update)
      .eq('id', req.params.id)
      .eq('user_id', getAccountId(req))
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, draft: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/drafts/history — approved + rejected drafts
router.get('/history', authRequired, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('drafts')
      .select('*')
      .eq('user_id', getAccountId(req))
      .in('status', ['approved', 'rejected'])
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, drafts: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;