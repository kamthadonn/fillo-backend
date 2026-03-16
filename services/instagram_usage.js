// instagram_usage.js — Instagram API request gating by plan
// 
// Starter:    NO Instagram access
// Pro:        10,000 requests/month hard limit
// Enterprise: 100,000 requests/month + can buy overage blocks
//
// Overage block: 50,000 requests for $49 (one-time charge via Stripe)

const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

const PLAN_LIMITS = {
  starter:    0,       // No Instagram access
  pro:        10000,   // 10k/month hard limit
  enterprise: 100000,  // 100k/month + overage available
};

const OVERAGE_REQUESTS = 50000; // requests per overage block
const OVERAGE_PRICE_ID = 'price_instagram_overage'; // set after creating in Stripe

function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function getUsage(userId) {
  const supabase = getSupabase();
  const month = getMonthKey();
  const { data } = await supabase
    .from('instagram_usage')
    .select('*')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle();
  return data || { user_id: userId, month, requests_used: 0, overage_blocks: 0 };
}

async function checkInstagramAccess(userId, plan, requestCount = 1) {
  const limit = PLAN_LIMITS[plan] || 0;

  if (limit === 0) {
    return {
      allowed: false,
      reason: 'Instagram signals are available on Pro and Enterprise plans.',
      upgradeUrl: '/index.html#pricing',
      remaining: 0,
      limit: 0,
      plan,
    };
  }

  const usage = await getUsage(userId);
  const used = usage.requests_used || 0;
  const overageBlocks = usage.overage_blocks || 0;
  const effectiveLimit = limit + (overageBlocks * OVERAGE_REQUESTS);
  const remaining = Math.max(0, effectiveLimit - used);

  if (used + requestCount > effectiveLimit) {
    if (plan === 'enterprise') {
      return {
        allowed: false,
        reason: `Instagram limit reached (${effectiveLimit.toLocaleString()} requests). Buy an overage block for 50,000 more requests.`,
        remaining: 0,
        limit: effectiveLimit,
        plan,
        canBuyOverage: true,
        overagePriceId: OVERAGE_PRICE_ID,
      };
    } else {
      // Pro hit limit — upsell to Enterprise
      return {
        allowed: false,
        reason: `You've used all ${limit.toLocaleString()} Instagram requests this month. Upgrade to Enterprise for 100k/month + overage.`,
        remaining: 0,
        limit,
        plan,
        canBuyOverage: false,
        upgradeUrl: '/index.html#pricing',
      };
    }
  }

  return { allowed: true, remaining, limit: effectiveLimit, used, plan };
}

async function trackInstagramUsage(userId, plan, requestCount = 1) {
  if (!userId || PLAN_LIMITS[plan] === 0) return;

  const supabase = getSupabase();
  const month = getMonthKey();

  const { data: existing } = await supabase
    .from('instagram_usage')
    .select('id, requests_used')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('instagram_usage')
      .update({ requests_used: existing.requests_used + requestCount, updated_at: new Date() })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('instagram_usage')
      .insert({ user_id: userId, month, requests_used: requestCount, overage_blocks: 0, plan });
  }
}

async function addInstagramOverageBlock(userId) {
  const supabase = getSupabase();
  const month = getMonthKey();

  const { data: existing } = await supabase
    .from('instagram_usage')
    .select('id, overage_blocks')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('instagram_usage')
      .update({ overage_blocks: (existing.overage_blocks || 0) + 1 })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('instagram_usage')
      .insert({ user_id: userId, month, requests_used: 0, overage_blocks: 1 });
  }
}

async function getInstagramUsageSummary(userId, plan) {
  const limit = PLAN_LIMITS[plan] || 0;
  if (limit === 0) return { plan, instagramEnabled: false };

  const usage = await getUsage(userId);
  const used = usage.requests_used || 0;
  const overageBlocks = usage.overage_blocks || 0;
  const effectiveLimit = limit + (overageBlocks * OVERAGE_REQUESTS);
  const pct = Math.round((used / effectiveLimit) * 100);

  return {
    plan,
    instagramEnabled: true,
    used,
    limit: effectiveLimit,
    baseLimit: limit,
    overageBlocks,
    remaining: Math.max(0, effectiveLimit - used),
    pct,
    month: getMonthKey(),
    warning: pct >= 80,
    critical: pct >= 95,
  };
}

module.exports = {
  checkInstagramAccess,
  trackInstagramUsage,
  addInstagramOverageBlock,
  getInstagramUsageSummary,
  PLAN_LIMITS,
  OVERAGE_REQUESTS,
};