const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildBillaOfficialValidityRootCauseDiagnostic,
  buildDuplicateGroups,
  buildFieldCoverage,
  classifyRootCause,
  detectHiddenValidityFields,
  hasCampaignLevelOnlySignal,
  shapeRawFactsPreview,
} = require('../src/services/diagnostics/billaOfficialValidityRootCauseDiagnostic');

function offer(overrides = {}) {
  return {
    _id: overrides._id || 'offer-a',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    sourceType: 'billa-official-algolia',
    sourceUrl: 'https://www.billa.at/unsere-aktionen/aktionen',
    title: 'BILLA Bio Milch 1 l',
    titleNormalized: 'billa bio milch 1 l',
    priceCurrent: { amount: 1.29 },
    quantityText: '1 l',
    normalizedUnitPrice: { amount: 1.29, unit: 'l' },
    validFrom: new Date('2026-05-10T12:00:00Z'),
    validTo: null,
    conditionsText: '',
    rawFacts: {
      sourceType: 'billa-official-algolia',
      objectID: 'obj-1',
      sku: 'sku-1',
      tags: ['pt-sale'],
      snapshotCurrent: true,
    },
    ...overrides,
  };
}

test('detects hidden validity fields with dates in nested raw payloads', () => {
  const signals = detectHiddenValidityFields({
    rawFacts: {
      promotion: {
        validFrom: '2026-05-01',
        validTo: '2026-05-10',
      },
    },
  });

  assert.equal(signals.some((signal) => signal.path === 'rawFacts.promotion.validTo' && signal.hasDate), true);
});

test('classifies campaign-level-only signals separately from offer-level fields', () => {
  const signals = detectHiddenValidityFields({
    campaign: {
      legal: 'Gueltig von 01.05.2026 bis 10.05.2026',
    },
  });

  assert.equal(hasCampaignLevelOnlySignal(signals), true);
  assert.equal(classifyRootCause({
    fieldCoverage: { total: 1, validToPresentCount: 0, snapshotCurrentCount: 0 },
    offerSignals: signals,
    rawDocumentSignals: [],
    codeFindings: [],
  }), 'validity-campaign-level-only');
});

test('classifies missing validTo with snapshotCurrent as not in stored source evidence', () => {
  const coverage = buildFieldCoverage([offer()]);

  assert.equal(coverage.validToPresentCount, 0);
  assert.equal(coverage.snapshotCurrentCount, 1);
  assert.equal(classifyRootCause({
    fieldCoverage: coverage,
    offerSignals: [],
    rawDocumentSignals: [],
  }), 'validity-not-in-source');
});

test('safe example shaping keeps raw payload compact', () => {
  const rawFacts = {
    sourceType: 'billa-official-algolia',
    objectID: 'obj',
    hugePayload: 'x'.repeat(1000),
    tags: Array.from({ length: 20 }, (_, index) => `tag-${index}`),
  };
  const preview = shapeRawFactsPreview(rawFacts);

  assert.equal(preview.hugePayload, undefined);
  assert.equal(preview.tags.length, 8);
});

test('groups BILLA and BILLA PLUS duplicate-like official offers', () => {
  const groups = buildDuplicateGroups([
    offer({ _id: 'billa', retailerKey: 'billa', title: 'Clever Kaffee 500 g', titleNormalized: 'clever kaffee 500 g', priceCurrent: { amount: 4.99 }, quantityText: '500 g' }),
    offer({ _id: 'billa-plus', retailerKey: 'billa-plus', title: 'Clever Kaffee 500 g', titleNormalized: 'clever kaffee 500 g', priceCurrent: { amount: 4.99 }, quantityText: '500 g' }),
    offer({ _id: 'other', retailerKey: 'billa', title: 'Andere Ware', titleNormalized: 'andere ware', priceCurrent: { amount: 1.99 }, quantityText: '1 Stk' }),
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].retailers.sort(), ['billa', 'billa-plus']);
});

test('diagnostic report remains read-only and uses no DB when context is provided', async () => {
  const report = await buildBillaOfficialValidityRootCauseDiagnostic({
    generatedAt: '2026-05-10T12:00:00.000Z',
    context: {
      offers: [
        offer({ _id: 'billa', retailerKey: 'billa' }),
        offer({ _id: 'billa-plus', retailerKey: 'billa-plus' }),
      ],
      rawDocuments: [
        {
          _id: 'raw-1',
          retailerKey: 'billa',
          title: 'BILLA Algolia Promotions',
          payload: { retailerKey: 'billa', hitCount: 100, sampleNames: ['Milch'] },
        },
      ],
      sources: [],
    },
  });

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.summary.billaOfficialCount, 1);
  assert.equal(report.summary.billaPlusOfficialCount, 1);
  assert.equal(report.retailers[0].rootCauseClassification, 'validity-not-in-source');
});
