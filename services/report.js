const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── GENERATE SOCIAL GUIDANCE VIA CLAUDE ─────────────────────
async function generateSocialGuidance({ venueName, venueType, city, genres, instagram, tiktok, twitter, competitors, trends, signals, fomoScore }) {
  const prompt = `You are Fillo's intelligence engine analyzing a venue's social media presence and generating a weekly personalized social media playbook.

VENUE: ${venueName} · ${venueType} · ${city}
GENRES/VIBE: ${(genres || []).join(', ')}
SOCIAL HANDLES: Instagram: ${instagram || 'not set'} · TikTok: ${tiktok || 'not set'} · X/Twitter: ${twitter || 'not set'}
COMPETITORS: ${(competitors || []).join(', ')}
FOMO SCORE THIS WEEK: ${fomoScore}
TOP TRENDS: ${(trends || []).map(t => `${t.keyword} ${t.delta}`).join(', ')}
LIVE SIGNALS: ${(signals || []).map(s => s.text || s.signal || '').filter(Boolean).slice(0,5).join(' | ')}

Generate a detailed, actionable social media intelligence report with specific, personalized tips for each platform this venue uses. Make it feel like it came from a real social media strategist who has been monitoring their accounts and the Houston market all week.

Respond ONLY in valid JSON with this exact structure:
{
  "platforms": [
    {
      "name": "Instagram",
      "handle": "${instagram || '@' + venueName.toLowerCase().replace(/\s+/g,'')}",
      "icon": "📸",
      "color": "#E1306C",
      "tips": [
        { "label": "Short title", "text": "Specific actionable tip with data or reasoning (2-3 sentences)", "action": "Short CTA" }
      ]
    }
  ],
  "expansion": [
    { "platform": "Platform name", "why": "Why this venue should be on it", "opportunity": "High ROI / Untapped / Easy Win" }
  ]
}

Include platforms: Instagram (if handle set), TikTok (if handle set), X/Twitter (if handle set), Google Business Profile (always).
Include 4-5 tips per platform, all specific to this venue, city, and current trends.
Include 2-3 expansion platform suggestions.
Base tips on the actual trend data and signals provided.`;

  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = res.content[0].text.replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (err) {
    console.error('generateSocialGuidance error:', err.message);
    return { platforms: [], expansion: [] };
  }
}

// ── GENERATE PDF BUFFER ──────────────────────────────────────
async function generatePDFBuffer(venue, scan, auditEntries, socialGuidance, periodStart, periodEnd) {
  // Use the Python script via child_process
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const dataPath = path.join(os.tmpdir(), `fillo-report-${venue.id || Date.now()}.json`);
  const outPath = path.join(os.tmpdir(), `fillo-report-${venue.id || Date.now()}.pdf`);

  const reportData = { venue, scan, auditEntries, socialGuidance, periodStart, periodEnd };
  fs.writeFileSync(dataPath, JSON.stringify(reportData));

  const pythonScript = `
import json, sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.colors import HexColor
from io import BytesIO
import datetime

GOLD=HexColor('#C8963E');DARK=HexColor('#0E0E10');TEXT3=HexColor('#71717A')
GREEN=HexColor('#6EC97F');BLUE=HexColor('#60A5FA');RED=HexColor('#FF4444')
WHITE=HexColor('#FFFFFF');LIGHT_BG=HexColor('#F9FAFB');GOLD_BG=HexColor('#FFFBF0')
GREEN_BG=HexColor('#F0FDF4');BORDER=HexColor('#E5E7EB');TEXT2=HexColor('#A1A1AA')

with open('${dataPath}') as f: d = json.load(f)
venue=d['venue']; scan=d['scan']; audit=d['auditEntries']; sg=d['socialGuidance']
p_start=d['periodStart']; p_end=d['periodEnd']

doc=SimpleDocTemplate('${outPath}',pagesize=letter,
    rightMargin=0.6*inch,leftMargin=0.6*inch,topMargin=0.6*inch,bottomMargin=0.6*inch)
s=getSampleStyleSheet()
def sty(name,**kw): return ParagraphStyle(name,**kw)
def P(txt,st): return Paragraph(txt,st)

story=[]

# Header
hdr=Table([[
  P('<font color="#C8963E"><b>FILLO</b></font>',sty('l',fontName='Helvetica-Bold',fontSize=26,textColor=GOLD)),
  P(f'<font color="#A1A1AA">Weekly Intelligence Report</font><br/><font color="#71717A" size="9">{p_start} &ndash; {p_end}</font>',
    sty('r',fontName='Helvetica',fontSize=11,textColor=TEXT2,alignment=2)),
]],colWidths=[3.5*inch,3.5*inch])
hdr.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),DARK),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
  ('TOPPADDING',(0,0),(-1,-1),14),('BOTTOMPADDING',(0,0),(-1,-1),14),
  ('LEFTPADDING',(0,0),(0,-1),18),('RIGHTPADDING',(-1,0),(-1,-1),18)]))
story+=[hdr,Spacer(1,14)]

story+=[
  P(f'<b>{venue.get("name","Venue")}</b>',sty('t',fontName='Helvetica-Bold',fontSize=20,textColor=DARK,spaceAfter=4)),
  P(f'{venue.get("city","")}, {venue.get("state","")} &nbsp;&middot;&nbsp; {venue.get("type","Venue")} &nbsp;&middot;&nbsp; Enterprise',
    sty('ts',fontName='Helvetica',fontSize=11,textColor=TEXT3,spaceAfter=14)),
  HRFlowable(width='100%',thickness=1,color=BORDER,spaceAfter=14),
]

fomo=scan.get('fomoScore',0)
fc='#FF4444' if fomo>=80 else '#C8963E' if fomo>=60 else '#6EC97F'
fl='CRITICAL' if fomo>=80 else 'HIGH' if fomo>=60 else 'MODERATE'

kpi=Table([[
  P(f'<font color="#71717A" size="8"><b>FOMO SCORE</b></font><br/><font color="{fc}" size="32"><b>{fomo}</b></font><br/><font color="{fc}" size="9"><b>{fl}</b></font>',sty('k1',fontName='Helvetica',fontSize=10,leading=20)),
  P(f'<font color="#71717A" size="8"><b>SIGNALS</b></font><br/><font color="#C8963E" size="28"><b>{scan.get("signalCount",0)}</b></font><br/><font color="#A1A1AA" size="9">5 sources</font>',sty('k2',fontName='Helvetica',fontSize=10,leading=20)),
  P(f'<font color="#71717A" size="8"><b>PUBLISHED</b></font><br/><font color="#6EC97F" size="28"><b>{scan.get("published",0)}</b></font><br/><font color="#A1A1AA" size="9">This week</font>',sty('k3',fontName='Helvetica',fontSize=10,leading=20)),
  P(f'<font color="#71717A" size="8"><b>TOP TREND</b></font><br/><font color="#C8963E" size="11"><b>{scan.get("topTrend","")}</b></font><br/><font color="#A1A1AA" size="9">{scan.get("topTrendDelta","")}</font>',sty('k4',fontName='Helvetica',fontSize=10,leading=20)),
]],colWidths=[1.75*inch]*4)
kpi.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),LIGHT_BG),('BOX',(0,0),(-1,-1),1,BORDER),
  ('INNERGRID',(0,0),(-1,-1),0.5,BORDER),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
  ('TOPPADDING',(0,0),(-1,-1),14),('BOTTOMPADDING',(0,0),(-1,-1),14),('LEFTPADDING',(0,0),(-1,-1),14)]))
story+=[kpi,Spacer(1,20)]

# Trends
story.append(P('Trending This Week',sty('sh',fontName='Helvetica-Bold',fontSize=13,textColor=DARK,spaceAfter=8)))
trends=scan.get('trends',[])
if trends:
  rows=[['Keyword','Change','Signal']]
  for t in trends[:6]: rows.append([t.get('keyword',''),t.get('delta',''),t.get('status','')])
  tt=Table(rows,colWidths=[3.6*inch,1.4*inch,2*inch])
  tt.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),DARK),('TEXTCOLOR',(0,0),(-1,0),WHITE),
    ('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,0),9),('FONTSIZE',(0,1),(-1,-1),10),
    ('ROWBACKGROUNDS',(0,1),(-1,-1),[WHITE,LIGHT_BG]),('GRID',(0,0),(-1,-1),0.5,BORDER),
    ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LEFTPADDING',(0,0),(-1,-1),10)]))
  story.append(tt)
story.append(Spacer(1,18))

# Opportunity
opp=scan.get('topOpportunity','')
if opp:
  story.append(P('Top Opportunity',sty('sh2',fontName='Helvetica-Bold',fontSize=13,textColor=DARK,spaceAfter=8)))
  ot=Table([[P(opp,sty('op',fontName='Helvetica',fontSize=10,textColor=DARK,leading=16))]],colWidths=[7*inch])
  ot.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),GOLD_BG),('BOX',(0,0),(-1,-1),1.5,GOLD),
    ('TOPPADDING',(0,0),(-1,-1),12),('BOTTOMPADDING',(0,0),(-1,-1),12),
    ('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14)]))
  story+=[ot,Spacer(1,18)]

# Social guidance
story.append(P('Social Media Intelligence & Recommendations',sty('sh3',fontName='Helvetica-Bold',fontSize=13,textColor=DARK,spaceAfter=6)))
story.append(P('Personalized guidance based on your social handles, live trend data, and competitor analysis.',
  sty('si',fontName='Helvetica',fontSize=10,textColor=TEXT3,spaceAfter=12,leading=15)))

for platform in sg.get('platforms',[]):
  color=HexColor(platform.get('color','#C8963E'))
  ph=Table([[
    P(f'<font color="white"><b>{platform.get("icon","")}  {platform.get("name","")}</b></font>',sty('ph',fontName='Helvetica-Bold',fontSize=11,textColor=WHITE)),
    P(f'<font color="white">{platform.get("handle","")}</font>',sty('ph2',fontName='Helvetica',fontSize=10,textColor=WHITE,alignment=2)),
  ]],colWidths=[3.5*inch,3.5*inch])
  ph.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),color),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
    ('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),
    ('LEFTPADDING',(0,0),(0,-1),14),('RIGHTPADDING',(-1,0),(-1,-1),14)]))
  story.append(ph)
  tips=platform.get('tips',[])
  if tips:
    tip_rows=[]
    for i,tip in enumerate(tips):
      tip_rows.append([
        P(f'<b>{tip.get("label","")}</b><br/>{tip.get("text","")}',sty(f'tp{i}',fontName='Helvetica',fontSize=10,textColor=DARK,leading=15)),
        P(f'<font color="#C8963E"><b>{tip.get("action","")}</b></font>',sty(f'ta{i}',fontName='Helvetica-Bold',fontSize=9,textColor=GOLD,alignment=2)),
      ])
    cmds=[('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),
      ('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(-1,0),(-1,-1),12),('GRID',(0,0),(-1,-1),0.5,BORDER)]
    for i in range(len(tip_rows)):
      cmds.append(('BACKGROUND',(0,i),(-1,i),WHITE if i%2==0 else LIGHT_BG))
    tbl=Table(tip_rows,colWidths=[5.5*inch,1.5*inch])
    tbl.setStyle(TableStyle(cmds))
    story.append(tbl)
  story.append(Spacer(1,14))

# Expansion
expansion=sg.get('expansion',[])
if expansion:
  story.append(P('Platforms to Consider Expanding To',sty('sh4',fontName='Helvetica-Bold',fontSize=13,textColor=DARK,spaceAfter=8)))
  exp_rows=[]
  for e in expansion:
    exp_rows.append([
      P(f'<b>{e.get("platform","")}</b><br/><font color="#71717A" size="9">{e.get("why","")}</font>',sty('ex',fontName='Helvetica',fontSize=10,textColor=DARK,leading=15)),
      P(f'<font color="#6EC97F"><b>{e.get("opportunity","")}</b></font>',sty('ea',fontName='Helvetica-Bold',fontSize=9,textColor=GREEN,alignment=2)),
    ])
  et=Table(exp_rows,colWidths=[5.2*inch,1.8*inch])
  et.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),GREEN_BG),('BOX',(0,0),(-1,-1),1,HexColor('#D1FAE5')),
    ('INNERGRID',(0,0),(-1,-1),0.5,HexColor('#D1FAE5')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
    ('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),
    ('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(-1,0),(-1,-1),12)]))
  story+=[et,Spacer(1,18)]

# Audit
if audit:
  story.append(P('Activity This Week',sty('sh5',fontName='Helvetica-Bold',fontSize=13,textColor=DARK,spaceAfter=8)))
  arows=[['Time','Action','Details']]
  for e in audit[:10]:
    ts=e.get('created_at','')
    try:
      dt=datetime.datetime.fromisoformat(ts.replace('Z',''))
      ts=dt.strftime('%b %d %I:%M%p')
    except: pass
    arows.append([ts,e.get('action',''),e.get('description','')[:55]])
  at=Table(arows,colWidths=[1.2*inch,2.3*inch,3.5*inch])
  at.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),DARK),('TEXTCOLOR',(0,0),(-1,0),WHITE),
    ('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,0),9),('FONTSIZE',(0,1),(-1,-1),9),
    ('ROWBACKGROUNDS',(0,1),(-1,-1),[WHITE,LIGHT_BG]),('GRID',(0,0),(-1,-1),0.5,BORDER),
    ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),
    ('LEFTPADDING',(0,0),(-1,-1),8),('VALIGN',(0,0),(-1,-1),'TOP')]))
  story+=[at,Spacer(1,16)]

# Footer
story+=[
  HRFlowable(width='100%',thickness=1,color=BORDER,spaceBefore=6,spaceAfter=8),
  P('Generated by Fillo AI &nbsp;&middot;&nbsp; fillo.tech &nbsp;&middot;&nbsp; support@fillo.tech &nbsp;&middot;&nbsp; Enterprise Weekly Intelligence Report',
    sty('ft',fontName='Helvetica',fontSize=8,textColor=TEXT3,alignment=1))
]

doc.build(story)
print("ok")
`;

  // Write and run python script
  const scriptPath = path.join(os.tmpdir(), `fillo-gen-${Date.now()}.py`);
  fs.writeFileSync(scriptPath, pythonScript);
  execSync(`python3 ${scriptPath}`, { stdio: 'pipe' });

  const pdfBuffer = fs.readFileSync(outPath);

  // Cleanup
  try { fs.unlinkSync(dataPath); fs.unlinkSync(outPath); fs.unlinkSync(scriptPath); } catch {}

  return pdfBuffer;
}

// ── SEND REPORT EMAIL ─────────────────────────────────────────
async function sendReportEmail({ toEmail, venueName, pdfBuffer, periodStart, periodEnd }) {
  const transporter = nodemailer.createTransport({
    host: 'mail.privateemail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.SUPPORT_EMAIL || 'support@fillo.tech',
      pass: process.env.SUPPORT_EMAIL_PASS,
    },
  });

  await transporter.sendMail({
    from: '"Fillo AI" <support@fillo.tech>',
    to: toEmail,
    subject: `📊 Your Fillo Weekly Report · ${venueName} · ${periodStart} – ${periodEnd}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#0E0E10;color:#F4F4F5;border-radius:12px;overflow:hidden">
        <div style="background:#0E0E10;padding:28px 32px;border-bottom:1px solid rgba(255,255,255,0.08)">
          <div style="font-size:22px;font-weight:800;letter-spacing:3px;color:#C8963E">FILLO</div>
        </div>
        <div style="padding:32px">
          <h2 style="margin:0 0 12px;font-size:20px">Your Weekly Intelligence Report is ready 📊</h2>
          <p style="color:#A1A1AA;font-size:14px;line-height:1.6;margin:0 0 24px">
            Here's your full Fillo Intelligence Report for <strong style="color:#F4F4F5">${venueName}</strong> — 
            covering ${periodStart} through ${periodEnd}. Includes your FOMO score, top trends, 
            personalized social media playbook, and everything Fillo did this week.
          </p>
          <div style="background:#18181B;border-radius:10px;padding:20px;margin-bottom:24px;border:1px solid rgba(255,255,255,0.08)">
            <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#71717A;margin-bottom:8px">This week's report includes</div>
            <div style="font-size:13px;color:#A1A1AA;line-height:2">
              📈 FOMO Score + trend analysis<br>
              🎯 Top opportunity of the week<br>
              📱 Personalized social media playbook (Instagram, TikTok, X, Google)<br>
              🚀 Platform expansion recommendations<br>
              🔄 Full audit trail of everything Fillo published
            </div>
          </div>
          <p style="color:#71717A;font-size:12px">The full report is attached as a PDF. Questions? Reply to this email or reach us at support@fillo.tech</p>
        </div>
        <div style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);text-align:center">
          <p style="color:#71717A;font-size:11px;margin:0">Fillo AI · fillo.tech · Enterprise Weekly Reports</p>
        </div>
      </div>
    `,
    attachments: [{
      filename: `fillo-weekly-${venueName.toLowerCase().replace(/\s+/g,'-')}-${periodEnd.replace(/\s+/g,'-')}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
  });
}

// ── MAIN: RUN WEEKLY REPORT FOR ALL ENTERPRISE USERS ──────────
async function runWeeklyReports() {
  console.log('Running weekly Fillo reports...');

  // Get all enterprise users with alert emails
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, plan, first_name')
    .eq('plan', 'enterprise')
    .eq('status', 'active');

  if (error || !users?.length) {
    console.log('No enterprise users found:', error?.message);
    return;
  }

  const now = new Date();
  const periodEnd = now.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  const periodStartDate = new Date(now); periodStartDate.setDate(now.getDate() - 7);
  const periodStart = periodStartDate.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });

  for (const user of users) {
    try {
      // Get their active venue
      const { data: venue } = await supabase
        .from('venues')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single();

      if (!venue) continue;

      // Get audit trail for the week
      const { data: auditEntries } = await supabase
        .from('audit_trail')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', periodStartDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(20);

      // Get latest scan data from venues table
      const scanData = {
        fomoScore: venue.last_fomo_score || 0,
        signalCount: venue.last_signal_count || 0,
        published: auditEntries?.filter(e => e.action?.includes('Published')).length || 0,
        topTrend: venue.last_top_trend || '',
        topTrendDelta: venue.last_top_trend_delta || '',
        trends: venue.last_trends || [],
        topOpportunity: venue.last_opportunity || '',
      };

      // Generate Claude social guidance
      const socialGuidance = await generateSocialGuidance({
        venueName: venue.name,
        venueType: venue.type,
        city: venue.city,
        genres: venue.genres || [],
        instagram: venue.instagram,
        tiktok: venue.tiktok,
        twitter: venue.twitter,
        competitors: venue.competitors || [],
        trends: scanData.trends,
        fomoScore: scanData.fomoScore,
      });

      // Generate PDF
      const pdfBuffer = await generatePDFBuffer(venue, scanData, auditEntries || [], socialGuidance, periodStart, periodEnd);

      // Send email
      const toEmail = venue.alert_email || user.email;
      await sendReportEmail({ toEmail, venueName: venue.name, pdfBuffer, periodStart, periodEnd });

      // Log to audit trail
      await supabase.from('audit_trail').insert({
        user_id: user.id,
        action: 'Weekly Report Sent',
        description: `PDF report emailed to ${toEmail} · ${periodStart} – ${periodEnd}`,
        platform: 'Fillo Reports',
        created_at: new Date(),
      });

      console.log(`✅ Report sent for ${venue.name} → ${toEmail}`);
    } catch (err) {
      console.error(`❌ Report failed for user ${user.id}:`, err.message);
    }
  }

  console.log('Weekly reports complete.');
}

module.exports = { generateSocialGuidance, generatePDFBuffer, sendReportEmail, runWeeklyReports };