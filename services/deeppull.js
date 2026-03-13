// deeppull.js — Venue Intelligence Profile Builder
//
// PURPOSE: Learn everything about this venue. That is it.
// Runs silently in the background after onboarding.
// Does NOT generate drafts. Does NOT save a scan.
// Stores one intelligence profile per venue that all future
// scans and Spotlights read from.

const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

const toList = (v) => typeof v === 'string'
  ? v.split(',').map(s => s.trim()).filter(Boolean)
  : (Array.isArray(v) ? v.filter(Boolean) : []);

// ─── REDDIT MARKET RESEARCH ──────────────────────────────────────────────────
async function redditMarketResearch(queries = []) {
  const results = [];
  for (const q of queries.slice(0, 6)) {
    try {
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=top&limit=6&t=year`;
      const res = await axios.get(url, { headers: { 'User-Agent': 'Fillo/1.0' }, timeout: 6000 });
      (res.data?.data?.children || []).forEach(p => {
        const d = p.data;
        if (d.score > 5) results.push({
          query: q,
          title: d.title?.slice(0, 120),
          subreddit: d.subreddit,
          score: d.score,
          comments: d.num_comments,
          snippet: (d.selftext || d.title || '').slice(0, 250)
        });
      });
    } catch (e) { console.warn(`[DeepPull] Reddit: "${q}":`, e.message); }
  }
  return results.sort((a, b) => (b.score + b.comments) - (a.score + a.comments)).slice(0, 15);
}

// ─── TWITTER/X RESEARCH ──────────────────────────────────────────────────────
async function twitterMarketResearch(handle = '', marketQueries = []) {
  const bearer = process.env.X_BEARER_TOKEN;
  if (!bearer) return { accountTweets: [], marketTweets: [] };

  const accountTweets = [], marketTweets = [];

  if (handle) {
    try {
      const res = await axios.get(
        `https://api.twitter.com/2/tweets/search/recent?query=from:${handle.replace('@','')}&max_results=10&tweet.fields=public_metrics,created_at`,
        { headers: { Authorization: `Bearer ${bearer}` }, timeout: 8000 }
      );
      (res.data?.data || []).forEach(t => accountTweets.push({
        text: t.text?.slice(0, 200),
        likes: t.public_metrics?.like_count || 0,
        retweets: t.public_metrics?.retweet_count || 0
      }));
    } catch (e) { console.warn('[DeepPull] Twitter account:', e.message); }
  }

  for (const q of marketQueries.slice(0, 2)) {
    try {
      const res = await axios.get(
        `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=10&tweet.fields=public_metrics`,
        { headers: { Authorization: `Bearer ${bearer}` }, timeout: 8000 }
      );
      (res.data?.data || []).forEach(t => marketTweets.push({
        text: t.text?.slice(0, 200),
        likes: t.public_metrics?.like_count || 0,
        query: q
      }));
    } catch (e) { console.warn('[DeepPull] Twitter market:', e.message); }
  }

  return {
    accountTweets: accountTweets.sort((a,b) => (b.likes+b.retweets)-(a.likes+a.retweets)).slice(0,5),
    marketTweets: marketTweets.sort((a,b) => b.likes-a.likes).slice(0,8)
  };
}

// ─── CLAUDE VENUE PROFILING ──────────────────────────────────────────────────
// Pure learning — synthesizes signals into a reusable intelligence profile.
// No drafts, no content. Just deep understanding of this venue.
async function buildVenueProfile({
  venueName, venueType, city, state, genres, competitors, keywords,
  eventTypes, capacity, venueBusinessType, instagram, tiktok, twitter, facebook,
  redditSignals, twitterData
}) {
  const isGoods = venueBusinessType === 'goods';

  const prompt = `You are Fillo's venue intelligence engine. Your only job right now is to learn this venue deeply.
Do NOT generate any marketing content. Do NOT write drafts or captions.
Build a permanent intelligence profile that will make every future scan and analysis smarter.

VENUE FACTS:
Name: ${venueName}
Business Type: ${isGoods ? 'Sells goods/products' : 'Hosts events / sells tickets'}
Venue Type: ${venueType || 'venue'}
Location: ${city || 'Unknown'}${state ? ', ' + state : ''}
Capacity: ${capacity || 'Unknown'}
Genres/Vibes: ${genres.join(', ') || 'Not specified'}
Event Types: ${eventTypes.join(', ') || 'Not specified'}
Competitors: ${competitors.join(', ') || 'None listed'}
Keywords: ${keywords.join(', ') || 'None'}
Social: Instagram: ${instagram || 'none'} | TikTok: ${tiktok || 'none'} | X: ${twitter || 'none'} | Facebook: ${facebook || 'none'}

REDDIT — what the market is talking about:
${redditSignals.slice(0, 8).map(r => `- "${r.title}" (r/${r.subreddit}, ${r.score} upvotes, ${r.comments} comments)`).join('\n') || 'No data'}

THEIR OWN X/TWITTER POSTS — voice and engagement reference:
${twitterData.accountTweets.map(t => `- "${t.text}" (${t.likes} likes, ${t.retweets} RTs)`).join('\n') || 'None found'}

MARKET X/TWITTER — what their audience engages with:
${twitterData.marketTweets.map(t => `- "${t.text}" (${t.likes} likes)`).join('\n') || 'None found'}

Now build the intelligence profile. This is research, not content creation.
Respond ONLY with valid JSON, no markdown:
{
  "marketSummary": "<4-5 sentences: competitive landscape in this city, what this venue type looks like here, what the audience cares about most, what opportunity exists that competitors aren't capturing>",
  "audienceProfile": "<3-4 sentences: who actually attends/buys here — age, lifestyle, motivations, when they're active, what makes them loyal>",
  "competitorLandscape": [
    { "name": "<competitor or type>", "strength": "<what they do well>", "gap": "<specific gap to exploit>" }
  ],
  "brandVoiceRecommendation": "<2-3 sentences: what tone, language style, and personality this venue's content should have — specific to this venue, not generic>",
  "contentStrategy": {
    "tone": "<e.g. Bold and unapologetic>",
    "bestPostingDays": ["<day>", "<day>", "<day>"],
    "bestPostingTimes": ["<time>", "<time>"],
    "topContentFormats": ["<format>", "<format>", "<format>"],
    "hashtagStrategy": "<which hashtag categories work best for this venue type in this city>",
    "postingCadence": "<recommended posts per week>"
  },
  "audienceTriggers": [
    "<specific trigger that drives this audience to act>",
    "<another trigger>",
    "<another trigger>"
  ],
  "topKeywords": ["<keyword>", "<keyword>", "<keyword>", "<keyword>", "<keyword>"],
  "localMarketTrends": "<2-3 sentences: what trends are active in this specific city/market right now based on the signals gathered>",
  "spotlightReadiness": "<1 sentence: the single most spotlight-worthy asset or opportunity this venue has right now>"
}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = message.content[0].text.trim().replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

// ─── MASTER DEEP PULL ────────────────────────────────────────────────────────
async function runDeepPull(venueData) {
  const {
    id: venueId, user_id: userId,
    name: venueName, city, state, type: venueType,
    genres, competitors, keywords, event_types, capacity,
    venue_business_type, instagram, tiktok, twitter, facebook
  } = venueData;

  console.log(`\n🔬 [DeepPull] Learning: ${venueName} (${city || 'unknown city'})`);

  const genreList      = toList(genres);
  const competitorList = toList(competitors);
  const keywordList    = toList(keywords);
  const eventTypeList  = toList(event_types);

  const redditQueries = [
    venueName,
    `${city} ${venueType || 'nightclub'}`,
    `${city} nightlife`,
    ...genreList.slice(0, 2).map(g => `${g} ${city}`),
    ...competitorList.slice(0, 2),
    `${city} events`
  ].filter(q => q?.length > 2);

  const twitterMarketQ = [
    `${city} ${genreList[0] || 'nightlife'}`,
    `${city} events this weekend`
  ].filter(q => q?.length > 3);

  const [redditSignals, twitterData] = await Promise.all([
    redditMarketResearch(redditQueries),
    twitterMarketResearch(twitter || '', twitterMarketQ)
  ]);

  const totalSignals = redditSignals.length
    + twitterData.accountTweets.length
    + twitterData.marketTweets.length;

  console.log(`   Signals: ${totalSignals} (Reddit: ${redditSignals.length}, Twitter: ${twitterData.accountTweets.length + twitterData.marketTweets.length})`);

  const profile = await buildVenueProfile({
    venueName, venueType, city, state,
    genres: genreList, competitors: competitorList,
    keywords: keywordList, eventTypes: eventTypeList,
    capacity, venueBusinessType: venue_business_type || 'tickets',
    instagram, tiktok, twitter, facebook,
    redditSignals, twitterData
  });

  // Save intelligence profile — this is the only thing we write
  const supabase = getSupabase();
  await supabase.from('venue_intelligence').upsert({
    user_id:             userId,
    venue_id:            venueId,
    market_summary:      profile.marketSummary,
    audience_profile:    profile.audienceProfile,
    local_competition:   JSON.stringify(profile.competitorLandscape || []),
    market_trends:       profile.localMarketTrends,
    brand_voice:         profile.brandVoiceRecommendation,
    content_strategy:    JSON.stringify(profile.contentStrategy || {}),
    reddit_signals:      JSON.stringify(redditSignals),
    twitter_signals:     JSON.stringify(twitterData),
    top_keywords:        (profile.topKeywords || []).join(', '),
    audience_triggers:   JSON.stringify(profile.audienceTriggers || []),
    spotlight_readiness: profile.spotlightReadiness,
    pulled_at:           new Date().toISOString(),
    signal_count:        totalSignals
  }, { onConflict: 'venue_id' })
    .then(() => console.log(`✅ [DeepPull] Profile saved for ${venueName}`))
    .catch(e => console.error('[DeepPull] Save error:', e.message));

  // Single clean audit entry — no content details, just a status note
  await supabase.from('audit_trail').insert({
    user_id:    userId,
    venue_id:   venueId,
    action:     'Venue intelligence profile ready',
    description: `Fillo learned your market — ${totalSignals} signals gathered across Reddit and X`,
    platform:   'Fillo Intelligence',
    pilot_mode: venueData.pilot_mode || 'suggest',
    created_at: new Date().toISOString()
  }).catch(() => {});

  return { success: true, signalCount: totalSignals };
}

// ─── READ PROFILE (used by intelligence.js and spotlight.js) ─────────────────
async function getVenueIntelligence(venueId) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('venue_intelligence')
    .select('*')
    .eq('venue_id', venueId)
    .maybeSingle();
  return data || null;
}


// ─── CONTINUOUS LEARNING ─────────────────────────────────────────────────────
// Called after every meaningful action: scan, approved draft, spotlight
// Updates the venue_intelligence profile with what worked and what didn't
// so future scans and spotlights are progressively smarter

async function learnFrom({ venueId, userId, eventType, data }) {
  const supabase = getSupabase();

  // Load current profile
  const { data: profile } = await supabase
    .from('venue_intelligence')
    .select('*')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!profile) return; // nothing to update if no profile exists yet

  try {
    // Parse existing learned patterns
    const learnedPatterns = (() => {
      try { return JSON.parse(profile.learned_patterns || '{}'); }
      catch { return {}; }
    })();
    const now = new Date().toISOString();

    if (eventType === 'scan_complete') {
      // After a scan: note what the FOMO score was, which topics were hot
      const scanCount = (learnedPatterns.scanCount || 0) + 1;
      const fomoHistory = learnedPatterns.fomoHistory || [];
      fomoHistory.push({ score: data.fomoScore, at: now });
      if (fomoHistory.length > 20) fomoHistory.shift(); // keep last 20

      const avgFomo = fomoHistory.length
        ? Math.round(fomoHistory.reduce((s, x) => s + x.score, 0) / fomoHistory.length)
        : data.fomoScore;

      const hotTopics = learnedPatterns.hotTopics || [];
      (data.trendTopics || []).slice(0, 3).forEach(t => {
        const existing = hotTopics.find(h => h.topic === t);
        if (existing) existing.count++;
        else hotTopics.push({ topic: t, count: 1 });
      });
      hotTopics.sort((a, b) => b.count - a.count);
      if (hotTopics.length > 15) hotTopics.length = 15;

      learnedPatterns.scanCount = scanCount;
      learnedPatterns.fomoHistory = fomoHistory;
      learnedPatterns.avgFomoScore = avgFomo;
      learnedPatterns.hotTopics = hotTopics;
      learnedPatterns.lastScanAt = now;

    } else if (eventType === 'draft_approved') {
      // After a draft is approved: note which platform and content type resonates
      const approvedDrafts = learnedPatterns.approvedDrafts || [];
      approvedDrafts.push({
        platform: data.platform,
        type: data.draftType,
        hookSnippet: (data.hook || '').slice(0, 60),
        approvedAt: now
      });
      if (approvedDrafts.length > 30) approvedDrafts.shift();

      // Track which platforms get approved most
      const platformApprovals = learnedPatterns.platformApprovals || {};
      platformApprovals[data.platform] = (platformApprovals[data.platform] || 0) + 1;

      learnedPatterns.approvedDrafts = approvedDrafts;
      learnedPatterns.platformApprovals = platformApprovals;
      learnedPatterns.lastApprovedAt = now;

    } else if (eventType === 'draft_rejected') {
      // After a draft is rejected: note what didn't resonate
      const rejectedPatterns = learnedPatterns.rejectedPatterns || [];
      rejectedPatterns.push({
        platform: data.platform,
        type: data.draftType,
        reason: data.reason || 'user rejected',
        at: now
      });
      if (rejectedPatterns.length > 20) rejectedPatterns.shift();
      learnedPatterns.rejectedPatterns = rejectedPatterns;

    } else if (eventType === 'spotlight_complete') {
      // After a spotlight: note which item/event got spotlighted and its score
      const spotlightHistory = learnedPatterns.spotlightHistory || [];
      spotlightHistory.push({
        name: data.spotlightName,
        type: data.spotlightType,
        score: data.spotlightScore,
        at: now
      });
      if (spotlightHistory.length > 10) spotlightHistory.shift();
      learnedPatterns.spotlightHistory = spotlightHistory;
      learnedPatterns.lastSpotlightAt = now;
    }

    learnedPatterns.lastLearnedAt = now;
    learnedPatterns.totalEvents = (learnedPatterns.totalEvents || 0) + 1;

    // Build a Claude-readable learning summary for future prompts
    const topPlatforms = Object.entries(learnedPatterns.platformApprovals || {})
      .sort(([,a],[,b]) => b - a).slice(0, 3).map(([p]) => p);
    const recurringTopics = (learnedPatterns.hotTopics || []).slice(0, 5).map(h => h.topic);

    const learningSummary = [
      learnedPatterns.scanCount ? `${learnedPatterns.scanCount} scans run` : null,
      learnedPatterns.avgFomoScore ? `Avg FOMO score: ${learnedPatterns.avgFomoScore}` : null,
      topPlatforms.length ? `Best performing platforms: ${topPlatforms.join(', ')}` : null,
      recurringTopics.length ? `Recurring hot topics: ${recurringTopics.join(', ')}` : null,
      (learnedPatterns.approvedDrafts || []).length ? `${learnedPatterns.approvedDrafts.length} drafts approved so far` : null,
    ].filter(Boolean).join(' | ');

    // Update the profile with learned patterns
    await supabase.from('venue_intelligence').update({
      learned_patterns: JSON.stringify(learnedPatterns),
      learning_summary: learningSummary,
      last_updated: now,
      signal_count: profile.signal_count + 1
    }).eq('venue_id', venueId);

  } catch (e) {
    console.error('[Learn] Update error:', e.message);
  }
}

module.exports = { runDeepPull, getVenueIntelligence, learnFrom };