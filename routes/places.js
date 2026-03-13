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
      return res.json({
        predictions: [
          { description: query, structured_formatting: { main_text: query, secondary_text: 'Your City, USA' }, place_id: 'mock_1' },
        ]
      });
    }

    const response = await axios.get('https://maps.googleapis.com/maps/api/place/autocomplete/json', {
      params: { input: query, types: 'establishment', key: apiKey }
    });

    res.json(response.data);
  } catch (err) {
    console.error('Places autocomplete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/places/details?place_id=xxx
router.get('/details', async (req, res) => {
  try {
    const { place_id } = req.query;
    if (!place_id) return res.status(400).json({ error: 'place_id required' });

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return res.json({ result: null });

    const response = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
      params: {
        place_id,
        fields: 'name,formatted_address,types,rating,user_ratings_total,price_level,opening_hours,website,formatted_phone_number,editorial_summary,reviews',
        key: apiKey
      }
    });

    res.json(response.data);
  } catch (err) {
    console.error('Places details error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;