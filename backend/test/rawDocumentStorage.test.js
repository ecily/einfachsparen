const assert = require('node:assert/strict');
const test = require('node:test');
const { _private } = require('../src/services/crawl/rawDocumentStorage');

test('compact raw-document payload preserves bounded rejected candidate evidence', () => {
  const payload = _private.compactPayload({
    rejectedCandidateSamples: Array.from({ length: 25 }, (_, index) => ({
      reason: 'generic-missing-quantity',
      stage: 'generic-text-layer-price-block',
      page: 2,
      blockIndex: index,
      snippet: 'x'.repeat(400),
      nearbyPriceTokens: ['9,99', '12,99'],
      nearbyQuantityTokens: ['1 kg'],
      nearbyConditionTokens: ['ab 2'],
      ignoredObject: { raw: 'drop nested object' },
    })),
  });

  assert.equal(payload.rejectedCandidateSamples.length, 18);
  assert.ok(payload.rejectedCandidateSamples[0].snippet.length <= 220);
  assert.deepEqual(payload.rejectedCandidateSamples[0].nearbyPriceTokens, ['9,99', '12,99']);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.rejectedCandidateSamples[0], 'ignoredObject'), false);
});
