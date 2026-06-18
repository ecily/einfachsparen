const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPublicVisibilityDiagnostics,
  _private,
} = require('../src/services/diagnostics/publicVisibilityDiagnostics');

function createOfferModel(docs, calls = {}) {
  calls.find = [];

  return {
    find(match) {
      calls.find.push({ match });

      return {
        select(fields) {
          calls.select = fields;
          return this;
        },
        sort(sort) {
          calls.sort = sort;
          return this;
        },
        limit(limit) {
          calls.limit = limit;
          return this;
        },
        async lean() {
          return docs.slice(0, calls.limit);
        },
      };
    },
  };
}

function baseOffer(overrides = {}) {
  return {
    _id: overrides._id || 'offer-1',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    sourceRetailerFormat: 'spar',
    appliesToRetailerFormats: ['spar'],
    title: 'SPAR Beispiel Angebot',
    sourceType: 'spar-official-pdf',
    sourceTypes: ['spar-official-pdf', 'official-flyer'],
    sourceUrl: 'https://flugblatt.spar.at/source.pdf',
    status: 'active',
    isActiveNow: true,
    validFrom: new Date('2026-06-01T00:00:00.000Z'),
    validTo: new Date('2026-06-30T21:59:59.999Z'),
    publishStatus: 'crawl-run-success',
    sourceRunStatus: 'success',
    lastSeenAt: new Date('2026-06-18T10:00:00.000Z'),
    lastSeenRunId: 'run-1',
    crawlJobId: 'job-1',
    quality: { comparisonSafe: true },
    normalizedUnitPrice: { amount: 1.99, comparable: true },
    comparableUnit: 'kg',
    comparisonGroup: 'spar-example',
    customerProgramRequired: false,
    conditionsText: '',
    priceCurrent: { amount: 1.99 },
    quantityText: '1 kg',
    unitValue: 1,
    totalComparableAmount: 1,
    rawFacts: {
      sourceKey: 'spar-official-flyer-pdf',
      validityText: 'gueltig bis 30.06.2026',
      validitySource: 'pdf',
    },
    createdAt: new Date('2026-06-18T10:00:00.000Z'),
    updatedAt: new Date('2026-06-18T10:00:00.000Z'),
    ...overrides,
  };
}

test('public visibility diagnostics counts SPAR freshness rejects and keeps examples sanitized', async () => {
  const now = new Date('2026-06-18T12:00:00.000Z');
  const docs = [
    baseOffer({
      _id: 'expired-offer',
      title: 'SPAR expired offer',
      validTo: new Date('2026-06-10T21:59:59.999Z'),
    }),
    baseOffer({
      _id: 'stale-aggregator-offer',
      title: 'SPAR stale aggregator offer',
      sourceType: 'aktionsfinder-json',
      sourceTypes: ['aktionsfinder-json'],
      sourceUrl: 'https://www.aktionsfinder.at/ppcv/spar/example',
      validTo: null,
      publishStatus: 'retained',
      lastSeenAt: new Date('2026-06-18T08:00:00.000Z'),
      rawFacts: {
        sourceKey: 'aktionsfinder-spar',
        validityText: '',
      },
    }),
    baseOffer({
      _id: 'fresh-offer',
      title: 'SPAR fresh offer',
    }),
  ];
  const calls = {};
  const OfferModel = createOfferModel(docs, calls);
  const rankingService = {
    async buildOfferRanking(args) {
      calls.rankingArgs = args;
      return { summary: { resultCount: 1 } };
    },
  };

  const report = await buildPublicVisibilityDiagnostics({
    retailers: 'spar',
    OfferModel,
    rankingService,
    now,
  });
  const spar = report.retailers[0];

  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.equal(spar.candidateCount, 3);
  assert.equal(spar.publicResultCount, 1);
  assert.equal(spar.stageCounts.afterFreshnessFilter, 1);
  assert.equal(spar.stageCounts.afterProgramEligibility, 1);
  assert.equal(spar.rejectReasonCounts['validTo-expired'], 1);
  assert.equal(spar.rejectReasonCounts['stale-retained-aggregator-without-public-freshness'], 1);
  assert.equal(spar.rejectExamples.length, 2);
  assert.equal(spar.rejectExamples[0].offerReference, 'expired-offer');
  assert.equal(spar.rejectExamples[0].sourceKey, 'spar-official-flyer-pdf');
  assert.equal(spar.rejectExamples[0].sourceUrl, undefined);
  assert.equal(spar.rejectExamples[0].freshness.hasValidityEvidence, true);
  assert.equal(spar.rejectExamples[1].officialOrAggregator, 'aggregator');
  assert.equal(spar.rejectExamples[1].freshness.sourceClass, 'aggregator-ppcv');
  assert.equal(spar.rejectExamplesByReason['validTo-expired'][0].offerReference, 'expired-offer');
  assert.equal(
    spar.rejectExamplesByReason['stale-retained-aggregator-without-public-freshness'][0].offerReference,
    'stale-aggregator-offer'
  );
  assert.equal(calls.limit, _private.CANDIDATE_LIMIT);
  assert.equal(calls.rankingArgs.retailers, 'spar');
  assert.equal(calls.rankingArgs.limit, 'all');
});

test('public visibility diagnostics rejects unsupported retailers', async () => {
  await assert.rejects(
    () => buildPublicVisibilityDiagnostics({
      retailers: 'pagro',
      OfferModel: createOfferModel([]),
      rankingService: { async buildOfferRanking() { return { summary: { resultCount: 0 } }; } },
    }),
    /Unsupported retailer/
  );
});

test('collectFreshnessRejectReasons exposes secondary causes deterministically', () => {
  const reasons = _private.collectFreshnessRejectReasons(baseOffer({
    status: 'expired',
    isActiveNow: false,
    validTo: new Date('2026-06-01T00:00:00.000Z'),
  }), new Date('2026-06-18T12:00:00.000Z'));

  assert.deepEqual(reasons.slice(0, 3), [
    'status-not-active',
    'isActiveNow-false',
    'validTo-expired',
  ]);
});
