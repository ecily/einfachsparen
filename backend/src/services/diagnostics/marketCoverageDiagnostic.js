const { RETAILER_DEFINITIONS } = require('../sources/sourceDefinitions');
const { CATEGORY_TAXONOMY } = require('../crawl/categoryClassifier');
const {
  dedupeFinalResponseOffers,
  normalizeSearchText,
} = require('../offers/offerRankingService');

const RETAILER_SPECS = [
  { key: 'spar', label: 'SPAR', retailerKeys: ['spar'], formats: ['spar'], sparGroup: true },
  { key: 'interspar', label: 'INTERSPAR', retailerKeys: ['spar'], formats: ['interspar'], sparGroup: true },
  { key: 'eurospar', label: 'EUROSPAR', retailerKeys: ['spar'], formats: ['eurospar'], sparGroup: true },
  { key: 'spar-aggregate', label: 'SPAR gesamt', retailerKeys: ['spar'], formats: ['spar', 'interspar', 'eurospar', ''], aggregate: true },
  { key: 'billa', label: 'BILLA', retailerKeys: ['billa'] },
  { key: 'billa-plus', label: 'BILLA PLUS', retailerKeys: ['billa-plus'] },
  { key: 'penny', label: 'PENNY', retailerKeys: ['penny'] },
  { key: 'hofer', label: 'HOFER', retailerKeys: ['hofer'] },
  { key: 'lidl', label: 'LIDL', retailerKeys: ['lidl'] },
  { key: 'dm', label: 'dm', retailerKeys: ['dm'] },
  { key: 'bipa', label: 'BIPA', retailerKeys: ['bipa'] },
  { key: 'adeg', label: 'ADEG', retailerKeys: ['adeg'], optional: true },
];

const SMOKE_KEYWORDS = [
  'kaffee',
  'milch',
  'butter',
  'joghurt',
  'kaese',
  'wurst',
  'huhn',
  'reis',
  'nudeln',
  'waschmittel',
  'zahnpasta',
  'shampoo',
  'windeln',
  'bier',
  'schokolade',
  'obst',
  'gemuese',
  'tiefkuehl',
  'tiernahrung',
];

const ACTION_CAUSES = [
  'source_missing',
  'source_disabled',
  'source_low_yield',
  'parser_weak',
  'category_mapping_weak',
  'retailer_mapping_weak',
  'ranking_visibility_issue',
  'dedupe_suspected',
  'validity_weak',
  'quantity_unit_weak',
  'condition_weak',
];

const STATUS_RULES = {
  critical: [
    'activeOfferCount < 2 and no active official or structured source',
    'totalOfferCount === 0 and source is missing or disabled',
    'rankedOffersCount === 0 while activeOfferCount > 0',
  ],
  weak: [
    'activeOfferCount < 5',
    'validity, quantity/unit, price, or source quality ratio below threshold',
    'category smoke indicates likely category mismatch',
  ],
  ok: [
    'activeOfferCount >= 5',
    'rankedOffersCount > 0',
    'price and validity coverage are usable',
    'at least one active official/structured or mixed source is present',
  ],
  unknown: [
    'no usable source context and no offers',
    'combination cannot be judged from the loaded data',
  ],
};

const QUALITY_THRESHOLDS = {
  minOkActiveOffers: 5,
  minWeakActiveOffers: 2,
  minOkValidityRatio: 0.7,
  minOkPriceRatio: 0.8,
  minOkQuantityRatio: 0.5,
  minOkVisibilityRatio: 0.5,
};

const HOFER_CATEGORY_AREAS = [
  { key: 'lebensmittel', label: 'Lebensmittel', terms: ['bio', 'genuss', 'brot', 'mehl', 'zucker', 'ei', 'eier'] },
  { key: 'obst-gemuese', label: 'Obst/Gemuese', terms: ['obst', 'gemuese', 'gemuse', 'tomate', 'paradeiser', 'gurke', 'paprika', 'apfel', 'banane', 'kartoffel'] },
  { key: 'fleisch-wurst-fisch', label: 'Fleisch/Wurst/Fisch', terms: ['fleisch', 'wurst', 'fisch', 'hendl', 'huhn', 'faschiert', 'grillfleisch', 'schnitzel'] },
  { key: 'milch-kaese', label: 'Milchprodukte/Kaese', terms: ['milch', 'joghurt', 'butter', 'kaese', 'kase', 'topfen', 'milfina'] },
  { key: 'tiefkuehl-fertigprodukte', label: 'Tiefkuehl/Fertigprodukte', terms: ['tiefkuehl', 'tiefkuhl', 'pizza', 'eis', 'grandessa', 'fertiggericht'] },
  { key: 'getraenke', label: 'Getraenke', terms: ['wasser', 'saft', 'sirup', 'bier', 'wein', 'kaffee', 'tee'] },
  { key: 'haushalt-reinigung', label: 'Haushalt/Reinigung', terms: ['tandil', 'alio', 'waschmittel', 'reiniger', 'geschirrspuel', 'geschirrspul'] },
  { key: 'drogerie-hygiene', label: 'Drogerie/Hygiene', terms: ['ombia', 'shampoo', 'duschgel', 'creme', 'deo', 'zahnpasta'] },
  { key: 'tierbedarf', label: 'Tierbedarf', terms: ['romeo', 'hundefutter', 'katzenfutter', 'hund', 'katze'] },
  { key: 'baby-kinder', label: 'Baby/Kinder', terms: ['mamia', 'windeln', 'feuchttuecher', 'feuchttucher', 'baby'] },
  { key: 'aktionsware-non-food', label: 'Aktionsware/Non-Food', terms: ['gardenline', 'workzone', 'ferrex', 'crane', 'easy home', 'werkzeug', 'pflanze', 'garten'] },
];

const HOFER_CATEGORY_BRANDS = [
  'milfina',
  'zurueck zum ursprung',
  'zuruck zum ursprung',
  'gutes vom bauernhof',
  'fairhof',
  'bbq',
  'cucina nobile',
  'asia green garden',
  'grandessa',
  'choceur',
  'tandil',
  'alio',
  'ombia',
  'mamia',
  'romeo',
  'cachet',
  'gardenline',
  'workzone',
  'ferrex',
  'crane',
  'easy home',
];

function normalizeKey(value) {
  return normalizeSearchText(value).replace(/\s+/g, '-');
}

function pct(part, total) {
  return total > 0 ? Number((part / total).toFixed(3)) : 0;
}

function dateIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateKey(value) {
  const iso = dateIso(value);
  return iso ? iso.slice(0, 10) : '';
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function countBy(items = [], resolveKey) {
  const counts = new Map();

  for (const item of items) {
    const key = String(resolveKey(item) || 'unknown').trim() || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'de'))
    .map(([key, count]) => ({ key, count }));
}

function topItems(items = [], resolveKey, limit = 20) {
  return countBy(items, resolveKey).slice(0, limit);
}

function hasDate(value) {
  return Boolean(dateIso(value));
}

function hasPrice(offer = {}) {
  return Number.isFinite(Number(offer.priceCurrent?.amount));
}

function hasUnitOrQuantity(offer = {}) {
  return Boolean(
    String(offer.quantityText || '').trim()
    || (Number.isFinite(Number(offer.unitValue)) && String(offer.unitType || '').trim())
    || (Number.isFinite(Number(offer.totalComparableAmount)) && String(offer.comparableUnit || '').trim())
    || (Number.isFinite(Number(offer.normalizedUnitPrice?.amount)) && String(offer.normalizedUnitPrice?.unit || '').trim())
  );
}

function hasConditions(offer = {}) {
  return Boolean(
    String(offer.conditionsText || '').trim()
    || offer.hasConditions
    || offer.customerProgramRequired
    || offer.isMultiBuy
    || Number(offer.minimumPurchaseQty || 1) > 1
    || !['', 'unknown', undefined, null].includes(offer.effectiveDiscountType)
  );
}

function hasImage(offer = {}) {
  return Boolean(String(offer.imageUrl || '').trim());
}

function isComparisonSafe(offer = {}) {
  return Boolean(
    offer.quality?.comparisonSafe
    || offer.normalizedUnitPrice?.comparable
    || (Number.isFinite(Number(offer.normalizedUnitPrice?.amount)) && String(offer.normalizedUnitPrice?.unit || '').trim())
  );
}

function isActiveOffer(offer = {}, now = new Date()) {
  if (offer.isActiveNow === true || offer.isActiveToday === true) return true;
  if (offer.status !== 'active') return false;
  if (!offer.validTo) return true;
  const validTo = new Date(offer.validTo);
  return !Number.isNaN(validTo.getTime()) && validTo >= now;
}

function getOfferFormats(offer = {}) {
  return unique([
    offer.sourceRetailerFormat,
    offer.retailerFormatLabel,
    ...(Array.isArray(offer.retailerFormats) ? offer.retailerFormats : []),
    ...(Array.isArray(offer.appliesToRetailerFormats) ? offer.appliesToRetailerFormats : []),
  ]).map(normalizeKey);
}

function offerMatchesRetailer(offer = {}, spec = {}) {
  if (!spec.retailerKeys.includes(String(offer.retailerKey || '').trim())) {
    return false;
  }

  if (!spec.formats) {
    return true;
  }

  const offerFormats = getOfferFormats(offer);
  if (spec.aggregate) {
    return offerFormats.length === 0 || spec.formats.some((format) => offerFormats.includes(format));
  }

  return spec.formats.some((format) => offerFormats.includes(format));
}

function categoryAliases(category = {}) {
  return unique([
    category.key,
    category.label,
    category.mainCategoryKey,
    category.mainCategoryLabel,
  ]);
}

function offerCategoryKeys(offer = {}) {
  return unique([
    offer.categoryKey,
    offer.subcategoryKey,
    offer.categoryPrimary,
    offer.categorySecondary,
  ]).map(normalizeKey);
}

function offerMatchesCategory(offer = {}, category = {}) {
  const expected = new Set(categoryAliases(category).map(normalizeKey));
  return offerCategoryKeys(offer).some((key) => expected.has(key));
}

function offerText(offer = {}) {
  return normalizeSearchText([
    offer.title,
    offer.titleNormalized,
    offer.brand,
    offer.searchText,
    offer.description,
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.categoryKey,
    offer.subcategoryKey,
    offer.rawFacts?.infoText,
    offer.rawFacts?.validityText,
  ].filter(Boolean).join(' '));
}

function offerDiagnosticText(offer = {}) {
  return normalizeSearchText([
    offer.title,
    offer.titleNormalized,
    offer.brand,
    offer.searchText,
    offer.description,
    offer.rawFacts?.title,
    offer.rawFacts?.name,
    offer.rawFacts?.infoText,
    offer.rawFacts?.category,
    offer.rawFacts?.sourceCategory,
    offer.rawFacts?.categoryName,
    offer.rawFacts?.productGroup,
    offer.rawFacts?.sourceGroup,
  ].filter(Boolean).join(' '));
}

const KEYWORD_MATCH_PROFILES = {
  butter: {
    terms: ['butter', 'teebutter'],
    excludedTerms: ['buttergemuese', 'buttergemuse', 'butterkeks', 'butterkaese', 'butterkase', 'buttermilch', 'kraeuterbutter', 'krauterbutter', 'erdnussbutter'],
  },
  reis: {
    terms: ['reis', 'basmati', 'jasminreis', 'langkornreis', 'risotto'],
    excludedTerms: ['reisdrink', 'milchreis'],
  },
  huhn: {
    terms: ['huhn', 'hendl', 'haehnchen', 'hahnchen', 'huehnchen', 'huhnchen', 'huehner', 'huhner', 'gefluegel', 'geflugel'],
    allowTokenPart: true,
  },
  kaese: {
    terms: ['kaese', 'kase', 'gouda', 'emmentaler', 'mozzarella', 'feta', 'camembert', 'parmesan', 'bergkaese', 'bergkase', 'frischkaese', 'frischkase'],
  },
  gemuese: {
    terms: ['gemuese', 'gemuse', 'roestgemuese', 'rostgemuese', 'buttergemuese', 'buttergemuse', 'tomate', 'tomaten', 'paprika', 'gurke', 'salat', 'zucchini', 'spinat', 'karotte', 'moehre', 'mohre'],
    allowTokenPart: true,
  },
};

function keywordProductText(offer = {}) {
  const directProductText = [
    offer.title,
    offer.titleNormalized,
    offer.brand,
    offer.description,
    offer.comparisonGroup,
    offer.rawFacts?.title,
    offer.rawFacts?.name,
    offer.rawFacts?.infoText,
  ].filter(Boolean).join(' ');

  return normalizeSearchText(directProductText || offer.searchText || '');
}

function textContainsTerm(text, term) {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) return false;

  return new RegExp(`(^|\\s)${normalizedTerm}(\\s|$)`).test(text);
}

function textContainsProfileTerm(text, term, { allowTokenPart = false } = {}) {
  if (textContainsTerm(text, term)) return true;
  if (!allowTokenPart) return false;

  const normalizedTerm = normalizeSearchText(term);
  return text.split(/\s+/).some((token) => token.startsWith(normalizedTerm) || token.endsWith(normalizedTerm));
}

function offerMatchesKeyword(offer = {}, keyword = '') {
  const normalizedKeyword = normalizeSearchText(keyword);
  const profile = KEYWORD_MATCH_PROFILES[normalizedKeyword];
  const haystack = keywordProductText(offer);

  if (!haystack) {
    return false;
  }

  if (profile) {
    const excludedTerms = profile.excludedTerms || [];
    if (excludedTerms.some((term) => textContainsTerm(haystack, term))) {
      return false;
    }

    return profile.terms.some((term) => textContainsProfileTerm(haystack, term, profile));
  }

  return textContainsTerm(haystack, normalizedKeyword);
}

function buildProductiveCategories(categoryDocuments = []) {
  const fromDb = categoryDocuments
    .filter((category) => category?.isActive !== false)
    .map((category) => ({
      key: category.mainCategoryKey || normalizeKey(category.mainCategoryLabel),
      label: category.mainCategoryLabel || category.mainCategoryKey,
      source: 'db-category',
    }))
    .filter((category) => category.key && category.label);

  if (fromDb.length > 0) {
    return fromDb;
  }

  return CATEGORY_TAXONOMY.map((category) => ({
    key: normalizeKey(category.main),
    label: category.main,
    source: 'taxonomy-fallback',
  }));
}

function buildKeywordMatrix(keywords = SMOKE_KEYWORDS) {
  return keywords.map((keyword) => ({
    key: normalizeKey(keyword),
    label: keyword,
    keyword,
    source: 'smoke-keyword',
  }));
}

function sourceDefinitionType(source = {}) {
  const haystack = normalizeSearchText([
    source.channel,
    source.sourceType,
    source.label,
    source.sourceUrl,
    source.parserHint,
  ].filter(Boolean).join(' '));

  if (source.channel === 'official-site' || /official.*json|algolia|api|structured|json/.test(haystack)) {
    return 'official_structured';
  }

  if (source.channel === 'official-flyer' || /official|flyer|flugblatt|prospekt|pdf/.test(haystack)) {
    return 'official_flyer';
  }

  if (source.channel === 'aggregator' || /aktionsfinder|marktguru|wogibtswas|aggregator/.test(haystack)) {
    return 'aggregator';
  }

  return 'other';
}

function sourceEnabled(source = {}) {
  return source.enabled !== false && source.active !== false && source.latestStatus !== 'inactive';
}

function summarizeSourcesForRetailer({ spec, sources = [], definitions = RETAILER_DEFINITIONS }) {
  const all = [...sources, ...definitions].filter((source) => spec.retailerKeys.includes(source.retailerKey));
  const relevant = spec.formats && !spec.aggregate
    ? all.filter((source) => {
      const formats = unique([
        source.sourceRetailerFormat,
        ...(Array.isArray(source.appliesToRetailerFormats) ? source.appliesToRetailerFormats : []),
      ]).map(normalizeKey);
      return formats.length === 0 || spec.formats.some((format) => formats.includes(format));
    })
    : all;

  const byUrl = new Map();
  for (const source of relevant) {
    const key = `${source.retailerKey}:${source.sourceUrl || source.label}`;
    byUrl.set(key, { ...(byUrl.get(key) || {}), ...source });
  }

  const sourceList = [...byUrl.values()];
  const activeSources = sourceList.filter(sourceEnabled);
  const disabledSources = sourceList.filter((source) => !sourceEnabled(source));
  const sourceTypes = countBy(sourceList, sourceDefinitionType);
  const activeTypes = new Set(activeSources.map(sourceDefinitionType));

  return {
    retailerKey: spec.key,
    retailerLabel: spec.label,
    activeSourceCount: activeSources.length,
    disabledSourceCount: disabledSources.length,
    activeSources: activeSources.map((source) => ({
      label: source.label || '',
      channel: source.channel || '',
      sourceType: source.sourceType || '',
      type: sourceDefinitionType(source),
      latestStatus: source.latestStatus || '',
    })),
    disabledSources: disabledSources.map((source) => ({
      label: source.label || '',
      channel: source.channel || '',
      sourceType: source.sourceType || '',
      type: sourceDefinitionType(source),
      reason: source.disabledReason || source.notes || 'unknown',
    })),
    sourceTypeDistribution: sourceTypes,
    hasActiveOfficialOrStructured: activeTypes.has('official_structured') || activeTypes.has('official_flyer'),
    hasActiveStructured: activeTypes.has('official_structured'),
    hasOnlyAggregatorActive: activeSources.length > 0 && activeSources.every((source) => sourceDefinitionType(source) === 'aggregator'),
    hasNoUsableSource: activeSources.length === 0,
  };
}

function buildOfferPreview(offer = {}) {
  return {
    id: String(offer._id || offer.id || ''),
    title: offer.title || '',
    retailerKey: offer.retailerKey || '',
    sourceRetailerFormat: offer.sourceRetailerFormat || '',
    categoryPrimary: offer.categoryPrimary || '',
    categorySecondary: offer.categorySecondary || '',
    categoryKey: offer.categoryKey || '',
    subcategoryKey: offer.subcategoryKey || '',
    sourceType: offer.sourceType || '',
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    price: offer.priceCurrent?.amount ?? null,
    quantityText: offer.quantityText || '',
    customerProgramRequired: Boolean(offer.customerProgramRequired),
  };
}

function simulateRankingVisibility({ offers = [], query = '', limit = 30 }) {
  const active = offers.filter(isActiveOffer);
  const withSearchText = query
    ? active.filter((offer) => String(offer.searchText || offer.title || '').trim())
    : active;
  const publicOrVisible = withSearchText;
  const deduped = dedupeFinalResponseOffers(publicOrVisible, query);
  const sorted = deduped.sort((left, right) => {
    const leftScore = Number(left.sortScoreDefault || 0);
    const rightScore = Number(right.sortScoreDefault || 0);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return String(left.title || '').localeCompare(String(right.title || ''), 'de');
  });
  const ranked = sorted.slice(0, limit);
  const rankedIds = new Set(ranked.map((offer) => String(offer._id || offer.id || '')));
  const activeIds = new Set(active.map((offer) => String(offer._id || offer.id || '')));
  const dedupedIds = new Set(deduped.map((offer) => String(offer._id || offer.id || '')));
  const notVisible = active.filter((offer) => !rankedIds.has(String(offer._id || offer.id || '')));
  const reasons = countBy(notVisible, (offer) => {
    if (!isActiveOffer(offer)) return 'validity filter';
    if (query && !String(offer.searchText || offer.title || '').trim()) return 'missing searchText';
    if (!dedupedIds.has(String(offer._id || offer.id || ''))) return 'response dedupe removed';
    if (offer.customerProgramRequired) return 'programRetailer required';
    if (offer.status && offer.status !== 'active') return 'inactive/status';
    if (activeIds.has(String(offer._id || offer.id || ''))) return 'limit/ranking order';
    return 'unknown';
  });

  return {
    rankedOffersCount: ranked.length,
    topRankedOffers: ranked.slice(0, 5).map(buildOfferPreview),
    dbOffersPresentButNotRanked: notVisible.length,
    visibilityReasons: reasons,
  };
}

function classifyCategoryQuality(retailerOffers = [], scopedOffers = []) {
  const genericPattern = /^(sonstiges|unkategorisiert|unknown|unbekannt|freizeit-sonstiges)$/i;
  const genericOffers = retailerOffers.filter((offer) =>
    offerCategoryKeys(offer).some((key) => genericPattern.test(key))
    || genericPattern.test(String(offer.categoryPrimary || ''))
    || genericPattern.test(String(offer.categorySecondary || ''))
  );
  const missingOrUncertain = retailerOffers.filter((offer) =>
    !offer.categoryKey
    || !offer.categoryPrimary
    || Number(offer.categoryConfidence || 0) > 0 && Number(offer.categoryConfidence || 0) < 0.55
  );
  const examples = scopedOffers
    .filter((offer) => genericOffers.includes(offer) || missingOrUncertain.includes(offer))
    .slice(0, 5)
    .map(buildOfferPreview);

  return {
    sonstigesShare: pct(genericOffers.length, retailerOffers.length),
    missingOrUncertainCategoryShare: pct(missingOrUncertain.length, retailerOffers.length),
    possibleMisclassificationExamples: examples,
  };
}

function isGenericOrWeakCategory(offer = {}) {
  const genericPattern = /^(sonstiges|unkategorisiert|unknown|unbekannt|freizeit-sonstiges)$/i;
  return (
    !offer.categoryKey
    || !offer.categoryPrimary
    || !offer.categorySecondary
    || Number(offer.categoryConfidence || 0) > 0 && Number(offer.categoryConfidence || 0) < 0.55
    || offerCategoryKeys(offer).some((key) => genericPattern.test(key))
    || genericPattern.test(String(offer.categoryPrimary || ''))
    || genericPattern.test(String(offer.categorySecondary || ''))
  );
}

function hoferSourceBucket(offer = {}) {
  const sourceType = normalizeSearchText([offer.sourceType, ...(offer.sourceTypes || [])].filter(Boolean).join(' '));

  if (sourceType.includes('aktionsfinder-json')) return 'aktionsfinder-json';
  if (sourceType.includes('hofer-official') || sourceType.includes('official') || sourceType.includes('flyer')) return 'hofer official flyer';
  return offer.sourceType || 'unknown';
}

function extractSourceCategory(offer = {}) {
  return [
    offer.rawFacts?.category,
    offer.rawFacts?.sourceCategory,
    offer.rawFacts?.categoryName,
    offer.rawFacts?.productGroup,
    offer.rawFacts?.sourceGroup,
  ].map((value) => String(value || '').trim()).find(Boolean) || '';
}

function tokenizeDiagnosticText(text = '') {
  return normalizeSearchText(text)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !/^\d+$/.test(token));
}

function buildHoferAreaCoverage(offers = []) {
  return HOFER_CATEGORY_AREAS.map((area) => {
    const matched = offers.filter((offer) => {
      const text = offerDiagnosticText(offer);
      return area.terms.some((term) => textContainsTerm(text, term) || text.includes(normalizeSearchText(term)));
    });

    return {
      key: area.key,
      label: area.label,
      total: matched.length,
      weak: matched.filter(isGenericOrWeakCategory).length,
      weakShare: pct(matched.filter(isGenericOrWeakCategory).length, matched.length),
      examples: matched.filter(isGenericOrWeakCategory).slice(0, 5).map(buildOfferPreview),
    };
  });
}

function buildProjectedCategoryDecision(offer = {}) {
  const { determineCategoryDecision } = require('../crawl/categoryClassifier');

  return determineCategoryDecision({
    title: offer.title || '',
    contextText: [
      offer.description,
      offer.rawFacts?.infoText,
      offer.rawFacts?.category,
      offer.rawFacts?.sourceCategory,
      offer.rawFacts?.categoryName,
      offer.rawFacts?.productGroup,
      offer.rawFacts?.sourceGroup,
    ].filter(Boolean).join(' '),
    sourceCategory: extractSourceCategory(offer),
  });
}

function buildHoferWeakExample(offer = {}) {
  const projected = buildProjectedCategoryDecision(offer);
  const sourceCategory = extractSourceCategory(offer);

  return {
    ...buildOfferPreview(offer),
    sourceBucket: hoferSourceBucket(offer),
    sourceCategory,
    categoryConfidence: Number(offer.categoryConfidence || 0),
    subcategoryConfidence: Number(offer.subcategoryConfidence || 0),
    projectedCategoryPrimary: projected.primaryCategory,
    projectedCategorySecondary: projected.secondaryCategory,
    projectedCategoryConfidence: projected.categoryConfidence,
    projectedSubcategoryConfidence: projected.subcategoryConfidence,
    projectedStillWeak: projected.needsReview || projected.primaryCategory === 'Unkategorisiert' || !projected.secondaryCategory || projected.secondaryCategory === 'Sonstiges',
    likelyIssue: !sourceCategory && projected.needsReview
      ? 'source-data-or-title-too-weak'
      : projected.primaryCategory !== offer.categoryPrimary || projected.secondaryCategory !== offer.categorySecondary
        ? 'classifier-can-improve-or-stored-category-stale'
        : 'stored-category-still-weak',
  };
}

function buildHoferCategoryQualityDiagnostic(offers = []) {
  const hoferOffers = offers.filter((offer) => String(offer.retailerKey || '').trim() === 'hofer');
  const weakOffers = hoferOffers.filter(isGenericOrWeakCategory);
  const projectedExamples = weakOffers.map(buildHoferWeakExample);
  const improvedByCurrentClassifier = projectedExamples.filter((example) => !example.projectedStillWeak);
  const sourceBuckets = topItems(hoferOffers, hoferSourceBucket, 20).map((bucket) => {
    const bucketOffers = hoferOffers.filter((offer) => hoferSourceBucket(offer) === bucket.key);
    const bucketWeak = bucketOffers.filter(isGenericOrWeakCategory);

    return {
      sourceBucket: bucket.key,
      total: bucketOffers.length,
      weak: bucketWeak.length,
      weakShare: pct(bucketWeak.length, bucketOffers.length),
      missingSourceCategoryShare: pct(bucketOffers.filter((offer) => !extractSourceCategory(offer)).length, bucketOffers.length),
      currentCategoryDistribution: topItems(bucketOffers, (offer) => `${offer.categoryPrimary || 'missing'} > ${offer.categorySecondary || 'missing'}`, 12),
      weakExamples: bucketWeak.slice(0, 10).map(buildHoferWeakExample),
    };
  });
  const weakTokenCounts = new Map();

  for (const offer of weakOffers) {
    for (const token of tokenizeDiagnosticText(offer.title || '')) {
      if (!HOFER_CATEGORY_BRANDS.includes(token)) {
        weakTokenCounts.set(token, (weakTokenCounts.get(token) || 0) + 1);
      }
    }
  }

  return {
    retailerKey: 'hofer',
    readOnly: true,
    totalOffers: hoferOffers.length,
    weakOffers: weakOffers.length,
    weakShare: pct(weakOffers.length, hoferOffers.length),
    sonstigesOffers: hoferOffers.filter((offer) => String(offer.categorySecondary || '') === 'Sonstiges').length,
    missingCategoryOffers: hoferOffers.filter((offer) => !offer.categoryPrimary || !offer.categoryKey).length,
    missingSubcategoryOffers: hoferOffers.filter((offer) => !offer.categorySecondary || !offer.subcategoryKey).length,
    genericCategoryDistribution: topItems(weakOffers, (offer) => `${offer.categoryPrimary || 'missing'} > ${offer.categorySecondary || 'missing'}`, 20),
    sourceBuckets,
    productAreaCoverage: buildHoferAreaCoverage(hoferOffers),
    projectedWithCurrentClassifier: {
      improvedWeakOffers: improvedByCurrentClassifier.length,
      improvedWeakShare: pct(improvedByCurrentClassifier.length, weakOffers.length),
      stillWeakOffers: projectedExamples.length - improvedByCurrentClassifier.length,
      projectedCategoryDistribution: topItems(projectedExamples, (example) => `${example.projectedCategoryPrimary || 'missing'} > ${example.projectedCategorySecondary || 'missing'}`, 20),
      improvedExamples: improvedByCurrentClassifier.slice(0, 20),
      stillWeakExamples: projectedExamples.filter((example) => example.projectedStillWeak).slice(0, 20),
    },
    likelyRootCauseSignals: {
      sourceDataWeak: weakOffers.filter((offer) => !extractSourceCategory(offer)).length,
      classifierCanImproveOrStoredCategoryStale: improvedByCurrentClassifier.length,
      keywordMatchingNeedsReview: weakOffers.filter((offer) =>
        extractSourceCategory(offer)
        && buildProjectedCategoryDecision(offer).needsReview
      ).length,
    },
    topWeakTitleTokens: [...weakTokenCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'de'))
      .slice(0, 40)
      .map(([key, count]) => ({ key, count })),
    topWeakExamples: projectedExamples.slice(0, 30),
  };
}

function evaluateStatus({ metrics, sourceHealth, categoryQuality }) {
  const reasons = [];
  const active = metrics.activeOfferCount;
  const total = metrics.totalOfferCount;
  const validityRatio = pct(metrics.offersWithAnyValidity, Math.max(total, 1));
  const priceRatio = pct(metrics.offersWithPrice, Math.max(total, 1));
  const quantityRatio = pct(metrics.offersWithUnitOrQuantity, Math.max(total, 1));
  const visibilityRatio = pct(metrics.rankedOffersCount, Math.max(active, 1));

  if (total === 0 && sourceHealth.hasNoUsableSource) {
    return { status: 'unknown', reasons: ['no offers and no usable source context'] };
  }

  if (total === 0 && sourceHealth.disabledSourceCount > 0 && sourceHealth.activeSourceCount === 0) {
    return { status: 'critical', reasons: ['no offers and all known sources disabled'] };
  }

  if (active < QUALITY_THRESHOLDS.minWeakActiveOffers && !sourceHealth.hasActiveOfficialOrStructured) {
    reasons.push('activeOfferCount very low and no active official/structured source');
  }

  if (active > 0 && metrics.rankedOffersCount === 0) {
    reasons.push('active DB offers are not visible in ranking simulation');
  }

  if (reasons.length > 0) {
    return { status: 'critical', reasons };
  }

  if (active < QUALITY_THRESHOLDS.minOkActiveOffers) reasons.push('activeOfferCount below ok threshold');
  if (validityRatio < QUALITY_THRESHOLDS.minOkValidityRatio) reasons.push('validity coverage weak');
  if (priceRatio < QUALITY_THRESHOLDS.minOkPriceRatio) reasons.push('price coverage weak');
  if (quantityRatio < QUALITY_THRESHOLDS.minOkQuantityRatio) reasons.push('quantity/unit coverage weak');
  if (visibilityRatio < QUALITY_THRESHOLDS.minOkVisibilityRatio) reasons.push('ranking visibility weak');
  if (sourceHealth.hasOnlyAggregatorActive) reasons.push('only aggregator source active');
  if (categoryQuality.missingOrUncertainCategoryShare > 0.25 || categoryQuality.sonstigesShare > 0.25) {
    reasons.push('category quality weak');
  }

  if (reasons.length > 0) {
    return { status: 'weak', reasons };
  }

  return { status: 'ok', reasons: ['passes conservative diagnostic thresholds'] };
}

function buildCoverageMetrics({ offers = [], activeOffers = [], ranked }) {
  const newestCreatedAt = offers.map((offer) => dateIso(offer.createdAt)).filter(Boolean).sort().at(-1) || null;
  const newestUpdatedAt = offers.map((offer) => dateIso(offer.updatedAt)).filter(Boolean).sort().at(-1) || null;

  return {
    activeOfferCount: activeOffers.length,
    totalOfferCount: offers.length,
    offersWithValidFrom: offers.filter((offer) => hasDate(offer.validFrom)).length,
    offersWithValidTo: offers.filter((offer) => hasDate(offer.validTo)).length,
    offersWithAnyValidity: offers.filter((offer) => hasDate(offer.validFrom) || hasDate(offer.validTo)).length,
    offersWithPrice: offers.filter(hasPrice).length,
    offersWithUnitOrQuantity: offers.filter(hasUnitOrQuantity).length,
    offersWithConditions: offers.filter(hasConditions).length,
    offersWithImage: offers.filter(hasImage).length,
    offersWithComparisonSafe: offers.filter(isComparisonSafe).length,
    offersWithCustomerProgramRequired: offers.filter((offer) => offer.customerProgramRequired).length,
    sourceTypeDistribution: countBy(offers, (offer) => offer.sourceType || offer.sourceTypes?.[0]),
    sourceKeyDistribution: countBy(offers, (offer) => offer.sourceId),
    newestCreatedAt,
    newestUpdatedAt,
    ...ranked,
  };
}

function buildMatrixRow({ spec, dimension, allOffers, sourceHealth, generatedAt }) {
  const retailerOffers = allOffers.filter((offer) => offerMatchesRetailer(offer, spec));
  const scopedOffers = retailerOffers.filter((offer) =>
    dimension.type === 'category'
      ? offerMatchesCategory(offer, dimension)
      : offerMatchesKeyword(offer, dimension.keyword)
  );
  const activeOffers = scopedOffers.filter((offer) => isActiveOffer(offer, generatedAt));
  const ranked = simulateRankingVisibility({
    offers: scopedOffers,
    query: dimension.type === 'keyword' ? dimension.keyword : '',
  });
  const metrics = buildCoverageMetrics({ offers: scopedOffers, activeOffers, ranked });
  const categoryQuality = classifyCategoryQuality(retailerOffers, scopedOffers);
  const status = evaluateStatus({ metrics, sourceHealth, categoryQuality });

  return {
    id: `${spec.key}:${dimension.type}:${dimension.key}`,
    retailerKey: spec.key,
    retailerLabel: spec.label,
    normalizedRetailerKeys: spec.retailerKeys,
    dimensionType: dimension.type,
    categoryKey: dimension.type === 'category' ? dimension.key : null,
    categoryLabel: dimension.type === 'category' ? dimension.label : null,
    keyword: dimension.type === 'keyword' ? dimension.keyword : null,
    status: status.status,
    statusReasons: status.reasons,
    metrics,
    categoryQuality,
    sourceHealth: {
      activeSourceCount: sourceHealth.activeSourceCount,
      disabledSourceCount: sourceHealth.disabledSourceCount,
      hasActiveOfficialOrStructured: sourceHealth.hasActiveOfficialOrStructured,
      hasActiveStructured: sourceHealth.hasActiveStructured,
      hasOnlyAggregatorActive: sourceHealth.hasOnlyAggregatorActive,
      hasNoUsableSource: sourceHealth.hasNoUsableSource,
    },
    samples: scopedOffers.slice(0, 5).map(buildOfferPreview),
  };
}

function action(cause, item, detail) {
  return {
    cause,
    retailerKey: item.retailerKey,
    retailerLabel: item.retailerLabel,
    dimensionType: item.dimensionType,
    categoryLabel: item.categoryLabel,
    keyword: item.keyword,
    status: item.status,
    detail,
  };
}

function buildRecommendedNextActions(matrix = []) {
  const grouped = Object.fromEntries(ACTION_CAUSES.map((cause) => [cause, []]));

  for (const item of matrix) {
    if (item.sourceHealth.hasNoUsableSource) grouped.source_missing.push(action('source_missing', item, 'No active usable source is configured or observed.'));
    if (item.sourceHealth.disabledSourceCount > 0 && item.sourceHealth.activeSourceCount === 0) grouped.source_disabled.push(action('source_disabled', item, 'Known sources are disabled or inactive.'));
    if (item.metrics.activeOfferCount < QUALITY_THRESHOLDS.minWeakActiveOffers && item.sourceHealth.activeSourceCount > 0) grouped.source_low_yield.push(action('source_low_yield', item, 'Sources exist but yield very few active offers.'));
    if (item.metrics.totalOfferCount > 0 && item.metrics.offersWithPrice / item.metrics.totalOfferCount < 0.7) grouped.parser_weak.push(action('parser_weak', item, 'Many offers lack parsed price.'));
    if (item.categoryQuality.missingOrUncertainCategoryShare > 0.25 || item.categoryQuality.sonstigesShare > 0.25) grouped.category_mapping_weak.push(action('category_mapping_weak', item, 'High share of missing, uncertain, or generic categories.'));
    if (['spar', 'interspar', 'eurospar'].includes(item.retailerKey) && item.metrics.totalOfferCount === 0) grouped.retailer_mapping_weak.push(action('retailer_mapping_weak', item, 'SPAR format split may be losing offers.'));
    if (item.metrics.activeOfferCount > 0 && item.metrics.rankedOffersCount === 0) grouped.ranking_visibility_issue.push(action('ranking_visibility_issue', item, 'Active DB offers are absent from ranking simulation.'));
    if (item.metrics.dbOffersPresentButNotRanked > 0 && item.metrics.visibilityReasons.some((reason) => reason.key === 'response dedupe removed')) grouped.dedupe_suspected.push(action('dedupe_suspected', item, 'Ranking simulation indicates response dedupe removed offers.'));
    if (item.metrics.totalOfferCount > 0 && item.metrics.offersWithAnyValidity / item.metrics.totalOfferCount < 0.7) grouped.validity_weak.push(action('validity_weak', item, 'Validity fields are weak or missing.'));
    if (item.metrics.totalOfferCount > 0 && item.metrics.offersWithUnitOrQuantity / item.metrics.totalOfferCount < 0.5) grouped.quantity_unit_weak.push(action('quantity_unit_weak', item, 'Quantity/unit fields are weak or missing.'));
    if (item.metrics.totalOfferCount > 0 && item.metrics.offersWithConditions / item.metrics.totalOfferCount < 0.2) grouped.condition_weak.push(action('condition_weak', item, 'Condition fields are sparse; this can be fine for simple price cuts but should be checked.'));
  }

  return ACTION_CAUSES.map((cause) => ({
    cause,
    count: grouped[cause].length,
    items: grouped[cause].slice(0, 20),
  }));
}

function buildRetailerSummaries(matrix = [], sourceHealth = []) {
  return RETAILER_SPECS.map((spec) => {
    const rows = matrix.filter((item) => item.retailerKey === spec.key);
    return {
      retailerKey: spec.key,
      retailerLabel: spec.label,
      statuses: countBy(rows, (row) => row.status),
      activeOfferCount: rows.reduce((sum, row) => sum + row.metrics.activeOfferCount, 0),
      totalOfferCount: rows.reduce((sum, row) => sum + row.metrics.totalOfferCount, 0),
      sourceHealth: sourceHealth.find((item) => item.retailerKey === spec.key) || null,
    };
  });
}

function buildSummary({ matrix, categories }) {
  const statusCounts = new Map(matrix.map((item) => [item.status, 0]));
  for (const item of matrix) statusCounts.set(item.status, (statusCounts.get(item.status) || 0) + 1);

  return {
    retailersChecked: RETAILER_SPECS.length,
    categoriesChecked: categories.length,
    keywordsChecked: SMOKE_KEYWORDS.length,
    criticalCount: statusCounts.get('critical') || 0,
    weakCount: statusCounts.get('weak') || 0,
    okCount: statusCounts.get('ok') || 0,
    unknownCount: statusCounts.get('unknown') || 0,
    mostCriticalRetailers: countBy(matrix.filter((item) => item.status === 'critical'), (item) => item.retailerKey).slice(0, 10),
    mostCriticalCategories: countBy(matrix.filter((item) => item.status === 'critical'), (item) => item.categoryLabel || item.keyword).slice(0, 10),
  };
}

function buildMarketCoverageDiagnostic({
  offers = [],
  sources = [],
  categories = [],
  databaseName = '',
  checkedAt = new Date(),
} = {}) {
  const generatedAt = checkedAt instanceof Date ? checkedAt : new Date(checkedAt);
  const productiveCategories = buildProductiveCategories(categories).map((category) => ({ ...category, type: 'category' }));
  const keywordDimensions = buildKeywordMatrix().map((keyword) => ({ ...keyword, type: 'keyword' }));
  const dimensions = [...productiveCategories, ...keywordDimensions];
  const sourceHealth = RETAILER_SPECS.map((spec) => summarizeSourcesForRetailer({ spec, sources }));
  const matrix = [];

  for (const spec of RETAILER_SPECS) {
    const health = sourceHealth.find((item) => item.retailerKey === spec.key);
    for (const dimension of dimensions) {
      matrix.push(buildMatrixRow({
        spec,
        dimension,
        allOffers: offers,
        sourceHealth: health,
        generatedAt,
      }));
    }
  }

  return {
    checkedAt: generatedAt.toISOString(),
    databaseName,
    readOnly: true,
    mutatedCollections: [],
    principle: 'Qualitaet der Daten ist kein Nebenthema - sie IST das Produkt.',
    heuristic: {
      statusRules: STATUS_RULES,
      thresholds: QUALITY_THRESHOLDS,
      note: 'Diagnostic heuristic only; not productive business logic.',
    },
    summary: buildSummary({ matrix, categories: productiveCategories }),
    retailerSummaries: buildRetailerSummaries(matrix, sourceHealth),
    coverageMatrix: matrix,
    hoferCategoryQuality: buildHoferCategoryQualityDiagnostic(offers),
    sourceHealth,
    recommendedNextActions: buildRecommendedNextActions(matrix),
  };
}

module.exports = {
  ACTION_CAUSES,
  QUALITY_THRESHOLDS,
  RETAILER_SPECS,
  SMOKE_KEYWORDS,
  STATUS_RULES,
  buildKeywordMatrix,
  buildMarketCoverageDiagnostic,
  buildProductiveCategories,
  buildHoferCategoryQualityDiagnostic,
  buildProjectedCategoryDecision,
  evaluateStatus,
  extractSourceCategory,
  hoferSourceBucket,
  isGenericOrWeakCategory,
  offerMatchesRetailer,
  simulateRankingVisibility,
  sourceDefinitionType,
  summarizeSourcesForRetailer,
};
