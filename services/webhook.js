const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

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
      auditEntry: {
        action: 'Custom Webhook Fired',
        desc: `"${draft.title}" · ${pilotMode} · Status: ${res.status}`,
        platform: 'Custom Webhook',
        url: webhookUrl,
      }
module.exports = { fireWebhook, getWebhookConfig, saveWebhookConfig };
