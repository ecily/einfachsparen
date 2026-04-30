const Offer = require('../../models/Offer');
const Category = require('../../models/Category');
const Retailer = require('../../models/Retailer');
const RetailerCategoryOfferCache = require('../../models/RetailerCategoryOfferCache');
const { computeOfferSavings } = require('./promotionMath');

const OFFER_RANKING_FIELDS = [
  '_id',
  'retailerKey',
  'retailerName',
  'sourceRetailerName',
  'sourceRetailerFormat',
  'retailerFormats',
  'appliesToRetailerFormats',
  'retailerFormatLabel',
  'title',
  'titleNormalized',
  'brand',
  'searchText',
  'categoryKey',
  'categoryPrimary',
  'categorySecondary',
  'subcategoryKey',
  'categoryConfidence',
  'subcategoryConfidence',
  'benefitType',
  'conditionsText',
  'customerProgramRequired',
  'hasConditions',
  'isMultiBuy',
  'effectiveDiscountType',
  'comparisonGroup',
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
  'rawFacts',
  'supportingSources',
  'sourceType',
  'sourceUrls',
  'evidenceUrls',
  'sourceTypes',
  'needsReview',
  'reviewReasons',
].join(' ');

const RANKING_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const rankingResponseCache = new Map();

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function normalizeProgramRetailers(value) {
  return normalizeStringList(value);
}

function buildRankingCacheKey({
  categories = '',
  query = '',
  unit = 'all',
  retailers = '',
  programRetailers = '',
  onlyWithoutProgram = false,
  limit = 30,
}) {
  return JSON.stringify({
    categories: normalizeStringList(categories).sort(),
    query: String(query || '').trim().toLowerCase(),
    unit: String(unit || 'all').trim().toLowerCase(),
    retailers: normalizeStringList(retailers).sort(),
    programRetailers: normalizeProgramRetailers(programRetailers).sort(),
    onlyWithoutProgram: normalizeBoolean(onlyWithoutProgram),
    limit: String(limit || '30').trim().toLowerCase(),
  });
}

function getCachedRankingResponse(cacheKey) {
  const entry = rankingResponseCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (Date.now() - entry.createdAt > RANKING_CACHE_TTL_MS) {
    rankingResponseCache.delete(cacheKey);
    return null;
  }

  return entry.value;
}

function setCachedRankingResponse(cacheKey, value) {
  rankingResponseCache.set(cacheKey, {
    createdAt: Date.now(),
    value,
  });
}

function clearRankingResponseCache() {
  rankingResponseCache.clear();
}

function buildCurrentAvailabilityMatch() {
  return {
    status: 'active',
    isActiveNow: true,
  };
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
  return String(value || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
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
    tokens: ['butter'],
    preferred: ['butter', 'milchprodukte', 'molkerei', 'milch', 'backen', 'lebensmittel'],
    strongPreferred: ['butter', 'milchprodukte', 'molkerei'],
    productIntent: ['butter', 'teebutter'],
    exactProductIntent: ['teebutter'],
    productContext: ['milchprodukte', 'molkerei'],
    severeWeakContexts: ['lippenbalsam', 'kosmetik', 'make'],
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
    preferred: ['kaffee', 'tee', 'getraenke', 'getranke', 'fruehstueck', 'fruhstuck', 'eiskaffee', 'caffe'],
    strongPreferred: ['kaffee', 'tee', 'eiskaffee', 'caffe'],
    weakContexts: ['pflanze', 'zierpflanze', 'duftgeranie', 'tomate', 'erdbeere', 'banane'],
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
];

function getQueryContext(queryTokens) {
  return QUERY_CONTEXTS.find((context) => context.tokens.some((token) => queryTokens.includes(token))) || null;
}

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
  const productIntentMatched = context
    ? hasAnyTokenMatch(titleTokens.concat(comparisonTokens), context.productIntent, {
        exact: true,
        suffix: true,
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

      if (left.offer.normalizedUnitPrice.amount !== right.offer.normalizedUnitPrice.amount) {
        return left.offer.normalizedUnitPrice.amount - right.offer.normalizedUnitPrice.amount;
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
  const fallbackSavings =
    offer?.savingsAmount !== undefined && offer?.savingsAmount !== null
      ? null
      : computeOfferSavings(offer);
  const savings = {
    savingsAmount:
      offer?.savingsAmount !== undefined && offer?.savingsAmount !== null
        ? offer.savingsAmount
        : fallbackSavings?.savingsAmount,
    savingsPercent:
      offer?.savingsPercent !== undefined && offer?.savingsPercent !== null
        ? offer.savingsPercent
        : fallbackSavings?.savingsPercent,
    requiredQuantity:
      offer?.minimumPurchaseQuantity !== undefined && offer?.minimumPurchaseQuantity !== null
        ? offer.minimumPurchaseQuantity
        : fallbackSavings?.requiredQuantity,
  };
  const normalizedAmount = Number(offer?.normalizedUnitPrice?.amount ?? 0);
  const priceGapPercent = bestUnitPrice
    ? Number((((normalizedAmount - bestUnitPrice) / bestUnitPrice) * 100).toFixed(2))
    : 0;
  const spread = worstUnitPrice && bestUnitPrice && worstUnitPrice !== bestUnitPrice
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
    imageUrl: offer.imageUrl || '',
    sourceType: offer.sourceType || '',
    sourceTypes: offer.sourceTypes || [],
    evidenceUrls: offer.evidenceUrls || [],
    needsReview: Boolean(offer.needsReview),
    reviewReasons: offer.reviewReasons || [],
    priceGapPercent,
    relativeScore: Number((spread * 100).toFixed(2)),
    savingsAmount: savings.savingsAmount,
    savingsPercent: savings.savingsPercent,
    minimumPurchaseQuantity: savings.requiredQuantity,
    minimumPurchaseQty: offer.minimumPurchaseQty ?? savings.requiredQuantity ?? 1,
    quality: offer.quality || {},
    sortScoreDefault: Number(offer.sortScoreDefault || 0),
    validityLabel: offer.validTo ? 'gueltig bis' : 'aktuell verfuegbar, Enddatum nicht erkannt',
  };
}

function buildConsumerScore(offer) {
  let score = Number(offer?.sortScoreDefault || 0);

  if (offer?.status === 'active' && offer?.isActiveNow) score += 1000;
  if (offer?.quality?.comparisonSafe && offer?.comparisonGroup) score += 500;

  const unitAmount = Number(offer?.normalizedUnitPrice?.amount);
  if (Number.isFinite(unitAmount) && unitAmount > 0) {
    score += Math.max(0, 200 - Math.min(200, Math.round(unitAmount * 10)));
  }

  if (!offer?.isMultiBuy && (offer?.minimumPurchaseQuantity || 1) <= 1) score += 100;
  if (!offer?.customerProgramRequired) score += 80;
  if (!offer?.hasConditions) score += 60;

  return score;
}

function buildRetailerDistribution(offers) {
  const grouped = new Map();

  for (const offer of offers) {
    if (!grouped.has(offer.retailerKey)) {
      grouped.set(offer.retailerKey, {
        retailerKey: offer.retailerKey,
        retailerName: offer.retailerName,
        offerCount: 0,
        bestUnitPrice: Number(offer?.normalizedUnitPrice?.amount ?? Number.MAX_SAFE_INTEGER),
      });
    }

    const current = grouped.get(offer.retailerKey);
    current.offerCount += 1;
    current.bestUnitPrice = Math.min(
      current.bestUnitPrice,
      Number(offer?.normalizedUnitPrice?.amount ?? Number.MAX_SAFE_INTEGER)
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
  const seen = new Set();
  const unique = [];

  for (const offer of offers) {
    const dedupeKey = offer.dedupeKey || offer.offerKey || [
      offer.retailerKey,
      offer.categoryKey,
      offer.titleNormalized || offer.title,
      offer.comparisonGroup,
      offer.normalizedUnitPrice?.amount,
      offer.validTo?.toISOString?.() || offer.validTo,
    ].join('::');

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    unique.push(offer);
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

function getOfferTitleKey(offer) {
  return normalizeSearchText(offer?.titleNormalized || offer?.title);
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
      titleKey,
      getOfferPriceKey(offer),
      getOfferQuantityKey(offer),
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

function choosePreferredQueryDuplicate(left, right, query) {
  const rankingComparison = compareOffersByRanking(left, right, { query });

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
  return reduceAdjacentQueryDuplicates(dedupeQueryOffers(offers, query), query);
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

  if (left.normalizedUnitPrice.amount !== right.normalizedUnitPrice.amount) {
    return left.normalizedUnitPrice.amount - right.normalizedUnitPrice.amount;
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
  const eligibleOffers = applyProgramEligibility(baseOffers, {
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

async function buildOfferRanking({
  categories = '',
  query = '',
  unit = 'all',
  retailers = '',
  programRetailers = '',
  onlyWithoutProgram = false,
  limit = 30,
}) {
  const limitValue = String(limit || '30').trim().toLowerCase();
  const showAllMatching = limitValue === 'all';
  const safeLimit = showAllMatching ? null : Math.max(5, Math.min(Number(limit) || 30, 500));
  const selectedCategories = normalizeStringList(categories);
  const selectedRetailers = normalizeStringList(retailers);
  const selectedProgramRetailers = normalizeProgramRetailers(programRetailers);
  const withoutProgram = normalizeBoolean(onlyWithoutProgram);
  const cacheKey = buildRankingCacheKey({
    categories,
    query,
    unit,
    retailers,
    programRetailers,
    onlyWithoutProgram,
    limit,
  });
  const cachedResponse = getCachedRankingResponse(cacheKey);

  if (cachedResponse) {
    return cachedResponse;
  }

  const retailerMatch = selectedRetailers.length > 0
    ? { isActive: true, retailerKey: { $in: selectedRetailers } }
    : { isActive: true };
  const cacheMatch = buildCacheMatch({
    selectedRetailers,
    selectedCategories,
  });
  const [offerCacheDocuments, categoryDocuments, retailerOptions] = await Promise.all([
    RetailerCategoryOfferCache.find(cacheMatch)
      .select('offers')
      .lean(),
    Category.find({ isActive: true })
      .select('mainCategoryLabel offerCount subcategories')
      .lean(),
    Retailer.find(retailerMatch)
      .select('retailerKey retailerName activeOfferCount')
      .sort({ sortOrder: 1, retailerName: 1 })
      .lean(),
  ]);

  const selectedCategoryKeys = new Set(
    selectedCategories.map((category) => category.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
  );
  let candidateOffers = offerCacheDocuments
    .flatMap((document) => document.offers || [])
    .filter((offer) => selectedCategoryKeys.size === 0 || selectedCategoryKeys.has(String(offer.categoryKey || '')));

  if (candidateOffers.length === 0) {
    candidateOffers = await buildFallbackCandidateOffers({
      selectedRetailers,
      selectedCategories,
    });
  }

  const fullyFilteredOffers = dedupeOffers(
    applyQueryMatch(
      applyUnitFilter(
        applyProgramEligibility(
          candidateOffers.filter((offer) => offer?.status === 'active' && offer?.isActiveNow),
          {
            programRetailers: selectedProgramRetailers,
            onlyWithoutProgram: withoutProgram,
          }
        ),
        unit
      ),
      query
    )
  );
  const queryTokens = tokenizeSearchText(query);
  const queryScores = queryTokens.length > 0 ? new WeakMap() : null;

  if (queryScores) {
    for (const offer of fullyFilteredOffers) {
      queryScores.set(offer, scoreOfferAgainstQuery(offer, query));
    }
  }

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

      if (left.normalizedUnitPrice.amount !== right.normalizedUnitPrice.amount) {
        return left.normalizedUnitPrice.amount - right.normalizedUnitPrice.amount;
      }

      const leftSimple = Number(Boolean(left.customerProgramRequired || left.hasConditions || left.isMultiBuy));
      const rightSimple = Number(Boolean(right.customerProgramRequired || right.hasConditions || right.isMultiBuy));

      if (leftSimple !== rightSimple) {
        return leftSimple - rightSimple;
      }

      return String(left.title).localeCompare(String(right.title), 'de');
    });
  const responseCandidateOffers = prepareQueryOffersForResponse(sortedOffers, query);
  const offers = responseCandidateOffers
    .slice(0, showAllMatching ? fullyFilteredOffers.length : safeLimit);

  const bestUnitPrice = offers[0]?.normalizedUnitPrice?.amount || null;
  const worstUnitPrice = offers[offers.length - 1]?.normalizedUnitPrice?.amount || null;
  const rankedOffers = offers.map((offer) => buildRankedOffer(offer, bestUnitPrice, worstUnitPrice));

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
      completeResultSetVisible: rankedOffers.length === fullyFilteredOffers.length,
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

  setCachedRankingResponse(cacheKey, response);
  return response;
}

module.exports = {
  buildOfferRanking,
  buildBasketSuggestions,
  clearRankingResponseCache,
  scoreOfferAgainstQuery,
  applyQueryMatch,
  buildGroupedRankings,
  dedupeQueryOffers,
  reduceAdjacentQueryDuplicates,
  prepareQueryOffersForResponse,
  normalizeSearchText,
  tokenizeSearchText,
};
