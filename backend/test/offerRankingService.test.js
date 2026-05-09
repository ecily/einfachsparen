const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyQueryMatch,
  buildRankingCandidateLimit,
  buildRankingCandidateMatch,
  buildValidityLabel,
  buildGroupedRankings,
  buildKnownCategoryLabelMap,
  dedupeFinalResponseOffers,
  dedupeQueryOffers,
  dedupeResponseOffers,
  normalizeSearchText,
  normalizeRetailerList,
  parseRankingCategories,
  prepareQueryOffersForResponse,
  scoreOfferAgainstQuery,
  tokenizeSearchText,
} = require('../src/services/offers/offerRankingService');

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

test('normalizes umlauts and tokenizes search text for query matching', () => {
  assert.equal(normalizeSearchText('Käse & Öl'), 'kaese oel');
  assert.deepEqual(tokenizeSearchText('Red Bull 4-Pack'), ['red', 'bull', '4', 'pack']);
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
});

test('builds bounded ranking candidate limits for small result requests', () => {
  assert.equal(buildRankingCandidateLimit({ safeLimit: 1, hasQuery: false }), 20);
  assert.equal(buildRankingCandidateLimit({ safeLimit: 1, hasQuery: true }), 60);
  assert.equal(buildRankingCandidateLimit({ safeLimit: 60, hasQuery: true }), 180);
});

test('pushes unknown ranking query into Mongo candidate filtering before JS scoring', () => {
  const match = buildRankingCandidateMatch({
    selectedRetailers: ['hofer'],
    selectedCategories: ['Kaffee & Tee'],
    unit: 'kg',
    onlyWithoutProgram: true,
    query: 'zzzzzzzz',
  });

  assert.equal(match.status, 'active');
  assert.equal(match.isActiveNow, true);
  assert.deepEqual(match.retailerKey, { $in: ['hofer'] });
  assert.deepEqual(match.categoryKey, { $in: ['kaffee-tee'] });
  assert.equal(match.comparableUnit, 'kg');
  assert.equal(match.customerProgramRequired, false);
  assert.ok(Array.isArray(match.$and));
  assert.equal(match.$and.length, 1);
  assert.ok(match.$and[0].$or.some((item) => String(item.titleNormalized).includes('zzzzzzzz')));
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
    assert.ok(sortedTitles.indexOf(sideMeaning) > 1, sideMeaning);
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

test('ranks real yoghurt ahead of dessert, bar and margarine context hits', () => {
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

  assert.equal(sortedTitles[0], 'Naturjoghurt 3,5 Prozent');
  assert.ok(sortedTitles.indexOf('Fruchtriegel Joghurt') > 0);
  assert.ok(sortedTitles.indexOf('Rama mit Joghurt') > 0);
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

[
  ['billa', 'billa-official-algolia'],
  ['billa-plus', 'billa-official-algolia'],
  ['lidl', 'lidl-official-flyer-api'],
  ['penny', 'penny-official-html'],
  ['dm', 'dm-official-html'],
  ['bipa', 'bipa-official-html'],
  ['spar', 'spar-official-html'],
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
