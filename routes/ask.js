// routes/ask.js
// Ask Fillo — AI strategist chat endpoint
// Requires Pro or Enterprise plan
// Uses venue intelligence profile + conversation history for context

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';
const PLAN_RANK   = { starter: 1, pro: 2, enterprise: 3, voucher: 3 };

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function authRequired(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    req.user = jwt.verify(token, AUTH_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function requirePro(req, res, next) {
  const rank = PLAN_RANK[(req.user.plan || 'starter').toLowerCase()] || 1;
  if (rank >= 2) return next();
  return res.status(403).json({
    error: 'Ask Fillo requires Pro or Enterprise plan.',
    requiredPlan: 'pro',
    currentPlan: req.user.plan,
    upgrade: true,
  });
}

// POST /api/ask
router.post('/', authRequired, requirePro, async (req, res) => {
  try {
    const { question, history = [] } = req.body;
    if (!question) return res.status(400).json({ error: 'question required' });

    const supabase = getSupabase();
    const userId   = req.user.userId;

    // Load venue context
    const { data: venue } = await supabase
      .from('venues')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    // Load intelligence profile
    let intelContext = '';
    if (venue) {
      const { data: intel } = await supabase
        .from('venue_intelligence')
        .select('market_summary, audience_profile, brand_voice, top_keywords, local_competition, market_trends, learning_summary')
        .eq('user_id', userId)
        .eq('venue_id', venue.id)
        .maybeSingle();

      if (intel) {
        intelContext = `
VENUE INTELLIGENCE (what Fillo has learned):
Market: ${intel.market_summary || 'N/A'}
Audience: ${intel.audience_profile || 'N/A'}
Brand voice: ${intel.brand_voice || 'N/A'}
Top keywords: ${intel.top_keywords || 'N/A'}
Market trends: ${intel.market_trends || 'N/A'}
${intel.learning_summary ? 'What Fillo has learned: ' + intel.learning_summary : ''}`;
      }
    }

    // Load latest scan for context
    const { data: latestScan } = await supabase
      .from('scans')
      .select('fomo_score, insight, trend_count, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const scanContext = latestScan
      ? `\nLATEST SCAN: FOMO Score ${latestScan.fomo_score}, ${latestScan.trend_count} signals, insight: "${latestScan.insight}"`
      : '';

    const systemPrompt = `You are Fillo AI, a sharp and direct venue intelligence strategist. You know this account deeply.

VENUE: ${venue?.name || 'Unknown'}
TYPE: ${venue?.venue_business_type === 'goods' ? 'Retail/Product business' : 'Venue/Events business'}
CITY: ${venue?.city || 'Unknown'}${venue?.state ? ', ' + venue.state : ''}
PLAN: ${req.user.plan || 'pro'}
${intelContext}
${scanContext}

Rules:
- Be direct, actionable, and specific to THIS venue — never generic
- Reference their actual market, city, and signals when relevant
- If they ask for content, write it immediately — don't ask clarifying questions
- Keep responses focused and useful — this is a strategy tool, not a chatbot
- For ${venue?.venue_business_type === 'goods' ? 'product/retail' : 'venue/ticketing'} context always`;

    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Build message history
    const messages = [
      ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: question },
    ];

    const response = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 800,
      system:     systemPrompt,
      messages,
    });

    const answer = response.content[0].text;

    // Log to audit trail
    try {
      await supabase.from('audit_trail').insert({
        user_id:    userId,
        venue_id:   venue?.id,
        action:     'Ask Fillo — question answered',
        description: question.slice(0, 100),
        platform:   'Ask Fillo',
        created_at: new Date().toISOString(),
      });
    } catch(e) {}

    res.json({ success: true, answer, question });

  } catch (err) {
    console.error('[Ask Fillo]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
