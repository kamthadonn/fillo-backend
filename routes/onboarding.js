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

    // Safe string converter — NEVER returns empty string to Postgres
    // All array-like columns are TEXT in Supabase — store as comma-separated strings
    // NEVER pass a JS array to Supabase TEXT columns — causes malformed array literal
    const toStr = v => {
      if (!v) return null;
      if (Array.isArray(v)) {
        const s = v.map(x => String(x).trim()).filter(Boolean).join(', ');
        return s || null;
      }
      if (typeof v === 'string') {
        const s = v.split(',').map(x => x.trim()).filter(Boolean).join(', ');
        return s || null;
      }
      return null;
    };
    const toText = v => { if (!v) return null; const s = String(v).trim(); return s || null; };
    const toArr = toStr; // alias — same thing, columns are TEXT not TEXT[]



    const { data: venue, error } = await supabase
      .from('venues')
      .insert([{
        name:               String(data.name || '').trim(),
        city:               toText(data.city),
        state:              toText(data.state),
        type:               toText(data.type) || 'venue',
        capacity:           data.capacity ? parseInt(data.capacity) : null,
        genres:             toArr(data.genres),
        event_types:        toArr(data.eventTypes),
        busiest_nights:     toArr(data.busiestNights),
        competitors:        toStr(data.competitors),
        keywords:           toStr(data.customKeywords),
        venue_business_type: String(data.venueBusinessType || 'tickets'),
        price_point:        toText(data.pricePoint),
        target_customers:   toArr(data.targetCustomers),
        product_categories: toArr(data.productCategories),
        pilot_mode:         toText(data.pilotMode) || 'suggest',
        alert_email:        toText(data.alertEmail),
        site_url:           toText(data.siteUrl),
        instagram:          toText(data.socialHandles?.instagram),
        tiktok:             toText(data.socialHandles?.tiktok),
        twitter:            toText(data.socialHandles?.twitter),
        facebook:           toText(data.socialHandles?.facebook),
        is_active:          true,
        user_id:            userId || null,
      }])
      .select()
      .single();

    if (error) throw error;

    // Link venue back to user record and set account_type
    if (userId) {
      const accountType = data.venueBusinessType === 'goods' ? 'product' : 'venue';
      await supabase
        .from('users')
        .update({ 
          updated_at: new Date().toISOString(),
          account_type: accountType,  // permanently marks this user as venue or product type
        })
        .eq('id', userId);
      console.log(`✅ User ${userId} account_type set to: ${accountType}`);
    }

    console.log(`✅ New venue: ${venue.name} (${venue.id}) → user: ${userId || 'anonymous'}`);

    // Trigger deep pull in background — learns the venue, stores intelligence profile only
    // Does NOT generate drafts or save scans
    try {
      const { runDeepPull } = require('../services/deeppull');
      const toStrSafe = v => { if (!v) return ''; if (Array.isArray(v)) return v.filter(Boolean).join(', '); return String(v); };
      const venueForPull = {
        ...venue,
        event_types: toStrSafe(data.eventTypes),
        genres:      toStrSafe(data.genres),
        competitors: toStrSafe(data.competitors),
        keywords:    toStrSafe(data.customKeywords),
        userId,            // ← ALWAYS scope intelligence to this user
        user_id: userId,   // ← both fields used across different services
        plan:    'starter' // new signups start here — updated after payment
      };
      runDeepPull(venueForPull)
        .then(r => console.log(`✅ [DeepPull] Done for ${venue.name} (user: ${userId}) — ${r?.signalCount || 0} signals`))
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