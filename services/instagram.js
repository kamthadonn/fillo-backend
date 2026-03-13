const axios = require('axios');

async function getHashtagSignals(hashtags = [], limit = 10) {
  const results = [];

  for (const tag of hashtags.slice(0, 4)) {
    try {
      const cleanTag = tag.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

      const res = await axios.get(
        `https://www.instagram.com/explore/tags/${cleanTag}/?__a=1&__d=dis`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/html,*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.instagram.com/',
            'x-ig-app-id': '936619743392459',
          },
          timeout: 8000,
        }
      );

      const data = res.data;
      const tagData = data?.graphql?.hashtag || data?.data?.hashtag_data || {};
      const postCount = tagData?.edge_hashtag_to_media?.count || 0;
      const topPosts = tagData?.edge_hashtag_to_top_posts?.edges ||
                       tagData?.edge_hashtag_to_media?.edges || [];

      const recentEngagement = topPosts.slice(0, 6).reduce((sum, e) => {
        const node = e.node || {};
        return sum + (node.edge_liked_by?.count || 0) + (node.edge_media_to_comment?.count || 0);
      }, 0);

      const avgEngagement = topPosts.length ? Math.round(recentEngagement / topPosts.length) : 0;
      const score = Math.min(99, Math.round(30 + Math.log10(postCount + 1) * 15 + (avgEngagement / 100)));

      results.push({
        hashtag: `#${cleanTag}`,
        postCount,
        avgEngagement,
        score,
        hot: score > 65 || avgEngagement > 500,
        source: 'Instagram',
        signal: `${postCount.toLocaleString()} posts · avg ${avgEngagement.toLocaleString()} engagements`,
        topPost: topPosts[0]?.node?.accessibility_caption || null,
      });

    } catch (err) {
      console.error(`Instagram hashtag error for #${tag}:`, err.message);
      results.push({
        hashtag: `#${tag}`,
        postCount: 0,
        avgEngagement: 0,
        score: 0,
        hot: false,
        source: 'Instagram',
        signal: 'Unable to fetch — rate limited or private',
      });
    }

    await new Promise(r => setTimeout(r, 600));
  }

  return results.sort((a, b) => b.score - a.score);
}

function buildHashtags(venueName, city, venueType, keywords = []) {
  const cityClean = city?.replace(/\s+/g, '').toLowerCase() || '';
  const typeMap = {
    nightclub: ['nightclub', 'nightlife', 'clubbing', 'bottleservice', 'vip'],
    bar: ['bar', 'cocktails', 'happyhour', 'drinkup'],
    lounge: ['lounge', 'vibes', 'nightout'],
    restaurant: ['foodie', 'eats', 'dinner'],
    venue: ['livemusic', 'events', 'concert'],
  };

  const typeHashtags = typeMap[venueType] || typeMap.venue;
  const venueClean = venueName?.replace(/\s+/g, '').toLowerCase() || '';

  return [
    venueClean,
    cityClean ? `${cityClean}nightlife` : null,
    cityClean ? `${cityClean}events` : null,
    cityClean ? `${cityClean}${typeHashtags[0]}` : null,
    ...typeHashtags.slice(0, 2),
    ...keywords.slice(0, 2).map(k => k.replace(/\s+/g, '').toLowerCase()),
  ].filter(Boolean);
}

async function getInstagramSignals(keywords = [], city = '', venueType = '', venueName = '') {
  const hashtags = buildHashtags(venueName, city, venueType, keywords);
  const results = await getHashtagSignals(hashtags);
  return results.filter(r => r.score > 0);
}

module.exports = { getInstagramSignals, getHashtagSignals, buildHashtags };