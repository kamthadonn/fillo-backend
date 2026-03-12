const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

async function fireWebhook({ webhookUrl, webhookSecret, draft, pilotMode, venueId }) {
  if (!webhookUrl) return { success: false, error: 'No webhook URL configured' };
  if (pilotMode === 'off') return { success: false, skipped: true };
  const payload = { event: 'fillo.content.ready', pilotMode, venueId, timestamp: new Date().toISOString(), content: { title: draft.title || '', body: draft.body || draft.content || '', platform: draft.platform || 'website', action: pilotMode === 'auto' ? 'publish' : 'draft' } };
  const headers = { 'Content-Type': 'application/json' };
  if (webhookSecret) headers['X-Fillo-Secret'] = webhookSecret;
  try {
    const res = await axios.post(webhookUrl, payload, { headers, timeout: 10000 });
    return { success: true, status: res.status, auditEntry: { action: 'Webhook Fired', desc: pilotMode, platform: 'Custom Webhook', url: webhookUrl } };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getWebhookConfig(venueId) {
  const { data } = await getSupabase().from('venues').select('webhook_url, webhook_secret').eq('id', venueId).single();
  return data || {};
}

async function saveWebhookConfig(venueId, { webhookUrl, webhookSecret }) {
  const { error } = await getSupabase().from('venues').update({ webhook_url: webhookUrl, webhook_secret: webhookSecret }).eq('id', venueId);
  return !error;
}

module.exports = { fireWebhook, getWebhookConfig, saveWebhookConfig };
