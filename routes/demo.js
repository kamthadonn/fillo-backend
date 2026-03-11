const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/demo/generate
router.post('/generate', async (req, res) => {
  try {
    const { venueName, venueAddress, placeId } = req.body;
    if (!venueName) return res.status(400).json({ error: 'Venue name required' });

    console.log(`🎯 Generating demo for: ${venueName} — ${venueAddress}`);

    const prompt = `You are Fillo, an AI venue intelligence platform. A potential customer wants to see a demo dashboard for their venue.

Venue: "${venueName}"
Address: "${venueAddress || 'Unknown location'}"

Generate a realistic, intelligent demo dashboard for this specific venue. Use real knowledge about this type of venue and location.

Respond ONLY with valid JSON (no markdown, no backticks) in this exact format:
{
  "venueName": "${venueName}",
  "venueType": "nightclub/bar/restaurant/lounge/etc",
  "city": "city name",
  "fomoScore": 72,
  "insight": "2-3 sentence insight about this venue's specific market, what trends apply to them, and what Fillo would do for them. Be specific to their location and venue type.",
  "trends": [
    { "topic": "trend name relevant to this venue", "source": "Google Trends", "signal": "search volume description", "hot": true },
    { "topic": "another relevant trend", "source": "Reddit", "signal": "engagement level", "hot": false },
    { "topic": "another relevant trend", "source": "TikTok", "signal": "viral signal", "hot": true },
    { "topic": "another relevant trend", "source": "Google Trends", "signal": "rising searches", "hot": false }
  ],
  "fomoSignals": [
    { "score": 88, "topic": "specific trend for this venue", "source": "TikTok", "detail": "specific detail about why this is trending", "action": "Suggested content action Fillo would take" },
    { "score": 74, "topic": "another signal", "source": "Reddit", "detail": "detail", "action": "action" },
    { "score": 61, "topic": "another signal", "source": "Google Trends", "detail": "detail", "action": "action" }
  ],
  "drafts": [
    { "platform": "Instagram Caption", "content": "A realistic, engaging Instagram caption for this specific venue. Reference their city, vibe, and venue type. Include relevant hashtags." },
    { "platform": "Website Event Post", "content": "A short event or promotion post for their website. Specific to their venue and what events they likely host." },
    { "platform": "Google Business Update", "content": "A short Google Business post update relevant to this venue type and location." }
  ],
  "auditTrail": [
    { "action": "Venue profile analyzed", "detail": "Fillo scanned ${venueName} — identified venue type, market, and competitor landscape", "time": "Just now", "color": "#C8963E" },
    { "action": "Trend scan completed", "detail": "Detected 4 relevant trends for ${venueName}'s market", "time": "Just now", "color": "#1D6A48" },
    { "action": "3 content drafts generated", "detail": "Instagram, website post, and Google Business update created", "time": "Just now", "color": "#2563EB" },
    { "action": "FOMO score calculated", "detail": "Current buying window signal analyzed for your market", "time": "Just now", "color": "#C0392B" }
  ]
}`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = message.content[0].text.trim();
    const clean = rawText.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);

    console.log(`✅ Demo generated for ${venueName}`);
    res.json(data);

  } catch (err) {
    console.error('Demo generate error:', err.message);
    // Fallback demo data
    res.json({
      venueName: req.body.venueName,
      fomoScore: 74,
      insight: `Fillo has analyzed ${req.body.venueName} and identified strong opportunities in your local market. Based on your venue type and location, there are multiple trending topics your content engine can capitalize on right now.`,
      trends: [
        { topic: 'Weekend nightlife surge', source: 'Google Trends', signal: 'High search volume', hot: true },
        { topic: 'Cocktail culture rising', source: 'TikTok', signal: 'Viral content spike', hot: true },
        { topic: 'Local events buzz', source: 'Reddit', signal: 'Community engagement', hot: false },
        { topic: 'Happy hour deals', source: 'Google Trends', signal: 'Rising searches', hot: false },
      ],
      fomoSignals: [
        { score: 89, topic: 'Weekend surge incoming', source: 'Google Trends', detail: 'Searches for nightlife in your area up 43% this week', action: 'Publish weekend promo content now to capture intent' },
        { score: 71, topic: 'Cocktail content trending', source: 'TikTok', detail: '#cocktails hitting 2M views today', action: 'Create behind-the-bar content this week' },
        { score: 58, topic: 'Local event discovery', source: 'Reddit', detail: 'Users asking for event recs in your area', action: 'Post upcoming events to Google Business and website' },
      ],
      drafts: [
        { platform: 'Instagram Caption', content: `The night is yours. 🥂 Whether you're here for the vibes, the music, or the best drinks in the city — we've got you covered every weekend. Tag a friend you're bringing out this Friday. #Nightlife #WeekendVibes #GoodTimes` },
        { platform: 'Website Event Post', content: `This Weekend at ${req.body.venueName}: Don't miss our signature Saturday night experience. Doors open at 9PM, featuring our resident DJ, craft cocktail menu, and VIP bottle service. Limited tables available — reserve yours now.` },
        { platform: 'Google Business Update', content: `Now open for weekend reservations. Experience the best nightlife in the city with craft cocktails, live entertainment, and an unforgettable atmosphere. Book your table online.` },
      ],
      auditTrail: [
        { action: 'Venue profile analyzed', detail: `Scanned ${req.body.venueName} — identified market position and opportunities`, time: 'Just now', color: '#C8963E' },
        { action: 'Trend scan completed', detail: '4 relevant trends detected for your market', time: 'Just now', color: '#1D6A48' },
        { action: '3 content drafts generated', detail: 'Instagram, website post, and Google Business update ready', time: 'Just now', color: '#2563EB' },
        { action: 'FOMO score calculated', detail: 'Buying window signal: High (74/100)', time: 'Just now', color: '#C0392B' },
      ],
    });
  }
});

module.exports = router;