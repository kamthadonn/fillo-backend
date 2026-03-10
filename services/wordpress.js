const axios = require('axios');

async function pushToWordPress(content) {
  try {
    const { WP_SITE_URL, WP_USERNAME, WP_APP_PASSWORD } = process.env;

    if (!WP_SITE_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
      console.log('WordPress credentials not set yet — skipping');
      return null;
    }

    const credentials = Buffer.from(
      `${WP_USERNAME}:${WP_APP_PASSWORD}`
    ).toString('base64');const response = await axios.post(
      `${WP_SITE_URL}/wp-json/wp/v2/posts`,
      {
        title: content.bannerHeadline,
        content: `<div class="fillo-banner"><h1>${content.bannerHeadline}</h1><p>${content.homepageBlurb}</p><p>${content.ticketCopy}</p><a href="#tickets">GET TICKETS</a></div>`,
        status: 'draft',
        meta: {
          fillo_generated: true,
          fillo_timestamp: new Date().toISOString()
        }
      },
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ WordPress draft created:', response.data.link);
    return response.data;

  } catch(err) {
    console.error('WordPress error:', err.message);
    return null;
  }
}

module.exports = { pushToWordPress };