const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CHECKED_RETAILERS,
  INACTIVE_OFFICIAL_CONTEXT,
  buildCoverageFromOffers,
  buildRetailerReport,
  calculateCompletenessScore,
  classifyRisks,
  detectConditionSignal,
  detectQuantitySignal,
  detectValiditySignal,
  hasUsablePrice,
  pct,
} = require('../src/services/diagnostics/officialValidityCoverageDiagnostic');

function offer(overrides = {}) {
  return {
    _id: 'offer-1',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    sourceType: 'billa-official-algolia',
    sourceUrl: 'https://www.billa.at/unsere-aktionen/aktionen',
    title: 'Ja Natuerlich Bio Milch 1 l',
    categoryKey: 'milchprodukte',
    categoryPrimary: 'Milchprodukte',
    comparisonGroup: 'milch',
    priceCurrent: { amount: 1.29, currency: 'EUR', originalText: '1,29' },
    quantityText: '1 l',
    unitType: 'l',
    normalizedUnitPrice: { amount: 1.29, unit: 'l', comparable: true },
    validFrom: new Date('2026-05-01T00:00:00Z'),
    validTo: new Date('2026-05-20T00:00:00Z'),
    conditionsText: '',
    hasConditions: false,
    customerProgramRequired: false,
    minimumPurchaseQty: 1,
    isMultiBuy: false,
    rawFacts: {},
    ...overrides,
  };
}

test('coverage ratio calculation is stable', () => {
  assert.equal(pct(2, 4), 50);
  assert.equal(pct(1, 3), 33.3);
  assert.equal(pct(1, 0), 0);
});

test('detects validity signals and uncertainty conservatively', () => {
  const present = detectValiditySignal(offer(), new Date('2026-05-10T00:00:00Z'));
  const missing = detectValiditySignal(offer({ validFrom: null, validTo: null }), new Date('2026-05-10T00:00:00Z'));
  const labeled = detectValiditySignal(offer({ validFrom: null, validTo: null, rawFacts: { validityText: 'gueltig bis 20.05.2026' } }));

  assert.equal(present.bothValidFromToPresent, true);
  assert.equal(present.activeNowApprox, true);
  assert.equal(missing.noValiditySignal, true);
  assert.equal(missing.uncertainValidity, true);
  assert.equal(labeled.validityLabelPresent, true);
  assert.equal(labeled.noValiditySignal, false);
});

test('detects price signals and invalid prices', () => {
  assert.equal(hasUsablePrice(offer({ priceCurrent: { amount: 1.99 } })), true);
  assert.equal(hasUsablePrice(offer({ priceCurrent: { amount: 0 } })), false);

  const coverage = buildCoverageFromOffers([
    offer({ priceCurrent: { amount: 1.99 } }),
    offer({ priceCurrent: { amount: 0 } }),
  ]);

  assert.equal(coverage.price.priceCurrentAmountPresentCount, 1);
  assert.equal(coverage.price.noUsablePriceCount, 1);
  assert.equal(coverage.price.zeroOrInvalidPriceCount, 1);
});

test('detects quantity and condition signals', () => {
  const quantity = detectQuantitySignal(offer({ quantityText: '500 g', unitType: 'g', normalizedUnitPrice: { amount: 3.98, unit: 'kg' } }));
  const condition = detectConditionSignal(offer({
    conditionsText: '2 fuer 1 nur mit App',
    customerProgramRequired: false,
    minimumPurchaseQty: 2,
    isMultiBuy: false,
  }));

  assert.equal(quantity.quantityTextPresent, true);
  assert.equal(quantity.unitPresent, true);
  assert.equal(quantity.normalizedUnitPricePresent, true);
  assert.equal(condition.conditionsTextPresent, true);
  assert.equal(condition.customerProgramRequired, true);
  assert.equal(condition.minimumPurchaseQtyPresent, true);
  assert.equal(condition.multiBuyCondition, true);
});

test('risk classification maps weak fields to diagnostic risks and actions', () => {
  const coverage = buildCoverageFromOffers([
    offer({ validFrom: null, validTo: null, priceCurrent: { amount: null }, quantityText: '', unitType: '', normalizedUnitPrice: {} }),
    offer({ validFrom: null, validTo: null, priceCurrent: { amount: null }, quantityText: '', unitType: '', normalizedUnitPrice: {} }),
  ]);
  const risks = classifyRisks(coverage, { retailerKey: 'billa', hasAggregator: true, sourceKey: 'billa-official-algolia' });

  assert.equal(risks.includes('missing-validity'), true);
  assert.equal(risks.includes('missing-price'), true);
  assert.equal(risks.includes('missing-quantity'), true);
  assert.equal(risks.includes('retailer-scope-risk'), true);
  assert.equal(risks.includes('official-weaker-than-aggregator'), true);
});

test('completeness score is explicitly diagnostic only', () => {
  const score = calculateCompletenessScore(offer());

  assert.equal(score.diagnosticOnly, true);
  assert.equal(score.totalChecks, 7);
  assert.ok(score.score > 0);
});

test('SPAR and PAGRO remain inactive context only', () => {
  assert.deepEqual(CHECKED_RETAILERS.map((retailer) => retailer.retailerKey), [
    'billa',
    'billa-plus',
    'hofer',
    'dm',
    'bipa',
    'lidl',
    'penny',
  ]);
  assert.equal(INACTIVE_OFFICIAL_CONTEXT.some((item) => item.retailerKey === 'spar'), true);
  assert.equal(INACTIVE_OFFICIAL_CONTEXT.some((item) => item.retailerKey === 'pagro'), true);
});

test('retailer report emits examples without raw documents', () => {
  const report = buildRetailerReport({
    retailer: { retailerKey: 'billa', displayName: 'BILLA' },
    offers: [
      offer(),
      offer({ _id: 'weak', validFrom: null, validTo: null, rawFacts: {}, title: 'Aktion' }),
      offer({ _id: 'no-price', priceCurrent: { amount: null } }),
      offer({ _id: 'aggregator', sourceType: 'aktionsfinder-json', priceCurrent: { amount: 1.29 } }),
    ],
    now: new Date('2026-05-10T00:00:00Z'),
  });
  const source = report.sourceBreakdown[0];

  assert.equal(report.coverage.totalOffers, 4);
  assert.equal(report.coverage.officialOfferCount, 3);
  assert.equal(report.coverage.aggregatorOfferCount, 1);
  assert.ok(source.examplesGood.length <= 5);
  assert.equal(Object.prototype.hasOwnProperty.call(source.examplesGood[0], 'rawFacts'), false);
});
