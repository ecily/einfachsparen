const assert = require('node:assert/strict');
const test = require('node:test');
const { computeOfferSavings } = require('../src/services/offers/promotionMath');
const { enrichOfferForStorage } = require('../src/services/crawl/offerAuditEnrichment');

test('marks offers without reference price as action price only', () => {
  const offer = enrichOfferForStorage({
    sourceId: '000000000000000000000001',
    retailerKey: 'hofer',
    retailerName: 'Hofer',
    region: 'Grossraum Graz',
    title: 'Aktionsprodukt',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    categoryKey: 'milchprodukte',
    sourceUrl: 'https://example.test/offer',
    priceCurrent: {
      amount: 1.99,
      currency: 'EUR',
      originalText: '1.99 EUR',
    },
    priceReference: {
      amount: null,
      currency: 'EUR',
      originalText: '',
    },
    normalizedUnitPrice: {
      amount: null,
      unit: '',
      comparable: false,
      confidence: 0,
    },
    quality: {
      completenessScore: 0.7,
      parsingConfidence: 0.8,
      comparisonSafe: false,
      issues: [],
    },
    rawFacts: {
      sourceType: 'flyer',
    },
  }, {
    source: {
      _id: '000000000000000000000002',
      channel: 'official-flyer',
      sourceUrl: 'https://example.test/flyer',
    },
    sourceType: 'flyer',
  });

  assert.equal(offer.savingsDisplayType, 'action-price-only');
  assert.equal(offer.isActionPriceOnly, true);
  assert.equal(offer.hasProspectNormalPrice, false);
  assert.equal(offer.needsReview, true);
  assert.ok(offer.reviewReasons.includes('action-price-only'));
});

test('does not turn estimated reference prices into secure savings', () => {
  const savings = computeOfferSavings({
    title: 'Produkt mit Referenzpreis',
    priceCurrent: { amount: 1.99 },
    priceReference: { amount: 2.49 },
    priceReferenceSource: 'product-search',
    savingsDisplayType: 'estimated-reference-price',
    hasEstimatedReferencePrice: true,
    rawFacts: {},
  });

  assert.equal(savings.savingsAmount, null);
  assert.equal(savings.savingsPercent, null);
});
