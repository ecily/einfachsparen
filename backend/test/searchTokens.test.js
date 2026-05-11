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
