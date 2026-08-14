const express = require('express');
const env = require('../config/env');
const { getDatabaseState } = require('../config/mongodb');
const OfferFeedback = require('../models/OfferFeedback');
const { buildSafeBuildInfo } = require('../services/buildInfo');
const sourceTransportMatrixService = require('../services/diagnostics/sourceTransportMatrix');
const publicVisibilityDiagnosticsService = require('../services/diagnostics/publicVisibilityDiagnostics');
const mongoExplainDiagnosticsService = require('../services/diagnostics/mongoExplainDiagnostics');
const filterMetadataService = require('../services/filters/filterMetadataService');

const FILTER_METADATA_COLLECTIONS = [
  'retailers',
  'categories',
  'retailercategorystats',
  'retailercategoryoffercaches',
];

const RECENT_FEEDBACK_DEFAULT_LIMIT = 50;
const RECENT_FEEDBACK_MAX_LIMIT = 200;
const EXPORT_FEEDBACK_DEFAULT_LIMIT = 200;
const EXPORT_FEEDBACK_MAX_LIMIT = 1000;
const SOURCE_TRANSPORT_DEFAULT_TARGETS = ['spar-productworld-inangebot', 'spar-productworld-preisgesenkt', 'pagro-angebote', 'aktionsfinder-pagro'];
const SOURCE_TRANSPORT_DEFAULT_CLIENTS = ['global-fetch', 'native-https', 'axios', 'http2', 'curl'];
const OFFER_FEEDBACK_RECENT_PROJECTION = {
  _id: 1,
  createdAt: 1,
  updatedAt: 1,
  status: 1,
  priority: 1,
  reasons: 1,
  offerRef: 1,
  offerSnapshot: 1,
  pageContext: 1,
  structuredDetails: 1,
  freeText: 1,
};

function parseBoundedLimit(rawLimit, { defaultLimit, maxLimit }) {
  const parsed = Number.parseInt(String(rawLimit || ''), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultLimit;
  }

  return Math.min(parsed, maxLimit);
}

function parseCsvList(rawValue, fallback = []) {
  const values = String(rawValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? values : fallback;
}

function parseBoundedInteger(rawValue, { defaultValue, min, max }) {
  const parsed = Number.parseInt(String(rawValue || ''), 10);

  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.max(min, Math.min(max, parsed));
}

function truncateText(value, maxLength = 800) {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return trimmed.slice(0, maxLength);
}

function cleanArray(value, maxItems = 50) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, maxItems)
    .map((item) => (typeof item === 'string' ? truncateText(item, 200) : item))
    .filter((item) => item !== null && item !== undefined && item !== '');
}

function pickObject(source, keys) {
  const result = {};

  if (!source || typeof source !== 'object') {
    return result;
  }

  for (const key of keys) {
    const value = source[key];

    if (value === undefined) {
      continue;
    }

    if (typeof value === 'string') {
      result[key] = truncateText(value, 800);
    } else if (Array.isArray(value)) {
      result[key] = cleanArray(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function sanitizeStructuredDetails(details = {}) {
  return {
    category_wrong: pickObject(details.category_wrong, [
      'currentCategoryPrimary',
      'currentCategorySecondary',
      'suggestedCategoryPrimary',
      'suggestedCategorySecondary',
      'suggestedCategoryUnknown',
      'userNote',
    ]),
    price_wrong: pickObject(details.price_wrong, [
      'visiblePrice',
      'seenPrice',
      'seenPriceText',
      'seenAt',
      'userNote',
    ]),
    condition_wrong: pickObject(details.condition_wrong, [
      'visibleConditions',
      'issueTypes',
      'userExpectedConditionText',
      'userSawDifferentCondition',
      'userNote',
    ]),
    image_wrong: pickObject(details.image_wrong, [
      'issueTypes',
      'userNote',
    ]),
    expired_or_not_found: pickObject(details.expired_or_not_found, [
      'issueTypes',
      'checkedWhere',
      'userNote',
    ]),
    duplicate: pickObject(details.duplicate, [
      'duplicateOfferId',
      'duplicateVisibleTitle',
      'duplicateReason',
      'userNote',
    ]),
    offer_nonsense: pickObject(details.offer_nonsense, [
      'issueTypes',
      'userNote',
    ]),
    search_result_wrong: pickObject(details.search_result_wrong, [
      'query',
      'visibleTitle',
      'currentCategoryPrimary',
      'currentCategorySecondary',
      'expectedProductType',
      'expectedCategoryPrimary',
      'expectedCategorySecondary',
      'issueTypes',
      'userNote',
    ]),
    other: pickObject(details.other, [
      'userNote',
    ]),
  };
}

function removeEmptyObjects(value) {
  if (value instanceof Date) {
    return value;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [key, removeEmptyObjects(entryValue)])
      .filter(([, entryValue]) => {
        if (entryValue === null || entryValue === undefined) {
          return false;
        }

        if (Array.isArray(entryValue)) {
          return entryValue.length > 0;
        }

        if (typeof entryValue === 'object') {
          return Object.keys(entryValue).length > 0;
        }

        return true;
      })
  );
}

function sanitizeOfferFeedbackDocument(doc) {
  const plain = typeof doc?.toObject === 'function' ? doc.toObject() : doc || {};

  return removeEmptyObjects({
    id: String(plain._id || plain.id || ''),
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
    status: plain.status || null,
    priority: plain.priority || null,
    reasons: cleanArray(plain.reasons, 20),
    offerRef: pickObject(plain.offerRef, [
      'offerId',
      'stableId',
      'sourceId',
      'dedupeKey',
    ]),
    offerSnapshot: pickObject(plain.offerSnapshot, [
      'title',
      'retailerKey',
      'retailerLabel',
      'categoryPrimary',
      'categorySecondary',
      'conditionsText',
      'conditionBadges',
      'imagePresent',
      'sourceType',
      'sourceTypes',
      'priceCurrent',
      'quantity',
      'validityText',
    ]),
    pageContext: pickObject(plain.pageContext, [
      'path',
      'query',
      'activeRetailers',
      'activeCategories',
      'resultPosition',
      'viewport',
    ]),
    structuredDetails: sanitizeStructuredDetails(plain.structuredDetails),
    freeText: truncateText(plain.freeText, 800),
    triage: pickObject(plain.triage, [
      'note',
      'rootCause',
      'resolution',
      'updatedBy',
      'updatedAt',
    ]),
  });
}

function mapCountRows(rows, keyName) {
  return rows
    .map((row) => ({
      [keyName]: row._id,
      count: row.count,
    }))
    .filter((row) => row[keyName] !== null && row[keyName] !== undefined && row[keyName] !== '');
}

function groupByField(field, { keyName, limit = 25, unwind = false } = {}) {
  const pipeline = [];

  if (unwind) {
    pipeline.push({ $unwind: `$${field}` });
  }

  pipeline.push(
    { $match: { [field]: { $nin: [null, ''] } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: limit }
  );

  return { pipeline, keyName };
}

async function aggregateMapped(OfferFeedbackModel, definition) {
  const rows = await OfferFeedbackModel.aggregate(definition.pipeline);
  return mapCountRows(rows, definition.keyName);
}

async function buildOfferFeedbackSummary({ OfferFeedbackModel = OfferFeedback } = {}) {
  const [
    total,
    byStatus,
    byReason,
    byRetailerRows,
    bySourceType,
    byQuery,
    byCategory,
    categorySuggestionRows,
    conditionIssueTypes,
    imageIssueTypes,
    offerNonsenseIssueTypes,
    searchResultIssueTypes,
    topReportedOfferRows,
  ] = await Promise.all([
    OfferFeedbackModel.countDocuments({}),
    aggregateMapped(OfferFeedbackModel, groupByField('status', { keyName: 'status' })),
    aggregateMapped(OfferFeedbackModel, groupByField('reasons', { keyName: 'reason', unwind: true })),
    OfferFeedbackModel.aggregate([
      { $match: { 'offerSnapshot.retailerKey': { $nin: [null, ''] } } },
      {
        $group: {
          _id: '$offerSnapshot.retailerKey',
          retailerLabel: { $first: '$offerSnapshot.retailerLabel' },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 25 },
    ]),
    aggregateMapped(OfferFeedbackModel, groupByField('offerSnapshot.sourceType', { keyName: 'sourceType' })),
    OfferFeedbackModel.aggregate([
      {
        $project: {
          query: {
            $ifNull: [
              '$pageContext.query',
              '$structuredDetails.search_result_wrong.query',
            ],
          },
        },
      },
      { $match: { query: { $nin: [null, ''] } } },
      { $group: { _id: '$query', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 25 },
    ]),
    aggregateMapped(OfferFeedbackModel, groupByField('offerSnapshot.categoryPrimary', { keyName: 'categoryPrimary' })),
    OfferFeedbackModel.aggregate([
      {
        $project: {
          currentCategoryPrimary: {
            $ifNull: [
              '$structuredDetails.category_wrong.currentCategoryPrimary',
              '$offerSnapshot.categoryPrimary',
            ],
          },
          suggestedCategoryPrimary: '$structuredDetails.category_wrong.suggestedCategoryPrimary',
        },
      },
      {
        $match: {
          currentCategoryPrimary: { $nin: [null, ''] },
          suggestedCategoryPrimary: { $nin: [null, ''] },
        },
      },
      {
        $group: {
          _id: {
            currentCategoryPrimary: '$currentCategoryPrimary',
            suggestedCategoryPrimary: '$suggestedCategoryPrimary',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1, '_id.currentCategoryPrimary': 1, '_id.suggestedCategoryPrimary': 1 } },
      { $limit: 50 },
    ]),
    aggregateMapped(OfferFeedbackModel, groupByField('structuredDetails.condition_wrong.issueTypes', {
      keyName: 'issueType',
      unwind: true,
    })),
    aggregateMapped(OfferFeedbackModel, groupByField('structuredDetails.image_wrong.issueTypes', {
      keyName: 'issueType',
      unwind: true,
    })),
    aggregateMapped(OfferFeedbackModel, groupByField('structuredDetails.offer_nonsense.issueTypes', {
      keyName: 'issueType',
      unwind: true,
    })),
    aggregateMapped(OfferFeedbackModel, groupByField('structuredDetails.search_result_wrong.issueTypes', {
      keyName: 'issueType',
      unwind: true,
    })),
    OfferFeedbackModel.aggregate([
      { $match: { 'offerRef.offerId': { $nin: [null, ''] } } },
      {
        $group: {
          _id: '$offerRef.offerId',
          title: { $first: '$offerSnapshot.title' },
          retailerKey: { $first: '$offerSnapshot.retailerKey' },
          count: { $sum: 1 },
          reasonLists: { $push: '$reasons' },
        },
      },
      {
        $project: {
          title: 1,
          retailerKey: 1,
          count: 1,
          reasons: {
            $reduce: {
              input: '$reasonLists',
              initialValue: [],
              in: { $setUnion: ['$$value', '$$this'] },
            },
          },
        },
      },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 25 },
    ]),
  ]);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    total,
    byStatus,
    byReason,
    byRetailer: byRetailerRows.map((row) => ({
      retailerKey: row._id,
      retailerLabel: row.retailerLabel || '',
      count: row.count,
    })),
    bySourceType,
    byQuery: mapCountRows(byQuery, 'query'),
    byCategory,
    categorySuggestions: categorySuggestionRows.map((row) => ({
      currentCategoryPrimary: row._id.currentCategoryPrimary,
      suggestedCategoryPrimary: row._id.suggestedCategoryPrimary,
      count: row.count,
    })),
    conditionIssueTypes,
    imageIssueTypes,
    offerNonsenseIssueTypes,
    searchResultIssueTypes,
    topReportedOffers: topReportedOfferRows.map((row) => ({
      offerId: row._id,
      title: row.title || '',
      retailerKey: row.retailerKey || '',
      count: row.count,
      reasons: cleanArray(row.reasons, 20),
    })),
  };
}

async function findRecentOfferFeedback({
  OfferFeedbackModel = OfferFeedback,
  limit = RECENT_FEEDBACK_DEFAULT_LIMIT,
} = {}) {
  let query = OfferFeedbackModel.find({}, OFFER_FEEDBACK_RECENT_PROJECTION)
    .sort({ createdAt: -1 })
    .limit(limit);

  if (typeof query.lean === 'function') {
    query = query.lean();
  }

  const docs = await query;
  return docs.map(sanitizeOfferFeedbackDocument);
}

function buildFilterRebuildContext({ envConfig = env, dbState = getDatabaseState(), buildInfo = buildSafeBuildInfo() } = {}) {
  const isProduction = envConfig.NODE_ENV === 'production';

  return {
    nodeEnv: envConfig.NODE_ENV,
    database: {
      connected: dbState.readyState === 1,
      name: dbState.name || envConfig.MONGODB_DB_NAME || '',
    },
    build: buildInfo,
    operation: {
      name: 'filter-metadata-rebuild',
      allowedInCurrentEnvironment: isProduction,
      mutatesCollections: FILTER_METADATA_COLLECTIONS,
      doesNotRun: ['crawl', 'reindex', 'repair-apply', 'hard-delete'],
    },
  };
}

function assertProductionFilterRebuildAllowed(context) {
  if (context.nodeEnv !== 'production') {
    const error = new Error('Filtermetadata-Rebuild ist nur in NODE_ENV=production erlaubt.');
    error.statusCode = 409;
    error.details = {
      nodeEnv: context.nodeEnv,
      databaseName: context.database.name,
    };
    throw error;
  }

  if (!context.database.connected) {
    const error = new Error('Datenbankverbindung ist nicht bereit.');
    error.statusCode = 503;
    error.details = {
      nodeEnv: context.nodeEnv,
      databaseName: context.database.name,
    };
    throw error;
  }
}

function createAdminRouter({
  envConfig = env,
  filterMetadataServiceImpl = filterMetadataService,
  sourceTransportMatrixServiceImpl = sourceTransportMatrixService,
  publicVisibilityDiagnosticsServiceImpl = publicVisibilityDiagnosticsService,
  mongoExplainDiagnosticsServiceImpl = mongoExplainDiagnosticsService,
  dbStateProvider = getDatabaseState,
  buildInfoProvider = buildSafeBuildInfo,
  OfferFeedbackModel = OfferFeedback,
} = {}) {
  const router = express.Router();

  router.get('/filters/rebuild-context', (req, res) => {
    res.json({
      ok: true,
      context: buildFilterRebuildContext({
        envConfig,
        dbState: dbStateProvider(),
        buildInfo: buildInfoProvider(),
      }),
    });
  });

  router.post('/filters/rebuild', async (req, res, next) => {
    const startedAt = Date.now();

    try {
      const context = buildFilterRebuildContext({
        envConfig,
        dbState: dbStateProvider(),
        buildInfo: buildInfoProvider(),
      });

      assertProductionFilterRebuildAllowed(context);

      const summary = await filterMetadataServiceImpl.rebuildFilterMetadata({
        trigger: 'admin-api',
        loggerContext: { invokedBy: 'POST /api/admin/filters/rebuild' },
      });

      res.json({
        ok: true,
        durationMs: Date.now() - startedAt,
        context,
        summary,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/source-transport-matrix', async (req, res, next) => {
    try {
      const targetIds = parseCsvList(req.query.targets, SOURCE_TRANSPORT_DEFAULT_TARGETS);
      const clientIds = parseCsvList(req.query.clients, SOURCE_TRANSPORT_DEFAULT_CLIENTS);
      const timeoutMs = parseBoundedInteger(req.query.timeoutMs, {
        defaultValue: 10000,
        min: 1000,
        max: 30000,
      });
      const delayMs = parseBoundedInteger(req.query.delayMs, {
        defaultValue: 750,
        min: 0,
        max: 5000,
      });

      const report = await sourceTransportMatrixServiceImpl.runSourceTransportMatrix({
        targetIds,
        clientIds,
        timeoutMs,
        delayMs,
        maxCombinations: 20,
      });

      res.json({
        ...report,
        adminEndpoint: {
          path: '/api/admin/source-transport-matrix',
          readOnly: true,
          allowlistedTargetsOnly: true,
          freeUrlInputAllowed: false,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/public-visibility-diagnostics', async (req, res, next) => {
    try {
      const retailers = req.query.retailers || req.query.retailer || '';
      const report = await publicVisibilityDiagnosticsServiceImpl.buildPublicVisibilityDiagnostics({
        retailers,
      });

      res.json({
        ...report,
        adminEndpoint: {
          path: '/api/admin/public-visibility-diagnostics',
          readOnly: true,
          allowedRetailers: report.allowedRetailers || [],
          exposesRawOffers: false,
          mutatesCollections: [],
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/diagnostics/mongo-explain', async (req, res, next) => {
    try {
      const report = await mongoExplainDiagnosticsServiceImpl.buildMongoExplainDiagnostics();

      res.json({
        ...report,
        adminEndpoint: {
          path: '/api/admin/diagnostics/mongo-explain',
          readOnly: true,
          exposesRawOffers: false,
          exposesSecrets: false,
          mutatesCollections: [],
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/offer-feedback/summary', async (req, res, next) => {
    try {
      const summary = await buildOfferFeedbackSummary({ OfferFeedbackModel });
      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  router.get('/offer-feedback/recent', async (req, res, next) => {
    try {
      const limit = parseBoundedLimit(req.query.limit, {
        defaultLimit: RECENT_FEEDBACK_DEFAULT_LIMIT,
        maxLimit: RECENT_FEEDBACK_MAX_LIMIT,
      });
      const items = await findRecentOfferFeedback({ OfferFeedbackModel, limit });

      res.json({
        ok: true,
        count: items.length,
        limit,
        items,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/offer-feedback/export', async (req, res, next) => {
    try {
      const limit = parseBoundedLimit(req.query.limit, {
        defaultLimit: EXPORT_FEEDBACK_DEFAULT_LIMIT,
        maxLimit: EXPORT_FEEDBACK_MAX_LIMIT,
      });
      const items = await findRecentOfferFeedback({ OfferFeedbackModel, limit });

      res.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        count: items.length,
        limit,
        items,
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/offer-feedback/:feedbackId/status', async (req, res, next) => {
    try {
      const status = String(req.body?.status || '').trim();

      if (!['new', 'reviewing', 'resolved', 'ignored', 'duplicate'].includes(status)) {
        return res.status(400).json({
          ok: false,
          message: 'Ungueltiger Feedback-Status.',
        });
      }

      const update = {
        status,
        triage: {
          note: truncateText(req.body?.note || '', 800) || '',
          rootCause: truncateText(req.body?.rootCause || '', 200) || '',
          resolution: truncateText(req.body?.resolution || '', 200) || '',
          updatedBy: 'codex-admin',
          updatedAt: new Date(),
        },
      };
      const item = await OfferFeedbackModel.findByIdAndUpdate(
        req.params.feedbackId,
        { $set: update },
        { new: true }
      );

      if (!item) {
        return res.status(404).json({
          ok: false,
          message: 'OfferFeedback wurde nicht gefunden.',
        });
      }

      return res.json({
        ok: true,
        item: sanitizeOfferFeedbackDocument(item),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

const router = createAdminRouter();

module.exports = router;
module.exports.createAdminRouter = createAdminRouter;
module.exports.buildFilterRebuildContext = buildFilterRebuildContext;
module.exports.buildOfferFeedbackSummary = buildOfferFeedbackSummary;
module.exports.findRecentOfferFeedback = findRecentOfferFeedback;
module.exports.parseBoundedInteger = parseBoundedInteger;
module.exports.parseCsvList = parseCsvList;
module.exports.parseBoundedLimit = parseBoundedLimit;
module.exports.sanitizeOfferFeedbackDocument = sanitizeOfferFeedbackDocument;
module.exports.FILTER_METADATA_COLLECTIONS = FILTER_METADATA_COLLECTIONS;
