const Source = require('../../models/Source');
const CrawlJob = require('../../models/CrawlJob');
const RawDocument = require('../../models/RawDocument');
const Offer = require('../../models/Offer');
const AdminFeedback = require('../../models/AdminFeedback');
const OfferFeedback = require('../../models/OfferFeedback');
const Retailer = require('../../models/Retailer');
const CrawlRun = require('../../models/CrawlRun');
const CrawlRunLock = require('../../models/CrawlRunLock');
const mongoose = require('mongoose');
const env = require('../../config/env');
const { buildSafeBuildInfo } = require('../buildInfo');
const { buildComparisonSnapshot } = require('../comparisons/comparisonService');
const { buildAnalyticsSummary } = require('../analytics/analyticsService');
const { classifyOfferSourceQuality } = require('../offers/sourceQuality');
const logger = require('../../lib/logger');

const COMPARISON_SNAPSHOT_TIMEOUT_MS = 3000;
const DASHBOARD_QUERY_MAX_TIME_MS = 5000;
const ACTIVE_OFFER_DIAGNOSTIC_LIMIT = 5000;
const DASHBOARD_AGGREGATE_RESULT_LIMIT = 50;
const HEAVY_OFFER_DIAGNOSTICS_ENABLED = false;
const GLOBAL_CRAWL_LOCK_KEY = 'crawl-run-global';
const TERMINAL_CRAWL_STATUSES = new Set(['success', 'partial', 'failed', 'skipped', 'stale']);
const ACTIVE_CRAWL_STATUSES = new Set(['queued', 'running']);
const FINAL_PUBLISH_STATUSES = new Set([
  'crawl-run-success',
  'crawl-run-partial',
  'crawl-run-failed',
  'crawl-run-skipped',
  'crawl-run-stale',
]);
const INTERMEDIATE_PUBLISH_STATUSES = new Set(['', 'source-written', 'queued', 'running']);
const PROMOTION_TYPES = new Set(['multi-buy', 'threshold', 'card-required', 'conditional-price', 'sticker']);
const FEEDBACK_OPEN_STATUSES = new Set(['new', 'reviewing']);
const FEEDBACK_RESOLVED_STATUSES = new Set(['resolved', 'ignored']);
const FEEDBACK_DOCUMENT_LIMIT = 5000;
const ANALYSIS_FEEDBACK_SNIPPET_LIMIT = 160;
const SPAR_FAMILY_KEYS = new Set(['spar', 'eurospar', 'interspar']);
const SENSITIVE_ANALYSIS_PATTERNS = [
  /ipAddress/gi,
  /remoteAddress/gi,
  /userAgent/gi,
  /sessionIdHash/gi,
  /sessionId/gi,
  /clientContext/gi,
  /adminKey/gi,
  /ADMIN_API_KEY/g,
  /https?:\/\/[^\s"']+/gi,
  /www\.[^\s"']+/gi,
];

function buildCurrentAvailabilityMatch() {
  const now = new Date();

  return {
    $and: [
      {
        $or: [
          { validFrom: { $lte: now } },
          { validFrom: null, 'rawFacts.snapshotCurrent': true },
        ],
      },
      {
        $or: [
          { validTo: { $gte: now } },
          { validTo: null, 'rawFacts.snapshotCurrent': true },
        ],
      },
    ],
  };
}

function buildDashboardActiveOfferMatch() {
  return {
    status: 'active',
    isActiveNow: true,
  };
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asStringId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value._bsontype === 'ObjectId') return String(value);
  if (value._id && value._id !== value) return asStringId(value._id);
  return String(value);
}

function numberFrom(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 1000) / 1000;
}

function rate(count, total) {
  const safeTotal = numberFrom(total);
  if (safeTotal <= 0) return 0;
  return roundRatio(numberFrom(count) / safeTotal);
}

function compactStrings(values = [], limit = 6) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, limit);
}

function truncate(value, maxLength = 320) {
  const text = String(value || '').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function sanitizeAnalysisText(value, maxLength = 320) {
  let text = String(value || '').replace(/\s+/g, ' ').trim();

  for (const pattern of SENSITIVE_ANALYSIS_PATTERNS) {
    text = text.replace(pattern, '[redacted]');
  }

  return truncate(text, maxLength);
}

function quoteYaml(value) {
  if (value === true || value === false) return String(value);
  if (value === null || value === undefined || value === '') return 'unknown';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return JSON.stringify(sanitizeAnalysisText(value, 1000));
}

function scalarYaml(value) {
  if (value === true || value === false) return String(value);
  if (value === null || value === undefined || value === '') return 'unknown';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return sanitizeAnalysisText(value, 1000);
}

function percentText(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'unknown';
  return `${Math.round(numeric * 100)}%`;
}

function durationText(ms) {
  const numeric = Number(ms);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'unknown';
  const seconds = Math.round(numeric / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${restSeconds}s`;
  return `${restSeconds}s`;
}

function toDayKey(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function createCountRowsFromMap(map, keyName, limit = 20) {
  return [...map.entries()]
    .map(([key, count]) => ({ [keyName]: key || 'unknown', count }))
    .sort((left, right) => right.count - left.count || String(left[keyName]).localeCompare(String(right[keyName])))
    .slice(0, limit);
}

function collectStructuredFeedbackNote(structuredDetails = {}, reasons = []) {
  const reasonList = Array.isArray(reasons) ? reasons : [];

  for (const reason of reasonList) {
    const details = structuredDetails?.[reason];
    const note = details?.userNote
      || details?.userExpectedConditionText
      || details?.userSawDifferentCondition
      || details?.duplicateReason
      || details?.checkedWhere
      || '';

    if (note) return note;
  }

  for (const details of Object.values(structuredDetails || {})) {
    if (details?.userNote) return details.userNote;
  }

  return '';
}

function sanitizeLatestFeedbackDocument(doc = {}) {
  const reasons = compactStrings(doc.reasons || [], 6);
  const offerSnapshot = doc.offerSnapshot || {};
  const offerRef = doc.offerRef || {};
  const pageContext = doc.pageContext || {};
  const snippetSource = doc.freeText || collectStructuredFeedbackNote(doc.structuredDetails, reasons);

  return {
    id: asStringId(doc._id || doc.id),
    createdAt: toIsoOrNull(doc.createdAt),
    updatedAt: toIsoOrNull(doc.updatedAt),
    type: doc.type || 'offer_feedback',
    status: doc.status || 'unknown',
    reasons,
    primaryReason: reasons[0] || 'unknown',
    retailerKey: offerSnapshot.retailerKey || '',
    retailerLabel: offerSnapshot.retailerLabel || offerSnapshot.retailerKey || '',
    offerId: offerRef.offerId || '',
    offerTitle: truncate(offerSnapshot.title || offerSnapshot.displayTitle || '', 120),
    query: truncate(pageContext.query || doc.structuredDetails?.search_result_wrong?.query || '', 120),
    path: truncate(pageContext.path || '', 160),
    snippet: truncate(snippetSource, 180),
  };
}

function serializeCrawlRun(run) {
  if (!run) return null;
  const plain = typeof run.toObject === 'function' ? run.toObject({ getters: false, virtuals: false }) : run;
  const sources = Array.isArray(plain.result?.sources) ? plain.result.sources : [];
  const progress = plain.metadata?.progress || {};

  return {
    id: asStringId(plain._id || plain.id),
    status: plain.status || 'unknown',
    trigger: plain.trigger || '',
    mode: plain.mode || '',
    dryRun: Boolean(plain.dryRun),
    region: plain.region || '',
    startedAt: toIsoOrNull(plain.startedAt),
    finishedAt: toIsoOrNull(plain.finishedAt),
    durationMs: plain.durationMs ?? null,
    warnings: compactStrings(plain.warnings || [], 8),
    errorMessages: compactStrings(plain.errorMessages || [], 8),
    lastStage: progress.stage || '',
    publishStatusFinished: progress.stage === 'publish-status-finished',
    publishRunStatus: progress.runStatus || '',
    publishMatchedCount: progress.matchedCount ?? null,
    publishModifiedCount: progress.modifiedCount ?? null,
    publishStatusUpdatedAt: toIsoOrNull(progress.updatedAt),
    metadata: {
      scheduledReplacement: plain.metadata?.scheduledReplacement || null,
    },
    summary: plain.summary || {},
    perRetailer: Array.isArray(plain.perRetailer) ? plain.perRetailer : [],
    sourceTypes: Array.isArray(plain.sourceTypes) ? plain.sourceTypes : [],
    sources: sources.map((source) => ({
      sourceKey: source.sourceKey || '',
      retailerKey: source.retailerKey || '',
      retailerName: source.retailerName || '',
      sourceType: source.sourceType || '',
      channel: source.channel || '',
      status: source.status || 'unknown',
      offersStored: numberFrom(source.offersStored),
      parsedOffers: numberFrom(source.parsedOffers),
      foundRawItems: numberFrom(source.foundRawItems),
      error: truncate(source.error || source.message || ''),
      failureStage: source.failureStage || '',
      httpStatus: source.httpStatus ?? null,
    })),
  };
}

function crawlStatusLevel(run) {
  if (!run) return 'yellow';
  if (ACTIVE_CRAWL_STATUSES.has(run.status)) return 'yellow';
  if (run.status === 'failed' || run.status === 'stale') return 'red';
  if (run.status === 'partial' || run.status === 'skipped') return 'yellow';
  if (run.status === 'success') return 'green';
  return 'red';
}

function findLatestManualFullCrawl(crawlHistory = []) {
  return (crawlHistory || []).find((run) => (
    run?.trigger === 'manual'
    && run?.mode === 'full'
    && run?.dryRun !== true
  )) || null;
}

function detectSourceErrorType(source = {}) {
  const text = `${source.failureStage || ''} ${source.error || ''}`.toLowerCase();

  if (source.httpStatus) return `http-${source.httpStatus}`;
  if (/\b404\b/.test(text)) return 'http-404';
  if (/timeout|timed out/.test(text)) return 'timeout';
  if (/fetch|network|socket|econn/.test(text)) return 'fetch';
  if (/parse|parser/.test(text)) return 'parse';
  return source.failureStage || 'source-error';
}

function isPolicyBoundedDashboardSource(source = {}) {
  const diagnostic = source.diagnostic || {};
  return source.status === 'skipped' && (
    source.skippedReason === 'full-crawl-scoped-only-source'
    || source.failureStage === 'source-bounded-before-execution'
    || diagnostic.boundedReason === 'full-crawl-scoped-only-source'
    || diagnostic.notExecutedByPolicy === true
    || diagnostic.policyBounded === true
  );
}

function isSourceLessProcessRestartRecoveryRun(run) {
  if (!run || run.status !== 'failed') return false;

  const sourceCount = Array.isArray(run.sources) ? run.sources.length : 0;
  if (sourceCount > 0) return false;

  const successfulSourcesCount = numberFrom(run.summary?.successfulSourcesCount, 0);
  const failedSourcesCount = numberFrom(run.summary?.failedSourcesCount, 0);
  if (successfulSourcesCount > 0 || failedSourcesCount > 0) return false;

  const text = [
    run.lastStage,
    ...(Array.isArray(run.warnings) ? run.warnings : []),
    ...(Array.isArray(run.errorMessages) ? run.errorMessages : []),
    run.summary?.error,
    run.summary?.reason,
  ].filter(Boolean).join(' ').toLowerCase();

  return /process-restart-recovery|stale crawlrun recovery after restart|previous process/.test(text);
}

function getScheduledReplacementStatus(run = {}) {
  const replacement = run?.metadata?.scheduledReplacement || {};
  const status = String(replacement.status || '').trim();

  if (status === 'required' || status === 'planned' || status === 'replacementFailedExhausted') {
    return status;
  }

  return '';
}

function isScheduledReplacementExhausted(run = {}) {
  return getScheduledReplacementStatus(run) === 'replacementFailedExhausted';
}

function scheduledDailyStatusLevel(run) {
  if (!run) return 'yellow';
  if (isScheduledReplacementExhausted(run)) {
    return 'red';
  }
  if (isSourceLessProcessRestartRecoveryRun(run) && getScheduledReplacementStatus(run)) {
    return 'yellow';
  }
  return crawlStatusLevel(run);
}

function buildSourceFailureDiagnosis(run) {
  if (isSourceLessProcessRestartRecoveryRun(run)) {
    const replacementStatus = getScheduledReplacementStatus(run);

    return {
      level: isScheduledReplacementExhausted(run) ? 'red' : replacementStatus ? 'yellow' : 'red',
      failedSourcesCount: 0,
      p0ReliabilityCount: 1,
      p1SourceCoverageCount: 0,
      policyBoundedSourcesCount: 0,
      notExecutedByPolicySourcesCount: 0,
      reason: replacementStatus
        ? isScheduledReplacementExhausted(run)
          ? 'Reference crawl failed source-less after restart; automatic replacement attempts are exhausted and operator action is required.'
          : `Reference crawl failed before any source produced a result; scheduled replacement is ${replacementStatus}.`
        : 'Reference crawl failed before any source produced a result because process-restart recovery finalized a previous-process run; this is P0 crawl runtime reliability, not a source/parser failure.',
      groups: [
        {
          sourceType: 'crawl-runtime',
          errorType: 'process-restart-recovery',
          count: 1,
          severity: isScheduledReplacementExhausted(run) ? 'red' : replacementStatus ? 'yellow' : 'red',
          classification: 'P0 Crawl Runtime',
          sourceKeys: [],
        },
      ],
      policyBoundedGroups: [],
    };
  }

  const failedSources = (run?.sources || []).filter((source) => source.status === 'failed');
  const policyBoundedSources = (run?.sources || []).filter(isPolicyBoundedDashboardSource);
  const groups = new Map();

  for (const source of failedSources) {
    const errorType = detectSourceErrorType(source);
    const sourceType = source.sourceType || source.channel || 'unknown';
    const key = `${sourceType}:${errorType}`;

    if (!groups.has(key)) {
      groups.set(key, {
        sourceType,
        errorType,
        count: 0,
        severity: 'yellow',
        classification: 'P1 Source/Coverage',
        sourceKeys: [],
      });
    }

    const group = groups.get(key);
    group.count += 1;
    group.sourceKeys.push(source.sourceKey || 'unknown');
  }

  const p1SourceCoverageCount = [...groups.values()]
    .filter((group) => group.classification === 'P1 Source/Coverage')
    .reduce((sum, group) => sum + group.count, 0);

  return {
    level: failedSources.length > 0 ? 'yellow' : 'green',
    failedSourcesCount: failedSources.length,
    p0ReliabilityCount: 0,
    p1SourceCoverageCount,
    policyBoundedSourcesCount: policyBoundedSources.length,
    notExecutedByPolicySourcesCount: policyBoundedSources.length,
    reason: failedSources.length > 0
      ? `${failedSources.length} failed source(s) are classified separately from crawl finalization/lock reliability; ${policyBoundedSources.length} source(s) were not executed by policy.`
      : 'No failed sources in the reference crawl.',
    groups: [...groups.values()],
    policyBoundedGroups: policyBoundedSources.length > 0
      ? [
        {
          reason: 'full-crawl-scoped-only-source',
          count: policyBoundedSources.length,
          classification: 'notExecutedByPolicy',
          sourceKeys: policyBoundedSources.map((source) => source.sourceKey || 'unknown'),
        },
      ]
      : [],
  };
}

function buildCrawlReliabilityStatus({
  latestScheduledFullCrawl,
  latestCrawl,
  crawlHistory,
  activeCrawlRun,
  lockStatus,
  publishStatusSummary,
} = {}) {
  const latestManualFullCrawl = findLatestManualFullCrawl(crawlHistory) || (
    latestCrawl?.trigger === 'manual' && latestCrawl?.mode === 'full' && latestCrawl?.dryRun !== true
      ? latestCrawl
      : null
  );
  const scheduledLevel = scheduledDailyStatusLevel(latestScheduledFullCrawl);
  const lockFree = lockStatus?.isBlocked === false;
  const hasActiveBlockedRun = Boolean(activeCrawlRun && ACTIVE_CRAWL_STATUSES.has(activeCrawlRun.status));
  const manualFullTerminal = latestManualFullCrawl
    ? TERMINAL_CRAWL_STATUSES.has(latestManualFullCrawl.status) && Boolean(latestManualFullCrawl.finishedAt)
    : false;
  const finalizationComplete = Boolean(latestManualFullCrawl?.publishStatusFinished);
  const publishFinal = publishStatusSummary?.status === 'final' && numberFrom(publishStatusSummary?.openCount) === 0;
  const hasFinalizationProof = (manualFullTerminal && finalizationComplete) || publishFinal;
  const currentStateLevel = lockFree && !hasActiveBlockedRun && hasFinalizationProof
    ? 'green'
    : 'red';
  const awaitingNextScheduledDailyConfirmation = Boolean(
    latestScheduledFullCrawl
    && latestScheduledFullCrawl.status === 'stale'
    && currentStateLevel === 'green'
  );
  const sourceFailureReferenceCrawl = isSourceLessProcessRestartRecoveryRun(latestScheduledFullCrawl)
    ? latestScheduledFullCrawl
    : latestManualFullCrawl || latestCrawl || latestScheduledFullCrawl;
  const sourceFailures = buildSourceFailureDiagnosis(sourceFailureReferenceCrawl);

  return {
    scheduledDaily: {
      level: scheduledLevel,
      status: latestScheduledFullCrawl?.status || 'unknown',
      runId: latestScheduledFullCrawl?.id || '',
      startedAt: latestScheduledFullCrawl?.startedAt || null,
      finishedAt: latestScheduledFullCrawl?.finishedAt || null,
      reason: latestScheduledFullCrawl
        ? isScheduledReplacementExhausted(latestScheduledFullCrawl)
          ? 'Latest scheduled full crawl failed source-less after restart; automatic replacement attempts are exhausted and operator action is required.'
          : getScheduledReplacementStatus(latestScheduledFullCrawl)
          ? 'Latest scheduled full crawl failed source-less after restart; a scheduled replacement is required/planned.'
          : scheduledLevel === 'red'
          ? 'Latest scheduled full crawl is not healthy; keep scheduled daily reliability on watch.'
          : 'Latest scheduled full crawl is terminal.'
        : 'No scheduled full crawl is available.',
    },
    currentCrawlSystem: {
      level: currentStateLevel,
      lockState: lockStatus?.state || 'unknown',
      lockFree,
      activeRunBlocked: hasActiveBlockedRun || lockStatus?.isBlocked === true,
      activeRunId: activeCrawlRun?.id || '',
      latestManualFullCrawl: latestManualFullCrawl ? {
        id: latestManualFullCrawl.id,
        status: latestManualFullCrawl.status,
        terminal: manualFullTerminal,
        startedAt: latestManualFullCrawl.startedAt,
        finishedAt: latestManualFullCrawl.finishedAt,
        durationMs: latestManualFullCrawl.durationMs,
        successfulSourcesCount: numberFrom(latestManualFullCrawl.summary?.successfulSourcesCount),
        failedSourcesCount: numberFrom(latestManualFullCrawl.summary?.failedSourcesCount),
        lastStage: latestManualFullCrawl.lastStage || '',
        publishStatusFinished: finalizationComplete,
        publishMatchedCount: latestManualFullCrawl.publishMatchedCount ?? null,
        publishModifiedCount: latestManualFullCrawl.publishModifiedCount ?? null,
      } : null,
      finalizationLockBlocker: currentStateLevel === 'green' ? 'green' : 'needs-attention',
      finalizationLockBlockerLabel: currentStateLevel === 'green'
        ? 'Recovered/green'
        : 'Needs attention',
      awaitingNextScheduledDailyConfirmation,
      reason: currentStateLevel === 'green'
        ? 'Current crawl lock is free, no active blocked run exists, and active offer publish status is final.'
        : 'Current crawl system state still has an active lock/run or lacks final publish-state evidence.',
    },
    sourceFailures,
  };
}

function serializeLock(lock, now = new Date()) {
  if (!lock) {
    return {
      state: 'free',
      isBlocked: false,
      reason: 'Kein globaler Crawl-Lock vorhanden.',
      lock: null,
    };
  }

  const expiresAt = lock.expiresAt ? new Date(lock.expiresAt) : null;
  const heartbeatAt = lock.heartbeatAt ? new Date(lock.heartbeatAt) : null;
  const heartbeatAgeMs = heartbeatAt && !Number.isNaN(heartbeatAt.getTime())
    ? now.getTime() - heartbeatAt.getTime()
    : null;
  const staleHeartbeatMs = env.CRAWL_RUN_STALE_HEARTBEAT_MINUTES * 60 * 1000;
  const expired = expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime();
  const hasRunId = Boolean(lock.runId);
  const activeStatus = lock.status === 'queued' || lock.status === 'running';
  const isBlocked = Boolean(activeStatus && hasRunId && !expired);
  const staleHeartbeat = isBlocked && heartbeatAgeMs !== null && heartbeatAgeMs > staleHeartbeatMs;

  return {
    state: isBlocked ? (staleHeartbeat ? 'blocked-stale-heartbeat' : 'blocked') : 'free',
    isBlocked,
    staleHeartbeat,
    heartbeatAgeMs,
    staleHeartbeatThresholdMs: staleHeartbeatMs,
    reason: isBlocked
      ? staleHeartbeat
        ? 'Globaler Crawl-Lock ist blockiert und der Heartbeat ist zu alt.'
        : 'Globaler Crawl-Lock ist durch einen aktiven Run belegt.'
      : 'Globaler Crawl-Lock ist frei.',
    lock: {
      runId: asStringId(lock.runId),
      status: lock.status || '',
      acquiredAt: toIsoOrNull(lock.acquiredAt),
      heartbeatAt: toIsoOrNull(lock.heartbeatAt),
      expiresAt: toIsoOrNull(lock.expiresAt),
      owner: lock.owner || '',
    },
  };
}

function hasConditionEvidence(offer = {}) {
  return Boolean(
    String(offer.conditionsText || '').trim()
    || offer.hasConditions
    || offer.isMultiBuy
    || PROMOTION_TYPES.has(String(offer.effectiveDiscountType || ''))
    || numberFrom(offer.minimumPurchaseQty, 1) > 1
    || offer.discountPercent != null
    || offer.discountUpToPercent != null
  );
}

function hasImage(offer = {}) {
  return Boolean(String(offer.imageUrl || '').trim() || String(offer.rawFacts?.imageUrl || '').trim());
}

function hasSafeValidity(offer = {}, sourceQuality = {}) {
  return Boolean(
    offer.validFrom && offer.validTo
    || offer.validTo && sourceQuality.hasValidityEvidence
    || offer.rawFacts?.validitySource
    || offer.rawFacts?.validTo
  );
}

function isComparisonSafe(offer = {}) {
  return Boolean(offer.quality?.comparisonSafe || offer.normalizedUnitPrice?.comparable);
}

function isFinalPublishStatus(status) {
  return FINAL_PUBLISH_STATUSES.has(String(status || ''));
}

function isIntermediatePublishStatus(status) {
  return INTERMEDIATE_PUBLISH_STATUSES.has(String(status || ''));
}

function incrementCount(map, key, by = 1) {
  const safeKey = String(key || 'unknown');
  map.set(safeKey, numberFrom(map.get(safeKey)) + by);
}

function createOfferCounters(retailerKey = '', retailerName = '') {
  return {
    retailerKey,
    retailerName,
    activeOffers: 0,
    officialOffers: 0,
    aggregatorOffers: 0,
    safeValidityOffers: 0,
    missingValidToOffers: 0,
    conditionOffers: 0,
    comparisonSafeOffers: 0,
    imageOffers: 0,
    aggregatorRiskOffers: 0,
  };
}

function withOfferRates(item) {
  return {
    ...item,
    officialCoverageRate: rate(item.officialOffers, item.activeOffers),
    validityConfidenceRate: rate(item.safeValidityOffers, item.activeOffers),
    conditionDetectionRate: rate(item.conditionOffers, item.activeOffers),
    comparisonSafetyRate: rate(item.comparisonSafeOffers, item.activeOffers),
    imageCoverageRate: rate(item.imageOffers, item.activeOffers),
    aggregatorRiskRate: rate(item.aggregatorRiskOffers, item.activeOffers),
  };
}

function addRetailerWarningStatus(row) {
  const warningStatus = row.activeOffers < 10
    || row.officialOffers === 0
    || row.validityConfidenceRate < 0.5
    || row.aggregatorRiskRate >= 0.6
    ? 'red'
    : row.activeOffers < 30
      || row.officialCoverageRate < 0.35
      || row.validityConfidenceRate < 0.75
      || row.imageCoverageRate < 0.4
      ? 'yellow'
      : 'green';

  return {
    ...row,
    warningStatus,
  };
}

function buildOfferDiagnostics(activeOffers = []) {
  const totals = createOfferCounters();
  const retailerMap = new Map();
  const sourceTypeMap = new Map();
  const publishStatusMap = new Map();

  for (const offer of activeOffers) {
    const sourceQuality = classifyOfferSourceQuality(offer);
    const retailerKey = offer.retailerKey || 'unknown';
    const sourceType = offer.sourceType || sourceQuality.sourceClass || 'unknown';
    const retailerName = offer.retailerName || retailerKey;

    if (!retailerMap.has(retailerKey)) {
      retailerMap.set(retailerKey, createOfferCounters(retailerKey, retailerName));
    }

    const retailer = retailerMap.get(retailerKey);
    const official = Boolean(sourceQuality.hasOfficialEvidence || sourceQuality.sourceClass.startsWith('official'));
    const aggregator = sourceQuality.sourceClass === 'aggregator' || sourceQuality.sourceClass === 'aggregator-ppcv';
    const safeValidity = hasSafeValidity(offer, sourceQuality);
    const condition = hasConditionEvidence(offer);
    const comparisonSafe = isComparisonSafe(offer);
    const imagePresent = hasImage(offer);
    const aggregatorRisk = Boolean(aggregator && (!safeValidity || sourceQuality.isLowConfidenceAggregator));

    for (const target of [totals, retailer]) {
      target.activeOffers += 1;
      if (official) target.officialOffers += 1;
      if (aggregator) target.aggregatorOffers += 1;
      if (safeValidity) target.safeValidityOffers += 1;
      if (!offer.validTo) target.missingValidToOffers += 1;
      if (condition) target.conditionOffers += 1;
      if (comparisonSafe) target.comparisonSafeOffers += 1;
      if (imagePresent) target.imageOffers += 1;
      if (aggregatorRisk) target.aggregatorRiskOffers += 1;
    }

    incrementCount(sourceTypeMap, sourceType);
    incrementCount(publishStatusMap, offer.publishStatus || 'unknown');
  }

  const retailerMatrix = [...retailerMap.values()].map((item) => addRetailerWarningStatus(withOfferRates(item))).sort((left, right) => {
    if (left.warningStatus !== right.warningStatus) {
      return ['red', 'yellow', 'green'].indexOf(left.warningStatus) - ['red', 'yellow', 'green'].indexOf(right.warningStatus);
    }
    return right.activeOffers - left.activeOffers;
  });

  const publishStatuses = [...publishStatusMap.entries()]
    .map(([status, count]) => ({
      status,
      count,
      final: isFinalPublishStatus(status),
      intermediate: isIntermediatePublishStatus(status),
    }))
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status));
  const openPublishCount = publishStatuses
    .filter((item) => item.intermediate)
    .reduce((sum, item) => sum + item.count, 0);

  return {
    offerSummary: withOfferRates({
      ...totals,
      activeOfferCount: totals.activeOffers,
    }),
    retailerMatrix,
    sourceTypeSummary: [...sourceTypeMap.entries()]
      .map(([sourceType, count]) => ({ sourceType, count }))
      .sort((left, right) => right.count - left.count || left.sourceType.localeCompare(right.sourceType)),
    publishStatusSummary: {
      totalActiveOffers: totals.activeOffers,
      finalCount: totals.activeOffers - openPublishCount,
      openCount: openPublishCount,
      finalRate: rate(totals.activeOffers - openPublishCount, totals.activeOffers),
      status: openPublishCount > 0 ? 'open' : totals.activeOffers > 0 ? 'final' : 'unknown',
      statuses: publishStatuses,
    },
  };
}

function buildUnavailableOfferDiagnostics(message = 'Offer diagnostics unavailable') {
  return {
    offerSummary: {
      ...createOfferCounters(),
      activeOffers: null,
      activeOfferCount: null,
      officialOffers: null,
      aggregatorOffers: null,
      safeValidityOffers: null,
      missingValidToOffers: null,
      conditionOffers: null,
      comparisonSafeOffers: null,
      imageOffers: null,
      aggregatorRiskOffers: null,
      officialCoverageRate: null,
      validityConfidenceRate: null,
      conditionDetectionRate: null,
      comparisonSafetyRate: null,
      imageCoverageRate: null,
      aggregatorRiskRate: null,
      unavailable: true,
      message,
    },
    retailerMatrix: [],
    sourceTypeSummary: [],
    publishStatusSummary: {
      totalActiveOffers: null,
      finalCount: null,
      openCount: null,
      finalRate: null,
      status: 'unknown',
      statuses: [],
      unavailable: true,
      message,
    },
  };
}

function normalizeAggregateCounterRow(row = {}) {
  return {
    retailerKey: row.retailerKey || '',
    retailerName: row.retailerName || '',
    activeOffers: numberFrom(row.activeOffers),
    officialOffers: numberFrom(row.officialOffers),
    aggregatorOffers: numberFrom(row.aggregatorOffers),
    safeValidityOffers: numberFrom(row.safeValidityOffers),
    missingValidToOffers: numberFrom(row.missingValidToOffers),
    conditionOffers: numberFrom(row.conditionOffers),
    comparisonSafeOffers: numberFrom(row.comparisonSafeOffers),
    imageOffers: numberFrom(row.imageOffers),
    aggregatorRiskOffers: numberFrom(row.aggregatorRiskOffers),
  };
}

function buildOfferDiagnosticsFromAggregateResult(result = {}) {
  const summaryRow = normalizeAggregateCounterRow((result.summary || [])[0] || {});
  const retailerMatrix = (result.retailerMatrix || [])
    .map((row) => addRetailerWarningStatus(withOfferRates(normalizeAggregateCounterRow(row))))
    .sort((left, right) => {
      if (left.warningStatus !== right.warningStatus) {
        return ['red', 'yellow', 'green'].indexOf(left.warningStatus) - ['red', 'yellow', 'green'].indexOf(right.warningStatus);
      }
      return right.activeOffers - left.activeOffers;
    });

  return {
    offerSummary: withOfferRates({
      ...summaryRow,
      activeOfferCount: summaryRow.activeOffers,
    }),
    retailerMatrix,
    sourceTypeSummary: (result.sourceTypeSummary || [])
      .map((row) => ({ sourceType: row.sourceType || 'unknown', count: numberFrom(row.count) }))
      .sort((left, right) => right.count - left.count || left.sourceType.localeCompare(right.sourceType)),
    publishStatusSummary: buildPublishStatusSummaryFromRows(result.publishStatusSummary || []),
  };
}

function buildQualityKpis(offerSummary = {}) {
  return [
    {
      key: 'officialCoverageRate',
      label: 'Official Coverage Rate',
      value: offerSummary.officialCoverageRate ?? null,
      numerator: offerSummary.officialOffers ?? null,
      denominator: offerSummary.activeOffers ?? null,
      meaning: 'Anteil aktiver Angebote mit offizieller Quellen-Evidenz.',
      relevance: 'Offizielle Evidenz ist die belastbarste Grundlage fuer kaufklug.',
      interpretation: 'Gut ab ca. 70%, kritisch unter ca. 35%.',
    },
    {
      key: 'validityConfidenceRate',
      label: 'Validity Confidence Rate',
      value: offerSummary.validityConfidenceRate ?? null,
      numerator: offerSummary.safeValidityOffers ?? null,
      denominator: offerSummary.activeOffers ?? null,
      meaning: 'Anteil aktiver Angebote mit sicherer oder sauber propagierter Gueltigkeit.',
      relevance: 'Nur Angebote mit belastbarer Gueltigkeit sollten aktiv verglichen werden.',
      interpretation: 'Gut ab ca. 85%, kritisch unter ca. 60%.',
    },
    {
      key: 'conditionDetectionRate',
      label: 'Condition Detection Rate',
      value: offerSummary.conditionDetectionRate ?? null,
      numerator: offerSummary.conditionOffers ?? null,
      denominator: offerSummary.activeOffers ?? null,
      meaning: 'Anteil aktiver Angebote mit erkannten Angebotsbedingungen oder Promotionssignalen.',
      relevance: 'Bedingungen wie 1+1, Joker oder Mengenrabatte entscheiden ueber reale Ersparnis.',
      interpretation: 'Sinkende Werte koennen Parser- oder Quellenluecken anzeigen.',
    },
    {
      key: 'comparisonSafetyRate',
      label: 'Comparison Safety Rate',
      value: offerSummary.comparisonSafetyRate ?? null,
      numerator: offerSummary.comparisonSafeOffers ?? null,
      denominator: offerSummary.activeOffers ?? null,
      meaning: 'Anteil aktiver Angebote, die rechnerisch sicher vergleichbar sind.',
      relevance: 'Preisvergleiche duerfen nur bei sicherer Normalisierung gezeigt werden.',
      interpretation: 'Gut ab ca. 75%, kritisch unter ca. 50%.',
    },
    {
      key: 'imageCoverageRate',
      label: 'Image Coverage Rate',
      value: offerSummary.imageCoverageRate ?? null,
      numerator: offerSummary.imageOffers ?? null,
      denominator: offerSummary.activeOffers ?? null,
      meaning: 'Anteil aktiver Angebote mit Bild.',
      relevance: 'Bilder helfen bei schneller Erkennung und Plausibilitaetspruefung.',
      interpretation: 'Gut ab ca. 80%, eingeschraenkt unter ca. 50%.',
    },
    {
      key: 'aggregatorRiskRate',
      label: 'Aggregator Risk Rate',
      value: offerSummary.aggregatorRiskRate ?? null,
      numerator: offerSummary.aggregatorRiskOffers ?? null,
      denominator: offerSummary.activeOffers ?? null,
      meaning: 'Anteil aktiver Angebote aus Aggregator- oder schwacher Evidenz ohne klare Gueltigkeit.',
      relevance: 'Hohe Werte bedeuten mehr Risiko fuer veraltete oder unsichere Angebote.',
      interpretation: 'Gut niedrig, kritisch ab ca. 30%.',
      inverse: true,
    },
  ];
}

function buildTrendSeries(crawlRuns = [], activeOffers = []) {
  const dayMap = new Map();

  for (const run of crawlRuns) {
    const date = run.startedAt || run.createdAt;
    const day = date ? new Date(date).toISOString().slice(0, 10) : '';
    if (!day) continue;

    if (!dayMap.has(day)) {
      dayMap.set(day, {
        date: day,
        crawlDurationMs: null,
        crawlStatus: 'unknown',
        offersStored: 0,
        sourceSuccessCount: 0,
        sourceFailCount: 0,
      });
    }

    const row = dayMap.get(day);
    const duration = numberFrom(run.durationMs, null);
    row.crawlDurationMs = duration === null ? row.crawlDurationMs : Math.max(numberFrom(row.crawlDurationMs), duration);
    row.crawlStatus = run.status || row.crawlStatus;
    row.offersStored += numberFrom(run.summary?.offersStoredTotal);
    row.sourceSuccessCount += numberFrom(run.summary?.successfulSourcesCount);
    row.sourceFailCount += numberFrom(run.summary?.failedSourcesCount);
  }

  const observedActiveByDay = new Map();
  for (const offer of activeOffers) {
    const date = offer.lastSeenAt || offer.updatedAt || offer.createdAt;
    const day = date ? new Date(date).toISOString().slice(0, 10) : '';
    if (!day) continue;
    if (!observedActiveByDay.has(day)) {
      observedActiveByDay.set(day, {
        activeOffersObserved: 0,
        officialOffersObserved: 0,
        safeValidityObserved: 0,
        conditionsObserved: 0,
        comparisonSafeObserved: 0,
      });
    }

    const row = observedActiveByDay.get(day);
    const sourceQuality = classifyOfferSourceQuality(offer);
    row.activeOffersObserved += 1;
    if (sourceQuality.hasOfficialEvidence || sourceQuality.sourceClass.startsWith('official')) row.officialOffersObserved += 1;
    if (hasSafeValidity(offer, sourceQuality)) row.safeValidityObserved += 1;
    if (hasConditionEvidence(offer)) row.conditionsObserved += 1;
    if (isComparisonSafe(offer)) row.comparisonSafeObserved += 1;
  }

  for (const [day, observed] of observedActiveByDay.entries()) {
    if (!dayMap.has(day)) {
      dayMap.set(day, {
        date: day,
        crawlDurationMs: null,
        crawlStatus: 'unknown',
        offersStored: 0,
        sourceSuccessCount: 0,
        sourceFailCount: 0,
      });
    }
    Object.assign(dayMap.get(day), observed, {
      comparisonSafeRateObserved: rate(observed.comparisonSafeObserved, observed.activeOffersObserved),
    });
  }

  return [...dayMap.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-14);
}

function buildFeedbackSummaryFromDocuments(documents = [], {
  now = new Date(),
  totalFeedback = null,
  exactCounts = {},
  capped = false,
} = {}) {
  const nowDate = new Date(now);
  const todayStart = startOfUtcDay(nowDate);
  const last24hStart = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000);
  const last7DaysStart = new Date(nowDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30DaysStart = new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const trendStart = addDays(startOfUtcDay(nowDate), -29);
  const statusMap = new Map();
  const typeMap = new Map();
  const retailerMap = new Map();
  const offerMap = new Map();
  const dailyMap = new Map();
  let computedToday = 0;
  let computedLast24h = 0;
  let computedLast7Days = 0;
  let computedLast30Days = 0;

  for (let cursor = new Date(trendStart); cursor <= todayStart; cursor = addDays(cursor, 1)) {
    dailyMap.set(toDayKey(cursor), {
      date: toDayKey(cursor),
      count: 0,
      openCount: 0,
      resolvedCount: 0,
    });
  }

  for (const doc of documents || []) {
    const createdAt = doc.createdAt ? new Date(doc.createdAt) : null;
    const status = doc.status || 'unknown';
    const reasons = Array.isArray(doc.reasons) && doc.reasons.length ? doc.reasons : ['unknown'];
    const retailerKey = doc.offerSnapshot?.retailerKey || '';
    const retailerLabel = doc.offerSnapshot?.retailerLabel || retailerKey;
    const offerId = doc.offerRef?.offerId || '';

    incrementCount(statusMap, status);
    for (const reason of reasons) {
      incrementCount(typeMap, reason);
    }

    if (retailerKey) {
      if (!retailerMap.has(retailerKey)) {
        retailerMap.set(retailerKey, { retailerKey, retailerLabel, count: 0 });
      }
      retailerMap.get(retailerKey).count += 1;
    }

    if (offerId) {
      if (!offerMap.has(offerId)) {
        offerMap.set(offerId, {
          offerId,
          title: truncate(doc.offerSnapshot?.title || doc.offerSnapshot?.displayTitle || '', 120),
          retailerKey,
          retailerLabel,
          count: 0,
          reasons: new Set(),
        });
      }

      const offer = offerMap.get(offerId);
      offer.count += 1;
      for (const reason of reasons) offer.reasons.add(reason);
    }

    if (!createdAt || Number.isNaN(createdAt.getTime())) {
      continue;
    }

    if (createdAt >= todayStart) computedToday += 1;
    if (createdAt >= last24hStart) computedLast24h += 1;
    if (createdAt >= last7DaysStart) computedLast7Days += 1;
    if (createdAt >= last30DaysStart) computedLast30Days += 1;

    const dayKey = toDayKey(createdAt);
    if (dailyMap.has(dayKey)) {
      const day = dailyMap.get(dayKey);
      day.count += 1;
      if (FEEDBACK_OPEN_STATUSES.has(status)) day.openCount += 1;
      if (FEEDBACK_RESOLVED_STATUSES.has(status)) day.resolvedCount += 1;
    }
  }

  const feedbackByStatus = createCountRowsFromMap(statusMap, 'status');
  const feedbackByType = createCountRowsFromMap(typeMap, 'type');
  const openFeedback = feedbackByStatus
    .filter((row) => FEEDBACK_OPEN_STATUSES.has(row.status))
    .reduce((sum, row) => sum + row.count, 0);
  const resolvedFeedback = feedbackByStatus
    .filter((row) => FEEDBACK_RESOLVED_STATUSES.has(row.status))
    .reduce((sum, row) => sum + row.count, 0);
  const feedbackByRetailer = [...retailerMap.values()]
    .sort((left, right) => right.count - left.count || left.retailerKey.localeCompare(right.retailerKey))
    .slice(0, 12);
  const feedbackByOffer = [...offerMap.values()]
    .map((item) => ({
      ...item,
      reasons: [...item.reasons].slice(0, 6),
    }))
    .sort((left, right) => right.count - left.count || left.offerId.localeCompare(right.offerId))
    .slice(0, 10);
  const dailyFeedbackTrend = [...dailyMap.values()].sort((left, right) => left.date.localeCompare(right.date));
  const latestFeedback = (documents || [])
    .slice()
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
    .slice(0, 5)
    .map(sanitizeLatestFeedbackDocument);
  const total = totalFeedback ?? documents.length;
  const feedbackDataWarnings = [
    capped ? `Feedback-Auswertung ist auf die letzten ${FEEDBACK_DOCUMENT_LIMIT} Eintraege begrenzt; Gesamtzahl bleibt exakt.` : '',
    total > 0 && feedbackByStatus.length === 0 ? 'Status wird aktuell nicht strukturiert erfasst.' : '',
    total > 0 && feedbackByType.length === 0 ? 'Kategorie/Grund wird aktuell nicht strukturiert erfasst.' : '',
    total > 0 && feedbackByRetailer.length === 0 ? 'Haendlerbezug ist nicht fuer alle Feedbacks vorhanden.' : '',
    dailyFeedbackTrend.filter((row) => row.count > 0).length < 2 ? 'Noch nicht genug historische Feedback-Tage fuer belastbare Trends vorhanden.' : '',
  ].filter(Boolean);

  return {
    totalFeedback: total,
    newToday: exactCounts.newToday ?? computedToday,
    newLast24h: exactCounts.newLast24h ?? computedLast24h,
    newLast7Days: exactCounts.newLast7Days ?? computedLast7Days,
    newLast30Days: exactCounts.newLast30Days ?? computedLast30Days,
    openFeedback,
    resolvedFeedback,
    feedbackByStatus,
    feedbackByType,
    feedbackByRetailer,
    feedbackByOffer,
    dailyFeedbackTrend,
    latestFeedback,
    feedbackDataWarnings,
    source: 'OfferFeedback',
    generatedAt: nowDate.toISOString(),
  };
}

async function buildFeedbackSummary({
  OfferFeedbackModel = OfferFeedback,
  now = new Date(),
} = {}) {
  const todayStart = startOfUtcDay(now);
  const last24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7DaysStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30DaysStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const projection = {
    _id: 1,
    createdAt: 1,
    updatedAt: 1,
    type: 1,
    status: 1,
    reasons: 1,
    offerRef: 1,
    offerSnapshot: 1,
    pageContext: 1,
    structuredDetails: 1,
    freeText: 1,
  };

  const [
    totalFeedback,
    newToday,
    newLast24h,
    newLast7Days,
    newLast30Days,
    documents,
  ] = await Promise.all([
    withQueryMaxTime(OfferFeedbackModel.countDocuments({})),
    withQueryMaxTime(OfferFeedbackModel.countDocuments({ createdAt: { $gte: todayStart } })),
    withQueryMaxTime(OfferFeedbackModel.countDocuments({ createdAt: { $gte: last24hStart } })),
    withQueryMaxTime(OfferFeedbackModel.countDocuments({ createdAt: { $gte: last7DaysStart } })),
    withQueryMaxTime(OfferFeedbackModel.countDocuments({ createdAt: { $gte: last30DaysStart } })),
    withQueryMaxTime(OfferFeedbackModel.find({}, projection)
      .sort({ createdAt: -1 })
      .limit(FEEDBACK_DOCUMENT_LIMIT)
      .lean()),
  ]);

  return buildFeedbackSummaryFromDocuments(documents, {
    now,
    totalFeedback,
    exactCounts: {
      newToday,
      newLast24h,
      newLast7Days,
      newLast30Days,
    },
    capped: totalFeedback > documents.length,
  });
}

function buildExecutiveStatus({ latestCrawl, latestScheduledFullCrawl, activeCrawlRun, lockStatus, publishStatusSummary }) {
  const referenceRun = latestScheduledFullCrawl || latestCrawl;
  const reasons = [];
  let level = 'green';

  if (!referenceRun) {
    level = 'red';
    reasons.push('Keine CrawlRun-Lineage gefunden.');
  } else {
    if (referenceRun.status === 'failed') {
      const replacementStatus = getScheduledReplacementStatus(referenceRun);
      level = isScheduledReplacementExhausted(referenceRun) ? 'red' : replacementStatus ? 'yellow' : 'red';
      reasons.push(replacementStatus
        ? isScheduledReplacementExhausted(referenceRun)
          ? 'Letzter Daily Crawl ist source-los fehlgeschlagen; automatische Replacement-Versuche sind ausgeschoepft und Operator-Handlung ist erforderlich.'
          : `Letzter Daily Crawl ist source-los fehlgeschlagen; scheduled Replacement ist ${replacementStatus}.`
        : 'Letzter Daily Crawl ist fehlgeschlagen.');
    } else if (referenceRun.status === 'stale') {
      level = 'red';
      reasons.push('Letzter Daily Crawl wurde stale, weil der Heartbeat oder Prozessstatus nicht mehr vertrauenswuerdig war.');
    } else if (!TERMINAL_CRAWL_STATUSES.has(referenceRun.status)) {
      level = 'yellow';
      reasons.push('Letzter Daily Crawl ist nicht terminal abgeschlossen.');
    } else if (!referenceRun.finishedAt) {
      level = 'red';
      reasons.push('Letzter Daily Crawl hat kein finishedAt.');
    } else if (referenceRun.status === 'partial') {
      level = 'yellow';
      reasons.push('Letzter Daily Crawl war partial; einzelne Quellen oder Schritte waren eingeschraenkt.');
    } else if (referenceRun.status === 'skipped') {
      level = 'yellow';
      reasons.push('Letzter Daily Crawl wurde uebersprungen.');
    }
  }

  if (activeCrawlRun && ACTIVE_CRAWL_STATUSES.has(activeCrawlRun.status)) {
    level = level === 'red' ? 'red' : 'yellow';
    reasons.push('Es gibt eine aktive CrawlRun-Situation.');
  }

  if (lockStatus?.isBlocked) {
    level = 'red';
    reasons.push(lockStatus.reason || 'Globaler Crawl-Lock ist blockiert.');
  }

  if (publishStatusSummary?.status === 'open') {
    level = 'red';
    reasons.push('PublishStatus haengt fuer aktive Angebote in Zwischen- oder unbekannten Status.');
  } else if (publishStatusSummary?.status === 'unknown' && level === 'green') {
    level = 'yellow';
    reasons.push('PublishStatus ist mangels aktiver Angebote unbekannt.');
  }

  if (level === 'green') {
    reasons.push('Letzter Daily Crawl terminal abgeschlossen, Lock frei, PublishStatus final.');
  }

  return {
    level,
    label: level === 'green' ? 'Gruen' : level === 'yellow' ? 'Gelb' : 'Rot',
    reason: reasons[0] || 'Status unbekannt.',
    reasons,
  };
}

function buildActionableIssues({ latestCrawl, lockStatus, publishStatusSummary, retailerMatrix, offerSummary, feedbackSummary }) {
  const issues = [];

  if (latestCrawl?.status === 'stale') {
    issues.push({
      severity: 'red',
      title: 'Letzter Crawl stale',
      detail: 'Daily Crawl Reliability und Heartbeat/Restart-Verhalten pruefen.',
    });
  }

  if (latestCrawl?.status === 'failed') {
    const replacementStatus = getScheduledReplacementStatus(latestCrawl);
    issues.push({
      severity: isScheduledReplacementExhausted(latestCrawl) ? 'red' : replacementStatus ? 'yellow' : 'red',
      title: isScheduledReplacementExhausted(latestCrawl)
        ? 'Scheduled Replacement ausgeschoepft'
        : replacementStatus ? 'Scheduled Replacement ausstehend' : 'Letzter Crawl failed',
      detail: replacementStatus
        ? isScheduledReplacementExhausted(latestCrawl)
          ? 'Source-loser Daily ist wiederholt fehlgeschlagen; automatische Replacements sind gestoppt, Runtime-/Plattform-Pruefung erforderlich.'
          : `Source-loser Daily ist fehlgeschlagen; scheduled Replacement ist ${replacementStatus}.`
        : compactStrings(latestCrawl.errorMessages, 1)[0] || 'Fehlerdetails im CrawlRun pruefen.',
    });
  }

  if (lockStatus?.isBlocked) {
    issues.push({
      severity: 'red',
      title: 'Globaler Crawl-Lock blockiert',
      detail: lockStatus.reason || 'Lock-Status pruefen.',
    });
  }

  if (publishStatusSummary?.openCount > 0) {
    issues.push({
      severity: 'red',
      title: 'PublishStatus haengt in Zwischenstatus',
      detail: `${publishStatusSummary.openCount} aktive Angebote sind nicht final markiert.`,
    });
  }

  for (const retailer of (retailerMatrix || []).filter((item) => item.warningStatus !== 'green').slice(0, 6)) {
    const detailParts = [];
    if (retailer.activeOffers < 10) detailParts.push('kritisch wenige aktive Angebote');
    if (retailer.officialCoverageRate < 0.35) detailParts.push('wenig offizielle Evidenz');
    if (retailer.validityConfidenceRate < 0.75) detailParts.push('eingeschraenkte Gueltigkeit');
    if (retailer.imageCoverageRate < 0.4) detailParts.push('wenig Bilder');

    issues.push({
      severity: retailer.warningStatus,
      title: `${retailer.retailerName || retailer.retailerKey}: Coverage eingeschraenkt`,
      detail: detailParts.join(', ') || 'Coverage-Kennzahlen pruefen.',
    });
  }

  if (offerSummary?.aggregatorRiskRate >= 0.3) {
    issues.push({
      severity: 'yellow',
      title: 'Viele Aggregator-Angebote mit Risiko',
      detail: `${Math.round(offerSummary.aggregatorRiskRate * 100)}% der aktiven Angebote haben schwache Aggregator-/Gueltigkeits-Evidenz.`,
    });
  }

  if (offerSummary?.imageCoverageRate > 0 && offerSummary.imageCoverageRate < 0.5) {
    issues.push({
      severity: 'yellow',
      title: 'Viele Angebote ohne Bilder',
      detail: `Image Coverage liegt bei ${Math.round(offerSummary.imageCoverageRate * 100)}%.`,
    });
  }

  if (offerSummary?.comparisonSafetyRate > 0 && offerSummary.comparisonSafetyRate < 0.5) {
    issues.push({
      severity: 'yellow',
      title: 'Viele Angebote nicht comparisonSafe',
      detail: `Comparison Safety liegt bei ${Math.round(offerSummary.comparisonSafetyRate * 100)}%.`,
    });
  }

  if (feedbackSummary?.newLast24h > 0) {
    issues.push({
      severity: 'yellow',
      title: 'Neue Beta-Feedbacks eingelangt',
      detail: `${feedbackSummary.newLast24h} neue Fehler-melden-Eintraege in den letzten 24 Stunden pruefen.`,
    });
  }

  if (feedbackSummary?.openFeedback >= 10) {
    issues.push({
      severity: feedbackSummary.openFeedback >= 25 ? 'red' : 'yellow',
      title: 'Viele offene Feedbacks',
      detail: `${feedbackSummary.openFeedback} Feedbacks sind neu oder in Bearbeitung.`,
    });
  }

  const topRetailerFeedback = feedbackSummary?.feedbackByRetailer?.[0];
  if (topRetailerFeedback?.count >= 3) {
    issues.push({
      severity: 'yellow',
      title: `Feedback-Haeufung bei ${topRetailerFeedback.retailerLabel || topRetailerFeedback.retailerKey}`,
      detail: `${topRetailerFeedback.count} Fehler-melden-Eintraege betreffen diesen Haendler.`,
    });
  }

  if (issues.length === 0) {
    issues.push({
      severity: 'green',
      title: 'Keine blockierenden Issues aus vorhandenen Daten abgeleitet',
      detail: 'Weiterhin naechsten scheduled Daily Crawl beobachten.',
    });
  }

  return issues;
}

function summarizeCrawlSources(run = {}) {
  const sources = Array.isArray(run?.sources) ? run.sources : [];
  const sourceOk = numberFrom(run?.summary?.successfulSourcesCount, null);
  const sourceFail = numberFrom(run?.summary?.failedSourcesCount, null);
  const countedOk = sources.filter((source) => source.status === 'success').length;
  const countedFail = sources.filter((source) => !['success', 'skipped', 'unknown'].includes(source.status)).length;
  const sourceSkipped = numberFrom(run?.summary?.skippedSourcesCount, null);
  const sourcePolicyBounded = numberFrom(run?.summary?.policyBoundedSourcesCount, null);

  return {
    sourceOk: sourceOk === null ? countedOk : sourceOk,
    sourceFail: sourceFail === null ? countedFail : sourceFail,
    sourceSkipped: sourceSkipped === null ? sources.filter((source) => source.status === 'skipped').length : sourceSkipped,
    sourcePolicyBounded: sourcePolicyBounded === null ? sources.filter(isPolicyBoundedDashboardSource).length : sourcePolicyBounded,
    warningSummary: compactStrings([...(run?.errorMessages || []), ...(run?.warnings || [])].map((item) => sanitizeAnalysisText(item, 180)), 5),
    staleOrRecoveryReason: sanitizeAnalysisText(
      run?.summary?.staleReason
      || run?.summary?.recoveryReason
      || run?.summary?.markStaleReason
      || '',
      180
    ) || 'unknown',
  };
}

function buildCrawlHistorySummary(crawlHistory = []) {
  const scheduledFullRuns = crawlHistory.filter((run) => (
    run.trigger === 'scheduled'
    && run.mode === 'full'
    && run.dryRun === false
  ));
  const manualScopedRuns = crawlHistory.filter((run) => (
    run.trigger === 'manual'
    || run.mode === 'scoped'
    || run.mode === 'retailer'
  ));
  const statusCounts = scheduledFullRuns.reduce((counts, run) => {
    const status = run.status || 'unknown';
    counts[status] = numberFrom(counts[status]) + 1;
    return counts;
  }, {});
  const staleCount = numberFrom(statusCounts.stale);
  const failedCount = numberFrom(statusCounts.failed);
  const successCount = numberFrom(statusCounts.success);
  const partialCount = numberFrom(statusCounts.partial);
  const manualSuccessCount = manualScopedRuns.filter((run) => run.status === 'success').length;
  const pattern = staleCount >= 2
    ? 'Repeated scheduled full crawls became stale.'
    : staleCount === 1
      ? 'Latest observed scheduled full crawl became stale.'
      : failedCount > 0
        ? 'At least one scheduled full crawl failed.'
        : scheduledFullRuns.length > 0
          ? 'Scheduled full crawl history is present.'
          : 'No scheduled full crawl history in snapshot window.';

  return {
    scheduledFull: {
      lastRuns: scheduledFullRuns.slice(0, 6).map((run) => ({
        date: run.startedAt ? String(run.startedAt).slice(0, 10) : 'unknown',
        status: run.status || 'unknown',
        duration: durationText(run.durationMs),
      })),
      statusCounts: {
        success: successCount,
        partial: partialCount,
        failed: failedCount,
        stale: staleCount,
        unknown: numberFrom(statusCounts.unknown),
      },
    },
    manualScoped: {
      count: manualScopedRuns.length,
      success: manualSuccessCount,
      failedOrStale: manualScopedRuns.filter((run) => ['failed', 'stale'].includes(run.status)).length,
    },
    pattern,
    interpretationHint: staleCount > 0 || failedCount > 0
      ? 'Pipeline reliability must be verified by the next scheduled daily crawl before coverage work.'
      : 'Keep monitoring scheduled daily crawl terminal status before broadening coverage work.',
  };
}

function buildInterpretationFlags({
  latestScheduledFullCrawl,
  lockStatus,
  publishStatusSummary,
  offerSummary,
  retailerMatrix,
  trendSeries,
  dataCompletenessWarnings,
  feedbackSummary,
}) {
  const flags = [];
  const latestStatus = latestScheduledFullCrawl?.status;

  if (['stale', 'failed'].includes(latestStatus)) {
    flags.push({
      flag: 'pipeline_unstable',
      severity: 'red',
      evidence: `latest scheduled full crawl ${latestStatus}`,
    });
  }

  if (publishStatusSummary?.status === 'open' || numberFrom(publishStatusSummary?.openCount) > 0) {
    flags.push({
      flag: 'publish_status_open',
      severity: 'red',
      evidence: `${numberFrom(publishStatusSummary?.openCount)} active offers are not final`,
    });
  }

  if (lockStatus?.isBlocked) {
    flags.push({
      flag: 'lock_blocked',
      severity: 'red',
      evidence: lockStatus.reason || 'global crawl lock is blocked',
    });
  }

  if (numberFrom(offerSummary?.validityConfidenceRate) > 0 && offerSummary.validityConfidenceRate < 0.6) {
    flags.push({
      flag: 'validity_confidence_critical',
      severity: 'red',
      evidence: `${percentText(offerSummary.validityConfidenceRate)} validity confidence; ${numberFrom(offerSummary.missingValidToOffers)} offers without validTo`,
    });
  }

  if (numberFrom(offerSummary?.aggregatorRiskRate) >= 0.3) {
    flags.push({
      flag: 'aggregator_risk_high',
      severity: offerSummary.aggregatorRiskRate >= 0.5 ? 'red' : 'yellow',
      evidence: `${percentText(offerSummary.aggregatorRiskRate)} aggregator risk`,
    });
  }

  const sparRows = (retailerMatrix || []).filter((row) => SPAR_FAMILY_KEYS.has(row.retailerKey));
  if (sparRows.length > 0 && sparRows.some((row) => row.activeOffers >= 10 && (row.officialCoverageRate < 0.35 || row.validityConfidenceRate < 0.6))) {
    flags.push({
      flag: 'spar_family_official_coverage_critical',
      severity: 'red',
      evidence: 'SPAR/EUROSPAR/INTERSPAR show low official evidence or weak validity with active offer volume',
    });
  }

  const bipa = (retailerMatrix || []).find((row) => row.retailerKey === 'bipa');
  if (bipa && bipa.warningStatus === 'green' && bipa.officialCoverageRate >= 0.7 && bipa.validityConfidenceRate >= 0.75) {
    flags.push({
      flag: 'bipa_currently_best_quality',
      severity: 'green',
      evidence: 'BIPA has green retailer status with strong official and validity rates',
    });
  }

  if (numberFrom(offerSummary?.imageCoverageRate) >= 0.8) {
    flags.push({
      flag: 'image_coverage_strong',
      severity: 'green',
      evidence: `${percentText(offerSummary.imageCoverageRate)} image coverage`,
    });
  }

  if ((trendSeries || []).length < 7 || (dataCompletenessWarnings || []).length > 0) {
    flags.push({
      flag: 'historical_trends_incomplete',
      severity: 'yellow',
      evidence: (dataCompletenessWarnings || [])[0] || 'limited trend history in snapshot',
    });
  }

  if (numberFrom(feedbackSummary?.openFeedback) >= 10) {
    flags.push({
      flag: 'feedback_unprocessed_high',
      severity: feedbackSummary.openFeedback >= 25 ? 'red' : 'yellow',
      evidence: `${feedbackSummary.openFeedback} open or reviewing OfferFeedback entries`,
    });
  }

  return flags;
}

function buildRetailerMatrixSummary(retailerMatrix = []) {
  const rows = retailerMatrix.map((row) => {
    const diagnoses = [];
    if (row.activeOffers < 10) diagnoses.push('low active offer volume');
    if (row.officialCoverageRate < 0.35) diagnoses.push('low official evidence');
    if (row.validityConfidenceRate < 0.6) diagnoses.push('weak validity confidence');
    if (row.aggregatorRiskRate >= 0.3) diagnoses.push('high aggregator risk');
    if (row.imageCoverageRate < 0.4) diagnoses.push('weak image coverage');

    return {
      retailerKey: row.retailerKey,
      retailerName: row.retailerName || row.retailerKey,
      active: numberFrom(row.activeOffers),
      officialRate: percentText(row.officialCoverageRate),
      validityRate: percentText(row.validityConfidenceRate),
      conditionRate: percentText(row.conditionDetectionRate),
      imageRate: percentText(row.imageCoverageRate),
      aggregatorCount: numberFrom(row.aggregatorOffers),
      warningStatus: row.warningStatus || 'unknown',
      shortDiagnosis: diagnoses.length ? diagnoses.join('; ') : 'no major issue from available retailer KPIs',
    };
  });
  const sparRows = rows.filter((row) => SPAR_FAMILY_KEYS.has(row.retailerKey));
  const sparCritical = sparRows.some((row) => row.warningStatus === 'red');

  return {
    rows,
    sparFamily: {
      status: sparRows.length ? (sparCritical ? 'red' : sparRows.some((row) => row.warningStatus === 'yellow') ? 'yellow' : 'green') : 'unknown',
      diagnosis: sparRows.length
        ? 'SPAR/EUROSPAR/INTERSPAR are interpreted together because source quality and validity work are coupled.'
        : 'No SPAR family rows available in retailer matrix.',
      likelyNextWork: sparCritical
        ? 'Official source discovery and validity propagation, but only after daily crawl reliability is confirmed.'
        : 'Continue observing SPAR family quality after crawl reliability is confirmed.',
    },
  };
}

function buildTrendSummary(trendSeries = [], dataCompletenessWarnings = []) {
  const rows = Array.isArray(trendSeries) ? trendSeries : [];
  const unknownDays = rows.filter((row) => row.crawlStatus === 'unknown').map((row) => row.date);
  const successDays = rows.filter((row) => row.crawlStatus === 'success').map((row) => row.date);
  const staleDays = rows.filter((row) => row.crawlStatus === 'stale').map((row) => row.date);
  const historicalOfferSnapshotsAvailable = false;
  const reliability = historicalOfferSnapshotsAvailable && rows.length >= 7 && staleDays.length === 0 && unknownDays.length === 0
    ? 'usable'
    : 'limited';

  return {
    historicalOfferSnapshotsAvailable,
    unknownDays,
    successDays,
    staleDays,
    reliability,
    interpretation: reliability === 'limited'
      ? 'Trend charts are structurally useful but not yet statistically reliable.'
      : 'Trend charts have enough recent signal for cautious interpretation.',
    warnings: dataCompletenessWarnings || [],
  };
}

function priorityForIssue(issue = {}) {
  if (/crawl|lock|publish/i.test(issue.title || '') && issue.severity === 'red') return 'P0';
  if (/feedback/i.test(issue.title || '') && issue.severity === 'red') return 'P1';
  if (issue.severity === 'red') return 'P1';
  if (issue.severity === 'yellow') return 'P2';
  return 'P2';
}

function enrichActionableIssues(issues = []) {
  return issues.map((issue) => {
    const title = issue.title || 'Unknown issue';
    const isCrawl = /crawl/i.test(title);
    const isPublish = /publish/i.test(title);
    const isFeedback = /feedback/i.test(title);
    const isLock = /lock/i.test(title);

    return {
      priority: priorityForIssue(issue),
      severity: issue.severity || 'unknown',
      title,
      evidence: sanitizeAnalysisText(issue.detail || 'unknown', 240),
      likelyRootCauseClass: isCrawl
        ? 'pipeline/orchestrator/deploy interaction'
        : isPublish
          ? 'publish-state/finalization'
          : isFeedback
            ? 'beta-feedback-triage'
            : isLock
              ? 'crawl-lock/orchestrator'
              : 'data-quality/source-evidence',
      recommendedNextAction: isCrawl
        ? 'Wait for the next scheduled crawl and verify terminal status, lock and publishStatus.'
        : isPublish
          ? 'Inspect publish finalization state read-only before running any repair.'
          : isFeedback
            ? 'Build or use a read-only triage summary before changing parsers, ranking or coverage.'
            : 'Use read-only diagnostics to confirm evidence before implementation work.',
      forbiddenActionsUntilResolved: isCrawl
        ? ['no manual replacement crawl unless explicitly approved', 'no coverage work before next daily crawl is evaluated']
        : isPublish
          ? ['no productive repair without explicit approval', 'no data deletion']
          : [],
    };
  });
}

function buildFeedbackBetaSummary(feedbackSummary = {}) {
  const latest = (feedbackSummary.latestFeedback || [])
    .filter((item) => FEEDBACK_OPEN_STATUSES.has(item.status))
    .slice(0, 5)
    .map((item) => ({
      createdAt: item.createdAt || 'unknown',
      status: item.status || 'unknown',
      reasons: item.reasons || [],
      retailer: item.retailerLabel || item.retailerKey || 'unknown',
      offerReference: item.offerId || 'unknown',
      offerTitle: sanitizeAnalysisText(item.offerTitle, 100),
      query: sanitizeAnalysisText(item.query, 80),
      snippet: sanitizeAnalysisText(item.snippet, ANALYSIS_FEEDBACK_SNIPPET_LIMIT),
    }));

  return {
    totalFeedback: numberFrom(feedbackSummary.totalFeedback),
    newToday: numberFrom(feedbackSummary.newToday),
    newLast24h: numberFrom(feedbackSummary.newLast24h),
    newLast7Days: numberFrom(feedbackSummary.newLast7Days),
    newLast30Days: numberFrom(feedbackSummary.newLast30Days),
    openFeedback: numberFrom(feedbackSummary.openFeedback),
    resolvedFeedback: numberFrom(feedbackSummary.resolvedFeedback),
    feedbackByStatus: feedbackSummary.feedbackByStatus || [],
    feedbackByType: feedbackSummary.feedbackByType || [],
    feedbackByRetailer: feedbackSummary.feedbackByRetailer || [],
    topAffectedOffers: feedbackSummary.feedbackByOffer || [],
    latestFeedbackCount: latest.length,
    latestOpenFeedbackSnippets: latest,
    interpretation: numberFrom(feedbackSummary.openFeedback) > 0
      ? 'Beta-test feedback is being collected, but unprocessed feedback must be triaged before next implementation prompts.'
      : 'No open beta-test feedback is visible, but the read-only feedback check still applies before next implementation prompts.',
    recommendedNextAction: numberFrom(feedbackSummary.openFeedback) > 0
      ? 'Build or use feedback triage status workflow: new -> reviewing -> resolved/ignored/duplicate.'
      : 'Keep checking OfferFeedback read-only before formulating the next Codex prompt.',
  };
}

function buildSourceExtractionSummary(latestEssence = []) {
  const summary = {};
  const knownKeys = ['billa-plus', 'billa', 'hofer', 'bipa', 'pagro', 'dm', 'penny', 'lidl', 'interspar', 'eurospar', 'spar'];

  for (const key of knownKeys) {
    summary[key] = 'not_available';
  }

  for (const item of latestEssence || []) {
    const key = item.retailerKey || 'unknown';
    summary[key] = sanitizeAnalysisText(item.essence || 'not_available', 280) || 'not_available';
  }

  return summary;
}

function buildFeedbackProcessingInstruction(feedbackSummary = {}) {
  const unprocessed = numberFrom(feedbackSummary.openFeedback) > 0;

  return {
    requiredForNextCodexPrompt: true,
    unprocessedFeedbackAvailable: unprocessed,
    instructionStillApplies: true,
    instruction: 'Before formulating the next Codex prompt, read and consider current unprocessed OfferFeedback entries.',
    scope: 'read-only',
    collection: 'OfferFeedback',
    includeOnly: [
      'new/open/unprocessed feedback',
      'reason/type/category',
      'retailer',
      'offer reference',
      'query/context if available',
      'short text snippet if available',
    ],
    exclude: [
      'IP addresses',
      'user agents',
      'session ids',
      'raw client-side context',
      'long free-text dumps',
    ],
    purpose: 'Use real beta-user feedback to prioritize root-cause analysis and next actions.',
  };
}

function buildAnalysisEssence({
  generatedAt,
  buildInfo,
  executiveStatus,
  crawlReliability,
  latestScheduledFullCrawl,
  crawlHistory,
  lockStatus,
  publishStatusSummary,
  offerSummary,
  qualityKpis,
  retailerMatrix,
  trendSeries,
  actionableIssues,
  dataCompletenessWarnings,
  feedbackSummary,
  latestEssence,
} = {}) {
  const latestSourceSummary = summarizeCrawlSources(latestScheduledFullCrawl);
  const crawlHistorySummary = buildCrawlHistorySummary(crawlHistory);
  const interpretationFlags = buildInterpretationFlags({
    latestScheduledFullCrawl,
    lockStatus,
    publishStatusSummary,
    offerSummary,
    retailerMatrix,
    trendSeries,
    dataCompletenessWarnings,
    feedbackSummary,
  });
  const retailerSummary = buildRetailerMatrixSummary(retailerMatrix);
  const trendSummary = buildTrendSummary(trendSeries, dataCompletenessWarnings);
  const feedbackBetaSummary = buildFeedbackBetaSummary(feedbackSummary);
  const feedbackProcessingInstruction = buildFeedbackProcessingInstruction(feedbackSummary);

  return {
    header: {
      snapshotAt: generatedAt || new Date().toISOString(),
      buildTime: buildInfo?.buildTime || 'unknown',
      dashboardVersion: 'v1.2-chatgpt-analysis-essence',
      dataMode: 'read-only',
      tracking: 'none',
    },
    executiveHealth: {
      level: executiveStatus?.level || 'unknown',
      reason: executiveStatus?.reason || 'unknown',
      backend: 'online',
      mongo: mongoose.connection.readyState === 1 ? 'connected' : 'unknown',
      globalLock: lockStatus?.state || 'unknown',
      publishStatus: publishStatusSummary?.status || 'unknown',
      publishFinalOffers: numberFrom(publishStatusSummary?.finalCount),
      publishOpenOffers: numberFrom(publishStatusSummary?.openCount),
      finalOffers: numberFrom(publishStatusSummary?.finalCount),
      openOffers: numberFrom(publishStatusSummary?.openCount),
      nextCrawlBlocked: lockStatus?.isBlocked === true ? true : lockStatus?.isBlocked === false ? false : 'unknown',
      latestBuildTime: buildInfo?.buildTime || 'unknown',
      latestHealthTime: generatedAt || 'unknown',
    },
    crawlReliability: crawlReliability || {},
    latestScheduledFullCrawl: {
      runId: latestScheduledFullCrawl?.id || 'not_available',
      status: latestScheduledFullCrawl?.status || 'not_available',
      trigger: latestScheduledFullCrawl?.trigger || 'not_available',
      mode: latestScheduledFullCrawl?.mode || 'not_available',
      dryRun: latestScheduledFullCrawl ? Boolean(latestScheduledFullCrawl.dryRun) : 'unknown',
      startedAt: latestScheduledFullCrawl?.startedAt || 'not_available',
      finishedAt: latestScheduledFullCrawl?.finishedAt || 'not_available',
      duration: durationText(latestScheduledFullCrawl?.durationMs),
      sourceOk: latestSourceSummary.sourceOk,
      sourceFail: latestSourceSummary.sourceFail,
      warningErrorSummary: latestSourceSummary.warningSummary,
      staleRecoveryReason: latestSourceSummary.staleOrRecoveryReason,
      automaticReplacementCrawlStarted: 'unknown',
    },
    crawlHistorySummary,
    offerQualityKpi: {
      activeOffers: numberFrom(offerSummary?.activeOffers),
      officialOffers: numberFrom(offerSummary?.officialOffers),
      officialCoverageRate: percentText(offerSummary?.officialCoverageRate),
      validityConfidenceRate: percentText(offerSummary?.validityConfidenceRate),
      offersWithoutValidTo: numberFrom(offerSummary?.missingValidToOffers),
      conditionDetectionRate: percentText(offerSummary?.conditionDetectionRate),
      comparisonSafetyRate: percentText(offerSummary?.comparisonSafetyRate),
      imageCoverageRate: percentText(offerSummary?.imageCoverageRate),
      aggregatorRiskRate: percentText(offerSummary?.aggregatorRiskRate),
      qualityKpiKeys: (qualityKpis || []).map((kpi) => kpi.key),
    },
    interpretationFlags,
    retailerMatrixSummary: retailerSummary.rows,
    sparFamily: retailerSummary.sparFamily,
    trendSummary,
    actionableIssues: enrichActionableIssues(actionableIssues),
    feedbackBetaTest: feedbackBetaSummary,
    feedbackProcessingInstruction,
    sourceExtractionSummary: buildSourceExtractionSummary(latestEssence),
    safety: {
      excludesSensitiveFields: true,
      snippetsMaxCharacters: ANALYSIS_FEEDBACK_SNIPPET_LIMIT,
      completeUrlsIncluded: false,
      secretsIncluded: false,
    },
  };
}

function appendList(lines, list, indent = '  ') {
  if (!Array.isArray(list) || list.length === 0) {
    lines.push(`${indent}- none`);
    return;
  }

  for (const item of list) {
    lines.push(`${indent}- ${quoteYaml(item)}`);
  }
}

function renderAnalysisEssenceText(essence = {}) {
  const lines = [];
  const header = essence.header || {};
  const health = essence.executiveHealth || {};
  const reliability = essence.crawlReliability || {};
  const scheduledDaily = reliability.scheduledDaily || {};
  const currentCrawlSystem = reliability.currentCrawlSystem || {};
  const latestManualFull = currentCrawlSystem.latestManualFullCrawl || {};
  const sourceFailures = reliability.sourceFailures || {};
  const latest = essence.latestScheduledFullCrawl || {};
  const history = essence.crawlHistorySummary || {};
  const offerKpi = essence.offerQualityKpi || {};
  const feedback = essence.feedbackBetaTest || {};
  const instruction = essence.feedbackProcessingInstruction || {};

  lines.push('# kaufklug.at Dashboard Analyse-Essenz');
  lines.push(`snapshotAt: ${scalarYaml(header.snapshotAt)}`);
  lines.push(`buildTime: ${scalarYaml(header.buildTime)}`);
  lines.push(`dashboardVersion: ${scalarYaml(header.dashboardVersion)}`);
  lines.push(`dataMode: ${scalarYaml(header.dataMode)}`);
  lines.push(`tracking: ${scalarYaml(header.tracking)}`);
  lines.push('');
  lines.push('executive_health:');
  lines.push(`  level: ${scalarYaml(health.level)}`);
  lines.push(`  reason: ${quoteYaml(health.reason)}`);
  lines.push(`  backend: ${scalarYaml(health.backend)}`);
  lines.push(`  mongo: ${scalarYaml(health.mongo)}`);
  lines.push(`  globalLock: ${scalarYaml(health.globalLock)}`);
  lines.push(`  publishStatus: ${scalarYaml(health.publishStatus)}`);
  lines.push(`  publishFinalOffers: ${scalarYaml(health.publishFinalOffers)}`);
  lines.push(`  publishOpenOffers: ${scalarYaml(health.publishOpenOffers)}`);
  lines.push(`  finalOffers: ${scalarYaml(health.finalOffers)}`);
  lines.push(`  openOffers: ${scalarYaml(health.openOffers)}`);
  lines.push(`  nextCrawlBlocked: ${scalarYaml(health.nextCrawlBlocked)}`);
  lines.push(`  latestBuildTime: ${scalarYaml(health.latestBuildTime)}`);
  lines.push(`  latestHealthTime: ${scalarYaml(health.latestHealthTime)}`);
  lines.push('');
  lines.push('crawl_reliability:');
  lines.push('  scheduledDaily:');
  lines.push(`    level: ${scalarYaml(scheduledDaily.level)}`);
  lines.push(`    status: ${scalarYaml(scheduledDaily.status)}`);
  lines.push(`    runId: ${quoteYaml(scheduledDaily.runId)}`);
  lines.push(`    reason: ${quoteYaml(scheduledDaily.reason)}`);
  lines.push('  currentCrawlSystem:');
  lines.push(`    level: ${scalarYaml(currentCrawlSystem.level)}`);
  lines.push(`    lockState: ${scalarYaml(currentCrawlSystem.lockState)}`);
  lines.push(`    lockFree: ${scalarYaml(currentCrawlSystem.lockFree)}`);
  lines.push(`    activeRunBlocked: ${scalarYaml(currentCrawlSystem.activeRunBlocked)}`);
  lines.push(`    finalizationLockBlocker: ${scalarYaml(currentCrawlSystem.finalizationLockBlocker)}`);
  lines.push(`    awaitingNextScheduledDailyConfirmation: ${scalarYaml(currentCrawlSystem.awaitingNextScheduledDailyConfirmation)}`);
  lines.push(`    reason: ${quoteYaml(currentCrawlSystem.reason)}`);
  lines.push('    latestManualFullCrawl:');
  lines.push(`      runId: ${quoteYaml(latestManualFull.id || 'not_available')}`);
  lines.push(`      status: ${scalarYaml(latestManualFull.status || 'unknown')}`);
  lines.push(`      terminal: ${scalarYaml(latestManualFull.terminal ?? 'unknown')}`);
  lines.push(`      lastStage: ${scalarYaml(latestManualFull.lastStage || 'unknown')}`);
  lines.push(`      publishStatusFinished: ${scalarYaml(latestManualFull.publishStatusFinished ?? 'unknown')}`);
  lines.push(`      sourceOk: ${scalarYaml(latestManualFull.successfulSourcesCount ?? 'unknown')}`);
  lines.push(`      sourceFail: ${scalarYaml(latestManualFull.failedSourcesCount ?? 'unknown')}`);
  lines.push('  sourceFailures:');
  lines.push(`    level: ${scalarYaml(sourceFailures.level)}`);
  lines.push(`    failedSourcesCount: ${scalarYaml(sourceFailures.failedSourcesCount)}`);
  lines.push(`    p0ReliabilityCount: ${scalarYaml(sourceFailures.p0ReliabilityCount)}`);
  lines.push(`    p1SourceCoverageCount: ${scalarYaml(sourceFailures.p1SourceCoverageCount)}`);
  lines.push(`    reason: ${quoteYaml(sourceFailures.reason)}`);
  lines.push('');
  lines.push('latest_scheduled_full_crawl:');
  lines.push(`  runId: ${quoteYaml(latest.runId)}`);
  lines.push(`  status: ${scalarYaml(latest.status)}`);
  lines.push(`  trigger: ${scalarYaml(latest.trigger)}`);
  lines.push(`  mode: ${scalarYaml(latest.mode)}`);
  lines.push(`  dryRun: ${scalarYaml(latest.dryRun)}`);
  lines.push(`  startedAt: ${scalarYaml(latest.startedAt)}`);
  lines.push(`  finishedAt: ${scalarYaml(latest.finishedAt)}`);
  lines.push(`  duration: ${quoteYaml(latest.duration)}`);
  lines.push(`  sourceOk: ${scalarYaml(latest.sourceOk)}`);
  lines.push(`  sourceFail: ${scalarYaml(latest.sourceFail)}`);
  lines.push('  warningErrorSummary:');
  appendList(lines, latest.warningErrorSummary, '    ');
  lines.push(`  staleRecoveryReason: ${quoteYaml(latest.staleRecoveryReason)}`);
  lines.push(`  automaticReplacementCrawlStarted: ${scalarYaml(latest.automaticReplacementCrawlStarted)}`);
  lines.push('');
  lines.push('crawl_history_summary:');
  lines.push('  scheduledFull:');
  lines.push('    lastRuns:');
  for (const run of history.scheduledFull?.lastRuns || []) {
    lines.push(`      - date: ${quoteYaml(run.date)}`);
    lines.push(`        status: ${scalarYaml(run.status)}`);
    lines.push(`        duration: ${quoteYaml(run.duration)}`);
  }
  if (!(history.scheduledFull?.lastRuns || []).length) lines.push('      - none');
  lines.push('    statusCounts:');
  for (const [key, value] of Object.entries(history.scheduledFull?.statusCounts || {})) {
    lines.push(`      ${key}: ${scalarYaml(value)}`);
  }
  lines.push('  manualScoped:');
  lines.push(`    count: ${scalarYaml(history.manualScoped?.count)}`);
  lines.push(`    success: ${scalarYaml(history.manualScoped?.success)}`);
  lines.push(`    failedOrStale: ${scalarYaml(history.manualScoped?.failedOrStale)}`);
  lines.push(`  pattern: ${quoteYaml(history.pattern)}`);
  lines.push(`  interpretationHint: ${quoteYaml(history.interpretationHint)}`);
  lines.push('');
  lines.push('offer_quality_kpi:');
  for (const [key, value] of Object.entries(offerKpi)) {
    if (Array.isArray(value)) continue;
    lines.push(`  ${key}: ${quoteYaml(value)}`);
  }
  lines.push('');
  lines.push('interpretation_flags:');
  for (const flag of essence.interpretationFlags || []) {
    lines.push(`  - flag: ${scalarYaml(flag.flag)}`);
    lines.push(`    severity: ${scalarYaml(flag.severity)}`);
    lines.push(`    evidence: ${quoteYaml(flag.evidence)}`);
  }
  if (!(essence.interpretationFlags || []).length) lines.push('  - none');
  lines.push('');
  lines.push('retailer_matrix_summary:');
  for (const row of essence.retailerMatrixSummary || []) {
    lines.push(`  - retailer: ${quoteYaml(row.retailerName || row.retailerKey)}`);
    lines.push(`    key: ${quoteYaml(row.retailerKey)}`);
    lines.push(`    active: ${scalarYaml(row.active)}`);
    lines.push(`    officialRate: ${quoteYaml(row.officialRate)}`);
    lines.push(`    validityRate: ${quoteYaml(row.validityRate)}`);
    lines.push(`    conditionRate: ${quoteYaml(row.conditionRate)}`);
    lines.push(`    imageRate: ${quoteYaml(row.imageRate)}`);
    lines.push(`    aggregatorCount: ${scalarYaml(row.aggregatorCount)}`);
    lines.push(`    warningStatus: ${scalarYaml(row.warningStatus)}`);
    lines.push(`    shortDiagnosis: ${quoteYaml(row.shortDiagnosis)}`);
  }
  if (!(essence.retailerMatrixSummary || []).length) lines.push('  - none');
  lines.push('spar_family:');
  lines.push(`  status: ${scalarYaml(essence.sparFamily?.status)}`);
  lines.push(`  diagnosis: ${quoteYaml(essence.sparFamily?.diagnosis)}`);
  lines.push(`  likelyNextWork: ${quoteYaml(essence.sparFamily?.likelyNextWork)}`);
  lines.push('');
  lines.push('trend_summary:');
  lines.push(`  historicalOfferSnapshotsAvailable: ${scalarYaml(essence.trendSummary?.historicalOfferSnapshotsAvailable)}`);
  lines.push(`  reliability: ${scalarYaml(essence.trendSummary?.reliability)}`);
  lines.push(`  unknownDays: [${(essence.trendSummary?.unknownDays || []).map(quoteYaml).join(', ')}]`);
  lines.push(`  successDays: [${(essence.trendSummary?.successDays || []).map(quoteYaml).join(', ')}]`);
  lines.push(`  staleDays: [${(essence.trendSummary?.staleDays || []).map(quoteYaml).join(', ')}]`);
  lines.push(`  interpretation: ${quoteYaml(essence.trendSummary?.interpretation)}`);
  lines.push('');
  lines.push('actionable_issues:');
  for (const issue of essence.actionableIssues || []) {
    lines.push(`  - priority: ${scalarYaml(issue.priority)}`);
    lines.push(`    severity: ${scalarYaml(issue.severity)}`);
    lines.push(`    title: ${quoteYaml(issue.title)}`);
    lines.push(`    evidence: ${quoteYaml(issue.evidence)}`);
    lines.push(`    likelyRootCauseClass: ${quoteYaml(issue.likelyRootCauseClass)}`);
    lines.push(`    recommendedNextAction: ${quoteYaml(issue.recommendedNextAction)}`);
    if (issue.forbiddenActionsUntilResolved?.length) {
      lines.push('    forbiddenActionsUntilResolved:');
      appendList(lines, issue.forbiddenActionsUntilResolved, '      ');
    }
  }
  if (!(essence.actionableIssues || []).length) lines.push('  - none');
  lines.push('');
  lines.push('feedback_beta_test:');
  lines.push(`  totalFeedback: ${scalarYaml(feedback.totalFeedback)}`);
  lines.push(`  newToday: ${scalarYaml(feedback.newToday)}`);
  lines.push(`  newLast24h: ${scalarYaml(feedback.newLast24h)}`);
  lines.push(`  newLast7Days: ${scalarYaml(feedback.newLast7Days)}`);
  lines.push(`  newLast30Days: ${scalarYaml(feedback.newLast30Days)}`);
  lines.push(`  openFeedback: ${scalarYaml(feedback.openFeedback)}`);
  lines.push(`  resolvedFeedback: ${scalarYaml(feedback.resolvedFeedback)}`);
  lines.push('  feedbackByStatus:');
  for (const row of feedback.feedbackByStatus || []) lines.push(`    - ${quoteYaml(row.status)}: ${scalarYaml(row.count)}`);
  if (!(feedback.feedbackByStatus || []).length) lines.push('    - none');
  lines.push('  feedbackByType:');
  for (const row of feedback.feedbackByType || []) lines.push(`    - ${quoteYaml(row.type)}: ${scalarYaml(row.count)}`);
  if (!(feedback.feedbackByType || []).length) lines.push('    - none');
  lines.push('  feedbackByRetailer:');
  for (const row of feedback.feedbackByRetailer || []) lines.push(`    - ${quoteYaml(row.retailerLabel || row.retailerKey)}: ${scalarYaml(row.count)}`);
  if (!(feedback.feedbackByRetailer || []).length) lines.push('    - none');
  lines.push('  topAffectedOffers:');
  for (const row of feedback.topAffectedOffers || []) {
    lines.push(`    - offerReference: ${quoteYaml(row.offerId)}`);
    lines.push(`      retailer: ${quoteYaml(row.retailerLabel || row.retailerKey)}`);
    lines.push(`      count: ${scalarYaml(row.count)}`);
    lines.push(`      reasons: [${(row.reasons || []).map(quoteYaml).join(', ')}]`);
  }
  if (!(feedback.topAffectedOffers || []).length) lines.push('    - none');
  lines.push(`  latestFeedbackCount: ${scalarYaml(feedback.latestFeedbackCount)}`);
  lines.push('  latestOpenFeedbackSnippets:');
  for (const item of feedback.latestOpenFeedbackSnippets || []) {
    lines.push(`    - createdAt: ${scalarYaml(item.createdAt)}`);
    lines.push(`      status: ${scalarYaml(item.status)}`);
    lines.push(`      reasons: [${(item.reasons || []).map(quoteYaml).join(', ')}]`);
    lines.push(`      retailer: ${quoteYaml(item.retailer)}`);
    lines.push(`      offerReference: ${quoteYaml(item.offerReference)}`);
    lines.push(`      query: ${quoteYaml(item.query)}`);
    lines.push(`      snippet: ${quoteYaml(item.snippet)}`);
  }
  if (!(feedback.latestOpenFeedbackSnippets || []).length) lines.push('    - none');
  lines.push(`  interpretation: ${quoteYaml(feedback.interpretation)}`);
  lines.push(`  recommendedNextAction: ${quoteYaml(feedback.recommendedNextAction)}`);
  lines.push('');
  lines.push('feedback_processing_instruction:');
  lines.push(`  requiredForNextCodexPrompt: ${scalarYaml(instruction.requiredForNextCodexPrompt)}`);
  lines.push(`  unprocessedFeedbackAvailable: ${scalarYaml(instruction.unprocessedFeedbackAvailable)}`);
  lines.push(`  instructionStillApplies: ${scalarYaml(instruction.instructionStillApplies)}`);
  lines.push(`  instruction: ${quoteYaml(instruction.instruction)}`);
  lines.push(`  scope: ${quoteYaml(instruction.scope)}`);
  lines.push(`  collection: ${quoteYaml(instruction.collection)}`);
  lines.push('  includeOnly:');
  appendList(lines, instruction.includeOnly, '    ');
  lines.push('  exclude:');
  appendList(lines, instruction.exclude, '    ');
  lines.push(`  purpose: ${quoteYaml(instruction.purpose)}`);
  lines.push('');
  lines.push('source_extraction_summary:');
  for (const [key, value] of Object.entries(essence.sourceExtractionSummary || {})) {
    lines.push(`  ${key}: ${quoteYaml(value)}`);
  }
  lines.push('');
  lines.push('safety:');
  lines.push(`  excludesSensitiveFields: ${scalarYaml(essence.safety?.excludesSensitiveFields)}`);
  lines.push(`  snippetsMaxCharacters: ${scalarYaml(essence.safety?.snippetsMaxCharacters)}`);
  lines.push(`  completeUrlsIncluded: ${scalarYaml(essence.safety?.completeUrlsIncluded)}`);
  lines.push(`  secretsIncluded: ${scalarYaml(essence.safety?.secretsIncluded)}`);
  lines.push('');
  lines.push('# Aufgabe an ChatGPT');
  lines.push('Analysiere diese Dashboard-Essenz.');
  lines.push('Beruecksichtige dabei ausdruecklich die aktuellen, noch nicht verarbeiteten User-Feedbacks aus OfferFeedback, sofern sie in der Essenz enthalten sind. Falls sie nicht enthalten sind, fordere im naechsten Codex-Prompt read-only an, diese Feedbacks auszulesen und bei der Priorisierung zu beruecksichtigen.');
  lines.push('');
  lines.push('Bitte liefere:');
  lines.push('1. Kurzfazit Gruen/Gelb/Rot');
  lines.push('2. wichtigste Muster');
  lines.push('3. wahrscheinlichste Root Causes');
  lines.push('4. Prioritaeten nach P0/P1/P2');
  lines.push('5. welche Arbeiten jetzt ausdruecklich NICHT gemacht werden sollen');
  lines.push('6. den idealen naechsten Codex-Prompt mit maximaler Effizienz und minimalem Risiko');

  return lines.join('\n');
}

function buildAnalysisEssencePayload(context = {}) {
  const analysisEssence = buildAnalysisEssence(context);
  return {
    analysisEssence,
    analysisEssenceText: renderAnalysisEssenceText(analysisEssence),
  };
}

function createEmptyComparisonSnapshot(message) {
  return {
    generatedAt: new Date().toISOString(),
    comparableOfferCount: 0,
    exactMatches: [],
    categoryBenchmarks: [],
    unavailable: true,
    message,
  };
}

async function withTimeout(task, timeoutMs, timeoutMessage) {
  let timeoutId = null;

  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function buildComparisonSnapshotSafely() {
  const startedAt = Date.now();

  try {
    const snapshot = await withTimeout(
      () => buildComparisonSnapshot(),
      COMPARISON_SNAPSHOT_TIMEOUT_MS,
      `Comparison snapshot timed out after ${COMPARISON_SNAPSHOT_TIMEOUT_MS}ms`
    );

    logger.info('Dashboard comparison snapshot built', {
      durationMs: Date.now() - startedAt,
      comparableOfferCount: snapshot.comparableOfferCount,
      exactMatchCount: snapshot.exactMatches.length,
      categoryBenchmarkCount: snapshot.categoryBenchmarks.length,
    });

    return snapshot;
  } catch (error) {
    logger.warn('Dashboard comparison snapshot unavailable', {
      durationMs: Date.now() - startedAt,
      message: error.message,
    });

    return createEmptyComparisonSnapshot(
      'Vergleichsgruppen konnten diesmal nicht rechtzeitig geladen werden. Die restliche Diagnose bleibt verfuegbar.'
    );
  }
}

function withQueryMaxTime(query) {
  return typeof query.maxTimeMS === 'function'
    ? query.maxTimeMS(DASHBOARD_QUERY_MAX_TIME_MS)
    : query;
}

function buildPublishStatusSummaryFromRows(rows = []) {
  const publishStatuses = rows
    .map((row) => {
      const status = row.status || row._id || 'unknown';

      return {
        status,
        count: numberFrom(row.count),
        final: isFinalPublishStatus(status),
        intermediate: isIntermediatePublishStatus(status),
      };
    })
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status));
  const totalActiveOffers = publishStatuses.reduce((sum, item) => sum + item.count, 0);
  const openPublishCount = publishStatuses
    .filter((item) => item.intermediate)
    .reduce((sum, item) => sum + item.count, 0);

  return {
    totalActiveOffers,
    finalCount: totalActiveOffers - openPublishCount,
    openCount: openPublishCount,
    finalRate: rate(totalActiveOffers - openPublishCount, totalActiveOffers),
    status: openPublishCount > 0 ? 'open' : totalActiveOffers > 0 ? 'final' : 'unknown',
    statuses: publishStatuses,
  };
}

async function buildActivePublishStatusSummary(currentAvailabilityMatch) {
  const rows = await Offer.aggregate([
    { $match: currentAvailabilityMatch },
    { $group: { _id: '$publishStatus', count: { $sum: 1 } } },
    { $project: { _id: 0, status: { $ifNull: ['$_id', 'unknown'] }, count: 1 } },
    { $sort: { count: -1, status: 1 } },
  ]).option({ maxTimeMS: DASHBOARD_QUERY_MAX_TIME_MS });

  return buildPublishStatusSummaryFromRows(rows);
}

function concatStringArrayExpression(fieldPath) {
  return {
    $reduce: {
      input: { $ifNull: [fieldPath, []] },
      initialValue: '',
      in: {
        $concat: [
          '$$value',
          ' ',
          { $toString: { $ifNull: ['$$this', ''] } },
        ],
      },
    },
  };
}

function buildActiveOfferFeatureStages() {
  const sourceTextExpression = {
    $toLower: {
      $concat: [
        { $toString: { $ifNull: ['$sourceType', ''] } },
        ' ',
        concatStringArrayExpression('$sourceTypes'),
        ' ',
        { $toString: { $ifNull: ['$rawFacts.sourceType', ''] } },
      ],
    },
  };
  const urlTextExpression = {
    $toLower: {
      $concat: [
        { $toString: { $ifNull: ['$sourceUrl', ''] } },
        ' ',
        concatStringArrayExpression('$sourceUrls'),
        ' ',
        concatStringArrayExpression('$evidenceUrls'),
        ' ',
        { $toString: { $ifNull: ['$rawFacts.clickoutUrl', ''] } },
        ' ',
        { $toString: { $ifNull: ['$rawFacts.leafletHref', ''] } },
      ],
    },
  };

  return [
    {
      $project: {
        retailerKey: { $ifNull: ['$retailerKey', 'unknown'] },
        retailerName: { $ifNull: ['$retailerName', '$retailerKey'] },
        sourceType: { $ifNull: ['$sourceType', 'unknown'] },
        publishStatus: { $ifNull: ['$publishStatus', 'unknown'] },
        validFrom: 1,
        validTo: 1,
        sourceText: sourceTextExpression,
        urlText: urlTextExpression,
        safeValidity: {
          $or: [
            {
              $and: [
                { $ne: ['$validFrom', null] },
                { $ne: ['$validTo', null] },
              ],
            },
            { $ne: ['$rawFacts.validitySource', null] },
            { $ne: ['$rawFacts.validTo', null] },
          ],
        },
        missingValidTo: { $eq: ['$validTo', null] },
        condition: {
          $or: [
            { $gt: [{ $strLenCP: { $ifNull: ['$conditionsText', ''] } }, 0] },
            { $eq: ['$hasConditions', true] },
            { $eq: ['$isMultiBuy', true] },
            { $in: ['$effectiveDiscountType', [...PROMOTION_TYPES]] },
            { $gt: [{ $ifNull: ['$minimumPurchaseQty', 1] }, 1] },
            { $ne: ['$discountPercent', null] },
            { $ne: ['$discountUpToPercent', null] },
          ],
        },
        comparisonSafe: {
          $or: [
            { $eq: ['$quality.comparisonSafe', true] },
            { $eq: ['$normalizedUnitPrice.comparable', true] },
          ],
        },
        image: {
          $or: [
            { $gt: [{ $strLenCP: { $ifNull: ['$imageUrl', ''] } }, 0] },
            { $gt: [{ $strLenCP: { $ifNull: ['$rawFacts.imageUrl', ''] } }, 0] },
          ],
        },
      },
    },
    {
      $set: {
        official: {
          $or: [
            { $regexMatch: { input: '$sourceText', regex: /official|algolia/ } },
            {
              $and: [
                { $regexMatch: { input: '$urlText', regex: /(billa|penny|hofer|lidl|spar|interspar|dm|bipa|pagro)\.at/ } },
                { $not: [{ $regexMatch: { input: '$urlText', regex: /aktionsfinder\.at|marketguru\.at|wogibtswas\.at/ } }] },
              ],
            },
          ],
        },
        aggregator: {
          $or: [
            { $regexMatch: { input: '$sourceText', regex: /aggregator|aktionsfinder|marketguru|wogibtswas/ } },
            { $regexMatch: { input: '$urlText', regex: /aktionsfinder\.at|marketguru\.at|wogibtswas\.at/ } },
          ],
        },
      },
    },
    {
      $set: {
        aggregatorRisk: {
          $and: [
            '$aggregator',
            { $not: ['$safeValidity'] },
          ],
        },
      },
    },
  ];
}

function buildCounterGroupStage(idExpression = null) {
  return {
    $group: {
      _id: idExpression,
      retailerKey: { $first: '$retailerKey' },
      retailerName: { $first: '$retailerName' },
      activeOffers: { $sum: 1 },
      officialOffers: { $sum: { $cond: ['$official', 1, 0] } },
      aggregatorOffers: { $sum: { $cond: ['$aggregator', 1, 0] } },
      safeValidityOffers: { $sum: { $cond: ['$safeValidity', 1, 0] } },
      missingValidToOffers: { $sum: { $cond: ['$missingValidTo', 1, 0] } },
      conditionOffers: { $sum: { $cond: ['$condition', 1, 0] } },
      comparisonSafeOffers: { $sum: { $cond: ['$comparisonSafe', 1, 0] } },
      imageOffers: { $sum: { $cond: ['$image', 1, 0] } },
      aggregatorRiskOffers: { $sum: { $cond: ['$aggregatorRisk', 1, 0] } },
    },
  };
}

async function buildActiveOfferDashboardDiagnostics(activeOfferMatch) {
  const [result = {}] = await Offer.aggregate([
    { $match: activeOfferMatch },
    ...buildActiveOfferFeatureStages(),
    {
      $facet: {
        summary: [
          buildCounterGroupStage(null),
          { $project: { _id: 0 } },
        ],
        retailerMatrix: [
          buildCounterGroupStage('$retailerKey'),
          {
            $project: {
              _id: 0,
              retailerKey: '$_id',
              retailerName: 1,
              activeOffers: 1,
              officialOffers: 1,
              aggregatorOffers: 1,
              safeValidityOffers: 1,
              missingValidToOffers: 1,
              conditionOffers: 1,
              comparisonSafeOffers: 1,
              imageOffers: 1,
              aggregatorRiskOffers: 1,
            },
          },
          { $sort: { activeOffers: -1, retailerKey: 1 } },
          { $limit: DASHBOARD_AGGREGATE_RESULT_LIMIT },
        ],
        sourceTypeSummary: [
          { $group: { _id: '$sourceType', count: { $sum: 1 } } },
          { $project: { _id: 0, sourceType: { $ifNull: ['$_id', 'unknown'] }, count: 1 } },
          { $sort: { count: -1, sourceType: 1 } },
          { $limit: DASHBOARD_AGGREGATE_RESULT_LIMIT },
        ],
        publishStatusSummary: [
          { $group: { _id: '$publishStatus', count: { $sum: 1 } } },
          { $project: { _id: 0, status: { $ifNull: ['$_id', 'unknown'] }, count: 1 } },
          { $sort: { count: -1, status: 1 } },
          { $limit: DASHBOARD_AGGREGATE_RESULT_LIMIT },
        ],
      },
    },
  ]).option({ maxTimeMS: DASHBOARD_QUERY_MAX_TIME_MS });

  return buildOfferDiagnosticsFromAggregateResult(result);
}

async function safeDashboardQuery(name, promise, fallback, warnings = []) {
  try {
    return await promise;
  } catch (error) {
    const message = `${name} unavailable: ${error.message}`;
    warnings.push(message);
    logger.warn('Dashboard snapshot section unavailable', {
      section: name,
      message: error.message,
    });
    return fallback;
  }
}

async function buildDashboardSnapshot() {
  const activeOfferMatch = buildDashboardActiveOfferMatch();
  const dashboardWarnings = [];
  const [
    sources,
    latestJobs,
    crawlRuns,
    latestScheduledFullCrawlRaw,
    activeCrawlRunRaw,
    crawlLock,
    rawCount,
    storedOfferCount,
    offersPendingReview,
    offersWithIssues,
    activeOfferDiagnostics,
    offerSamples,
    recentFeedback,
    retailerSummary,
    retailerCoverage,
    feedbackSummary,
    comparisonSnapshot,
    analyticsSummary,
  ] = await Promise.all([
    safeDashboardQuery('sources', withQueryMaxTime(Source.find().sort({ active: -1, retailerName: 1 }).lean()), [], dashboardWarnings),
    safeDashboardQuery('latestJobs', withQueryMaxTime(CrawlJob.find().sort({ startedAt: -1 }).limit(20).lean()), [], dashboardWarnings),
    safeDashboardQuery('crawlRuns', withQueryMaxTime(CrawlRun.find().sort({ startedAt: -1, createdAt: -1 }).limit(14).lean()), [], dashboardWarnings),
    safeDashboardQuery('latestScheduledFullCrawl', withQueryMaxTime(CrawlRun.findOne({
      trigger: 'scheduled',
      mode: 'full',
      dryRun: false,
    }).sort({ startedAt: -1, createdAt: -1 }).lean()), null, dashboardWarnings),
    safeDashboardQuery('activeCrawlRun', withQueryMaxTime(CrawlRun.findOne({ status: { $in: ['queued', 'running'] } }).sort({ startedAt: -1, createdAt: -1 }).lean()), null, dashboardWarnings),
    safeDashboardQuery('crawlLock', withQueryMaxTime(CrawlRunLock.findById(GLOBAL_CRAWL_LOCK_KEY).lean()), null, dashboardWarnings),
    HEAVY_OFFER_DIAGNOSTICS_ENABLED
      ? safeDashboardQuery('rawCount', withQueryMaxTime(RawDocument.countDocuments()), 0, dashboardWarnings)
      : Promise.resolve(null),
    HEAVY_OFFER_DIAGNOSTICS_ENABLED
      ? safeDashboardQuery('storedOfferCount', withQueryMaxTime(Offer.countDocuments()), 0, dashboardWarnings)
      : Promise.resolve(null),
    HEAVY_OFFER_DIAGNOSTICS_ENABLED
      ? safeDashboardQuery('offersPendingReview', withQueryMaxTime(Offer.countDocuments({ 'adminReview.status': 'pending' })), 0, dashboardWarnings)
      : Promise.resolve(null),
    HEAVY_OFFER_DIAGNOSTICS_ENABLED
      ? safeDashboardQuery('offersWithIssues', withQueryMaxTime(Offer.countDocuments({ 'quality.issues.0': { $exists: true } })), 0, dashboardWarnings)
      : Promise.resolve(null),
    safeDashboardQuery(
      'activeOfferDiagnostics',
      buildActiveOfferDashboardDiagnostics(activeOfferMatch),
      buildUnavailableOfferDiagnostics('Active offer diagnostics query failed.'),
      dashboardWarnings
    ),
    HEAVY_OFFER_DIAGNOSTICS_ENABLED
      ? safeDashboardQuery('offerSamples', withQueryMaxTime(Offer.find(
      {},
      {
        retailerName: 1,
        title: 1,
        imageUrl: 1,
        sourceUrl: 1,
        supportingSources: 1,
        categoryPrimary: 1,
        categorySecondary: 1,
        validFrom: 1,
        validTo: 1,
        conditionsText: 1,
        priceCurrent: 1,
        normalizedUnitPrice: 1,
        quality: 1,
        adminReview: 1,
      }
    )
      .sort({ createdAt: -1 })
      .limit(24)
      .lean()), [], dashboardWarnings)
      : Promise.resolve([]),
    safeDashboardQuery('recentFeedback', withQueryMaxTime(AdminFeedback.find().sort({ createdAt: -1 }).limit(10).lean()), [], dashboardWarnings),
    safeDashboardQuery('retailerSummary', withQueryMaxTime(Retailer.find({})
      .select('retailerKey retailerName offerCount activeOfferCount comparisonSafeShare usableOfferShare coverageStatus activeCoverageSignal coverageGapReasons coveragePriorityScore sourceDiversity lastSuccessfulCrawlAt')
      .sort({ retailerName: 1 })
      .lean()), [], dashboardWarnings),
    safeDashboardQuery('retailerCoverage', withQueryMaxTime(Retailer.find({})
      .select('retailerKey retailerName totalOffers activeOffers offersBySource offersByChannel firstSeenAt lastSeenAt lastSuccessfulCrawlAt activeCoverageSignal coverageStatus coveragePriorityScore coverageGapReasons activeCoverageTarget activeCoverageRatio sourceDiversity channelDiversity parsingConfidenceAverage comparisonSafeShare usableOfferShare crawlStabilityScore recentSuccessfulCrawlCount recentFailedCrawlCount repeatedLowYield')
      .sort({ coveragePriorityScore: -1, retailerName: 1 })
      .lean()), [], dashboardWarnings),
    safeDashboardQuery('feedbackSummary', buildFeedbackSummary(), buildFeedbackSummaryFromDocuments([], {
      totalFeedback: 0,
    }), dashboardWarnings),
    buildComparisonSnapshotSafely(),
    safeDashboardQuery('analyticsSummary', buildAnalyticsSummary(), {
      ok: false,
      trafficLast24h: 0,
      internalTrafficLast24h: 0,
      totalTrafficLast24h: 0,
      trafficDailyHistory: [],
      traffic: {
        last24h: { total: 0, byEventName: {}, since: null, until: null },
        dailyHistory: [],
        countedEvents: [],
        excludedEvents: [],
        note: 'Analytics summary unavailable.',
      },
    }, dashboardWarnings),
  ]);

  const activeSourceCount = sources.filter((source) => source.active).length;
  const inactiveSourceCount = sources.filter((source) => !source.active).length;
  const crawlHistory = crawlRuns.map(serializeCrawlRun);
  const latestCrawl = crawlHistory[0] || null;
  const latestScheduledFullCrawl = serializeCrawlRun(latestScheduledFullCrawlRaw);
  const activeCrawlRun = serializeCrawlRun(activeCrawlRunRaw);
  const lockStatus = serializeLock(crawlLock);
  const {
    offerSummary,
    retailerMatrix,
    sourceTypeSummary,
    publishStatusSummary,
  } = activeOfferDiagnostics || buildUnavailableOfferDiagnostics('Active offer diagnostics unavailable.');
  const qualityKpis = buildQualityKpis(offerSummary);
  const trendSeries = buildTrendSeries(crawlRuns, []);
  const activeOfferDiagnosticsCapped = false;

  const qualitySummary = {
    sourceCount: activeSourceCount,
    inactiveSourceCount,
    registeredSourceCount: sources.length,
    crawlJobCount: latestJobs.length,
    rawDocumentCount: rawCount,
    storedOfferCount,
    activeOfferCount: publishStatusSummary.totalActiveOffers ?? offerSummary.activeOffers ?? null,
    offersPendingReview,
    comparisonSafeOffers: offerSummary.comparisonSafeOffers,
    offersWithIssues,
  };

  const latestEssence = latestJobs
    .map((job) => ({
      retailerKey: job.retailerKey,
      status: job.status,
      essence: job.metadata?.essence || '',
      startedAt: job.startedAt,
    }))
    .filter((job) => job.essence);

  const executiveStatus = buildExecutiveStatus({
    latestCrawl,
    latestScheduledFullCrawl,
    activeCrawlRun,
    lockStatus,
    publishStatusSummary,
  });
  const crawlReliability = buildCrawlReliabilityStatus({
    latestScheduledFullCrawl,
    latestCrawl,
    crawlHistory,
    activeCrawlRun,
    lockStatus,
    publishStatusSummary,
  });
  const actionableIssues = buildActionableIssues({
    latestCrawl: latestScheduledFullCrawl || latestCrawl,
    lockStatus,
    publishStatusSummary,
    retailerMatrix,
    offerSummary,
    feedbackSummary,
  });
  const dataCompletenessWarnings = [
    trendSeries.length < 2
      ? 'Noch nicht genug historische Tagesdaten fuer belastbare KPI-Trends vorhanden.'
      : '',
    offerSummary.unavailable
      ? offerSummary.message || 'Aktive Offer-Diagnose ist nicht verfuegbar.'
      : '',
    !offerSummary.unavailable && offerSummary.activeOffers === 0
      ? 'Keine aktiven Angebote in der aktuellen Verfuegbarkeitslogik gefunden.'
      : '',
    activeOfferDiagnosticsCapped
      ? `Aktive Offer-Diagnose ist auf die neuesten ${ACTIVE_OFFER_DIAGNOSTIC_LIMIT} Angebote begrenzt; PublishStatus-Zaehlung bleibt exakt aggregiert.`
      : '',
    ...dashboardWarnings.map((warning) => `Dashboard partial: ${warning}`),
    latestScheduledFullCrawl ? '' : 'Kein scheduled/full CrawlRun gefunden; Ampel nutzt den neuesten CrawlRun als Fallback.',
  ].filter(Boolean);
  const generatedAt = new Date().toISOString();
  const buildInfo = buildSafeBuildInfo();
  const {
    analysisEssence,
    analysisEssenceText,
  } = buildAnalysisEssencePayload({
    generatedAt,
    buildInfo,
    executiveStatus,
    crawlReliability,
    latestScheduledFullCrawl,
    crawlHistory,
    lockStatus,
    publishStatusSummary,
    offerSummary,
    qualityKpis,
    retailerMatrix,
    trendSeries,
    actionableIssues,
    dataCompletenessWarnings,
    feedbackSummary,
    latestEssence,
  });

  return {
    ok: true,
    generatedAt,
    health: {
      build: buildInfo,
    },
    executiveStatus,
    crawlReliability,
    latestCrawl,
    latestScheduledFullCrawl,
    activeCrawlRun,
    crawlHistory,
    lockStatus,
    publishStatusSummary,
    offerSummary,
    retailerMatrix,
    sourceTypeSummary,
    qualityKpis,
    trendSeries,
    analyticsSummary,
    trafficSummary: analyticsSummary?.traffic || null,
    trafficLast24h: analyticsSummary?.trafficLast24h ?? analyticsSummary?.traffic?.last24h?.external?.total ?? 0,
    internalTrafficLast24h: analyticsSummary?.internalTrafficLast24h ?? analyticsSummary?.traffic?.last24h?.internal?.total ?? 0,
    totalTrafficLast24h: analyticsSummary?.totalTrafficLast24h ?? analyticsSummary?.traffic?.last24h?.total ?? 0,
    trafficDailyHistory: analyticsSummary?.trafficDailyHistory || analyticsSummary?.traffic?.dailyHistory || [],
    feedbackSummary,
    actionableIssues,
    dataCompletenessWarnings,
    qualitySummary,
    dashboardDiagnostics: {
      activeOfferDiagnosticsLimit: ACTIVE_OFFER_DIAGNOSTIC_LIMIT,
      activeOfferDiagnosticsCount: offerSummary.activeOffers ?? null,
      activeOfferDiagnosticsCapped,
      activeOfferDiagnosticsMatch: 'status=active,isActiveNow=true',
      aggregateResultLimit: DASHBOARD_AGGREGATE_RESULT_LIMIT,
      queryMaxTimeMs: DASHBOARD_QUERY_MAX_TIME_MS,
      comparisonSnapshotTimeoutMs: COMPARISON_SNAPSHOT_TIMEOUT_MS,
      heavyOfferDiagnosticsEnabled: HEAVY_OFFER_DIAGNOSTICS_ENABLED,
      partial: dashboardWarnings.length > 0,
      warnings: dashboardWarnings,
    },
    sources,
    latestJobs,
    retailerSummary,
    retailerCoverage,
    comparisonSnapshot,
    offerSamples,
    latestEssence,
    recentFeedback,
    analysisEssence,
    analysisEssenceText,
  };
}

module.exports = {
  buildDashboardSnapshot,
  _private: {
    buildActionableIssues,
    buildExecutiveStatus,
    buildFeedbackSummary,
    buildFeedbackSummaryFromDocuments,
    buildAnalysisEssencePayload,
    buildCrawlReliabilityStatus,
    buildSourceFailureDiagnosis,
    buildOfferDiagnostics,
    buildOfferDiagnosticsFromAggregateResult,
    buildUnavailableOfferDiagnostics,
    buildPublishStatusSummaryFromRows,
    buildQualityKpis,
    buildTrendSeries,
    renderAnalysisEssenceText,
    hasConditionEvidence,
    hasSafeValidity,
    isComparisonSafe,
    serializeLock,
  },
};
