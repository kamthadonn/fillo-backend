const express = require('express');
const router = express.Router();
const { pushToWordPress } = require('../services/wordpress');
const { pushToWebflow } = require('../services/webflow');

router.post('/publish', async (req, res) => {
  try {
    const { content, target } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'content is required'
      });
    }

    const results = {};

    if (target === 'wordpress' || target === 'both') {
      results.wordpress = await pushToWordPress(content);
    }

    if (target === 'webflow' || target === 'both') {
      results.webflow = await pushToWebflow(content);
    }

    res.json({
      success: true,
      published: results,
      timestamp: new Date().toISOString()
    });

  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;