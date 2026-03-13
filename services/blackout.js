const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Check if current time is in a blackout window
// windows: [{ day: 0-6 (0=Sun), startHour: 0-23, endHour: 0-23, label: 'string' }]
function isBlackout(windows = []) {
  if (!windows?.length) return false;
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();

  for (const w of windows) {
    if (w.day !== undefined && w.day !== day) continue;
    if (hour >= w.startHour && hour < w.endHour) {
      return { blocked: true, reason: w.label || `Blackout window: ${w.startHour}:00 - ${w.endHour}:00` };
    }
  }
  return false;
}

// Get blackout windows for a venue
async function getBlackouts(venueId) {
  try {
    const { data } = await supabase
      .from('venues')
      .select('blackout_windows')
      .eq('id', venueId)
      .single();
    return data?.blackout_windows || [];
  } catch {
    return [];
  }
}

// Save blackout windows
async function saveBlackouts(venueId, windows) {
  const { error } = await supabase
    .from('venues')
    .update({ blackout_windows: windows })
    .eq('id', venueId);
  return !error;
}

// Check if publish should be blocked
async function checkBlackout(venueId) {
  const windows = await getBlackouts(venueId);
  return isBlackout(windows);
}

module.exports = { isBlackout, getBlackouts, saveBlackouts, checkBlackout };