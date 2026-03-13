const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

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

function requireEnterprise(req, res, next) {
  if (req.user.plan !== 'enterprise') {
    return res.status(403).json({ error: 'White label is an Enterprise feature.', upgrade: true });
  }
  next();
}

// GET /api/whitelabel
router.get('/', authRequired, requireEnterprise, async (req, res) => {
  try {
    const { data } = await supabase
      .from('users')
      .select('white_label')
      .eq('id', req.user.id)
      .single();
    res.json({ success: true, config: data?.white_label || {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whitelabel
router.post('/', authRequired, requireEnterprise, async (req, res) => {
  try {
    const config = {
      enabled: req.body.enabled !== false,
      brandName: req.body.brandName || '',
      logoUrl: req.body.logoUrl || '',
      primaryColor: req.body.primaryColor || '#C8963E',
      accentColor: req.body.accentColor || '#E8B86D',
      subdomain: req.body.subdomain?.toLowerCase().replace(/[^a-z0-9]/g, '') || '',
      hideFillobranding: req.body.hideFillobranding !== false,
      customSupportEmail: req.body.customSupportEmail || '',
    };

    const { error } = await supabase
      .from('users')
      .update({ white_label: config })
      .eq('id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });

    await supabase.from('audit_trail').insert({
      user_id: req.user.id,
      action: 'White Label Updated',
      description: `Brand: ${config.brandName} · Color: ${config.primaryColor}`,
      platform: 'Settings',
      created_at: new Date(),
    });

    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/whitelabel/resolve/:subdomain
router.get('/resolve/:subdomain', async (req, res) => {
  try {
    const subdomain = req.params.subdomain?.toLowerCase();
    const { data: users } = await supabase
      .from('users')
      .select('id, white_label')
      .not('white_label', 'is', null);

    const match = (users || []).find(u =>
      u.white_label?.subdomain === subdomain && u.white_label?.enabled
    );

    if (!match) return res.json({ found: false });
    res.json({ found: true, config: match.white_label });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;