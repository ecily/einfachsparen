const express = require('express');
const env = require('../config/env');
const crawlRunService = require('../services/crawl/crawlRunService');

const STARTUP_GRACE_BYPASS_REASON = 'spar-rescue-scoped-sourcekeys';
const STARTUP_GRACE_BYPASS_ALLOWED_SOURCE_KEYS = Object.freeze([
  'spar-official-flyer-current',
  'interspar-official-flyer-current',
]);

function arrayFromBody(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function isAllowedStartupGraceBypassRequest(parsed, body = {}) {
  if (body.allowStartupGraceBypass !== true || parsed.dryRun !== false) return false;
  if (parsed.retailerKeys.length > 0 || parsed.sourceIds.length > 0) return false;

  const allowedSet = new Set(STARTUP_GRACE_BYPASS_ALLOWED_SOURCE_KEYS);
  const sourceKeySet = new Set(parsed.sourceKeys);

  return (
    parsed.sourceKeys.length === STARTUP_GRACE_BYPASS_ALLOWED_SOURCE_KEYS.length
    && STARTUP_GRACE_BYPASS_ALLOWED_SOURCE_KEYS.every((sourceKey) => sourceKeySet.has(sourceKey))
    && parsed.sourceKeys.every((sourceKey) => allowedSet.has(sourceKey))
  );
}

function parseCrawlRunBody(body = {}) {
  const sourceSelectionRequested = Object.prototype.hasOwnProperty.call(body, 'sourceKeys') ||
    Object.prototype.hasOwnProperty.call(body, 'sourceIds');
  const parsed = {
    retailerKeys: arrayFromBody(body.retailerKeys),
    sourceKeys: arrayFromBody(body.sourceKeys),
    sourceIds: arrayFromBody(body.sourceIds),
    dryRun: body.dryRun === true,
    allowDisabled: body.allowDisabled === true,
    sourceSelectionRequested,
  };
  const allowStartupGraceBypass = isAllowedStartupGraceBypassRequest(parsed, body);

  return {
    ...parsed,
    allowStartupGraceBypass,
    startupGraceBypassReason: allowStartupGraceBypass ? STARTUP_GRACE_BYPASS_REASON : '',
    allowedSourceKeys: allowStartupGraceBypass ? [...STARTUP_GRACE_BYPASS_ALLOWED_SOURCE_KEYS] : [],
  };
}

function buildAcceptedResponse({ serviceResult, options, envConfig }) {
  const run = crawlRunService.serializeCrawlRun(serviceResult.run);

  if (!serviceResult.accepted) {
    return {
      statusCode: 200,
      body: {
        ok: true,
        accepted: false,
        alreadyRunning: true,
        runId: run?.id || '',
        status: run?.status || 'running',
      },
    };
  }

  return {
    statusCode: 202,
    body: {
      ok: true,
      accepted: true,
      alreadyRunning: false,
      runId: run.id,
      status: run.status,
      region: envConfig.CRAWL_REGION,
      dryRun: options.dryRun,
      mode: run.mode,
      requestedSourceKeys: run.requestedSourceKeys || options.sourceKeys,
      requestedSourceIds: run.requestedSourceIds || options.sourceIds,
      startupGraceBypassed: run.metadata?.startupGraceBypassed === true,
      startupGraceBypassReason: run.metadata?.startupGraceBypassReason || '',
    },
  };
}

function createCrawlRouter({
  crawlRunServiceImpl = crawlRunService,
  envConfig = env,
} = {}) {
  const router = express.Router();

  router.post('/run', async (req, res, next) => {
    try {
      const options = parseCrawlRunBody(req.body || {});
      const serviceResult = await crawlRunServiceImpl.startCrawlRun({
        options,
        region: envConfig.CRAWL_REGION,
        trigger: 'manual',
      });
      const response = buildAcceptedResponse({ serviceResult, options, envConfig });

      res.status(response.statusCode).json(response.body);
    } catch (error) {
      next(error);
    }
  });

  router.get('/runs/latest', async (req, res, next) => {
    try {
      const run = await crawlRunServiceImpl.getLatestCrawlRun();

      res.json({
        ok: true,
        run: crawlRunServiceImpl.serializeCrawlRun(run),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/runs/:runId/recover-stale', async (req, res, next) => {
    try {
      const recovery = await crawlRunServiceImpl.recoverStaleCrawlRun({
        runId: req.params.runId,
        reason: req.body?.reason,
        staleAfterMinutes: req.body?.staleAfterMinutes,
      });

      if (recovery.notFound) {
        return res.status(404).json({
          ok: false,
          recovered: false,
          reason: recovery.reason,
          message: 'CrawlRun wurde nicht gefunden.',
        });
      }

      if (!recovery.recovered) {
        return res.status(recovery.conflict ? 409 : 200).json({
          ok: false,
          recovered: false,
          reason: recovery.reason,
          ageMs: recovery.ageMs ?? null,
          staleAfterMs: recovery.staleAfterMs ?? null,
          processStartedAt: recovery.processStartedAt,
          lock: recovery.lock || null,
          run: crawlRunServiceImpl.serializeCrawlRun(recovery.run),
        });
      }

      return res.json({
        ok: true,
        recovered: true,
        reason: recovery.reason,
        ageMs: recovery.ageMs ?? null,
        staleAfterMs: recovery.staleAfterMs,
        lock: recovery.lock || null,
        run: crawlRunServiceImpl.serializeCrawlRun(recovery.run),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/runs/:runId', async (req, res, next) => {
    try {
      const run = await crawlRunServiceImpl.getCrawlRunById(req.params.runId);

      if (!run) {
        return res.status(404).json({
          ok: false,
          message: 'CrawlRun wurde nicht gefunden.',
        });
      }

      return res.json({
        ok: true,
        run: crawlRunServiceImpl.serializeCrawlRun(run),
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

const router = createCrawlRouter();

module.exports = router;
module.exports.createCrawlRouter = createCrawlRouter;
module.exports.parseCrawlRunBody = parseCrawlRunBody;
module.exports.buildAcceptedResponse = buildAcceptedResponse;
module.exports.isAllowedStartupGraceBypassRequest = isAllowedStartupGraceBypassRequest;
module.exports.STARTUP_GRACE_BYPASS_ALLOWED_SOURCE_KEYS = STARTUP_GRACE_BYPASS_ALLOWED_SOURCE_KEYS;
module.exports.STARTUP_GRACE_BYPASS_REASON = STARTUP_GRACE_BYPASS_REASON;
