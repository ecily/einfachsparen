const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyQueryMatch,
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
