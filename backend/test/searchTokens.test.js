const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SEARCH_TOKEN_VERSION,
  buildOfferSearchTokens,
  buildQuerySearchTokens,
  normalizeSearchTokenText,
  withOfferSearchTokens,
} = require('../src/services/offers/searchTokens');

test('normalizes coffee accents and conservative coffee synonyms', () => {
  assert.equal(normalizeSearchTokenText('Café Crème'), 'cafe creme');
  assert.deepEqual(new Set(buildQuerySearchTokens('Café')), new Set(['cafe', 'caffe', 'kaffee']));
  assert.deepEqual(new Set(buildQuerySearchTokens('Kaffee')), new Set(['cafe', 'caffe', 'kaffee']));
});

test('normalizes kaese and oel variants conservatively', () => {
  assert.deepEqual(new Set(buildQuerySearchTokens('Käse')), new Set(['kaese', 'kase']));
  assert.deepEqual(new Set(buildQuerySearchTokens('Oel')), new Set(['oel']));
  assert.deepEqual(new Set(buildQuerySearchTokens('Öl')), new Set(['oel']));
});

test('removes stopwords and non-dominant quantity tokens', () => {
  const tokens = buildOfferSearchTokens({
    title: 'Diverse Sorten Packung 1 kg 500 Gramm Stück Kaffee',
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
