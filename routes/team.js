const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, AUTH_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// GET /api/team — get all team members for this account
router.get('/', authRequired, async (req, res) => {
  try {
    const supabase = getSupabase();
    const ownerId = req.user.ownerId || req.user.userId;

    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, members: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/team/invite — invite a team member by email
router.post('/invite', authRequired, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { email, role = 'viewer' } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    if (!['admin', 'viewer'].includes(role)) return res.status(400).json({ error: 'Role must be admin or viewer' });

    const ownerId  = req.user.ownerId || req.user.userId;
    const venueId  = req.user.venueId || null;

    // Check plan — Pro allows up to 3 team members, Enterprise unlimited
    const { data: owner } = await supabase.from('users').select('plan').eq('id', ownerId).single();
    const plan = owner?.plan || 'starter';

    if (plan === 'starter') {
      return res.status(403).json({ error: 'Team members require Pro or Enterprise plan.', upgrade: true });
    }

    const { data: existing } = await supabase.from('team_members').select('id').eq('owner_id', ownerId).eq('invited_email', email).maybeSingle();
    if (existing) return res.status(400).json({ error: 'This person has already been invited.' });

    // Check team size limit for Pro (max 5 members)
    if (plan === 'pro') {
      const { data: members } = await supabase.from('team_members').select('id').eq('owner_id', ownerId);
      if (members && members.length >= 5) {
        return res.status(403).json({ error: 'Pro plan allows up to 5 team members. Upgrade to Enterprise for unlimited.', upgrade: true });
      }
    }

    // Generate invite token
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    // Check if user already exists in system
    const { data: existingUser } = await supabase.from('users').select('id').eq('email', email).maybeSingle();

    const { data: member, error } = await supabase.from('team_members').insert({
      owner_id:      ownerId,
      member_id:     existingUser?.id || null,
      venue_id:      venueId,
      role,
      invited_email: email,
      invite_token:  inviteToken,
      invite_expires: expiresAt,
      status:        existingUser ? 'active' : 'pending',
      created_at:    new Date().toISOString()
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    // Log to audit trail
    await supabase.from('audit_trail').insert({
      user_id:    ownerId,
      action:     'Team Member Invited',
      description: `${email} invited as ${role}`,
      platform:   'Team',
      created_at: new Date().toISOString()
    });

    // Return invite link for manual sharing
    const inviteLink = `${process.env.FRONTEND_URL}/login.html?invite=${inviteToken}&email=${encodeURIComponent(email)}`;

    res.json({
      success: true,
      member: data,
      inviteLink,
      message: `${email} invited as ${role}. Share the invite link with them.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/team/accept — accept an invite (called when invited user signs up or logs in)
router.post('/accept', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { invite_token, email, password, name } = req.body;
    if (!invite_token) return res.status(400).json({ error: 'Invite token required' });

    // Find the invite
    const { data: invite, error: inviteErr } = await supabase
      .from('team_members')
      .select('*, owner:owner_id(id, email, plan)')
      .eq('invite_token', invite_token)
      .maybeSingle();

    if (inviteErr || !invite) return res.status(400).json({ error: 'Invalid or expired invite link.' });
    if (new Date(invite.invite_expires) < new Date()) return res.status(400).json({ error: 'This invite has expired. Ask your admin to resend it.' });

    // Check if user already exists
    let userId;
    const { data: existingUser } = await supabase.from('users').select('id, email').eq('email', invite.invited_email).maybeSingle();

    if (existingUser) {
      userId = existingUser.id;
    } else {
      // Create account for them
      if (!password) return res.status(400).json({ error: 'Password required to create your account.' });
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash(password, 10);
      const { data: newUser, error: createErr } = await supabase.from('users').insert({
        email:         invite.invited_email,
        password_hash: hash,
        name:          name || '',
        plan:          invite.owner?.plan || 'pro',
        status:        'active',
        created_at:    new Date().toISOString()
      }).select().single();
      if (createErr) return res.status(500).json({ error: createErr.message });
      userId = newUser.id;
    }

    // Link them to the team
    await supabase.from('team_members').update({
      member_id: userId,
      status:    'active',
      invite_token: null
    }).eq('id', invite.id);

    // Get venue for this team
    const venueId = invite.venue_id;

    // Issue JWT with owner context so they see shared data
    const token = jwt.sign({
      userId,
      email:   invite.invited_email,
      ownerId: invite.owner_id,   // ← key: load data as owner
      venueId,
      role:    invite.role
    }, AUTH_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      token,
      user: {
        id:      userId,
        email:   invite.invited_email,
        name:    name || '',
        plan:    invite.owner?.plan,
        role:    invite.role,
        ownerId: invite.owner_id,
        venueId
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/team/:id — remove team member
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const supabase = getSupabase();
    const ownerId = req.user.ownerId || req.user.userId;
    const { error } = await supabase.from('team_members').delete().eq('id', req.params.id).eq('owner_id', ownerId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/team/:id/role
router.patch('/:id/role', authRequired, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { role } = req.body;
    if (!['admin', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const ownerId = req.user.ownerId || req.user.userId;
    const { error } = await supabase.from('team_members').update({ role }).eq('id', req.params.id).eq('owner_id', ownerId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;