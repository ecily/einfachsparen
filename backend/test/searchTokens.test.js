const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FOOD_OIL_PRODUCT_TOKENS,
  SEARCH_TOKEN_VERSION,
  TEE_PRODUCT_TOKENS,
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
  assert.deepEqual(new Set(buildQuerySearchTokens('katzenstreu')), new Set(['katzenstreu', 'klumpstreu', 'streu']));
});

test('expands pet food and S-Budget query aliases without relying on broad substrings', () => {
  assert.deepEqual(new Set(buildQuerySearchTokens('hundefutter')), new Set([
    'biscrok',
    'hundefutter',
    'hundenahrung',
    'hundesnack',
    'pedigree',
    'schmackos',
    'tierfutter',
    'tiernahrung',
  ]));
  assert.equal(buildQuerySearchTokens('tiernahrung').includes('pedigree'), true);
  assert.equal(buildQuerySearchTokens('tiernahrung').includes('fruchtbar'), false);
  assert.deepEqual(new Set(buildQuerySearchTokens('sbudget')), new Set(['budget', 'sbudget']));
  assert.deepEqual(buildQuerySearchTokens('s-budget'), ['budget']);
  assert.deepEqual(buildQuerySearchTokens('s budget'), ['budget']);
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

test('expands wurst query to direct sausage and cold-cut product tokens only', () => {
  const wurstTokens = buildQuerySearchTokens('wurst');

  for (const token of ['wurst', 'salami', 'frankfurter', 'wuerstel', 'aufschnitt', 'schinken', 'speck']) {
    assert.equal(wurstTokens.includes(token), true);
  }

  for (const sideHitToken of ['lachs', 'hendl', 'schnitzel', 'fisch']) {
    assert.equal(wurstTokens.includes(sideHitToken), false);
  }
});

test('expands tee query to direct tea product tokens without coffee or Teebutter side hits', () => {
  const teeTokens = buildQuerySearchTokens('tee');

  for (const token of ['tee', 'teebeutel', 'kraeutertee', 'schwarztee', 'gruentee', 'eistee', 'teekanne']) {
    assert.equal(teeTokens.includes(token), true);
  }

  for (const sideHitToken of ['kaffee', 'kapseln', 'bohnen', 'espresso', 'teebutter', 'kidneybohnen']) {
    assert.equal(teeTokens.includes(sideHitToken), false);
  }

  assert.deepEqual(new Set(teeTokens), new Set(TEE_PRODUCT_TOKENS));
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

test('indexes common wurst compounds with a generic wurst token', () => {
  const grillwurstTokens = buildOfferSearchTokens({ title: 'BBQ Grillwurst-Mix' });
  const salamiTokens = buildOfferSearchTokens({ title: 'Haussalami geschnitten' });
  const fishTokens = buildOfferSearchTokens({ title: 'Lachsfilet frisch' });

  assert.equal(grillwurstTokens.includes('wurst'), true);
  assert.equal(salamiTokens.includes('wurst'), true);
  assert.equal(fishTokens.includes('wurst'), false);
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

test('indexes category promotion scope, conditions and explicit search keywords', () => {
  const tokens = buildOfferSearchTokens({
    offerType: 'category-promotion',
    title: 'bis zu -25% auf alle Waschmittel, Fein- & Spezialwaschmittel inkl. Weichspueler',
    promotionScope: 'waschmittel',
    appliesToCategory: 'waschmittel',
    conditionsText: 'gilt auch fuer Feinwaschmittel und Spezialwaschmittel inkl. Weichspueler',
    categorySecondary: 'Waschmittel & Reiniger',
    searchText: 'waschmittel weichspueler feinwaschmittel spezialwaschmittel',
  });

  for (const token of ['waschmittel', 'weichspueler', 'feinwaschmittel', 'spezialwaschmittel']) {
    assert.equal(tokens.includes(token), true);
  }
});
