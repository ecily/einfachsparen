const assert = require('node:assert/strict');
const test = require('node:test');
const {
  OFFICIAL_RETAILERS,
  assessStructure,
  buildCoverageRatios,
  classifySourceKind,
  getRetailerConfigs,
  isBlockedLikely,
  normalizeCodeSource,
  pct,
} = require('../src/services/diagnostics/officialSourceMatrixDiagnostic');

test('official retailer configuration covers requested source matrix targets', () => {
  const keys = OFFICIAL_RETAILERS.map((retailer) => retailer.retailerKey);

  assert.deepEqual(keys, [
    'spar',
    'billa',
    'billa-plus',
    'hofer',
    'dm',
    'bipa',
    'lidl',
    'pagro',
    'penny',
  ]);
  assert.ok(OFFICIAL_RETAILERS.find((retailer) => retailer.retailerKey === 'spar').officialUrls.includes('https://www.spar.at/aktionen/steiermark'));
  assert.ok(OFFICIAL_RETAILERS.find((retailer) => retailer.retailerKey === 'pagro').officialUrls.includes('https://www.pagro.at/angebote'));
});

test('classifies source kind as official aggregator marketplace or unknown', () => {
  assert.equal(classifySourceKind({ channel: 'official-site', sourceUrl: 'https://www.billa.at/unsere-aktionen/aktionen' }), 'official');
  assert.equal(classifySourceKind({ channel: 'aggregator', sourceUrl: 'https://www.aktionsfinder.at/pv/billa/' }), 'aggregator');
  assert.equal(classifySourceKind({ channel: 'aggregator', sourceUrl: 'https://www.marktguru.at/r/billa' }), 'marketplace');
  assert.equal(classifySourceKind({ channel: 'other', sourceUrl: 'https://example.test/offers' }), 'unknown');
});

test('blockedLikely detects access and rate limiting statuses', () => {
  assert.equal(isBlockedLikely(401), true);
  assert.equal(isBlockedLikely(403), true);
  assert.equal(isBlockedLikely(429), true);
  assert.equal(isBlockedLikely(200), false);
  assert.equal(isBlockedLikely(null), false);
});

test('normalizes code sources with activation and parser hints', () => {
  const source = normalizeCodeSource({
    retailerKey: 'spar',
    retailerName: 'Spar',
    channel: 'official-flyer',
    sourceUrl: 'https://www.spar.at/aktionen',
    enabled: false,
    latestStatus: 'inactive',
    disabledReason: 'disabled-source-blocked',
  });

  assert.equal(source.sourceKind, 'official');
  assert.equal(source.sourceKey, 'spar-official-flyer');
  assert.equal(source.active, false);
  assert.equal(source.parserOrAdapter.includes('spar-official-parser-fixture-only'), true);
});

test('coverage ratio calculation is stable for totals and zero totals', () => {
  assert.equal(pct(2, 4), 50);
  assert.equal(pct(1, 3), 33.3);
  assert.equal(pct(1, 0), 0);

  const coverage = buildCoverageRatios({
    offerCountApprox: 10,
    validFromPresent: 7,
    validToPresent: 6,
    validityLabelPresent: 2,
    priceCurrentPresent: 9,
    priceAmountPresent: 9,
    quantityTextPresent: 5,
    normalizedUnitPricePresent: 4,
    comparableUnitPresent: 3,
    conditionsTextPresent: 2,
    conditionFlagPresent: 1,
  });

  assert.equal(coverage.validityCoverageApprox.validFromPresent.pct, 70);
  assert.equal(coverage.priceCoverageApprox.priceCurrentPresent.pct, 90);
  assert.equal(coverage.quantityCoverageApprox.normalizedUnitPricePresent.pct, 40);
  assert.equal(coverage.conditionCoverageApprox.conditionFlagPresent.pct, 10);
});

test('structure assessment uses code and reachability hints conservatively', () => {
  const spar = getRetailerConfigs().find((retailer) => retailer.retailerKey === 'spar');
  const assessment = assessStructure({
    retailer: spar,
    codeSources: spar.codeSources,
    reachability: [{ url: 'https://www.spar.at/aktionen/steiermark', status: 403, blockedLikely: true }],
    dbCoverage: {
      sourceBreakdown: [
        { sourceType: 'aktionsfinder-json', offers: 20 },
      ],
    },
  });

  assert.equal(assessment.blockedLikely, true);
  assert.equal(assessment.pdfFlyerLikely, true);
  assert.equal(assessment.existingParserCoverage, 'fixture-only');
  assert.equal(assessment.confidence, 'medium');
});
