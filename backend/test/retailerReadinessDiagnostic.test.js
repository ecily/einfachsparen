const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildRetailerReadinessDiagnostic,
  buildFiveQuestionCoverage,
  determinePlanningStatus,
} = require('../src/services/diagnostics/retailerReadinessDiagnostic');

function fullOffer(overrides = {}) {
  return {
    _id: overrides._id || 'offer-1',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    sourceType: 'billa-official-algolia',
    sourceTypes: ['billa-official-algolia'],
    sourceConfidence: 0.95,
    title: 'Ja Natuerlich Bio Milch 1 l',
    titleNormalized: 'ja natuerlich bio milch 1 l',
    categoryPrimary: 'Lebensmittel',
    categoryKey: 'lebensmittel',
    subcategoryKey: 'milchprodukte',
    comparisonGroup: 'milch',
    dedupeKey: 'billa:milch:1l',
    validFrom: new Date('2026-05-01T00:00:00Z'),
    validTo: new Date('2026-05-12T23:59:59Z'),
    rawFacts: {
      validityLabel: 'gueltig von 01.05.2026 bis 12.05.2026',
    },
    isActiveNow: true,
    quantityText: '1 l',
    unitValue: 1,
    unitType: 'l',
    normalizedUnitPrice: {
      amount: 1.29,
      unit: 'l',
      comparable: true,
    },
    quality: {
      comparisonSafe: true,
    },
    hasConditions: false,
    customerProgramRequired: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    conditionsText: '',
    priceCurrent: {
      amount: 1.29,
    },
    ...overrides,
  };
}

const billaDefinition = {
  retailerKey: 'billa',
  retailerName: 'BILLA',
  channel: 'official-site',
  label: 'BILLA Aktionen',
  sourceUrl: 'https://www.billa.at/unsere-aktionen/aktionen',
  sourceType: 'billa-official-algolia',
  enabled: true,
};

test('calculates coverage for the five USP questions', () => {
  const sourceProfile = {
    sourceTypes: ['billa-official-algolia'],
    sourceConfidence: 95,
    officialSourceObserved: true,
    officialSourceConfigured: true,
    primarySourceFromMatrix: {
      label: 'BILLA Aktionen',
    },
  };
  const coverage = buildFiveQuestionCoverage([
    fullOffer(),
    fullOffer({
      _id: 'offer-2',
      titleNormalized: '',
      validTo: null,
      quantityText: '',
      unitValue: null,
      unitType: '',
      normalizedUnitPrice: {},
      quality: {},
    }),
  ], sourceProfile, new Date('2026-05-08T12:00:00Z'));

  assert.equal(coverage.whatIsIt.titlePresentPct, 100);
  assert.equal(coverage.whatIsIt.titleNormalizedPresentPct, 50);
  assert.equal(coverage.whenIsIt.validToPresentPct, 50);
  assert.equal(coverage.quantityUnit.quantityTextPresentPct, 50);
  assert.equal(coverage.quantityUnit.comparisonSafePct, 50);
  assert.equal(coverage.conditions.hasConditionsPresentPct, 100);
});

test('classifies ready, watch and not-ready retailers for planning status', () => {
  const readyReport = buildRetailerReadinessDiagnostic({
    targetRetailers: [{ retailerKey: 'billa', retailerName: 'BILLA' }],
    definitions: [billaDefinition],
    offers: [
      fullOffer(),
      fullOffer({
        _id: 'offer-2',
        title: 'Ja Natuerlich Bio Joghurt 500 g',
        titleNormalized: 'ja natuerlich bio joghurt 500 g',
        comparisonGroup: 'joghurt',
        dedupeKey: 'billa:joghurt:500g',
        quantityText: '500 g',
        unitValue: 500,
        unitType: 'g',
        normalizedUnitPrice: {
          amount: 3.98,
          unit: 'kg',
          comparable: true,
        },
        priceCurrent: {
          amount: 1.99,
        },
      }),
    ],
    generatedAt: new Date('2026-05-08T12:00:00Z'),
  });
  const ready = readyReport.retailers[0];

  assert.equal(ready.planningStatus, 'ready');
  assert.equal(ready.launchStatus, 'ready');
  assert.ok(ready.score >= 88);

  const watchStatus = determinePlanningStatus({
    offerCount: 2,
    score: 55,
    coverage: {
      whenIsIt: { validToPresentPct: 20 },
      quantityUnit: { comparisonSafePct: 10 },
    },
    risks: { userTrustRisk: 'high' },
    sourceProfile: { officialSourceConfigured: true, enabledSourceCount: 1 },
  });

  assert.equal(watchStatus, 'watch');

  const notReadyReport = buildRetailerReadinessDiagnostic({
    targetRetailers: [{ retailerKey: 'adeg', retailerName: 'ADEG' }],
    definitions: [
      {
        retailerKey: 'adeg',
        retailerName: 'ADEG',
        channel: 'official-flyer',
        label: 'ADEG Flugblatt',
        sourceUrl: 'https://www.adeg.at/flugblatt-aktionen/adeg-flugblatt',
        enabled: false,
        disabledReason: 'disabled-unreliable-source',
      },
    ],
    offers: [],
  });

  assert.equal(notReadyReport.retailers[0].planningStatus, 'not-ready');
});

test('missing validTo does not automatically block MVP search when current offer basics are strong', () => {
  const report = buildRetailerReadinessDiagnostic({
    targetRetailers: [{ retailerKey: 'billa', retailerName: 'BILLA' }],
    definitions: [billaDefinition],
    offers: [
      fullOffer({
        validFrom: null,
        validTo: null,
        rawFacts: {},
      }),
      fullOffer({
        _id: 'offer-2',
        title: 'Ja Natuerlich Bio Joghurt 500 g',
        titleNormalized: 'ja natuerlich bio joghurt 500 g',
        comparisonGroup: 'joghurt',
        dedupeKey: 'billa:joghurt:500g',
        validFrom: null,
        validTo: null,
        rawFacts: {},
        quantityText: '500 g',
        unitValue: 500,
        unitType: 'g',
        normalizedUnitPrice: {
          amount: 3.98,
          unit: 'kg',
          comparable: true,
        },
        priceCurrent: {
          amount: 1.99,
        },
      }),
    ],
    generatedAt: new Date('2026-05-08T12:00:00Z'),
  });
  const billa = report.retailers[0];

  assert.equal(billa.fiveQuestionCoverage.whenIsIt.validToPresentPct, 0);
  assert.equal(billa.mvpSearchStatus, 'watch');
  assert.equal(billa.planningStatus, 'watch');
  assert.equal(billa.mvpRisks.missingValidityRisk, 'medium');
  assert.equal(billa.planningRisks.missingValidityRisk, 'high');
});

test('retailer with good source price title and quantity can be MVP ready even without validity windows', () => {
  const offers = Array.from({ length: 60 }, (_, index) => fullOffer({
    _id: `offer-${index}`,
    title: `Produkt ${index} 1 l`,
    titleNormalized: `produkt ${index} 1 l`,
    comparisonGroup: `produkt-${index}`,
    dedupeKey: `billa:produkt-${index}:1l`,
    validFrom: null,
    validTo: null,
    rawFacts: {},
    priceCurrent: { amount: 1 + index / 100 },
  }));
  const report = buildRetailerReadinessDiagnostic({
    targetRetailers: [{ retailerKey: 'billa', retailerName: 'BILLA' }],
    definitions: [billaDefinition],
    offers,
    generatedAt: new Date('2026-05-08T12:00:00Z'),
  });
  const billa = report.retailers[0];

  assert.equal(billa.mvpSearchStatus, 'ready');
  assert.equal(billa.planningStatus, 'watch');
});

test('missing data does not crash and produces low coverage', () => {
  const report = buildRetailerReadinessDiagnostic({
    targetRetailers: [{ retailerKey: 'dm', retailerName: 'dm' }],
    definitions: [
      {
        retailerKey: 'dm',
        retailerName: 'dm',
        channel: 'official-site',
        label: 'dm Startseite',
        sourceUrl: 'https://www.dm.at/',
      },
    ],
    offers: [
      {
        _id: 'empty',
        retailerKey: 'dm',
        retailerName: 'dm',
        sourceType: 'aktionsfinder-json',
        rawFacts: null,
      },
    ],
  });
  const dm = report.retailers[0];

  assert.equal(dm.offerCount, 1);
  assert.equal(dm.fiveQuestionCoverage.whatIsIt.titlePresentPct, 0);
  assert.equal(dm.fiveQuestionCoverage.whenIsIt.validToPresentPct, 0);
  assert.equal(dm.mvpSearchStatus, 'not-ready');
  assert.equal(dm.planningStatus, 'watch');
});

test('disabled sources are visible but not counted as productive official sources', () => {
  const report = buildRetailerReadinessDiagnostic({
    targetRetailers: [{ retailerKey: 'adeg', retailerName: 'ADEG' }],
    definitions: [
      {
        retailerKey: 'adeg',
        retailerName: 'ADEG',
        channel: 'official-flyer',
        label: 'ADEG Flugblatt',
        sourceUrl: 'https://www.adeg.at/flugblatt-aktionen/adeg-flugblatt',
        enabled: false,
        disabledReason: 'disabled-unreliable-source',
      },
    ],
    offers: [fullOffer({ retailerKey: 'adeg', retailerName: 'ADEG', sourceType: 'flyer' })],
  });
  const adeg = report.retailers[0];

  assert.equal(adeg.sourceProfile.disabledSourceCount, 1);
  assert.equal(adeg.sourceProfile.officialSourceConfigured, false);
  assert.equal(adeg.mvpSearchStatus, 'not-ready');
  assert.equal(adeg.planningStatus, 'not-ready');
});

test('diagnostic remains read-only and records no mutations', () => {
  const report = buildRetailerReadinessDiagnostic({
    targetRetailers: [{ retailerKey: 'billa', retailerName: 'BILLA' }],
    definitions: [billaDefinition],
    offers: [fullOffer()],
  });

  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.ok(report.summary.mvpSearch);
  assert.ok(report.summary.planning);
  assert.ok(Array.isArray(report.summary.recommendedMvpNextActions));
  assert.ok(Array.isArray(report.summary.recommendedPlanningNextActions));
});
