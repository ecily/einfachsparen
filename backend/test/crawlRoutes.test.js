const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { requireAdminApiKey } = require('../src/middleware/adminAuth');
const {
  createCrawlRouter,
  parseCrawlRunBody,
} = require('../src/routes/crawl.routes');

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

function buildTestApp(crawlAllSourcesImpl, { adminProtected = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/crawl', adminProtected ? requireAdminApiKey : (req, res, next) => next(), createCrawlRouter({
    crawlAllSourcesImpl,
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

test('parseCrawlRunBody preserves compatible retailerKeys-only requests and new source selectors', () => {
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

test('dryRun request returns preview and does not require route-level crawl execution', async () => {
  let received = null;
  const app = buildTestApp(async (options) => {
    received = options;
    return {
      dryRun: true,
      crawlStarted: false,
      matchedSources: [
        { sourceKey: 'aktionsfinder-spar', retailerKey: 'spar' },
        { sourceKey: 'aktionsfinder-interspar', retailerKey: 'spar' },
        { sourceKey: 'aktionsfinder-eurospar', retailerKey: 'spar' },
      ],
      skippedSources: [],
      disabledSources: [],
      effectiveRetailerKeys: ['spar'],
      requestedSourceKeys: options.sourceKeys,
      requestedSourceIds: [],
      wouldRunCount: 3,
    };
  });

  const response = await requestJson(app, {
    body: {
      retailerKeys: ['spar'],
      sourceKeys: ['aktionsfinder-spar', 'aktionsfinder-interspar', 'aktionsfinder-eurospar'],
      dryRun: true,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.dryRun, true);
  assert.equal(response.body.crawlStarted, false);
  assert.equal(response.body.wouldRunCount, 3);
  assert.deepEqual(received.sourceKeys, ['aktionsfinder-spar', 'aktionsfinder-interspar', 'aktionsfinder-eurospar']);
  assert.equal(received.sourceSelectionRequested, true);
});

test('unknown sourceKeys bubble up as 400 from the route', async () => {
  const app = buildTestApp(async () => {
    const error = new Error('Unknown sourceKeys/sourceIds requested.');
    error.statusCode = 400;
    error.details = { unknownSourceKeys: ['missing-source'] };
    throw error;
  });

  const response = await requestJson(app, {
    body: { sourceKeys: ['missing-source'] },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body.details.unknownSourceKeys, ['missing-source']);
});

test('admin protection blocks crawl route before handler is called', async () => {
  let called = false;
  const app = buildTestApp(async () => {
    called = true;
    return { sources: [] };
  }, { adminProtected: true });

  const response = await requestJson(app, {
    body: {
      sourceKeys: ['aktionsfinder-spar'],
      dryRun: true,
    },
  });

  assert.equal([401, 503].includes(response.statusCode), true);
  assert.equal(called, false);
});
