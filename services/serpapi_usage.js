// serpapi_usage.js — Google Trends SerpAPI call gating by plan
//
// Starter:    5,000 calls/month
// Pro:        20,000 calls/month  
// Enterprise: unlimited
//
// Smart scanning: each scan uses 3-5 calls max (1 per keyword, capped)
// Calls are precious — only scan the most relevant keywords

const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

const PLAN_LIMITS = {
  starter:    5000,
  pro:        20000,
  enterprise: Infinity, // unlimited
};

// Max SerpAPI calls PER SCAN by plan — keeps usage efficient
const CALLS_PER_SCAN = {
  starter:    3,  // 3 keywords per scan
  pro:        5,  // 5 keywords per scan
  enterprise: 8,  // 8 keywords per scan
};

function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function getUsage(userId) {
  if (!userId) return { calls_used: 0, overage_blocks: 0 };
  const supabase = getSupabase();
  const month = getMonthKey();
  const { data } = await supabase
    .from('serpapi_usage')
    .select('*')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle();
  return data || { user_id: userId, month, calls_used: 0, overage_blocks: 0 };
}

async function checkSerpAPIAccess(userId, plan, callCount = 1) {
  const limit = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;

  // Enterprise: unlimited
  if (limit === Infinity) {
    return { allowed: true, remaining: Infinity, limit: Infinity, plan, unlimited: true };
  }

  const usage = await getUsage(userId);
  const used = usage.calls_used || 0;
  const extraBlocks = usage.overage_blocks || 0;
  const effectiveLimit = limit + (extraBlocks * 500); // 500 calls per overage block
  const remaining = Math.max(0, effectiveLimit - used);

  if (used + callCount > effectiveLimit) {
    return {
      allowed: false,
      reason: `Google Trends limit reached (${used.toLocaleString()}/${effectiveLimit.toLocaleString()} this month). ${plan === 'pro' ? 'Upgrade to Enterprise for unlimited.' : 'Buy a boost for 500 more calls.'}`,
      remaining: 0,
      limit: effectiveLimit,
      used,
      plan,
      canBuyBoost: true,
      upgradeUrl: plan === 'pro' ? '/index.html#pricing' : null,
    };
  }

  return { allowed: true, remaining, limit: effectiveLimit, used, plan };
}

async function trackSerpAPIUsage(userId, plan, callCount = 1) {
  if (!userId || PLAN_LIMITS[plan] === Infinity) return;

  const supabase = getSupabase();
  const month = getMonthKey();

  const { data: existing } = await supabase
    .from('serpapi_usage')
    .select('id, calls_used')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('serpapi_usage')
      .update({ calls_used: existing.calls_used + callCount, updated_at: new Date() })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('serpapi_usage')
      .insert({ user_id: userId, month, calls_used: callCount, overage_blocks: 0, plan });
  }
}

async function getSerpAPIUsageSummary(userId, plan) {
  const limit = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
  if (limit === Infinity) return { plan, unlimited: true, callsPerScan: CALLS_PER_SCAN[plan] };

  const usage = await getUsage(userId);
  const used = usage.calls_used || 0;
  const effectiveLimit = limit + (usage.overage_blocks || 0) * 500;
  const pct = Math.round((used / effectiveLimit) * 100);

  return {
    plan,
    unlimited: false,
    used,
    limit: effectiveLimit,
    remaining: Math.max(0, effectiveLimit - used),
    pct,
    callsPerScan: CALLS_PER_SCAN[plan] || 3,
    month: getMonthKey(),
    warning: pct >= 80,
    critical: pct >= 95,
  };
}

// Returns how many keywords to actually scan based on plan + remaining budget
function getSmartKeywordCount(plan, remaining) {
  const maxPerScan = CALLS_PER_SCAN[plan] || 3;
  if (plan === 'enterprise') return maxPerScan;
  return Math.min(maxPerScan, remaining);
}

module.exports = {
  checkSerpAPIAccess,
  trackSerpAPIUsage,
  getSerpAPIUsageSummary,
  getSmartKeywordCount,
  PLAN_LIMITS,
  CALLS_PER_SCAN,
};