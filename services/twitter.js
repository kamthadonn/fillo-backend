const axios = require('axios');
const { checkXAccess, trackUsage } = require('./xusage');

const BEARER = process.env.X_BEARER_TOKEN;

const headers = {
  'Authorization': `Bearer ${BEARER}`,
  'User-Agent': 'FilloApp/1.0',
};

async function searchTweets(query, maxResults = 10) {
  try {
    const res = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
      headers,
      params: {
        query: `${query} -is:retweet lang:en`,
        max_results: maxResults,
        'tweet.fields': 'public_metrics,created_at',
        expansions: 'author_id',
      },
      timeout: 8000,
    });

    const tweets = res.data?.data || [];
    return tweets.map(t => ({
      text: t.text,
      likes: t.public_metrics?.like_count || 0,
      retweets: t.public_metrics?.retweet_count || 0,
      replies: t.public_metrics?.reply_count || 0,
      engagement: (t.public_metrics?.like_count || 0) + (t.public_metrics?.retweet_count || 0) * 2,
      created_at: t.created_at,
    }));
  } catch (err) {
    console.error(`X search error for "${query}":`, err.response?.data || err.message);
    return [];
  }
}

async function getXSignals(keywords = [], city = '', venueType = '', userId = null, plan = 'starter') {
  if (!BEARER) {
    console.warn('X_BEARER_TOKEN not set — skipping X signals');
    return [];
  }

  const access = await checkXAccess(userId, plan, 30);
  if (!access.allowed) {
    console.warn(`X access denied for user ${userId}: ${access.reason}`);
    return [{ blocked: true, reason: access.reason, canBuyOverage: access.canBuyOverage || false }];
  }

  const results = [];
  const queries = [
    city ? `${city} nightlife` : null,
    city ? `${city} ${venueType}` : null,
    keywords[0] || null,
    venueType === 'nightclub' || venueType === 'bar' ? 'bottle service' : null,
  ].filter(Boolean).slice(0, 3);

  for (const query of queries) {
    try {
      const tweets = await searchTweets(query, 10);
      if (!tweets.length) continue;

      const totalEngagement = tweets.reduce((sum, t) => sum + t.engagement, 0);
      const avgEngagement = Math.round(totalEngagement / tweets.length);
      const topTweet = tweets.sort((a, b) => b.engagement - a.engagement)[0];
      const score = Math.min(99, Math.round(40 + (avgEngagement / 10)));

      results.push({
        topic: query,
        source: 'X (Twitter)',
        score,
        hot: score > 70,
        signal: `${tweets.length} recent tweets · avg ${avgEngagement} engagements`,
        topTweet: topTweet?.text?.slice(0, 120),
        totalEngagement,
      });
    } catch (err) {
      console.error(`X signal error for "${query}":`, err.message);
    }
  }

  const totalFetched = results.length * 10;
  if (userId && totalFetched > 0) await trackUsage(userId, plan, totalFetched);

  return results.sort((a, b) => b.score - a.score);
}

module.exports = { searchTweets, getXSignals };