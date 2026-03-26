// services/capcut.js
// CapCut SeedAnce 2.0 integration service
// Generates video timelines, SeedAnce AI prompts, scripts, captions
// All output is structured to map 1:1 with CapCut's timeline editor
// Enterprise only — never saves user content externally

const Anthropic = require('@anthropic-ai/sdk');

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// SeedAnce 2.0 free features we can leverage
const SEEDANCE_FREE_FEATURES = [
  'Text-to-video generation',
  'Image-to-video animation',
  'Motion style transfer',
  'AI background generation',
  'Auto-caption sync',
  'Beat sync editing',
  'Smart scene detection',
  'AI color grading',
];

// Video format specs for CapCut timeline
const FORMAT_SPECS = {
  reels:    { width: 1080, height: 1920, fps: 30, duration: 15, label: 'Instagram Reels / TikTok' },
  shorts:   { width: 1080, height: 1920, fps: 30, duration: 30, label: 'YouTube Shorts' },
  story:    { width: 1080, height: 1920, fps: 30, duration: 15, label: 'Story (IG/FB)' },
  landscape:{ width: 1920, height: 1080, fps: 30, duration: 60, label: 'Landscape / YouTube' },
  square:   { width: 1080, height: 1080, fps: 30, duration: 30, label: 'Square Feed Post' },
};

async function generateVideoPackage({
  venueName, city, fomoScore, trends, insight, videoType, format, plan, userId
}) {
  const formatSpec   = FORMAT_SPECS[format] || FORMAT_SPECS.reels;
  const isHighScore  = (fomoScore || 70) >= 80;
  const topTrend     = (trends || [])[0]?.topic || '';
  const topSignal    = (trends || [])[0]?.signal || '';
  const bizType      = videoType === 'product' ? 'goods' : 'venue';

  const typeDescriptions = {
    urgency:  'urgent ticket/sales push — drive immediate action, scarcity messaging',
    hype:     'event hype and anticipation building — excitement, countdown energy',
    recap:    'post-event recap — celebrate highlights, drive future ticket sales',
    trend:    'trend-riding content — tap into a live cultural moment',
    product:  'product drop/promotion — showcase items, drive purchase urgency',
    behindscenes: 'behind the scenes — authentic, raw footage energy',
  };
  const typeDesc = typeDescriptions[videoType] || 'promotional venue content';

  const prompt = `You are a professional video content director and CapCut expert creating a complete video production package for ${venueName}${city ? ' in ' + city : ''}.

CONTEXT:
- FOMO Score: ${fomoScore}/100 (${isHighScore ? 'HIGH — peak buying window' : 'MODERATE — building momentum'})
- Video type: ${typeDesc}
- Format: ${formatSpec.label} (${formatSpec.width}x${formatSpec.height}, ${formatSpec.duration}s max)
- Top trending signal: ${topTrend || 'weekend local demand'}
- Market insight: ${insight || venueName + ' is showing strong demand signals'}

Generate a complete CapCut video production package. Respond ONLY in valid JSON, no markdown:
{
  "seedancePrompt": {
    "main": "<Primary SeedAnce 2.0 text-to-video prompt — 4-6 sentences. Describe the EXACT visual style, camera movement, lighting, energy level, color palette, and atmosphere. Be cinematic and specific to ${venueName}. Include motion instructions like 'slow pan', 'quick cuts', 'zoom in on crowd'. This is what gets pasted into SeedAnce 2.0.>",
    "style": "<Visual style descriptor — e.g. 'cinematic 4K, golden hour lighting, shallow depth of field'>",
    "mood": "<Energy mood — e.g. 'electric and urgent' or 'euphoric and celebratory'>",
    "negativePrompt": "<Things to avoid — e.g. 'blurry, static camera, empty venue, low energy'>"
  },
  "timeline": [
    {
      "clip": 1,
      "startTime": 0,
      "endTime": 3,
      "label": "<short clip label>",
      "description": "<what should be on screen — be specific>",
      "shootingInstructions": "<how to film this clip if shooting real footage>",
      "aiGenInstruction": "<if using SeedAnce, what to prompt for this specific clip>",
      "textOverlay": { "text": "<bold on-screen text>", "position": "center|bottom|top", "style": "bold|caption|title" },
      "transition": "<cut|dissolve|zoom|slide — transition INTO this clip>"
    },
    {
      "clip": 2,
      "startTime": 3,
      "endTime": 8,
      "label": "<short clip label>",
      "description": "<what should be on screen>",
      "shootingInstructions": "<filming guide>",
      "aiGenInstruction": "<SeedAnce prompt for this clip>",
      "textOverlay": { "text": "<on-screen text>", "position": "center|bottom|top", "style": "bold|caption|title" },
      "transition": "cut"
    },
    {
      "clip": 3,
      "startTime": 8,
      "endTime": 16,
      "label": "<short clip label>",
      "description": "<what should be on screen>",
      "shootingInstructions": "<filming guide>",
      "aiGenInstruction": "<SeedAnce prompt for this clip>",
      "textOverlay": { "text": "<on-screen text>", "position": "bottom", "style": "caption" },
      "transition": "dissolve"
    },
    {
      "clip": 4,
      "startTime": 16,
      "endTime": ${formatSpec.duration},
      "label": "CTA Close",
      "description": "${venueName} branding, logo or venue shot — strong close",
      "shootingInstructions": "Clean venue logo or exterior — steady shot",
      "aiGenInstruction": "Cinematic fade-out on ${venueName} branding, professional close",
      "textOverlay": { "text": "Get Tickets · Link in Bio", "position": "bottom", "style": "bold" },
      "transition": "fade"
    }
  ],
  "musicDirection": {
    "mood": "<describe the beat/energy — e.g. 'trap hi-hats, building energy, 120bpm'>",
    "capcutSearchTerms": "<3-4 search terms to find the right track in CapCut's music library>",
    "beatSyncPoints": [3, 8, 16]
  },
  "textOverlaySequence": [
    { "time": 0, "text": "<opening text>", "duration": 2, "animation": "fade-in" },
    { "time": 3, "text": "<middle text>", "duration": 3, "animation": "slide-up" },
    { "time": 8, "text": "<urgency text>", "duration": 4, "animation": "pop" },
    { "time": 16, "text": "<CTA text>", "duration": 4, "animation": "fade-in" }
  ],
  "caption": "<2-3 sentence social caption, specific to ${venueName} and ${city}, current trend hook, urgency, ends with CTA>",
  "hashtags": "<12-14 relevant hashtags no # prefix, space-separated, mix of venue-specific and trending>",
  "editingTips": [
    "<Tip 1 — specific to this video type in CapCut>",
    "<Tip 2 — how to use SeedAnce 2.0 for best results>",
    "<Tip 3 — color grading or filter recommendation>"
  ]
}`;

  const client = getClient();
  const message = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages:   [{ role: 'user', content: prompt }],
  });

  const raw    = message.content[0].text.trim().replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(raw);

  return {
    success:       true,
    venueName,
    city,
    fomoScore,
    videoType,
    format:        formatSpec,
    seedance:      parsed.seedancePrompt,
    timeline:      parsed.timeline || [],
    music:         parsed.musicDirection || {},
    textOverlays:  parsed.textOverlaySequence || [],
    caption:       parsed.caption || '',
    hashtags:      parsed.hashtags || '',
    editingTips:   parsed.editingTips || [],
    capcutDeepLink: buildCapCutDeepLink(parsed),
    seedanceFreeFeatures: SEEDANCE_FREE_FEATURES,
  };
}

// Build a CapCut-compatible deep link with context pre-loaded
function buildCapCutDeepLink(data) {
  return {
    web:    'https://www.capcut.com/create',
    mobile: 'capcut://create',
    note:   'Open CapCut, navigate to AI Video → SeedAnce 2.0, and paste your generated prompt',
  };
}

// Quick fallback if Claude is unavailable
function buildFallback({ venueName, city, fomoScore, videoType, format }) {
  const spec = FORMAT_SPECS[format] || FORMAT_SPECS.reels;
  return {
    success:    true,
    venueName,
    city,
    fomoScore,
    videoType,
    format:     spec,
    seedance: {
      main:           `Dynamic ${videoType} video for ${venueName}${city ? ' in ' + city : ''}. High energy venue atmosphere with crowd footage and dramatic lighting. ${fomoScore >= 80 ? 'Fast-paced cuts synced to beat, electric atmosphere, peak energy.' : 'Smooth transitions, warm inviting atmosphere, building energy.'} Camera work includes wide establishing shot, close-up crowd reaction, and venue branding close. Professional broadcast quality.`,
      style:          'Cinematic 4K, dynamic lighting, shallow depth of field',
      mood:           fomoScore >= 80 ? 'Electric and urgent' : 'Vibrant and inviting',
      negativePrompt: 'blurry, static, empty, low energy, poor lighting',
    },
    timeline: [
      { clip:1, startTime:0,  endTime:3,       label:'Hook',     description:`${venueName} logo or exterior reveal`,            textOverlay:{ text:venueName.toUpperCase(), position:'center', style:'title'   }, transition:'fade'    },
      { clip:2, startTime:3,  endTime:10,      label:'Energy',   description:'Crowd energy and venue atmosphere',               textOverlay:{ text:'The Energy Is Different Here', position:'center', style:'bold'    }, transition:'cut'     },
      { clip:3, startTime:10, endTime:18,      label:'Urgency',  description:'Key moment — tickets, product, or event reveal',  textOverlay:{ text:"Don't Miss This", position:'bottom', style:'caption' }, transition:'dissolve' },
      { clip:4, startTime:18, endTime:spec.duration, label:'CTA', description:`${venueName} branding close`,                   textOverlay:{ text:'Get Tickets · Link in Bio', position:'bottom', style:'bold'    }, transition:'fade'    },
    ],
    music:        { mood:'High energy, beat-driven', capcutSearchTerms:'energy hype venue nightlife', beatSyncPoints:[3,10,18] },
    textOverlays: [
      { time:0,  text:venueName.toUpperCase(),       duration:2, animation:'fade-in'  },
      { time:3,  text:'The Energy Is Different Here', duration:4, animation:'slide-up' },
      { time:10, text:"Don't Miss This",              duration:4, animation:'pop'      },
      { time:18, text:'Link in Bio 🔥',               duration:4, animation:'fade-in'  },
    ],
    caption:      `${city ? city + ' — ' : ''}${venueName} is the place to be right now. The energy in here is on a different level. Come see it for yourself — link in bio 🔥`,
    hashtags:     `${venueName.replace(/\s+/g,'')} ${city.replace(/\s/g,'')}Events LiveNow NightOut WeekendVibes LocalEvents Entertainment HTX`,
    editingTips:  [
      'Use CapCut\'s Beat Sync to align your cuts to the music automatically',
      'In SeedAnce 2.0, add "4K cinematic" and "drone shot" to your prompt for premium results',
      'Apply the "Moody" or "Neon" preset filter pack for venue content — both are free in CapCut',
    ],
    capcutDeepLink: buildCapCutDeepLink({}),
    seedanceFreeFeatures: SEEDANCE_FREE_FEATURES,
  };
}

module.exports = { generateVideoPackage, buildFallback, FORMAT_SPECS, SEEDANCE_FREE_FEATURES };