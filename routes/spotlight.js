cat > /tmp/fix_spotlight.js << 'EOF'
const fs = require('fs');
let c = fs.readFileSync('routes/spotlight.js','utf8');
c = c.replace(
`async function enterpriseOnly(req, res, next) {
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase
      .from('users')
      .select('plan')
      .eq('id', req.user.userId)
      .single();
    if (!user || user.plan !== 'enterprise') {
      return res.status(403).json({ error: 'Spotlight is an Enterprise feature. Upgrade to access.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}`,
`function enterpriseOnly(req,res,next) {
  const plan=(req.user.plan||'starter').toLowerCase();
  if(plan==='enterprise'||plan==='voucher') return next();
  return res.status(403).json({error:'Spotlight requires Enterprise plan.',requiredPlan:'enterprise',currentPlan:plan,upgrade:true});
}`
);
fs.writeFileSync('routes/spotlight.js',c);
console.log('✅ spotlight.js');
EOF