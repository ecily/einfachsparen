const assert = require('node:assert/strict');
const test = require('node:test');
const { _private } = require('../src/services/crawl/catalogDeduper');

test('source dedupe filters can be scoped to the current CrawlRun lineage', () => {
  assert.deepEqual(_private.buildDedupeFilters({
    retailerKeys: ['billa', 'hofer'],
    crawlRunId: 'run-123',
  }), {
    retailerKey: { $in: ['billa', 'hofer'] },
    crawlRunId: 'run-123',
  });
});

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

test('source dedupe image merge copies valid image from safe duplicate when canonical is empty', () => {
  const imageUrl = _private.pickMergedImageUrl(
    { imageUrl: '' },
    [
      { imageUrl: '' },
      { imageUrl: 'https://img.example.test/product.jpg' },
    ]
  );

  assert.equal(imageUrl, 'https://img.example.test/product.jpg');
});

test('source dedupe image merge keeps existing canonical image', () => {
  const imageUrl = _private.pickMergedImageUrl(
    { imageUrl: 'https://img.example.test/canonical.jpg' },
    [
      { imageUrl: 'https://img.example.test/canonical.jpg' },
      { imageUrl: 'https://img.example.test/duplicate.jpg' },
    ]
  );

  assert.equal(imageUrl, 'https://img.example.test/canonical.jpg');
});

test('source dedupe image merge keeps empty image when no duplicate has an image', () => {
  const imageUrl = _private.pickMergedImageUrl(
    { imageUrl: '' },
    [
      { imageUrl: '' },
      { imageUrl: null },
      { imageUrl: undefined },
    ]
  );

  assert.equal(imageUrl, '');
});

test('source dedupe image merge ignores invalid and placeholder image values', () => {
  const imageUrl = _private.pickMergedImageUrl(
    { imageUrl: '' },
    [
      { imageUrl: '' },
      { imageUrl: 'data:image/png;base64,placeholder' },
      { imageUrl: '/relative/product.jpg' },
      { imageUrl: 'https://img.example.test/no-image.png' },
      { imageUrl: 'https://img.example.test/product.jpg' },
    ]
  );

  assert.equal(imageUrl, 'https://img.example.test/product.jpg');
});

test('source dedupe image merge is deterministic for sorted candidates', () => {
  const imageUrl = _private.pickMergedImageUrl(
    { imageUrl: '' },
    [
      { imageUrl: '' },
      { imageUrl: 'https://img.example.test/official.jpg' },
      { imageUrl: 'https://img.example.test/aggregator.jpg' },
    ]
  );

  assert.equal(imageUrl, 'https://img.example.test/official.jpg');
});

test('source dedupe image merge does not mutate condition evidence', () => {
  const canonical = {
    imageUrl: '',
    conditionsText: '',
    customerProgramRequired: false,
    hasConditions: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    benefitType: 'price-cut',
    effectiveDiscountType: 'price-cut',
  };
  const conditional = {
    imageUrl: 'https://img.example.test/product.jpg',
    conditionsText: 'ab 2 Packungen',
    customerProgramRequired: false,
    hasConditions: true,
    isMultiBuy: false,
    minimumPurchaseQty: 2,
    benefitType: 'conditional-price',
    effectiveDiscountType: 'threshold',
  };

  assert.equal(_private.pickMergedImageUrl(canonical, [canonical, conditional]), 'https://img.example.test/product.jpg');
  assert.deepEqual(_private.buildMergedConditionFields(canonical, conditional), {
    benefitType: 'conditional-price',
    effectiveDiscountType: 'threshold',
    conditionsText: 'ab 2 Packungen',
    customerProgramRequired: false,
    hasConditions: true,
    isMultiBuy: false,
    minimumPurchaseQty: 2,
  });
});

test('source dedupe image safety depends on matching dedupe fingerprints', () => {
  const base = {
    retailerKey: 'spar',
    offerType: 'product',
    titleNormalized: 'puntigamer maerzen',
    priceCurrent: { amount: 0.99 },
    effectiveDiscountType: 'price-cut',
    customerProgramRequired: false,
    validTo: new Date('2026-06-02T00:00:00.000Z'),
  };
  const same = {
    ...base,
    imageUrl: 'https://img.example.test/puntigamer.jpg',
  };
  const different = {
    ...base,
    titleNormalized: 'goesser maerzen',
    imageUrl: 'https://img.example.test/goesser.jpg',
  };

  assert.equal(_private.buildDedupeKey(base), _private.buildDedupeKey(same));
  assert.notEqual(_private.buildDedupeKey(base), _private.buildDedupeKey(different));
});

test('source dedupe image URL validation accepts only usable public URL shapes', () => {
  assert.equal(_private.isPreservableImageUrl('https://img.example.test/product.jpg'), true);
  assert.equal(_private.isPreservableImageUrl('http://img.example.test/product.jpg'), true);
  assert.equal(_private.isPreservableImageUrl('/product.jpg'), false);
  assert.equal(_private.isPreservableImageUrl('data:image/png;base64,abc'), false);
  assert.equal(_private.isPreservableImageUrl('https://img.example.test/placeholder.png'), false);
  assert.equal(_private.isPreservableImageUrl(''), false);
});
