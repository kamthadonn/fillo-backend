require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const cron       = require('node-cron');
const rateLimit  = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);

app.use(cors());

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


// Routes
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/demo',          require('./routes/demo'));
app.use('/api/trends',        require('./routes/trends'));
app.use('/api/cms',           require('./routes/cms'));
app.use('/api/onboarding',    require('./routes/onboarding'));
app.use('/api/stripe',        require('./routes/stripe'));
app.use('/api/places',        require('./routes/places'));
app.use('/api/searchconsole', require('./routes/searchconsole'));
app.use('/api/venues',        require('./routes/venues'));
app.use('/api/audit',         require('./routes/audit'));
app.use('/api/team',          require('./routes/team'));
app.use('/api/report',        require('./routes/report'));
app.use('/api/whitelabel',    require('./routes/whitelabel'));
app.use('/api/scans',         require('./routes/scans'));
app.use('/api/spotlight',     require('./routes/spotlight'));
app.use('/api/intelligence',  require('./routes/intelligence_learn'));
app.use('/api/drafts',        require('./routes/drafts'));
app.use('/api/x',             require('./routes/x'));

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
