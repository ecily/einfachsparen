const { normalizeTitleForMatch } = require('../crawl/sourceEvidence');
const {
  applyQueryMatch,
  dedupeFinalResponseOffers,
  dedupeVisibleCardResponseOffers,
  scoreOfferAgainstQuery,
} = require('../offers/offerRankingService');

const QUERY_TERMS = {
  butter: [
    'butter',
    'teebutter',
    'markenbutter',
    'suessrahmbutter',
    'sauerrahmbutter',
    'streichfett',
    'margarine',
  ],
  reis: [
    'reis',
    'basmati',
    'basmatireis',
    'jasmin',
    'jasminreis',
    'langkorn',
    'langkornreis',
    'risotto',
    'risottoreis',
    'milchreis',
  ],
  waschmittel: [
    'waschmittel',
    'ariel',
    'somat',
    'dr beckmann',
    'dr. beckmann',
    'persil',
    'lenor',
    'spee',
  ],
};

const BUTTER_SIDE_TOKENS = [
  'bodybutter',
  'buttercroissant',
  'buttergemuese',
  'buttergemuse',
  'butterkeks',
  'butterkaese',
  'butterkase',
  'buttermilch',
  'butterpinze',
  'erdnussbutter',
  'gewuerz',
  'gewuerzzubereitung',
  'kraeuterbutter',
  'krauterbutter',
  'lippenbalsam',
  'peanut',
];

const RICE_SIDE_TOKENS = [
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

const RICE_WEAK_TOKENS = ['milchreis', 'reisgericht', 'reischips', 'reiswaffel', 'reiswaffeln'];
const RICE_STRONG_TOKENS = [
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

const VARIANT_TOKENS = [
  'color',
  'classic',
  'pods',
  'pulver',
  'caps',
  'gel',
  'tabs',
  'all',
  'universal',
  'colorwaschmittel',
  'vollwaschmittel',
  'sensitiv',
  'sensitive',
  'platinum',
  'gold',
  'extra',
];

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeKey(value) {
  return normalizeTitleForMatch(value).replace(/\s+/g, '-');
}

function tokens(value) {
  return normalizeTitleForMatch(value).split(/\s+/).filter(Boolean);
}

function tokenSet(value) {
  return new Set(tokens(value));
}

function hasAnyToken(value, candidates = []) {
  const set = tokenSet(value);
  return candidates.some((candidate) => set.has(candidate) || [...set].some((token) => token.startsWith(candidate)));
}

function hasExactToken(value, candidates = []) {
  const set = tokenSet(value);
  return candidates.some((candidate) => set.has(candidate));
}

function offerText(offer = {}) {
  return [
    offer.title,
    offer.titleNormalized,
    offer.brand,
    offer.searchText,
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.subcategoryKey,
    offer.comparisonGroup,
    offer.quantityText,
  ].filter(Boolean).join(' ');
}

function categoryText(offer = {}) {
  return [
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.categoryKey,
    offer.subcategoryKey,
    offer.comparisonGroup,
  ].filter(Boolean).join(' ');
}

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function numberKey(value, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '';
}

function classifyButterOffer(offer = {}) {
  const title = `${offer.title || ''} ${offer.titleNormalized || ''}`;
  const text = offerText(offer);
  const category = categoryText(offer);
  const hasDairyCategory = hasAnyToken(category, ['milchprodukte', 'molkerei']);
  const hasButterCategory = hasAnyToken(category, ['butter']);
  const hardSide = hasAnyToken(text, BUTTER_SIDE_TOKENS);
  const realButter =
    !hardSide &&
    (
      hasExactToken(title, ['teebutter', 'markenbutter', 'suessrahmbutter', 'sauerrahmbutter']) ||
      (hasExactToken(title, ['butter']) && (hasDairyCategory || hasButterCategory))
    );
  const plausibleSpread = !hardSide && hasAnyToken(title, ['margarine', 'streichfett', 'butterschmalz']);

  if (realButter) {
    return { classification: 'true', reason: 'direct butter term with dairy/butter context' };
  }

  if (plausibleSpread) {
    return { classification: 'true', reason: 'plausible spread/fat replacement candidate' };
  }

  if (hardSide) {
    return { classification: 'sideHit', reason: 'butter token is part of a non-butter product term' };
  }

  if (hasAnyToken(text, QUERY_TERMS.butter)) {
    return { classification: 'unclear', reason: 'butter text signal without safe product context' };
  }

  return { classification: 'miss', reason: 'no butter signal' };
}

function classifyRiceOffer(offer = {}) {
  const title = `${offer.title || ''} ${offer.titleNormalized || ''}`;
  const text = offerText(offer);
  const titleTokens = tokenSet(title);
  const hardSide = hasAnyToken(text, RICE_SIDE_TOKENS);
  const weakRice = hasAnyToken(title, RICE_WEAK_TOKENS);
  const realRice = !hardSide && RICE_STRONG_TOKENS.some((candidate) => {
    if (candidate === 'reis') {
      return titleTokens.has('reis');
    }

    return titleTokens.has(candidate);
  });

  if (realRice) {
    return { classification: 'true', reason: 'direct rice product term in title' };
  }

  if (weakRice && !hardSide) {
    return { classification: 'weakTrue', reason: 'rice-adjacent product, not a staple rice pack' };
  }

  if (hardSide) {
    return { classification: 'sideHit', reason: 'rice query collided with pasta/sauce/canned-good context' };
  }

  if (hasExactToken(text, QUERY_TERMS.reis)) {
    return { classification: 'unclear', reason: 'rice signal without safe title product intent' };
  }

  return { classification: 'miss', reason: 'no rice signal' };
}

function priceKey(offer = {}) {
  return [
    numberKey(offer.priceCurrent?.amount, 2),
    normalizeKey(offer.priceCurrent?.currency || 'EUR'),
    numberKey(offer.normalizedUnitPrice?.amount, 4),
    normalizeKey(offer.normalizedUnitPrice?.unit || offer.comparableUnit || ''),
  ].join('|');
}

function quantityKey(offer = {}) {
  return [
    numberKey(offer.packCount, 0),
    numberKey(offer.unitValue, 3),
    normalizeKey(offer.unitType || ''),
    numberKey(offer.totalComparableAmount, 3),
    normalizeKey(offer.comparableUnit || offer.normalizedUnitPrice?.unit || ''),
    normalizeKey(offer.quantityText || ''),
  ].join('|');
}

function validityKey(offer = {}) {
  return [dateKey(offer.validFrom), dateKey(offer.validTo)].join('|');
}

function conditionKey(offer = {}) {
  return [
    normalizeKey(offer.effectiveDiscountType || offer.benefitType || ''),
    offer.customerProgramRequired ? 'program' : 'public',
    offer.hasConditions ? 'conditions' : 'no-conditions',
    offer.isMultiBuy ? 'multi-buy' : 'single',
    numberKey(offer.minimumPurchaseQty, 0),
    normalizeKey(offer.conditionsText || ''),
  ].join('|');
}

function productKey(offer = {}) {
  return normalizeKey(offer.comparisonSignature || offer.comparisonGroup || offer.titleNormalized || offer.title || '');
}

function variantSignature(offer = {}) {
  const set = tokenSet(`${offer.title || ''} ${offer.titleNormalized || ''} ${offer.comparisonGroup || ''}`);
  return VARIANT_TOKENS.filter((token) => set.has(token)).sort().join('|');
}

function strongDuplicateKey(offer = {}) {
  return [
    normalizeKey(offer.retailerKey || offer.retailerName || ''),
    productKey(offer),
    priceKey(offer),
    quantityKey(offer),
    validityKey(offer),
    conditionKey(offer),
    variantSignature(offer),
  ].join('::');
}

function looseProductKey(offer = {}) {
  return [
    normalizeKey(offer.retailerKey || offer.retailerName || ''),
    normalizeKey(offer.brand || ''),
    normalizeKey(offer.comparisonGroup || offer.titleNormalized || offer.title || ''),
  ].join('::');
}

function looseVariantKey(offer = {}) {
  return [
    variantSignature(offer),
    priceKey(offer),
    quantityKey(offer),
    validityKey(offer),
    conditionKey(offer),
  ].join('::');
}

function protectedDifferences(offers = []) {
  const checks = [
    ['sourceId', (offer) => String(offer.sourceId || '')],
    ['sourceType', (offer) => normalizeKey(offer.sourceType || '')],
    ['sourceUrl', (offer) => normalizeKey(offer.sourceUrl || '')],
    ['title', (offer) => normalizeKey(offer.title || offer.titleNormalized || '')],
    ['brand', (offer) => normalizeKey(offer.brand || '')],
    ['price', priceKey],
    ['quantity', quantityKey],
    ['validity', validityKey],
    ['conditions', conditionKey],
    ['comparisonGroup', (offer) => normalizeKey(offer.comparisonGroup || '')],
    ['dedupeKey', (offer) => normalizeKey(offer.dedupeKey || '')],
  ];

  return checks
    .filter(([, getValue]) => new Set(offers.map(getValue)).size > 1)
    .map(([label]) => label);
}

function summarizeOffer(offer = {}) {
  return {
    id: String(offer._id || ''),
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
    sourceId: String(offer.sourceId || ''),
    sourceType: offer.sourceType || '',
    sourceUrl: offer.sourceUrl || '',
    title: offer.title || '',
    brand: offer.brand || '',
    categoryPrimary: offer.categoryPrimary || '',
    categorySecondary: offer.categorySecondary || '',
    categoryKey: offer.categoryKey || '',
    subcategoryKey: offer.subcategoryKey || '',
    price: offer.priceCurrent?.amount ?? null,
    unitPrice: offer.normalizedUnitPrice?.amount ?? null,
    unit: offer.normalizedUnitPrice?.unit || offer.comparableUnit || '',
    quantityText: offer.quantityText || '',
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    comparisonGroup: offer.comparisonGroup || '',
    dedupeKey: offer.dedupeKey || '',
  };
}

function summarizeClassified(offer, classification, query) {
  return {
    ...summarizeOffer(offer),
    diagnosticClassification: classification.classification,
    diagnosticReason: classification.reason,
    rankingScore: scoreOfferAgainstQuery(offer, query),
  };
}

function buildQuerySection({ query, offers = [], ranking = null, classifier }) {
  const classified = offers
    .map((offer) => ({
      offer,
      classification: classifier(offer),
      score: scoreOfferAgainstQuery(offer, query),
    }))
    .filter((item) => item.classification.classification !== 'miss');
  const rankedMatches = applyQueryMatch(offers, query);
  const trueCandidates = classified
    .filter((item) => item.classification.classification === 'true')
    .sort((left, right) => right.score - left.score)
    .slice(0, 10)
    .map((item) => summarizeClassified(item.offer, item.classification, query));
  const weakCandidates = classified
    .filter((item) => item.classification.classification === 'weakTrue')
    .sort((left, right) => right.score - left.score)
    .slice(0, 10)
    .map((item) => summarizeClassified(item.offer, item.classification, query));
  const excludedByIntent = classified
    .filter((item) => ['true', 'weakTrue', 'unclear'].includes(item.classification.classification) && item.score <= 0)
    .slice(0, 10)
    .map((item) => summarizeClassified(item.offer, item.classification, query));
  const sideHitsCorrectlyExcluded = classified
    .filter((item) => item.classification.classification === 'sideHit')
    .slice(0, 10)
    .map((item) => summarizeClassified(item.offer, item.classification, query));

  return {
    inspectedTextMatchCount: offers.length,
    rankingSummary: ranking?.summary || null,
    rankingTopExamples: (ranking?.rankedOffers || []).slice(0, 10).map(summarizeOffer),
    rankedTextMatches: rankedMatches.slice(0, 10).map(summarizeOffer),
    trueCandidateCount: classified.filter((item) => item.classification.classification === 'true').length,
    weakCandidateCount: classified.filter((item) => item.classification.classification === 'weakTrue').length,
    sideHitCount: classified.filter((item) => item.classification.classification === 'sideHit').length,
    unclearCount: classified.filter((item) => item.classification.classification === 'unclear').length,
    excludedByIntentCount: excludedByIntent.length,
    trueButterCandidates: query === 'butter' ? trueCandidates : undefined,
    trueRiceCandidates: query === 'reis' ? trueCandidates : undefined,
    weakRiceCandidates: query === 'reis' ? weakCandidates : undefined,
    excludedByIntent,
    sideHitsCorrectlyExcluded,
    missingCoverageLikely: trueCandidates.length === 0,
  };
}

function buildWaschmittelDuplicates({ offers = [], ranking = null } = {}) {
  const groups = new Map();

  for (const offer of offers) {
    const key = strongDuplicateKey(offer);
    if (!key || key.split('::').some((part, index) => index <= 1 && !part)) {
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  }

  const duplicateGroups = [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const differences = protectedDifferences(group);
      const sourceIds = uniq(group.map((offer) => String(offer.sourceId || '')));
      const sourceTypes = uniq(group.map((offer) => offer.sourceType || ''));
      const titles = uniq(group.map((offer) => normalizeTitleForMatch(offer.title || offer.titleNormalized || '')));
      const reason = differences.length === 0
        ? 'same retailer, title/product, price, quantity, validity and conditions'
        : `strong identity fields match; differences observed in ${differences.join(', ')}`;

      return {
        classification: 'strongDuplicateCandidate',
        reason,
        count: group.length,
        sameSourceId: sourceIds.length <= 1,
        sameSourceType: sourceTypes.length <= 1,
        sourceIds,
        sourceTypes,
        normalizedTitles: titles,
        protectedDifferences: differences,
        offers: group.map(summarizeOffer),
      };
    })
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason, 'de'))
    .slice(0, 20);
  const strongIds = new Set(duplicateGroups.flatMap((group) => group.offers.map((offer) => offer.id)));
  const looseGroups = new Map();

  for (const offer of offers) {
    const key = looseProductKey(offer);
    if (!key || key.split('::').filter(Boolean).length < 2) {
      continue;
    }
    if (!looseGroups.has(key)) looseGroups.set(key, []);
    looseGroups.get(key).push(offer);
  }

  const reviewGroups = [...looseGroups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.filter((offer) => !strongIds.has(String(offer._id || ''))))
    .filter((group) => group.length > 1)
    .map((group) => {
      const differences = protectedDifferences(group);
      const variantKeys = uniq(group.map(looseVariantKey));
      const classification = variantKeys.length === 1 ? 'strongDuplicateCandidate' : 'variantOrSourceReview';

      return {
        classification,
        reason: classification === 'strongDuplicateCandidate'
          ? 'loose product key plus identical price, quantity, validity and conditions'
          : `same loose product/title family, but protected fields differ: ${differences.join(', ') || 'unknown'}`,
        count: group.length,
        sameSourceId: uniq(group.map((offer) => String(offer.sourceId || ''))).length <= 1,
        sameSourceType: uniq(group.map((offer) => offer.sourceType || '')).length <= 1,
        sourceIds: uniq(group.map((offer) => String(offer.sourceId || ''))),
        sourceTypes: uniq(group.map((offer) => offer.sourceType || '')),
        normalizedTitles: uniq(group.map((offer) => normalizeTitleForMatch(offer.title || offer.titleNormalized || ''))),
        protectedDifferences: differences,
        offers: group.map(summarizeOffer),
      };
    })
    .sort((left, right) => {
      const rank = { strongDuplicateCandidate: 2, variantOrSourceReview: 1 };
      return (rank[right.classification] || 0) - (rank[left.classification] || 0) || right.count - left.count;
    })
    .slice(0, 20);

  const combinedDuplicateGroups = [
    ...duplicateGroups,
    ...reviewGroups.filter((group) => group.classification === 'strongDuplicateCandidate'),
  ].slice(0, 20);
  const visibleRankingDuplicateGroups = buildVisibleRankingDuplicateGroups(ranking?.rankedOffers || []);
  const responseDedupeSimulation = buildResponseDedupeSimulation({
    offers,
    limit: ranking?.summary?.requestedDisplay || ranking?.summary?.displayedCount || 60,
  });

  return {
    inspectedTextMatchCount: offers.length,
    rankingSummary: ranking?.summary || null,
    rankingTopExamples: (ranking?.rankedOffers || []).slice(0, 12).map(summarizeOffer),
    duplicateGroups: combinedDuplicateGroups,
    duplicateGroupCount: combinedDuplicateGroups.length,
    strictDuplicateGroupCount: duplicateGroups.length,
    reviewGroups,
    reviewGroupCount: reviewGroups.length,
    visibleRankingDuplicateGroups,
    visibleRankingDuplicateGroupCount: visibleRankingDuplicateGroups.length,
    responseDedupeSimulation,
  };
}

function offerId(offer = {}) {
  return String(offer._id || offer.id || '');
}

function buildResponseDedupeSimulation({ offers = [], limit = 60 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 60, 200));
  const before = applyQueryMatch(offers, 'waschmittel').slice(0, safeLimit);
  const afterFirstStage = dedupeFinalResponseOffers(before, 'waschmittel');
  const secondStage = dedupeVisibleCardResponseOffers(afterFirstStage, 'waschmittel', { collectDiagnostics: true });
  const after = secondStage.offers;
  const beforeGroups = buildVisibleRankingDuplicateGroups(before);
  const afterGroups = buildVisibleRankingDuplicateGroups(after);
  const afterIds = new Set(after.map(offerId).filter(Boolean));
  const collapsedGroups = beforeGroups
    .map((group) => {
      const collapsedOffers = group.offers.filter((offer) => offer.id && !afterIds.has(offer.id));

      return {
        ...group,
        collapsedOffers,
      };
    })
    .filter((group) => group.collapsedOffers.length > 0);
  const keptAsVariants = beforeGroups
    .filter((group) => group.protectedDifferences.some((field) => ['price', 'quantity', 'conditions', 'validity'].includes(field)))
    .filter((group) => group.offers.every((offer) => !offer.id || afterIds.has(offer.id)));

  return {
    simulatedInputCount: before.length,
    simulatedOutputCount: after.length,
    visibleRepeatCountBefore: beforeGroups.length,
    visibleRepeatCountAfter: afterGroups.length,
    strongCollapsedCount: before.length - afterFirstStage.length,
    secondStageCollapsedCount: secondStage.diagnostics.secondStageCollapsedCount,
    variantsKeptCount: keptAsVariants.length,
    examplesCollapsed: collapsedGroups.slice(0, 8).map((group) => ({
      reason: group.reason,
      countBefore: group.count,
      collapsedCount: group.collapsedOffers.length,
      kept: group.offers.filter((offer) => !offer.id || afterIds.has(offer.id)).slice(0, 2),
      collapsed: group.collapsedOffers.slice(0, 3),
    })),
    examplesSecondStageCollapsed: secondStage.diagnostics.examplesSecondStageCollapsed,
    examplesKeptBecauseVariant: secondStage.diagnostics.examplesKeptBecauseVariant,
    examplesKeptAsVariants: keptAsVariants.slice(0, 8),
  };
}

function buildVisibleRankingDuplicateGroups(rankedOffers = []) {
  const groups = new Map();

  for (const offer of rankedOffers) {
    const key = [
      normalizeKey(offer.retailerKey || offer.retailerName || ''),
      normalizeKey(offer.title || ''),
    ].join('::');

    if (!key || !offer.title) {
      continue;
    }

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      classification: protectedDifferences(group).length === 0 ? 'visibleStrongDuplicateCandidate' : 'visibleVariantOrSourceReview',
      reason: protectedDifferences(group).length === 0
        ? 'same visible ranking title/fingerprint'
        : `same visible ranking title, but protected fields differ: ${protectedDifferences(group).join(', ')}`,
      count: group.length,
      protectedDifferences: protectedDifferences(group),
      offers: group.map(summarizeOffer),
    }))
    .slice(0, 20);
}

function buildRecommendedNextActions({ butter, reis, waschmittelDuplicates }) {
  const actions = [];

  if (butter.trueCandidateCount === 0) {
    actions.push('Butter: likely DB/source coverage gap for active true butter/spread offers; do not loosen intent until a real excludedByIntent example appears.');
  } else if (butter.excludedByIntent.length > 0) {
    actions.push('Butter: review intent exclusions against listed true candidates before changing sources.');
  }

  if (reis.trueCandidateCount === 0) {
    actions.push('Reis: likely DB/source coverage gap for staple rice packs; current visible matches are rice-adjacent weak products.');
  } else if (reis.excludedByIntent.length > 0) {
    actions.push('Reis: review intent exclusions for listed true rice candidates.');
  }

  if (waschmittelDuplicates.duplicateGroupCount > 0) {
    actions.push('Waschmittel: smallest safe next fix is response/storage dedupe only for strong duplicate keys with identical price, quantity, validity and conditions; keep source evidence.');
  } else if (waschmittelDuplicates.visibleRankingDuplicateGroupCount > 0) {
    actions.push('Waschmittel: visible response repeats exist; smallest safe next fix is response-only dedupe for identical visible fingerprints, with variants kept separate.');
  } else if (waschmittelDuplicates.reviewGroupCount > 0) {
    actions.push('Waschmittel: visible repeats are review groups, not strong duplicates; first compare protected differences before enabling any merge.');
  }

  return actions;
}

function buildQueryQualityGapsDiagnostic({
  checkedAt = new Date(),
  butterOffers = [],
  reisOffers = [],
  waschmittelOffers = [],
  rankings = {},
} = {}) {
  const butter = buildQuerySection({
    query: 'butter',
    offers: butterOffers,
    ranking: rankings.butter,
    classifier: classifyButterOffer,
  });
  const reis = buildQuerySection({
    query: 'reis',
    offers: reisOffers,
    ranking: rankings.reis,
    classifier: classifyRiceOffer,
  });
  const waschmittelDuplicates = buildWaschmittelDuplicates({
    offers: waschmittelOffers,
    ranking: rankings.waschmittel,
  });

  return {
    checkedAt: checkedAt instanceof Date ? checkedAt.toISOString() : checkedAt,
    readOnly: true,
    mutatedCollections: [],
    performanceSafe: true,
    butter,
    reis,
    waschmittelDuplicates,
    recommendedNextActions: buildRecommendedNextActions({ butter, reis, waschmittelDuplicates }),
  };
}

module.exports = {
  QUERY_TERMS,
  buildQueryQualityGapsDiagnostic,
  buildRecommendedNextActions,
  buildWaschmittelDuplicates,
  buildResponseDedupeSimulation,
  classifyButterOffer,
  classifyRiceOffer,
  strongDuplicateKey,
  summarizeOffer,
};
