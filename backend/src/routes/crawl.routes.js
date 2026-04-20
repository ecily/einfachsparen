const express = require('express');
const env = require('../config/env');
const { crawlAllSources } = require('../services/crawl/crawlDispatcher');

const router = express.Router();

router.post('/run', async (req, res, next) => {
  try {
    const retailerKeys = Array.isArray(req.body?.retailerKeys) ? req.body.retailerKeys : [];
    const crawlResult = await crawlAllSources({
      retailerKeys,
      region: env.CRAWL_REGION,
      trigger: 'manual',
    });

    res.json({
      ok: true,
      region: env.CRAWL_REGION,
      results: crawlResult.sources,
      dedupe: crawlResult.dedupe,
      filterMetadata: crawlResult.filterMetadata,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
