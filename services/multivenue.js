const { createClient } = require('@supabase/supabase-js');
 
function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}
 
const PLAN_LIMITS = {
  starter:    1,
  pro:        3,
  enterprise: Infinity,
  voucher:    3,
  cancelled:  0,
};
 
// ── GET all venues for a user ─────────────────────────────────────────
async function getVenues(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
 
  if (error) throw new Error(error.message);
  return data || [];
}
 
// ── GET the active venue for a user ──────────────────────────────────
async function getActiveVenue(userId) {
  const supabase = getSupabase();
 
  // Try is_active = true first
  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
 
  if (error) throw new Error(error.message);
 
  // If no active venue, return the most recently created one
  if (!data) {
    const { data: fallback } = await supabase
      .from('venues')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return fallback || null;
  }
 
  return data;
}
 
// ── SWITCH active venue ───────────────────────────────────────────────
async function switchVenue(userId, venueId) {
  const supabase = getSupabase();
 
  // Deactivate all venues for user
  await supabase
    .from('venues')
    .update({ is_active: false })
    .eq('user_id', userId);
 
  // Activate the selected one
  const { error } = await supabase
    .from('venues')
    .update({ is_active: true })
    .eq('id', venueId)
    .eq('user_id', userId); // Security: must own the venue
 
  if (error) throw new Error(error.message);
  return true;
}
 
// ── ADD a new venue (enforces plan limits) ────────────────────────────
async function addVenue(userId, plan, venueData) {
  const supabase = getSupabase();
 
  const limit = PLAN_LIMITS[plan] || 1;
 
  // Count existing venues
  const { count } = await supabase
    .from('venues')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
 
  if (count >= limit) {
    const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
    return {
      success: false,
      error: `Your ${planLabel} plan allows up to ${limit === Infinity ? 'unlimited' : limit} venue${limit === 1 ? '' : 's'}. Upgrade to add more.`,
      limitReached: true,
      currentCount: count,
      limit,
    };
  }
 
  // Deactivate current active venue
  await supabase
    .from('venues')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('is_active', true);
 
  // Insert new venue
  const { data: venue, error } = await supabase
    .from('venues')
    .insert([{
      user_id:         userId,
      name:            venueData.name || 'New Venue',
      city:            venueData.city || '',
      state:           venueData.state || '',
      type:            venueData.type || 'venue',
      capacity:        venueData.capacity ? parseInt(venueData.capacity) : null,
      genres:          venueData.genres || [],
      event_types:     venueData.eventTypes || [],
      busiest_nights:  venueData.busiestNights || [],
      competitors:     venueData.competitors || [],
      custom_keywords: venueData.customKeywords || [],
      pilot_mode:      venueData.pilotMode || 'suggest',
      alert_email:     venueData.alertEmail || '',
      site_url:        venueData.siteUrl || '',
      instagram:       venueData.socialHandles?.instagram || '',
      tiktok:          venueData.socialHandles?.tiktok || '',
      twitter:         venueData.socialHandles?.twitter || '',
      facebook:        venueData.socialHandles?.facebook || '',
      is_active:       true,
    }])
    .select()
    .single();
 
  if (error) throw new Error(error.message);
 
  console.log(`✅ Added venue "${venue.name}" for user ${userId} (${count + 1}/${limit === Infinity ? '∞' : limit})`);
 
  return {
    success: true,
    venue,
    currentCount: count + 1,
    limit,
  };
}
 
// ── DELETE a venue ────────────────────────────────────────────────────
async function deleteVenue(userId, venueId) {
  const supabase = getSupabase();
 
  const { error } = await supabase
    .from('venues')
    .delete()
    .eq('id', venueId)
    .eq('user_id', userId); // Security: must own it
 
  if (error) throw new Error(error.message);
 
  // If they deleted the active venue, activate the most recent remaining one
  const { data: remaining } = await supabase
    .from('venues')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
 
  if (remaining) {
    await supabase
      .from('venues')
      .update({ is_active: true })
      .eq('id', remaining.id);
  }
 
  return true;
}
 
module.exports = { getVenues, getActiveVenue, switchVenue, addVenue, deleteVenue };