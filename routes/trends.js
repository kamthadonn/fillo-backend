const express = require('express');
const router = express.Router();
const { scanTrends } = require('../services/googletrends');
const { scanReddit } = require('../services/reddit');
const { generateContent } = require('../services/claude');

router.get('/', async (req, res) => {
  try {
    const keywords = req.query.keywords
      ? req.query.keywords.split(',')
      : [];

    const [trends, reddit] = await Promise.all([
      scanTrends(keywords),
      scanReddit(keywords)
    ]);

    res.json({
      success: true,
      trends,
      reddit,
      timestamp: new Date().toISOString()
    });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});router.post('/generate', async (req, res) => {
  try {
    const { venue, event, keywords } = req.body;

    if (!venue || !event) {
      return res.status(400).json({
        success: false,
        error: 'venue and event are required'
      });
    }

    const [trends, reddit] = await Promise.all([
      scanTrends(keywords || [event, venue]),
      scanReddit(keywords || [event, venue])
    ]);

    const content = await generateContent(venue, event, trends, reddit);

    res.json({
      success: true,
      venue,
      event,
      trends,
      reddit,
      content,
      timestamp: new Date().toISOString()
    });

  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;