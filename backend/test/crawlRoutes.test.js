const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { requireAdminApiKey } = require('../src/middleware/adminAuth');
const {
  createCrawlRouter,
  parseCrawlRunBody,
} = require('../src/routes/crawl.routes');
const { serializeCrawlRun } = require('../src/services/crawl/crawlRunService');

function requestJson(app, { method = 'POST', path = '/api/crawl/run', body = {}, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const payload = JSON.stringify(body);
      const request = http.request({
        method,
        hostname: '127.0.0.1',
        port: server.address().port,
        path,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
      }, (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => {
          server.close();
          resolve({
            statusCode: response.statusCode,
            body: raw ? JSON.parse(raw) : null,
          });
        });
      });
      request.on('error', (error) => {
        server.close();
        reject(error);
      });
      request.end(payload);
    });
  });
}

function run(overrides = {}) {
  return {
    _id: overrides._id || '665000000000000000000001',
    id: overrides.id,
    status: overrides.status || 'queued',
    trigger: overrides.trigger || 'manual',
    mode: overrides.mode || 'full',
    dryRun: overrides.dryRun || false,
    region: overrides.region || 'Steiermark',
    startedAt: overrides.startedAt || null,
    finishedAt: overrides.finishedAt || null,
    durationMs: overrides.durationMs ?? null,
    sourceKeys: overrides.sourceKeys || [],
    sourceIds: overrides.sourceIds || [],
    summary: overrides.summary || {},
    perRetailer: overrides.perRetailer || [],
    sourceTypes: overrides.sourceTypes || [],
    result: overrides.result || {
      sources: [],
      dedupe: {},
      filterMetadata: {},
      effectiveRetailerKeys: [],
      requestedSourceKeys: overrides.sourceKeys || [],
      requestedSourceIds: overrides.sourceIds || [],
    },
    errorMessages: overrides.errorMessages || [],
    warnings: overrides.warnings || [],
  };
}

function buildService({ startResult, latestRun = null, byIdRun = null, calls = [] } = {}) {
  return {
    async startCrawlRun(payload) {
      calls.push(payload);
      return startResult || { accepted: true, alreadyRunning: false, run: run() };
    },
    async getLatestCrawlRun() {
      return latestRun;
    },
    async getCrawlRunById() {
      return byIdRun;
    },
    async recoverStaleCrawlRun(payload) {
      calls.push(payload);
      return {
        recovered: true,
        reason: 'age-threshold-exceeded',
        ageMs: 3600000,
        staleAfterMs: 1800000,
        lock: null,
        run: run({
          _id: payload.runId,
          status: 'stale',
          finishedAt: new Date('2026-05-10T20:00:00.000Z'),
          durationMs: 3600000,
          warnings: ['Stale CrawlRun recovery: test'],
        }),
      };
    },
    serializeCrawlRun,
  };
}

function buildTestApp(crawlRunServiceImpl, { adminProtected = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/crawl', adminProtected ? requireAdminApiKey : (req, res, next) => next(), createCrawlRouter({
    crawlRunServiceImpl,
    envConfig: { CRAWL_REGION: 'Steiermark' },
  }));
  app.use((error, req, res, next) => {
    res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message,
      details: error.details || {},
    });
  });
  return app;
}

test('parseCrawlRunBody preserves compatible retailerKeys-only requests and source selectors', () => {
  assert.deepEqual(parseCrawlRunBody({ retailerKeys: ['spar', 'spar', ''] }), {
    retailerKeys: ['spar'],
    sourceKeys: [],
    sourceIds: [],
    dryRun: false,
    allowDisabled: false,
    sourceSelectionRequested: false,
  });

  assert.deepEqual(parseCrawlRunBody({
    retailerKeys: ['spar'],
    sourceKeys: ['aktionsfinder-spar'],
    dryRun: true,
  }), {
    retailerKeys: ['spar'],
    sourceKeys: ['aktionsfinder-spar'],
    sourceIds: [],
    dryRun: true,
    allowDisabled: false,
    sourceSelectionRequested: true,
  });
});

test('POST /api/crawl/run accepts an async full CrawlRun without waiting for crawl completion', async () => {
  const calls = [];
  const service = buildService({
    calls,
    startResult: {
      accepted: true,
      alreadyRunning: false,
      run: run({ mode: 'full' }),
    },
  });
  const app = buildTestApp(service);

  const response = await requestJson(app, {
    body: { dryRun: false },
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.body.accepted, true);
  assert.equal(response.body.alreadyRunning, false);
  assert.equal(response.body.mode, 'full');
  assert.equal(response.body.runId, '665000000000000000000001');
  assert.deepEqual(calls[0].options.retailerKeys, []);
  assert.deepEqual(calls[0].options.sourceKeys, []);
});

test('POST /api/crawl/run accepts scoped sourceKeys and keeps the request scoped', async () => {
  const calls = [];
  const service = buildService({
    calls,
    startResult: {
      accepted: true,
      alreadyRunning: false,
      run: run({
        mode: 'scoped',
        sourceKeys: ['spar-official-flyer-pdf'],
      }),
    },
  });
  const app = buildTestApp(service);

  const response = await requestJson(app, {
    body: {
      retailerKeys: ['spar'],
      sourceKeys: ['spar-official-flyer-pdf'],
      dryRun: false,
    },
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.body.mode, 'scoped');
  assert.deepEqual(response.body.requestedSourceKeys, ['spar-official-flyer-pdf']);
  assert.deepEqual(calls[0].options.sourceKeys, ['spar-official-flyer-pdf']);
  assert.equal(calls[0].options.sourceSelectionRequested, true);
});

test('POST /api/crawl/run returns existing run when another CrawlRun is active', async () => {
  const service = buildService({
    startResult: {
      accepted: false,
      alreadyRunning: true,
      run: run({
        _id: '665000000000000000000002',
        status: 'running',
      }),
    },
  });
  const app = buildTestApp(service);

  const response = await requestJson(app, {
    body: { dryRun: false },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.accepted, false);
  assert.equal(response.body.alreadyRunning, true);
  assert.equal(response.body.runId, '665000000000000000000002');
  assert.equal(response.body.status, 'running');
});

test('GET /api/crawl/runs/latest returns compact serialized CrawlRun status', async () => {
  const service = buildService({
    latestRun: run({
      status: 'partial',
      summary: { matchedSourcesCount: 3, failedSourcesCount: 1 },
      result: {
        sources: [{ sourceKey: 'aktionsfinder-spar', status: 'success', offersStored: 10 }],
        dedupe: { duplicateGroups: 1, removedOffers: 2 },
        filterMetadata: { ok: true, processedOffers: 100 },
        effectiveRetailerKeys: ['spar'],
        requestedSourceKeys: [],
        requestedSourceIds: [],
      },
    }),
  });
  const app = buildTestApp(service);

  const response = await requestJson(app, {
    method: 'GET',
    path: '/api/crawl/runs/latest',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.run.status, 'partial');
  assert.equal(response.body.run.summary.failedSourcesCount, 1);
  assert.equal(response.body.run.result.sources[0].sourceKey, 'aktionsfinder-spar');
  assert.equal(response.body.run.result.sources[0].rawDocuments, undefined);
  assert.equal(response.body.run.result.offers, undefined);
});

test('GET /api/crawl/runs/:runId serializes ObjectIds as strings and returns 404 for missing runs', async () => {
  const service = buildService({
    byIdRun: run({
      _id: { toString: () => '665000000000000000000003' },
      status: 'success',
    }),
  });
  const app = buildTestApp(service);

  const response = await requestJson(app, {
    method: 'GET',
    path: '/api/crawl/runs/665000000000000000000003',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.run.id, '665000000000000000000003');

  const missingApp = buildTestApp(buildService({ byIdRun: null }));
  const missing = await requestJson(missingApp, {
    method: 'GET',
    path: '/api/crawl/runs/665000000000000000000004',
  });

  assert.equal(missing.statusCode, 404);
});

test('POST /api/crawl/runs/:runId/recover-stale returns recovered stale run status', async () => {
  const calls = [];
  const service = buildService({ calls });
  const app = buildTestApp(service);

  const response = await requestJson(app, {
    method: 'POST',
    path: '/api/crawl/runs/665000000000000000000099/recover-stale',
    body: {
      reason: 'deploy restart orphan',
      staleAfterMinutes: 30,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.recovered, true);
  assert.equal(response.body.run.status, 'stale');
  assert.equal(response.body.run.id, '665000000000000000000099');
  assert.equal(calls[0].reason, 'deploy restart orphan');
  assert.equal(calls[0].staleAfterMinutes, 30);
});

test('admin protection blocks crawl run and status endpoints before handlers are called', async () => {
  let called = false;
  const service = buildService();
  service.startCrawlRun = async () => {
    called = true;
    return { accepted: true, alreadyRunning: false, run: run() };
  };
  service.getLatestCrawlRun = async () => {
    called = true;
    return run();
  };
  const app = buildTestApp(service, { adminProtected: true });

  const postResponse = await requestJson(app, {
    body: {
      sourceKeys: ['aktionsfinder-spar'],
      dryRun: true,
    },
  });
  const getResponse = await requestJson(app, {
    method: 'GET',
    path: '/api/crawl/runs/latest',
  });
  const recoverResponse = await requestJson(app, {
    method: 'POST',
    path: '/api/crawl/runs/665000000000000000000003/recover-stale',
    body: {
      reason: 'blocked',
    },
  });

  assert.equal([401, 503].includes(postResponse.statusCode), true);
  assert.equal([401, 503].includes(getResponse.statusCode), true);
  assert.equal([401, 503].includes(recoverResponse.statusCode), true);
  assert.equal(called, false);
});
