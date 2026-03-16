// googletrends.js — Google Trends via SerpAPI (plan-gated) + Reddit fallback
// Starter: 5k calls/mo (3/scan) | Pro: 20k/mo (5/scan) | Enterprise: unlimited (8/scan)
//
// ADD TO RAILWAY: SERPAPI_KEY=your_key
// Get free key (100 searches/mo, no CC needed):
//   1. Go to https://serpapi.com
//   2. Sign up → Dashboard → copy "API Key"
//
// Without key: Reddit-powered scoring runs automatically — no crash

const axios = require('axios');
const { checkSerpAPIAccess, trackSerpAPIUsage, getSmartKeywordCount } = require('./serpapi_usage');
const UA = 'Fillo/1.0';

// ─── SERPAPI: real Google Trends data ────────────────────────────────────────
async function getTrendScoreViaSerpAPI(keyword, geo = 'US') {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;

  try {
    const res = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine:  'google_trends',
        q:        keyword,
        geo,
        date:    'now 7-d',
        api_key:  key,
      },
      timeout: 9000,
    });

    const timeline = res.data?.interest_over_time?.timeline_data || [];
    if (!timeline.length) return null;

    const values = timeline.map(t => t.values?.[0]?.extracted_value || 0);
    const avg    = values.reduce((a, b) => a + b, 0) / values.length;
    const recent = values.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const prev   = values.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const delta  = prev > 0 ? Math.round(((recent - prev) / prev) * 100) : 0;
    const score  = Math.round(avg);
    const trend  = recent > avg * 1.1 ? 'rising' : recent < avg * 0.9 ? 'falling' : 'stable';

    return {
      keyword,
      score,
      delta,
      trend,
      hot:    score > 60 || delta > 20,
      source: 'Google Trends',
    };
  } catch (err) {
    console.warn(`[SerpAPI Trends] "${keyword}":`, err.message);
    return null;
  }
}

// ─── SERPAPI: daily trending searches ────────────────────────────────────────
async function getDailyTrendsViaSerpAPI(geo = 'US') {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;

  try {
    const res = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine:  'google_trends_trending_now',
        geo,
        api_key:  key,
      },
      timeout: 9000,
    });

    const searches = res.data?.trending_searches || [];
    if (!searches.length) return null;

    return searches.slice(0, 8).map(s => ({
      topic:    s.query || s.title || '',
      traffic:  s.formattedTraffic || s.traffic_increase || '',
      articles: s.articles?.length || 0,
      source:   'Google Trends',
      hot:      true,
    }));
  } catch (err) {
    console.warn('[SerpAPI Daily Trends]:', err.message);
    return null;
  }
}

// ─── REDDIT FALLBACK: keyword scoring ────────────────────────────────────────
async function getTrendScoreViaReddit(keyword) {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(keyword)}&sort=hot&limit=15&t=week`;
    const res = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 6000 });

    // Detect HTML rate-limit page
    const contentType = res.headers?.['content-type'] || '';
    if (contentType.includes('text/html') || !res.data?.data?.children) {
      console.warn('[Reddit Score] HTML/invalid response for keyword:', keyword);
      return { keyword, score: 30, delta: 0, trend: 'stable', hot: false, source: 'estimated' };
    }

    const posts = res.data.data.children;
    if (!posts.length) return { keyword, score: 20, delta: 0, trend: 'low', hot: false, source: 'Reddit' };

    const totalScore    = posts.reduce((a, p) => a + (p.data?.score || 0), 0);
    const totalComments = posts.reduce((a, p) => a + (p.data?.num_comments || 0), 0);
    const engagement    = totalScore + totalComments * 3;
    const score         = Math.min(100, Math.max(15, Math.round(engagement / 200)));
    const trend         = score > 60 ? 'rising' : score > 30 ? 'stable' : 'low';

    return { keyword, score, delta: score - 40, trend, hot: score > 60, source: 'Reddit' };
  } catch (err) {
    console.warn('[Reddit Score] Error for keyword', keyword, ':', err.message);
    return { keyword, score: 25, delta: 0, trend: 'stable', hot: false, source: 'estimated' };
  }
}

// ─── REDDIT FALLBACK: daily trending ─────────────────────────────────────────
async function getDailyTrendsViaReddit() {
  // Try multiple Reddit endpoints — if one is rate-limited, try the next
  const endpoints = [
    'https://www.reddit.com/r/trending/hot.json?limit=8',
    'https://www.reddit.com/r/popular/hot.json?limit=8',
    'https://www.reddit.com/r/all/hot.json?limit=8',
  ];

  for (const url of endpoints) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': UA },
        timeout: 5000,
      });

      // Reddit sometimes returns HTML (rate limit page) — detect and skip
      const contentType = res.headers?.['content-type'] || '';
      if (contentType.includes('text/html')) {
        console.warn('[Reddit Daily] Got HTML response from', url, '— trying next');
        continue;
      }

      // Validate it's actually JSON with the expected shape
      if (!res.data?.data?.children) {
        console.warn('[Reddit Daily] Unexpected shape from', url, '— trying next');
        continue;
      }

      const posts = res.data.data.children;
      const results = posts
        .filter(p => p.data?.score > 50)
        .map(p => ({
          topic:    (p.data.title || '').slice(0, 60),
          traffic:  (p.data.score || 0).toString(),
          articles: p.data.num_comments || 0,
          source:   'Reddit',
          hot:      p.data.score > 500,
        }));

      if (results.length) return results;

    } catch (err) {
      console.warn('[Reddit Daily] Error from', url, ':', err.message);
      continue;
    }
  }

  // All Reddit endpoints failed — return sensible static fallback
  // so the dashboard never breaks and cron never crashes
  console.warn('[Reddit Daily] All endpoints failed — using static fallback');
  return [
    { topic: 'Trending this week',       traffic: '',  articles: 0, source: 'estimated', hot: false },
    { topic: 'Weekend events near you',  traffic: '',  articles: 0, source: 'estimated', hot: false },
    { topic: 'Local nightlife buzz',     traffic: '',  articles: 0, source: 'estimated', hot: false },
  ];
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────
async function getTrendScore(keyword, geo = 'US') {
  const serpResult = await getTrendScoreViaSerpAPI(keyword, geo);
  if (serpResult) return serpResult;
  return getTrendScoreViaReddit(keyword);
}

async function getDailyTrends(geo = 'US') {
  const serpResult = await getDailyTrendsViaSerpAPI(geo);
  if (serpResult?.length) return serpResult;
  return getDailyTrendsViaReddit();
}

async function getRelatedQueries(keyword, geo = 'US') {
  const key = process.env.SERPAPI_KEY;
  if (!key) return { top: [], rising: [], status: 'pending_key' };

  try {
    const res = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine:     'google_trends',
        q:           keyword,
        geo,
        data_type:  'RELATED_QUERIES',
        api_key:     key,
      },
      timeout: 8000,
    });
    const top    = (res.data?.related_queries?.top    || []).slice(0, 5).map(q => q.query);
    const rising = (res.data?.related_queries?.rising || []).slice(0, 5).map(q => q.query);
    return { top, rising };
  } catch {
    return { top: [], rising: [] };
  }
}

async function scanTrends(keywords = [], geo = 'US', userId = null, plan = 'starter') {
  const hasSerpAPI = !!process.env.SERPAPI_KEY;
  const results    = [];

  if (hasSerpAPI && userId) {
    // Check access and get smart keyword count for this plan
    const access = await checkSerpAPIAccess(userId, plan, 1);
    if (!access.allowed) {
      console.warn(`[Trends] SerpAPI limit reached for ${plan}: ${access.reason}`);
      // Fall back to Reddit for all keywords
      for (const keyword of keywords.slice(0, 5)) {
        const result = await getTrendScoreViaReddit(keyword);
        if (result.score > 0) results.push(result);
      }
      const daily = await getDailyTrendsViaReddit();
      return {
        keywords: results.sort((a, b) => b.score - a.score),
        daily: daily.slice(0, 6),
        source: 'Reddit (SerpAPI limit reached)',
        limitReached: true,
        canBuyBoost: access.canBuyBoost || false,
      };
    }

    // Smart keyword count — don't waste calls
    const smartCount = getSmartKeywordCount(plan, access.remaining);
    const keywordsToScan = keywords.slice(0, smartCount);
    console.log(`[Trends] SerpAPI scanning ${keywordsToScan.length}/${keywords.length} keywords (plan: ${plan}, remaining: ${access.remaining === Infinity ? 'unlimited' : access.remaining})`);

    let serpCallsMade = 0;
    for (const keyword of keywordsToScan) {
      const result = await getTrendScoreViaSerpAPI(keyword, geo);
      if (result) {
        results.push(result);
        serpCallsMade++;
      } else {
        // SerpAPI failed for this keyword — use Reddit
        const fallback = await getTrendScoreViaReddit(keyword);
        results.push(fallback);
      }
      await new Promise(r => setTimeout(r, 600));
    }

    // Track actual SerpAPI calls made
    if (serpCallsMade > 0) {
      await trackSerpAPIUsage(userId, plan, serpCallsMade).catch(() => {});
    }

    // Fill remaining keywords with Reddit (free)
    for (const keyword of keywords.slice(smartCount, keywords.length)) {
      const result = await getTrendScoreViaReddit(keyword);
      results.push(result);
    }

  } else {
    // No SerpAPI key or no userId — use Reddit for everything
    for (const keyword of keywords.slice(0, 5)) {
      const result = await getTrendScore(keyword, geo); // will use Reddit internally
      if (result.score > 0) results.push(result);
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const daily = await getDailyTrends(geo);

  return {
    keywords: results.sort((a, b) => b.score - a.score),
    daily:    daily.slice(0, 6),
    source:   hasSerpAPI
      ? 'Google Trends via SerpAPI'
      : 'Reddit (add SERPAPI_KEY to Railway for real Google Trends)',
  };
}

module.exports = { getTrendScore, getRelatedQueries, getDailyTrends, scanTrends };