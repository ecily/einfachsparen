const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyProgramEligibility,
  applyQueryMatch,
  buildRankingCandidateLimit,
  buildRankingCandidateFallbackMatch,
  buildRankingCandidateMatch,
  buildSparConditionSupplementalCandidateMatch,
  buildSparOfficialProductSupplementalCandidateMatch,
  buildRetailerScopeMatch,
  buildRankedOffer,
  buildSafeMarketComparisonAlternative,
  buildValidityLabel,
  buildGroupedRankings,
  buildKnownCategoryLabelMap,
  buildRankingBaseCacheKey,
  calculateOfferTermCoverage,
  compareOffersByRanking,
  canOfferSafeMarketComparison,
  createResultSetToken,
  dedupeFinalResponseOffers,
  dedupeQueryOffers,
  dedupeResponseOffers,
  dedupeVisibleCardResponseOffers,
  mergeSparConditionEvidenceIntoOffers,
  canMergeConditionEvidence,
  filterExpiredDateBoundConditionFragments,
  buildRankingCandidateQueryMetadata,
  hashRankingCacheKey,
  hasSparConditionQueryIntent,
  buildRankingResponseFromBase,
  filterFreshActiveOffers,
  getRankingCacheCapabilities,
  mergeCandidateOffers,
  normalizeSearchText,
  normalizeRetailerList,
  shouldLoadSparOfficialProductSupplementalCandidates,
  shouldLoadSparConditionSupplementalCandidates,
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
  assert.equal(normalizeSearchText('Proven\u00e7ale'), normalizeSearchText('Provencale'));
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
  assert.equal(match.crawlRunId, undefined);
  assert.equal(match.publishStatus, undefined);
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

test('ranking candidate query expands salad compounds and austrian potato aliases', () => {
  const salatMetadata = buildRankingCandidateQueryMetadata({ query: 'salat' });
  const kartoffelMetadata = buildRankingCandidateQueryMetadata({ query: 'kartoffel' });
  const erdaepfelMetadata = buildRankingCandidateQueryMetadata({ query: 'erd\u00e4pfel' });
  const paradeiserMetadata = buildRankingCandidateQueryMetadata({ query: 'paradeiser' });

  for (const token of ['salat', 'salatherzen', 'kopfsalat', 'eisbergsalat', 'salatgurke']) {
    assert.equal(salatMetadata.queryTokens.includes(token), true);
  }

  for (const metadata of [kartoffelMetadata, erdaepfelMetadata]) {
    for (const token of ['kartoffel', 'kartoffeln', 'erdapfel', 'erdaepfel', 'grillerdaepfel']) {
      assert.equal(metadata.queryTokens.includes(token), true);
    }
  }

  assert.equal(salatMetadata.candidateQueryMode, 'searchTokensOnly');
  assert.equal(kartoffelMetadata.candidateQueryMode, 'searchTokensOnly');
  assert.equal(erdaepfelMetadata.candidateQueryMode, 'searchTokensOnly');
  assert.equal(paradeiserMetadata.queryTokens.includes('tomaten'), true);
  assert.equal(paradeiserMetadata.candidateQueryMode, 'searchTokensOnly');
});

test('query scoring matches salad compounds and potato erdapfel aliases', () => {
  const saladOffers = [
    offer({ title: 'Salatherzen', categoryPrimary: 'Lebensmittel', categorySecondary: 'Obst & Gemuese' }),
    offer({ title: 'Kopfsalat', categoryPrimary: 'Lebensmittel', categorySecondary: 'Obst & Gemuese' }),
    offer({ title: 'Salatgurke', categoryPrimary: 'Lebensmittel', categorySecondary: 'Obst & Gemuese' }),
  ];
  const potatoOffers = [
    offer({ title: 'Ofen-/Grillerd\u00e4pfel', categoryPrimary: 'Lebensmittel', categorySecondary: 'Obst & Gemuese' }),
    offer({ title: 'Kartoffelp\u00fcree', categoryPrimary: 'Lebensmittel', categorySecondary: 'Trockensortiment' }),
  ];

  assert.deepEqual(new Set(applyQueryMatch(saladOffers, 'salat').map((item) => item.title)), new Set([
    'Salatherzen',
    'Kopfsalat',
    'Salatgurke',
  ]));
  assert.deepEqual(applyQueryMatch(potatoOffers, 'kartoffel').map((item) => item.title), [
    'Ofen-/Grillerd\u00e4pfel',
    'Kartoffelp\u00fcree',
  ]);
  assert.deepEqual(applyQueryMatch(potatoOffers, 'erd\u00e4pfel').map((item) => item.title), [
    'Ofen-/Grillerd\u00e4pfel',
    'Kartoffelp\u00fcree',
  ]);
});

test('query scoring matches austrian food aliases bidirectionally', () => {
  const offers = [
    offer({ title: 'Paradeiser', categoryPrimary: 'Lebensmittel', categorySecondary: 'Obst & Gemuese' }),
    offer({ title: 'Tomaten', categoryPrimary: 'Lebensmittel', categorySecondary: 'Obst & Gemuese' }),
    offer({ title: 'Marillen', categoryPrimary: 'Lebensmittel', categorySecondary: 'Obst & Gemuese' }),
    offer({ title: 'Aprikosen', categoryPrimary: 'Lebensmittel', categorySecondary: 'Obst & Gemuese' }),
    offer({ title: 'Karfiol', categoryPrimary: 'Lebensmittel', categorySecondary: 'Obst & Gemuese' }),
    offer({ title: 'Blumenkohl', categoryPrimary: 'Lebensmittel', categorySecondary: 'Obst & Gemuese' }),
    offer({ title: 'Topfen', categoryPrimary: 'Lebensmittel', categorySecondary: 'Milchprodukte' }),
    offer({ title: 'Quark', categoryPrimary: 'Lebensmittel', categorySecondary: 'Milchprodukte' }),
  ];

  assert.equal(applyQueryMatch(offers, 'tomate').some((item) => item.title === 'Paradeiser'), true);
  assert.equal(applyQueryMatch(offers, 'tomaten').some((item) => item.title === 'Paradeiser'), true);
  assert.equal(applyQueryMatch(offers, 'paradeiser').some((item) => item.title === 'Tomaten'), true);
  assert.equal(applyQueryMatch(offers, 'marille').some((item) => item.title === 'Aprikosen'), true);
  assert.equal(applyQueryMatch(offers, 'aprikose').some((item) => item.title === 'Marillen'), true);
  assert.equal(applyQueryMatch(offers, 'karfiol').some((item) => item.title === 'Blumenkohl'), true);
  assert.equal(applyQueryMatch(offers, 'blumenkohl').some((item) => item.title === 'Karfiol'), true);
  assert.equal(applyQueryMatch(offers, 'topfen').some((item) => item.title === 'Quark'), true);
  assert.equal(applyQueryMatch(offers, 'quark').some((item) => item.title === 'Topfen'), true);
});

test('query scoring keeps original austrian food terms ahead of alias-only hits', () => {
  const offers = [
    offer({ title: 'Paradeiser', categoryPrimary: 'Lebensmittel', categorySecondary: 'Obst & Gemuese' }),
    offer({ title: 'Tomaten', categoryPrimary: 'Lebensmittel', categorySecondary: 'Obst & Gemuese' }),
  ];

  assert.equal(applyQueryMatch(offers, 'tomate')[0].title, 'Tomaten');
  assert.equal(applyQueryMatch(offers, 'paradeiser')[0].title, 'Paradeiser');
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

test('condition query scoring ranks SPAR PDF 1+1 condition above generic SPAR hits', () => {
  const generic = sparOffer({
    _id: 'generic-spar',
    title: 'SPAR Markenartikel Aktion',
    brand: '',
    categorySecondary: 'Lebensmittel',
    categoryKey: 'lebensmittel',
    searchText: 'spar angebot aktion',
    conditionsText: '',
    hasConditions: false,
    sourceType: 'aktionsfinder-json',
  });
  const pdf = sparPdfOffer({
    _id: 'pdf-puntigamer',
    title: 'Puntigamer Maerzen',
    brand: 'Puntigamer',
    quantityText: 'Kiste, 0.5 l Flaschen',
    conditionsText: '1+1 gratis / 1 Kiste 29,80 / ab 2 Kisten je 14,90',
    hasConditions: true,
    isMultiBuy: true,
    minimumPurchaseQty: 2,
    sourceType: 'spar-official-pdf',
    rawFacts: { sourceKey: 'spar-official-flyer-pdf' },
  });

  assert.deepEqual(applyQueryMatch([generic, pdf], 'spar 1+1').map((item) => item._id), [
    'pdf-puntigamer',
    'generic-spar',
  ]);
  assert.equal(scoreOfferAgainstQuery(pdf, '1+1 gratis') > scoreOfferAgainstQuery(generic, '1+1 gratis'), true);
});

test('condition query scoring ranks SPAR beer crate context above generic SPAR hits', () => {
  const generic = sparOffer({
    _id: 'generic-spar-kiste',
    title: 'SPAR Haushaltsbox Aktion',
    brand: '',
    categorySecondary: 'Haushalt',
    categoryKey: 'haushalt',
    quantityText: '1 Kiste',
    searchText: 'spar kiste haushalt',
    conditionsText: '',
    hasConditions: false,
    sourceType: 'aktionsfinder-json',
  });
  const pdf = sparPdfOffer({
    _id: 'pdf-puntigamer-kiste',
    title: 'Puntigamer Maerzen',
    brand: 'Puntigamer',
    quantityText: '20 x 0.5 l',
    conditionsText: '1+1 gratis / 1 Kiste 29,80 / ab 2 Kisten je 14,90',
    searchText: 'puntigamer maerzen bier kiste 20 x 0.5 l spar',
    sourceType: 'spar-official-pdf',
    rawFacts: { sourceKey: 'spar-official-flyer-pdf' },
  });

  assert.deepEqual(applyQueryMatch([generic, pdf], 'spar kiste').map((item) => item._id), [
    'pdf-puntigamer-kiste',
    'generic-spar-kiste',
  ]);
});

function genericSparCandidate(index, overrides = {}) {
  return sparOffer({
    _id: `generic-spar-${index}`,
    title: `SPAR Markenartikel Aktion ${index}`,
    brand: '',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Unkategorisiert',
    categoryKey: 'unkategorisiert',
    searchText: `spar angebot aktion ${index}`,
    conditionsText: '',
    hasConditions: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    sourceType: 'aktionsfinder-json',
    sortScoreDefault: 250 - index,
    ...overrides,
  });
}

function assertSupplementRanksTopTen(query, genericOverrides, pdfOverrides) {
  const primary = Array.from({ length: 220 }, (_, index) => genericSparCandidate(index, genericOverrides)).slice(0, 200);
  const pdf = sparPdfOffer({
    _id: `pdf-${query.replace(/[^a-z0-9]+/gi, '-')}`,
    title: 'Puntigamer Maerzen',
    brand: 'Puntigamer',
    quantityText: '20 x 0.5 l',
    searchText: 'spar puntigamer maerzen bier kiste 20 x 0.5 l',
    searchTokens: ['bier', 'kiste', 'puntigamer', 'spar'],
    searchTokenVersion: 2,
    priceCurrent: { amount: 14.90, currency: 'EUR' },
    normalizedUnitPrice: { amount: 1.49, unit: 'l', comparable: true, confidence: 0.9 },
    conditionsText: '1+1 gratis / 1 Kiste 29,80 / ab 2 Kisten je 14,90 / Keine weiteren Rabatte / Joker moeglich',
    hasConditions: true,
    isMultiBuy: true,
    minimumPurchaseQty: 2,
    sourceType: 'spar-official-pdf',
    rawFacts: { sourceKey: 'spar-official-flyer-pdf' },
    ...pdfOverrides,
  });

  assert.equal(primary.some((item) => item._id === pdf._id), false);

  const withoutSupplement = applyQueryMatch(primary, query);
  assert.equal(withoutSupplement.some((item) => item._id === pdf._id), false);

  const merged = mergeCandidateOffers(primary, [pdf]);
  const ranked = applyQueryMatch(merged, query);

  assert.equal(merged.some((item) => item._id === pdf._id), true);
  assert.equal(ranked.slice(0, 10).some((item) => item._id === pdf._id), true);
  assert.equal(ranked[0]._id, pdf._id);
}

test('SPAR condition supplemental query activates only for SPAR-family condition intent', () => {
  assert.equal(hasSparConditionQueryIntent('spar 1+1'), true);
  assert.equal(hasSparConditionQueryIntent('spar kiste'), true);
  assert.equal(hasSparConditionQueryIntent('spar ab 2 kisten'), true);
  assert.equal(hasSparConditionQueryIntent('spar kaffee'), false);

  assert.equal(shouldLoadSparConditionSupplementalCandidates({ query: 'spar 1+1' }), true);
  assert.equal(shouldLoadSparConditionSupplementalCandidates({ query: 'spar kiste' }), true);
  assert.equal(shouldLoadSparConditionSupplementalCandidates({ query: 'interspar joker' }), true);
  assert.equal(shouldLoadSparConditionSupplementalCandidates({ query: 'eurospar ab 6' }), true);
  assert.equal(shouldLoadSparConditionSupplementalCandidates({ query: '1+1 gratis' }), false);
  assert.equal(shouldLoadSparConditionSupplementalCandidates({ query: 'kiste' }), false);
  assert.equal(shouldLoadSparConditionSupplementalCandidates({ query: 'spar' }), false);
  assert.equal(shouldLoadSparConditionSupplementalCandidates({ query: 'spar kaffee' }), false);
  assert.equal(shouldLoadSparConditionSupplementalCandidates({ query: 'spar 1+1', selectedRetailers: ['hofer'] }), false);
  assert.equal(shouldLoadSparConditionSupplementalCandidates({ query: 'spar 1+1', selectedRetailers: ['spar'] }), true);
});

test('SPAR condition supplemental candidate match is scoped and condition-gated', () => {
  const match = buildSparConditionSupplementalCandidateMatch({ query: 'spar 1+1' });
  const serialized = JSON.stringify(match);

  assert.equal(match.status, 'active');
  assert.equal(match.isActiveNow, true);
  assert.ok(serialized.includes('spar'));
  assert.ok(serialized.includes('eurospar'));
  assert.ok(serialized.includes('interspar'));
  assert.ok(serialized.includes('conditionsText'));
  assert.ok(serialized.includes('minimumPurchaseQty'));
  assert.ok(serialized.includes('sourceType'));
  assert.ok(serialized.includes('sourceUrls'));
  assert.ok(serialized.includes('evidenceUrls'));
  assert.equal(buildSparConditionSupplementalCandidateMatch({ query: 'spar kaffee' }), null);
  assert.equal(buildSparConditionSupplementalCandidateMatch({ query: 'spar' }), null);
  assert.equal(buildSparConditionSupplementalCandidateMatch({ query: 'kiste' }), null);
});

test('SPAR 1+1 supplemental candidates restore PDF condition ranking after primary cap', () => {
  assertSupplementRanksTopTen('spar 1+1');
});

test('SPAR kiste supplemental candidates restore beer crate ranking after primary cap', () => {
  assertSupplementRanksTopTen('spar kiste', {
    title: 'SPAR Haushaltsbox Aktion',
    categoryPrimary: 'Haushalt',
    categorySecondary: 'Aufbewahrung',
    categoryKey: 'aufbewahrung',
    quantityText: '1 Kiste',
    searchText: 'spar kiste haushalt aufbewahrung',
  });
});

test('SPAR ab 2 kisten supplemental candidates restore threshold crate ranking after primary cap', () => {
  assertSupplementRanksTopTen('spar ab 2 kisten', {
    title: 'SPAR Haushaltsbox Aktion',
    categoryPrimary: 'Haushalt',
    categorySecondary: 'Aufbewahrung',
    categoryKey: 'aufbewahrung',
    quantityText: '1 Kiste',
    searchText: 'spar kiste haushalt aufbewahrung',
  });
});

test('existing condition-heavy queries keep PDF evidence ranked without SPAR supplement', () => {
  const generic = genericSparCandidate(1, {
    title: 'SPAR Markenartikel gratis Aktion',
    searchText: 'spar gratis aktion',
  });
  const pdf = sparPdfOffer({
    _id: 'pdf-existing-condition-query',
    title: 'Puntigamer Maerzen',
    brand: 'Puntigamer',
    quantityText: '20 x 0.5 l',
    conditionsText: '1+1 gratis / ab 2 Kisten je 14,90 / Joker moeglich',
    hasConditions: true,
    isMultiBuy: true,
    minimumPurchaseQty: 2,
    sourceType: 'spar-official-pdf',
    rawFacts: { sourceKey: 'spar-official-flyer-pdf' },
  });

  for (const query of ['1+1 gratis', 'ab 2 kisten', 'puntigamer', 'joker']) {
    assert.equal(shouldLoadSparConditionSupplementalCandidates({ query }), false);
    assert.equal(applyQueryMatch([generic, pdf], query)[0]._id, 'pdf-existing-condition-query');
  }
});

test('non-condition control queries do not activate SPAR condition supplement', () => {
  for (const query of ['spar kaffee', 'kaffee', 'spar bier', 'butter', 'tee', 'wurst']) {
    assert.equal(shouldLoadSparConditionSupplementalCandidates({ query }), false);
    assert.equal(buildSparConditionSupplementalCandidateMatch({ query }), null);
  }
});

test('SPAR official product supplemental query activates only for coffee and ice product intent', () => {
  for (const query of ['kaffee', 'lavazza', 'kimbo', 'hornig', 'eskimo', 'magnum', 'eis']) {
    assert.equal(shouldLoadSparOfficialProductSupplementalCandidates({ query }), true);
  }

  for (const query of ['gin', 'butter', 'wurst', 'spar 1+1', 'koffer']) {
    assert.equal(shouldLoadSparOfficialProductSupplementalCandidates({ query }), false);
  }

  assert.equal(shouldLoadSparOfficialProductSupplementalCandidates({ query: 'kaffee', selectedRetailers: ['hofer'] }), false);
  assert.equal(shouldLoadSparOfficialProductSupplementalCandidates({ query: 'kaffee', selectedRetailers: ['spar'] }), true);
  assert.equal(shouldLoadSparOfficialProductSupplementalCandidates({ query: 'eis', selectedRetailers: ['interspar'] }), true);
});

test('SPAR official product supplemental candidate match is official-pdf and product-gated', () => {
  const coffeeMatch = buildSparOfficialProductSupplementalCandidateMatch({ query: 'kaffee' });
  const iceMatch = buildSparOfficialProductSupplementalCandidateMatch({ query: 'eis' });
  const coffeeSerialized = JSON.stringify(coffeeMatch);
  const coffeeRegexText = coffeeMatch.$and
    .flatMap((part) => part.$or || [])
    .flatMap((branch) => Object.values(branch))
    .filter((value) => value instanceof RegExp)
    .map(String)
    .join(' ');
  const iceRegexText = iceMatch.$and
    .flatMap((part) => part.$or || [])
    .flatMap((branch) => Object.values(branch))
    .filter((value) => value instanceof RegExp)
    .map(String)
    .join(' ');

  assert.equal(coffeeMatch.status, 'active');
  assert.equal(coffeeMatch.isActiveNow, true);
  assert.ok(coffeeSerialized.includes('spar'));
  assert.ok(coffeeSerialized.includes('eurospar'));
  assert.ok(coffeeSerialized.includes('interspar'));
  assert.ok(coffeeSerialized.includes('sourceType'));
  assert.ok(coffeeSerialized.includes('sourceUrls'));
  assert.ok(coffeeSerialized.includes('evidenceUrls'));
  assert.match(coffeeRegexText, /lavazza/i);
  assert.match(coffeeRegexText, /kimbo/i);
  assert.ok(coffeeSerialized.includes('titleNormalized'));
  assert.equal(coffeeSerialized.includes('categorySecondary'), false);

  assert.match(iceRegexText, /eskimo/i);
  assert.match(iceRegexText, /magnum/i);
  assert.equal(buildSparOfficialProductSupplementalCandidateMatch({ query: 'gin' }), null);
  assert.equal(buildSparOfficialProductSupplementalCandidateMatch({ query: 'kaffee', selectedRetailers: ['hofer'] }), null);
});

test('SPAR product supplemental candidates restore coffee and ice products after primary cap', () => {
  const primary = Array.from({ length: 220 }, (_, index) => offer({
    _id: `billa-kaffee-${index}`,
    retailerKey: 'billa',
    retailerName: 'BILLA',
    title: `BILLA Kaffee Aktion ${index}`,
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: `billa-kaffee-${index}::1-kg`,
    searchText: `billa kaffee aktion ${index}`,
    sortScoreDefault: 250 - index,
  })).slice(0, 200);
  const lavazza = sparPdfOffer({
    _id: 'pdf-lavazza-kaffee',
    retailerKey: 'interspar',
    retailerName: 'INTERSPAR',
    sourceRetailerFormat: 'interspar',
    title: 'Lavazza Espresso Cremoso',
    brand: 'Lavazza',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'lavazza-espresso-cremoso::1-kg',
    searchText: 'interspar lavazza espresso cremoso kaffee',
  });
  const eskimo = sparPdfOffer({
    _id: 'pdf-eskimo-eis',
    title: 'Eskimo 6 Family Mix tiefgekuehlt',
    brand: 'Eskimo',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Tiefkuehl- & Fertigprodukte',
    comparisonGroup: 'eskimo-family-mix::6-stueck',
    searchText: 'spar eskimo family mix tiefkuehl lebensmittel',
  });

  assert.equal(primary.some((item) => item._id === lavazza._id), false);
  assert.equal(applyQueryMatch(primary, 'kaffee').some((item) => item._id === lavazza._id), false);
  assert.equal(applyQueryMatch(mergeCandidateOffers(primary, [lavazza]), 'kaffee')[0]._id, 'pdf-lavazza-kaffee');
  assert.equal(applyQueryMatch([eskimo], 'eis')[0]._id, 'pdf-eskimo-eis');
});

test('eis search prefers ice-cream brands over drogerie ice side hits', () => {
  const eskimo = offer({
    _id: 'eskimo-eis',
    title: 'Eskimo 6 Family Mix tiefgekuehlt',
    brand: 'Eskimo',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Tiefkuehl- & Fertigprodukte',
    comparisonGroup: 'eskimo-family-mix::6-stueck',
    searchText: 'eskimo family mix tiefkuehl lebensmittel',
  });
  const rollOn = offer({
    _id: 'roll-on',
    title: 'Teufelssalbe Eis Roll-On',
    brand: 'Teufelssalbe',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Koerperpflege',
    comparisonGroup: 'teufelssalbe-eis-roll-on::1-stueck',
    searchText: 'teufelssalbe eis roll on koerperpflege',
  });

  assert.equal(applyQueryMatch([rollOn, eskimo], 'eis')[0]._id, 'eskimo-eis');
  assert.ok(scoreOfferAgainstQuery(eskimo, 'eis') > scoreOfferAgainstQuery(rollOn, 'eis'));
});

test('gin search rejects original substring side hits and keeps exact gin products', () => {
  const original = offer({
    _id: 'original-tortilla',
    title: 'Santa Maria Tortilla Original oder Whole Wheat',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Brot & Gebaeck',
    comparisonGroup: 'santa-maria-tortilla-original::320-g',
    searchText: 'santa maria tortilla original whole wheat',
  });
  const gin = offer({
    _id: 'hendricks-gin',
    title: "Hendrick's Gin 0,7 l",
    brand: 'Hendrick',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Spirituosen',
    comparisonGroup: 'hendricks-gin::0.7-l',
    searchText: 'hendricks gin london dry spirituosen',
  });

  assert.deepEqual(applyQueryMatch([original], 'gin'), []);
  assert.equal(applyQueryMatch([original, gin], 'gin')[0]._id, 'hendricks-gin');
});

test('SPAR-family retailer prefixes are not treated as dominant product tokens', () => {
  const genericSpar = sparOffer({
    _id: 'generic-spar-bread',
    title: 'SPAR Olivenstange SPAR 1 Stueck',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Brot & Gebaeck',
    categoryKey: 'brot-gebaeck',
    searchText: 'spar olivenstange angebot',
    searchTokens: ['aktion', 'olivenstange', 'spar'],
    searchTokenVersion: 2,
  });
  const tomato = sparOffer({
    _id: 'interspar-tomaten',
    retailerKey: 'interspar',
    retailerName: 'INTERSPAR',
    sourceRetailerFormat: 'interspar',
    title: 'Frische Tomaten INTERSPAR 1 kg',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Obst & Gemuese',
    categoryKey: 'obst-gemuese',
    searchText: 'frische tomaten interspar obst gemuese',
    searchTokens: ['frisch', 'gemuese', 'interspar', 'obst', 'tomaten'],
    searchTokenVersion: 2,
  });

  assert.deepEqual(applyQueryMatch([genericSpar], 'spar gurke'), []);
  assert.equal(applyQueryMatch([genericSpar, tomato], 'interspar tomaten')[0]._id, 'interspar-tomaten');

  const intersparMetadata = buildRankingCandidateQueryMetadata({ query: 'interspar tomaten' });
  assert.ok(intersparMetadata.queryTokens.includes('tomaten'));
  assert.equal(intersparMetadata.queryTokens.includes('interspar'), false);

  const eurosparMetadata = buildRankingCandidateQueryMetadata({ query: 'eurospar bananen' });
  assert.ok(eurosparMetadata.queryTokens.includes('bananen'));
  assert.equal(eurosparMetadata.queryTokens.includes('eurospar'), false);

  const match = buildRankingCandidateMatch({ query: 'spar gurke' });
  const serialized = JSON.stringify(match);
  assert.ok(serialized.includes('sourceRetailerFormat'));
  assert.ok(serialized.includes('searchTokens'));
  assert.ok(serialized.includes('gurke'));

  const sparMetadata = buildRankingCandidateQueryMetadata({ query: 'spar gurke' });
  assert.ok(sparMetadata.queryTokens.includes('gurke'));
  assert.equal(sparMetadata.queryTokens.includes('spar'), false);
});

test('SPAR non-condition control queries still match product intent', () => {
  const beer = sparOffer({ _id: 'spar-bier', title: 'Goesser Maerzen SPAR 0.50 Liter 1 Dose' });
  const coffee = sparOffer({
    _id: 'spar-kaffee',
    title: 'Lavazza Kaffee Bohnen SPAR 1 Kilogramm',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    categoryKey: 'kaffee-tee',
    searchText: 'lavazza kaffee bohnen spar',
  });
  const wurst = sparOffer({
    _id: 'spar-wurst',
    title: 'TANN Salami SPAR 100 Gramm',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    categoryKey: 'fleisch-wurst-fisch',
    searchText: 'tann salami wurst spar',
  });

  assert.equal(applyQueryMatch([beer], 'spar bier')[0]._id, 'spar-bier');
  assert.equal(applyQueryMatch([coffee], 'spar kaffee')[0]._id, 'spar-kaffee');
  assert.equal(applyQueryMatch([wurst], 'spar wurst')[0]._id, 'spar-wurst');
  assert.equal(applyQueryMatch([beer], 'spar kiste').length, 0);
  assert.equal(scoreOfferAgainstQuery(sparPdfOffer({ conditionsText: '1+1 gratis' }), 'spar 1+1') > 0, true);
});

function freshFoodOffer(overrides = {}) {
  return offer({
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Obst & Gemuese',
    categoryKey: 'obst-gemuese',
    sourceType: 'aktionsfinder-json',
    quantityText: '500 g',
    normalizedUnitPrice: { amount: 2.98, unit: 'kg', comparable: true, confidence: 0.9 },
    ...overrides,
  });
}

test('fresh-intent ranking keeps true fresh bananas before chocolate bananas', () => {
  const fresh = freshFoodOffer({
    _id: 'fresh-bananas',
    title: 'Frische Bananen aus Oesterreich 1 kg',
    searchText: 'frische bananen obst gemuese kg',
  });
  const sidehit = offer({
    _id: 'schoko-bananas',
    title: 'Casali Schoko-Bananen 600 Gramm 1 Packung',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Suesswaren & Knabbereien',
    categoryKey: 'suesswaren-knabbereien',
    searchText: 'casali schoko bananen suesswaren',
    normalizedUnitPrice: { amount: 11.65, unit: 'kg', comparable: true, confidence: 0.9 },
  });

  assert.deepEqual(applyQueryMatch([sidehit, fresh], 'bananen').map((item) => item._id), [
    'fresh-bananas',
    'schoko-bananas',
  ]);
});

test('fresh-intent ranking keeps fresh paprika before chips and cheese paprika sidehits', () => {
  const fresh = freshFoodOffer({
    _id: 'fresh-paprika',
    title: 'Frische Paprika rot Klasse I 500 g',
    searchText: 'frische paprika obst gemuese klasse 500 g',
  });
  const chips = offer({
    _id: 'chips-paprika',
    title: 'S-BUDGET Chips Salz oder Paprika 300 Gramm',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Suesswaren & Knabbereien',
    categoryKey: 'suesswaren-knabbereien',
    searchText: 'chips paprika snack',
  });
  const quargel = offer({
    _id: 'quargel-paprika',
    title: 'SPAR Quargel Natur oder Paprika 200 Gramm',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Kaese',
    categoryKey: 'kaese',
    searchText: 'quargel paprika kaese',
  });

  assert.deepEqual(applyQueryMatch([chips, quargel, fresh], 'paprika').map((item) => item._id), [
    'fresh-paprika',
    'chips-paprika',
    'quargel-paprika',
  ]);
});

test('fresh-intent ranking keeps fresh tomatoes before processed tomato sidehits', () => {
  const fresh = freshFoodOffer({
    _id: 'fresh-tomatoes',
    title: 'Rispentomaten aus Oesterreich 500 g',
    searchText: 'rispentomaten frisch obst gemuese 500 g',
  });
  const passata = offer({
    _id: 'passierte-tomaten',
    title: 'Passierte Tomaten 500 Gramm',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Pasta, Reis & Konserven',
    categoryKey: 'pasta-reis-konserven',
    searchText: 'passierte tomaten sugo sauce',
  });
  const tuna = offer({
    _id: 'thunfisch-tomaten',
    title: 'Thunfisch Getrocknete Tomaten und Kraeuter',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    categoryKey: 'fleisch-wurst-fisch',
    searchText: 'thunfisch getrocknete tomaten',
  });

  assert.deepEqual(applyQueryMatch([passata, tuna, fresh], 'tomaten').map((item) => item._id), [
    'fresh-tomatoes',
    'passierte-tomaten',
    'thunfisch-tomaten',
  ]);
});

test('fresh-intent ranking keeps fresh carrots before bakery carrot sidehits', () => {
  const fresh = freshFoodOffer({
    _id: 'fresh-carrots',
    title: 'Karotten Bund aus Oesterreich',
    quantityText: '1 Bund',
    searchText: 'karotten bund frisch obst gemuese',
  });
  const bakery = offer({
    _id: 'karotten-dinkelknopf',
    title: 'SPAR Dinkelknopf mit Karotten und Buchweizen 350 Gramm',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Brot & Gebaeck',
    categoryKey: 'brot-gebaeck',
    searchText: 'dinkelknopf gebaeck karotten',
  });

  assert.deepEqual(applyQueryMatch([bakery, fresh], 'karotten').map((item) => item._id), [
    'fresh-carrots',
    'karotten-dinkelknopf',
  ]);
});

test('fresh-intent ranking keeps fresh strawberries before Haribo strawberry sweets', () => {
  const fresh = freshFoodOffer({
    _id: 'fresh-strawberries',
    title: 'Erdbeeren 500 g 1 Packung',
    searchText: 'erdbeeren frisch obst gemuese 500 g',
  });
  const sweets = offer({
    _id: 'haribo-strawberries',
    title: 'Haribo Primavera Erdbeeren',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Suesswaren & Knabbereien',
    categoryKey: 'suesswaren-knabbereien',
    searchText: 'haribo primavera erdbeeren suesswaren',
  });

  assert.deepEqual(applyQueryMatch([sweets, fresh], 'erdbeeren').map((item) => item._id), [
    'fresh-strawberries',
    'haribo-strawberries',
  ]);
});

test('fresh sidehits remain searchable when no true fresh offer is present', () => {
  const sidehit = offer({
    _id: 'only-schoko-bananas',
    title: 'Casali Schoko-Bananen 600 Gramm 1 Packung',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Suesswaren & Knabbereien',
    categoryKey: 'suesswaren-knabbereien',
    searchText: 'casali schoko bananen suesswaren',
  });

  const ranked = applyQueryMatch([sidehit], 'bananen');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]._id, 'only-schoko-bananas');
  assert.equal(scoreOfferAgainstQuery(sidehit, 'bananen') > 0, true);
});

test('SPAR condition merge keeps current dated condition sentences intact', () => {
  const aktionsfinder = sparOffer({
    brand: 'Goesser',
    title: 'Gösser Märzen SPAR 0.50 Liter 1 Dose',
  });
  const pdf = sparPdfOffer({
    brand: 'Goesser',
    conditionsText: 'ab 6 Dosen. Zusaetzlich -25% am Fr., 22.5. und Sa., 23.5.2026 laut Flugblatt',
  });

  const [merged] = mergeSparConditionEvidenceIntoOffers([aktionsfinder, pdf], {
    now: new Date('2026-05-22T12:00:00.000Z'),
  });

  assert.equal(
    merged.conditionsText,
    'ab 6 Dosen. Zusaetzlich -25% am Fr., 22.5. und Sa., 23.5.2026 laut Flugblatt',
  );
});

test('SPAR condition guard removes expired Zusaetzlich fragments and keeps basis conditions', () => {
  const offerWithBasis = sparPdfOffer({
    conditionsText: 'Zusaetzlich -25% am Fr., 22.5. und Sa., 23.5.2026 laut Flugblatt / ab 6 Dosen',
  });

  assert.equal(
    filterExpiredDateBoundConditionFragments(offerWithBasis.conditionsText, {
      offer: offerWithBasis,
      now: new Date('2026-05-26T10:00:00.000Z'),
    }),
    'ab 6 Dosen',
  );
  assert.equal(
    filterExpiredDateBoundConditionFragments(
      'ab 6 Dosen. Zusaetzlich -25% am Fr., 22.5. und Sa., 23.5.2026 laut Flugblatt / ab 6 Dosen',
      {
        offer: offerWithBasis,
        now: new Date('2026-05-26T10:00:00.000Z'),
      },
    ),
    'ab 6 Dosen',
  );
});

test('SPAR condition guard removes expired Zusatz fragments without laut Flugblatt suffix', () => {
  const pdf = sparPdfOffer({
    conditionsText: 'ab 2 Kisten je 14,90. Zusaetzlich -25% am Fr., 22.5. und Sa., 23.5.2026',
  });

  assert.equal(
    filterExpiredDateBoundConditionFragments(pdf.conditionsText, {
      offer: pdf,
      now: new Date('2026-05-29T10:00:00.000Z'),
    }),
    'ab 2 Kisten je 14,90',
  );
});

test('SPAR condition guard handles Zusaetzlich umlaut variant', () => {
  const pdf = sparPdfOffer({
    conditionsText: 'ab 24 Dosen. Zusätzlich -25% am Fr., 22.05. und Sa., 23.05.2026 laut Flugblatt',
  });

  assert.equal(
    filterExpiredDateBoundConditionFragments(pdf.conditionsText, {
      offer: pdf,
      now: new Date('2026-05-26T10:00:00.000Z'),
    }),
    'ab 24 Dosen',
  );
});

test('SPAR condition guard keeps future and current date-bound Zusatz conditions', () => {
  const pdf = sparPdfOffer({
    conditionsText: 'Zusaetzlich -25% am Fr., 29.5. und Sa., 30.5.2026 laut Flugblatt / ab 6 Dosen',
  });

  assert.equal(
    filterExpiredDateBoundConditionFragments(pdf.conditionsText, {
      offer: pdf,
      now: new Date('2026-05-26T10:00:00.000Z'),
    }),
    'Zusaetzlich -25% am Fr., 29.5. und Sa., 30.5.2026 laut Flugblatt / ab 6 Dosen',
  );
  assert.equal(
    filterExpiredDateBoundConditionFragments(pdf.conditionsText, {
      offer: pdf,
      now: new Date('2026-05-29T10:00:00.000Z'),
    }),
    'Zusaetzlich -25% am Fr., 29.5. und Sa., 30.5.2026 laut Flugblatt / ab 6 Dosen',
  );
});

test('SPAR condition guard leaves base and unclear conditions unchanged', () => {
  const pdf = sparPdfOffer();

  assert.equal(
    filterExpiredDateBoundConditionFragments('ab 6 Dosen', {
      offer: pdf,
      now: new Date('2026-05-26T10:00:00.000Z'),
    }),
    'ab 6 Dosen',
  );
  assert.equal(
    filterExpiredDateBoundConditionFragments('ab 24 Dosen', {
      offer: pdf,
      now: new Date('2026-05-26T10:00:00.000Z'),
    }),
    'ab 24 Dosen',
  );
  assert.equal(
    filterExpiredDateBoundConditionFragments('12+12 gratis', {
      offer: pdf,
      now: new Date('2026-05-26T10:00:00.000Z'),
    }),
    '12+12 gratis',
  );
  assert.equal(
    filterExpiredDateBoundConditionFragments('Zusaetzlich -25% am Flugblatt-Wochenende laut Flugblatt / ab 6 Dosen', {
      offer: pdf,
      now: new Date('2026-05-26T10:00:00.000Z'),
    }),
    'Zusaetzlich -25% am Flugblatt-Wochenende laut Flugblatt / ab 6 Dosen',
  );
});

test('buildRankedOffer filters expired date-bound Zusatz condition text in API response', () => {
  const ranked = buildRankedOffer(
    sparPdfOffer({
      conditionsText: 'ab 6 Dosen. Zusaetzlich -25% am Fr., 22.5. und Sa., 23.5.2026 laut Flugblatt / ab 6 Dosen',
    }),
    1.98,
    1.98,
    { now: new Date('2026-05-26T10:00:00.000Z') },
  );

  assert.equal(ranked.conditionsText, 'ab 6 Dosen');
});

test('buildRankedOffer removes expired SPAR PDF Zusatz fragments from public title and keeps product name', () => {
  const ranked = buildRankedOffer(
    sparPdfOffer({
      brand: 'Felix',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenfutter',
      title: 'Felix Katzennahrung versch. Sorten, 12x85 g *Heidelbeer-Angebot g\u00fcltig bis Sa., 23.5.2026 ab 2 Pkg. je 3,74(per kg 3,67) Noch zus\u00e4tzlich',
      quantityText: '12 x 85 g',
      conditionsText: 'ab 2 Packungen',
      validTo: '2026-06-02T12:00:00.000Z',
    }),
    4.89,
    4.89,
    { now: new Date('2026-05-29T10:00:00.000Z') },
  );

  assert.equal(ranked.title, 'Felix Katzennahrung versch. Sorten, 12x85 g');
  assert.doesNotMatch(ranked.title, /23\.5|zus(?:ae|a|\u00e4)tzlich|Heidelbeer/i);
  assert.match(ranked.title, /Felix Katzennahrung/);
  assert.equal(ranked.conditionsText, 'ab 2 Packungen');
});

test('buildRankedOffer keeps fragment-only expired SPAR PDF titles instead of returning an empty public title', () => {
  const rawTitle = 'Noch zus\u00e4tzlich -25%am Fr., 22.5. und Sa., 23.5. ab 2 Ds. je';
  const ranked = buildRankedOffer(
    sparPdfOffer({
      title: rawTitle,
      quantityText: '4 Stk',
      conditionsText: 'ab 4 Stueck',
      validTo: '2026-06-02T12:00:00.000Z',
    }),
    3.49,
    3.49,
    { now: new Date('2026-05-29T10:00:00.000Z') },
  );

  assert.equal(ranked.title, rawTitle);
  assert.notEqual(ranked.title.trim(), '');
  assert.equal(ranked.conditionsText, 'ab 4 Stueck');
});

test('buildRankedOffer keeps current and future SPAR PDF Zusatz title dates intact', () => {
  const rawTitle = 'Felix Katzennahrung 12 x 85 g Zusaetzlich -25% am Fr., 29.5. und Sa., 30.5.2026';
  const ranked = buildRankedOffer(
    sparPdfOffer({
      title: rawTitle,
      quantityText: '12 x 85 g',
    }),
    4.89,
    4.89,
    { now: new Date('2026-05-29T10:00:00.000Z') },
  );

  assert.equal(ranked.title, rawTitle);
});

test('buildRankedOffer leaves non-SPAR or non-official-PDF titles unchanged', () => {
  const rawTitle = 'Felix Katzennahrung 12 x 85 g Zusaetzlich -25% am Fr., 22.5. und Sa., 23.5.2026';
  const billa = buildRankedOffer(
    offer({
      retailerKey: 'billa',
      retailerName: 'BILLA',
      title: rawTitle,
      sourceType: 'billa-official-pdf',
      rawFacts: { sourceKey: 'billa-official-flyer-pdf' },
      priceCurrent: { amount: 4.99, currency: 'EUR' },
      normalizedUnitPrice: { amount: 4.89, unit: 'kg', comparable: true },
    }),
    4.89,
    4.89,
    { now: new Date('2026-05-29T10:00:00.000Z') },
  );
  const aktionsfinder = buildRankedOffer(
    sparOffer({
      title: rawTitle,
      sourceType: 'aktionsfinder-json',
      rawFacts: { sourceKey: 'aktionsfinder-spar' },
    }),
    4.89,
    4.89,
    { now: new Date('2026-05-29T10:00:00.000Z') },
  );

  assert.equal(billa.title, rawTitle);
  assert.equal(aktionsfinder.title, rawTitle);
});

test('buildRankedOffer public title cleanup does not change normal numbers, percentages or base conditions', () => {
  const rawTitle = 'Puntigamer 20 x 0.5 l Kiste -25% und Felix 12 x 85 g';
  const ranked = buildRankedOffer(
    sparPdfOffer({
      title: rawTitle,
      quantityText: '20 x 0.5 l',
      conditionsText: '1+1 gratis / ab 2 Kisten / Joker moeglich / ab 2 Packungen',
    }),
    1.49,
    1.49,
    { now: new Date('2026-05-29T10:00:00.000Z') },
  );

  assert.equal(ranked.title, rawTitle);
  assert.match(ranked.title, /20 x 0\.5 l/);
  assert.match(ranked.title, /12 x 85 g/);
  assert.match(ranked.title, /-25%/);
  assert.equal(ranked.conditionsText, '1+1 gratis / ab 2 Kisten / Joker moeglich / ab 2 Packungen');
});

test('buildRankedOffer repairs legacy SPAR beer crate unit price only with safe crate context', () => {
  const ranked = buildRankedOffer(
    sparPdfOffer({
      _id: 'spar-puntigamer-kiste',
      title: 'Puntigamer Maerzen',
      brand: 'Puntigamer',
      priceCurrent: { amount: 14.90, currency: 'EUR' },
      quantityText: 'Kiste, 0.5 l Flaschen',
      packCount: null,
      unitValue: 0.5,
      unitType: 'l',
      totalComparableAmount: 0.5,
      comparableUnit: 'l',
      normalizedUnitPrice: { amount: 29.8, unit: 'l', comparable: true, confidence: 0.5 },
      conditionsText: '1+1 gratis / 1 Kiste 29,80 / ab 2 Kisten je 14,90 / Joker moeglich',
      quality: { comparisonSafe: false, issues: ['Packungsgroesse unklar'] },
    }),
    1.49,
    1.49,
  );

  assert.equal(ranked.packCount, 20);
  assert.equal(ranked.totalComparableAmount, 10);
  assert.equal(ranked.normalizedUnitPrice.amount, 1.49);
  assert.equal(ranked.normalizedUnitPrice.unit, 'l');
  assert.match(ranked.conditionsText, /1\+1 gratis/);
  assert.match(ranked.conditionsText, /Joker moeglich/);
});

test('SPAR condition guard can return an empty condition text when only expired Zusatz remains', () => {
  const pdf = sparPdfOffer({
    conditionsText: 'Zusaetzlich -25% am Fr., 22.5. und Sa., 23.5.2026 laut Flugblatt',
  });

  assert.equal(
    filterExpiredDateBoundConditionFragments(pdf.conditionsText, {
      offer: pdf,
      now: new Date('2026-05-26T10:00:00.000Z'),
    }),
    '',
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

test('beer query rejects textile side hits even when category is misclassified as beer', () => {
  const beer = offer({
    title: 'Wieselburger Bier 0,5 l',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    subcategoryKey: 'bier',
    searchText: 'wieselburger bier getraenke',
  });
  const shorts = offer({
    title: 'CRIVIT Herren Laufshorts',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    subcategoryKey: 'bier',
    searchText: 'crivit herren laufshorts bier',
  });

  assert.equal(scoreOfferAgainstQuery(shorts, 'bier'), 0);
  assert.deepEqual(applyQueryMatch([shorts, beer], 'bier').map((item) => item.title), [
    'Wieselburger Bier 0,5 l',
  ]);
});

test('generic sauce query rejects pet-food in-sauce side hits without hiding pet-food intent', () => {
  const foodSauce = offer({
    title: 'BILLA Bio BBQ Sauce',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Saucen, Oele & Gewuerze',
    categoryKey: 'saucen-oele-gewuerze',
    subcategoryKey: 'saucen-oele-gewuerze',
    searchText: 'billa bio bbq sauce lebensmittel saucen gewuerze',
  });
  const sheba = offer({
    title: 'Sheba Selection in Sauce Herzhafte Komposition 4-Pack',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Katzenfutter',
    categoryKey: 'katzenfutter',
    subcategoryKey: 'katzenfutter',
    searchText: 'sheba selection in sauce katzenfutter tierbedarf',
  });
  const poesie = offer({
    title: 'Poesie Sauce mit Seelachs und Tomate',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Saucen, Oele & Gewuerze',
    categoryKey: 'saucen-oele-gewuerze',
    subcategoryKey: 'saucen-oele-gewuerze',
    searchText: 'poesie sauce seelachs tomate lebensmittel saucen',
  });

  assert.equal(scoreOfferAgainstQuery(sheba, 'sauce'), 0);
  assert.equal(scoreOfferAgainstQuery(poesie, 'sauce'), 0);
  assert.deepEqual(applyQueryMatch([sheba, foodSauce, poesie], 'sauce').map((item) => item.title), [
    'BILLA Bio BBQ Sauce',
  ]);
  assert.equal(scoreOfferAgainstQuery(sheba, 'katzenfutter sauce') > 0, true);
  assert.equal(scoreOfferAgainstQuery(sheba, 'sheba') > 0, true);
  assert.equal(scoreOfferAgainstQuery(poesie, 'poesie') > 0, true);
});

test('generic duft query ranks fragrances ahead of scented side hits without hiding specific side queries', () => {
  const perfume = offer({
    title: 'Boss Bottled Eau de Toilette 100ml',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Kosmetik & Make-up',
    categoryKey: 'kosmetik-make-up',
    searchTokens: ['boss', 'bottled', 'eau', 'toilette', 'parfum', 'kosmetik', 'bipa'],
    retailerName: 'BIPA',
  });
  const litter = offer({
    title: 'ZooRoyal Ultra Klumpstreu Pinienduft 5 Liter',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Katzenstreu & Pflege',
    categoryKey: 'katzenstreu-pflege',
    searchTokens: ['zooroyal', 'klumpstreu', 'pinienduft', 'katzenstreu', 'bipa'],
    retailerName: 'BIPA',
  });
  const cleaner = offer({
    title: 'WC-Duft Reiniger Zitrone',
    categoryPrimary: 'Haushalt',
    categorySecondary: 'Waschmittel & Reiniger',
    categoryKey: 'waschmittel-reiniger',
    searchTokens: ['wc', 'duft', 'reiniger', 'bipa'],
    retailerName: 'BIPA',
  });

  const generic = applyQueryMatch([litter, cleaner, perfume], 'bipa duft');

  assert.equal(generic[0].title, perfume.title);
  assert.equal(generic.some((item) => item.title === litter.title), true);
  assert.equal(generic.some((item) => item.title === cleaner.title), true);
  assert.equal(scoreOfferAgainstQuery(perfume, 'duft') > scoreOfferAgainstQuery(litter, 'duft'), true);
  assert.equal(scoreOfferAgainstQuery(perfume, 'duft') > scoreOfferAgainstQuery(cleaner, 'duft'), true);
  assert.equal(scoreOfferAgainstQuery(litter, 'pinienduft') > 0, true);
  assert.equal(scoreOfferAgainstQuery(cleaner, 'wc duft') > 0, true);
  assert.equal(scoreOfferAgainstQuery(cleaner, 'wc duft') > scoreOfferAgainstQuery(perfume, 'wc duft'), true);
  assert.equal(applyQueryMatch([perfume, cleaner], 'wc duft')[0].title, cleaner.title);
});

test('ranking response infers safe visible ml fields from fragrance titles', () => {
  const cases = [
    ['Boss Bottled Eau de Toilette 100ml', 57.99, '100 ml', 579.9],
    ['My Land Eau de Toilette 50ml', 31.49, '50 ml', 629.8],
    ['Boss Bottled Eau de Toilette 200ml', 76.99, '200 ml', 384.95],
    ['Paco Rabanne Lady Million Eau de Parfum BIPA 50 Milliliter 1 Stueck', 62.99, '50 ml', 1259.8],
    ['Jil Sander Sun Woman Eau de Toilette BIPA 75 Milliliter 1 Stueck', 34.99, '75 ml', 466.53],
  ];

  for (const [title, price, quantityText, unitPrice] of cases) {
    const ranked = buildRankedOffer(offer({
      retailerKey: 'bipa',
      retailerName: 'BIPA',
      title,
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Kosmetik & Make-up',
      priceCurrent: { amount: price, currency: 'EUR' },
      quantityText: title.includes('1 Stueck') ? '1 Stueck' : '',
      unitType: title.includes('1 Stueck') ? 'Stk' : '',
      totalComparableAmount: title.includes('1 Stueck') ? 1 : null,
      comparableUnit: title.includes('1 Stueck') ? 'Stk' : '',
      normalizedUnitPrice: title.includes('1 Stueck')
        ? { amount: price, unit: 'Stk', comparable: true, confidence: 0.8 }
        : { amount: null, unit: '', comparable: false, confidence: 0 },
      quality: { comparisonSafe: false, issues: ['Vergleichseinheit unklar'] },
    }));

    assert.equal(ranked.quantityText, quantityText, title);
    assert.equal(ranked.unitType, 'ml', title);
    assert.equal(ranked.comparableUnit, 'l', title);
    assert.equal(ranked.normalizedUnitPrice.amount, unitPrice, title);
    assert.equal(ranked.normalizedUnitPrice.unit, 'l', title);
    assert.equal(ranked.normalizedUnitPrice.comparable, true, title);
    assert.equal(ranked.quality.comparisonSafe, true, title);
  }
});

test('ranking response keeps unsafe plus and ambiguous set quantities hidden', () => {
  const cases = [
    'Sonnencreme LSF 50+',
    'SPF 50+ Sun Spray',
    'Vitamin C+ B-Vitamine',
    'MCM Compact Mini Set Eau de Parfum BIPA 7 Milliliter 4 Stueck',
  ];

  for (const title of cases) {
    const ranked = buildRankedOffer(offer({
      retailerKey: 'bipa',
      retailerName: 'BIPA',
      title,
      priceCurrent: { amount: 9.99, currency: 'EUR' },
      quantityText: '',
      totalComparableAmount: null,
      comparableUnit: '',
      unitType: '',
      normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
      quality: { comparisonSafe: false },
    }));

    assert.equal(ranked.normalizedUnitPrice.amount, null, title);
    assert.equal(ranked.comparableUnit, '', title);
  }
});

test('ranking response corrects stale BIPA fragrance giftset wine category with context only', () => {
  const bottled = buildRankedOffer(offer({
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    brand: 'Hugo Boss',
    title: 'Bottled Geschenkset',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wein & Sekt',
    categoryKey: 'wein-sekt',
    subcategoryKey: 'wein-sekt',
    rawFacts: { bipaCategory: 'parfum-herrenduefte' },
  }));
  const wine = buildRankedOffer(offer({
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    title: 'Wein Geschenkset',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wein & Sekt',
    categoryKey: 'wein-sekt',
    subcategoryKey: 'wein-sekt',
  }));

  assert.equal(bottled.categoryPrimary, 'Drogerie / Hygiene');
  assert.equal(bottled.categorySecondary, 'Kosmetik & Make-up');
  assert.equal(bottled.displayCategory, 'Kosmetik & Make-up');
  assert.equal(wine.categoryPrimary, 'Getraenke');
  assert.equal(wine.categorySecondary, 'Wein & Sekt');
});

test('generic wine query rejects dm cosmetic color-name side hits', () => {
  const realWine = offer({
    _id: 'real-wine',
    retailerKey: 'billa',
    retailerName: 'Billa',
    title: 'Wegenstein Gruener Veltliner Weinviertel DAC',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wein & Sekt',
    categoryKey: 'wein-sekt',
    subcategoryKey: 'wein-sekt',
    searchText: 'wein veltliner getraenke',
  });
  const dmEyeshadow = offer({
    _id: 'dm-catrice',
    retailerKey: 'dm',
    retailerName: 'dm',
    title: 'CATRICE Lidschatten Art Couleurs 460 Frosted Dust',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wein & Sekt',
    categoryKey: 'wein-sekt',
    subcategoryKey: 'wein-sekt',
    searchText: 'catrice lidschatten kosmetik make up dm wein',
  });
  const dmLipgloss = offer({
    _id: 'dm-lipgloss',
    retailerKey: 'dm',
    retailerName: 'dm',
    title: 'Lipgloss Mineral Wear Diamond Plumper Champagner, 5 ml',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wein & Sekt',
    categoryKey: 'wein-sekt',
    subcategoryKey: 'wein-sekt',
    searchText: 'lipgloss mineral wear diamond plumper champagner kosmetik dm wein',
  });
  const dmDeo = offer({
    _id: 'dm-rose-deo',
    retailerKey: 'dm',
    retailerName: 'dm',
    title: 'Antitranspirant Deospray Fresh Rose Touch, 150 ml',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wein & Sekt',
    categoryKey: 'wein-sekt',
    subcategoryKey: 'wein-sekt',
    searchText: 'antitranspirant deospray fresh rose touch dm wein',
  });
  const dmWaschmittel = offer({
    _id: 'dm-wild-rose-waschmittel',
    retailerKey: 'dm',
    retailerName: 'dm',
    title: 'Universalwaschmittel Pulver Tiefenrein Wild Rose mit Silan, 90 Wl',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wein & Sekt',
    categoryKey: 'wein-sekt',
    subcategoryKey: 'wein-sekt',
    searchText: 'universalwaschmittel pulver tiefenrein wild rose silan dm wein',
  });

  assert.ok(scoreOfferAgainstQuery(realWine, 'wein') > 0);
  assert.equal(scoreOfferAgainstQuery(dmEyeshadow, 'wein'), 0);
  assert.equal(scoreOfferAgainstQuery(dmLipgloss, 'wein'), 0);
  assert.equal(scoreOfferAgainstQuery(dmDeo, 'wein'), 0);
  assert.equal(scoreOfferAgainstQuery(dmWaschmittel, 'wein'), 0);
  assert.deepEqual(applyQueryMatch([dmEyeshadow, realWine, dmLipgloss, dmDeo, dmWaschmittel], 'wein').map((item) => item._id), [
    'real-wine',
  ]);
});

test('ranking response corrects stale dm cosmetic wine category', () => {
  const ranked = buildRankedOffer(offer({
    retailerKey: 'dm',
    retailerName: 'dm',
    title: 'CATRICE Lidschatten Art Couleurs 460 Frosted Dust',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wein & Sekt',
    categoryKey: 'wein-sekt',
    subcategoryKey: 'wein-sekt',
  }));

  assert.equal(ranked.categoryPrimary, 'Drogerie / Hygiene');
  assert.equal(ranked.categorySecondary, 'Kosmetik & Make-up');
  assert.equal(ranked.displayCategory, 'Kosmetik & Make-up');

  const deo = buildRankedOffer(offer({
    retailerKey: 'dm',
    retailerName: 'dm',
    title: 'Antitranspirant Deospray Fresh Rose Touch, 150 ml',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wein & Sekt',
    categoryKey: 'wein-sekt',
    subcategoryKey: 'wein-sekt',
  }));
  const detergent = buildRankedOffer(offer({
    retailerKey: 'dm',
    retailerName: 'dm',
    title: 'Universalwaschmittel Pulver Tiefenrein Wild Rose mit Silan, 90 Wl',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wein & Sekt',
    categoryKey: 'wein-sekt',
    subcategoryKey: 'wein-sekt',
  }));

  assert.equal(deo.categoryPrimary, 'Drogerie / Hygiene');
  assert.equal(deo.categorySecondary, 'Koerperpflege');
  assert.equal(detergent.categoryPrimary, 'Haushalt');
  assert.equal(detergent.categorySecondary, 'Waschmittel & Reiniger');
});

test('ranking response corrects billa plus official algolia uncategorized anchors only', () => {
  const cases = [
    ['Mountain Dew Mountain Dew', 'Getraenke', 'Softdrinks'],
    ['Lillet Berry 0,75 Liter', 'Getraenke', 'Wein & Sekt'],
    ['Clever Spareribs mariniert', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['Santa Maria Dip Salsa mild', 'Lebensmittel', 'Saucen, Oele & Gewuerze'],
    ['Ja! Natuerlich Kichererbsen', 'Lebensmittel', 'Pasta, Reis & Konserven'],
    ['Shan Shi Glasnudeln', 'Lebensmittel', 'Pasta, Reis & Konserven'],
    ['Mautner Markhof Schokosauce', 'Lebensmittel', 'Suesswaren & Knabbereien'],
    ['Shaker Erdbeer Tiramisu', 'Lebensmittel', 'Suesswaren & Knabbereien'],
  ];

  for (const [title, categoryPrimary, categorySecondary] of cases) {
    const ranked = buildRankedOffer(offer({
      retailerKey: 'billa-plus',
      retailerName: 'BILLA Plus',
      sourceType: 'billa-official-algolia',
      sourceTypes: ['billa-official-algolia'],
      title,
      categoryPrimary: 'Unkategorisiert',
      categorySecondary: '',
      categoryKey: 'unkategorisiert',
      subcategoryKey: 'unkategorisiert',
    }));

    assert.equal(ranked.categoryPrimary, categoryPrimary, title);
    assert.equal(ranked.categorySecondary, categorySecondary, title);
    assert.equal(ranked.displayCategory, categorySecondary, title);
  }

  const waldquelle = buildRankedOffer(offer({
    retailerKey: 'billa-plus',
    retailerName: 'BILLA Plus',
    sourceType: 'billa-official-algolia',
    sourceTypes: ['billa-official-algolia'],
    title: 'Waldquelle Mineralwasser prickelnd',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wasser',
    categoryKey: 'wasser',
    subcategoryKey: 'wasser',
  }));
  const spar = buildRankedOffer(offer({
    retailerKey: 'spar',
    retailerName: 'SPAR',
    sourceType: 'spar-official-pdf',
    title: 'Mountain Dew Mountain Dew',
    categoryPrimary: 'Unkategorisiert',
    categorySecondary: '',
    categoryKey: 'unkategorisiert',
    subcategoryKey: 'unkategorisiert',
  }));
  const felixPaprika = buildRankedOffer(offer({
    retailerKey: 'billa-plus',
    retailerName: 'BILLA Plus',
    sourceType: 'billa-official-algolia',
    title: 'Felix Gefuellte Paprika in Tomatensauce',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Pasta, Reis & Konserven',
    categoryKey: 'pasta-reis-konserven',
    subcategoryKey: 'pasta-reis-konserven',
  }));

  assert.equal(waldquelle.categoryPrimary, 'Getraenke');
  assert.equal(waldquelle.categorySecondary, 'Wasser');
  assert.equal(spar.categoryPrimary, 'Unkategorisiert');
  assert.equal(felixPaprika.categoryPrimary, 'Lebensmittel');
  assert.equal(felixPaprika.categorySecondary, 'Pasta, Reis & Konserven');
});

test('search regression keeps softdrinks and energy intent separated', () => {
  const softdrink = offer({
    _id: 'softdrink',
    title: 'Coca-Cola Original 2 Liter',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Softdrinks',
    categoryKey: 'softdrinks',
    subcategoryKey: 'softdrinks',
    searchText: 'Coca-Cola Original Softdrinks Cola',
  });
  const energy = offer({
    _id: 'energy',
    title: 'Red Bull Energy Drink 250 ml',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Energy Drinks',
    categoryKey: 'energy-drinks',
    subcategoryKey: 'energy-drinks',
    searchText: 'Red Bull Energy Drink',
  });
  const lemonade = offer({
    _id: 'lemonade',
    title: 'Zitronenlimonade 1,5 Liter',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Softdrinks',
    categoryKey: 'softdrinks',
    subcategoryKey: 'softdrinks',
    searchText: 'Zitronenlimonade Limonade Softdrinks',
  });

  assert.deepEqual(applyQueryMatch([softdrink, energy, lemonade], 'softdrinks').map((item) => item._id), ['softdrink', 'lemonade']);
  assert.deepEqual(applyQueryMatch([softdrink, energy, lemonade], 'cola').map((item) => item._id), ['softdrink']);
  assert.deepEqual(applyQueryMatch([softdrink, energy, lemonade], 'limonade').map((item) => item._id), ['lemonade']);
  assert.deepEqual(applyQueryMatch([softdrink, energy, lemonade], 'energy drink').map((item) => item._id), ['energy']);
  assert.deepEqual(applyQueryMatch([softdrink, energy, lemonade], 'energy').map((item) => item._id), ['energy']);
});

test('ranking response corrects billa plus official flyer pdf anchors and drops fragments', () => {
  const baseBillaFlyer = {
    retailerKey: 'billa-plus',
    retailerName: 'BILLA Plus',
    sourceType: 'billa-official-flyer-pdf',
    sourceTypes: ['billa-official-flyer-pdf'],
    rawFacts: { sourceType: 'billa-official-flyer-pdf' },
    categoryPrimary: 'Unkategorisiert',
    categorySecondary: '',
    categoryKey: 'unkategorisiert',
    subcategoryKey: 'unkategorisiert',
    priceCurrent: { amount: 1.99, currency: 'EUR' },
    quantityText: '1 Packung',
    status: 'active',
    isActiveNow: true,
    validTo: '2099-12-31T23:59:59.999Z',
  };
  const cases = [
    ['SanLucar Pflaumen-Mix', 'Lebensmittel', 'Obst & Gemuese'],
    ['Kirschen', 'Lebensmittel', 'Obst & Gemuese'],
    ['SanLucar Plattpfirsich', 'Lebensmittel', 'Obst & Gemuese'],
    ['Drautaler Scheiben', 'Lebensmittel', 'Kaese'],
    ['Keringer Heideboden On Ice', 'Getraenke', 'Wein & Sekt'],
    ['Efko Pikantes Weisskraut Burger & BQ', 'Lebensmittel', 'Pasta, Reis & Konserven'],
    ['Pikantes Weisskraut Burger & BQ', 'Lebensmittel', 'Pasta, Reis & Konserven'],
    ['Weisskraut Burger & BQ', 'Lebensmittel', 'Pasta, Reis & Konserven'],
  ];

  for (const [title, categoryPrimary, categorySecondary] of cases) {
    const ranked = buildRankedOffer(offer({
      ...baseBillaFlyer,
      title,
    }));

    assert.equal(ranked.categoryPrimary, categoryPrimary, title);
    assert.equal(ranked.categorySecondary, categorySecondary, title);
    assert.equal(ranked.displayCategory, categorySecondary, title);
  }

  const provence = buildRankedOffer(offer({
    ...baseBillaFlyer,
    title: 'Provence AOP',
    description: 'Rosewein 0,75-l-Flasche',
  }));
  const vagueProvence = buildRankedOffer(offer({
    ...baseBillaFlyer,
    title: 'Provence AOP',
  }));
  const alreadyCorrect = buildRankedOffer(offer({
    ...baseBillaFlyer,
    title: 'Kirschen',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Obst & Gemuese',
    categoryKey: 'obst-gemuese',
    subcategoryKey: 'obst-gemuese',
  }));
  const spar = buildRankedOffer(offer({
    ...baseBillaFlyer,
    retailerKey: 'spar',
    retailerName: 'SPAR',
    sourceType: 'spar-official-pdf',
    sourceTypes: ['spar-official-pdf'],
    rawFacts: { sourceType: 'spar-official-pdf' },
    title: 'SanLucar Pflaumen-Mix',
  }));
  const visible = filterFreshActiveOffers([
    offer({ ...baseBillaFlyer, _id: 'good', title: 'Kirschen' }),
    offer({ ...baseBillaFlyer, _id: 'fragment', title: 'geschnitten' }),
    offer({ ...baseBillaFlyer, _id: 'fragment-od', title: 'od. geschnitten' }),
    offer({ ...baseBillaFlyer, _id: 'product-with-variant', title: 'Kaiserschnitzel vom STROHwohlschwein aus der Schale od. geschnitten' }),
    offer({
      ...baseBillaFlyer,
      _id: 'no-price',
      title: 'SanLucar Pflaumen-Mix',
      priceCurrent: {},
      normalizedUnitPrice: {},
    }),
  ], new Date('2026-07-05T12:00:00.000Z'));

  assert.equal(provence.categoryPrimary, 'Getraenke');
  assert.equal(provence.categorySecondary, 'Wein & Sekt');
  assert.equal(vagueProvence.categoryPrimary, 'Unkategorisiert');
  assert.equal(alreadyCorrect.categoryPrimary, 'Lebensmittel');
  assert.equal(alreadyCorrect.categorySecondary, 'Obst & Gemuese');
  assert.equal(spar.categoryPrimary, 'Unkategorisiert');
  assert.deepEqual(visible.map((item) => item._id), ['good', 'product-with-variant']);
});

test('ranking response corrects stale active categories from remaining category feedback clusters', () => {
  const cases = [
    {
      title: 'Face Beard 6-in-1 Multi Trimmer',
      retailerKey: 'bipa',
      categoryPrimary: 'Baby / Kinder',
      categorySecondary: 'Babybedarf',
      expectedPrimary: 'Drogerie / Hygiene',
      expectedSecondary: 'Rasur',
      guard: 'bipa-grooming-device',
    },
    {
      title: 'Burgit Anti H\u00fchneraugen Stift',
      retailerKey: 'bipa',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      expectedPrimary: 'Drogerie / Hygiene',
      expectedSecondary: 'Gesundheit & Nahrungsergaenzung',
      guard: 'bipa-corn-remover',
    },
    {
      title: 'Hof Cat Hof Cat Bio Fisch',
      retailerKey: 'billa-plus',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      expectedPrimary: 'Tierbedarf',
      expectedSecondary: 'Katzenfutter',
      guard: 'billa-plus-hof-cat',
    },
    {
      title: 'BBQ Marinierter Grillkaese, BBQ',
      retailerKey: 'hofer',
      categoryPrimary: 'Technik / Elektronik',
      categorySecondary: 'Kuechengeraete',
      expectedPrimary: 'Lebensmittel',
      expectedSecondary: 'Kaese',
      guard: 'hofer-grillkaese',
    },
    {
      title: 'CHOCEUR Schoko & Keks, Milch',
      retailerKey: 'hofer',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Milchprodukte',
      expectedPrimary: 'Lebensmittel',
      expectedSecondary: 'Suesswaren & Knabbereien',
      guard: 'hofer-chocolate',
    },
    {
      title: 'MILSANI Pizzakaese',
      retailerKey: 'hofer',
      categoryPrimary: 'Unkategorisiert',
      categorySecondary: '',
      expectedPrimary: 'Lebensmittel',
      expectedSecondary: 'Kaese',
      guard: 'hofer-milsani-kaese',
    },
    {
      title: 'SAMSUNG Galaxy A26-5G',
      retailerKey: 'hofer',
      categoryPrimary: 'Unkategorisiert',
      categorySecondary: '',
      expectedPrimary: 'Technik / Elektronik',
      expectedSecondary: 'Handys & Router',
      guard: 'hofer-mobile-phone',
    },
    {
      title: 'Bio Limetten',
      retailerKey: 'lidl',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Sonstiges',
      expectedPrimary: 'Lebensmittel',
      expectedSecondary: 'Obst & Gemuese',
      guard: 'lidl-limetten',
    },
    {
      title: 'PARKSIDE Herren kurze Arbeitsbundhose',
      retailerKey: 'lidl',
      categoryPrimary: 'Technik / Elektronik',
      categorySecondary: 'Werkzeug & Akkus',
      expectedPrimary: 'Kleidung / Mode',
      expectedSecondary: 'Herrenbekleidung',
      guard: 'lidl-parkside-workwear',
    },
  ];

  for (const item of cases) {
    const ranked = buildRankedOffer(offer({
      retailerName: item.retailerKey,
      retailerKey: item.retailerKey,
      title: item.title,
      categoryPrimary: item.categoryPrimary,
      categorySecondary: item.categorySecondary,
      categoryKey: 'stale',
      subcategoryKey: 'stale',
      rawFacts: {},
    }));

    assert.equal(ranked.categoryPrimary, item.expectedPrimary, item.title);
    assert.equal(ranked.categorySecondary, item.expectedSecondary, item.title);
    assert.equal(ranked.displayCategory, item.expectedSecondary, item.title);
    assert.notEqual(ranked.categoryKey, 'stale', item.title);
    assert.notEqual(ranked.subcategoryKey, 'stale', item.title);
  }
});

test('specific room scent and cat litter queries remain findable', () => {
  const roomScent = offer({
    title: 'Raumduft Lavendel',
    categoryPrimary: 'Haushalt',
    categorySecondary: 'Lufterfrischer & Raumduft',
    searchTokens: ['raumduft', 'lufterfrischer'],
  });
  const litter = offer({
    title: 'ZooRoyal Ultra Klumpstreu Pinienduft 5 Liter',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Katzenstreu & Pflege',
    searchTokens: ['zooroyal', 'klumpstreu', 'pinienduft', 'katzenstreu'],
  });
  const softener = offer({
    title: 'Duftspueler Frische',
    categoryPrimary: 'Haushalt',
    categorySecondary: 'Waschmittel & Reiniger',
    searchTokens: ['duftspueler', 'weichspueler'],
  });

  assert.equal(applyQueryMatch([roomScent], 'raumduft')[0].title, roomScent.title);
  assert.equal(applyQueryMatch([litter], 'katzenstreu')[0].title, litter.title);
  assert.equal(applyQueryMatch([litter], 'pinienduft')[0].title, litter.title);
  assert.equal(applyQueryMatch([softener], 'duftspueler')[0].title, softener.title);
});

test('multi-term ranking prefers offers covering all original query terms via strong fields and search tokens', () => {
  const fullIntent = offer({
    title: 'ZZZ Milka Aktion',
    brand: 'Milka',
    searchTokens: ['milka', 'schokolade'],
    searchTokenVersion: 2,
  });
  const brandOnly = offer({
    title: 'Milka Geschenkpackung',
    brand: 'Milka',
    searchTokens: ['milka'],
    searchTokenVersion: 2,
  });
  const productOnly = offer({
    title: 'Alpenmilch Schokolade',
    categorySecondary: 'Schokolade',
    searchTokens: ['schokolade'],
    searchTokenVersion: 2,
  });
  const rankedTitles = applyQueryMatch([brandOnly, productOnly, fullIntent], 'milka schokolade')
    .map((item) => item.title);

  assert.equal(rankedTitles[0], 'ZZZ Milka Aktion');
  assert.equal(rankedTitles.includes('Milka Geschenkpackung'), true);
  assert.equal(rankedTitles.includes('Alpenmilch Schokolade'), true);
  assert.deepEqual(calculateOfferTermCoverage(fullIntent, 'milka schokolade'), {
    bucket: 3,
    coveredTerms: 2,
    totalTerms: 2,
    strongTerms: 2,
    mediumTerms: 0,
    directTerms: 2,
    sourceScore: 6,
  });
});

test('multi-term ranking prefers brand plus product type over brand-only hits without dropping partials', () => {
  const fullIntent = offer({
    title: 'Ariel Waschmittel Pulver',
    brand: 'Ariel',
    categorySecondary: 'Waschmittel',
    searchText: 'ariel waschmittel drogerie',
  });
  const brandOnly = offer({
    title: 'Ariel Pods Color',
    brand: 'Ariel',
    searchText: 'ariel pods',
  });
  const productOnly = offer({
    title: 'Universal Waschmittel',
    categorySecondary: 'Waschmittel',
    searchText: 'waschmittel drogerie',
  });
  const ranked = applyQueryMatch([brandOnly, productOnly, fullIntent], 'ariel waschmittel');

  assert.equal(ranked[0].title, 'Ariel Waschmittel Pulver');
  assert.deepEqual(new Set(ranked.map((item) => item.title)), new Set([
    'Ariel Waschmittel Pulver',
    'Ariel Pods Color',
    'Universal Waschmittel',
  ]));
});

test('multi-term coverage keeps cautious synonym matches and category-only partials searchable', () => {
  const synonymFull = offer({
    title: 'Caffe Crema Ganze Bohnen',
    categorySecondary: 'Kaffee & Tee',
    searchTokens: ['caffe', 'bohnen'],
    searchTokenVersion: 2,
  });
  const categoryPartial = offer({
    title: 'Jacobs Filterkaffee gemahlen',
    categorySecondary: 'Kaffee & Tee',
    searchText: 'kaffee getraenke',
    searchTokens: ['kaffee'],
    searchTokenVersion: 2,
  });
  const ranked = applyQueryMatch([categoryPartial, synonymFull], 'kaffee bohnen');

  assert.equal(ranked[0].title, 'Caffe Crema Ganze Bohnen');
  assert.equal(ranked.some((item) => item.title === 'Jacobs Filterkaffee gemahlen'), true);
  assert.equal(calculateOfferTermCoverage(synonymFull, 'kaffee bohnen').bucket, 3);
  assert.equal(calculateOfferTermCoverage(categoryPartial, 'kaffee bohnen').bucket, 1);
});

test('term coverage treats meaningful packaging terms defensively for beer dose queries', () => {
  const canBeer = offer({
    title: 'Ottakringer Helles 0.5 l Dose',
    categorySecondary: 'Bier',
    searchText: 'bier dose getraenke',
  });
  const bottleBeer = offer({
    title: 'Goesser Maerzen Flasche',
    categorySecondary: 'Bier',
    searchText: 'bier getraenke',
  });
  const ranked = applyQueryMatch([bottleBeer, canBeer], 'bier dose');

  assert.equal(ranked[0].title, 'Ottakringer Helles 0.5 l Dose');
  assert.equal(calculateOfferTermCoverage(canBeer, 'bier dose').bucket, 3);
  assert.equal(calculateOfferTermCoverage(bottleBeer, 'bier dose').bucket, 1);
});

test('single-term searches do not receive a term coverage bucket', () => {
  const coffee = offer({
    title: 'Lavazza Kaffee',
    categorySecondary: 'Kaffee & Tee',
    searchTokens: ['kaffee', 'caffe'],
    searchTokenVersion: 2,
  });

  assert.equal(calculateOfferTermCoverage(coffee, 'kaffee').bucket, 0);
  assert.equal(applyQueryMatch([coffee], 'kaffee')[0].title, 'Lavazza Kaffee');
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

test('ranked offer suppresses unsafe multibuy block reference savings in public response', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'puntigamer-unsafe-block-reference',
    title: 'Puntigamer Maerzen',
    retailerKey: 'billa',
    retailerName: 'Billa',
    priceCurrent: { amount: 0.77, currency: 'EUR' },
    priceReference: { amount: 11.54, currency: 'EUR' },
    priceReferenceSource: 'prospect',
    priceReferenceConfidence: 0.95,
    savingsDisplayType: 'prospect-saving',
    savingsAmount: 258.48,
    savingsPercent: 93.33,
    conditionsText: 'Extrem Aktion; 12+12 gratis; bei 24 Dosen je 0,77 / 12+12 gratis / bei 24 Dosen',
    minimumPurchaseQty: 24,
    isMultiBuy: true,
    effectiveDiscountType: 'multi-buy',
    rawFacts: {
      minimumPurchaseQuantity: 24,
    },
    quantityText: '0,5 Liter / 1 DOSE',
    totalComparableAmount: 0.5,
    comparableUnit: 'l',
    normalizedUnitPrice: { amount: 0.15, unit: 'l', comparable: true, confidence: 0.86 },
    quality: { comparisonSafe: true },
  }), 0.15, 1.49);

  assert.equal(ranked.minimumPurchaseQuantity, 24);
  assert.equal(ranked.savingsAmount, 18.48);
  assert.equal(ranked.savings.amount, 18.48);
  assert.equal(ranked.savings.basis, 'derived_x_plus_y_block');
  assert.equal(ranked.savings.isApproximate, true);
  assert.equal(ranked.referencePrice.amount, null);
  assert.equal(ranked.referencePrice.allowsSavings, false);
  assert.equal(ranked.referencePrice.unsafeReason, 'block-reference-price-not-unit-safe');
  assert.notEqual(ranked.savingsAmount, 258.48);
});

test('ranked offer hides public unit price for clear free-item multibuy mechanics', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'bipa-oral-b-zahnpasta-2plus1',
    title: 'Oral-B Zahnpasta',
    brand: 'Oral-B',
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    priceCurrent: { amount: 4.79, currency: 'EUR' },
    conditionsText: 'Gilt ab 3 Stueck; 2+1 Gratis',
    minimumPurchaseQty: 3,
    isMultiBuy: true,
    effectiveDiscountType: 'multi-buy',
    quantityText: '75 ml',
    unitValue: 75,
    unitType: 'ml',
    totalComparableAmount: 0.075,
    comparableUnit: 'l',
    normalizedUnitPrice: { amount: 63.87, unit: 'l', comparable: true, confidence: 0.9 },
    quality: { comparisonSafe: true },
  }), 42.58, 63.87);

  assert.equal(ranked.normalizedUnitPrice.amount, null);
  assert.equal(ranked.normalizedUnitPrice.unit, '');
  assert.equal(ranked.normalizedUnitPrice.comparable, false);
  assert.equal(ranked.totalComparableAmount, 0.075);
  assert.equal(ranked.minimumPurchaseQty, 3);
});

test('ranked offer keeps public unit price for same product without gratis mechanic', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'bipa-oral-b-zahnpasta-single',
    title: 'Oral-B Zahnpasta',
    brand: 'Oral-B',
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    priceCurrent: { amount: 4.79, currency: 'EUR' },
    conditionsText: 'Gilt ab 3 Stueck',
    minimumPurchaseQty: 3,
    isMultiBuy: false,
    effectiveDiscountType: 'threshold',
    quantityText: '75 ml',
    unitValue: 75,
    unitType: 'ml',
    totalComparableAmount: 0.075,
    comparableUnit: 'l',
    normalizedUnitPrice: { amount: 63.87, unit: 'l', comparable: true, confidence: 0.9 },
    quality: { comparisonSafe: true },
  }), 63.87, 63.87);

  assert.equal(ranked.normalizedUnitPrice.amount, 63.87);
  assert.equal(ranked.normalizedUnitPrice.unit, 'l');
  assert.equal(ranked.normalizedUnitPrice.comparable, true);
});

test('ranked offer keeps public piece unit price for threshold-only Sensodyne pack', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'bipa-sensodyne-3-stueck',
    title: 'Sensodyne Zahnpasta 3 Stueck',
    brand: 'Sensodyne',
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    priceCurrent: { amount: 8.99, currency: 'EUR' },
    conditionsText: 'Gilt ab 3 Stueck',
    minimumPurchaseQty: 3,
    isMultiBuy: false,
    effectiveDiscountType: 'threshold',
    quantityText: '3 Stueck',
    unitValue: 3,
    unitType: 'Stk',
    totalComparableAmount: 3,
    comparableUnit: 'Stk',
    normalizedUnitPrice: { amount: 3, unit: 'Stk', comparable: true, confidence: 0.9 },
    quality: { comparisonSafe: true },
  }), 3, 3);

  assert.equal(ranked.normalizedUnitPrice.amount, 3);
  assert.equal(ranked.normalizedUnitPrice.unit, 'Stk');
  assert.equal(ranked.normalizedUnitPrice.comparable, true);
});

test('ranked offer recalculates quantity but hides public unit price for free-item mechanics', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'goesser-naturradler-billa-plus-6plus6',
    title: 'Goesser Maerzen Naturradler od. Naturradler 0,0 6+6',
    retailerKey: 'billa-plus',
    retailerName: 'BILLA Plus',
    sourceType: 'billa-official-flyer-pdf',
    sourceTypes: ['billa-official-flyer-pdf'],
    rawFacts: {
      sourceType: 'billa-official-flyer-pdf',
      sourceKey: 'billa-official-flyer-pdf',
    },
    priceCurrent: { amount: 0.79, currency: 'EUR' },
    conditionsText: 'Gilt ab 12 Stueck; 6+6 gratis',
    minimumPurchaseQty: 12,
    isMultiBuy: true,
    effectiveDiscountType: 'multi-buy',
    quantityText: '0,5 l',
    unitValue: 0.5,
    unitType: 'l',
    packCount: 1,
    totalComparableAmount: 5,
    comparableUnit: 'l',
    normalizedUnitPrice: { amount: 0.16, unit: 'l', comparable: true, confidence: 0.86 },
    quality: { comparisonSafe: true },
  }), 0.16, 1.99);

  assert.equal(ranked.quantityText, '0,5 l');
  assert.equal(ranked.totalComparableAmount, 0.5);
  assert.equal(ranked.comparableUnit, 'l');
  assert.equal(ranked.normalizedUnitPrice.amount, null);
  assert.equal(ranked.normalizedUnitPrice.unit, '');
  assert.equal(ranked.normalizedUnitPrice.comparable, false);
  assert.notEqual(ranked.normalizedUnitPrice.amount, 0.16);
  assert.notEqual(ranked.normalizedUnitPrice.amount, 0.19);
});

test('ranked offer computes standard liter unit prices from explicit product quantities', () => {
  const cases = [
    ['penny-075', 0.33, '0,75 l', 0.75, 0.44],
    ['half-liter', 0.79, '0,5 l', 0.5, 1.58],
    ['large-bottle', 1.49, '1,5 l', 1.5, 0.99],
    ['wine-ml', 2.99, '750 ml', 0.75, 3.99],
    ['can-ml', 0.99, '330 ml', 0.33, 3],
  ];

  for (const [id, price, quantityText, expectedAmount, expectedUnitPrice] of cases) {
    const ranked = buildRankedOffer(offer({
      _id: id,
      title: `Getraenk ${id}`,
      priceCurrent: { amount: price, currency: 'EUR' },
      quantityText,
      totalComparableAmount: null,
      comparableUnit: '',
      normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
      quality: { comparisonSafe: false },
    }), null, null);

    assert.equal(ranked.totalComparableAmount, expectedAmount, id);
    assert.equal(ranked.comparableUnit, 'l', id);
    assert.equal(ranked.normalizedUnitPrice.amount, expectedUnitPrice, id);
  }
});

test('ranked offer drops unsafe threshold block savings without clear gratis mechanic', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'threshold-unsafe-block-reference',
    title: 'Blockangebot ohne klare Gratis-Mechanik',
    retailerKey: 'billa',
    retailerName: 'Billa',
    priceCurrent: { amount: 0.77, currency: 'EUR' },
    priceReference: { amount: 11.54, currency: 'EUR' },
    priceReferenceSource: 'prospect',
    savingsDisplayType: 'prospect-saving',
    savingsAmount: 258.48,
    conditionsText: 'Gilt ab 24 Dosen / bei 24 Dosen je 0,77',
    minimumPurchaseQty: 24,
    isMultiBuy: true,
    effectiveDiscountType: 'multi-buy',
    normalizedUnitPrice: { amount: 0.15, unit: 'l', comparable: true, confidence: 0.86 },
    quality: { comparisonSafe: true },
  }), 0.15, 1.49);

  assert.equal(ranked.savingsAmount, null);
  assert.equal(ranked.savings.amount, null);
  assert.equal(ranked.savings.label, 'Aktionspreis');
  assert.equal(ranked.referencePrice.amount, null);
  assert.equal(ranked.referencePrice.unsafeReason, 'block-reference-price-not-unit-safe');
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

test('generic pet queries exclude Felix filled paprika but keep real Felix cat food', () => {
  const filledPaprika = offer({
    _id: 'felix-paprika',
    title: 'Felix Felix Gef\u00fcllte Paprika',
    brand: 'Felix',
    retailerKey: 'billa-plus',
    retailerName: 'BILLA Plus',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Katzenfutter',
    categoryKey: 'katzenfutter',
    subcategoryKey: 'katzenfutter',
    searchText: 'felix felix gef\u00fcllte paprika tierbedarf katzenfutter',
  });
  const catFood = offer({
    _id: 'felix-cat-food',
    title: 'Felix Katzennahrung 12 x 85 g',
    brand: 'Felix',
    retailerKey: 'billa-plus',
    retailerName: 'BILLA Plus',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Katzenfutter',
    categoryKey: 'katzenfutter',
    subcategoryKey: 'katzenfutter',
    searchText: 'felix katzennahrung katzenfutter tierbedarf',
  });

  assert.equal(scoreOfferAgainstQuery(filledPaprika, 'tierbedarf'), 0);
  assert.ok(scoreOfferAgainstQuery(catFood, 'tierbedarf') > 0);
  assert.deepEqual(applyQueryMatch([filledPaprika, catFood], 'tierbedarf').map((item) => item._id), [
    'felix-cat-food',
  ]);
  assert.ok(scoreOfferAgainstQuery(filledPaprika, 'Felix Gef\u00fcllte Paprika') > 0);
  assert.deepEqual(applyQueryMatch([filledPaprika], 'Felix Gef\u00fcllte Paprika').map((item) => item._id), [
    'felix-paprika',
  ]);
});

test('BILLA Felix filled paprika response category is guarded back to human food', () => {
  for (const retailerKey of ['billa', 'billa-plus']) {
    const ranked = buildRankedOffer(offer({
      title: 'Felix Felix Gef\u00fcllte Paprika',
      brand: 'Felix',
      retailerKey,
      retailerName: retailerKey === 'billa' ? 'BILLA' : 'BILLA Plus',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenfutter',
      categoryKey: 'katzenfutter',
      subcategoryKey: 'katzenfutter',
      searchText: 'felix felix gef\u00fcllte paprika tierbedarf katzenfutter',
    }));

    assert.equal(ranked.categoryPrimary, 'Lebensmittel');
    assert.equal(ranked.categorySecondary, 'Pasta, Reis & Konserven');
    assert.equal(ranked.categoryKey, 'pasta-reis-konserven');
  }
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

test('human food intent downranks pet food for fish and meat terms without hiding it', () => {
  const offers = [
    offer({
      title: 'Sheba Fresh&Fine in Sauce Lachs und Thunfisch',
      brand: 'Sheba',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenfutter',
      comparisonGroup: 'sheba-katzenfutter-lachs-thunfisch::0.3-kg',
    }),
    offer({
      title: 'BILLA Bio Raeucherlachs',
      brand: 'BILLA Bio',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'billa-bio-raeucherlachs::0.1-kg',
    }),
    offer({
      title: 'Vitakraft Liquid Snack mit Lachs',
      brand: 'Vitakraft',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'vitakraft-liquid-snack-lachs::6-Stk',
    }),
  ];

  const sortedTitles = applyQueryMatch(offers, 'lachs').map((item) => item.title);

  assert.equal(sortedTitles[0], 'BILLA Bio Raeucherlachs');
  assert.ok(sortedTitles.includes('Sheba Fresh&Fine in Sauce Lachs und Thunfisch'));
  assert.ok(sortedTitles.includes('Vitakraft Liquid Snack mit Lachs'));
  assert.ok(sortedTitles.indexOf('Sheba Fresh&Fine in Sauce Lachs und Thunfisch') > 0);
  assert.ok(sortedTitles.indexOf('Vitakraft Liquid Snack mit Lachs') > 0);
});

test('human thunfisch outranks Sheba cat food for thunfisch intent', () => {
  const offers = [
    offer({
      title: 'Sheba Fresh&Fine in Sauce Lachs und Thunfisch',
      brand: 'Sheba',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenfutter',
      comparisonGroup: 'sheba-katzenfutter-lachs-thunfisch::0.3-kg',
    }),
    offer({
      title: 'Orlando MSC Thunfisch in Salzlake',
      brand: 'Orlando',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'orlando-thunfisch-salzlake::0.185-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'thunfisch').map((item) => item.title);

  assert.deepEqual(sortedTitles, [
    'Orlando MSC Thunfisch in Salzlake',
    'Sheba Fresh&Fine in Sauce Lachs und Thunfisch',
  ]);
});

test('explicit pet food intent keeps pet food above human food controls', () => {
  const offers = [
    offer({
      title: 'BILLA Bio Raeucherlachs',
      brand: 'BILLA Bio',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'billa-bio-raeucherlachs::0.1-kg',
    }),
    offer({
      title: 'Sheba Fresh&Fine in Sauce Lachs und Thunfisch',
      brand: 'Sheba',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenfutter',
      comparisonGroup: 'sheba-katzenfutter-lachs-thunfisch::0.3-kg',
    }),
  ];

  assert.equal(applyQueryMatch(offers, 'katzenfutter lachs')[0].title, 'Sheba Fresh&Fine in Sauce Lachs und Thunfisch');
  assert.equal(applyQueryMatch(offers, 'sheba lachs')[0].title, 'Sheba Fresh&Fine in Sauce Lachs und Thunfisch');
});

test('Vitakraft pet food is detected despite misleading human food category', () => {
  const offers = [
    offer({
      title: 'Puten-Kaesekrainer',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'puten-kaesekrainer::0.3-kg',
    }),
    offer({
      title: 'Beef Stick mit Pute',
      brand: 'Vitakraft',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'vitakraft-beef-stick-pute::1-Stk',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'pute').map((item) => item.title);

  assert.deepEqual(sortedTitles, [
    'Puten-Kaesekrainer',
    'Beef Stick mit Pute',
  ]);
});

test('human food pet downrank leaves garnelen wurst and schinken controls stable', () => {
  const offers = [
    offer({
      title: 'Iglo Backteig Garnelen',
      brand: 'Iglo',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'iglo-backteig-garnelen::0.275-kg',
    }),
    offer({
      title: 'Felix Crispies Garnelen',
      brand: 'Felix',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenfutter',
      comparisonGroup: 'felix-crispies-garnelen::0.06-kg',
    }),
    offer({
      title: 'Heurigenschinken',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'heurigenschinken::0.1-kg',
    }),
    offer({
      title: 'Liquid Snack mit Leberwurst',
      brand: 'Vitakraft',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      comparisonGroup: 'vitakraft-liquid-snack-leberwurst::1-Stk',
    }),
    offer({
      title: 'Kantwurst oder ungarische Salami',
      brand: 'Reiter',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch & Wurst',
      comparisonGroup: 'kantwurst-salami::0.2-kg',
    }),
  ];

  assert.equal(applyQueryMatch(offers, 'garnelen')[0].title, 'Iglo Backteig Garnelen');
  assert.equal(applyQueryMatch(offers, 'wurst')[0].title, 'Kantwurst oder ungarische Salami');
  assert.equal(applyQueryMatch(offers, 'schinken')[0].title, 'Heurigenschinken');
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

test('fisch search ranks fish and seafood products ahead of meat and sausage category side hits', () => {
  const offers = [
    offer({
      title: 'Hendl Schnitzerl',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'hendl-schnitzerl::0.4-kg',
    }),
    offer({
      title: 'TANN Salami',
      brand: 'TANN',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'tann-salami::0.1-kg',
    }),
    offer({
      title: 'Schweins Schnitzel',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'schweins-schnitzel::0.5-kg',
    }),
    offer({
      title: 'Rindsgulasch Fleisch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'rindsgulasch-fleisch::0.5-kg',
    }),
    offer({
      title: 'Thunfisch in Oel',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'thunfisch-in-oel::0.195-kg',
    }),
    offer({
      title: 'Lachsfilet frisch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'lachsfilet-frisch::0.25-kg',
    }),
    offer({
      title: 'Forellen Filet geraeuchert',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'forellen-filet::0.125-kg',
    }),
    offer({
      title: 'Garnelen gekocht',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'garnelen-gekocht::0.2-kg',
    }),
    offer({
      title: 'Fischfilet paniert',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Tiefkuehl',
      comparisonGroup: 'fischfilet-paniert::0.45-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'fisch').map((item) => item.title);

  assert.deepEqual(new Set(sortedTitles.slice(0, 5)), new Set([
    'Fischfilet paniert',
    'Forellen Filet geraeuchert',
    'Garnelen gekocht',
    'Lachsfilet frisch',
    'Thunfisch in Oel',
  ]));

  for (const sideHit of ['Hendl Schnitzerl', 'TANN Salami', 'Schweins Schnitzel', 'Rindsgulasch Fleisch']) {
    assert.ok(sortedTitles.indexOf(sideHit) > sortedTitles.indexOf('Thunfisch in Oel'));
  }
});

test('fisch category-only signal stays weak while explicit Thunfisch remains relevant', () => {
  const thunfisch = offer({
    title: 'Thunfisch',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'thunfisch::0.195-kg',
  });
  const hendl = offer({
    title: 'Hendl Schnitzerl',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'hendl-schnitzerl::0.4-kg',
  });
  const categoryOnly = offer({
    title: 'Sortiment Angebot',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'sortiment-angebot::1-stueck',
  });
  const sortedTitles = applyQueryMatch([categoryOnly, hendl, thunfisch], 'fisch').map((item) => item.title);

  assert.equal(scoreOfferAgainstQuery(categoryOnly, 'fisch') > 0, true);
  assert.equal(scoreOfferAgainstQuery(thunfisch, 'fisch') > scoreOfferAgainstQuery(categoryOnly, 'fisch'), true);
  assert.equal(scoreOfferAgainstQuery(thunfisch, 'fisch') > scoreOfferAgainstQuery(hendl, 'fisch'), true);
  assert.deepEqual(sortedTitles, [
    'Thunfisch',
    'Hendl Schnitzerl',
    'Sortiment Angebot',
  ]);
});

test('fisch context keeps fleisch, lachs, schnitzel, wurst, tee and multi-word controls searchable', () => {
  const fish = offer({
    title: 'Lachsfilet frisch',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'lachsfilet-frisch::0.25-kg',
  });
  const meat = offer({
    title: 'Rindsgulasch Fleisch',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'rindsgulasch-fleisch::0.5-kg',
  });
  const schnitzel = offer({
    title: 'Schweins Schnitzel',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'schweins-schnitzel::0.5-kg',
  });
  const sausage = offer({
    title: 'Haussalami geschnitten',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'haussalami-geschnitten::0.15-kg',
  });
  const tea = offer({
    title: 'Teekanne Fruechtetee',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'teekanne-fruechtetee::20-stueck',
  });
  const coffee = offer({
    title: 'Lavazza Kaffee Bohnen',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'lavazza-kaffee-bohnen::1-kg',
  });

  assert.ok(applyQueryMatch([fish, meat, schnitzel, sausage], 'fleisch').some((item) => item.title === 'Rindsgulasch Fleisch'));
  assert.deepEqual(applyQueryMatch([meat, fish], 'lachs').map((item) => item.title), ['Lachsfilet frisch']);
  assert.deepEqual(applyQueryMatch([fish, schnitzel], 'schnitzel').map((item) => item.title), ['Schweins Schnitzel']);
  assert.deepEqual(applyQueryMatch([fish, sausage], 'wurst').map((item) => item.title), [
    'Haussalami geschnitten',
    'Lachsfilet frisch',
  ]);
  assert.deepEqual(applyQueryMatch([coffee, tea], 'tee').map((item) => item.title), [
    'Teekanne Fruechtetee',
    'Lavazza Kaffee Bohnen',
  ]);
  assert.deepEqual(applyQueryMatch([fish, meat], 'lachs frisch').map((item) => item.title), ['Lachsfilet frisch']);
});

test('wurst search ranks sausage and cold-cut products ahead of category-only fish and meat hits', () => {
  const offers = [
    offer({
      title: 'Lachsfilet frisch',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'lachsfilet-frisch::0.25-kg',
    }),
    offer({
      title: 'Huhnerschnitzel paniert',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'huhnerschnitzel-paniert::0.4-kg',
      imageUrl: '',
    }),
    offer({
      title: 'TANN Salami',
      brand: 'TANN',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'tann-salami::0.1-kg',
    }),
    offer({
      title: 'Frankfurter Wuerstel',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'frankfurter-wuerstel::0.3-kg',
    }),
    offer({
      title: 'BBQ Grillwurst-Mix',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'bbq-grillwurst-mix::0.6-kg',
    }),
    offer({
      title: 'Schinken Aufschnitt',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'schinken-aufschnitt::0.2-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'wurst').map((item) => item.title);

  assert.deepEqual(new Set(sortedTitles.slice(0, 4)), new Set([
    'BBQ Grillwurst-Mix',
    'Frankfurter Wuerstel',
    'Schinken Aufschnitt',
    'TANN Salami',
  ]));
  assert.ok(sortedTitles.indexOf('Lachsfilet frisch') > sortedTitles.indexOf('TANN Salami'));
  assert.ok(sortedTitles.indexOf('Huhnerschnitzel paniert') > sortedTitles.indexOf('Frankfurter Wuerstel'));
  assert.equal(sortedTitles.includes('Lachsfilet frisch'), true);
  assert.equal(sortedTitles.includes('Huhnerschnitzel paniert'), true);
});

test('wurst category remains a weak signal without outranking explicit salami', () => {
  const offers = [
    offer({
      title: 'Kategorie-Angebot Fleischplatte',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'fleischplatte::0.5-kg',
    }),
    offer({
      title: 'Haussalami geschnitten',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Fleisch, Wurst & Fisch',
      comparisonGroup: 'haussalami-geschnitten::0.15-kg',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'wurst').map((item) => item.title);

  assert.deepEqual(sortedTitles, [
    'Haussalami geschnitten',
    'Kategorie-Angebot Fleischplatte',
  ]);
});

test('wurst intent demotes bakery cheese side hits behind real sausage products', () => {
  const butterCroissant = offer({
    title: 'Schinken-Kaese-Buttercroissant SPAR 1 Stueck',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'schinken-kaese-buttercroissant::1-stueck',
  });
  const tannSalami = offer({
    title: 'TANN Salami SPAR',
    brand: 'TANN',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'tann-salami::0.1-kg',
    searchText: 'spar tann salami wurst',
  });
  const cabanossi = offer({
    title: 'Cabanossi SPAR',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'cabanossi::0.3-kg',
    searchText: 'spar cabanossi wurst',
  });
  const frankfurter = offer({
    title: 'Frankfurter Wuerstel SPAR',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'frankfurter-wuerstel::0.3-kg',
    searchText: 'spar frankfurter wurst',
  });

  for (const query of ['wurst', 'spar wurst']) {
    const sortedTitles = applyQueryMatch([butterCroissant, tannSalami, cabanossi, frankfurter], query)
      .map((item) => item.title);

    assert.ok(sortedTitles.indexOf('Schinken-Kaese-Buttercroissant SPAR 1 Stueck') > 2, query);
    assert.deepEqual(new Set(sortedTitles.slice(0, 3)), new Set([
      'Cabanossi SPAR',
      'Frankfurter Wuerstel SPAR',
      'TANN Salami SPAR',
    ]), query);
  }

  assert.equal(applyQueryMatch([butterCroissant, tannSalami], 'tann')[0].title, 'TANN Salami SPAR');
  assert.equal(applyQueryMatch([butterCroissant, tannSalami], 'salami')[0].title, 'TANN Salami SPAR');
  assert.equal(applyQueryMatch([butterCroissant, cabanossi], 'cabanossi')[0].title, 'Cabanossi SPAR');
  assert.equal(
    applyQueryMatch([tannSalami, butterCroissant], 'schinken kaese buttercroissant')[0].title,
    'Schinken-Kaese-Buttercroissant SPAR 1 Stueck'
  );
});

test('wurst intent demotes cheese, prepared speck and snack side hits behind sausage products', () => {
  const cheeseAufschnitt = offer({
    title: 'Schaerdinger 3-Kaese Aufschnitt',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Kaese',
    comparisonGroup: 'schaerdinger-3-kaese-aufschnitt::0.15-kg',
  });
  const speckSoup = offer({
    title: 'Knorr Kartoffel-Lauchsuppe mit Speck',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'knorr-kartoffel-lauchsuppe-speck::1-stk',
  });
  const baconBalls = offer({
    title: 'Bacon Balls Gouda',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Kaese',
    comparisonGroup: 'bacon-balls-gouda::1-stk',
  });
  const salamiWrap = offer({
    title: 'Knabber Nossi Salami Wrap',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Brot & Gebaeck',
    comparisonGroup: 'knabber-nossi-salami-wrap::0.035-kg',
  });
  const extrawurst = offer({
    title: 'TANN Extrawurst',
    brand: 'TANN',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'tann-extrawurst::0.5-kg',
  });
  const frankfurter = offer({
    title: 'Frankfurter Wuerstel',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'frankfurter-wuerstel::0.3-kg',
  });
  const cabanossi = offer({
    title: 'Cabanossi Classic mit Kaese',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Kaese',
    comparisonGroup: 'cabanossi-classic-kaese::0.3-kg',
  });
  const salami = offer({
    title: 'Frische Salami od. Kantwurst',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'frische-salami-kantwurst::0.1-kg',
  });
  const sortedTitles = applyQueryMatch([
    cheeseAufschnitt,
    speckSoup,
    baconBalls,
    salamiWrap,
    extrawurst,
    frankfurter,
    cabanossi,
    salami,
  ], 'wurst').map((item) => item.title);
  const rankOf = (title) => {
    const index = sortedTitles.indexOf(title);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };

  assert.deepEqual(new Set(sortedTitles.slice(0, 4)), new Set([
    'Cabanossi Classic mit Kaese',
    'Frische Salami od. Kantwurst',
    'Frankfurter Wuerstel',
    'TANN Extrawurst',
  ]));
  for (const sideHit of [
    'Bacon Balls Gouda',
    'Knabber Nossi Salami Wrap',
    'Knorr Kartoffel-Lauchsuppe mit Speck',
    'Schaerdinger 3-Kaese Aufschnitt',
  ]) {
    assert.ok(rankOf(sideHit) > 3, sideHit);
  }
});

test('specific side-hit queries remain findable after wurst demotion', () => {
  const cheeseAufschnitt = offer({
    title: 'Schaerdinger 3-Kaese Aufschnitt',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Kaese',
    comparisonGroup: 'schaerdinger-3-kaese-aufschnitt::0.15-kg',
  });
  const speckSoup = offer({
    title: 'Knorr Kartoffel-Lauchsuppe mit Speck',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Saucen, Oele & Gewuerze',
    comparisonGroup: 'knorr-kartoffel-lauchsuppe-speck::1-stk',
  });
  const cabanossi = offer({
    title: 'Cabanossi Classic mit Kaese',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Kaese',
    comparisonGroup: 'cabanossi-classic-kaese::0.3-kg',
  });
  const salami = offer({
    title: 'Frische Salami od. Kantwurst',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'frische-salami-kantwurst::0.1-kg',
  });
  const frankfurter = offer({
    title: 'Frankfurter Wuerstel',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    comparisonGroup: 'frankfurter-wuerstel::0.3-kg',
  });

  assert.equal(applyQueryMatch([salami, cabanossi], 'cabanossi')[0].title, 'Cabanossi Classic mit Kaese');
  assert.equal(applyQueryMatch([salami, speckSoup], 'speck')[0].title, 'Knorr Kartoffel-Lauchsuppe mit Speck');
  assert.equal(applyQueryMatch([salami, speckSoup], 'knorr')[0].title, 'Knorr Kartoffel-Lauchsuppe mit Speck');
  assert.equal(applyQueryMatch([salami, cheeseAufschnitt], 'kaese aufschnitt')[0].title, 'Schaerdinger 3-Kaese Aufschnitt');
  assert.equal(applyQueryMatch([cheeseAufschnitt, salami], 'salami')[0].title, 'Frische Salami od. Kantwurst');
  assert.equal(applyQueryMatch([cheeseAufschnitt, frankfurter], 'frankfurter')[0].title, 'Frankfurter Wuerstel');
});

test('tee search ranks real tea products ahead of coffee category side hits', () => {
  const offers = [
    offer({
      title: 'Lavazza Nespressokompatible Alukapseln',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      comparisonGroup: 'lavazza-kapseln::30-stueck',
    }),
    offer({
      title: 'Jacobs Cafe Crema Ganze Bohne',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      comparisonGroup: 'jacobs-cafe-crema-bohne::1-kg',
    }),
    offer({
      title: 'Nescafe Eiskaffee div. Sorten',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      comparisonGroup: 'nescafe-eiskaffee::0.25-l',
    }),
    offer({
      title: 'Greenland Kidneybohnen',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      comparisonGroup: 'greenland-kidneybohnen::0.8-kg',
    }),
    offer({
      title: 'Teekanne Fruechtetee',
      brand: 'Teekanne',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      comparisonGroup: 'teekanne-fruechtetee::20-stueck',
    }),
    offer({
      title: 'Ceylon-Tee',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      comparisonGroup: 'ceylon-tee::25-stueck',
    }),
    offer({
      title: 'Westminster Schwarzer Tee',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      comparisonGroup: 'westminster-schwarzer-tee::25-stueck',
    }),
    offer({
      title: 'Kraeutertee Kamille',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      comparisonGroup: 'kraeutertee-kamille::20-stueck',
    }),
    offer({
      title: 'Eistee Gruener-Tee Zitrone',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Softdrinks & Energy',
      comparisonGroup: 'eistee-gruener-tee-zitrone::1-l',
    }),
  ];
  const sortedTitles = applyQueryMatch(offers, 'tee').map((item) => item.title);

  assert.deepEqual(new Set(sortedTitles.slice(0, 5)), new Set([
    'Ceylon-Tee',
    'Eistee Gruener-Tee Zitrone',
    'Kraeutertee Kamille',
    'Teekanne Fruechtetee',
    'Westminster Schwarzer Tee',
  ]));
  assert.ok(sortedTitles.indexOf('Lavazza Nespressokompatible Alukapseln') > sortedTitles.indexOf('Ceylon-Tee'));
  assert.ok(sortedTitles.indexOf('Jacobs Cafe Crema Ganze Bohne') > sortedTitles.indexOf('Westminster Schwarzer Tee'));
  assert.ok(sortedTitles.indexOf('Nescafe Eiskaffee div. Sorten') > sortedTitles.indexOf('Eistee Gruener-Tee Zitrone'));
  assert.ok(sortedTitles.indexOf('Greenland Kidneybohnen') > sortedTitles.indexOf('Teekanne Fruechtetee'));
});

test('tee search treats Teebutter and category-only coffee tea pages as weak signals', () => {
  const teebeutel = offer({
    title: 'Teekanne Teebeutel Kamillentee',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'teekanne-teebeutel-kamillentee::20-stueck',
  });
  const teebutter = offer({
    title: 'Oesterreichische Teebutter',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'oesterreichische-teebutter::0.25-kg',
  });
  const categoryOnly = offer({
    title: 'Sortiment Angebot',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'sortiment-angebot::1-stueck',
  });
  const sortedTitles = applyQueryMatch([categoryOnly, teebutter, teebeutel], 'tee').map((item) => item.title);

  assert.equal(scoreOfferAgainstQuery(teebutter, 'tee'), 0);
  assert.deepEqual(sortedTitles, [
    'Teekanne Teebeutel Kamillentee',
    'Sortiment Angebot',
  ]);
});

test('tee context does not regress kaffee or eistee queries', () => {
  const coffee = offer({
    title: 'Lavazza Kaffee Bohnen',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'lavazza-kaffee-bohnen::1-kg',
  });
  const tea = offer({
    title: 'Ceylon-Tee',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'ceylon-tee::25-stueck',
  });
  const icedTea = offer({
    title: 'Eistee Gruener-Tee Zitrone',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Softdrinks & Energy',
    comparisonGroup: 'eistee-gruener-tee-zitrone::1-l',
  });

  assert.deepEqual(applyQueryMatch([tea, coffee], 'kaffee').map((item) => item.title), [
    'Lavazza Kaffee Bohnen',
  ]);
  assert.deepEqual(applyQueryMatch([coffee, icedTea], 'eistee').map((item) => item.title), [
    'Eistee Gruener-Tee Zitrone',
  ]);
});

test('kaffee search excludes tea and category-only coffee-tea side hits without hiding tea searches', () => {
  const coffee = offer({
    title: 'Lavazza Kaffee Bohnen',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'lavazza-kaffee-bohnen::1-kg',
  });
  const icedTea = offer({
    title: 'S-BUDGET Eistee Pfirsich SPAR',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 's-budget-eistee-pfirsich::1.5-l',
    searchText: 'spar eistee tee getraenke',
  });
  const categoryOnly = offer({
    title: 'Sortiment Angebot SPAR',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'sortiment-angebot::1-stueck',
    searchText: 'spar kaffee tee getraenke',
  });

  assert.deepEqual(applyQueryMatch([icedTea, categoryOnly, coffee], 'kaffee').map((item) => item.title), [
    'Lavazza Kaffee Bohnen',
  ]);
  assert.deepEqual(applyQueryMatch([categoryOnly], 'spar kaffee').map((item) => item.title), []);
  assert.deepEqual(applyQueryMatch([icedTea], 'spar kaffee').map((item) => item.title), []);
  assert.equal(applyQueryMatch([coffee, icedTea], 'tee')[0].title, 'S-BUDGET Eistee Pfirsich SPAR');
  assert.equal(applyQueryMatch([coffee, icedTea], 'eistee')[0].title, 'S-BUDGET Eistee Pfirsich SPAR');
});

test('kaffee searches keep specific coffee products findable and reject cosmetic espresso side hits', () => {
  const espresso = offer({
    title: 'Lavazza Espresso Italiano Classico',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'lavazza-espresso-italiano::0.25-kg',
  });
  const capsules = offer({
    title: 'Nespresso Kaffee Kapseln',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'nespresso-kaffee-kapseln::10-stueck',
  });
  const caffeCrema = offer({
    title: 'Jacobs Caffe Crema Ganze Bohnen',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'jacobs-caffe-crema-bohnen::1-kg',
  });
  const jacobs = offer({
    title: 'Jacobs Auslese Klassisch Pads',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'jacobs-auslese-pads::0.25-kg',
  });
  const juliusMeinl = offer({
    title: 'Julius Meinl Praesident gemahlen',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'julius-meinl-praesident::0.5-kg',
  });
  const eyeliner = offer({
    title: 'Gel Eyeliner Cozy Chic Espresso',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Kosmetik & Make-up',
    comparisonGroup: 'gel-eyeliner-espresso::1-stueck',
  });

  assert.equal(applyQueryMatch([eyeliner, espresso], 'espresso')[0].title, 'Lavazza Espresso Italiano Classico');
  assert.equal(applyQueryMatch([eyeliner], 'espresso').length, 0);
  assert.equal(applyQueryMatch([eyeliner, capsules], 'kaffeekapseln')[0].title, 'Nespresso Kaffee Kapseln');
  assert.equal(applyQueryMatch([eyeliner, caffeCrema], 'caffe crema')[0].title, 'Jacobs Caffe Crema Ganze Bohnen');
  assert.equal(applyQueryMatch([eyeliner, jacobs], 'jacobs')[0].title, 'Jacobs Auslese Klassisch Pads');
  assert.equal(applyQueryMatch([eyeliner, espresso], 'lavazza')[0].title, 'Lavazza Espresso Italiano Classico');
  assert.equal(applyQueryMatch([eyeliner, juliusMeinl], 'julius meinl')[0].title, 'Julius Meinl Praesident gemahlen');
});

test('generic kaffee search keeps exact coffee brands visible before broad direct coffee titles', () => {
  const broadCoffee = offer({
    title: 'Dallmayr Prodomo Entcoffeiniert Kaffee gemahlen',
    brand: 'Dallmayr',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'dallmayr-prodomo-kaffee-gemahlen::0.5-kg',
  });
  const lavazza = offer({
    title: 'Lavazza Espresso Cremoso',
    brand: 'Lavazza',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'lavazza-espresso-cremoso::1-kg',
    sourceType: 'spar-official-pdf',
  });
  const eistee = offer({
    title: 'Jana Eistee Waldfrucht Preiselbeere',
    brand: 'Jana',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'jana-eistee-waldfrucht-preiselbeere::0.5-l',
    sourceType: 'spar-official-pdf',
  });
  const eyeliner = offer({
    title: 'Gel Eyeliner Cozy Chic Espresso',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Kosmetik & Make-up',
    comparisonGroup: 'gel-eyeliner-espresso::1-stueck',
  });

  assert.equal(applyQueryMatch([broadCoffee, lavazza], 'kaffee')[0].title, 'Lavazza Espresso Cremoso');
  assert.equal(applyQueryMatch([eyeliner, lavazza], 'kaffee')[0].title, 'Lavazza Espresso Cremoso');
  assert.equal(applyQueryMatch([eyeliner], 'kaffee').length, 0);
  assert.deepEqual(applyQueryMatch([eistee], 'kaffee'), []);
});

test('coffee searches keep Teebutter from winning through coffee tea category signals', () => {
  const teebutter = offer({
    title: 'Oesterreichische Teebutter SPAR',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'oesterreichische-teebutter::0.25-kg',
    searchText: 'spar teebutter butter kaffee tee',
  });
  const sparCoffee = offer({
    title: 'Lavazza Kaffee Bohnen SPAR',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'lavazza-kaffee-bohnen::1-kg',
    searchText: 'spar lavazza kaffee bohnen',
  });
  const tea = offer({
    title: 'Teekanne Teebeutel Schwarztee SPAR',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'teekanne-teebeutel-schwarztee::20-stueck',
    searchText: 'spar tee teebeutel schwarztee',
  });

  assert.equal(applyQueryMatch([teebutter, sparCoffee], 'spar kaffee')[0].title, 'Lavazza Kaffee Bohnen SPAR');
  assert.equal(applyQueryMatch([teebutter, sparCoffee], 'kaffee')[0].title, 'Lavazza Kaffee Bohnen SPAR');
  assert.equal(applyQueryMatch([teebutter, tea], 'tee')[0].title, 'Teekanne Teebeutel Schwarztee SPAR');
  assert.equal(applyQueryMatch([sparCoffee, teebutter], 'butter')[0].title, 'Oesterreichische Teebutter SPAR');
  assert.equal(applyQueryMatch([teebutter], 'spar kaffee').length, 0);
  assert.equal(calculateOfferTermCoverage(teebutter, 'spar kaffee').coveredTerms, 0);
  assert.ok(scoreOfferAgainstQuery(teebutter, 'kaffee') < scoreOfferAgainstQuery(sparCoffee, 'kaffee'));
  assert.ok(scoreOfferAgainstQuery(teebutter, 'tee') < scoreOfferAgainstQuery(tea, 'tee'));
});

test('single-word core product searches keep direct product matches searchable', () => {
  const directProductOffers = [
    ['kaffee', offer({ title: 'Lavazza Kaffee Bohnen', categorySecondary: 'Kaffee & Tee' })],
    ['bier', offer({ title: 'Goesser Maerzen Bier', categorySecondary: 'Bier' })],
    ['duschgel', offer({ title: 'Nivea Duschgel', categorySecondary: 'Koerperpflege' })],
    ['zahnpasta', offer({ title: 'Elmex Zahnpasta', categorySecondary: 'Mundpflege' })],
  ];

  for (const [query, directOffer] of directProductOffers) {
    assert.equal(applyQueryMatch([directOffer], query).length, 1);
    assert.ok(scoreOfferAgainstQuery(directOffer, query) > 0);
  }
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

test('BILLA action HTML price-window evidence remains visible ahead of Algolia snapshot', () => {
  const algolia = offer({
    _id: 'dallmayr-algolia',
    title: 'Dallmayr Prodomo 500 g',
    retailerKey: 'billa',
    sourceType: 'offers-page',
    rawFacts: { sourceType: 'billa-official-algolia' },
    priceCurrent: { amount: 11.99 },
    quantityText: '500 g',
    normalizedUnitPrice: { amount: 23.98, unit: 'kg', comparable: true },
    conditionsText: '',
    status: 'active',
    isActiveNow: true,
    validTo: null,
    searchText: 'dallmayr prodomo 500 g billa',
  });
  const actionHtml = offer({
    ...algolia,
    _id: 'dallmayr-action-html',
    rawFacts: { sourceType: 'billa-official-action-html' },
    priceCurrent: { amount: 8.99 },
    normalizedUnitPrice: { amount: 17.98, unit: 'kg', comparable: true },
    conditionsText: 'Preisfenster Freitag und Samstag',
    validFrom: new Date('2026-06-11T22:00:00.000Z'),
    validTo: new Date('2026-06-13T21:59:59.999Z'),
    searchText: 'dallmayr prodomo 500 g billa preisfenster freitag samstag',
  });

  const ranked = [algolia, actionHtml].sort((a, b) => compareOffersByRanking(a, b, {
    query: 'Dallmayr Prodomo',
  }));
  const rankedOffer = buildRankedOffer(actionHtml, 17.98, 23.98);

  assert.equal(ranked[0]._id, 'dallmayr-action-html');
  assert.equal(rankedOffer.sourceType, 'billa-official-action-html');
  assert.deepEqual(rankedOffer.sourceTypes.sort(), ['billa-official-action-html', 'offers-page']);
});

test('BILLA action HTML price-window evidence does not outrank Algolia when inactive', () => {
  const algolia = offer({
    _id: 'dallmayr-algolia',
    title: 'Dallmayr Prodomo 500 g',
    retailerKey: 'billa',
    sourceType: 'offers-page',
    rawFacts: { sourceType: 'billa-official-algolia' },
    priceCurrent: { amount: 11.99 },
    quantityText: '500 g',
    normalizedUnitPrice: { amount: 23.98, unit: 'kg', comparable: true },
    conditionsText: '',
    status: 'active',
    isActiveNow: true,
    searchText: 'dallmayr prodomo 500 g billa',
  });
  const inactiveActionHtml = offer({
    ...algolia,
    _id: 'dallmayr-action-html-inactive',
    rawFacts: { sourceType: 'billa-official-action-html' },
    priceCurrent: { amount: 8.99 },
    normalizedUnitPrice: { amount: 17.98, unit: 'kg', comparable: true },
    conditionsText: 'Preisfenster Freitag und Samstag',
    status: 'upcoming',
    isActiveNow: false,
    validFrom: new Date('2026-06-15T22:00:00.000Z'),
    validTo: new Date('2026-06-17T21:59:59.999Z'),
    searchText: 'dallmayr prodomo 500 g billa preisfenster freitag samstag',
  });

  const ranked = [algolia, inactiveActionHtml].sort((a, b) => compareOffersByRanking(a, b, {
    query: 'Dallmayr Prodomo',
  }));

  assert.equal(ranked[0]._id, 'dallmayr-algolia');
});

test('BILLA Algolia-only query result remains visible', () => {
  const algolia = offer({
    _id: 'dallmayr-algolia',
    title: 'Dallmayr Prodomo Ganze Bohne',
    retailerKey: 'billa',
    sourceType: 'offers-page',
    rawFacts: { sourceType: 'billa-official-algolia' },
    priceCurrent: { amount: 11.99 },
    quantityText: '500 g',
    normalizedUnitPrice: { amount: 23.98, unit: 'kg', comparable: true },
    conditionsText: '',
    status: 'active',
    isActiveNow: true,
    searchText: 'dallmayr prodomo ganze bohne 500 g billa',
  });

  const prepared = prepareQueryOffersForResponse([algolia], 'dallmayr prodomo');

  assert.deepEqual(prepared.map((item) => item._id), ['dallmayr-algolia']);
});

test('BILLA adjacent duplicate rotation keeps current primary evidence ahead of Algolia variants', () => {
  const base = {
    title: 'Dallmayr Prodomo',
    retailerKey: 'billa',
    sourceType: 'offers-page',
    priceCurrent: { amount: 8.99 },
    quantityText: '500 g',
    normalizedUnitPrice: { amount: 17.98, unit: 'kg', comparable: true },
    conditionsText: 'Preisfenster Freitag und Samstag',
    status: 'active',
    isActiveNow: true,
    validFrom: new Date('2026-06-11T22:00:00.000Z'),
    validTo: new Date('2026-06-13T21:59:59.999Z'),
    searchText: 'dallmayr prodomo 500 g billa preisfenster freitag samstag',
  };
  const billaAction = offer({
    ...base,
    _id: 'dallmayr-action-billa',
    rawFacts: { sourceType: 'billa-official-action-html' },
  });
  const billaPlusAction = offer({
    ...base,
    _id: 'dallmayr-action-billa-plus',
    retailerKey: 'billa-plus',
    rawFacts: { sourceType: 'billa-official-action-html' },
  });
  const algolia = offer({
    ...base,
    _id: 'dallmayr-algolia',
    title: 'Dallmayr Dallmayr Prodomo Ganze Bohne',
    rawFacts: { sourceType: 'billa-official-algolia' },
    priceCurrent: { amount: 11.99 },
    normalizedUnitPrice: { amount: 23.98, unit: 'kg', comparable: true },
    conditionsText: '',
    validFrom: null,
    validTo: null,
    searchText: 'dallmayr prodomo ganze bohne 500 g billa',
  });

  const prepared = prepareQueryOffersForResponse([billaAction, billaPlusAction, algolia], 'dallmayr prodomo');

  assert.deepEqual(prepared.map((item) => item._id), [
    'dallmayr-action-billa',
    'dallmayr-action-billa-plus',
    'dallmayr-algolia',
  ]);
});

test('BILLA response dedupe prefers exact action HTML evidence over same-price Algolia duplicate', () => {
  const algolia = offer({
    _id: 'dallmayr-algolia',
    title: 'Dallmayr Prodomo 500 g',
    retailerKey: 'billa',
    sourceType: 'offers-page',
    rawFacts: { sourceType: 'billa-official-algolia' },
    priceCurrent: { amount: 8.99 },
    quantityText: '500 g',
    normalizedUnitPrice: { amount: 17.98, unit: 'kg', comparable: true },
    conditionsText: 'Preisfenster Freitag und Samstag',
    validTo: null,
  });
  const actionHtml = offer({
    ...algolia,
    _id: 'dallmayr-action-html',
    rawFacts: { sourceType: 'billa-official-action-html' },
    conditionsText: 'Preisfenster Freitag und Samstag',
  });

  const prepared = dedupeResponseOffers([algolia, actionHtml], 'dallmayr prodomo');

  assert.deepEqual(prepared.map((item) => item._id), ['dallmayr-action-html']);
});

test('fresh active filter removes expired and stale offers but keeps recent missing-validTo snapshots', () => {
  const now = new Date('2026-05-21T12:00:00.000Z');
  const current = offer({
    title: 'BILLA Snapshot aktuell',
    status: 'active',
    isActiveNow: true,
    validTo: null,
    lastSeenAt: new Date('2026-05-21T08:00:00.000Z'),
    sourceId: 'billa-source',
    crawlRunId: 'billa-run',
    crawlJobId: 'billa-job',
    lastSeenSourceRunId: 'billa-job',
    sourceRunStatus: 'success',
    publishStatus: 'crawl-run-success',
    sourceType: 'billa-official-algolia',
    rawFacts: { snapshotCurrent: true, freshnessTtlHours: 72 },
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

test('fresh active filter hides stale retained Aktionsfinder offers without validTo', () => {
  const now = new Date('2026-06-03T12:00:00.000Z');
  const staleAggregator = offer({
    title: 'Holy Slice Pizza BILLA 1 Stueck',
    status: 'active',
    isActiveNow: true,
    sourceType: 'aktionsfinder-json',
    sourceTypes: ['aktionsfinder-json', 'aggregator'],
    publishStatus: 'crawl-run-stale',
    validTo: null,
    lastSeenAt: new Date('2026-06-03T08:00:00.000Z'),
    lastSeenRunId: 'old-retained-run',
    crawlJobId: 'old-retained-job',
    priceCurrent: { amount: 2.99 },
    quantityText: '1 Stk',
    comparableUnit: 'Stk',
  });

  assert.deepEqual(filterFreshActiveOffers([staleAggregator], now), []);
});

test('fresh active filter hides unknown Aktionsfinder offers without strong freshness evidence', () => {
  const now = new Date('2026-06-03T12:00:00.000Z');
  const unknownAggregator = offer({
    title: 'Holy Slice Pizza BILLA 1 Stueck',
    status: 'active',
    isActiveNow: true,
    sourceType: 'aktionsfinder-json',
    publishStatus: 'unknown',
    validTo: null,
    lastSeenAt: new Date('2026-06-03T08:00:00.000Z'),
    lastSeenRunId: 'fresh-run-but-not-published-current',
    crawlJobId: 'fresh-job',
    priceCurrent: { amount: 2.99 },
    quantityText: '1 Stk',
    comparableUnit: 'Stk',
  });

  assert.deepEqual(filterFreshActiveOffers([unknownAggregator], now), []);
});

test('fresh active filter keeps aggregator offers with future validTo visible', () => {
  const now = new Date('2026-06-03T12:00:00.000Z');
  const futureAggregator = offer({
    title: 'Aktionsfinder Angebot mit Enddatum',
    status: 'active',
    isActiveNow: true,
    sourceType: 'aktionsfinder-json',
    publishStatus: 'crawl-run-stale',
    validTo: new Date('2026-06-04T21:59:59.999Z'),
    priceCurrent: { amount: 1.99 },
    quantityText: '1 Stk',
  });

  assert.deepEqual(filterFreshActiveOffers([futureAggregator], now), [futureAggregator]);
});

test('fresh active filter keeps official offers with valid current validity visible', () => {
  const now = new Date('2026-06-03T12:00:00.000Z');
  const official = offer({
    title: 'BILLA Official Kaffee 500 g',
    status: 'active',
    isActiveNow: true,
    sourceType: 'billa-official-algolia',
    publishStatus: 'crawl-run-partial',
    validFrom: new Date('2026-06-01T00:00:00.000Z'),
    validTo: new Date('2026-06-04T21:59:59.999Z'),
    priceCurrent: { amount: 4.99 },
    quantityText: '500 g',
  });

  assert.deepEqual(filterFreshActiveOffers([official], now), [official]);
});

test('fresh active filter hides expired validTo even with fresh crawl evidence', () => {
  const now = new Date('2026-06-03T12:00:00.000Z');
  const expired = offer({
    title: 'Aktionsfinder abgelaufen',
    status: 'active',
    isActiveNow: true,
    sourceType: 'aktionsfinder-json',
    publishStatus: 'crawl-run-success',
    validTo: new Date('2026-06-02T21:59:59.999Z'),
    lastSeenAt: new Date('2026-06-03T08:00:00.000Z'),
    lastSeenRunId: 'fresh-run',
    crawlJobId: 'fresh-job',
    priceCurrent: { amount: 1.99 },
    quantityText: '1 Stk',
  });

  assert.deepEqual(filterFreshActiveOffers([expired], now), []);
});

test('ranking visibility remains compatible with legacy offers without CrawlRun lineage', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'legacy-offer',
    title: 'Legacy Kaffee',
    status: 'active',
    isActiveNow: true,
    crawlRunId: null,
    publishStatus: undefined,
  }), 1, 2);

  assert.equal(ranked.id, 'legacy-offer');
  assert.equal(ranked.status, 'active');
  assert.equal(ranked.isActiveNow, true);
  assert.equal(ranked.crawlRunId, null);
  assert.equal(ranked.publishStatus, 'unknown');
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
    sourceId: 'billa-source',
    crawlRunId: 'billa-run',
    crawlJobId: 'billa-job',
    lastSeenSourceRunId: 'billa-job',
    sourceRunStatus: 'success',
    publishStatus: 'crawl-run-success',
    rawFacts: { snapshotCurrent: true, freshnessTtlHours: 72 },
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
    publishStatus: 'crawl-run-success',
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

  const quality = classifyOfferSourceQuality(freshPpcv, now);

  assert.equal(quality.sourceClass, 'aggregator-ppcv');
  assert.equal(quality.hasFreshCrawlEvidence, true);
  assert.equal(quality.validityConfidence, 'low');
  assert.equal(quality.freshnessConfidence, 'high');
  assert.equal(quality.sourceQualityRisk, '');
  assert.deepEqual(filterFreshActiveOffers([freshPpcv], now), []);
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
    publishStatus: 'crawl-run-success',
  };

  assert.deepEqual(filterFreshActiveOffers([expiredWithoutRecrawl], now), []);
  assert.deepEqual(filterFreshActiveOffers([recrawledAfterOldValidTo], now), []);
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
    publishStatus: 'crawl-run-success',
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

  assert.deepEqual(filterFreshActiveOffers([visibleCondition], now), []);
  assert.deepEqual(filterFreshActiveOffers([hiddenCondition], now), []);
});

test('cached browse response filters Holy-like stale Aggregator offers before public response mapping', () => {
  const staleHoly = offer({
    _id: 'holy-stale',
    id: 'holy-stale',
    title: 'Holy Slice Pizza BILLA 1 Stueck',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    status: 'active',
    isActiveNow: true,
    sourceType: 'aktionsfinder-json',
    sourceTypes: ['aktionsfinder-json', 'aggregator'],
    publishStatus: 'crawl-run-stale',
    validTo: null,
    lastSeenAt: new Date('2026-06-03T08:00:00.000Z'),
    lastSeenRunId: 'old-retained-run',
    crawlJobId: 'old-retained-job',
    priceCurrent: { amount: 2.99 },
    quantityText: '1 Stk',
    normalizedUnitPrice: { amount: 2.99, unit: 'Stk', comparable: true },
    quality: { comparisonSafe: true },
  });
  const official = offer({
    _id: 'official-visible',
    id: 'official-visible',
    title: 'BILLA Kaffee 500 g',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    status: 'active',
    isActiveNow: true,
    sourceType: 'billa-official-algolia',
    publishStatus: 'crawl-run-partial',
    validTo: new Date(Date.now() + 24 * 60 * 60 * 1000),
    priceCurrent: { amount: 4.99 },
    quantityText: '500 g',
    normalizedUnitPrice: { amount: 9.98, unit: 'kg', comparable: true },
    quality: { comparisonSafe: true },
  });
  const response = buildRankingResponseFromBase({
    base: {
      visibleOffers: [staleHoly, official],
      categoryDocuments: [],
      retailerOptions: [],
      candidateCount: 2,
      candidateLimit: 100,
      resultCount: 2,
    },
    query: 'holy',
    safeLimit: 30,
  });

  assert.equal(response.rankedOffers.some((item) => /holy/i.test(item.title)), false);
  assert.equal(response.rankedOffers.length, 1);
  assert.equal(response.rankedOffers[0].id, 'official-visible');
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

test('weak Aggregator offers stay visible but rank below trusted official PDF evidence', () => {
  const aggregator = sparOffer({
    _id: 'spar-aggregator-weak-butter',
    title: 'Oesterreichische Teebutter SPAR 250 Gramm 1 Packung',
    brand: 'Schaerdinger',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    categoryKey: 'butter',
    searchText: 'spar teebutter butter 250 gramm',
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/ppcv/butter/spar/',
    rawFacts: { sourceKey: 'aktionsfinder-spar', sourceType: 'aktionsfinder-json' },
    imageUrl: 'https://img.example.test/butter.jpg',
    validFrom: null,
    validTo: null,
    conditionsText: '',
    hasConditions: false,
    isMultiBuy: false,
  });
  const officialPdf = sparPdfOffer({
    _id: 'spar-official-trusted-butter',
    title: 'Oesterreichische Teebutter',
    brand: 'Schaerdinger',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    categoryKey: 'butter',
    searchText: 'spar teebutter butter 250 gramm',
    quantityText: '250 g',
    sourceType: 'spar-official-pdf',
    rawFacts: { sourceKey: 'spar-official-flyer-pdf' },
    imageUrl: '',
    validFrom: '2026-05-27T22:00:00.000Z',
    validTo: '2026-06-02T21:59:59.999Z',
    conditionsText: 'Joker moeglich',
    hasConditions: true,
  });

  assert.deepEqual(applyQueryMatch([aggregator], 'spar butter').map((item) => item._id), [
    'spar-aggregator-weak-butter',
  ]);
  assert.deepEqual(applyQueryMatch([aggregator, officialPdf], 'spar butter').map((item) => item._id), [
    'spar-official-trusted-butter',
    'spar-aggregator-weak-butter',
  ]);
});

test('trusted official PDF stays ahead of weak Aggregator image-only match', () => {
  const officialPdf = offer({
    _id: 'spar-official-pdf-trusted-duplicate',
    title: 'Puntigamer Maerzen',
    titleNormalized: 'puntigamer maerzen',
    retailerKey: 'spar',
    sourceType: 'spar-official-pdf',
    rawFacts: { sourceKey: 'spar-official-flyer-pdf' },
    priceCurrent: { amount: 14.9 },
    quantityText: '20 x 0.5 l',
    normalizedUnitPrice: { amount: 1.49, unit: 'l', comparable: true },
    validFrom: new Date('2026-05-27T22:00:00.000Z'),
    validTo: new Date('2026-06-02T21:59:59.999Z'),
    conditionsText: 'Joker moeglich',
    hasConditions: true,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
  });
  const aggregator = {
    ...officialPdf,
    _id: 'spar-aktionsfinder-weak-duplicate',
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/ppcv/bier/spar/',
    rawFacts: { sourceKey: 'aktionsfinder-spar', sourceType: 'aktionsfinder-json' },
    imageUrl: 'https://img.example.test/puntigamer.jpg',
    validFrom: null,
    validTo: null,
    conditionsText: '',
    hasConditions: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
  };
  const ranked = [aggregator, officialPdf].sort((left, right) => compareOffersByRanking(left, right, { query: 'puntigamer' }));

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]._id, 'spar-official-pdf-trusted-duplicate');
});

test('broad SPAR-family Aggregator coverage remains searchable without trusted official duplicate', () => {
  const offers = [
    sparOffer({ _id: 'spar-coverage', retailerKey: 'spar', title: 'SPAR Olivenstange SPAR 1 Stueck', searchText: 'spar olivenstange' }),
    sparOffer({ _id: 'interspar-coverage', retailerKey: 'interspar', retailerName: 'INTERSPAR', title: 'Interspar Backstube Weckerl INTERSPAR 1 Stueck', searchText: 'interspar backstube weckerl' }),
    sparOffer({ _id: 'eurospar-coverage', retailerKey: 'eurospar', retailerName: 'EUROSPAR', title: 'EUROSPAR Kornsemmel EUROSPAR 1 Stueck', searchText: 'eurospar kornsemmel' }),
  ];

  assert.equal(applyQueryMatch(offers, 'spar').length > 0, true);
  assert.equal(applyQueryMatch(offers, 'interspar').length > 0, true);
  assert.equal(applyQueryMatch(offers, 'eurospar').length > 0, true);
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

test('final response dedupe merges official conditions into matching conditionless aggregator duplicate', () => {
  const aggregator = offer({
    _id: 'lindor-aggregator',
    title: 'Lindt Lindor Kugeln div. Sorten BILLA PLUS 500 Gramm 1 Packung',
    titleNormalized: 'lindt lindor kugeln div sorten billa plus 500 gramm 1 packung',
    retailerKey: 'billa-plus',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 7.99 },
    quantityText: '500 g',
    unitValue: 500,
    unitType: 'g',
    totalComparableAmount: 0.5,
    comparableUnit: 'kg',
    normalizedUnitPrice: { amount: 15.98, unit: 'kg', comparable: true },
    conditionsText: '',
    hasConditions: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    effectiveDiscountType: 'price-cut',
  });
  const official = offer({
    ...aggregator,
    _id: 'lindor-official',
    title: 'Lindt Lindor Kugeln',
    titleNormalized: 'lindt lindor kugeln',
    sourceType: 'billa-official-algolia',
    conditionsText: '1+1 gratis / ab 2 Packungen',
    hasConditions: true,
    isMultiBuy: true,
    minimumPurchaseQty: 2,
    effectiveDiscountType: 'multi-buy',
  });

  const prepared = dedupeFinalResponseOffers([aggregator, official], 'lindor');
  const ranked = buildRankedOffer(prepared[0], null, null);

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]._id, 'lindor-official');
  assert.equal(prepared[0].conditionsText, '1+1 gratis / ab 2 Packungen');
  assert.equal(prepared[0].hasConditions, true);
  assert.equal(prepared[0].isMultiBuy, true);
  assert.equal(prepared[0].minimumPurchaseQty, 2);
  assert.equal(prepared[0].effectiveDiscountType, 'multi-buy');
  assert.equal(ranked.conditionsText, '1+1 gratis / ab 2 Packungen');
});

test('final response dedupe does not invent conditions when official and aggregator duplicates are conditionless', () => {
  const aggregator = offer({
    _id: 'conditionless-aggregator',
    title: 'Bio Vollmilch 1 l',
    titleNormalized: 'bio vollmilch 1 l',
    retailerKey: 'billa',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 l',
    unitValue: 1,
    unitType: 'l',
    totalComparableAmount: 1,
    comparableUnit: 'l',
    normalizedUnitPrice: { amount: 1.49, unit: 'l', comparable: true },
    conditionsText: '',
    hasConditions: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
  });
  const official = offer({
    ...aggregator,
    _id: 'conditionless-official',
    sourceType: 'billa-official-algolia',
  });

  const prepared = dedupeFinalResponseOffers([aggregator, official], 'milch');

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]._id, 'conditionless-official');
  assert.equal(prepared[0].conditionsText, '');
  assert.equal(prepared[0].hasConditions, false);
  assert.equal(prepared[0].minimumPurchaseQty, 1);
});

test('final response condition merge keeps different package sizes separate', () => {
  const base = {
    title: 'Lindt Lindor Kugeln',
    titleNormalized: 'lindt lindor kugeln',
    retailerKey: 'billa-plus',
    priceCurrent: { amount: 7.99 },
    unitType: 'g',
    comparableUnit: 'kg',
    normalizedUnitPrice: { amount: 15.98, unit: 'kg', comparable: true },
  };
  const official = offer({
    ...base,
    _id: 'lindor-500g-official',
    sourceType: 'billa-official-algolia',
    quantityText: '500 g',
    unitValue: 500,
    totalComparableAmount: 0.5,
    conditionsText: '1+1 gratis / ab 2 Packungen',
    hasConditions: true,
    isMultiBuy: true,
    minimumPurchaseQty: 2,
    effectiveDiscountType: 'multi-buy',
  });
  const aggregator = offer({
    ...base,
    _id: 'lindor-250g-aggregator',
    sourceType: 'aktionsfinder-json',
    quantityText: '250 g',
    unitValue: 250,
    totalComparableAmount: 0.25,
    conditionsText: '',
    hasConditions: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    effectiveDiscountType: 'price-cut',
  });

  assert.equal(dedupeFinalResponseOffers([aggregator, official], 'lindor').length, 2);
});

test('final response condition merge keeps same title with different price or mechanic separate', () => {
  const base = {
    title: 'Lindt Lindor Kugeln',
    titleNormalized: 'lindt lindor kugeln',
    retailerKey: 'billa-plus',
    quantityText: '500 g',
    unitValue: 500,
    unitType: 'g',
    totalComparableAmount: 0.5,
    comparableUnit: 'kg',
    normalizedUnitPrice: { amount: 15.98, unit: 'kg', comparable: true },
  };
  const official = offer({
    ...base,
    _id: 'lindor-official-mechanic',
    sourceType: 'billa-official-algolia',
    priceCurrent: { amount: 7.99 },
    conditionsText: '1+1 gratis / ab 2 Packungen',
    hasConditions: true,
    isMultiBuy: true,
    minimumPurchaseQty: 2,
    effectiveDiscountType: 'multi-buy',
  });
  const otherPrice = offer({
    ...base,
    _id: 'lindor-other-price',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 8.99 },
    conditionsText: '',
    hasConditions: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    effectiveDiscountType: 'price-cut',
  });
  const otherMechanic = offer({
    ...base,
    _id: 'lindor-other-mechanic',
    sourceType: 'billa-official-algolia',
    priceCurrent: { amount: 7.99 },
    conditionsText: 'ab 3 Packungen',
    hasConditions: true,
    isMultiBuy: false,
    minimumPurchaseQty: 3,
    effectiveDiscountType: 'threshold',
  });

  assert.equal(dedupeFinalResponseOffers([official, otherPrice], 'lindor').length, 2);
  assert.equal(dedupeFinalResponseOffers([official, otherMechanic], 'lindor').length, 2);
});

test('final response condition merge prefers SPAR official PDF when structured duplicate data matches', () => {
  const aggregator = sparOffer({
    _id: 'puntigamer-aggregator',
    brand: 'Puntigamer',
    title: 'Puntigamer das bierige Bier SPAR 0.50 Liter 20 Stueck',
    titleNormalized: 'puntigamer das bierige bier spar 0 50 liter 20 stueck',
    priceCurrent: { amount: 14.9 },
    quantityText: '0.5 l / 20 stueck',
    unitValue: 0.5,
    unitType: 'l',
    packCount: 20,
    totalComparableAmount: 10,
    comparableUnit: 'l',
    normalizedUnitPrice: { amount: 1.49, unit: 'l', comparable: true },
    validFrom: null,
    validTo: null,
    conditionsText: '',
    hasConditions: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    effectiveDiscountType: 'price-cut',
  });
  const officialPdf = sparPdfOffer({
    _id: 'puntigamer-official-pdf',
    brand: 'Puntigamer',
    title: 'Puntigamer das bierige Bier',
    titleNormalized: 'puntigamer das bierige bier',
    priceCurrent: { amount: 14.9 },
    quantityText: '0.5 l / 20 stueck',
    unitValue: 0.5,
    unitType: 'l',
    packCount: 20,
    totalComparableAmount: 10,
    comparableUnit: 'l',
    normalizedUnitPrice: { amount: 1.49, unit: 'l', comparable: true },
    conditionsText: '1+1 gratis / ab 2 Kisten je 14,90',
    hasConditions: true,
    isMultiBuy: true,
    minimumPurchaseQty: 2,
    effectiveDiscountType: 'multi-buy',
  });

  const prepared = dedupeFinalResponseOffers([aggregator, officialPdf], 'bier');

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]._id, 'puntigamer-official-pdf');
  assert.equal(prepared[0].sourceType, 'spar-official-pdf');
  assert.equal(prepared[0].conditionsText, '1+1 gratis / ab 2 Kisten je 14,90');
  assert.equal(prepared[0].isMultiBuy, true);
  assert.equal(prepared[0].minimumPurchaseQty, 2);
});

test('final response condition merge does not guess PENNY image-only conditions', () => {
  const official = offer({
    _id: 'penny-image-only-official',
    title: 'Coca-Cola Original od. Zero',
    titleNormalized: 'coca cola original od zero',
    retailerKey: 'penny',
    sourceType: 'penny-official-html',
    priceCurrent: { amount: 1.49 },
    quantityText: '1 flasche',
    unitValue: 1,
    unitType: 'flasche',
    totalComparableAmount: 1,
    comparableUnit: 'flasche',
    normalizedUnitPrice: { amount: 1.49, unit: 'flasche', comparable: true },
    conditionsText: '',
    hasConditions: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
  });
  const aggregator = offer({
    ...official,
    _id: 'penny-image-only-aggregator',
    sourceType: 'aktionsfinder-json',
  });

  const prepared = dedupeFinalResponseOffers([aggregator, official], 'cola');

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].conditionsText, '');
  assert.equal(prepared[0].hasConditions, false);
  assert.equal(prepared[0].minimumPurchaseQty, 1);
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

function arielDmAktionsfinderOffer(overrides = {}) {
  return offer({
    title: 'Ariel Waschmittel Fluessig div. Sorten 40 WL dm 1 Flasche',
    titleNormalized: 'ariel waschmittel fluessig div sorten 40 wl dm 1 flasche',
    retailerKey: 'dm',
    sourceType: 'aktionsfinder-json',
    priceCurrent: { amount: 11.65 },
    quantityText: '1 flasche',
    unitValue: 1,
    unitType: 'flasche',
    totalComparableAmount: 1,
    comparableUnit: 'flasche',
    normalizedUnitPrice: { amount: 11.65, unit: 'flasche', comparable: true },
    conditionsText: '',
    customerProgramRequired: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    validFrom: new Date('2026-04-30T00:00:00Z'),
    validTo: new Date('2026-06-02T00:00:00Z'),
    imageUrl: 'https://example.test/ariel.jpg',
    ...overrides,
  });
}

test('visible card dedupe collapses same-source duplicate when exactly one quantity is broken and the other is a simple pack quantity', () => {
  const broken = arielDmAktionsfinderOffer({
    _id: 'ariel-broken',
    quantityText: '$undefined WG / 1 Fl.',
    unitValue: null,
    unitType: '',
    totalComparableAmount: null,
    comparableUnit: '',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false },
  });
  const clean = arielDmAktionsfinderOffer({ _id: 'ariel-clean' });
  const result = dedupeVisibleCardResponseOffers([broken, clean], 'ariel waschmittel');

  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0]._id, 'ariel-clean');
});

test('visible card dedupe collapses live dm Ariel duplicate with polluted normalized title and broken quantity', () => {
  const liveTitle = 'Ariel Waschmittel Fluessig div. Sorten 40 WL dm 1 Flasche';
  const broken = arielDmAktionsfinderOffer({
    _id: '6a1231d917a69802d5088f30',
    title: liveTitle,
    titleNormalized: 'ariel ariel waschmittel fluessig div sorten 40 wl dm 1 flasche',
    brand: 'Ariel',
    packageType: 'pack',
    sourceTypes: ['aktionsfinder-json', 'aggregator'],
    sourceUrl: 'https://www.dm.at/p/d/3059061/ariel-colorwaschmittel-fluessig',
    quantityText: '$undefined WG / 1 Fl.',
    unitValue: null,
    unitType: 'WG',
    packCount: 1,
    totalComparableAmount: null,
    comparableUnit: '',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
    validFrom: new Date('2026-04-30T00:00:00Z'),
    validTo: new Date('2026-06-02T00:00:00Z'),
  });
  const clean = arielDmAktionsfinderOffer({
    _id: '6a1231d917a69802d5088f8b',
    title: liveTitle,
    titleNormalized: 'ariel waschmittel fluessig div sorten 40 wl dm 1 flasche',
    brand: '',
    packageType: 'pack',
    sourceTypes: ['aktionsfinder-json', 'aggregator'],
    sourceUrl: 'https://www.aktionsfinder.at/l/dm-drogerie-markt-30-04-2026-02-06-2026/',
    quantityText: '1 flasche',
    validFrom: new Date('2026-04-30T12:00:00Z'),
    validTo: new Date('2026-06-02T23:59:59.999Z'),
  });
  const result = dedupeVisibleCardResponseOffers([broken, clean], 'ariel waschmittel');

  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0]._id, '6a1231d917a69802d5088f8b');
});

test('visible card broken-quantity tolerance keeps one-sided brand variants when visible title does not confirm the brand', () => {
  const genericTitle = 'Waschmittel Fluessig div. Sorten 40 WL dm 1 Flasche';
  const broken = arielDmAktionsfinderOffer({
    _id: 'brand-variant-broken',
    title: genericTitle,
    titleNormalized: 'waschmittel fluessig div sorten 40 wl dm 1 flasche',
    brand: 'Ariel',
    packageType: 'pack',
    quantityText: '$undefined WG / 1 Fl.',
    unitValue: null,
    unitType: 'WG',
    packCount: 1,
    totalComparableAmount: null,
    comparableUnit: '',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
  });
  const clean = arielDmAktionsfinderOffer({
    _id: 'brand-variant-clean',
    title: genericTitle,
    titleNormalized: 'waschmittel fluessig div sorten 40 wl dm 1 flasche',
    brand: '',
    packageType: 'pack',
  });
  const result = dedupeVisibleCardResponseOffers([broken, clean], 'waschmittel');

  assert.equal(result.offers.length, 2);
});

test('visible card broken-quantity tolerance keeps price variants visible', () => {
  const broken = arielDmAktionsfinderOffer({
    _id: 'ariel-broken',
    quantityText: '$undefined WG / 1 Fl.',
    unitValue: null,
    unitType: '',
    totalComparableAmount: null,
    comparableUnit: '',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false },
  });
  const otherPrice = arielDmAktionsfinderOffer({
    _id: 'ariel-other-price',
    priceCurrent: { amount: 19.99 },
    normalizedUnitPrice: { amount: 19.99, unit: 'flasche', comparable: true },
  });
  const result = dedupeVisibleCardResponseOffers([broken, otherPrice], 'ariel waschmittel');

  assert.equal(result.offers.length, 2);
});

test('visible card broken-quantity tolerance keeps different retailers visible', () => {
  const broken = arielDmAktionsfinderOffer({
    _id: 'dm-broken',
    quantityText: '$undefined WG / 1 Fl.',
    unitValue: null,
    unitType: '',
    totalComparableAmount: null,
    comparableUnit: '',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false },
  });
  const otherRetailer = arielDmAktionsfinderOffer({ _id: 'bipa-clean', retailerKey: 'bipa' });
  const result = dedupeVisibleCardResponseOffers([broken, otherRetailer], 'ariel waschmittel');

  assert.equal(result.offers.length, 2);
});

test('visible card broken-quantity tolerance keeps different sources visible', () => {
  const broken = arielDmAktionsfinderOffer({
    _id: 'ariel-broken',
    quantityText: '$undefined WG / 1 Fl.',
    unitValue: null,
    unitType: '',
    totalComparableAmount: null,
    comparableUnit: '',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false },
  });
  const otherSource = arielDmAktionsfinderOffer({
    _id: 'ariel-other-source',
    sourceType: 'wogibtswas-html',
  });
  const result = dedupeVisibleCardResponseOffers([broken, otherSource], 'ariel waschmittel');

  assert.equal(result.offers.length, 2);
});

test('visible card broken-quantity tolerance does not collapse official source offers', () => {
  const broken = arielDmAktionsfinderOffer({
    _id: 'official-broken',
    sourceType: 'dm-official-product-search',
    quantityText: '$undefined WG / 1 Fl.',
    unitValue: null,
    unitType: '',
    totalComparableAmount: null,
    comparableUnit: '',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false },
  });
  const clean = arielDmAktionsfinderOffer({
    _id: 'official-clean',
    sourceType: 'dm-official-product-search',
  });
  const result = dedupeVisibleCardResponseOffers([broken, clean], 'ariel waschmittel');

  assert.equal(result.offers.length, 2);
});

test('visible card broken-quantity tolerance keeps different conditions visible', () => {
  const broken = arielDmAktionsfinderOffer({
    _id: 'ariel-broken',
    quantityText: '$undefined WG / 1 Fl.',
    unitValue: null,
    unitType: '',
    totalComparableAmount: null,
    comparableUnit: '',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false },
  });
  const conditional = arielDmAktionsfinderOffer({
    _id: 'ariel-condition',
    conditionsText: 'nur mit App',
    customerProgramRequired: true,
  });
  const result = dedupeVisibleCardResponseOffers([broken, conditional], 'ariel waschmittel');

  assert.equal(result.offers.length, 2);
});

test('visible card broken-quantity tolerance keeps different validity visible', () => {
  const broken = arielDmAktionsfinderOffer({
    _id: 'ariel-broken',
    quantityText: '$undefined WG / 1 Fl.',
    unitValue: null,
    unitType: '',
    totalComparableAmount: null,
    comparableUnit: '',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false },
  });
  const otherValidity = arielDmAktionsfinderOffer({
    _id: 'ariel-other-validity',
    validTo: new Date('2026-06-09T00:00:00Z'),
  });
  const result = dedupeVisibleCardResponseOffers([broken, otherValidity], 'ariel waschmittel');

  assert.equal(result.offers.length, 2);
});

test('visible card broken-quantity tolerance keeps real quantity variants visible', () => {
  const oneBottle = arielDmAktionsfinderOffer({ _id: 'ariel-one', quantityText: '1 flasche' });
  const twoBottles = arielDmAktionsfinderOffer({
    _id: 'ariel-two',
    quantityText: '2 flaschen',
    unitValue: 2,
    totalComparableAmount: 2,
    normalizedUnitPrice: { amount: 5.825, unit: 'flasche', comparable: true },
  });
  const result = dedupeVisibleCardResponseOffers([oneBottle, twoBottles], 'ariel waschmittel');

  assert.equal(result.offers.length, 2);
});

test('visible card broken-quantity tolerance does not change non-broken quantity behavior', () => {
  const bottle = arielDmAktionsfinderOffer({ _id: 'ariel-bottle', quantityText: '1 flasche' });
  const pack = arielDmAktionsfinderOffer({
    _id: 'ariel-pack',
    quantityText: '1 packung',
    unitType: 'packung',
    comparableUnit: 'packung',
    normalizedUnitPrice: { amount: 11.65, unit: 'packung', comparable: true },
  });
  const result = dedupeVisibleCardResponseOffers([bottle, pack], 'ariel waschmittel');

  assert.equal(result.offers.length, 2);
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
  assert.equal(
    buildValidityLabel({
      validFrom: new Date('2026-06-10T22:00:00Z'),
      validTo: new Date('2026-06-17T21:59:59.999Z'),
    }),
    'gueltig 2026-06-11 bis 2026-06-17'
  );
});

test('BILLA Delamaris variants stay separate when a duplicated brand token inflates title overlap', () => {
  const base = {
    retailerKey: 'billa',
    retailerName: 'BILLA',
    brand: 'Delamaris',
    sourceType: 'billa-official-algolia',
    priceCurrent: { amount: 1.69 },
    priceReference: { amount: 2.49 },
    quantityText: '125 g',
    unitValue: 125,
    unitType: 'g',
    totalComparableAmount: 0.125,
    comparableUnit: 'kg',
    normalizedUnitPrice: { amount: 13.52, unit: 'kg', comparable: true },
    conditionsText: 'ab 2 Dosen',
    hasConditions: true,
    minimumPurchaseQty: 2,
    validFrom: new Date('2026-08-02T04:39:16Z'),
    validTo: null,
  };
  const variants = [
    offer({
      ...base,
      _id: 'delamaris-picnic',
      title: 'Delamaris Delamaris Makrelen Picnic',
      imageUrl: 'https://example.test/picnic.jpg',
    }),
    offer({
      ...base,
      _id: 'delamaris-pikant',
      title: 'Delamaris Delamaris Makrelensalat Pikant',
      imageUrl: 'https://example.test/pikant.jpg',
    }),
    offer({
      ...base,
      _id: 'delamaris-provencale',
      title: 'Delamaris Delamaris Makrelensalat Proven\u00e7ale',
      imageUrl: '',
    }),
  ];

  const finalResult = dedupeFinalResponseOffers(variants, 'Delamaris');
  const visibleResult = dedupeVisibleCardResponseOffers(finalResult, 'Delamaris');

  assert.deepEqual(
    new Set(visibleResult.offers.map((item) => item._id)),
    new Set(['delamaris-picnic', 'delamaris-pikant', 'delamaris-provencale'])
  );
  assert.equal(visibleResult.offers.find((item) => item._id === 'delamaris-provencale').imageUrl, '');
  assert.ok(visibleResult.offers.every((item) => item.conditionsText === 'ab 2 Dosen'));
  assert.ok(visibleResult.offers.every((item) => item.validTo === null));
});

test('visible card dedupe still collapses an actual duplicate with repeated title tokens', () => {
  const base = offer({
    title: 'Delamaris Delamaris Makrelensalat Proven\u00e7ale',
    brand: 'Delamaris',
    retailerKey: 'billa',
    priceCurrent: { amount: 1.69 },
    quantityText: '125 g',
    unitValue: 125,
    unitType: 'g',
    totalComparableAmount: 0.125,
    comparableUnit: 'kg',
    conditionsText: 'ab 2 Dosen',
    minimumPurchaseQty: 2,
    validFrom: new Date('2026-08-02T04:39:16Z'),
    validTo: null,
  });

  const result = dedupeVisibleCardResponseOffers([
    { ...base, _id: 'provencale-a' },
    { ...base, _id: 'provencale-b' },
  ], 'Provencale');

  assert.equal(result.offers.length, 1);
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
  const capabilities = getRankingCacheCapabilities();
  assert.match(capabilities.schemaVersion, /public-validity-v1/);
  assert.deepEqual({
    resultSetTokens: capabilities.resultSetTokens,
    mongoBackedResultSets: capabilities.mongoBackedResultSets,
    resultSetTtlSeconds: capabilities.resultSetTtlSeconds,
  }, {
    resultSetTokens: true,
    mongoBackedResultSets: true,
    resultSetTtlSeconds: 300,
  });
});

test('ranking eligibility keeps customer-program offers visible by default with public opt-out', () => {
  const appOffer = offer({
    _id: 'zespri-app',
    id: 'zespri-app',
    title: 'ZESPRI Kiwi Gold',
    titleNormalized: 'zespri kiwi gold',
    brand: 'ZESPRI',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Obst & Gemuese',
    categoryKey: 'obst-gemuese',
    quantityText: '4 Stueck',
    priceCurrent: { amount: 2.49, currency: 'EUR' },
    normalizedUnitPrice: { amount: 0.62, unit: 'Stk', comparable: true },
    comparableUnit: 'Stk',
    comparisonGroup: 'obst-gemuese:zespri-kiwi-gold:4-stueck',
    conditionsText: 'Nur mit SPAR-App-Gutschein laut Flugblatt',
    customerProgramRequired: true,
    hasConditions: true,
    status: 'active',
    isActiveNow: true,
    isActiveToday: true,
    validFrom: new Date('2026-06-01T00:00:00.000Z'),
    validTo: new Date('2099-06-07T23:59:59.999Z'),
  });
  assert.deepEqual(applyProgramEligibility([appOffer], {}), [appOffer]);
  assert.deepEqual(applyProgramEligibility([appOffer], { onlyWithoutProgram: true }), []);
  assert.deepEqual(applyProgramEligibility([appOffer], { programRetailers: ['spar'] }), [appOffer]);
  assert.deepEqual(applyProgramEligibility([appOffer], { programRetailers: ['bipa'] }), []);
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
    validFrom: new Date('2020-01-01T00:00:00.000Z'),
    validTo: new Date('2099-01-31T23:59:59.999Z'),
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

test('ranked offer response hides unsafe stored technical unit prices', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'parkside-drill',
    title: 'PARKSIDE Akku-Bohrschrauber, 20 V',
    retailerKey: 'lidl',
    sourceType: 'lidl-official-flyer-api',
    priceCurrent: { amount: 24.99, currency: 'EUR' },
    quantityText: '',
    comparableUnit: '',
    normalizedUnitPrice: {
      amount: 24990,
      unit: 'kg',
      comparable: false,
      confidence: 0.4,
    },
    quality: {
      comparisonSafe: false,
    },
  }), 24.99, 24.99);

  assert.deepEqual(ranked.normalizedUnitPrice, {
    amount: null,
    unit: '',
    comparable: false,
    confidence: 0.4,
  });
  assert.equal(ranked.comparableUnit, '');
  assert.equal(ranked.priceGapPercent, 0);
});

test('ranked offer response sanitizes broken visible quantity artifacts without hiding the clean pack hint', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'ariel-broken',
    title: 'Ariel Waschmittel Fluessig div. Sorten 40 WL dm 1 Flasche',
    retailerKey: 'dm',
    priceCurrent: { amount: 11.65, currency: 'EUR' },
    quantityText: '$undefined WG / 1 Fl.',
    unitType: 'WG',
    comparableUnit: '',
    normalizedUnitPrice: {
      amount: null,
      unit: '',
      comparable: false,
      confidence: 0,
    },
    quality: {
      comparisonSafe: false,
    },
  }), null, null);

  assert.equal(ranked.quantityText, '1 Fl.');
  assert.equal(ranked.unitType, '');
  assert.equal(ranked.comparableUnit, '');
});

test('ranked offer response keeps safely comparable unit prices visible', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'coffee',
    title: 'Kaffee 1 kg',
    retailerKey: 'lidl',
    priceCurrent: { amount: 7.99, currency: 'EUR' },
    quantityText: '1 kg',
    unitValue: 1,
    unitType: 'kg',
    totalComparableAmount: 1,
    comparableUnit: 'kg',
    normalizedUnitPrice: {
      amount: 7.99,
      unit: 'kg',
      comparable: true,
      confidence: 0.9,
    },
    quality: {
      comparisonSafe: true,
    },
  }), 7.99, 7.99);

  assert.deepEqual(ranked.normalizedUnitPrice, {
    amount: 7.99,
    unit: 'kg',
    comparable: true,
    confidence: 0.9,
  });
  assert.equal(ranked.comparableUnit, 'kg');
});

test('ranked offer response explains availability for Müller online offers', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'mueller-online',
    retailerKey: 'mueller',
    retailerName: 'Müller',
    sourceType: 'mueller-official-online-offers',
    conditionsText: 'Müller Online-Angebot; online',
    priceCurrent: { amount: 7.65, currency: 'EUR' },
    normalizedUnitPrice: { amount: 7.65, unit: 'Stk', comparable: false, confidence: 0.4 },
  }), null, null);

  assert.equal(ranked.conditionsText, 'Online-Angebot · Verfügbarkeit bei Müller prüfen');
  assert.equal(ranked.validTo, undefined);
});

test('ranked offer response normalizes Mueller store availability tokens', () => {
  for (const availability of ['store-only', 'deliver-to-store']) {
    const ranked = buildRankedOffer(offer({
      _id: `mueller-online-${availability}`,
      retailerKey: 'mueller',
      retailerName: 'Mueller',
      sourceType: 'mueller-official-online-offers',
      conditionsText: `Mueller Online-Angebot; ${availability}`,
      priceCurrent: { amount: 7.65, currency: 'EUR' },
      normalizedUnitPrice: { amount: 7.65, unit: 'Stk', comparable: false, confidence: 0.4 },
    }), null, null);

    assert.equal(ranked.conditionsText, 'Online-Angebot \u00b7 Verf\u00fcgbarkeit bei M\u00fcller pr\u00fcfen');
  }
});

test('Mueller Blink wipes response category guard repairs stale food category across normalized title variants', () => {
  for (const [index, title] of [
    'Blink Feuchte Allzwecktücher Orange Pfirsich',
    'Blink Feuchte Allzwecktuecher Orange Pfirsich',
    'Blink Feuchte Allzweck Tücher Orange Pfirsich',
    'Blink Feuchte Allzweck-Tücher Orange Pfirsich',
  ].entries()) {
    const ranked = buildRankedOffer(offer({
      _id: `mueller-blink-allzwecktuecher-${index}`,
      retailerKey: 'mueller',
      retailerName: 'Mueller',
      sourceKey: 'mueller-official-online-offers',
      sourceType: 'mueller-official-online-offers',
      title,
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Obst & Gemuese',
      categoryKey: 'obst-gemuese',
      subcategoryKey: 'obst-gemuese',
    }), null, null);

    assert.equal(ranked.categoryPrimary, 'Haushalt', title);
    assert.equal(ranked.categorySecondary, 'Waschmittel & Reiniger', title);
  }

  const blinkOnly = buildRankedOffer(offer({
    _id: 'mueller-blink-only',
    retailerKey: 'mueller',
    retailerName: 'Mueller',
    sourceKey: 'mueller-official-online-offers',
    sourceType: 'mueller-official-online-offers',
    title: 'Blink Sommerduft',
    categoryPrimary: 'Non-Food',
    categorySecondary: 'Online-only / Sale',
    categoryKey: 'online-only-sale',
    subcategoryKey: 'online-only-sale',
  }), null, null);

  assert.equal(blinkOnly.categoryPrimary, 'Non-Food');
  assert.equal(blinkOnly.categorySecondary, 'Online-only / Sale');

  const otherRetailer = buildRankedOffer(offer({
    _id: 'billa-blink-allzwecktuecher',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    sourceKey: 'billa-official-algolia',
    sourceType: 'billa-official-algolia',
    title: 'Blink Feuchte Allzwecktuecher Orange Pfirsich',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Obst & Gemuese',
    categoryKey: 'obst-gemuese',
    subcategoryKey: 'obst-gemuese',
  }), null, null);

  assert.equal(otherRetailer.categoryPrimary, 'Lebensmittel');
  assert.equal(otherRetailer.categorySecondary, 'Obst & Gemuese');
});

test('ranked offer response repairs stored Hirter crate total without using minimum purchase quantity', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'hirter-action-crate',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    sourceType: 'billa-official-action-html',
    title: 'Hirter Privat Pils',
    brand: 'Hirter',
    quantityText: '0.5 l',
    packCount: null,
    unitValue: 0.5,
    unitType: 'l',
    totalComparableAmount: 0.5,
    comparableUnit: 'l',
    priceCurrent: { amount: 16.8, currency: 'EUR' },
    priceReference: { amount: 22.4, currency: 'EUR' },
    normalizedUnitPrice: { amount: 33.6, unit: 'l', comparable: true, confidence: 0.86 },
    conditionsText: 'Gilt ab 2 Stueck; Preisfenster FR & SA',
    rawFacts: {
      sourceType: 'billa-official-action-html',
      teaserName: 'Hirter Privat Pils 0,5 Liter, 1 Kiste = 20 Flaschen (0,5 l 1.12/0.84)',
    },
  }), 1.68, 1.68);

  assert.equal(ranked.packCount, 20);
  assert.equal(ranked.totalComparableAmount, 10);
  assert.equal(ranked.normalizedUnitPrice.amount, 1.68);
  assert.notEqual(ranked.normalizedUnitPrice.amount, 33.6);
  assert.notEqual(ranked.normalizedUnitPrice.amount, 8.4);
  assert.match(ranked.conditionsText, /Gilt ab 2 Stueck/);
});

test('ranked offer response does not rewrite availability copy from other sources', () => {
  const ranked = buildRankedOffer(offer({
    _id: 'other-online',
    retailerKey: 'other',
    sourceType: 'official-site',
    conditionsText: 'Müller Online-Angebot; online',
  }), null, null);

  assert.equal(ranked.conditionsText, 'Müller Online-Angebot; online');
});

test('ranking quality adjustment stays behind query relevance', () => {
  const relevantWithoutImage = offer({
    title: 'Milka Schokolade Alpenmilch',
    brand: 'Milka',
    categorySecondary: 'Schokolade',
    searchText: 'milka schokolade',
    imageUrl: '',
    sourceType: 'aktionsfinder-json',
  });
  const irrelevantWithImage = offer({
    title: 'Nivea Duschgel',
    brand: 'Nivea',
    categorySecondary: 'Duschgel',
    searchText: 'nivea duschgel',
    imageUrl: 'https://example.test/nivea.jpg',
    sourceType: 'bipa-official-html',
  });

  assert.equal(compareOffersByRanking(relevantWithoutImage, irrelevantWithImage, { query: 'milka schokolade' }) < 0, true);
});

test('equally relevant and otherwise equal offers prefer the card with an image', () => {
  const withoutImage = offer({
    title: 'Caffe Crema Ganze Bohne',
    searchText: 'caffe crema ganze bohne',
    imageUrl: '',
    normalizedUnitPrice: { amount: 15.99, unit: 'kg', comparable: false },
  });
  const withImage = offer({
    ...withoutImage,
    imageUrl: 'https://example.test/caffe-crema.jpg',
  });

  assert.equal(compareOffersByRanking(withImage, withoutImage, { query: 'kaffee' }) < 0, true);
  assert.equal(compareOffersByRanking(withoutImage, withImage, { query: 'kaffee' }) > 0, true);
});

test('safe market comparison exposes a cheaper strongly matched product type with clear conditions', () => {
  const primary = offer({
    _id: 'primary-coffee',
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    title: 'Beispiel Caffe Crema 500 g',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    comparisonGroup: 'beispiel-caffe-crema::0.5-kg',
    quantityText: '500 g',
    totalComparableAmount: 0.5,
    comparableUnit: 'kg',
    priceCurrent: { amount: 9.99, currency: 'EUR' },
    normalizedUnitPrice: { amount: 19.98, unit: 'kg', comparable: true, confidence: 0.9 },
    quality: { comparisonSafe: true },
    sourceType: 'bipa-official-html',
    rawFacts: { sourceKey: 'bipa-official-category' },
    sourceRunStatus: 'success',
    publishStatus: 'crawl-run-partial',
    status: 'active',
    isActiveNow: true,
    validFrom: '2020-01-01T00:00:00.000Z',
    validTo: '2099-01-31T23:59:59.000Z',
    conditionsText: 'Aktion',
    hasConditions: true,
    isMultiBuy: false,
    customerProgramRequired: false,
    minimumPurchaseQty: 1,
  });
  const alternative = offer({
    ...primary,
    _id: 'alternative-coffee',
    retailerKey: 'dm',
    retailerName: 'dm',
    title: 'Beispiel Caffe Crema 1 kg',
    comparisonGroup: 'beispiel-caffe-crema::1-kg',
    quantityText: '1 kg',
    totalComparableAmount: 1,
    priceCurrent: { amount: 15.99, currency: 'EUR' },
    normalizedUnitPrice: { amount: 15.99, unit: 'kg', comparable: true, confidence: 0.9 },
    sourceType: 'dm-official-html',
    rawFacts: { sourceKey: 'dm-official-product-search' },
    conditionsText: 'Nur mit dm App',
    customerProgramRequired: true,
  });

  assert.equal(canOfferSafeMarketComparison(primary, alternative), true);
  assert.deepEqual(buildSafeMarketComparisonAlternative(primary, [primary, alternative]), {
    available: true,
    type: 'cheaper_alternative',
    label: 'Günstiger pro kg',
    reason: 'Gleiche Kategorie und niedrigerer Preis pro Einheit',
    similarityLabel: 'Gleiche Kategorie: Kaffee & Tee',
    unitPriceDeltaLabel: '15,99 €/kg statt 19,98 €/kg',
    conditionNote: 'Bedingung: Nur mit dm App',
    offer: {
      id: 'alternative-coffee',
      retailerKey: 'dm',
      retailerName: 'dm',
      title: 'Beispiel Caffe Crema 1 kg',
      brand: '',
      imageUrl: '',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      displayCategory: 'Kaffee & Tee',
      quantityText: '1 kg',
      conditionsText: 'Nur mit dm App',
      validFrom: '2020-01-01T00:00:00.000Z',
      validTo: '2099-01-31T23:59:59.000Z',
      validityLabel: 'gueltig 2020-01-01 bis 2099-02-01',
      priceCurrent: { amount: 15.99, currency: 'EUR' },
      normalizedUnitPrice: { amount: 15.99, unit: 'kg', comparable: true, confidence: 0.9 },
      sourceType: 'dm-official-html',
      sourceKey: 'dm-official-product-search',
    },
  });

  const response = buildRankingResponseFromBase({
    base: {
      visibleOffers: [primary, alternative],
      resultCount: 2,
      candidateCount: 2,
      candidateLimit: 100,
      units: ['kg'],
      categoryDocuments: [],
      retailerOptions: [],
    },
    query: 'kaffee',
    showAllMatching: true,
  });
  const primaryResponse = response.rankedOffers.find((item) => item.id === 'primary-coffee');
  const alternativeResponse = response.rankedOffers.find((item) => item.id === 'alternative-coffee');

  assert.equal(primaryResponse.comparisonAlternative.offer.id, 'alternative-coffee');
  assert.equal(alternativeResponse.comparisonAlternative.type, 'similar_alternative');
  assert.equal(alternativeResponse.comparisonAlternative.offer.id, 'primary-coffee');
});

test('safe market comparison exposes a nearby similar alternative without a savings claim', () => {
  const primary = offer({
    _id: 'primary-sunscreen',
    retailerKey: 'dm',
    retailerName: 'dm',
    title: 'Sonnencreme Summer Scent LSF 50, 100 ml',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Koerperpflege',
    quantityText: '100 ml',
    totalComparableAmount: 0.1,
    comparableUnit: 'l',
    priceCurrent: { amount: 3.95, currency: 'EUR' },
    normalizedUnitPrice: { amount: 39.5, unit: 'l', comparable: true, confidence: 0.9 },
    quality: { comparisonSafe: true },
    sourceType: 'dm-official-product-search',
    rawFacts: { sourceKey: 'dm-official-product-search' },
    sourceRunStatus: 'success',
    publishStatus: 'crawl-run-success',
    status: 'active',
    isActiveNow: true,
    validFrom: '2020-01-01T00:00:00.000Z',
    validTo: '2099-01-31T23:59:59.000Z',
    conditionsText: 'Ausverkauf; nur solange der Vorrat reicht',
    hasConditions: true,
  });
  const alternative = offer({
    ...primary,
    _id: 'similar-sunscreen',
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    title: 'Sonnencreme Hydrating Protect LSF 30',
    quantityText: '180 ml',
    totalComparableAmount: 0.18,
    priceCurrent: { amount: 10.49, currency: 'EUR' },
    normalizedUnitPrice: { amount: 58.3, unit: 'l', comparable: true, confidence: 0.9 },
    sourceType: 'bipa-official-html',
    rawFacts: { sourceKey: 'bipa-official-category' },
    conditionsText: 'Aktion',
  });

  const comparison = buildSafeMarketComparisonAlternative(primary, [primary, alternative]);

  assert.equal(comparison.type, 'similar_alternative');
  assert.equal(comparison.label, 'Ähnliche Alternative');
  assert.equal(comparison.reason, 'Gleiche Kategorie und ähnlicher Produkttyp');
  assert.equal(comparison.unitPriceDeltaLabel, '');
  assert.equal(comparison.conditionNote, 'Bedingung: Aktion');
  assert.equal(comparison.offer.id, 'similar-sunscreen');
});

test('safe piece comparison is limited to meaningful matching pack units', () => {
  const primary = offer({
    _id: 'primary-paper',
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    title: 'Toilettenpapier Simply Soft Kamille',
    categoryPrimary: 'Haushalt',
    categorySecondary: 'Haushaltspapier',
    quantityText: '20 Rollen',
    totalComparableAmount: 20,
    comparableUnit: 'Stk',
    priceCurrent: { amount: 6.8, currency: 'EUR' },
    normalizedUnitPrice: { amount: 0.34, unit: 'Stk', comparable: true, confidence: 0.9 },
    quality: { comparisonSafe: true },
    sourceType: 'bipa-official-html',
    rawFacts: { sourceKey: 'bipa-official-category' },
    sourceRunStatus: 'success',
    publishStatus: 'crawl-run-success',
    status: 'active',
    isActiveNow: true,
    validFrom: '2020-01-01T00:00:00.000Z',
    validTo: '2099-01-31T23:59:59.000Z',
    conditionsText: 'Aktion',
    hasConditions: true,
  });
  const alternative = offer({
    ...primary,
    _id: 'alternative-paper',
    retailerKey: 'dm',
    retailerName: 'dm',
    title: 'Toilettenpapier 3-lagig',
    quantityText: '16 Rollen',
    totalComparableAmount: 16,
    priceCurrent: { amount: 4, currency: 'EUR' },
    normalizedUnitPrice: { amount: 0.25, unit: 'Stk', comparable: true, confidence: 0.9 },
    sourceType: 'dm-official-product-search',
    rawFacts: { sourceKey: 'dm-official-product-search' },
  });

  const comparison = buildSafeMarketComparisonAlternative(primary, [alternative]);

  assert.equal(comparison.type, 'cheaper_alternative');
  assert.equal(comparison.label, 'Günstiger pro Stück');
});

test('safe market comparison fails closed for unsafe units, sources, mechanics, categories and quantities', () => {
  const base = offer({
    _id: 'base',
    retailerKey: 'dm',
    retailerName: 'dm',
    title: 'Zahnpasta Sensitive 75 ml',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Mund- & Zahnpflege',
    quantityText: '75 ml',
    totalComparableAmount: 0.075,
    comparableUnit: 'l',
    priceCurrent: { amount: 3, currency: 'EUR' },
    normalizedUnitPrice: { amount: 40, unit: 'l', comparable: true, confidence: 0.9 },
    quality: { comparisonSafe: true },
    sourceType: 'dm-official-html',
    sourceRunStatus: 'success',
    publishStatus: 'crawl-run-success',
    status: 'active',
    isActiveNow: true,
    validFrom: '2020-01-01T00:00:00.000Z',
    validTo: '2099-01-31T23:59:59.000Z',
    conditionsText: '',
    hasConditions: false,
    isMultiBuy: false,
    customerProgramRequired: false,
    minimumPurchaseQty: 1,
  });
  const primary = { ...base, _id: 'primary', retailerKey: 'bipa', normalizedUnitPrice: { ...base.normalizedUnitPrice, amount: 50 } };

  const rejected = [
    { ...base, retailerKey: 'spar' },
    { ...base, retailerKey: 'eurospar' },
    { ...base, retailerKey: 'hofer' },
    { ...base, comparableUnit: 'Stk', normalizedUnitPrice: { amount: 9, unit: 'Stk', comparable: true, confidence: 0.9 } },
    { ...base, totalComparableAmount: 1, quantityText: '1 l' },
    { ...base, quality: { comparisonSafe: true, issues: ['Vergleichseinheit unsicher oder nicht ableitbar'] } },
    { ...base, sourceType: 'aktionsfinder-json' },
    { ...base, sourceRunStatus: 'failed' },
    { ...base, conditionsText: '2+1 Gratis', hasConditions: true, isMultiBuy: true },
    { ...base, title: 'Mundspülung Sensitive 500 ml' },
    { ...base, categorySecondary: 'Andere Kategorie' },
    { ...base, conditionsText: 'Bedingung im Angebotsbild pruefen', hasConditions: true },
    { ...base, normalizedUnitPrice: { amount: 90, unit: 'l', comparable: true, confidence: 0.9 } },
    { ...base, status: 'expired', isActiveNow: false },
  ];

  for (const candidate of rejected) {
    assert.equal(canOfferSafeMarketComparison(primary, candidate), false);
  }

  const billa = { ...base, _id: 'billa', retailerKey: 'billa', normalizedUnitPrice: { ...base.normalizedUnitPrice, amount: 50 } };
  const billaPlus = { ...base, _id: 'billa-plus', retailerKey: 'billa-plus', normalizedUnitPrice: { ...base.normalizedUnitPrice, amount: 30 } };
  assert.equal(canOfferSafeMarketComparison(billa, billaPlus), false);
  assert.equal(buildSafeMarketComparisonAlternative(primary, rejected), null);
});

test('ranking quality adjustment weakly prefers equally relevant official complete card', () => {
  const official = offer({
    title: 'Bio Vollmilch 1 l',
    categorySecondary: 'Milch',
    searchText: 'milch',
    sourceType: 'billa-official-algolia',
    sourceUrl: 'https://www.billa.at/aktionen/milch',
    imageUrl: 'https://example.test/milch.jpg',
    conditionsText: 'nur diese Woche',
    quantityText: '1 l',
    unitValue: 1,
    unitType: 'l',
    totalComparableAmount: 1,
    comparableUnit: 'l',
    normalizedUnitPrice: { amount: 1.49, unit: 'l', comparable: true, confidence: 0.9 },
    quality: { comparisonSafe: true, issues: [] },
    categoryConfidence: 0.8,
  });
  const aggregator = offer({
    ...official,
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/l/billa/',
    imageUrl: '',
    conditionsText: '',
  });

  assert.equal(compareOffersByRanking(official, aggregator, { query: 'milch' }) < 0, true);
});

test('ranking quality issue only demotes and does not remove equal query match', () => {
  const clean = offer({
    title: 'Ariel Waschmittel Pulver',
    categorySecondary: 'Waschmittel',
    searchText: 'ariel waschmittel',
    priceCurrent: { amount: 9.99 },
    normalizedUnitPrice: { amount: 9.99, unit: 'Stk', comparable: false, confidence: 0.2 },
    quality: { comparisonSafe: false, issues: [] },
  });
  const review = offer({
    ...clean,
    reviewReasons: ['Menge unvollstaendig'],
    quality: { comparisonSafe: false, issues: ['Menge unvollstaendig'] },
  });

  assert.equal(scoreOfferAgainstQuery(review, 'ariel waschmittel') > 0, true);
  assert.equal(compareOffersByRanking(clean, review, { query: 'ariel waschmittel' }) < 0, true);
});
