const express = require('express');
const router = express.Router();
const axios = require('axios');

// GET /api/places/autocomplete?q=venue+name
router.get('/autocomplete', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Query required' });

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey) {
      // Fallback: return mock predictions if no API key yet
      return res.json({
        predictions: [
          { description: query, structured_formatting: { main_text: query, secondary_text: 'Your City, USA' }, place_id: 'mock_1' },
        ]
      });
    }

    const response = await axios.get('https://maps.googleapis.com/maps/api/place/autocomplete/json', {
      params: {
        input: query,
        types: 'establishment',
        key: apiKey,
      }
    });

    res.json(response.data);
  } catch (err) {
    console.error('Places autocomplete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;