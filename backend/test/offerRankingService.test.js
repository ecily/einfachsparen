const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyQueryMatch,
  buildRankingCandidateLimit,
  buildRankingCandidateFallbackMatch,
  buildRankingCandidateMatch,
  buildRetailerScopeMatch,
  buildRankedOffer,
  buildValidityLabel,
  buildGroupedRankings,
  buildKnownCategoryLabelMap,
  buildRankingBaseCacheKey,
  createResultSetToken,
  dedupeFinalResponseOffers,
  dedupeQueryOffers,
  dedupeResponseOffers,
  dedupeVisibleCardResponseOffers,
  mergeSparConditionEvidenceIntoOffers,
  canMergeConditionEvidence,
  buildRankingCandidateQueryMetadata,
  hashRankingCacheKey,
  buildRankingResponseFromBase,
  filterFreshActiveOffers,
  getRankingCacheCapabilities,
  normalizeSearchText,
  normalizeRetailerList,
  paginateVisibleRankingOffers,
  parseRankingCategories,
  prepareQueryOffersForResponse,
  scoreOfferAgainstQuery,
  tokenizeSearchText,
} = require('../src/services/offers/offerRankingService');
const { FOOD_OIL_PRODUCT_TOKENS } = require('../src/services/offers/searchTokens');
const { classifyOfferSourceQuality } = require('../src/services/offers/sourceQuality');

function offer(overrides) {
  return {
    title: '',
    brand: '',
    categoryPrimary: '',
    categorySecondary: '',
    subcategoryKey: '',
    comparisonGroup: '',
    searchText: '',
    retailerName: 'Testmarkt',
    normalizedUnitPrice: { amount: 1 },
    ...overrides,
  };
}

function sparOffer(overrides = {}) {
  return offer({
    retailerKey: 'spar',
    retailerName: 'SPAR',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    brand: 'Goesser',
    title: 'Gösser Märzen SPAR 0.50 Liter 1 Dose',
    quantityText: '0.5 l / 1 dose',
    packCount: 1,
    unitValue: 0.5,
    unitType: 'l',
    totalComparableAmount: 0.5,
    comparableUnit: 'l',
    priceCurrent: { amount: 0.99, currency: 'EUR' },
    normalizedUnitPrice: { amount: 1.98, unit: 'l', comparable: true, confidence: 0.9 },
    sourceType: 'aktionsfinder-json',
    rawFacts: { sourceKey: 'aktionsfinder-spar' },
    imageUrl: 'https://example.test/goesser.jpg',
    conditionsText: '',
    hasConditions: false,
    isMultiBuy: false,
    customerProgramRequired: false,
    minimumPurchaseQty: 1,
    validFrom: null,
    validTo: null,
    ...overrides,
  });
}

function sparPdfOffer(overrides = {}) {
  return sparOffer({
    title: 'Goesser Maerzen, Naturradler Zitrone oder Naturradler Zitrone alkoholfrei',
    sourceType: 'spar-official-pdf',
    rawFacts: { sourceKey: 'spar-official-flyer-pdf' },
    imageUrl: '',
    conditionsText: 'ab 6 Dosen',
    hasConditions: true,
    minimumPurchaseQty: 6,
    effectiveDiscountType: 'threshold',
    validFrom: '2026-05-21T12:00:00.000Z',
    validTo: '2026-06-02T12:00:00.000Z',
    ...overrides,
  });
}

test('normalizes umlauts and tokenizes search text for query matching', () => {
  assert.equal(normalizeSearchText('Käse & Öl'), 'kaese oel');
  assert.deepEqual(tokenizeSearchText('Red Bull 4-Pack'), ['red', 'bull', '4', 'pack']);
  assert.equal(normalizeSearchText('K\u00e4se & \u00d6l'), 'kaese oel');
  assert.equal(normalizeSearchText('\ufffdl'), 'oel');
  assert.equal(normalizeSearchText('\u00c3\u00b6l'), 'oel');
  assert.equal(normalizeSearchText('Haar\ufffdl'), 'haaroel');
  assert.equal(normalizeSearchText('Haar\u00c3\u00b6l'), 'haaroel');
});

test('parses ranking category names containing commas as a single category', () => {
  const knownCategories = buildKnownCategoryLabelMap();

  assert.deepEqual(
    parseRankingCategories('Fleisch, Wurst & Fisch', knownCategories),
    ['Fleisch, Wurst & Fisch']
  );
  assert.deepEqual(
    parseRankingCategories('Fleisch, Wurst & Fisch,Kaese', knownCategories),
    ['Fleisch, Wurst & Fisch', 'Kaese']
  );
});

test('parses repeated and JSON ranking categories without legacy comma damage', () => {
  const knownCategories = buildKnownCategoryLabelMap();

  assert.deepEqual(
    parseRankingCategories(['Fleisch, Wurst & Fisch', 'Kaese'], knownCategories),
    ['Fleisch, Wurst & Fisch', 'Kaese']
  );
  assert.deepEqual(
    parseRankingCategories('["Fleisch, Wurst & Fisch","Kaese"]', knownCategories),
    ['Fleisch, Wurst & Fisch', 'Kaese']
  );
});

test('parses ampersand category labels as one ranking category', () => {
  const knownCategories = buildKnownCategoryLabelMap();

  assert.deepEqual(
    parseRankingCategories('Kaffee & Tee', knownCategories),
    ['Kaffee & Tee']
  );
  assert.deepEqual(
    parseRankingCategories('["Kaffee & Tee"]', knownCategories),
    ['Kaffee & Tee']
  );
});

test('normalizes ranking retailer filters case-insensitively', () => {
  assert.deepEqual(normalizeRetailerList('PENNY'), ['penny']);
  assert.deepEqual(normalizeRetailerList('Penny,penny,BILLA PLUS'), ['penny', 'billa-plus']);
  assert.deepEqual(normalizeRetailerList(['PENNY', 'Billa-Plus']), ['penny', 'billa-plus']);
  assert.deepEqual(normalizeRetailerList('SPAR,EUROSPAR,INTERSPAR'), ['spar', 'eurospar', 'interspar']);
});

test('builds bounded ranking candidate limits for small result requests', () => {
  assert.equal(buildRankingCandidateLimit({ safeLimit: 1, hasQuery: false }), 20);
  assert.equal(buildRankingCandidateLimit({ safeLimit: 1, hasQuery: true }), 200);
  assert.equal(buildRankingCandidateLimit({ safeLimit: 60, hasQuery: true }), 200);
  assert.equal(buildRankingCandidateLimit({ safeLimit: 100, hasQuery: true }), 300);
});

test('pushes ranking query into Mongo searchTokens candidate filtering before JS scoring', () => {
  const match = buildRankingCandidateMatch({
    selectedRetailers: ['hofer'],
    selectedCategories: ['Kaffee & Tee'],
    unit: 'kg',
    onlyWithoutProgram: true,
    query: 'kaffee',
  });

  assert.equal(match.status, 'active');
  assert.equal(match.isActiveNow, true);
  assert.deepEqual(match.retailerKey, { $in: ['hofer'] });
  assert.deepEqual(match.categoryKey, { $in: ['kaffee-tee'] });
  assert.equal(match.comparableUnit, 'kg');
  assert.equal(match.customerProgramRequired, false);
  assert.ok(Array.isArray(match.$and));
  assert.equal(match.$and.length, 1);
  assert.ok(JSON.stringify(match.$and).includes('searchTokens'));
  assert.ok(JSON.stringify(match.$and).includes('kaffee'));
  assert.doesNotMatch(JSON.stringify(match), /titleNormalized|comparisonGroup|brand/);
  assert.deepEqual(buildRankingCandidateQueryMetadata({ query: 'kaffee' }), {
    queryTokens: ['cafe', 'caffe', 'kaffee'],
    candidateQueryMode: 'searchTokensOnly',
    usesSearchTokens: true,
    fallbackUsed: false,
    fallbackReason: '',
  });
});

test('ranking retailer filter keeps normal retailerKey query for non-SPAR retailers', () => {
  assert.deepEqual(buildRetailerScopeMatch(['hofer']), {
    retailerKey: { $in: ['hofer'] },
  });
});

test('ranking retailer filter finds legacy EUROSPAR and INTERSPAR offers by format metadata', () => {
  assert.deepEqual(buildRetailerScopeMatch(['eurospar']), {
    $or: [
      { retailerKey: 'eurospar' },
      { sourceRetailerFormat: 'eurospar' },
      { appliesToRetailerFormats: 'eurospar' },
      { 'rawFacts.sourceRetailerFormat': 'eurospar' },
      { 'rawFacts.appliesToRetailerFormats': 'eurospar' },
    ],
  });

  const match = buildRankingCandidateMatch({
    selectedRetailers: ['interspar'],
    query: 'kaffee',
  });

  assert.ok(Array.isArray(match.$and));
  assert.equal(match.$and.length, 2);
  assert.ok(JSON.stringify(match.$and[0]).includes('interspar'));
  assert.ok(JSON.stringify(match.$and[1]).includes('searchTokens'));
});

test('ranking retailer filter does not show legacy INTERSPAR-only offers for SPAR-only requests', () => {
  const match = buildRetailerScopeMatch(['spar']);
  const serialized = JSON.stringify(match);

  assert.ok(serialized.includes('"retailerKey":"spar"'));
  assert.ok(serialized.includes('"sourceRetailerFormat":"spar"'));
  assert.ok(serialized.includes('"appliesToRetailerFormats":"spar"'));
  assert.doesNotMatch(serialized, /eurospar|interspar/);
});

test('SPAR condition merge keeps Aktionsfinder winner data and imports PDF threshold conditions', () => {
  const aktionsfinder = sparOffer({
    id: 'aktionsfinder-goesser',
    title: 'Gösser Märzen SPAR 0.50 Liter 1 Dose',
    sourceType: 'aktionsfinder-json',
    rawFacts: { sourceKey: 'aktionsfinder-spar' },
    imageUrl: 'https://example.test/goesser.jpg',
  });
  const pdf = sparPdfOffer({
    id: 'pdf-goesser',
    conditionsText: 'ab 6 Dosen',
    minimumPurchaseQty: 6,
    isMultiBuy: false,
  });

  const [merged] = mergeSparConditionEvidenceIntoOffers([aktionsfinder, pdf]);

  assert.equal(merged.id, 'aktionsfinder-goesser');
  assert.equal(merged.sourceType, 'aktionsfinder-json');
  assert.equal(merged.imageUrl, 'https://example.test/goesser.jpg');
  assert.equal(merged.conditionsText, 'ab 6 Dosen');
  assert.equal(merged.hasConditions, true);
  assert.equal(merged.minimumPurchaseQty, 6);
  assert.equal(merged.validTo, '2026-06-02T12:00:00.000Z');
  assert.ok(merged.sourceTypes.includes('aktionsfinder-json'));
  assert.ok(merged.sourceTypes.includes('spar-official-pdf'));
});

test('SPAR condition merge preserves 12+12 gratis evidence when structured alternative wins', () => {
  const aktionsfinder = sparOffer({
    brand: 'Ottakringer',
    title: 'Ottakringer Helles SPAR 0.50 Liter 1 Dose',
    priceCurrent: { amount: 0.69, currency: 'EUR' },
    normalizedUnitPrice: { amount: 1.38, unit: 'l', comparable: true, confidence: 0.9 },
    imageUrl: 'https://example.test/ottakringer.jpg',
  });
  const pdf = sparPdfOffer({
    brand: 'Ottakringer',
    title: 'Ottakringer Helles oder Frucade Radler',
    priceCurrent: { amount: 0.69, currency: 'EUR' },
    normalizedUnitPrice: { amount: 1.38, unit: 'l', comparable: true, confidence: 0.82 },
    conditionsText: '12+12 gratis',
    minimumPurchaseQty: 24,
    isMultiBuy: true,
    effectiveDiscountType: 'multi-buy',
  });

  const [merged] = mergeSparConditionEvidenceIntoOffers([aktionsfinder, pdf]);

  assert.equal(merged.title, 'Ottakringer Helles SPAR 0.50 Liter 1 Dose');
  assert.equal(merged.imageUrl, 'https://example.test/ottakringer.jpg');
  assert.equal(merged.conditionsText, '12+12 gratis');
  assert.equal(merged.isMultiBuy, true);
  assert.equal(merged.minimumPurchaseQty, 24);
});

test('SPAR condition merge keeps fragment PDF titles out of visible title while importing safe evidence', () => {
  const aktionsfinder = sparOffer({
    brand: 'Felix',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Katzenfutter',
    categoryKey: 'katzenfutter',
    title: 'Felix Katzennahrung SPAR 12 x 85 Gramm',
    quantityText: '12 x 85 g',
    totalComparableAmount: 1.02,
    comparableUnit: 'kg',
    normalizedUnitPrice: { amount: 4.89, unit: 'kg', comparable: true, confidence: 0.9 },
    priceCurrent: { amount: 4.99, currency: 'EUR' },
    imageUrl: 'https://example.test/felix.jpg',
  });
  const pdf = sparPdfOffer({
    brand: 'Felix',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Katzenfutter',
    categoryKey: 'katzenfutter',
    title: 'Noch zusätzlich Felix Katzennahrung ab 2 Pkg. je',
    quantityText: '12 x 85 g',
    totalComparableAmount: 1.02,
    comparableUnit: 'kg',
    normalizedUnitPrice: { amount: 4.89, unit: 'kg', comparable: true, confidence: 0.82 },
    priceCurrent: { amount: 4.99, currency: 'EUR' },
    conditionsText: 'ab 2 Packungen',
    minimumPurchaseQty: 2,
  });

  const [merged] = mergeSparConditionEvidenceIntoOffers([aktionsfinder, pdf]);

  assert.equal(merged.title, 'Felix Katzennahrung SPAR 12 x 85 Gramm');
  assert.equal(merged.imageUrl, 'https://example.test/felix.jpg');
  assert.equal(merged.conditionsText, 'ab 2 Packungen');
  assert.equal(merged.minimumPurchaseQty, 2);
});

test('SPAR condition merge rejects uncertain products, different formats and conflicting price or quantity', () => {
  const pdf = sparPdfOffer({ brand: 'Goesser', conditionsText: 'ab 6 Dosen' });

  assert.equal(canMergeConditionEvidence(
    sparOffer({ brand: 'Puntigamer', title: 'Puntigamer Maerzen SPAR 0.50 Liter 1 Dose' }),
    pdf,
  ), false);
  assert.equal(canMergeConditionEvidence(
    sparOffer({ brand: 'Puntigamer', title: 'Puntigamer Maerzen SPAR 0.50 Liter 1 Dose' }),
    sparPdfOffer({ brand: '', title: 'Goesser Maerzen, Naturradler Zitrone oder Naturradler Zitrone alkoholfrei' }),
  ), false);
  assert.equal(canMergeConditionEvidence(
    sparOffer({ retailerKey: 'eurospar', retailerName: 'EUROSPAR' }),
    pdf,
  ), false);
  assert.equal(canMergeConditionEvidence(
    sparOffer({ priceCurrent: { amount: 1.49, currency: 'EUR' } }),
    pdf,
  ), false);
  assert.equal(canMergeConditionEvidence(
    sparOffer({ quantityText: '0.33 l / 1 dose', unitValue: 0.33, totalComparableAmount: 0.33 }),
    pdf,
  ), false);
});

test('SPAR condition merge deduplicates overlapping condition text', () => {
  const aktionsfinder = sparOffer({
    conditionsText: 'ab 6 Dosen',
    hasConditions: true,
    minimumPurchaseQty: 6,
  });
  const pdf = sparPdfOffer({
    conditionsText: 'ab 6 Dosen / ab 6 Dosen',
    minimumPurchaseQty: 6,
  });

  const [merged] = mergeSparConditionEvidenceIntoOffers([aktionsfinder, pdf]);

  assert.equal(merged.conditionsText, 'ab 6 Dosen');
  assert.equal(merged.minimumPurchaseQty, 6);
});

test('SPAR condition merge keeps dated condition sentences intact', () => {
  const aktionsfinder = sparOffer({
    brand: 'Goesser',
    title: 'Gösser Märzen SPAR 0.50 Liter 1 Dose',
  });
  const pdf = sparPdfOffer({
    brand: 'Goesser',
    conditionsText: 'ab 6 Dosen. Zusaetzlich -25% am Fr., 22.5. und Sa., 23.5.2026 laut Flugblatt',
  });

  const [merged] = mergeSparConditionEvidenceIntoOffers([aktionsfinder, pdf]);

  assert.equal(
    merged.conditionsText,
    'ab 6 Dosen. Zusaetzlich -25% am Fr., 22.5. und Sa., 23.5.2026 laut Flugblatt',
  );
});

test('query without useful tokens uses safe regex fallback metadata', () => {
  assert.deepEqual(buildRankingCandidateQueryMetadata({ query: '1 kg' }), {
    queryTokens: [],
    candidateQueryMode: 'fallbackRegex',
    usesSearchTokens: false,
    fallbackUsed: true,
    fallbackReason: 'no-query-tokens',
  });
});

test('beer query keeps beverage radler but rejects Radler shorts side hits', () => {
  const beer = offer({
    title: 'Goesser Maerzen Naturradler Zitrone 0,5 l',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    subcategoryKey: 'bier',
    searchText: 'goesser maerzen naturradler bier getraenke',
  });
  const shorts = offer({
    title: 'LILY & DAN Kleinkinder-Radler-Shorts HOFER 3 Stueck',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    subcategoryKey: 'bier',
    searchText: 'lily dan kleinkinder radler shorts bier',
  });

  assert.ok(scoreOfferAgainstQuery(beer, 'bier') > 0);
  assert.equal(scoreOfferAgainstQuery(shorts, 'bier'), 0);
});

test('beer query rejects hair care weizen false positives even when category is misclassified', () => {
  const beer = offer({
    title: 'Hadmar Bio Bier 6x0,5l',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    subcategoryKey: 'bier',
    searchText: 'hadmar bio bier getraenke',
  });
  const balsam = offer({
    title: 'Glem Vital Balsam Weizen',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    subcategoryKey: 'bier',
    searchText: 'glem vital balsam weizen bier',
  });
  const shampoo = offer({
    title: 'Glem Vital Pflege Shampoo Weizen & Colorin',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    subcategoryKey: 'bier',
    searchText: 'glem vital pflege shampoo weizen colorin bier',
  });

  assert.deepEqual(applyQueryMatch([balsam, beer, shampoo], 'bier').map((item) => item.title), [
    'Hadmar Bio Bier 6x0,5l',
  ]);
});

test('umlaut oil query stays tokenized and does not fall back to broad regex search', () => {
  const oilQueryTokens = ['oel', ...FOOD_OIL_PRODUCT_TOKENS].sort();

  assert.deepEqual(buildRankingCandidateQueryMetadata({ query: '\u00f6l' }), {
    queryTokens: oilQueryTokens,
    candidateQueryMode: 'searchTokensOnly',
    usesSearchTokens: true,
    fallbackUsed: false,
    fallbackReason: '',
  });
  assert.deepEqual(buildRankingCandidateQueryMetadata({ query: 'ol' }), {
    queryTokens: oilQueryTokens,
    candidateQueryMode: 'searchTokensOnly',
    usesSearchTokens: true,
    fallbackUsed: false,
    fallbackReason: '',
  });
  assert.deepEqual(buildRankingCandidateQueryMetadata({ query: '\ufffdl' }), {
    queryTokens: oilQueryTokens,
    candidateQueryMode: 'searchTokensOnly',
    usesSearchTokens: true,
    fallbackUsed: false,
    fallbackReason: '',
  });
  assert.deepEqual(buildRankingCandidateQueryMetadata({ query: '\u00c3\u00b6l' }), {
    queryTokens: oilQueryTokens,
    candidateQueryMode: 'searchTokensOnly',
    usesSearchTokens: true,
    fallbackUsed: false,
    fallbackReason: '',
  });
});

test('generic oil candidate search recalls explicit food oil tokens without side-hit expansion', () => {
  const match = buildRankingCandidateMatch({ query: '\u00f6l' });
  const serialized = JSON.stringify(match);

  assert.match(serialized, /searchTokens/);
  assert.match(serialized, /rapsoel/);
  assert.match(serialized, /olivenoel/);
  assert.match(serialized, /sonnenblumenoel/);
  assert.doesNotMatch(serialized, /haaroel|duftoel|motoroel|pflegeoel/);
});

test('generic oil query recalls Bellasan rapeseed oil without broad substring fallback', () => {
  const offerDocument = offer({
    title: 'BELLASAN Raps\u00f6l*, 1 l',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Saucen, Oele & Gewuerze',
    comparisonGroup: 'bellasan-rapsoel::1-l',
    searchText: 'bellasan rapsoel saucen oele gewuerze hofer',
    searchTokens: ['bellasan', 'gewuerze', 'hofer', 'lebensmittel', 'oel', 'rapsoel', 'saucen'],
    searchTokenVersion: 2,
  });
  const sideHit = offer({
    title: 'Naehr-Shampoo EI-Oel 200 ml',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Haarpflege',
    comparisonGroup: 'naehr-shampoo-ei-oel::0.2-l',
    searchText: 'naehr shampoo ei oel haarpflege',
    searchTokens: ['ei', 'haarpflege', 'naehr', 'oel', 'shampoo'],
    searchTokenVersion: 2,
  });
  const match = buildRankingCandidateMatch({ query: 'oel' });

  assert.equal(match.$and[0].searchTokens.$in.includes('rapsoel'), true);
  assert.equal(buildRankingCandidateQueryMetadata({ query: 'oel' }).candidateQueryMode, 'searchTokensOnly');
  assert.deepEqual(applyQueryMatch([sideHit, offerDocument], '\u00f6l').map((item) => item.title), [
    'BELLASAN Raps\u00f6l*, 1 l',
  ]);
  assert.deepEqual(applyQueryMatch([sideHit, offerDocument], 'oel').map((item) => item.title), [
    'BELLASAN Raps\u00f6l*, 1 l',
  ]);
  assert.equal(scoreOfferAgainstQuery(offerDocument, 'rapsoel') > 0, true);
  assert.equal(scoreOfferAgainstQuery(offerDocument, 'Rapsoel') > 0, true);
});

test('unicode hair oil query stays tokenized like ascii variants', () => {
  for (const query of ['haar\u00f6l', 'haaroel', 'haarol', 'haar\ufffdl', 'haar\u00c3\u00b6l']) {
    assert.deepEqual(buildRankingCandidateQueryMetadata({ query }), {
      queryTokens: ['haaroel', 'haarol'],
      candidateQueryMode: 'searchTokensOnly',
      usesSearchTokens: true,
      fallbackUsed: false,
      fallbackReason: '',
    });
  }
});

test('separate regex fallback is not mixed into the searchTokens primary match', () => {
  const primary = buildRankingCandidateMatch({ query: 'kaffee' });
  const fallback = buildRankingCandidateFallbackMatch({ query: 'kaffee' });

  assert.match(JSON.stringify(primary), /searchTokens/);
  assert.doesNotMatch(JSON.stringify(primary), /titleNormalized|comparisonGroup|brand/);
  assert.doesNotMatch(JSON.stringify(primary), /\$or/);
  assert.doesNotMatch(JSON.stringify(fallback), /searchTokens/);
  assert.match(JSON.stringify(fallback), /titleNormalized/);
});

test('ranked offer response contains structured reference price and approximate savings fields', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'coffee-percent-derived',
    title: 'Dallmayr Prodomo 500 g',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    priceCurrent: { amount: 11.99, currency: 'EUR' },
    priceReference: { amount: 15.99, currency: 'EUR' },
    priceReferenceSource: 'discount-percent-derived',
    priceReferenceConfidence: 0.72,
    savingsDisplayType: 'estimated-reference-price',
    hasReferencePrice: true,
    hasEstimatedReferencePrice: true,
    rawFacts: {
      discountPercentage: 25,
      referencePriceType: 'source_percent_derived',
      referencePriceDerived: true,
    },
    quantityText: '500 g',
    totalComparableAmount: 0.5,
    comparableUnit: 'kg',
    normalizedUnitPrice: { amount: 23.98, unit: 'kg', comparable: true, confidence: 0.9 },
    quality: { comparisonSafe: true },
  }), 23.98, 23.98);

  assert.equal(ranked.referencePrice.amount, 15.99);
  assert.equal(ranked.referencePrice.type, 'source_percent_derived');
  assert.equal(ranked.referencePrice.discountPercent, 25);
  assert.equal(ranked.savings.amount, 4);
  assert.equal(ranked.savings.percent, 25);
  assert.equal(ranked.savings.isApproximate, true);
  assert.equal(ranked.savings.basis, 'source_discount_percent');
  assert.equal(ranked.savingsAmount, 4);
  assert.equal(ranked.savingsPercent, 25);
});

test('ranked offer keeps direct source savings even when cross-offer comparability is unsafe', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'direct-reference-unsafe-unit',
    title: 'Kaffee Packung',
    retailerKey: 'billa',
    retailerName: 'Billa',
    priceCurrent: { amount: 15.99, currency: 'EUR' },
    priceReference: { amount: 21.99, currency: 'EUR' },
    priceReferenceSource: 'prospect',
    priceReferenceConfidence: 0.95,
    savingsDisplayType: 'prospect-saving',
    quantityText: '1 Packung',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false },
    quality: { comparisonSafe: false },
  }), null, null);

  assert.equal(ranked.referencePrice.type, 'direct_source_reference_price');
  assert.equal(ranked.savings.amount, 6);
  assert.equal(ranked.savings.basis, 'direct_source_reference_price');
  assert.equal(ranked.savingsAmount, 6);
});

test('ranked offer response carries category promotion fields without invented price savings', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'spar-beer-category-promo',
    title: '-25% auf alle Biere',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    offerType: 'category-promotion',
    sourceRetailerFormat: 'spar',
    appliesToRetailerFormats: ['spar'],
    discountPercent: 25,
    promotionScope: 'bier',
    appliesToCategory: 'bier',
    regionScope: 'Steiermark',
    priceCurrent: { amount: null, currency: 'EUR' },
    sourceType: 'official-action',
    sourceUrl: 'https://www.spar.at/aktionen/steiermark',
    rawFacts: { sourceKey: 'spar-official-actions-steiermark' },
    normalizedUnitPrice: { amount: null, unit: '', comparable: false },
    quality: { comparisonSafe: false },
  }), null, null);

  assert.equal(ranked.offerType, 'category-promotion');
  assert.equal(ranked.priceCurrent.amount, null);
  assert.equal(ranked.discountPercent, 25);
  assert.equal(ranked.discountUpToPercent, null);
  assert.equal(ranked.promotionScope, 'bier');
  assert.equal(ranked.regionScope, 'Steiermark');
  assert.equal(ranked.sourceKey, 'spar-official-actions-steiermark');
  assert.equal(ranked.savingsAmount, null);
  assert.equal(ranked.savingsPercent, null);
});

test('generic rice Mongo prefilter avoids broad pasta category flooding', () => {
  const match = buildRankingCandidateMatch({
    query: 'reis',
    useSearchTokens: false,
  });

  const searchedFields = match.$and[0].$or.flatMap((item) => Object.keys(item));

  assert.deepEqual(searchedFields.sort(), ['brand', 'comparisonGroup', 'title', 'titleNormalized'].sort());
});

test('scores real butter offers ahead of cosmetic side meanings', () => {
  const dairyButter = offer({
    title: 'Milsani Irische Butter 250 g',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    comparisonGroup: 'milsani-irische-butter::0.25-kg',
  });
  const lipBalm = offer({
    title: 'MANHATTAN Butter Me Up Lippenbalsam',
    brand: 'MANHATTAN',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Kosmetik & Make-up',
    comparisonGroup: 'manhattan-butter-lippenbalsam::1-Stk',
  });

  assert.ok(scoreOfferAgainstQuery(dairyButter, 'butter') > scoreOfferAgainstQuery(lipBalm, 'butter'));
});

test('ranks dairy butter intent ahead of butter side meanings', () => {
  const offers = [
    offer({
      title: 'Butter Topfengolatsche Lidl 1 Stueck',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Brot & Gebaeck',
      comparisonGroup: 'butter-topfengolatsche::1-Stk',
    }),
    offer({
      title: 'Schinken-Kaese-Buttercroissant BILLA 1 Stueck',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Brot & Gebaeck',
      comparisonGroup: 'schinken-kaese-buttercroissant::1-Stk',
    }),
    offer({
      title: 'MANHATTAN Butter Me Up Lippenbalsam dm',
      brand: 'MANHATTAN',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Kosmetik & Make-up',
      comparisonGroup: 'manhattan-butter-lippenbalsam::1-Stk',
    }),
    offer({
      title: 'Milbona Butterkaese oder Gouda',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaese',
      comparisonGroup: 'milbona-butterkaese-gouda::0.25-kg',
    }),
    offer({
      title: 'Schaerdinger Oesterreichische Teebutter',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'schaerdinger-oesterreichische-teebutter::0.25-kg',
    }),
    offer({
      title: 'Milsani Irische Butter',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'milsani-irische-butter::0.25-kg',
    }),
  ];

  const sortedTitles = applyQueryMatch(offers, 'butter').map((item) => item.title);

  assert.deepEqual(new Set(sortedTitles.slice(0, 2)), new Set([
    'Milsani Irische Butter',
    'Schaerdinger Oesterreichische Teebutter',
  ]));
  for (const sideMeaning of [
    'Butter Topfengolatsche Lidl 1 Stueck',
    'Schinken-Kaese-Buttercroissant BILLA 1 Stueck',
    'MANHATTAN Butter Me Up Lippenbalsam dm',
    'Milbona Butterkaese oder Gouda',
  ]) {
    const sideIndex = sortedTitles.indexOf(sideMeaning);
    assert.ok(sideIndex === -1 || sideIndex > 1, sideMeaning);
  }
});

test('keeps grouped butter response query-sorted for live response order', () => {
  const offers = [
    offer({
      title: 'Butter Topfengolatsche Lidl 1 Stueck',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Brot & Gebaeck',
      comparisonGroup: 'butter-topfengolatsche::1-Stk',
      normalizedUnitPrice: { amount: 0.89, unit: 'Stk' },
      sortScoreDefault: 9999,
    }),
    offer({
      title: 'Schinken-Kaese-Buttercroissant BILLA 1 Stueck',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Brot & Gebaeck',
      comparisonGroup: 'schinken-kaese-buttercroissant::1-Stk',
      normalizedUnitPrice: { amount: 0.99, unit: 'Stk' },
      sortScoreDefault: 9999,
    }),
    offer({
      title: 'MANHATTAN High Shine Butter Me Up Lippenbalsam dm',
      brand: 'MANHATTAN',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Kosmetik & Make-up',
      comparisonGroup: 'manhattan-butter-lippenbalsam::1-Stk',
      normalizedUnitPrice: { amount: 1.95, unit: 'Stk' },
      sortScoreDefault: 9999,
    }),
    offer({
      title: 'Nyx Buttermelt Highlighter dm',
      brand: 'Nyx',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Kosmetik & Make-up',
      comparisonGroup: 'nyx-buttermelt-highlighter::1-Stk',
      normalizedUnitPrice: { amount: 6.95, unit: 'Stk' },
      sortScoreDefault: 9999,
    }),
    offer({
      title: 'Kotanyi Kraeuterbutter Gewuerzzubereitung',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Gewuerze & Saucen',
      comparisonGroup: 'kotanyi-kraeuterbutter-gewuerzzubereitung::1-Stk',
      normalizedUnitPrice: { amount: 1.49, unit: 'Stk' },
      sortScoreDefault: 9999,
    }),
    offer({
      title: 'Gourmet Finest Cuisine Butterbriochestriezel',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Brot & Gebaeck',
      comparisonGroup: 'gourmet-finest-cuisine-butterbriochestriezel::0.63-kg',
      normalizedUnitPrice: { amount: 4.29, unit: 'Stk' },
      sortScoreDefault: 9999,
    }),
    offer({
      title: 'Schaerdinger Oesterreichische Teebutter Penny 250 Gramm',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaese',
      comparisonGroup: 'schaerdinger-oesterreichische-teebutter::0.25-kg',
      normalizedUnitPrice: { amount: 2.49, unit: 'Stk' },
      sortScoreDefault: 1,
    }),
    offer({
      title: 'Milsani Irische Butter HOFER 250 Gramm',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'milsani-irische-butter::0.25-kg',
      normalizedUnitPrice: { amount: 2.19, unit: 'Stk' },
      sortScoreDefault: 1,
    }),
  ];

  const firstGroupTitles = buildGroupedRankings(
    prepareQueryOffersForResponse(applyQueryMatch(offers, 'butter'), 'butter'),
    { query: 'butter' }
  ).flatMap((group) => group.offers).map((item) => item.title);

  assert.deepEqual(new Set(firstGroupTitles.slice(0, 2)), new Set([
    'Milsani Irische Butter HOFER 250 Gramm',
    'Schaerdinger Oesterreichische Teebutter Penny 250 Gramm',
  ]));
});

test('ranks real butter ahead of peanut butter cups and cosmetic butter hits', () => {
  const offers = [
    offer({
      title: 'Protein Peanut Butter Cups',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'protein-peanut-butter-cups::0.04-kg',
    }),
    offer({
      title: 'MANHATTAN Body Butter Lippenbalsam',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Kosmetik & Make-up',
      comparisonGroup: 'manhattan-body-butter-lippenbalsam::1-Stk',
    }),
    offer({
      title: 'NYX Buttermelt Highlighter',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Kosmetik & Make-up',
      comparisonGroup: 'nyx-buttermelt-highlighter::1-Stk',
    }),
    offer({
      title: 'Schaerdinger Teebutter 250 g',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'schaerdinger-teebutter::0.25-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'butter').map((item) => item.title);

  assert.equal(sortedTitles[0], 'Schaerdinger Teebutter 250 g');
  assert.equal(sortedTitles.includes('Protein Peanut Butter Cups'), false);
  assert.equal(sortedTitles.includes('MANHATTAN Body Butter Lippenbalsam'), false);
  assert.equal(sortedTitles.includes('NYX Buttermelt Highlighter'), false);
});

test('generic butter excludes facial and body butter while explicit cosmetic butter queries still work', () => {
  const offers = [
    offer({
      title: 'Q10 Anti Falten Kollagen Experte Facial Butter Tag und Nacht',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Kosmetik & Make-up',
      comparisonGroup: 'q10-facial-butter::1-Stk',
    }),
    offer({
      title: 'Body Butter Shea',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Koerperpflege',
      comparisonGroup: 'body-butter-shea::1-Stk',
    }),
    offer({
      title: 'Ja Natuerlich Bio Butter 250 g',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'ja-natuerlich-bio-butter::0.25-kg',
    }),
  ];

  const genericTitles = applyQueryMatch(offers, 'butter').map((item) => item.title);
  const bodyButterTitles = applyQueryMatch(offers, 'body butter').map((item) => item.title);
  const facialButterTitles = applyQueryMatch(offers, 'facial butter').map((item) => item.title);

  assert.deepEqual(genericTitles, ['Ja Natuerlich Bio Butter 250 g']);
  assert.equal(bodyButterTitles.includes('Body Butter Shea'), true);
  assert.equal(facialButterTitles.includes('Q10 Anti Falten Kollagen Experte Facial Butter Tag und Nacht'), true);
});

test('generic butter excludes lip butter even when category is misclassified as dairy', () => {
  const lipButter = offer({
    title: 'pure Softening Lip Butter',
    brand: 'LOOK BY BIPA',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    categoryKey: 'milchprodukte',
    subcategoryKey: 'milchprodukte',
    comparisonGroup: '',
    searchText: '',
  });

  assert.deepEqual(applyQueryMatch([lipButter], 'butter'), []);
  assert.equal(scoreOfferAgainstQuery(lipButter, 'butter'), 0);
});

test('generic butter still finds real dairy butter when lip butter side hit is present', () => {
  const offers = [
    offer({
      title: 'pure Softening Lip Butter',
      brand: 'LOOK BY BIPA',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      categoryKey: 'milchprodukte',
      subcategoryKey: 'milchprodukte',
      comparisonGroup: '',
      searchText: '',
    }),
    offer({
      title: 'Schaerdinger Oesterreichische Teebutter 250 g',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      categoryKey: 'milchprodukte',
      subcategoryKey: 'butter',
      comparisonGroup: 'schaerdinger-oesterreichische-teebutter::0.25-kg',
    }),
  ];

  assert.deepEqual(applyQueryMatch(offers, 'butter').map((item) => item.title), [
    'Schaerdinger Oesterreichische Teebutter 250 g',
  ]);
});

test('explicit lip butter query keeps lip butter searchable', () => {
  const lipButter = offer({
    title: 'pure Softening Lip Butter',
    brand: 'LOOK BY BIPA',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    categoryKey: 'milchprodukte',
    subcategoryKey: 'milchprodukte',
    comparisonGroup: '',
    searchText: '',
  });

  assert.deepEqual(applyQueryMatch([lipButter], 'lip butter').map((item) => item.title), [
    'pure Softening Lip Butter',
  ]);
});

test('explicit lip butter query ranks lip care before food butter and generic butter excludes lip butter', () => {
  const lipButter = offer({
    title: 'pure Softening Lip Butter',
    brand: 'LOOK BY BIPA',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Kosmetik & Make-up',
    comparisonGroup: 'pure-softening-lip-butter::1-Stk',
  });
  const foodButter = offer({
    title: 'Schaerdinger Oesterreichische Teebutter 250 g',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    comparisonGroup: 'schaerdinger-oesterreichische-teebutter::0.25-kg',
  });
  const misclassifiedPeanutButter = offer({
    title: 'Bonne Maman Erdnuss Butter Creme Crunchy',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Koerperpflege',
    comparisonGroup: 'bonne-maman-erdnuss-butter-creme-crunchy::0.35-kg',
  });

  assert.deepEqual(applyQueryMatch([foodButter, lipButter, misclassifiedPeanutButter], 'lip butter').map((item) => item.title), [
    'pure Softening Lip Butter',
  ]);
  assert.deepEqual(applyQueryMatch([foodButter, lipButter], 'butter').map((item) => item.title), [
    'Schaerdinger Oesterreichische Teebutter 250 g',
  ]);
});

test('pet food intent finds dog food products and excludes Fruchtbar baby food false positives', () => {
  const babyFood = offer({
    title: 'Fruchtbar Bio Herznudeln',
    brand: 'Fruchtbar',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Tiernahrung',
    searchText: 'fruchtbar bio herznudeln baby nudeln lebensmittel tiernahrung',
  });
  const pedigree = offer({
    title: 'Pedigree Schmackos Hunde Snack',
    brand: 'Pedigree',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Hundefutter',
    searchText: 'pedigree schmackos hundesnack tierbedarf',
  });

  assert.deepEqual(applyQueryMatch([babyFood, pedigree], 'tiernahrung').map((item) => item.title), [
    'Pedigree Schmackos Hunde Snack',
  ]);
  assert.deepEqual(applyQueryMatch([babyFood, pedigree], 'hundefutter').map((item) => item.title), [
    'Pedigree Schmackos Hunde Snack',
  ]);
});

test('cat litter intent finds litter and excludes cat food', () => {
  const litter = offer({
    title: 'ZooRoyal Ultra Klumpstreu Pinienduft 5 Liter',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Katzenstreu & Pflege',
    comparisonGroup: 'zooroyal-ultra-klumpstreu::5-l',
  });
  const catFood = offer({
    title: 'Felix Katzenfutter Beutel',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Katzenfutter',
    comparisonGroup: 'felix-katzenfutter::0.085-kg',
  });

  assert.deepEqual(applyQueryMatch([catFood, litter], 'katzenstreu').map((item) => item.title), [
    'ZooRoyal Ultra Klumpstreu Pinienduft 5 Liter',
  ]);
});

test('cat food query accepts category-labeled cat food without literal food token in title', () => {
  const catFood = offer({
    title: 'ZooRoyal Moon Ranger Ente',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Katzenfutter',
    comparisonGroup: 'zooroyal-moon-ranger-ente::0.085-kg',
  });
  const litter = offer({
    title: 'ZooRoyal Ultra Klumpstreu Pinienduft 5 Liter',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Katzenstreu & Pflege',
    comparisonGroup: 'zooroyal-ultra-klumpstreu::5-l',
  });

  assert.deepEqual(applyQueryMatch([catFood, litter], 'katzenfutter').map((item) => item.title), [
    'ZooRoyal Moon Ranger Ente',
  ]);
});

test('S-Budget aliases score current offer tokens consistently', () => {
  const semmel = offer({
    title: 'S-Budget Semmel',
    brand: 'S-Budget',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    searchText: 's budget semmel spar',
  });

  for (const query of ['s-budget', 's budget', 'sbudget']) {
    assert.deepEqual(applyQueryMatch([semmel], query).map((item) => item.title), ['S-Budget Semmel'], query);
  }
});

test('multi-term search prioritizes offers covering all query tokens before partial matches', () => {
  const sixPackBeer = offer({
    title: 'Goesser Bier 6 Dosen',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    searchText: 'goesser bier 6 dosen 6er pack',
  });
  const beer = offer({
    title: 'Wieselburger Bier 0,5 l',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    searchText: 'wieselburger bier',
  });
  const sixPackWater = offer({
    title: 'Mineralwasser 6er Traeger',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wasser',
    searchText: 'mineralwasser 6er traeger',
  });

  assert.deepEqual(applyQueryMatch([beer, sixPackWater, sixPackBeer], '6er bier').map((item) => item.title), [
    'Goesser Bier 6 Dosen',
    'Wieselburger Bier 0,5 l',
    'Mineralwasser 6er Traeger',
  ]);
});

test('default browsing ranking gives official evidence a visible tie-break over aggregator JSON', () => {
  const aggregator = offer({
    title: 'Aggregator Kaffee',
    sourceType: 'aktionsfinder-json',
    normalizedUnitPrice: { amount: 4, unit: 'kg', comparable: true },
    comparableUnit: 'kg',
    quality: { comparisonSafe: true },
    comparisonGroup: 'kaffee::1-kg',
  });
  const official = offer({
    title: 'Official Kaffee',
    sourceType: 'spar-official-html',
    normalizedUnitPrice: { amount: 4, unit: 'kg', comparable: true },
    comparableUnit: 'kg',
    quality: { comparisonSafe: true },
    comparisonGroup: 'kaffee-official::1-kg',
  });

  const titles = buildGroupedRankings([aggregator, official]).flatMap((group) => group.offers).map((item) => item.title);

  assert.deepEqual(titles, ['Official Kaffee', 'Aggregator Kaffee']);
});

test('explicit body butter prefers body care and excludes food butter side hits', () => {
  const offers = [
    offer({
      title: 'Erdnuss Butter Crunchy',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fruehstueck & Aufstriche',
      comparisonGroup: 'erdnuss-butter-crunchy::0.35-kg',
    }),
    offer({
      title: 'Protein Peanut Butter Cups',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'protein-peanut-butter-cups::0.04-kg',
    }),
    offer({
      title: 'Butter Me Up Lippenbalsam',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Kosmetik & Make-up',
      comparisonGroup: 'butter-me-up-lippenbalsam::1-Stk',
    }),
    offer({
      title: 'Body Spray Coconut',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Koerperpflege',
      comparisonGroup: 'body-spray-coconut::0.15-l',
    }),
    offer({
      title: 'Body Butter Shea',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Koerperpflege',
      comparisonGroup: 'body-butter-shea::1-Stk',
    }),
  ];

  assert.deepEqual(applyQueryMatch(offers, 'body butter').map((item) => item.title), ['Body Butter Shea']);
});

test('explicit body butter returns no food replacement when no real body butter exists', () => {
  const offers = [
    offer({
      title: 'Erdnuss Butter Crunchy',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fruehstueck & Aufstriche',
      comparisonGroup: 'erdnuss-butter-crunchy::0.35-kg',
    }),
    offer({
      title: 'Protein Peanut Butter Cups',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'protein-peanut-butter-cups::0.04-kg',
    }),
  ];

  assert.deepEqual(applyQueryMatch(offers, 'body butter'), []);
});

test('does not keep buttergemuese or butter sweets as top butter results', () => {
  const offers = [
    offer({
      title: 'Iglo Buttergemuese',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Tiefkuehl',
      comparisonGroup: 'iglo-buttergemuese::0.4-kg',
    }),
    offer({
      title: 'Butterkeks Schokolade',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'butterkeks-schokolade::0.2-kg',
    }),
    offer({
      title: 'Ja Natuerlich Bio Butter',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'ja-natuerlich-bio-butter::0.25-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'butter').map((item) => item.title);

  assert.equal(sortedTitles[0], 'Ja Natuerlich Bio Butter');
  assert.equal(sortedTitles.includes('Iglo Buttergemuese'), false);
  assert.equal(sortedTitles.includes('Butterkeks Schokolade'), false);
});

test('excludes bakery dairy and seasoning side hits when no real butter exists', () => {
  const offers = [
    offer({
      title: 'Oelz Butterpinze 400 g',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Brot & Gebaeck',
      comparisonGroup: 'oelz-butterpinze::0.4-kg',
    }),
    offer({
      title: 'Buttermilch Kuchen',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Brot & Gebaeck',
      comparisonGroup: 'buttermilch-kuchen::0.25-kg',
    }),
    offer({
      title: 'Kotanyi Kraeuterbutter Gewuerzzubereitung',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Saucen, Oele & Gewuerze',
      comparisonGroup: 'kotanyi-kraeuterbutter-gewuerzzubereitung::1-Stk',
    }),
    offer({
      title: 'Fa Cream & Oil Kakaobutter Duschgel',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Koerperpflege',
      comparisonGroup: 'fa-kakaobutter-duschgel::0.25-l',
    }),
    offer({
      title: 'Butter Laugencroissant',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Brot & Gebaeck',
      comparisonGroup: 'butter-laugencroissant::0.07-kg',
    }),
  ];

  assert.deepEqual(applyQueryMatch(offers, 'butter'), []);
});

test('generic oil ranks food oil and excludes hair essential and cosmetic oils', () => {
  const offers = [
    offer({
      title: "L'Or Kapseln Espresso",
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaffee & Tee',
      comparisonGroup: 'lor-kapseln-espresso::10-Stk',
    }),
    offer({
      title: 'Egger Dose Bier',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Bier',
      comparisonGroup: 'egger-dose-bier::0.5-l',
    }),
    offer({
      title: 'Roemerquelle Mineralwasser',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Wasser',
      comparisonGroup: 'roemerquelle-mineralwasser::1.5-l',
    }),
    offer({
      title: 'Almdudler Limonade',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Limonaden',
      comparisonGroup: 'almdudler-limonade::1-l',
    }),
    offer({
      title: 'ZooRoyal Ultra Klumpstreu Pinienduft',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenstreu & Pflege',
      comparisonGroup: 'zooroyal-klumpstreu::5-l',
    }),
    offer({
      title: 'Haarspray Extra Stark',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Haarpflege',
      comparisonGroup: 'haarspray-extra-stark::0.25-l',
    }),
    offer({
      title: 'Naehr-Shampoo EI-Oel 200 ml',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Haarpflege',
      comparisonGroup: 'naehr-shampoo-ei-oel::0.2-l',
    }),
    offer({
      title: 'Aetherisches Oel Lavendel 10 ml',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Koerperpflege',
      comparisonGroup: 'aetherisches-oel-lavendel::0.01-l',
    }),
    offer({
      title: 'Bona Bona Oel',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Saucen, Oele & Gewuerze',
      comparisonGroup: 'bona-bona-oel::1-l',
    }),
    offer({
      title: 'Olivenoel Extra Vergine',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Saucen, Oele & Gewuerze',
      comparisonGroup: 'olivenoel-extra-vergine::0.75-l',
    }),
  ];

  const genericTitles = applyQueryMatch(offers, 'oel').map((item) => item.title);
  const umlautTitles = applyQueryMatch(offers, '\u00f6l').map((item) => item.title);
  const shortVariantTitles = applyQueryMatch(offers, 'ol').map((item) => item.title);
  const replacementVariantTitles = applyQueryMatch(offers, '\ufffdl').map((item) => item.title);
  const mojibakeVariantTitles = applyQueryMatch(offers, '\u00c3\u00b6l').map((item) => item.title);

  assert.deepEqual(genericTitles, ['Olivenoel Extra Vergine', 'Bona Bona Oel']);
  assert.deepEqual(umlautTitles, ['Olivenoel Extra Vergine', 'Bona Bona Oel']);
  assert.deepEqual(shortVariantTitles, ['Olivenoel Extra Vergine', 'Bona Bona Oel']);
  assert.deepEqual(replacementVariantTitles, ['Olivenoel Extra Vergine', 'Bona Bona Oel']);
  assert.deepEqual(mojibakeVariantTitles, ['Olivenoel Extra Vergine', 'Bona Bona Oel']);
});

test('generic oil returns no broad side-hit replacements when no food oil exists', () => {
  const offers = [
    offer({
      title: "L'Or Kapseln Espresso",
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaffee & Tee',
      comparisonGroup: 'lor-kapseln-espresso::10-Stk',
    }),
    offer({
      title: 'Roemerquelle Mineralwasser',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Wasser',
      comparisonGroup: 'roemerquelle-mineralwasser::1.5-l',
    }),
    offer({
      title: 'ZooRoyal Ultra Klumpstreu Pinienduft',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenstreu & Pflege',
      comparisonGroup: 'zooroyal-klumpstreu::5-l',
    }),
    offer({
      title: 'Haarspray Extra Stark',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Haarpflege',
      comparisonGroup: 'haarspray-extra-stark::0.25-l',
    }),
  ];

  assert.deepEqual(applyQueryMatch(offers, '\u00f6l'), []);
  assert.deepEqual(applyQueryMatch(offers, 'ol'), []);
  assert.deepEqual(applyQueryMatch(offers, '\ufffdl'), []);
  assert.deepEqual(applyQueryMatch(offers, '\u00c3\u00b6l'), []);
});

test('explicit oil side-intent queries still find matching drogerie oils', () => {
  const offers = [
    offer({
      title: 'Haaroel Argan 100 ml',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Haarpflege',
      comparisonGroup: 'haaroel-argan::0.1-l',
    }),
    offer({
      title: 'Aetherisches Oel Lavendel 10 ml',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Koerperpflege',
      comparisonGroup: 'aetherisches-oel-lavendel::0.01-l',
    }),
    offer({
      title: 'Olivenoel Extra Vergine',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Saucen, Oele & Gewuerze',
      comparisonGroup: 'olivenoel-extra-vergine::0.75-l',
    }),
  ];

  assert.equal(applyQueryMatch(offers, 'haar\u00f6l')[0].title, 'Haaroel Argan 100 ml');
  assert.equal(
    applyQueryMatch(offers, '\u00e4therisches \u00f6l').some((item) => item.title === 'Aetherisches Oel Lavendel 10 ml'),
    true
  );
});

test('explicit essential oil ranks aroma oils ahead of food and shampoo oil hits', () => {
  const offers = [
    offer({
      title: 'Bona Bona Oel',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Saucen, Oele & Gewuerze',
      comparisonGroup: 'bona-bona-oel::1-l',
    }),
    offer({
      title: 'Thunfisch in Oel',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'thunfisch-in-oel::0.16-kg',
    }),
    offer({
      title: 'Frischkaese mit Oel',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaese',
      comparisonGroup: 'frischkaese-mit-oel::0.15-kg',
    }),
    offer({
      title: 'Naehr-Shampoo EI-Oel',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Haarpflege',
      comparisonGroup: 'naehr-shampoo-ei-oel::0.2-l',
    }),
    offer({
      title: 'Aetherisches Oel Lavendel 10 ml',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Koerperpflege',
      comparisonGroup: 'aetherisches-oel-lavendel::0.01-l',
    }),
  ];

  assert.deepEqual(
    applyQueryMatch(offers, '\u00e4therisches \u00f6l').map((item) => item.title),
    ['Aetherisches Oel Lavendel 10 ml']
  );
});

test('explicit hair oil remains findable without broadening generic oil', () => {
  const offers = [
    offer({
      title: 'Haaroel Argan 100 ml',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Haarpflege',
      comparisonGroup: 'haaroel-argan::0.1-l',
    }),
    offer({
      title: 'Haarspray Extra Stark',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Haarpflege',
      comparisonGroup: 'haarspray-extra-stark::0.25-l',
    }),
    offer({
      title: 'Haar- und Koerperspray Kokos',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Koerperpflege',
      comparisonGroup: 'haar-und-koerperspray-kokos::0.15-l',
    }),
    offer({
      title: 'Olivenoel Extra Vergine',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Saucen, Oele & Gewuerze',
      comparisonGroup: 'olivenoel-extra-vergine::0.75-l',
    }),
  ];

  assert.equal(applyQueryMatch(offers, 'haar\u00f6l')[0].title, 'Haaroel Argan 100 ml');
  assert.equal(applyQueryMatch(offers, 'haaroel')[0].title, 'Haaroel Argan 100 ml');
  assert.equal(applyQueryMatch(offers, 'haarol')[0].title, 'Haaroel Argan 100 ml');
  assert.equal(applyQueryMatch(offers, 'haar\ufffdl')[0].title, 'Haaroel Argan 100 ml');
  assert.equal(applyQueryMatch(offers, 'haar\u00c3\u00b6l')[0].title, 'Haaroel Argan 100 ml');
  assert.deepEqual(applyQueryMatch(offers, '\u00f6l').map((item) => item.title), ['Olivenoel Extra Vergine']);
});

test('explicit hair oil returns no spray replacement when no hair oil exists', () => {
  const offers = [
    offer({
      title: 'Haarspray Extra Stark',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Haarpflege',
      comparisonGroup: 'haarspray-extra-stark::0.25-l',
    }),
    offer({
      title: 'Haar- und Koerperspray Kokos',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Koerperpflege',
      comparisonGroup: 'haar-und-koerperspray-kokos::0.15-l',
    }),
  ];

  assert.deepEqual(applyQueryMatch(offers, 'haar\u00f6l'), []);
  assert.deepEqual(applyQueryMatch(offers, 'haaroel'), []);
  assert.deepEqual(applyQueryMatch(offers, 'haarol'), []);
  assert.deepEqual(applyQueryMatch(offers, 'haar\ufffdl'), []);
  assert.deepEqual(applyQueryMatch(offers, 'haar\u00c3\u00b6l'), []);
});

test('generic joghurt ranks dairy joghurt and excludes shower gel sweets and baby bars', () => {
  const offers = [
    offer({
      title: 'Fa Joghurt Aloe Vera Duschgel',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Koerperpflege',
      comparisonGroup: 'fa-joghurt-duschgel::0.25-l',
    }),
    offer({
      title: 'nimm2 Lachgummi Frucht & Joghurt',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'nimm2-lachgummi-joghurt::0.25-kg',
    }),
    offer({
      title: 'HiPP Fruchtriegel Joghurt-Kirsch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Baby / Kinder',
      comparisonGroup: 'hipp-fruchtriegel-joghurt::0.023-kg',
    }),
    offer({
      title: 'Naturjoghurt 3,6%',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'naturjoghurt::0.5-kg',
    }),
    offer({
      title: 'Gelatelli Frozen Joghurt',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Tiefkuehl',
      comparisonGroup: 'gelatelli-frozen-joghurt::0.5-kg',
    }),
  ];

  const titles = applyQueryMatch(offers, 'joghurt').map((item) => item.title);

  assert.deepEqual(titles, ['Naturjoghurt 3,6%', 'Gelatelli Frozen Joghurt']);
});

test('generic katzenfutter ranks food and excludes cat litter while katzenstreu remains searchable', () => {
  const offers = [
    offer({
      title: 'ZooRoyal Ultra Klumpstreu Pinienduft',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenstreu',
      comparisonGroup: 'zooroyal-klumpstreu::5-l',
      searchText: 'Tierbedarf Katze Katzenfutter Katzenstreu',
    }),
    offer({
      title: 'Gourmet GOLD Katzenfutter-Dose',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenfutter',
      comparisonGroup: 'gourmet-gold-katzenfutter::0.085-kg',
    }),
    offer({
      title: 'Whiskas Katzen-Trockenfutter',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenfutter',
      comparisonGroup: 'whiskas-katzen-trockenfutter::0.95-kg',
    }),
  ];

  const foodTitles = applyQueryMatch(offers, 'katzenfutter').map((item) => item.title);
  const litterTitles = applyQueryMatch(offers, 'katzenstreu').map((item) => item.title);

  assert.deepEqual(foodTitles, ['Gourmet GOLD Katzenfutter-Dose', 'Whiskas Katzen-Trockenfutter']);
  assert.equal(litterTitles[0], 'ZooRoyal Ultra Klumpstreu Pinienduft');
});

test('ranks real rice ahead of pasta sauce noodles beans and category-only conserve hits', () => {
  const offers = [
    offer({
      title: 'Despar Passata di Pomodoro',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Pasta, Reis & Konserven',
      subcategoryKey: 'pasta-reis-konserven',
      comparisonGroup: 'despar-passata-pomodoro::0.7-kg',
    }),
    offer({
      title: 'Barilla Spaghetti',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Pasta, Reis & Konserven',
      comparisonGroup: 'barilla-spaghetti::0.5-kg',
    }),
    offer({
      title: 'Bonduelle Kichererbsen',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Pasta, Reis & Konserven',
      comparisonGroup: 'bonduelle-kichererbsen::0.4-kg',
    }),
    offer({
      title: 'MAGGI Asia Fix Gebratener Reis',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Pasta, Reis & Konserven',
      comparisonGroup: 'maggi-asia-fix-gebratener-reis::1-beutel',
    }),
    offer({
      title: 'Basmati Reis 1 kg',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Pasta, Reis & Konserven',
      comparisonGroup: 'basmati-reis::1-kg',
    }),
    offer({
      title: 'Langkornreis',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Pasta, Reis & Konserven',
      comparisonGroup: 'langkornreis::1-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'reis').map((item) => item.title);

  assert.deepEqual(new Set(sortedTitles.slice(0, 2)), new Set([
    'Basmati Reis 1 kg',
    'Langkornreis',
  ]));
  assert.equal(sortedTitles.includes('Despar Passata di Pomodoro'), false);
  assert.equal(sortedTitles.includes('Barilla Spaghetti'), false);
  assert.equal(sortedTitles.includes('Bonduelle Kichererbsen'), false);
  assert.equal(sortedTitles.includes('MAGGI Asia Fix Gebratener Reis'), false);
});

test('excludes rice-adjacent snacks for generic rice queries', () => {
  const offers = [
    offer({
      title: 'Reiswaffeln Natur',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Bio Snacks',
      comparisonGroup: 'reiswaffeln-natur::0.1-kg',
    }),
    offer({
      title: 'Milchreis pur',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Baby Nahrung',
      comparisonGroup: 'milchreis-pur::0.19-kg',
    }),
    offer({
      title: 'Jasminreis 1 kg',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Pasta, Reis & Konserven',
      comparisonGroup: 'jasminreis::1-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'reis').map((item) => item.title);

  assert.equal(sortedTitles[0], 'Jasminreis 1 kg');
  assert.equal(sortedTitles.includes('Milchreis pur'), false);
  assert.equal(sortedTitles.includes('Reiswaffeln Natur'), false);
});

test('keeps real rice products even when broad category text contains pasta', () => {
  const offers = [
    offer({
      title: 'Barilla Spaghetti N.5',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Pasta, Reis & Konserven',
      subcategoryKey: 'pasta-reis-konserven',
      searchText: 'barilla spaghetti n 5 lebensmittel pasta reis konserven 500 g',
    }),
    offer({
      title: 'Riso Gallo Risottoreis Selezione Speciale',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Pasta, Reis & Konserven',
      subcategoryKey: 'pasta-reis-konserven',
      searchText: 'riso gallo risottoreis selezione speciale lebensmittel pasta reis konserven 500 g',
      comparisonGroup: '',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'reis').map((item) => item.title);

  assert.deepEqual(sortedTitles, ['Riso Gallo Risottoreis Selezione Speciale']);
});

test('scores coffee products ahead of plant assortment side hits', () => {
  const coffee = offer({
    title: 'Nescafe Eiskaffee div. Sorten',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'nescafe-eiskaffee::0.25-l',
  });
  const plant = offer({
    title: 'Frucht- oder Zierpflanze im Becher Erdbeere Tomate Banane Kaffee oder Duftgeranie',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'frucht-zierpflanze-erdbeere-tomate-banane-kaffee-duftgeranie::1-Stk',
  });

  assert.ok(scoreOfferAgainstQuery(coffee, 'kaffee') > scoreOfferAgainstQuery(plant, 'kaffee'));
});

test('sorts multi-token brand/product matches ahead of partial side hits', () => {
  const energyDrink = offer({
    title: 'Red Bull Sea Blue Edition 4-Pack',
    brand: 'Red Bull',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Softdrinks & Energy',
  });
  const redWine = offer({
    title: 'Artner Red Passion',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wein & Sekt',
  });

  assert.deepEqual(applyQueryMatch([redWine, energyDrink], 'red bull')[0], energyDrink);
});

test('keeps drogerie queries relevant instead of broadly matching the whole category', () => {
  const shampoo = offer({
    title: 'Balea Shampoo div. Sorten',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Haarpflege',
    comparisonGroup: 'balea-shampoo::0.3-l',
  });
  const genericCare = offer({
    title: 'Balea Reinigungstuecher',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Koerperpflege',
    comparisonGroup: 'balea-reinigungstuecher::25-Stk',
  });

  assert.ok(scoreOfferAgainstQuery(shampoo, 'shampoo') > 0);
  assert.equal(scoreOfferAgainstQuery(genericCare, 'shampoo'), 0);
});

test('ranks concrete laundry detergent ahead of generic cleaning side hits', () => {
  const offers = [
    offer({
      title: 'BI HOME Desinfektionstuecher',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'home-desinfektionstuecher::40-Stk',
    }),
    offer({
      title: 'Dr. Beckmann Aufhelltuecher',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'beckmann-aufhelltuecher::15-Stk',
    }),
    offer({
      title: 'Profissimo Schmutzradierer',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'profissimo-schmutzradierer::6-Stk',
    }),
    offer({
      title: 'Ariel Waschmittel Fluessig',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'ariel-waschmittel-fluessig::1-Stk',
    }),
    offer({
      title: 'Weisser Riese Waschmittel Pulver',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'weisser-riese-waschmittel-pulver::1-Stk',
    }),
    offer({
      title: 'Persil Waschmittel Discs',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'persil-waschmittel-discs::1-Stk',
    }),
  ];

  const sortedTitles = applyQueryMatch(offers, 'waschmittel').map((item) => item.title);

  assert.deepEqual(sortedTitles.slice(0, 3), [
    'Ariel Waschmittel Fluessig',
    'Persil Waschmittel Discs',
    'Weisser Riese Waschmittel Pulver',
  ]);
});

test('keeps grouped detergent response query-sorted for live response order', () => {
  const offers = [
    offer({
      title: 'BI HOME Desinfektionstuecher',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'home-desinfektionstuecher::40-Stk',
      normalizedUnitPrice: { amount: 0.05, unit: 'Stk' },
      sortScoreDefault: 9999,
    }),
    offer({
      title: 'Clever Geschirr Reiniger Schwaemme',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'clever-geschirr-reiniger-schwaemme::10-Stk',
      normalizedUnitPrice: { amount: 0.12, unit: 'Stk' },
      sortScoreDefault: 9999,
    }),
    offer({
      title: 'Denkmit Multi-Power Geschirr Reiniger',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'denkmit-multi-power-geschirr-reiniger::40-Stk',
      normalizedUnitPrice: { amount: 0.13, unit: 'Stk' },
      sortScoreDefault: 9999,
    }),
    offer({
      title: 'Dr. Beckmann WC-Reinigungs-Blaetter',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'beckmann-wc-reinigungs-blaetter::20-Stk',
      normalizedUnitPrice: { amount: 0.15, unit: 'Stk' },
      sortScoreDefault: 9999,
    }),
    offer({
      title: 'Profissimo Allzwecktuecher',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'profissimo-allzwecktuecher::6-Stk',
      normalizedUnitPrice: { amount: 0.17, unit: 'Stk' },
      sortScoreDefault: 9999,
    }),
    offer({
      title: 'Somat Geschirrspuel-Tabs',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'somat-geschirrspuel-tabs::55-Stk',
      normalizedUnitPrice: { amount: 0.18, unit: 'Stk' },
      sortScoreDefault: 9999,
    }),
    offer({
      title: 'Ariel Waschmittel',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'ariel-waschmittel::1-Stk',
      normalizedUnitPrice: { amount: 8.99, unit: 'Stk' },
      sortScoreDefault: 1,
    }),
    offer({
      title: 'Weisser Riese Waschmittel',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'weisser-riese-waschmittel::1-Stk',
      normalizedUnitPrice: { amount: 9.99, unit: 'Stk' },
      sortScoreDefault: 1,
    }),
    offer({
      title: 'Persil Waschmittel',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'persil-waschmittel::1-Stk',
      normalizedUnitPrice: { amount: 10.99, unit: 'Stk' },
      sortScoreDefault: 1,
    }),
  ];

  const firstGroupTitles = buildGroupedRankings(
    prepareQueryOffersForResponse(applyQueryMatch(offers, 'waschmittel'), 'waschmittel'),
    { query: 'waschmittel' }
  ).flatMap((group) => group.offers).map((item) => item.title);

  assert.deepEqual(new Set(firstGroupTitles.slice(0, 3)), new Set([
    'Ariel Waschmittel',
    'Weisser Riese Waschmittel',
    'Persil Waschmittel',
  ]));
});

test('ranks chicken meat ahead of pet food for generic huhn search', () => {
  const offers = [
    offer({
      title: 'Sheba Nassfutter mit Huhn',
      brand: 'Sheba',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenfutter',
      comparisonGroup: 'sheba-nassfutter-huhn::12-Stk',
    }),
    offer({
      title: 'Hendl Hühnerfilet frisch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'hendl-huehnerfilet::1-kg',
    }),
    offer({
      title: 'Whiskas Katzenfutter Huhn',
      brand: 'Whiskas',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenfutter',
      comparisonGroup: 'whiskas-katzenfutter-huhn::12-Stk',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'huhn').map((item) => item.title);

  assert.equal(sortedTitles[0], 'Hendl Hühnerfilet frisch');
  assert.ok(sortedTitles.includes('Sheba Nassfutter mit Huhn'));
  assert.ok(sortedTitles.indexOf('Sheba Nassfutter mit Huhn') > 0);
  assert.ok(sortedTitles.indexOf('Whiskas Katzenfutter Huhn') > 0);
});

test('ranks real milk ahead of cheese or cream brand context hits', () => {
  const offers = [
    offer({
      title: 'Salzburg Milch Gouda Scheiben',
      brand: 'Salzburg Milch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaese',
      comparisonGroup: 'salzburg-milch-gouda::0.25-kg',
    }),
    offer({
      title: 'Tirol Milch Schlagobers',
      brand: 'Tirol Milch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'tirol-milch-schlagobers::0.25-l',
    }),
    offer({
      title: 'Ja Natuerlich Bio Vollmilch 1 l',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'bio-vollmilch::1-l',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'milch').map((item) => item.title);

  assert.deepEqual(sortedTitles, ['Ja Natuerlich Bio Vollmilch 1 l']);
  assert.equal(sortedTitles[0], 'Ja Natuerlich Bio Vollmilch 1 l');
  assert.equal(sortedTitles.includes('Salzburg Milch Gouda Scheiben'), false);
  assert.equal(sortedTitles.includes('Tirol Milch Schlagobers'), false);
});

test('ranks drinking milk ahead of whole milk chocolate for milk search', () => {
  const offers = [
    offer({
      title: "Tony's Chocolonely Vollmilch Schokolade",
      brand: "Tony's Chocolonely",
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'tonys-chocolonely-vollmilch-schokolade::0.18-kg',
    }),
    offer({
      title: 'Bio Frischmilch 1 l',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'bio-frischmilch::1-l',
    }),
    offer({
      title: 'Milka Vollmilch Schokolade',
      brand: 'Milka',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'milka-vollmilch-schokolade::0.1-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'milch').map((item) => item.title);

  assert.deepEqual(sortedTitles, ['Bio Frischmilch 1 l']);
  assert.equal(sortedTitles[0], 'Bio Frischmilch 1 l');
  assert.equal(sortedTitles.includes("Tony's Chocolonely Vollmilch Schokolade"), false);
  assert.equal(sortedTitles.includes('Milka Vollmilch Schokolade'), false);
});

test('does not give whole milk chocolate a positive milk intent boost', () => {
  const drinkingMilk = offer({
    title: 'Vollmilch 1 Liter',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    comparisonGroup: 'vollmilch::1-l',
  });
  const chocolate = offer({
    title: 'LU Mikado Vollmilch oder Zartbitter',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Suesswaren & Knabbereien',
    comparisonGroup: 'lu-mikado-vollmilch-zartbitter::0.075-kg',
  });

  assert.ok(scoreOfferAgainstQuery(drinkingMilk, 'milch') > scoreOfferAgainstQuery(chocolate, 'milch'));
});

[
  {
    name: 'palmolive liquid soap milk honey',
    sideOffer: offer({
      title: 'Palmolive Fluessigseife Milch-Honig',
      brand: 'Palmolive',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Koerperpflege',
      comparisonGroup: 'palmolive-fluessigseife-milch-honig::0.3-l',
    }),
  },
  {
    name: 'heumilk cheese slices',
    sideOffer: offer({
      title: 'Bio-Kaesescheiben aus Heumilch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaese',
      comparisonGroup: 'bio-kaesescheiben-heumilch::0.15-kg',
    }),
  },
  {
    name: 'tirol milch cheese brand hit',
    sideOffer: offer({
      title: 'Tirol Milch Feiner Tiroler',
      brand: 'Tirol Milch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaese',
      comparisonGroup: 'tirol-milch-feiner-tiroler::0.25-kg',
    }),
  },
  {
    name: 'buttermilk cake',
    sideOffer: offer({
      title: 'Buttermilch-Kuchen',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Brot & Gebaeck',
      comparisonGroup: 'buttermilch-kuchen::1-Stk',
    }),
  },
  {
    name: 'hipp follow-on milk',
    sideOffer: offer({
      title: 'HiPP Combiotik Folgemilch',
      brand: 'HiPP',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Baby / Kinder',
      comparisonGroup: 'hipp-combiotik-folgemilch::0.6-kg',
    }),
  },
].forEach(({ name, sideOffer }) => {
  test(`ranks drinking milk ahead of ${name} for generic milk search`, () => {
    const drinkingMilk = offer({
      title: 'Trinkmilch 1 Liter',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'trinkmilch::1-l',
    });
    const sortedTitles = applyQueryMatch([sideOffer, drinkingMilk], 'milch').map((item) => item.title);

    assert.deepEqual(sortedTitles, ['Trinkmilch 1 Liter']);
    assert.equal(sortedTitles[0], 'Trinkmilch 1 Liter');
    assert.equal(sortedTitles.includes(sideOffer.title), false);
  });
});

test('does not boost whole milk chocolate as drinking milk for generic milk search', () => {
  const drinkingMilk = offer({
    title: 'Trinkmilch 1 Liter',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    comparisonGroup: 'trinkmilch::1-l',
  });
  const chocolate = offer({
    title: 'Vollmilch-Schokolade',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Suesswaren & Knabbereien',
    comparisonGroup: 'vollmilch-schokolade::0.1-kg',
  });

  assert.ok(scoreOfferAgainstQuery(drinkingMilk, 'milch') - scoreOfferAgainstQuery(chocolate, 'milch') > 4000);
});

test('keeps drinking milk visible for generic milk search', () => {
  const drinkingMilk = offer({
    title: 'Trinkmilch 1 Liter',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    comparisonGroup: 'trinkmilch::1-l',
  });

  assert.deepEqual(applyQueryMatch([drinkingMilk], 'milch').map((item) => item.title), [
    'Trinkmilch 1 Liter',
  ]);
});

test('does not use butter, cosmetics or peanut butter cups as milk replacement hits', () => {
  const offers = [
    offer({
      title: 'Milsani Irische Butter',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'milsani-irische-butter::0.25-kg',
    }),
    offer({
      title: 'MANHATTAN Butter Me Up Lippenbalsam',
      brand: 'MANHATTAN',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Kosmetik & Make-up',
      comparisonGroup: 'manhattan-butter-lippenbalsam::1-Stk',
    }),
    offer({
      title: 'Protein Peanut Butter Cups',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'protein-peanut-butter-cups::0.04-kg',
    }),
    offer({
      title: 'Trinkmilch 1 Liter',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'trinkmilch::1-l',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'milch').map((item) => item.title);

  assert.deepEqual(sortedTitles, ['Trinkmilch 1 Liter']);
});

test('does not use yoghurt or actimel as milk replacement hits', () => {
  const offers = [
    offer({
      title: 'Naturjoghurt 3,5 Prozent',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'naturjoghurt::0.5-kg',
    }),
    offer({
      title: 'Actimel Drink Erdbeere',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'actimel-drink::0.6-l',
    }),
    offer({
      title: 'Frischmilch 1 l',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'frischmilch::1-l',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'milch').map((item) => item.title);

  assert.deepEqual(sortedTitles, ['Frischmilch 1 l']);
});

test('returns no generic milk ranking when only irrelevant replacement hits are available', () => {
  const offers = [
    offer({
      title: 'Milsani Irische Butter',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'milsani-irische-butter::0.25-kg',
    }),
    offer({
      title: 'Naturjoghurt 3,5 Prozent',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'naturjoghurt::0.5-kg',
    }),
    offer({
      title: 'MANHATTAN Butter Me Up Lippenbalsam',
      brand: 'MANHATTAN',
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Kosmetik & Make-up',
      comparisonGroup: 'manhattan-butter-lippenbalsam::1-Stk',
    }),
  ];

  assert.deepEqual(applyQueryMatch(offers, 'milch'), []);
});

test('ranks drinking milk ahead of heumilk camembert or cheese for milk search', () => {
  const offers = [
    offer({
      title: 'Heumilch Bio-Camembert',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaese',
      comparisonGroup: 'heumilch-bio-camembert::0.15-kg',
    }),
    offer({
      title: 'Bio Heumilch 1 l',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'bio-heumilch::1-l',
    }),
    offer({
      title: 'Heumilch Gouda Scheiben',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaese',
      comparisonGroup: 'heumilch-gouda-scheiben::0.25-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'milch').map((item) => item.title);

  assert.deepEqual(sortedTitles, ['Bio Heumilch 1 l']);
  assert.equal(sortedTitles[0], 'Bio Heumilch 1 l');
  assert.equal(sortedTitles.includes('Heumilch Bio-Camembert'), false);
  assert.equal(sortedTitles.includes('Heumilch Gouda Scheiben'), false);
});

test('dampens milk brand cheese hits for milk search', () => {
  const offers = [
    offer({
      title: 'Gmundner Milch Edamer Scheiben',
      brand: 'Gmundner Milch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaese',
      comparisonGroup: 'gmundner-milch-edamer-scheiben::0.25-kg',
    }),
    offer({
      title: 'Tirol Milch Graukaese',
      brand: 'Tirol Milch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaese',
      comparisonGroup: 'tirol-milch-graukaese::0.2-kg',
    }),
    offer({
      title: 'Frischmilch 1 l',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'frischmilch::1-l',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'milch').map((item) => item.title);

  assert.deepEqual(sortedTitles, ['Frischmilch 1 l']);
  assert.equal(sortedTitles[0], 'Frischmilch 1 l');
  assert.equal(sortedTitles.includes('Gmundner Milch Edamer Scheiben'), false);
  assert.equal(sortedTitles.includes('Tirol Milch Graukaese'), false);
});

test('ranks drinking milk ahead of milk biscuit and chocolate snack hits', () => {
  const offers = [
    offer({
      title: 'Milch Broetle Schoko',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Brot & Gebaeck',
      comparisonGroup: 'milch-broetle-schoko::1-Stk',
    }),
    offer({
      title: 'Leibniz Choco & Milch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'leibniz-choco-milch::0.125-kg',
    }),
    offer({
      title: 'Merci Mandel-Milch-Nuss',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'merci-mandel-milch-nuss::0.25-kg',
    }),
    offer({
      title: 'Laktosefreie Milch 1 l',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'laktosefreie-milch::1-l',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'milch').map((item) => item.title);

  assert.deepEqual(sortedTitles, ['Laktosefreie Milch 1 l']);
  assert.equal(sortedTitles[0], 'Laktosefreie Milch 1 l');
  assert.equal(sortedTitles.includes('Milch Broetle Schoko'), false);
  assert.equal(sortedTitles.includes('Leibniz Choco & Milch'), false);
  assert.equal(sortedTitles.includes('Merci Mandel-Milch-Nuss'), false);
});

test('does not rank Bahlsen Ohne Gleichen as drinking milk for milk search', () => {
  const offers = [
    offer({
      title: 'Bahlsen Ohne Gleichen Vollmilch',
      brand: 'Bahlsen',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'bahlsen-ohne-gleichen-vollmilch::0.125-kg',
    }),
    offer({
      title: 'Vollmilch aus Deiner Region 1 l',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'vollmilch-aus-deiner-region::1-l',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'milch').map((item) => item.title);

  assert.deepEqual(sortedTitles, ['Vollmilch aus Deiner Region 1 l']);
});

test('nudeln search keeps pasta visible ahead of sweet noodle side hits', () => {
  const offers = [
    offer({
      title: 'Mohnnudeln mit Butterbroesel',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suessspeisen',
      comparisonGroup: 'mohnnudeln-butterbroesel::0.5-kg',
    }),
    offer({
      title: 'Barilla Spaghetti No. 5',
      brand: 'Barilla',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Pasta, Reis & Konserven',
      comparisonGroup: 'barilla-spaghetti-no-5::0.5-kg',
    }),
    offer({
      title: 'Penne Rigate',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Pasta, Reis & Konserven',
      comparisonGroup: 'penne-rigate::0.5-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'nudeln').map((item) => item.title);

  assert.deepEqual(sortedTitles.slice(0, 2), ['Barilla Spaghetti No. 5', 'Penne Rigate']);
  assert.ok(sortedTitles.indexOf('Mohnnudeln mit Butterbroesel') > 1);
});

test('filters safe core-product false positives without broadening generic queries', () => {
  assert.deepEqual(applyQueryMatch([
    offer({
      title: 'Syoss Oleo Intense Haarfarbe Permanente Oel-Coloration',
      categoryPrimary: 'Drogerie',
      categorySecondary: 'Haarfarbe',
      comparisonGroup: 'syoss-oleo-haarfarbe::1-stueck',
    }),
    offer({
      title: 'Bona Oel',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Oele & Gewuerze',
      comparisonGroup: 'bona-oel::1-l',
    }),
  ], 'oel').map((item) => item.title), ['Bona Oel']);

  assert.deepEqual(applyQueryMatch([
    offer({
      title: 'Meridol Mundspuelung Zahnfleischschutz',
      categoryPrimary: 'Drogerie',
      categorySecondary: 'Mundpflege',
      comparisonGroup: 'meridol-zahnfleischschutz::0.4-l',
    }),
    offer({
      title: 'Fleisch geschnitten',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'fleisch-geschnitten::1-kg',
    }),
  ], 'fleisch').map((item) => item.title), ['Fleisch geschnitten']);

  assert.deepEqual(applyQueryMatch([
    offer({
      title: 'Somat Geschirrspuel-Tabs Zitrone Limette',
      categoryPrimary: 'Drogerie',
      categorySecondary: 'Geschirrspuelmittel',
      comparisonGroup: 'somat-tabs-zitrone-limette::55-stueck',
    }),
    offer({
      title: 'Kiwi Gruen',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Obst & Gemuese',
      comparisonGroup: 'kiwi-gruen::1-stueck',
    }),
  ], 'obst').map((item) => item.title), ['Kiwi Gruen']);

  assert.deepEqual(applyQueryMatch([
    offer({
      title: 'Skoff Sauvignon Blanc Suedsteiermark',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Wein',
      comparisonGroup: 'skoff-suedsteiermark::0.75-l',
    }),
    offer({
      title: 'Freilandeier 10 Stueck',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Grundnahrungsmittel',
      comparisonGroup: 'freilandeier::10-stueck',
    }),
  ], 'eier').map((item) => item.title), ['Freilandeier 10 Stueck']);
});

test('does not rank cream ahead of drinking milk for milk search', () => {
  const offers = [
    offer({
      title: 'Tirol Milch Schlagobers',
      brand: 'Tirol Milch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'tirol-milch-schlagobers::0.25-l',
    }),
    offer({
      title: 'Haltbarmilch 1 l',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'haltbarmilch::1-l',
    }),
    offer({
      title: 'Sahne Dessert mit Milch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Dessert',
      comparisonGroup: 'sahne-dessert-milch::0.2-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'milch').map((item) => item.title);

  assert.deepEqual(sortedTitles, ['Haltbarmilch 1 l']);
  assert.equal(sortedTitles[0], 'Haltbarmilch 1 l');
  assert.equal(sortedTitles.includes('Tirol Milch Schlagobers'), false);
  assert.equal(sortedTitles.includes('Sahne Dessert mit Milch'), false);
});

test('keeps generic yoghurt focused on real dairy yoghurt', () => {
  const offers = [
    offer({
      title: 'Joghurttorte Erdbeer',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Backen & Suesswaren',
      comparisonGroup: 'joghurttorte-erdbeer::1-Stk',
    }),
    offer({
      title: 'Rama mit Joghurt',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Butter & Margarine',
      comparisonGroup: 'rama-joghurt::0.25-kg',
    }),
    offer({
      title: 'Naturjoghurt 3,5 Prozent',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      comparisonGroup: 'naturjoghurt::0.5-kg',
    }),
    offer({
      title: 'Fruchtriegel Joghurt',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'fruchtriegel-joghurt::6-Stk',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'joghurt').map((item) => item.title);

  assert.deepEqual(sortedTitles, ['Naturjoghurt 3,5 Prozent']);
});

test('ranks cheese products ahead of meat products with cheese', () => {
  const offers = [
    offer({
      title: 'Mini Pljeskavica mit Kaese',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'mini-pljeskavica-kaese::0.4-kg',
    }),
    offer({
      title: 'Gouda Scheiben',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaese',
      comparisonGroup: 'gouda-scheiben::0.25-kg',
    }),
    offer({
      title: 'Cabanossi mit Kaese',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'cabanossi-kaese::0.3-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'kaese').map((item) => item.title);

  assert.equal(sortedTitles[0], 'Gouda Scheiben');
  assert.ok(sortedTitles.indexOf('Cabanossi mit Kaese') > 0);
});

test('ranks chocolate bars ahead of chocolate dessert hits', () => {
  const offers = [
    offer({
      title: 'Schokolade Dessert Creme',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Dessert',
      comparisonGroup: 'schokolade-dessert-creme::0.2-kg',
    }),
    offer({
      title: 'Milka Tafelschokolade Alpenmilch',
      brand: 'Milka',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'milka-tafelschokolade::0.1-kg',
    }),
    offer({
      title: 'Lindt Schokolade Riegel',
      brand: 'Lindt',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'lindt-schokolade-riegel::0.05-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'schokolade').map((item) => item.title);

  assert.deepEqual(new Set(sortedTitles.slice(0, 2)), new Set([
    'Milka Tafelschokolade Alpenmilch',
    'Lindt Schokolade Riegel',
  ]));
  assert.ok(sortedTitles.indexOf('Schokolade Dessert Creme') > 1);
});

test('ranks classic coffee ahead of iced coffee drink for generic coffee search', () => {
  const offers = [
    offer({
      title: 'Emmi Caffe Latte Eiskaffee Drink',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      comparisonGroup: 'emmi-caffe-latte::0.23-l',
    }),
    offer({
      title: 'Lavazza Kaffee Bohnen Espresso',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      comparisonGroup: 'lavazza-kaffee-bohnen::1-kg',
    }),
    offer({
      title: 'Nespresso Kaffee Kapseln',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      comparisonGroup: 'nespresso-kaffee-kapseln::10-Stk',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'kaffee').map((item) => item.title);

  assert.deepEqual(new Set(sortedTitles.slice(0, 2)), new Set([
    'Lavazza Kaffee Bohnen Espresso',
    'Nespresso Kaffee Kapseln',
  ]));
  assert.ok(sortedTitles.indexOf('Emmi Caffe Latte Eiskaffee Drink') > 1);
});

test('ranks real detergent ahead of unclear laundry accessory hits', () => {
  const offers = [
    offer({
      title: 'Dr. Beckmann Aufhelltuecher',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'beckmann-aufhelltuecher::15-Stk',
    }),
    offer({
      title: 'Ariel Waschmittel Pods 20 WG',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'ariel-waschmittel-pods::20-Stk',
    }),
    offer({
      title: 'Profissimo Waesche Duftperlen',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reiniger',
      comparisonGroup: 'profissimo-waesche-duftperlen::1-Stk',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'waschmittel').map((item) => item.title);

  assert.equal(sortedTitles[0], 'Ariel Waschmittel Pods 20 WG');
  assert.ok(sortedTitles.indexOf('Dr. Beckmann Aufhelltuecher') > 0);
});

test('keeps offers without validTo in ranking groups', () => {
  const noEndDateOffer = offer({
    title: 'BILLA Bio Butter 250 g',
    retailerKey: 'billa',
    status: 'active',
    isActiveNow: true,
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    comparisonGroup: 'billa-bio-butter::0.25-kg',
    normalizedUnitPrice: { amount: 8.76, unit: 'kg' },
    priceCurrent: { amount: 2.19 },
    validTo: null,
    sortScoreDefault: 100,
    quality: { comparisonSafe: true },
  });
  const grouped = buildGroupedRankings([noEndDateOffer]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].offers.length, 1);
  assert.equal(grouped[0].offers[0].title, 'BILLA Bio Butter 250 g');
});

test('keeps unsafe comparable offers visible but prefers safe peers when otherwise similar', () => {
  const unsafeCheap = offer({
    title: 'A Kaffee unklare Menge',
    retailerKey: 'hofer',
    status: 'active',
    isActiveNow: true,
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: '',
    searchText: 'kaffee',
    quantityText: '',
    comparableUnit: '',
    normalizedUnitPrice: { amount: 1.99, unit: 'kg', comparable: false },
    priceCurrent: { amount: 1.99 },
    sortScoreDefault: 100,
    quality: { comparisonSafe: false },
  });
  const safePeer = offer({
    title: 'B Kaffee klare Menge',
    retailerKey: 'spar',
    status: 'active',
    isActiveNow: true,
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'kaffee::0.5-kg',
    searchText: 'kaffee',
    quantityText: '500 g',
    totalComparableAmount: 0.5,
    comparableUnit: 'kg',
    normalizedUnitPrice: { amount: 5.98, unit: 'kg', comparable: true },
    priceCurrent: { amount: 2.99 },
    sortScoreDefault: 100,
    quality: { comparisonSafe: true },
  });
  const groupedTitles = buildGroupedRankings(
    prepareQueryOffersForResponse(applyQueryMatch([unsafeCheap, safePeer], 'kaffee'), 'kaffee'),
    { query: 'kaffee' }
  )
    .flatMap((group) => group.offers)
    .map((item) => item.title);

  assert.deepEqual(groupedTitles, [
    'B Kaffee klare Menge',
    'A Kaffee unklare Menge',
  ]);
});

test('slightly prefers otherwise similar offers with clear validTo', () => {
  const withoutValidTo = offer({
    title: 'A Kaffee Ohne Enddatum',
    retailerKey: 'billa',
    status: 'active',
    isActiveNow: true,
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'test-kaffee::0.5-kg',
    normalizedUnitPrice: { amount: 9.99, unit: 'kg' },
    priceCurrent: { amount: 4.99 },
    validTo: null,
    sortScoreDefault: 100,
    quality: { comparisonSafe: true },
  });
  const withValidTo = offer({
    ...withoutValidTo,
    title: 'B Kaffee Mit Enddatum',
    validTo: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const groupedTitles = buildGroupedRankings([withoutValidTo, withValidTo])[0].offers.map((item) => item.title);

  assert.deepEqual(groupedTitles, [
    'B Kaffee Mit Enddatum',
    'A Kaffee Ohne Enddatum',
  ]);
});

test('keeps BILLA-like snapshot offers without validTo findable but lower than clear validity peers', () => {
  const billaSnapshot = offer({
    title: 'BILLA Caffe Crema Ganze Bohne',
    retailerKey: 'billa',
    status: 'active',
    isActiveNow: true,
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'caffe-crema::1-kg',
    searchText: 'billa caffe crema kaffee',
    normalizedUnitPrice: { amount: 11.99, unit: 'kg' },
    priceCurrent: { amount: 11.99 },
    validTo: null,
    sortScoreDefault: 100,
    quality: { comparisonSafe: true },
    rawFacts: { sourceType: 'billa-official-algolia', snapshotCurrent: true },
  });
  const datedPeer = offer({
    ...billaSnapshot,
    title: 'PENNY Caffe Crema Ganze Bohne',
    retailerKey: 'penny',
    searchText: 'penny caffe crema kaffee',
    validTo: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const matched = applyQueryMatch([billaSnapshot, datedPeer], 'kaffee');
  const groupedTitles = buildGroupedRankings(matched)[0].offers.map((item) => item.title);

  assert.equal(matched.some((item) => item.retailerKey === 'billa'), true);
  assert.deepEqual(groupedTitles, [
    'PENNY Caffe Crema Ganze Bohne',
    'BILLA Caffe Crema Ganze Bohne',
  ]);
});

test('dedupes exact offer identities and dedupe keys for query responses', () => {
  const offers = [
    offer({
      _id: 'same-id',
      dedupeKey: 'same-key',
      title: 'Milka Hauchzarte Herzen Alpenmilch',
      retailerKey: 'billa',
      priceCurrent: { amount: 2.99 },
      quantityText: '130 g',
    }),
    offer({
      _id: 'same-id',
      dedupeKey: 'same-key',
      title: 'Milka Hauchzarte Herzen Alpenmilch',
      retailerKey: 'billa',
      priceCurrent: { amount: 2.99 },
      quantityText: '130 g',
    }),
  ];

  assert.equal(dedupeQueryOffers(offers, 'milka').length, 1);
});

test('dedupes same retailer title price and quantity fallback for query responses', () => {
  const offers = [
    offer({
      _id: 'first',
      title: 'Emmi Caffe Latte Cappuccino',
      retailerKey: 'billa',
      priceCurrent: { amount: 1.32 },
      quantityText: '230 ml',
    }),
    offer({
      _id: 'second',
      title: 'Emmi Caffe Latte Cappuccino',
      retailerKey: 'billa',
      priceCurrent: { amount: 1.32 },
      quantityText: '230 ml',
    }),
  ];

  assert.equal(dedupeQueryOffers(offers, 'kaffee').length, 1);
});

test('keeps same title for different retailers and distinct variants', () => {
  const offers = [
    offer({
      _id: 'billa',
      title: 'Emmi Caffe Latte Cappuccino',
      retailerKey: 'billa',
      priceCurrent: { amount: 1.32 },
      quantityText: '230 ml',
    }),
    offer({
      _id: 'billa-plus',
      title: 'Emmi Caffe Latte Cappuccino',
      retailerKey: 'billa-plus',
      priceCurrent: { amount: 1.32 },
      quantityText: '230 ml',
    }),
    offer({
      _id: 'billa-large',
      title: 'Emmi Caffe Latte Cappuccino',
      retailerKey: 'billa',
      priceCurrent: { amount: 2.49 },
      quantityText: '500 ml',
    }),
  ];

  assert.equal(dedupeQueryOffers(offers, 'kaffee').length, 3);
});

test('keeps hardware variants with material power model or color differences', () => {
  const offers = [
    offer({
      _id: 'bohrer-hss',
      title: 'Bohrer Set',
      brand: 'Bosch',
      retailerKey: 'baumarkt',
      priceCurrent: { amount: 12.99 },
      quantityText: '10 Stk',
      rawFacts: { material: 'HSS', modell: 'X-Line' },
    }),
    offer({
      _id: 'bohrer-stein',
      title: 'Bohrer Set',
      brand: 'Bosch',
      retailerKey: 'baumarkt',
      priceCurrent: { amount: 12.99 },
      quantityText: '10 Stk',
      rawFacts: { material: 'Stein', modell: 'CYL-3' },
    }),
    offer({
      _id: 'farbe-weiss',
      title: 'Wandfarbe',
      retailerKey: 'baumarkt',
      priceCurrent: { amount: 24.99 },
      quantityText: '10 l',
      rawFacts: { farbe: 'weiss matt' },
    }),
    offer({
      _id: 'farbe-grau',
      title: 'Wandfarbe',
      retailerKey: 'baumarkt',
      priceCurrent: { amount: 24.99 },
      quantityText: '10 l',
      rawFacts: { farbe: 'grau matt' },
    }),
    offer({
      _id: 'akku-2ah',
      title: 'Akku',
      retailerKey: 'baumarkt',
      priceCurrent: { amount: 39.99 },
      quantityText: '1 Stk',
      rawFacts: { spannung: '18 V', leistung: '2 Ah', modell: 'PBA 18V 2.0Ah' },
    }),
    offer({
      _id: 'akku-4ah',
      title: 'Akku',
      retailerKey: 'baumarkt',
      priceCurrent: { amount: 39.99 },
      quantityText: '1 Stk',
      rawFacts: { spannung: '18 V', leistung: '4 Ah', modell: 'PBA 18V 4.0Ah' },
    }),
  ];

  assert.equal(dedupeQueryOffers(offers, 'bohrer').length, 6);
});

test('reduces adjacent visible duplicate titles without dropping different retailers', () => {
  const offers = [
    offer({
      _id: 'emmi-billa',
      title: 'Emmi Caffe Latte Cappuccino',
      retailerKey: 'billa',
      priceCurrent: { amount: 1.32 },
      quantityText: '230 ml',
      normalizedUnitPrice: { amount: 5.74, unit: 'l' },
    }),
    offer({
      _id: 'emmi-billa-plus',
      title: 'Emmi Caffe Latte Cappuccino',
      retailerKey: 'billa-plus',
      priceCurrent: { amount: 1.32 },
      quantityText: '230 ml',
      normalizedUnitPrice: { amount: 5.74, unit: 'l' },
    }),
    offer({
      _id: 'eduscho-billa',
      title: 'Eduscho Caffe Crema Brasilien Ganze Bohne',
      retailerKey: 'billa',
      priceCurrent: { amount: 17.24 },
      quantityText: '1 kg',
      normalizedUnitPrice: { amount: 17.24, unit: 'kg' },
    }),
    offer({
      _id: 'eduscho-billa-plus',
      title: 'Eduscho Caffe Crema Brasilien Ganze Bohne',
      retailerKey: 'billa-plus',
      priceCurrent: { amount: 17.24 },
      quantityText: '1 kg',
      normalizedUnitPrice: { amount: 17.24, unit: 'kg' },
    }),
  ];

  const prepared = prepareQueryOffersForResponse(offers, 'kaffee');
  const titles = prepared.map((item) => item.title);

  assert.equal(prepared.length, 4);
  assert.notEqual(titles[0], titles[1]);
  assert.notEqual(titles[1], titles[2]);
});

test('keeps milka and coffee response groups visibly de-clustered', () => {
  const milkaOffers = prepareQueryOffersForResponse([
    offer({
      _id: 'hauch-billa',
      title: 'Milka Hauchzarte Herzen Alpenmilch',
      retailerKey: 'billa',
      priceCurrent: { amount: 2.99 },
      quantityText: '130 g',
      normalizedUnitPrice: { amount: 23, unit: 'kg' },
    }),
    offer({
      _id: 'hauch-billa-plus',
      title: 'Milka Hauchzarte Herzen Alpenmilch',
      retailerKey: 'billa-plus',
      priceCurrent: { amount: 2.99 },
      quantityText: '130 g',
      normalizedUnitPrice: { amount: 23, unit: 'kg' },
    }),
    offer({
      _id: 'alles-gute-billa',
      title: 'Milka Alles Gute a la Dessert au Chocolat',
      retailerKey: 'billa',
      priceCurrent: { amount: 2.99 },
      quantityText: '110 g',
      normalizedUnitPrice: { amount: 27.18, unit: 'kg' },
    }),
  ], 'milka');
  const milkaGroupedTitles = buildGroupedRankings(milkaOffers, { query: 'milka' })[0].offers.map((item) => item.title);

  assert.notEqual(milkaGroupedTitles[0], milkaGroupedTitles[1]);

  const coffeeOffers = prepareQueryOffersForResponse([
    offer({
      _id: 'emmi-billa',
      title: 'Emmi Caffe Latte Cappuccino',
      retailerKey: 'billa',
      priceCurrent: { amount: 1.32 },
      quantityText: '230 ml',
      normalizedUnitPrice: { amount: 5.74, unit: 'l' },
    }),
    offer({
      _id: 'emmi-billa-plus',
      title: 'Emmi Caffe Latte Cappuccino',
      retailerKey: 'billa-plus',
      priceCurrent: { amount: 1.32 },
      quantityText: '230 ml',
      normalizedUnitPrice: { amount: 5.74, unit: 'l' },
    }),
    offer({
      _id: 'eduscho-billa',
      title: 'Eduscho Caffe Crema Brasilien Ganze Bohne',
      retailerKey: 'billa',
      priceCurrent: { amount: 17.24 },
      quantityText: '1 kg',
      normalizedUnitPrice: { amount: 17.24, unit: 'kg' },
    }),
  ], 'kaffee');
  const coffeeGroupedTitles = buildGroupedRankings(coffeeOffers, { query: 'kaffee' })[0].offers.map((item) => item.title);

  assert.notEqual(coffeeGroupedTitles[0], coffeeGroupedTitles[1]);
});

test('prefers PENNY official html with safe validity over matching Aktionsfinder response duplicate', () => {
  const aktionsfinder = offer({
    _id: 'aktionsfinder-mango',
    title: 'Mango vorgereift',
    titleNormalized: 'mango vorgereift',
    retailerKey: 'penny',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 Stk',
    normalizedUnitPrice: { amount: 1.49, unit: 'Stk', comparable: true },
    validFrom: null,
    validTo: null,
    status: 'active',
    isActiveNow: true,
    sortScoreDefault: 500,
    quality: { comparisonSafe: true },
  });
  const official = offer({
    ...aktionsfinder,
    _id: 'official-mango',
    sourceType: 'penny-official-html',
    validFrom: new Date('2026-05-07T12:00:00Z'),
    validTo: new Date('2026-05-12T12:00:00Z'),
    sortScoreDefault: 100,
  });
  const prepared = prepareQueryOffersForResponse([aktionsfinder, official], 'mango');

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]._id, 'official-mango');
  assert.equal(prepared[0].sourceType, 'penny-official-html');
});

test('keeps Mango fruit and Mango Schaumbecher as separate response products', () => {
  const fruit = offer({
    _id: 'mango-fruit',
    title: 'Mango vorgereift',
    titleNormalized: 'mango vorgereift',
    retailerKey: 'penny',
    sourceType: 'penny-official-html',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 Stk',
    normalizedUnitPrice: { amount: 1.49, unit: 'Stk', comparable: true },
    validTo: new Date('2026-05-12T12:00:00Z'),
  });
  const dessert = offer({
    _id: 'mango-dessert',
    title: 'Schaumbecher mit Mango Geschmack',
    titleNormalized: 'schaumbecher mit mango geschmack',
    retailerKey: 'penny',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 Stk',
    normalizedUnitPrice: { amount: 1.49, unit: 'Stk', comparable: true },
    validTo: null,
  });
  const prepared = prepareQueryOffersForResponse([dessert, fruit], 'mango');

  assert.equal(prepared.length, 2);
  assert.deepEqual(new Set(prepared.map((item) => item._id)), new Set(['mango-fruit', 'mango-dessert']));
});

test('keeps Aktionsfinder offer visible when no better official duplicate exists', () => {
  const aktionsfinder = offer({
    _id: 'aktionsfinder-only',
    title: 'Mango vorgereift',
    retailerKey: 'penny',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 Stk',
    normalizedUnitPrice: { amount: 1.49, unit: 'Stk', comparable: true },
    validTo: null,
  });

  assert.deepEqual(prepareQueryOffersForResponse([aktionsfinder], 'mango'), [aktionsfinder]);
});

test('response dedupe applies official source priority conservatively for BILLA and LIDL', () => {
  const billaOfficial = offer({
    _id: 'billa-official',
    title: 'Ja Natuerlich Bio Milch 1 l',
    retailerKey: 'billa',
    sourceType: 'billa-official-algolia',
    priceCurrent: { amount: 1.29 },
    quantityText: '1 l',
    normalizedUnitPrice: { amount: 1.29, unit: 'l', comparable: true },
    validTo: null,
  });
  const billaAggregator = offer({
    ...billaOfficial,
    _id: 'billa-aktionsfinder',
    sourceType: 'aktionsfinder-json',
  });
  const lidlOfficial = offer({
    _id: 'lidl-official',
    title: 'Barilla Pasta 500 g',
    retailerKey: 'lidl',
    sourceType: 'lidl-official-flyer-api',
    priceCurrent: { amount: 0.99 },
    quantityText: '500 g',
    normalizedUnitPrice: { amount: 1.98, unit: 'kg', comparable: true },
    validFrom: new Date('2026-05-07T12:00:00Z'),
    validTo: new Date('2026-05-13T12:00:00Z'),
  });
  const lidlAggregator = offer({
    ...lidlOfficial,
    _id: 'lidl-aktionsfinder',
    sourceType: 'aktionsfinder-json',
  });

  const prepared = dedupeResponseOffers([billaAggregator, billaOfficial, lidlAggregator, lidlOfficial], '');

  assert.deepEqual(prepared.map((item) => item._id).sort(), ['billa-official', 'lidl-official']);
});

test('fresh active filter removes expired and stale offers but keeps recent missing-validTo snapshots', () => {
  const now = new Date('2026-05-21T12:00:00.000Z');
  const current = offer({
    title: 'BILLA Snapshot aktuell',
    status: 'active',
    isActiveNow: true,
    validTo: null,
    lastSeenAt: new Date('2026-05-21T08:00:00.000Z'),
  });
  const expiredByDate = offer({
    title: 'Abgelaufen nach validTo',
    status: 'active',
    isActiveNow: true,
    validTo: new Date('2026-05-20T23:59:59.999Z'),
  });
  const expiredByUrl = offer({
    title: 'Abgelaufen nach Aktionsfinder URL',
    status: 'active',
    isActiveNow: true,
    validTo: null,
    sourceUrl: 'https://www.aktionsfinder.at/l/spar-flugblatt-26-02-2026-11-03-2026/',
    lastSeenAt: new Date('2026-05-21T08:00:00.000Z'),
  });
  const staleSnapshot = offer({
    title: 'Alter Snapshot ohne Enddatum',
    status: 'active',
    isActiveNow: true,
    validTo: null,
    lastSeenAt: new Date('2026-05-01T08:00:00.000Z'),
  });

  assert.deepEqual(
    filterFreshActiveOffers([current, expiredByDate, expiredByUrl, staleSnapshot], now).map((item) => item.title),
    ['BILLA Snapshot aktuell']
  );
});

test('fresh active filter removes soft-deactivated repair offers', () => {
  const repaired = offer({
    title: 'Repair deaktiviert',
    status: 'expired',
    isActiveNow: false,
    validTo: null,
    sourceType: 'aktionsfinder-json',
    deactivatedAt: new Date('2026-05-21T12:00:00.000Z'),
    deactivationReason: 'freshness-repair-stale-aktionsfinder',
  });

  assert.deepEqual(filterFreshActiveOffers([repaired], new Date('2026-05-21T13:00:00.000Z')), []);
});

test('fresh active filter removes low-confidence Aktionsfinder ppcv offers without validity evidence', () => {
  const now = new Date('2026-05-21T13:00:00.000Z');
  const lowConfidencePpcv = offer({
    title: 'Goesser Maerzen SPAR 0.50 Liter 20 Stueck',
    status: 'active',
    isActiveNow: true,
    validTo: null,
    lastSeenAt: new Date('2026-05-21T08:00:00.000Z'),
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/ppcv/flaschenbier/spar/',
    rawFacts: {
      sourceType: 'aktionsfinder-json',
      clickoutUrl: 'https://www.aktionsfinder.at/ppcv/flaschenbier/spar/',
    },
  });
  const officialCurrent = offer({
    title: 'BILLA Snapshot aktuell',
    status: 'active',
    isActiveNow: true,
    validTo: null,
    lastSeenAt: new Date('2026-05-21T08:00:00.000Z'),
    sourceType: 'billa-official-algolia',
    rawFacts: { snapshotCurrent: true },
  });

  assert.deepEqual(
    filterFreshActiveOffers([lowConfidencePpcv, officialCurrent], now).map((item) => item.title),
    ['BILLA Snapshot aktuell']
  );
});

test('fresh active filter removes soft-deactivated replacement offers', () => {
  const inactiveOffer = offer({
    _id: 'source-replaced-offer',
    title: 'Kaffee 500 g',
    sourceType: 'spar-official-pdf',
    sourceUrl: 'https://flugblatt.spar.at/test/getPdf.ashx',
    status: 'inactive',
    isActiveNow: false,
    isActiveToday: false,
    deactivatedAt: new Date('2026-05-21T10:00:00.000Z'),
    deactivationReason: 'source-replacement-not-seen',
  });

  assert.deepEqual(filterFreshActiveOffers([inactiveOffer]), []);
});

test('fresh active filter keeps Aktionsfinder ppcv only when offer-level validity evidence exists', () => {
  const now = new Date('2026-05-21T13:00:00.000Z');
  const withValidity = offer({
    title: 'Aktionsfinder Angebot mit Detail-Gueltigkeit',
    status: 'active',
    isActiveNow: true,
    validTo: new Date('2026-05-27T23:59:59.999Z'),
    lastSeenAt: new Date('2026-05-21T08:00:00.000Z'),
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/ppcv/flaschenbier/spar/',
    rawFacts: {
      sourceType: 'aktionsfinder-json',
      validitySource: 'aktionsfinder-leaflet-range',
      leafletHref: 'https://www.aktionsfinder.at/l/spar-flugblatt-30-04-2026-27-05-2026/',
    },
  });

  assert.deepEqual(filterFreshActiveOffers([withValidity], now), [withValidity]);
});

test('fresh active filter allows fresh plausible Aktionsfinder ppcv without validTo', () => {
  const now = new Date('2026-05-21T13:00:00.000Z');
  const freshPpcv = offer({
    title: 'SPAR Bio Kaffee 500 g',
    status: 'active',
    isActiveNow: true,
    validTo: null,
    lastSeenAt: new Date('2026-05-21T08:00:00.000Z'),
    lastSeenRunId: 'crawl-spar-1',
    crawlJobId: 'crawl-spar-1',
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/ppcv/kaffee/spar/',
    rawFacts: {
      sourceType: 'aktionsfinder-json',
      clickoutUrl: 'https://www.aktionsfinder.at/ppcv/kaffee/spar/',
    },
    priceCurrent: { amount: 4.99 },
    quantityText: '500 g',
    unitValue: 500,
    unitType: 'g',
    comparableUnit: 'kg',
  });

  const quality = classifyOfferSourceQuality(freshPpcv);

  assert.equal(quality.sourceClass, 'aggregator-ppcv');
  assert.equal(quality.hasFreshCrawlEvidence, true);
  assert.equal(quality.validityConfidence, 'low');
  assert.equal(quality.freshnessConfidence, 'high');
  assert.equal(quality.sourceQualityRisk, '');
  assert.deepEqual(filterFreshActiveOffers([freshPpcv], now), [freshPpcv]);
  assert.equal(buildValidityLabel(freshPpcv), 'Aktuell gefunden - bitte im Markt pruefen.');
});

test('fresh active filter blocks Aktionsfinder ppcv without current crawl confirmation', () => {
  const now = new Date('2026-05-21T13:00:00.000Z');
  const stalePpcv = offer({
    title: 'SPAR Bio Kaffee 500 g',
    status: 'active',
    isActiveNow: true,
    validTo: null,
    lastSeenAt: new Date('2026-04-20T08:00:00.000Z'),
    lastSeenRunId: 'old-crawl',
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/ppcv/kaffee/spar/',
    rawFacts: {
      sourceType: 'aktionsfinder-json',
      clickoutUrl: 'https://www.aktionsfinder.at/ppcv/kaffee/spar/',
    },
    priceCurrent: { amount: 4.99 },
    quantityText: '500 g',
    comparableUnit: 'kg',
  });

  assert.deepEqual(filterFreshActiveOffers([stalePpcv], now), []);
});

test('fresh active filter keeps expired validTo blocked unless a newer successful crawl saw the offer again', () => {
  const now = new Date('2026-05-21T13:00:00.000Z');
  const expiredWithoutRecrawl = offer({
    title: 'SPAR Bio Kaffee 500 g',
    status: 'expired',
    isActiveNow: false,
    validTo: new Date('2026-05-10T23:59:59.999Z'),
    lastSeenAt: new Date('2026-05-10T08:00:00.000Z'),
    lastSeenRunId: 'old-crawl',
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/ppcv/kaffee/spar/',
    priceCurrent: { amount: 4.99 },
    quantityText: '500 g',
    comparableUnit: 'kg',
  });
  const recrawledAfterOldValidTo = {
    ...expiredWithoutRecrawl,
    lastSeenAt: new Date('2026-05-21T08:00:00.000Z'),
    lastSeenRunId: 'fresh-crawl',
    crawlJobId: 'fresh-crawl',
  };

  assert.deepEqual(filterFreshActiveOffers([expiredWithoutRecrawl], now), []);
  assert.deepEqual(filterFreshActiveOffers([recrawledAfterOldValidTo], now), [recrawledAfterOldValidTo]);
  assert.equal(buildValidityLabel(recrawledAfterOldValidTo), 'Aktuell gefunden - bitte im Markt pruefen.');
});

test('fresh active filter requires visible customer-program conditions for fresh ppcv offers', () => {
  const now = new Date('2026-05-21T13:00:00.000Z');
  const base = offer({
    title: 'SPAR Kaffee App Preis 500 g',
    status: 'active',
    isActiveNow: true,
    validTo: null,
    lastSeenAt: new Date('2026-05-21T08:00:00.000Z'),
    lastSeenRunId: 'fresh-crawl',
    crawlJobId: 'fresh-crawl',
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/ppcv/kaffee/spar/',
    rawFacts: {
      sourceType: 'aktionsfinder-json',
      clickoutUrl: 'https://www.aktionsfinder.at/ppcv/kaffee/spar/',
    },
    priceCurrent: { amount: 3.99 },
    quantityText: '500 g',
    comparableUnit: 'kg',
    customerProgramRequired: true,
  });
  const visibleCondition = { ...base, conditionsText: 'nur mit App' };
  const hiddenCondition = { ...base, conditionsText: '' };

  assert.deepEqual(filterFreshActiveOffers([visibleCondition], now), [visibleCondition]);
  assert.deepEqual(filterFreshActiveOffers([hiddenCondition], now), []);
});

test('response dedupe keeps priced aggregator when official duplicate has no usable price', () => {
  const aggregator = offer({
    _id: 'priced-aggregator',
    title: 'Bio Vollmilch 1 l',
    titleNormalized: 'bio vollmilch 1 l',
    retailerKey: 'billa',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 l',
    normalizedUnitPrice: { amount: 1.49, unit: 'l', comparable: true },
    dedupeKey: 'billa::bio-vollmilch::1l::same-upstream',
    validTo: null,
  });
  const officialMissingPrice = offer({
    ...aggregator,
    _id: 'official-without-price',
    sourceType: 'billa-official-algolia',
    priceCurrent: { amount: null },
    normalizedUnitPrice: { amount: null, unit: 'l', comparable: false },
  });
  const prepared = prepareQueryOffersForResponse([aggregator, officialMissingPrice], 'milch');

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]._id, 'priced-aggregator');
});

test('SPAR Aktionsfinder remains visible while no active official SPAR duplicate exists', () => {
  const aggregator = offer({
    _id: 'spar-aktionsfinder-visible',
    title: 'Bio Vollmilch 1 l',
    titleNormalized: 'bio vollmilch 1 l',
    retailerKey: 'spar',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 l',
    normalizedUnitPrice: { amount: 1.49, unit: 'l', comparable: true },
    validTo: null,
  });
  const prepared = prepareQueryOffersForResponse([aggregator], 'milch');

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]._id, 'spar-aktionsfinder-visible');
});

test('SPAR official PDF evidence does not suppress structured Aktionsfinder duplicate data', () => {
  const officialPdf = offer({
    _id: 'spar-official-pdf',
    title: 'Bio Vollmilch 1 l',
    titleNormalized: 'bio vollmilch 1 l',
    retailerKey: 'spar',
    sourceType: 'spar-official-pdf',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 l',
    normalizedUnitPrice: { amount: 1.49, unit: 'l', comparable: true },
    validFrom: null,
    validTo: null,
  });
  const aggregator = offer({
    ...officialPdf,
    _id: 'spar-aktionsfinder-json',
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/ppcv/milch/spar/',
    imageUrl: 'https://img.example.test/milch.jpg',
    validFrom: null,
    validTo: null,
    lastSeenAt: new Date('2026-05-21T08:00:00.000Z'),
    lastSeenRunId: 'spar-crawl',
    crawlJobId: 'spar-crawl',
  });
  const prepared = prepareQueryOffersForResponse([officialPdf, aggregator], 'milch');

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]._id, 'spar-aktionsfinder-json');
});

test('final response dedupe keeps the same offer id only once', () => {
  const duplicate = offer({
    _id: 'same-offer-id',
    title: 'Mango vorgereift',
    titleNormalized: 'mango vorgereift',
    retailerKey: 'penny',
    sourceType: 'penny-official-html',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 Stk',
    validFrom: new Date('2026-05-07T12:00:00Z'),
    validTo: new Date('2026-05-12T12:00:00Z'),
  });

  assert.equal(dedupeFinalResponseOffers([duplicate, { ...duplicate }], 'mango').length, 1);
});

test('final response dedupe keeps the same visible offer fingerprint only once', () => {
  const first = offer({
    _id: 'first-visible',
    title: 'Mango vorgereift',
    titleNormalized: 'mango vorgereift',
    retailerKey: 'penny',
    sourceType: 'penny-official-html',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 Stk',
    validFrom: new Date('2026-05-07T12:00:00Z'),
    validTo: new Date('2026-05-12T12:00:00Z'),
  });
  const second = offer({
    ...first,
    _id: 'second-visible',
  });

  const prepared = dedupeFinalResponseOffers([first, second], 'mango');

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]._id, 'first-visible');
});

test('final response dedupe collapses identical visible detergent fingerprints', () => {
  const first = offer({
    _id: 'somat-a',
    title: 'Somat Geschirrspuel-Tabs 55 Stk',
    titleNormalized: 'somat geschirrspuel tabs 55 stk',
    retailerKey: 'bipa',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 9.99 },
    quantityText: '55 Stk',
    unitValue: 55,
    unitType: 'stueck',
    totalComparableAmount: 55,
    comparableUnit: 'stueck',
    normalizedUnitPrice: { amount: 0.18, unit: 'Stk', comparable: true },
  });
  const second = offer({
    ...first,
    _id: 'somat-b',
    sourceUrl: 'https://example.test/other',
  });

  const prepared = dedupeFinalResponseOffers([first, second], 'waschmittel');

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]._id, 'somat-a');
});

test('final response dedupe keeps detergent price variants visible', () => {
  const base = {
    title: 'Coral Magic Wash Waschmittel Fluessig div. Sorten 21 WG BIPA 1 Flasche',
    titleNormalized: 'coral magic wash waschmittel fluessig div sorten 21 wg bipa 1 flasche',
    retailerKey: 'bipa',
    sourceType: 'aktionsfinder-json',
    quantityText: '1 flasche',
    unitValue: 1,
    unitType: 'stueck',
    totalComparableAmount: 1,
    comparableUnit: 'stueck',
    normalizedUnitPrice: { amount: 3.99, unit: 'Stk', comparable: true },
  };
  const prepared = dedupeFinalResponseOffers([
    offer({ ...base, _id: 'coral-399', priceCurrent: { amount: 3.99 } }),
    offer({ ...base, _id: 'coral-499', priceCurrent: { amount: 4.99 }, normalizedUnitPrice: { amount: 4.99, unit: 'Stk', comparable: true } }),
  ], 'waschmittel');

  assert.equal(prepared.length, 2);
});

test('final response dedupe keeps real quantity variants but tolerates broken display text with same structured quantity', () => {
  const goodQuantity = offer({
    _id: 'ariel-good-qty',
    title: 'Ariel Waschmittel Fluessig div. Sorten 40 WL dm 1 Flasche',
    titleNormalized: 'ariel waschmittel fluessig div sorten 40 wl dm 1 flasche',
    retailerKey: 'dm',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 11.65 },
    quantityText: '1 flasche',
    unitValue: 1,
    unitType: 'stueck',
    totalComparableAmount: 1,
    comparableUnit: 'stueck',
    normalizedUnitPrice: { amount: 11.65, unit: 'Stk', comparable: true },
  });
  const brokenQuantityText = offer({
    ...goodQuantity,
    _id: 'ariel-broken-qty',
    quantityText: '$undefined WG / 1 Fl.',
  });
  const realQuantityVariant = offer({
    ...goodQuantity,
    _id: 'ariel-two-bottles',
    quantityText: '2 flaschen',
    unitValue: 2,
    totalComparableAmount: 2,
  });

  const prepared = dedupeFinalResponseOffers([goodQuantity, brokenQuantityText, realQuantityVariant], 'waschmittel');

  assert.equal(prepared.length, 2);
  assert.deepEqual(new Set(prepared.map((item) => item._id)), new Set(['ariel-good-qty', 'ariel-two-bottles']));
});

test('final response dedupe treats common quantity abbreviations as cosmetic', () => {
  const longText = offer({
    _id: 'frosch-long',
    title: 'Frosch baby Vollwaschmittel fluessig 22 WL dm 1 Flasche',
    titleNormalized: 'frosch baby vollwaschmittel fluessig 22 wl dm 1 flasche',
    retailerKey: 'dm',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 6.35 },
    quantityText: '1 flasche',
    normalizedUnitPrice: { amount: 6.35, unit: 'Stk', comparable: true },
  });
  const shortText = offer({
    ...longText,
    _id: 'frosch-short',
    quantityText: '1 Fl.',
  });

  const prepared = dedupeFinalResponseOffers([longText, shortText], 'waschmittel');

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]._id, 'frosch-long');
});

test('final response dedupe keeps condition and retailer variants visible', () => {
  const base = {
    title: 'Dr Beckmann WC Reinigungs Blaetter 20 Stk',
    titleNormalized: 'dr beckmann wc reinigungs blaetter 20 stk',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 2.99 },
    quantityText: '20 Stk',
    unitValue: 20,
    unitType: 'stueck',
    totalComparableAmount: 20,
    comparableUnit: 'stueck',
    normalizedUnitPrice: { amount: 0.15, unit: 'Stk', comparable: true },
  };
  const prepared = dedupeFinalResponseOffers([
    offer({ ...base, _id: 'public-bipa', retailerKey: 'bipa' }),
    offer({ ...base, _id: 'app-bipa', retailerKey: 'bipa', customerProgramRequired: true, conditionsText: 'nur mit App' }),
    offer({ ...base, _id: 'public-dm', retailerKey: 'dm' }),
  ], 'waschmittel');

  assert.equal(prepared.length, 3);
});

test('final response dedupe prefers better source for true visible duplicate', () => {
  const aggregator = offer({
    _id: 'ariel-aggregator',
    title: 'Ariel Waschmittel Fluessig 40 WL',
    titleNormalized: 'ariel waschmittel fluessig 40 wl',
    retailerKey: 'billa',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 11.65 },
    quantityText: '1 flasche',
    unitValue: 1,
    unitType: 'stueck',
    totalComparableAmount: 1,
    comparableUnit: 'stueck',
    normalizedUnitPrice: { amount: 11.65, unit: 'Stk', comparable: true },
    validFrom: new Date('2026-05-01T00:00:00Z'),
    validTo: new Date('2026-05-12T00:00:00Z'),
  });
  const official = offer({
    ...aggregator,
    _id: 'ariel-official',
    sourceType: 'billa-official-algolia',
  });

  const prepared = dedupeFinalResponseOffers([aggregator, official], 'waschmittel');

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]._id, 'ariel-official');
});

test('final response dedupe keeps aggregator when no better source exists', () => {
  const aggregator = offer({
    _id: 'dr-beckmann-aggregator',
    title: 'Dr Beckmann WC Reinigungs Blaetter 20 Stk',
    titleNormalized: 'dr beckmann wc reinigungs blaetter 20 stk',
    retailerKey: 'bipa',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 2.99 },
    quantityText: '20 Stk',
    unitValue: 20,
    unitType: 'stueck',
    totalComparableAmount: 20,
    comparableUnit: 'stueck',
    normalizedUnitPrice: { amount: 0.15, unit: 'Stk', comparable: true },
  });

  const prepared = dedupeFinalResponseOffers([aggregator], 'waschmittel');

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]._id, 'dr-beckmann-aggregator');
});

test('final response dedupe removes repeated q=mango PENNY Mango vorgereift result', () => {
  const mango = offer({
    _id: 'mango-vorgereift-a',
    title: 'Mango vorgereift',
    titleNormalized: 'mango vorgereift',
    retailerKey: 'penny',
    sourceType: 'penny-official-html',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 Stk',
    validFrom: new Date('2026-05-07T12:00:00Z'),
    validTo: new Date('2026-05-12T12:00:00Z'),
  });
  const prepared = dedupeFinalResponseOffers([
    mango,
    { ...mango, _id: 'mango-vorgereift-b' },
  ], 'mango');

  assert.equal(prepared.filter((item) => item.title === 'Mango vorgereift').length, 1);
});

test('final response dedupe removes repeated q=mango PENNY Schaumbecher result', () => {
  const dessert = offer({
    _id: 'schaumbecher-a',
    title: 'Schaumbecher mit Mango Geschmack Penny 150 Gramm 1 Stück',
    titleNormalized: 'schaumbecher mit mango geschmack penny 150 gramm 1 stueck',
    retailerKey: 'penny',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 0.79 },
    quantityText: '150 g',
    validFrom: new Date('2026-05-07T12:00:00Z'),
    validTo: new Date('2026-05-12T12:00:00Z'),
  });
  const prepared = dedupeFinalResponseOffers([
    dessert,
    { ...dessert, _id: 'schaumbecher-b' },
  ], 'mango');

  assert.equal(
    prepared.filter((item) => item.title === 'Schaumbecher mit Mango Geschmack Penny 150 Gramm 1 Stück').length,
    1
  );
});

test('final response dedupe keeps Mango vorgereift and Mango Schaumbecher separate', () => {
  const fruit = offer({
    _id: 'mango-fruit-final',
    title: 'Mango vorgereift',
    titleNormalized: 'mango vorgereift',
    retailerKey: 'penny',
    sourceType: 'penny-official-html',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 Stk',
    validTo: new Date('2026-05-12T12:00:00Z'),
  });
  const dessert = offer({
    _id: 'mango-dessert-final',
    title: 'Schaumbecher mit Mango Geschmack Penny 150 Gramm 1 Stück',
    titleNormalized: 'schaumbecher mit mango geschmack penny 150 gramm 1 stueck',
    retailerKey: 'penny',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 0.79 },
    quantityText: '150 g',
    validTo: new Date('2026-05-12T12:00:00Z'),
  });
  const prepared = dedupeFinalResponseOffers([fruit, dessert], 'mango');

  assert.equal(prepared.length, 2);
  assert.deepEqual(new Set(prepared.map((item) => item._id)), new Set(['mango-fruit-final', 'mango-dessert-final']));
});

test('final response dedupe keeps different retailers variants quantities and conditions visible', () => {
  const base = {
    title: 'Mango vorgereift',
    titleNormalized: 'mango vorgereift',
    sourceType: 'penny-official-html',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 Stk',
    validTo: new Date('2026-05-12T12:00:00Z'),
  };
  const offers = [
    offer({ ...base, _id: 'penny-mango', retailerKey: 'penny' }),
    offer({ ...base, _id: 'billa-mango', retailerKey: 'billa' }),
    offer({ ...base, _id: 'penny-two-pack', retailerKey: 'penny', quantityText: '2 Stk' }),
    offer({ ...base, _id: 'penny-app', retailerKey: 'penny', customerProgramRequired: true, conditionsText: 'nur mit App' }),
    offer({ ...base, _id: 'penny-brand', retailerKey: 'penny', brand: 'Biohof' }),
  ];

  assert.equal(dedupeFinalResponseOffers(offers, 'mango').length, 5);
});

test('visible card dedupe collapses dm Dr Beckmann identical card duplicates', () => {
  const base = offer({
    _id: 'dr-beckmann-a',
    title: 'Dr. Beckmann Aufhelltuecher Aktiv-Weiss 3 in 1 15 Stueck',
    titleNormalized: 'dr beckmann aufhelltuecher aktiv weiss 3 in 1 15 stueck',
    retailerKey: 'dm',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 3.25 },
    quantityText: '15 Stueck',
    unitValue: 15,
    unitType: 'stueck',
    totalComparableAmount: 15,
    comparableUnit: 'stueck',
    normalizedUnitPrice: { amount: 0.2167, unit: 'Stk', comparable: true },
    validFrom: new Date('2026-05-01T00:00:00Z'),
    validTo: new Date('2026-05-12T00:00:00Z'),
  });

  const result = dedupeVisibleCardResponseOffers([base, { ...base, _id: 'dr-beckmann-b', sourceType: 'wogibtswas-html' }], 'waschmittel');

  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0]._id, 'dr-beckmann-a');
});

test('visible card dedupe collapses dm Somat Excellence identical card duplicates', () => {
  const base = offer({
    _id: 'somat-excellence-a',
    title: 'Somat Excellence Premium Geschirrspuel-Tabs 5 in 1 36 Stueck',
    titleNormalized: 'somat excellence premium geschirrspuel tabs 5 in 1 36 stueck',
    retailerKey: 'dm',
    sourceType: 'wogibtswas-html',
    priceCurrent: { amount: 9.35 },
    quantityText: '36 Stueck',
    unitValue: 36,
    unitType: 'stueck',
    totalComparableAmount: 36,
    comparableUnit: 'stueck',
    normalizedUnitPrice: { amount: 0.2597, unit: 'Stk', comparable: true },
    validFrom: new Date('2026-05-01T00:00:00Z'),
    validTo: new Date('2026-05-12T00:00:00Z'),
  });

  const result = dedupeVisibleCardResponseOffers([{ ...base, _id: 'somat-excellence-b' }, base], 'waschmittel');

  assert.equal(result.offers.length, 1);
});

test('visible card dedupe collapses dm Profissimo Schmutzradierer identical card duplicates', () => {
  const base = offer({
    _id: 'profissimo-a',
    title: 'Profissimo Schmutzradierer 6 Stueck',
    titleNormalized: 'profissimo schmutzradierer 6 stueck',
    retailerKey: 'dm',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 2.55 },
    quantityText: '6 Stueck',
    unitValue: 6,
    unitType: 'stueck',
    totalComparableAmount: 6,
    comparableUnit: 'stueck',
    normalizedUnitPrice: { amount: 0.425, unit: 'Stk', comparable: true },
    validFrom: new Date('2026-05-01T00:00:00Z'),
    validTo: new Date('2026-05-12T00:00:00Z'),
  });

  const result = dedupeVisibleCardResponseOffers([base, { ...base, _id: 'profissimo-b' }], 'waschmittel');

  assert.equal(result.offers.length, 1);
});

test('visible card dedupe keeps Coral and Ariel price variants visible', () => {
  const coral = {
    title: 'Coral Magic Wash Waschmittel Fluessig 21 WG BIPA 1 Flasche',
    titleNormalized: 'coral magic wash waschmittel fluessig 21 wg bipa 1 flasche',
    retailerKey: 'bipa',
    quantityText: '1 Flasche',
    unitValue: 1,
    unitType: 'stueck',
    totalComparableAmount: 1,
    comparableUnit: 'stueck',
  };
  const ariel = {
    title: 'Ariel Waschmittel Pods 54 WG BIPA 1 Packung',
    titleNormalized: 'ariel waschmittel pods 54 wg bipa 1 packung',
    retailerKey: 'bipa',
    quantityText: '1 Packung',
    unitValue: 1,
    unitType: 'stueck',
    totalComparableAmount: 1,
    comparableUnit: 'stueck',
  };
  const result = dedupeVisibleCardResponseOffers([
    offer({ ...coral, _id: 'coral-399', priceCurrent: { amount: 3.99 } }),
    offer({ ...coral, _id: 'coral-499', priceCurrent: { amount: 4.99 } }),
    offer({ ...ariel, _id: 'ariel-1899', priceCurrent: { amount: 18.99 } }),
    offer({ ...ariel, _id: 'ariel-1999', priceCurrent: { amount: 19.99 } }),
  ], 'waschmittel');

  assert.deepEqual(new Set(result.offers.map((item) => item._id)), new Set([
    'coral-399',
    'coral-499',
    'ariel-1899',
    'ariel-1999',
  ]));
});

test('visible card dedupe keeps condition retailer validity and customer-program variants visible', () => {
  const base = {
    title: 'Somat Excellence Premium Geschirrspuel-Tabs 5 in 1 36 Stueck',
    titleNormalized: 'somat excellence premium geschirrspuel tabs 5 in 1 36 stueck',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 9.35 },
    quantityText: '36 Stueck',
    unitValue: 36,
    unitType: 'stueck',
    totalComparableAmount: 36,
    comparableUnit: 'stueck',
    validFrom: new Date('2026-05-01T00:00:00Z'),
    validTo: new Date('2026-05-12T00:00:00Z'),
  };
  const result = dedupeVisibleCardResponseOffers([
    offer({ ...base, _id: 'dm-public', retailerKey: 'dm' }),
    offer({ ...base, _id: 'bipa-public', retailerKey: 'bipa' }),
    offer({ ...base, _id: 'dm-app', retailerKey: 'dm', customerProgramRequired: true, conditionsText: 'nur mit App' }),
    offer({ ...base, _id: 'dm-discount', retailerKey: 'dm', conditionsText: 'ab 2 Packungen' }),
    offer({ ...base, _id: 'dm-other-validity', retailerKey: 'dm', validTo: new Date('2026-05-19T00:00:00Z') }),
  ], 'waschmittel');

  assert.equal(result.offers.length, 5);
});

test('visible card dedupe only tolerates broken quantity text when structured quantity safely matches', () => {
  const base = {
    title: 'Profissimo Schmutzradierer 6 Stueck',
    titleNormalized: 'profissimo schmutzradierer 6 stueck',
    retailerKey: 'dm',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 2.55 },
    normalizedUnitPrice: { amount: 0.425, unit: 'Stk', comparable: true },
    validFrom: new Date('2026-05-01T00:00:00Z'),
    validTo: new Date('2026-05-12T00:00:00Z'),
  };
  const safeResult = dedupeVisibleCardResponseOffers([
    offer({ ...base, _id: 'good', quantityText: '6 Stueck', unitValue: 6, unitType: 'stueck', totalComparableAmount: 6, comparableUnit: 'stueck' }),
    offer({ ...base, _id: 'broken', quantityText: '$undefined Stk', unitValue: 6, unitType: 'stueck', totalComparableAmount: 6, comparableUnit: 'stueck' }),
  ], 'waschmittel');
  const unsafeResult = dedupeVisibleCardResponseOffers([
    offer({ ...base, _id: 'good-text-only', quantityText: '6 Stueck' }),
    offer({ ...base, _id: 'broken-text-only', quantityText: '$undefined Stk' }),
  ], 'waschmittel');

  assert.equal(safeResult.offers.length, 1);
  assert.equal(unsafeResult.offers.length, 2);
});

[
  ['billa', 'billa-official-algolia'],
  ['billa-plus', 'billa-official-algolia'],
  ['lidl', 'lidl-official-flyer-api'],
  ['penny', 'penny-official-html'],
  ['dm', 'dm-official-html'],
  ['bipa', 'bipa-official-html'],
  ['spar', 'spar-official-html'],
  ['eurospar', 'spar-official-html'],
  ['interspar', 'official-action'],
  ['hofer', 'hofer-official-html'],
].forEach(([retailerKey, officialSourceType]) => {
  test(`prefers ${retailerKey} official response duplicate over aggregator with clearer validity`, () => {
    const official = offer({
      _id: `${retailerKey}-official`,
      title: 'Bio Vollmilch 1 l',
      titleNormalized: 'bio vollmilch 1 l',
      retailerKey,
      sourceType: officialSourceType,
      priceCurrent: { amount: 1.49 },
      quantityText: '1 l',
      normalizedUnitPrice: { amount: 1.49, unit: 'l', comparable: true },
      validFrom: null,
      validTo: null,
    });
    const aggregator = offer({
      ...official,
      _id: `${retailerKey}-aktionsfinder`,
      sourceType: 'aktionsfinder-json',
      validFrom: new Date('2026-05-07T12:00:00Z'),
      validTo: new Date('2026-05-12T12:00:00Z'),
    });
    const prepared = prepareQueryOffersForResponse([aggregator, official], 'milch');

    assert.equal(prepared.length, 1);
    assert.equal(prepared[0]._id, `${retailerKey}-official`);
  });
});

test('keeps response variants with different scope or condition visible', () => {
  const base = {
    title: 'Bio Vollmilch 1 l',
    titleNormalized: 'bio vollmilch 1 l',
    retailerKey: 'spar',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 l',
    normalizedUnitPrice: { amount: 1.49, unit: 'l', comparable: true },
  };
  const sparOnly = offer({
    ...base,
    _id: 'spar-only',
    sourceType: 'spar-official-html',
    sourceRetailerFormat: 'spar',
    appliesToRetailerFormats: ['spar'],
    retailerFormatLabel: 'nur SPAR',
  });
  const intersparOnly = offer({
    ...base,
    _id: 'interspar-only',
    sourceType: 'aktionsfinder-json',
    sourceRetailerFormat: 'interspar',
    appliesToRetailerFormats: ['interspar'],
    retailerFormatLabel: 'nur INTERSPAR',
  });
  const appOnly = offer({
    ...base,
    _id: 'app-only',
    sourceType: 'aktionsfinder-json',
    customerProgramRequired: true,
    conditionsText: 'nur mit App',
  });
  const publicOffer = offer({
    ...base,
    _id: 'public',
    sourceType: 'aktionsfinder-json',
  });
  const prepared = prepareQueryOffersForResponse([sparOnly, intersparOnly, appOnly, publicOffer], 'milch');

  assert.equal(prepared.length, 4);
  assert.deepEqual(new Set(prepared.map((item) => item._id)), new Set([
    'spar-only',
    'interspar-only',
    'app-only',
    'public',
  ]));
});

test('validity label includes concrete date when validTo is present', () => {
  assert.equal(
    buildValidityLabel({
      validFrom: new Date('2026-05-07T12:00:00Z'),
      validTo: new Date('2026-05-12T12:00:00Z'),
    }),
    'gueltig 2026-05-07 bis 2026-05-12'
  );
  assert.equal(
    buildValidityLabel({
      validTo: new Date('2026-05-12T12:00:00Z'),
    }),
    'gueltig bis 2026-05-12'
  );
});

test('paginates visible ranking offers by limit and offset without overlap', () => {
  const visibleOffers = Array.from({ length: 125 }, (_, index) => ({ _id: `offer-${index}` }));
  const firstPage = paginateVisibleRankingOffers(visibleOffers, { limit: 60, offset: 0 });
  const secondPage = paginateVisibleRankingOffers(visibleOffers, { limit: 60, offset: 60 });
  const finalPage = paginateVisibleRankingOffers(visibleOffers, { limit: 60, offset: 120 });

  assert.equal(firstPage.offers.length, 60);
  assert.equal(firstPage.totalCount, 125);
  assert.equal(firstPage.offset, 0);
  assert.equal(firstPage.limit, 60);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextOffset, 60);

  assert.equal(secondPage.offers.length, 60);
  assert.equal(secondPage.hasMore, true);
  assert.equal(secondPage.nextOffset, 120);

  const firstIds = new Set(firstPage.offers.map((item) => item._id));
  const secondIds = new Set(secondPage.offers.map((item) => item._id));
  assert.equal([...firstIds].some((id) => secondIds.has(id)), false);

  assert.equal(finalPage.offers.length, 5);
  assert.equal(finalPage.hasMore, false);
  assert.equal(finalPage.nextOffset, null);
});

test('ranking pagination defaults offset to zero for backwards compatibility', () => {
  const visibleOffers = Array.from({ length: 80 }, (_, index) => ({ _id: `offer-${index}` }));
  const page = paginateVisibleRankingOffers(visibleOffers, { limit: 60 });

  assert.equal(page.offset, 0);
  assert.deepEqual(
    page.offers.map((item) => item._id),
    visibleOffers.slice(0, 60).map((item) => item._id)
  );
  assert.equal(page.hasMore, true);
  assert.equal(page.nextOffset, 60);
});

test('ranking base cache key ignores pagination and separates ranking filters', () => {
  const firstPageKey = buildRankingBaseCacheKey({
    query: 'Waschmittel',
    retailers: 'dm,bipa',
    categories: ['Drogerie / Hygiene'],
    programRetailers: 'bipa,dm',
    unit: 'Stk',
    limit: 60,
    offset: 0,
  });
  const secondPageKey = buildRankingBaseCacheKey({
    query: 'waschmittel',
    retailers: 'bipa,dm',
    categories: ['Drogerie / Hygiene'],
    programRetailers: 'dm,bipa',
    unit: 'stk',
    limit: 60,
    offset: 60,
  });

  assert.equal(firstPageKey, secondPageKey);
  assert.notEqual(firstPageKey, buildRankingBaseCacheKey({ query: 'kaffee', retailers: 'dm,bipa', categories: ['Drogerie / Hygiene'], programRetailers: 'bipa,dm', unit: 'Stk' }));
  assert.notEqual(firstPageKey, buildRankingBaseCacheKey({ query: 'waschmittel', retailers: 'dm', categories: ['Drogerie / Hygiene'], programRetailers: 'bipa,dm', unit: 'Stk' }));
  assert.notEqual(firstPageKey, buildRankingBaseCacheKey({ query: 'waschmittel', retailers: 'dm,bipa', categories: ['Haushalt'], programRetailers: 'bipa,dm', unit: 'Stk' }));
  assert.notEqual(firstPageKey, buildRankingBaseCacheKey({ query: 'waschmittel', retailers: 'dm,bipa', categories: ['Drogerie / Hygiene'], programRetailers: 'dm', unit: 'Stk' }));
  assert.notEqual(firstPageKey, buildRankingBaseCacheKey({ query: 'waschmittel', retailers: 'dm,bipa', categories: ['Drogerie / Hygiene'], programRetailers: 'bipa,dm', unit: 'kg' }));
  assert.notEqual(firstPageKey, buildRankingBaseCacheKey({ query: 'waschmittel', retailers: 'dm,bipa', categories: ['Drogerie / Hygiene'], programRetailers: 'bipa,dm', unit: 'Stk', onlyWithoutProgram: true }));
});

test('ranking result cache token is opaque and cache key hash is stable', () => {
  const cacheKey = buildRankingBaseCacheKey({
    query: 'Waschmittel',
    retailers: 'dm,bipa',
    categories: ['Drogerie / Hygiene'],
    programRetailers: 'bipa,dm',
    unit: 'Stk',
  });
  const sameCacheKey = buildRankingBaseCacheKey({
    query: 'waschmittel',
    retailers: 'bipa,dm',
    categories: ['Drogerie / Hygiene'],
    programRetailers: 'dm,bipa',
    unit: 'stk',
    limit: 60,
    offset: 60,
  });
  const token = createResultSetToken();

  assert.equal(hashRankingCacheKey(cacheKey), hashRankingCacheKey(sameCacheKey));
  assert.match(hashRankingCacheKey(cacheKey), /^[a-f0-9]{32}$/);
  assert.match(token, /^[A-Za-z0-9_-]{20,80}$/);
  assert.equal(token.includes('Waschmittel'), false);
});

test('ranking cache capabilities expose token resultset support without secrets', () => {
  assert.deepEqual(getRankingCacheCapabilities(), {
    schemaVersion: 'ranking-cache-v8-source-quality-fresh-crawl-v1-search-token-v2-pet-food-lip-butter-v2-beer-context-v1-cat-food-v1-multiterm-v1-condition-merge-v1',
    resultSetTokens: true,
    mongoBackedResultSets: true,
    resultSetTtlSeconds: 300,
  });
});

test('ranking response base slices cache hits without changing order or overlap', () => {
  const visibleOffers = Array.from({ length: 125 }, (_, index) => offer({
    _id: `offer-${index}`,
    title: `Waschmittel ${index}`,
    retailerKey: index % 2 ? 'bipa' : 'dm',
    retailerName: index % 2 ? 'BIPA' : 'dm',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Waschmittel',
    priceCurrent: { amount: 1 + index / 100, currency: 'EUR' },
    normalizedUnitPrice: { amount: 1 + index / 100, unit: 'Stk', comparable: true },
    quality: { comparisonSafe: true },
  }));
  const base = {
    categoryDocuments: [],
    retailerOptions: [
      { retailerKey: 'dm', retailerName: 'dm', activeOfferCount: 70 },
      { retailerKey: 'bipa', retailerName: 'BIPA', activeOfferCount: 55 },
    ],
    units: ['Stk'],
    candidateCount: 140,
    candidateLimit: 1000,
    resultCount: 130,
    visibleOffers,
  };
  const firstPage = buildRankingResponseFromBase({
    base,
    query: 'waschmittel',
    unit: 'all',
    selectedCategories: [],
    selectedRetailers: ['dm', 'bipa'],
    selectedProgramRetailers: ['dm', 'bipa'],
    safeLimit: 60,
    safeOffset: 0,
  });
  const secondPage = buildRankingResponseFromBase({
    base,
    query: 'waschmittel',
    unit: 'all',
    selectedCategories: [],
    selectedRetailers: ['dm', 'bipa'],
    selectedProgramRetailers: ['dm', 'bipa'],
    safeLimit: 60,
    safeOffset: 60,
  });
  const firstIds = firstPage.rankedOffers.map((item) => item.id);
  const secondIds = secondPage.rankedOffers.map((item) => item.id);

  assert.deepEqual(firstIds, visibleOffers.slice(0, 60).map((item) => item._id));
  assert.deepEqual(secondIds, visibleOffers.slice(60, 120).map((item) => item._id));
  assert.equal(firstIds.some((id) => secondIds.includes(id)), false);
  assert.equal(firstPage.summary.hasMore, true);
  assert.equal(firstPage.summary.nextOffset, 60);
  assert.equal(secondPage.summary.hasMore, true);
  assert.equal(secondPage.summary.nextOffset, 120);
  assert.equal(firstPage.rankedOffers[0].title, 'Waschmittel 0');
  assert.equal(secondPage.rankedOffers[0].title, 'Waschmittel 60');
});
