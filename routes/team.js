const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
function getSupabase() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY); }

function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.AUTH_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role === 'viewer') {
    return res.status(403).json({ error: 'Viewers cannot perform this action. Contact your account admin.' });
  }
  next();
}

function requireEnterprise(req, res, next) {
  if (req.user.plan !== 'enterprise') {
    return res.status(403).json({ error: 'Team members are an Enterprise feature.', upgrade: true });
  }
  next();
}

// GET /api/team — get all team members for account
router.get('/', authRequired, requireEnterprise, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('team_members')
      .select('*, member:member_id(first_name, last_name, email, last_login)')
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, members: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/team/invite — invite a team member
router.post('/invite', authRequired, requireEnterprise, requireAdmin, async (req, res) => {
  try {
    const { email, role = 'viewer', venueId } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    if (!['admin', 'viewer'].includes(role)) return res.status(400).json({ error: 'Role must be admin or viewer' });

    // Check if already invited
    const { data: existing } = await supabase
      .from('team_members')
      .select('id')
      .eq('owner_id', req.user.id)
      .eq('invited_email', email)
      .single();

    if (existing) return res.status(400).json({ error: 'This person has already been invited.' });

    // Check if user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    const { data, error } = await supabase
      .from('team_members')
      .insert({
        owner_id: req.user.id,
        member_id: existingUser?.id || null,
        venue_id: venueId || null,
        role,
        invited_email: email,
        status: existingUser ? 'active' : 'pending',
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Log to audit trail
    await getSupabase().from('audit_trail').insert({
      user_id: req.user.id,
      action: `Team Member Invited`,
      description: `${email} invited as ${role}`,
      platform: 'Team',
      created_at: new Date(),
    });

    res.json({ success: true, member: data, message: `${email} invited as ${role}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/team/:id/role — change role
router.patch('/:id/role', authRequired, requireEnterprise, requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const { error } = await supabase
      .from('team_members')
      .update({ role })
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/team/:id — remove team member
router.delete('/:id', authRequired, requireEnterprise, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Middleware export — use in other routes to check viewer permissions
function checkPermission(action) {
  return async (req, res, next) => {
    // Viewers can read, not write
    const writeActions = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (req.user.role === 'viewer' && writeActions.includes(req.method)) {
      return res.status(403).json({ error: 'Viewers have read-only access. Contact your account admin to make changes.' });
    }
    next();
  };
}

module.exports = router;
module.exports.checkPermission = checkPermission;
module.exports.requireAdmin = requireAdmin;