const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyQueryMatch,
  buildGroupedRankings,
  dedupeQueryOffers,
  normalizeSearchText,
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

  assert.equal(sortedTitles[0], 'Ja Natuerlich Bio Vollmilch 1 l');
  assert.ok(sortedTitles.indexOf('Salzburg Milch Gouda Scheiben') > 0);
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
