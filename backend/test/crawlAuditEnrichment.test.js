const assert = require('node:assert/strict');
const test = require('node:test');
const { computeOfferSavings } = require('../src/services/offers/promotionMath');
const { enrichOfferForStorage, inferRetailerFormatMetadata } = require('../src/services/crawl/offerAuditEnrichment');
const { RETAILER_DEFINITIONS } = require('../src/services/sources/sourceDefinitions');

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

test('keeps SPAR retailer formats on offer documents without changing retailer identity', () => {
  const source = {
    _id: '000000000000000000000003',
    retailerKey: 'spar',
    retailerName: 'Spar',
    sourceRetailerName: 'INTERSPAR',
    sourceRetailerFormat: 'interspar',
    appliesToRetailerFormats: ['interspar'],
    retailerFormatLabel: 'nur INTERSPAR',
    channel: 'aggregator',
    sourceUrl: 'https://example.test/interspar',
  };
  const formatMetadata = inferRetailerFormatMetadata({
    offer: {
      retailerKey: 'spar',
      retailerName: 'Spar',
    },
    source,
  });
  const offer = enrichOfferForStorage({
    sourceId: '000000000000000000000003',
    retailerKey: 'spar',
    retailerName: 'Spar',
    region: 'Grossraum Graz',
    title: 'Zipfer Maerzen INTERSPAR 0.50 Liter 20 Stueck',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    dedupeKey: 'spar::zipfer-maerzen::10-l::price-cut::public::14.8::2026-05-01',
    sourceUrl: 'https://example.test/offer',
    validFrom: new Date(Date.now() - 60 * 60 * 1000),
    validTo: new Date(Date.now() + 24 * 60 * 60 * 1000),
    status: 'active',
    isActiveNow: true,
    priceCurrent: {
      amount: 14.8,
      currency: 'EUR',
      originalText: '14.80 EUR',
    },
    normalizedUnitPrice: {
      amount: 1.48,
      unit: 'l',
      comparable: true,
      confidence: 0.9,
    },
    quality: {
      completenessScore: 1,
      parsingConfidence: 0.9,
      comparisonSafe: true,
      issues: [],
    },
  }, {
    source,
    sourceType: 'aktionsfinder-json',
  });

  assert.equal(formatMetadata.sourceRetailerFormat, 'interspar');
  assert.equal(offer.retailerKey, 'spar');
  assert.deepEqual(offer.appliesToRetailerFormats, ['interspar']);
  assert.equal(offer.retailerFormatLabel, 'nur INTERSPAR');
  assert.match(offer.dedupeKey, /formats:interspar$/);
});

test('does not store future or expired offers', () => {
  const baseOffer = {
    sourceId: '000000000000000000000004',
    retailerKey: 'spar',
    retailerName: 'Spar',
    region: 'Grossraum Graz',
    title: 'Future offer',
    categoryPrimary: 'Lebensmittel',
    sourceUrl: 'https://example.test/offer',
    priceCurrent: { amount: 1.99, currency: 'EUR', originalText: '1.99 EUR' },
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
    quality: { completenessScore: 0.5, parsingConfidence: 0.8, comparisonSafe: false, issues: [] },
  };

  assert.equal(enrichOfferForStorage({
    ...baseOffer,
    validFrom: new Date(Date.now() + 24 * 60 * 60 * 1000),
    validTo: new Date(Date.now() + 48 * 60 * 60 * 1000),
    status: 'upcoming',
  }), null);
  assert.equal(enrichOfferForStorage({
    ...baseOffer,
    validFrom: new Date(Date.now() - 48 * 60 * 60 * 1000),
    validTo: new Date(Date.now() - 24 * 60 * 60 * 1000),
    status: 'expired',
  }), null);
});

test('keeps BILLA and BILLA PLUS separate and disables low-yield sources', () => {
  const billa = RETAILER_DEFINITIONS.find((definition) => definition.retailerKey === 'billa' && definition.channel === 'official-site');
  const billaPlus = RETAILER_DEFINITIONS.find((definition) => definition.retailerKey === 'billa-plus' && definition.channel === 'official-site');
  const marketguruSources = RETAILER_DEFINITIONS.filter((definition) => String(definition.sourceUrl).includes('marktguru.at/'));
  const adegSources = RETAILER_DEFINITIONS.filter((definition) => definition.retailerKey === 'adeg');

  assert.equal(billa?.retailerKey, 'billa');
  assert.equal(billaPlus?.retailerKey, 'billa-plus');
  assert.ok(marketguruSources.length > 0);
  assert.ok(marketguruSources.every((definition) => definition.enabled === false));
  assert.ok(adegSources.length >= 2);
  assert.ok(adegSources.every((definition) => definition.enabled === false));
});
