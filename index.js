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
  'https://api.fillo.tech',
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

// Every hour: lightweight market signal cache refresh (global trends only, no user data)
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
