const express = require('express');
const router = express.Router();
const { saveVenue, getVenue, getAllVenues } = require('../services/venuelearning');

// Step 1 — Venue submits their profile (onboarding form)
router.post('/setup', (req, res) => {
  try {
    const {
      name,
      city,
      state,
      type,
      genres,
      capacity,
      targetAudience,
      competitors,
      customKeywords,
      socialHandles
    } = req.body;

    if (!name || !city || !type) {
      return res.status(400).json({
        success: false,
        error: 'name, city, and type are required'
      });
    }

    const venue = saveVenue({
      name,
      city,
      state,
      type,
      genres: genres || [],
      capacity: capacity || null,
      targetAudience: targetAudience || '',
      competitors: competitors || [],
      customKeywords: customKeywords || [],
      socialHandles: socialHandles || {}
    });

    res.json({
      success: true,
      message: `Welcome to Fillo, ${name}! Your profile is set up.`,
      venue
    });

  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Step 2 — Get a venue profile by ID
router.get('/:id', (req, res) => {
  try {
    const venue = getVenue(req.params.id);
    if (!venue) {
      return res.status(404).json({ success: false, error: 'Venue not found' });
    }
    res.json({ success: true, venue });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Step 3 — Get all venues
router.get('/', (req, res) => {
  try {
    const venues = getAllVenues();
    res.json({ success: true, venues });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;