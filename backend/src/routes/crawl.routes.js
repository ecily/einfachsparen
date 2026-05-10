const express = require('express');
const env = require('../config/env');
const { crawlAllSources } = require('../services/crawl/crawlDispatcher');

function arrayFromBody(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function parseCrawlRunBody(body = {}) {
  const sourceSelectionRequested = Object.prototype.hasOwnProperty.call(body, 'sourceKeys') ||
    Object.prototype.hasOwnProperty.call(body, 'sourceIds');
  return {
    retailerKeys: arrayFromBody(body.retailerKeys),
    sourceKeys: arrayFromBody(body.sourceKeys),
    sourceIds: arrayFromBody(body.sourceIds),
    dryRun: body.dryRun === true,
    allowDisabled: body.allowDisabled === true,
    sourceSelectionRequested,
  };
}

function createCrawlRouter({ crawlAllSourcesImpl = crawlAllSources, envConfig = env } = {}) {
  const router = express.Router();

  router.post('/run', async (req, res, next) => {
    try {
      const options = parseCrawlRunBody(req.body || {});
      const crawlResult = await crawlAllSourcesImpl({
        ...options,
        region: envConfig.CRAWL_REGION,
        trigger: 'manual',
      });

      res.json({
        ok: true,
        region: envConfig.CRAWL_REGION,
        dryRun: Boolean(crawlResult.dryRun),
        crawlStarted: crawlResult.crawlStarted !== false && !crawlResult.dryRun,
        results: crawlResult.sources || [],
        matchedSources: crawlResult.matchedSources || [],
        skippedSources: crawlResult.skippedSources || [],
        disabledSources: crawlResult.disabledSources || [],
        unknownSourceKeys: crawlResult.unknownSourceKeys || [],
        unknownSourceIds: crawlResult.unknownSourceIds || [],
        effectiveRetailerKeys: crawlResult.effectiveRetailerKeys || [],
        requestedSourceKeys: crawlResult.requestedSourceKeys || options.sourceKeys,
        requestedSourceIds: crawlResult.requestedSourceIds || options.sourceIds,
        wouldRunCount: crawlResult.wouldRunCount ?? (crawlResult.sources || []).length,
        dedupe: crawlResult.dedupe,
        filterMetadata: crawlResult.filterMetadata,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

const router = createCrawlRouter();

module.exports = router;
module.exports.createCrawlRouter = createCrawlRouter;
module.exports.parseCrawlRunBody = parseCrawlRunBody;
