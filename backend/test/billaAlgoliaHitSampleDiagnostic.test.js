const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildBillaAlgoliaHitSampleDiagnostic,
  classifyValidityEvidence,
  findPossibleValidityFields,
  shapeSampleHit,
  truncate,
} = require('../src/services/diagnostics/billaAlgoliaHitSampleDiagnostic');

test('recursive validity field search finds nested explicit date fields', () => {
  const fields = findPossibleValidityFields({
    objectID: '1',
    promotion: {
      validFrom: '2026-05-01',
      validTo: '2026-05-10',
    },
  });

  assert.equal(fields.some((field) => field.path === 'promotion.validTo' && field.explicitPerHitCandidate), true);
});

test('long values are trimmed', () => {
  const value = truncate('x'.repeat(250), 40);

  assert.equal(value.length, 40);
  assert.equal(value.endsWith('...'), true);
});

test('classification detects explicit campaign legal and none', () => {
  assert.equal(classifyValidityEvidence([
    { path: 'validTo', hasDate: true, explicitPerHitCandidate: true },
  ]), 'explicit-per-hit-validity-present');

  assert.equal(classifyValidityEvidence([
    { path: 'promotion.endDate', hasDate: true, campaignLevelCandidate: true },
  ]), 'campaign-level-validity-only');

  assert.equal(classifyValidityEvidence([
    { path: 'legal.disclaimer', sampleValue: 'Gueltig solange der Vorrat reicht', legalTextCandidate: true },
  ]), 'legal-text-validity-only');

  assert.equal(classifyValidityEvidence([]), 'no-validity-evidence');
});

test('sample hit shaping avoids full payload dumps', () => {
  const shaped = shapeSampleHit({
    objectID: 'obj-1',
    sku: 'sku-1',
    name: 'Bio Milch',
    brand: { name: 'BILLA' },
    price: {
      regular: {
        value: 129,
        promotionText: 'x'.repeat(500),
      },
    },
    hugeNestedPayload: {
      text: 'y'.repeat(1000),
    },
  });

  assert.equal(shaped.objectID, 'obj-1');
  assert.equal(shaped.price.regular, 1.29);
  assert.equal(Object.prototype.hasOwnProperty.call(shaped, 'hugeNestedPayload'), false);
  assert.ok(shaped.price.regularPromotionText.length <= 120);
});

test('diagnostic uses injected fetch and does not require live HTTP in tests', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      hits: [
        {
          objectID: 'obj-1',
          name: 'Bio Milch',
          inPromotion: true,
          validTo: '2026-05-10',
        },
      ],
      nbHits: 1,
      page: 0,
      hitsPerPage: 1,
    }),
  });

  const report = await buildBillaAlgoliaHitSampleDiagnostic({
    fetchImpl,
    hitsPerRetailer: 1,
    generatedAt: '2026-05-10T12:00:00.000Z',
  });

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.summary.billaClassification, 'explicit-per-hit-validity-present');
  assert.equal(report.summary.billaPlusClassification, 'explicit-per-hit-validity-present');
});
