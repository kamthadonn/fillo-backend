const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function authRequired(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.AUTH_SECRET || 'fillo-super-secret-2026');
    next();
  } catch(e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireEnterprise(req, res, next) {
  const plan = (req.user.plan || 'starter').toLowerCase();
  if (plan !== 'enterprise' && plan !== 'voucher') {
    return res.status(403).json({ error: 'CapCut Studio requires Enterprise.', upgrade: true });
  }
  next();
}

// POST /api/capcut/generate
router.post('/generate', authRequired, requireEnterprise, async (req, res) => {
  try {
    const supabase = getSupabase();
    const userId   = req.user.userId || req.user.id;
    const { videoType = 'urgency', format = 'reels' } = req.body;

    const { data: venue } = await supabase
      .from('venues')
      .select('id, name, city, state, venue_business_type')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (!venue) return res.status(404).json({ error: 'No venue found. Complete onboarding first.' });

    const { data: latestScan } = await supabase
      .from('scans')
      .select('fomo_score, trends, insight')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const fomoScore = latestScan?.fomo_score || 72;
    let trends = [];
    try { trends = JSON.parse(latestScan?.trends || '[]'); } catch(e) {}
    const insight = latestScan?.insight || '';

    let result;
    try {
      const { generateVideoPackage } = require('../services/capcut');
      result = await generateVideoPackage({
        venueName: venue.name,
        city:      venue.city || '',
        fomoScore, trends, insight, videoType, format,
        plan:   req.user.plan || 'enterprise',
        userId,
      });
    } catch(err) {
      console.warn('[CapCut] Claude failed, using fallback:', err.message);
      const { buildFallback } = require('../services/capcut');
      result = buildFallback({ venueName: venue.name, city: venue.city || '', fomoScore, videoType, format });
    }

    try {
      await supabase.from('audit_trail').insert({
        user_id:     userId,
        action:      'CapCut video package generated — ' + videoType,
        description: venue.name + ' · ' + format + ' · FOMO Score: ' + fomoScore,
        platform:    'CapCut Studio',
        created_at:  new Date().toISOString(),
      });
    } catch(e) {}

    res.json(result);
  } catch(err) {
    console.error('[CapCut]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/capcut/formats
router.get('/formats', authRequired, (req, res) => {
  res.json({
    success: true,
    formats: {
      reels:     { width:1080, height:1920, fps:30, duration:15, label:'Instagram Reels / TikTok' },
      shorts:    { width:1080, height:1920, fps:30, duration:30, label:'YouTube Shorts' },
      story:     { width:1080, height:1920, fps:30, duration:15, label:'Story (IG/FB)' },
      landscape: { width:1920, height:1080, fps:30, duration:60, label:'Landscape / YouTube' },
      square:    { width:1080, height:1080, fps:30, duration:30, label:'Square Feed Post' },
    },
    capcutLinks: {
      web:    'https://www.capcut.com',
      appIos: 'https://apps.apple.com/app/capcut/id1500855883',
    },
  });
});

module.exports = router;