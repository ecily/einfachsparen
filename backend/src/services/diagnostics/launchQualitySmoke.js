const { isOfferSafelyComparable } = require('../crawl/offerQualityGuards');
const {
  buildOfferRanking,
  buildValidityLabel,
  normalizeRetailerKey,
  normalizeSearchText,
} = require('../offers/offerRankingService');

const DEFAULT_TOP_N = 10;
const GLOBAL_LOW_RESULT_WATCH_THRESHOLD = 6;

const LAUNCH_QUERIES = [
  { query: 'kaffee', aliases: ['kaffee'] },
  { query: 'butter', aliases: ['butter'] },
  { query: 'milch', aliases: ['milch'] },
  { query: 'joghurt', aliases: ['joghurt'] },
  { query: 'kaese', aliases: ['kaese', 'kaese'] },
  { query: 'huhn', aliases: ['huhn'] },
  { query: 'wurst', aliases: ['wurst'] },
  { query: 'reis', aliases: ['reis'] },
  { query: 'nudeln', aliases: ['nudeln'] },
  { query: 'waschmittel', aliases: ['waschmittel'] },
  { query: 'zahnpasta', aliases: ['zahnpasta'] },
  { query: 'shampoo', aliases: ['shampoo'] },
  { query: 'windeln', aliases: ['windeln'] },
  { query: 'bier', aliases: ['bier'] },
  { query: 'schokolade', aliases: ['schokolade'] },
  { query: 'obst', aliases: ['obst'] },
  { query: 'gemuese', aliases: ['gemuese', 'gemuese'] },
  { query: 'tiefkuehl', aliases: ['tiefkuehl', 'tiefkuehl'] },
  { query: 'tiernahrung', aliases: ['tiernahrung'] },
];

const LAUNCH_RETAILERS = [
  { retailerKey: 'billa', retailerName: 'BILLA' },
  { retailerKey: 'billa-plus', retailerName: 'BILLA PLUS' },
  { retailerKey: 'lidl', retailerName: 'LIDL' },
  { retailerKey: 'penny', retailerName: 'PENNY' },
  { retailerKey: 'hofer', retailerName: 'HOFER' },
  { retailerKey: 'spar', retailerName: 'SPAR' },
  { retailerKey: 'dm', retailerName: 'dm' },
  { retailerKey: 'bipa', retailerName: 'BIPA' },
];

const QUERY_PRIORITIES = {
  high: ['kaffee', 'butter', 'milch', 'joghurt', 'kaese', 'huhn', 'reis', 'nudeln', 'waschmittel', 'schokolade'],
  medium: ['zahnpasta', 'shampoo', 'windeln', 'bier', 'obst', 'gemuese', 'tiefkuehl'],
  low: ['tiernahrung'],
};

const QUERY_PRIORITY_BY_QUERY = Object.entries(QUERY_PRIORITIES).reduce((acc, [priority, queries]) => {
  for (const query of queries) {
    acc[query] = priority;
  }

  return acc;
}, {});

function terms(...values) {
  return values.map((value) => normalizeSearchText(value)).filter(Boolean);
}

const QUERY_PROFILES = {
  butter: {
    positiveTerms: terms('butter', 'teebutter', 'butterschmalz', 'streichfett', 'margarine'),
    positiveContextTerms: terms('milchprodukte', 'molkerei'),
    sideHitTerms: terms('peanut', 'erdnussbutter', 'almond butter', 'protein', 'cookie', 'cookies', 'cups', 'kosmetik', 'lippenbalsam', 'body butter', 'bodybutter', 'highlighter', 'make up', 'makeup', 'buttergemuese', 'buttergemuse', 'butterkeks', 'buttercroissant', 'butterkaese', 'butterkase', 'gebaeck', 'geback'),
    severeSideHitTerms: terms('peanut', 'erdnussbutter', 'almond butter', 'protein', 'cookie', 'cookies', 'cups', 'kosmetik', 'lippenbalsam', 'body butter', 'bodybutter', 'highlighter', 'make up', 'makeup', 'buttergemuese', 'buttergemuse'),
  },
  milch: {
    positiveTerms: terms('trinkmilch', 'frischmilch', 'haltbarmilch', 'vollmilch', 'heumilch', 'biomilch', 'milch 1 l', 'milch 1l'),
    positiveContextTerms: terms('milchprodukte', 'molkerei'),
    sideHitTerms: terms('kaese', 'kase', 'schokolade', 'schoko', 'kosmetik', 'milchkaffee', 'milchsnitte', 'caffe latte', 'eiskaffee', 'seife', 'shampoo', 'dessert', 'pudding'),
    severeSideHitTerms: terms('kaese', 'kase', 'schokolade', 'schoko', 'kosmetik', 'seife', 'shampoo', 'milchsnitte'),
  },
  reis: {
    positiveTerms: terms('reis', 'basmati', 'jasmin', 'langkorn', 'risotto', 'risottoreis', 'milchreis', 'expressreis', 'reischips', 'reiswaffel', 'reiswaffeln'),
    positiveContextTerms: terms('reis', 'grundnahrungsmittel'),
    sideHitTerms: terms('passata', 'pasta sauce', 'tomatensauce', 'sugo', 'spaghetti', 'nudeln', 'nudel', 'pasta', 'bohnen', 'kichererbsen', 'konserven', 'reisdrink', 'milchersatz', 'drink'),
    categoryOnlySideHit: true,
  },
  huhn: {
    positiveTerms: terms('huhn', 'hendl', 'huehnchen', 'huhnchen', 'huehner', 'huhner', 'gefluegel', 'geflugel', 'chicken'),
    positiveContextTerms: terms('fleisch', 'wurst und fisch', 'gefluegel', 'geflugel'),
    sideHitTerms: terms('tierfutter', 'katzenfutter', 'hundefutter', 'nassfutter', 'trockenfutter', 'katze', 'katzen', 'hund', 'hunde', 'whiskas', 'sheba', 'felix', 'gourmet'),
    severeSideHitTerms: terms('tierfutter', 'katzenfutter', 'hundefutter', 'nassfutter', 'trockenfutter', 'katze', 'katzen', 'hund', 'hunde'),
  },
  kaffee: {
    positiveTerms: terms('kaffee', 'cafe', 'caffe', 'bohnen', 'bohne', 'gemahlen', 'kapseln', 'kapsel', 'pads', 'espresso', 'loeskaffee', 'loskaffee'),
    positiveContextTerms: terms('kaffee tee'),
    sideHitTerms: terms('kaffeegetraenk', 'kaffee getraenk', 'eiskaffee', 'drink', 'pflanze', 'zierpflanze', 'duftgeranie'),
    severeSideHitTerms: terms('pflanze', 'zierpflanze', 'duftgeranie'),
  },
  waschmittel: {
    positiveTerms: terms('waschmittel', 'waschpulver', 'waschgel', 'vollwaschmittel', 'colorwaschmittel', 'pods', 'caps', 'discs'),
    positiveContextTerms: terms('waesche', 'wasche'),
    sideHitTerms: terms('schmutzradierer', 'allzweck', 'wc', 'tuecher', 'tucher', 'desinfektion', 'geschirr', 'spuelmittel', 'spulmittel'),
  },
  shampoo: {
    positiveTerms: terms('shampoo', 'haarpflege'),
    positiveContextTerms: terms('drogerie hygiene', 'koerperpflege', 'korperpflege'),
  },
  zahnpasta: {
    positiveTerms: terms('zahnpasta', 'zahncreme', 'zahnpflege', 'mundpflege'),
    positiveContextTerms: terms('drogerie hygiene'),
  },
  windeln: {
    positiveTerms: terms('windeln', 'babywindeln', 'pants'),
    positiveContextTerms: terms('baby', 'babyhygiene', 'baby kinder'),
  },
  obst: {
    positiveTerms: terms('obst', 'apfel', 'aepfel', 'apfel', 'banane', 'bananen', 'erdbeeren', 'mango', 'trauben', 'beeren', 'kiwi', 'birne'),
    positiveContextTerms: terms('obst gemuese', 'obst gemuse'),
    sideHitTerms: terms('saft', 'limonade', 'sirup', 'drink', 'joghurt', 'dessert'),
  },
  gemuese: {
    positiveTerms: terms('gemuese', 'gemuse', 'tomaten', 'gurken', 'paprika', 'salat', 'karotten', 'kartoffeln', 'zucchini', 'zwiebeln'),
    positiveContextTerms: terms('obst gemuese', 'obst gemuse'),
    sideHitTerms: terms('saft', 'limonade', 'sirup', 'drink', 'chips'),
  },
  bier: {
    positiveTerms: terms('bier', 'maerzen', 'marzen', 'pils', 'radler', 'lager', 'weizenbier', 'weissbier', 'alkoholfrei'),
    positiveContextTerms: terms('bier', 'getraenke', 'getranke'),
    sideHitTerms: terms('bierwurst', 'bierschinken'),
  },
  schokolade: {
    positiveTerms: terms('schokolade', 'schoko', 'tafelschokolade', 'pralinen', 'praline', 'riegel', 'milka', 'lindt', 'merci', 'zartbitter', 'vollmilchschokolade'),
    positiveContextTerms: terms('suesswaren', 'susswaren', 'knabbereien'),
    sideHitTerms: terms('dessert', 'pudding', 'torte', 'kuchen', 'backzutat', 'backzutaten', 'creme'),
  },
  tiernahrung: {
    positiveTerms: terms('tiernahrung', 'tierfutter', 'katzenfutter', 'hundefutter', 'nassfutter', 'trockenfutter'),
    positiveContextTerms: terms('tierbedarf'),
  },
  tiefkuehl: {
    positiveTerms: terms('tiefkuehl', 'tiefkuehlkost', 'tiefkuehlpizza', 'tiefgekuehlt', 'tiefgekuhlt', 'frozen'),
    positiveContextTerms: terms('tiefkuehl'),
  },
  wurst: {
    positiveTerms: terms('wurst', 'schinken', 'salami', 'aufschnitt', 'frankfurter', 'extrawurst'),
    positiveContextTerms: terms('fleisch wurst fisch'),
  },
  nudeln: {
    positiveTerms: terms('nudeln', 'pasta', 'spaghetti', 'penne', 'fusilli', 'tagliatelle'),
    positiveContextTerms: terms('pasta', 'grundnahrungsmittel'),
  },
  kaese: {
    positiveTerms: terms('kaese', 'kase', 'gouda', 'emmentaler', 'bergkaese', 'bergkase', 'mozzarella', 'feta', 'camembert', 'parmesan', 'edamer'),
    positiveContextTerms: terms('kaese', 'kase', 'milchprodukte', 'molkerei'),
    sideHitTerms: terms('pizza', 'cabanossi', 'pljeskavica', 'wurst'),
  },
};

function buildSmokeReadOnlyContract() {
  return {
    readOnly: true,
    mutatedCollections: [],
  };
}

function wordString(value) {
  const normalized = normalizeSearchText(value);
  return normalized ? ` ${normalized} ` : ' ';
}

function includesTerm(value, term) {
  return wordString(value).includes(` ${term} `);
}

function matchingTerms(value, expectedTerms = []) {
  return expectedTerms.filter((term) => includesTerm(value, term));
}

function getOfferTextParts(offer = {}) {
  const titleText = [
    offer.title,
    offer.titleNormalized,
    offer.brand,
    offer.comparisonGroup,
    offer.searchText,
  ].filter(Boolean).join(' ');
  const categoryText = [
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.categoryKey,
    offer.subcategoryKey,
    offer.displayCategory,
  ].filter(Boolean).join(' ');

  return {
    titleText,
    categoryText,
    allText: `${titleText} ${categoryText}`,
  };
}

function getPriceAmount(offer = {}) {
  const amount = Number(offer.priceCurrent?.amount);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function isMissingQuantity(offer = {}) {
  return !String(offer.quantityText || '').trim() &&
    !Number(offer.unitValue || 0) &&
    !Number(offer.totalComparableAmount || 0);
}

function hasSafeValidity(offer = {}) {
  if (offer.status && offer.status !== 'active') {
    return false;
  }

  if (offer.isActiveNow === false) {
    return false;
  }

  if (!offer.validTo) {
    return false;
  }

  return !Number.isNaN(new Date(offer.validTo).getTime());
}

function sourceTrust(offer = {}) {
  const sourceType = String(offer.sourceType || '').trim();

  if (/ocr|bbox|tesseract|paddle/i.test(sourceType)) {
    return { sourceType, level: 'low', role: 'ocr-diagnostic-only' };
  }

  if (/official.*(?:algolia|api|json)|(?:algolia|api|json).*official/i.test(sourceType)) {
    return { sourceType, level: 'official', role: 'official-structured-json' };
  }

  if (/official.*html|html.*official|flyer|offers-page/i.test(sourceType)) {
    return { sourceType, level: 'official', role: 'official-page' };
  }

  if (/aktionsfinder|marketguru|wogibtswas|aggregator/i.test(sourceType)) {
    return { sourceType, level: 'aggregator', role: 'aggregator' };
  }

  if (/pdf/i.test(sourceType)) {
    return { sourceType, level: 'low', role: 'pdf-evidence' };
  }

  return { sourceType: sourceType || 'unknown', level: 'unknown', role: 'unknown' };
}

function likelyConditionNeedsText(offer = {}) {
  const effectiveDiscountType = String(offer.effectiveDiscountType || 'unknown');
  return Boolean(
    offer.customerProgramRequired ||
    offer.hasConditions ||
    offer.isMultiBuy ||
    Number(offer.minimumPurchaseQty || offer.minimumPurchaseQuantity || 1) > 1 ||
    (effectiveDiscountType && !['unknown', 'price-cut'].includes(effectiveDiscountType))
  );
}

function detectSideHit(query, offer = {}) {
  const profile = QUERY_PROFILES[query] || {};
  const { titleText, categoryText, allText } = getOfferTextParts(offer);
  const positiveMatches = matchingTerms(allText, profile.positiveTerms);
  const contextMatches = matchingTerms(categoryText, profile.positiveContextTerms);
  const sideMatches = matchingTerms(allText, profile.sideHitTerms);
  const severeSideMatches = matchingTerms(allText, profile.severeSideHitTerms);
  const titlePositiveMatches = matchingTerms(titleText, profile.positiveTerms);
  const hasPositive = positiveMatches.length > 0 || contextMatches.length > 0;
  const isCategoryOnlySideHit = Boolean(
    profile.categoryOnlySideHit &&
    titlePositiveMatches.length === 0 &&
    contextMatches.length > 0
  );
  const isSideHit = sideMatches.length > 0 || severeSideMatches.length > 0 || isCategoryOnlySideHit;

  return {
    isSideHit,
    isSevereSideHit: severeSideMatches.length > 0 || isCategoryOnlySideHit,
    hasPositive,
    positiveMatches,
    contextMatches,
    sideMatches: [...new Set(sideMatches.concat(severeSideMatches))],
    categoryOnlySideHit: isCategoryOnlySideHit,
  };
}

function duplicateKey(offer = {}) {
  return [
    normalizeRetailerKey(offer.retailerKey || offer.retailerName || ''),
    normalizeSearchText(offer.titleNormalized || offer.title || ''),
    getPriceAmount(offer) ?? '',
    normalizeSearchText(offer.quantityText || ''),
    normalizeSearchText(offer.conditionsText || ''),
  ].join('::');
}

function findVisibleDuplicateKeys(offers = []) {
  const counts = new Map();

  for (const offer of offers) {
    const key = duplicateKey(offer);

    if (!key || key.split('::')[1] === '') {
      continue;
    }

    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function buildOfferQualityFlags({ query, offer, duplicateKeys }) {
  const sideHit = detectSideHit(query, offer);
  const trust = sourceTrust(offer);
  const comparisonSafe = isOfferSafelyComparable(offer);
  const missingPrice = getPriceAmount(offer) === null;
  const missingQuantity = isMissingQuantity(offer);
  const unsafeOrMissingValidity = !hasSafeValidity(offer);
  const missingConditionWhenLikelyNeeded = likelyConditionNeedsText(offer) && !String(offer.conditionsText || '').trim();
  const lowSourceTrust = trust.level === 'low' || trust.level === 'unknown';
  const likelyDuplicateVisible = duplicateKeys.has(duplicateKey(offer));
  const hasSavingsSignal = offer.savingsAmount !== null && offer.savingsAmount !== undefined ||
    offer.savingsPercent !== null && offer.savingsPercent !== undefined ||
    Number(offer.priceGapPercent || 0) > 0;
  const misleadingSavingsRisk = Boolean(hasSavingsSignal && !comparisonSafe);
  const suspiciousCategory = Boolean(sideHit.isSideHit || (!sideHit.hasPositive && query in QUERY_PROFILES));
  const needsManualReview = Boolean(
    offer.needsReview ||
    (offer.reviewReasons || []).length > 0 ||
    sideHit.isSevereSideHit ||
    missingPrice ||
    likelyDuplicateVisible ||
    misleadingSavingsRisk
  );

  return {
    suspiciousCategory,
    missingPrice,
    missingQuantity,
    unsafeOrMissingValidity,
    missingConditionWhenLikelyNeeded,
    lowSourceTrust,
    likelySideHit: sideHit.isSideHit,
    likelyDuplicateVisible,
    misleadingSavingsRisk,
    needsManualReview,
    sideHitEvidence: {
      positiveMatches: sideHit.positiveMatches,
      contextMatches: sideHit.contextMatches,
      sideMatches: sideHit.sideMatches,
      categoryOnlySideHit: sideHit.categoryOnlySideHit,
      severe: sideHit.isSevereSideHit,
    },
    sourceTrust: trust,
  };
}

function summarizeVisibleOffer({ query, offer, index, duplicateKeys }) {
  const flags = buildOfferQualityFlags({ query, offer, duplicateKeys });

  return {
    rank: index + 1,
    id: offer.id || offer._id || '',
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || offer.sourceRetailerName || '',
    title: offer.title || '',
    price: offer.priceCurrent || null,
    quantityText: offer.quantityText || '',
    categoryPrimary: offer.categoryPrimary || '',
    categorySecondary: offer.categorySecondary || '',
    categoryKey: offer.categoryKey || '',
    sourceType: offer.sourceType || '',
    validFrom: offer.validFrom || null,
    validTo: offer.validTo || null,
    validityLabel: offer.validityLabel || buildValidityLabel(offer),
    customerProgramRequired: Boolean(offer.customerProgramRequired),
    conditionsText: offer.conditionsText || '',
    comparisonSafe: isOfferSafelyComparable(offer),
    qualityFlags: flags,
  };
}

function countFlags(offers, flagName) {
  return offers.filter((offer) => offer.qualityFlags?.[flagName]).length;
}

function buildSourceTrustSummary(offers) {
  return offers.reduce((acc, offer) => {
    const level = offer.qualityFlags?.sourceTrust?.level || 'unknown';
    acc[level] = (acc[level] || 0) + 1;
    return acc;
  }, { official: 0, aggregator: 0, low: 0, unknown: 0 });
}

function getSevereIssueCount(offers) {
  return offers.reduce((count, offer) => {
    const flags = offer.qualityFlags || {};
    return count + Number(Boolean(
      flags.likelySideHit && flags.sideHitEvidence?.severe ||
      flags.missingPrice ||
      flags.likelyDuplicateVisible ||
      flags.misleadingSavingsRisk
    ));
  }, 0);
}

function getQueryPriority(query) {
  return QUERY_PRIORITY_BY_QUERY[query] || 'medium';
}

function hasTopFiveSevereWrongResult(result = {}) {
  return (result.rankedOffers || []).slice(0, 5).some((offer) => {
    const flags = offer.qualityFlags || {};
    return Boolean(flags.likelySideHit && flags.sideHitEvidence?.severe);
  });
}

function countVisibleFlag(result = {}, flagName) {
  return (result.rankedOffers || []).filter((offer) => offer.qualityFlags?.[flagName]).length;
}

function buildReadinessItem(result, {
  readinessClass,
  failReasons = [],
  recommendation = '',
  scopeLimit = '',
} = {}) {
  return {
    query: result.query,
    retailer: result.retailer || null,
    label: formatResultLabel(result),
    queryPriority: getQueryPriority(result.query),
    smokeStatus: result.status,
    readinessClass,
    resultCount: result.resultCount,
    severeIssueCount: result.severeIssueCount,
    missingCoreFieldCount: result.missingCoreFieldCount,
    failReasons,
    reasons: result.reasons || [],
    recommendation,
    scopeLimit,
  };
}

function classifyLaunchReadinessResult(result, globalResultsByQuery = new Map()) {
  const priority = getQueryPriority(result.query);
  const isRetailerSpecific = Boolean(result.retailer);
  const globalResult = globalResultsByQuery.get(result.query);
  const hasGlobalCoverage = Boolean(globalResult && globalResult.resultCount > 0);
  const topFiveSevereWrong = hasTopFiveSevereWrongResult(result);
  const missingPriceCount = countVisibleFlag(result, 'missingPrice');
  const missingQuantityCount = countVisibleFlag(result, 'missingQuantity');
  const missingValidityCount = countVisibleFlag(result, 'unsafeOrMissingValidity');
  const validityOnlyWatch = missingValidityCount > 0 &&
    missingPriceCount === 0 &&
    missingQuantityCount === 0 &&
    !topFiveSevereWrong &&
    result.severeIssueCount === 0;

  if (topFiveSevereWrong) {
    return buildReadinessItem(result, {
      readinessClass: 'launch_blocker',
      failReasons: ['fail_severe_wrong_results'],
      recommendation: `Fix wrong-category Top 5 results for ${formatResultLabel(result)} before MVP launch.`,
    });
  }

  if (result.resultCount === 0) {
    if (priority === 'low') {
      return buildReadinessItem(result, {
        readinessClass: 'acceptable_mvp_gap',
        failReasons: ['fail_zero_results'],
        scopeLimit: `${result.query} is optional MVP scope; expose it as not covered instead of claiming coverage.`,
      });
    }

    if (isRetailerSpecific && hasGlobalCoverage) {
      return buildReadinessItem(result, {
        readinessClass: 'acceptable_mvp_gap',
        failReasons: ['fail_zero_results', 'fail_retailer_specific_gap'],
        scopeLimit: `${formatResultLabel(result)} has no retailer-specific result; keep retailer-level coverage explicit in MVP.`,
      });
    }

    if (priority === 'high') {
      return buildReadinessItem(result, {
        readinessClass: 'launch_blocker',
        failReasons: ['fail_zero_results'],
        recommendation: `Restore at least plausible global coverage for high-priority query ${result.query}.`,
      });
    }

    return buildReadinessItem(result, {
      readinessClass: 'launch_watch',
      failReasons: ['fail_zero_results'],
      recommendation: `Check whether ${formatResultLabel(result)} belongs in MVP launch coverage.`,
    });
  }

  if (result.status === 'fail' && (missingPriceCount > 0 || missingQuantityCount > 0)) {
    return buildReadinessItem(result, {
      readinessClass: 'launch_blocker',
      failReasons: ['fail_missing_core_fields'],
      recommendation: `Fix missing core price or quantity fields for ${formatResultLabel(result)} before launch.`,
    });
  }

  if (validityOnlyWatch) {
    return buildReadinessItem(result, {
      readinessClass: 'launch_watch',
      failReasons: ['fail_validity_watch_only'],
      recommendation: `Keep validity uncertainty visible and improve validity extraction for ${formatResultLabel(result)}.`,
    });
  }

  if (!isRetailerSpecific &&
    priority === 'high' &&
    result.resultCount > 0 &&
    result.resultCount < GLOBAL_LOW_RESULT_WATCH_THRESHOLD &&
    result.severeIssueCount === 0) {
    return buildReadinessItem(result, {
      readinessClass: 'launch_watch',
      failReasons: ['fail_too_few_results'],
      recommendation: `Monitor low but plausible high-priority coverage for ${result.query}; do not widen matching without evidence.`,
    });
  }

  if (isRetailerSpecific &&
    result.resultCount > 0 &&
    result.resultCount < 2 &&
    result.severeIssueCount === 0) {
    return buildReadinessItem(result, {
      readinessClass: 'launch_watch',
      failReasons: ['fail_too_few_results', 'fail_retailer_specific_gap'],
      recommendation: `Monitor thin retailer-specific coverage for ${formatResultLabel(result)}.`,
    });
  }

  if (result.status === 'watch') {
    return buildReadinessItem(result, {
      readinessClass: 'launch_watch',
      failReasons: missingValidityCount > 0 ? ['fail_validity_watch_only'] : ['fail_too_few_results'],
      recommendation: `Review watch-level quality signals for ${formatResultLabel(result)}.`,
    });
  }

  if (result.status === 'fail') {
    return buildReadinessItem(result, {
      readinessClass: 'launch_watch',
      failReasons: ['fail_missing_core_fields'],
      recommendation: `Review failed smoke result for ${formatResultLabel(result)} and decide whether it affects MVP scope.`,
    });
  }

  return null;
}

function decideStatus({ resultCount, visibleOffers }) {
  if (resultCount === 0) {
    return {
      status: 'fail',
      reasons: ['No active ranked offers returned for an important launch query/filter.'],
    };
  }

  const topFive = visibleOffers.slice(0, 5);
  const topFiveSevereSideHits = topFive.filter((offer) =>
    offer.qualityFlags?.likelySideHit && offer.qualityFlags?.sideHitEvidence?.severe
  ).length;
  const topFiveSideHits = topFive.filter((offer) => offer.qualityFlags?.likelySideHit).length;
  const severeIssueCount = getSevereIssueCount(visibleOffers);
  const missingCoreFieldCount =
    countFlags(visibleOffers, 'missingPrice') +
    countFlags(visibleOffers, 'missingQuantity') +
    countFlags(visibleOffers, 'unsafeOrMissingValidity');
  const reasons = [];

  if (topFiveSevereSideHits >= 2 || topFiveSideHits >= 3) {
    reasons.push('Top 5 contains multiple obvious side hits or wrong-category results.');
    return { status: 'fail', reasons };
  }

  if (severeIssueCount >= 3) {
    reasons.push('Visible Top 10 contains several severe launch-quality issues.');
    return { status: 'fail', reasons };
  }

  if (missingCoreFieldCount > 0) {
    reasons.push('Visible results are usable, but core fields or validity are incomplete/unsafe.');
    return { status: 'watch', reasons };
  }

  if (countFlags(visibleOffers, 'missingConditionWhenLikelyNeeded') > 0) {
    reasons.push('Some conditional offers need clearer UI-visible condition text.');
    return { status: 'watch', reasons };
  }

  if (countFlags(visibleOffers, 'lowSourceTrust') > 0 || countFlags(visibleOffers, 'likelySideHit') > 0) {
    reasons.push('Top results are mostly plausible, but source trust or side-hit risk needs monitoring.');
    return { status: 'watch', reasons };
  }

  return {
    status: 'pass',
    reasons: ['Top results are plausible with price, quantity and safe validity signals.'],
  };
}

function evaluateLaunchQualityResult({
  query,
  aliases = [],
  retailer = null,
  rankedOffers = [],
  resultCount = rankedOffers.length,
}) {
  const topOffers = rankedOffers.slice(0, DEFAULT_TOP_N);
  const duplicateKeys = findVisibleDuplicateKeys(topOffers);
  const visibleOffers = topOffers.map((offer, index) =>
    summarizeVisibleOffer({ query, offer, index, duplicateKeys })
  );
  const severeIssueCount = getSevereIssueCount(visibleOffers);
  const duplicateIssueCount = countFlags(visibleOffers, 'likelyDuplicateVisible');
  const missingCoreFieldCount =
    countFlags(visibleOffers, 'missingPrice') +
    countFlags(visibleOffers, 'missingQuantity') +
    countFlags(visibleOffers, 'unsafeOrMissingValidity');
  const statusDecision = decideStatus({ resultCount, visibleOffers });

  return {
    query,
    aliases,
    retailer,
    resultCount,
    top10IssueCount: visibleOffers.reduce((sum, offer) =>
      sum + Object.entries(offer.qualityFlags || {})
        .filter(([key, value]) => typeof value === 'boolean' && value && key !== 'needsManualReview')
        .length, 0),
    severeIssueCount,
    duplicateIssueCount,
    missingCoreFieldCount,
    sourceTrustSummary: buildSourceTrustSummary(visibleOffers),
    status: statusDecision.status,
    reasons: statusDecision.reasons,
    rankedOffers: visibleOffers,
  };
}

function buildRecommendedNextActions(queryResults = [], retailerQueryResults = []) {
  const allResults = queryResults.concat(retailerQueryResults);
  const actions = [];
  const failResults = allResults.filter((result) => result.status === 'fail');
  const sideHitResults = allResults.filter((result) =>
    result.rankedOffers.some((offer) => offer.qualityFlags?.likelySideHit)
  );
  const missingValidityResults = allResults.filter((result) =>
    result.rankedOffers.some((offer) => offer.qualityFlags?.unsafeOrMissingValidity)
  );
  const missingPriceResults = allResults.filter((result) =>
    result.rankedOffers.some((offer) => offer.qualityFlags?.missingPrice)
  );
  const duplicateResults = allResults.filter((result) =>
    result.rankedOffers.some((offer) => offer.qualityFlags?.likelyDuplicateVisible)
  );
  const conditionResults = allResults.filter((result) =>
    result.rankedOffers.some((offer) => offer.qualityFlags?.missingConditionWhenLikelyNeeded)
  );

  if (failResults.length > 0) {
    actions.push(`Review failed launch smokes first: ${failResults.slice(0, 6).map(formatResultLabel).join(', ')}.`);
  }

  if (sideHitResults.length > 0) {
    actions.push(`Tighten query side-hit handling for: ${sideHitResults.slice(0, 6).map(formatResultLabel).join(', ')}.`);
  }

  if (missingPriceResults.length > 0) {
    actions.push(`Inspect visible missing-price offers before launch: ${missingPriceResults.slice(0, 6).map(formatResultLabel).join(', ')}.`);
  }

  if (missingValidityResults.length > 0) {
    actions.push(`Keep validity uncertainty explicit in UI and prioritize safe validity extraction for: ${missingValidityResults.slice(0, 6).map(formatResultLabel).join(', ')}.`);
  }

  if (duplicateResults.length > 0) {
    actions.push(`Check response-level duplicate visibility for: ${duplicateResults.slice(0, 6).map(formatResultLabel).join(', ')}.`);
  }

  if (conditionResults.length > 0) {
    actions.push(`Improve condition text extraction/display for conditional offers in: ${conditionResults.slice(0, 6).map(formatResultLabel).join(', ')}.`);
  }

  if (actions.length === 0) {
    actions.push('No small launch blocker emerged from this smoke; keep monitoring with fresh crawls before MVP launch.');
  }

  return actions;
}

function formatResultLabel(result) {
  return result.retailer ? `${result.query}/${result.retailer.retailerName}` : result.query;
}

function buildSummary(queryResults, retailerQueryResults) {
  const allResults = queryResults.concat(retailerQueryResults);

  return {
    queriesChecked: queryResults.length,
    retailerFiltersChecked: retailerQueryResults.length,
    passCount: allResults.filter((result) => result.status === 'pass').length,
    watchCount: allResults.filter((result) => result.status === 'watch').length,
    failCount: allResults.filter((result) => result.status === 'fail').length,
    severeIssueCount: allResults.reduce((sum, result) => sum + result.severeIssueCount, 0),
  };
}

function uniqueNonEmpty(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildLaunchReadiness(queryResults = [], retailerQueryResults = []) {
  const globalResultsByQuery = new Map(queryResults.map((result) => [result.query, result]));
  const allResults = queryResults.concat(retailerQueryResults);
  const classifiedItems = allResults
    .map((result) => classifyLaunchReadinessResult(result, globalResultsByQuery))
    .filter(Boolean);
  const blockers = classifiedItems.filter((item) => item.readinessClass === 'launch_blocker');
  const watchItems = classifiedItems.filter((item) => item.readinessClass === 'launch_watch');
  const acceptableGaps = classifiedItems.filter((item) => item.readinessClass === 'acceptable_mvp_gap');
  const recommendedBeforeLaunchFixes = uniqueNonEmpty(blockers.concat(watchItems).map((item) => item.recommendation));
  const recommendedMvpScopeLimits = uniqueNonEmpty(acceptableGaps.map((item) => item.scopeLimit));

  return {
    status: blockers.length > 0 ? 'not_ready' : (watchItems.length > 0 ? 'watch' : 'ready'),
    blockerCount: blockers.length,
    watchCount: watchItems.length,
    acceptableGapCount: acceptableGaps.length,
    blockers,
    watchItems,
    acceptableGaps,
    recommendedBeforeLaunchFixes,
    recommendedMvpScopeLimits,
  };
}

async function runLaunchQualitySmoke({ databaseName = '', top = DEFAULT_TOP_N } = {}) {
  const queryResults = [];
  const retailerQueryResults = [];

  for (const queryConfig of LAUNCH_QUERIES) {
    const ranking = await buildOfferRanking({
      query: queryConfig.query,
      unit: 'all',
      limit: top,
    });

    queryResults.push(evaluateLaunchQualityResult({
      ...queryConfig,
      rankedOffers: ranking.rankedOffers || [],
      resultCount: ranking.summary?.resultCount ?? ranking.rankedOffers?.length ?? 0,
    }));
  }

  for (const retailer of LAUNCH_RETAILERS) {
    for (const queryConfig of LAUNCH_QUERIES) {
      const ranking = await buildOfferRanking({
        query: queryConfig.query,
        unit: 'all',
        retailers: retailer.retailerKey,
        limit: top,
      });

      retailerQueryResults.push(evaluateLaunchQualityResult({
        ...queryConfig,
        retailer,
        rankedOffers: ranking.rankedOffers || [],
        resultCount: ranking.summary?.resultCount ?? ranking.rankedOffers?.length ?? 0,
      }));
    }
  }

  const recommendedNextActions = buildRecommendedNextActions(queryResults, retailerQueryResults);
  const launchReadiness = buildLaunchReadiness(queryResults, retailerQueryResults);

  return {
    checkedAt: new Date().toISOString(),
    databaseName,
    ...buildSmokeReadOnlyContract(),
    summary: buildSummary(queryResults, retailerQueryResults),
    queryResults,
    retailerQueryResults,
    launchReadiness,
    recommendedNextActions,
  };
}

module.exports = {
  DEFAULT_TOP_N,
  LAUNCH_QUERIES,
  LAUNCH_RETAILERS,
  QUERY_PROFILES,
  QUERY_PRIORITIES,
  buildLaunchReadiness,
  buildOfferQualityFlags,
  buildRecommendedNextActions,
  buildSmokeReadOnlyContract,
  classifyLaunchReadinessResult,
  detectSideHit,
  evaluateLaunchQualityResult,
  findVisibleDuplicateKeys,
  runLaunchQualitySmoke,
  sourceTrust,
};
