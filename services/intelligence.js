const googleTrends = require('google-trends-api');
const { getXSignals } = require('./twitter');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── GOOGLE TRENDS ───────────────────────────────────────────────────────────
async function getTrends(keywords = [], geo = 'US') {
  const results = [];
  try {
    for (const keyword of keywords.slice(0, 3)) {
      try {
        const data = await googleTrends.interestOverTime({
          keyword,
          geo,
          startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // last 7 days
        });
        const parsed = JSON.parse(data);
        const timeline = parsed?.default?.timelineData || [];
        const recent = timeline.slice(-3).map(t => t.value[0]);
        const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
        const prev = timeline.slice(-6, -3).map(t => t.value[0]);
        const prevAvg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
        const delta = prevAvg > 0 ? ((avg - prevAvg) / prevAvg) * 100 : 0;
        results.push({
          keyword,
          score: Math.round(avg),
          delta: Math.round(delta),
          hot: avg > 60 || delta > 30,
          source: 'Google Trends',
        });
      } catch (e) {
        console.error(`Trends error for "${keyword}":`, e.message);
      }
    }
  } catch (e) {
    console.error('Google Trends error:', e.message);
  }
  return results;
}

// ─── REDDIT ──────────────────────────────────────────────────────────────────
async function getRedditSignals(keywords = [], city = '') {
  const results = [];
  const citySubreddit = city.toLowerCase().replace(/\s+/g, '');
  const subreddits = ['nightlife', 'cocktails', 'EDM', 'hiphop', 'bartenders', citySubreddit].filter(Boolean);

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
async function generateIntelligence({ venueName, venueType, city, keywords, trends, redditSignals, xSignals, placeDetails }) {
  try {
    const trendsText = trends.map(t => `- "${t.keyword}": score ${t.score}, ${t.delta > 0 ? '+' + t.delta : t.delta}% vs last week, ${t.hot ? 'HOT' : 'stable'}`).join('\n');
    const redditText = redditSignals.slice(0, 4).map(r => `- r/${r.subreddit}: "${r.topic}" — ${r.upvotes} upvotes, ${r.comments} comments`).join('\n');
    const xText = (xSignals || []).slice(0, 3).map(x => `- "${x.topic}": score ${x.score}, ${x.signal}${x.topTweet ? ', top tweet: "' + x.topTweet + '"' : ''}`).join('\n');
    const placeInfo = placeDetails ? `Rating: ${placeDetails.rating}/5 (${placeDetails.user_ratings_total} reviews), Types: ${placeDetails.types?.slice(0,3).join(', ')}` : '';

    const prompt = `You are Fillo's AI intelligence engine. Analyze this venue and generate a complete intelligence report.

VENUE: ${venueName}
TYPE: ${venueType || 'venue'}
CITY: ${city || 'Unknown'}
KEYWORDS: ${keywords?.join(', ') || ''}
${placeInfo ? 'GOOGLE DATA: ' + placeInfo : ''}

LIVE GOOGLE TRENDS DATA:
${trendsText || 'No trend data available'}

LIVE REDDIT SIGNALS:
${redditText || 'No Reddit data available'}

LIVE X (TWITTER) SIGNALS:
${xText || 'No X data available'}

Generate a JSON intelligence report. Respond ONLY with valid JSON, no markdown:
{
  "fomoScore": <number 0-100 based on actual trend data>,
  "fomoLabel": "<Hot/Warm/Cool based on score>",
  "insight": "<3 sentences. Reference the actual trend scores and Reddit data above. Be specific to this venue, city, and what the data shows right now.>",
  "topOpportunity": "<Single most urgent content opportunity based on the data>",
  "contentIdeas": [
    { "platform": "Instagram", "hook": "<specific hook based on trending data>", "content": "<full caption with hashtags, specific to venue and current trends>" },
    { "platform": "Website", "hook": "<hook>", "content": "<full event/promo post specific to venue>" },
    { "platform": "Google Business", "hook": "<hook>", "content": "<short update post>" },
    { "platform": "TikTok", "hook": "<hook>", "content": "<TikTok caption/concept specific to current trends>" }
  ],
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
async function runFullScan({ venueName, venueType, city, keywords, placeDetails }) {
  console.log(`🔍 Running full intelligence scan for: ${venueName}`);

  const geo = city ? 'US' : 'US'; // Could map city → state code later
  const searchKeywords = keywords?.length ? keywords : [venueName, `${city} nightlife`, `${city} events`];

  const [trends, redditSignals, xSignals] = await Promise.all([
    getTrends(searchKeywords, geo),
    getRedditSignals(searchKeywords, city),
    getXSignals(searchKeywords, city, venueType),
  ]);

  console.log(`✅ Trends: ${trends.length}, Reddit: ${redditSignals.length}, X: ${xSignals.length}`);

  const intelligence = await generateIntelligence({
    venueName, venueType, city, keywords: searchKeywords,
    trends, redditSignals, xSignals, placeDetails,
  });

  return {
    venueName,
    venueType,
    city,
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
    fomoSignals: intelligence.fomoSignals,
    drafts: intelligence.contentIdeas?.map(c => ({
      platform: c.platform,
      hook: c.hook,
      content: c.content,
    })),
    auditTrail: [
      { action: 'Intelligence scan completed', detail: `Google Trends: ${trends.length} keywords scanned`, time: 'Just now', color: '#C8963E' },
      { action: 'Reddit signals collected', detail: `${redditSignals.length} trending posts analyzed`, time: 'Just now', color: '#1D6A48' },
      { action: 'Claude analysis complete', detail: `FOMO Score: ${intelligence.fomoScore} — ${intelligence.fomoLabel}`, time: 'Just now', color: '#2563EB' },
      { action: 'Content drafts generated', detail: `${intelligence.contentIdeas?.length || 0} pieces ready to review`, time: 'Just now', color: '#C0392B' },
    ],
  };
}

module.exports = { getTrends, getRedditSignals, generateIntelligence, runFullScan };