const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const DEFAULT_VOICE = {
  tone: 'energetic',
  style: 'punchy',
  emoji: true,
  capsUsage: 'moderate',
  hashtagStyle: 'selective',
  ctaStyle: 'urgent',
  avoidWords: [],
  mustInclude: [],
  signOff: '',
  customInstructions: '',
};

function buildVoicePrompt(voice = {}) {
  const v = { ...DEFAULT_VOICE, ...voice };
  const lines = [];
  lines.push(`BRAND VOICE REQUIREMENTS:`);
  lines.push(`- Tone: ${v.tone} (${getToneDesc(v.tone)})`);
  lines.push(`- Style: ${v.style} (${getStyleDesc(v.style)})`);
  lines.push(`- Emojis: ${v.emoji ? 'Yes — use them naturally' : 'No emojis'}`);
  lines.push(`- CAPS: ${v.capsUsage === 'none' ? 'No all-caps' : v.capsUsage === 'heavy' ? 'Use ALL CAPS for key hype words' : 'Moderate caps for emphasis only'}`);
  lines.push(`- Hashtags: ${v.hashtagStyle === 'none' ? 'No hashtags' : v.hashtagStyle === 'heavy' ? '5-8 hashtags' : '2-3 targeted hashtags only'}`);
  lines.push(`- CTA style: ${v.ctaStyle === 'urgent' ? 'Urgent — create FOMO, limited time feel' : v.ctaStyle === 'soft' ? 'Soft — inviting, no pressure' : 'No explicit CTA'}`);
  if (v.avoidWords?.length) lines.push(`- NEVER use these words: ${v.avoidWords.join(', ')}`);
  if (v.mustInclude?.length) lines.push(`- Always include: ${v.mustInclude.join(', ')}`);
  if (v.signOff) lines.push(`- Sign off with: "${v.signOff}"`);
  if (v.customInstructions) lines.push(`- Additional: ${v.customInstructions}`);
  return lines.join('\n');
}

function getToneDesc(tone) {
  const map = {
    energetic: 'high energy, exciting, pumped up',
    professional: 'polished, business-appropriate, credible',
    casual: 'relaxed, conversational, like a friend texting',
    luxury: 'elevated, exclusive, sophisticated — never desperate',
    hype: 'maximum hype, street culture, bold',
    friendly: 'warm, welcoming, community-focused',
  };
  return map[tone] || tone;
}

function getStyleDesc(style) {
  const map = {
    punchy: 'short sentences, high impact, no filler',
    descriptive: 'paint a picture, immersive details',
    minimal: 'less is more, clean and direct',
    storytelling: 'narrative arc, build anticipation',
  };
  return map[style] || style;
}

async function getVoice(venueId) {
  try {
    const { data } = await supabase
      .from('venues')
      .select('brand_voice')
      .eq('id', venueId)
      .single();
    return data?.brand_voice || DEFAULT_VOICE;
  } catch (err) {
    return DEFAULT_VOICE;
  }
}

async function saveVoice(venueId, voice) {
  const { error } = await supabase
    .from('venues')
    .update({ brand_voice: voice })
    .eq('id', venueId);
  return !error;
}

module.exports = { buildVoicePrompt, getVoice, saveVoice, DEFAULT_VOICE };