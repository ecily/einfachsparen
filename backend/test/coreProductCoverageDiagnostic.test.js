const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CORE_PRODUCT_QUERIES,
  classifyCoreOffer,
  inferZeroReason,
  parseArgs,
} = require('../src/services/diagnostics/coreProductCoverageDiagnostic');

function definition(key) {
  return CORE_PRODUCT_QUERIES.find((item) => item.key === key);
}

function offer(overrides = {}) {
  return {
    title: '',
    titleNormalized: '',
    brand: '',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: '',
    categoryKey: '',
    subcategoryKey: '',
    comparisonGroup: '',
    searchText: '',
    searchTokens: [],
    ...overrides,
  };
}

test('core product coverage args are Git Bash and PowerShell friendly', () => {
  assert.deepEqual(parseArgs([]), { json: false, limit: 800 });
  assert.deepEqual(parseArgs(['--json', '--limit=1200']), { json: true, limit: 1200 });
  assert.deepEqual(parseArgs(['--limit=99']), { json: false, limit: 800 });
});

test('butter classifier accepts real butter and rejects side-hit products', () => {
  assert.equal(classifyCoreOffer(offer({
    title: 'Schaerdinger Teebutter 250 g',
    categorySecondary: 'Milchprodukte',
    searchTokens: ['teebutter', 'butter', 'milchprodukte'],
  }), definition('butter')).classification, 'true');

  assert.equal(classifyCoreOffer(offer({
    title: 'Oelz Butterpinze 400 g',
    categorySecondary: 'Brot & Gebaeck',
    searchTokens: ['butterpinze', 'butter'],
  }), definition('butter')).classification, 'sideHit');

  assert.equal(classifyCoreOffer(offer({
    title: 'MANHATTAN High Shine Butter Me Up Lippenbalsam',
    categorySecondary: 'Milchprodukte',
    searchTokens: ['butter', 'lippenbalsam', 'milchprodukte'],
  }), definition('butter')).classification, 'sideHit');

  assert.equal(classifyCoreOffer(offer({
    title: 'Butter Laugencroissant',
    categorySecondary: 'Brot & Gebaeck',
    searchTokens: ['butter', 'laugencroissant'],
  }), definition('butter')).classification, 'sideHit');

  assert.equal(classifyCoreOffer(offer({
    title: 'BITE ME Protein Cookie Almond Butter',
    categorySecondary: 'Gesundheit & Nahrungsergaenzung',
    searchTokens: ['almond', 'butter', 'cookie', 'protein'],
  }), definition('butter')).classification, 'sideHit');
});

test('rice classifier keeps risottoreis but not preis or pasta category side hits', () => {
  assert.equal(classifyCoreOffer(offer({
    title: 'Riso Gallo Risottoreis Selezione Speciale',
    categorySecondary: 'Pasta, Reis & Konserven',
    searchTokens: ['riso', 'risottoreis', 'reis'],
  }), definition('reis')).classification, 'true');

  assert.equal(classifyCoreOffer(offer({
    title: 'Stattpreis Aktion',
    searchTokens: ['stattpreis'],
  }), definition('reis')).classification, 'sideHit');

  assert.equal(classifyCoreOffer(offer({
    title: 'Barilla Spaghetti',
    categorySecondary: 'Pasta, Reis & Konserven',
    searchTokens: ['pasta', 'reis', 'spaghetti'],
  }), definition('reis')).classification, 'sideHit');
});

test('milk classifier keeps drinking milk and rejects whole-milk chocolate context', () => {
  assert.equal(classifyCoreOffer(offer({
    title: 'Bio Vollmilch 1 l',
    categorySecondary: 'Milchprodukte',
    searchTokens: ['vollmilch', 'milch'],
  }), definition('milch')).classification, 'true');

  assert.equal(classifyCoreOffer(offer({
    title: 'Milka Vollmilch Schokolade',
    categorySecondary: 'Suesswaren & Knabbereien',
    searchTokens: ['vollmilch', 'milch', 'schokolade'],
  }), definition('milch')).classification, 'sideHit');
});

test('noodles classifier separates pasta from sweet noodle side hits', () => {
  assert.equal(classifyCoreOffer(offer({
    title: 'Barilla Penne Rigate',
    categorySecondary: 'Pasta, Reis & Konserven',
    searchTokens: ['penne', 'pasta'],
  }), definition('nudeln')).classification, 'true');

  assert.equal(classifyCoreOffer(offer({
    title: 'Mohnnudeln mit Butterbrösel',
    categorySecondary: 'Suesse Speisen',
    searchTokens: ['mohnnudeln'],
  }), definition('nudeln')).classification, 'sideHit');
});

test('core coverage classifier marks prepared false-positive classes as side hits', () => {
  assert.equal(classifyCoreOffer(offer({
    title: 'Syoss Oleo Intense Haarfarbe Permanente Oel-Coloration',
    categoryPrimary: 'Drogerie',
    categorySecondary: 'Haarfarbe',
  }), definition('oel')).classification, 'sideHit');

  assert.equal(classifyCoreOffer(offer({
    title: 'Meridol Mundspuelung Zahnfleischschutz',
    categoryPrimary: 'Drogerie',
    categorySecondary: 'Mundpflege',
  }), definition('fleisch')).classification, 'sideHit');

  assert.equal(classifyCoreOffer(offer({
    title: 'Somat Geschirrspuel-Tabs Zitrone Limette',
    categoryPrimary: 'Drogerie',
    categorySecondary: 'Geschirrspuelmittel',
    searchTokens: ['obst'],
  }), definition('obst')).classification, 'sideHit');

  assert.equal(classifyCoreOffer(offer({
    title: 'Skoff Sauvignon Blanc Suedsteiermark DAC',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wein',
  }), definition('eier')).classification, 'sideHit');
});

test('zero reason separates source coverage from token and ranking removal causes', () => {
  assert.equal(inferZeroReason({
    signalCount: 0,
    trueCount: 0,
    candidateCount: 0,
    finalDisplayed: 0,
  }), 'no-candidates-in-db');

  assert.equal(inferZeroReason({
    signalCount: 3,
    trueCount: 2,
    candidateCount: 0,
    finalDisplayed: 0,
  }), 'tokens-missing-or-query-prefilter-excludes-db-signals');

  assert.equal(inferZeroReason({
    signalCount: 3,
    trueCount: 2,
    candidateCount: 3,
    finalDisplayed: 0,
    removedExamples: [{ removedReason: 'scoreOfferAgainstQuery-zero' }],
  }), 'ranking-intent-postfilter-removed-candidates');
});
