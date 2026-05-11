const Offer = require('../../models/Offer');
const Source = require('../../models/Source');
const {
  buildOfferRanking,
  buildRankingCandidateQueryMetadata,
  normalizeSearchText,
  scoreOfferAgainstQuery,
} = require('../offers/offerRankingService');

const QUERY_MAX_TIME_MS = 1500;
const DEFAULT_LIMIT = 800;

const CORE_PRODUCT_QUERIES = [
  {
    key: 'butter',
    query: 'butter',
    trueTerms: ['butter', 'teebutter', 'markenbutter', 'suessrahmbutter', 'sauerrahmbutter', 'streichfett', 'margarine', 'butterschmalz'],
    sideTerms: ['almond butter', 'butterkeks', 'buttercroissant', 'butterpinze', 'buttermilch', 'butterkaese', 'buttergemuese', 'croissant', 'cookie', 'keks', 'kraeuterbutter', 'kakaobutter', 'laugencroissant', 'bodybutter', 'lippenbalsam', 'peanut', 'protein cookie'],
    requiredContext: ['milchprodukte', 'molkerei', 'butter', 'aufstrich', 'grundnahrungsmittel'],
  },
  {
    key: 'milch',
    query: 'milch',
    trueTerms: ['trinkmilch', 'frischmilch', 'haltbarmilch', 'vollmilch', 'heumilch', 'biomilch', 'bergbauernmilch', 'laktosefreie milch'],
    sideTerms: ['milchschokolade', 'vollmilch schokolade', 'schokolade', 'kaese', 'kase', 'camembert', 'gouda', 'edamer', 'emmentaler', 'buttermilch', 'milchreis', 'pudding', 'kuchen', 'broetle', 'seife', 'lippenbalsam'],
    requiredContext: ['milchprodukte', 'molkerei', 'milch'],
  },
  {
    key: 'reis',
    query: 'reis',
    trueTerms: ['reis', 'basmati', 'basmatireis', 'jasminreis', 'langkornreis', 'risotto', 'risottoreis', 'parboiled'],
    sideTerms: ['preis', 'reisekissen', 'reisematte', 'reiswaffel', 'reiswaffeln', 'reisdrink', 'milchreis', 'pasta', 'spaghetti', 'nudeln', 'bohnen', 'kichererbsen', 'passata', 'sugo'],
    requiredContext: ['reis', 'pasta', 'konserven', 'grundnahrungsmittel'],
  },
  {
    key: 'nudeln',
    query: 'nudeln',
    trueTerms: ['nudel', 'nudeln', 'pasta', 'spaghetti', 'penne', 'fusilli', 'makkaroni', 'maccheroni', 'tagliatelle', 'bavette', 'teigwaren'],
    sideTerms: ['mohnnudeln', 'germknoedel', 'germknodel', 'topfennockerl', 'suesse nudeln'],
    requiredContext: ['pasta', 'konserven', 'grundnahrungsmittel'],
  },
  {
    key: 'eier',
    query: 'eier',
    trueTerms: ['eier', 'ei', 'freilandeier', 'bodenhaltung', 'bioeier'],
    sideTerms: ['eierlikoer', 'osterei', 'schokoeier', 'eiersalat', 'eiermuschel', 'eiermuschelsuppe', 'steiermark', 'suedsteiermark', 'schleierkraut'],
    requiredContext: ['grundnahrungsmittel', 'backen', 'lebensmittel'],
  },
  {
    key: 'kaese',
    query: 'kaese',
    trueTerms: ['kaese', 'kase', 'gouda', 'emmentaler', 'bergkaese', 'bergkase', 'mozzarella', 'feta', 'camembert', 'parmesan', 'edamer', 'frischkaese', 'frischkase'],
    sideTerms: ['kaesekrainer', 'kasekrainer', 'pizza', 'chips'],
    requiredContext: ['kaese', 'kase', 'milchprodukte', 'molkerei'],
  },
  {
    key: 'mehl',
    query: 'mehl',
    trueTerms: ['mehl', 'weizenmehl', 'dinkelmehl', 'roggenmehl', 'universalmehl', 'glatt', 'griffig'],
    sideTerms: ['paniermehl'],
    requiredContext: ['backen', 'grundnahrungsmittel'],
  },
  {
    key: 'zucker',
    query: 'zucker',
    trueTerms: ['zucker', 'kristallzucker', 'staubzucker', 'braunzucker', 'wuerfelzucker', 'gelierzucker'],
    sideTerms: ['zuckerfrei', 'zuckerl'],
    requiredContext: ['backen', 'grundnahrungsmittel'],
  },
  {
    key: 'oel',
    query: 'oel',
    trueTerms: ['oel', 'olivenoel', 'rapsoel', 'sonnenblumenoel', 'kuerbiskernoel', 'kurbiskernol', 'kronenoel'],
    sideTerms: ['motoroel', 'haaroel', 'duschgel', 'oleo', 'haarfarbe', 'coloration', 'thunfisch in oel', 'frischkaese mit oel'],
    requiredContext: ['oele', 'oele gewuerze', 'saucen', 'gewuerze', 'lebensmittel'],
  },
  {
    key: 'fleisch',
    query: 'fleisch',
    trueTerms: ['fleisch', 'rind', 'schwein', 'huhn', 'hendl', 'faschiertes', 'filet', 'schnitzel', 'steak', 'braten'],
    sideTerms: ['fleischersatz', 'vegan', 'hundefutter', 'katzenfutter', 'zahnfleisch', 'mundpflege', 'mundspuelung', 'fleischtomaten', 'tomatenpflanzen', 'moussaka'],
    requiredContext: ['fleisch', 'wurst', 'fisch', 'lebensmittel'],
  },
  {
    key: 'gemuese',
    query: 'gemuese',
    trueTerms: ['gemuese', 'gemuse', 'tomaten', 'gurken', 'paprika', 'karotten', 'salat', 'zucchini', 'brokkoli', 'kartoffeln', 'zwiebeln'],
    sideTerms: ['gemuesesuppe', 'gewuerz', 'thunfisch in gemuese', 'mit gemuese', 'pflanzen', 'salatpflanzen'],
    requiredContext: ['obst', 'gemuese', 'frisch'],
  },
  {
    key: 'obst',
    query: 'obst',
    trueTerms: ['obst', 'aepfel', 'apfel', 'bananen', 'orange', 'orangen', 'erdbeeren', 'trauben', 'birnen', 'kiwi'],
    sideTerms: ['obstgarten', 'obstriegel', 'geschirrspuel', 'geschirr', 'tabs', 'pflanzen', 'salatpflanzen'],
    requiredContext: ['obst', 'gemuese', 'frisch'],
  },
];

function compact(values = []) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function normalizeTerm(value) {
  return normalizeSearchText(value);
}

function normalizeWords(value) {
  const normalized = normalizeTerm(value);
  return normalized ? ` ${normalized} ` : ' ';
}

function includesPhrase(value, term) {
  return normalizeWords(value).includes(` ${normalizeTerm(term)} `);
}

function hasAnyPhrase(value, terms = []) {
  return terms.some((term) => includesPhrase(value, term));
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
    Array.isArray(offer.searchTokens) ? offer.searchTokens.join(' ') : '',
  ]).join(' ');
}

function titleText(offer = {}) {
  return compact([offer.title, offer.titleNormalized, offer.brand, offer.comparisonGroup]).join(' ');
}

function categoryText(offer = {}) {
  return compact([offer.categoryPrimary, offer.categorySecondary, offer.categoryKey, offer.subcategoryKey, offer.comparisonGroup]).join(' ');
}

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function priceSummary(price = {}) {
  return {
    amount: price?.amount ?? null,
    currency: price?.currency || 'EUR',
    originalText: price?.originalText || '',
  };
}

function referenceSummary(offer = {}) {
  return {
    amount: offer.priceReference?.amount ?? null,
    source: offer.priceReferenceSource || '',
    confidence: offer.priceReferenceConfidence ?? null,
    savingsDisplayType: offer.savingsDisplayType || '',
    savingsConfidence: offer.savingsConfidence ?? null,
  };
}

function sourceKeyForOffer(offer = {}, source = {}) {
  return offer.sourceKey ||
    offer.rawFacts?.sourceKey ||
    offer.rawFacts?.sourceMetadata?.sourceKey ||
    source.sourceKey ||
    source.label ||
    '';
}

function channelForOffer(offer = {}, source = {}) {
  return offer.channel ||
    offer.rawFacts?.channel ||
    offer.rawFacts?.sourceMetadata?.channel ||
    source.channel ||
    '';
}

function summarizeOffer(offer = {}, { source = {}, query = '', classification = null, removedReason = '' } = {}) {
  return {
    id: String(offer._id || offer.id || ''),
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
    title: offer.title || '',
    categoryPrimary: offer.categoryPrimary || '',
    categorySecondary: offer.categorySecondary || '',
    categoryKey: offer.categoryKey || '',
    subcategoryKey: offer.subcategoryKey || '',
    sourceKey: sourceKeyForOffer(offer, source),
    sourceType: offer.sourceType || source.sourceType || '',
    channel: channelForOffer(offer, source),
    sourceId: String(offer.sourceId || source._id || ''),
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    validityLabel: offer.validityLabel || offer.rawFacts?.validityLabel || offer.rawFacts?.validityText || '',
    price: priceSummary(offer.priceCurrent),
    referencePrice: referenceSummary(offer),
    conditionsText: offer.conditionsText || '',
    searchTokens: Array.isArray(offer.searchTokens) ? offer.searchTokens.slice(0, 24) : [],
    rankingScore: query ? scoreOfferAgainstQuery(offer, query) : null,
    diagnosticClassification: classification?.classification || '',
    diagnosticReason: classification?.reason || '',
    removedReason,
  };
}

function classifyCoreOffer(offer = {}, definition = {}) {
  const text = offerText(offer);
  const title = titleText(offer);
  const category = categoryText(offer);
  const side = hasAnyPhrase(text, definition.sideTerms);
  const titleTrue = hasAnyPhrase(title, definition.trueTerms);
  const textTrue = hasAnyPhrase(text, definition.trueTerms);
  const context = hasAnyPhrase(category, definition.requiredContext);

  if (definition.key === 'reis' && hasAnyPhrase(text, ['preis', 'stattpreis'])) {
    return { classification: 'sideHit', reason: 'price/preis token must not satisfy rice intent' };
  }

  if (definition.key === 'milch' && side) {
    return { classification: 'sideHit', reason: 'milk token appears in chocolate/cheese/dessert or non-drinking-milk context' };
  }

  if (definition.key === 'butter' && side) {
    return { classification: 'sideHit', reason: 'butter token appears in pastry/cosmetics/peanut or seasoning context' };
  }

  if (['eier', 'oel', 'fleisch', 'gemuese', 'obst'].includes(definition.key) && side) {
    return { classification: 'sideHit', reason: 'query token appears in a prepared false-positive context' };
  }

  if (side && !titleTrue) {
    return { classification: 'sideHit', reason: 'query token appears in a known side-hit product context' };
  }

  if (titleTrue && (context || !side)) {
    return { classification: 'true', reason: context ? 'title product term with category context' : 'title product term' };
  }

  if (textTrue) {
    return { classification: 'unclear', reason: 'text/token signal exists outside safe title intent' };
  }

  return { classification: 'miss', reason: 'no product signal' };
}

function buildActiveMatch() {
  const now = new Date();

  return {
    $or: [
      { status: 'active', isActiveNow: true },
      { isActiveNow: true },
      { isActiveToday: true },
      {
        status: 'active',
        $or: [{ validTo: { $gte: now } }, { validTo: null }],
      },
    ],
  };
}

function regexForTerms(terms = []) {
  const escaped = terms.map((term) => String(term || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
  return new RegExp(escaped.join('|'), 'i');
}

function buildTextMatch(definition) {
  const regex = regexForTerms([...definition.trueTerms, ...definition.sideTerms, definition.query]);
  const searchTokens = [
    normalizeTerm(definition.query),
    ...definition.trueTerms.map(normalizeTerm),
    ...definition.sideTerms.map(normalizeTerm),
  ].filter(Boolean);

  return {
    ...buildActiveMatch(),
    $and: [
      {
        $or: [
          { searchTokens: { $in: searchTokens } },
          { title: regex },
          { titleNormalized: regex },
          { comparisonGroup: regex },
        ],
      },
    ],
  };
}

function selectOfferFields() {
  return [
    '_id',
    'retailerKey',
    'retailerName',
    'sourceId',
    'sourceType',
    'sourceKey',
    'title',
    'titleNormalized',
    'brand',
    'searchText',
    'searchTokens',
    'searchTokenVersion',
    'categoryPrimary',
    'categorySecondary',
    'categoryKey',
    'subcategoryKey',
    'comparisonGroup',
    'sourceUrl',
    'validFrom',
    'validTo',
    'status',
    'isActiveNow',
    'isActiveToday',
    'priceCurrent',
    'priceReference',
    'priceReferenceSource',
    'priceReferenceConfidence',
    'savingsDisplayType',
    'savingsConfidence',
    'conditionsText',
    'normalizedUnitPrice',
    'comparableUnit',
    'rawFacts.sourceKey',
    'rawFacts.channel',
    'rawFacts.validityLabel',
    'rawFacts.validityText',
    'rawFacts.sourceMetadata',
  ].join(' ');
}

async function fetchActiveSignalOffers(definition, limit = DEFAULT_LIMIT) {
  return Offer.find(buildTextMatch(definition))
    .select(selectOfferFields())
    .sort({ sortScoreDefault: -1, retailerName: 1, title: 1 })
    .limit(limit)
    .maxTimeMS(QUERY_MAX_TIME_MS * 2)
    .lean();
}

async function fetchOffersByIds(ids = []) {
  const uniqueIds = [...new Set(ids.map(String).filter(Boolean))];

  if (uniqueIds.length === 0) {
    return [];
  }

  return Offer.find({ _id: { $in: uniqueIds } })
    .select(selectOfferFields())
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

async function fetchSourcesByIds(ids = []) {
  const uniqueIds = [...new Set(ids.map(String).filter(Boolean))];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const sources = await Source.find({ _id: { $in: uniqueIds } })
    .select('_id label sourceType channel sourceUrl retailerKey retailerName')
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();

  return new Map(sources.map((source) => [String(source._id || ''), source]));
}

function increment(map, key) {
  const cleanKey = key || 'unknown';
  map.set(cleanKey, (map.get(cleanKey) || 0) + 1);
}

function mapBreakdown(map) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, 'de'));
}

function buildBreakdowns(offers = [], sourcesById = new Map()) {
  const retailers = new Map();
  const categories = new Map();
  const sources = new Map();

  for (const offer of offers) {
    const source = sourcesById.get(String(offer.sourceId || '')) || {};
    increment(retailers, `${offer.retailerKey || 'unknown'}|${offer.retailerName || 'unknown'}`);
    increment(categories, `${offer.categoryKey || 'unknown'}|${offer.categoryPrimary || 'unknown'}|${offer.categorySecondary || 'unknown'}`);
    increment(sources, `${sourceKeyForOffer(offer, source) || 'unknown'}|${offer.sourceType || source.sourceType || 'unknown'}|${channelForOffer(offer, source) || 'unknown'}`);
  }

  return {
    retailerCoverage: mapBreakdown(retailers).map((row) => {
      const [retailerKey, retailerName] = row.key.split('|');
      return { retailerKey, retailerName, count: row.count };
    }),
    categoryCoverage: mapBreakdown(categories).map((row) => {
      const [categoryKey, categoryPrimary, categorySecondary] = row.key.split('|');
      return { categoryKey, categoryPrimary, categorySecondary, count: row.count };
    }),
    sourceCoverage: mapBreakdown(sources).map((row) => {
      const [sourceKey, sourceType, channel] = row.key.split('|');
      return { sourceKey, sourceType, channel, count: row.count };
    }),
  };
}

function stageByName(rankingResult, stageName) {
  return (rankingResult.diagnostics?.candidates?.stages || []).find((stage) => stage.stage === stageName) || null;
}

function inferZeroReason({ signalCount, trueCount, candidateCount, finalDisplayed, removedExamples = [] }) {
  if (finalDisplayed > 0) return 'has-results';
  if (signalCount === 0 && candidateCount === 0) return 'no-candidates-in-db';
  if (candidateCount === 0 && signalCount > 0) return 'tokens-missing-or-query-prefilter-excludes-db-signals';
  if (trueCount === 0 && signalCount > 0) return 'only-side-or-unclear-db-signals';
  if (removedExamples.some((item) => item.removedReason === 'scoreOfferAgainstQuery-zero')) return 'ranking-intent-postfilter-removed-candidates';
  if (removedExamples.some((item) => /dedupe|limit/.test(item.removedReason))) return 'dedupe-or-limit-removed-candidates';
  return 'ranking-or-postfilter-exclusion';
}

async function buildCoreProductCase(definition, { limit = DEFAULT_LIMIT } = {}) {
  const rankingResult = await buildOfferRanking({
    query: definition.query,
    limit: 20,
    diagnostics: true,
    debugCandidates: true,
  });
  const signalOffers = await fetchActiveSignalOffers(definition, limit);
  const beforeStage = stageByName(rankingResult, 'candidates-before-ranking');
  const finalStage = stageByName(rankingResult, 'final-api-like-results');
  const stageIds = [
    ...(beforeStage?.top || []).map((item) => item.id),
    ...(finalStage?.top || []).map((item) => item.id),
  ];
  const stageOffers = await fetchOffersByIds(stageIds);
  const allSourceIds = [
    ...signalOffers.map((offer) => String(offer.sourceId || '')),
    ...stageOffers.map((offer) => String(offer.sourceId || '')),
  ];
  const sourcesById = await fetchSourcesByIds(allSourceIds);
  const stageOfferById = new Map(stageOffers.map((offer) => [String(offer._id || ''), offer]));
  const classified = signalOffers
    .map((offer) => ({
      offer,
      classification: classifyCoreOffer(offer, definition),
      score: scoreOfferAgainstQuery(offer, definition.query),
    }))
    .filter((item) => item.classification.classification !== 'miss');
  const trueItems = classified.filter((item) => item.classification.classification === 'true');
  const sideItems = classified.filter((item) => item.classification.classification === 'sideHit');
  const unclearItems = classified.filter((item) => item.classification.classification === 'unclear');
  const removedExamples = (rankingResult.diagnostics?.candidates?.stages || [])
    .flatMap((stage) => (stage.removed || []).map((item) => ({
      ...item,
      stage: stage.stage,
    })))
    .slice(0, 30);

  return {
    key: definition.key,
    query: definition.query,
    queryTokens: buildRankingCandidateQueryMetadata({ query: definition.query }).queryTokens,
    candidateQueryMode: rankingResult.diagnostics?.mongo?.queryMetadata?.candidateQueryMode || '',
    fallbackUsed: Boolean(rankingResult.diagnostics?.mongo?.queryMetadata?.fallbackUsed),
    resultCount: rankingResult.response?.summary?.resultCount ?? null,
    finalDisplayed: rankingResult.response?.summary?.displayedCount ?? null,
    candidateCountBeforeRanking: rankingResult.response?.summary?.candidateCount ?? null,
    dbSignalCount: classified.length,
    likelyTrueDbSignalCount: trueItems.length,
    sideHitDbSignalCount: sideItems.length,
    unclearDbSignalCount: unclearItems.length,
    zeroOrWeakReason: inferZeroReason({
      signalCount: classified.length,
      trueCount: trueItems.length,
      candidateCount: rankingResult.response?.summary?.candidateCount || 0,
      finalDisplayed: rankingResult.response?.summary?.displayedCount || 0,
      removedExamples,
    }),
    topCandidatesBeforeRanking: (beforeStage?.top || []).slice(0, 20).map((candidate) => {
      const offer = stageOfferById.get(String(candidate.id)) || candidate;
      return summarizeOffer(offer, {
        source: sourcesById.get(String(offer.sourceId || '')) || {},
        query: definition.query,
      });
    }),
    finalResults: (rankingResult.response?.rankedOffers || []).slice(0, 20).map((offer) => summarizeOffer(offer, {
      query: definition.query,
    })),
    topDbSignals: classified
      .sort((left, right) => right.score - left.score)
      .slice(0, 20)
      .map((item) => summarizeOffer(item.offer, {
        source: sourcesById.get(String(item.offer.sourceId || '')) || {},
        query: definition.query,
        classification: item.classification,
      })),
    removedOrDedupedCandidates: removedExamples.map((item) => {
      const offer = stageOfferById.get(String(item.id)) || { _id: item.id };
      return summarizeOffer(offer, {
        source: sourcesById.get(String(offer.sourceId || '')) || {},
        query: definition.query,
        removedReason: item.reason,
      });
    }),
    ...buildBreakdowns(classified.map((item) => item.offer), sourcesById),
  };
}

async function buildCoreProductCoverageDiagnostic({ limit = DEFAULT_LIMIT } = {}) {
  const cases = [];

  for (const definition of CORE_PRODUCT_QUERIES) {
    cases.push(await buildCoreProductCase(definition, { limit }));
  }

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: new Date().toISOString(),
    cases,
  };
}

function parseArgs(argv = []) {
  const options = {
    json: false,
    limit: DEFAULT_LIMIT,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const limit = Number(arg.slice('--limit='.length));
      if (Number.isInteger(limit) && limit >= 100 && limit <= 3000) {
        options.limit = limit;
      }
    }
  }

  return options;
}

module.exports = {
  CORE_PRODUCT_QUERIES,
  buildCoreProductCoverageDiagnostic,
  buildCoreProductCase,
  classifyCoreOffer,
  inferZeroReason,
  parseArgs,
};
