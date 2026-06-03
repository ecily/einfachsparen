const assert = require('node:assert/strict');
const test = require('node:test');
const { computeOfferSavings, extractPromotionRequirement } = require('../src/services/offers/promotionMath');
const {
  enrichOfferForStorage,
  inferRetailerFormatMetadata,
  isCurrentlyRelevantOffer,
} = require('../src/services/crawl/offerAuditEnrichment');
const { SEARCH_TOKEN_VERSION } = require('../src/services/offers/searchTokens');
const { RETAILER_DEFINITIONS } = require('../src/services/sources/sourceDefinitions');

const VALIDITY_INCOMPLETE_REASON = 'Gueltigkeitszeitraum unvollstaendig';

function activeComparableOffer(overrides = {}) {
  return {
    sourceId: '000000000000000000000101',
    retailerKey: 'hofer',
    retailerName: 'Hofer',
    region: 'Grossraum Graz',
    title: 'Testprodukt',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Test',
    categoryKey: 'test',
    comparisonGroup: 'testprodukt::basis',
    sourceUrl: 'https://example.test/offer',
    validFrom: new Date(Date.now() - 60 * 60 * 1000),
    validTo: new Date(Date.now() + 24 * 60 * 60 * 1000),
    status: 'active',
    isActiveNow: true,
    priceCurrent: { amount: 1.99, currency: 'EUR', originalText: '1.99 EUR' },
    priceReference: { amount: 2.49, currency: 'EUR', originalText: '2.49 EUR' },
    quantityText: '250 g',
    totalComparableAmount: 0.25,
    comparableUnit: 'kg',
    normalizedUnitPrice: { amount: 7.96, unit: 'kg', comparable: true, confidence: 0.9 },
    quality: { completenessScore: 1, parsingConfidence: 0.9, comparisonSafe: true, issues: [] },
    ...overrides,
  };
}

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
  assert.ok(offer.searchTokens.includes('aktionsprodukt'));
  assert.equal(offer.searchTokenVersion, SEARCH_TOKEN_VERSION);
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

test('computes exact savings from direct prospect reference prices', () => {
  const savings = computeOfferSavings({
    title: 'Lavazza Espresso 1 kg',
    priceCurrent: { amount: 22.99, currency: 'EUR' },
    priceReference: { amount: 28.99, currency: 'EUR' },
    priceReferenceSource: 'prospect',
    savingsDisplayType: 'prospect-saving',
    rawFacts: {},
  });

  assert.equal(savings.referencePrice.type, 'direct_source_reference_price');
  assert.equal(savings.referencePrice.isApproximate, false);
  assert.equal(savings.savingsAmount, 6);
  assert.equal(savings.savings.isApproximate, false);
  assert.equal(savings.savings.basis, 'direct_source_reference_price');
});

test('computes conservative savings for clear x plus y block when source reference is not unit-safe', () => {
  const savings = computeOfferSavings({
    title: 'Puntigamer Maerzen',
    priceCurrent: { amount: 0.77, currency: 'EUR' },
    priceReference: { amount: 11.54, currency: 'EUR' },
    priceReferenceSource: 'prospect',
    savingsDisplayType: 'prospect-saving',
    conditionsText: 'Extrem Aktion; 12+12 gratis; bei 24 Dosen je 0,77 / 12+12 gratis / bei 24 Dosen',
    isMultiBuy: true,
    effectiveDiscountType: 'multi-buy',
    rawFacts: {
      minimumPurchaseQuantity: 24,
    },
  });

  assert.equal(savings.requiredQuantity, 24);
  assert.equal(savings.payableQuantity, 12);
  assert.equal(savings.referencePrice.amount, null);
  assert.equal(savings.referencePrice.unsafeReason, 'block-reference-price-not-unit-safe');
  assert.equal(savings.savingsAmount, 18.48);
  assert.equal(savings.savingsPercent, 50);
  assert.equal(savings.savings.isApproximate, true);
  assert.equal(savings.savings.basis, 'derived_x_plus_y_block');
  assert.notEqual(savings.savingsAmount, 258.48);
});

test('does not count unsafe block reference savings without clear plus-free mechanic', () => {
  const savings = computeOfferSavings({
    title: 'Blockangebot ohne klare Gratis-Mechanik',
    priceCurrent: { amount: 0.77, currency: 'EUR' },
    priceReference: { amount: 11.54, currency: 'EUR' },
    priceReferenceSource: 'prospect',
    savingsDisplayType: 'prospect-saving',
    conditionsText: 'Gilt ab 24 Dosen / bei 24 Dosen je 0,77',
    isMultiBuy: true,
    effectiveDiscountType: 'multi-buy',
  });

  assert.equal(savings.referencePrice.amount, null);
  assert.equal(savings.referencePrice.unsafeReason, 'block-reference-price-not-unit-safe');
  assert.equal(savings.savingsAmount, null);
  assert.equal(savings.savings.basis, 'none');
});

test('derives approximate reference price and savings from product-level percent discount', () => {
  const enriched = enrichOfferForStorage(activeComparableOffer({
    title: 'Dallmayr Prodomo 500 g',
    priceCurrent: { amount: 11.99, currency: 'EUR', originalText: '11.99 EUR' },
    priceReference: { amount: null, currency: 'EUR', originalText: '' },
    rawFacts: {
      discountPercentage: 25,
    },
  }));
  const savings = computeOfferSavings(enriched);

  assert.equal(enriched.priceReference.amount, 15.99);
  assert.equal(enriched.priceReferenceSource, 'discount-percent-derived');
  assert.equal(enriched.hasEstimatedReferencePrice, true);
  assert.equal(enriched.hasProspectNormalPrice, false);
  assert.equal(savings.referencePrice.type, 'source_percent_derived');
  assert.equal(savings.referencePrice.discountPercent, 25);
  assert.equal(savings.referencePrice.isApproximate, true);
  assert.equal(savings.savingsAmount, 4);
  assert.equal(savings.savingsPercent, 25);
  assert.equal(savings.savings.isApproximate, true);
  assert.match(savings.savings.label, /Spart ca\./);
});

test('does not derive product savings from campaign-level percent discounts', () => {
  const savings = computeOfferSavings({
    title: 'Kaffee Aktion',
    priceCurrent: { amount: 11.99 },
    priceReference: { amount: null },
    rawFacts: {
      discountPercentage: 25,
      discountScope: 'campaign',
    },
  });

  assert.equal(savings.referencePrice.type, 'none');
  assert.equal(savings.savingsAmount, null);
  assert.equal(savings.savings.basis, 'none');
});

test('does not show savings when comparison basis is missing', () => {
  const savings = computeOfferSavings({
    title: 'Aktionsprodukt ohne Normalpreis',
    priceCurrent: { amount: 1.99 },
    priceReference: { amount: null },
    rawFacts: {},
  });

  assert.equal(savings.referencePrice.amount, null);
  assert.equal(savings.savingsAmount, null);
  assert.equal(savings.savings.label, 'Aktionspreis');
});

test('clears comparisonSafe and normalized comparability when comparableUnit is missing', () => {
  const offer = enrichOfferForStorage(activeComparableOffer({
    title: 'Testprodukt ohne sichere Menge',
    quantityText: 'Packung',
    totalComparableAmount: null,
    comparableUnit: '',
    normalizedUnitPrice: { amount: 7.96, unit: 'kg', comparable: true, confidence: 0.9 },
  }));

  assert.equal(offer.quality.comparisonSafe, false);
  assert.equal(offer.normalizedUnitPrice.comparable, false);
  assert.ok(offer.reviewReasons.includes('Vergleichseinheit unklar'));
});

test('keeps clear kg/g and l/ml offers comparable', () => {
  const butter = enrichOfferForStorage(activeComparableOffer({
    title: 'Butter 250 g',
    quantityText: '250 g',
    totalComparableAmount: 0.25,
    comparableUnit: 'kg',
    normalizedUnitPrice: { amount: 7.96, unit: 'kg', comparable: true, confidence: 0.9 },
  }));
  const milk = enrichOfferForStorage(activeComparableOffer({
    title: 'Milch 500 ml',
    quantityText: '500 ml',
    totalComparableAmount: 0.5,
    comparableUnit: 'l',
    normalizedUnitPrice: { amount: 1.98, unit: 'l', comparable: true, confidence: 0.9 },
  }));

  assert.equal(butter.quality.comparisonSafe, true);
  assert.equal(butter.normalizedUnitPrice.comparable, true);
  assert.equal(milk.quality.comparisonSafe, true);
  assert.equal(milk.normalizedUnitPrice.comparable, true);
});

test('keeps plausible piece, tab and capsule offers comparable only with a count', () => {
  const tabs = enrichOfferForStorage(activeComparableOffer({
    title: 'Waschmittel 20 Tabs',
    categoryPrimary: 'Haushalt',
    categorySecondary: 'Waschmittel & Reiniger',
    quantityText: '20 Tabs',
    totalComparableAmount: 20,
    comparableUnit: 'Stk',
    normalizedUnitPrice: { amount: 0.25, unit: 'Stk', comparable: true, confidence: 0.9 },
  }));
  const unclearPieces = enrichOfferForStorage(activeComparableOffer({
    title: 'Waschmittel Tabs',
    categoryPrimary: 'Haushalt',
    categorySecondary: 'Waschmittel & Reiniger',
    quantityText: 'Tabs',
    totalComparableAmount: null,
    comparableUnit: 'Stk',
    normalizedUnitPrice: { amount: 4.99, unit: 'Stk', comparable: true, confidence: 0.9 },
  }));

  assert.equal(tabs.quality.comparisonSafe, true);
  assert.equal(tabs.normalizedUnitPrice.comparable, true);
  assert.equal(unclearPieces.quality.comparisonSafe, false);
  assert.equal(unclearPieces.normalizedUnitPrice.comparable, false);
  assert.ok(unclearPieces.reviewReasons.includes('Menge unvollstaendig'));
});

test('recognizes multi-buy and threshold promotion requirements conservatively', () => {
  assert.deepEqual(extractPromotionRequirement({ title: 'Kaffee 2+1 gratis' }), {
    requiredQuantity: 3,
    payableQuantity: 2,
    mechanic: 'x-plus-y',
  });
  assert.deepEqual(extractPromotionRequirement({ title: 'Bier 4 fuer 2' }), {
    requiredQuantity: 4,
    payableQuantity: 2,
    mechanic: 'x-for-y',
  });
  assert.deepEqual(extractPromotionRequirement({ title: 'Nimm 3 zahl 2' }), {
    requiredQuantity: 3,
    payableQuantity: 2,
    mechanic: 'x-for-y',
  });
  assert.deepEqual(extractPromotionRequirement({ conditionsText: 'ab 2 Stueck' }), {
    requiredQuantity: 2,
    payableQuantity: null,
    mechanic: 'threshold',
  });
  assert.deepEqual(extractPromotionRequirement({ title: 'Reiniger ab 2 Pkg. je 3,49' }), {
    requiredQuantity: 2,
    payableQuantity: null,
    mechanic: 'threshold',
  });
  assert.deepEqual(extractPromotionRequirement({ title: 'Sonnenmilch Ultra Sensitive LSF 50+' }), {
    requiredQuantity: 1,
    payableQuantity: null,
    mechanic: 'single',
  });
  assert.deepEqual(extractPromotionRequirement({ title: 'SPF 50+ Sun Spray' }), {
    requiredQuantity: 1,
    payableQuantity: null,
    mechanic: 'single',
  });
  assert.deepEqual(extractPromotionRequirement({ title: 'Sonnenmilch Ultra Sensitive LSF 50+ 2+1 gratis' }), {
    requiredQuantity: 3,
    payableQuantity: 2,
    mechanic: 'x-plus-y',
  });
});

test('sets condition fields for multi-buy, minimum quantity and app or card prices', () => {
  const multiBuy = enrichOfferForStorage(activeComparableOffer({
    title: 'Kaffee 3+1 gratis',
    conditionsText: '3+1 gratis',
  }));
  const threshold = enrichOfferForStorage(activeComparableOffer({
    title: 'Bier Aktion',
    conditionsText: 'ab 2 Stueck',
  }));
  const appPrice = enrichOfferForStorage(activeComparableOffer({
    title: 'Joghurt App-Preis mit Kundenkarte',
  }));

  assert.equal(multiBuy.isMultiBuy, true);
  assert.equal(multiBuy.minimumPurchaseQty, 4);
  assert.equal(multiBuy.effectiveDiscountType, 'multi-buy');
  assert.equal(threshold.minimumPurchaseQty, 2);
  assert.equal(threshold.effectiveDiscountType, 'threshold');
  assert.equal(appPrice.customerProgramRequired, true);
  assert.equal(appPrice.hasConditions, true);
  assert.equal(appPrice.effectiveDiscountType, 'card-required');
});

test('does not turn LSF or SPF protection factors into purchase conditions', () => {
  const lsfOnly = enrichOfferForStorage(activeComparableOffer({
    title: 'BI KIDS Sonnenmilch Ultra Sensitive LSF 50+',
    conditionsText: '',
  }));
  const spfOnly = enrichOfferForStorage(activeComparableOffer({
    title: 'SPF 50+ Sun Spray',
    conditionsText: '',
  }));
  const realBundle = enrichOfferForStorage(activeComparableOffer({
    title: 'BI KIDS Sonnenmilch Ultra Sensitive LSF 50+ 2+1 gratis',
    conditionsText: '',
  }));

  assert.equal(lsfOnly.conditionsText, '');
  assert.equal(lsfOnly.hasConditions, false);
  assert.equal(lsfOnly.isMultiBuy, false);
  assert.equal(lsfOnly.minimumPurchaseQty, 1);
  assert.equal(spfOnly.conditionsText, '');
  assert.equal(spfOnly.minimumPurchaseQty, 1);
  assert.match(realBundle.conditionsText, /2\+1 gratis/);
  assert.equal(realBundle.isMultiBuy, true);
  assert.equal(realBundle.minimumPurchaseQty, 3);
});

test('extracts conservative German condition hints into stored condition text', () => {
  const cases = [
    ['S-BUDGET Pasta 2+1 gratis', /2\+1 gratis/, { isMultiBuy: true, minimumPurchaseQty: 3 }],
    ['Pizza 2 fuer 1', /2 fuer 1/, { isMultiBuy: true, minimumPurchaseQty: 2 }],
    ['Nimm 3 zahl 2 Chips', /Nimm 3 zahl 2/, { isMultiBuy: true, minimumPurchaseQty: 3 }],
    ['Mineralwasser ab 6 Flaschen je 0,49', /ab 6 Flaschen/, { isMultiBuy: false, minimumPurchaseQty: 6 }],
    ['Teigwaren ab 2 Packungen je 1,99', /ab 2 Packungen/, { isMultiBuy: false, minimumPurchaseQty: 2 }],
    ['Blue Star WC-Steine Doppelpackung ab 2 Pkg. je', /ab 2 Packungen/, { isMultiBuy: false, minimumPurchaseQty: 2 }],
    ['Felix Katzennahrung versch. Sorten ab 2 Pkg. je 3,74', /ab 2 Packungen/, { isMultiBuy: false, minimumPurchaseQty: 2 }],
    ['Kaffee nur mit App', /nur mit App/, { customerProgramRequired: true }],
    ['Waschmittel mit Gutschein', /mit Gutschein\/Coupon/, { hasConditions: true }],
    ['-25% auf alle Biere', /-25% auf alle biere/i, { hasConditions: true }],
  ];

  for (const [title, conditionPattern, expectations] of cases) {
    const stored = enrichOfferForStorage(activeComparableOffer({ title, conditionsText: '' }));

    assert.match(stored.conditionsText, conditionPattern, title);
    assert.equal(stored.hasConditions, true, title);

    for (const [field, expected] of Object.entries(expectations)) {
      assert.equal(stored[field], expected, `${title} ${field}`);
    }
  }
});

test('infers safe quantity fields from common product text without treating LSF as quantity', () => {
  const hugo = enrichOfferForStorage(activeComparableOffer({
    title: 'Hugo Boss Hugo Man Eau de Toilette 75 ml',
    quantityText: '',
    totalComparableAmount: null,
    comparableUnit: '',
    unitValue: null,
    unitType: '',
    priceCurrent: { amount: 26.99, currency: 'EUR', originalText: '26.99 EUR' },
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
  }));
  const davidoff = enrichOfferForStorage(activeComparableOffer({
    title: 'Davidoff Cool Water Man Eau de Toilette 75 ml',
    quantityText: '',
    totalComparableAmount: null,
    comparableUnit: '',
    unitValue: null,
    unitType: '',
    priceCurrent: { amount: 17.99, currency: 'EUR', originalText: '17.99 EUR' },
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
  }));
  const boss100 = enrichOfferForStorage(activeComparableOffer({
    title: 'Boss Bottled Eau de Toilette 100ml',
    quantityText: '',
    totalComparableAmount: null,
    comparableUnit: '',
    unitValue: null,
    unitType: '',
    priceCurrent: { amount: 57.99, currency: 'EUR', originalText: '57.99 EUR' },
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
  }));
  const boss200 = enrichOfferForStorage(activeComparableOffer({
    title: 'Boss Bottled Eau de Toilette 200ml',
    quantityText: '',
    totalComparableAmount: null,
    comparableUnit: '',
    unitValue: null,
    unitType: '',
    priceCurrent: { amount: 76.99, currency: 'EUR', originalText: '76.99 EUR' },
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
  }));
  const myLand = enrichOfferForStorage(activeComparableOffer({
    title: 'My Land Eau de Toilette 50ml',
    quantityText: '',
    totalComparableAmount: null,
    comparableUnit: '',
    unitValue: null,
    unitType: '',
    priceCurrent: { amount: 31.49, currency: 'EUR', originalText: '31.49 EUR' },
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
  }));
  const ladyMillion = enrichOfferForStorage(activeComparableOffer({
    title: 'Paco Rabanne Lady Million Eau de Parfum BIPA 50 Milliliter 1 Stueck',
    quantityText: '1 Stueck',
    totalComparableAmount: 1,
    comparableUnit: 'Stk',
    unitValue: 1,
    unitType: 'Stk',
    priceCurrent: { amount: 62.99, currency: 'EUR', originalText: '62.99 EUR' },
    normalizedUnitPrice: { amount: 62.99, unit: 'Stk', comparable: true, confidence: 0.8 },
  }));
  const casePack = enrichOfferForStorage(activeComparableOffer({
    title: 'Puntigamer 20 x 0,5 l',
    quantityText: '',
    totalComparableAmount: null,
    comparableUnit: '',
    unitValue: null,
    unitType: '',
    priceCurrent: { amount: 19.8, currency: 'EUR', originalText: '19.80 EUR' },
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
  }));
  const lsf = enrichOfferForStorage(activeComparableOffer({
    title: 'Sonnencreme LSF 50+',
    quantityText: '',
    totalComparableAmount: null,
    comparableUnit: '',
    unitValue: null,
    unitType: '',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
  }));

  assert.equal(hugo.unitValue, 75);
  assert.equal(hugo.quantityText, '75 ml');
  assert.equal(hugo.unitType, 'ml');
  assert.equal(hugo.totalComparableAmount, 0.075);
  assert.equal(hugo.comparableUnit, 'l');
  assert.equal(hugo.normalizedUnitPrice.amount, 359.87);
  assert.equal(hugo.quality.comparisonSafe, true);
  assert.equal(davidoff.normalizedUnitPrice.amount, 239.87);
  assert.equal(davidoff.quantityText, '75 ml');
  assert.equal(boss100.quantityText, '100 ml');
  assert.equal(boss100.normalizedUnitPrice.amount, 579.9);
  assert.equal(boss100.quality.comparisonSafe, true);
  assert.equal(boss200.quantityText, '200 ml');
  assert.equal(boss200.normalizedUnitPrice.amount, 384.95);
  assert.equal(myLand.quantityText, '50 ml');
  assert.equal(myLand.normalizedUnitPrice.amount, 629.8);
  assert.equal(ladyMillion.quantityText, '50 ml');
  assert.equal(ladyMillion.unitType, 'ml');
  assert.equal(ladyMillion.comparableUnit, 'l');
  assert.equal(ladyMillion.normalizedUnitPrice.amount, 1259.8);
  assert.equal(casePack.packCount, 20);
  assert.equal(casePack.quantityText, '20 x 0,5 l');
  assert.equal(casePack.unitValue, 0.5);
  assert.equal(casePack.totalComparableAmount, 10);
  assert.equal(casePack.normalizedUnitPrice.amount, 1.98);
  assert.equal(lsf.totalComparableAmount, null);
  assert.equal(lsf.comparableUnit, '');
  assert.equal(lsf.quality.comparisonSafe, false);
});

test('keeps condition text when offer is normalized for storage', () => {
  const stored = enrichOfferForStorage(activeComparableOffer({
    title: 'Limonade Aktion',
    description: 'nur in teilnehmenden Maerkten, solange der Vorrat reicht',
    conditionsText: '',
  }));

  assert.match(stored.conditionsText, /nur in teilnehmenden Maerkten/);
  assert.match(stored.conditionsText, /solange der Vorrat reicht/);
  assert.equal(stored.hasConditions, true);
  assert.ok(stored.searchTokens.includes('teilnehmenden'));
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

test('date-only flyer validity is relevant for the whole local validity day', () => {
  const morningOfStartDay = new Date('2026-05-28T08:59:00.000Z');

  assert.equal(isCurrentlyRelevantOffer({
    status: 'active',
    validFrom: '2026-05-28',
  }, morningOfStartDay), true);
  assert.equal(isCurrentlyRelevantOffer({
    status: 'active',
    validFrom: '2026-05-28',
    validTo: '2026-06-02',
  }, morningOfStartDay), true);
  assert.equal(isCurrentlyRelevantOffer({
    status: 'active',
    validFrom: '2026-05-29',
  }, morningOfStartDay), false);
  assert.equal(isCurrentlyRelevantOffer({
    status: 'active',
    validFrom: '2026-05-28',
    validTo: '2026-06-02',
  }, new Date('2026-06-02T21:30:00.000Z')), true);
  assert.equal(isCurrentlyRelevantOffer({
    status: 'active',
    validFrom: '2026-05-28',
    validTo: '2026-06-02',
  }, new Date('2026-06-02T22:30:00.000Z')), false);
});

test('current-day flyer validity remains storable before noon UTC while future days stay blocked', () => {
  const currentDayOffer = activeComparableOffer({
    validFrom: '2026-05-28',
    validTo: '2026-06-02',
    status: 'active',
  });
  const futureDayOffer = activeComparableOffer({
    validFrom: '2026-05-29',
    validTo: '2026-06-02',
    status: 'active',
  });
  const now = new Date('2026-05-28T08:59:00.000Z');

  assert.equal(isCurrentlyRelevantOffer(currentDayOffer, now), true);
  assert.equal(isCurrentlyRelevantOffer(futureDayOffer, now), false);
});

test('keeps BILLA and BILLA PLUS separate and disables low-yield sources', () => {
  const billa = RETAILER_DEFINITIONS.find((definition) => definition.retailerKey === 'billa' && definition.channel === 'official-site');
  const billaPlus = RETAILER_DEFINITIONS.find((definition) => definition.retailerKey === 'billa-plus' && definition.channel === 'official-site');
  const sparPdf = RETAILER_DEFINITIONS.find((definition) => definition.sourceRetailerFormat === 'spar' && definition.sourceType === 'pdf');
  const eurosparPdf = RETAILER_DEFINITIONS.find((definition) => definition.sourceRetailerFormat === 'eurospar' && definition.sourceType === 'pdf');
  const intersparPdf = RETAILER_DEFINITIONS.find((definition) => definition.sourceRetailerFormat === 'interspar' && definition.sourceType === 'pdf');
  const marketguruSources = RETAILER_DEFINITIONS.filter((definition) => String(definition.sourceUrl).includes('marktguru.at/'));
  const adegSources = RETAILER_DEFINITIONS.filter((definition) => definition.retailerKey === 'adeg');

  assert.equal(billa?.retailerKey, 'billa');
  assert.equal(billaPlus?.retailerKey, 'billa-plus');
  assert.equal(sparPdf?.retailerKey, 'spar');
  assert.equal(eurosparPdf?.retailerKey, 'eurospar');
  assert.equal(intersparPdf?.retailerKey, 'interspar');
  assert.ok(marketguruSources.length > 0);
  assert.ok(marketguruSources.every((definition) => definition.enabled === false));
  assert.ok(adegSources.length >= 2);
  assert.ok(adegSources.every((definition) => definition.enabled === false));
});

test('official SPAR flyer source validity uses local-day boundaries', () => {
  const morningOfStartDay = new Date('2026-06-03T08:59:00.000Z');
  const endOfLastDay = new Date('2026-06-17T21:30:00.000Z');
  const sparPdf = RETAILER_DEFINITIONS.find((definition) => definition.sourceRetailerFormat === 'spar' && definition.sourceType === 'pdf');
  const eurosparPdf = RETAILER_DEFINITIONS.find((definition) => definition.sourceRetailerFormat === 'eurospar' && definition.sourceType === 'pdf');
  const intersparPdf = RETAILER_DEFINITIONS.find((definition) => definition.sourceRetailerFormat === 'interspar' && definition.sourceType === 'pdf');

  for (const source of [sparPdf, intersparPdf]) {
    assert.ok(new Date(source.crawlPolicy.validFrom) <= morningOfStartDay);
    assert.ok(new Date(source.crawlPolicy.validTo) > endOfLastDay);
  }
  assert.ok(new Date(eurosparPdf.crawlPolicy.validTo) > endOfLastDay);
});

test('does not mark offers with clear validTo as incomplete validity', () => {
  const offer = enrichOfferForStorage({
    sourceId: '000000000000000000000005',
    retailerKey: 'hofer',
    retailerName: 'Hofer',
    region: 'Grossraum Graz',
    title: 'Milsani Butter 250 g',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    sourceUrl: 'https://example.test/offer',
    validFrom: new Date(Date.now() - 60 * 60 * 1000),
    validTo: new Date(Date.now() + 24 * 60 * 60 * 1000),
    status: 'active',
    isActiveNow: true,
    priceCurrent: { amount: 1.99, currency: 'EUR', originalText: '1.99 EUR' },
    priceReference: { amount: 2.49, currency: 'EUR', originalText: '2.49 EUR' },
    quantityText: '250 g',
    normalizedUnitPrice: { amount: 7.96, unit: 'kg', comparable: true, confidence: 0.9 },
    quality: { completenessScore: 1, parsingConfidence: 0.9, comparisonSafe: true, issues: [] },
  }, {
    source: {
      _id: '000000000000000000000006',
      channel: 'aggregator',
      sourceUrl: 'https://example.test/source',
    },
    sourceType: 'aktionsfinder-json',
  });

  assert.ok(offer);
  assert.equal(offer.reviewReasons.includes(VALIDITY_INCOMPLETE_REASON), false);
  assert.equal(offer.quality.issues.includes(VALIDITY_INCOMPLETE_REASON), false);
  assert.equal(offer.quality.completenessScore, 1);
});

test('marks offers without validTo with a clear validity review reason', () => {
  const offer = enrichOfferForStorage({
    sourceId: '000000000000000000000007',
    retailerKey: 'billa',
    retailerName: 'Billa',
    region: 'Grossraum Graz',
    title: 'BILLA Bio Butter 250 g',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    sourceUrl: 'https://example.test/offer',
    validFrom: new Date(Date.now() - 60 * 60 * 1000),
    validTo: null,
    status: 'active',
    isActiveNow: true,
    priceCurrent: { amount: 2.19, currency: 'EUR', originalText: '2.19 EUR' },
    priceReference: { amount: 2.69, currency: 'EUR', originalText: '2.69 EUR' },
    quantityText: '250 g',
    normalizedUnitPrice: { amount: 8.76, unit: 'kg', comparable: true, confidence: 0.9 },
    quality: { completenessScore: 1, parsingConfidence: 0.9, comparisonSafe: true, issues: [] },
    rawFacts: {
      sourceType: 'billa-official-algolia',
      snapshotCurrent: true,
    },
  }, {
    source: {
      _id: '000000000000000000000008',
      channel: 'official-site',
      sourceUrl: 'https://example.test/source',
    },
    sourceType: 'billa-official-algolia',
  });

  assert.ok(offer);
  assert.equal(offer.needsReview, true);
  assert.ok(offer.reviewReasons.includes(VALIDITY_INCOMPLETE_REASON));
  assert.ok(offer.quality.issues.includes(VALIDITY_INCOMPLETE_REASON));
  assert.equal(offer.quality.completenessScore, 0.9);
});
