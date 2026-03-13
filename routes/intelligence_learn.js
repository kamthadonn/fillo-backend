const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';
 
function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}
 
function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, AUTH_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
 
// ── POST /api/intelligence/learn ─────────────────────────────────────
// Called after every scan, draft approval/rejection, spotlight
// Updates learned_patterns so future scans are progressively smarter
router.post('/learn', authRequired, async (req, res) => {
  try {
    const { venue_id, eventType, data } = req.body;
    if (!venue_id || !eventType) return res.status(400).json({ error: 'venue_id and eventType required' });
 
    const { learnFrom } = require('../services/deeppull');
    await learnFrom({ venueId: venue_id, userId: req.user.userId, eventType, data: data || {} });
    res.json({ success: true, learned: eventType });
  } catch (err) {
    console.error('[Learn] Route error:', err.message);
    res.json({ success: false, error: err.message });
  }
});
 
// ── GET /api/intelligence/profile ────────────────────────────────────
// Returns the full venue intelligence profile — called on dashboard init
// This is the knowledge base that powers the greeting, dashboard config, and scans
router.get('/profile', authRequired, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: venue } = await supabase
      .from('venues')
      .select('id, name, venue_business_type')
      .eq('user_id', req.user.userId)
      .limit(1)
      .maybeSingle();
 
    if (!venue) return res.json({ success: true, profile: null });
 
    const { getVenueIntelligence } = require('../services/deeppull');
    const profile = await getVenueIntelligence(venue.id);
 
    res.json({
      success: true,
      profile,
      venueName: venue.name,
      venueBusinessType: venue.venue_business_type || 'tickets'
    });
  } catch (err) {
    console.error('[Profile] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
 
// ── POST /api/intelligence/refresh ───────────────────────────────────
// Called on login — triggers a background intelligence refresh
// Returns immediately (202 Accepted), refresh runs in background
// This is what makes the dashboard feel "always up to date"
router.post('/refresh', authRequired, async (req, res) => {
  res.json({ success: true, message: 'Intelligence refresh started' });
 
  // Run in background — do NOT await
  setImmediate(async () => {
    try {
      const supabase = getSupabase();
      const { data: venue } = await supabase
        .from('venues')
        .select('*')
        .eq('user_id', req.user.userId)
        .limit(1)
        .maybeSingle();
 
      if (!venue) return;
 
      // Check how old the last pull was
      const { data: intel } = await supabase
        .from('venue_intelligence')
        .select('pulled_at, signal_count')
        .eq('venue_id', venue.id)
        .maybeSingle();
 
      const lastPull = intel?.pulled_at ? new Date(intel.pulled_at) : null;
      const hoursSince = lastPull ? (Date.now() - lastPull.getTime()) / (1000 * 60 * 60) : 999;
 
      // Only re-pull if profile is older than 6 hours
      if (hoursSince > 6) {
        console.log(`[Refresh] ${venue.name} — profile is ${Math.round(hoursSince)}h old, refreshing...`);
        const { runDeepPull } = require('../services/deeppull');
        await runDeepPull(venue);
        console.log(`[Refresh] Done: ${venue.name}`);
      } else {
        console.log(`[Refresh] ${venue.name} — profile is fresh (${Math.round(hoursSince)}h), skipping`);
      }
    } catch(e) {
      console.error('[Refresh] Background error:', e.message);
    }
  });
});
 
module.exports = router;
 