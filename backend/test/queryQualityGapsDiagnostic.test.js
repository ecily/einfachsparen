const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildQueryQualityGapsDiagnostic,
  buildResponseDedupeSimulation,
  buildWaschmittelDuplicates,
  classifyButterOffer,
  classifyRiceOffer,
  strongDuplicateKey,
} = require('../src/services/diagnostics/queryQualityGapsDiagnostic');

function offer(overrides = {}) {
  return {
    _id: overrides._id || Math.random().toString(16).slice(2),
    retailerKey: 'billa',
    retailerName: 'BILLA',
    sourceId: overrides.sourceId || 'source-a',
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://example.test/offer',
    title: 'Ja Natuerlich Teebutter 250 g',
    titleNormalized: 'ja natuerlich teebutter 250 g',
    brand: 'Ja Natuerlich',
    categoryPrimary: 'Milchprodukte',
    categorySecondary: 'Butter',
    categoryKey: 'milchprodukte',
    subcategoryKey: 'butter',
    comparisonSignature: '',
    comparisonGroup: 'ja-natuerlich-teebutter-250-g',
    dedupeKey: 'billa::ja-natuerlich-teebutter::250-g::2.49',
    priceCurrent: { amount: 2.49, currency: 'EUR' },
    normalizedUnitPrice: { amount: 9.96, unit: 'kg', comparable: true },
    quantityText: '250 g',
    packCount: 1,
    unitValue: 250,
    unitType: 'g',
    totalComparableAmount: 0.25,
    comparableUnit: 'kg',
    packageType: '',
    benefitType: 'price-cut',
    effectiveDiscountType: 'price-cut',
    conditionsText: '',
    customerProgramRequired: false,
    hasConditions: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    validFrom: new Date('2026-05-01T00:00:00.000Z'),
    validTo: new Date('2026-05-11T23:59:59.000Z'),
    status: 'active',
    isActiveNow: true,
    isActiveToday: true,
    quality: { comparisonSafe: true },
    ...overrides,
  };
}

test('echte Butter wird als true candidate erkannt', () => {
  const result = classifyButterOffer(offer());

  assert.equal(result.classification, 'true');
});

test('Butterpinze, Buttermilch und Kraeuterbutter-Gewuerz bleiben Side-Hits', () => {
  const sideHits = [
    offer({
      title: 'Butterpinze',
      titleNormalized: 'butterpinze',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Backwaren',
    }),
    offer({
      title: 'Buttermilch 500 ml',
      titleNormalized: 'buttermilch 500 ml',
      categoryPrimary: 'Milchprodukte',
      categorySecondary: 'Milch',
    }),
    offer({
      title: 'Kraeuterbutter Gewuerzzubereitung',
      titleNormalized: 'kraeuterbutter gewuerzzubereitung',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Gewuerze',
    }),
  ];

  assert.deepEqual(sideHits.map(classifyButterOffer).map((item) => item.classification), [
    'sideHit',
    'sideHit',
    'sideHit',
  ]);
});

test('echter Reis wird als true candidate erkannt', () => {
  const result = classifyRiceOffer(offer({
    title: 'Basmati Reis 1 kg',
    titleNormalized: 'basmati reis 1 kg',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Grundnahrungsmittel',
    categoryKey: 'lebensmittel',
    subcategoryKey: 'grundnahrungsmittel',
    comparisonGroup: 'basmati-reis-1-kg',
  }));

  assert.equal(result.classification, 'true');
});

test('Reiswaffeln und Jasmine-Duftspray sind keine echten Reis-Packungen', () => {
  assert.equal(classifyRiceOffer(offer({
    title: 'HiPP Bio Reiswaffeln 30 g',
    titleNormalized: 'hipp bio reiswaffeln 30 g',
  })).classification, 'weakTrue');
  assert.equal(classifyRiceOffer(offer({
    title: 'Glade Touch & Fresh Jasmine Minispray Nachfueller',
    titleNormalized: 'glade touch fresh jasmine minispray nachfueller',
  })).classification, 'miss');
});

test('Passata, Sugo und Nudeln bleiben Side-Hits', () => {
  const sideHits = [
    offer({ title: 'Tomaten Passata', titleNormalized: 'tomaten passata' }),
    offer({ title: 'Sugo Basilico', titleNormalized: 'sugo basilico' }),
    offer({ title: 'Spaghetti Nudeln 500 g', titleNormalized: 'spaghetti nudeln 500 g' }),
  ];

  assert.deepEqual(sideHits.map(classifyRiceOffer).map((item) => item.classification), [
    'sideHit',
    'sideHit',
    'sideHit',
  ]);
});

test('Duplicate-Gruppe erkennt gleiche Titel, Preis und Menge als strong candidate', () => {
  const left = offer({
    _id: 'somat-a',
    sourceId: 'source-a',
    sourceType: 'aktionsfinder-json',
    title: 'Somat Excellence Tabs 30 Stueck',
    titleNormalized: 'somat excellence tabs 30 stueck',
    brand: 'Somat',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Waschmittel',
    categoryKey: 'drogerie-hygiene',
    subcategoryKey: 'waschmittel',
    comparisonGroup: 'somat-excellence-tabs-30-stueck',
    priceCurrent: { amount: 7.99, currency: 'EUR' },
    normalizedUnitPrice: { amount: 0.2663, unit: 'stueck', comparable: true },
    quantityText: '30 Stueck',
    unitValue: 30,
    unitType: 'stueck',
    totalComparableAmount: 30,
    comparableUnit: 'stueck',
  });
  const right = offer({
    ...left,
    _id: 'somat-b',
    sourceId: 'source-b',
    sourceUrl: 'https://example.test/other',
  });

  const report = buildWaschmittelDuplicates({ offers: [left, right] });

  assert.equal(report.duplicateGroupCount, 1);
  assert.equal(report.duplicateGroups[0].classification, 'strongDuplicateCandidate');
  assert.ok(report.duplicateGroups[0].protectedDifferences.includes('sourceId'));
});

test('Varianten bleiben nicht faelschlich strong duplicate', () => {
  const color = offer({
    title: 'Ariel Color Waschmittel 30 WG',
    titleNormalized: 'ariel color waschmittel 30 wg',
    brand: 'Ariel',
    comparisonGroup: 'ariel-waschmittel-30-wg',
    priceCurrent: { amount: 9.99, currency: 'EUR' },
    quantityText: '30 WG',
    unitValue: 30,
    unitType: 'stueck',
    totalComparableAmount: 30,
    comparableUnit: 'stueck',
  });
  const universal = offer({
    ...color,
    _id: 'universal',
    sourceId: 'source-b',
    title: 'Ariel Universal Waschmittel 30 WG',
    titleNormalized: 'ariel universal waschmittel 30 wg',
  });

  assert.notEqual(strongDuplicateKey(color), strongDuplicateKey(universal));
  assert.equal(buildWaschmittelDuplicates({ offers: [color, universal] }).duplicateGroupCount, 0);
});

test('read-only contract remains explicit', () => {
  const report = buildQueryQualityGapsDiagnostic({
    checkedAt: '2026-05-09T12:00:00.000Z',
    butterOffers: [offer()],
    reisOffers: [offer({ title: 'Basmati Reis 1 kg', titleNormalized: 'basmati reis 1 kg' })],
    waschmittelOffers: [],
  });

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.performanceSafe, true);
  assert.equal(report.checkedAt, '2026-05-09T12:00:00.000Z');
});

test('response dedupe simulation reports second-stage visible card collapse fields', () => {
  const first = offer({
    _id: 'somat-a',
    title: 'Somat Excellence Premium Geschirrspuel-Tabs 5 in 1 36 Stueck',
    titleNormalized: 'somat excellence premium geschirrspuel tabs 5 in 1 36 stueck',
    retailerKey: 'dm',
    brand: 'Somat',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Waschmittel',
    categoryKey: 'drogerie-hygiene',
    subcategoryKey: 'waschmittel',
    sourceId: 'source-a',
    sourceType: 'aktionsfinder-json',
    dedupeKey: 'dm::somat-a',
    comparisonGroup: 'somat-excellence-premium-tabs-36-stueck',
    priceCurrent: { amount: 9.35, currency: 'EUR' },
    quantityText: '36 Stueck',
    unitValue: 36,
    unitType: 'stueck',
    totalComparableAmount: 36,
    comparableUnit: 'stueck',
    normalizedUnitPrice: { amount: 0.2597, unit: 'stueck', comparable: true },
  });
  const second = {
    ...first,
    _id: 'somat-b',
    brand: 'Somat Plus',
    sourceId: 'source-b',
    dedupeKey: 'dm::somat-b',
    sourceUrl: 'https://example.test/other',
    sourceType: 'wogibtswas-html',
  };
  const simulation = buildResponseDedupeSimulation({ offers: [first, second], limit: 10 });

  assert.equal(simulation.secondStageCollapsedCount, 1);
  assert.ok(Array.isArray(simulation.examplesSecondStageCollapsed));
  assert.ok(Array.isArray(simulation.examplesKeptBecauseVariant));
  assert.equal(simulation.visibleRepeatCountAfter, 0);
});
