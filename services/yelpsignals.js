// yelpsignals.js — Competitor review velocity signals
//
// Tracks how fast competitors are getting reviews (= demand signal)
// ADD TO RAILWAY: YELP_API_KEY=your_key_here  
// Get free key: https://www.yelp.com/developers/v3/manage_app
// Free tier: 500 calls/day
//
// Without key: skipped gracefully

const axios = require('axios');

async function getYelpSignals(competitors = [], city = '', venueType = '', venueBusinessType = 'tickets') {
  const key = process.env.YELP_API_KEY;

  if (!key) {
    return [{
      status: 'pending_key',
      source: 'Yelp',
      signal: 'Add YELP_API_KEY to Railway to enable competitor review tracking',
      score: 0,
    }];
  }

  const results = [];
  const categories = venueBusinessType === 'goods'
    ? 'boutiques,fashion,shopping'
    : 'nightlife,bars,clubs';

  // Search for competitors or top venues in city
  const searchTerms = competitors.length
    ? competitors.slice(0, 2)
    : [`${venueType || 'venue'} ${city}`];

  for (const term of searchTerms) {
    try {
      const res = await axios.get('https://api.yelp.com/v3/businesses/search', {
        params: {
          term,
          location: city,
          limit: 3,
          sort_by: 'review_count',
          categories,
        },
        headers: {
          Authorization: `Bearer ${key}`,
          'User-Agent': 'Fillo/1.0',
        },
        timeout: 7000,
      });

      const businesses = res.data?.businesses || [];
      businesses.forEach(b => {
        results.push({
          name: b.name?.slice(0, 50) || '',
          rating: b.rating || 0,
          reviewCount: b.review_count || 0,
          score: Math.min(99, Math.round(b.rating * 15 + Math.log10(b.review_count + 1) * 10)),
          signal: `${b.rating}★ · ${b.review_count} reviews — ${b.review_count > 500 ? 'high demand' : 'growing'}`,
          source: 'Yelp',
          url: b.url || '',
          isOpen: b.is_open_now,
        });
      });
    } catch (err) {
      console.warn(`[Yelp] "${term}":`, err.message);
    }
  }

  return results.sort((a, b) => b.reviewCount - a.reviewCount).slice(0, 5);
}

module.exports = { getYelpSignals };