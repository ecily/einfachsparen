const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyQueryMatch,
  buildGroupedRankings,
  normalizeSearchText,
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

  const firstGroupTitles = buildGroupedRankings(offers, { query: 'butter' })[0].offers.map((item) => item.title);

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

  const firstGroupTitles = buildGroupedRankings(offers, { query: 'waschmittel' })[0].offers.map((item) => item.title);

  assert.deepEqual(new Set(firstGroupTitles.slice(0, 3)), new Set([
    'Ariel Waschmittel',
    'Weisser Riese Waschmittel',
    'Persil Waschmittel',
  ]));
});
