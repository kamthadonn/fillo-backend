// routes/trends.js
// ALL scan endpoints require auth — no anonymous scans, no intelligence bleed
// Every scan is scoped to the authenticated user's venue only

const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const { scanTrends, getDailyTrends, getRelatedQueries } = require('../services/googletrends');
const { runFullScan } = require('../services/intelligence');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

// Auth middleware — all scan routes require a valid token
function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    req.user = jwt.verify(token, AUTH_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// GET /api/trends — daily trending topics (public, no user data)
router.get('/', async (req, res) => {
  try {
    const geo   = req.query.geo || 'US';
    const daily = await getDailyTrends(geo);
    res.json({ success: true, trends: daily, geo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trends/scan — keyword trend scores (requires auth, uses user's plan)
router.get('/scan', requireAuth, async (req, res) => {
  try {
    const keywords = req.query.keywords?.split(',') || ['nightlife', 'events'];
    const geo      = req.query.geo || 'US';
    const userId   = req.user.userId || req.user.id;
    const plan     = req.user.plan || 'starter';
    const results  = await scanTrends(keywords, geo, userId, plan);
    res.json({ success: true, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trends/generate — full intelligence scan
// REQUIRES auth — scoped to requesting user's venue only
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const plan   = req.user.plan || 'starter';
    const supabase = getSupabase();

    // ── CRITICAL: always fetch venue from DB using this user's ID ──────────
    // Never trust venueId from request body — always verify ownership
    const { data: venue, error: venueErr } = await supabase
      .from('venues')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (venueErr) {
      console.error('[Scan] Venue fetch error:', venueErr.message);
      return res.status(500).json({ error: 'Could not load venue data' });
    }

    if (!venue) {
      return res.status(404).json({ error: 'No venue found for this account. Complete onboarding first.' });
    }

    // Build scan payload entirely from DB — never from untrusted request body
    const toArr = v => v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [];

    const scanPayload = {
      venueName:          venue.name,
      venueType:          venue.type || 'venue',
      city:               venue.city || '',
      venueAddress:       [venue.city, venue.state].filter(Boolean).join(', '),
      capacity:           venue.capacity || null,
      genres:             toArr(venue.genres),
      keywords:           toArr(venue.keywords),
      competitors:        toArr(venue.competitors),
      eventTypes:         toArr(venue.event_types),
      busiestNights:      toArr(venue.busiest_nights),
      venueBusinessType:  venue.venue_business_type || 'tickets',
      productCategories:  venue.product_categories || '',
      targetCustomers:    venue.target_customers || '',
      pricePoint:         venue.price_point || '',
      siteUrl:            venue.site_url || '',
      brandVoice:         venue.brand_voice || '',
      pilotMode:          venue.pilot_mode || 'auto-draft',
      venueId:            venue.id,
      userId,   // ← passed into intelligence engine for user-scoped storage
      plan,
    };

    console.log(`[Scan] Starting for user ${userId}, venue: ${venue.name} (${venue.id})`);

    const result = await runFullScan(scanPayload);

    // Save scan record scoped to this user + venue
    try {
      await supabase.from('scans').insert({
        user_id:             userId,
        venue_id:            venue.id,
        fomo_score:          result.fomoScore || 0,
        insight:             result.insight   || '',
        trends:              JSON.stringify(result.trends || []),
        trend_count:         (result.trends || []).length,
        venue_business_type: venue.venue_business_type || 'tickets',  // ← so replayed scans use right dashboard
        plan:                plan,                                      // ← so replayed scans use right tier
      });
    } catch (saveErr) {
      console.warn('[Scan] Could not save scan record:', saveErr.message);
    }

    // Always include venueBusinessType + plan in response
    // so dashboard applyDashboard() gets the right of the 6 configs
    res.json({
      success:             true,
      venueBusinessType:   venue.venue_business_type || 'tickets',
      plan,
      ...result,
    });

  } catch (err) {
    console.error('[Scan] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trends/related — related queries (public)
router.get('/related', async (req, res) => {
  try {
    const keyword = req.query.keyword || 'nightlife';
    const geo     = req.query.geo || 'US';
    const results = await getRelatedQueries(keyword, geo);
    res.json({ success: true, keyword, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
