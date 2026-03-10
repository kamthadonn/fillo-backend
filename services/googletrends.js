const RSSParser = require('rss-parser');
const parser = new RSSParser();

const GOOGLE_TRENDS_URL = 
  'https://trends.google.com/trends/trendingsearches/daily/rss?geo=US';

async function scanTrends(keywords = []) {
  try {
    const feed = await parser.parseURL(GOOGLE_TRENDS_URL);
    
    const trends = feed.items.map(item => ({
      title: item.title,
      description: item.contentSnippet || '',
      traffic: item['ht:approx_traffic'] || 'Unknown',
      pubDate: item.pubDate,
      source: 'Google Trends'
    }));

    // If keywords provided filter by them
    if (keywords.length > 0) {
      return trends.filter(t =>
        keywords.some(k => 
          t.title.toLowerCase().includes(k.toLowerCase())
        )
      );
    }

    return trends.slice(0, 10);
  } catch(err) {
    console.error('Google Trends error:', err.message);
    return [];
  }
}

module.exports = { scanTrends };