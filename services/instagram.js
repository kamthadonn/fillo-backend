// instagram.js — Instagram hashtag signals
// Gated by plan: Starter=none, Pro=10k/mo, Enterprise=100k/mo + overage
//
// ADD TO RAILWAY: RAPIDAPI_KEY=your_key
// Get key (~$10/mo):
//   1. Go to https://rapidapi.com/alexanderxbx/api/instagram-scraper-api2
//   2. Subscribe to Basic plan → copy "X-RapidAPI-Key" from code sample
//
// Without key: Reddit hashtag proxy runs — scan always completes

const axios = require('axios');
const { checkInstagramAccess, trackInstagramUsage } = require('./instagram_usage');
const UA = 'Fillo/1.0';

// ─── RAPIDAPI: real Instagram hashtag data ────────────────────────────────────
async function getHashtagViaRapidAPI(hashtag) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) return null;

  const cleanTag = hashtag.replace(/^#/, '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

  try {
    const res = await axios.get('https://instagram-scraper-api2.p.rapidapi.com/v1/hashtag', {
      params: { hashtag: cleanTag },
      headers: {
        'X-RapidAPI-Key':  key,
        'X-RapidAPI-Host': 'instagram-scraper-api2.p.rapidapi.com',
      },
      timeout: 9000,
    });

    const data      = res.data?.data || {};
    const postCount = data.media_count || 0;
    const topPosts  = data.top_posts || data.sections?.[0]?.layout_content?.medias || [];

    const recentEngagement = topPosts.slice(0, 6).reduce((s, p) => {
      const m = p.media || p;
      return s + (m.like_count || 0) + (m.comment_count || 0);
    }, 0);
    const avgEngagement = topPosts.length ? Math.round(recentEngagement / topPosts.length) : 0;
    const score = Math.min(99, Math.round(
      30 + Math.log10(postCount + 1) * 15 + (avgEngagement / 100)
    ));

    return {
      hashtag:       `#${cleanTag}`,
      postCount,
      avgEngagement,
      score:         Math.max(20, score),
      hot:           score > 65 || avgEngagement > 500,
      source:        'Instagram',
      signal:        `${postCount.toLocaleString()} posts · avg ${avgEngagement.toLocaleString()} engagements`,
    };
  } catch (err) {
    console.warn(`[Instagram RapidAPI] #${hashtag}:`, err.message);
    return null;
  }
}

// ─── REDDIT PROXY: hashtag activity as signal ─────────────────────────────────
async function getHashtagViaReddit(hashtag) {
  const cleanTag = hashtag.replace(/^#/, '').toLowerCase();
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent('#' + cleanTag)}&sort=hot&limit=10&t=week`;
    const res = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 5000 });
    const posts     = res.data?.data?.children || [];
    const totalScore = posts.reduce((a, p) => a + (p.data?.score || 0), 0);
    const score      = Math.min(75, Math.max(10, Math.round(totalScore / 80)));

    return {
      hashtag:       `#${cleanTag}`,
      postCount:     0,
      avgEngagement: Math.round(totalScore / Math.max(1, posts.length)),
      score,
      hot:           score > 50,
      source:        'Reddit proxy',
      signal:        `Reddit activity: ${score}/100${!process.env.RAPIDAPI_KEY ? ' — add RAPIDAPI_KEY for real Instagram data' : ''}`,
      status:        'reddit_proxy',
    };
  } catch {
    return {
      hashtag:       `#${cleanTag}`,
      postCount:     0,
      avgEngagement: 0,
      score:         0,
      hot:           false,
      source:        'Instagram',
      signal:        'Awaiting RAPIDAPI_KEY in Railway',
      status:        'pending_key',
    };
  }
}

// ─── BUILD HASHTAG LIST ───────────────────────────────────────────────────────
function buildHashtags(venueName, city, venueType, keywords = [], venueBusinessType = 'tickets') {
  const cityClean = (city || '').replace(/[\s,]+/g, '').toLowerCase();
  const isGoods   = venueBusinessType === 'goods';

  const typeMap = {
    nightclub:   ['nightclub', 'nightlife', 'clubbing', 'bottleservice', 'vip'],
    bar:         ['bar', 'cocktails', 'happyhour'],
    lounge:      ['lounge', 'vibes', 'nightout'],
    restaurant:  ['foodie', 'eats', 'dinnervibes'],
    venue:       ['livemusic', 'events', 'concert'],
    boutique:    ['boutique', 'newArrivals', 'shopLocal'],
    store:       ['shopLocal', 'newIn', 'shopSmall'],
  };

  const goodsFallback = ['ootd', 'streetwear', 'shopSmall', 'newArrival'];
  const typeHashtags  = isGoods
    ? (typeMap[venueType] || goodsFallback)
    : (typeMap[venueType] || typeMap.venue);

  const venueClean = (venueName || '').replace(/\s+/g, '').toLowerCase();

  return [
    venueClean || null,
    cityClean ? `${cityClean}${isGoods ? 'shopping' : 'nightlife'}` : null,
    cityClean ? `${cityClean}events` : null,
    ...typeHashtags.slice(0, 2),
    ...keywords.slice(0, 2).map(k => k.replace(/\s+/g, '').toLowerCase()),
  ].filter(Boolean);
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────
async function getHashtagSignals(hashtags = []) {
  const hasRapidAPI = !!process.env.RAPIDAPI_KEY;
  const results     = [];

  for (const tag of hashtags.slice(0, 5)) {
    let result = hasRapidAPI ? await getHashtagViaRapidAPI(tag) : null;
    if (!result) result = await getHashtagViaReddit(tag);
    if (result) results.push(result);
    await new Promise(r => setTimeout(r, hasRapidAPI ? 500 : 150));
  }

  return results.sort((a, b) => b.score - a.score);
}

async function getInstagramSignals(keywords = [], city = '', venueType = '', venueName = '', venueBusinessType = 'tickets', userId = null, plan = 'starter') {
  // Check plan access
  const access = await checkInstagramAccess(userId, plan, 1);
  if (!access.allowed) {
    console.warn(`[Instagram] Access denied for plan "${plan}": ${access.reason}`);
    return [{
      hashtag: '#instagram',
      score: 0,
      hot: false,
      source: 'Instagram',
      signal: access.reason,
      status: plan === 'starter' ? 'plan_upgrade_required' : 'limit_reached',
      canBuyOverage: access.canBuyOverage || false,
      upgradeUrl: access.upgradeUrl || null,
    }];
  }

  const hashtags = buildHashtags(venueName, city, venueType, keywords, venueBusinessType);
  const results = await getHashtagSignals(hashtags);

  // Track usage (1 request per batch)
  if (userId && results.length > 0) {
    await trackInstagramUsage(userId, plan, 1).catch(() => {});
  }

  return results;
}

module.exports = { getInstagramSignals, getHashtagSignals, buildHashtags };