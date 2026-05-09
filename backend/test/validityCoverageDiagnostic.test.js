const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildValidityCoverageDiagnostic,
  inferRecoverability,
} = require('../src/services/diagnostics/validityCoverageDiagnostic');

function offer(overrides = {}) {
  return {
    _id: overrides._id || Math.random().toString(16).slice(2),
    sourceId: overrides.sourceId || 'source-a',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    sourceType: 'billa-official-algolia',
    title: 'Ja Natuerlich Bio Milch',
    sourceUrl: 'https://shop.billa.at/aktionen',
    validFrom: null,
    validTo: null,
    rawFacts: {},
    parserVersion: 'test-parser',
    ...overrides,
  };
}

test('aggregates validity coverage by retailer and sourceType', () => {
  const report = buildValidityCoverageDiagnostic({
    offers: [
      offer({
        _id: 'billa-present',
        sourceType: 'billa-official-algolia',
        validFrom: new Date('2026-05-01T00:00:00Z'),
        validTo: new Date('2026-05-08T23:59:59Z'),
      }),
      offer({
        _id: 'billa-missing',
        sourceType: 'billa-official-algolia',
      }),
      offer({
        _id: 'penny-present',
        retailerKey: 'penny',
        retailerName: 'PENNY',
        sourceType: 'penny-official-html',
        validFrom: new Date('2026-05-07T00:00:00Z'),
        validTo: new Date('2026-05-12T23:59:59Z'),
      }),
    ],
    generatedAt: '2026-05-08T12:00:00.000Z',
  });
  const billa = report.rows.find((row) => row.retailerKey === 'billa' && row.sourceType === 'billa-official-algolia');
  const penny = report.rows.find((row) => row.retailerKey === 'penny' && row.sourceType === 'penny-official-html');

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.summary.totalOffersAnalyzed, 3);
  assert.equal(billa.offerCount, 2);
  assert.equal(billa.bothValidityPresentPct, 50);
  assert.equal(penny.bothValidityPresentPct, 100);
});

test('detects recoverable-from-validityLabel from explicit German date text', () => {
  const result = inferRecoverability({
    offer: offer({
      rawFacts: {
        validityText: 'gueltig von 01.05.2026 bis 08.05.2026',
      },
    }),
  });

  assert.equal(result, 'recoverable-from-validityLabel');
});

test('detects recoverable-from-source-title from flyer title or URL', () => {
  const result = inferRecoverability({
    offer: offer({ sourceId: 'source-flyer' }),
    source: {
      _id: 'source-flyer',
      label: 'Flugblatt Do 07.05. bis Di 12.05.2026',
      sourceUrl: 'https://example.test/flyer-07-05-2026-12-05-2026',
    },
  });

  assert.equal(result, 'recoverable-from-source-title');
});

test('empty fields do not crash and remain not safely recoverable', () => {
  const report = buildValidityCoverageDiagnostic({
    offers: [
      {
        _id: 'empty',
        retailerKey: 'dm',
        sourceType: 'wogibtswas-html',
        rawFacts: null,
      },
    ],
    sources: [{}],
    rawDocuments: [{}],
  });
  const row = report.rows[0];

  assert.equal(row.retailerKey, 'dm');
  assert.equal(row.validFromPresentPct, 0);
  assert.equal(row.validToPresentPct, 0);
  assert.equal(row.likelyRecoverable[0].status, 'not-safely-recoverable');
});

test('diagnostic remains read-only and records no mutated collections', () => {
  const report = buildValidityCoverageDiagnostic({
    offers: [
      offer({
        validFrom: new Date('2026-05-01T00:00:00Z'),
        validTo: new Date('2026-05-08T23:59:59Z'),
      }),
    ],
  });

  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
});
