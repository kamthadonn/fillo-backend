const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name, plan, billing } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const supabase = getSupabase();
    const { data: existing } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    if (existing) return res.status(400).json({ error: 'An account with this email already exists. Please log in.' });
    const hash = await bcrypt.hash(password, 10);
    const validPlans = ['starter', 'pro', 'enterprise', 'voucher'];
    const userPlan = validPlans.includes(plan) ? plan : 'starter';
    const { data: user, error } = await supabase.from('users').insert({
      email,
      password_hash: hash,
      name: name || '',
      plan: userPlan,
      billing: billing || 'monthly',
      status: 'pending_payment',
      created_at: new Date().toISOString()
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    const token = jwt.sign({ userId: user.id, email: user.email }, AUTH_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password, invite_token } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const supabase = getSupabase();
    const { data: user, error } = await supabase.from('users').select('*').eq('email', email).single();
    if (error || !user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // Check if this user is a team member — if so, load owner context
    const { data: teamMembership } = await supabase
      .from('team_members')
      .select('owner_id, venue_id, role')
      .eq('member_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    const ownerId = teamMembership?.owner_id || null;
    const venueId = teamMembership?.venue_id || null;
    const role    = teamMembership?.role || 'owner';

    // If invite token provided, accept the invite
    if (invite_token) {
      await supabase.from('team_members')
        .update({ member_id: user.id, status: 'active', invite_token: null })
        .eq('invite_token', invite_token);
    }

    const tokenPayload = { userId: user.id, email: user.email };
    if (ownerId) { tokenPayload.ownerId = ownerId; tokenPayload.venueId = venueId; tokenPayload.role = role; }

    const token = jwt.sign(tokenPayload, AUTH_SECRET, { expiresIn: '30d' });

    // Get owner's plan if team member
    let plan = user.plan;
    if (ownerId) {
      const { data: owner } = await supabase.from('users').select('plan').eq('id', ownerId).single();
      plan = owner?.plan || plan;
    }

    res.json({ success: true, token, user: {
      id: user.id, email: user.email, name: user.name,
      plan, role, ownerId, venueId
    }});
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, AUTH_SECRET);
    const supabase = getSupabase();
    const { data: user, error } = await supabase.from('users').select('id, email, name, first_name, last_name, plan, billing, status, created_at').eq('id', decoded.userId).single();
    if (error || !user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;