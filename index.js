require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const cron       = require('node-cron');
const rateLimit  = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);

const ALLOWED_ORIGINS = [
  'https://fillo.tech',
  'https://www.fillo.tech',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, Railway health checks)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    console.warn('[CORS] Blocked origin:', origin);
    callback(new Error('CORS: origin not allowed — ' + origin));
  },
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
  credentials: true,
}));

// Handle preflight for all routes (Express 5 / path-to-regexp v8 compatible)
app.options('/{*path}', cors());

// ── CRITICAL: Stripe webhook needs raw body BEFORE express.json() ──
// Mount webhook route first with raw body parser
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// All other routes use JSON
app.use(express.json());

// Rate limiters
const apiLimiter  = rateLimit({ windowMs: 15*60*1000, max: 100, message: { error: 'Too many requests.' } });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 10,  message: { error: 'Too many login attempts.' } });
const scanLimiter = rateLimit({ windowMs: 60*60*1000, max: 20,  message: { error: 'Scan limit reached.' } });

app.use('/api/', apiLimiter);
app.use('/api/auth/login',   authLimiter);
app.use('/api/auth/signup',  authLimiter);
app.use('/api/intelligence', scanLimiter);

app.get('/', (req, res) => res.json({ status: 'Fillo backend is live ⚡', version: '2.1.1' }));


// Safe route loader — if a route file is missing, log a warning instead of crashing
function safeRoute(path) {
  try {
    const route = require(path);
    if (typeof route !== 'function' && typeof route.handle !== 'function') {
      console.warn(`[Routes] ${path} did not export a valid router — skipping`);
      return null;
    }
    return route;
  } catch (e) {
    console.warn(`[Routes] Could not load ${path}: ${e.message}`);
    return null;
  }
}
function useRoute(app, prefix, path) {
  const r = safeRoute(path);
  if (r) app.use(prefix, r);
  else    console.warn(`[Routes] Skipping ${prefix} — route file not found or invalid`);
}

// Routes
useRoute(app, '/api/auth',          './routes/auth');
useRoute(app, '/api/demo',          './routes/demo');
useRoute(app, '/api/trends',        './routes/trends');
useRoute(app, '/api/integrations',  './routes/integrations');
useRoute(app, '/api/ask',           './routes/ask');
useRoute(app, '/api/cms',           './routes/cms');
useRoute(app, '/api/onboarding',    './routes/onboarding');
useRoute(app, '/api/stripe',        './routes/stripe');
useRoute(app, '/api/places',        './routes/places');
useRoute(app, '/api/searchconsole', './routes/searchconsole');
useRoute(app, '/api/venues',        './routes/venues');
useRoute(app, '/api/audit',         './routes/audit');
useRoute(app, '/api/team',          './routes/team');
useRoute(app, '/api/report',        './routes/report');
useRoute(app, '/api/whitelabel',    './routes/whitelabel');
useRoute(app, '/api/scans',         './routes/scans');
useRoute(app, '/api/spotlight',     './routes/spotlight');
useRoute(app, '/api/intelligence',  './routes/intelligence_learn');
useRoute(app, '/api/drafts',        './routes/drafts');
useRoute(app, '/api/x',             './routes/x');


// ── AUTOPILOT ENGINE — THE CORE OF FILLO ─────────────────────────────────────
// Every 6 hours: full scan + draft generation + CMS publish for every active venue
// This is what makes Fillo a true digital content manager running 24/7
// Pilot mode controls exactly what happens per venue:
//   'suggest'      → scan + generate drafts, saved to DB, user reviews in dashboard
//   'auto-draft'   → scan + generate drafts + save as CMS drafts (not live)
//   'auto-publish' → scan + generate drafts + publish live to website immediately
cron.schedule('30 */6 * * *', async () => {
  console.log('[Autopilot] Starting full scan cycle...');
  const startTime = Date.now();

  try {
    const { createClient }  = require('@supabase/supabase-js');
    const supabase           = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { runFullScan }    = require('./services/intelligence');
    const { sendFomoAlert }  = require('./services/emailalerts');
    const wp                 = require('./services/wordpress');
    const wf                 = require('./services/webflow');
    const { fireWebhook }    = require('./services/webhook');

    // Load all active venues with full details + user plan
    const { data: venues } = await supabase
      .from('venues')
      .select(`
        id, name, city, state, type, capacity, site_url,
        pilot_mode, genres, keywords, competitors, event_types,
        busiest_nights, venue_business_type, brand_voice,
        product_categories, target_customers, price_point,
        alert_email, fomo_threshold, email_frequency,
        cms_type, cms_site_url, cms_username, cms_app_password,
        cms_api_token, cms_collection_id, cms_connected,
        webhook_url, webhook_secret,
        users!inner(id, plan, status, email)
      `)
      .eq('is_active', true)
      .in('users.status', ['active', 'trialing'])
      .limit(100);

    if (!venues?.length) {
      console.log('[Autopilot] No active venues to process');
      return;
    }

    console.log(`[Autopilot] Processing ${venues.length} venues...`);
    let scanned = 0, published = 0, drafted = 0, errors = 0;

    for (const venue of venues) {
      // Stagger between venues to avoid hitting API rate limits
      await new Promise(r => setTimeout(r, 4000));

      const userId   = venue.users?.id || venue.user_id;
      const plan     = (venue.users?.plan || 'starter').toLowerCase();
      const pilotMode = venue.pilot_mode || 'suggest';

      if (!userId) continue;

      console.log(`[Autopilot] ${venue.name} | plan: ${plan} | pilot: ${pilotMode}`);

      try {
        const toArr = v => v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [];

        // ── STEP 1: RUN FULL INTELLIGENCE SCAN ──────────────────────────────
        const result = await runFullScan({
          venueName:         venue.name,
          venueType:         venue.type || 'venue',
          city:              venue.city || '',
          venueAddress:      [venue.city, venue.state].filter(Boolean).join(', '),
          capacity:          venue.capacity || null,
          genres:            toArr(venue.genres),
          keywords:          toArr(venue.keywords),
          competitors:       toArr(venue.competitors),
          eventTypes:        toArr(venue.event_types),
          busiestNights:     toArr(venue.busiest_nights),
          venueBusinessType: venue.venue_business_type || 'tickets',
          productCategories: venue.product_categories || '',
          targetCustomers:   venue.target_customers   || '',
          pricePoint:        venue.price_point         || '',
          siteUrl:           venue.site_url            || '',
          brandVoice:        venue.brand_voice         || '',
          pilotMode,
          venueId:           venue.id,
          userId,
          plan,
        });

        if (!result || result.blocked) {
          console.log(`[Autopilot] ${venue.name} — scan blocked or failed`);
          continue;
        }

        scanned++;
        const fomoScore = result.fomoScore || 0;
        const drafts    = result.drafts    || [];
        console.log(`[Autopilot] ${venue.name} — Score: ${fomoScore} · ${drafts.length} drafts`);

        // ── STEP 2: SAVE SCAN RECORD ─────────────────────────────────────────
        try {
          await supabase.from('scans').insert({
            user_id:             userId,
            venue_id:            venue.id,
            fomo_score:          fomoScore,
            insight:             result.insight    || '',
            trends:              JSON.stringify(result.trends || []),
            trend_count:         (result.trends    || []).length,
            drafts:              JSON.stringify(drafts),
            venue_business_type: venue.venue_business_type || 'tickets',
            plan,
            created_at:          new Date().toISOString(),
          });
        } catch(e) {
          console.warn(`[Autopilot] Scan save failed for ${venue.name}:`, e.message);
        }

        // ── STEP 3: EMAIL ALERT IF SCORE CROSSES THRESHOLD ───────────────────
        try {
          const threshold  = venue.fomo_threshold || 70;
          const alertEmail = venue.alert_email || venue.users?.email || '';
          if (alertEmail && fomoScore >= threshold && venue.email_frequency !== 'never') {
            await sendFomoAlert({
              to:        alertEmail,
              venueName: venue.name,
              fomoScore,
              insight:   result.insight,
              city:      venue.city,
              plan,
              bizType:   venue.venue_business_type || 'tickets',
            });
            console.log(`[Autopilot] Alert sent to ${alertEmail} — score ${fomoScore}`);
          }
        } catch(e) {
          console.warn(`[Autopilot] Alert failed for ${venue.name}:`, e.message);
        }

        // ── STEP 4: CMS PUBLISH / DRAFT BASED ON PILOT MODE ─────────────────
        // Only publish if pilot mode calls for it AND venue has CMS connected
        const hasCMS     = (venue.cms_connected || venue.cms_type) && (venue.cms_site_url || venue.cms_api_token);
        const hasWebhook = !!venue.webhook_url;
        const canPublish = hasCMS || hasWebhook;
        const shouldAct  = pilotMode === 'auto-publish' || pilotMode === 'auto-draft';
        const isAutoPub  = pilotMode === 'auto-publish';
        // Pro+ required for CMS — starter stays draft-only in dashboard
        const canUseCMS  = plan === 'pro' || plan === 'enterprise' || plan === 'voucher';

        if (shouldAct && canPublish && canUseCMS && drafts.length > 0) {
          // Pick the best draft — highest quality content piece first
          // Priority: Website/Blog content first, then Email, then Social
          const priorityOrder = ['Website', 'Blog Post', 'Email Campaign', 'Email', 'Instagram', 'TikTok', 'Product Drop'];
          const sortedDrafts  = [...drafts].sort((a, b) => {
            const ai = priorityOrder.findIndex(p => (a.platform||'').toLowerCase().includes(p.toLowerCase()));
            const bi = priorityOrder.findIndex(p => (b.platform||'').toLowerCase().includes(p.toLowerCase()));
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          });

          for (const draft of sortedDrafts.slice(0, isAutoPub ? 2 : 1)) {
            try {
              const draftPayload = {
                title:   `${venue.name} — ${draft.platform || 'Update'} · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
                content: draft.content || draft.hook || '',
                intro:   draft.hook    || '',
                body:    draft.content || '',
                cta:     result.topOpportunity || '',
                platform: draft.platform,
              };

              let publishResult = null;

              if (venue.cms_type === 'wordpress' && venue.cms_site_url) {
                publishResult = await wp.publishContent({
                  siteUrl:     venue.cms_site_url,
                  username:    venue.cms_username,
                  appPassword: venue.cms_app_password,
                  pilotMode:   isAutoPub ? 'auto' : 'suggest',
                  draft:       draftPayload,
                });
              } else if (venue.cms_type === 'webflow' && venue.cms_api_token) {
                publishResult = await wf.publishContent({
                  apiToken:     venue.cms_api_token,
                  collectionId: venue.cms_collection_id,
                  pilotMode:    isAutoPub ? 'auto' : 'suggest',
                  draft:        draftPayload,
                });
              } else if (hasWebhook) {
                publishResult = await fireWebhook({
                  webhookUrl:    venue.webhook_url,
                  webhookSecret: venue.webhook_secret,
                  draft:         draftPayload,
                  pilotMode:     isAutoPub ? 'auto' : 'suggest',
                  venueId:       venue.id,
                });
              }

              if (publishResult?.success) {
                isAutoPub ? published++ : drafted++;
                const action = isAutoPub
                  ? `Auto-published to ${venue.cms_type || 'webhook'} — ${draft.platform}`
                  : `Draft saved to ${venue.cms_type || 'webhook'} — ${draft.platform}`;
                console.log(`[Autopilot] ${venue.name} — ${action}`);

                // Save publish audit
                await supabase.from('audit_trail').insert({
                  user_id:    userId,
                  venue_id:   venue.id,
                  action,
                  description: `FOMO Score ${fomoScore} · ${draft.platform} · ${isAutoPub ? 'Live' : 'Draft'}`,
                  platform:   venue.cms_type || 'webhook',
                  pilot_mode: pilotMode,
                  created_at: new Date().toISOString(),
                });
              }
            } catch(publishErr) {
              console.warn(`[Autopilot] Publish failed for ${venue.name} (${draft.platform}):`, publishErr.message);
            }
          }
        } else if (shouldAct && !canPublish && canUseCMS) {
          // No CMS connected but autopilot is on — remind in audit
          await supabase.from('audit_trail').insert({
            user_id:    userId,
            venue_id:   venue.id,
            action:     'Autopilot ready — CMS not connected',
            description: `${venue.name} · Pilot mode: ${pilotMode} · Connect a CMS in Settings → Auto-Publish to start publishing`,
            platform:   'Fillo Autopilot',
            created_at: new Date().toISOString(),
          });
        }

        // ── STEP 5: SAVE SCAN AUDIT ENTRY ────────────────────────────────────
        await supabase.from('audit_trail').insert({
          user_id:    userId,
          venue_id:   venue.id,
          action:     `Autopilot scan — ${(result.trends||[]).length} signals · Score ${fomoScore}`,
          description: result.insight || `${venue.name} autopilot scan complete`,
          platform:   'Fillo Autopilot',
          pilot_mode: pilotMode,
          created_at: new Date().toISOString(),
        });

      } catch(venueErr) {
        errors++;
        console.error(`[Autopilot] Error for ${venue.name}:`, venueErr.message);
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[Autopilot] Complete in ${elapsed}s — scanned: ${scanned} · published: ${published} · drafted: ${drafted} · errors: ${errors}`);

  } catch(err) {
    console.error('[Autopilot] Fatal error:', err.message);
  }
});

// Hourly auto-scan
// ── 24/7 INTELLIGENCE ENGINE ─────────────────────────────────────────
// Every 6 hours: refresh intelligence profile for every active venue
// Each venue runs independently — strict user isolation, no bleed
cron.schedule('0 */6 * * *', async () => {
  console.log('[Cron] Starting 6-hour intelligence refresh...');
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    // Fetch all active venues WITH their owner's user record
    // Only process venues where the user is active (not cancelled/past_due)
    const { data: venues } = await supabase
      .from('venues')
      .select('*, users!inner(id, plan, status, email)')
      .eq('is_active', true)
      .in('users.status', ['active', 'trialing'])
      .limit(50);

    if (!venues?.length) { console.log('[Cron] No active venues'); return; }

    const { runDeepPull } = require('./services/deeppull');
    let refreshed = 0;

    for (const venue of venues) {
      try {
        // Stagger to avoid rate limits
        await new Promise(r => setTimeout(r, 3000));

        // ALWAYS pass userId so intelligence is stored under that user only
        const userId = venue.users?.id || venue.user_id;
        const plan   = venue.users?.plan || 'starter';

        if (!userId) {
          console.warn(`[Cron] Skipping ${venue.name} — no user_id found`);
          continue;
        }

        await runDeepPull({ ...venue, userId, plan });
        refreshed++;
        console.log(`[Cron] Refreshed: ${venue.name} (user: ${userId})`);
      } catch(e) {
        console.warn(`[Cron] Failed for ${venue.name}:`, e.message);
      }
    }

    console.log(`[Cron] Complete — ${refreshed}/${venues.length} refreshed`);
  } catch(err) {
    console.error('[Cron] Error:', err.message);
  }
});

// Every Monday 8am — send weekly intelligence reports to Enterprise users
cron.schedule('0 8 * * 1', async () => {
  console.log('[Cron] Sending weekly reports...');
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { sendWeeklyReport } = require('./services/emailalerts');

    // Get all active Enterprise users with alert emails
    const { data: users } = await supabase
      .from('users')
      .select('id, email')
      .eq('plan', 'enterprise')
      .eq('status', 'active');

    if (!users?.length) return;

    for (const user of users) {
      try {
        await new Promise(r => setTimeout(r, 2000)); // stagger

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const [{ data: venue }, { data: scans }, { data: audits }] = await Promise.all([
          supabase.from('venues').select('name, city, alert_email').eq('user_id', user.id).eq('is_active', true).limit(1).maybeSingle(),
          supabase.from('scans').select('fomo_score, insight, created_at').eq('user_id', user.id).gte('created_at', sevenDaysAgo),
          supabase.from('audit_trail').select('action').eq('user_id', user.id).gte('created_at', sevenDaysAgo),
        ]);

        if (!venue) continue;

        await sendWeeklyReport({
          to:        venue.alert_email || user.email,
          venueName: venue.name,
          scans:     scans || [],
          audits:    audits || [],
          topScore:  Math.max(...(scans || []).map(s => s.fomo_score || 0), 0),
          plan:      'enterprise',
        });

        console.log(`[Cron] Weekly report sent: ${venue.name}`);
      } catch(e) {
        console.warn(`[Cron] Weekly report failed for ${user.email}:`, e.message);
      }
    }
  } catch(err) {
    console.error('[Cron] Weekly report error:', err.message);
  }
});
// This is safe — it just refreshes public trending topics, not user intelligence
cron.schedule('0 * * * *', async () => {
  try {
    const { getDailyTrends } = require('./services/googletrends');
    const trends = await getDailyTrends('US');
    // Store in memory cache only — not written to any user's record
    global._cachedDailyTrends = { trends, cachedAt: Date.now() };
    console.log('[Cron] Global trends cache refreshed:', trends.length, 'topics');
  } catch (err) {
    console.error('[Cron] Trends error:', err.message);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`Fillo backend running on port ${PORT}`));