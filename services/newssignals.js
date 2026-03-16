// newssignals.js — Real news headlines for keywords + city
//
// Primary: NewsAPI.org (free: 100 requests/day, no CC needed)
// ADD TO RAILWAY: NEWSAPI_KEY=your_key_here
// Get free key: https://newsapi.org/register
//
// Fallback: Reddit r/news — always works without a key

const axios = require('axios');
const UA = 'Fillo/1.0';

async function getNewsViaNewsAPI(keywords = [], city = '') {
  const key = process.env.NEWSAPI_KEY;
  if (!key) return null;

  const q = [...keywords.slice(0, 2), city].filter(Boolean).join(' OR ');

  try {
    const res = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q,
        sortBy: 'publishedAt',
        pageSize: 8,
        language: 'en',
        apiKey: key,
      },
      timeout: 7000,
    });

    const articles = res.data?.articles || [];
    return articles.map(a => ({
      headline: a.title?.slice(0, 100) || '',
      source: a.source?.name || 'News',
      publishedAt: a.publishedAt,
      score: 80, // real news = high signal
      relevance: q,
      url: a.url || '',
      description: a.description?.slice(0, 150) || '',
      realNews: true,
    }));
  } catch (err) {
    console.warn('[NewsAPI]:', err.message);
    return null;
  }
}

async function getNewsViaReddit(keywords = [], city = '', venueBusinessType = 'tickets') {
  const isGoods = venueBusinessType === 'goods';
  const searchTerms = [
    ...keywords.slice(0, 2),
    city ? `${city} ${isGoods ? 'shopping' : 'nightlife'}` : null,
    isGoods ? 'retail fashion trends' : 'entertainment events',
  ].filter(Boolean);

  const results = [];

  for (const term of searchTerms.slice(0, 2)) {
    try {
      const url = `https://www.reddit.com/r/news+worldnews+entertainment/search.json?q=${encodeURIComponent(term)}&sort=hot&limit=5&t=week`;
      const res = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 5000 });
      const posts = res.data?.data?.children || [];
      posts.forEach(p => {
        if (p.data?.score > 30) {
          results.push({
            headline: p.data.title?.slice(0, 100) || '',
            source: `Reddit r/${p.data.subreddit}`,
            score: Math.min(75, Math.round(p.data.score / 50)),
            relevance: term,
            url: p.data.url || '',
            description: (p.data.selftext || '').slice(0, 150),
            realNews: false,
          });
        }
      });
    } catch {}
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 6);
}

async function getNewsSignals(keywords = [], city = '', venueBusinessType = 'tickets') {
  const newsAPIResults = await getNewsViaNewsAPI(keywords, city);

  if (newsAPIResults?.length) {
    return newsAPIResults.slice(0, 6);
  }

  // Fallback to Reddit news
  const redditNews = await getNewsViaReddit(keywords, city, venueBusinessType);

  if (!process.env.NEWSAPI_KEY && redditNews.length) {
    redditNews.forEach(r => {
      r.signal = 'Add NEWSAPI_KEY for real news headlines';
      r.status = 'reddit_proxy';
    });
  }

  return redditNews;
}

module.exports = { getNewsSignals };