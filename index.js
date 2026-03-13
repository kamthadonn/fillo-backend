require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'Fillo backend is live ⚡', version': '2.1.1'' }));

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/demo',          require('./routes/demo'));
app.use('/api/trends',        require('./routes/trends'));
app.use('/api/cms',           require('./routes/cms'));
app.use('/api/onboarding',    require('./routes/onboarding'));
app.use('/api/stripe',        require('./routes/stripe'));
app.use('/api/places',        require('./routes/places'));
app.use('/api/searchconsole', require('./routes/searchconsole'));
app.use('/api/venues',        require('./routes/venues'));
app.use('/api/audit',         require('./routes/audit'));
app.use('/api/team',          require('./routes/team'));
app.use('/api/report',        require('./routes/report'));
app.use('/api/whitelabel',    require('./routes/whitelabel'));

cron.schedule('0 2 * * *', async () => {
  try {
    const { scanTrends } = require('./services/googletrends');
    const trends = await scanTrends();
    console.log('Auto-scan:', trends.length, 'trends');
  } catch(err) {
    console.error('Auto-scan error:', err.message);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Fillo backend running on port ${PORT}`));
// Fri Mar 13 00:09:43 CDT 2026
