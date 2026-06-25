const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONFIDENCE,
  evaluateProductEvidenceCandidate,
  evidenceTransportBlocksPublicUse,
} = require('../src/services/evidence/productEvidenceCandidate');

function candidate(overrides = {}) {
  return {
    evidenceSource: 'official-product-fixture',
    productId: '4776529',
    slug: 'spar-qualitaetsmarke-natives-olivenoel-extra-p4776529',
    ean: '9000000000001',
    gtin: '',
    productName: 'SPAR Qualitaetsmarke natives Olivenoel extra',
    brand: 'SPAR',
    quantity: '0,5 l',
    category: 'Lebensmittel',
    imageUrl: 'https://example.invalid/product.jpg',
    productUrl: 'https://example.invalid/product',
    retailerFamily: 'spar-family',
    matchSignals: {
      variantMatch: true,
    },
    ...overrides,
  };
}

const expected = {
  brand: 'SPAR',
  quantity: '500 ml',
};

test('hard match with product id/ean, quantity and brand allows image and metadata only', () => {
  const result = evaluateProductEvidenceCandidate(candidate(), expected);

  assert.equal(result.confidence, CONFIDENCE.HARD);
  assert.equal(result.allowedPublicUse.image, true);
  assert.equal(result.allowedPublicUse.metadata, true);
  assert.equal(result.allowedPublicUse.price, false);
  assert.equal(result.allowedPublicUse.validity, false);
  assert.equal(result.allowedPublicUse.condition, false);
  assert.equal(result.rejectionReason, '');
  assert.equal(result.matchSignals.productId, '4776529');
  assert.equal(result.matchSignals.ean, '9000000000001');
});

test('title-only candidate remains rejected even when visible text looks plausible', () => {
  const result = evaluateProductEvidenceCandidate(
    candidate({ productId: '', ean: '', gtin: '', slug: 'spar-qualitaetsmarke-natives-olivenoel-extra-p4776529' }),
    expected,
  );

  assert.equal(result.confidence, CONFIDENCE.REJECT);
  assert.equal(result.rejectionReason, 'missing-hard-product-identity');
  assert.equal(result.allowedPublicUse.image, false);
  assert.equal(result.matchSignals.titleOnly, true);
});

test('wrong quantity rejects image use despite hard identity', () => {
  const result = evaluateProductEvidenceCandidate(candidate({ quantity: '1 l' }), expected);

  assert.equal(result.confidence, CONFIDENCE.REJECT);
  assert.equal(result.rejectionReason, 'quantity-mismatch');
  assert.equal(result.allowedPublicUse.image, false);
  assert.equal(result.matchSignals.quantityMatch, false);
});

test('wrong variant rejects image use despite matching brand and quantity', () => {
  const result = evaluateProductEvidenceCandidate(
    candidate({
      productName: 'SPAR Olivenoel mild',
      matchSignals: { variantMatch: false },
    }),
    expected,
  );

  assert.equal(result.confidence, CONFIDENCE.REJECT);
  assert.equal(result.rejectionReason, 'variant-not-proven');
  assert.equal(result.allowedPublicUse.image, false);
  assert.equal(result.matchSignals.variantMatch, false);
});

test('ProductEvidence never releases price, validity or condition for public use', () => {
  const result = evaluateProductEvidenceCandidate(
    candidate({
      price: 7.99,
      validFrom: '2026-06-25',
      validTo: '2026-06-30',
      condition: 'ab 2 Stueck',
    }),
    expected,
  );

  assert.equal(result.confidence, CONFIDENCE.HARD);
  assert.deepEqual(result.allowedPublicUse, {
    image: true,
    metadata: true,
    price: false,
    validity: false,
    condition: false,
  });
});

test('403, 429 and zero-hit transport health force no-public state', () => {
  for (const transportHealth of [
    { status: 403 },
    { status: 429 },
    { zeroHits: true },
    { reason: 'transport-error' },
  ]) {
    assert.equal(evidenceTransportBlocksPublicUse(transportHealth), true);
    const result = evaluateProductEvidenceCandidate(candidate(), expected, { transportHealth });

    assert.equal(result.confidence, CONFIDENCE.REJECT);
    assert.equal(result.rejectionReason, 'transport-health-no-public-use');
    assert.equal(result.allowedPublicUse.image, false);
    assert.equal(result.allowedPublicUse.price, false);
    assert.equal(result.matchSignals.transportHealthy, false);
  }
});
