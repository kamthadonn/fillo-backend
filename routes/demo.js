const express = require('express');
const router = express.Router();

router.post('/generate', async (req, res) => {
  try {
    const { venue, event, venueName, venueAddress, placeDetails } = req.body;
    const name = venueName || venue;
    if (!name) return res.status(400).json({ error: 'Venue name required' });
    const city = placeDetails?.formatted_address?.split(',')[1]?.trim() || venueAddress?.split(',')[0]?.trim() || '';
    const eventLabel = event || 'upcoming event';
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `Generate venue content as JSON only:\n{\n  "banner": "<headline>",\n  "social": "<caption>",\n  "homepage": "<blurb>",\n  "fomoScore": 75,\n  "insight": "<insight>"\n}\nVENUE: ${name}\nEVENT: ${eventLabel}`;
    const message = await client.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 600, messages: [{ role: 'user', content: prompt }] });
    const content = JSON.parse(message.content[0].text.trim().replace(/```json|```/g, '').trim());
    res.json({ success: true, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/test', (req, res) => res.json({ success: true }));

module.exports = router;
