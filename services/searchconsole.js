const axios = require('axios');

const API_KEY = process.env.GOOGLE_SEARCH_CONSOLE_KEY;
const BASE_URL = 'https://www.googleapis.com/webmasters/v3';

// Get top search queries for a site over the last 28 days
async function getTopQueries(siteUrl, limit = 10) {
  try {
    const encoded = encodeURIComponent(siteUrl);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 28);

    const res = await axios.post(
      `${BASE_URL}/sites/${encoded}/searchAnalytics/query?key=${API_KEY}`,
      {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        dimensions: ['query'],
        rowLimit: limit,
        orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }],
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );

    const rows = res.data?.rows || [];
    return rows.map(r => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: parseFloat((r.ctr * 100).toFixed(1)),
      position: parseFloat(r.position.toFixed(1)),
      opportunity: r.impressions > 500 && r.ctr < 5, // high impressions, low CTR = content opportunity
    }));
  } catch (err) {
    console.error('Search Console queries error:', err.response?.data?.error?.message || err.message);
    return [];
  }
}

// Get top pages by clicks
async function getTopPages(siteUrl, limit = 10) {
  try {
    const encoded = encodeURIComponent(siteUrl);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 28);

    const res = await axios.post(
      `${BASE_URL}/sites/${encoded}/searchAnalytics/query?key=${API_KEY}`,
      {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        dimensions: ['page'],
        rowLimit: limit,
        orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );

    const rows = res.data?.rows || [];
    return rows.map(r => ({
      page: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: parseFloat((r.ctr * 100).toFixed(1)),
      position: parseFloat(r.position.toFixed(1)),
    }));
  } catch (err) {
    console.error('Search Console pages error:', err.response?.data?.error?.message || err.message);
    return [];
  }
}

// Get overall site performance summary
async function getSiteSummary(siteUrl) {
  try {
    const encoded = encodeURIComponent(siteUrl);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 28);

    // Current period
    const [current, previous] = await Promise.all([
      axios.post(
        `${BASE_URL}/sites/${encoded}/searchAnalytics/query?key=${API_KEY}`,
        {
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
          dimensions: ['date'],
          rowLimit: 28,
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
      ),
      axios.post(
        `${BASE_URL}/sites/${encoded}/searchAnalytics/query?key=${API_KEY}`,
        {
          startDate: new Date(startDate.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          endDate: startDate.toISOString().split('T')[0],
          dimensions: ['date'],
          rowLimit: 28,
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
      ),
    ]);

    const currRows = current.data?.rows || [];
    const prevRows = previous.data?.rows || [];

    const sum = rows => rows.reduce((acc, r) => ({
      clicks: acc.clicks + r.clicks,
      impressions: acc.impressions + r.impressions,
    }), { clicks: 0, impressions: 0 });

    const curr = sum(currRows);
    const prev = sum(prevRows);

    const clickDelta = prev.clicks > 0 ? Math.round(((curr.clicks - prev.clicks) / prev.clicks) * 100) : 0;
    const impDelta = prev.impressions > 0 ? Math.round(((curr.impressions - prev.impressions) / prev.impressions) * 100) : 0;
    const avgCtr = currRows.length ? parseFloat(((curr.clicks / curr.impressions) * 100).toFixed(1)) : 0;

    return {
      clicks: curr.clicks,
      impressions: curr.impressions,
      avgCtr,
      clickDelta,
      impDelta,
      period: '28 days',
      trending: clickDelta > 10 ? 'up' : clickDelta < -10 ? 'down' : 'stable',
    };
  } catch (err) {
    console.error('Search Console summary error:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

// Full scan — everything at once for the intelligence engine
async function scanSearchConsole(siteUrl) {
  if (!siteUrl) return null;
  if (!API_KEY) {
    console.warn('GOOGLE_SEARCH_CONSOLE_KEY not set');
    return null;
  }

  const [summary, queries, pages] = await Promise.all([
    getSiteSummary(siteUrl),
    getTopQueries(siteUrl, 10),
    getTopPages(siteUrl, 5),
  ]);

  // Find content opportunities — queries with high impressions but low CTR
  const opportunities = queries
    .filter(q => q.opportunity)
    .map(q => ({
      query: q.query,
      impressions: q.impressions,
      currentCtr: q.ctr,
      suggestion: `Create content targeting "${q.query}" — ${q.impressions.toLocaleString()} monthly searches, only ${q.ctr}% CTR`,
    }));

  return {
    siteUrl,
    summary,
    topQueries: queries,
    topPages: pages,
    opportunities,
    source: 'Google Search Console',
  };
}

module.exports = { scanSearchConsole, getSiteSummary, getTopQueries, getTopPages };
