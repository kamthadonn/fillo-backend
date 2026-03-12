const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post('/generate', async (req, res) => {
  try {
    const { venue, event, venueName, venueAddress, placeDetails } = req.body;
    const name = venueName || venue;
    if (!name) return res.status(400).json({ error: 'Venue name required' });

    const city = placeDetails?.formatted_address?.split(',')[1]?.trim()
      || venueAddress?.split(',')[0]?.trim() || '';
    const eventLabel = event || 'upcoming event';

    const prompt = `You are Fillo AI. Generate venue content as JSON only, no markdown:
{
  "banner": "<punchy hero headline, max 12 words>",
  "social": "<Instagram caption, 2-3 sentences, emojis, 3 hashtags>",
  "homepage": "<event blurb, 2 sentences, drives ticket clicks>",
  "fomoScore": <number 60-95>,
  "insight": "<one sentence on why this content will perform>"
}
VENUE: ${name}
CITY: ${city || 'Unknown'}
EVENT: ${eventLabel}`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim().replace(/```json|```/g, '').trim();
    const content = JSON.parse(raw);
    res.json({ success: true, content });
  } catch (err) {
    console.error('Demo error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/test', (req, res) => res.json({ success: true }));

module.exports = router;
