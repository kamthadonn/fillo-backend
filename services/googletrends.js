const googleTrends = require('google-trends-api');

// Get interest over time for specific keywords
async function getTrendScore(keyword, geo = 'US') {
  try {
    const data = await googleTrends.interestOverTime({
      keyword,
      geo,
      startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });
    const parsed = JSON.parse(data);
    const timeline = parsed?.default?.timelineData || [];
    if (!timeline.length) return { keyword, score: 0, delta: 0, hot: false };

    const recent = timeline.slice(-3).map(t => t.value[0]);
    const prev = timeline.slice(-6, -3).map(t => t.value[0]);
    const avg = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
    const prevAvg = prev.reduce((a, b) => a + b, 0) / (prev.length || 1);
    const delta = prevAvg > 0 ? Math.round(((avg - prevAvg) / prevAvg) * 100) : 0;

    return {
      keyword,
      score: Math.round(avg),
      delta,
      hot: avg > 60 || delta > 25,
      source: 'Google Trends',
      signal: `Score: ${Math.round(avg)}/100, ${delta > 0 ? '+' : ''}${delta}% vs last week`,
    };
  } catch (err) {
    console.error(`Google Trends error for "${keyword}":`, err.message);
    return { keyword, score: 0, delta: 0, hot: false, source: 'Google Trends', signal: 'No data' };
  }
}

// Get related queries for a keyword — shows what people also search
async function getRelatedQueries(keyword, geo = 'US') {
  try {
    const data = await googleTrends.relatedQueries({ keyword, geo });
    const parsed = JSON.parse(data);
    const top = parsed?.default?.rankedList?.[0]?.rankedKeyword || [];
    const rising = parsed?.default?.rankedList?.[1]?.rankedKeyword || [];
    return {
      top: top.slice(0, 5).map(k => ({ query: k.query, value: k.value })),
      rising: rising.slice(0, 5).map(k => ({ query: k.query, value: k.value })),
    };
  } catch (err) {
    console.error(`Related queries error for "${keyword}":`, err.message);
    return { top: [], rising: [] };
  }
}

// Get trending searches in a specific geo right now
async function getDailyTrends(geo = 'US') {
  try {
    const data = await googleTrends.dailyTrends({ geo });
    const parsed = JSON.parse(data);
    const days = parsed?.default?.trendingSearchesDays || [];
    const searches = days?.[0]?.trendingSearches || [];
    return searches.slice(0, 10).map(s => ({
      topic: s.title?.query || '',
      traffic: s.formattedTraffic || '',
      articles: s.articles?.length || 0,
      source: 'Google Trends',
      hot: true,
    }));
  } catch (err) {
    console.error('Daily trends error:', err.message);
    return [];
  }
}

// Main function — scans all keywords for a venue
async function scanTrends(keywords = [], geo = 'US') {
  const results = [];

  // Score each keyword
  for (const keyword of keywords.slice(0, 4)) {
    const result = await getTrendScore(keyword, geo);
    if (result.score > 0) results.push(result);
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  // Also get daily trending topics for context
  const daily = await getDailyTrends(geo);

  return {
    keywords: results.sort((a, b) => b.score - a.score),
    daily: daily.slice(0, 5),
  };
}

module.exports = { getTrendScore, getRelatedQueries, getDailyTrends, scanTrends };