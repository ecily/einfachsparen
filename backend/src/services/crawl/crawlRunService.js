const os = require('node:os');
const mongoose = require('mongoose');
const CrawlRun = require('../../models/CrawlRun');
const CrawlRunLock = require('../../models/CrawlRunLock');
const { crawlAllSources } = require('./crawlDispatcher');
const logger = require('../../lib/logger');

const GLOBAL_CRAWL_LOCK_KEY = 'crawl-run-global';
const ACTIVE_RUN_STATUSES = ['queued', 'running'];
const LOCK_STALE_MS = 18 * 60 * 60 * 1000;

function compactStrings(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function determineMode(options = {}) {
  return (
    compactStrings(options.retailerKeys).length > 0
    || compactStrings(options.sourceKeys).length > 0
    || compactStrings(options.sourceIds).length > 0
    || options.sourceSelectionRequested === true
  )
    ? 'scoped'
    : 'full';
}

function asStringId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value._id) return asStringId(value._id);
  return String(value);
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberFrom(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function compactErrorMessage(value) {
  return String(value || '').slice(0, 400);
}

function sanitizeJsonValue(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return toIsoOrNull(value);
  if (mongoose.Types.ObjectId.isValid(value) && value._bsontype === 'ObjectId') return String(value);

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item, seen));
  }

  const plain = typeof value.toObject === 'function'
    ? value.toObject({ getters: false, virtuals: false })
    : value;
  const sanitized = {};

  for (const [key, entry] of Object.entries(plain)) {
    if (typeof entry !== 'undefined' && typeof entry !== 'function') {
      sanitized[key] = sanitizeJsonValue(entry, seen);
    }
  }

  return sanitized;
}

function normalizeSourceResult(source = {}) {
  if (!source || typeof source !== 'object') {
    source = {};
  }

  const foundRawItems = numberFrom(source.foundRawItems ?? source.rawCandidateCount ?? source.discoveredLinks);
  const parsedOffers = numberFrom(source.parsedOffers ?? source.offersExtracted ?? source.offersStored);
  const offersStored = numberFrom(source.offersStored);
  const rejectedOffers = numberFrom(source.rejectedOffers ?? Math.max(0, foundRawItems - parsedOffers));

  return {
    sourceId: asStringId(source.sourceId),
    sourceKey: String(source.sourceKey || ''),
    retailerKey: String(source.retailerKey || ''),
    retailerName: String(source.retailerName || ''),
    channel: String(source.channel || ''),
    sourceType: String(source.sourceType || source.channel || ''),
    status: String(source.status || 'success'),
    foundRawItems,
    parsedOffers,
    offersStored,
    rejectedOffers,
    skipped: Boolean(source.skipped),
    message: compactErrorMessage(source.message),
    error: compactErrorMessage(source.error),
  };
}

function incrementRetailerSummary(map, retailerKey) {
  const key = retailerKey || 'unknown';

  if (!map.has(key)) {
    map.set(key, {
      retailerKey: key,
      matchedSources: 0,
      successfulSources: 0,
      failedSources: 0,
      foundRawItems: 0,
      parsedOffers: 0,
      offersStored: 0,
      rejectedOffers: 0,
    });
  }

  return map.get(key);
}

function incrementSourceTypeSummary(map, source) {
  const key = [source.sourceType || '', source.channel || ''].join('::');

  if (!map.has(key)) {
    map.set(key, {
      sourceType: source.sourceType || '',
      channel: source.channel || '',
      matchedSources: 0,
      successfulSources: 0,
      failedSources: 0,
      offersStored: 0,
    });
  }

  return map.get(key);
}

function buildRunSummary(crawlResult = {}) {
  const sourceInputs = Array.isArray(crawlResult.sources) ? crawlResult.sources : [];
  const sources = sourceInputs.map(normalizeSourceResult);
  const matchedSources = Array.isArray(crawlResult.matchedSources) ? crawlResult.matchedSources : [];
  const skippedSources = Array.isArray(crawlResult.skippedSources) ? crawlResult.skippedSources : [];
  const disabledSources = Array.isArray(crawlResult.disabledSources) ? crawlResult.disabledSources : [];
  const sourceCoverage = crawlResult.sourceCoverage || {};
  const perRetailerMap = new Map();
  const sourceTypeMap = new Map();
  const matchedSourceIds = new Set();

  for (const source of matchedSources) {
    const normalized = normalizeSourceResult(source);
    const retailer = incrementRetailerSummary(perRetailerMap, normalized.retailerKey);
    const sourceType = incrementSourceTypeSummary(sourceTypeMap, normalized);

    retailer.matchedSources += 1;
    sourceType.matchedSources += 1;
    if (normalized.sourceId) matchedSourceIds.add(normalized.sourceId);
  }

  for (const source of sources) {
    const retailer = incrementRetailerSummary(perRetailerMap, source.retailerKey);
    const sourceType = incrementSourceTypeSummary(sourceTypeMap, source);
    const failed = source.status === 'failed';
    const partial = source.status === 'partial';

    if (source.sourceId) matchedSourceIds.add(source.sourceId);
    if (source.status === 'success') retailer.successfulSources += 1;
    if (source.status === 'success') sourceType.successfulSources += 1;
    if (failed) retailer.failedSources += 1;
    if (failed) sourceType.failedSources += 1;
    if (partial) {
      retailer.failedSources += 0;
    }

    retailer.foundRawItems += source.foundRawItems;
    retailer.parsedOffers += source.parsedOffers;
    retailer.offersStored += source.offersStored;
    retailer.rejectedOffers += source.rejectedOffers;
    sourceType.offersStored += source.offersStored;
  }

  const failedSourcesCount = sources.filter((source) => source.status === 'failed').length;
  const partialSourcesCount = sources.filter((source) => source.status === 'partial').length;
  const successfulSourcesCount = sources.filter((source) => source.status === 'success').length;
  const filterMetadata = crawlResult.filterMetadata || {};

  return {
    sources,
    matchedSourceIds: [...matchedSourceIds],
    summary: {
      totalRegisteredSources: numberFrom(sourceCoverage.totalRegisteredSources),
      activeEligibleSources: numberFrom(sourceCoverage.activeEligibleSources),
      matchedSourcesCount: matchedSources.length || sources.length,
      skippedSourcesCount: skippedSources.length,
      disabledSourcesCount: disabledSources.length || numberFrom(sourceCoverage.disabledSourcesCount),
      unknownSourceKeys: crawlResult.unknownSourceKeys || [],
      unknownSourceIds: crawlResult.unknownSourceIds || [],
      foundRawItemsTotal: sources.reduce((sum, source) => sum + source.foundRawItems, 0),
      parsedOffersTotal: sources.reduce((sum, source) => sum + source.parsedOffers, 0),
      offersStoredTotal: sources.reduce((sum, source) => sum + source.offersStored, 0),
      rejectedOffersTotal: sources.reduce((sum, source) => sum + source.rejectedOffers, 0),
      failedSourcesCount,
      successfulSourcesCount,
      partialSourcesCount,
      processedOffers: numberFrom(filterMetadata.processedOffers),
    },
    perRetailer: [...perRetailerMap.values()].sort((left, right) => left.retailerKey.localeCompare(right.retailerKey)),
    sourceTypes: [...sourceTypeMap.values()].sort((left, right) => {
      const leftKey = `${left.channel}:${left.sourceType}`;
      const rightKey = `${right.channel}:${right.sourceType}`;
      return leftKey.localeCompare(rightKey);
    }),
  };
}

function determineFinalStatus({ crawlResult = {}, summary = {}, mode = 'full', dryRun = false } = {}) {
  const filterMetadata = crawlResult.filterMetadata || {};
  const matchedSourcesCount = numberFrom(summary.matchedSourcesCount);

  if (matchedSourcesCount === 0) {
    return dryRun ? 'skipped' : 'skipped';
  }

  if (filterMetadata && filterMetadata.ok === false) {
    return 'failed';
  }

  if (numberFrom(summary.failedSourcesCount) > 0 || numberFrom(summary.partialSourcesCount) > 0) {
    return 'partial';
  }

  if (mode === 'full' && numberFrom(summary.activeEligibleSources) > 0 && matchedSourcesCount < numberFrom(summary.activeEligibleSources)) {
    return 'partial';
  }

  return 'success';
}

function serializeCrawlRun(run) {
  if (!run) return null;
  const plain = typeof run.toObject === 'function' ? run.toObject({ getters: false, virtuals: false }) : run;

  return {
    id: asStringId(plain._id || plain.id),
    status: plain.status,
    trigger: plain.trigger,
    mode: plain.mode,
    dryRun: Boolean(plain.dryRun),
    region: plain.region || '',
    startedAt: toIsoOrNull(plain.startedAt),
    finishedAt: toIsoOrNull(plain.finishedAt),
    durationMs: plain.durationMs ?? null,
    requestedSourceKeys: plain.result?.requestedSourceKeys || plain.sourceKeys || [],
    requestedSourceIds: plain.result?.requestedSourceIds || plain.sourceIds || [],
    effectiveRetailerKeys: plain.result?.effectiveRetailerKeys || [],
    summary: sanitizeJsonValue(plain.summary || {}),
    perRetailer: sanitizeJsonValue(plain.perRetailer || []),
    sourceTypes: sanitizeJsonValue(plain.sourceTypes || []),
    result: {
      sources: Array.isArray(plain.result?.sources)
        ? plain.result.sources.map(normalizeSourceResult)
        : [],
      dedupe: sanitizeJsonValue(plain.result?.dedupe || {}),
      filterMetadata: sanitizeJsonValue(plain.result?.filterMetadata || {}),
      effectiveRetailerKeys: compactStrings(plain.result?.effectiveRetailerKeys || []),
      requestedSourceKeys: compactStrings(plain.result?.requestedSourceKeys || plain.sourceKeys || []),
      requestedSourceIds: compactStrings(plain.result?.requestedSourceIds || plain.sourceIds || []),
    },
    errorMessages: compactStrings(plain.errorMessages || []),
    warnings: compactStrings(plain.warnings || []),
  };
}

function buildRunDocument({ runId, trigger, region, options = {} }) {
  const retailerKeys = compactStrings(options.retailerKeys);
  const sourceKeys = compactStrings(options.sourceKeys);
  const sourceIds = compactStrings(options.sourceIds);
  const sourceSelectionRequested = Boolean(
    options.sourceSelectionRequested
    || sourceKeys.length > 0
    || sourceIds.length > 0
  );

  return new CrawlRun({
    _id: runId,
    status: 'queued',
    trigger,
    mode: determineMode({
      retailerKeys,
      sourceKeys,
      sourceIds,
      sourceSelectionRequested,
    }),
    dryRun: options.dryRun === true,
    region,
    retailerKeys,
    sourceKeys,
    sourceIds,
    allowDisabled: options.allowDisabled === true,
    sourceSelectionRequested,
    lockKey: GLOBAL_CRAWL_LOCK_KEY,
    result: {
      sources: [],
      dedupe: {},
      filterMetadata: {},
      effectiveRetailerKeys: [],
      requestedSourceKeys: sourceKeys,
      requestedSourceIds: sourceIds,
    },
  });
}

async function findActiveRun() {
  return CrawlRun.findOne({ status: { $in: ACTIVE_RUN_STATUSES } })
    .sort({ startedAt: -1, createdAt: -1 });
}

function isRunStale(run, now = new Date()) {
  if (!run) return false;
  const reference = run.startedAt || run.createdAt;
  const timestamp = reference ? new Date(reference).getTime() : 0;

  return timestamp > 0 && now.getTime() - timestamp > LOCK_STALE_MS;
}

async function failStaleRun(run) {
  if (!run || !isRunStale(run)) {
    return false;
  }

  const finishedAt = new Date();
  const startedAt = run.startedAt || run.createdAt || finishedAt;

  await CrawlRun.findByIdAndUpdate(run._id, {
    $set: {
      status: 'failed',
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - new Date(startedAt).getTime()),
      warnings: [
        ...(run.warnings || []),
        'CrawlRun stale lock recovery marked this run failed after 18 hours.',
      ],
      errorMessages: [
        ...(run.errorMessages || []),
        'CrawlRun exceeded stale-lock threshold.',
      ],
    },
  });
  await releaseCrawlRunLock(run._id);
  return true;
}

function buildLockExpiry(now = new Date()) {
  return new Date(now.getTime() + LOCK_STALE_MS);
}

async function acquireCrawlRunLock({ runId, trigger }) {
  const now = new Date();

  try {
    const lock = await CrawlRunLock.findOneAndUpdate(
      {
        _id: GLOBAL_CRAWL_LOCK_KEY,
        $or: [
          { runId: null },
          { status: 'released' },
          { expiresAt: { $lte: now } },
          { expiresAt: null },
        ],
      },
      {
        $set: {
          runId,
          status: 'queued',
          acquiredAt: now,
          heartbeatAt: now,
          expiresAt: buildLockExpiry(now),
          owner: `${os.hostname()}:${process.pid}:${trigger}`,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    if (String(lock.runId || '') === String(runId)) {
      return { acquired: true, lock };
    }
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }
  }

  const activeRun = await findActiveRun();
  return { acquired: false, activeRun };
}

async function releaseCrawlRunLock(runId) {
  await CrawlRunLock.updateOne(
    {
      _id: GLOBAL_CRAWL_LOCK_KEY,
      runId,
    },
    {
      $set: {
        status: 'released',
        runId: null,
        heartbeatAt: new Date(),
        expiresAt: null,
      },
    }
  );
}

async function markLockRunning(runId) {
  await CrawlRunLock.updateOne(
    {
      _id: GLOBAL_CRAWL_LOCK_KEY,
      runId,
    },
    {
      $set: {
        status: 'running',
        heartbeatAt: new Date(),
        expiresAt: buildLockExpiry(),
      },
    }
  );
}

async function executeCrawlRun({
  runId,
  options = {},
  trigger,
  region,
  crawlAllSourcesImpl = crawlAllSources,
} = {}) {
  const startedAt = new Date();

  await markLockRunning(runId);
  await CrawlRun.findByIdAndUpdate(runId, {
    $set: {
      status: 'running',
      startedAt,
    },
  });

  try {
    const crawlResult = await crawlAllSourcesImpl({
      ...options,
      region,
      trigger,
    });
    const run = await CrawlRun.findById(runId);
    const aggregation = buildRunSummary(crawlResult);
    const status = determineFinalStatus({
      crawlResult,
      summary: aggregation.summary,
      mode: run?.mode || determineMode(options),
      dryRun: options.dryRun === true,
    });
    const finishedAt = new Date();
    const warnings = [
      ...(crawlResult.warnings || []),
      ...(status === 'skipped' ? ['No active eligible crawl sources matched this run.'] : []),
      ...(status === 'partial' ? ['One or more crawl sources were partial or failed; previous data for failed sources was retained.'] : []),
    ];

    await CrawlRun.findByIdAndUpdate(runId, {
      $set: {
        status,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        sourceIdsMatched: aggregation.matchedSourceIds,
        summary: aggregation.summary,
        perRetailer: aggregation.perRetailer,
        sourceTypes: aggregation.sourceTypes,
        result: {
          sources: aggregation.sources,
          dedupe: crawlResult.dedupe || {},
          filterMetadata: crawlResult.filterMetadata || {},
          effectiveRetailerKeys: crawlResult.effectiveRetailerKeys || [],
          requestedSourceKeys: crawlResult.requestedSourceKeys || options.sourceKeys || [],
          requestedSourceIds: crawlResult.requestedSourceIds || options.sourceIds || [],
        },
        errorMessages: aggregation.sources.filter((source) => source.error).map((source) => source.error),
        warnings,
      },
    });

    logger.info('CrawlRun completed', {
      runId: String(runId),
      status,
      trigger,
      mode: run?.mode || determineMode(options),
      summary: aggregation.summary,
    });
  } catch (error) {
    const finishedAt = new Date();
    const details = error?.details || {};

    await CrawlRun.findByIdAndUpdate(runId, {
      $set: {
        status: 'failed',
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        summary: {
          unknownSourceKeys: details.unknownSourceKeys || [],
          unknownSourceIds: details.unknownSourceIds || [],
        },
        errorMessages: [compactErrorMessage(error.message)],
        warnings: ['CrawlRun failed before a complete crawl result was available; existing live offers were not globally cleared.'],
      },
    });

    logger.error('CrawlRun failed', {
      runId: String(runId),
      trigger,
      message: error.message,
      stack: error.stack,
    });
  } finally {
    await releaseCrawlRunLock(runId);
  }
}

async function startCrawlRun({
  options = {},
  trigger = 'manual',
  region = '',
  crawlAllSourcesImpl = crawlAllSources,
  defer = true,
} = {}) {
  const activeRun = await findActiveRun();

  if (activeRun) {
    const staleRecovered = await failStaleRun(activeRun);

    if (!staleRecovered) {
      return {
        accepted: false,
        alreadyRunning: true,
        run: activeRun,
      };
    }
  }

  const runId = new mongoose.Types.ObjectId();
  const lockResult = await acquireCrawlRunLock({ runId, trigger });

  if (!lockResult.acquired) {
    return {
      accepted: false,
      alreadyRunning: true,
      run: lockResult.activeRun || await findActiveRun(),
    };
  }

  const run = buildRunDocument({ runId, trigger, region, options });

  try {
    await run.save();
  } catch (error) {
    await releaseCrawlRunLock(runId);
    throw error;
  }

  const execute = () => executeCrawlRun({
    runId,
    options: {
      retailerKeys: run.retailerKeys,
      sourceKeys: run.sourceKeys,
      sourceIds: run.sourceIds,
      dryRun: run.dryRun,
      allowDisabled: run.allowDisabled,
      sourceSelectionRequested: run.sourceSelectionRequested,
    },
    trigger,
    region,
    crawlAllSourcesImpl,
  }).catch(() => {});

  if (defer) {
    setImmediate(execute);
  } else {
    await execute();
  }

  return {
    accepted: true,
    alreadyRunning: false,
    run,
  };
}

async function getLatestCrawlRun() {
  return CrawlRun.findOne({})
    .sort({ _id: -1 })
    .lean();
}

async function getCrawlRunById(runId) {
  if (!mongoose.Types.ObjectId.isValid(String(runId || ''))) {
    return null;
  }

  return CrawlRun.findById(runId).lean();
}

module.exports = {
  GLOBAL_CRAWL_LOCK_KEY,
  startCrawlRun,
  executeCrawlRun,
  getLatestCrawlRun,
  getCrawlRunById,
  serializeCrawlRun,
  _private: {
    ACTIVE_RUN_STATUSES,
    LOCK_STALE_MS,
    buildRunDocument,
    buildRunSummary,
    determineFinalStatus,
    determineMode,
    failStaleRun,
    isRunStale,
    normalizeSourceResult,
    sanitizeJsonValue,
  },
};
