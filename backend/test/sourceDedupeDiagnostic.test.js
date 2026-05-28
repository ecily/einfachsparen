const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildSourceDedupeDiagnostic,
  evaluatePair,
  sourcePriorityEntry,
  sourcePriorityMatrixForReport,
} = require('../src/services/diagnostics/sourceDedupeDiagnostic');

function offer(overrides = {}) {
  return {
    _id: overrides._id || Math.random().toString(16).slice(2),
    retailerKey: 'billa',
    retailerName: 'BILLA',
    sourceType: 'aktionsfinder-json',
    title: 'Ja Natuerlich Bio Milch 1 l',
    titleNormalized: 'ja natuerlich bio milch 1 l',
    brand: 'Ja Natuerlich',
    categoryKey: 'milchprodukte',
    subcategoryKey: 'milch',
    priceCurrent: { amount: 1.29, currency: 'EUR' },
    normalizedUnitPrice: { amount: 1.29, unit: 'l', comparable: true },
    quantityText: '1 l',
    unitValue: 1,
    unitType: 'l',
    totalComparableAmount: 1,
    comparableUnit: 'l',
    comparisonGroup: 'ja-natuerlich-bio-milch::1-l',
    dedupeKey: 'billa::ja-natuerlich-bio-milch::1-l::1.29::2026-05-01',
    offerKey: '',
    validFrom: new Date('2026-05-01T00:00:00.000Z'),
    validTo: new Date('2026-05-08T23:59:59.000Z'),
    quality: { completenessScore: 80, parsingConfidence: 0.9 },
    ...overrides,
  };
}

test('source priority matrix exposes expected retailer source rules', () => {
  const matrix = sourcePriorityMatrixForReport();

  assert.equal(matrix.billa[0].sourceType, 'billa-official-algolia');
  assert.equal(matrix.lidl[0].sourceType, 'lidl-official-flyer-api');
  assert.equal(matrix.penny[0].sourceType, 'penny-official-html');
  assert.equal(matrix.spar[0].sourceType, 'official-action');
  assert.equal(matrix.spar.some((entry) => entry.sourceType === 'spar-official-pdf'), true);
  assert.equal(matrix.eurospar.some((entry) => entry.sourceType === 'spar-official-pdf'), true);
  assert.equal(matrix.interspar.some((entry) => entry.sourceType === 'spar-official-pdf'), true);
  assert.equal(matrix.hofer[0].sourceType, 'aktionsfinder-json');
});

test('BILLA official source wins over Aktionsfinder in duplicate group preview', () => {
  const official = offer({
    _id: 'official-billa',
    sourceType: 'billa-official-algolia',
    sourceConfidence: 0.95,
  });
  const aggregator = offer({
    _id: 'aktionsfinder-billa',
    sourceType: 'aktionsfinder-json',
    sourceConfidence: 0.78,
  });
  const report = buildSourceDedupeDiagnostic({ offers: [aggregator, official], generatedAt: '2026-05-08T12:00:00.000Z' });
  const billa = report.retailers.find((item) => item.retailerKey === 'billa');

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(billa.strongDuplicateGroups, 1);
  assert.equal(billa.topDuplicateExamples[0].winningSourceType, 'billa-official-algolia');
});

test('LIDL official flyer API wins over Aktionsfinder', () => {
  const official = offer({
    _id: 'official-lidl',
    retailerKey: 'lidl',
    retailerName: 'LIDL',
    sourceType: 'lidl-official-flyer-api',
  });
  const aggregator = offer({
    _id: 'aktionsfinder-lidl',
    retailerKey: 'lidl',
    retailerName: 'LIDL',
    sourceType: 'aktionsfinder-json',
  });
  const report = buildSourceDedupeDiagnostic({ offers: [aggregator, official] });
  const lidl = report.retailers.find((item) => item.retailerKey === 'lidl');

  assert.equal(lidl.topDuplicateExamples[0].winningSourceType, 'lidl-official-flyer-api');
});

test('PENNY OCR and PDF sources never win productively over official HTML', () => {
  assert.equal(sourcePriorityEntry('penny', 'penny-pdf-ocr-bbox').role, 'ocr-diagnostic-only');

  const official = offer({
    _id: 'penny-html',
    retailerKey: 'penny',
    retailerName: 'PENNY',
    sourceType: 'penny-official-html',
  });
  const pdf = offer({
    _id: 'penny-pdf',
    retailerKey: 'penny',
    retailerName: 'PENNY',
    sourceType: 'penny-official-pdf',
  });
  const ocr = offer({
    _id: 'penny-ocr',
    retailerKey: 'penny',
    retailerName: 'PENNY',
    sourceType: 'penny-pdf-ocr-bbox',
  });
  const report = buildSourceDedupeDiagnostic({ offers: [ocr, pdf, official] });
  const penny = report.retailers.find((item) => item.retailerKey === 'penny');

  assert.equal(penny.topDuplicateExamples[0].winningSourceType, 'penny-official-html');
  assert.ok(penny.risks.some((risk) => /OCR/.test(risk)));
});

test('PENNY official HTML wins over aggregator for comparable offers', () => {
  const official = offer({
    _id: 'penny-html',
    retailerKey: 'penny',
    retailerName: 'PENNY',
    sourceType: 'penny-official-html',
  });
  const aggregator = offer({
    _id: 'penny-aktionsfinder',
    retailerKey: 'penny',
    retailerName: 'PENNY',
    sourceType: 'aktionsfinder-json',
  });
  const report = buildSourceDedupeDiagnostic({ offers: [aggregator, official] });
  const penny = report.retailers.find((item) => item.retailerKey === 'penny');

  assert.equal(penny.topDuplicateExamples[0].winningSourceType, 'penny-official-html');
});

test('same title, same price and same validity are a strong duplicate candidate', () => {
  const result = evaluatePair(
    offer({ _id: 'left', sourceType: 'billa-official-algolia' }),
    offer({ _id: 'right', sourceType: 'aktionsfinder-json' })
  );

  assert.equal(result.matchStrength, 'strong');
  assert.ok(result.reasonCodes.includes('same-price'));
  assert.ok(result.reasonCodes.includes('same-validity-window'));
});

test('loose candidates are found without dedupeKey comparisonGroup or offerKey', () => {
  const report = buildSourceDedupeDiagnostic({
    offers: [
      offer({
        _id: 'official-loose',
        sourceType: 'billa-official-algolia',
        title: 'Coca Cola Original 1,5 l',
        titleNormalized: 'coca cola original 1 5 l',
        brand: 'Coca Cola',
        priceCurrent: { amount: 1.49, currency: 'EUR' },
        comparisonGroup: '',
        dedupeKey: '',
        offerKey: '',
        quantityText: '',
        unitValue: null,
        unitType: '',
        totalComparableAmount: null,
        comparableUnit: '',
        normalizedUnitPrice: { amount: null, unit: '', comparable: false },
      }),
      offer({
        _id: 'aggregator-loose',
        sourceType: 'aktionsfinder-json',
        title: 'Coca-Cola Original Flasche',
        titleNormalized: 'coca cola original flasche',
        brand: 'Coca Cola',
        priceCurrent: { amount: 1.49, currency: 'EUR' },
        comparisonGroup: '',
        dedupeKey: '',
        offerKey: '',
        quantityText: '',
        unitValue: null,
        unitType: '',
        totalComparableAmount: null,
        comparableUnit: '',
        normalizedUnitPrice: { amount: null, unit: '', comparable: false },
      }),
    ],
  });
  const billa = report.retailers.find((item) => item.retailerKey === 'billa');

  assert.equal(billa.looseCandidatePairs, 1);
  assert.equal(billa.classifiedMedium + billa.classifiedWeak + billa.classifiedNeedsReview, 1);
  assert.equal(billa.topLooseCandidateExamples[0].sharedTokens.includes('coca'), true);
});

test('same retailer and different sources with similar titles create a loose candidate', () => {
  const result = evaluatePair(
    offer({
      _id: 'left-similar',
      sourceType: 'billa-official-algolia',
      title: 'Lavazza Caffe Crema ganze Bohne',
      titleNormalized: 'lavazza caffe crema ganze bohne',
      brand: 'Lavazza',
      comparisonGroup: '',
      dedupeKey: '',
      offerKey: '',
      validFrom: null,
      validTo: null,
    }),
    offer({
      _id: 'right-similar',
      sourceType: 'aktionsfinder-json',
      title: 'Lavazza Crema Kaffee Bohnen',
      titleNormalized: 'lavazza crema kaffee bohnen',
      brand: 'Lavazza',
      comparisonGroup: '',
      dedupeKey: '',
      offerKey: '',
      validFrom: null,
      validTo: null,
    })
  );

  assert.ok(result);
  assert.ok(['medium', 'weak', 'needsReview'].includes(result.classification));
  assert.ok(result.sharedTokens.length >= 2);
});

test('similar titles with different package size are needsReview, not strong', () => {
  const result = evaluatePair(
    offer({
      _id: 'left',
      sourceType: 'billa-official-algolia',
      title: 'Ja Natuerlich Bio Milch 1 l',
      titleNormalized: 'ja natuerlich bio milch 1 l',
      quantityText: '1 l',
      unitValue: 1,
      totalComparableAmount: 1,
      normalizedUnitPrice: { amount: 1.29, unit: 'l', comparable: true },
    }),
    offer({
      _id: 'right',
      sourceType: 'aktionsfinder-json',
      title: 'Ja Natuerlich Bio Milch 0,5 l',
      titleNormalized: 'ja natuerlich bio milch 0 5 l',
      quantityText: '0,5 l',
      unitValue: 0.5,
      totalComparableAmount: 0.5,
      normalizedUnitPrice: { amount: 2.58, unit: 'l', comparable: true },
      comparisonGroup: '',
      dedupeKey: '',
    })
  );

  assert.equal(result.matchStrength, 'needsReview');
  assert.ok(result.reasonCodes.includes('quantity-conflict'));
  assert.ok(result.whyNotMerged.some((reason) => /Mengenfelder/.test(reason)));
});

test('different product variants are not marked as strong', () => {
  const result = evaluatePair(
    offer({
      _id: 'vollmilch',
      sourceType: 'billa-official-algolia',
      title: 'Milka Schokolade Vollmilch 100 g',
      titleNormalized: 'milka schokolade vollmilch 100 g',
      brand: 'Milka',
      comparisonGroup: '',
      dedupeKey: '',
      quantityText: '100 g',
      unitValue: 100,
      unitType: 'g',
      totalComparableAmount: 0.1,
      comparableUnit: 'kg',
      normalizedUnitPrice: { amount: 14.9, unit: 'kg', comparable: true },
    }),
    offer({
      _id: 'noisette',
      sourceType: 'aktionsfinder-json',
      title: 'Milka Schokolade Noisette 100 g',
      titleNormalized: 'milka schokolade noisette 100 g',
      brand: 'Milka',
      comparisonGroup: '',
      dedupeKey: '',
      quantityText: '100 g',
      unitValue: 100,
      unitType: 'g',
      totalComparableAmount: 0.1,
      comparableUnit: 'kg',
      normalizedUnitPrice: { amount: 14.9, unit: 'kg', comparable: true },
    })
  );

  assert.notEqual(result?.matchStrength, 'strong');
});

test('diagnostic report remains read-only and records no mutated collections', () => {
  const report = buildSourceDedupeDiagnostic({
    offers: [
      offer({ _id: 'a', sourceType: 'billa-official-algolia' }),
      offer({ _id: 'b', sourceType: 'aktionsfinder-json' }),
    ],
  });

  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.summary.duplicateGroupsDetected, 1);
});

test('missing fields create coverage warnings without crashing', () => {
  const report = buildSourceDedupeDiagnostic({
    offers: [
      {
        _id: 'sparse-a',
        retailerKey: 'dm',
        retailerName: 'dm',
        sourceType: 'aktionsfinder-json',
        title: 'Balea Shampoo',
        priceCurrent: {},
      },
      {
        _id: 'sparse-b',
        retailerKey: 'dm',
        retailerName: 'dm',
        sourceType: 'wogibtswas-html',
        title: 'Balea Shampoo',
        priceCurrent: {},
      },
    ],
  });
  const dm = report.retailers.find((item) => item.retailerKey === 'dm');

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.ok(report.summary.fieldCoverageWarnings > 0);
  assert.ok(dm.fieldCoverageWarnings.length > 0);
  assert.equal(dm.fieldCoverage.priceCurrent.percent, 0);
});
