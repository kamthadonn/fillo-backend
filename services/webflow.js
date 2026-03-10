const axios = require('axios');

async function pushToWebflow(content) {
  try {
    const { WEBFLOW_API_KEY, WEBFLOW_COLLECTION_ID } = process.env;

    if (!WEBFLOW_API_KEY || !WEBFLOW_COLLECTION_ID) {
      console.log('Webflow credentials not set yet — skipping');
      return null;
    }

    const response = await axios.post(
      `https://api.webflow.com/collections/${WEBFLOW_COLLECTION_ID}/items`,
      {
        fields: {
          name: content.bannerHeadline,
          slug: `fillo-${Date.now()}`,
          'banner-headline': content.bannerHeadline,
          'homepage-blurb': content.homepageBlurb,
          'ticket-copy': content.ticketCopy,
          'social-caption': content.socialCaption,
          '_archived': false,
          '_draft': true
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WEBFLOW_API_KEY}`,
          'Content-Type': 'application/json',
          'accept-version': '1.0.0'
        }
      }
    );

    console.log('✅ Webflow draft created');
    return response.data;

  } catch(err) {
    console.error('Webflow error:', err.message);
    return null;
  }
}

module.exports = { pushToWebflow };