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

// GET /api/audit — get audit trail entries for user
router.get('/', authRequired, async (req, res) => {
  try {
    const limit = req.query.limit || 100;
    const { data, error } = await supabase
      .from('audit_trail')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, entries: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/audit/export — return CSV string
router.get('/export', authRequired, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('audit_trail')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) return res.status(500).json({ error: error.message });

    const rows = [['Timestamp', 'Action', 'Description', 'Platform', 'Pilot Mode', 'URL']];
    (data || []).forEach(e => {
      rows.push([
        e.created_at,
        (e.action || '').replace(/,/g, ' '),
        (e.description || '').replace(/,/g, ' '),
        e.platform || '',
        e.pilot_mode || '',
        e.url || '',
      ]);
    });

    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="fillo-audit-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/audit — log a new entry
router.post('/', authRequired, async (req, res) => {
  try {
    const { action, description, platform, url, pilot_mode } = req.body;
    const { error } = await getSupabase().from('audit_trail').insert({
      user_id: req.user.id,
      action,
      description,
      platform,
      url,
      pilot_mode,
      created_at: new Date(),
    });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;