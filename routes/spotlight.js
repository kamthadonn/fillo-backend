// spotlight.js — Enterprise-only deep spotlight analysis route
// POST /api/spotlight — generate ultra-deep analysis for one specific item or event

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

async function enterpriseOnly(req, res, next) {
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase
      .from('users')
      .select('plan')
      .eq('id', req.user.userId)
      .single();
    if (!user || user.plan !== 'enterprise') {
      return res.status(403).json({ error: 'Spotlight is an Enterprise feature. Upgrade to access.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// Deep Reddit search for specific item/event
async function spotlightRedditSearch(queries = []) {
  const results = [];
  for (const q of queries.slice(0, 6)) {
    try {
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=top&limit=8&t=year`;
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Fillo/1.0' },
        timeout: 6000
      });
      const posts = res.data?.data?.children || [];
      posts.forEach(p => {
        const d = p.data;
        results.push({
          title: d.title?.slice(0, 140),
          subreddit: d.subreddit,
          score: d.score,
          comments: d.num_comments,
          snippet: d.selftext?.slice(0, 300) || '',
          url: `https://reddit.com${d.permalink}`
        });
      });
    } catch (e) {
      console.warn('Spotlight Reddit error:', e.message);
    }
  }
  return results.sort((a, b) => (b.score + b.comments) - (a.score + a.comments)).slice(0, 15);
}

// Deep Twitter/X search for specific item/event
async function spotlightTwitterSearch(queries = []) {
  const bearer = process.env.X_BEARER_TOKEN;
  if (!bearer) return [];
  const results = [];
  for (const q of queries.slice(0, 3)) {
    try {
      const res = await axios.get(
        `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=15&tweet.fields=public_metrics,created_at`,
        { headers: { Authorization: `Bearer ${bearer}` }, timeout: 8000 }
      );
      const tweets = res.data?.data || [];
      tweets.forEach(t => {
        results.push({
          text: t.text?.slice(0, 200),
          likes: t.public_metrics?.like_count || 0,
          retweets: t.public_metrics?.retweet_count || 0,
          date: t.created_at
        });
      });
    } catch (e) {
      console.warn('Spotlight Twitter error:', e.message);
    }
  }
  return results.sort((a, b) => (b.likes + b.retweets * 3) - (a.likes + a.retweets * 3)).slice(0, 10);
}

// The deep Claude spotlight analysis
async function generateSpotlightAnalysis({
  venueName, venueType, city, venueBusinessType,
  spotlightType, // 'event' or 'item'
  spotlightName,
  spotlightDescription,
  spotlightDate,
  spotlightPrice,
  spotlightGoal,
  genres, competitors,
  redditData, twitterData
}) {
  const isEvent = spotlightType === 'event';
  const isGoods = venueBusinessType === 'goods';

  const prompt = `You are Fillo's ENTERPRISE SPOTLIGHT ENGINE — the most advanced analysis mode in the platform.

A venue is putting ALL of Fillo's intelligence on ONE specific ${isEvent ? 'event' : 'product/item'}. This is not a broad overview. This is a surgical, deep-focus marketing analysis and content campaign for exactly this thing.

VENUE CONTEXT:
- Venue: ${venueName} (${venueType || 'venue'}) in ${city || 'Unknown'}
- Business Type: ${isGoods ? 'Goods/Products' : 'Events/Tickets'}
- Genres/Vibes: ${(genres || []).join(', ') || 'Not specified'}
- Competitors: ${(competitors || []).join(', ') || 'None listed'}

SPOTLIGHT TARGET:
- Type: ${spotlightType === 'event' ? 'Event' : 'Product/Item'}
- Name: ${spotlightName}
- Description: ${spotlightDescription || 'No description provided'}
${spotlightDate ? '- Date/Launch: ' + spotlightDate : ''}
${spotlightPrice ? '- Price: ' + spotlightPrice : ''}
- Primary Goal: ${spotlightGoal || 'Maximum exposure and sales'}

LIVE MARKET INTELLIGENCE FOR THIS SPOTLIGHT:
Reddit signals: ${redditData.slice(0, 6).map(r => `"${r.title}" (${r.score} upvotes)`).join(' | ') || 'None found'}
Twitter signals: ${twitterData.slice(0, 5).map(t => `"${t.text?.slice(0, 80)}" (${t.likes} likes)`).join(' | ') || 'None found'}

Your job: Create a COMPLETE, LAUNCH-READY marketing campaign for this specific ${isEvent ? 'event' : 'product'}. Every draft must be polished, specific, and ready to publish or send. Do not be generic. Reference the event/item name and specific details in every piece of content.

Respond ONLY with valid JSON, no markdown:
{
  "spotlightScore": <number 0-100, how strong this spotlight opportunity is based on market data>,
  "spotlightVerdict": "<2-3 sentence punchy assessment — is this a slam dunk? what's the biggest risk? what's the biggest opportunity?>",
  "demandSignals": {
    "strength": "<High/Medium/Low>",
    "evidence": "<specific evidence from Reddit/Twitter data above, or market reasoning>",
    "timing": "<is now the right time? why?>",
    "audienceReady": "<who is most likely to respond to this right now?>"
  },
  "campaignStrategy": {
    "theme": "<the unifying marketing theme/angle for this campaign>",
    "primaryHook": "<THE single most compelling marketing line for this ${isEvent ? 'event' : 'product'}>",
    "scarcityAngle": "<how to create urgency — is there natural scarcity? how to frame it?>",
    "launchPlan": "<3-step launch sequence: pre-launch, launch day, follow-up>"
  },
  "contentCampaign": [
    {
      "platform": "Instagram",
      "destination": "Instagram Feed",
      "phase": "Pre-launch (3-5 days before)",
      "hook": "<first line — STOP THE SCROLL worthy>",
      "content": "<full caption, 200+ words, specific to ${spotlightName}, with hashtags>",
      "visual": "<describe exactly what the image/graphic should look like>",
      "why": "<why this specific post will perform>"
    },
    {
      "platform": "Instagram Stories",
      "destination": "Instagram Stories",
      "phase": "Launch day",
      "hook": "<1 punchy line for story text overlay>",
      "content": "<storyboard: 3-5 story frames, describe each frame and text overlay>",
      "visual": "<visual direction for each frame>",
      "why": "<the conversion mechanism>"
    },
    {
      "platform": "TikTok",
      "destination": "TikTok / Reels",
      "phase": "Launch day",
      "hook": "<first 3 seconds — what does the creator say/do to hook viewers>",
      "content": "<full video script, 30-45 seconds, with actions in [brackets]>",
      "visual": "<visual style — lighting, angles, energy>",
      "why": "<why this will get shares>"
    },
    {
      "platform": "Email",
      "destination": "Email Blast",
      "phase": "Launch day",
      "hook": "<subject line — write 3 subject line options>",
      "content": "<full email, 300-400 words, from the venue voice, specific to ${spotlightName}, with CTA>",
      "visual": "<header image suggestion>",
      "why": "<what drives the open and click>"
    },
    {
      "platform": "${isEvent ? 'Ticket Page' : 'Product Page'}",
      "destination": "${isEvent ? 'Ticketing / Event Page' : 'Product / Website Page'}",
      "phase": "Always live",
      "hook": "<page headline>",
      "content": "<full page copy, 250-350 words, conversion-optimized for ${spotlightName}>",
      "visual": "<hero image direction>",
      "why": "<the conversion flow>"
    },
    {
      "platform": "SMS / Push",
      "destination": "SMS or App Push Notification",
      "phase": "Day of / 24 hours before",
      "hook": "<the notification text — under 160 characters>",
      "content": "<2-3 SMS message variants: teaser, urgency, final call>",
      "visual": null,
      "why": "<highest-intent audience move>"
    },
    {
      "platform": "X / Twitter",
      "destination": "X (Twitter) Thread",
      "phase": "Launch day",
      "hook": "<Thread opener — first tweet>",
      "content": "<3-tweet thread: opener, detail, CTA — each under 280 chars>",
      "visual": "<image to attach to first tweet>",
      "why": "<organic reach strategy>"
    }
  ],
  "competitorGaps": "<how does this ${isEvent ? 'event' : 'product'} differentiate from competitors? what are they NOT doing that this spotlight can own?>",
  "riskFactors": ["<risk 1>", "<risk 2>"],
  "successMetrics": {
    "week1": "<what success looks like in the first week>",
    "target": "<the number to hit — ${isEvent ? 'tickets sold / attendance' : 'units sold / revenue'}>",
    "tracking": "<what to watch daily>"
  }
}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 5000,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = message.content[0].text.trim().replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

// POST /api/spotlight — run a deep spotlight analysis
router.post('/', authRequired, enterpriseOnly, async (req, res) => {
  try {
    const supabase = getSupabase();
    const {
      venue_id,
      spotlightType,   // 'event' or 'item'
      spotlightName,
      spotlightDescription,
      spotlightDate,
      spotlightPrice,
      spotlightGoal
    } = req.body;

    if (!spotlightName) {
      return res.status(400).json({ error: 'spotlightName is required' });
    }

    // Load venue data
    const { data: venue } = await supabase
      .from('venues')
      .select('*')
      .eq('id', venue_id)
      .eq('user_id', req.user.userId)
      .single();

    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const venueName = venue.name;
    const city = venue.city;
    const genres = typeof venue.genres === 'string' ? venue.genres.split(',').map(s => s.trim()) : (venue.genres || []);
    const competitors = typeof venue.competitors === 'string' ? venue.competitors.split(',').map(s => s.trim()) : (venue.competitors || []);

    // Build targeted search queries for this specific spotlight
    const searchQueries = [
      spotlightName,
      `${spotlightName} ${city || ''}`.trim(),
      `${spotlightName} ${venueName}`.trim(),
      `${spotlightType === 'event' ? 'event' : 'product'} ${spotlightName}`,
      `${city || ''} ${spotlightType === 'event' ? 'events' : 'shopping'}`.trim(),
      ...genres.slice(0, 2).map(g => `${g} ${spotlightType === 'event' ? 'event' : 'product'}`)
    ].filter(q => q.length > 2);

    // Load venue intelligence profile — gives Claude deep venue context
    let venueIntel = null;
    try {
      const { getVenueIntelligence } = require('../services/deeppull');
      venueIntel = await getVenueIntelligence(venue_id, req.user.userId);
      if (venueIntel) console.log(`[Spotlight] Loaded venue intel for ${venueName} (${venueIntel.signal_count} signals)`);
    } catch(e) { console.warn('[Spotlight] Could not load venue intel:', e.message); }

    // Merge intel into venue object so generateSpotlightAnalysis gets it
    if (venueIntel) {
      try {
        const cs = typeof venueIntel.content_strategy === 'string' ? JSON.parse(venueIntel.content_strategy) : (venueIntel.content_strategy || {});
        const extraKeywords = venueIntel.top_keywords?.split(', ').slice(0, 3) || []; genres.push(...extraKeywords);
      } catch {}
    }

    console.log(`🔦 Spotlight: "${spotlightName}" for ${venueName}`);
    console.log(`   Searching: ${searchQueries.slice(0, 3).join(', ')}...`);

    const [redditData, twitterData] = await Promise.all([
      spotlightRedditSearch(searchQueries),
      spotlightTwitterSearch([spotlightName, `${spotlightName} ${city || ''}`.trim(), venueName])
    ]);

    const analysis = await generateSpotlightAnalysis({
      venueName,
      venueType: venue.type,
      city,
      venueBusinessType: venue.venue_business_type || 'tickets',
      spotlightType: spotlightType || 'event',
      spotlightName,
      spotlightDescription,
      spotlightDate,
      spotlightPrice,
      spotlightGoal,
      genres,
      competitors,
      redditData,
      twitterData
    });

    // Save spotlight to audit
    await supabase.from('audit_trail').insert({
      user_id: req.user.userId,
      venue_id: venue_id,
      action: 'Spotlight analysis generated',
      description: `Deep analysis: "${spotlightName}" — Score: ${analysis.spotlightScore}/100`,
      platform: 'Spotlight',
      pilot_mode: venue.pilot_mode || 'suggest',
      created_at: new Date().toISOString()
    });

    res.json({
      success: true,
      venueName,
      spotlightName,
      spotlightType,
      generatedAt: new Date().toISOString(),
      redditSignals: redditData.length,
      twitterSignals: twitterData.length,
      ...analysis
    });

  } catch (err) {
    console.error('Spotlight error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/spotlight/history — last 10 spotlights for this account
router.get('/history', authRequired, enterpriseOnly, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('audit_trail')
      .select('*')
      .eq('user_id', req.user.userId)
      .eq('platform', 'Spotlight')
      .order('created_at', { ascending: false })
      .limit(10);
    res.json({ success: true, history: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
