// x_preferences.js — Read/write X signal preferences per user
// Stored in user_x_preferences table in Supabase
// Used by twitter.js to know what to scan and how much budget to give each signal type

const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

// Default allocations — how user's monthly X budget is split across signal types
// Values are PERCENTAGES of their total monthly limit (must sum to 100)
const DEFAULT_PREFS = {
  // Signal type allocations (% of monthly budget)
  posts_read:       40,  // Reading posts/tweets for trend signals
  trends:           30,  // Trending topics search
  news:             15,  // News/breaking content
  profile_read:     10,  // Competitor profile monitoring
  spaces:            5,  // Twitter Spaces activity

  // Content preferences
  track_competitors: true,   // Track competitor handles
  track_hashtags:    true,   // Monitor relevant hashtags
  track_keywords:    true,   // Track venue keywords
  geo_filter:        true,   // Filter to city/region
  language:         'en',

  // Scan behavior
  posts_per_query:  25,       // How many posts to fetch per query (10-50)
  max_queries_per_scan: 3,    // How many queries per scan (1-5)
  sort_by:         'relevancy', // relevancy | recency | popularity
};

// Plan caps on posts_per_query
const POSTS_PER_QUERY_CAPS = {
  starter:    0,   // no X access
  pro:        25,  // max 25 posts per query
  enterprise: 50,  // max 50 posts per query
};

// Plan caps on max_queries_per_scan
const QUERIES_PER_SCAN_CAPS = {
  starter:    0,
  pro:        3,
  enterprise: 6,
};

async function getXPreferences(userId) {
  if (!userId) return DEFAULT_PREFS;

  const supabase = getSupabase();
  const { data } = await supabase
    .from('user_x_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return { ...DEFAULT_PREFS };

  // Merge stored prefs with defaults (handles new fields gracefully)
  return { ...DEFAULT_PREFS, ...data.preferences };
}

async function saveXPreferences(userId, prefs) {
  const supabase = getSupabase();

  const { data: existing } = await supabase
    .from('user_x_preferences')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('user_x_preferences')
      .update({ preferences: prefs, updated_at: new Date() })
      .eq('user_id', userId);
  } else {
    await supabase
      .from('user_x_preferences')
      .insert({ user_id: userId, preferences: prefs });
  }

  return { success: true };
}

// Converts user's % allocations into actual monthly call budgets
function calculateBudgetAllocation(plan, monthlyLimit, prefs) {
  if (plan === 'starter') return null; // no X access

  const alloc = prefs || DEFAULT_PREFS;
  return {
    posts_read:   Math.round(monthlyLimit * (alloc.posts_read / 100)),
    trends:       Math.round(monthlyLimit * (alloc.trends / 100)),
    news:         Math.round(monthlyLimit * (alloc.news / 100)),
    profile_read: Math.round(monthlyLimit * (alloc.profile_read / 100)),
    spaces:       Math.round(monthlyLimit * (alloc.spaces / 100)),
    total:        monthlyLimit,
  };
}

// Build the actual scan queries based on user preferences + venue data
function buildScanQueries(prefs, { venueName, city, venueType, keywords, competitors, genres, venueBusinessType }) {
  const queries = [];
  const isGoods = venueBusinessType === 'goods';
  const maxQueries = prefs.max_queries_per_scan || 3;
  const geoFilter = prefs.geo_filter && city ? ` ${city}` : '';

  // Core keyword queries
  if (prefs.track_keywords && keywords?.length) {
    queries.push({
      type: 'keywords',
      query: `${keywords[0]}${geoFilter} -is:retweet lang:en`,
      label: `${keywords[0]} signals`,
    });
  }

  // City + venue type
  if (city) {
    queries.push({
      type: 'trends',
      query: isGoods
        ? `${city} shopping boutique new arrivals -is:retweet lang:en`
        : `${city} ${venueType || 'nightlife'} events -is:retweet lang:en`,
      label: `${city} market trends`,
    });
  }

  // Competitor monitoring
  if (prefs.track_competitors && competitors?.length) {
    const comp = competitors[0].replace(/\s+/g, '');
    queries.push({
      type: 'profile_read',
      query: `"${competitors[0]}"${geoFilter} -is:retweet lang:en`,
      label: `${competitors[0]} mentions`,
    });
  }

  // Hashtag trending
  if (prefs.track_hashtags && genres?.length) {
    const tag = genres[0].replace(/\s+/g, '').toLowerCase();
    queries.push({
      type: 'trends',
      query: `#${tag}${geoFilter} -is:retweet lang:en`,
      label: `#${tag} trending`,
    });
  }

  // News signals
  if (prefs.track_keywords) {
    queries.push({
      type: 'news',
      query: isGoods
        ? `fashion retail trends${geoFilter} -is:retweet lang:en`
        : `nightlife entertainment events${geoFilter} -is:retweet lang:en`,
      label: 'Market news',
    });
  }

  return queries.slice(0, maxQueries);
}

module.exports = {
  getXPreferences,
  saveXPreferences,
  calculateBudgetAllocation,
  buildScanQueries,
  DEFAULT_PREFS,
  POSTS_PER_QUERY_CAPS,
  QUERIES_PER_SCAN_CAPS,
};