require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const cron       = require('node-cron');
const rateLimit  = require('express-rate-limit');

const app = express();

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
app.use('/api/intelligence',   require('./routes/intelligence_learn'));
app.use('/api/drafts',        require('./routes/drafts'));

// Hourly auto-scan
// ── 24/7 INTELLIGENCE ENGINE ─────────────────────────────────────────
// Every 6 hours: refresh intelligence profile for every active venue
// This is what makes Fillo always learning — not just on login
cron.schedule('0 */6 * * *', async () => {
  console.log('[Cron] Starting 6-hour intelligence refresh for all venues...');
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    // Get all active venues that have had a scan in the last 30 days
    const { data: venues } = await supabase
      .from('venues')
      .select('*, users!inner(plan, status)')
      .eq('is_active', true)
      .limit(50); // process up to 50 venues per cycle

    if (!venues?.length) { console.log('[Cron] No active venues found'); return; }

    const { runDeepPull } = require('./services/deeppull');
    let refreshed = 0;

    for (const venue of venues) {
      try {
        // Stagger requests to avoid rate limits
        await new Promise(r => setTimeout(r, 3000));
        await runDeepPull(venue);
        refreshed++;
        console.log(`[Cron] Refreshed: ${venue.name}`);
      } catch(e) {
        console.warn(`[Cron] Failed for ${venue.name}:`, e.message);
      }
    }
    console.log(`[Cron] Intelligence refresh complete — ${refreshed}/${venues.length} venues updated`);
  } catch(err) {
    console.error('[Cron] Intelligence refresh error:', err.message);
  }
});

// Every hour: run a lightweight market signal update (trends only, no full re-pull)
cron.schedule('0 * * * *', async () => {
  try {
    const { scanTrends } = require('./services/googletrends');
    const trends = await scanTrends();
    console.log('[Cron] Market trends refreshed:', trends.length, 'signals');
  } catch (err) {
    console.error('[Cron] Trends error:', err.message);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`Fillo backend running on port ${PORT}`));