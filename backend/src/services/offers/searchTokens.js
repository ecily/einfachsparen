const { normalizeTitleForMatch } = require('../crawl/sourceEvidence');

const SEARCH_TOKEN_VERSION = 1;

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
  ['kase', ['kaese']],
  ['kaese', ['kase']],
  ['oel', ['ol']],
  ['ol', ['oel']],
  ['suesswaren', ['susswaren']],
  ['susswaren', ['suesswaren']],
]);

function normalizeSearchTokenText(value) {
  return normalizeTitleForMatch(
    String(value || '')
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
    }
  }

  return [...tokens].sort();
}

function buildQuerySearchTokens(query) {
  const tokens = new Set();

  for (const token of tokenizeValue(query)) {
    addTokenWithSynonyms(tokens, token);
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
  STOPWORDS,
  buildOfferSearchTokens,
  buildQuerySearchTokens,
  hasCurrentSearchTokens,
  normalizeSearchTokenText,
  withOfferSearchTokens,
};
