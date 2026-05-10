const { normalizeTitleForMatch } = require('../crawl/sourceEvidence');
const {
  applyQueryMatch,
  dedupeFinalResponseOffers,
  dedupeVisibleCardResponseOffers,
  scoreOfferAgainstQuery,
} = require('../offers/offerRankingService');
const {
  classifyButterOffer,
  classifyRiceOffer,
  summarizeOffer,
} = require('./queryQualityGapsDiagnostic');

const CASES = {
  butter: {
    queryCase: 'butter',
    rankingQuery: 'butter',
    terms: [
      'butter',
      'teebutter',
      'markenbutter',
      'alpenbutter',
      'suessrahmbutter',
      'sauerrahmbutter',
      'streichbutter',
      'streichfett',
      'margarine',
    ],
    classify: classifyButterOffer,
  },
  reis: {
    queryCase: 'reis',
    rankingQuery: 'reis',
    terms: [
      'reis',
      'basmati',
      'jasmin',
      'langkorn',
      'rundkorn',
      'risotto',
      'milchreis',
      'parboiled',
    ],
    classify: classifyRiceOffer,
  },
  'spar-kaffee': {
    queryCase: 'spar-kaffee',
    rankingQuery: 'kaffee',
    rankingRetailers: 'spar',
    rankingCategories: 'Kaffee & Tee',
    terms: [
      'kaffee',
      'cafe',
      'caffe',
      'cappuccino',
      'espresso',
      'tassimo',
      'nescafe',
      'meinl',
      'dallmayr',
      'regio gold',
      'cafe royal',
      'coffee',
    ],
    classify: classifyCoffeeOffer,
  },
};

const COFFEE_TRUE_TERMS = [
  'kaffee',
  'cafe',
  'caffe',
  'cappuccino',
  'espresso',
  'tassimo',
  'nescafe',
  'nescafé',
  'meinl',
  'dallmayr',
  'regio',
  'royal',
  'coffee',
];

const COFFEE_SIDE_TERMS = [
  'eiskaffee',
  'duft',
  'duftgeranie',
  'pflanze',
  'zierpflanze',
  'tomate',
  'erdbeere',
  'banane',
];

function normalizeTokenText(value) {
  return normalizeTitleForMatch(value).replace(/\s+/g, ' ').trim();
}

function compact(values = []) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function offerText(offer = {}) {
  return compact([
    offer.title,
    offer.titleNormalized,
    offer.brand,
    offer.searchText,
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.categoryKey,
    offer.subcategoryKey,
    offer.comparisonGroup,
    offer.sourceRetailerFormat,
    offer.retailerFormatLabel,
  ]).join(' ');
}

function hasTerm(text, terms = []) {
  const normalized = ` ${normalizeTokenText(text)} `;
  return terms.some((term) => normalized.includes(` ${normalizeTokenText(term)} `));
}

function classifyCoffeeOffer(offer = {}) {
  const text = offerText(offer);
  const category = normalizeTokenText([
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.categoryKey,
    offer.subcategoryKey,
    offer.comparisonGroup,
  ].join(' '));
  const hasCoffee = hasTerm(text, COFFEE_TRUE_TERMS);
  const hardSide = hasTerm(text, COFFEE_SIDE_TERMS);
  const coffeeContext = hasTerm(category, ['kaffee', 'tee', 'fruehstueck', 'getraenke', 'getranke']);

  if (hardSide) {
    return { classification: 'sideHit', reason: 'coffee token appears in a non-coffee context' };
  }

  if (hasCoffee) {
    return {
      classification: 'true',
      reason: coffeeContext ? 'coffee signal with category context' : 'coffee product or brand signal',
    };
  }

  return { classification: 'miss', reason: 'no coffee signal' };
}

function isSparOffer(offer = {}) {
  return hasTerm([
    offer.retailerKey,
    offer.retailerName,
    offer.sourceRetailerName,
    offer.sourceRetailerFormat,
    offer.retailerFormatLabel,
    ...(offer.retailerFormats || []),
    ...(offer.appliesToRetailerFormats || []),
  ].join(' '), ['spar', 'interspar', 'eurospar']);
}

function sourceInfo(offer = {}, source = {}) {
  const metadata = offer.rawFacts?.sourceMetadata || {};

  return {
    sourceType: offer.sourceType || source.sourceType || metadata.sourceType || '',
    sourceKey: offer.sourceKey || offer.rawFacts?.sourceKey || metadata.sourceKey || '',
    sourceId: String(offer.sourceId || source._id || ''),
    sourceUrl: offer.sourceUrl || source.sourceUrl || metadata.sourceUrl || '',
    sourceName: source.label || metadata.label || offer.rawFacts?.sourceName || '',
  };
}

function summarizeCoverageOffer(offer = {}, { classification = null, source = null, query = '' } = {}) {
  const base = summarizeOffer(offer);

  return {
    ...base,
    sourceRetailerFormat: offer.sourceRetailerFormat || '',
    retailerFormatLabel: offer.retailerFormatLabel || '',
    appliesToRetailerFormats: offer.appliesToRetailerFormats || [],
    sourceKey: offer.sourceKey || offer.rawFacts?.sourceKey || offer.rawFacts?.sourceMetadata?.sourceKey || '',
    sourceName: source?.label || offer.rawFacts?.sourceMetadata?.label || '',
    validityLabel: offer.validityLabel || offer.rawFacts?.validityLabel || offer.rawFacts?.validityText || '',
    status: offer.status || '',
    isActiveNow: Boolean(offer.isActiveNow),
    isActiveToday: Boolean(offer.isActiveToday),
    priceCurrent: offer.priceCurrent?.amount ?? null,
    normalizedUnitPrice: offer.normalizedUnitPrice?.amount ?? null,
    normalizedUnit: offer.normalizedUnitPrice?.unit || offer.comparableUnit || '',
    comparisonSafe: Boolean(offer.quality?.comparisonSafe),
    diagnosticClassification: classification?.classification || '',
    diagnosticReason: classification?.reason || '',
    rankingScore: query ? scoreOfferAgainstQuery(offer, query) : null,
  };
}

function increment(map, key) {
  const normalizedKey = key || 'unknown';
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + 1);
}

function sortedBreakdown(map) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, 'de'));
}

function buildBreakdowns(offers = [], sourcesById = new Map()) {
  const retailers = new Map();
  const sources = new Map();
  const categories = new Map();
  const validity = {
    validFromPresent: 0,
    validToPresent: 0,
    validityLabelPresent: 0,
    validFromMissing: 0,
    validToMissing: 0,
    validityLabelMissing: 0,
  };

  for (const offer of offers) {
    const source = sourcesById.get(String(offer.sourceId || '')) || {};
    const sourceDetails = sourceInfo(offer, source);
    increment(retailers, `${offer.retailerKey || 'unknown'}|${offer.retailerName || 'unknown'}`);
    increment(sources, [
      sourceDetails.sourceType || 'unknown',
      sourceDetails.sourceKey || 'unknown',
      sourceDetails.sourceId || 'unknown',
      sourceDetails.sourceName || 'unknown',
    ].join('|'));
    increment(categories, [
      offer.categoryKey || 'unknown',
      offer.categoryPrimary || 'unknown',
      offer.categorySecondary || 'unknown',
      offer.comparisonGroup || 'unknown',
    ].join('|'));

    if (dateKey(offer.validFrom)) validity.validFromPresent += 1;
    else validity.validFromMissing += 1;
    if (dateKey(offer.validTo)) validity.validToPresent += 1;
    else validity.validToMissing += 1;
    if (offer.validityLabel || offer.rawFacts?.validityLabel || offer.rawFacts?.validityText) validity.validityLabelPresent += 1;
    else validity.validityLabelMissing += 1;
  }

  return {
    retailerBreakdown: sortedBreakdown(retailers).map((row) => {
      const [retailerKey, retailerName] = row.key.split('|');
      return { retailerKey, retailerName, count: row.count };
    }),
    sourceBreakdown: sortedBreakdown(sources).map((row) => {
      const [sourceType, sourceKey, sourceId, sourceName] = row.key.split('|');
      return { sourceType, sourceKey, sourceId, sourceName, count: row.count };
    }),
    categoryBreakdown: sortedBreakdown(categories).map((row) => {
      const [categoryKey, categoryMain, categorySecondary, comparisonGroup] = row.key.split('|');
      return { categoryKey, categoryMain, categorySecondary, comparisonGroup, count: row.count };
    }),
    validityCoverage: validity,
  };
}

function isCurrentlyEligible(offer = {}) {
  const now = Date.now();
  const validTo = offer.validTo ? new Date(offer.validTo).getTime() : null;
  const notExpired = validTo === null || Number.isNaN(validTo) || validTo >= now;

  return Boolean(
    (offer.status === 'active' && offer.isActiveNow) ||
    offer.isActiveToday ||
    (offer.status === 'active' && notExpired)
  );
}

function hasRankingPrice(offer = {}) {
  return offer.priceCurrent?.amount != null &&
    offer.normalizedUnitPrice?.amount != null &&
    offer.normalizedUnitPrice?.comparable === true &&
    Boolean(offer.comparableUnit || offer.normalizedUnitPrice?.unit);
}

function explainExclusion({ offer, queryCase, rankingQuery, classification, finalRankedIds, dedupedIds }) {
  const score = scoreOfferAgainstQuery(offer, rankingQuery);

  if (queryCase === 'spar-kaffee' && !isSparOffer(offer)) {
    return 'retailer-filter';
  }

  if (!isCurrentlyEligible(offer)) {
    return 'validity-filter';
  }

  if (queryCase === 'spar-kaffee' && offer.categoryKey && offer.categoryKey !== 'kaffee-tee') {
    return 'category-filter';
  }

  if (!hasRankingPrice(offer)) {
    return 'missing-price';
  }

  if (score <= 0) {
    return classification.classification === 'sideHit' ? 'side-hit-protection' : 'query-match-too-weak';
  }

  const id = String(offer._id || offer.id || '');
  if (dedupedIds.has(id) && !finalRankedIds.has(id)) {
    return 'dedupe-collapse';
  }

  if (!finalRankedIds.has(id)) {
    return 'ranking-exclusion';
  }

  return 'included';
}

function inferMissingLikelyReason({ trueCount, rankedCount, examples = [], queryCase, sparSourceSummary = null }) {
  if (trueCount === 0) {
    if (queryCase === 'spar-kaffee' && sparSourceSummary?.activeOfferCount > 0) return 'source-missing';
    return 'no-db-coverage';
  }

  const reasons = examples.map((item) => item.exclusionReason);

  if (rankedCount === 0 && reasons.includes('category-filter')) return 'wrong-category';
  if (rankedCount === 0 && reasons.includes('validity-filter')) return 'validity-filter';
  if (rankedCount === 0 && reasons.includes('dedupe-collapse')) return 'dedupe-collapse';
  if (rankedCount === 0) return 'ranking-exclusion';

  return 'unclear';
}

function recommendedActions({ queryCase, missingLikelyReason }) {
  const byCase = {
    butter: {
      'no-db-coverage': 'Butter: zuerst Source-/Crawl-Coverage fuer echte Butterangebote pruefen; Ranking nicht lockern, solange keine echten DB-Kandidaten vorliegen.',
      'wrong-category': 'Butter: Kategorie-/ComparisonGroup-Zuordnung echter Butterkandidaten pruefen.',
      'ranking-exclusion': 'Butter: Ranking-Query-Match und Side-Hit-Schutz gegen die gelisteten echten Kandidaten pruefen.',
      'validity-filter': 'Butter: Validity-Normalisierung fuer echte Butterkandidaten pruefen.',
      unclear: 'Butter: gelistete Kandidaten manuell gegen Source- und Ranking-Stufen vergleichen.',
    },
    reis: {
      'no-db-coverage': 'Reis: Source-/Parser-Coverage fuer Stapelreis-Packungen priorisieren; Reiswaffeln/Reischips nicht als Fixpfad verwenden.',
      'wrong-category': 'Reis: echte Reis-Packungen auf Kategorie/ComparisonGroup-Fehlklassifikation pruefen.',
      'ranking-exclusion': 'Reis: Query-Match fuer echte Reis-Packungen pruefen, ohne Side-Hit-Schutz fuer Pasta/Sugo zu lockern.',
      'validity-filter': 'Reis: Validity-Felder echter Reis-Packungen pruefen.',
      unclear: 'Reis: Samples nach Source und Kategorie manuell sichten.',
    },
    'spar-kaffee': {
      'source-missing': 'SPAR + Kaffee: SPAR-Quellenabdeckung/Parser fuer Flugblatt-Kaffeeangebote pruefen, nicht isoliert Ranking patchen.',
      'no-db-coverage': 'SPAR + Kaffee: klaeren, ob aktuelle SPAR-Quellen ueberhaupt Kaffeeangebote speichern.',
      'wrong-category': 'SPAR + Kaffee: Kategoriepfad Kaffee & Tee und SPAR-Formatfelder fuer vorhandene Kaffeeangebote pruefen.',
      'ranking-exclusion': 'SPAR + Kaffee: Retailer-/Kategorie-/Query-Filter gegen vorhandene SPAR-Kaffee-Kandidaten pruefen.',
      'validity-filter': 'SPAR + Kaffee: Validity fuer vorhandene SPAR-Kaffee-Angebote pruefen.',
      unclear: 'SPAR + Kaffee: SourceBreakdown mit aktuellen SPAR-Angeboten gegen sichtbares Flugblatt abgleichen.',
    },
  };

  return [byCase[queryCase]?.[missingLikelyReason] || byCase[queryCase]?.unclear || 'Naechste Diagnose anhand der Beispiele eingrenzen.'];
}

function buildCaseReport({
  queryCase,
  offers = [],
  sourcesById = new Map(),
  ranking = null,
  sparSourceSummary = null,
} = {}) {
  const definition = CASES[queryCase];
  const rankingQuery = definition.rankingQuery;
  const classified = offers.map((offer) => ({
    offer,
    classification: definition.classify(offer),
    score: scoreOfferAgainstQuery(offer, rankingQuery),
  })).filter((item) => item.classification.classification !== 'miss');
  const trueItems = classified.filter((item) => item.classification.classification === 'true');
  const sideItems = classified.filter((item) => item.classification.classification === 'sideHit');
  const weakItems = classified.filter((item) => item.classification.classification === 'weakTrue' || item.classification.classification === 'unclear');
  const activeOffers = offers.filter(isCurrentlyEligible);
  const queryMatched = applyQueryMatch(activeOffers, rankingQuery);
  const deduped = dedupeFinalResponseOffers(queryMatched, rankingQuery);
  const visible = dedupeVisibleCardResponseOffers(deduped, rankingQuery, { collectDiagnostics: true });
  const finalRankedIds = new Set((ranking?.rankedOffers || visible.offers).map((offer) => String(offer._id || offer.id || '')).filter(Boolean));
  const dedupedIds = new Set(deduped.map((offer) => String(offer._id || offer.id || '')).filter(Boolean));
  const examplesExcludedWithReason = classified
    .map((item) => ({
      ...summarizeCoverageOffer(item.offer, {
        classification: item.classification,
        source: sourcesById.get(String(item.offer.sourceId || '')) || {},
        query: rankingQuery,
      }),
      exclusionReason: explainExclusion({
        offer: item.offer,
        queryCase,
        rankingQuery,
        classification: item.classification,
        finalRankedIds,
        dedupedIds,
      }),
    }))
    .filter((item) => item.exclusionReason !== 'included')
    .slice(0, 20);
  const rankedResultCount = ranking?.summary?.displayedCount ?? ranking?.rankedOffers?.length ?? null;
  const missingLikelyReason = inferMissingLikelyReason({
    trueCount: trueItems.length,
    rankedCount: rankedResultCount || 0,
    examples: examplesExcludedWithReason,
    queryCase,
    sparSourceSummary,
  });

  return {
    queryCase,
    dbCandidateCount: classified.length,
    likelyTrueProductCount: trueItems.length,
    likelySideHitCount: sideItems.length,
    weakOrUnclearCount: weakItems.length,
    rankedResultCount,
    rankingFilters: ranking?.filters || {
      query: rankingQuery,
      retailers: definition.rankingRetailers ? [definition.rankingRetailers] : [],
      categories: definition.rankingCategories ? [definition.rankingCategories] : [],
    },
    topDbCandidates: classified
      .sort((left, right) => right.score - left.score)
      .slice(0, 20)
      .map((item) => summarizeCoverageOffer(item.offer, {
        classification: item.classification,
        source: sourcesById.get(String(item.offer.sourceId || '')) || {},
        query: rankingQuery,
      })),
    topRankedCandidates: (ranking?.rankedOffers || []).slice(0, 20).map((offer) =>
      summarizeCoverageOffer(offer, { query: rankingQuery })
    ),
    missingLikelyReason,
    ...buildBreakdowns(classified.map((item) => item.offer), sourcesById),
    rankingStageSimulation: {
      activeCandidateCount: activeOffers.length,
      queryMatchedCount: queryMatched.length,
      finalDedupeCount: deduped.length,
      visibleDedupeCount: visible.offers.length,
      visibleDedupeDiagnostics: visible.diagnostics,
    },
    examplesExcludedWithReason,
    sparSourceSummary: queryCase === 'spar-kaffee' ? sparSourceSummary : undefined,
    recommendedNextActions: recommendedActions({ queryCase, missingLikelyReason }),
  };
}

function buildCoverageBaselineDiagnostic({
  checkedAt = new Date(),
  caseOffers = {},
  sources = [],
  rankings = {},
  sparSourceSummary = null,
} = {}) {
  const sourcesById = new Map(sources.map((source) => [String(source._id || ''), source]));
  const cases = ['butter', 'reis', 'spar-kaffee'].map((queryCase) =>
    buildCaseReport({
      queryCase,
      offers: caseOffers[queryCase] || [],
      sourcesById,
      ranking: rankings[queryCase] || null,
      sparSourceSummary,
    })
  );

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    performanceSafe: true,
    checkedAt: checkedAt instanceof Date ? checkedAt.toISOString() : checkedAt,
    cases,
  };
}

module.exports = {
  CASES,
  buildCoverageBaselineDiagnostic,
  buildCaseReport,
  classifyCoffeeOffer,
  explainExclusion,
  isCurrentlyEligible,
  isSparOffer,
};
