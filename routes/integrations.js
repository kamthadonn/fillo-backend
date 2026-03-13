const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ── AUTH MIDDLEWARE ────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  req.token = token;

  // Resolve user from token
  supabase.from('users').select('id, email, plan').eq('token', token).single()
    .then(({ data, error }) => {
      if (error || !data) return res.status(401).json({ error: 'Invalid token' });
      req.user = data;
      next();
    });
}

// ── GET ALL INTEGRATIONS FOR USER ────────────────────────────────────────
// GET /api/integrations
router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('integrations')
      .select('platform, connected, meta, last_sync')
      .eq('user_id', req.user.id);

    if (error) return res.json({ integrations: {} });

    const result = {};
    (data || []).forEach(row => {
      result[row.platform] = {
        connected:  row.connected,
        last_sync:  row.last_sync,
        org_name:   row.meta?.org_name,
        endpoint:   row.meta?.endpoint,
        url:        row.meta?.url,
      };
    });

    res.json({ integrations: result });
  } catch(e) {
    res.json({ integrations: {} });
  }
});

// ── SAVE INTEGRATION (generic) ────────────────────────────────────────────
// POST /api/integrations
router.post('/', auth, async (req, res) => {
  const { platform, ...payload } = req.body;
  if (!platform) return res.status(400).json({ error: 'platform required' });

  try {
    await supabase.from('integrations').upsert({
      user_id:   req.user.id,
      platform,
      connected: true,
      meta:      payload,
      last_sync: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,platform' });

    res.json({ success: true });
  } catch(e) {
    res.json({ success: true }); // still succeed — localStorage is backup
  }
});

// ── EVENTBRITE ────────────────────────────────────────────────────────────
// POST /api/integrations/eventbrite/connect
router.post('/eventbrite/connect', auth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });

  try {
    // Verify by calling Eventbrite /users/me/
    const ebRes = await fetch('https://www.eventbriteapi.com/v3/users/me/', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const ebData = await ebRes.json();

    if (!ebRes.ok || ebData.error) {
      return res.status(400).json({ error: ebData.error_description || 'Invalid token' });
    }

    // Get their organizations
    let orgName = ebData.name || ebData.emails?.[0]?.email || 'Your Account';
    try {
      const orgRes = await fetch('https://www.eventbriteapi.com/v3/users/me/organizations/', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const orgData = await orgRes.json();
      if (orgData.organizations?.[0]?.name) orgName = orgData.organizations[0].name;
    } catch(e) {}

    // Encrypt token before storing (base64 for now — swap for AES in production)
    const tokenEnc = Buffer.from(token).toString('base64');

    await supabase.from('integrations').upsert({
      user_id:    req.user.id,
      platform:  'eventbrite',
      connected:  true,
      meta:       { org_name: orgName, token_enc: tokenEnc },
      last_sync:  new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,platform' });

    res.json({ success: true, org_name: orgName });
  } catch(e) {
    console.error('Eventbrite connect error:', e.message);
    res.status(500).json({ error: 'Failed to connect to Eventbrite' });
  }
});

// POST /api/integrations/eventbrite/sync
router.post('/eventbrite/sync', auth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });

  try {
    // Get user's upcoming events
    const eventsRes = await fetch('https://www.eventbriteapi.com/v3/users/me/events/?status=live,started&order_by=start_asc&expand=ticket_availability', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const eventsData = await eventsRes.json();
    const events = eventsData.events || [];

    let totalSold = 0;
    let totalRevenue = 0;
    const eventSummaries = [];

    for (const event of events.slice(0, 5)) { // limit to 5 events
      try {
        const ordersRes = await fetch(`https://www.eventbriteapi.com/v3/events/${event.id}/orders/?only_emails=false`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const ordersData = await ordersRes.json();
        const sold = ordersData.pagination?.object_count || 0;
        const revenue = (ordersData.orders || []).reduce((sum, o) => sum + (parseFloat(o.costs?.base_price?.value || 0) / 100), 0);

        totalSold    += sold;
        totalRevenue += revenue;
        eventSummaries.push({ name: event.name?.text, sold, revenue: Math.round(revenue) });
      } catch(e) {}
    }

    // Save snapshot to Supabase
    await supabase.from('integrations').upsert({
      user_id:   req.user.id,
      platform:  'eventbrite',
      connected: true,
      meta:      { org_name: req.body.org_name, token_enc: Buffer.from(token).toString('base64'), events: eventSummaries },
      last_sync: new Date().toISOString()
    }, { onConflict: 'user_id,platform' });

    res.json({
      success:     true,
      tickets_sold: totalSold,
      revenue:      Math.round(totalRevenue),
      events:       events.length,
      summaries:    eventSummaries
    });
  } catch(e) {
    console.error('Eventbrite sync error:', e.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// ── DICE.FM ────────────────────────────────────────────────────────────────
// POST /api/integrations/dice/connect
router.post('/dice/connect', auth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });

  try {
    // Verify token via Dice GraphQL API
    const diceRes = await fetch('https://partners-endpoint.dice.fm/graphql', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ query: '{ viewer { id name } }' })
    });
    const diceData = await diceRes.json();

    if (diceData.errors || !diceData.data?.viewer) {
      return res.status(400).json({ error: 'Invalid Dice token' });
    }

    await supabase.from('integrations').upsert({
      user_id:    req.user.id,
      platform:  'dice',
      connected:  true,
      meta:       { token_enc: Buffer.from(token).toString('base64'), name: diceData.data.viewer.name },
      last_sync:  new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,platform' });

    res.json({ success: true, name: diceData.data.viewer.name });
  } catch(e) {
    console.error('Dice connect error:', e.message);
    res.status(500).json({ error: 'Failed to connect to Dice' });
  }
});

// ── TICKETMASTER ────────────────────────────────────────────────────────────
// POST /api/integrations/ticketmaster/connect
router.post('/ticketmaster/connect', auth, async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });

  try {
    // Verify by fetching user's venue if they have one
    const tmRes = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?apikey=${key}&size=1`);
    const tmData = await tmRes.json();

    if (!tmRes.ok || tmData.fault) {
      return res.status(400).json({ error: 'Invalid API key' });
    }

    await supabase.from('integrations').upsert({
      user_id:    req.user.id,
      platform:  'ticketmaster',
      connected:  true,
      meta:       { key_enc: Buffer.from(key).toString('base64') },
      last_sync:  new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,platform' });

    res.json({ success: true });
  } catch(e) {
    console.error('Ticketmaster connect error:', e.message);
    res.status(500).json({ error: 'Failed to connect to Ticketmaster' });
  }
});

// ── WEBHOOK ────────────────────────────────────────────────────────────────
// POST /api/integrations/webhook/generate
router.post('/webhook/generate', auth, async (req, res) => {
  const secret    = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const endpoint  = `${process.env.FRONTEND_URL || 'https://api.fillo.tech'}/api/integrations/webhook/receive/${req.user.id}/${secret}`;

  await supabase.from('integrations').upsert({
    user_id:    req.user.id,
    platform:  'webhook',
    connected:  true,
    meta:       { endpoint, secret },
    last_sync:  null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,platform' });

  res.json({ success: true, endpoint });
});

// POST /api/integrations/webhook/receive/:userId/:secret
// This is the public endpoint ticketing platforms POST to
router.post('/webhook/receive/:userId/:secret', async (req, res) => {
  const { userId, secret } = req.params;

  try {
    // Verify secret
    const { data: intData } = await supabase
      .from('integrations')
      .select('meta')
      .eq('user_id', userId)
      .eq('platform', 'webhook')
      .single();

    if (!intData || intData.meta?.secret !== secret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const payload = req.body;
    // Normalize: support order.placed, ticket.sold, sale, order styles
    const action      = payload.action || payload.type || payload.event || 'sale';
    const ticketsSold = payload.quantity || payload.tickets_sold || payload.count || 1;
    const eventName   = payload.event_name || payload.event || payload.description || 'Event';
    const revenue     = payload.total || payload.amount || payload.revenue || 0;

    // Save webhook event to audit trail for this user
    await supabase.from('audit_trail').insert({
      user_id:    userId,
      action:    'Webhook received: ' + action,
      description: eventName + ' · ' + ticketsSold + ' ticket(s) · $' + revenue,
      platform:  'Webhook',
      pilot_mode: 'webhook',
      created_at: new Date().toISOString()
    });

    // Update integrations last_sync
    await supabase.from('integrations').update({ last_sync: new Date().toISOString() })
      .eq('user_id', userId).eq('platform', 'webhook');

    res.json({ received: true });
  } catch(e) {
    console.error('Webhook receive error:', e.message);
    res.status(500).json({ error: 'Processing failed' });
  }
});

// ── CMS CONNECT ────────────────────────────────────────────────────────────
// POST /api/integrations/cms/connect
router.post('/cms/connect', auth, async (req, res) => {
  const { platform, url, user, pass, token, collection, key, site } = req.body;

  try {
    let verified = false;
    let meta = { platform };

    if (platform === 'wordpress' && url && user && pass) {
      // Test WP REST API connection
      const b64 = Buffer.from(`${user}:${pass}`).toString('base64');
      const wpRes = await fetch(`${url.replace(/\/$/, '')}/wp-json/wp/v2/posts?per_page=1`, {
        headers: { 'Authorization': `Basic ${b64}` }
      });
      verified = wpRes.ok;
      meta = { url, user, pass_enc: Buffer.from(pass).toString('base64') };
    } else if (platform === 'webflow' && token) {
      // Test Webflow connection
      const wfRes = await fetch('https://api.webflow.com/v2/sites', {
        headers: { 'Authorization': `Bearer ${token}`, 'accept-version': '1.0.0' }
      });
      verified = wfRes.ok;
      meta = { token_enc: Buffer.from(token).toString('base64'), collection };
    } else if (platform === 'squarespace' && key) {
      // Squarespace v6 API verification
      const ssRes = await fetch('https://api.squarespace.com/1.0/commerce/products', {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      verified = ssRes.ok || ssRes.status === 404; // 404 = key valid but no products
      meta = { key_enc: Buffer.from(key).toString('base64'), site };
    }

    if (!verified) {
      return res.status(400).json({ error: 'Could not verify credentials. Please check and try again.' });
    }

    await supabase.from('integrations').upsert({
      user_id:    req.user.id,
      platform,
      connected:  true,
      meta,
      last_sync:  new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,platform' });

    res.json({ success: true });
  } catch(e) {
    console.error('CMS connect error:', e.message);
    res.status(500).json({ error: 'Connection failed: ' + e.message });
  }
});

// ── DISCONNECT ────────────────────────────────────────────────────────────────
// DELETE /api/integrations/:platform/disconnect
router.delete('/:platform/disconnect', auth, async (req, res) => {
  try {
    await supabase.from('integrations')
      .update({ connected: false, updated_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .eq('platform', req.params.platform);

    res.json({ success: true });
  } catch(e) {
    res.json({ success: true });
  }
});

// ── SYNC ALL TICKET INTEGRATIONS (called on every login/refresh) ────────────
// POST /api/integrations/sync
router.post('/sync', auth, async (req, res) => {
  try {
    // Get all connected ticket integrations for this user
    const { data: integrations } = await supabase
      .from('integrations')
      .select('platform, meta, last_sync')
      .eq('user_id', req.user.id)
      .eq('connected', true)
      .in('platform', ['eventbrite', 'dice', 'ticketmaster']);

    if (!integrations || integrations.length === 0) {
      return res.json({ results: [] });
    }

    const results = await Promise.allSettled(
      integrations.map(int => syncPlatform(int, req.user.id))
    );

    const output = results.map((r, i) => ({
      platform:    integrations[i].platform,
      ...(r.status === 'fulfilled' ? r.value : { error: r.reason?.message })
    }));

    res.json({ results: output });
  } catch(e) {
    console.error('Sync error:', e.message);
    res.json({ results: [] });
  }
});

async function syncPlatform(integration, userId) {
  const { platform, meta } = integration;

  if (platform === 'eventbrite' && meta?.token_enc) {
    const token = Buffer.from(meta.token_enc, 'base64').toString();

    // Fetch events + orders
    const eventsRes = await fetch(
      'https://www.eventbriteapi.com/v3/users/me/events/?status=live,started&order_by=start_desc&expand=ticket_availability',
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!eventsRes.ok) throw new Error('Eventbrite token invalid or expired');

    const eventsData = await eventsRes.json();
    const events = (eventsData.events || []).slice(0, 10);

    let totalSold = 0, totalRevenue = 0;

    for (const event of events) {
      try {
        const ordersRes = await fetch(
          `https://www.eventbriteapi.com/v3/events/${event.id}/orders/?only_emails=false&status=placed`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const ordersData = await ordersRes.json();
        totalSold += ordersData.pagination?.object_count || 0;
        totalRevenue += (ordersData.orders || []).reduce((s, o) => {
          return s + (parseFloat(o.costs?.base_price?.value || 0) / 100);
        }, 0);
      } catch(e) {}
    }

    // Update last_sync
    await supabase.from('integrations')
      .update({ last_sync: new Date().toISOString(), meta: { ...meta, last_count: totalSold } })
      .eq('user_id', userId).eq('platform', 'eventbrite');

    return { platform: 'Eventbrite', tickets_sold: totalSold, revenue: Math.round(totalRevenue), events: events.length };
  }

  if (platform === 'dice' && meta?.token_enc) {
    const token = Buffer.from(meta.token_enc, 'base64').toString();

    // Query Dice GraphQL for recent orders
    const query = `{
      viewer {
        orders(first: 100, where: { purchasedAt: { gte: "${getStartOfMonth()}" } }) {
          totalCount
          edges { node { tickets { fullPrice total } } }
        }
      }
    }`;

    const diceRes = await fetch('https://partners-endpoint.dice.fm/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ query })
    });
    const diceData = await diceRes.json();

    const totalCount  = diceData.data?.viewer?.orders?.totalCount || 0;
    const edges       = diceData.data?.viewer?.orders?.edges || [];
    const totalRevenue = edges.reduce((sum, e) => {
      return sum + (e.node?.tickets || []).reduce((s, t) => s + ((t.total || 0) / 100), 0);
    }, 0);

    await supabase.from('integrations')
      .update({ last_sync: new Date().toISOString() })
      .eq('user_id', userId).eq('platform', 'dice');

    return { platform: 'Dice', tickets_sold: totalCount, revenue: Math.round(totalRevenue) };
  }

  if (platform === 'ticketmaster' && meta?.key_enc) {
    // TM Discovery API — search for venue's upcoming events using stored venue name
    const key = Buffer.from(meta.key_enc, 'base64').toString();

    // Get user's venue name for targeted search
    const { data: venues } = await supabase
      .from('venues')
      .select('name, city')
      .eq('user_id', userId)
      .limit(1);

    const venueName = venues?.[0]?.name || '';
    const city      = venues?.[0]?.city || '';

    const tmRes = await fetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${key}&keyword=${encodeURIComponent(venueName)}&city=${encodeURIComponent(city)}&size=10`
    );
    if (!tmRes.ok) throw new Error('Ticketmaster key invalid');

    const tmData  = await tmRes.json();
    const events  = tmData._embedded?.events || [];
    const onSale  = events.filter(e => e.dates?.status?.code === 'onsale').length;

    await supabase.from('integrations')
      .update({ last_sync: new Date().toISOString() })
      .eq('user_id', userId).eq('platform', 'ticketmaster');

    // TM Discovery API doesn't expose private sales counts — return event count
    return { platform: 'Ticketmaster', tickets_sold: 0, events_on_sale: onSale, note: 'Event listings synced' };
  }

  return { platform, skipped: true };
}

function getStartOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

module.exports = router;