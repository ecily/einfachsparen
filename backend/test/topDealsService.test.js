const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCandidateDecision, buildTopDealsFromOffers } = require('../src/services/offers/topDealsService');

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
})

test('sorts by percentage, then absolute savings, then image and limits to ten', () => {
  const candidates = Array.from({ length: 12 }, (_, index) => offer({
    _id: `deal-${index}`,
    title: `Deal ${index}`,
    titleNormalized: `deal ${index}`,
    priceCurrent: { amount: 1 + index / 100, currency: 'EUR' },
    priceReference: { amount: 4, currency: 'EUR' },
    imageUrl: index === 0 ? '' : `https://www.lidl.at/${index}.jpg`,
  }));
  const response = buildTopDealsFromOffers(candidates, { limit: 99, now: NOW });

  assert.equal(response.limit, 10);
  assert.equal(response.count, 10);
  assert.equal(response.deals[0].id, 'deal-0');
  assert.ok(response.deals[0].topDeal.discountPercent >= response.deals[1].topDeal.discountPercent);
})

test('returns fewer than ten without unsafe filler offers and carries clear conditions', () => {
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
    offer({ _id: 'missing-price', priceCurrent: { amount: null, currency: 'EUR' } }),
  ];
  for (const unsafeOffer of unsafeOffers) {
    assert.equal(buildCandidateDecision(unsafeOffer, NOW).accepted, false, unsafeOffer._id);
  }
  const response = buildTopDealsFromOffers(unsafeOffers, { now: NOW });

  assert.equal(response.count, 0);
  assert.equal(response.excludedReasons['excluded-retailer'], 4);
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

test('image is used only as a tie-breaker', () => {
  const withoutImage = offer({ _id: 'without-image', title: 'Deal A', titleNormalized: 'deal a', imageUrl: '' });
  const withImage = offer({ _id: 'with-image', title: 'Deal B', titleNormalized: 'deal b' });
  const response = buildTopDealsFromOffers([withoutImage, withImage], { now: NOW });

  assert.equal(response.deals[0].id, 'with-image');
  assert.equal(response.deals[1].id, 'without-image');
})
