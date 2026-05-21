const { normalizeTitleForMatch } = require('../crawl/sourceEvidence');

const SEARCH_TOKEN_VERSION = 2;

const FOOD_OIL_PRODUCT_TOKENS = [
  'bratoel',
  'bratol',
  'kronenoel',
  'kronenol',
  'kuerbiskernoel',
  'kuerbiskernol',
  'kurbiskernoel',
  'kurbiskernol',
  'olivenoel',
  'olivenol',
  'pflanzenoel',
  'pflanzenol',
  'rapsoel',
  'rapsol',
  'sonnenblumenoel',
  'sonnenblumenol',
  'speiseoel',
  'speiseol',
];

const STOPWORDS = new Set([
  'ab',
  'aktion',
  'aktuell',
  'angebot',
  'becher',
  'beutel',
  'bis',
  'cl',
  'div',
  'diverse',
  'dose',
  'flasche',
  'g',
  'glas',
  'gramm',
  'gueltig',
  'kg',
  'kilogramm',
  'l',
  'liter',
  'ml',
  'oder',
  'pack',
  'packung',
  'sorten',
  'stk',
  'stueck',
  'und',
  'versch',
]);

const SYNONYMS = new Map([
  ['cafe', ['kaffee', 'caffe']],
  ['caffe', ['kaffee', 'cafe']],
  ['kaffee', ['cafe', 'caffe']],
  ['haaroel', ['haarol']],
  ['haarol', ['haaroel']],
  ['katzenstreu', ['klumpstreu']],
  ['klumpstreu', ['katzenstreu']],
  ['kase', ['kaese']],
  ['kaese', ['kase']],
  ['nudeln', ['nudel', 'pasta', 'spaghetti', 'penne', 'fusilli', 'makkaroni', 'maccheroni', 'teigwaren']],
  ['nudel', ['nudeln', 'pasta', 'spaghetti', 'penne', 'fusilli', 'makkaroni', 'maccheroni', 'teigwaren']],
  ['oel', ['ol']],
  ['ol', ['oel']],
  ['suesswaren', ['susswaren']],
  ['susswaren', ['suesswaren']],
]);

const COMPOUND_PRODUCT_TOKENS = new Set([
  'milch',
  'reis',
]);

const CONSERVATIVE_COMPOUND_TOKEN_ALIASES = new Map([
  ['oel', FOOD_OIL_PRODUCT_TOKENS],
  ['butter', [
    'alpenbutter',
    'bauernbutter',
    'markenbutter',
    'sauerrahmbutter',
    'streichbutter',
    'suessrahmbutter',
    'sussrahmbutter',
    'teebutter',
  ]],
]);

function repairGermanSearchTextEncoding(value) {
  return String(value || '')
    .replace(/\u00c3\u00a4/g, '\u00e4')
    .replace(/\u00c3\u00b6/g, '\u00f6')
    .replace(/\u00c3\u00bc/g, '\u00fc')
    .replace(/\u00c3\u009f/g, '\u00df')
    .replace(/\ufffd(?=l\b)/gi, 'oe')
    .replace(/\ufffd(?=le\b)/gi, 'oe')
    .replace(/\ufffd(?=ther)/gi, 'ae')
    .replace(/\ufffd(?=se\b)/gi, 'ae');
}

function normalizeSearchTokenText(value) {
  return normalizeTitleForMatch(
    repairGermanSearchTextEncoding(value)
      .toLowerCase()
      .replace(/\u00e4/g, 'ae')
      .replace(/\u00f6/g, 'oe')
      .replace(/\u00fc/g, 'ue')
      .replace(/\u00df/g, 'ss')
  );
}

function addTokenWithSynonyms(tokens, token) {
  if (!token || token.length < 3 || STOPWORDS.has(token) || /^\d+$/.test(token)) {
    return;
  }

  tokens.add(token);

  for (const synonym of SYNONYMS.get(token) || []) {
    if (synonym.length >= 3 && !STOPWORDS.has(synonym)) {
      tokens.add(synonym);
    }
  }
}

function addConservativeCompoundTokens(tokens, token) {
  for (const productToken of COMPOUND_PRODUCT_TOKENS) {
    if (token === productToken || token === `p${productToken}` || token.endsWith(`p${productToken}`)) {
      continue;
    }

    if (token.endsWith(productToken) || token.startsWith(productToken)) {
      addTokenWithSynonyms(tokens, productToken);
    }
  }

  for (const [productToken, compounds] of CONSERVATIVE_COMPOUND_TOKEN_ALIASES.entries()) {
    if (compounds.includes(token)) {
      addTokenWithSynonyms(tokens, productToken);
    }
  }
}

function tokenizeValue(value) {
  return normalizeSearchTokenText(value).split(/\s+/).filter(Boolean);
}

function buildOfferSearchTokens(offer = {}) {
  const tokens = new Set();
  const weightedSources = [
    offer.title,
    offer.titleNormalized,
    offer.brand,
    offer.manufacturer,
    offer.productName,
    offer.normalizedName,
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.categoryKey,
    offer.subcategoryKey,
    offer.comparisonSignature,
    offer.comparisonGroup,
    offer.retailerKey,
    offer.retailerName,
  ];

  for (const value of weightedSources) {
    for (const token of tokenizeValue(value)) {
      addTokenWithSynonyms(tokens, token);
      addConservativeCompoundTokens(tokens, token);
    }
  }

  return [...tokens].sort();
}

function buildQuerySearchTokens(query) {
  const tokens = new Set();

  for (const token of tokenizeValue(query)) {
    const normalizedToken = token === 'ol' ? 'oel' : token;

    addTokenWithSynonyms(tokens, normalizedToken);

    if (normalizedToken === 'oel') {
      for (const oilToken of FOOD_OIL_PRODUCT_TOKENS) {
        addTokenWithSynonyms(tokens, oilToken);
      }

      continue;
    }
  }

  return [...tokens].sort();
}

function hasCurrentSearchTokens(offer = {}) {
  return Array.isArray(offer.searchTokens) &&
    offer.searchTokens.length > 0 &&
    Number(offer.searchTokenVersion || 0) >= SEARCH_TOKEN_VERSION;
}

function withOfferSearchTokens(offer = {}) {
  return {
    ...offer,
    searchTokens: buildOfferSearchTokens(offer),
    searchTokenVersion: SEARCH_TOKEN_VERSION,
  };
}

module.exports = {
  SEARCH_TOKEN_VERSION,
  FOOD_OIL_PRODUCT_TOKENS,
  STOPWORDS,
  buildOfferSearchTokens,
  buildQuerySearchTokens,
  hasCurrentSearchTokens,
  normalizeSearchTokenText,
  repairGermanSearchTextEncoding,
  withOfferSearchTokens,
};
