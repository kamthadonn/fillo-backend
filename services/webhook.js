const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Fire a custom webhook for any CMS platform
// Venue sets their webhook URL in settings — Fillo POSTs content to it
async function fireWebhook({ webhookUrl, webhookSecret, draft, pilotMode, venueId }) {
  if (!webhookUrl) return { success: false, error: 'No webhook URL configured' };
  if (pilotMode === 'off') return { success: false, skipped: true };

  const payload = {
    event: 'fillo.content.ready',
    pilotMode,
    venueId,
    timestamp: new Date().toISOString(),
    content: {
      title: draft.title || '',
      body: draft.body || draft.content || draft.text || '',
      intro: draft.intro || '',
      cta: draft.cta || '',
      platform: draft.platform || 'website',
      action: pilotMode === 'auto' ? 'publish' : 'draft',
    },
  };

  const headers = { 'Content-Type': 'application/json' };
  if (webhookSecret) headers['X-Fillo-Secret'] = webhookSecret;

  try {
    const res = await axios.post(webhookUrl, payload, { headers, timeout: 10000 });
    return {
      success: true,
      status: res.status,
      action: pilotMode === 'auto' ? 'Webhook fired — content published' : 'Webhook fired — draft saved',
      auditEntry: {
        action: 'Custom Webhook Fired',
        desc: `"${draft.title}" · ${pilotMode} · Status: ${res.status}`,
        platform: 'Custom Webhook',
        url: webhookUrl,
      },
    };
  } catch (err) {
    return { success: false, error: err.response?.data || err.message };
  }
}

// Get webhook config for venue
async function getWebhookConfig(venueId) {
  const { data } = await supabase
    .from('venues')
    .select('webhook_url, webhook_secret')
    .eq('id', venueId)
    .single();
  return data || {};
}

// Save webhook config
async function saveWebhookConfig(venueId, { webhookUrl, webhookSecret }) {
  const { error } = await supabase
    .from('venues')
    .update({ webhook_url: webhookUrl, webhook_secret: webhookSecret })
    .eq('id', venueId);
  return !error;
}

module.exports = { fireWebhook, getWebhookConfig, saveWebhookConfig };