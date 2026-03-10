const axios = require('axios');

async function generateContent(venue, event, trends, redditSignals) {
  try {
    const trendSummary = trends.slice(0, 3).map(t => t.title).join(', ');
    const redditSummary = redditSignals.slice(0, 3).map(r => r.title).join(', ');

    const prompt = `You are Fillo, an AI venue content agent.

Venue: ${venue}
Event: ${event}
Trending on Google right now: ${trendSummary}
People on Reddit are saying: ${redditSummary}

Generate content in JSON only (no markdown):
{
  "bannerHeadline": "Bold hero banner, max 8 words, all caps, FOMO-driven",
  "bannerWhy": "One sentence why this headline drives ticket sales",
  "ticketCopy": "Urgent ticket message, max 20 words, use scarcity",
  "ticketWhy": "One sentence why scarcity language converts here",
  "socialCaption": "Instagram/X caption under 200 chars with hashtags and emojis",
  "socialWhy": "One sentence why this caption performs at peak trend moments",
  "homepageBlurb": "2 sentences using social proof to drive ticket clicks",
  "homepageWhy": "One sentence why social proof increases click-through"
}`;

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );

    const raw = response.data.content
      .map(i => i.text || '')
      .join('');

    return JSON.parse(raw.replace(/```json|```/g, '').trim());

  } catch(err) {
    console.error('Claude error:', err.message);
    return null;
  }
}

module.exports = { generateContent };