const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildCoverageBaselineDiagnostic,
  classifyCoffeeOffer,
  explainExclusion,
  isCurrentlyEligible,
  isSparOffer,
} = require('../src/services/diagnostics/coverageBaselineDiagnostic');

function offer(overrides = {}) {
  return {
    _id: overrides._id || 'offer-a',
    retailerKey: overrides.retailerKey || 'spar',
    retailerName: overrides.retailerName || 'SPAR',
    sourceRetailerFormat: overrides.sourceRetailerFormat || '',
    retailerFormatLabel: overrides.retailerFormatLabel || '',
    appliesToRetailerFormats: overrides.appliesToRetailerFormats || [],
    sourceId: overrides.sourceId || 'source-a',
    sourceType: overrides.sourceType || 'aktionsfinder-json',
    sourceUrl: 'https://example.test/offer',
    title: overrides.title || 'Meinl Praesident Kaffee 500 g',
    titleNormalized: overrides.titleNormalized || 'meinl praesident kaffee 500 g',
    brand: overrides.brand || 'Meinl',
    searchText: overrides.searchText || '',
    categoryPrimary: overrides.categoryPrimary || 'Getraenke',
    categorySecondary: overrides.categorySecondary || 'Kaffee & Tee',
    categoryKey: overrides.categoryKey || 'kaffee-tee',
    subcategoryKey: overrides.subcategoryKey || 'kaffee',
    comparisonGroup: overrides.comparisonGroup || 'meinl-praesident-kaffee-500-g',
    priceCurrent: overrides.priceCurrent || { amount: 5.99, currency: 'EUR' },
    normalizedUnitPrice: overrides.normalizedUnitPrice || { amount: 11.98, unit: 'kg', comparable: true },
    comparableUnit: overrides.comparableUnit || 'kg',
    quantityText: '500 g',
    validFrom: overrides.validFrom || new Date('2026-05-01T00:00:00.000Z'),
    validTo: overrides.validTo || new Date('2099-05-10T00:00:00.000Z'),
    status: overrides.status || 'active',
    isActiveNow: overrides.isActiveNow ?? true,
    isActiveToday: overrides.isActiveToday ?? true,
    quality: overrides.quality || { comparisonSafe: true },
    rawFacts: overrides.rawFacts || {},
    ...overrides,
  };
}

test('SPAR formats are recognized across retailer and format fields', () => {
  assert.equal(isSparOffer(offer({ retailerKey: 'spar' })), true);
  assert.equal(isSparOffer(offer({ retailerKey: 'other', retailerName: 'INTERSPAR' })), true);
  assert.equal(isSparOffer(offer({ retailerKey: 'other', retailerName: 'Other', appliesToRetailerFormats: ['eurospar'] })), true);
  assert.equal(isSparOffer(offer({ retailerKey: 'billa', retailerName: 'BILLA' })), false);
});

test('coffee classifier keeps named coffee offers and rejects plant side hits', () => {
  assert.equal(classifyCoffeeOffer(offer({ title: 'Tassimo Kapseln', titleNormalized: 'tassimo kapseln' })).classification, 'true');
  assert.equal(classifyCoffeeOffer(offer({ title: 'Dallmayr Prodomo Kaffee', titleNormalized: 'dallmayr prodomo kaffee' })).classification, 'true');
  assert.equal(classifyCoffeeOffer(offer({
    title: 'Kaffee Duftgeranie',
    titleNormalized: 'kaffee duftgeranie',
    categoryPrimary: 'Garten / Pflanzen',
    categorySecondary: 'Pflanzen',
    categoryKey: 'garten-pflanzen',
    subcategoryKey: 'pflanzen',
  })).classification, 'sideHit');
});

test('current eligibility accepts active current offers and rejects expired offers', () => {
  assert.equal(isCurrentlyEligible(offer()), true);
  assert.equal(isCurrentlyEligible(offer({
    status: 'expired',
    isActiveNow: false,
    isActiveToday: false,
    validTo: new Date('2020-01-01T00:00:00.000Z'),
  })), false);
});

test('exclusion explains SPAR category and missing price filters', () => {
  const wrongCategory = offer({ categoryKey: 'getraenke' });
  const missingPrice = offer({
    priceCurrent: { amount: null, currency: 'EUR' },
    normalizedUnitPrice: { amount: null, unit: '', comparable: false },
    comparableUnit: '',
  });

  assert.equal(explainExclusion({
    offer: wrongCategory,
    queryCase: 'spar-kaffee',
    rankingQuery: 'kaffee',
    classification: classifyCoffeeOffer(wrongCategory),
    finalRankedIds: new Set(),
    dedupedIds: new Set(),
  }), 'category-filter');
  assert.equal(explainExclusion({
    offer: missingPrice,
    queryCase: 'butter',
    rankingQuery: 'butter',
    classification: { classification: 'true' },
    finalRankedIds: new Set(),
    dedupedIds: new Set(),
  }), 'missing-price');
});

test('coverage report keeps read-only contract and per-case shape', () => {
  const report = buildCoverageBaselineDiagnostic({
    checkedAt: '2026-05-10T08:00:00.000Z',
    caseOffers: {
      butter: [],
      reis: [],
      'spar-kaffee': [offer()],
    },
    sources: [{ _id: 'source-a', label: 'SPAR Aktionen', sourceType: 'aggregator' }],
    rankings: {
      'spar-kaffee': {
        summary: { displayedCount: 0 },
        filters: { query: 'kaffee', retailers: ['spar'], categories: ['Kaffee & Tee'] },
        rankedOffers: [],
      },
    },
    sparSourceSummary: { activeOfferCount: 12 },
  });

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.performanceSafe, true);
  assert.equal(report.cases.length, 3);
  assert.equal(report.cases.find((item) => item.queryCase === 'spar-kaffee').likelyTrueProductCount, 1);
});
