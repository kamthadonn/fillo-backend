// routes/capcut.js
// CapCut Studio — Enterprise only
// Generates SeedAnce 2.0 prompts, video timelines, scripts, captions
// from live Fillo intelligence data

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.AUTH_SECRET || 'fillo-super-secret-2026');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireEnterprise(req, res, next) {
  const plan = (req.user.plan || 'starter').toLowerCase();
  if (plan !== 'enterprise' && plan !== 'voucher') {
    return res.status(403).json({
      error: 'CapCut Studio is an Enterprise feature.',
      upgrade: true,
      upgradeUrl: '/index.html#pricing',
    });
  }
  next();
}

// ── POST /api/capcut/generate ─────────────────────────────────────────────────
// Main generation endpoint — takes venue context + video preferences
// Returns full production package: timeline, SeedAnce prompt, script, captions
router.post('/generate', authRequired, requireEnterprise, async (req, res) => {
  try {
    const supabase = getSupabase();
    const userId   = req.user.userId || req.user.id;
    const plan     = req.user.plan || 'enterprise';

    const { videoType = 'urgency', format = 'reels' } = req.body;

    // Load venue
    const { data: venue } = await supabase
      .from('venues')
      .select('id, name, city, state, venue_business_type, type')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (!venue) return res.status(404).json({ error: 'No venue found. Complete onboarding first.' });

    // Load latest scan for intelligence context
    const { data: latestScan } = await supabase
      .from('scans')
      .select('fomo_score, trends, insight, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const fomoScore = latestScan?.fomo_score || 72;
    let trends = [];
    try { trends = JSON.parse(latestScan?.trends || '[]'); } catch(e) {}
    const insight = latestScan?.insight || '';

    const { generateVideoPackage, buildFallback } = require('../services/capcut');

    let result;
    try {
      result = await generateVideoPackage({
        venueName: venue.name,
        city:      venue.city || '',
        fomoScore,
        trends,
        insight,
        videoType,
        format,
        plan,
        userId,
      });
    } catch(err) {
      console.warn('[CapCut] Claude generation failed, using fallback:', err.message);
      result = buildFallback({
        venueName: venue.name,
        city:      venue.city || '',
        fomoScore,
        videoType,
        format,
      });
    }

    // Save to audit trail
    try {
      await supabase.from('audit_trail').insert({
        user_id:     userId,
        action:      `CapCut video package generated — ${videoType}`,
        description: `${venue.name} · Format: ${format} · FOMO Score: ${fomoScore} · SeedAnce 2.0`,
        platform:    'CapCut Studio',
        created_at:  new Date().toISOString(),
      });
    } catch(e) { /* non-blocking */ }

    res.json(result);
  } catch (err) {
    console.error('[CapCut] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/capcut/formats ───────────────────────────────────────────────────
// Returns all available video formats and SeedAnce free features
router.get('/formats', authRequired, (req, res) => {
  const { FORMAT_SPECS, SEEDANCE_FREE_FEATURES } = require('../services/capcut');
  res.json({
    success: true,
    formats: FORMAT_SPECS,
    seedanceFreeFeatures: SEEDANCE_FREE_FEATURES,
    capcutLinks: {
      web:    'https://www.capcut.com',
      appIos: 'https://apps.apple.com/app/capcut/id1500855883',
      appAndroid: 'https://play.google.com/store/apps/details?id=com.lemon.lvoverseas',
    },
  });
});

// ── POST /api/capcut/seedance-prompt ─────────────────────────────────────────
// Quick endpoint — just generates a SeedAnce 2.0 prompt, no full package
// Faster for users who just want the AI prompt
router.post('/seedance-prompt', authRequired, requireEnterprise, async (req, res) => {
  try {
    const { sceneDescription, venueName, mood, duration = 15 } = req.body;
    if (!sceneDescription) return res.status(400).json({ error: 'sceneDescription required' });

    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Write a SeedAnce 2.0 AI video generation prompt for CapCut based on this description: "${sceneDescription}" for ${venueName || 'a venue'}. Mood: ${mood || 'energetic'}. Duration: ${duration} seconds. 

The prompt should be 3-4 sentences, cinematic, specific about camera movement, lighting, atmosphere, and energy. Include negative prompt suggestions. Format as JSON: {"prompt": "...", "negative": "...", "style": "..."}`
      }],
    });

    const raw = message.content[0].text.trim().replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(raw);
    res.json({ success: true, ...parsed });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;