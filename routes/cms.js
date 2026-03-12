const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const wp = require('../services/wordpress');
const wf = require('../services/webflow');
const { fireWebhook, getWebhookConfig, saveWebhookConfig } = require('../services/webhook');

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

// Check plan allows CMS (Pro+)
function requirePro(req, res, next) {
  const plan = req.user?.plan || 'starter';
  if (plan === 'starter') {
    return res.status(403).json({
      error: 'Auto CMS publishing is available on Pro and Enterprise plans.',
      upgrade: true,
    });
  }
  next();
}

// GET /api/cms/test — test CMS connection for a venue
router.post('/test', authRequired, requirePro, async (req, res) => {
  try {
    const { cmsType, siteUrl, username, appPassword, apiToken } = req.body;

    if (cmsType === 'wordpress') {
      const result = await wp.testConnection(siteUrl, username, appPassword);
      return res.json(result);
    }

    if (cmsType === 'webflow') {
      const result = await wf.testConnection(apiToken);
      return res.json(result);
    }

    res.status(400).json({ error: 'cmsType must be wordpress or webflow' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cms/publish — publish a draft to CMS
router.post('/publish', authRequired, requirePro, async (req, res) => {
  try {
    const { cmsType, draft, pilotMode } = req.body;
    const userId = req.user.id;

    // Get venue CMS credentials from Supabase
    const { data: venue } = await supabase
      .from('venues')
      .select('cms_type, cms_site_url, cms_username, cms_app_password, cms_api_token, cms_collection_id, pilot_mode')
      .eq('user_id', userId)
      .single();

    if (!venue) return res.status(404).json({ error: 'Venue not found. Complete onboarding first.' });

    const effectivePilotMode = pilotMode || venue.pilot_mode || 'suggest';
    const effectiveCmsType = cmsType || venue.cms_type;

    let result;

    if (effectiveCmsType === 'wordpress') {
      result = await wp.publishContent({
        siteUrl: venue.cms_site_url,
        username: venue.cms_username,
        appPassword: venue.cms_app_password,
        pilotMode: effectivePilotMode,
        draft,
      });
    } else if (effectiveCmsType === 'webflow') {
      result = await wf.publishContent({
        apiToken: venue.cms_api_token,
        collectionId: venue.cms_collection_id,
        pilotMode: effectivePilotMode,
        draft,
      });
    } else if (venue.webhook_url) {
      const config = await getWebhookConfig(venueId || venue.id);
      result = await fireWebhook({
        webhookUrl: config.webhook_url,
        webhookSecret: config.webhook_secret,
        draft,
        pilotMode: effectivePilotMode,
        venueId,
      });
    } else {
      return res.status(400).json({ error: 'No CMS configured for this venue. Add CMS credentials in settings.' });
    }

    // Log to audit trail
    if (result.success && result.auditEntry) {
      await getSupabase().from('audit_trail').insert({
        user_id: userId,
        action: result.auditEntry.action,
        description: result.auditEntry.desc,
        platform: result.auditEntry.platform,
        url: result.auditEntry.url || null,
        pilot_mode: effectivePilotMode,
        created_at: new Date(),
      });
    }

    res.json({ success: result.success, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cms/credentials — save CMS credentials for a venue
router.post('/credentials', authRequired, requirePro, async (req, res) => {
  try {
    const { cmsType, siteUrl, username, appPassword, apiToken, collectionId } = req.body;
    const userId = req.user.id;

    // Test connection first
    let testResult;
    if (cmsType === 'wordpress') {
      testResult = await wp.testConnection(siteUrl, username, appPassword);
    } else if (cmsType === 'webflow') {
      testResult = await wf.testConnection(apiToken);
    }

    if (!testResult?.success) {
      return res.status(400).json({ error: `CMS connection failed: ${testResult?.error}` });
    }

    // Save to venues table
    const { error } = await supabase
      .from('venues')
      .update({
        cms_type: cmsType,
        cms_site_url: siteUrl || null,
        cms_username: username || null,
        cms_app_password: appPassword || null,
        cms_api_token: apiToken || null,
        cms_collection_id: collectionId || null,
        cms_connected: true,
        cms_connected_at: new Date(),
      })
      .eq('user_id', userId);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, message: `${cmsType} connected successfully.`, user: testResult.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cms/posts — get recent posts from connected CMS
router.get('/posts', authRequired, requirePro, async (req, res) => {
  try {
    const { data: venue } = await supabase
      .from('venues')
      .select('cms_type, cms_site_url, cms_username, cms_app_password')
      .eq('user_id', req.user.id)
      .single();

    if (!venue?.cms_connected) return res.json({ posts: [], connected: false });

    if (venue.cms_type === 'wordpress') {
      const posts = await wp.getRecentPosts(venue.cms_site_url, venue.cms_username, venue.cms_app_password);
      return res.json({ success: true, posts, cmsType: 'wordpress' });
    }

    res.json({ posts: [], connected: true, cmsType: venue.cms_type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cms/webhook — save webhook config
router.post('/webhook', authRequired, requirePro, async (req, res) => {
  try {
    const { webhookUrl, webhookSecret } = req.body;
    if (!webhookUrl) return res.status(400).json({ error: 'webhookUrl required' });
    const venueId = req.body.venueId;
    const success = await saveWebhookConfig(venueId, { webhookUrl, webhookSecret });
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;