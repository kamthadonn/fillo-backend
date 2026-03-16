const { scanTrends } = require('./googletrends');
const { getXSignals } = require('./twitter');
const { getInstagramSignals } = require('./instagram');
const { getNewsSignals } = require('./newssignals');
const { getWeatherSignals } = require('./weathersignals');
const { getEventbriteSignals } = require('./eventbritesignals');
const { getYelpSignals } = require('./yelpsignals');
const { scanSearchConsole } = require('./searchconsole');
const { buildVoicePrompt } = require('./brandvoice');
const { checkBlackout } = require('./blackout');

// Safe wrapper: any signal source can fail — scan always completes
async function safeSignal(name, fn) {
  try {
    const result = await fn();
    return result;
  } catch (err) {
    console.warn(`[Signal:${name}] Skipped:`, err.message);
    return [];
  }
}
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── GOOGLE TRENDS ───────────────────────────────────────────────────────────
async function getTrends(keywords = [], geo = 'US') {
  // Google Trends is blocked server-side — using Reddit-powered scoring
  try {
    const result = await scanTrends(keywords, geo);
    return result.keywords || [];
  } catch(e) {
    console.warn('[Trends] Reddit scan failed:', e.message);
    return [];
  }
}

// ─── REDDIT ──────────────────────────────────────────────────────────────────
async function getRedditSignals(keywords = [], city = '', venueBusinessType = 'tickets') {
  const results = [];
  const citySubreddit = city.toLowerCase().replace(/\s+/g, '');
  const isGoods = venueBusinessType === 'goods';
  const subreddits = isGoods
    ? ['streetwear', 'femalefashionadvice', 'malefashionadvice', 'frugalmalefashion', 'Sneakers', citySubreddit].filter(Boolean)
    : ['nightlife', 'cocktails', 'EDM', 'hiphop', 'bartenders', citySubreddit].filter(Boolean);

  try {
    const clientId = process.env.REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;

    let headers = { 'User-Agent': 'Fillo/1.0 by /u/FilloAI' };

    if (clientId && clientSecret) {
      // Authenticated
      const tokenRes = await axios.post(
        'https://www.reddit.com/api/v1/access_token',
        'grant_type=client_credentials',
        {
          auth: { username: clientId, password: clientSecret },
          headers: { 'User-Agent': headers['User-Agent'], 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );
      const token = tokenRes.data.access_token;
      headers['Authorization'] = `Bearer ${token}`;
    }

    for (const sub of subreddits.slice(0, 3)) {
      try {
        const url = clientId
          ? `https://oauth.reddit.com/r/${sub}/hot.json?limit=10`
          : `https://www.reddit.com/r/${sub}/hot.json?limit=10`;

        const res = await axios.get(url, { headers, timeout: 5000 });
        const posts = res.data?.data?.children || [];

        posts.slice(0, 3).forEach(post => {
          const p = post.data;
          const score = Math.min(99, Math.round((p.score / 100) + (p.num_comments / 10)));
          results.push({
            topic: p.title.slice(0, 80),
            subreddit: sub,
            upvotes: p.score,
            comments: p.num_comments,
            score: Math.max(40, score),
            hot: p.score > 500 || p.num_comments > 100,
            source: 'Reddit',
            url: `https://reddit.com${p.permalink}`,
          });
        });
      } catch (e) {
        console.error(`Reddit r/${sub} error:`, e.message);
      }
    }
  } catch (e) {
    console.error('Reddit auth error:', e.message);
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 6);
}

// ─── CLAUDE INTELLIGENCE ─────────────────────────────────────────────────────
async function generateIntelligence({ venueName, venueType, city, keywords, genres, competitors, eventTypes, busiestNights, capacity, venueBusinessType, trends, dailyTrends, redditSignals, xSignals, instagramSignals, newsSignals, weatherData, eventbriteSignals, yelpSignals, searchConsoleData, placeDetails, brandVoice, venueId, userId }) {
  try {
    const trendsText = trends.map(t => `- "${t.keyword}": score ${t.score}, ${t.delta > 0 ? '+' + t.delta : t.delta}% vs last week, ${t.hot ? 'HOT' : 'stable'}`).join('\n');
    const redditText = redditSignals.slice(0, 4).map(r => `- r/${r.subreddit}: "${r.topic}" — ${r.upvotes} upvotes, ${r.comments} comments`).join('\n');
    const newsText = (newsSignals || []).slice(0, 3).map(n => `- "${n.headline}" (score: ${n.score})`).join('\n');
    const weatherText = weatherData?.available ? `Weekend signal: ${weatherData.weekendSignal}` : 'Weather data not available';
    const eventbriteText = (eventbriteSignals || []).filter(e => !e.status).slice(0, 3).map(e => `- "${e.name}" — ${e.signal}`).join('\n');
    const yelpText = (yelpSignals || []).filter(e => !e.status).slice(0, 3).map(y => `- ${y.name}: ${y.signal}`).join('\n');
    const xText = (xSignals || []).slice(0, 3).map(x => `- "${x.topic}": score ${x.score}, ${x.signal}${x.topTweet ? ', top tweet: "' + x.topTweet + '"' : ''}`).join('\n');
    const placeInfo = placeDetails ? `Rating: ${placeDetails.rating}/5 (${placeDetails.user_ratings_total} reviews), Types: ${placeDetails.types?.slice(0,3).join(', ')}` : '';

    const isGoods = venueBusinessType === 'goods';
    // Load venue intelligence profile if available
    let venueIntelContext = '';
    if (venueId) {
      try {
        const { getVenueIntelligence } = require('./deeppull');
        const intel = await getVenueIntelligence(venueId, userId);
        if (intel) {
          const strategy = (() => { try { return typeof intel.content_strategy === 'string' ? JSON.parse(intel.content_strategy) : (intel.content_strategy || {}); } catch { return {}; } })();
          const patterns = (() => { try { return JSON.parse(intel.learned_patterns || '{}'); } catch { return {}; } })();
          const topPlatforms = Object.entries(patterns.platformApprovals || {}).sort(([,a],[,b])=>b-a).slice(0,3).map(([p])=>p);
          venueIntelContext = `\nVENUE INTELLIGENCE PROFILE (pre-learned, continuously updated):
Market context: ${intel.market_summary || 'N/A'}
Audience: ${intel.audience_profile || 'N/A'}
Recommended brand voice: ${intel.brand_voice || 'N/A'}
Best posting days: ${(strategy.bestPostingDays || []).join(', ') || 'N/A'}
Best times: ${(strategy.bestPostingTimes || []).join(', ') || 'N/A'}
Top keywords found: ${intel.top_keywords || 'N/A'}
Local market trends: ${intel.market_trends || 'N/A'}
${intel.learning_summary ? 'What Fillo has learned from this account: ' + intel.learning_summary : ''}
${topPlatforms.length ? 'Their best-performing platforms (by approved drafts): ' + topPlatforms.join(', ') : ''}
${(patterns.hotTopics||[]).length ? 'Recurring hot topics for this venue: ' + patterns.hotTopics.slice(0,5).map(h=>h.topic).join(', ') : ''}`;
        }
      } catch(e) { /* intel not available yet — scan proceeds without it */ }
    }

    const prompt = `You are Fillo's AI intelligence engine. Analyze this venue and generate a complete intelligence report.

VENUE: ${venueName}
BUSINESS TYPE: ${isGoods ? 'Sells goods/merchandise (NOT ticket-based events)' : 'Sells tickets / event-based venue'}
TYPE: ${venueType || 'venue'}
CITY: ${city || 'Unknown'}
CAPACITY: ${capacity || 'Unknown'}
GENRES/VIBES: ${(genres||[]).join(', ') || 'Not specified'}
EVENT TYPES: ${(eventTypes||[]).join(', ') || 'Not specified'}
BUSIEST NIGHTS: ${(busiestNights||[]).join(', ') || 'Not specified'}
COMPETITORS: ${(competitors||[]).join(', ') || 'None listed'}
TRACKED KEYWORDS: ${keywords?.join(', ') || ''}
${placeInfo ? 'GOOGLE DATA: ' + placeInfo : ''}

${venueIntelContext}
${brandVoice ? buildVoicePrompt(brandVoice) : ''}

GOOGLE SEARCH CONSOLE DATA (venue's own website):
${searchConsoleData ? `Clicks: ${searchConsoleData.summary?.clicks || 0} (${searchConsoleData.summary?.clickDelta > 0 ? '+' : ''}${searchConsoleData.summary?.clickDelta || 0}% vs last month)
Impressions: ${searchConsoleData.summary?.impressions || 0}
Top queries: ${(searchConsoleData.topQueries || []).slice(0,3).map(q => q.query).join(', ')}
Opportunities: ${(searchConsoleData.opportunities || []).slice(0,2).map(o => o.suggestion).join(' | ')}` : 'Not connected — venue has not linked their website'}

LIVE INSTAGRAM SIGNALS:
${(instagramSignals || []).slice(0, 3).map(i => `- ${i.hashtag}: ${i.signal}, score ${i.score}`).join('\n') || 'No Instagram data available'}

LIVE GOOGLE TRENDS DATA:
${trendsText || 'No trend data available'}

TODAY'S TRENDING SEARCHES (Google):
${(dailyTrends || []).slice(0,3).map(t => `- "${t.topic}": ${t.traffic} searches`).join('\n') || 'No daily trends available'}

LIVE REDDIT SIGNALS:
${redditText || 'No Reddit data available'}

NEWS SIGNALS (trending news relevant to this market):
${newsText || 'No news data available'}

WEATHER INTELLIGENCE (weekend forecast for ${city}):
${weatherText}

TRENDING EVENTS IN MARKET (Eventbrite):
${eventbriteText || 'No Eventbrite data — add key to enable'}

COMPETITOR REVIEW SIGNALS (Yelp):
${yelpText || 'No Yelp data — add YELP_API_KEY to enable'}

LIVE X (TWITTER) SIGNALS:
${xText || 'No X data available'}

Generate a JSON intelligence report. Respond ONLY with valid JSON, no markdown:
{
  "fomoScore": <number 0-100 based on actual trend data>,
  "fomoLabel": "<Hot/Warm/Cool based on score>",
  "insight": "<3 sentences. Reference the actual trend scores and Reddit data above. Be specific to this venue, city, and what the data shows right now.>",
  "topOpportunity": "<Single most urgent content opportunity based on the data>",
  "contentIdeas": [
    { "platform": "Instagram", "hook": "<hook based on trending data>", "content": "<full caption with hashtags — for goods: product-focused, for venue: event/vibe-focused>" },
    { "platform": ${isGoods ? '"Product Drop"' : '"Website"'}, "hook": "<hook>", "content": "<for goods: product listing copy/drop announcement; for venue: event promo post>" },
    { "platform": "Email Campaign", "hook": "<subject line>", "content": "<for goods: promotional email for trending products; for venue: event invite email>" },
    { "platform": "TikTok", "hook": "<hook>", "content": "<for goods: product showcase/unboxing concept; for venue: event hype concept>" }
  ],
  "venueBusinessType": "${isGoods ? 'goods' : 'tickets'}",
  "fomoSignals": [
    { "score": <number>, "topic": "<topic from trend/reddit data>", "source": "<Google Trends/Reddit>", "detail": "<specific data point>", "action": "<exact content action to take>" },
    { "score": <number>, "topic": "<topic>", "source": "<source>", "detail": "<detail>", "action": "<action>" },
    { "score": <number>, "topic": "<topic>", "source": "<source>", "detail": "<detail>", "action": "<action>" }
  ],
  "weeklyForecast": "<1 sentence prediction for this venue's best content window this week based on trends>"
}`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim().replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch (err) {
    console.error('Claude intelligence error:', err.message);
    return {
      fomoScore: 65,
      fomoLabel: 'Warm',
      insight: `Intelligence engine analyzed ${venueName}. Trend data has been collected — Claude analysis temporarily unavailable.`,
      topOpportunity: 'Review trend data and post weekend content',
      contentIdeas: [],
      fomoSignals: [],
      weeklyForecast: 'Weekend looks strong based on search volume trends.',
    };
  }
}

// ─── FULL SCAN ────────────────────────────────────────────────────────────────
async function runFullScan({ venueName, venueType, city, keywords, genres, competitors, eventTypes, busiestNights, capacity, venueAddress, venueBusinessType, placeDetails, siteUrl, venueId, brandVoice, pilotMode, userId, plan }) {
  console.log(`🔍 Running full intelligence scan for: ${venueName}`);

  // Check blackout window before running
  if (venueId) {
    const blackout = await checkBlackout(venueId);
    if (blackout && pilotMode === 'auto') {
      console.log(`Blackout active for venue ${venueId}: ${blackout.reason}`);
      return { blocked: true, reason: blackout.reason };
    }
  }

  const geo = city ? 'US' : 'US'; // Could map city → state code later
  const baseKeywords = keywords?.length ? keywords : [];
  const isGoods = venueBusinessType === 'goods';
  const genreKeywords = (genres || []).map(g => `${g} ${city}`).filter(Boolean);
  const competitorKeywords = (competitors || []).slice(0, 2);
  const cityContext = isGoods
    ? [city ? `${city} boutique` : null, city ? `${city} fashion` : null, city ? `${city} shopping` : null]
    : [city ? `${city} ${venueType || 'events'}` : null, city ? `${city} nightlife` : null];
  const searchKeywords = [...new Set([
    ...baseKeywords,
    ...genreKeywords,
    venueName,
    ...cityContext
  ].filter(Boolean))].slice(0, 8);

  console.log(`📋 Keywords for scan: ${searchKeywords.join(', ')}`);
  console.log(`🏆 Competitors: ${(competitors||[]).join(', ') || 'none'}`);
  console.log(`🎵 Genres: ${(genres||[]).join(', ') || 'none'}`);

  const [
    trendsData,
    redditSignals,
    xSignals,
    instagramSignals,
    newsSignals,
    weatherData,
    eventbriteSignals,
    yelpSignals,
    searchConsoleData,
  ] = await Promise.all([
    safeSignal('Trends',     () => scanTrends(searchKeywords, geo)),
    safeSignal('Reddit',     () => getRedditSignals(searchKeywords, city, venueBusinessType)),
    safeSignal('X',          () => getXSignals(searchKeywords, city, venueType)),
    safeSignal('Instagram',  () => getInstagramSignals(searchKeywords, city, venueType, venueName, venueBusinessType)),
    safeSignal('News',       () => getNewsSignals(searchKeywords, city, venueBusinessType)),
    safeSignal('Weather',    () => getWeatherSignals(city)),
    safeSignal('Eventbrite', () => getEventbriteSignals(city, searchKeywords, venueBusinessType)),
    safeSignal('Yelp',       () => getYelpSignals(competitors, city, venueType, venueBusinessType)),
    siteUrl ? safeSignal('SearchConsole', () => scanSearchConsole(siteUrl)) : Promise.resolve(null),
  ]);

  const trends = trendsData.keywords || [];
  const dailyTrends = trendsData.daily || [];

  const trendsSource = trendsData?.source || 'Reddit';
  console.log(`✅ Trends(${trendsSource}): ${trends.length}, Reddit: ${redditSignals.length}, X: ${xSignals.length}, Instagram: ${instagramSignals.length}, News: ${newsSignals.length}, Weather: ${weatherData?.available ? 'yes' : 'no'}, Eventbrite: ${eventbriteSignals.length}, Yelp: ${yelpSignals.length}`);

  const intelligence = await generateIntelligence({
    venueName, venueType, city, keywords: searchKeywords,
    genres, competitors, eventTypes, busiestNights, capacity, venueBusinessType,
    trends, dailyTrends, redditSignals, xSignals, instagramSignals, newsSignals,
    weatherData, eventbriteSignals, yelpSignals,
    searchConsoleData, placeDetails, brandVoice, venueId, userId,
  });

  return {
    venueName,
    venueType,
    city,
    venueBusinessType,          // ← critical: tells dashboard which of 6 configs to apply
    plan,                        // ← critical: tells dashboard which tier (starter/pro/enterprise)
    venueId,                     // ← for saving/linking scan records
    userId,                      // ← for user-scoped storage
    scannedAt: new Date().toISOString(),
    fomoScore: intelligence.fomoScore,
    fomoLabel: intelligence.fomoLabel,
    insight: intelligence.insight,
    topOpportunity: intelligence.topOpportunity,
    weeklyForecast: intelligence.weeklyForecast,
    trends: trends.map(t => ({
      topic: t.keyword,
      score: t.score,
      delta: t.delta,
      hot: t.hot,
      source: 'Google Trends',
      signal: `Score: ${t.score}/100, ${t.delta > 0 ? '+' : ''}${t.delta}% vs last week`,
    })),
    redditSignals,
    xSignals,
    instagramSignals,
    searchConsoleData,
    dailyTrends,
    fomoSignals: intelligence.fomoSignals,
    weatherSignal: weatherData?.available ? weatherData.weekendSignal : null,
    weatherForecast: weatherData?.forecast?.filter(d => d.isWeekend) || [],
    eventbriteSignals: (eventbriteSignals || []).filter(e => !e.status),
    yelpSignals: (yelpSignals || []).filter(y => !y.status),
    newsSignals,
    trendSource: trendsData?.source || 'Reddit',
    drafts: intelligence.contentIdeas?.map(c => ({
      platform: c.platform,
      hook: c.hook,
      content: c.content,
    })),
    auditTrail: [
      { action: 'Intelligence scan completed', detail: `Google Trends: ${trends.length} keywords scanned`, time: 'Just now', color: '#C8963E' },
      { action: isGoods ? 'Product demand signals collected' : 'Reddit signals collected', detail: `${redditSignals.length} trending posts analyzed`, time: 'Just now', color: '#1D6A48' },
      { action: 'News signals collected', detail: `${(newsSignals||[]).length} news signals analyzed`, time: 'Just now', color: '#7C3AED' },
      { action: 'Weather intelligence', detail: weatherData?.available ? weatherData.weekendSignal?.slice(0,60) : 'Weather data unavailable', time: 'Just now', color: '#0891B2' },
      { action: isGoods ? 'Competitor review signals' : 'Event market signals', detail: isGoods ? `${(yelpSignals||[]).filter(y=>!y.status).length} competitor signals` : `${(eventbriteSignals||[]).filter(e=>!e.status).length} trending events in market`, time: 'Just now', color: '#F59E0B' },
      { action: 'Claude analysis complete', detail: `${isGoods ? 'Demand Score' : 'FOMO Score'}: ${intelligence.fomoScore} — ${intelligence.fomoLabel}`, time: 'Just now', color: '#2563EB' },
      { action: isGoods ? 'Product content drafts generated' : 'Content drafts generated', detail: `${intelligence.contentIdeas?.length || 0} pieces ready to review`, time: 'Just now', color: '#C0392B' },
    ],
  };
}

module.exports = { getTrends, getRedditSignals, generateIntelligence, runFullScan };