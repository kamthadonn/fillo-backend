// eventbritesignals.js — Trending events in your city
//
// Primary: Eventbrite Public API (free, no key needed for basic search)
// Fallback: Reddit r/[city] event posts
// Shows what events are actually selling in the venue's market

const axios = require('axios');
const UA = 'Fillo/1.0';

async function getEventbriteSignals(city = '', keywords = [], venueBusinessType = 'tickets') {
  if (venueBusinessType === 'goods') return []; // not relevant for goods

  const results = [];

  try {
    const searchQuery = [city, keywords[0]].filter(Boolean).join(' ');
    const res = await axios.get('https://www.eventbriteapi.com/v3/events/search/', {
      params: {
        q: searchQuery,
        location: { address: city },
        'location.within': '25mi',
        sort_by: 'best',
        categories: '103,105,110', // music, performing arts, nightlife
        'start_date.keyword': 'this_week',
        expand: 'ticket_availability',
      },
      headers: {
        'User-Agent': UA,
        // Note: no auth token = limited results but still works for trending
      },
      timeout: 7000,
    });

    const events = res.data?.events || [];
    events.slice(0, 6).forEach(e => {
      const soldOut = e.ticket_availability?.is_sold_out;
      const limited = e.ticket_availability?.has_limited_supply;
      results.push({
        name: e.name?.text?.slice(0, 80) || '',
        venue: e.venue?.name || '',
        date: e.start?.local?.slice(0, 10) || '',
        soldOut,
        limited,
        score: soldOut ? 95 : limited ? 75 : 50,
        signal: soldOut ? 'SOLD OUT — high demand in your market' : limited ? 'Limited tickets — urgency opportunity' : 'Active event',
        source: 'Eventbrite',
        url: e.url || '',
      });
    });

    if (results.length) return results.sort((a, b) => b.score - a.score);
  } catch (err) {
    console.warn('[Eventbrite]:', err.message);
  }

  // Reddit fallback — look for event posts in city subreddit
  try {
    const cityKey = city.toLowerCase().replace(/\s+/g, '');
    const url = `https://www.reddit.com/r/${cityKey}/search.json?q=event+this+weekend&sort=hot&limit=6&t=week`;
    const res = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 5000 });
    const posts = res.data?.data?.children || [];

    posts.forEach(p => {
      if (p.data?.score > 20) {
        results.push({
          name: p.data.title?.slice(0, 80) || '',
          venue: city,
          date: '',
          soldOut: false,
          limited: false,
          score: Math.min(70, Math.round(p.data.score / 20)),
          signal: 'Community event buzz',
          source: 'Reddit',
          url: p.data.url || '',
          status: 'reddit_proxy',
        });
      }
    });
  } catch {}

  return results.slice(0, 5);
}

module.exports = { getEventbriteSignals };