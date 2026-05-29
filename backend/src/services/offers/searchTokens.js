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

const WURST_PRODUCT_TOKENS = [
  'aufschnitt',
  'bacon',
  'bierschinken',
  'bratwurst',
  'cabanossi',
  'extrawurst',
  'frankfurter',
  'grillwurst',
  'haussalami',
  'hauswurst',
  'kaesewurst',
  'kantwurst',
  'krakauer',
  'leberkaese',
  'leberkase',
  'leberwurst',
  'mortadella',
  'polnische',
  'presswurst',
  'putensalami',
  'salami',
  'schinken',
  'speck',
  'streichwurst',
  'wuerstel',
  'wuerstl',
  'wurst',
  'wurstl',
];

const TEE_PRODUCT_TOKENS = [
  'eistee',
  'fruechtetee',
  'fruchtetee',
  'gruentee',
  'gruenentee',
  'kamillentee',
  'kraeutertee',
  'krautertee',
  'pfefferminztee',
  'schwarztee',
  'tee',
  'teebeutel',
  'teekanne',
];

const FISCH_PRODUCT_TOKENS = [
  'fisch',
  'fischfilet',
  'fischfilets',
  'fischstaebchen',
  'forelle',
  'forellen',
  'forellenfilet',
  'garnelen',
  'hering',
  'kabeljau',
  'kabeljaufilet',
  'lachs',
  'lachsfilet',
  'makrele',
  'makrelen',
  'matjes',
  'meeresfruechte',
  'prawns',
  'sardine',
  'sardinen',
  'seelachs',
  'seelachsfilet',
  'shrimp',
  'shrimps',
  'sushi',
  'thunfisch',
  'zander',
  'zanderfilet',
];

const DUFT_PRODUCT_TOKENS = [
  'duft',
  'duftset',
  'duftsets',
  'eau',
  'edt',
  'edp',
  'fragrance',
  'homme',
  'parfum',
  'toilette',
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

const QUERY_SYNONYMS = new Map([
  ['hundefutter', ['pedigree', 'schmackos', 'biscrok', 'hundesnack', 'hundenahrung', 'tierfutter', 'tiernahrung']],
  ['katzenstreu', ['klumpstreu', 'streu']],
  ['sbudget', ['budget']],
  ['tiernahrung', [
    'biscrok',
    'felix',
    'hundefutter',
    'hundesnack',
    'katzenfutter',
    'katzenstreu',
    'pedigree',
    'schmackos',
    'sheba',
    'streu',
    'tierfutter',
    'whiskas',
  ]],
  ['fisch', FISCH_PRODUCT_TOKENS.filter((token) => token !== 'fisch')],
  ['tee', TEE_PRODUCT_TOKENS.filter((token) => token !== 'tee')],
  ['wurst', WURST_PRODUCT_TOKENS.filter((token) => token !== 'wurst')],
  ['duft', DUFT_PRODUCT_TOKENS.filter((token) => token !== 'duft')],
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
  ['wurst', WURST_PRODUCT_TOKENS.filter((token) => token !== 'wurst')],
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

function addQueryTokenWithSynonyms(tokens, token) {
  addTokenWithSynonyms(tokens, token);

  for (const synonym of QUERY_SYNONYMS.get(token) || []) {
    addTokenWithSynonyms(tokens, synonym);
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
    offer.description,
    offer.searchText,
    offer.conditionsText,
    offer.offerType,
    offer.promotionScope,
    offer.appliesToCategory,
    offer.regionScope,
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.categoryKey,
    offer.subcategoryKey,
    offer.comparisonSignature,
    offer.comparisonGroup,
    offer.retailerKey,
    offer.retailerName,
    offer.rawFacts?.promotionScope,
    offer.rawFacts?.appliesToCategory,
    offer.rawFacts?.regionScope,
    offer.rawFacts?.evidenceText,
    offer.rawFacts?.sourceText,
  ];

  for (const value of weightedSources) {
    for (const token of tokenizeValue(value)) {
      addTokenWithSynonyms(tokens, token);
      addConservativeCompoundTokens(tokens, token);
    }
  }

  const fragranceText = normalizeSearchTokenText([
    offer.title,
    offer.brand,
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.description,
  ].join(' '));

  if (/\b(eau de parfum|eau de toilette|parfum|fragrance|duftset|duftsets|edt|edp)\b/.test(fragranceText)) {
    addTokenWithSynonyms(tokens, 'duft');
  }

  return [...tokens].sort();
}

function buildQuerySearchTokens(query) {
  const tokens = new Set();

  for (const token of tokenizeValue(query)) {
    const normalizedToken = token === 'ol' ? 'oel' : token;

    addQueryTokenWithSynonyms(tokens, normalizedToken);

    if (normalizedToken === 'oel') {
      for (const oilToken of FOOD_OIL_PRODUCT_TOKENS) {
        addQueryTokenWithSynonyms(tokens, oilToken);
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
  DUFT_PRODUCT_TOKENS,
  FISCH_PRODUCT_TOKENS,
  WURST_PRODUCT_TOKENS,
  TEE_PRODUCT_TOKENS,
  STOPWORDS,
  buildOfferSearchTokens,
  buildQuerySearchTokens,
  hasCurrentSearchTokens,
  normalizeSearchTokenText,
  repairGermanSearchTextEncoding,
  withOfferSearchTokens,
};
