// twitter.js — X/Twitter signal fetching with plan gating + user preferences
// 
// Starter:    NO X access
// Pro:        150k tweets/month, max 25 posts/query, max 3 queries/scan
// Enterprise: 500k tweets/month, max 50 posts/query, max 6 queries/scan
//
// Smart scanning: respects user's budget allocation preferences
// Only fetches what's needed — most relevant results surfaced first

const axios = require('axios');
const { checkXAccess, trackUsage } = require('./xusage');
const { getXPreferences, buildScanQueries, POSTS_PER_QUERY_CAPS, QUERIES_PER_SCAN_CAPS } = require('./x_preferences');

const BEARER = process.env.X_BEARER_TOKEN;

function getHeaders() {
  return {
    'Authorization': `Bearer ${BEARER}`,
    'User-Agent': 'FilloApp/1.0',
  };
}

// ─── CORE TWEET FETCHER ───────────────────────────────────────────────────────
async function searchTweets(query, maxResults = 25, sortOrder = 'relevancy') {
  try {
    const params = {
      query,
      max_results: Math.max(10, Math.min(100, maxResults)), // X API min=10 max=100
      'tweet.fields': 'public_metrics,created_at,author_id',
      expansions: 'author_id',
      'user.fields': 'name,username,verified',
    };

    // X API sort_order: recency | relevancy
    if (sortOrder === 'recency') params.sort_order = 'recency';

    const res = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
      headers: getHeaders(),
      params,
      timeout: 9000,
    });

    const tweets = res.data?.data || [];
    const users  = {};
    (res.data?.includes?.users || []).forEach(u => { users[u.id] = u; });

    return tweets.map(t => ({
      text:        t.text,
      likes:       t.public_metrics?.like_count || 0,
      retweets:    t.public_metrics?.retweet_count || 0,
      replies:     t.public_metrics?.reply_count || 0,
      impressions: t.public_metrics?.impression_count || 0,
      engagement:  (t.public_metrics?.like_count || 0) + (t.public_metrics?.retweet_count || 0) * 2 + (t.public_metrics?.reply_count || 0),
      created_at:  t.created_at,
      author:      users[t.author_id]?.username || null,
      verified:    users[t.author_id]?.verified || false,
    }));
  } catch (err) {
    console.warn(`[X] Search error "${query}":`, err.response?.data?.detail || err.message);
    return [];
  }
}

// ─── SIGNAL BUILDER ───────────────────────────────────────────────────────────
function buildSignalFromTweets(tweets, queryMeta) {
  if (!tweets.length) return null;

  const sorted          = tweets.sort((a, b) => b.engagement - a.engagement);
  const top             = sorted[0];
  const totalEngagement = tweets.reduce((s, t) => s + t.engagement, 0);
  const avgEngagement   = Math.round(totalEngagement / tweets.length);
  const score           = Math.min(99, Math.round(40 + (avgEngagement / 8)));

  return {
    topic:           queryMeta.label || queryMeta.query,
    type:            queryMeta.type,
    source:          'X (Twitter)',
    score,
    hot:             score > 70,
    signal:          `${tweets.length} posts · avg ${avgEngagement} engagements`,
    topTweet:        top?.text?.slice(0, 140),
    topAuthor:       top?.author ? `@${top.author}` : null,
    totalEngagement,
    postsFetched:    tweets.length,
  };
}

// ─── MAIN SIGNAL FUNCTION ─────────────────────────────────────────────────────
async function getXSignals(
  keywords   = [],
  city       = '',
  venueType  = '',
  userId     = null,
  plan       = 'starter',
  venueData  = {}
) {
  if (!BEARER) {
    console.warn('[X] X_BEARER_TOKEN not set');
    return [];
  }

  // Check plan access (uses xusage.js for monthly budget tracking)
  const estimatedPosts = (POSTS_PER_QUERY_CAPS[plan] || 25) * (QUERIES_PER_SCAN_CAPS[plan] || 3);
  const access = await checkXAccess(userId, plan, estimatedPosts);

  if (!access.allowed) {
    console.warn(`[X] Access denied for ${plan}: ${access.reason}`);
    return [{
      blocked:       true,
      reason:        access.reason,
      canBuyOverage: access.canBuyOverage || false,
      upgradeUrl:    plan === 'starter' ? '/index.html#pricing' : null,
    }];
  }

  // Load user's X preferences
  const prefs = await getXPreferences(userId).catch(() => null);

  // Get plan-appropriate limits
  const maxPostsPerQuery  = POSTS_PER_QUERY_CAPS[plan]   || 25;
  const maxQueriesPerScan = QUERIES_PER_SCAN_CAPS[plan]  || 3;
  const postsPerQuery     = Math.min(maxPostsPerQuery, prefs?.posts_per_query || maxPostsPerQuery);
  const sortBy            = prefs?.sort_by || 'relevancy';

  // Build smart queries from preferences + venue data
  const queries = buildScanQueries(
    { ...prefs, max_queries_per_scan: maxQueriesPerScan },
    {
      venueName:          venueData.name || '',
      city,
      venueType,
      keywords,
      competitors:        venueData.competitors || [],
      genres:             venueData.genres || [],
      venueBusinessType:  venueData.venueBusinessType || 'tickets',
    }
  );

  console.log(`[X] Scanning ${queries.length} queries × ${postsPerQuery} posts (plan: ${plan})`);

  const results     = [];
  let totalFetched  = 0;

  for (const q of queries) {
    const tweets = await searchTweets(q.query, postsPerQuery, sortBy);
    if (!tweets.length) continue;

    const signal = buildSignalFromTweets(tweets, q);
    if (signal) results.push(signal);

    totalFetched += tweets.length;
    await new Promise(r => setTimeout(r, 300));
  }

  // Track actual usage
  if (userId && totalFetched > 0) {
    await trackUsage(userId, plan, totalFetched).catch(() => {});
  }

  console.log(`[X] Fetched ${totalFetched} posts, ${results.length} signals`);

  return results
    .sort((a, b) => b.score - a.score)
    .map(r => ({
      ...r,
      creditsUsed: r.postsFetched,
    }));
}

module.exports = { searchTweets, getXSignals };