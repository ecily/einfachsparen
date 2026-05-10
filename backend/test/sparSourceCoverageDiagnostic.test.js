const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assessOfficialSparSteiermarkCoverage,
  buildSparSourceCoverageDiagnostic,
  deriveSourceKey,
  getSparCodeSources,
  inferLikelyRootCause,
  mapCodeSource,
  summarizeOffer,
} = require('../src/services/diagnostics/sparSourceCoverageDiagnostic');

test('maps SPAR code sources with activation and parser hints', () => {
  const source = mapCodeSource({
    retailerKey: 'spar',
    retailerName: 'Spar',
    channel: 'official-flyer',
    sourceUrl: 'https://www.spar.at/aktionen',
    enabled: false,
    latestStatus: 'inactive',
    disabledReason: 'disabled-source-blocked',
    sourceRetailerFormat: 'spar',
    appliesToRetailerFormats: ['spar', 'interspar', 'eurospar'],
  });

  assert.equal(source.sourceKey, 'spar-official-flyer');
  assert.equal(source.appearsActive, false);
  assert.match(source.parserOrAdapter, /no SPAR-specific/i);
  assert.deepEqual(source.retailerKeys, ['spar', 'interspar', 'eurospar']);
});

test('SPAR source definitions include active aggregators and disabled official flyer', () => {
  const sources = getSparCodeSources();
  const keys = sources.map((source) => source.sourceKey);

  assert.ok(keys.includes('aktionsfinder-spar'));
  assert.ok(keys.includes('aktionsfinder-interspar'));
  assert.ok(keys.includes('aktionsfinder-eurospar'));
  assert.ok(keys.includes('spar-official-flyer'));
  assert.equal(sources.find((source) => source.sourceKey === 'spar-official-flyer').appearsActive, false);
});

test('official SPAR Steiermark reference is recognized as missing exact URL but covered by generic actions entry', () => {
  const coverage = assessOfficialSparSteiermarkCoverage(getSparCodeSources());

  assert.equal(coverage.referenceUrl, 'https://www.spar.at/aktionen/steiermark');
  assert.equal(coverage.exactSourceExistsInCode, false);
  assert.equal(coverage.equivalentOfficialActionEntryExistsInCode, true);
  assert.equal(coverage.currentApplication, 'generic-official-spar-actions-entry-present');
  assert.equal(coverage.suitabilityForFutureSupplementalSource.suitable, true);
});

test('official SPAR Steiermark exact URL is detected when configured', () => {
  const coverage = assessOfficialSparSteiermarkCoverage([
    {
      sourceKey: 'spar-official-steiermark-actions',
      channel: 'official-flyer',
      sourceUrl: 'https://www.spar.at/aktionen/steiermark',
      appearsActive: true,
    },
  ]);

  assert.equal(coverage.exactSourceExistsInCode, true);
  assert.equal(coverage.currentApplication, 'exact-url-present');
});

test('root cause prefers disabled official SPAR source when aggregators have sparse coffee coverage', () => {
  const cause = inferLikelyRootCause({
    sparOffersInDb: 120,
    sparCoffeeOffersInDb: 1,
    activeSparOffersApprox: 80,
    activeSparCoffeeOffersApprox: 1,
    codeSources: [
      { channel: 'aggregator', appearsActive: true },
      { channel: 'official-flyer', appearsActive: false },
    ],
  });

  assert.equal(cause, 'source-disabled');
});

test('root cause detects category and wrong-retailer candidates', () => {
  assert.equal(inferLikelyRootCause({
    sparOffersInDb: 20,
    sparCoffeeOffersInDb: 0,
    activeSparOffersApprox: 10,
    possibleWrongRetailerCandidates: [{ title: 'Tassimo' }],
    codeSources: [{ channel: 'official-flyer', appearsActive: true }],
  }), 'wrong-retailer-mapping');

  assert.equal(inferLikelyRootCause({
    sparOffersInDb: 20,
    sparCoffeeOffersInDb: 5,
    activeSparOffersApprox: 10,
    activeSparCoffeeOffersApprox: 1,
    possibleMisclassifiedCoffeeCandidates: [{ title: 'Meinl' }, { title: 'Dallmayr' }],
    codeSources: [{ channel: 'official-flyer', appearsActive: true }],
  }), 'wrong-category');
});

test('report keeps read-only contract and requested JSON shape', () => {
  const report = buildSparSourceCoverageDiagnostic({
    checkedAt: '2026-05-10T12:00:00.000Z',
    codeSources: [
      {
        channel: 'aggregator',
        appearsActive: true,
        sourceKey: deriveSourceKey({ channel: 'aggregator', retailerKey: 'spar', sourceRetailerFormat: 'spar', sourceUrl: 'https://www.aktionsfinder.at/pv/spar/' }),
      },
      { channel: 'official-flyer', appearsActive: false, disabledReason: 'disabled-source-blocked', notes: '403' },
    ],
    db: {
      sparOffersInDb: 12,
      sparCoffeeOffersInDb: 0,
      activeSparOffersApprox: 10,
      activeSparCoffeeOffersApprox: 0,
      dbSourceBreakdown: [],
      dbCategoryBreakdown: [],
    },
  });

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.retailer, 'spar');
  assert.equal(report.summary.likelyRootCause, 'source-disabled');
  assert.ok(Array.isArray(report.codeSources));
  assert.ok(Array.isArray(report.recommendedNextActions));
});

test('offer summary keeps source and validity fields compact', () => {
  const summary = summarizeOffer({
    _id: 'abc',
    title: 'Meinl Praesident Kaffee',
    retailerKey: 'spar',
    sourceType: 'aktionsfinder-json',
    sourceId: 'source-a',
    validTo: new Date('2026-05-13T12:00:00.000Z'),
    priceCurrent: { amount: 5.99 },
    normalizedUnitPrice: { amount: 11.98, unit: 'kg', comparable: true },
    quality: { comparisonSafe: true },
    rawFacts: { sourceKey: 'aktionsfinder-spar' },
  });

  assert.equal(summary.id, 'abc');
  assert.equal(summary.sourceKey, 'aktionsfinder-spar');
  assert.equal(summary.validTo, '2026-05-13');
  assert.equal(summary.priceCurrent, 5.99);
  assert.equal(summary.comparisonSafe, true);
});
