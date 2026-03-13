const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const AUTH_SECRET = process.env.AUTH_SECRET || 'fillo-super-secret-2026';

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function getUserFromReq(req) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return null;
    return jwt.verify(token, AUTH_SECRET);
  } catch { return null; }
}

// POST /api/demo/generate — run a scan, save to Supabase if logged in
router.post('/generate', async (req, res) => {
  try {
    const { venue, event, venueName, venueAddress, placeDetails, venue_id } = req.body;
    const name = venueName || venue;
    if (!name) return res.status(400).json({ error: 'Venue name required' });

    const city = placeDetails?.formatted_address?.split(',')[1]?.trim()
      || venueAddress?.split(',')[0]?.trim() || '';
    const eventLabel = event || 'upcoming event';

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `You are Fillo AI. Generate venue content as JSON only, no markdown:
{
  "banner": "<punchy hero headline, max 12 words, urgency>",
  "social": "<Instagram caption, 2-3 sentences, emojis, 3 hashtags, FOMO>",
  "homepage": "<event blurb, 2 sentences, drives ticket clicks>",
  "fomoScore": <number 60-95>,
  "insight": "<one sentence on why this content will perform right now>",
  "trends": [
    {"label": "<trend name>", "score": <50-99>, "source": "<X|TikTok|Reddit|Google>", "signal": "<why this matters>"},
    {"label": "<trend name>", "score": <50-99>, "source": "<X|TikTok|Reddit|Google>", "signal": "<why this matters>"},
    {"label": "<trend name>", "score": <50-99>, "source": "<X|TikTok|Reddit|Google>", "signal": "<why this matters>"}
  ]
}
VENUE: ${name}
CITY: ${city || 'Unknown'}
EVENT: ${eventLabel}`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = JSON.parse(message.content[0].text.trim().replace(/```json|```/g, '').trim());

    // Save scan to Supabase if user is logged in
    const user = getUserFromReq(req);
    let scanId = null;

    if (user?.userId) {
      try {
        const supabase = getSupabase();

        // Save the scan
        const { data: scan } = await supabase.from('scans').insert({
          user_id: user.userId,
          venue_id: venue_id || null,
          fomo_score: content.fomoScore || 0,
          trends: JSON.stringify(content.trends || []),
          insight: content.insight || '',
          created_at: new Date().toISOString()
        }).select().single();

        scanId = scan?.id;

        // Save each draft
        const draftItems = [
          { type: 'banner',   title: '🏆 Banner Copy',      content: content.banner },
          { type: 'social',   title: '📱 Social Caption',   content: content.social },
          { type: 'homepage', title: '🌐 Homepage Blurb',   content: content.homepage },
        ];

        for (const d of draftItems) {
          await supabase.from('drafts').insert({
            user_id: user.userId,
            venue_id: venue_id || null,
            scan_id: scanId,
            type: d.type,
            title: d.title,
            content: d.content,
            source: content.insight || '',
            status: 'pending',
            created_at: new Date().toISOString()
          });
        }

        // Save audit entry
        await supabase.from('audit_trail').insert({
          user_id: user.userId,
          action: 'Fillo Scan Complete',
          description: `FOMO Score: ${content.fomoScore} — ${content.insight}`,
          platform: 'Fillo AI',
          pilot_mode: 'auto-draft',
          created_at: new Date().toISOString()
        });

      } catch (saveErr) {
        console.error('Scan save error (non-blocking):', saveErr.message);
      }
    }

    res.json({ success: true, content, scanId });
  } catch (err) {
    console.error('Demo error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/test', (req, res) => res.json({ success: true, message: 'Demo route live' }));

module.exports = router;