const axios = require('axios');

async function scanReddit(keywords) {
  if (!keywords) keywords = ['game tonight', 'tickets', 'arena'];
  try {
    const results = [];
    for (const keyword of keywords) {
      const res = await axios.get(
        'https://www.reddit.com/search.json?q=' + encodeURIComponent(keyword) + '&sort=new&limit=5',
        { headers: { 'User-Agent': 'fillo-agent/1.0' } }
      );
      const posts = res.data.data.children.map(p => ({
        title: p.data.title,
        subreddit: p.data.subreddit,
        upvotes: p.data.ups,
        source: 'Reddit'
      }));
      results.push(...posts);
    }
    return results.sort((a, b) => b.upvotes - a.upvotes);
  } catch(err) {
    console.error('Reddit error:', err.message);
    return [];
  }
}

module.exports = { scanReddit };