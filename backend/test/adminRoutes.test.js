const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { requireAdminApiKey } = require('../src/middleware/adminAuth');
const {
  createAdminRouter,
  buildFilterRebuildContext,
  FILTER_METADATA_COLLECTIONS,
} = require('../src/routes/admin.routes');

function requestJson(app, { method = 'GET', path = '/api/admin/filters/rebuild-context', body = {}, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const payload = method === 'GET' ? '' : JSON.stringify(body);
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

function buildTestApp(router, { adminProtected = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminProtected ? requireAdminApiKey : (req, res, next) => next(), router);
  app.use((error, req, res, next) => {
    res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message,
      details: error.details || {},
    });
  });
  return app;
}

test('filter rebuild context exposes only safe environment, database and operation metadata', () => {
  const context = buildFilterRebuildContext({
    envConfig: {
      NODE_ENV: 'production',
      MONGODB_DB_NAME: 'einfachsparen',
    },
    dbState: {
      readyState: 1,
      name: 'einfachsparen',
    },
    buildInfo: {
      commitSha: '8f8c170cfc223582ff9351c34ef89469bc819d77',
      commitShort: '8f8c170cfc22',
      nodeEnv: 'production',
    },
  });

  assert.equal(context.nodeEnv, 'production');
  assert.equal(context.database.connected, true);
  assert.equal(context.database.name, 'einfachsparen');
  assert.deepEqual(context.operation.mutatesCollections, FILTER_METADATA_COLLECTIONS);
  assert.deepEqual(context.operation.doesNotRun, ['crawl', 'reindex', 'repair-apply', 'hard-delete']);
  assert.equal(JSON.stringify(context).includes('MONGODB_URI'), false);
  assert.equal(JSON.stringify(context).includes('ADMIN_API_KEY'), false);
});

test('POST /api/admin/filters/rebuild rejects non-production environments before service call', async () => {
  let called = false;
  const router = createAdminRouter({
    envConfig: {
      NODE_ENV: 'development',
      MONGODB_DB_NAME: 'einfachsparen_dev',
    },
    dbStateProvider: () => ({
      readyState: 1,
      name: 'einfachsparen_dev',
    }),
    buildInfoProvider: () => ({ commitSha: '8f8c170cfc223582ff9351c34ef89469bc819d77' }),
    filterMetadataServiceImpl: {
      async rebuildFilterMetadata() {
        called = true;
        return {};
      },
    },
  });
  const app = buildTestApp(router);

  const response = await requestJson(app, {
    method: 'POST',
    path: '/api/admin/filters/rebuild',
  });

  assert.equal(response.statusCode, 409);
  assert.equal(called, false);
  assert.equal(response.body.details.nodeEnv, 'development');
  assert.equal(response.body.details.databaseName, 'einfachsparen_dev');
});

test('POST /api/admin/filters/rebuild runs existing filter metadata service in production context', async () => {
  const calls = [];
  const summary = {
    trigger: 'admin-api',
    processedOffers: 497,
    counts: {
      retailers: { modified: 3 },
    },
  };
  const router = createAdminRouter({
    envConfig: {
      NODE_ENV: 'production',
      MONGODB_DB_NAME: 'einfachsparen',
    },
    dbStateProvider: () => ({
      readyState: 1,
      name: 'einfachsparen',
    }),
    buildInfoProvider: () => ({
      commitSha: '8f8c170cfc223582ff9351c34ef89469bc819d77',
      commitShort: '8f8c170cfc22',
      nodeEnv: 'production',
    }),
    filterMetadataServiceImpl: {
      async rebuildFilterMetadata(payload) {
        calls.push(payload);
        return summary;
      },
    },
  });
  const app = buildTestApp(router);

  const response = await requestJson(app, {
    method: 'POST',
    path: '/api/admin/filters/rebuild',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.deepEqual(response.body.summary, summary);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].trigger, 'admin-api');
  assert.equal(calls[0].loggerContext.invokedBy, 'POST /api/admin/filters/rebuild');
});

test('admin protection blocks filter rebuild before handler is called', async () => {
  let called = false;
  const router = createAdminRouter({
    envConfig: {
      NODE_ENV: 'production',
      MONGODB_DB_NAME: 'einfachsparen',
    },
    dbStateProvider: () => ({
      readyState: 1,
      name: 'einfachsparen',
    }),
    filterMetadataServiceImpl: {
      async rebuildFilterMetadata() {
        called = true;
        return {};
      },
    },
  });
  const app = buildTestApp(router, { adminProtected: true });

  const response = await requestJson(app, {
    method: 'POST',
    path: '/api/admin/filters/rebuild',
  });

  assert.equal([401, 503].includes(response.statusCode), true);
  assert.equal(called, false);
});
