const express = require('express');
const env = require('../config/env');
const logger = require('../lib/logger');
const { trackAnalyticsEvent } = require('../services/analytics/analyticsService');

const router = express.Router();
const allowedSources = new Set(['hero', 'footer', 'direct', 'unknown']);

router.get('/kaufklug-alpha', async (req, res) => {
  try {
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : 'direct';
    const source = allowedSources.has(requestedSource) ? requestedSource : 'unknown';

    await trackAnalyticsEvent({
      req,
      eventName: 'apk_download_click',
      path: req.originalUrl,
      metadata: { source },
    });
  } catch (error) {
    logger.error('Failed to track APK download click', { message: error.message });
  }

  res.redirect(302, env.KAUFKLUG_APK_URL);
});

module.exports = router;
