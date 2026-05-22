const assert = require('node:assert/strict');
const test = require('node:test');
const { _private } = require('../src/services/crawl/catalogDeduper');

test('source dedupe condition merge keeps conditional offer fields', () => {
  const canonical = {
    conditionsText: '',
    customerProgramRequired: false,
    hasConditions: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    benefitType: 'price-cut',
    effectiveDiscountType: 'price-cut',
  };
  const conditional = {
    conditionsText: 'ab 6 Flaschen',
    customerProgramRequired: false,
    hasConditions: true,
    isMultiBuy: false,
    minimumPurchaseQty: 6,
    benefitType: 'conditional-price',
    effectiveDiscountType: 'threshold',
  };

  assert.deepEqual(_private.buildMergedConditionFields(canonical, conditional), {
    benefitType: 'conditional-price',
    effectiveDiscountType: 'threshold',
    conditionsText: 'ab 6 Flaschen',
    customerProgramRequired: false,
    hasConditions: true,
    isMultiBuy: false,
    minimumPurchaseQty: 6,
  });
});

test('source dedupe condition preference picks richer condition evidence', () => {
  const best = _private.pickBestConditionOffer([
    { conditionsText: '', hasConditions: false, minimumPurchaseQty: 1 },
    { conditionsText: 'nur mit App', customerProgramRequired: true, hasConditions: true, minimumPurchaseQty: 1 },
    { conditionsText: 'ab 2 Packungen', hasConditions: true, minimumPurchaseQty: 2 },
  ]);

  assert.equal(best.conditionsText, 'nur mit App');
});
