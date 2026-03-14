const nodemailer = require('nodemailer');
function getTransport() { return nodemailer.createTransport({ host:process.env.SMTP_HOST||'mail.privateemail.com', port:parseInt(process.env.SMTP_PORT||'587'), secure:false, auth:{ user:process.env.SMTP_USER||'support@fillo.tech', pass:process.env.SMTP_PASS } }); }
async function sendFomoAlert({to,venueName,fomoScore,insight,city,bizType}) {
  if (!process.env.SMTP_PASS||!to) return {skipped:true};
  const label = bizType==='goods'?'Demand Score':'FOMO Score';
  try {
    await getTransport().sendMail({ from:`"Fillo" <${process.env.SMTP_USER}>`, to, subject:`${venueName} — ${label} ${fomoScore} · Act now`, html:`<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#F9F8F6"><h2 style="font-family:serif">${venueName}</h2><p style="font-size:48px;font-weight:700;color:${fomoScore>=80?'#C0392B':'#C8963E'};margin:0">${fomoScore}</p><p style="font-size:13px;color:#5A5754">${label} · ${fomoScore>=80?'High buying window':'Moderate activity'}</p><p>${insight||'Strong market signals detected.'}</p><a href="https://fillo.tech/dashboard.html" style="background:#0D0D0D;color:#fff;padding:12px 24px;border-radius:9px;text-decoration:none;font-size:14px;font-weight:600">View Dashboard</a></div>` });
    console.log(`[Email] Alert sent to ${to} — score: ${fomoScore}`);
    return {sent:true};
  } catch(err) { console.error('[Email]',err.message); return {error:err.message}; }
}
async function sendWeeklyReport({to,venueName,scans,audits,plan}) {
  if (!process.env.SMTP_PASS||!to) return {skipped:true};
  if (plan!=='enterprise'&&plan!=='voucher') return {skipped:true};
  const avg = scans.length ? Math.round(scans.reduce((s,r)=>s+(r.fomo_score||0),0)/scans.length) : 0;
  try {
    await getTransport().sendMail({ from:`"Fillo" <${process.env.SMTP_USER}>`, to, subject:`${venueName} — Weekly Intelligence Report`, html:`<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#F9F8F6"><h2 style="font-family:serif">${venueName} — Weekly Report</h2><p><strong>${scans.length}</strong> scans · Avg score <strong>${avg}</strong> · <strong>${audits.length}</strong> actions</p><a href="https://fillo.tech/dashboard.html" style="background:#0D0D0D;color:#fff;padding:12px 24px;border-radius:9px;text-decoration:none;font-size:14px">View Dashboard</a></div>` });
    return {sent:true};
  } catch(err) { return {error:err.message}; }
}
module.exports = { sendFomoAlert, sendWeeklyReport };
