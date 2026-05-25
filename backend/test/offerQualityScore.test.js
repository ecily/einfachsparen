const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildOfferQualityRankingAdjustment,
  calculateOfferQualityScore,
  hasQuantityArtifact,
  hasUnsafeUnitPrice,
} = require('../src/services/offers/offerQualityScore');
const {
  buildSourceQualityMatrixDiagnostic,
} = require('../src/services/diagnostics/sourceQualityMatrixDiagnostic');

function baseOffer(overrides = {}) {
  return {
    _id: 'offer-1',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/l/billa/',
    title: 'Bio Vollmilch 1 l',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milch',
    categoryKey: 'milch',
    categoryConfidence: 0.8,
    priceCurrent: { amount: 1.49, currency: 'EUR' },
    quantityText: '1 l',
    unitValue: 1,
    unitType: 'l',
    totalComparableAmount: 1,
    comparableUnit: 'l',
    normalizedUnitPrice: { amount: 1.49, unit: 'l', comparable: true, confidence: 0.9 },
    quality: { comparisonSafe: true, issues: [] },
    reviewReasons: [],
    ...overrides,
  };
}

test('offer quality score rewards complete safe official cards without becoming destructive', () => {
  const official = baseOffer({
    sourceType: 'billa-official-algolia',
    sourceUrl: 'https://www.billa.at/aktionen/milch',
    imageUrl: 'https://example.test/milch.jpg',
    conditionsText: 'nur diese Woche',
  });
  const weak = baseOffer({
    imageUrl: '',
    normalizedUnitPrice: { amount: 1490, unit: 'kg', comparable: false, confidence: 0.3 },
    comparableUnit: '',
    quality: { comparisonSafe: false, issues: ['Vergleichseinheit unklar'] },
    reviewReasons: ['Vergleichseinheit unklar'],
  });

  const officialScore = calculateOfferQualityScore(official);
  const weakScore = calculateOfferQualityScore(weak);

  assert.equal(officialScore.band, 'high');
  assert.equal(officialScore.positiveSignals.includes('official-source'), true);
  assert.equal(weakScore.score < officialScore.score, true);
  assert.equal(weakScore.negativeSignals.includes('unsafe-unit-price'), true);
  assert.equal(buildOfferQualityRankingAdjustment(weak) >= -8, true);
});

test('offer quality artifact helpers detect unsafe unit prices and broken quantities', () => {
  const broken = baseOffer({
    quantityText: '$undefined WG / 1 Fl.',
    unitType: 'WG',
    comparableUnit: '',
    normalizedUnitPrice: { amount: 24990, unit: 'kg', comparable: false, confidence: 0.3 },
    quality: { comparisonSafe: false, issues: [] },
  });

  assert.equal(hasQuantityArtifact(broken), true);
  assert.equal(hasUnsafeUnitPrice(broken), true);
});

test('source quality matrix summarizes source health without filtering sources', () => {
  const offers = [
    baseOffer({
      _id: 'safe-official',
      sourceType: 'billa-official-algolia',
      sourceUrl: 'https://www.billa.at/aktionen/milch',
      rawFacts: { sourceKey: 'billa-official' },
      imageUrl: 'https://example.test/milch.jpg',
      conditionsText: 'nur diese Woche',
    }),
    baseOffer({
      _id: 'broken-aggregator',
      sourceType: 'aktionsfinder-json',
      sourceUrl: 'https://www.aktionsfinder.at/l/billa/',
      rawFacts: { sourceKey: 'aktionsfinder-billa' },
      title: 'Ariel Waschmittel 1 Fl.',
      priceCurrent: { amount: 11.65, currency: 'EUR' },
      quantityText: '$undefined WG / 1 Fl.',
      unitType: 'WG',
      comparableUnit: '',
      normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
      quality: { comparisonSafe: false, issues: ['Menge unvollstaendig'] },
      reviewReasons: ['Menge unvollstaendig'],
    }),
    baseOffer({
      _id: 'clean-aggregator-duplicate',
      sourceType: 'aktionsfinder-json',
      sourceUrl: 'https://www.aktionsfinder.at/l/billa/',
      rawFacts: { sourceKey: 'aktionsfinder-billa' },
      title: 'Ariel Waschmittel 1 Fl.',
      priceCurrent: { amount: 11.65, currency: 'EUR' },
      quantityText: '1 Fl.',
      unitType: '',
      comparableUnit: '',
      normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
      quality: { comparisonSafe: false, issues: [] },
      reviewReasons: [],
    }),
  ];

  const report = buildSourceQualityMatrixDiagnostic({ offers, sources: [] });
  const official = report.table.find((row) => row.sourceKey === 'billa-official');
  const aggregator = report.table.find((row) => row.sourceKey === 'aktionsfinder-billa');

  assert.equal(report.readOnly, true);
  assert.equal(report.mutatedCollections.length, 0);
  assert.equal(official.officialShare, 100);
  assert.equal(aggregator.count, 2);
  assert.equal(aggregator.quantityArtifactQuote, 50);
  assert.equal(aggregator.qualityIssueQuote, 50);
  assert.equal(aggregator.duplicateSuspicion.brokenVsCleanGroups, 1);
});
