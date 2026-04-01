const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function getUserId(req) {
  try {
    const raw = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!raw) return null;
    const decoded = jwt.verify(raw, AUTH_SECRET);
    return decoded.userId || decoded.id || null;
  } catch { return null; }
}

// Convert anything → plain string (null-safe, never throws)
function s(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean).join(', ') || null;
  const r = String(v).trim();
  return r || null;
}

// ── POST /api/onboarding/setup ────────────────────────────────────────────────
router.post('/setup', async (req, res) => {
  try {
    const b        = req.body;
    const supabase = getSupabase();
    const userId   = getUserId(req);

    // Accept both camelCase and snake_case field names from frontend
    const name = s(b.name);
    if (!name) return res.status(400).json({ error: 'Venue name is required' });

    console.log(`[Onboarding] User: ${userId || 'anon'} | Venue: ${name}`);
    console.log(`[Onboarding] Fields received:`, Object.keys(b).join(', '));

    // Deactivate old venue for this user
    if (userId) {
      await supabase.from('venues')
        .update({ is_active: false })
        .eq('user_id', userId)
        .eq('is_active', true);
    }

    const row = {
      user_id:             userId || null,
      is_active:           true,
      name,
      city:                s(b.city),
      state:               s(b.state),
      type:                s(b.type) || 'venue',
      capacity:            b.capacity ? parseInt(b.capacity) || null : null,
      site_url:            s(b.siteUrl || b.site_url),
      venue_business_type: s(b.venueBusinessType || b.venue_business_type) || 'tickets',
      pilot_mode:          s(b.pilotMode || b.pilot_mode) || 'suggest',
      alert_email:         s(b.alertEmail || b.alert_email),
      price_point:         s(b.pricePoint || b.price_point),
      // Accept both naming conventions for all array-like fields
      genres:              s(b.genres),
      event_types:         s(b.eventTypes || b.event_types),
      busiest_nights:      s(b.busiestNights || b.busiest_nights),
      competitors:         s(b.competitors),
      keywords:            s(b.customKeywords || b.keywords),
      target_customers:    s(b.targetCustomers || b.target_customers),
      product_categories:  s(b.productCategories || b.product_categories),
      // Social handles — accept both flat and nested
      instagram: s(b.socialHandles?.instagram || b.instagram),
      tiktok:    s(b.socialHandles?.tiktok    || b.tiktok),
      twitter:   s(b.socialHandles?.twitter   || b.twitter),
      facebook:  s(b.socialHandles?.facebook  || b.facebook),
    };

    console.log(`[Onboarding] Saving row:`, JSON.stringify(row));

    const { data: venue, error } = await supabase
      .from('venues')
      .insert([row])
      .select()
      .single();

    if (error) {
      console.error(`[Onboarding] DB ERROR: ${error.message}`);
      console.error(`[Onboarding] Row that failed:`, JSON.stringify(row));
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }

    // Update user account_type
    if (userId) {
      const accountType = (b.venueBusinessType || b.venue_business_type) === 'goods' ? 'product' : 'venue';
      const { error: userErr } = await supabase.from('users')
        .update({ account_type: accountType, updated_at: new Date().toISOString() })
        .eq('id', userId);
      if (userErr) console.warn(`[Onboarding] User update error: ${userErr.message}`);
      else console.log(`[Onboarding] account_type set to: ${accountType}`);
    }

    // Background deep pull
    try {
      const { runDeepPull } = require('../services/deeppull');
      runDeepPull({ ...venue, userId, user_id: userId, plan: 'starter' })
        .then(r => console.log(`[DeepPull] ${venue.name} complete — ${r?.signalCount || 0} signals`))
        .catch(e => console.warn(`[DeepPull] Error: ${e.message}`));
    } catch(e) {
      console.warn(`[DeepPull] Could not start: ${e.message}`);
    }

    console.log(`✅ [Onboarding] Saved: ${venue.name} (id: ${venue.id})`);

    res.json({
      success: true,
      venueId: venue.id,
      message: `${venue.name} is live on Fillo!`,
      venue,
    });

  } catch(err) {
    console.error('[Onboarding] Unexpected error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/onboarding/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await getSupabase()
      .from('venues').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(data);
  } catch(err) {
    res.status(404).json({ error: 'Venue not found' });
  }
});

module.exports = router;