const Offer = require('../../models/Offer');
const Retailer = require('../../models/Retailer');
const filterMetadataService = require('../filters/filterMetadataService');
const { buildOfferRanking } = require('../offers/offerRankingService');

const TOP_DEALS_RETAILER_KEYS = [
  'billa',
  'billa-plus',
  'lidl',
  'penny',
  'dm',
  'bipa',
  'mueller',
  'interspar',
];
const TOP_DEALS_LIMIT = 20000;
const EXPLAIN_MAX_TIME_MS = 15000;
const TOP_DEALS_PROJECTION = [
  'retailerKey',
  'status',
  'isActiveNow',
  'priceCurrent.amount',
  'priceReference.amount',
  'discountPercent',
  'rawFacts.discountPercentage',
  'rawFacts.discountPercent',
];
const FILTER_PROJECTION = filterMetadataService._private.PUBLIC_FACET_OFFER_SELECT_FIELDS;
const FILTER_MATCH = filterMetadataService._private.buildFilterMetadataOfferMatch;

function describeQueryShape(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') {
    return typeof value;
  }

  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => describeQueryShape(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      /secret|password|authorization|api[_-]?key/i.test(key) ? '[redacted-key]' : key,
      key === '$regex' ? '[regex]' : describeQueryShape(entry, seen),
    ])
  );
}

function walkPlan(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => walkPlan(item, visitor));
    else if (value && typeof value === 'object') walkPlan(value, visitor);
  }
}

function summarizeExplain({
  name,
  collection,
  explain,
  queryShape,
  limit,
  projectionFieldCount,
}) {
  const stats = explain?.executionStats || {};
  const stages = new Set();
  const indexNames = new Set();
  let hasCollscan = false;
  let hasSortStage = false;

  walkPlan(explain?.queryPlanner?.winningPlan, (node) => {
    if (node.stage) {
      stages.add(node.stage);
      if (node.stage === 'COLLSCAN') hasCollscan = true;
      if (node.stage === 'SORT' || node.stage === 'SORT_KEY_GENERATOR') hasSortStage = true;
    }
    if (node.indexName) indexNames.add(node.indexName);
  });

  return {
    name,
    collection,
    indexNames: [...indexNames],
    stages: [...stages],
    hasCollscan,
    hasSortStage,
    totalDocsExamined: stats.totalDocsExamined ?? null,
    totalKeysExamined: stats.totalKeysExamined ?? null,
    nReturned: stats.nReturned ?? null,
    executionTimeMillis: stats.executionTimeMillis ?? null,
    estimatedQueryShape: describeQueryShape(queryShape),
    limit: limit ?? null,
    projectionFieldCount: projectionFieldCount ?? 0,
  };
}

function buildFilterQuery({ model = Offer, categoryOnly = false } = {}) {
  const fields = categoryOnly
    ? FILTER_PROJECTION.filter((field) => field.includes('category') || field === 'retailerKey' || field === 'status' || field === 'isActiveNow')
    : FILTER_PROJECTION;

  return {
    query: model.find(FILTER_MATCH()).select(fields.join(' ')),
    shape: FILTER_MATCH(),
    fields,
    limit: null,
  };
}

function buildTopDealsQuery({ model = Offer } = {}) {
  const shape = {
    status: 'active',
    isActiveNow: true,
    'priceCurrent.amount': { $gt: 0 },
    $or: [
      { 'priceReference.amount': { $gt: 0 } },
      { discountPercent: { $gt: 0 } },
      { 'rawFacts.discountPercentage': { $gt: 0 } },
      { 'rawFacts.discountPercent': { $gt: 0 } },
    ],
    retailerKey: { $in: TOP_DEALS_RETAILER_KEYS },
  };

  return {
    query: model.find(shape).select(TOP_DEALS_PROJECTION.join(' ')).limit(TOP_DEALS_LIMIT),
    shape,
    fields: TOP_DEALS_PROJECTION,
    limit: TOP_DEALS_LIMIT,
  };
}

async function explainQuery({ name, model, query, shape, fields, limit }) {
  try {
    if (typeof query.maxTimeMS === 'function') {
      query.maxTimeMS(EXPLAIN_MAX_TIME_MS);
    }
    const explain = await query.explain('executionStats');
    return summarizeExplain({
      name,
      collection: model.collection.name,
      explain,
      queryShape: shape,
      limit,
      projectionFieldCount: fields.length,
    });
  } catch (error) {
    return {
      name,
      collection: model.collection.name,
      error: /maxTimeMS|time limit/i.test(String(error?.message || '')) ? 'explain-time-limit' : 'explain-failed',
      message: 'Explain konnte nicht abgeschlossen werden.',
      estimatedQueryShape: describeQueryShape(shape),
      limit: limit ?? null,
      projectionFieldCount: fields.length,
    };
  }
}

async function explainRankingQuery({ name, retailer = '', rankingBuilder = buildOfferRanking }) {
  try {
    const result = await rankingBuilder({
      retailers: retailer,
      limit: 20,
      diagnostics: true,
    });
    const diagnostics = result?.diagnostics || {};
    const mongo = diagnostics.mongo || {};
    const explain = mongo.primaryExecutionStats || mongo.executionStats;

    if (!explain) {
      return {
        name,
        collection: 'offers',
        error: mongo.error || 'explain-unavailable',
        message: 'Ranking-Explain war nicht verfügbar.',
        estimatedQueryShape: describeQueryShape(mongo.primaryMatch || mongo.match || {}),
        limit: mongo.limit ?? null,
        projectionFieldCount: Array.isArray(mongo.fields) ? mongo.fields.length : 0,
      };
    }

    return summarizeExplain({
      name,
      collection: 'offers',
      explain,
      queryShape: mongo.primaryMatch || mongo.match || {},
      limit: mongo.limit ?? null,
      projectionFieldCount: Array.isArray(mongo.fields) ? mongo.fields.length : 0,
    });
  } catch (error) {
    return {
      name,
      collection: 'offers',
      error: 'explain-failed',
      message: 'Ranking-Explain konnte nicht abgeschlossen werden.',
      estimatedQueryShape: {},
      limit: 20,
      projectionFieldCount: 0,
    };
  }
}

async function buildMongoExplainDiagnostics({
  OfferModel = Offer,
  RetailerModel = Retailer,
  rankingBuilder = buildOfferRanking,
} = {}) {
  const filterRetailer = buildFilterQuery({ model: OfferModel });
  const filterCategory = buildFilterQuery({ model: OfferModel, categoryOnly: true });
  const topDeals = buildTopDealsQuery({ model: OfferModel });

  const queries = [
    await explainQuery({ name: 'filter-metadata-retailer-facet', model: OfferModel, ...filterRetailer }),
    await explainQuery({ name: 'filter-metadata-category-facet', model: OfferModel, ...filterCategory }),
    await explainQuery({ name: 'top-deals-candidate', model: OfferModel, ...topDeals }),
    await explainRankingQuery({ name: 'global-ranking-candidate', rankingBuilder }),
    await explainRankingQuery({ name: 'retailer-ranking-hofer', retailer: 'hofer', rankingBuilder }),
    await explainRankingQuery({ name: 'retailer-ranking-billa', retailer: 'billa', rankingBuilder }),
    await explainRankingQuery({ name: 'retailer-ranking-billa-plus', retailer: 'billa-plus', rankingBuilder }),
  ];

  return {
    ok: queries.every((query) => !query.error),
    readOnly: true,
    generatedAt: new Date().toISOString(),
    mutatedCollections: [],
    queries,
  };
}

module.exports = {
  buildMongoExplainDiagnostics,
  describeQueryShape,
  summarizeExplain,
};
