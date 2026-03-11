const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

router.post('/setup', async (req, res) => {
  try {
    const data = req.body;
    if (!data.name) return res.status(400).json({ error: 'Venue name is required' });
    const supabase = getSupabase();
    const { data: venue, error } = await supabase.from('venues').insert([{
      name: data.name,
      city: data.city || '',
      state: data.state || '',
      type: data.type || 'venue',
      capacity: data.capacity ? parseInt(data.capacity) : null,
      genres: data.genres || [],
      event_types: data.eventTypes || [],
      busiest_nights: data.busiestNights || [],
      competitors: data.competitors || [],
      custom_keywords: data.customKeywords || [],
      pilot_mode: data.pilotMode || 'auto-draft',
      alert_email: data.alertEmail || '',
      instagram: data.socialHandles?.instagram || '',
      tiktok: data.socialHandles?.tiktok || '',
    }]).select().single();
    if (error) throw error;
    console.log(`✅ New venue: ${venue.name} (${venue.id})`);
    res.json({
      success: true,
      message: `${venue.name} is live on Fillo!`,
      venueId: venue.id,
      venue: {
        ...venue,
        keywords: [
          data.city ? `${data.city} nightlife` : '',
          data.city ? `${data.city} events` : '',
          ...(data.genres || []).slice(0, 3),
          ...(data.customKeywords || []).slice(0, 3),
        ].filter(Boolean),
      },
    });
  } catch (err) {
    console.error('Onboarding error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: venue, error } = await supabase.from('venues').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(venue);
  } catch (err) {
    res.status(404).json({ error: 'Venue not found' });
  }
});

router.get('/', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: venues, error } = await supabase.from('venues').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(venues);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;