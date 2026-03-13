const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const PLAN_LIMITS = {
  starter: 0,        // No X access
  pro: 150000,       // 150k/month
  enterprise: 500000 // 500k/month
};

const OVERAGE_BLOCK = 500000; // tweets per overage block
const OVERAGE_PRICE = 350;    // $ per block

// Get current month key e.g. "2026-03"
function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Get usage record for a user this month
async function getUsage(userId) {
  const month = getMonthKey();
  const { data, error } = await supabase
    .from('x_usage')
    .select('*')
    .eq('user_id', userId)
    .eq('month', month)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('getUsage error:', error.message);
    return null;
  }

  return data || { user_id: userId, month, tweets_used: 0, overage_blocks: 0 };
}

// Check if user can make a scan — returns { allowed, remaining, limit, plan }
async function checkXAccess(userId, plan, tweetCount = 10) {
  const limit = PLAN_LIMITS[plan] || 0;

  // Starter has no X access at all
  if (limit === 0) {
    return {
      allowed: false,
      reason: 'X signals are available on Pro and Enterprise plans.',
      remaining: 0,
      limit: 0,
      plan,
    };
  }

  const usage = await getUsage(userId);
  const used = usage?.tweets_used || 0;
  const overageBlocks = usage?.overage_blocks || 0;
  const effectiveLimit = limit + (overageBlocks * OVERAGE_BLOCK);
  const remaining = Math.max(0, effectiveLimit - used);

  if (used + tweetCount > effectiveLimit) {
    // Enterprise can buy overage, Pro hits a hard wall
    if (plan === 'enterprise') {
      return {
        allowed: false,
        reason: `You've reached your X tweet limit (${effectiveLimit.toLocaleString()}). Add a $${OVERAGE_PRICE} overage block for ${OVERAGE_BLOCK.toLocaleString()} more tweets.`,
        remaining,
        limit: effectiveLimit,
        plan,
        canBuyOverage: true,
      };
    } else {
      return {
        allowed: false,
        reason: `You've used all ${limit.toLocaleString()} X tweets this month. Upgrade to Enterprise for more.`,
        remaining,
        limit,
        plan,
        canBuyOverage: false,
      };
    }
  }

  return { allowed: true, remaining, limit: effectiveLimit, used, plan };
}

// Track tweet usage after a successful scan
async function trackUsage(userId, plan, tweetCount) {
  if (!userId || PLAN_LIMITS[plan] === 0) return;

  const month = getMonthKey();

  // Upsert — increment tweets_used
  const { data: existing } = await supabase
    .from('x_usage')
    .select('id, tweets_used')
    .eq('user_id', userId)
    .eq('month', month)
    .single();

  if (existing) {
    await supabase
      .from('x_usage')
      .update({ tweets_used: existing.tweets_used + tweetCount, updated_at: new Date() })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('x_usage')
      .insert({ user_id: userId, month, tweets_used: tweetCount, overage_blocks: 0, plan });
  }
}

// Add an overage block (called after Stripe payment)
async function addOverageBlock(userId) {
  const month = getMonthKey();
  const { data: existing } = await supabase
    .from('x_usage')
    .select('id, overage_blocks')
    .eq('user_id', userId)
    .eq('month', month)
    .single();

  if (existing) {
    await supabase
      .from('x_usage')
      .update({ overage_blocks: (existing.overage_blocks || 0) + 1 })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('x_usage')
      .insert({ user_id: userId, month, tweets_used: 0, overage_blocks: 1 });
  }
}

// Get usage summary for dashboard display
async function getUsageSummary(userId, plan) {
  const limit = PLAN_LIMITS[plan] || 0;
  if (limit === 0) return { plan, xEnabled: false };

  const usage = await getUsage(userId);
  const used = usage?.tweets_used || 0;
  const overageBlocks = usage?.overage_blocks || 0;
  const effectiveLimit = limit + (overageBlocks * OVERAGE_BLOCK);
  const pct = Math.round((used / effectiveLimit) * 100);

  return {
    plan,
    xEnabled: true,
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

module.exports = { checkXAccess, trackUsage, addOverageBlock, getUsageSummary, PLAN_LIMITS };
