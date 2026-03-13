const express = require('express');
const router = express.Router();
const { scanTrends, getDailyTrends, getRelatedQueries } = require('../services/googletrends');
const { runFullScan } = require('../services/intelligence');

// GET /api/trends — daily trending topics in the US
router.get('/', async (req, res) => {
  try {
    const geo = req.query.geo || 'US';
    const daily = await getDailyTrends(geo);
    res.json({ success: true, trends: daily, geo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trends/scan?keywords=houston+nightlife,edm+houston&geo=US
router.get('/scan', async (req, res) => {
  try {
    const keywords = req.query.keywords?.split(',') || ['nightlife', 'events'];
    const geo = req.query.geo || 'US';
    const results = await scanTrends(keywords, geo);
    res.json({ success: true, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trends/related?keyword=houston+nightlife
router.get('/related', async (req, res) => {
  try {
    const keyword = req.query.keyword || 'nightlife';
    const geo = req.query.geo || 'US';
    const results = await getRelatedQueries(keyword, geo);
    res.json({ success: true, keyword, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trends/generate — full intelligence scan
router.post('/generate', async (req, res) => {
  try {
    const { venueName, venueType, city, keywords, genres, competitors, eventTypes, busiestNights, capacity, venueAddress, venueBusinessType, venueId } = req.body;
    if (!venueName) return res.status(400).json({ error: 'venueName required' });
    const allKeywords = [...(keywords || []), ...(genres || [])].filter(Boolean);
    const result = await runFullScan({ venueName, venueType, city, keywords: allKeywords, genres, competitors, eventTypes, busiestNights, capacity, venueAddress, venueBusinessType, venueId });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;