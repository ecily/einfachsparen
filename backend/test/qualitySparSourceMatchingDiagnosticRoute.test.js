const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const env = require('../src/config/env');
const { requireAdminApiKey } = require('../src/middleware/adminAuth');
const { createQualityRouter } = require('../src/routes/quality.routes');
const {
  buildAggregatorOfferQuery,
  buildPdfOfferQuery,
  parseSparMatchingDiagnosticQuery,
  shapeSparSourceMatchingReport,
  summarizeSourceFieldCoverage,
} = require('../src/services/diagnostics/sparSourceMatchingDiagnosticRunner');

function requestJson(app, { path = '/api/quality/spar-source-matching-diagnostic', headers = {} } = {}) {
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
      request.end();
    });
  });
}

function buildTestApp(router, { adminProtected = true } = {}) {
  const app = express();
  app.use('/api/quality', adminProtected ? requireAdminApiKey : (req, res, next) => next(), router);
  app.use((error, req, res, next) => {
    res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message,
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

test('GET SPAR matching diagnostic is blocked by admin auth before service call', async (t) => {
  withAdminApiKey(t);
  let called = false;
  const router = createQualityRouter({
    sparMatchingDiagnosticServiceImpl: {
      async buildProductionSparSourceMatchingDiagnostic() {
        called = true;
        return {};
      },
    },
  });
  const app = buildTestApp(router);

  const response = await requestJson(app);

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.ok, false);
  assert.equal(called, false);
});

test('GET SPAR matching diagnostic forwards bounded query to read-only service', async (t) => {
  const adminKey = withAdminApiKey(t);
  const calls = [];
  const router = createQualityRouter({
    sparMatchingDiagnosticServiceImpl: {
      async buildProductionSparSourceMatchingDiagnostic(payload) {
        calls.push(payload);
        return {
          ok: true,
          readOnly: true,
          mutatedCollections: [],
          query: payload.query,
          totalPdfOffers: 1,
          totalAggregatorOffers: 2,
          fullMatchRowsReturned: false,
        };
      },
    },
  });
  const app = buildTestApp(router);

  const response = await requestJson(app, {
    path: '/api/quality/spar-source-matching-diagnostic?retailer=interspar&limitPdf=10&limitAggregator=20&maxExamples=3&includeSamples=false',
    headers: {
      'x-admin-api-key': adminKey,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.readOnly, true);
  assert.deepEqual(response.body.mutatedCollections, []);
  assert.equal(response.body.fullMatchRowsReturned, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query.retailer, 'interspar');
  assert.equal(calls[0].query.limitPdf, '10');
  assert.equal(calls[0].query.includeSamples, 'false');
});

test('SPAR matching query parser enforces safe defaults and caps', () => {
  assert.deepEqual(parseSparMatchingDiagnosticQuery({}), {
    retailer: 'all',
    limitPdf: 500,
    limitAggregator: 1500,
    maxExamples: 8,
    includeSamples: true,
  });

  assert.deepEqual(parseSparMatchingDiagnosticQuery({
    retailer: 'unknown',
    limitPdf: '999999',
    limitAggregator: '999999',
    maxExamples: '999',
    includeSamples: 'false',
  }), {
    retailer: 'all',
    limitPdf: 1500,
    limitAggregator: 5000,
    maxExamples: 25,
    includeSamples: false,
  });
});

test('SPAR matching offer queries are read-only source filters with active offer scope', () => {
  const now = new Date('2026-05-28T12:00:00.000Z');
  const pdfQuery = buildPdfOfferQuery({ retailer: 'spar', now });
  const aggregatorQuery = buildAggregatorOfferQuery({ retailer: 'all', now });

  assert.equal(JSON.stringify(pdfQuery).includes('$set'), false);
  assert.equal(JSON.stringify(pdfQuery).includes('spar-official-pdf'), true);
  assert.equal(JSON.stringify(pdfQuery).includes('spar-official-flyer-pdf'), true);
  assert.equal(JSON.stringify(aggregatorQuery).includes('aktionsfinder-json'), true);
  assert.equal(JSON.stringify(aggregatorQuery).includes('aktionsfinder-spar'), true);
  assert.deepEqual(pdfQuery.$and[0], { retailerKey: 'spar' });
  assert.deepEqual(aggregatorQuery.$and[0], { retailerKey: { $in: ['spar', 'interspar', 'eurospar'] } });
});

test('SPAR matching report shaping limits examples and omits full match rows', () => {
  const report = {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    summary: { unsafeExamples: 3 },
    matches: [{ id: 'full-row-not-returned' }],
    unsafeExamples: [{ id: 1 }, { id: 2 }, { id: 3 }],
    topStrongExamples: [{ id: 's1' }, { id: 's2' }],
    topMediumExamples: [{ id: 'm1' }],
    topNoMatchExamples: [{ id: 'n1' }],
    topRejectedCandidateSamples: [{ reason: 'generic-missing-quantity', snippet: 'short' }],
  };

  const shaped = shapeSparSourceMatchingReport(report, {
    includeSamples: true,
    maxExamples: 1,
    query: { retailer: 'all' },
    fieldCoverage: {},
    productionRejectionReasonHistogram: { 'generic-missing-quantity': 7 },
  });

  assert.equal(shaped.matches, undefined);
  assert.equal(shaped.unsafeExamples, 3);
  assert.equal(shaped.topUnsafeExamples.length, 1);
  assert.equal(shaped.topStrongExamples.length, 1);
  assert.equal(shaped.topRejectedCandidateSamples.length, 1);
  assert.equal(shaped.rejectionEvidenceAvailable, true);
  assert.equal(shaped.productionRejectionReasonHistogram['generic-missing-quantity'], 7);
  assert.equal(JSON.stringify(shaped).includes('full-row-not-returned'), false);
});

test('SPAR matching field coverage reports source and data field availability compactly', () => {
  const coverage = summarizeSourceFieldCoverage([
    {
      retailerKey: 'spar',
      sourceType: 'aktionsfinder-json',
      rawFacts: {},
      title: 'Milch',
      priceCurrent: { amount: 1.29 },
      quantityText: '1 l',
      validTo: new Date('2026-05-29T00:00:00.000Z'),
      categoryKey: 'milch',
      imageUrl: 'https://img.example/milch.jpg',
    },
    {
      retailerKey: 'spar',
      rawFacts: { sourceKey: 'spar-official-flyer-pdf' },
      title: '',
      priceCurrent: {},
    },
  ]);

  assert.equal(coverage.total, 2);
  assert.equal(coverage.sourceKey, 1);
  assert.equal(coverage.sourceType, 1);
  assert.equal(coverage.title, 1);
  assert.equal(coverage.priceCurrent, 1);
  assert.equal(coverage.quantity, 1);
  assert.equal(coverage.validity, 1);
  assert.equal(coverage.category, 1);
  assert.equal(coverage.imageUrl, 1);
});
