const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const env = require('../src/config/env');
const { requireAdminApiKey } = require('../src/middleware/adminAuth');
const {
  createAdminRouter,
  buildFilterRebuildContext,
  parseBoundedInteger,
  parseCsvList,
  parseBoundedLimit,
  FILTER_METADATA_COLLECTIONS,
} = require('../src/routes/admin.routes');
const {
  createOfferFeedbackRouter,
} = require('../src/routes/offerFeedback.routes');

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

function withAdminApiKey(t, value = 'test-admin-key') {
  const originalValue = env.ADMIN_API_KEY;
  env.ADMIN_API_KEY = value;
  t.after(() => {
    env.ADMIN_API_KEY = originalValue;
  });
  return value;
}

function createSummaryOfferFeedbackModel() {
  const calls = {
    countDocuments: 0,
    aggregate: [],
  };

  return {
    calls,
    async countDocuments(filter) {
      calls.countDocuments += 1;
      assert.deepEqual(filter, {});
      return 4;
    },
    async aggregate(pipeline) {
      calls.aggregate.push(pipeline);
      const serialized = JSON.stringify(pipeline);

      if (serialized.includes('"$status"')) {
        return [
          { _id: 'new', count: 3 },
          { _id: 'reviewing', count: 1 },
        ];
      }

      if (serialized.includes('offerSnapshot.retailerKey') && serialized.includes('retailerLabel')) {
        return [
          { _id: 'billa', retailerLabel: 'BILLA', count: 2 },
        ];
      }

      if (serialized.includes('"$offerSnapshot.sourceType"')) {
        return [
          { _id: 'aktionsfinder-json', count: 2 },
        ];
      }

      if (serialized.includes('pageContext.query')) {
        return [
          { _id: 'Eis', count: 1 },
        ];
      }

      if (serialized.includes('suggestedCategoryPrimary')) {
        return [
          {
            _id: {
              currentCategoryPrimary: 'Katzenfutter',
              suggestedCategoryPrimary: 'Konserven',
            },
            count: 2,
          },
        ];
      }

      if (serialized.includes('"$offerSnapshot.categoryPrimary"')) {
        return [
          { _id: 'Katzenfutter', count: 2 },
        ];
      }

      if (serialized.includes('structuredDetails.condition_wrong.issueTypes')) {
        return [
          { _id: 'duplicate_or_conflicting', count: 1 },
        ];
      }

      if (serialized.includes('structuredDetails.image_wrong.issueTypes')) {
        return [
          { _id: 'missing_image', count: 1 },
        ];
      }

      if (serialized.includes('structuredDetails.offer_nonsense.issueTypes')) {
        return [
          { _id: 'broken_title', count: 1 },
        ];
      }

      if (serialized.includes('structuredDetails.search_result_wrong.issueTypes')) {
        return [
          { _id: 'substring_false_positive', count: 1 },
        ];
      }

      if (serialized.includes('offerRef.offerId') && serialized.includes('reasonLists')) {
        return [
          {
            _id: 'offer-123',
            title: 'Felix Felix Linsen mit Speck',
            retailerKey: 'billa',
            count: 2,
            reasons: ['category_wrong', 'condition_wrong'],
          },
        ];
      }

      if (serialized.includes('"$reasons"')) {
        return [
          { _id: 'category_wrong', count: 2 },
          { _id: 'condition_wrong', count: 1 },
        ];
      }

      throw new Error(`Unexpected aggregate pipeline: ${serialized}`);
    },
  };
}

function createRecentOfferFeedbackModel(docs, calls = {}) {
  calls.find = 0;

  return {
    calls,
    find(filter, projection) {
      calls.find += 1;
      assert.deepEqual(filter, {});
      calls.projection = projection;

      return {
        sort(sortArg) {
          calls.sort = sortArg;
          return this;
        },
        limit(limitArg) {
          calls.limit = limitArg;
          return this;
        },
        lean() {
          calls.lean = true;
          return Promise.resolve(docs.slice(0, calls.limit));
        },
      };
    },
  };
}

function createStatusOfferFeedbackModel({ updatedDoc = recentFeedbackDoc(), calls = {} } = {}) {
  calls.findByIdAndUpdate = [];

  return {
    calls,
    async findByIdAndUpdate(id, update, options) {
      calls.findByIdAndUpdate.push({ id, update, options });
      if (id === 'missing-feedback') {
        return null;
      }
      return {
        ...updatedDoc,
        _id: id,
        status: update.$set.status,
        triage: update.$set.triage,
      };
    },
  };
}

function recentFeedbackDoc(overrides = {}) {
  return {
    _id: 'feedback-1',
    createdAt: '2026-05-25T10:00:00.000Z',
    updatedAt: '2026-05-25T10:01:00.000Z',
    status: 'new',
    priority: 'normal',
    reasons: ['category_wrong', 'condition_wrong'],
    offerRef: {
      offerId: 'offer-123',
      stableId: 'stable-123',
      sourceId: 'source-123',
      dedupeKey: 'dedupe-123',
    },
    offerSnapshot: {
      title: 'Felix Felix Linsen mit Speck',
      retailerKey: 'billa',
      retailerLabel: 'BILLA',
      categoryPrimary: 'Katzenfutter',
      categorySecondary: 'Nassfutter',
      conditionsText: 'Gilt ab 2 Stueck',
      conditionBadges: ['Gilt ab 2 Stueck'],
      imagePresent: true,
      sourceType: 'aktionsfinder-json',
      sourceTypes: ['aktionsfinder-json'],
      priceCurrent: { amount: 1.99, currency: 'EUR' },
      quantity: '400 g',
      validityText: 'bis 31.05.',
      sourceUrl: 'https://example.test/source',
    },
    pageContext: {
      path: '/angebote',
      query: 'wurst',
      url: 'https://www.kaufklug.at/angebote?secret=not-returned',
      activeRetailers: ['billa'],
      activeCategories: ['Katzenfutter'],
      resultPosition: 3,
      viewport: '390x844',
    },
    structuredDetails: {
      category_wrong: {
        currentCategoryPrimary: 'Katzenfutter',
        suggestedCategoryPrimary: 'Konserven',
        userNote: 'Ist ein Lebensmittel.',
        ignoredField: 'not-returned',
      },
      condition_wrong: {
        issueTypes: ['duplicate_or_conflicting'],
        userNote: 'Doppelte Bedingung.',
      },
    },
    freeText: 'Bitte pruefen.',
    clientContext: {
      userAgent: 'Mozilla/5.0 '.repeat(50),
      sessionIdHash: 'session-hash-not-returned',
    },
    ip: '203.0.113.10',
    headers: {
      authorization: 'secret',
    },
    ...overrides,
  };
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

test('GET /api/admin/offer-feedback/summary wird ohne Admin-Key abgelehnt', async (t) => {
  withAdminApiKey(t);
  const model = createSummaryOfferFeedbackModel();
  const router = createAdminRouter({ OfferFeedbackModel: model });
  const app = buildTestApp(router, { adminProtected: true });

  const response = await requestJson(app, {
    path: '/api/admin/offer-feedback/summary',
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.ok, false);
  assert.equal(model.calls.countDocuments, 0);
  assert.equal(model.calls.aggregate.length, 0);
});

test('GET /api/admin/offer-feedback/recent wird ohne Admin-Key abgelehnt', async (t) => {
  withAdminApiKey(t);
  const calls = {};
  const model = createRecentOfferFeedbackModel([recentFeedbackDoc()], calls);
  const router = createAdminRouter({ OfferFeedbackModel: model });
  const app = buildTestApp(router, { adminProtected: true });

  const response = await requestJson(app, {
    path: '/api/admin/offer-feedback/recent',
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.ok, false);
  assert.equal(calls.find, 0);
});

test('parseCsvList and parseBoundedInteger keep source transport params bounded', () => {
  assert.deepEqual(parseCsvList('spar-productworld-inangebot, pagro-angebote'), ['spar-productworld-inangebot', 'pagro-angebote']);
  assert.deepEqual(parseCsvList('', ['default-target']), ['default-target']);
  assert.equal(parseBoundedInteger('99999', { defaultValue: 10000, min: 1000, max: 30000 }), 30000);
  assert.equal(parseBoundedInteger('100', { defaultValue: 10000, min: 1000, max: 30000 }), 1000);
  assert.equal(parseBoundedInteger('abc', { defaultValue: 10000, min: 1000, max: 30000 }), 10000);
});

test('GET /api/admin/source-transport-matrix delegates only parsed allowlist IDs to service', async () => {
  const calls = [];
  const router = createAdminRouter({
    sourceTransportMatrixServiceImpl: {
      async runSourceTransportMatrix(options) {
        calls.push(options);
        return {
          ok: true,
          readOnly: true,
          mutatedCollections: [],
          generatedAt: '2026-06-05T12:00:00.000Z',
          runtime: {},
          summary: { resultCount: 0, usable: 0, blocked: 0, challenges: 0, unavailable: 0 },
          targetIds: options.targetIds,
          clientIds: options.clientIds,
          targets: [],
          results: [],
          readiness: [],
          retailers: [],
        };
      },
    },
  });
  const app = buildTestApp(router);

  const response = await requestJson(app, {
    path: '/api/admin/source-transport-matrix?targets=spar-productworld-inangebot,pagro-angebote&clients=global-fetch,curl&timeoutMs=60000&delayMs=99999',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.adminEndpoint.allowlistedTargetsOnly, true);
  assert.equal(response.body.adminEndpoint.freeUrlInputAllowed, false);
  assert.deepEqual(calls[0].targetIds, ['spar-productworld-inangebot', 'pagro-angebote']);
  assert.deepEqual(calls[0].clientIds, ['global-fetch', 'curl']);
  assert.equal(calls[0].timeoutMs, 30000);
  assert.equal(calls[0].delayMs, 5000);
  assert.equal(calls[0].maxCombinations, 20);
});

test('GET /api/admin/offer-feedback/summary liefert aggregierte Feedback-Kennzahlen', async (t) => {
  const adminKey = withAdminApiKey(t);
  const model = createSummaryOfferFeedbackModel();
  const router = createAdminRouter({ OfferFeedbackModel: model });
  const app = buildTestApp(router, { adminProtected: true });

  const response = await requestJson(app, {
    path: '/api/admin/offer-feedback/summary',
    headers: {
      'x-admin-api-key': adminKey,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.total, 4);
  assert.deepEqual(response.body.byStatus, [
    { status: 'new', count: 3 },
    { status: 'reviewing', count: 1 },
  ]);
  assert.deepEqual(response.body.byReason[0], { reason: 'category_wrong', count: 2 });
  assert.deepEqual(response.body.byRetailer, [
    { retailerKey: 'billa', retailerLabel: 'BILLA', count: 2 },
  ]);
  assert.deepEqual(response.body.bySourceType, [
    { sourceType: 'aktionsfinder-json', count: 2 },
  ]);
  assert.deepEqual(response.body.byQuery, [
    { query: 'Eis', count: 1 },
  ]);
  assert.deepEqual(response.body.categorySuggestions, [
    {
      currentCategoryPrimary: 'Katzenfutter',
      suggestedCategoryPrimary: 'Konserven',
      count: 2,
    },
  ]);
  assert.deepEqual(response.body.conditionIssueTypes, [
    { issueType: 'duplicate_or_conflicting', count: 1 },
  ]);
  assert.deepEqual(response.body.imageIssueTypes, [
    { issueType: 'missing_image', count: 1 },
  ]);
  assert.deepEqual(response.body.offerNonsenseIssueTypes, [
    { issueType: 'broken_title', count: 1 },
  ]);
  assert.deepEqual(response.body.searchResultIssueTypes, [
    { issueType: 'substring_false_positive', count: 1 },
  ]);
  assert.deepEqual(response.body.topReportedOffers, [
    {
      offerId: 'offer-123',
      title: 'Felix Felix Linsen mit Speck',
      retailerKey: 'billa',
      count: 2,
      reasons: ['category_wrong', 'condition_wrong'],
    },
  ]);
  assert.equal(JSON.stringify(response.body).includes('ADMIN_API_KEY'), false);
});

test('GET /api/admin/offer-feedback/recent liefert newest first, limitiert und sanitisiert', async (t) => {
  const adminKey = withAdminApiKey(t);
  const calls = {};
  const model = createRecentOfferFeedbackModel([recentFeedbackDoc()], calls);
  const router = createAdminRouter({ OfferFeedbackModel: model });
  const app = buildTestApp(router, { adminProtected: true });

  const response = await requestJson(app, {
    path: '/api/admin/offer-feedback/recent?limit=50',
    headers: {
      'x-admin-api-key': adminKey,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.count, 1);
  assert.equal(response.body.limit, 50);
  assert.deepEqual(calls.sort, { createdAt: -1 });
  assert.equal(calls.limit, 50);
  assert.equal(calls.lean, true);
  assert.equal(calls.projection.clientContext, undefined);
  assert.equal(calls.projection._id, 1);
  assert.equal(calls.projection.freeText, 1);
  assert.deepEqual(response.body.items[0].offerSnapshot, {
    title: 'Felix Felix Linsen mit Speck',
    retailerKey: 'billa',
    retailerLabel: 'BILLA',
    categoryPrimary: 'Katzenfutter',
    categorySecondary: 'Nassfutter',
    conditionsText: 'Gilt ab 2 Stueck',
    conditionBadges: ['Gilt ab 2 Stueck'],
    imagePresent: true,
    sourceType: 'aktionsfinder-json',
    sourceTypes: ['aktionsfinder-json'],
    priceCurrent: { amount: 1.99, currency: 'EUR' },
    quantity: '400 g',
    validityText: 'bis 31.05.',
  });
  assert.equal(response.body.items[0].pageContext.url, undefined);
  assert.equal(response.body.items[0].clientContext, undefined);
  assert.equal(response.body.items[0].ip, undefined);
  assert.equal(response.body.items[0].headers, undefined);
  assert.equal(response.body.items[0].structuredDetails.category_wrong.ignoredField, undefined);
  assert.equal(JSON.stringify(response.body).includes('203.0.113.10'), false);
  assert.equal(JSON.stringify(response.body).includes('Mozilla/5.0'), false);
  assert.equal(JSON.stringify(response.body).includes('session-hash-not-returned'), false);
  assert.equal(JSON.stringify(response.body).includes('secret'), false);
});

test('GET /api/admin/offer-feedback/recent begrenzt limit auf 200', async (t) => {
  const adminKey = withAdminApiKey(t);
  const calls = {};
  const model = createRecentOfferFeedbackModel([recentFeedbackDoc()], calls);
  const router = createAdminRouter({ OfferFeedbackModel: model });
  const app = buildTestApp(router, { adminProtected: true });

  const response = await requestJson(app, {
    path: '/api/admin/offer-feedback/recent?limit=9999',
    headers: {
      'x-admin-api-key': adminKey,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.limit, 200);
  assert.equal(calls.limit, 200);
});

test('GET /api/admin/offer-feedback/export begrenzt limit auf 1000 und bleibt sanitisiert', async (t) => {
  const adminKey = withAdminApiKey(t);
  const calls = {};
  const model = createRecentOfferFeedbackModel([recentFeedbackDoc()], calls);
  const router = createAdminRouter({ OfferFeedbackModel: model });
  const app = buildTestApp(router, { adminProtected: true });

  const response = await requestJson(app, {
    path: '/api/admin/offer-feedback/export?limit=5000',
    headers: {
      'x-admin-api-key': adminKey,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.limit, 1000);
  assert.equal(calls.limit, 1000);
  assert.equal(JSON.stringify(response.body).includes('203.0.113.10'), false);
  assert.equal(JSON.stringify(response.body).includes('session-hash-not-returned'), false);
});

test('PATCH /api/admin/offer-feedback/:feedbackId/status aktualisiert Status und Triage sanitisiert', async (t) => {
  const adminKey = withAdminApiKey(t);
  const calls = {};
  const model = createStatusOfferFeedbackModel({ calls });
  const router = createAdminRouter({ OfferFeedbackModel: model });
  const app = buildTestApp(router, { adminProtected: true });

  const response = await requestJson(app, {
    method: 'PATCH',
    path: '/api/admin/offer-feedback/feedback-123/status',
    headers: {
      'x-admin-api-key': adminKey,
    },
    body: {
      status: 'resolved',
      note: `${'x'.repeat(900)} secret`,
      rootCause: 'category-classifier-feedback-cluster',
      resolution: 'classifier-override-deployed',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.item.status, 'resolved');
  assert.equal(response.body.item.triage.updatedBy, 'codex-admin');
  assert.equal(response.body.item.triage.note.length, 800);
  assert.equal(calls.findByIdAndUpdate.length, 1);
  assert.equal(calls.findByIdAndUpdate[0].id, 'feedback-123');
  assert.equal(calls.findByIdAndUpdate[0].update.$set.status, 'resolved');
  assert.equal(calls.findByIdAndUpdate[0].update.$set.triage.rootCause, 'category-classifier-feedback-cluster');
  assert.equal(calls.findByIdAndUpdate[0].options.new, true);
});

test('PATCH /api/admin/offer-feedback/:feedbackId/status erlaubt duplicate als Triage-Status', async (t) => {
  const adminKey = withAdminApiKey(t);
  const calls = {};
  const model = createStatusOfferFeedbackModel({ calls });
  const router = createAdminRouter({ OfferFeedbackModel: model });
  const app = buildTestApp(router, { adminProtected: true });

  const response = await requestJson(app, {
    method: 'PATCH',
    path: '/api/admin/offer-feedback/feedback-123/status',
    headers: {
      'x-admin-api-key': adminKey,
    },
    body: {
      status: 'duplicate',
      rootCause: 'same-offer-image-cluster',
      resolution: 'duplicate-feedback',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.item.status, 'duplicate');
  assert.equal(calls.findByIdAndUpdate[0].update.$set.triage.resolution, 'duplicate-feedback');
});

test('PATCH /api/admin/offer-feedback/:feedbackId/status lehnt ungueltige Statuswerte ab', async (t) => {
  const adminKey = withAdminApiKey(t);
  const calls = {};
  const model = createStatusOfferFeedbackModel({ calls });
  const router = createAdminRouter({ OfferFeedbackModel: model });
  const app = buildTestApp(router, { adminProtected: true });

  const response = await requestJson(app, {
    method: 'PATCH',
    path: '/api/admin/offer-feedback/feedback-123/status',
    headers: {
      'x-admin-api-key': adminKey,
    },
    body: {
      status: 'closed',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.equal(calls.findByIdAndUpdate.length, 0);
});

test('parseBoundedLimit nutzt Default und Maximalwert deterministisch', () => {
  assert.equal(parseBoundedLimit(undefined, { defaultLimit: 50, maxLimit: 200 }), 50);
  assert.equal(parseBoundedLimit('0', { defaultLimit: 50, maxLimit: 200 }), 50);
  assert.equal(parseBoundedLimit('17', { defaultLimit: 50, maxLimit: 200 }), 17);
  assert.equal(parseBoundedLimit('999', { defaultLimit: 50, maxLimit: 200 }), 200);
});

test('POST /api/offer-feedback bleibt nach Admin-Read-Erweiterung unveraendert', async () => {
  const created = [];
  const app = express();

  app.use(express.json());
  app.use('/api/offer-feedback', createOfferFeedbackRouter({
    OfferFeedbackModel: {
      async create(payload) {
        created.push(payload);
        return {
          _id: 'feedback-1',
          status: payload.status,
        };
      },
    },
    rateLimitMiddleware: (req, res, next) => next(),
  }));

  const response = await requestJson(app, {
    method: 'POST',
    path: '/api/offer-feedback',
    body: {
      reasons: ['category_wrong'],
      offerRef: {
        offerId: 'offer-123',
      },
      offerSnapshot: {
        title: 'Felix Felix Linsen mit Speck',
        retailerKey: 'billa',
        retailerLabel: 'BILLA',
      },
    },
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body, {
    ok: true,
    feedbackId: 'feedback-1',
    status: 'new',
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].status, 'new');
});
