const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

// Pull user_id from Bearer token if present (optional — doesn't block if missing)
function getUserIdFromReq(req) {
  try {
    const header = req.headers.authorization;
    if (!header) return null;
    const token = header.replace('Bearer ', '').trim();
    const decoded = jwt.verify(token, AUTH_SECRET);
    return decoded.userId || decoded.id || null;
  } catch {
    return null;
  }
}

// ── POST /api/onboarding/setup ────────────────────────────────────────
router.post('/setup', async (req, res) => {
  try {
    const data = req.body;
    if (!data.name) return res.status(400).json({ error: 'Venue name is required' });

    const supabase = getSupabase();
    const userId = getUserIdFromReq(req);

    // If we have a userId, deactivate their existing active venue first
    if (userId) {
      await supabase
        .from('venues')
        .update({ is_active: false })
        .eq('user_id', userId)
        .eq('is_active', true);
    }

    const toStr = v => { if (!v) return ''; if (Array.isArray(v)) return v.filter(Boolean).join(', '); return String(v); };

    const { data: venue, error } = await supabase
      .from('venues')
      .insert([{
        name:            data.name,
        city:            data.city || '',
        state:           data.state || '',
        type:            data.type || 'venue',
        capacity:        data.capacity ? parseInt(data.capacity) : null,
        genres:          toStr(data.genres),
        event_types:     toStr(data.eventTypes),
        busiest_nights:  toStr(data.busiestNights),
        competitors:     toStr(data.competitors),
        keywords:        toStr(data.customKeywords),
        venue_business_type: data.venueBusinessType || 'tickets',
        price_point:      data.pricePoint || null,
        target_customers: data.targetCustomers || null,
        product_categories: data.productCategories || null,
        pilot_mode:      data.pilotMode || 'suggest',
        alert_email:     data.alertEmail || '',
        site_url:        data.siteUrl || '',
        instagram:       data.socialHandles?.instagram || '',
        tiktok:          data.socialHandles?.tiktok || '',
        twitter:         data.socialHandles?.twitter || '',
        facebook:        data.socialHandles?.facebook || '',
        is_active:       true,
        user_id:         userId || null,
      }])
      .select()
      .single();

    if (error) throw error;

    // Link venue back to user record
    if (userId) {
      await supabase
        .from('users')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', userId);
    }

    console.log(`✅ New venue: ${venue.name} (${venue.id}) → user: ${userId || 'anonymous'}`);

    // Trigger deep pull in background — learns the venue, stores intelligence profile only
    // Does NOT generate drafts or save scans
    try {
      const { runDeepPull } = require('../services/deeppull');
      const venueForPull = {
        ...venue,
        event_types: data.eventTypes,
        genres: data.genres?.join(', '),
        competitors: data.competitors?.join(', '),
        keywords: data.customKeywords?.join(', ')
      };
      runDeepPull(venueForPull)
        .then(r => console.log(`✅ [DeepPull] Done for ${venue.name} — ${r.signalCount} signals`))
        .catch(e => console.error('[DeepPull] Background error:', e.message));
    } catch(e) { console.error('[DeepPull] Init error:', e.message); }

    res.json({
      success: true,
      message: `${venue.name} is live on Fillo!`,
      venueId: venue.id,
      venue: {
        ...venue,
        keywords: [
          data.city ? `${data.city} nightlife` : '',
          data.city ? `${data.city} events` : '',
          ...(data.genres || []).slice(0, 3),
          ...(data.customKeywords || []).slice(0, 3),
        ].filter(Boolean),
      },
    });
  } catch (err) {
    console.error('Onboarding error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/onboarding/:id ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: venue, error } = await supabase
      .from('venues')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.json(venue);
  } catch (err) {
    res.status(404).json({ error: 'Venue not found' });
  }
});

// ── GET /api/onboarding/ ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: venues, error } = await supabase
      .from('venues')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(venues);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;