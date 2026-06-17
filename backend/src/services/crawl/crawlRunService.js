const os = require('node:os');
const mongoose = require('mongoose');
const CrawlRun = require('../../models/CrawlRun');
const CrawlRunLock = require('../../models/CrawlRunLock');
const Offer = require('../../models/Offer');
const env = require('../../config/env');
const { crawlAllSources } = require('./crawlDispatcher');
const { buildCoverageMetrics, compactRejectionReasons } = require('./crawlAudit');
const logger = require('../../lib/logger');

const GLOBAL_CRAWL_LOCK_KEY = 'crawl-run-global';
const ACTIVE_RUN_STATUSES = ['queued', 'running'];
const LOCK_STALE_MS = 18 * 60 * 60 * 1000;
const EXPLICIT_RECOVERY_MIN_STALE_MS = 30 * 60 * 1000;
const DEFAULT_MAX_RUNTIME_MS = env.CRAWL_RUN_MAX_RUNTIME_MINUTES * 60 * 1000;
const DEFAULT_LOCK_HEARTBEAT_INTERVAL_MS = env.CRAWL_RUN_LOCK_HEARTBEAT_INTERVAL_SECONDS * 1000;
const DEFAULT_STALE_HEARTBEAT_MS = env.CRAWL_RUN_STALE_HEARTBEAT_MINUTES * 60 * 1000;
const DEFAULT_STARTUP_GRACE_MS = env.CRAWL_RUN_STARTUP_GRACE_SECONDS * 1000;
const PROCESS_STARTED_AT = new Date();
const CURRENT_PROCESS_OWNER_PREFIX = `${os.hostname()}:${process.pid}:`;
const SENSITIVE_DIAGNOSTIC_KEY_PATTERN = /authorization|cookie|token|secret|password|api[-_]?key|set-cookie/i;
const activeExecutionRunIds = new Map();
const OFFER_PUBLISH_STATUS_BY_RUN_STATUS = {
  success: 'crawl-run-success',
  partial: 'crawl-run-partial',
  failed: 'crawl-run-failed',
  stale: 'crawl-run-stale',
  skipped: 'crawl-run-skipped',
};
const FINAL_OFFER_PUBLISH_STATUSES = Object.values(OFFER_PUBLISH_STATUS_BY_RUN_STATUS);
const TERMINAL_RUN_STATUSES = ['success', 'partial', 'failed', 'skipped', 'stale'];

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
  if (value._bsontype === 'ObjectId' || value instanceof mongoose.Types.ObjectId) {
    return String(value);
  }
  if (value._id && value._id !== value) return asStringId(value._id);
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

function addReasonCounts(target = {}, source = {}) {
  for (const [reason, count] of Object.entries(source || {})) {
    const numeric = numberFrom(count);
    if (reason && numeric > 0) {
      target[reason] = numberFrom(target[reason]) + numeric;
    }
  }
  return target;
}

function aggregateNullableCount(current, value) {
  if (value === null || typeof value === 'undefined') {
    return current;
  }

  return numberFrom(current) + numberFrom(value);
}

function mergeFlags(target = {}, source = {}) {
  for (const [flag, value] of Object.entries(source || {})) {
    target[flag] = Boolean(target[flag] || value);
  }

  return target;
}

function hasAnyFlag(flags = {}) {
  return Object.values(flags || {}).some(Boolean);
}

function compactRecoveryReason(value) {
  return compactErrorMessage(value || 'Admin-triggered stale CrawlRun recovery.');
}

function compactShutdownReason(value) {
  return compactErrorMessage(value || 'Process shutdown interrupted this CrawlRun.');
}

function buildLockOwner(trigger = '') {
  return `${CURRENT_PROCESS_OWNER_PREFIX}${String(trigger || 'unknown')}`;
}

function isCurrentProcessLockOwner(lock) {
  return typeof lock?.owner === 'string' && lock.owner.startsWith(CURRENT_PROCESS_OWNER_PREFIX);
}

function createCrawlRunTimeoutError(timeoutMs) {
  const error = new Error(`CrawlRun exceeded maximum runtime of ${timeoutMs}ms.`);
  error.code = 'CRAWL_RUN_TIMEOUT';
  error.timeoutMs = timeoutMs;
  return error;
}

function getStartupCrawlStartGuard({
  options = {},
  trigger = '',
  envConfig = env,
  now = new Date(),
  processStartedAt = PROCESS_STARTED_AT,
} = {}) {
  const graceMs = Math.max(0, Number(envConfig.CRAWL_RUN_STARTUP_GRACE_SECONDS ?? 0) * 1000);
  const processStartedAtTime = new Date(processStartedAt).getTime();
  const nowTime = new Date(now).getTime();
  const processAgeMs = Number.isFinite(processStartedAtTime) && Number.isFinite(nowTime)
    ? Math.max(0, nowTime - processStartedAtTime)
    : null;

  if (envConfig.NODE_ENV !== 'production' || options.dryRun === true || graceMs <= 0) {
    return {
      blocked: false,
      processAgeMs,
      graceMs,
      reason: 'not-applicable',
    };
  }

  if (processAgeMs !== null && processAgeMs < graceMs) {
    return {
      blocked: true,
      processAgeMs,
      graceMs,
      retryAfterSeconds: Math.ceil((graceMs - processAgeMs) / 1000),
      reason: 'process-startup-grace',
      trigger: String(trigger || ''),
    };
  }

  return {
    blocked: false,
    processAgeMs,
    graceMs,
    reason: 'process-stable',
  };
}

function buildStartupCrawlStartError(guard = {}) {
  const retryAfterSeconds = Number.isFinite(Number(guard.retryAfterSeconds))
    ? Number(guard.retryAfterSeconds)
    : null;
  const error = new Error(
    retryAfterSeconds
      ? `Crawl start blocked during backend startup grace period. Retry after ${retryAfterSeconds}s.`
      : 'Crawl start blocked during backend startup grace period.'
  );

  error.statusCode = 409;
  error.code = 'CRAWL_STARTUP_GRACE';
  error.details = {
    reason: guard.reason || 'process-startup-grace',
    processAgeMs: guard.processAgeMs ?? null,
    graceMs: guard.graceMs ?? null,
    retryAfterSeconds,
  };

  return error;
}

async function withCrawlRunTimeout(task, timeoutMs = DEFAULT_MAX_RUNTIME_MS) {
  const effectiveTimeoutMs = Number(timeoutMs);

  if (!Number.isFinite(effectiveTimeoutMs) || effectiveTimeoutMs <= 0) {
    return task();
  }

  let timeoutId = null;

  try {
    return await Promise.race([
      task(),
      new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(createCrawlRunTimeoutError(effectiveTimeoutMs));
        }, effectiveTimeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function sanitizeJsonValue(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return toIsoOrNull(value);
  if (value._bsontype === 'ObjectId' || value instanceof mongoose.Types.ObjectId) return String(value);

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

function sanitizeDiagnosticValue(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return toIsoOrNull(value);
  if (value._bsontype === 'ObjectId' || value instanceof mongoose.Types.ObjectId) return String(value);

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticValue(item, seen));
  }

  const plain = typeof value.toObject === 'function'
    ? value.toObject({ getters: false, virtuals: false })
    : value;
  const sanitized = {};

  for (const [key, entry] of Object.entries(plain)) {
    if (typeof entry === 'undefined' || typeof entry === 'function') {
      continue;
    }

    sanitized[key] = SENSITIVE_DIAGNOSTIC_KEY_PATTERN.test(key)
      ? '[redacted]'
      : sanitizeDiagnosticValue(entry, seen);
  }

  return sanitized;
}

function buildCrawlRunProgressMarker(progress = {}, now = new Date()) {
  return sanitizeDiagnosticValue({
    ...(progress && typeof progress === 'object' ? progress : {}),
    updatedAt: now,
  });
}

async function updateCrawlRunProgress(runId, progress) {
  return CrawlRun.findByIdAndUpdate(runId, {
    $set: {
      'metadata.progress': buildCrawlRunProgressMarker(progress),
    },
  });
}

function normalizeSourceResult(source = {}) {
  if (!source || typeof source !== 'object') {
    source = {};
  }

  const foundRawItems = numberFrom(source.foundRawItems ?? source.rawCandidateCount ?? source.discoveredLinks);
  const parsedOffers = numberFrom(source.parsedOffers ?? source.offersExtracted ?? source.offersStored);
  const offersStored = numberFrom(source.offersStored);
  const rejectedOffers = numberFrom(source.rejectedOffers ?? Math.max(0, foundRawItems - parsedOffers));
  const diagnostic = sanitizeDiagnosticValue(source.diagnostic || source.diagnostics || {});
  const httpStatus = source.httpStatus ?? diagnostic.httpStatus ?? null;
  const rejectionReasons = compactRejectionReasons(source.rejectionReasons || diagnostic.rejectionReasons || []);
  const coverage = buildCoverageMetrics({
    foundRawItems,
    parsedOffers,
    offersStored,
    rejectedOffers,
    offers: source.offers || source.offerDocuments || [],
    rejectionReasons,
    validFrom: source.validFrom || diagnostic.validFrom || diagnostic.detectedValidity?.validFrom || null,
    validTo: source.validTo || diagnostic.validTo || diagnostic.detectedValidity?.validTo || null,
  });
  const rejectedByReason = {
    ...coverage.rejectedByReason,
    ...(source.rejectedByReason || {}),
  };
  const missingImageCount = source.missingImageCount ?? coverage.missingImageCount;
  const withImageCount = source.withImageCount ?? coverage.withImageCount;
  const missingQuantityCount = numberFrom(source.missingQuantityCount ?? coverage.missingQuantityCount);
  const unclearProductCount = numberFrom(source.unclearProductCount ?? coverage.unclearProductCount);
  const upcomingCount = numberFrom(source.upcomingCount ?? coverage.upcomingCount);
  const expiredCount = numberFrom(source.expiredCount ?? coverage.expiredCount);
  const parseFailedCount = numberFrom(source.parseFailedCount ?? coverage.parseFailedCount);
  const categoryUnclearCount = numberFrom(source.categoryUnclearCount ?? coverage.categoryUnclearCount);
  const flags = {
    ...coverage.flags,
    ...(source.flags || {}),
  };

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
    rejectionReasons: rejectionReasons.length > 0 ? rejectionReasons : coverage.rejectionReasons,
    rejectedByReason,
    missingImageCount,
    withImageCount,
    missingQuantityCount,
    unclearProductCount,
    upcomingCount,
    expiredCount,
    parseFailedCount,
    categoryUnclearCount,
    storedRatio: source.storedRatio ?? coverage.storedRatio,
    imageCoverageRatio: source.imageCoverageRatio ?? coverage.imageCoverageRatio,
    freshnessStatus: String(source.freshnessStatus || coverage.freshnessStatus || 'unknown'),
    flags,
    skipped: Boolean(source.skipped),
    skippedReason: String(source.skippedReason || diagnostic.boundedReason || ''),
    message: compactErrorMessage(source.message),
    error: compactErrorMessage(source.error),
    failureStage: String(source.failureStage || diagnostic.failureStage || ''),
    httpStatus: httpStatus === null || typeof httpStatus === 'undefined' ? null : numberFrom(httpStatus, null),
    contentType: String(source.contentType || diagnostic.contentType || ''),
    finalUrl: String(source.finalUrl || diagnostic.finalUrl || ''),
    diagnostic,
  };
}

function isPolicyBoundedSource(source = {}) {
  const diagnostic = source.diagnostic || {};
  return source.status === 'skipped' && (
    source.skippedReason === 'full-crawl-scoped-only-source'
    || source.failureStage === 'source-bounded-before-execution'
    || diagnostic.boundedReason === 'full-crawl-scoped-only-source'
    || diagnostic.notExecutedByPolicy === true
    || diagnostic.policyBounded === true
  );
}

function incrementRetailerSummary(map, retailerKey) {
  const key = retailerKey || 'unknown';

  if (!map.has(key)) {
    map.set(key, {
      retailerKey: key,
      matchedSources: 0,
      successfulSources: 0,
      failedSources: 0,
      skippedSources: 0,
      policyBoundedSources: 0,
      foundRawItems: 0,
      parsedOffers: 0,
      offersStored: 0,
      rejectedOffers: 0,
      rejectedByReason: {},
      missingImageCount: null,
      withImageCount: null,
      missingQuantityCount: 0,
      unclearProductCount: 0,
      upcomingCount: 0,
      expiredCount: 0,
      parseFailedCount: 0,
      categoryUnclearCount: 0,
      flags: {},
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
      skippedSources: 0,
      policyBoundedSources: 0,
      offersStored: 0,
      rejectedOffers: 0,
      rejectedByReason: {},
      missingImageCount: null,
      withImageCount: null,
      flags: {},
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
    const skipped = source.status === 'skipped';
    const policyBounded = isPolicyBoundedSource(source);

    if (source.sourceId) matchedSourceIds.add(source.sourceId);
    if (source.status === 'success') retailer.successfulSources += 1;
    if (source.status === 'success') sourceType.successfulSources += 1;
    if (failed) retailer.failedSources += 1;
    if (failed) sourceType.failedSources += 1;
    if (skipped) retailer.skippedSources += 1;
    if (skipped) sourceType.skippedSources += 1;
    if (policyBounded) retailer.policyBoundedSources += 1;
    if (policyBounded) sourceType.policyBoundedSources += 1;
    if (partial) {
      retailer.failedSources += 0;
    }

    retailer.foundRawItems += source.foundRawItems;
    retailer.parsedOffers += source.parsedOffers;
    retailer.offersStored += source.offersStored;
    retailer.rejectedOffers += source.rejectedOffers;
    addReasonCounts(retailer.rejectedByReason, source.rejectedByReason);
    retailer.missingImageCount = aggregateNullableCount(retailer.missingImageCount, source.missingImageCount);
    retailer.withImageCount = aggregateNullableCount(retailer.withImageCount, source.withImageCount);
    retailer.missingQuantityCount += source.missingQuantityCount;
    retailer.unclearProductCount += source.unclearProductCount;
    retailer.upcomingCount += source.upcomingCount;
    retailer.expiredCount += source.expiredCount;
    retailer.parseFailedCount += source.parseFailedCount;
    retailer.categoryUnclearCount += source.categoryUnclearCount;
    mergeFlags(retailer.flags, source.flags);
    sourceType.offersStored += source.offersStored;
    sourceType.rejectedOffers += source.rejectedOffers;
    addReasonCounts(sourceType.rejectedByReason, source.rejectedByReason);
    sourceType.missingImageCount = aggregateNullableCount(sourceType.missingImageCount, source.missingImageCount);
    sourceType.withImageCount = aggregateNullableCount(sourceType.withImageCount, source.withImageCount);
    mergeFlags(sourceType.flags, source.flags);
  }

  const failedSourcesCount = sources.filter((source) => source.status === 'failed').length;
  const partialSourcesCount = sources.filter((source) => source.status === 'partial').length;
  const successfulSourcesCount = sources.filter((source) => source.status === 'success').length;
  const skippedResultSourcesCount = sources.filter((source) => source.status === 'skipped').length;
  const policyBoundedSourcesCount = sources.filter(isPolicyBoundedSource).length;
  const filterMetadata = crawlResult.filterMetadata || {};
  const rejectedByReasonTotal = sources.reduce((acc, source) => addReasonCounts(acc, source.rejectedByReason), {});
  const sourceFlags = sources.reduce((acc, source) => {
    for (const [flag, value] of Object.entries(source.flags || {})) {
      if (value) {
        acc[flag] = numberFrom(acc[flag]) + 1;
      }
    }
    return acc;
  }, {});

  return {
    sources,
    matchedSourceIds: [...matchedSourceIds],
    summary: {
      totalRegisteredSources: numberFrom(sourceCoverage.totalRegisteredSources),
      activeEligibleSources: numberFrom(sourceCoverage.activeEligibleSources),
      matchedSourcesCount: matchedSources.length || sources.length,
      skippedSourcesCount: skippedSources.length + skippedResultSourcesCount,
      policyBoundedSourcesCount,
      notExecutedByPolicySourcesCount: policyBoundedSourcesCount,
      disabledSourcesCount: disabledSources.length || numberFrom(sourceCoverage.disabledSourcesCount),
      unknownSourceKeys: crawlResult.unknownSourceKeys || [],
      unknownSourceIds: crawlResult.unknownSourceIds || [],
      foundRawItemsTotal: sources.reduce((sum, source) => sum + source.foundRawItems, 0),
      parsedOffersTotal: sources.reduce((sum, source) => sum + source.parsedOffers, 0),
      offersStoredTotal: sources.reduce((sum, source) => sum + source.offersStored, 0),
      rejectedOffersTotal: sources.reduce((sum, source) => sum + source.rejectedOffers, 0),
      rejectedByReason: rejectedByReasonTotal,
      missingImageCountTotal: sources.reduce((sum, source) => aggregateNullableCount(sum, source.missingImageCount), 0),
      withImageCountTotal: sources.reduce((sum, source) => aggregateNullableCount(sum, source.withImageCount), 0),
      missingQuantityCountTotal: sources.reduce((sum, source) => sum + source.missingQuantityCount, 0),
      unclearProductCountTotal: sources.reduce((sum, source) => sum + source.unclearProductCount, 0),
      upcomingCountTotal: sources.reduce((sum, source) => sum + source.upcomingCount, 0),
      expiredCountTotal: sources.reduce((sum, source) => sum + source.expiredCount, 0),
      parseFailedCountTotal: sources.reduce((sum, source) => sum + source.parseFailedCount, 0),
      categoryUnclearCountTotal: sources.reduce((sum, source) => sum + source.categoryUnclearCount, 0),
      sourceFlags,
      flaggedSourcesCount: sources.filter((source) => hasAnyFlag(source.flags)).length,
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
    metadata: {
      progress: sanitizeDiagnosticValue(plain.metadata?.progress || null),
      scheduledReplacement: sanitizeDiagnosticValue(plain.metadata?.scheduledReplacement || null),
    },
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

  const scheduledReplacement = options.scheduledReplacement || null;
  const metadata = {};

  if (scheduledReplacement?.originalRunId) {
    metadata.scheduledReplacement = {
      originalRunId: asStringId(scheduledReplacement.originalRunId),
      reason: compactErrorMessage(scheduledReplacement.reason || 'source-less-process-restart-recovery'),
      plannedAt: scheduledReplacement.plannedAt || new Date(),
    };
  }

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
    metadata,
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
  await markOfferPublishStatusForRun({
    runId: run._id,
    runStatus: 'failed',
  });
  await releaseCrawlRunLock(run._id);
  return true;
}

async function markOfferPublishStatusForRun({
  runId,
  runStatus,
  OfferModel = Offer,
  now = new Date(),
} = {}) {
  if (!runId || !OfferModel || typeof OfferModel.updateMany !== 'function') {
    return { matchedCount: 0, modifiedCount: 0, skipped: true };
  }

  const publishStatus = OFFER_PUBLISH_STATUS_BY_RUN_STATUS[runStatus] || 'crawl-run-unknown';
  return OfferModel.updateMany(
    { crawlRunId: runId },
    {
      $set: {
        publishStatus,
        publishStatusUpdatedAt: now,
      },
    }
  );
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
          owner: buildLockOwner(trigger),
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

async function releaseRecoverableCrawlRunLock(runId, lock) {
  if (!lock) {
    return { matchedCount: 0, modifiedCount: 0, skipped: true };
  }

  const lockRunId = lock.runId ? String(lock.runId) : '';
  const runIdString = String(runId || '');
  const filter = {
    _id: GLOBAL_CRAWL_LOCK_KEY,
    status: { $in: ['queued', 'running'] },
  };

  if (lockRunId) {
    if (lockRunId !== runIdString) {
      return { matchedCount: 0, modifiedCount: 0, skipped: true, reason: 'lock-owned-by-different-run' };
    }
    filter.runId = runId;
  } else {
    filter.$or = [
      { runId: null },
      { runId: { $exists: false } },
    ];
  }

  return CrawlRunLock.updateOne(
    filter,
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

async function updateCrawlRunLockHeartbeat(runId, { trigger = '', now = new Date() } = {}) {
  return CrawlRunLock.updateOne(
    {
      _id: GLOBAL_CRAWL_LOCK_KEY,
      runId,
      status: 'running',
    },
    {
      $set: {
        heartbeatAt: now,
        expiresAt: buildLockExpiry(now),
        owner: buildLockOwner(trigger),
      },
    }
  );
}

function startCrawlRunLockHeartbeat({
  runId,
  trigger = '',
  intervalMs = DEFAULT_LOCK_HEARTBEAT_INTERVAL_MS,
  updateHeartbeat = updateCrawlRunLockHeartbeat,
  loggerImpl = logger,
} = {}) {
  const effectiveIntervalMs = Number(intervalMs);

  if (!runId || !Number.isFinite(effectiveIntervalMs) || effectiveIntervalMs <= 0) {
    return {
      stop() {},
    };
  }

  let stopped = false;
  let inFlight = false;

  const beat = async () => {
    if (stopped || inFlight) {
      return;
    }

    inFlight = true;

    try {
      const result = await updateHeartbeat(runId, { trigger, now: new Date() });

      if (Number(result?.matchedCount ?? result?.n ?? 1) === 0) {
        loggerImpl.warn('CrawlRun lock heartbeat did not match an active lock', {
          runId: String(runId),
          trigger,
        });
      }
    } catch (error) {
      loggerImpl.error('CrawlRun lock heartbeat failed', {
        runId: String(runId),
        trigger,
        message: error.message,
      });
    } finally {
      inFlight = false;
    }
  };

  const intervalId = setInterval(() => {
    beat();
  }, effectiveIntervalMs);

  if (typeof intervalId.unref === 'function') {
    intervalId.unref();
  }

  return {
    stop() {
      stopped = true;
      clearInterval(intervalId);
    },
    beat,
  };
}

function serializeLockForAudit(lock) {
  if (!lock) return null;

  return sanitizeJsonValue({
    runId: asStringId(lock.runId),
    status: lock.status || '',
    acquiredAt: toIsoOrNull(lock.acquiredAt),
    heartbeatAt: toIsoOrNull(lock.heartbeatAt),
    expiresAt: toIsoOrNull(lock.expiresAt),
    owner: lock.owner || '',
  });
}

function parseExplicitRecoveryStaleMs(value) {
  const minutes = Number(value);

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return EXPLICIT_RECOVERY_MIN_STALE_MS;
  }

  return Math.max(EXPLICIT_RECOVERY_MIN_STALE_MS, Math.round(minutes * 60 * 1000));
}

function getRunReferenceDate(run) {
  return run?.startedAt || run?.createdAt || null;
}

function isRecoverableStaleRun({ run, lock, now = new Date(), staleAfterMs = EXPLICIT_RECOVERY_MIN_STALE_MS } = {}) {
  if (!run || !ACTIVE_RUN_STATUSES.includes(run.status)) {
    return {
      recoverable: false,
      reason: 'not-active',
      ageMs: null,
      startedBeforeProcess: false,
    };
  }

  const reference = getRunReferenceDate(run);
  const referenceTime = reference ? new Date(reference).getTime() : 0;
  const lockHeartbeatTime = lock?.heartbeatAt ? new Date(lock.heartbeatAt).getTime() : 0;
  const ageMs = referenceTime > 0 ? now.getTime() - referenceTime : null;
  const lockBelongsToRun = !lock?.runId || String(lock.runId) === String(run._id);
  const ageExpired = ageMs !== null && ageMs >= staleAfterMs;
  const startedBeforeProcess =
    referenceTime > 0
    && referenceTime < PROCESS_STARTED_AT.getTime()
    && (!lockHeartbeatTime || lockHeartbeatTime < PROCESS_STARTED_AT.getTime())
    && lockBelongsToRun;

  if (!lockBelongsToRun) {
    return {
      recoverable: false,
      reason: 'lock-owned-by-different-run',
      ageMs,
      startedBeforeProcess,
    };
  }

  return {
    recoverable: ageExpired || startedBeforeProcess,
    reason: ageExpired ? 'age-threshold-exceeded' : startedBeforeProcess ? 'started-before-current-process' : 'not-stale-enough',
    ageMs,
    startedBeforeProcess,
  };
}

function isRecoverableInterruptedRunAfterRestart({
  run,
  lock,
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_HEARTBEAT_MS,
} = {}) {
  if (!run || !ACTIVE_RUN_STATUSES.includes(run.status)) {
    return {
      recoverable: false,
      reason: 'not-active',
      ageMs: null,
      startedBeforeProcess: false,
    };
  }

  const reference = getRunReferenceDate(run);
  const referenceTime = reference ? new Date(reference).getTime() : 0;
  const lockHeartbeatTime = lock?.heartbeatAt ? new Date(lock.heartbeatAt).getTime() : 0;
  const ageMs = referenceTime > 0 ? now.getTime() - referenceTime : null;
  const heartbeatAgeMs = lockHeartbeatTime > 0 ? now.getTime() - lockHeartbeatTime : ageMs;
  const lockBelongsToRun = !lock?.runId || String(lock.runId) === String(run._id);
  const heartbeatExpired = heartbeatAgeMs !== null && heartbeatAgeMs >= staleAfterMs;
  const startedBeforeProcess = referenceTime > 0 && referenceTime < PROCESS_STARTED_AT.getTime();
  const lockHeartbeatBeforeProcess = !lockHeartbeatTime || lockHeartbeatTime < PROCESS_STARTED_AT.getTime();
  const lockOwnerIsCurrentProcess =
    isCurrentProcessLockOwner(lock)
    && lockHeartbeatTime >= PROCESS_STARTED_AT.getTime();

  if (!lockBelongsToRun) {
    return {
      recoverable: false,
      reason: 'lock-owned-by-different-run',
      ageMs,
      heartbeatAgeMs,
      startedBeforeProcess,
    };
  }

  if (!startedBeforeProcess) {
    return {
      recoverable: false,
      reason: 'started-in-current-process',
      ageMs,
      heartbeatAgeMs,
      startedBeforeProcess,
    };
  }

  if (lockOwnerIsCurrentProcess) {
    return {
      recoverable: false,
      reason: 'lock-owned-by-current-process',
      ageMs,
      heartbeatAgeMs,
      startedBeforeProcess,
    };
  }

  if (!lockHeartbeatBeforeProcess && !heartbeatExpired) {
    return {
      recoverable: false,
      reason: 'lock-heartbeat-in-current-process',
      ageMs,
      heartbeatAgeMs,
      startedBeforeProcess,
    };
  }

  if (!heartbeatExpired) {
    return {
      recoverable: false,
      reason: 'not-stale-enough',
      ageMs,
      heartbeatAgeMs,
      startedBeforeProcess,
    };
  }

  return {
    recoverable: true,
    reason: 'process-restart-stale-heartbeat',
    ageMs,
    heartbeatAgeMs,
    startedBeforeProcess,
  };
}

function hasSourceExecutionEvidence(run = {}) {
  const sources = Array.isArray(run.result?.sources) ? run.result.sources : [];
  const successful = numberFrom(run.summary?.successfulSourcesCount);
  const failed = numberFrom(run.summary?.failedSourcesCount);
  const stage = String(run.metadata?.progress?.stage || '');

  return (
    sources.length > 0
    || successful > 0
    || failed > 0
    || /^source-|^crawl-dispatcher|^publish-status/.test(stage)
  );
}

function isSourceLessScheduledRestartRecoveryRun(run = {}) {
  if (!run) return false;
  const shutdownSignal = String(run.metadata?.shutdown?.signal || '');
  const progressStage = String(run.metadata?.progress?.stage || '');

  return (
    String(run.trigger || '') === 'scheduled'
    && String(run.mode || '') === 'full'
    && run.dryRun !== true
    && String(run.status || '') === 'failed'
    && (shutdownSignal === 'process-restart-recovery' || progressStage === 'process-restart-recovery')
    && !hasSourceExecutionEvidence(run)
  );
}

async function findExistingScheduledReplacementRun(originalRunId) {
  const id = asStringId(originalRunId);
  if (!id) return null;

  return CrawlRun.findOne({
    _id: { $ne: originalRunId },
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    'metadata.scheduledReplacement.originalRunId': id,
  }).sort({ startedAt: -1, createdAt: -1 });
}

async function findNewerEffectiveScheduledFullRun(originalRun) {
  const startedAt = originalRun?.startedAt || originalRun?.createdAt;
  const startedAtDate = startedAt ? new Date(startedAt) : null;
  const query = {
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
  };

  if (startedAtDate && !Number.isNaN(startedAtDate.getTime())) {
    query.$or = [
      { startedAt: { $gt: startedAtDate } },
      { createdAt: { $gt: startedAtDate } },
    ];
  }

  const newerRuns = await CrawlRun.find(query)
    .sort({ startedAt: -1, createdAt: -1 })
    .limit(10);

  return newerRuns.find((run) => (
    TERMINAL_RUN_STATUSES.includes(run.status)
      ? (run.status === 'success' || run.status === 'partial' || hasSourceExecutionEvidence(run))
      : ACTIVE_RUN_STATUSES.includes(run.status)
  )) || null;
}

async function hasOpenOfferPublishStatus() {
  const count = await Offer.countDocuments({
    status: 'active',
    isActiveNow: true,
    publishStatus: { $nin: FINAL_OFFER_PUBLISH_STATUSES },
  });
  return count > 0;
}

async function assessScheduledReplacementReadiness({ originalRunId } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(originalRunId || ''))) {
    return { eligible: false, reason: 'invalid-original-run-id' };
  }

  const originalRun = await CrawlRun.findById(originalRunId);

  if (!originalRun) {
    return { eligible: false, reason: 'original-run-not-found' };
  }

  if (!isSourceLessScheduledRestartRecoveryRun(originalRun)) {
    return {
      eligible: false,
      reason: 'original-run-not-source-less-scheduled-restart',
      originalRun,
    };
  }

  const existingReplacement = await findExistingScheduledReplacementRun(originalRun._id);

  if (existingReplacement) {
    return {
      eligible: false,
      reason: 'replacement-already-exists',
      originalRun,
      existingReplacement,
    };
  }

  const newerEffectiveRun = await findNewerEffectiveScheduledFullRun(originalRun);

  if (newerEffectiveRun) {
    return {
      eligible: false,
      reason: 'newer-effective-scheduled-full-exists',
      originalRun,
      newerEffectiveRun,
    };
  }

  const activeRun = await findActiveRun();

  if (activeRun) {
    return {
      eligible: false,
      reason: 'active-crawl-run-exists',
      originalRun,
      activeRun,
    };
  }

  const lock = await CrawlRunLock.findById(GLOBAL_CRAWL_LOCK_KEY).lean();

  if (lock?.runId) {
    return {
      eligible: false,
      reason: 'global-lock-active',
      originalRun,
      lock: serializeLockForAudit(lock),
    };
  }

  if (await hasOpenOfferPublishStatus()) {
    return {
      eligible: false,
      reason: 'publish-status-open',
      originalRun,
    };
  }

  return {
    eligible: true,
    reason: 'eligible-source-less-scheduled-restart',
    originalRun,
  };
}

async function startScheduledReplacementCrawlRun({
  originalRunId,
  region = '',
  envConfig = env,
  crawlAllSourcesImpl = crawlAllSources,
  defer = true,
} = {}) {
  const readiness = await assessScheduledReplacementReadiness({ originalRunId });

  if (!readiness.eligible) {
    return {
      accepted: false,
      alreadyRunning: false,
      replacementSkipped: true,
      reason: readiness.reason,
      originalRun: readiness.originalRun || null,
      existingReplacement: readiness.existingReplacement || null,
      newerEffectiveRun: readiness.newerEffectiveRun || null,
    };
  }

  return startCrawlRun({
    trigger: 'scheduled',
    region,
    options: {
      dryRun: false,
      scheduledReplacement: {
        originalRunId,
        reason: readiness.reason,
        plannedAt: new Date(),
      },
    },
    envConfig,
    crawlAllSourcesImpl,
    defer,
  });
}

async function recoverStaleCrawlRun({ runId, reason = '', staleAfterMinutes, now = new Date() } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(runId || ''))) {
    return {
      recovered: false,
      notFound: true,
      reason: 'invalid-run-id',
      run: null,
    };
  }

  const run = await CrawlRun.findById(runId);

  if (!run) {
    return {
      recovered: false,
      notFound: true,
      reason: 'not-found',
      run: null,
    };
  }

  const lock = await CrawlRunLock.findById(GLOBAL_CRAWL_LOCK_KEY).lean();
  const staleAfterMs = parseExplicitRecoveryStaleMs(staleAfterMinutes);
  const recoverable = isRecoverableStaleRun({ run, lock, now, staleAfterMs });

  if (!recoverable.recoverable) {
    return {
      recovered: false,
      conflict: ACTIVE_RUN_STATUSES.includes(run.status),
      reason: recoverable.reason,
      ageMs: recoverable.ageMs,
      staleAfterMs,
      processStartedAt: PROCESS_STARTED_AT,
      lock: serializeLockForAudit(lock),
      run,
    };
  }

  const reference = getRunReferenceDate(run) || now;
  const auditReason = compactRecoveryReason(reason);
  const durationMs = Math.max(0, now.getTime() - new Date(reference).getTime());
  const auditMessage = `Stale CrawlRun recovery: ${auditReason}`;

  await CrawlRun.findByIdAndUpdate(run._id, {
    $set: {
      status: 'stale',
      finishedAt: now,
      durationMs,
      'metadata.staleRecovery': {
        reason: auditReason,
        recoveredAt: now,
        recoveredBy: 'admin-route',
        previousStatus: run.status,
        staleAfterMs,
        ageMs: recoverable.ageMs,
        processStartedAt: PROCESS_STARTED_AT,
        detectionReason: recoverable.reason,
        lock: serializeLockForAudit(lock),
      },
    },
    $push: {
      warnings: auditMessage,
      errorMessages: 'CrawlRun was marked stale by admin recovery; no automatic replacement crawl was started.',
    },
  });
  let publishStatusUpdate = null;
  let publishStatusError = null;

  try {
    publishStatusUpdate = await markOfferPublishStatusForRun({
      runId: run._id,
      runStatus: 'stale',
      now,
    });
  } catch (error) {
    publishStatusError = compactErrorMessage(error.message);
    logger.warn('Stale CrawlRun recovery continued after publish status update failed', {
      runId: asStringId(run._id),
      message: publishStatusError,
    });
  }

  if (!lock?.runId || String(lock.runId) === String(run._id)) {
    await releaseRecoverableCrawlRunLock(run._id, lock);
  }

  const recoveredRun = await CrawlRun.findById(run._id);

  return {
    recovered: true,
    reason: recoverable.reason,
    ageMs: recoverable.ageMs,
    staleAfterMs,
    processStartedAt: PROCESS_STARTED_AT,
    lock: serializeLockForAudit(lock),
    publishStatusUpdate: sanitizeJsonValue(publishStatusUpdate || {}),
    publishStatusError,
    run: recoveredRun,
  };
}

async function recoverInterruptedCrawlRunsAfterRestart({
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_HEARTBEAT_MS,
  reason = 'CrawlRun was interrupted by process restart and its lock heartbeat is stale.',
} = {}) {
  const activeRuns = await CrawlRun.find({ status: { $in: ACTIVE_RUN_STATUSES } })
    .sort({ startedAt: 1, createdAt: 1 });
  const lock = await CrawlRunLock.findById(GLOBAL_CRAWL_LOCK_KEY).lean();
  const recovered = [];
  const skipped = [];

  for (const run of activeRuns) {
    const recoverable = isRecoverableInterruptedRunAfterRestart({
      run,
      lock,
      now,
      staleAfterMs,
    });

    if (!recoverable.recoverable) {
      skipped.push({
        runId: asStringId(run._id),
        reason: recoverable.reason,
        ageMs: recoverable.ageMs,
        heartbeatAgeMs: recoverable.heartbeatAgeMs,
      });
      continue;
    }

    const reference = getRunReferenceDate(run) || now;
    const durationMs = Math.max(0, now.getTime() - new Date(reference).getTime());
    const auditReason = compactRecoveryReason(reason);
    const auditMessage = `Interrupted CrawlRun recovery after restart: ${auditReason}`;
    const replacementCandidate = (
      String(run.trigger || '') === 'scheduled'
      && String(run.mode || '') === 'full'
      && run.dryRun !== true
      && !hasSourceExecutionEvidence(run)
    );
    const updatedRun = await CrawlRun.findOneAndUpdate(
      {
        _id: run._id,
        status: { $in: ACTIVE_RUN_STATUSES },
      },
      {
        $set: {
          status: 'failed',
          finishedAt: now,
          durationMs,
          'metadata.staleRecovery': {
            reason: auditReason,
            recoveredAt: now,
            recoveredBy: 'startup-recovery',
            previousStatus: run.status,
            staleAfterMs,
            ageMs: recoverable.ageMs,
            heartbeatAt: lock?.heartbeatAt || null,
            heartbeatAgeMs: recoverable.heartbeatAgeMs,
            heartbeatAgeMinutes: recoverable.heartbeatAgeMs === null ? null : Math.round((recoverable.heartbeatAgeMs / 60 / 1000) * 100) / 100,
            thresholdMs: staleAfterMs,
            thresholdMinutes: Math.round((staleAfterMs / 60 / 1000) * 100) / 100,
            processStartedAt: PROCESS_STARTED_AT,
            detectionReason: recoverable.reason,
            lockOwner: lock?.owner || '',
            lock: serializeLockForAudit(lock),
          },
          'metadata.shutdown': {
            reason: auditReason,
            signal: 'process-restart-recovery',
            interruptedAt: now,
            interruptedBy: 'startup-recovery',
            previousStatus: run.status,
            processStartedAt: PROCESS_STARTED_AT,
            detectionReason: recoverable.reason,
            lockOwner: lock?.owner || '',
          },
          'metadata.progress': buildCrawlRunProgressMarker({
            stage: 'process-restart-recovery',
            trigger: run.trigger || '',
            runStatus: 'failed',
          }, now),
          ...(replacementCandidate
            ? {
              'metadata.scheduledReplacement': {
                status: 'required',
                reason: 'source-less-process-restart-recovery',
                originalRunId: asStringId(run._id),
                detectedAt: now,
              },
            }
            : {}),
        },
        $push: {
          warnings: auditMessage,
          errorMessages: replacementCandidate
            ? 'CrawlRun was marked failed after process restart; a safe scheduled replacement crawl is required.'
            : 'CrawlRun was marked failed after process restart; no automatic replacement crawl was started.',
        },
      },
      { new: true }
    );

    if (!updatedRun) {
      skipped.push({
        runId: asStringId(run._id),
        reason: 'status-changed-before-recovery',
        ageMs: recoverable.ageMs,
        heartbeatAgeMs: recoverable.heartbeatAgeMs,
      });
      continue;
    }

    try {
      await markOfferPublishStatusForRun({
        runId: run._id,
        runStatus: 'failed',
        now,
      });
    } catch (error) {
      logger.warn('Interrupted CrawlRun recovery continued after publish status update failed', {
        runId: asStringId(run._id),
        message: compactErrorMessage(error.message),
      });
    }

    if (!lock?.runId || String(lock.runId) === String(run._id)) {
      await releaseRecoverableCrawlRunLock(run._id, lock);
    }

    recovered.push({
      runId: asStringId(run._id),
      reason: recoverable.reason,
      ageMs: recoverable.ageMs,
      heartbeatAgeMs: recoverable.heartbeatAgeMs,
      staleAfterMs,
      trigger: run.trigger || '',
      mode: run.mode || '',
      dryRun: run.dryRun === true,
      sourceLess: !hasSourceExecutionEvidence(run),
      replacementCandidate,
    });
  }

  if (recovered.length > 0) {
    logger.warn('Recovered interrupted CrawlRuns after restart', {
      recovered,
      skipped,
    });
  }

  return {
    recovered,
    skipped,
    staleAfterMs,
    processStartedAt: PROCESS_STARTED_AT,
  };
}

function trackActiveExecution(runId, { trigger = '', startedAt = new Date() } = {}) {
  const id = String(runId || '');

  if (!id) return;

  activeExecutionRunIds.set(id, {
    runId,
    trigger,
    startedAt,
  });
}

function untrackActiveExecution(runId) {
  activeExecutionRunIds.delete(String(runId || ''));
}

async function interruptCurrentProcessCrawlRuns({
  reason = 'Process shutdown interrupted this CrawlRun.',
  signal = '',
  now = new Date(),
} = {}) {
  const activeExecutions = [...activeExecutionRunIds.values()];
  const interrupted = [];
  const skipped = [];

  for (const execution of activeExecutions) {
    const run = await CrawlRun.findById(execution.runId);

    if (!run || !ACTIVE_RUN_STATUSES.includes(run.status)) {
      skipped.push({
        runId: asStringId(execution.runId),
        reason: 'not-active',
        status: run?.status || 'not-found',
      });
      untrackActiveExecution(execution.runId);
      continue;
    }

    const startedAt = run.startedAt || execution.startedAt || now;
    const durationMs = Math.max(0, now.getTime() - new Date(startedAt).getTime());
    const auditReason = compactShutdownReason(reason);
    const auditMessage = `CrawlRun interrupted by process shutdown: ${auditReason}`;
    const updatedRun = await CrawlRun.findOneAndUpdate(
      {
        _id: run._id,
        status: { $in: ACTIVE_RUN_STATUSES },
      },
      {
        $set: {
          status: 'failed',
          finishedAt: now,
          durationMs,
          'metadata.shutdown': {
            reason: auditReason,
            signal: String(signal || ''),
            interruptedAt: now,
            previousStatus: run.status,
            processStartedAt: PROCESS_STARTED_AT,
            ownerPrefix: CURRENT_PROCESS_OWNER_PREFIX,
          },
          'metadata.progress': buildCrawlRunProgressMarker({
            stage: 'process-shutdown',
            trigger: execution.trigger,
            runStatus: 'failed',
            signal: String(signal || ''),
          }, now),
        },
        $push: {
          warnings: auditMessage,
          errorMessages: 'CrawlRun was interrupted by process shutdown; no automatic replacement crawl was started.',
        },
      },
      { new: true }
    );

    if (!updatedRun) {
      skipped.push({
        runId: asStringId(run._id),
        reason: 'status-changed-before-shutdown-finalization',
      });
      untrackActiveExecution(execution.runId);
      continue;
    }

    try {
      await markOfferPublishStatusForRun({
        runId: run._id,
        runStatus: 'failed',
        now,
      });
    } catch (error) {
      logger.warn('Shutdown CrawlRun interruption continued after publish status update failed', {
        runId: asStringId(run._id),
        message: compactErrorMessage(error.message),
      });
    }

    const lock = await CrawlRunLock.findById(GLOBAL_CRAWL_LOCK_KEY).lean();
    if (!lock?.runId || String(lock.runId) === String(run._id)) {
      await releaseRecoverableCrawlRunLock(run._id, lock);
    }

    interrupted.push({
      runId: asStringId(run._id),
      trigger: execution.trigger,
      previousStatus: run.status,
      durationMs,
    });
    untrackActiveExecution(execution.runId);
  }

  return {
    interrupted,
    skipped,
    processStartedAt: PROCESS_STARTED_AT,
  };
}

async function markLockRunning(runId, { trigger = '' } = {}) {
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
        owner: buildLockOwner(trigger),
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
  maxRuntimeMs = DEFAULT_MAX_RUNTIME_MS,
  heartbeatIntervalMs = DEFAULT_LOCK_HEARTBEAT_INTERVAL_MS,
} = {}) {
  const startedAt = new Date();
  let heartbeat = null;

  trackActiveExecution(runId, { trigger, startedAt });
  await markLockRunning(runId, { trigger });
  await CrawlRun.findByIdAndUpdate(runId, {
    $set: {
      status: 'running',
      startedAt,
    },
  });
  heartbeat = startCrawlRunLockHeartbeat({ runId, trigger, intervalMs: heartbeatIntervalMs });

  try {
    const crawlResult = await withCrawlRunTimeout(() => crawlAllSourcesImpl({
      ...options,
      region,
      trigger,
      crawlRunId: runId,
      onProgress: (progress) => updateCrawlRunProgress(runId, {
        ...progress,
        trigger,
      }),
    }), maxRuntimeMs);
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
    await updateCrawlRunProgress(runId, {
      stage: 'publish-status-started',
      trigger,
      runStatus: status,
    });
    const publishResult = await markOfferPublishStatusForRun({
      runId,
      runStatus: status,
      now: finishedAt,
    });
    await updateCrawlRunProgress(runId, {
      stage: 'publish-status-finished',
      trigger,
      runStatus: status,
      matchedCount: publishResult?.matchedCount ?? publishResult?.n ?? null,
      modifiedCount: publishResult?.modifiedCount ?? publishResult?.nModified ?? null,
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
    const timedOut = error?.code === 'CRAWL_RUN_TIMEOUT';

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
        warnings: [
          timedOut
            ? 'CrawlRun exceeded maximum runtime and was marked failed; existing live offers were not globally cleared.'
            : 'CrawlRun failed before a complete crawl result was available; existing live offers were not globally cleared.',
        ],
        ...(timedOut ? {
          'metadata.timeout': {
            timeoutMs: error.timeoutMs,
            failedAt: finishedAt,
          },
        } : {}),
      },
    });
    await updateCrawlRunProgress(runId, {
      stage: 'publish-status-started',
      trigger,
      runStatus: 'failed',
    });
    const publishResult = await markOfferPublishStatusForRun({
      runId,
      runStatus: 'failed',
      now: finishedAt,
    });
    await updateCrawlRunProgress(runId, {
      stage: 'publish-status-finished',
      trigger,
      runStatus: 'failed',
      matchedCount: publishResult?.matchedCount ?? publishResult?.n ?? null,
      modifiedCount: publishResult?.modifiedCount ?? publishResult?.nModified ?? null,
    });

    logger.error('CrawlRun failed', {
      runId: String(runId),
      trigger,
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
  } finally {
    if (heartbeat) {
      heartbeat.stop();
    }
    untrackActiveExecution(runId);
    await releaseCrawlRunLock(runId);
  }
}

async function startCrawlRun({
  options = {},
  trigger = 'manual',
  region = '',
  crawlAllSourcesImpl = crawlAllSources,
  defer = true,
  envConfig = env,
} = {}) {
  const startupGuard = getStartupCrawlStartGuard({
    options,
    trigger,
    envConfig,
  });

  if (startupGuard.blocked) {
    logger.warn('CrawlRun start blocked during backend startup grace period', {
      trigger,
      mode: determineMode(options),
      processAgeMs: startupGuard.processAgeMs,
      graceMs: startupGuard.graceMs,
      retryAfterSeconds: startupGuard.retryAfterSeconds,
    });
    throw buildStartupCrawlStartError(startupGuard);
  }

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
  const runs = await CrawlRun.collection
    .find({})
    .sort({ _id: -1 })
    .limit(1)
    .toArray();

  return runs[0] || null;
}

async function getCrawlRunById(runId) {
  if (!mongoose.Types.ObjectId.isValid(String(runId || ''))) {
    return null;
  }

  return CrawlRun.collection.findOne({
    _id: new mongoose.Types.ObjectId(String(runId)),
  });
}

module.exports = {
  GLOBAL_CRAWL_LOCK_KEY,
  startCrawlRun,
  startScheduledReplacementCrawlRun,
  assessScheduledReplacementReadiness,
  executeCrawlRun,
  getLatestCrawlRun,
  getCrawlRunById,
  interruptCurrentProcessCrawlRuns,
  recoverInterruptedCrawlRunsAfterRestart,
  recoverStaleCrawlRun,
  serializeCrawlRun,
  _private: {
    ACTIVE_RUN_STATUSES,
    CURRENT_PROCESS_OWNER_PREFIX,
    DEFAULT_LOCK_HEARTBEAT_INTERVAL_MS,
    DEFAULT_STALE_HEARTBEAT_MS,
    DEFAULT_STARTUP_GRACE_MS,
    EXPLICIT_RECOVERY_MIN_STALE_MS,
    LOCK_STALE_MS,
    PROCESS_STARTED_AT,
    buildStartupCrawlStartError,
    buildLockOwner,
    buildRunDocument,
    buildRunSummary,
    determineFinalStatus,
    determineMode,
    failStaleRun,
    getStartupCrawlStartGuard,
    assessScheduledReplacementReadiness,
    activeExecutionRunIds,
    findExistingScheduledReplacementRun,
    findNewerEffectiveScheduledFullRun,
    hasOpenOfferPublishStatus,
    hasSourceExecutionEvidence,
    isCurrentProcessLockOwner,
    interruptCurrentProcessCrawlRuns,
    isRecoverableInterruptedRunAfterRestart,
    isSourceLessScheduledRestartRecoveryRun,
    isRecoverableStaleRun,
    isRunStale,
    markOfferPublishStatusForRun,
    normalizeSourceResult,
    parseExplicitRecoveryStaleMs,
    releaseRecoverableCrawlRunLock,
    buildCrawlRunProgressMarker,
    sanitizeJsonValue,
    sanitizeDiagnosticValue,
    serializeLockForAudit,
    startCrawlRunLockHeartbeat,
    updateCrawlRunLockHeartbeat,
    withCrawlRunTimeout,
  },
};
