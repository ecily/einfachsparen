const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSearchCoverageDiagnostic,
  buildSearchCoverageTermReport,
} = require('../src/services/diagnostics/searchCoverageDiagnostic');

function offer(overrides = {}) {
  return {
    _id: overrides._id || 'offer-1',
    title: overrides.title || 'Kaffee 500 g',
    retailerKey: overrides.retailerKey || 'spar',
    retailerName: overrides.retailerName || 'SPAR',
    sourceType: overrides.sourceType || 'spar-official-pdf',
    sourceUrl: overrides.sourceUrl || 'https://flugblatt.spar.at/test/getPdf.ashx',
    priceCurrent: { amount: 4.99 },
    validTo: overrides.validTo,
    rawFacts: overrides.rawFacts || {},
    ...overrides,
  };
}

test('search coverage counts official, official flyer, aggregator validity and low-confidence exclusions', () => {
  const official = offer({ _id: 'official', sourceType: 'billa-official-algolia', sourceUrl: 'https://www.billa.at/unsere-aktionen/aktionen' });
  const officialFlyer = offer({ _id: 'flyer', sourceType: 'spar-official-pdf' });
  const aggregatorWithValidity = offer({
    _id: 'agg-valid',
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/ppcv/bier/spar/',
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  });
  const lowConfidence = offer({
    _id: 'agg-low',
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/ppcv/bier/spar/',
    validTo: null,
  });

  const report = buildSearchCoverageTermReport({
    query: 'bier',
    ranking: {
      summary: { totalCount: 3, displayedCount: 3, resultSetToken: 'token-1', hasMore: true, nextOffset: 3 },
      rankedOffers: [official, officialFlyer, aggregatorWithValidity],
    },
    candidates: [official, officialFlyer, aggregatorWithValidity, lowConfidence],
  });

  assert.equal(report.totalCount, 3);
  assert.equal(report.displayedCount, 3);
  assert.equal(report.officialCount, 1);
  assert.equal(report.officialFlyerCount, 1);
  assert.equal(report.aggregatorWithValidityCount, 1);
  assert.equal(report.aggregatorPpcvLowConfidenceCount, 1);
  assert.equal(report.excludedLowConfidenceCount, 1);
  assert.equal(report.resultSetTokenVisible, true);
  assert.equal(report.hasMore, true);
});

test('search coverage summary identifies zero displayed, no official coverage and low-confidence terms', () => {
  const report = buildSearchCoverageDiagnostic({
    terms: ['milch', 'bier'],
    reports: [
      buildSearchCoverageTermReport({ query: 'milch', ranking: { summary: { totalCount: 0, displayedCount: 0 }, rankedOffers: [] }, candidates: [] }),
      buildSearchCoverageTermReport({
        query: 'bier',
        ranking: {
          summary: { totalCount: 1, displayedCount: 1 },
          rankedOffers: [offer({ sourceType: 'aktionsfinder-json', sourceUrl: 'https://www.aktionsfinder.at/l/spar-flugblatt-21-05-2026-02-06-2026/' })],
        },
        candidates: [offer({ sourceType: 'aktionsfinder-json', sourceUrl: 'https://www.aktionsfinder.at/ppcv/bier/spar/', validTo: null })],
      }),
    ],
  });

  assert.deepEqual(report.summary.termsWithZeroDisplayed, ['milch']);
  assert.deepEqual(report.summary.termsWithoutOfficialCoverage, ['bier']);
  assert.deepEqual(report.summary.termsWithLowConfidenceExclusions, [
    { query: 'bier', excludedLowConfidenceCount: 1 },
  ]);
});
