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
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// Whitelist of allowed venue columns to prevent injection
const ALLOWED_VENUE_FIELDS = [
  'name','city','state','type','capacity','site_url','pilot_mode','alert_email',
  'genres','event_types','busiest_nights','competitors','keywords',
  'instagram','tiktok','twitter','facebook','google_place_id',
  'cms_url','cms_type','email_frequency','fomo_threshold','venue_business_type',
  'price_point','target_customers','product_categories','updated_at'
];

function sanitizeVenuePayload(body) {
  const safe = { updated_at: new Date().toISOString() };
  ALLOWED_VENUE_FIELDS.forEach(f => { if (body[f] !== undefined) safe[f] = body[f]; });
  return safe;
}

// GET /api/venues
router.get('/', authMiddleware, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('venues').select('*').eq('user_id', req.user.userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, venues: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/venues — create a new venue for this user
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, city, state, type, capacity } = req.body;
    if (!name) return res.status(400).json({ error: 'Venue name required' });
    const supabase = getSupabase();
    const { data, error } = await supabase.from('venues').insert({
      user_id: req.user.userId, name, city, state, type,
      capacity: parseInt(capacity) || null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, venue: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/venues/:id — update any fields (whitelisted)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const supabase = getSupabase();
    const payload = sanitizeVenuePayload(req.body);
    const { data, error } = await supabase.from('venues')
      .update(payload).eq('id', req.params.id).eq('user_id', req.user.userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, venue: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/venues/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('venues').delete()
      .eq('id', req.params.id).eq('user_id', req.user.userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/venues/settings — save email_frequency (and any future user-level prefs)
router.patch('/settings', authMiddleware, async (req, res) => {
  const { email_frequency } = req.body;
  if (!email_frequency) return res.status(400).json({ error: 'No settings to update' });
  try {
    const supabase = getSupabase();
    await supabase.from('venues')
      .update({ email_frequency, updated_at: new Date().toISOString() })
      .eq('user_id', req.user.userId);
    await supabase.from('users')
      .update({ email_frequency, updated_at: new Date().toISOString() })
      .eq('id', req.user.userId);
    res.json({ success: true, email_frequency });
  } catch(e) { res.status(500).json({ error: 'Could not save settings' }); }
});

module.exports = router;