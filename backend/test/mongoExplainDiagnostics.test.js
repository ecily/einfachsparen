const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const env = require('../src/config/env');
const { requireAdminApiKey } = require('../src/middleware/adminAuth');
const { createAdminRouter } = require('../src/routes/admin.routes');
const { buildMongoExplainDiagnostics } = require('../src/services/diagnostics/mongoExplainDiagnostics');

class FakeQuery {
  constructor(explainResult) {
    this.explainResult = explainResult;
  }

  select() { return this; }
  limit() { return this; }

  async explain() {
    return this.explainResult;
  }
}

function fakeModel(collectionName = 'offers') {
  const explainResult = {
    queryPlanner: {
      winningPlan: {
        stage: 'FETCH',
        inputStage: { stage: 'IXSCAN', indexName: 'status_1_isActiveNow_1' },
      },
    },
    executionStats: {
      executionTimeMillis: 7,
      totalDocsExamined: 12,
      totalKeysExamined: 14,
      nReturned: 5,
    },
  };

  return {
    collection: { name: collectionName },
    find() { return new FakeQuery(explainResult); },
  };
}

function requestJson(app, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const request = http.request({
        method: 'GET',
        hostname: '127.0.0.1',
        port: server.address().port,
        path,
        headers,
      }, (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => {
          server.close();
          resolve({ statusCode: response.statusCode, body: raw ? JSON.parse(raw) : null });
        });
      });
      request.on('error', (error) => { server.close(); reject(error); });
      request.end();
    });
  });
}

test('Mongo explain summary runs all read-only query classes without raw explain or secrets', async () => {
  const report = await buildMongoExplainDiagnostics({
    OfferModel: fakeModel(),
    RetailerModel: fakeModel('retailers'),
    rankingBuilder: async ({ retailers }) => ({
      diagnostics: {
        mongo: {
          primaryExecutionStats: fakeModel().find().explainResult,
          primaryMatch: { retailerKey: retailers || { $exists: true }, secretToken: 'must-not-appear' },
          limit: 240,
          fields: ['_id', 'title'],
        },
      },
    }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.queries.length, 8);
  assert.equal(report.queries[0].collection, 'offers');
  assert.deepEqual(report.queries[0].indexNames, ['status_1_isActiveNow_1']);
  assert.equal(report.queries[0].hasCollscan, false);
  assert.equal(report.queries[0].hasSortStage, false);
  assert.equal(report.queries[4].estimatedQueryShape['[redacted-key]'], 'string');
  assert.doesNotMatch(JSON.stringify(report), /must-not-appear/);
  assert.doesNotMatch(JSON.stringify(report), /winningPlan/);
});

test('Mongo explain endpoint requires the existing admin key', async (t) => {
  const originalKey = env.ADMIN_API_KEY;
  env.ADMIN_API_KEY = 'diagnostic-test-key';
  t.after(() => { env.ADMIN_API_KEY = originalKey; });

  const app = express();
  app.use('/api/admin', requireAdminApiKey, createAdminRouter({
    mongoExplainDiagnosticsServiceImpl: {
      async buildMongoExplainDiagnostics() {
        return { ok: true, readOnly: true, mutatedCollections: [], queries: [] };
      },
    },
  }));

  const unauthorized = await requestJson(app, '/api/admin/diagnostics/mongo-explain');
  assert.equal(unauthorized.statusCode, 401);

  const authorized = await requestJson(app, '/api/admin/diagnostics/mongo-explain', {
    'x-admin-api-key': 'diagnostic-test-key',
  });
  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.body.adminEndpoint.readOnly, true);
  assert.deepEqual(authorized.body.adminEndpoint.mutatesCollections, []);
});
