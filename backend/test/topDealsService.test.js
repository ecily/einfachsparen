const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCandidateDecision,
  buildTopDealsFromOffers,
  compareTopDeals,
} = require('../src/services/offers/topDealsService');

const NOW = new Date('2026-07-22T12:00:00.000Z');

function offer(overrides = {}) {
  const currentAmount = overrides.priceCurrent?.amount ?? 2;
  const referenceAmount = overrides.priceReference?.amount ?? 4;
  const totalComparableAmount = overrides.totalComparableAmount ?? 1;
  const unit = overrides.normalizedUnitPrice?.unit || 'l';

  return {
    _id: overrides._id || `offer-${Math.random()}`,
    retailerKey: 'lidl',
    retailerName: 'Lidl',
    title: 'Sicherer Test Deal',
    titleNormalized: 'sicherer test deal',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Saefte & Sirupe',
    categoryConfidence: 0.95,
    status: 'active',
    isActiveNow: true,
    isActiveToday: true,
    validFrom: new Date('2026-07-20T00:00:00.000Z'),
    validTo: new Date('2026-07-24T23:59:59.000Z'),
    lastSeenAt: NOW,
    lastSeenRunId: 'run-1',
    sourceRunStatus: 'success',
    publishStatus: 'finished',
    sourceType: 'lidl-official-html',
    sourceTypes: ['lidl-official-html'],
    sourceUrl: 'https://www.lidl.at/p/test-deal',
    priceCurrent: { amount: currentAmount, currency: 'EUR' },
    priceReference: { amount: referenceAmount, currency: 'EUR' },
    priceReferenceSource: 'prospect',
    priceReferenceConfidence: 0.95,
    hasReferencePrice: true,
    normalizedUnitPrice: {
      amount: currentAmount / totalComparableAmount,
      unit,
      comparable: true,
      confidence: 0.95,
      ...overrides.normalizedUnitPrice,
    },
    totalComparableAmount,
    comparableUnit: unit,
    unitType: unit,
    quantityText: `1 ${unit}`,
    quality: { comparisonSafe: true },
    imageUrl: 'https://www.lidl.at/test.jpg',
    conditionsText: '',
    hasConditions: false,
    customerProgramRequired: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    reviewReasons: [],
    rawFacts: {
      sourceKey: 'lidl-official-html',
    },
    ...overrides,
  };
}

test('accepts a fresh official deal and derives a reference unit price from the same package', () => {
  const response = buildTopDealsFromOffers([offer()], { now: NOW });

  assert.equal(response.count, 1, JSON.stringify(response.excludedReasons));
  assert.equal(response.deals[0].topDeal.currentUnitPrice.amount, 2);
  assert.equal(response.deals[0].topDeal.referenceUnitPrice.amount, 4);
  assert.equal(response.deals[0].topDeal.discountPercent, 50);
  assert.equal(response.deals[0].topDeal.reason, 'Starke Ersparnis nach Preis pro Einheit');
  assert.equal(response.mode, 'strict');
})

test('sorts by verified unit savings and caps the default response at twenty', () => {
  const candidates = Array.from({ length: 25 }, (_, index) => offer({
    _id: `deal-${index}`,
    title: `Deal ${index}`,
    titleNormalized: `deal ${index}`,
    priceCurrent: { amount: 1 + index / 100, currency: 'EUR' },
    priceReference: { amount: 4, currency: 'EUR' },
    imageUrl: index === 0 ? '' : `https://www.lidl.at/${index}.jpg`,
  }));
  const response = buildTopDealsFromOffers(candidates, { limit: 99, now: NOW });

  assert.equal(response.limit, 20);
  assert.equal(response.count, 20);
  assert.equal(response.deals[0].id, 'deal-0');
  assert.ok(response.deals[0].topDeal.discountPercent >= response.deals[1].topDeal.discountPercent);
})

test('keeps an explicit limit of ten and never returns more than requested', () => {
  const candidates = Array.from({ length: 25 }, (_, index) => offer({
    _id: `explicit-${index}`,
    title: `Explicit Deal ${index}`,
    titleNormalized: `explicit deal ${index}`,
  }));
  const response = buildTopDealsFromOffers(candidates, { limit: 10, now: NOW });

  assert.equal(response.limit, 10);
  assert.equal(response.count, 10);
  assert.equal(response.deals.length, 10);
})

test('returns fewer than twenty without unsafe filler offers and carries clear conditions', () => {
  const conditioned = offer({
    _id: 'conditioned',
    hasConditions: true,
    customerProgramRequired: true,
    conditionsText: 'Nur mit Lidl Plus',
  });
  const response = buildTopDealsFromOffers([conditioned], { now: NOW });

  assert.equal(response.count, 1);
  assert.equal(response.deals[0].conditionsText, 'Nur mit Lidl Plus');
})

test('sorts equal percentage deals by absolute unit saving before current unit price', () => {
  const lowerUnitSaving = offer({
    _id: 'lower-unit-saving',
    title: 'Lower unit saving',
    titleNormalized: 'lower unit saving',
    priceCurrent: { amount: 1, currency: 'EUR' },
    priceReference: { amount: 2, currency: 'EUR' },
  });
  const higherUnitSaving = offer({
    _id: 'higher-unit-saving',
    title: 'Higher unit saving',
    titleNormalized: 'higher unit saving',
    priceCurrent: { amount: 5, currency: 'EUR' },
    priceReference: { amount: 10, currency: 'EUR' },
  });
  const response = buildTopDealsFromOffers([lowerUnitSaving, higherUnitSaving], { now: NOW });

  assert.equal(response.deals[0].id, 'higher-unit-saving');
  assert.equal(response.deals[0].topDeal.unitPriceSavingsAmount, 5);
  assert.equal(response.methodology.secondarySort, 'absolute-unit-price-savings');
})

test('sorts lower current unit price first after equal percent and unit saving', () => {
  const lowerCurrent = {
    retailerName: 'A',
    title: 'Lower current',
    topDeal: {
      discountPercent: 50,
      unitPriceSavingsAmount: 2,
      currentUnitPrice: { amount: 3 },
      savingsAmount: 1,
    },
  };
  const higherCurrent = {
    retailerName: 'B',
    title: 'Higher current',
    topDeal: {
      discountPercent: 50,
      unitPriceSavingsAmount: 2,
      currentUnitPrice: { amount: 4 },
      savingsAmount: 9,
    },
  };

  assert.ok(compareTopDeals(lowerCurrent, higherCurrent) < 0);
})

test('applies allowlisted category and retailer filters after all safety guards', () => {
  const coffee = offer({
    _id: 'coffee',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    title: 'Kaffee Ganze Bohne',
    titleNormalized: 'kaffee ganze bohne',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
  });
  const toothpaste = offer({
    _id: 'toothpaste',
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    title: 'Zahnpasta Sensitive',
    titleNormalized: 'zahnpasta sensitive',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Mund- & Zahnpflege',
  });

  const coffeeResponse = buildTopDealsFromOffers([coffee, toothpaste], { category: 'kaffee', now: NOW });
  assert.deepEqual(coffeeResponse.deals.map((deal) => deal.id), ['coffee']);
  assert.deepEqual(coffeeResponse.filters, { category: 'kaffee', retailer: '', invalid: false });
  assert.deepEqual(coffeeResponse.availableFilters.retailers, [
    {
      key: 'billa',
      count: 1,
      strictCount: 1,
      fallbackCount: 0,
      totalShownCount: 1,
      mode: 'strict',
    },
    {
      key: 'bipa',
      count: 1,
      strictCount: 1,
      fallbackCount: 0,
      totalShownCount: 1,
      mode: 'strict',
    },
  ]);
  assert.deepEqual(coffeeResponse.availableFilters.categories, [
    { key: 'getraenke', count: 1 },
    { key: 'drogerie', count: 1 },
    { key: 'kaffee', count: 1 },
    { key: 'zahnpasta', count: 1 },
  ]);

  const bipaResponse = buildTopDealsFromOffers([coffee, toothpaste], { retailer: 'bipa', now: NOW });
  assert.deepEqual(bipaResponse.deals.map((deal) => deal.id), ['toothpaste']);
  assert.deepEqual(bipaResponse.filters, { category: '', retailer: 'bipa', invalid: false });

  const emptyResponse = buildTopDealsFromOffers([coffee, toothpaste], { retailer: 'spar', now: NOW });
  assert.equal(emptyResponse.count, 0);
  assert.equal(emptyResponse.filters.invalid, true);
  assert.equal(emptyResponse.totalGuardedCandidateCount, 2);
})

test('available filters include only positive counts from guarded deduplicated deals', () => {
  const safeBillaBeer = offer({
    _id: 'safe-billa-beer',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    title: 'Sicheres Bier',
    titleNormalized: 'sicheres bier',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
  });
  const unsafeBipaToothpaste = offer({
    _id: 'unsafe-bipa-toothpaste',
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    title: 'Zahnpasta ohne Referenz',
    titleNormalized: 'zahnpasta ohne referenz',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Mund- & Zahnpflege',
    priceReference: { amount: null, currency: 'EUR' },
    hasReferencePrice: false,
  });

  const response = buildTopDealsFromOffers([safeBillaBeer, unsafeBipaToothpaste], { now: NOW });

  assert.deepEqual(response.availableFilters.retailers, [{
    key: 'billa',
    count: 1,
    strictCount: 1,
    fallbackCount: 0,
    totalShownCount: 1,
    mode: 'strict',
  }]);
  assert.deepEqual(response.availableFilters.categories, [
    { key: 'getraenke', count: 1 },
    { key: 'bier', count: 1 },
  ]);
  assert.equal(response.availableFilters.retailers.some(({ key }) => key === 'bipa'), false);
  assert.equal(response.availableFilters.categories.some(({ key }) => key === 'zahnpasta'), false);
  assert.equal(response.excludedReasons['reference-price-unsafe'], 1);
})

test('retailer filter falls back to verified pack savings when strict unit-price deals are unavailable', () => {
  const fallback = offer({
    _id: 'bipa-fallback',
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    sourceType: 'bipa-official-category-expanded',
    sourceTypes: ['bipa-official-category-expanded', 'official-site'],
    sourceUrl: 'https://www.bipa.at/p/test',
    title: 'Sicherer BIPA Rabatt',
    titleNormalized: 'sicherer bipa rabatt',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
    totalComparableAmount: null,
    comparableUnit: '',
    unitType: '',
    quantityText: '',
    conditionsText: 'Aktion',
    hasConditions: true,
  });

  const response = buildTopDealsFromOffers([fallback], { retailer: 'bipa', now: NOW });

  assert.equal(response.mode, 'retailer_discount_fallback');
  assert.equal(response.count, 1);
  assert.equal(response.strictCandidateCount, 0);
  assert.equal(response.fallbackCandidateCount, 1);
  assert.equal(response.totalFallbackCandidateCount, 1);
  assert.equal(response.filteredOutCount, 0);
  assert.equal(response.methodology.primarySort, 'verified-discount-percent');
  assert.equal(
    response.methodology.referencePrice,
    'direct-source-reference-or-explicit-high-confidence-product-percent'
  );
  assert.equal(response.deals[0].retailerKey, 'bipa');
  assert.equal(response.deals[0].conditionsText, 'Aktion');
  assert.equal(response.deals[0].topDeal.discountPercent, 50);
  assert.equal(response.deals[0].topDeal.mode, 'retailer_discount_fallback');
  assert.equal(
    response.deals[0].topDeal.reason,
    'Top Deals nach Markt: höchste verifizierte Ersparnisse dieses Marktes'
  );
  assert.equal(response.deals[0].topDeal.currentUnitPrice, undefined);
  assert.deepEqual(response.availableFilters.retailers, [{
    key: 'bipa',
    count: 1,
    strictCount: 0,
    fallbackCount: 1,
    totalShownCount: 1,
    mode: 'retailer_discount_fallback',
  }]);
})

test('BILLA and Lidl fallback keep safe official discounts despite unrelated review flags', () => {
  for (const [retailerKey, retailerName, sourceType] of [
    ['billa', 'BILLA', 'billa-official-algolia'],
    ['lidl', 'Lidl', 'lidl-official-flyer-api'],
  ]) {
    const fallback = offer({
      _id: `${retailerKey}-reviewed-fallback`,
      retailerKey,
      retailerName,
      sourceType,
      sourceTypes: [sourceType, 'official-site'],
      sourceUrl: `https://example.test/${retailerKey}`,
      normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
      totalComparableAmount: null,
      comparableUnit: '',
      unitType: '',
      quantityText: '',
      needsReview: true,
      reviewReasons: ['Gueltigkeitszeitraum unvollstaendig'],
      conditionsText: '',
      hasConditions: false,
    });

    const response = buildTopDealsFromOffers([fallback], { retailer: retailerKey, now: NOW });

    assert.equal(response.mode, 'retailer_discount_fallback');
    assert.equal(response.count, 1);
    assert.equal(response.fallbackCandidateCount, 1);
    assert.equal(response.deals[0].retailerKey, retailerKey);
    assert.equal(response.deals[0].topDeal.discountPercent, 50);
  }
})

test('retailer discount fallback sorts by percent and rejects unsafe price, validity and savings evidence', () => {
  const fallbackOffer = (overrides = {}) => offer({
    retailerKey: 'dm',
    retailerName: 'dm',
    sourceType: 'dm-official-product-search',
    sourceTypes: ['dm-official-product-search', 'official-site'],
    sourceUrl: 'https://www.dm.at/product',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
    totalComparableAmount: null,
    comparableUnit: '',
    unitType: '',
    quantityText: '',
    ...overrides,
  });
  const lowerDiscount = fallbackOffer({
    _id: 'dm-lower',
    title: 'DM Rabatt niedriger',
    titleNormalized: 'dm rabatt niedriger',
    priceCurrent: { amount: 8, currency: 'EUR' },
    priceReference: { amount: 10, currency: 'EUR' },
  });
  const higherDiscount = fallbackOffer({
    _id: 'dm-higher',
    title: 'DM Rabatt höher',
    titleNormalized: 'dm rabatt hoeher',
    priceCurrent: { amount: 5, currency: 'EUR' },
    priceReference: { amount: 10, currency: 'EUR' },
  });
  const missingPrice = fallbackOffer({
    _id: 'dm-no-price',
    title: 'DM ohne Preis',
    titleNormalized: 'dm ohne preis',
    priceCurrent: { amount: null, currency: 'EUR' },
  });
  const expired = fallbackOffer({
    _id: 'dm-expired',
    title: 'DM abgelaufen',
    titleNormalized: 'dm abgelaufen',
    validTo: new Date('2026-07-21T00:00:00.000Z'),
  });
  const missingReference = fallbackOffer({
    _id: 'dm-no-reference',
    title: 'DM ohne Referenz',
    titleNormalized: 'dm ohne referenz',
    priceReference: { amount: null, currency: 'EUR' },
    hasReferencePrice: false,
  });

  const response = buildTopDealsFromOffers(
    [lowerDiscount, missingPrice, expired, missingReference, higherDiscount],
    { retailer: 'dm', now: NOW }
  );

  assert.deepEqual(response.deals.map((deal) => deal.id), ['dm-higher', 'dm-lower']);
  assert.equal(response.deals[0].topDeal.discountPercent, 50);
  assert.equal(response.deals[1].topDeal.discountPercent, 20);
  assert.equal(response.fallbackExcludedReasons['fallback-price-missing'], 1);
  assert.equal(response.fallbackExcludedReasons['fallback-expired'], 1);
  assert.equal(response.fallbackExcludedReasons['fallback-savings-unsafe'], 1);
})

test('retailer fallback accepts only high-confidence explicit product discounts without a reference price', () => {
  const explicitPercent = (id, savingsConfidence) => offer({
    _id: id,
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    sourceType: 'bipa-official-category-expanded',
    sourceTypes: ['bipa-official-category-expanded', 'official-site'],
    sourceUrl: `https://www.bipa.at/p/${id}`,
    title: `BIPA Prozent ${id}`,
    titleNormalized: `bipa prozent ${id}`,
    priceReference: { amount: null, currency: 'EUR' },
    hasReferencePrice: false,
    discountPercent: 30,
    savingsConfidence,
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
    totalComparableAmount: null,
    comparableUnit: '',
    unitType: '',
    quantityText: '',
    rawFacts: {
      sourceKey: 'bipa-official-category-expanded',
      discountPercent: 30,
      discountAppliesToProduct: true,
      discountLevel: 'product',
    },
  });
  const response = buildTopDealsFromOffers([
    explicitPercent('safe-percent', 0.95),
    explicitPercent('unsafe-percent', 0.4),
  ], { retailer: 'bipa', now: NOW });

  assert.deepEqual(response.deals.map((deal) => deal.id), ['safe-percent']);
  assert.equal(response.deals[0].topDeal.discountPercent, 30);
  assert.equal(response.deals[0].topDeal.evidence, 'explicit_official_discount_percent');
  assert.equal(response.fallbackExcludedReasons['fallback-savings-unsafe'], 1);
})

test('fallback availability covers safe dm and mueller markets but never excluded retailers', () => {
  const fallback = (retailerKey, sourceType) => offer({
    _id: `${retailerKey}-fallback`,
    retailerKey,
    retailerName: retailerKey,
    sourceType,
    sourceTypes: [sourceType, 'official-site'],
    sourceUrl: `https://example.test/${retailerKey}`,
    title: `${retailerKey} sicherer Rabatt`,
    titleNormalized: `${retailerKey} sicherer rabatt`,
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
    totalComparableAmount: null,
    comparableUnit: '',
    unitType: '',
    quantityText: '',
  });
  const response = buildTopDealsFromOffers([
    fallback('dm', 'dm-official-product-search'),
    fallback('mueller', 'mueller-official-online-offers'),
    fallback('spar', 'spar-official-pdf'),
    fallback('eurospar', 'eurospar-official-pdf'),
    fallback('hofer', 'hofer-official-html'),
    fallback('pagro', 'pagro-official-online-offers'),
  ], { now: NOW });

  assert.deepEqual(response.availableFilters.retailers.map(({ key, mode }) => ({ key, mode })), [
    { key: 'dm', mode: 'retailer_discount_fallback' },
    { key: 'mueller', mode: 'retailer_discount_fallback' },
  ]);
  for (const excluded of ['spar', 'eurospar', 'hofer', 'pagro']) {
    assert.equal(response.availableFilters.retailers.some(({ key }) => key === excluded), false);
  }
})

test('excludes missing reference, unsafe unit price, expired, risky retailers and missing prices', () => {
  const unsafeOffers = [
    offer({ _id: 'missing-reference', priceReference: { amount: null, currency: 'EUR' }, hasReferencePrice: false }),
    offer({
      _id: 'unsafe-unit',
      normalizedUnitPrice: { amount: null, unit: 'l', comparable: false },
      totalComparableAmount: null,
      comparableUnit: '',
      unitType: '',
      quantityText: '',
      quality: { comparisonSafe: false },
      reviewReasons: ['quantity-incomplete'],
    }),
    offer({ _id: 'expired', validTo: new Date('2026-07-21T23:59:59.000Z') }),
    offer({ _id: 'spar', retailerKey: 'spar', retailerName: 'SPAR' }),
    offer({ _id: 'eurospar', retailerKey: 'eurospar', retailerName: 'EUROSPAR' }),
    offer({ _id: 'interspar', retailerKey: 'interspar', retailerName: 'INTERSPAR' }),
    offer({ _id: 'hofer', retailerKey: 'hofer', retailerName: 'HOFER' }),
    offer({ _id: 'pagro', retailerKey: 'pagro', retailerName: 'PAGRO' }),
    offer({ _id: 'missing-price', priceCurrent: { amount: null, currency: 'EUR' } }),
  ];
  for (const unsafeOffer of unsafeOffers) {
    assert.equal(buildCandidateDecision(unsafeOffer, NOW).accepted, false, unsafeOffer._id);
  }
  const response = buildTopDealsFromOffers(unsafeOffers, { now: NOW });

  assert.equal(response.count, 0);
  assert.equal(response.excludedReasons['excluded-retailer'], 5);
  assert.ok(response.excludedReasons.expired >= 1);
  assert.ok(response.excludedReasons['unit-price-unsafe'] >= 1);
  assert.ok(response.excludedReasons['reference-price-unsafe'] >= 1);
})

test('excludes free-item promotions because the public unit price guard hides them', () => {
  const response = buildTopDealsFromOffers([offer({
    _id: 'free-item',
    isMultiBuy: true,
    hasConditions: true,
    minimumPurchaseQty: 3,
    conditionsText: '2+1 Gratis',
  })], { now: NOW });

  assert.equal(response.count, 0);
  assert.equal(response.excludedReasons['unit-price-unsafe'], 1);
})

test('excludes the proven BILLA Lindor milk-category mismatch without changing adjacent sweets', () => {
  const wrongCategory = offer({
    _id: 'lindor-milk-category',
    retailerKey: 'billa-plus',
    retailerName: 'BILLA Plus',
    sourceType: 'billa-official-algolia',
    sourceTypes: ['billa-official-algolia'],
    title: 'Lindt Lindt Lindor Kugeln Milch',
    titleNormalized: 'lindt lindt lindor kugeln milch',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
  });
  const correctCategory = offer({
    _id: 'lindor-sweets-category',
    retailerKey: 'billa-plus',
    retailerName: 'BILLA Plus',
    sourceType: 'billa-official-algolia',
    sourceTypes: ['billa-official-algolia'],
    title: 'Lindt Lindt Lindor Kugeln Dark',
    titleNormalized: 'lindt lindt lindor kugeln dark',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Suesswaren & Knabbereien',
  });
  const response = buildTopDealsFromOffers([wrongCategory, correctCategory], { now: NOW });

  assert.equal(response.count, 1);
  assert.equal(response.deals[0].id, 'lindor-sweets-category');
  assert.equal(response.excludedReasons['category-implausible'], 1);
})

test('image is used only as a tie-breaker', () => {
  const withoutImage = offer({ _id: 'without-image', title: 'Deal A', titleNormalized: 'deal a', imageUrl: '' });
  const withImage = offer({ _id: 'with-image', title: 'Deal B', titleNormalized: 'deal b' });
  const response = buildTopDealsFromOffers([withoutImage, withImage], { now: NOW });

  assert.equal(response.deals[0].id, 'with-image');
  assert.equal(response.deals[1].id, 'without-image');
})
