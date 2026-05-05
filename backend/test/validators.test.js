const assert = require('node:assert/strict');
const test = require('node:test');
const { validateRankingQuery } = require('../src/middleware/validators');

const LEGITIMATE_CATEGORIES = [
  'Suesswaren & Knabbereien',
  'Saucen',
  'Oele & Gewuerze',
  'Fleisch',
  'Wurst & Fisch',
  'Obst & Gemuese',
  'Tiefkuehl- & Fertigprodukte',
  'Kaese',
  'Pasta',
  'Reis & Konserven',
  'Brot & Gebaeck',
  'Milchprodukte',
  'Backen & Grundnahrungsmittel',
  'Fruehstueck & Aufstriche',
  'Sonstiges',
  'Kuechenhelfer',
  'Waschmittel & Reiniger',
  'Papier & Buero',
  'Lufterfrischer & Raumduft',
  'Aufbewahrung & Folien',
];

function runRankingValidator(query) {
  const req = { query: { ...query } };
  let nextError = null;

  validateRankingQuery(req, {}, (error) => {
    nextError = error || null;
  });

  return {
    req,
    error: nextError,
  };
}

test('accepts legitimate ranking query with around 20 categories', () => {
  const { req, error } = runRankingValidator({
    categories: LEGITIMATE_CATEGORIES.join(','),
    retailers: 'billa,pagro',
    programRetailers: 'billa,pagro',
    unit: 'all',
    limit: '60',
  });

  assert.equal(error, null);
  assert.equal(req.query.limit, 60);
  assert.equal(req.query.categories.split(',').length, LEGITIMATE_CATEGORIES.length);
  assert.equal(req.query.retailers, 'billa,pagro');
  assert.equal(req.query.programRetailers, 'billa,pagro');
});

test('rejects ranking query with too many categories', () => {
  const tooManyCategories = Array.from({ length: 200 }, (_, index) => `Kategorie ${index + 1}`).join(',');
  const { error } = runRankingValidator({
    categories: tooManyCategories,
    limit: '60',
  });

  assert.equal(error?.statusCode, 400);
  assert.match(error?.message, /categories enthaelt zu viele Werte/);
});

test('keeps public limit=all rejected for ranking queries', () => {
  const { error } = runRankingValidator({
    q: 'butter',
    limit: 'all',
  });

  assert.equal(error?.statusCode, 400);
  assert.match(error?.message, /limit=all ist oeffentlich nicht erlaubt/);
});

test('accepts normal search query with limit 60', () => {
  const { req, error } = runRankingValidator({
    q: 'butter',
    limit: '60',
  });

  assert.equal(error, null);
  assert.equal(req.query.q, 'butter');
  assert.equal(req.query.limit, 60);
});

test('accepts multiple retailers and program retailers but caps oversized limit', () => {
  const { req, error } = runRankingValidator({
    q: 'kaffee',
    retailers: 'hofer,lidl,spar,billa,billa-plus,penny,dm,bipa',
    programRetailers: 'billa,billa-plus,lidl,dm,bipa',
    limit: '999999',
  });

  assert.equal(error, null);
  assert.equal(req.query.limit, 60);
  assert.equal(req.query.retailers.split(',').length, 8);
  assert.equal(req.query.programRetailers.split(',').length, 5);
});
