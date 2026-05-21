const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FOOD_OIL_PRODUCT_TOKENS,
  SEARCH_TOKEN_VERSION,
  buildOfferSearchTokens,
  buildQuerySearchTokens,
  normalizeSearchTokenText,
  withOfferSearchTokens,
} = require('../src/services/offers/searchTokens');

test('normalizes coffee accents and conservative coffee synonyms', () => {
  assert.equal(normalizeSearchTokenText('Caf\u00e9 Cr\u00e8me'), 'cafe creme');
  assert.deepEqual(new Set(buildQuerySearchTokens('Caf\u00e9')), new Set(['cafe', 'caffe', 'kaffee']));
  assert.deepEqual(new Set(buildQuerySearchTokens('Kaffee')), new Set(['cafe', 'caffe', 'kaffee']));
});

test('normalizes kaese and oel variants conservatively', () => {
  assert.deepEqual(new Set(buildQuerySearchTokens('K\u00e4se')), new Set(['kaese', 'kase']));
  assert.deepEqual(new Set(buildQuerySearchTokens('K\u00c3\u00a4se')), new Set(['kaese', 'kase']));
  const genericOilTokens = new Set(['oel', ...FOOD_OIL_PRODUCT_TOKENS]);
  assert.deepEqual(new Set(buildQuerySearchTokens('Oel')), genericOilTokens);
  assert.deepEqual(new Set(buildQuerySearchTokens('\u00d6l')), genericOilTokens);
  assert.deepEqual(new Set(buildQuerySearchTokens('Ol')), genericOilTokens);
  assert.deepEqual(new Set(buildQuerySearchTokens('Haarol')), new Set(['haaroel', 'haarol']));
  assert.deepEqual(new Set(buildQuerySearchTokens('\ufffdl')), genericOilTokens);
  assert.deepEqual(new Set(buildQuerySearchTokens('\u00c3\u00b6l')), genericOilTokens);
  assert.deepEqual(new Set(buildQuerySearchTokens('Haar\ufffdl')), new Set(['haaroel', 'haarol']));
  assert.deepEqual(new Set(buildQuerySearchTokens('Haar\u00c3\u00b6l')), new Set(['haaroel', 'haarol']));
});

test('expands generic oil queries to explicit food oil product types only', () => {
  const genericOilTokens = buildQuerySearchTokens('\u00f6l');

  for (const token of [
    'bratoel',
    'kuerbiskernoel',
    'olivenoel',
    'pflanzenoel',
    'rapsoel',
    'sonnenblumenoel',
    'speiseoel',
  ]) {
    assert.equal(genericOilTokens.includes(token), true);
  }

  for (const sideHitToken of ['haaroel', 'duftoel', 'duschoel', 'motoroel', 'pflegeoel']) {
    assert.equal(genericOilTokens.includes(sideHitToken), false);
  }

  assert.deepEqual(buildQuerySearchTokens('Raps\u00f6l'), ['rapsoel']);
  assert.deepEqual(buildQuerySearchTokens('rapsoel'), ['rapsoel']);
});

test('removes stopwords and non-dominant quantity tokens', () => {
  const tokens = buildOfferSearchTokens({
    title: 'Diverse Sorten Packung 1 kg 500 Gramm St\u00fcck Kaffee',
    quantityText: '1 kg',
  });

  assert.equal(tokens.includes('diverse'), false);
  assert.equal(tokens.includes('sorten'), false);
  assert.equal(tokens.includes('packung'), false);
  assert.equal(tokens.includes('gramm'), false);
  assert.equal(tokens.includes('stueck'), false);
  assert.equal(tokens.includes('kaffee'), true);
});

test('does not broaden waschmittel query to cleaning accessories', () => {
  assert.deepEqual(buildQuerySearchTokens('waschmittel'), ['waschmittel']);
});

test('expands explicit cat litter query to current litter title tokens', () => {
  assert.deepEqual(new Set(buildQuerySearchTokens('katzenstreu')), new Set(['katzenstreu', 'klumpstreu']));
});

test('expands nudeln query only to direct pasta product tokens', () => {
  assert.deepEqual(new Set(buildQuerySearchTokens('nudeln')), new Set([
    'fusilli',
    'maccheroni',
    'makkaroni',
    'nudel',
    'nudeln',
    'pasta',
    'penne',
    'spaghetti',
    'teigwaren',
  ]));
});

test('keeps reis and milch query tokens and indexes conservative product compounds', () => {
  assert.deepEqual(buildQuerySearchTokens('reis'), ['reis']);
  assert.deepEqual(buildQuerySearchTokens('milch'), ['milch']);

  const riceTokens = buildOfferSearchTokens({ title: 'Riso Gallo Risottoreis 500 g' });
  const milkTokens = buildOfferSearchTokens({ title: 'Ja! Natuerlich Vollmilch 1 Liter' });
  const priceTokens = buildOfferSearchTokens({ title: 'Stattpreis Aktion' });

  assert.equal(riceTokens.includes('reis'), true);
  assert.equal(milkTokens.includes('milch'), true);
  assert.equal(priceTokens.includes('reis'), false);
});

test('indexes food oil compounds with a generic oil token without indexing oil side hits', () => {
  const rapeseedOilTokens = buildOfferSearchTokens({
    title: 'BELLASAN Raps\u00f6l 1 l',
    categorySecondary: 'Saucen, Oele & Gewuerze',
  });
  const oliveOilTokens = buildOfferSearchTokens({ title: 'Italienisches Oliven\u00f6l 750 ml' });
  const hairOilTokens = buildOfferSearchTokens({
    title: 'Haar\u00f6l Argan',
    categorySecondary: 'Haarpflege',
  });

  assert.equal(rapeseedOilTokens.includes('rapsoel'), true);
  assert.equal(rapeseedOilTokens.includes('oel'), true);
  assert.equal(oliveOilTokens.includes('olivenoel'), true);
  assert.equal(oliveOilTokens.includes('oel'), true);
  assert.equal(hairOilTokens.includes('haaroel'), true);
  assert.equal(hairOilTokens.includes('oel'), false);
});

test('indexes only true butter product compounds as butter search tokens', () => {
  const teaButterTokens = buildOfferSearchTokens({ title: 'Schaerdinger Teebutter 250 g' });
  const sourCreamButterTokens = buildOfferSearchTokens({ title: 'Sauerrahmbutter 250 g' });
  const bodyButterTokens = buildOfferSearchTokens({ title: 'Bodybutter Kokos' });
  const pastryTokens = buildOfferSearchTokens({ title: 'Oelz Butterpinze 400 g' });
  const peanutTokens = buildOfferSearchTokens({ title: 'Peanut Butter Cups' });

  assert.equal(teaButterTokens.includes('butter'), true);
  assert.equal(sourCreamButterTokens.includes('butter'), true);
  assert.equal(bodyButterTokens.includes('butter'), false);
  assert.equal(pastryTokens.includes('butter'), false);
  assert.equal(peanutTokens.includes('butter'), true);
});

test('adds search token metadata to offer documents', () => {
  const offer = withOfferSearchTokens({
    title: 'Lavazza Caffe Crema',
    brand: 'Lavazza',
    categorySecondary: 'Kaffee & Tee',
  });

  assert.equal(offer.searchTokenVersion, SEARCH_TOKEN_VERSION);
  assert.ok(offer.searchTokens.includes('kaffee'));
  assert.ok(offer.searchTokens.includes('caffe'));
  assert.ok(offer.searchTokens.includes('lavazza'));
});
