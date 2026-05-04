const express = require('express');
const { requireAdminApiKey } = require('../middleware/adminAuth');
const { analyticsEventRateLimit } = require('../middleware/rateLimits');
const { validateAnalyticsPayload } = require('../middleware/validators');
const { buildAnalyticsSummary, trackAnalyticsEvent } = require('../services/analytics/analyticsService');

const router = express.Router();

router.post('/event', analyticsEventRateLimit, validateAnalyticsPayload, async (req, res, next) => {
  try {
    await trackAnalyticsEvent({
      req,
      eventName: req.body?.eventName,
      path: req.body?.path,
      metadata: req.body?.metadata || {},
    });

    res.json({ ok: true });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({
        ok: false,
        message: error.message,
      });
    }

    next(error);
  }
});

router.get('/summary', requireAdminApiKey, async (req, res, next) => {
  try {
    const summary = await buildAnalyticsSummary();
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
