const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

// ── Build a signed token that includes plan + status ─────────────────────────
// Plan is embedded so routes can use it without a DB hit every request.
// Token refreshed on: signup, login, /api/auth/refresh (called after Stripe payment)
function signToken(user, extra = {}) {
  const payload = {
    userId: user.id,
    email:  user.email,
    plan:   user.plan   || 'starter',
    status: user.status || 'pending_payment',
    ...extra,
  };
  return jwt.sign(payload, AUTH_SECRET, { expiresIn: '30d' });
}

function userPublic(user, extra = {}) {
  return {
    id:         user.id,
    email:      user.email,
    name:       user.name       || '',
    first_name: user.first_name || '',
    last_name:  user.last_name  || '',
    plan:       user.plan       || 'starter',
    billing:    user.billing    || 'monthly',
    status:     user.status     || 'pending_payment',
    ...extra,
  };
}

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name, firstName, lastName, plan, billing } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const supabase  = getSupabase();
    const { data: existing } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    if (existing) return res.status(400).json({ error: 'An account with this email already exists. Please log in.' });

    const hash      = await bcrypt.hash(password, 10);
    const validPlans = ['starter', 'pro', 'enterprise', 'voucher'];
    const userPlan  = validPlans.includes(plan) ? plan : 'starter';
    const fullName  = name || [firstName, lastName].filter(Boolean).join(' ') || '';

    const { data: user, error } = await supabase.from('users').insert({
      email,
      password_hash: hash,
      name:          fullName,
      first_name:    firstName || fullName.split(' ')[0]  || '',
      last_name:     lastName  || fullName.split(' ').slice(1).join(' ') || '',
      plan:          userPlan,
      billing:       billing || 'monthly',
      status:        'pending_payment',
      created_at:    new Date().toISOString(),
      updated_at:    new Date().toISOString(),
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    const token = signToken(user);
    console.log(`✅ New user: ${user.email} (plan: ${userPlan})`);
    res.json({ success: true, token, user: userPublic(user) });

  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password, invite_token } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const supabase = getSupabase();
    const { data: user, error } = await supabase.from('users').select('*').eq('email', email).single();
    if (error || !user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // Check team membership
    const { data: membership } = await supabase
      .from('team_members')
      .select('owner_id, venue_id, role')
      .eq('member_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    const ownerId = membership?.owner_id || null;
    const venueId = membership?.venue_id || null;
    const role    = membership?.role     || 'owner';

    // Accept pending invite if token provided
    if (invite_token) {
      await supabase.from('team_members')
        .update({ member_id: user.id, status: 'active', invite_token: null })
        .eq('invite_token', invite_token);
    }

    // For team members, use the owner's plan
    let plan = user.plan;
    if (ownerId) {
      const { data: owner } = await supabase.from('users').select('plan, status').eq('id', ownerId).single();
      plan = owner?.plan || plan;
    }

    // Fresh user record with real plan
    const tokenUser = { ...user, plan };
    const extra     = ownerId ? { ownerId, venueId, role } : {};
    const token     = signToken(tokenUser, extra);

    console.log(`✅ Login: ${user.email} (plan: ${plan}, role: ${role})`);
    res.json({ success: true, token, user: userPublic(tokenUser, extra) });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/me — returns latest user data from DB ──────────────────────
router.get('/me', async (req, res) => {
  try {
    const raw = req.headers.authorization?.replace('Bearer ', '');
    if (!raw) return res.status(401).json({ error: 'No token' });

    const decoded  = jwt.verify(raw, AUTH_SECRET);
    const supabase = getSupabase();

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, first_name, last_name, plan, billing, status, created_at')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) return res.status(404).json({ error: 'User not found' });

    // Also get team context if applicable
    const ownerId = decoded.ownerId || null;
    const role    = decoded.role    || 'owner';

    res.json({ success: true, user: userPublic(user, ownerId ? { ownerId, role } : {}) });

  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ── POST /api/auth/refresh — re-issue token with latest plan/status ───────────
// Called by dashboard after Stripe payment completes so the JWT reflects
// the new paid plan immediately — no logout/login required
router.post('/refresh', async (req, res) => {
  try {
    const raw = req.headers.authorization?.replace('Bearer ', '');
    if (!raw) return res.status(401).json({ error: 'No token' });

    const decoded  = jwt.verify(raw, AUTH_SECRET);
    const supabase = getSupabase();

    // Pull fresh user record — plan/status updated by Stripe webhook
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, first_name, last_name, plan, billing, status')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) return res.status(404).json({ error: 'User not found' });

    const ownerId = decoded.ownerId || null;
    const role    = decoded.role    || 'owner';
    const extra   = ownerId ? { ownerId, venueId: decoded.venueId, role } : {};
    const token   = signToken(user, extra);

    console.log(`🔄 Token refreshed: ${user.email} → plan: ${user.plan}, status: ${user.status}`);
    res.json({ success: true, token, user: userPublic(user, extra) });

  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
