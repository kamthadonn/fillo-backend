const fs = require('fs');
let c = fs.readFileSync('routes/onboarding.js', 'utf8');
c = c.replace(
  "const toStr = v => Array.isArray(v) ? v.join(', ') : (v || '');",
  "const toStr = v => { if (!v) return ''; if (Array.isArray(v)) return v.filter(Boolean).join(', '); return String(v); };"
);
fs.writeFileSync('routes/onboarding.js', c);
console.log('done');
