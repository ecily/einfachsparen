const Offer = require('../../models/Offer');
const Category = require('../../models/Category');
const Retailer = require('../../models/Retailer');
const RetailerCategoryOfferCache = require('../../models/RetailerCategoryOfferCache');
const RankingResultCache = require('../../models/RankingResultCache');
const crypto = require('node:crypto');
const { computeOfferSavings } = require('./promotionMath');
const { SEARCH_TOKEN_VERSION, buildQuerySearchTokens, repairGermanSearchTextEncoding } = require('./searchTokens');
const { isOfferSafelyComparable, normalizeComparableUnit } = require('../crawl/offerQualityGuards');
const { CATEGORY_TAXONOMY } = require('../crawl/categoryClassifier');
const { normalizeTitleForMatch } = require('../crawl/sourceEvidence');
const { isOfferFreshForActiveUse } = require('./offerFreshness');
const { classifyOfferSourceQuality } = require('./sourceQuality');

const OFFER_RANKING_FIELD_LIST = [
  '_id',
  'retailerKey',
  'retailerName',
  'title',
  'titleNormalized',
  'brand',
  'searchTokens',
  'searchTokenVersion',
  'searchText',
  'categoryKey',
  'categoryPrimary',
  'categorySecondary',
  'subcategoryKey',
  'categoryConfidence',
  'subcategoryConfidence',
  'conditionsText',
  'customerProgramRequired',
  'hasConditions',
  'isMultiBuy',
  'effectiveDiscountType',
  'comparisonGroup',
  'offerKey',
  'dedupeKey',
  'status',
  'isActiveNow',
  'isActiveToday',
  'quantityText',
  'validFrom',
  'validTo',
  'packCount',
  'unitValue',
  'unitType',
  'totalComparableAmount',
  'comparableUnit',
  'packageType',
  'normalizedUnitPrice',
  'priceCurrent',
  'priceReference',
  'priceReferenceSource',
  'priceReferenceConfidence',
  'savingsDisplayType',
  'savingsConfidence',
  'hasReferencePrice',
  'hasProspectNormalPrice',
  'hasEstimatedReferencePrice',
  'isActionPriceOnly',
  'imageUrl',
  'quality',
  'sortScoreDefault',
  'minimumPurchaseQty',
  'sourceType',
  'sourceUrl',
  'sourceUrls',
  'sourceTypes',
  'evidenceUrls',
  'lastSeenAt',
  'updatedAt',
  'reviewReasons',
  'rawFacts.explicitExpired',
  'rawFacts.validTo',
  'rawFacts.clickoutUrl',
  'rawFacts.leafletHref',
  'rawFacts.validitySource',
  'rawFacts.discountPercentage',
  'rawFacts.discountPercent',
  'rawFacts.discountScope',
  'rawFacts.discountLevel',
  'rawFacts.isCampaignDiscount',
  'rawFacts.discountAppliesToProduct',
  'rawFacts.referencePriceType',
  'rawFacts.referencePriceSource',
  'rawFacts.referencePriceDerived',
  'rawFacts.savingsDisplayType',
];
const OFFER_RANKING_FIELDS = OFFER_RANKING_FIELD_LIST.join(' ');

const RANKING_CACHE_TTL_MS = 3 * 60 * 1000;
const RANKING_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
const RANKING_CACHE_SCHEMA_VERSION = `ranking-cache-v6-source-quality-search-token-v${SEARCH_TOKEN_VERSION}-oil-recall-v2`;
const RANKING_CANDIDATE_CAP = 1000;
const RANKING_QUERY_MAX_TIME_MS = 1500;
const RANKING_SEARCH_TOKEN_FALLBACK_MODE = String(process.env.RANKING_SEARCH_TOKEN_FALLBACK_MODE || '').trim().toLowerCase();
const RANKING_SORT = { sortScoreDefault: -1, 'normalizedUnitPrice.amount': 1, validTo: 1, retailerName: 1, title: 1 };

function getRankingCacheCapabilities() {
  return {
    schemaVersion: RANKING_CACHE_SCHEMA_VERSION,
    resultSetTokens: true,
    mongoBackedResultSets: true,
    resultSetTtlSeconds: Math.round(RANKING_RESULT_CACHE_TTL_MS / 1000),
  };
}
const rankingResponseCache = new Map();
const rankingResultBaseCache = new Map();
const INSTANCE_MARKER = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRetailerKey(value) {
  return normalizeTitleForMatch(value).replace(/\s+/g, '-');
}

function normalizeRetailerList(value) {
  return [...new Set(normalizeStringList(value).map(normalizeRetailerKey).filter(Boolean))];
}

function normalizeCategoryLabelKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildKnownCategoryLabelMap(categoryDocuments = []) {
  const labels = new Map();
  const addLabel = (label) => {
    const cleanLabel = String(label || '').trim();

    if (cleanLabel) {
      labels.set(normalizeCategoryLabelKey(cleanLabel), cleanLabel);
    }
  };

  for (const category of CATEGORY_TAXONOMY) {
    addLabel(category.main);

    for (const subcategory of category.subcategories || []) {
      addLabel(subcategory.label);
    }
  }

  for (const category of categoryDocuments || []) {
    addLabel(category?.mainCategoryLabel);

    for (const subcategory of category?.subcategories || []) {
      addLabel(subcategory?.subcategoryLabel);
    }
  }

  return labels;
}

function parseJsonCategoryArray(value) {
  const trimmed = String(value || '').trim();

  if (!trimmed.startsWith('[')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean);
    }
  } catch (error) {
    return null;
  }

  return null;
}

function parseLegacyCategoryList(value, knownCategoryLabels) {
  const parts = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const categories = [];

  for (let index = 0; index < parts.length; index += 1) {
    let matchedLabel = '';
    let matchedEndIndex = index;

    for (let endIndex = parts.length - 1; endIndex >= index; endIndex -= 1) {
      const candidate = parts.slice(index, endIndex + 1).join(', ');
      const knownLabel = knownCategoryLabels.get(normalizeCategoryLabelKey(candidate));

      if (knownLabel) {
        matchedLabel = knownLabel;
        matchedEndIndex = endIndex;
        break;
      }
    }

    if (matchedLabel) {
      categories.push(matchedLabel);
      index = matchedEndIndex;
    } else {
      categories.push(parts[index]);
    }
  }

  return categories;
}

function parseRankingCategories(value, knownCategoryLabels = buildKnownCategoryLabelMap()) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        const jsonItems = parseJsonCategoryArray(item);
        return jsonItems || [String(item || '').trim()];
      })
      .filter(Boolean);
  }

  const rawValue = String(value || '').trim();

  if (!rawValue) {
    return [];
  }

  const jsonItems = parseJsonCategoryArray(rawValue);

  if (jsonItems) {
    return jsonItems;
  }

  const knownLabel = knownCategoryLabels.get(normalizeCategoryLabelKey(rawValue));

  if (knownLabel) {
    return [knownLabel];
  }

  if (rawValue.includes(',')) {
    return parseLegacyCategoryList(rawValue, knownCategoryLabels);
  }

  return [rawValue];
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function normalizeProgramRetailers(value) {
  return normalizeRetailerList(value);
}

function buildRankingCacheKey({
  categories = '',
  query = '',
  unit = 'all',
  retailers = '',
  programRetailers = '',
  onlyWithoutProgram = false,
  limit = 30,
  offset = 0,
  offsetExplicit = false,
}) {
  return JSON.stringify({
    cacheSchemaVersion: RANKING_CACHE_SCHEMA_VERSION,
    categories: normalizeStringList(categories).sort(),
    query: String(query || '').trim().toLowerCase(),
    unit: String(unit || 'all').trim().toLowerCase(),
    retailers: normalizeRetailerList(retailers).sort(),
    programRetailers: normalizeProgramRetailers(programRetailers).sort(),
    onlyWithoutProgram: normalizeBoolean(onlyWithoutProgram),
    limit: String(limit || '30').trim().toLowerCase(),
    offset: Math.max(0, Number(offset) || 0),
    paginated: Boolean(offsetExplicit),
  });
}

function buildRankingBaseCacheKey({
  categories = '',
  query = '',
  unit = 'all',
  retailers = '',
  programRetailers = '',
  onlyWithoutProgram = false,
}) {
  return JSON.stringify({
    cacheSchemaVersion: RANKING_CACHE_SCHEMA_VERSION,
    categories: normalizeStringList(categories).sort(),
    query: String(query || '').trim().toLowerCase(),
    unit: String(unit || 'all').trim().toLowerCase(),
    retailers: normalizeRetailerList(retailers).sort(),
    programRetailers: normalizeProgramRetailers(programRetailers).sort(),
    onlyWithoutProgram: normalizeBoolean(onlyWithoutProgram),
  });
}

function hashRankingCacheKey(cacheKey) {
  return crypto.createHash('sha256').update(String(cacheKey || '')).digest('hex').slice(0, 32);
}

function createResultSetToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function getCachedRankingEntry(cache, cacheKey) {
  const entry = cache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (Date.now() - entry.createdAt > RANKING_CACHE_TTL_MS) {
    cache.delete(cacheKey);
    return null;
  }

  return entry.value;
}

function setCachedRankingEntry(cache, cacheKey, value) {
  cache.set(cacheKey, {
    createdAt: Date.now(),
    value,
  });
}

function getCachedRankingResponse(cacheKey) {
  return getCachedRankingEntry(rankingResponseCache, cacheKey);
}

function setCachedRankingResponse(cacheKey, value) {
  setCachedRankingEntry(rankingResponseCache, cacheKey, value);
}

function getCachedRankingResultBase(cacheKey) {
  return getCachedRankingEntry(rankingResultBaseCache, cacheKey);
}

function setCachedRankingResultBase(cacheKey, value) {
  setCachedRankingEntry(rankingResultBaseCache, cacheKey, value);
}

function clearRankingResponseCache() {
  rankingResponseCache.clear();
  rankingResultBaseCache.clear();
}

function getRankingResponseCacheSize() {
  return rankingResponseCache.size + rankingResultBaseCache.size;
}

function summarizeDebugRankingOffer(offer, { query = '' } = {}) {
  return {
    id: String(offer?._id || offer?.id || ''),
    retailerKey: offer?.retailerKey || '',
    retailerName: offer?.retailerName || '',
    title: offer?.title || '',
    searchTokens: Array.isArray(offer?.searchTokens) ? offer.searchTokens.slice(0, 24) : [],
    searchTokenVersion: offer?.searchTokenVersion ?? null,
    score: query ? scoreOfferAgainstQuery(offer, query) : null,
  };
}

function buildDebugRankingStage({ stage, offers = [], query = '', previousIds = null, reason = '' }) {
  const ids = new Set(offers.map((offer) => String(offer?._id || offer?.id || '')).filter(Boolean));
  const removed = previousIds
    ? [...previousIds]
        .filter((id) => !ids.has(id))
        .slice(0, 20)
        .map((id) => ({ id, reason }))
    : [];

  return {
    stage,
    count: offers.length,
    top: offers.slice(0, 20).map((offer) => summarizeDebugRankingOffer(offer, { query })),
    removed,
  };
}

function buildCurrentAvailabilityMatch() {
  return {
    status: 'active',
    isActiveNow: true,
  };
}

function filterFreshActiveOffers(offers, now = new Date()) {
  return offers.filter((offer) => isOfferFreshForActiveUse(offer, now));
}

function isUsefulCategory(category) {
  return Boolean(String(category || '').trim());
}

function isGenericCategory(category) {
  return /^(lebensmittel|getraenke|getränke|haushalt|drogerie \/ hygiene|dose|in öl)$/i.test(String(category || '').trim());
}

function isBroadCategory(category) {
  return /^(lebensmittel|getraenke|getranke|haushalt|drogerie \/ hygiene|tierbedarf|garten \/ pflanzen|kleidung \/ mode|technik \/ elektronik|freizeit \/ sonstiges|baby \/ kinder|dose|in ol)$/i.test(String(category || '').trim());
}

function selectDisplayCategory(offer) {
  const primary = String(offer?.categoryPrimary || '').trim();
  const secondary = String(offer?.categorySecondary || '').trim();

  if (secondary && isUsefulCategory(secondary) && !isBroadCategory(secondary)) {
    return secondary;
  }

  if (primary && isUsefulCategory(primary)) {
    return primary;
  }

  return secondary || primary || '';
}

function normalizeSearchText(value) {
  return repairGermanSearchTextEncoding(value)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenizeSearchText(value) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

function buildWordString(value) {
  const tokens = tokenizeSearchText(value);
  return tokens.length > 0 ? ` ${tokens.join(' ')} ` : ' ';
}

function hasPhrase(wordString, queryTokens) {
  if (queryTokens.length === 0) {
    return false;
  }

  return wordString.includes(` ${queryTokens.join(' ')} `);
}

const QUERY_CONTEXTS = [
  {
    key: 'body-butter',
    tokens: ['body', 'butter', 'bodybutter', 'koerperbutter', 'korperbutter', 'facial', 'cream', 'lotion'],
    anyTokenSequences: [
      ['body', 'butter'],
      ['facial', 'butter'],
      ['body', 'cream'],
      ['body', 'lotion'],
    ],
    phraseOnly: true,
    preferred: ['bodybutter', 'koerperbutter', 'korperbutter', 'body', 'butter', 'cream', 'lotion', 'koerperpflege', 'korperpflege', 'kosmetik', 'pflege'],
    strongPreferred: ['bodybutter', 'koerperbutter', 'korperbutter', 'koerperpflege', 'korperpflege', 'kosmetik'],
    productIntent: ['bodybutter', 'koerperbutter', 'korperbutter', 'body', 'facial', 'butter', 'cream', 'lotion'],
    exactProductIntent: ['bodybutter', 'koerperbutter', 'korperbutter'],
    productContext: ['koerperpflege', 'korperpflege', 'kosmetik', 'pflege'],
    weakContexts: ['spray', 'mist', 'lippenbalsam', 'lippenpflege', 'peanut', 'erdnuss', 'erdnussbutter', 'protein', 'cups', 'schokolade', 'suesswaren', 'susswaren'],
    severeWeakContexts: ['lebensmittel', 'milchprodukte', 'molkerei', 'teebutter', 'peanut', 'erdnussbutter'],
  },
  {
    key: 'essential-oil',
    tokens: ['aetherisch', 'atherisch', 'essential', 'duftoel', 'duftol', 'aromaoel', 'aromaol'],
    anyTokenSequences: [
      ['aetherisches', 'oel'],
      ['atherisches', 'ol'],
      ['essential', 'oil'],
    ],
    preferred: ['aetherisch', 'atherisch', 'essential', 'duftoel', 'duftol', 'aroma', 'aromatherapie', 'drogerie', 'koerperpflege', 'korperpflege'],
    strongPreferred: ['aetherisch', 'atherisch', 'essential', 'duftoel', 'duftol', 'aromatherapie'],
    productIntent: ['aetherisch', 'atherisch', 'essential', 'duftoel', 'duftol', 'aromaoel', 'aromaol', 'lavendel', 'eukalyptus'],
    exactProductIntent: ['duftoel', 'duftol', 'aromaoel', 'aromaol'],
    productContext: ['drogerie', 'koerperpflege', 'korperpflege', 'aromatherapie', 'duft'],
    weakContexts: ['haaroel', 'haarol', 'shampoo', 'oleo'],
    severeWeakContexts: ['lebensmittel', 'saucen', 'gewuerze', 'gewurze', 'thunfisch', 'frischkaese', 'speiseoel', 'speiseol', 'olivenoel', 'olivenol', 'rapsoel', 'rapsol', 'sonnenblumenoel', 'sonnenblumenol'],
  },
  {
    key: 'hair-oil',
    tokens: ['haaroel', 'haarol'],
    anyTokenSequences: [
      ['hair', 'oil'],
      ['haar', 'oel'],
      ['haar', 'ol'],
    ],
    preferred: ['haaroel', 'haarol', 'hair', 'oil', 'haarpflege', 'drogerie'],
    strongPreferred: ['haaroel', 'haarol', 'hair', 'oil', 'haarpflege'],
    productIntent: ['haaroel', 'haarol', 'hairoil'],
    exactProductIntent: ['haaroel', 'haarol', 'hairoil'],
    productContext: ['haarpflege', 'drogerie'],
    weakContexts: ['haarspray', 'spray', 'koerperspray', 'korperspray', 'body', 'coloration', 'haarfarbe', 'shampoo'],
    severeWeakContexts: ['haarspray', 'spray', 'koerperspray', 'korperspray', 'body', 'lebensmittel'],
  },
  {
    key: 'butter',
    tokens: ['butter'],
    preferred: ['butter', 'milchprodukte', 'molkerei', 'milch', 'backen', 'lebensmittel'],
    strongPreferred: ['butter', 'milchprodukte', 'molkerei'],
    productIntent: ['butter', 'teebutter'],
    exactProductIntent: ['teebutter'],
    productContext: ['milchprodukte', 'molkerei'],
    severeWeakContexts: ['lippenbalsam', 'kosmetik', 'make', 'highlighter', 'body', 'bodybutter', 'facial', 'face', 'creme', 'lotion', 'shea', 'karite', 'peanut', 'erdnussbutter'],
    weakContexts: [
      'backbox',
      'brot',
      'gebaeck',
      'geback',
      'croissant',
      'topfengolatsche',
      'buttercroissant',
      'butterkaese',
      'butterkase',
      'briochestriezel',
      'buttergemuese',
      'buttergemuse',
      'butterkeks',
      'cookie',
      'cookies',
      'cups',
      'kraeuterbutter',
      'krauterbutter',
      'gewuerz',
      'gewurz',
      'gewuerzzubereitung',
      'gewurzzubereitung',
      'gemuese',
      'gemuse',
      'kaese',
      'kase',
      'peanut',
      'protein',
      'buttermilch',
      'kosmetik',
      'make',
      'lippenbalsam',
      'nahrungsergaenzung',
      'nahrungserganzung',
    ],
  },
  {
    tokens: ['kaffee', 'cafe', 'caffe'],
    preferred: ['kaffee', 'tee', 'getraenke', 'getranke', 'fruehstueck', 'fruhstuck', 'caffe'],
    strongPreferred: ['kaffee', 'tee', 'caffe'],
    productIntent: ['kaffee', 'cafe', 'caffe', 'espresso', 'bohnen', 'bohne', 'gemahlen', 'kapseln', 'kapsel', 'pads', 'crema'],
    exactProductIntent: ['espresso', 'bohnen', 'bohne', 'gemahlen', 'kapseln', 'kapsel', 'pads', 'crema'],
    productContext: ['kaffee', 'tee', 'fruehstueck', 'fruhstuck'],
    weakContexts: ['eiskaffee', 'drink', 'pflanze', 'zierpflanze', 'duftgeranie', 'tomate', 'erdbeere', 'banane'],
  },
  {
    key: 'milch',
    tokens: ['milch'],
    preferred: ['milch', 'milchprodukte', 'molkerei', 'lebensmittel'],
    strongPreferred: ['milch', 'milchprodukte', 'molkerei'],
    productIntent: ['milch', 'trinkmilch', 'frischmilch', 'haltbarmilch', 'vollmilch', 'heumilch', 'biomilch'],
    exactProductIntent: ['trinkmilch', 'frischmilch', 'haltbarmilch'],
    productContext: ['milchprodukte', 'molkerei', 'milch'],
    weakContexts: ['schlagobers', 'sahne', 'obers', 'dessert', 'pudding', 'torte', 'milchreis', 'drink', 'reisdrink'],
    severeWeakContexts: [
      'schokolade',
      'schoko',
      'zartbitter',
      'chocolonely',
      'bahlsen',
      'mikado',
      'pickup',
      'pick',
      'merci',
      'choco',
      'mandel',
      'nuss',
      'keks',
      'kekse',
      'riegel',
      'pralinen',
      'tafel',
      'broetchen',
      'brotle',
      'camembert',
      'emmentaler',
      'edamer',
      'gouda',
      'graukaese',
      'graukase',
      'kaese',
      'kase',
      'scheiben',
      'gerieben',
      'bahlsen',
    ],
  },
  {
    tokens: ['huhn', 'hendl', 'huehnchen', 'huhnchen'],
    preferred: ['huhn', 'hendl', 'huehnchen', 'huhnchen', 'gefluegel', 'geflugel', 'fleisch', 'lebensmittel'],
    strongPreferred: ['huhn', 'hendl', 'huehnchen', 'huhnchen', 'gefluegel', 'geflugel', 'fleisch'],
    productIntent: ['huhn', 'hendl', 'huehnchen', 'huhnchen', 'huehnerfilet', 'huhnerfilet', 'huehnerbrust', 'huhnerbrust', 'gefluegel', 'geflugel'],
    exactProductIntent: ['hendl', 'gefluegel', 'geflugel'],
    productContext: ['fleisch', 'wurst', 'fisch', 'lebensmittel', 'gefluegel', 'geflugel'],
    weakContexts: ['nassfutter', 'trockenfutter', 'tierfutter', 'katze', 'katzen', 'hund', 'hunde', 'gourmet', 'sheba', 'whiskas', 'felix'],
    severeWeakContexts: ['tierbedarf', 'katzenfutter', 'hundefutter'],
  },
  {
    key: 'joghurt',
    tokens: ['joghurt'],
    preferred: ['joghurt', 'milchprodukte', 'molkerei', 'lebensmittel'],
    strongPreferred: ['joghurt', 'milchprodukte', 'molkerei'],
    productIntent: ['joghurt', 'naturjoghurt', 'fruchtjoghurt', 'jogurt', 'yoghurt', 'yogurt', 'skyr'],
    exactProductIntent: ['naturjoghurt', 'fruchtjoghurt', 'skyr'],
    productContext: ['milchprodukte', 'molkerei', 'joghurt'],
    weakContexts: ['fruchtriegel', 'lachgummi', 'riegel', 'suesswaren', 'susswaren', 'dessert', 'torte', 'margarine', 'rama', 'kuchen', 'schnitte'],
    severeWeakContexts: ['duschgel', 'body', 'koerperpflege', 'korperpflege', 'kosmetik'],
  },
  {
    tokens: ['kaese', 'kase'],
    preferred: ['kaese', 'kase', 'milchprodukte', 'molkerei', 'lebensmittel'],
    strongPreferred: ['kaese', 'kase', 'milchprodukte', 'molkerei'],
    productIntent: ['kaese', 'kase', 'gouda', 'emmentaler', 'bergkaese', 'bergkase', 'mozzarella', 'feta', 'camembert', 'parmesan'],
    exactProductIntent: ['gouda', 'emmentaler', 'mozzarella', 'feta', 'camembert', 'parmesan'],
    productContext: ['kaese', 'kase', 'milchprodukte', 'molkerei'],
    weakContexts: ['cabanossi', 'pljeskavica', 'fleisch', 'wurst', 'mit kaese', 'mit kase'],
  },
  {
    tokens: ['schokolade'],
    preferred: ['schokolade', 'suesswaren', 'susswaren', 'knabbereien', 'lebensmittel'],
    strongPreferred: ['schokolade', 'suesswaren', 'susswaren'],
    productIntent: ['schokolade', 'tafelschokolade', 'riegel', 'pralinen', 'milka', 'lindt'],
    exactProductIntent: ['tafelschokolade', 'riegel', 'pralinen', 'milka', 'lindt'],
    productContext: ['schokolade', 'suesswaren', 'susswaren', 'knabbereien'],
    weakContexts: ['dessert', 'torte', 'kuchen', 'pudding', 'creme'],
  },
  {
    key: 'bier',
    tokens: ['bier'],
    preferred: ['bier', 'getraenke', 'getranke'],
    strongPreferred: ['bier', 'getraenke', 'getranke'],
    productIntent: ['bier', 'maerzen', 'marzen', 'pils', 'radler', 'alkoholfrei'],
    exactProductIntent: ['maerzen', 'marzen', 'pils', 'radler'],
    productContext: ['bier', 'getraenke', 'getranke'],
    weakContexts: ['bierwurst', 'bierschinken'],
    severeWeakContexts: ['shorts', 'bekleidung', 'textil', 'kleinkinder', 'kinderbekleidung', 'damenbekleidung', 'herrenbekleidung'],
  },
  {
    key: 'reis',
    tokens: ['reis'],
    preferred: ['reis', 'grundnahrungsmittel', 'lebensmittel'],
    strongPreferred: ['reis'],
    productIntent: ['reis', 'basmati', 'jasmin', 'langkorn', 'expressreis', 'risotto', 'risottoreis', 'milchreis', 'reiswaffel', 'reiswaffeln'],
    exactProductIntent: ['basmati', 'jasmin', 'langkorn', 'expressreis', 'risotto', 'risottoreis'],
    productContext: ['reis', 'grundnahrungsmittel', 'lebensmittel'],
    weakContexts: [
      'drink',
      'reisdrink',
      'milchersatz',
      'pasta',
      'nudel',
      'nudeln',
      'spaghetti',
      'penne',
      'fusilli',
      'passata',
      'sugo',
      'konserve',
      'konserven',
      'bohnen',
      'kichererbse',
      'kichererbsen',
    ],
    severeWeakContexts: ['passata', 'sugo', 'spaghetti', 'nudel', 'nudeln', 'bohnen', 'kichererbse', 'kichererbsen'],
  },
  {
    key: 'nudeln',
    tokens: ['nudeln', 'nudel', 'pasta', 'spaghetti', 'penne', 'fusilli', 'makkaroni', 'maccheroni', 'teigwaren'],
    preferred: ['nudeln', 'nudel', 'pasta', 'teigwaren', 'grundnahrungsmittel', 'lebensmittel'],
    strongPreferred: ['nudeln', 'nudel', 'pasta', 'teigwaren'],
    productIntent: ['nudeln', 'nudel', 'pasta', 'spaghetti', 'penne', 'fusilli', 'makkaroni', 'maccheroni', 'tagliatelle', 'bavette', 'teigwaren'],
    exactProductIntent: ['spaghetti', 'penne', 'fusilli', 'makkaroni', 'maccheroni', 'tagliatelle', 'bavette', 'teigwaren'],
    productContext: ['nudeln', 'nudel', 'pasta', 'teigwaren', 'grundnahrungsmittel'],
    weakContexts: ['mohnnudeln', 'germknoedel', 'germknodel', 'suessspeise', 'susspeise', 'dessert'],
    severeWeakContexts: ['mohnnudeln', 'germknoedel', 'germknodel'],
  },
  {
    key: 'eier',
    tokens: ['eier'],
    preferred: ['eier', 'ei', 'grundnahrungsmittel', 'backen', 'lebensmittel'],
    strongPreferred: ['eier', 'ei', 'grundnahrungsmittel'],
    productIntent: ['eier', 'ei', 'freilandeier', 'bodenhaltung', 'bioeier'],
    exactProductIntent: ['freilandeier', 'bioeier'],
    productContext: ['eier', 'ei', 'grundnahrungsmittel', 'backen'],
    weakContexts: ['eiersalat'],
    severeWeakContexts: ['steiermark', 'suedsteiermark', 'schleierkraut', 'osterei', 'schokoeier', 'eiermuschel', 'eiermuschelsuppe'],
  },
  {
    key: 'oel',
    tokens: ['oel', 'ol'],
    preferred: ['oel', 'ol', 'oele', 'ole', 'bratoel', 'bratol', 'olivenoel', 'olivenol', 'pflanzenoel', 'pflanzenol', 'rapsoel', 'rapsol', 'sonnenblumenoel', 'sonnenblumenol', 'kuerbiskernoel', 'kuerbiskernol', 'kurbiskernoel', 'kurbiskernol', 'speiseoel', 'speiseol', 'lebensmittel'],
    strongPreferred: ['oel', 'ol', 'oele', 'ole', 'bratoel', 'bratol', 'olivenoel', 'olivenol', 'pflanzenoel', 'pflanzenol', 'rapsoel', 'rapsol', 'sonnenblumenoel', 'sonnenblumenol', 'kuerbiskernoel', 'kuerbiskernol', 'kurbiskernoel', 'kurbiskernol', 'speiseoel', 'speiseol'],
    productIntent: ['oel', 'ol', 'bratoel', 'bratol', 'olivenoel', 'olivenol', 'pflanzenoel', 'pflanzenol', 'rapsoel', 'rapsol', 'sonnenblumenoel', 'sonnenblumenol', 'kuerbiskernoel', 'kuerbiskernol', 'kurbiskernoel', 'kurbiskernol', 'kronenoel', 'kronenol', 'speiseoel', 'speiseol'],
    exactProductIntent: ['bratoel', 'bratol', 'olivenoel', 'olivenol', 'pflanzenoel', 'pflanzenol', 'rapsoel', 'rapsol', 'sonnenblumenoel', 'sonnenblumenol', 'kuerbiskernoel', 'kuerbiskernol', 'kurbiskernoel', 'kurbiskernol', 'kronenoel', 'kronenol', 'speiseoel', 'speiseol'],
    productContext: ['oel', 'ol', 'oele', 'ole', 'gewuerze', 'gewurze', 'saucen', 'lebensmittel'],
    weakContexts: ['thunfisch', 'frischkaese', 'in oel', 'mit oel'],
    severeWeakContexts: ['aetherisch', 'atherisch', 'duftoel', 'duftol', 'duschoel', 'duschol', 'haaroel', 'haarol', 'haarfarbe', 'koerperoel', 'korperoel', 'pflegeoel', 'pflegeol', 'shampoo', 'coloration', 'motoroel', 'motorol', 'oleo'],
  },
  {
    key: 'fleisch',
    tokens: ['fleisch'],
    preferred: ['fleisch', 'rind', 'schwein', 'huhn', 'hendl', 'wurst', 'lebensmittel'],
    strongPreferred: ['fleisch', 'rind', 'schwein', 'huhn', 'hendl', 'wurst'],
    productIntent: ['fleisch', 'rind', 'schwein', 'huhn', 'hendl', 'faschiertes', 'filet', 'schnitzel', 'steak', 'braten'],
    exactProductIntent: ['rind', 'schwein', 'huhn', 'hendl', 'faschiertes', 'filet', 'schnitzel', 'steak', 'braten'],
    productContext: ['fleisch', 'wurst'],
    weakContexts: ['fleischersatz', 'pflanzlich', 'moussaka', 'fertiggericht'],
    severeWeakContexts: ['zahnfleisch', 'mundpflege', 'mundspuelung', 'fleischtomaten', 'tomatenpflanzen', 'hundefutter', 'katzenfutter', 'tierfutter'],
  },
  {
    key: 'gemuese',
    tokens: ['gemuese'],
    preferred: ['gemuese', 'gemuse', 'obst', 'frisch', 'lebensmittel'],
    strongPreferred: ['gemuese', 'gemuse', 'obst', 'frisch'],
    productIntent: ['gemuese', 'gemuse', 'tomaten', 'gurken', 'paprika', 'karotten', 'salat', 'zucchini', 'brokkoli', 'kartoffeln', 'zwiebeln'],
    exactProductIntent: ['tomaten', 'gurken', 'paprika', 'karotten', 'salat', 'zucchini', 'brokkoli', 'kartoffeln', 'zwiebeln'],
    productContext: ['gemuese', 'gemuse', 'obst', 'frisch'],
    weakContexts: ['thunfisch', 'in gemuese', 'mit gemuese', 'gemuesesuppe', 'gewuerz'],
    severeWeakContexts: ['pflanzen', 'salatpflanzen'],
  },
  {
    key: 'obst',
    tokens: ['obst'],
    preferred: ['obst', 'frisch', 'gemuese', 'lebensmittel'],
    strongPreferred: ['obst', 'frisch', 'gemuese'],
    productIntent: ['obst', 'tiefkuehlobst', 'steinobst', 'aepfel', 'apfel', 'bananen', 'orange', 'orangen', 'erdbeeren', 'trauben', 'birnen', 'kiwi'],
    exactProductIntent: ['tiefkuehlobst', 'steinobst', 'aepfel', 'apfel', 'bananen', 'orange', 'orangen', 'erdbeeren', 'trauben', 'birnen', 'kiwi'],
    productContext: ['obst', 'gemuese', 'frisch'],
    weakContexts: ['obstriegel', 'obstgarten'],
    severeWeakContexts: ['geschirr', 'geschirrspuel', 'tabs', 'pflanzen', 'salatpflanzen'],
  },
  {
    tokens: ['waschmittel'],
    preferred: ['waschmittel', 'waschen', 'waesche', 'wasche', 'reiniger', 'reinigung', 'haushalt'],
    strongPreferred: ['waschmittel', 'waschen', 'waesche', 'wasche'],
    productIntent: ['waschmittel'],
    productContext: ['waschmittel', 'waschen', 'waesche', 'wasche'],
    weakContexts: [
      'aufhelltuecher',
      'aufhelltucher',
      'desinfektionstuecher',
      'desinfektionstucher',
      'geschirr',
      'radierer',
      'reiniger',
      'schmutzradierer',
      'spuel',
      'spul',
      'tuecher',
      'tucher',
      'wc',
      'allzweck',
    ],
  },
  {
    tokens: ['zahnpasta'],
    preferred: ['zahnpasta', 'zahnpflege', 'mundpflege', 'drogerie', 'hygiene', 'koerperpflege', 'korperpflege'],
    strongPreferred: ['zahnpasta', 'zahnpflege', 'mundpflege'],
  },
  {
    tokens: ['shampoo'],
    preferred: ['shampoo', 'haarpflege', 'drogerie', 'hygiene', 'koerperpflege', 'korperpflege'],
    strongPreferred: ['shampoo', 'haarpflege'],
  },
  {
    tokens: ['windeln'],
    preferred: ['windeln', 'baby', 'babyhygiene', 'drogerie', 'hygiene'],
    strongPreferred: ['windeln', 'babyhygiene', 'baby'],
  },
  {
    key: 'cat-litter',
    tokens: ['katzenstreu', 'klumpstreu'],
    preferred: ['katzenstreu', 'klumpstreu', 'streu', 'tierbedarf', 'hygiene'],
    strongPreferred: ['katzenstreu', 'klumpstreu', 'streu'],
    productIntent: ['katzenstreu', 'klumpstreu', 'streu'],
    exactProductIntent: ['katzenstreu', 'klumpstreu'],
    productContext: ['tierbedarf', 'hygiene', 'katzenstreu'],
    weakContexts: ['katzenfutter', 'nassfutter', 'trockenfutter', 'futter'],
    severeWeakContexts: ['lebensmittel'],
  },
  {
    key: 'katzenfutter',
    tokens: ['katzenfutter'],
    preferred: ['katzenfutter', 'futter', 'nassfutter', 'trockenfutter', 'tiernahrung', 'tierbedarf'],
    strongPreferred: ['katzenfutter', 'futter', 'nassfutter', 'trockenfutter', 'tiernahrung'],
    productIntent: ['katzenfutter', 'futter', 'nassfutter', 'trockenfutter', 'tiernahrung'],
    exactProductIntent: ['katzenfutter', 'nassfutter', 'trockenfutter'],
    productContext: ['katzenfutter', 'futter', 'tierbedarf', 'tiernahrung'],
    weakContexts: ['streu', 'katzenstreu', 'klumpstreu', 'hygiene', 'sand', 'zubehoer', 'zubehor'],
    severeWeakContexts: ['katzenstreu', 'klumpstreu'],
  },
];

function countTokenMatches(fieldTokens, queryTokens, { allowPrefix = false, allowSubstring = false } = {}) {
  let matches = 0;

  for (const queryToken of queryTokens) {
    if (
      fieldTokens.some((fieldToken) =>
        fieldToken === queryToken ||
        (allowPrefix && fieldToken.startsWith(queryToken)) ||
        (allowSubstring && fieldToken.includes(queryToken))
      )
    ) {
      matches += 1;
    }
  }

  return matches;
}

function countAnyTokenMatches(fieldTokens, expectedTokens = []) {
  return expectedTokens.filter((expectedToken) =>
    fieldTokens.some((fieldToken) => fieldToken === expectedToken || fieldToken.startsWith(expectedToken))
  ).length;
}

function hasAnyTokenMatch(fieldTokens, expectedTokens = [], { exact = false, suffix = false } = {}) {
  return expectedTokens.some((expectedToken) =>
    fieldTokens.some((fieldToken) =>
      fieldToken === expectedToken ||
      (!exact && fieldToken.startsWith(expectedToken)) ||
      (suffix && fieldToken.endsWith(expectedToken))
    )
  );
}

function hasWordToken(wordString, token) {
  return wordString.includes(` ${token} `);
}

function hasAnyWordToken(wordString, tokens = []) {
  return tokens.some((token) => hasWordToken(wordString, token));
}

function isGenericMilkQuery(queryTokens) {
  return queryTokens.length === 1 && queryTokens[0] === 'milch';
}

function hasAnyTokenFamily(fieldTokens, expectedTokens = []) {
  return hasAnyTokenMatch(fieldTokens, expectedTokens, { exact: false, suffix: true });
}

function hasTokenSequence(fieldTokens, expectedTokens = []) {
  if (expectedTokens.length === 0 || fieldTokens.length < expectedTokens.length) {
    return false;
  }

  return fieldTokens.some((_, index) =>
    expectedTokens.every((expectedToken, offset) => fieldTokens[index + offset] === expectedToken)
  );
}

function contextMatchesQuery(context, queryTokens) {
  const sequenceMatched = (context.anyTokenSequences || []).some((sequence) => hasTokenSequence(queryTokens, sequence));

  if (sequenceMatched) {
    return true;
  }

  if (context.phraseOnly) {
    return false;
  }

  if ((context.requiredTokens || []).length > 0) {
    return context.requiredTokens.every((token) => queryTokens.includes(token));
  }

  return context.tokens.some((token) => queryTokens.includes(token));
}

function getQueryContext(queryTokens) {
  return QUERY_CONTEXTS.find((context) => contextMatchesQuery(context, queryTokens)) || null;
}

function hasMilkVolumeSignal(wordString) {
  return /\b\d+(?:\s\d+)?\s*(?:l|liter|ml|milliliter)\b/.test(wordString) ||
    /\b(?:1l|0 5l|0 5 l|500ml|500 ml|liter)\b/.test(wordString);
}

function getGenericMilkOfferIntent({ titleTokens, categoryTokens, structuredTokens, comparisonTokens, aggregateTokens }) {
  const titleWords = ` ${titleTokens.join(' ')} `;
  const categoryWords = ` ${categoryTokens.join(' ')} `;
  const comparisonWords = ` ${comparisonTokens.join(' ')} `;
  const allTokens = structuredTokens.concat(aggregateTokens);
  const hardIndirectTokens = [
    'alpenmilch',
    'babymilch',
    'butter',
    'buttermilch',
    'schokolade',
    'schoko',
    'vollmilchschokolade',
    'zartbitter',
    'chocolonely',
    'mikado',
    'pickup',
    'pick',
    'merci',
    'choco',
    'mandel',
    'nuss',
    'erdnuss',
    'peanut',
    'cups',
    'keks',
    'kekse',
    'riegel',
    'pralinen',
    'tafel',
    'kuchen',
    'broetchen',
    'brotle',
    'gebaeck',
    'geback',
    'camembert',
    'emmentaler',
    'edamer',
    'gouda',
    'graukaese',
    'graukase',
    'kaese',
    'kase',
    'kaesescheiben',
    'kasescheiben',
    'mozzarella',
    'pizzakaese',
    'pizzakase',
    'scheiben',
    'gerieben',
    'seife',
    'fluessigseife',
    'flussigseife',
    'palmolive',
    'dusche',
    'creme',
    'pflege',
    'lippenbalsam',
    'kosmetik',
    'make',
    'joghurt',
    'yoghurt',
    'naturjoghurt',
    'fruchtjoghurt',
    'actimel',
    'folgemilch',
    'combiotik',
    'hipp',
    'milchreis',
    'reisdrink',
    'haferdrink',
    'mandeldrink',
    'mandelmilch',
  ];
  const softIndirectTokens = [
    'cremefine',
    'schlagobers',
    'sahne',
    'obers',
    'dessert',
    'pudding',
    'torte',
    'milchreis',
    'drink',
    'reisdrink',
  ];
  const directMilkTokens = [
    'milch',
    'trinkmilch',
    'vollmilch',
    'frischmilch',
    'haltbarmilch',
    'heumilch',
    'biomilch',
  ];
  const hardIndirect =
    hasAnyTokenFamily(allTokens, hardIndirectTokens) ||
    hasTokenSequence(allTokens, ['feiner', 'tiroler']) ||
    hasTokenSequence(allTokens, ['ohne', 'gleichen']);
  const softIndirect = hasAnyTokenFamily(allTokens, softIndirectTokens);
  const milkCategory = hasAnyWordToken(categoryWords, ['milchprodukte', 'molkerei']);
  const milkInTitle = hasAnyWordToken(titleWords, directMilkTokens) ||
    (hasAnyWordToken(titleWords, ['laktosefrei', 'laktosefreie']) && hasAnyWordToken(titleWords, ['milch']));
  const closeMilkTerm = hasAnyWordToken(titleWords, ['trinkmilch', 'frischmilch', 'haltbarmilch', 'biomilch']) ||
    (hasAnyWordToken(titleWords, ['bio', 'heumilch', 'vollmilch', 'laktosefrei', 'laktosefreie', 'esl']) && hasAnyWordToken(titleWords, ['milch', 'heumilch', 'vollmilch']));
  const volumeSignal = hasMilkVolumeSignal(titleWords) || hasMilkVolumeSignal(comparisonWords);
  const explicitMilkWithVolume = hasAnyWordToken(titleWords, ['milch']) && volumeSignal;
  const drinkingMilk = !hardIndirect && !softIndirect && milkInTitle && (closeMilkTerm || explicitMilkWithVolume);

  return {
    drinkingMilk,
    hardIndirect,
    milkCategory,
    softIndirect,
  };
}

function isRelevantGenericMilkOffer({ titleTokens, categoryTokens, structuredTokens, comparisonTokens, aggregateTokens }) {
  return getGenericMilkOfferIntent({
    titleTokens,
    categoryTokens,
    structuredTokens,
    comparisonTokens,
    aggregateTokens,
  }).drinkingMilk;
}

function scoreMilkSearchIntent({ titleTokens, categoryTokens, structuredTokens, comparisonTokens, aggregateTokens }) {
  const titleWords = ` ${titleTokens.join(' ')} `;
  const {
    drinkingMilk,
    hardIndirect,
    softIndirect,
  } = getGenericMilkOfferIntent({
    titleTokens,
    categoryTokens,
    structuredTokens,
    comparisonTokens,
    aggregateTokens,
  });
  let adjustment = 0;

  if (drinkingMilk) {
    adjustment += 5000;
  }

  if (hardIndirect) {
    adjustment -= 6000;
  } else if (softIndirect) {
    adjustment -= 3500;
  }

  if (!drinkingMilk && hasAnyTokenFamily(titleTokens, ['milch', 'vollmilch', 'heumilch', 'biomilch'])) {
    adjustment -= 1400;
  }

  return adjustment;
}

function getGenericButterOfferIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const titleWords = ` ${titleTokens.join(' ')} `;
  const categoryWords = ` ${categoryTokens.join(' ')} `;
  const allTokens = titleTokens.concat(categoryTokens, comparisonTokens, aggregateTokens);
  const hardSideTokens = [
    'body',
    'bodybutter',
    'buttercroissant',
    'buttergemuese',
    'buttergemuse',
    'butterkeks',
    'butterkaese',
    'butterkase',
    'buttermilch',
    'butterpinze',
    'cups',
    'erdnuss',
    'erdnussbutter',
    'face',
    'facial',
    'gewuerzzubereitung',
    'gewurzzubereitung',
    'highlighter',
    'kakaobutter',
    'karite',
    'kosmetik',
    'kraeuterbutter',
    'krauterbutter',
    'lippenbalsam',
    'lotion',
    'make',
    'peanut',
    'pflege',
    'shea',
  ];
  const softSideTokens = [
    'briochestriezel',
    'buttermilch',
    'butterpinze',
    'cookie',
    'cookies',
    'croissant',
    'gebaeck',
    'geback',
    'gemuese',
    'gemuse',
    'gewuerz',
    'gewuerzzubereitung',
    'gewurz',
    'gewurzzubereitung',
    'kaese',
    'kase',
    'keks',
    'kekse',
    'kraeuterbutter',
    'krauterbutter',
    'protein',
    'riegel',
    'suesswaren',
    'susswaren',
    'topfengolatsche',
  ];
  const dairyCategory = hasAnyWordToken(categoryWords, ['milchprodukte', 'molkerei']);
  const hardSide = hasAnyTokenFamily(allTokens, hardSideTokens) ||
    (
      hasAnyWordToken(titleWords, ['butter']) &&
      hasAnyTokenFamily(titleTokens.concat(comparisonTokens), ['almond', 'cookie', 'cookies', 'protein'])
    );
  const softSide = hasAnyTokenFamily(allTokens, softSideTokens);
  const explicitButter = hasAnyWordToken(titleWords, ['butter', 'teebutter', 'markenbutter', 'suessrahmbutter', 'sauerrahmbutter']);
  const plausibleSpread = hasAnyTokenFamily(titleTokens.concat(comparisonTokens), [
    'butterschmalz',
    'margarine',
    'streichfett',
  ]);
  const realButter = !hardSide && (
    hasAnyWordToken(titleWords, ['teebutter', 'markenbutter', 'suessrahmbutter', 'sauerrahmbutter']) ||
    (explicitButter && dairyCategory)
  );

  return {
    hardSide,
    plausibleSpread,
    realButter,
    softSide,
  };
}

function scoreButterSearchIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const {
    hardSide,
    plausibleSpread,
    realButter,
    softSide,
  } = getGenericButterOfferIntent({
    titleTokens,
    categoryTokens,
    comparisonTokens,
    aggregateTokens,
  });
  let adjustment = 0;

  if (realButter) {
    adjustment += 4500;
  } else if (plausibleSpread && !hardSide) {
    adjustment += 900;
  }

  if (hardSide) {
    adjustment -= 6500;
  } else if (softSide) {
    adjustment -= 3200;
  }

  return adjustment;
}

function getGenericOilOfferIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const titleWords = ` ${titleTokens.join(' ')} `;
  const categoryWords = ` ${categoryTokens.join(' ')} `;
  const productTokens = titleTokens.concat(comparisonTokens);
  const allTokens = titleTokens.concat(categoryTokens, comparisonTokens, aggregateTokens);
  const foodOilTokens = [
    'bratoel',
    'bratol',
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
    'kuerbiskernoel',
    'kuerbiskernol',
    'kurbiskernoel',
    'kurbiskernol',
    'kronenoel',
    'kronenol',
  ];
  const hardSideTokens = [
    'aetherisch',
    'atherisch',
    'body',
    'coloration',
    'duftoel',
    'duftol',
    'duschoel',
    'duschol',
    'ei',
    'haaroel',
    'haarol',
    'haarpflege',
    'haarfarbe',
    'koerperoel',
    'korperoel',
    'kosmetik',
    'motoroel',
    'motorol',
    'oleo',
    'pflege',
    'pflegeoel',
    'pflegeol',
    'shampoo',
  ];
  const foodCategory = hasAnyWordToken(categoryWords, ['lebensmittel', 'gewuerze', 'gewurze', 'saucen']);
  const titleHasFoodOil = hasAnyTokenFamily(productTokens, foodOilTokens);
  const genericFoodOil = hasAnyWordToken(titleWords, ['oel', 'ol']) && foodCategory;
  const hardSide = hasAnyTokenFamily(allTokens, hardSideTokens);

  return {
    foodOil: (titleHasFoodOil || genericFoodOil) && !hardSide,
    hardSide,
  };
}

function scoreOilSearchIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const { foodOil, hardSide } = getGenericOilOfferIntent({
    titleTokens,
    categoryTokens,
    comparisonTokens,
    aggregateTokens,
  });
  let adjustment = 0;

  if (foodOil) {
    adjustment += 4800;
  }

  if (hardSide) {
    adjustment -= 6500;
  }

  return adjustment;
}

function getEssentialOilOfferIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const productTokens = titleTokens.concat(comparisonTokens);
  const allTokens = titleTokens.concat(categoryTokens, comparisonTokens, aggregateTokens);
  const essentialTokens = [
    'aetherisch',
    'aetherisches',
    'atherisch',
    'atherisches',
    'duftoel',
    'duftol',
    'aromaoel',
    'aromaol',
    'aromatherapie',
    'essential',
  ];
  const sideTokens = [
    'frischkaese',
    'lebensmittel',
    'olivenoel',
    'olivenol',
    'rapsoel',
    'rapsol',
    'saucen',
    'shampoo',
    'speiseoel',
    'speiseol',
    'sonnenblumenoel',
    'sonnenblumenol',
    'thunfisch',
  ];
  const hairOilTokens = ['haaroel', 'haarol', 'haarpflege'];
  const essentialOil = hasAnyTokenFamily(productTokens, essentialTokens) ||
    (hasAnyTokenFamily(productTokens, ['lavendel', 'eukalyptus']) && hasAnyTokenFamily(productTokens, ['oel', 'ol']));
  const sideHit = hasAnyTokenFamily(allTokens, sideTokens) || hasAnyTokenFamily(allTokens, hairOilTokens);

  return {
    essentialOil,
    sideHit,
  };
}

function scoreEssentialOilSearchIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const { essentialOil, sideHit } = getEssentialOilOfferIntent({
    titleTokens,
    categoryTokens,
    comparisonTokens,
    aggregateTokens,
  });
  let adjustment = 0;

  if (essentialOil) {
    adjustment += 5200;
  }

  if (sideHit) {
    adjustment -= 6200;
  }

  return adjustment;
}

function getHairOilOfferIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const productTokens = titleTokens.concat(comparisonTokens);
  const allTokens = titleTokens.concat(categoryTokens, comparisonTokens, aggregateTokens);
  const hairOil =
    hasAnyTokenFamily(productTokens, ['haaroel', 'haarol', 'hairoil']) ||
    (hasAnyTokenFamily(productTokens, ['hair']) && hasAnyTokenFamily(productTokens, ['oil'])) ||
    (
      hasAnyTokenFamily(productTokens, ['oel', 'ol', 'oil', 'elixier']) &&
      hasAnyTokenFamily(categoryTokens.concat(comparisonTokens), ['haarpflege'])
    );
  const sideHit = hasAnyTokenFamily(allTokens, [
    'body',
    'coloration',
    'haarspray',
    'koerperspray',
    'korperspray',
    'lebensmittel',
    'shampoo',
    'spray',
  ]);

  return {
    hairOil,
    sideHit,
  };
}

function scoreHairOilSearchIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const { hairOil, sideHit } = getHairOilOfferIntent({
    titleTokens,
    categoryTokens,
    comparisonTokens,
    aggregateTokens,
  });
  let adjustment = 0;

  if (hairOil) {
    adjustment += 5200;
  }

  if (sideHit) {
    adjustment -= 6200;
  }

  return adjustment;
}

function getBodyButterOfferIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const productTokens = titleTokens.concat(comparisonTokens);
  const allTokens = titleTokens.concat(categoryTokens, comparisonTokens, aggregateTokens);
  const careContext = hasAnyTokenFamily(categoryTokens.concat(comparisonTokens), ['koerperpflege', 'korperpflege', 'kosmetik', 'pflege']);
  const realBodyButter =
    hasAnyTokenFamily(productTokens, ['bodybutter', 'koerperbutter', 'korperbutter']) ||
    (hasAnyTokenFamily(productTokens, ['body']) && hasAnyTokenFamily(productTokens, ['butter']) && careContext) ||
    (hasAnyTokenFamily(productTokens, ['facial']) && hasAnyTokenFamily(productTokens, ['butter']) && careContext);
  const acceptableCare =
    realBodyButter ||
    (hasAnyTokenFamily(productTokens, ['body']) && hasAnyTokenFamily(productTokens, ['cream', 'lotion']) && careContext);
  const weakCare = hasAnyTokenFamily(productTokens, ['spray', 'mist', 'lippenbalsam', 'lippenpflege']);
  const foodSide = hasAnyTokenFamily(allTokens, [
    'erdnuss',
    'erdnussbutter',
    'lebensmittel',
    'milchprodukte',
    'molkerei',
    'peanut',
    'protein',
    'schokolade',
    'suesswaren',
    'susswaren',
    'teebutter',
  ]);

  return {
    acceptableCare,
    foodSide,
    realBodyButter,
    weakCare,
  };
}

function scoreBodyButterSearchIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const {
    acceptableCare,
    foodSide,
    realBodyButter,
    weakCare,
  } = getBodyButterOfferIntent({
    titleTokens,
    categoryTokens,
    comparisonTokens,
    aggregateTokens,
  });
  let adjustment = 0;

  if (realBodyButter) {
    adjustment += 5400;
  } else if (acceptableCare) {
    adjustment += 2200;
  }

  if (foodSide) {
    adjustment -= 6500;
  }

  if (weakCare) {
    adjustment -= 3000;
  }

  return adjustment;
}

function getGenericJoghurtOfferIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const titleWords = ` ${titleTokens.join(' ')} `;
  const categoryWords = ` ${categoryTokens.join(' ')} `;
  const allTokens = titleTokens.concat(categoryTokens, comparisonTokens, aggregateTokens);
  const dairyCategory = hasAnyWordToken(categoryWords, ['milchprodukte', 'molkerei', 'tiefkuehl', 'tiefkuhl']);
  const realJoghurtTokens = ['joghurt', 'jogurt', 'yoghurt', 'yogurt', 'naturjoghurt', 'fruchtjoghurt', 'skyr'];
  const hardSideTokens = [
    'body',
    'duschgel',
    'fruchtriegel',
    'haarpflege',
    'koerperpflege',
    'korperpflege',
    'kosmetik',
    'lachgummi',
    'riegel',
    'shampoo',
    'suesswaren',
    'susswaren',
  ];
  const softSideTokens = ['baby', 'babynahrung', 'dessert', 'kuchen', 'schnitte', 'torte'];
  const hardSide = hasAnyTokenFamily(allTokens, hardSideTokens);
  const softSide = hasAnyTokenFamily(allTokens, softSideTokens);
  const realJoghurt = hasAnyWordToken(titleWords, realJoghurtTokens) && dairyCategory && !hardSide;

  return {
    hardSide,
    realJoghurt,
    softSide,
  };
}

function scoreJoghurtSearchIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const { hardSide, realJoghurt, softSide } = getGenericJoghurtOfferIntent({
    titleTokens,
    categoryTokens,
    comparisonTokens,
    aggregateTokens,
  });
  let adjustment = 0;

  if (realJoghurt) {
    adjustment += 4600;
  }

  if (hardSide) {
    adjustment -= 6500;
  } else if (softSide) {
    adjustment -= 2800;
  }

  return adjustment;
}

function getGenericCatFoodOfferIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const productTokens = titleTokens.concat(comparisonTokens);
  const allTokens = titleTokens.concat(categoryTokens, comparisonTokens, aggregateTokens);
  const foodTokens = ['katzenfutter', 'nassfutter', 'trockenfutter', 'futter', 'tiernahrung'];
  const litterTokens = ['katzenstreu', 'klumpstreu', 'streu', 'sand', 'hygiene', 'zubehoer', 'zubehor'];
  const catFood = hasAnyTokenFamily(productTokens, foodTokens);
  const litter = hasAnyTokenFamily(allTokens, litterTokens);

  return {
    catFood: catFood && !litter,
    litter,
  };
}

function scoreCatFoodSearchIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const { catFood, litter } = getGenericCatFoodOfferIntent({
    titleTokens,
    categoryTokens,
    comparisonTokens,
    aggregateTokens,
  });
  let adjustment = 0;

  if (catFood) {
    adjustment += 4200;
  }

  if (litter) {
    adjustment -= 6000;
  }

  return adjustment;
}

function getCatLitterOfferIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const productTokens = titleTokens.concat(categoryTokens, comparisonTokens);
  const litter = hasAnyTokenFamily(productTokens, ['katzenstreu', 'klumpstreu', 'streu']);
  const foodSide = hasAnyTokenFamily(titleTokens.concat(comparisonTokens), [
    'katzenfutter',
    'nassfutter',
    'trockenfutter',
    'futter',
  ]);

  return {
    foodSide,
    litter,
  };
}

function scoreCatLitterSearchIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const { foodSide, litter } = getCatLitterOfferIntent({
    titleTokens,
    categoryTokens,
    comparisonTokens,
    aggregateTokens,
  });
  let adjustment = 0;

  if (litter) {
    adjustment += 4400;
  }

  if (foodSide) {
    adjustment -= 5600;
  }

  return adjustment;
}

function getGenericRiceOfferIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const titleWords = ` ${titleTokens.join(' ')} `;
  const productTokens = titleTokens.concat(comparisonTokens);
  const hardSideTokens = [
    'bohnen',
    'fusilli',
    'kichererbse',
    'kichererbsen',
    'konserve',
    'konserven',
    'nudel',
    'nudeln',
    'passata',
    'pasta',
    'penne',
    'polpa',
    'sauce',
    'sugo',
    'spaghetti',
    'tomaten',
    'tomatensauce',
  ];
  const weakRiceTokens = ['milchreis', 'reisgericht', 'reischips', 'reiswaffel', 'reiswaffeln'];
  const dishMixSideTokens = ['fix'];
  const strongRiceTokens = [
    'basmati',
    'basmatireis',
    'expressreis',
    'jasmin',
    'jasminreis',
    'langkorn',
    'langkornreis',
    'reis',
    'risotto',
    'risottoreis',
  ];
  const titleHasStrongRice = hasAnyWordToken(titleWords, strongRiceTokens) ||
    hasAnyTokenFamily(
      titleTokens.concat(comparisonTokens),
      strongRiceTokens.filter((token) => token !== 'reis')
    );
  const weakRice = hasAnyTokenFamily(titleTokens.concat(comparisonTokens), weakRiceTokens);
  const hardSide = (hasAnyTokenFamily(productTokens, hardSideTokens) && !titleHasStrongRice) ||
    hasAnyTokenFamily(productTokens, dishMixSideTokens);
  const categoryOnly =
    !titleHasStrongRice &&
    !weakRice &&
    hasAnyTokenFamily(categoryTokens, ['pasta', 'reis', 'konserve', 'konserven']);

  return {
    categoryOnly,
    hardSide,
    realRice: titleHasStrongRice && !hardSide,
    weakRice: weakRice && !hardSide,
  };
}

function scoreRiceSearchIntent({ titleTokens, categoryTokens, comparisonTokens, aggregateTokens }) {
  const {
    categoryOnly,
    hardSide,
    realRice,
    weakRice,
  } = getGenericRiceOfferIntent({
    titleTokens,
    categoryTokens,
    comparisonTokens,
    aggregateTokens,
  });
  let adjustment = 0;

  if (realRice) {
    adjustment += 4500;
  } else if (weakRice) {
    adjustment += 900;
  }

  if (hardSide) {
    adjustment -= 6000;
  }

  if (categoryOnly) {
    adjustment -= 3500;
  }

  return adjustment;
}

function scoreFieldAgainstQuery(value, queryTokens, weights) {
  const fieldTokens = tokenizeSearchText(value);

  if (fieldTokens.length === 0) {
    return 0;
  }

  let score = 0;
  const wordString = ` ${fieldTokens.join(' ')} `;
  const exactMatches = countTokenMatches(fieldTokens, queryTokens);
  const prefixMatches = countTokenMatches(fieldTokens, queryTokens, { allowPrefix: true }) - exactMatches;
  const substringMatches = countTokenMatches(fieldTokens, queryTokens, { allowSubstring: true }) - exactMatches - prefixMatches;

  if (hasPhrase(wordString, queryTokens)) {
    score += weights.phrase || 0;
  }

  score += exactMatches * (weights.exact || 0);
  score += Math.max(0, prefixMatches) * (weights.prefix || 0);
  score += Math.max(0, substringMatches) * (weights.substring || 0);

  if (queryTokens.length > 1 && exactMatches === queryTokens.length) {
    score += weights.allTokens || 0;
  }

  if (fieldTokens[0] && queryTokens.includes(fieldTokens[0])) {
    score += weights.firstToken || 0;
  }

  return score;
}

function scoreOfferAgainstQuery(offer, query) {
  const queryTokens = tokenizeSearchText(query);

  if (queryTokens.length === 0) {
    return 1;
  }

  const context = getQueryContext(queryTokens);
  const structuredText = [
    offer.title,
    offer.brand,
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.subcategoryKey,
    offer.comparisonGroup,
  ].join(' ');
  const structuredTokens = tokenizeSearchText(structuredText);
  const titleTokens = tokenizeSearchText(offer.title);
  const categoryTokens = tokenizeSearchText([
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.subcategoryKey,
  ].join(' '));
  const comparisonTokens = tokenizeSearchText(offer.comparisonGroup);
  const aggregateTokens = tokenizeSearchText(offer.searchText);
  let score = 0;

  score += scoreFieldAgainstQuery(offer.title, queryTokens, {
    phrase: 260,
    exact: 70,
    prefix: 38,
    substring: 8,
    allTokens: 100,
    firstToken: 28,
  });
  score += scoreFieldAgainstQuery(offer.brand, queryTokens, {
    phrase: 220,
    exact: 64,
    prefix: 34,
    substring: 6,
    allTokens: 90,
    firstToken: 20,
  });
  score += scoreFieldAgainstQuery(offer.categorySecondary || offer.subcategoryKey, queryTokens, {
    phrase: 180,
    exact: 56,
    prefix: 30,
    substring: 5,
    allTokens: 70,
  });
  score += scoreFieldAgainstQuery(offer.categoryPrimary, queryTokens, {
    phrase: 95,
    exact: 34,
    prefix: 16,
    substring: 3,
    allTokens: 30,
  });
  score += scoreFieldAgainstQuery(offer.comparisonGroup, queryTokens, {
    phrase: 130,
    exact: 38,
    prefix: 20,
    substring: 4,
    allTokens: 55,
  });
  score += scoreFieldAgainstQuery(offer.searchText, queryTokens, {
    phrase: 35,
    exact: 9,
    prefix: 5,
    substring: 1,
    allTokens: 12,
  });
  score += scoreFieldAgainstQuery(offer.conditionsText, queryTokens, {
    phrase: 10,
    exact: 3,
    prefix: 1,
    substring: 0,
  });
  score += scoreFieldAgainstQuery(offer.retailerName, queryTokens, {
    phrase: 4,
    exact: 2,
    prefix: 1,
    substring: 0,
  });

  const matchedStructuredTokens = countTokenMatches(structuredTokens, queryTokens, { allowPrefix: true });
  const matchedAggregateTokens = countTokenMatches(aggregateTokens, queryTokens, { allowSubstring: true });
  const explicitBodyButterQuery = context?.key === 'body-butter';
  const explicitEssentialOilQuery = context?.key === 'essential-oil';
  const explicitHairOilQuery = context?.key === 'hair-oil';
  const explicitCatLitterQuery = context?.key === 'cat-litter';
  const genericMilkQuery = context?.key === 'milch' && isGenericMilkQuery(queryTokens);
  const genericButterQuery = context?.key === 'butter' && queryTokens.length === 1 && queryTokens[0] === 'butter';
  const genericOilQuery = context?.key === 'oel' && queryTokens.length === 1 && ['oel', 'ol'].includes(queryTokens[0]);
  const genericJoghurtQuery = context?.key === 'joghurt' && queryTokens.length === 1 && queryTokens[0] === 'joghurt';
  const genericCatFoodQuery = context?.key === 'katzenfutter' && queryTokens.length === 1 && queryTokens[0] === 'katzenfutter';
  const genericRiceQuery = context?.key === 'reis' && queryTokens.length === 1 && queryTokens[0] === 'reis';
  const genericBeerQuery = context?.key === 'bier' && queryTokens.length === 1 && queryTokens[0] === 'bier';
  const conservativeFalsePositiveQuery = context && ['eier', 'fleisch', 'gemuese', 'obst'].includes(context.key);
  const conservativeGenericOilQuery = genericOilQuery;

  if (
    genericMilkQuery &&
    !isRelevantGenericMilkOffer({
      titleTokens,
      categoryTokens,
      structuredTokens,
      comparisonTokens,
      aggregateTokens,
    })
  ) {
    return 0;
  }

  if (
    (conservativeFalsePositiveQuery || conservativeGenericOilQuery) &&
    countAnyTokenMatches(
      titleTokens.concat(categoryTokens, comparisonTokens),
      (context.weakContexts || []).concat(context.severeWeakContexts || [])
    ) > 0
  ) {
    return 0;
  }

  const productIntentMatched = context
    ? hasAnyTokenMatch(titleTokens.concat(comparisonTokens), context.productIntent, {
        exact: true,
        suffix: !genericMilkQuery,
      })
    : false;
  const productContextMatched = context
    ? hasAnyTokenMatch(categoryTokens.concat(comparisonTokens), context.productContext, {
        exact: false,
        suffix: true,
      })
    : false;

  if (queryTokens.length > 1 && matchedStructuredTokens > 1) {
    score += matchedStructuredTokens * 32;
  }

  if (context && (matchedStructuredTokens > 0 || matchedAggregateTokens > 0 || productIntentMatched)) {
    const strongContextMatches = countAnyTokenMatches(categoryTokens.concat(comparisonTokens), context.strongPreferred);
    const preferredContextMatches = countAnyTokenMatches(structuredTokens, context.preferred);
    const weakContextMatches = countAnyTokenMatches(titleTokens.concat(categoryTokens, comparisonTokens), context.weakContexts);
    const severeWeakContextMatches = countAnyTokenMatches(
      titleTokens.concat(categoryTokens, comparisonTokens),
      context.severeWeakContexts
    );
    const exactProductIntentMatched = hasAnyTokenMatch(titleTokens.concat(comparisonTokens), context.exactProductIntent, {
      exact: true,
    });

    score += strongContextMatches * 80;
    score += preferredContextMatches * 20;
    if (exactProductIntentMatched) {
      score += 900;
    }

    if (productIntentMatched && productContextMatched) {
      score += 700;
    } else if (productIntentMatched && weakContextMatches === 0) {
      score += 650;
    } else if (productIntentMatched) {
      score += 260;
    }

    if (weakContextMatches > 0) {
      score -= weakContextMatches * (productIntentMatched && productContextMatched ? 300 : 500);
    }

    if (severeWeakContextMatches > 0) {
      score -= severeWeakContextMatches * 1600;
    }

    if (
      (weakContextMatches > 0 || severeWeakContextMatches > 0) &&
      (['eier', 'fleisch', 'gemuese', 'obst'].includes(context.key) || genericOilQuery)
    ) {
      return 0;
    }

    if (genericMilkQuery) {
      score += scoreMilkSearchIntent({
        titleTokens,
        categoryTokens,
        structuredTokens,
        comparisonTokens,
        aggregateTokens,
      });
    }

    if (genericButterQuery) {
      score += scoreButterSearchIntent({
        titleTokens,
        categoryTokens,
        comparisonTokens,
        aggregateTokens,
      });
    }

    if (genericOilQuery) {
      score += scoreOilSearchIntent({
        titleTokens,
        categoryTokens,
        comparisonTokens,
        aggregateTokens,
      });
    }

    if (explicitEssentialOilQuery) {
      score += scoreEssentialOilSearchIntent({
        titleTokens,
        categoryTokens,
        comparisonTokens,
        aggregateTokens,
      });
    }

    if (explicitHairOilQuery) {
      score += scoreHairOilSearchIntent({
        titleTokens,
        categoryTokens,
        comparisonTokens,
        aggregateTokens,
      });
    }

    if (explicitBodyButterQuery) {
      score += scoreBodyButterSearchIntent({
        titleTokens,
        categoryTokens,
        comparisonTokens,
        aggregateTokens,
      });
    }

    if (genericJoghurtQuery) {
      score += scoreJoghurtSearchIntent({
        titleTokens,
        categoryTokens,
        comparisonTokens,
        aggregateTokens,
      });
    }

    if (genericCatFoodQuery) {
      score += scoreCatFoodSearchIntent({
        titleTokens,
        categoryTokens,
        comparisonTokens,
        aggregateTokens,
      });
    }

    if (explicitCatLitterQuery) {
      score += scoreCatLitterSearchIntent({
        titleTokens,
        categoryTokens,
        comparisonTokens,
        aggregateTokens,
      });
    }

    if (genericRiceQuery) {
      score += scoreRiceSearchIntent({
        titleTokens,
        categoryTokens,
        comparisonTokens,
        aggregateTokens,
      });
    }
  }

  if (score <= 0 && genericButterQuery) {
    const { hardSide, realButter, plausibleSpread } = getGenericButterOfferIntent({
      titleTokens,
      categoryTokens,
      comparisonTokens,
      aggregateTokens,
    });

    if (hardSide && !realButter && !plausibleSpread) {
      return 0;
    }
  }

  if (genericButterQuery) {
    const {
      hardSide,
      plausibleSpread,
      realButter,
      softSide,
    } = getGenericButterOfferIntent({
      titleTokens,
      categoryTokens,
      comparisonTokens,
      aggregateTokens,
    });

    if ((hardSide || softSide) && !realButter && !plausibleSpread) {
      return 0;
    }
  }

  if (genericRiceQuery) {
    const { realRice } = getGenericRiceOfferIntent({
      titleTokens,
      categoryTokens,
      comparisonTokens,
      aggregateTokens,
    });

    if (!realRice) {
      return 0;
    }
  }

  if (genericBeerQuery && countAnyTokenMatches(titleTokens.concat(categoryTokens, comparisonTokens), context.severeWeakContexts || []) > 0) {
    return 0;
  }

  if (genericOilQuery) {
    const { foodOil, hardSide } = getGenericOilOfferIntent({
      titleTokens,
      categoryTokens,
      comparisonTokens,
      aggregateTokens,
    });

    if (!foodOil || hardSide) {
      return 0;
    }
  }

  if (explicitEssentialOilQuery) {
    const { essentialOil, sideHit } = getEssentialOilOfferIntent({
      titleTokens,
      categoryTokens,
      comparisonTokens,
      aggregateTokens,
    });

    if (!essentialOil || sideHit) {
      return 0;
    }
  }

  if (explicitHairOilQuery) {
    const { hairOil, sideHit } = getHairOilOfferIntent({
      titleTokens,
      categoryTokens,
      comparisonTokens,
      aggregateTokens,
    });

    if (!hairOil || sideHit) {
      return 0;
    }
  }

  if (explicitBodyButterQuery) {
    const {
      acceptableCare,
      foodSide,
      weakCare,
    } = getBodyButterOfferIntent({
      titleTokens,
      categoryTokens,
      comparisonTokens,
      aggregateTokens,
    });

    if (!acceptableCare || foodSide || weakCare) {
      return 0;
    }
  }

  if (genericJoghurtQuery) {
    const { hardSide, realJoghurt } = getGenericJoghurtOfferIntent({
      titleTokens,
      categoryTokens,
      comparisonTokens,
      aggregateTokens,
    });

    if (!realJoghurt || hardSide) {
      return 0;
    }
  }

  if (genericCatFoodQuery) {
    const { catFood, litter } = getGenericCatFoodOfferIntent({
      titleTokens,
      categoryTokens,
      comparisonTokens,
      aggregateTokens,
    });

    if (!catFood || litter) {
      return 0;
    }
  }

  if (explicitCatLitterQuery) {
    const { foodSide, litter } = getCatLitterOfferIntent({
      titleTokens,
      categoryTokens,
      comparisonTokens,
      aggregateTokens,
    });

    if (!litter || foodSide) {
      return 0;
    }
  }

  if (score <= 0 && (matchedAggregateTokens > 0 || matchedStructuredTokens > 0 || productIntentMatched)) {
    score = 1;
  }

  return score;
}

function applyQueryMatch(offers, query) {
  if (!query) {
    return offers;
  }

  return offers
    .map((offer) => ({
      offer,
      score: scoreOfferAgainstQuery(offer, query),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const priceComparison = compareSafeUnitPrice(left.offer, right.offer);

      if (priceComparison !== 0) {
        return priceComparison;
      }

      return String(left.offer.title).localeCompare(String(right.offer.title), 'de');
    })
    .map((item) => item.offer);
}

function applyProgramEligibility(offers, { programRetailers = [], onlyWithoutProgram = false }) {
  const allowedRetailers = new Set(normalizeProgramRetailers(programRetailers));
  const restrictToPublicOnly = normalizeBoolean(onlyWithoutProgram);

  return offers.filter((offer) => {
    if (!offer.customerProgramRequired) {
      return true;
    }

    if (restrictToPublicOnly) {
      return false;
    }

    return allowedRetailers.has(offer.retailerKey);
  });
}

function applyUnitFilter(offers, unit) {
  if (!unit || unit === 'all') {
    return offers;
  }

  return offers.filter(
    (offer) => String(offer?.comparableUnit || offer?.normalizedUnitPrice?.unit || '') === String(unit)
  );
}

function buildFilters({ categories, query, unit, retailers, onlyWithoutProgram }) {
  const filters = {
    'quality.comparisonSafe': true,
    comparisonGroup: { $ne: '' },
    'normalizedUnitPrice.amount': { $ne: null },
    'normalizedUnitPrice.comparable': true,
    comparableUnit: { $ne: '' },
    ...buildCurrentAvailabilityMatch(),
  };

  const selectedCategories = normalizeStringList(categories);
  const selectedRetailers = normalizeStringList(retailers);

  if (selectedCategories.length > 0) {
    filters.categoryKey = {
      $in: selectedCategories.map((category) => category.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
    };
  }

  if (selectedRetailers.length > 0) {
    filters.retailerKey = { $in: selectedRetailers };
  }

  if (unit && unit !== 'all') {
    filters.comparableUnit = unit;
  }

  if (normalizeBoolean(onlyWithoutProgram)) {
    filters.customerProgramRequired = false;
  }

  return filters;
}

function buildRankedOffer(offer, bestUnitPrice, worstUnitPrice) {
  const safelyComparable = isOfferSafelyComparable(offer);
  const computedPromotion = computeOfferSavings(offer);
  const legacySavings = {
    savingsAmount:
      offer?.savingsAmount !== undefined && offer?.savingsAmount !== null
        ? offer.savingsAmount
        : computedPromotion?.savingsAmount ?? null,
    savingsPercent:
      offer?.savingsPercent !== undefined && offer?.savingsPercent !== null
        ? offer.savingsPercent
        : computedPromotion?.savingsPercent ?? null,
    requiredQuantity:
      offer?.minimumPurchaseQuantity !== undefined && offer?.minimumPurchaseQuantity !== null
        ? offer.minimumPurchaseQuantity
        : computedPromotion?.requiredQuantity,
  };
  const structuredReferencePrice = computedPromotion?.referencePrice || {
    amount: null,
    type: 'none',
    source: '',
    confidence: 0,
    discountPercent: null,
    isApproximate: false,
    label: '',
  };
  const structuredSavings = {
    amount: legacySavings.savingsAmount ?? null,
    percent: legacySavings.savingsPercent ?? null,
    isApproximate: Boolean(legacySavings.savingsAmount && computedPromotion?.savings?.isApproximate),
    basis: legacySavings.savingsAmount ? (computedPromotion?.savings?.basis || 'none') : 'none',
    label: legacySavings.savingsAmount ? (computedPromotion?.savings?.label || '') : 'Aktionspreis',
  };
  const normalizedAmount = Number(offer?.normalizedUnitPrice?.amount ?? 0);
  const priceGapPercent = safelyComparable && bestUnitPrice
    ? Number((((normalizedAmount - bestUnitPrice) / bestUnitPrice) * 100).toFixed(2))
    : 0;
  const spread = safelyComparable && worstUnitPrice && bestUnitPrice && worstUnitPrice !== bestUnitPrice
    ? (normalizedAmount - bestUnitPrice) / (worstUnitPrice - bestUnitPrice)
    : 0;

  return {
    id: offer.id || offer._id,
    retailerKey: offer.retailerKey,
    retailerName: offer.retailerName,
    title: offer.title,
    titleNormalized: offer.titleNormalized || '',
    brand: offer.brand,
    categoryPrimary: offer.categoryPrimary,
    categorySecondary: offer.categorySecondary,
    categoryKey: offer.categoryKey || '',
    subcategoryKey: offer.subcategoryKey || '',
    categoryConfidence: Number(offer.categoryConfidence || 0),
    subcategoryConfidence: Number(offer.subcategoryConfidence || 0),
    displayCategory: selectDisplayCategory(offer),
    quantityText: offer.quantityText,
    conditionsText: offer.conditionsText,
    customerProgramRequired: offer.customerProgramRequired,
    hasConditions: Boolean(offer.hasConditions),
    isMultiBuy: Boolean(offer.isMultiBuy),
    effectiveDiscountType: offer.effectiveDiscountType || 'unknown',
    comparisonGroup: offer.comparisonGroup || '',
    status: offer.status || 'unknown',
    isActiveNow: Boolean(offer.isActiveNow),
    isActiveToday: Boolean(offer.isActiveToday),
    validFrom: offer.validFrom,
    validTo: offer.validTo,
    packCount: offer.packCount ?? null,
    unitValue: offer.unitValue ?? null,
    unitType: offer.unitType || '',
    totalComparableAmount: offer.totalComparableAmount ?? null,
    comparableUnit: offer.comparableUnit || '',
    packageType: offer.packageType || '',
    normalizedUnitPrice: offer.normalizedUnitPrice,
    priceCurrent: offer.priceCurrent,
    priceReference: offer.priceReference,
    priceReferenceSource: offer.priceReferenceSource || '',
    priceReferenceConfidence: Number(offer.priceReferenceConfidence || 0),
    savingsDisplayType: offer.savingsDisplayType || '',
    savingsConfidence: Number(offer.savingsConfidence || 0),
    hasReferencePrice: Boolean(offer.hasReferencePrice),
    hasProspectNormalPrice: Boolean(offer.hasProspectNormalPrice),
    hasEstimatedReferencePrice: Boolean(offer.hasEstimatedReferencePrice),
    isActionPriceOnly: Boolean(offer.isActionPriceOnly),
    referencePrice: structuredReferencePrice,
    savings: structuredSavings,
    imageUrl: offer.imageUrl || '',
    sourceType: offer.sourceType || '',
    sourceTypes: offer.sourceTypes || [],
    evidenceUrls: offer.evidenceUrls || [],
    needsReview: Boolean(offer.needsReview),
    reviewReasons: offer.reviewReasons || [],
    priceGapPercent,
    relativeScore: Number((spread * 100).toFixed(2)),
    savingsAmount: legacySavings.savingsAmount,
    savingsPercent: legacySavings.savingsPercent,
    minimumPurchaseQuantity: legacySavings.requiredQuantity,
    minimumPurchaseQty: offer.minimumPurchaseQty ?? legacySavings.requiredQuantity ?? 1,
    quality: offer.quality || {},
    sortScoreDefault: Number(offer.sortScoreDefault || 0),
    validityLabel: buildValidityLabel(offer),
  };
}

function formatDateLabel(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function buildValidityLabel(offer) {
  const validFrom = formatDateLabel(offer?.validFrom);
  const validTo = formatDateLabel(offer?.validTo);

  if (validFrom && validTo) {
    return `gueltig ${validFrom} bis ${validTo}`;
  }

  if (validTo) {
    return `gueltig bis ${validTo}`;
  }

  return 'aktuell verfuegbar, Enddatum nicht erkannt';
}

function hasReliableValidTo(offer) {
  if (!offer?.validTo) {
    return false;
  }

  const validTo = new Date(offer.validTo);
  return !Number.isNaN(validTo.getTime());
}

function compareSafeUnitPrice(left, right) {
  const leftSafe = isOfferSafelyComparable(left);
  const rightSafe = isOfferSafelyComparable(right);

  if (leftSafe !== rightSafe) {
    return leftSafe ? -1 : 1;
  }

  if (!leftSafe || !rightSafe) {
    return 0;
  }

  const leftUnit = normalizeComparableUnit(left?.comparableUnit || left?.normalizedUnitPrice?.unit);
  const rightUnit = normalizeComparableUnit(right?.comparableUnit || right?.normalizedUnitPrice?.unit);

  if (leftUnit !== rightUnit) {
    return 0;
  }

  const leftAmount = Number(left?.normalizedUnitPrice?.amount);
  const rightAmount = Number(right?.normalizedUnitPrice?.amount);

  if (Number.isFinite(leftAmount) && Number.isFinite(rightAmount) && leftAmount !== rightAmount) {
    return leftAmount - rightAmount;
  }

  return 0;
}

function buildConsumerScore(offer) {
  let score = Number(offer?.sortScoreDefault || 0);
  const safelyComparable = isOfferSafelyComparable(offer);

  if (offer?.status === 'active' && offer?.isActiveNow) score += 1000;
  if (safelyComparable && offer?.comparisonGroup) score += 500;
  if (hasReliableValidTo(offer)) score += 25;
  score += buildSourceQualityScore(offer);

  const unitAmount = Number(offer?.normalizedUnitPrice?.amount);
  if (safelyComparable && Number.isFinite(unitAmount) && unitAmount > 0) {
    score += Math.max(0, 200 - Math.min(200, Math.round(unitAmount * 10)));
  }

  if (!offer?.isMultiBuy && (offer?.minimumPurchaseQuantity || 1) <= 1) score += 100;
  if (!offer?.customerProgramRequired) score += 80;
  if (!offer?.hasConditions) score += 60;

  return score;
}

function getOfferSourceType(offer) {
  return String(offer?.sourceType || offer?.rawFacts?.sourceType || '').trim();
}

const RESPONSE_SOURCE_PRIORITY_MATRIX = {
  billa: [
    ['billa-official-algolia', 1, 'official-structured-json'],
    ['billa-official-html', 2, 'official-html'],
    ['flyer', 3, 'official-flyer'],
    ['offers-page', 3, 'official-page'],
    ['aktionsfinder-json', 5, 'aggregator-json'],
    ['marketguru-json-api', 6, 'aggregator-json'],
    ['marketguru-embedded-json', 6, 'aggregator-json'],
    ['marketguru-html', 7, 'aggregator-html'],
    ['aggregator', 7, 'aggregator'],
  ],
  'billa-plus': [
    ['billa-official-algolia', 1, 'official-structured-json'],
    ['billa-official-html', 2, 'official-html'],
    ['flyer', 3, 'official-flyer'],
    ['offers-page', 3, 'official-page'],
    ['aktionsfinder-json', 5, 'aggregator-json'],
    ['marketguru-json-api', 6, 'aggregator-json'],
    ['marketguru-embedded-json', 6, 'aggregator-json'],
    ['marketguru-html', 7, 'aggregator-html'],
    ['aggregator', 7, 'aggregator'],
  ],
  lidl: [
    ['lidl-official-flyer-api', 1, 'official-structured-json'],
    ['lidl-official-html', 2, 'official-html'],
    ['flyer', 3, 'official-flyer'],
    ['aktionsfinder-json', 5, 'aggregator-json'],
    ['marketguru-json-api', 6, 'aggregator-json'],
    ['marketguru-embedded-json', 6, 'aggregator-json'],
    ['marketguru-html', 7, 'aggregator-html'],
    ['aggregator', 7, 'aggregator'],
  ],
  penny: [
    ['penny-official-html', 2, 'official-html'],
    ['penny-official-pdf', 8, 'official-pdf-evidence'],
    ['aktionsfinder-json', 5, 'aggregator-json'],
    ['marketguru-json-api', 6, 'aggregator-json'],
    ['marketguru-embedded-json', 6, 'aggregator-json'],
    ['marketguru-html', 7, 'aggregator-html'],
    ['aggregator', 7, 'aggregator'],
    ['penny-pdf-ocr-bbox', 99, 'ocr-diagnostic-only'],
    ['penny-ocr-diagnostics', 99, 'ocr-diagnostic-only'],
  ],
  dm: [
    ['dm-official-html', 2, 'official-html'],
    ['offers-page', 3, 'official-page'],
    ['aktionsfinder-json', 5, 'aggregator-json'],
    ['wogibtswas-html', 7, 'aggregator-html'],
    ['marketguru-json-api', 6, 'aggregator-json'],
    ['marketguru-embedded-json', 6, 'aggregator-json'],
    ['marketguru-html', 7, 'aggregator-html'],
    ['aggregator', 7, 'aggregator'],
  ],
  bipa: [
    ['bipa-official-html', 2, 'official-html'],
    ['offers-page', 3, 'official-page'],
    ['aktionsfinder-json', 5, 'aggregator-json'],
    ['marketguru-json-api', 6, 'aggregator-json'],
    ['marketguru-embedded-json', 6, 'aggregator-json'],
    ['marketguru-html', 7, 'aggregator-html'],
    ['aggregator', 7, 'aggregator'],
  ],
  spar: [
    ['spar-official-html', 2, 'official-html'],
    ['flyer', 3, 'official-flyer'],
    ['offers-page', 3, 'official-page'],
    ['aktionsfinder-json', 5, 'aggregator-json'],
    ['marketguru-json-api', 6, 'aggregator-json'],
    ['marketguru-embedded-json', 6, 'aggregator-json'],
    ['marketguru-html', 7, 'aggregator-html'],
    ['aggregator', 7, 'aggregator'],
  ],
  hofer: [
    ['hofer-official-html', 2, 'official-html'],
    ['flyer', 3, 'official-flyer'],
    ['offers-page', 3, 'official-page'],
    ['aktionsfinder-json', 5, 'aggregator-json'],
    ['marketguru-json-api', 6, 'aggregator-json'],
    ['marketguru-embedded-json', 6, 'aggregator-json'],
    ['marketguru-html', 7, 'aggregator-html'],
    ['aggregator', 7, 'aggregator'],
  ],
};

function getSourcePriorityEntry(offer) {
  const sourceType = getOfferSourceType(offer);
  const retailerKey = normalizeRetailerKey(offer?.retailerKey || offer?.retailerName || '');
  const entries = RESPONSE_SOURCE_PRIORITY_MATRIX[retailerKey] || [];
  const exact = entries.find(([candidate]) => candidate === sourceType);

  if (exact) {
    return { sourceType: exact[0], rank: exact[1], role: exact[2] };
  }

  if (/ocr|bbox|tesseract|paddle/i.test(sourceType)) {
    return { sourceType, rank: 99, role: 'ocr-diagnostic-only' };
  }

  if (/official.*(?:algolia|api|json)|(?:algolia|api|json).*official/i.test(sourceType)) {
    return { sourceType, rank: 1, role: 'official-structured-json' };
  }

  if (/official.*html|html.*official/i.test(sourceType)) {
    return { sourceType, rank: 2, role: 'official-html' };
  }

  if (/official.*pdf|pdf.*official/i.test(sourceType)) {
    return { sourceType, rank: 8, role: 'official-pdf-evidence' };
  }

  if (/aktionsfinder/i.test(sourceType)) {
    return { sourceType, rank: 5, role: 'aggregator-json' };
  }

  if (/marketguru.*(?:json|api|embedded)|(?:json|api|embedded).*marketguru/i.test(sourceType)) {
    return { sourceType, rank: 6, role: 'aggregator-json' };
  }

  if (/wogibtswas|marketguru|aggregator/i.test(sourceType)) {
    return { sourceType, rank: 7, role: 'aggregator' };
  }

  if (/pdf/i.test(sourceType)) {
    return { sourceType, rank: 8, role: 'pdf-evidence' };
  }

  return { sourceType: sourceType || 'unknown', rank: 20, role: 'unknown' };
}

function getSourcePriorityRank(offer) {
  return getSourcePriorityEntry(offer).rank;
}

function buildSourceQualityScore(offer) {
  const rank = getSourcePriorityRank(offer);
  const quality = classifyOfferSourceQuality(offer);

  if (quality.isLowConfidenceAggregator) return -500;

  if (rank === 1) return 45;
  if (rank === 2) return 35;
  if (rank === 3) return 30;
  if (rank === 5) return 0;
  if (rank === 8) return -10;
  if (rank >= 90) return -30;

  return 0;
}

function buildRetailerDistribution(offers) {
  const grouped = new Map();

  for (const offer of offers) {
    if (!grouped.has(offer.retailerKey)) {
      grouped.set(offer.retailerKey, {
        retailerKey: offer.retailerKey,
        retailerName: offer.retailerName,
        offerCount: 0,
        bestUnitPrice: isOfferSafelyComparable(offer)
          ? Number(offer?.normalizedUnitPrice?.amount ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER,
      });
    }

    const current = grouped.get(offer.retailerKey);
    current.offerCount += 1;
    current.bestUnitPrice = Math.min(
      current.bestUnitPrice,
      isOfferSafelyComparable(offer)
        ? Number(offer?.normalizedUnitPrice?.amount ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER
    );
  }

  return [...grouped.values()].sort((left, right) => {
    if (right.offerCount !== left.offerCount) {
      return right.offerCount - left.offerCount;
    }

    return left.bestUnitPrice - right.bestUnitPrice;
  });
}

function dedupeOffers(offers) {
  const unique = [];
  const keyToIndex = new Map();

  for (const offer of offers) {
    const dedupeKey = offer.dedupeKey || offer.offerKey || [
      offer.retailerKey,
      offer.categoryKey,
      offer.titleNormalized || offer.title,
      offer.comparisonGroup,
      offer.normalizedUnitPrice?.amount,
      offer.validTo?.toISOString?.() || offer.validTo,
    ].join('::');

    const duplicateIndex = keyToIndex.get(dedupeKey);

    if (duplicateIndex === undefined) {
      keyToIndex.set(dedupeKey, unique.length);
      unique.push(offer);
      continue;
    }

    const preferred = choosePreferredQueryDuplicate(unique[duplicateIndex], offer, '');
    unique[duplicateIndex] = preferred;
  }

  return unique;
}

function dedupeByQuery(offers) {
  const seen = new Set();
  const unique = [];

  for (const offer of offers) {
    const dedupeKey = offer.dedupeKey || offer.offerKey || [
      offer.retailerKey,
      offer.titleNormalized || offer.title,
      offer.comparisonGroup,
      offer.quantityText,
      offer.normalizedUnitPrice?.amount,
      offer.normalizedUnitPrice?.unit,
    ].join('::');

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    unique.push(offer);
  }

  return unique;
}

function getOfferIdentity(offer) {
  return String(offer?._id || offer?.id || '').trim();
}

function getOfferPriceKey(offer) {
  const currentAmount = offer?.priceCurrent?.amount;
  const unitAmount = offer?.normalizedUnitPrice?.amount;

  if (currentAmount !== undefined && currentAmount !== null) {
    return `current:${Number(currentAmount).toFixed(2)}`;
  }

  if (unitAmount !== undefined && unitAmount !== null) {
    return `unit:${Number(unitAmount).toFixed(2)}:${offer?.normalizedUnitPrice?.unit || offer?.comparableUnit || ''}`;
  }

  return 'price:unknown';
}

function getOfferQuantityKey(offer) {
  const quantityText = normalizeSearchText(offer?.quantityText);

  if (quantityText) {
    return quantityText;
  }

  return [
    offer?.packCount ?? '',
    offer?.unitValue ?? '',
    offer?.unitType || '',
    offer?.totalComparableAmount ?? '',
    offer?.comparableUnit || offer?.normalizedUnitPrice?.unit || '',
  ].join(':');
}

function normalizeQuantityUnit(value) {
  const normalized = normalizeSearchText(value);

  if (['stuck', 'stk', 'stueck', 'piece', 'pieces'].includes(normalized)) {
    return 'stueck';
  }

  if (['liter'].includes(normalized)) {
    return 'l';
  }

  if (['gramm'].includes(normalized)) {
    return 'g';
  }

  return normalized;
}

function numericSignature(value, digits = 4) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number.toFixed(digits) : '';
}

function getStructuredQuantitySignature(offer) {
  const total = numericSignature(offer?.totalComparableAmount, 4);
  const comparableUnit = normalizeQuantityUnit(offer?.comparableUnit || offer?.normalizedUnitPrice?.unit || '');

  if (total && comparableUnit) {
    return `total:${total}:${comparableUnit}`;
  }

  const unitValue = numericSignature(offer?.unitValue, 4);
  const unitType = normalizeQuantityUnit(offer?.unitType || '');
  const packCount = numericSignature(offer?.packCount, 0);

  if (unitValue && unitType) {
    return `unit:${packCount || '1'}:${unitValue}:${unitType}`;
  }

  return '';
}

function normalizeVisibleQuantityText(value) {
  return normalizeSearchText(value)
    .replace(/\bundefined\b/g, ' ')
    .replace(/\bnan\b/g, ' ')
    .replace(/\bfl\b/g, 'flasche')
    .replace(/\bflaschen\b/g, 'flasche')
    .replace(/\bpackung\b/g, 'packung')
    .replace(/\bpackungen\b/g, 'packung')
    .replace(/\bstk\b/g, 'stueck')
    .replace(/\bstuck\b/g, 'stueck')
    .replace(/\s+/g, ' ')
    .trim();
}

function getVisibleQuantitySignature(offer) {
  return getStructuredQuantitySignature(offer) || normalizeVisibleQuantityText(offer?.quantityText);
}

function haveSameVisibleQuantity(left, right) {
  const leftStructured = getStructuredQuantitySignature(left);
  const rightStructured = getStructuredQuantitySignature(right);

  if (leftStructured && rightStructured) {
    return leftStructured === rightStructured;
  }

  const leftText = normalizeVisibleQuantityText(left?.quantityText);
  const rightText = normalizeVisibleQuantityText(right?.quantityText);

  return Boolean(leftText && leftText === rightText);
}

function getOfferScopeKey(offer) {
  const formats = Array.isArray(offer?.appliesToRetailerFormats)
    ? offer.appliesToRetailerFormats
    : Array.isArray(offer?.retailerFormats)
      ? offer.retailerFormats
      : [];
  const formatKey = formats.map(normalizeSearchText).filter(Boolean).sort().join('+');

  return [
    normalizeSearchText(offer?.sourceRetailerFormat),
    formatKey,
    normalizeSearchText(offer?.retailerFormatLabel),
  ].filter(Boolean).join(':') || 'scope:default';
}

function getOfferConditionKey(offer) {
  return [
    normalizeSearchText(offer?.conditionsText || offer?.conditionLabel),
    normalizeSearchText(offer?.benefitType),
    normalizeSearchText(offer?.effectiveDiscountType || offer?.discountMechanic || offer?.discountType),
    normalizeSearchText(offer?.customerProgramRequired ? 'program-required' : 'public'),
    normalizeSearchText(offer?.isMultiBuy ? 'multibuy' : 'single-buy'),
    String(offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || offer?.minQuantity || ''),
  ].filter(Boolean).join(':') || 'condition:default';
}

function getOfferTitleKey(offer) {
  return normalizeSearchText(offer?.titleNormalized || offer?.title);
}

function getComparableTitleTokens(offer) {
  const noisyTokens = new Set([
    'aktion',
    'aktionen',
    'angebot',
    'angebote',
    'div',
    'diverse',
    'geschmack',
    'gueltig',
    'penny',
    'billa',
    'plus',
    'lidl',
    'spar',
    'hofer',
    'sorten',
    'versch',
    'verschiedene',
  ]);

  return tokenizeSearchText(offer?.titleNormalized || offer?.title)
    .filter((token) => token.length > 2 && !/^\d+$/.test(token) && !noisyTokens.has(token))
    .slice(0, 10);
}

function sameConservativeTitleIdentity(left, right) {
  const leftTokens = getComparableTitleTokens(left);
  const rightTokens = getComparableTitleTokens(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token)).length;
  const smaller = Math.min(leftSet.size, rightSet.size);
  const larger = Math.max(leftSet.size, rightSet.size);

  return shared >= 2 && shared / smaller >= 0.85 && shared / larger >= 0.6;
}

function hasSameResponseFallbackIdentity(left, right) {
  if (!left || !right) {
    return false;
  }

  if (getOfferIdentity(left) && getOfferIdentity(left) === getOfferIdentity(right)) {
    return true;
  }

  if (left.dedupeKey && left.dedupeKey === right.dedupeKey) {
    return true;
  }

  if (left.offerKey && left.offerKey === right.offerKey) {
    return true;
  }

  const sameRetailer =
    String(left.retailerKey || left.retailerName || '') === String(right.retailerKey || right.retailerName || '');
  const sameScope = getOfferScopeKey(left) === getOfferScopeKey(right);
  const samePrice = getOfferPriceKey(left) === getOfferPriceKey(right);
  const sameQuantity = getOfferQuantityKey(left) === getOfferQuantityKey(right);
  const sameCondition = getOfferConditionKey(left) === getOfferConditionKey(right);
  const sameVariant = getOfferVariantKey(left) === getOfferVariantKey(right);

  if (!sameRetailer || !sameScope || !samePrice || !sameQuantity || !sameCondition || !sameVariant) {
    return false;
  }

  if (getOfferTitleKey(left) === getOfferTitleKey(right)) {
    return true;
  }

  return sameConservativeTitleIdentity(left, right);
}

function findRawFactValue(value, keys) {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const matches = [];

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const normalizedKey = normalizeSearchText(rawKey);

    if (keys.some((key) => normalizedKey === key || normalizedKey.includes(key))) {
      if (rawValue === null || rawValue === undefined || typeof rawValue === 'object') {
        matches.push(normalizeSearchText(JSON.stringify(rawValue || '')));
      } else {
        matches.push(normalizeSearchText(rawValue));
      }
    }
  }

  return matches.filter(Boolean).join(':');
}

function getOfferVariantKey(offer) {
  const rawVariantKeys = [
    'abmessung',
    'akku',
    'breite',
    'color',
    'durchmesser',
    'farbe',
    'groesse',
    'grosse',
    'hoehe',
    'hohe',
    'laenge',
    'lange',
    'leistung',
    'material',
    'model',
    'modell',
    'spannung',
    'staerke',
    'starke',
    'tiefe',
    'voltage',
    'watt',
  ];

  return [
    normalizeSearchText(offer?.brand),
    normalizeSearchText(offer?.packageType),
    findRawFactValue(offer?.rawFacts, rawVariantKeys),
  ].filter(Boolean).join(':');
}

function getStrictQueryDedupeKeys(offer) {
  const keys = [];
  const identity = getOfferIdentity(offer);

  if (identity) {
    keys.push(`id:${identity}`);
  }

  if (offer?.dedupeKey) {
    keys.push(`dedupe:${offer.dedupeKey}`);
  }

  if (offer?.offerKey) {
    keys.push(`offer:${offer.offerKey}`);
  }

  const titleKey = getOfferTitleKey(offer);
  if (titleKey) {
    keys.push([
      'fallback',
      offer?.retailerKey || offer?.retailerName || '',
      getOfferScopeKey(offer),
      titleKey,
      getOfferPriceKey(offer),
      getOfferQuantityKey(offer),
      getOfferConditionKey(offer),
      getOfferVariantKey(offer),
    ].join(':'));
  }

  return keys;
}

function hasRicherOfferData(left, right) {
  const leftScore = [
    Boolean(left?.imageUrl),
    Boolean(left?.comparisonGroup),
    Boolean(left?.brand),
    Boolean(left?.quantityText),
    Boolean(left?.priceCurrent?.amount),
    Boolean(left?.normalizedUnitPrice?.amount),
    Boolean(left?.validTo),
  ].filter(Boolean).length;
  const rightScore = [
    Boolean(right?.imageUrl),
    Boolean(right?.comparisonGroup),
    Boolean(right?.brand),
    Boolean(right?.quantityText),
    Boolean(right?.priceCurrent?.amount),
    Boolean(right?.normalizedUnitPrice?.amount),
    Boolean(right?.validTo),
  ].filter(Boolean).length;

  return leftScore > rightScore;
}

function hasSafeValidityWindow(offer) {
  return Boolean(formatDateLabel(offer?.validFrom) && formatDateLabel(offer?.validTo));
}

function centsValue(value) {
  const number = Number(
    value && typeof value === 'object' && typeof value.toString === 'function'
      ? value.toString()
      : value,
  );
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function sameVisiblePrice(left, right) {
  const leftCurrent = centsValue(left?.priceCurrent?.amount);
  const rightCurrent = centsValue(right?.priceCurrent?.amount);

  if (leftCurrent !== null || rightCurrent !== null) {
    return leftCurrent !== null && rightCurrent !== null && leftCurrent === rightCurrent;
  }

  const leftUnit = centsValue(left?.normalizedUnitPrice?.amount);
  const rightUnit = centsValue(right?.normalizedUnitPrice?.amount);
  const leftUnitName = normalizeQuantityUnit(left?.normalizedUnitPrice?.unit || left?.comparableUnit || '');
  const rightUnitName = normalizeQuantityUnit(right?.normalizedUnitPrice?.unit || right?.comparableUnit || '');

  return leftUnit !== null && rightUnit !== null && leftUnit === rightUnit && leftUnitName === rightUnitName;
}

function dateValue(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function haveCompatibleResponseValidity(left, right) {
  const leftFrom = dateValue(left?.validFrom);
  const leftTo = dateValue(left?.validTo);
  const rightFrom = dateValue(right?.validFrom);
  const rightTo = dateValue(right?.validTo);

  if (!leftFrom && !leftTo) return true;
  if (!rightFrom && !rightTo) return true;

  if (getResponseDateKey(left?.validFrom) === getResponseDateKey(right?.validFrom)
    && getResponseDateKey(left?.validTo) === getResponseDateKey(right?.validTo)) {
    return true;
  }

  if (leftFrom && leftTo && rightFrom && rightTo) {
    return leftFrom <= rightTo && rightFrom <= leftTo;
  }

  if (leftTo && rightTo) {
    return getResponseDateKey(leftTo) === getResponseDateKey(rightTo);
  }

  return false;
}

function getResponseDiscountKey(offer) {
  const value = normalizeSearchText(
    offer?.benefitType || offer?.effectiveDiscountType || offer?.discountMechanic || offer?.discountType,
  );

  return value && value !== 'unknown' ? value : '';
}

function haveCompatibleResponseConditions(left, right) {
  const leftConditionText = normalizeSearchText(left?.conditionsText || left?.conditionLabel);
  const rightConditionText = normalizeSearchText(right?.conditionsText || right?.conditionLabel);

  if (leftConditionText && rightConditionText && leftConditionText !== rightConditionText) {
    return false;
  }

  if (Boolean(left?.customerProgramRequired) !== Boolean(right?.customerProgramRequired)) {
    return false;
  }

  if (Boolean(left?.isMultiBuy) !== Boolean(right?.isMultiBuy)) {
    return false;
  }

  const leftMinimum = Number(left?.minimumPurchaseQty || left?.minimumPurchaseQuantity || left?.minQuantity || 1);
  const rightMinimum = Number(right?.minimumPurchaseQty || right?.minimumPurchaseQuantity || right?.minQuantity || 1);

  if (Number.isFinite(leftMinimum) && Number.isFinite(rightMinimum) && leftMinimum !== rightMinimum) {
    return false;
  }

  const leftDiscount = getResponseDiscountKey(left);
  const rightDiscount = getResponseDiscountKey(right);

  return !leftDiscount || !rightDiscount || leftDiscount === rightDiscount;
}

function haveSameVisibleCardConditions(left, right) {
  const leftConditionText = normalizeSearchText(left?.conditionsText || left?.conditionLabel);
  const rightConditionText = normalizeSearchText(right?.conditionsText || right?.conditionLabel);

  if (leftConditionText !== rightConditionText) {
    return false;
  }

  if (Boolean(left?.customerProgramRequired) !== Boolean(right?.customerProgramRequired)) {
    return false;
  }

  if (Boolean(left?.isMultiBuy) !== Boolean(right?.isMultiBuy)) {
    return false;
  }

  const leftMinimum = Number(left?.minimumPurchaseQty || left?.minimumPurchaseQuantity || left?.minQuantity || 1);
  const rightMinimum = Number(right?.minimumPurchaseQty || right?.minimumPurchaseQuantity || right?.minQuantity || 1);

  if (Number.isFinite(leftMinimum) && Number.isFinite(rightMinimum) && leftMinimum !== rightMinimum) {
    return false;
  }

  return true;
}

function getVisibleCardValidityLabel(offer) {
  return normalizeSearchText(buildValidityLabel(offer));
}

function haveSameVisibleCardValidity(left, right) {
  const leftLabel = getVisibleCardValidityLabel(left);
  const rightLabel = getVisibleCardValidityLabel(right);

  return leftLabel === rightLabel;
}

function getResponseRawVariantKey(offer) {
  const rawVariantKeys = [
    'abmessung',
    'akku',
    'breite',
    'color',
    'durchmesser',
    'farbe',
    'groesse',
    'grosse',
    'hoehe',
    'hohe',
    'laenge',
    'lange',
    'leistung',
    'material',
    'model',
    'modell',
    'spannung',
    'staerke',
    'starke',
    'tiefe',
    'voltage',
    'watt',
  ];

  return findRawFactValue(offer?.rawFacts, rawVariantKeys);
}

function haveCompatibleResponseVariant(left, right) {
  const leftBrand = normalizeSearchText(left?.brand);
  const rightBrand = normalizeSearchText(right?.brand);
  const visibleTitle = normalizeSearchText(`${left?.title || ''} ${right?.title || ''}`);

  if (leftBrand && rightBrand && leftBrand !== rightBrand) {
    return false;
  }

  const oneSidedBrand = leftBrand || rightBrand;
  if (oneSidedBrand && !visibleTitle.includes(oneSidedBrand)) {
    return false;
  }

  const leftPackage = normalizeSearchText(left?.packageType);
  const rightPackage = normalizeSearchText(right?.packageType);

  if (leftPackage && rightPackage && leftPackage !== rightPackage) {
    return false;
  }

  const leftRawVariant = getResponseRawVariantKey(left);
  const rightRawVariant = getResponseRawVariantKey(right);

  return !leftRawVariant || !rightRawVariant || leftRawVariant === rightRawVariant;
}

function hasSameVisibleResponseFingerprint(left, right) {
  if (!left || !right) {
    return false;
  }

  const sameRetailer =
    normalizeRetailerKey(left.retailerKey || left.retailerName || '') ===
    normalizeRetailerKey(right.retailerKey || right.retailerName || '');

  if (!sameRetailer) {
    return false;
  }

  if (!sameVisiblePrice(left, right)) {
    return false;
  }

  if (!haveSameVisibleQuantity(left, right)) {
    return false;
  }

  if (!haveCompatibleResponseConditions(left, right)) {
    return false;
  }

  if (!haveCompatibleResponseVariant(left, right)) {
    return false;
  }

  if (!haveCompatibleResponseValidity(left, right)) {
    return false;
  }

  const leftVisibleTitle = normalizeSearchText(left?.title || left?.titleNormalized);
  const rightVisibleTitle = normalizeSearchText(right?.title || right?.titleNormalized);

  if (leftVisibleTitle && leftVisibleTitle === rightVisibleTitle) {
    return true;
  }

  const leftTitle = getOfferTitleKey(left);
  const rightTitle = getOfferTitleKey(right);

  return Boolean(leftTitle && leftTitle === rightTitle) || sameConservativeTitleIdentity(left, right);
}

function hasVeryStrongVisibleCardTitleIdentity(left, right) {
  const leftVisibleTitle = normalizeSearchText(left?.title || left?.titleNormalized);
  const rightVisibleTitle = normalizeSearchText(right?.title || right?.titleNormalized);

  if (!leftVisibleTitle || !rightVisibleTitle) {
    return false;
  }

  if (leftVisibleTitle === rightVisibleTitle) {
    return true;
  }

  const leftTokens = getComparableTitleTokens(left);
  const rightTokens = getComparableTitleTokens(right);

  if (leftTokens.length < 3 || rightTokens.length < 3) {
    return false;
  }

  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token)).length;
  const smaller = Math.min(new Set(leftTokens).size, new Set(rightTokens).size);
  const larger = Math.max(new Set(leftTokens).size, new Set(rightTokens).size);

  return shared >= 3 && shared / smaller >= 0.9 && shared / larger >= 0.8;
}

function hasSameVisibleCardFingerprint(left, right) {
  if (!left || !right) {
    return false;
  }

  const sameRetailer =
    normalizeRetailerKey(left.retailerKey || left.retailerName || '') ===
    normalizeRetailerKey(right.retailerKey || right.retailerName || '');

  if (!sameRetailer) {
    return false;
  }

  if (!hasVeryStrongVisibleCardTitleIdentity(left, right)) {
    return false;
  }

  if (!sameVisiblePrice(left, right)) {
    return false;
  }

  if (!haveSameVisibleQuantity(left, right)) {
    return false;
  }

  if (!haveSameVisibleCardValidity(left, right)) {
    return false;
  }

  return haveSameVisibleCardConditions(left, right);
}

function hasUsableOfferPrice(offer) {
  const currentAmount = Number(offer?.priceCurrent?.amount);
  const unitAmount = Number(offer?.normalizedUnitPrice?.amount);

  return (Number.isFinite(currentAmount) && currentAmount > 0)
    || (Number.isFinite(unitAmount) && unitAmount > 0);
}

function compareResponseDuplicatePreference(left, right, query) {
  const leftHasPrice = Number(hasUsableOfferPrice(left));
  const rightHasPrice = Number(hasUsableOfferPrice(right));

  if (leftHasPrice !== rightHasPrice) {
    return rightHasPrice - leftHasPrice;
  }

  const leftSourceRank = getSourcePriorityRank(left);
  const rightSourceRank = getSourcePriorityRank(right);

  if (leftSourceRank !== rightSourceRank) {
    return leftSourceRank - rightSourceRank;
  }

  const leftValidity = Number(hasSafeValidityWindow(left));
  const rightValidity = Number(hasSafeValidityWindow(right));

  if (leftValidity !== rightValidity) {
    return rightValidity - leftValidity;
  }

  return compareOffersByRanking(left, right, { query });
}

function visibleQuantityTextCompletenessScore(offer) {
  const text = normalizeVisibleQuantityText(offer?.quantityText);

  if (!text) {
    return 0;
  }

  if (/\bundefined\b|\bnan\b/.test(normalizeSearchText(offer?.quantityText))) {
    return 1;
  }

  return Math.min(10, text.length);
}

function compareVisibleCardDuplicatePreference(left, right, query) {
  const leftSourceRank = getSourcePriorityRank(left);
  const rightSourceRank = getSourcePriorityRank(right);

  if (leftSourceRank !== rightSourceRank) {
    return leftSourceRank - rightSourceRank;
  }

  const leftValidity = Number(hasSafeValidityWindow(left));
  const rightValidity = Number(hasSafeValidityWindow(right));

  if (leftValidity !== rightValidity) {
    return rightValidity - leftValidity;
  }

  const leftQuantityScore = visibleQuantityTextCompletenessScore(left);
  const rightQuantityScore = visibleQuantityTextCompletenessScore(right);

  if (leftQuantityScore !== rightQuantityScore) {
    return rightQuantityScore - leftQuantityScore;
  }

  const leftImage = Number(Boolean(left?.imageUrl));
  const rightImage = Number(Boolean(right?.imageUrl));

  if (leftImage !== rightImage) {
    return rightImage - leftImage;
  }

  return compareOffersByRanking(left, right, { query });
}

function choosePreferredQueryDuplicate(left, right, query) {
  const rankingComparison = compareResponseDuplicatePreference(left, right, query);

  if (rankingComparison < 0) {
    return left;
  }

  if (rankingComparison > 0) {
    return right;
  }

  if (hasRicherOfferData(right, left)) {
    return right;
  }

  return left;
}

function dedupeResponseOffers(offers, query = '') {
  const unique = [];

  for (const offer of offers) {
    const duplicateIndex = unique.findIndex((candidate) => hasSameResponseFallbackIdentity(candidate, offer));

    if (duplicateIndex < 0) {
      unique.push(offer);
      continue;
    }

    const preferred = choosePreferredQueryDuplicate(unique[duplicateIndex], offer, query);
    unique[duplicateIndex] = preferred;
  }

  return unique;
}

function normalizeResponseFingerprintPart(value) {
  if (value === undefined || value === null) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Number(value.toFixed(4))) : '';
  }

  return normalizeSearchText(value);
}

function getResponseDateKey(value) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return normalizeResponseFingerprintPart(value);
  }

  return date.toISOString().slice(0, 10);
}

function getFinalResponseVisibleFingerprint(offer) {
  const titleKey = normalizeResponseFingerprintPart(offer?.titleNormalized || offer?.title);

  if (!titleKey) {
    return '';
  }

  return [
    'visible',
    normalizeRetailerKey(offer?.retailerKey || offer?.retailerName || ''),
    titleKey,
    getOfferPriceKey(offer),
    getOfferQuantityKey(offer),
    normalizeResponseFingerprintPart(offer?.sourceType || offer?.rawFacts?.sourceType || ''),
    getResponseDateKey(offer?.validFrom),
    getResponseDateKey(offer?.validTo),
    getOfferConditionKey(offer),
    getOfferVariantKey(offer),
  ].join('::');
}

function getFinalResponseDedupeKeys(offer) {
  const keys = [];
  const identity = getOfferIdentity(offer);

  if (identity) {
    keys.push(`id:${identity}`);
  }

  if (offer?.dedupeKey) {
    keys.push(`dedupe:${offer.dedupeKey}`);
  }

  if (offer?.offerKey) {
    keys.push(`offer:${offer.offerKey}`);
  }

  const visibleFingerprint = getFinalResponseVisibleFingerprint(offer);

  if (visibleFingerprint) {
    keys.push(visibleFingerprint);
  }

  return keys;
}

function dedupeFinalResponseOffers(offers, query = '') {
  const unique = [];
  const keyToIndex = new Map();

  for (const offer of offers) {
    const keys = getFinalResponseDedupeKeys(offer);
    let duplicateIndex = keys
      .map((key) => keyToIndex.get(key))
      .find((index) => index !== undefined);

    if (duplicateIndex === undefined) {
      duplicateIndex = unique.findIndex((candidate) => hasSameVisibleResponseFingerprint(candidate, offer));
      if (duplicateIndex < 0) {
        duplicateIndex = undefined;
      }
    }

    if (duplicateIndex === undefined) {
      const newIndex = unique.length;
      unique.push(offer);
      keys.forEach((key) => keyToIndex.set(key, newIndex));
      continue;
    }

    const preferred = choosePreferredQueryDuplicate(unique[duplicateIndex], offer, query);

    if (preferred !== unique[duplicateIndex]) {
      unique[duplicateIndex] = preferred;
    }

    const mergedKeys = new Set([
      ...getFinalResponseDedupeKeys(unique[duplicateIndex]),
      ...keys,
    ]);
    mergedKeys.forEach((key) => keyToIndex.set(key, duplicateIndex));
  }

  return unique;
}

function summarizeVisibleCardDedupeOffer(offer = {}) {
  return {
    id: String(offer._id || offer.id || ''),
    retailerKey: offer.retailerKey || '',
    sourceType: offer.sourceType || '',
    title: offer.title || '',
    price: offer.priceCurrent?.amount ?? null,
    quantityText: offer.quantityText || '',
    validityLabel: buildValidityLabel(offer),
    conditionsText: offer.conditionsText || '',
    customerProgramRequired: Boolean(offer.customerProgramRequired),
  };
}

function getVisibleCardVariantDifference(left, right) {
  if (
    normalizeRetailerKey(left?.retailerKey || left?.retailerName || '') !==
    normalizeRetailerKey(right?.retailerKey || right?.retailerName || '')
  ) {
    return 'retailer';
  }

  if (!sameVisiblePrice(left, right)) {
    return 'price';
  }

  if (!haveSameVisibleQuantity(left, right)) {
    return 'quantity';
  }

  if (!haveSameVisibleCardValidity(left, right)) {
    return 'validity';
  }

  if (!haveSameVisibleCardConditions(left, right)) {
    return 'conditions';
  }

  if (!hasVeryStrongVisibleCardTitleIdentity(left, right)) {
    return 'title';
  }

  return '';
}

function dedupeVisibleCardResponseOffers(offers, query = '', { collectDiagnostics = false } = {}) {
  const unique = [];
  const diagnostics = {
    visibleRepeatCountBefore: Math.max(0, offers.length - new Set(offers.map((offer) => getOfferIdentity(offer)).filter(Boolean)).size),
    visibleRepeatCountAfter: 0,
    secondStageCollapsedCount: 0,
    examplesSecondStageCollapsed: [],
    examplesKeptBecauseVariant: [],
  };

  for (const offer of offers) {
    const duplicateIndex = unique.findIndex((candidate) => hasSameVisibleCardFingerprint(candidate, offer));

    if (duplicateIndex < 0) {
      if (collectDiagnostics && diagnostics.examplesKeptBecauseVariant.length < 8) {
        const related = unique.find((candidate) => {
          const leftTitle = getOfferTitleKey(candidate);
          const rightTitle = getOfferTitleKey(offer);

          return leftTitle && rightTitle && leftTitle === rightTitle;
        });
        const reason = related ? getVisibleCardVariantDifference(related, offer) : '';

        if (reason && reason !== 'title') {
          diagnostics.examplesKeptBecauseVariant.push({
            reason,
            kept: summarizeVisibleCardDedupeOffer(related),
            variant: summarizeVisibleCardDedupeOffer(offer),
          });
        }
      }

      unique.push(offer);
      continue;
    }

    const current = unique[duplicateIndex];
    const comparison = compareVisibleCardDuplicatePreference(current, offer, query);
    const preferred = comparison <= 0 ? current : offer;
    const collapsed = preferred === current ? offer : current;

    unique[duplicateIndex] = preferred;
    diagnostics.secondStageCollapsedCount += 1;

    if (collectDiagnostics && diagnostics.examplesSecondStageCollapsed.length < 8) {
      diagnostics.examplesSecondStageCollapsed.push({
        reason: 'same visible card fingerprint',
        kept: summarizeVisibleCardDedupeOffer(preferred),
        collapsed: summarizeVisibleCardDedupeOffer(collapsed),
      });
    }
  }

  diagnostics.visibleRepeatCountAfter = Math.max(0, unique.length - new Set(unique.map((offer) => getOfferIdentity(offer)).filter(Boolean)).size);

  return collectDiagnostics ? { offers: unique, diagnostics } : { offers: unique };
}

function dedupeQueryOffers(offers, query) {
  if (tokenizeSearchText(query).length === 0) {
    return offers;
  }

  const unique = [];
  const keyToIndex = new Map();

  for (const offer of offers) {
    const keys = getStrictQueryDedupeKeys(offer);
    const duplicateIndex = keys
      .map((key) => keyToIndex.get(key))
      .find((index) => index !== undefined);

    if (duplicateIndex === undefined) {
      const newIndex = unique.length;
      unique.push(offer);
      keys.forEach((key) => keyToIndex.set(key, newIndex));
      continue;
    }

    const preferred = choosePreferredQueryDuplicate(unique[duplicateIndex], offer, query);

    if (preferred !== unique[duplicateIndex]) {
      unique[duplicateIndex] = preferred;
      keys.forEach((key) => keyToIndex.set(key, duplicateIndex));
    }
  }

  return unique;
}

function reduceAdjacentQueryDuplicates(offers, query) {
  if (tokenizeSearchText(query).length === 0 || offers.length < 2) {
    return offers;
  }

  const remaining = [...offers];
  const ordered = [];
  let previousTitleKey = '';

  while (remaining.length > 0) {
    let selectedIndex = 0;

    if (previousTitleKey && getOfferTitleKey(remaining[0]) === previousTitleKey) {
      const alternativeIndex = remaining.findIndex((offer) => getOfferTitleKey(offer) !== previousTitleKey);

      if (alternativeIndex > 0) {
        selectedIndex = alternativeIndex;
      }
    }

    const [selected] = remaining.splice(selectedIndex, 1);
    ordered.push(selected);
    previousTitleKey = getOfferTitleKey(selected);
  }

  return ordered;
}

function prepareQueryOffersForResponse(offers, query) {
  return reduceAdjacentQueryDuplicates(dedupeResponseOffers(dedupeQueryOffers(offers, query), query), query);
}

function compareOffersByRanking(left, right, { query = '' } = {}) {
  const queryTokens = tokenizeSearchText(query);

  if (queryTokens.length > 0) {
    const leftQueryScore = scoreOfferAgainstQuery(left, query);
    const rightQueryScore = scoreOfferAgainstQuery(right, query);

    if (rightQueryScore !== leftQueryScore) {
      return rightQueryScore - leftQueryScore;
    }
  }

  const leftConsumerScore = buildConsumerScore(left);
  const rightConsumerScore = buildConsumerScore(right);

  if (rightConsumerScore !== leftConsumerScore) {
    return rightConsumerScore - leftConsumerScore;
  }

  const priceComparison = compareSafeUnitPrice(left, right);

  if (priceComparison !== 0) {
    return priceComparison;
  }

  return String(left.title).localeCompare(String(right.title), 'de');
}

function buildGroupedRankings(offers, { query = '' } = {}) {
  const hasQuery = tokenizeSearchText(query).length > 0;

  if (hasQuery) {
    const orderedGroups = [];

    for (const offer of offers) {
      const unit = offer.normalizedUnitPrice?.unit || 'unbekannt';
      const currentGroup = orderedGroups[orderedGroups.length - 1];

      if (currentGroup && currentGroup.unit === unit) {
        currentGroup.offers.push(offer);
      } else {
        orderedGroups.push({
          unit,
          offers: [offer],
        });
      }
    }

    return orderedGroups;
  }

  const groups = new Map();

  for (const offer of offers) {
    const unit = offer.normalizedUnitPrice?.unit || 'unbekannt';

    if (!groups.has(unit)) {
      groups.set(unit, []);
    }

    groups.get(unit).push(offer);
  }

  return [...groups.entries()]
    .map(([unit, unitOffers]) => ({
      unit,
      offers: unitOffers.sort((left, right) => compareOffersByRanking(left, right, { query })),
    }))
    .sort((left, right) => {
      const leftTopConsumerScore = left.offers[0] ? buildConsumerScore(left.offers[0]) : -1;
      const rightTopConsumerScore = right.offers[0] ? buildConsumerScore(right.offers[0]) : -1;

      if (rightTopConsumerScore !== leftTopConsumerScore) {
        return rightTopConsumerScore - leftTopConsumerScore;
      }

      return left.unit.localeCompare(right.unit, 'de');
    });
}

function buildRetailerOptions(items) {
  return items
    .map((item) => ({
      key: item._id,
      retailerKey: item._id,
      retailerName: item.name,
      offerCount: item.offerCount,
    }))
    .filter((item) => item.key && item.retailerName)
    .sort((left, right) => left.retailerName.localeCompare(right.retailerName, 'de'));
}

function buildCategoryLabelsFromDocuments(items) {
  const labels = new Map();

  for (const item of items || []) {
    const mainLabel = String(item?.mainCategoryLabel || '').trim();

    if (mainLabel && !isBroadCategory(mainLabel)) {
      labels.set(mainLabel, (labels.get(mainLabel) || 0) + Number(item?.offerCount || 0));
    }

    for (const subcategory of item?.subcategories || []) {
      const subLabel = String(subcategory?.subcategoryLabel || '').trim();

      if (!subLabel || isBroadCategory(subLabel)) {
        continue;
      }

      labels.set(subLabel, (labels.get(subLabel) || 0) + Number(subcategory?.offerCount || 0));
    }
  }

  return [...labels.entries()]
    .filter(([, count]) => count >= 1)
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0], 'de');
    })
    .map(([label]) => label);
}

function buildCacheMatch({ selectedRetailers = [], selectedCategories = [] }) {
  const match = {};

  if (selectedRetailers.length > 0) {
    match.retailerKey = { $in: selectedRetailers };
  }

  if (selectedCategories.length > 0) {
    const categoryKeys = selectedCategories.map((category) => category.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    match.offers = {
      $elemMatch: {
        categoryKey: { $in: categoryKeys },
      },
    };
  }

  return match;
}

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMongoQuerySearchFilter(query) {
  const queryTokens = tokenizeSearchText(query).slice(0, 5);

  if (queryTokens.length === 0) {
    return null;
  }

  const isGenericRiceQuery = queryTokens.length === 1 && queryTokens[0] === 'reis';
  const searchableFields = isGenericRiceQuery ? [
    'titleNormalized',
    'title',
    'brand',
    'comparisonGroup',
  ] : [
    'titleNormalized',
    'searchText',
    'title',
    'brand',
    'categoryPrimary',
    'categorySecondary',
    'subcategoryKey',
    'comparisonGroup',
  ];

  return {
    $and: queryTokens.map((token) => {
      const regex = new RegExp(escapeRegexLiteral(token), 'i');

      return {
        $or: searchableFields.map((field) => ({ [field]: regex })),
      };
    }),
  };
}

function buildTokenizedSearchFilter(query) {
  const queryTokens = buildQuerySearchTokens(query).slice(0, 24);

  if (queryTokens.length === 0) {
    return {
      filter: buildMongoQuerySearchFilter(query),
      queryTokens,
      candidateQueryMode: query ? 'fallbackRegex' : 'noTextQuery',
      usesSearchTokens: false,
      fallbackUsed: Boolean(query),
      fallbackReason: query ? 'no-query-tokens' : '',
    };
  }

  return {
    filter: {
      $and: [
        { searchTokens: { $in: queryTokens }, searchTokenVersion: { $gte: SEARCH_TOKEN_VERSION } },
      ],
    },
    queryTokens,
    candidateQueryMode: 'searchTokensOnly',
    usesSearchTokens: true,
    fallbackUsed: false,
    fallbackReason: '',
  };
}

function buildRankingCandidateMatch({
  selectedRetailers = [],
  selectedCategories = [],
  unit = 'all',
  onlyWithoutProgram = false,
  query = '',
  useSearchTokens = true,
}) {
  const match = buildCurrentAvailabilityMatch();
  const selectedCategoryKeys = selectedCategories.map((category) => category.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  const querySearch = useSearchTokens ? buildTokenizedSearchFilter(query) : {
    filter: buildMongoQuerySearchFilter(query),
    queryTokens: tokenizeSearchText(query).slice(0, 5),
    candidateQueryMode: query ? 'fallbackRegex' : 'noTextQuery',
    usesSearchTokens: false,
    fallbackUsed: Boolean(query),
    fallbackReason: query ? 'legacy-regex-mode' : '',
  };

  if (selectedRetailers.length > 0) {
    match.retailerKey = { $in: selectedRetailers };
  }

  if (selectedCategoryKeys.length > 0) {
    match.categoryKey = { $in: selectedCategoryKeys };
  }

  if (unit && unit !== 'all') {
    match.comparableUnit = unit;
  }

  if (normalizeBoolean(onlyWithoutProgram)) {
    match.customerProgramRequired = false;
  }

  if (querySearch.filter) {
    match.$and = querySearch.filter.$and;
  }

  return match;
}

function buildRankingCandidateQueryMetadata({ query = '', useSearchTokens = true } = {}) {
  const querySearch = useSearchTokens ? buildTokenizedSearchFilter(query) : {
    filter: buildMongoQuerySearchFilter(query),
    queryTokens: tokenizeSearchText(query).slice(0, 5),
    candidateQueryMode: query ? 'fallbackRegex' : 'noTextQuery',
    usesSearchTokens: false,
    fallbackUsed: Boolean(query),
    fallbackReason: query ? 'legacy-regex-mode' : '',
  };

  return {
    queryTokens: querySearch.queryTokens,
    candidateQueryMode: querySearch.candidateQueryMode,
    usesSearchTokens: Boolean(querySearch.usesSearchTokens),
    fallbackUsed: Boolean(querySearch.fallbackUsed),
    fallbackReason: querySearch.fallbackReason || '',
  };
}

function buildRankingCandidateFallbackMetadata(reason) {
  return {
    queryTokens: [],
    candidateQueryMode: 'fallbackRegex',
    usesSearchTokens: false,
    fallbackUsed: true,
    fallbackReason: reason,
  };
}

function buildRankingCandidateFallbackMatch({
  selectedRetailers = [],
  selectedCategories = [],
  unit = 'all',
  onlyWithoutProgram = false,
  query = '',
}) {
  return buildRankingCandidateMatch({
    selectedRetailers,
    selectedCategories,
    unit,
    onlyWithoutProgram,
    query,
    useSearchTokens: false,
  });
}

function shouldRunSeparatedRegexFallback({ query = '', offers = [], queryMetadata = {} }) {
  if (!query || queryMetadata.candidateQueryMode !== 'searchTokensOnly') {
    return '';
  }

  if (RANKING_SEARCH_TOKEN_FALLBACK_MODE === 'always' || RANKING_SEARCH_TOKEN_FALLBACK_MODE === 'force') {
    return 'explicit-transition-mode';
  }

  if (offers.length === 0) {
    return 'token-query-empty';
  }

  return '';
}

function mergeCandidateOffers(primaryOffers, fallbackOffers) {
  if (primaryOffers.length === 0) {
    return fallbackOffers;
  }

  const seen = new Set(primaryOffers.map((offer) => String(offer?._id || offer?.id || offer?.offerKey || '')));
  const merged = [...primaryOffers];

  for (const offer of fallbackOffers) {
    const key = String(offer?._id || offer?.id || offer?.offerKey || '');
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(offer);
  }

  return merged;
}

function buildRankingOfferQuery(match, candidateLimit) {
  const dbQuery = Offer.find(match)
    .select(OFFER_RANKING_FIELDS)
    .sort(RANKING_SORT)
    .limit(candidateLimit)
    .lean();

  return dbQuery;
}

function buildRankingCandidateLimit({ safeLimit = 30, showAllMatching = false, hasQuery = false }) {
  if (showAllMatching) {
    return RANKING_CANDIDATE_CAP;
  }

  if (hasQuery) {
    return Math.min(RANKING_CANDIDATE_CAP, Math.max(200, safeLimit * 3));
  }

  return Math.min(RANKING_CANDIDATE_CAP, Math.max(20, safeLimit * 20));
}

function paginateVisibleRankingOffers(offers = [], { limit = 30, offset = 0, showAllMatching = false } = {}) {
  const visibleOffers = Array.isArray(offers) ? offers : [];
  const safeOffset = showAllMatching ? 0 : Math.max(0, Number(offset) || 0);
  const safeLimit = showAllMatching ? visibleOffers.length : Math.max(1, Math.min(Number(limit) || 30, 500));
  const totalCount = visibleOffers.length;
  const pageOffers = showAllMatching ? visibleOffers : visibleOffers.slice(safeOffset, safeOffset + safeLimit);
  const nextOffset = safeOffset + pageOffers.length;
  const hasMore = !showAllMatching && nextOffset < totalCount;

  return {
    offers: pageOffers,
    totalCount,
    offset: safeOffset,
    limit: showAllMatching ? 'all' : safeLimit,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  };
}

function roundTiming(value) {
  return Number((Number(value) || 0).toFixed(1));
}

function buildCacheDebugTiming({
  cacheKeyHash = '',
  cacheHit = false,
  cacheSource = 'none',
  resultSetToken = '',
  safeLimit = 30,
  safeOffset = 0,
  query = '',
  selectedRetailers = [],
  selectedCategories = [],
  candidateCount = 0,
  resultCount = 0,
  finalVisibleCount = 0,
  timings = {},
} = {}) {
  return {
    instanceMarker: INSTANCE_MARKER,
    processUptimeSec: Math.round(process.uptime()),
    memoryCacheSize: getRankingResponseCacheSize(),
    cacheKeyHash,
    cacheHit,
    cacheSource,
    resultSetToken: resultSetToken ? `${String(resultSetToken).slice(0, 8)}...` : '',
    offset: safeOffset,
    limit: safeLimit,
    qPresent: Boolean(String(query || '').trim()),
    retailersCount: selectedRetailers.length,
    categoriesCount: selectedCategories.length,
    path: String(query || '').trim() ? 'keyword' : 'browse/filter',
    mongoQueryMs: roundTiming(timings.candidateFindMs || timings.mongoQueryMs),
    candidateCount,
    resultCount,
    finalVisibleCount,
    rankingMs: roundTiming(timings.rankingMs),
    dedupeMs: roundTiming((timings.dedupeMs || 0) + (timings.finalDedupeMs || 0) + (timings.visibleDedupeMs || 0)),
    sliceMs: roundTiming(timings.sliceMs),
    hydrateMs: roundTiming(timings.hydrateMs || timings.responseHydrationMs),
    responseBuildMs: roundTiming(timings.responseBuildMs || timings.responseMappingMs),
    mongoResultCacheMs: roundTiming(timings.mongoResultCacheMs),
    cacheWriteMs: roundTiming(timings.cacheWriteMs),
    totalMs: roundTiming(timings.totalMs),
  };
}

async function readRankingResultCache({ baseCacheKey = '', resultSetToken = '', expectedKeyHash = '' } = {}) {
  const now = new Date();
  const keyHash = expectedKeyHash || (baseCacheKey ? hashRankingCacheKey(baseCacheKey) : '');
  const token = String(resultSetToken || '').trim();

  if (token) {
    const tokenEntry = await RankingResultCache.findOne({
      resultSetToken: token,
      expiresAt: { $gt: now },
    }).lean();

    if (tokenEntry && (!keyHash || tokenEntry.keyHash === keyHash)) {
      return { entry: tokenEntry, source: 'mongo-token' };
    }
  }

  if (!keyHash) {
    return { entry: null, source: 'none' };
  }

  const keyEntry = await RankingResultCache.findOne({
    keyHash,
    expiresAt: { $gt: now },
  }).lean();

  return keyEntry ? { entry: keyEntry, source: 'mongo-base-key' } : { entry: null, source: 'none' };
}

async function writeRankingResultCache({
  baseCacheKey,
  query = '',
  unit = 'all',
  selectedCategories = [],
  selectedRetailers = [],
  selectedProgramRetailers = [],
  withoutProgram = false,
  candidateCount = 0,
  candidateLimit = 0,
  resultCount = 0,
  units = [],
  visibleOffers = [],
} = {}) {
  if (!baseCacheKey || !Array.isArray(visibleOffers) || visibleOffers.length === 0) {
    return '';
  }

  const offerIds = visibleOffers.map((offer) => offer?._id || offer?.id).filter(Boolean);

  if (offerIds.length === 0) {
    return '';
  }

  const resultSetToken = createResultSetToken();
  const now = new Date();
  const keyHash = hashRankingCacheKey(baseCacheKey);

  await RankingResultCache.updateOne(
    { keyHash },
    {
      $set: {
        keyHash,
        resultSetToken,
        normalizedKey: baseCacheKey,
        offerIds,
        filters: {
          query: String(query || '').trim().toLowerCase(),
          unit: String(unit || 'all').trim().toLowerCase(),
          categories: selectedCategories,
          retailers: selectedRetailers,
          programRetailers: selectedProgramRetailers,
          onlyWithoutProgram: Boolean(withoutProgram),
        },
        summaryBasis: {
          resultCount,
          candidateCount,
          candidateLimit,
          units,
        },
        expiresAt: new Date(now.getTime() + RANKING_RESULT_CACHE_TTL_MS),
      },
    },
    { upsert: true }
  );

  return resultSetToken;
}

async function buildRankingResponseFromStoredResultCache({
  cacheEntry,
  query = '',
  unit = 'all',
  selectedCategories = [],
  selectedRetailers = [],
  selectedProgramRetailers = [],
  withoutProgram = false,
  safeLimit = 30,
  safeOffset = 0,
  showAllMatching = false,
  debugTiming = false,
  cacheKeyHash = '',
  cacheSource = 'mongo-base-key',
} = {}) {
  const totalStartedAt = nowMs();
  const timings = { sliceMs: 0, hydrateMs: 0, responseBuildMs: 0, totalMs: 0 };
  const offerIds = Array.isArray(cacheEntry?.offerIds) ? cacheEntry.offerIds : [];
  const sliceStartedAt = nowMs();
  const pagination = paginateVisibleRankingOffers(offerIds, {
    limit: safeLimit || offerIds.length,
    offset: safeOffset,
    showAllMatching,
  });
  timings.sliceMs = nowMs() - sliceStartedAt;

  const hydrateStartedAt = nowMs();
  const retailerMatch = selectedRetailers.length > 0
    ? { isActive: true, retailerKey: { $in: selectedRetailers } }
    : { isActive: true };
  const [hydratedOffers, categoryDocuments, retailerOptions] = await Promise.all([
    Offer.find({ _id: { $in: pagination.offers } })
      .select(OFFER_RANKING_FIELDS)
      .lean(),
    Category.find({ isActive: true })
      .select('mainCategoryLabel offerCount subcategories')
      .lean(),
    Retailer.find(retailerMatch)
      .select('retailerKey retailerName activeOfferCount')
      .sort({ sortOrder: 1, retailerName: 1 })
      .lean(),
  ]);
  const hydratedById = new Map(hydratedOffers.map((offer) => [String(offer._id), offer]));
  const offers = pagination.offers
    .map((id) => hydratedById.get(String(id)))
    .filter(Boolean);
  timings.hydrateMs = nowMs() - hydrateStartedAt;

  const responseStartedAt = nowMs();
  const safelyComparableOffers = offers.filter(isOfferSafelyComparable);
  const bestUnitPrice = safelyComparableOffers[0]?.normalizedUnitPrice?.amount || null;
  const worstUnitPrice = safelyComparableOffers[safelyComparableOffers.length - 1]?.normalizedUnitPrice?.amount || null;
  const rankedOffers = offers.map((offer) => buildRankedOffer(offer, bestUnitPrice, worstUnitPrice));
  const summaryBasis = cacheEntry?.summaryBasis || {};
  const response = {
    generatedAt: new Date().toISOString(),
    filters: {
      categories: selectedCategories,
      query,
      unit,
      retailers: selectedRetailers,
      programRetailers: selectedProgramRetailers,
      onlyWithoutProgram: withoutProgram,
      limit: showAllMatching ? 'all' : safeLimit,
      offset: safeOffset,
    },
    categories: buildCategoryLabelsFromDocuments(categoryDocuments),
    retailers: retailerOptions.map((item) => ({
      key: item.retailerKey,
      retailerKey: item.retailerKey,
      retailerName: item.retailerName,
      offerCount: item.activeOfferCount || 0,
    })),
    units: Array.isArray(summaryBasis.units) ? summaryBasis.units : [],
    summary: {
      resultCount: summaryBasis.resultCount || 0,
      displayedCount: rankedOffers.length,
      requestedDisplay: showAllMatching ? 'all' : safeLimit,
      totalCount: pagination.totalCount,
      offset: pagination.offset,
      limit: pagination.limit,
      hasMore: pagination.hasMore,
      nextOffset: pagination.nextOffset,
      completeResultSetVisible:
        (summaryBasis.candidateCount || 0) < (summaryBasis.candidateLimit || 0) &&
        !pagination.hasMore &&
        pagination.offset === 0 &&
        rankedOffers.length === pagination.totalCount,
      candidateCount: summaryBasis.candidateCount || 0,
      candidateLimit: summaryBasis.candidateLimit || 0,
      resultSetToken: cacheEntry.resultSetToken || '',
      bestUnitPrice,
      worstUnitPrice,
      spreadPercent:
        bestUnitPrice && worstUnitPrice
          ? Number((((worstUnitPrice - bestUnitPrice) / bestUnitPrice) * 100).toFixed(2))
          : 0,
    },
    retailerDistribution: buildRetailerDistribution(rankedOffers),
    rankedGroups: buildGroupedRankings(rankedOffers, { query }),
    rankedOffers,
  };
  timings.responseBuildMs = nowMs() - responseStartedAt;
  timings.totalMs = nowMs() - totalStartedAt;

  if (debugTiming) {
    response.summary.debugTiming = buildCacheDebugTiming({
      cacheKeyHash,
      cacheHit: true,
      cacheSource,
      resultSetToken: cacheEntry.resultSetToken || '',
      safeLimit,
      safeOffset,
      query,
      selectedRetailers,
      selectedCategories,
      candidateCount: summaryBasis.candidateCount || 0,
      resultCount: summaryBasis.resultCount || 0,
      finalVisibleCount: pagination.totalCount,
      timings,
    });
  }

  return response;
}

async function findRankingCandidateOffers({
  selectedRetailers = [],
  selectedCategories = [],
  unit = 'all',
  onlyWithoutProgram = false,
  query = '',
  candidateLimit = RANKING_CANDIDATE_CAP,
  collectExecutionStats = false,
}) {
  const queryStartedAt = nowMs();
  const primaryMatch = buildRankingCandidateMatch({
    selectedRetailers,
    selectedCategories,
    unit,
    onlyWithoutProgram,
    query,
  });
  const queryMetadata = buildRankingCandidateQueryMetadata({ query });
  const dbQuery = buildRankingOfferQuery(primaryMatch, candidateLimit);

  if (query) {
    dbQuery.maxTimeMS(RANKING_QUERY_MAX_TIME_MS);
  }

  try {
    const primaryStartedAt = nowMs();
    const primaryOffers = await dbQuery;
    const primaryLoadMs = nowMs() - primaryStartedAt;
    const fallbackReason = shouldRunSeparatedRegexFallback({
      query,
      offers: primaryOffers,
      queryMetadata,
    });
    let offers = primaryOffers;
    let fallbackMatch = null;
    let fallbackQueryMetadata = null;

    if (fallbackReason) {
      fallbackMatch = buildRankingCandidateFallbackMatch({
        selectedRetailers,
        selectedCategories,
        unit,
        onlyWithoutProgram,
        query,
      });
      fallbackQueryMetadata = buildRankingCandidateFallbackMetadata(fallbackReason);
      const fallbackQuery = buildRankingOfferQuery(fallbackMatch, candidateLimit);
      fallbackQuery.maxTimeMS(RANKING_QUERY_MAX_TIME_MS);
      const fallbackStartedAt = nowMs();
      const fallbackOffers = await fallbackQuery;
      const fallbackLoadMs = nowMs() - fallbackStartedAt;
      offers = mergeCandidateOffers(primaryOffers, fallbackOffers).slice(0, candidateLimit);
      queryMetadata.candidateQueryMode = 'searchTokensThenFallback';
      queryMetadata.fallbackUsed = true;
      queryMetadata.fallbackReason = fallbackReason;
      fallbackQueryMetadata.loadMs = fallbackLoadMs;
      fallbackQueryMetadata.loadedDocumentCount = fallbackOffers.length;
    }

    if (!collectExecutionStats) {
      return offers;
    }

    const mongo = {
      match: primaryMatch,
      primaryMatch,
      fallbackMatch,
      sort: RANKING_SORT,
      limit: candidateLimit,
      fields: OFFER_RANKING_FIELDS.split(' '),
      queryMetadata,
      fallbackQueryMetadata,
      loadTimings: {
        totalFindMs: nowMs() - queryStartedAt,
        primaryFindMs: primaryLoadMs,
        fallbackFindMs: fallbackQueryMetadata?.loadMs || 0,
        primaryLoadedDocumentCount: primaryOffers.length,
        fallbackLoadedDocumentCount: fallbackQueryMetadata?.loadedDocumentCount || 0,
        loadedDocumentCount: offers.length,
        loadedDocumentBytes: Buffer.byteLength(JSON.stringify(offers), 'utf8'),
      },
      executionStats: null,
      primaryExecutionStats: null,
      fallbackExecutionStats: null,
    };

    return {
      offers,
      mongo,
    };
  } catch (error) {
    if (query && (error?.code === 50 || /maxTimeMS|time limit/i.test(String(error?.message || '')))) {
      return collectExecutionStats
        ? {
          offers: [],
          mongo: {
            match: primaryMatch,
            primaryMatch,
            fallbackMatch: null,
            sort: RANKING_SORT,
            limit: candidateLimit,
            fields: OFFER_RANKING_FIELDS.split(' '),
            queryMetadata,
            executionStats: null,
            primaryExecutionStats: null,
            fallbackExecutionStats: null,
            error: 'query-time-limit',
          },
        }
        : [];
    }

    throw error;
  }
}

async function explainRankingCandidateQuery({
  selectedRetailers = [],
  selectedCategories = [],
  unit = 'all',
  onlyWithoutProgram = false,
  query = '',
  candidateLimit = RANKING_CANDIDATE_CAP,
  useSearchTokens = true,
  matchOverride = null,
}) {
  const match = matchOverride || buildRankingCandidateMatch({
    selectedRetailers,
    selectedCategories,
    unit,
    onlyWithoutProgram,
    query,
    useSearchTokens,
  });
  const explainQuery = buildRankingOfferQuery(match, candidateLimit);

  if (query) {
    explainQuery.maxTimeMS(RANKING_QUERY_MAX_TIME_MS);
  }

  try {
    return {
      executionStats: await explainQuery.explain('executionStats'),
      error: null,
    };
  } catch (error) {
    return {
      executionStats: null,
      error: error?.code === 50 || /maxTimeMS|time limit/i.test(String(error?.message || ''))
        ? 'explain-time-limit'
        : 'explain-failed',
    };
  }
}

async function buildFallbackCandidateOffers({ selectedRetailers = [], selectedCategories = [] }) {
  const match = buildCurrentAvailabilityMatch();
  const selectedCategoryKeys = selectedCategories.map((category) => category.toLowerCase().replace(/[^a-z0-9]+/g, '-'));

  if (selectedRetailers.length > 0) {
    match.retailerKey = { $in: selectedRetailers };
  }

  if (selectedCategoryKeys.length > 0) {
    match.categoryKey = { $in: selectedCategoryKeys };
  }

  return Offer.find(match)
    .select(OFFER_RANKING_FIELDS)
    .sort({ sortScoreDefault: -1, 'normalizedUnitPrice.amount': 1, validTo: 1, retailerName: 1, title: 1 })
    .limit(2000)
    .lean();
}

function parseShoppingItems(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

async function buildBasketSuggestions({
  items = '',
  categories = '',
  retailers = '',
  programRetailers = '',
  onlyWithoutProgram = false,
}) {
  const shoppingItems = parseShoppingItems(items);
  const selectedCategories = normalizeStringList(categories);
  const selectedRetailers = normalizeStringList(retailers);
  const selectedProgramRetailers = normalizeProgramRetailers(programRetailers);
  const withoutProgram = normalizeBoolean(onlyWithoutProgram);

  if (shoppingItems.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      filters: {
        categories: selectedCategories,
        retailers: selectedRetailers,
        programRetailers: selectedProgramRetailers,
        onlyWithoutProgram: withoutProgram,
      },
      items: [],
      summary: {
        itemCount: 0,
        matchedItemCount: 0,
        totalCurrentAmount: 0,
        retailerCount: 0,
      },
      retailerMix: [],
    };
  }

  const results = [];
  const baseFilters = buildFilters({
    categories: selectedCategories,
    retailers: selectedRetailers,
    onlyWithoutProgram: withoutProgram,
    unit: 'all',
    query: '',
  });
  const baseOffers = await Offer.find(baseFilters)
    .sort({ 'normalizedUnitPrice.amount': 1, validTo: 1, retailerName: 1, title: 1 })
    .limit(500)
    .lean();
  const eligibleOffers = applyProgramEligibility(filterFreshActiveOffers(baseOffers), {
    programRetailers: selectedProgramRetailers,
    onlyWithoutProgram: withoutProgram,
  });

  for (const item of shoppingItems) {
    const matches = dedupeByQuery(applyQueryMatch(eligibleOffers, item)).slice(0, 12);

    results.push({
      query: item,
      matchCount: matches.length,
      bestOffer: matches[0] ? buildRankedOffer(matches[0], matches[0].normalizedUnitPrice.amount, matches[matches.length - 1]?.normalizedUnitPrice.amount || matches[0].normalizedUnitPrice.amount) : null,
      alternatives: matches.slice(0, 3).map((offer) =>
        buildRankedOffer(
          offer,
          matches[0]?.normalizedUnitPrice?.amount || offer.normalizedUnitPrice.amount,
          matches[matches.length - 1]?.normalizedUnitPrice?.amount || offer.normalizedUnitPrice.amount
        )
      ),
    });
  }

  const matchedOffers = results.map((item) => item.bestOffer).filter(Boolean);
  const retailerMap = new Map();

  for (const offer of matchedOffers) {
    if (!retailerMap.has(offer.retailerKey)) {
      retailerMap.set(offer.retailerKey, {
        retailerKey: offer.retailerKey,
        retailerName: offer.retailerName,
        itemCount: 0,
        totalCurrentAmount: 0,
      });
    }

    const current = retailerMap.get(offer.retailerKey);
    current.itemCount += 1;
    current.totalCurrentAmount = Number((current.totalCurrentAmount + (offer.priceCurrent?.amount || 0)).toFixed(2));
  }

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      categories: selectedCategories,
      retailers: selectedRetailers,
      programRetailers: selectedProgramRetailers,
      onlyWithoutProgram: withoutProgram,
    },
    items: results,
    summary: {
      itemCount: shoppingItems.length,
      matchedItemCount: matchedOffers.length,
      totalCurrentAmount: Number(
        matchedOffers.reduce((sum, offer) => sum + (offer.priceCurrent?.amount || 0), 0).toFixed(2)
      ),
      retailerCount: retailerMap.size,
    },
    retailerMix: [...retailerMap.values()].sort((left, right) => {
      if (right.itemCount !== left.itemCount) {
        return right.itemCount - left.itemCount;
      }

      return left.totalCurrentAmount - right.totalCurrentAmount;
    }),
  };
}

function buildRankingResponseFromBase({
  base,
  query = '',
  unit = 'all',
  selectedCategories = [],
  selectedRetailers = [],
  selectedProgramRetailers = [],
  withoutProgram = false,
  safeLimit = 30,
  safeOffset = 0,
  showAllMatching = false,
}) {
  const visibleOffers = Array.isArray(base?.visibleOffers) ? base.visibleOffers : [];
  const pagination = paginateVisibleRankingOffers(visibleOffers, {
    limit: safeLimit || visibleOffers.length,
    offset: safeOffset,
    showAllMatching,
  });
  const offers = pagination.offers;
  const safelyComparableOffers = offers.filter(isOfferSafelyComparable);
  const bestUnitPrice = safelyComparableOffers[0]?.normalizedUnitPrice?.amount || null;
  const worstUnitPrice = safelyComparableOffers[safelyComparableOffers.length - 1]?.normalizedUnitPrice?.amount || null;
  const rankedOffers = offers.map((offer) => buildRankedOffer(offer, bestUnitPrice, worstUnitPrice));
  const categoryDocuments = Array.isArray(base?.categoryDocuments) ? base.categoryDocuments : [];
  const retailerOptions = Array.isArray(base?.retailerOptions) ? base.retailerOptions : [];

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      categories: selectedCategories,
      query,
      unit,
      retailers: selectedRetailers,
      programRetailers: selectedProgramRetailers,
      onlyWithoutProgram: withoutProgram,
      limit: showAllMatching ? 'all' : safeLimit,
      offset: safeOffset,
    },
    categories: buildCategoryLabelsFromDocuments(categoryDocuments),
    retailers: retailerOptions.map((item) => ({
      key: item.retailerKey,
      retailerKey: item.retailerKey,
      retailerName: item.retailerName,
      offerCount: item.activeOfferCount || 0,
    })),
    units: Array.isArray(base?.units) ? base.units : [],
    summary: {
      resultCount: base?.resultCount || 0,
      displayedCount: rankedOffers.length,
      requestedDisplay: showAllMatching ? 'all' : safeLimit,
      totalCount: pagination.totalCount,
      offset: pagination.offset,
      limit: pagination.limit,
      hasMore: pagination.hasMore,
      nextOffset: pagination.nextOffset,
      completeResultSetVisible:
        (base?.candidateCount || 0) < (base?.candidateLimit || 0) &&
        !pagination.hasMore &&
        pagination.offset === 0 &&
        rankedOffers.length === pagination.totalCount,
      candidateCount: base?.candidateCount || 0,
      candidateLimit: base?.candidateLimit || 0,
      resultSetToken: base?.resultSetToken || '',
      bestUnitPrice,
      worstUnitPrice,
      spreadPercent:
        bestUnitPrice && worstUnitPrice
          ? Number((((worstUnitPrice - bestUnitPrice) / bestUnitPrice) * 100).toFixed(2))
          : 0,
    },
    retailerDistribution: buildRetailerDistribution(rankedOffers),
    rankedGroups: buildGroupedRankings(rankedOffers, { query }),
    rankedOffers,
  };
}

async function buildOfferRanking({
  categories = '',
  query = '',
  unit = 'all',
  retailers = '',
  programRetailers = '',
  onlyWithoutProgram = false,
  limit = 30,
  offset = 0,
  offsetExplicit = false,
  resultSetToken = '',
  debugTiming = false,
  diagnostics = false,
  debugCandidates = false,
}) {
  const totalStartedAt = nowMs();
  const timings = {
    categoryLoadMs: 0,
    cacheLookupMs: 0,
    retailerLoadMs: 0,
    candidateFindMs: 0,
    activeFilterMs: 0,
    programFilterMs: 0,
    unitFilterMs: 0,
    queryMatchMs: 0,
    dedupeMs: 0,
    scoreCacheMs: 0,
    sortMs: 0,
    responsePreparationMs: 0,
    finalDedupeMs: 0,
    visibleDedupeMs: 0,
    responseHydrationMs: 0,
    comparableFilterMs: 0,
    rankedOfferMappingMs: 0,
    responseAssemblyMs: 0,
    explainMs: 0,
    dbLoadMs: 0,
    rankingMs: 0,
    responseMappingMs: 0,
    mongoResultCacheMs: 0,
    cacheWriteMs: 0,
    totalMs: 0,
  };
  const limitValue = String(limit || '30').trim().toLowerCase();
  const showAllMatching = limitValue === 'all';
  const safeLimit = showAllMatching ? null : Math.max(1, Math.min(Number(limit) || 30, 500));
  const safeOffset = showAllMatching ? 0 : Math.max(0, Number(offset) || 0);
  const queryTokens = tokenizeSearchText(query);
  const hasQuery = queryTokens.length > 0;
  const selectedRetailers = normalizeRetailerList(retailers);
  const selectedProgramRetailers = normalizeProgramRetailers(programRetailers);
  const withoutProgram = normalizeBoolean(onlyWithoutProgram);
  const rawCategories = normalizeStringList(categories);
  const normalizedResultSetToken = String(resultSetToken || '').trim();
  const earlyBaseCacheKey = rawCategories.length === 0 ? buildRankingBaseCacheKey({
    categories: [],
    query,
    unit,
    retailers,
    programRetailers,
    onlyWithoutProgram,
  }) : '';
  const earlyCacheKey = rawCategories.length === 0 ? buildRankingCacheKey({
    categories: [],
    query,
    unit,
    retailers,
    programRetailers,
    onlyWithoutProgram,
    limit,
    offset: safeOffset,
    offsetExplicit,
  }) : '';
  const cacheLookupStartedAt = nowMs();
  const earlyCachedBase = !diagnostics && offsetExplicit && earlyBaseCacheKey
    ? getCachedRankingResultBase(earlyBaseCacheKey)
    : null;
  const earlyCachedResponse = !diagnostics && !debugTiming && earlyCacheKey ? getCachedRankingResponse(earlyCacheKey) : null;
  timings.cacheLookupMs += nowMs() - cacheLookupStartedAt;

  if (earlyCachedBase) {
    const response = buildRankingResponseFromBase({
      base: earlyCachedBase,
      query,
      unit,
      selectedCategories: [],
      selectedRetailers,
      selectedProgramRetailers,
      withoutProgram,
      safeLimit,
      safeOffset,
      showAllMatching,
    });
    if (debugTiming) {
      response.summary.debugTiming = buildCacheDebugTiming({
        cacheKeyHash: hashRankingCacheKey(earlyBaseCacheKey),
        cacheHit: true,
        cacheSource: 'memory-base',
        resultSetToken: earlyCachedBase.resultSetToken || '',
        safeLimit,
        safeOffset,
        query,
        selectedRetailers,
        selectedCategories: [],
        candidateCount: earlyCachedBase.candidateCount || 0,
        resultCount: earlyCachedBase.resultCount || 0,
        finalVisibleCount: Array.isArray(earlyCachedBase.visibleOffers) ? earlyCachedBase.visibleOffers.length : 0,
        timings: { totalMs: nowMs() - totalStartedAt },
      });
    }
    return response;
  }

  if (earlyCachedResponse) {
    return earlyCachedResponse;
  }

  if (!diagnostics && offsetExplicit && earlyBaseCacheKey) {
    const mongoCacheStartedAt = nowMs();
    const mongoCacheResult = await readRankingResultCache({
      baseCacheKey: earlyBaseCacheKey,
      resultSetToken: normalizedResultSetToken,
      expectedKeyHash: hashRankingCacheKey(earlyBaseCacheKey),
    });
    timings.mongoResultCacheMs += nowMs() - mongoCacheStartedAt;

    if (mongoCacheResult.entry) {
      return buildRankingResponseFromStoredResultCache({
        cacheEntry: mongoCacheResult.entry,
        query,
        unit,
        selectedCategories: [],
        selectedRetailers,
        selectedProgramRetailers,
        withoutProgram,
        safeLimit,
        safeOffset,
        showAllMatching,
        debugTiming,
        cacheKeyHash: hashRankingCacheKey(earlyBaseCacheKey),
        cacheSource: mongoCacheResult.source,
      });
    }
  }

  const categoryLoadStartedAt = nowMs();
  const categoryDocuments = await Category.find({ isActive: true })
    .select('mainCategoryLabel offerCount subcategories')
    .lean();
  timings.categoryLoadMs = nowMs() - categoryLoadStartedAt;
  timings.dbLoadMs += timings.categoryLoadMs;
  const selectedCategories = parseRankingCategories(categories, buildKnownCategoryLabelMap(categoryDocuments));
  const cacheKey = earlyCacheKey || buildRankingCacheKey({
    categories: selectedCategories,
    query,
    unit,
    retailers,
    programRetailers,
    onlyWithoutProgram,
    limit,
    offset: safeOffset,
    offsetExplicit,
  });
  const baseCacheKey = earlyBaseCacheKey || buildRankingBaseCacheKey({
    categories: selectedCategories,
    query,
    unit,
    retailers,
    programRetailers,
    onlyWithoutProgram,
  });
  const lateCacheLookupStartedAt = nowMs();
  const cachedBase = !diagnostics && offsetExplicit && !earlyBaseCacheKey
    ? getCachedRankingResultBase(baseCacheKey)
    : null;
  const cachedResponse = diagnostics || debugTiming || earlyCacheKey ? null : getCachedRankingResponse(cacheKey);
  timings.cacheLookupMs += nowMs() - lateCacheLookupStartedAt;

  if (cachedBase) {
    const response = buildRankingResponseFromBase({
      base: cachedBase,
      query,
      unit,
      selectedCategories,
      selectedRetailers,
      selectedProgramRetailers,
      withoutProgram,
      safeLimit,
      safeOffset,
      showAllMatching,
    });
    if (debugTiming) {
      response.summary.debugTiming = buildCacheDebugTiming({
        cacheKeyHash: hashRankingCacheKey(baseCacheKey),
        cacheHit: true,
        cacheSource: 'memory-base',
        resultSetToken: cachedBase.resultSetToken || '',
        safeLimit,
        safeOffset,
        query,
        selectedRetailers,
        selectedCategories,
        candidateCount: cachedBase.candidateCount || 0,
        resultCount: cachedBase.resultCount || 0,
        finalVisibleCount: Array.isArray(cachedBase.visibleOffers) ? cachedBase.visibleOffers.length : 0,
        timings: { totalMs: nowMs() - totalStartedAt },
      });
    }
    return response;
  }

  if (cachedResponse) {
    return cachedResponse;
  }

  if (!diagnostics && offsetExplicit) {
    const mongoCacheStartedAt = nowMs();
    const mongoCacheResult = await readRankingResultCache({
      baseCacheKey,
      resultSetToken: normalizedResultSetToken,
      expectedKeyHash: hashRankingCacheKey(baseCacheKey),
    });
    timings.mongoResultCacheMs += nowMs() - mongoCacheStartedAt;

    if (mongoCacheResult.entry) {
      return buildRankingResponseFromStoredResultCache({
        cacheEntry: mongoCacheResult.entry,
        query,
        unit,
        selectedCategories,
        selectedRetailers,
        selectedProgramRetailers,
        withoutProgram,
        safeLimit,
        safeOffset,
        showAllMatching,
        debugTiming,
        cacheKeyHash: hashRankingCacheKey(baseCacheKey),
        cacheSource: mongoCacheResult.source,
      });
    }
  }

  const retailerMatch = selectedRetailers.length > 0
    ? { isActive: true, retailerKey: { $in: selectedRetailers } }
    : { isActive: true };
  const candidateLimit = buildRankingCandidateLimit({
    safeLimit: showAllMatching || offsetExplicit ? RANKING_CANDIDATE_CAP : safeOffset + safeLimit,
    showAllMatching,
    hasQuery,
  });
  const dbLoadStartedAt = nowMs();
  const retailerLoadTiming = { ms: 0 };
  const [candidateResult, retailerOptions] = await Promise.all([
    findRankingCandidateOffers({
      selectedRetailers,
      selectedCategories,
      unit,
      onlyWithoutProgram: withoutProgram,
      query,
      candidateLimit,
      collectExecutionStats: diagnostics,
    }),
    (async () => {
      const retailerLoadStartedAt = nowMs();
      const rows = await Retailer.find(retailerMatch)
        .select('retailerKey retailerName activeOfferCount')
        .sort({ sortOrder: 1, retailerName: 1 })
        .lean();
      retailerLoadTiming.ms = nowMs() - retailerLoadStartedAt;
      return rows;
    })(),
  ]);
  timings.dbLoadMs += nowMs() - dbLoadStartedAt;
  const candidateOffers = diagnostics ? candidateResult.offers : candidateResult;
  const mongoDiagnostics = diagnostics ? candidateResult.mongo : null;
  timings.retailerLoadMs = retailerLoadTiming.ms;
  timings.candidateFindMs = diagnostics
    ? Number(mongoDiagnostics?.loadTimings?.totalFindMs || 0)
    : Math.max(0, timings.dbLoadMs - timings.categoryLoadMs - timings.retailerLoadMs);
  const debugStages = diagnostics && debugCandidates ? [] : null;

  if (debugStages) {
    debugStages.push(buildDebugRankingStage({
      stage: 'candidates-before-ranking',
      offers: candidateOffers,
      query,
    }));
  }

  const rankingStartedAt = nowMs();
  const activeFilterStartedAt = nowMs();
  const activeCandidateOffers = filterFreshActiveOffers(candidateOffers);
  timings.activeFilterMs = nowMs() - activeFilterStartedAt;
  const programFilterStartedAt = nowMs();
  const programEligibleOffers = applyProgramEligibility(
    activeCandidateOffers,
    {
      programRetailers: selectedProgramRetailers,
      onlyWithoutProgram: withoutProgram,
    }
  );
  timings.programFilterMs = nowMs() - programFilterStartedAt;
  const unitFilterStartedAt = nowMs();
  const unitFilteredOffers = applyUnitFilter(programEligibleOffers, unit);
  timings.unitFilterMs = nowMs() - unitFilterStartedAt;
  const queryMatchStartedAt = nowMs();
  const queryMatchedOffers = applyQueryMatch(unitFilteredOffers, query);
  timings.queryMatchMs = nowMs() - queryMatchStartedAt;
  const dedupeStartedAt = nowMs();
  const fullyFilteredOffers = dedupeOffers(queryMatchedOffers);
  timings.dedupeMs = nowMs() - dedupeStartedAt;

  if (debugStages) {
    const candidateIds = new Set(candidateOffers.map((offer) => String(offer?._id || offer?.id || '')).filter(Boolean));
    const activeIds = new Set(activeCandidateOffers.map((offer) => String(offer?._id || offer?.id || '')).filter(Boolean));
    const programIds = new Set(programEligibleOffers.map((offer) => String(offer?._id || offer?.id || '')).filter(Boolean));
    const unitIds = new Set(unitFilteredOffers.map((offer) => String(offer?._id || offer?.id || '')).filter(Boolean));
    const queryIds = new Set(queryMatchedOffers.map((offer) => String(offer?._id || offer?.id || '')).filter(Boolean));

    debugStages.push(buildDebugRankingStage({
      stage: 'after-active-filter',
      offers: activeCandidateOffers,
      query,
      previousIds: candidateIds,
      reason: 'inactive-or-not-active-now',
    }));
    debugStages.push(buildDebugRankingStage({
      stage: 'after-program-filter',
      offers: programEligibleOffers,
      query,
      previousIds: activeIds,
      reason: 'customer-program-filter',
    }));
    debugStages.push(buildDebugRankingStage({
      stage: 'after-unit-filter',
      offers: unitFilteredOffers,
      query,
      previousIds: programIds,
      reason: 'unit-filter',
    }));
    debugStages.push(buildDebugRankingStage({
      stage: 'after-query-ranking-filter',
      offers: queryMatchedOffers,
      query,
      previousIds: unitIds,
      reason: 'scoreOfferAgainstQuery-zero',
    }));
    debugStages.push(buildDebugRankingStage({
      stage: 'after-dedupe',
      offers: fullyFilteredOffers,
      query,
      previousIds: queryIds,
      reason: 'dedupeOffers',
    }));
  }
  const queryScores = hasQuery ? new WeakMap() : null;

  if (queryScores) {
    const scoreCacheStartedAt = nowMs();
    for (const offer of fullyFilteredOffers) {
      queryScores.set(offer, scoreOfferAgainstQuery(offer, query));
    }
    timings.scoreCacheMs = nowMs() - scoreCacheStartedAt;
  }

  const sortStartedAt = nowMs();
  const sortedOffers = fullyFilteredOffers
    .sort((left, right) => {
      if (queryScores) {
        const leftQueryScore = queryScores.get(left) || 0;
        const rightQueryScore = queryScores.get(right) || 0;

        if (rightQueryScore !== leftQueryScore) {
          return rightQueryScore - leftQueryScore;
        }
      }

      const leftConsumerScore = buildConsumerScore(left);
      const rightConsumerScore = buildConsumerScore(right);

      if (rightConsumerScore !== leftConsumerScore) {
        return rightConsumerScore - leftConsumerScore;
      }

      const priceComparison = compareSafeUnitPrice(left, right);

      if (priceComparison !== 0) {
        return priceComparison;
      }

      const leftSimple = Number(Boolean(left.customerProgramRequired || left.hasConditions || left.isMultiBuy));
      const rightSimple = Number(Boolean(right.customerProgramRequired || right.hasConditions || right.isMultiBuy));

      if (leftSimple !== rightSimple) {
        return leftSimple - rightSimple;
      }

      return String(left.title).localeCompare(String(right.title), 'de');
    });
  timings.sortMs = nowMs() - sortStartedAt;
  const responsePreparationStartedAt = nowMs();
  const responseCandidateOffers = prepareQueryOffersForResponse(sortedOffers, query);
  timings.responsePreparationMs = nowMs() - responsePreparationStartedAt;
  const finalDedupeStartedAt = nowMs();
  const finalResponseOffers = dedupeFinalResponseOffers(responseCandidateOffers, query);
  timings.finalDedupeMs = nowMs() - finalDedupeStartedAt;
  const visibleDedupeStartedAt = nowMs();
  const visibleDedupeResult = dedupeVisibleCardResponseOffers(finalResponseOffers, query, {
    collectDiagnostics: Boolean(debugStages),
  });
  timings.visibleDedupeMs = nowMs() - visibleDedupeStartedAt;
  const pagination = paginateVisibleRankingOffers(visibleDedupeResult.offers, {
    limit: safeLimit || visibleDedupeResult.offers.length,
    offset: safeOffset,
    showAllMatching,
  });
  const offers = pagination.offers;

  if (debugStages) {
    const sortedIds = new Set(sortedOffers.map((offer) => String(offer?._id || offer?.id || '')).filter(Boolean));
    const responseCandidateIds = new Set(responseCandidateOffers.map((offer) => String(offer?._id || offer?.id || '')).filter(Boolean));
    const finalIds = new Set(finalResponseOffers.map((offer) => String(offer?._id || offer?.id || '')).filter(Boolean));

    debugStages.push(buildDebugRankingStage({
      stage: 'after-response-preparation',
      offers: responseCandidateOffers,
      query,
      previousIds: sortedIds,
      reason: 'prepareQueryOffersForResponse',
    }));
    debugStages.push(buildDebugRankingStage({
      stage: 'after-final-dedupe',
      offers: finalResponseOffers,
      query,
      previousIds: responseCandidateIds,
      reason: 'final-dedupe',
    }));
    debugStages.push(buildDebugRankingStage({
      stage: 'final-api-like-results',
      offers,
      query,
      previousIds: finalIds,
      reason: 'visible-card-dedupe',
    }));
  }
  const comparableFilterStartedAt = nowMs();
  const safelyComparableOffers = offers.filter(isOfferSafelyComparable);
  timings.comparableFilterMs = nowMs() - comparableFilterStartedAt;
  timings.rankingMs = nowMs() - rankingStartedAt;

  const responseMappingStartedAt = nowMs();
  const bestUnitPrice = safelyComparableOffers[0]?.normalizedUnitPrice?.amount || null;
  const worstUnitPrice = safelyComparableOffers[safelyComparableOffers.length - 1]?.normalizedUnitPrice?.amount || null;
  const rankedOfferMappingStartedAt = nowMs();
  const rankedOffers = offers.map((offer) => buildRankedOffer(offer, bestUnitPrice, worstUnitPrice));
  timings.rankedOfferMappingMs = nowMs() - rankedOfferMappingStartedAt;

  const responseAssemblyStartedAt = nowMs();
  const response = {
    generatedAt: new Date().toISOString(),
    filters: {
      categories: selectedCategories,
      query,
      unit,
      retailers: selectedRetailers,
      programRetailers: selectedProgramRetailers,
      onlyWithoutProgram: withoutProgram,
      limit: showAllMatching ? 'all' : safeLimit,
      offset: safeOffset,
    },
    categories: buildCategoryLabelsFromDocuments(categoryDocuments),
    retailers: retailerOptions.map((item) => ({
      key: item.retailerKey,
      retailerKey: item.retailerKey,
      retailerName: item.retailerName,
      offerCount: item.activeOfferCount || 0,
    })),
    units: [...new Set(candidateOffers.map((offer) => offer?.normalizedUnitPrice?.unit).filter(Boolean))].sort(),
    summary: {
      resultCount: fullyFilteredOffers.length,
      displayedCount: rankedOffers.length,
      requestedDisplay: showAllMatching ? 'all' : safeLimit,
      totalCount: pagination.totalCount,
      offset: pagination.offset,
      limit: pagination.limit,
      hasMore: pagination.hasMore,
      nextOffset: pagination.nextOffset,
      completeResultSetVisible:
        candidateOffers.length < candidateLimit &&
        !pagination.hasMore &&
        pagination.offset === 0 &&
        rankedOffers.length === pagination.totalCount,
      candidateCount: candidateOffers.length,
      candidateLimit,
      bestUnitPrice,
      worstUnitPrice,
      spreadPercent:
        bestUnitPrice && worstUnitPrice
          ? Number((((worstUnitPrice - bestUnitPrice) / bestUnitPrice) * 100).toFixed(2))
          : 0,
    },
    retailerDistribution: buildRetailerDistribution(rankedOffers),
    rankedGroups: buildGroupedRankings(rankedOffers, { query }),
    rankedOffers,
  };
  timings.responseAssemblyMs = nowMs() - responseAssemblyStartedAt;
  timings.responseMappingMs = nowMs() - responseMappingStartedAt;
  timings.totalMs = nowMs() - totalStartedAt;

  if (diagnostics) {
    const explainStartedAt = nowMs();
    const primaryExplainResult = await explainRankingCandidateQuery({
      selectedRetailers,
      selectedCategories,
      unit,
      onlyWithoutProgram: withoutProgram,
      query,
      candidateLimit,
      matchOverride: mongoDiagnostics.primaryMatch || mongoDiagnostics.match,
    });
    mongoDiagnostics.primaryExecutionStats = primaryExplainResult.executionStats;
    mongoDiagnostics.executionStats = primaryExplainResult.executionStats;
    if (primaryExplainResult.error) {
      mongoDiagnostics.error = primaryExplainResult.error;
    }

    if (mongoDiagnostics.fallbackMatch) {
      const fallbackExplainResult = await explainRankingCandidateQuery({
        selectedRetailers,
        selectedCategories,
        unit,
        onlyWithoutProgram: withoutProgram,
        query,
        candidateLimit,
        useSearchTokens: false,
        matchOverride: mongoDiagnostics.fallbackMatch,
      });
      mongoDiagnostics.fallbackExecutionStats = fallbackExplainResult.executionStats;
      if (fallbackExplainResult.error) {
        mongoDiagnostics.fallbackError = fallbackExplainResult.error;
      }
    }
    timings.explainMs = nowMs() - explainStartedAt;

    return {
      response,
      diagnostics: {
        timings: Object.fromEntries(
          Object.entries(timings).map(([key, value]) => [key, Number(value.toFixed(1))])
        ),
        mongo: mongoDiagnostics,
        ...(debugStages ? {
          candidates: {
            stages: debugStages,
            visibleDedupe: visibleDedupeResult.diagnostics,
          },
        } : {}),
      },
    };
  }

  if (offsetExplicit) {
    let persistedResultSetToken = '';
    const cacheWriteStartedAt = nowMs();
    try {
      persistedResultSetToken = await writeRankingResultCache({
        baseCacheKey,
        query,
        unit,
        selectedCategories,
        selectedRetailers,
        selectedProgramRetailers,
        withoutProgram,
        candidateCount: candidateOffers.length,
        candidateLimit,
        resultCount: fullyFilteredOffers.length,
        units: response.units,
        visibleOffers: visibleDedupeResult.offers,
      });
    } catch (error) {
      persistedResultSetToken = '';
      if (process.env.RANKING_TIMING_LOGS === 'true') {
        console.warn('[ranking-result-cache] write failed', {
          cacheKeyHash: hashRankingCacheKey(baseCacheKey),
          error: error?.message || 'unknown',
        });
      }
    } finally {
      timings.cacheWriteMs = nowMs() - cacheWriteStartedAt;
    }
    response.summary.resultSetToken = persistedResultSetToken;
    setCachedRankingResultBase(baseCacheKey, {
      categoryDocuments,
      retailerOptions,
      units: [...new Set(candidateOffers.map((offer) => offer?.normalizedUnitPrice?.unit).filter(Boolean))].sort(),
      candidateCount: candidateOffers.length,
      candidateLimit,
      resultCount: fullyFilteredOffers.length,
      resultSetToken: persistedResultSetToken,
      visibleOffers: visibleDedupeResult.offers,
    });
  }

  timings.totalMs = nowMs() - totalStartedAt;
  if (debugTiming) {
    response.summary.debugTiming = buildCacheDebugTiming({
      cacheKeyHash: hashRankingCacheKey(baseCacheKey),
      cacheHit: false,
      cacheSource: 'computed',
      resultSetToken: response.summary.resultSetToken || '',
      safeLimit,
      safeOffset,
      query,
      selectedRetailers,
      selectedCategories,
      candidateCount: candidateOffers.length,
      resultCount: fullyFilteredOffers.length,
      finalVisibleCount: visibleDedupeResult.offers.length,
      timings,
    });
  }

  if (!debugTiming) {
    setCachedRankingResponse(cacheKey, response);
  }
  return response;
}

module.exports = {
  buildOfferRanking,
  buildBasketSuggestions,
  buildRankedOffer,
  clearRankingResponseCache,
  getRankingResponseCacheSize,
  scoreOfferAgainstQuery,
  applyQueryMatch,
  filterFreshActiveOffers,
  buildValidityLabel,
  buildGroupedRankings,
  dedupeQueryOffers,
  dedupeResponseOffers,
  dedupeFinalResponseOffers,
  dedupeVisibleCardResponseOffers,
  hasSameVisibleResponseFingerprint,
  hasSameVisibleCardFingerprint,
  reduceAdjacentQueryDuplicates,
  prepareQueryOffersForResponse,
  parseRankingCategories,
  buildKnownCategoryLabelMap,
  buildRankingBaseCacheKey,
  hashRankingCacheKey,
  createResultSetToken,
  buildRankingCandidateLimit,
  buildRankingCandidateMatch,
  buildRankingCandidateFallbackMatch,
  buildRankingCandidateQueryMetadata,
  paginateVisibleRankingOffers,
  buildRankingResponseFromStoredResultCache,
  buildRankingResponseFromBase,
  getRankingCacheCapabilities,
  normalizeSearchText,
  normalizeRetailerKey,
  normalizeRetailerList,
  tokenizeSearchText,
};
