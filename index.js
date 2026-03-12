require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status: 'Fillo backend is live ⚡',
    version: '2.0.0'
  });
});

app.use('/api/trends', require('./routes/trends'));
app.use('/api/cms', require('./routes/cms'));
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/stripe', require('./routes/stripe'));

cron.schedule('0 * * * *', async () => {
  console.log('⚡ Fillo auto-scan running...');
  try {
    const { scanTrends } = require('./services/googletrends');
    const { scanReddit } = require('./services/reddit');
    const trends = await scanTrends();
    const reddit = await scanReddit();
    console.log('✅ Trends detected:', trends.length);
    console.log('✅ Reddit signals:', reddit.length);
  } catch(err) {
    console.error('Auto-scan error:', err.message);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n⚡ Fillo backend running on port ${PORT}`);
  console.log(`🌐 Visit: http://localhost:${PORT}`);
  console.log(`📡 Trends: http://localhost:${PORT}/api/trends`);
  console.log(`🔧 CMS: http://localhost:${PORT}/api/cms\n`);
})