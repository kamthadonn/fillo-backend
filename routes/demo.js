const express = require('express');
const router = express.Router();
const { runFullScan } = require('../services/intelligence');

// POST /api/demo/generate
router.post('/generate', async (req, res) => {
  try {
    const { venueName, venueAddress, placeDetails } = req.body;
    if (!venueName) return res.status(400).json({ error: 'Venue name required' });

    const city = placeDetails?.formatted_address?.split(',')[1]?.trim()
      || venueAddress?.split(',')[0]?.trim()
      || '';

    const venueType = placeDetails?.types?.[0]?.replace(/_/g, ' ') || 'venue';
    const keywords = [venueName, city ? `${city} nightlife` : 'nightlife', city ? `${city} events` : 'events'];

    console.log(`🎯 Demo scan: ${venueName} | ${city} | ${venueType}`);

    const result = await runFullScan({ venueName, venueType, city, keywords, placeDetails });
    res.json(result);

  } catch (err) {
    console.error('Demo generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/demo/test
router.get('/test', async (req, res) => {
  try {
    const { runFullScan } = require('../services/intelligence');
    const result = await runFullScan({
      venueName: 'Sekai Night Club',
      venueType: 'nightclub',
      city: 'Houston',
      keywords: ['Houston nightlife', 'Houston EDM', 'bottle service Houston'],
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;