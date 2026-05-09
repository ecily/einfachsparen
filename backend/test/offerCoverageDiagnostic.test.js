const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildOfferCoverageDiagnostic,
  offerMatchesCategory,
} = require('../src/services/diagnostics/offerCoverageDiagnostic');

function offer(overrides = {}) {
  return {
    _id: overrides._id || Math.random().toString(16).slice(2),
    sourceId: overrides.sourceId || 'source-aktionsfinder',
    retailerKey: 'spar',
    retailerName: 'Spar',
    title: 'REGIO Gold 500 g',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    categoryKey: 'kaffee-tee',
    subcategoryKey: 'kaffee-tee',
    sourceType: 'aktionsfinder-json',
    sourceTypes: ['aktionsfinder-json', 'aggregator'],
    status: 'active',
    isActiveNow: true,
    isActiveToday: true,
    validFrom: new Date('2026-05-08T00:00:00Z'),
    validTo: new Date('2026-05-09T23:59:59Z'),
    priceCurrent: { amount: 5.99 },
    quantityText: '500 g',
    normalizedUnitPrice: { amount: 11.98, unit: 'kg', comparable: true },
    conditionsText: '',
    customerProgramRequired: false,
    hasConditions: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    ...overrides,
  };
}

test('matches Kaffee & Tee as one category label across keys and labels', () => {
  assert.equal(offerMatchesCategory(offer(), { categoryLabel: 'Kaffee & Tee' }), true);
  assert.equal(offerMatchesCategory(offer({ categoryKey: '', subcategoryKey: '', categorySecondary: 'Kaffee & Tee' }), { categoryLabel: 'Kaffee & Tee' }), true);
});

test('builds read-only offer coverage diagnostics for target retailer/category combinations', () => {
  const report = buildOfferCoverageDiagnostic({
    generatedAt: new Date('2026-05-09T12:00:00Z'),
    sources: [
      {
        _id: 'source-aktionsfinder',
        retailerKey: 'spar',
        channel: 'aggregator',
        sourceType: 'aggregator',
        label: 'Aktionsfinder SPAR Aktionen',
      },
      {
        _id: 'source-official',
        retailerKey: 'billa',
        channel: 'official-site',
        sourceType: 'billa-official-algolia',
        label: 'BILLA Aktionen',
      },
    ],
    offers: [
      offer({ _id: 'spar-regio' }),
      offer({
        _id: 'spar-tassimo-program',
        title: 'Tassimo Kaffeekapseln',
        customerProgramRequired: true,
        hasConditions: true,
        conditionsText: 'nur mit App',
      }),
      offer({
        _id: 'billa-coffee',
        sourceId: 'source-official',
        retailerKey: 'billa',
        retailerName: 'BILLA',
        title: 'Dallmayr Prodomo 500 g',
        sourceType: 'billa-official-algolia',
      }),
    ],
  });
  const sparCoffee = report.combinations.find((item) => item.id === 'spar-kaffee-tee');
  const billaCoffee = report.combinations.find((item) => item.id === 'billa-kaffee-tee');

  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(sparCoffee.counts.afterRetailerAndCategoryFilter, 2);
  assert.equal(sparCoffee.counts.customerProgramRequiredOffers, 1);
  assert.equal(sparCoffee.counts.aggregatorSources, 2);
  assert.equal(sparCoffee.counts.withValidFromAndValidTo, 2);
  assert.equal(billaCoffee.counts.officialSources, 1);
});

test('warns when an important combination is suspiciously low', () => {
  const report = buildOfferCoverageDiagnostic({
    generatedAt: new Date('2026-05-09T12:00:00Z'),
    offers: [
      offer({ _id: 'spar-only-one' }),
    ],
  });
  const sparCoffee = report.combinations.find((item) => item.id === 'spar-kaffee-tee');

  assert.equal(
    sparCoffee.warnings.some((warning) => warning.code === 'low-retailer-category-coverage'),
    true
  );
});
