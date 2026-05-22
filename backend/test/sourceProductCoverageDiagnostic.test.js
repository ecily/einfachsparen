const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFalsePositiveClasses,
  classifyFalsePositiveTitle,
  classifyRawDocument,
  definitionForQuery,
  inferProductRootCause,
  normalizeQueryKey,
  parseArgs,
  TARGET_RETAILERS,
} = require('../src/services/diagnostics/sourceProductCoverageDiagnostic');
const {
  CORE_PRODUCT_QUERIES,
} = require('../src/services/diagnostics/coreProductCoverageDiagnostic');

function definition(key) {
  return CORE_PRODUCT_QUERIES.find((item) => item.key === key);
}

function offer(overrides = {}) {
  return {
    title: '',
    titleNormalized: '',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: '',
    categoryKey: '',
    subcategoryKey: '',
    comparisonGroup: '',
    searchTokens: [],
    ...overrides,
  };
}

test('source product coverage args are Git Bash and PowerShell friendly', () => {
  assert.deepEqual(parseArgs([]), { query: 'butter', json: false, limit: 500 });
  assert.deepEqual(parseArgs(['--query=milch', '--json', '--limit=700']), { query: 'milch', json: true, limit: 700 });
  assert.deepEqual(parseArgs(['--query', 'waschmittel', '--json', '--limit', '900']), { query: 'waschmittel', json: true, limit: 900 });
  assert.deepEqual(parseArgs(['--query', '--json']), { query: 'butter', json: true, limit: 500 });
  assert.deepEqual(parseArgs(['reis']), { query: 'reis', json: false, limit: 500 });
});

test('source product coverage custom query keys preserve diagnostic intent', () => {
  assert.equal(normalizeQueryKey('s-budget'), 's-budget');
  assert.equal(normalizeQueryKey('Haushalt Pflege'), 'haushalt-pflege');
  assert.deepEqual({
    key: definitionForQuery('kaffee').key,
    query: definitionForQuery('kaffee').query,
    trueTerms: definitionForQuery('kaffee').trueTerms,
  }, {
    key: 'kaffee',
    query: 'kaffee',
    trueTerms: ['kaffee'],
  });
  assert.equal(definitionForQuery('s-budget').key, 's-budget');
  assert.equal(definitionForQuery('butter').key, 'butter');
});

test('source product coverage diagnostics include SPAR format retailers', () => {
  assert.equal(TARGET_RETAILERS.includes('spar'), true);
  assert.equal(TARGET_RETAILERS.includes('eurospar'), true);
  assert.equal(TARGET_RETAILERS.includes('interspar'), true);
});

test('raw document classifier separates true butter evidence from side-hit butter text', () => {
  assert.equal(classifyRawDocument({
    title: 'BILLA promotions',
    payload: { sampleNames: ['Schaerdinger Teebutter 250 g'] },
  }, definition('butter')).classification, 'true');

  assert.equal(classifyRawDocument({
    title: 'Bakery promotions',
    extractedPreview: ['Oelz Butterpinze 400 g'],
  }, definition('butter')).classification, 'sideHit');

  assert.equal(classifyRawDocument({
    title: 'Cosmetics promotions',
    payload: { sampleNames: ['MANHATTAN Butter Me Up Lippenbalsam'] },
  }, definition('butter')).classification, 'sideHit');
});

test('root cause distinguishes source coverage from parser loss and active offer visibility', () => {
  const butter = definition('butter');
  const trueOffer = offer({
    title: 'Teebutter 250 g',
    categorySecondary: 'Milchprodukte',
    searchTokens: ['teebutter', 'butter'],
  });
  const trueRaw = {
    payload: { sampleNames: ['Sauerrahmbutter 250 g'] },
    foundRawItems: 10,
    parsedOffers: 0,
  };

  assert.equal(inferProductRootCause({ offers: [trueOffer], rawDocuments: [], definition: butter }), 'true-active-offer-exists');
  assert.equal(inferProductRootCause({ offers: [], rawDocuments: [trueRaw], definition: butter }), 'raw-true-evidence-parser-loss');
  assert.equal(inferProductRootCause({
    offers: [],
    rawDocuments: [{ ...trueRaw, foundRawItems: 1, parsedOffers: 1 }],
    definition: butter,
  }), 'raw-true-evidence-no-active-offer');
  assert.equal(inferProductRootCause({
    offers: [offer({ title: 'Buttercroissant', searchTokens: ['butter'] })],
    rawDocuments: [],
    definition: butter,
  }), 'only-side-or-unclear-evidence');
});

test('false-positive class preparation groups known weak product classes', () => {
  assert.equal(classifyFalsePositiveTitle('fleisch', 'Tomatenpflanzen Strauch-, Fleisch- oder Ovaltomaten'), 'plant-variety');
  assert.equal(classifyFalsePositiveTitle('oel', 'Syoss Oleo Intense Haarfarbe'), 'hair-cosmetics');
  assert.equal(classifyFalsePositiveTitle('obst', 'Somat Geschirrspuel-Tabs Zitrone Limette'), 'dishwasher-tabs-fruit-scent');

  const groups = buildFalsePositiveClasses([
    {
      key: 'fleisch',
      definition: definition('fleisch'),
      offers: [
        offer({ title: 'Tomatenpflanzen Strauch-, Fleisch- oder Ovaltomaten' }),
        offer({ title: 'Meridol Mundspuelung Zahnfleischschutz' }),
      ],
    },
  ]);

  assert.deepEqual(groups[0].topClasses.map((item) => item.className), ['plant-variety', 'dental-care-fragment']);
});
