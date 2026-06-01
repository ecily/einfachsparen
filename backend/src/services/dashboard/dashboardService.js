const Source = require('../../models/Source');
const CrawlJob = require('../../models/CrawlJob');
const RawDocument = require('../../models/RawDocument');
const Offer = require('../../models/Offer');
const AdminFeedback = require('../../models/AdminFeedback');
const Retailer = require('../../models/Retailer');
const CrawlRun = require('../../models/CrawlRun');
const CrawlRunLock = require('../../models/CrawlRunLock');
const env = require('../../config/env');
const { buildSafeBuildInfo } = require('../buildInfo');
const { buildComparisonSnapshot } = require('../comparisons/comparisonService');
const { classifyOfferSourceQuality } = require('../offers/sourceQuality');
const logger = require('../../lib/logger');

const COMPARISON_SNAPSHOT_TIMEOUT_MS = 8000;
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
const INTERMEDIATE_PUBLISH_STATUSES = new Set(['', 'unknown', 'source-written', 'queued', 'running']);
const PROMOTION_TYPES = new Set(['multi-buy', 'threshold', 'card-required', 'conditional-price', 'sticker']);

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

function serializeCrawlRun(run) {
  if (!run) return null;
  const plain = typeof run.toObject === 'function' ? run.toObject({ getters: false, virtuals: false }) : run;
  const sources = Array.isArray(plain.result?.sources) ? plain.result.sources : [];

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

  const withRates = (item) => ({
    ...item,
    officialCoverageRate: rate(item.officialOffers, item.activeOffers),
    validityConfidenceRate: rate(item.safeValidityOffers, item.activeOffers),
    conditionDetectionRate: rate(item.conditionOffers, item.activeOffers),
    comparisonSafetyRate: rate(item.comparisonSafeOffers, item.activeOffers),
    imageCoverageRate: rate(item.imageOffers, item.activeOffers),
    aggregatorRiskRate: rate(item.aggregatorRiskOffers, item.activeOffers),
  });

  const retailerMatrix = [...retailerMap.values()].map((item) => {
    const row = withRates(item);
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
  }).sort((left, right) => {
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
    .filter((item) => item.intermediate || !item.final)
    .reduce((sum, item) => sum + item.count, 0);

  return {
    offerSummary: withRates({
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

function buildQualityKpis(offerSummary = {}) {
  return [
    {
      key: 'officialCoverageRate',
      label: 'Official Coverage Rate',
      value: offerSummary.officialCoverageRate || 0,
      numerator: offerSummary.officialOffers || 0,
      denominator: offerSummary.activeOffers || 0,
      meaning: 'Anteil aktiver Angebote mit offizieller Quellen-Evidenz.',
      relevance: 'Offizielle Evidenz ist die belastbarste Grundlage fuer kaufklug.',
      interpretation: 'Gut ab ca. 70%, kritisch unter ca. 35%.',
    },
    {
      key: 'validityConfidenceRate',
      label: 'Validity Confidence Rate',
      value: offerSummary.validityConfidenceRate || 0,
      numerator: offerSummary.safeValidityOffers || 0,
      denominator: offerSummary.activeOffers || 0,
      meaning: 'Anteil aktiver Angebote mit sicherer oder sauber propagierter Gueltigkeit.',
      relevance: 'Nur Angebote mit belastbarer Gueltigkeit sollten aktiv verglichen werden.',
      interpretation: 'Gut ab ca. 85%, kritisch unter ca. 60%.',
    },
    {
      key: 'conditionDetectionRate',
      label: 'Condition Detection Rate',
      value: offerSummary.conditionDetectionRate || 0,
      numerator: offerSummary.conditionOffers || 0,
      denominator: offerSummary.activeOffers || 0,
      meaning: 'Anteil aktiver Angebote mit erkannten Angebotsbedingungen oder Promotionssignalen.',
      relevance: 'Bedingungen wie 1+1, Joker oder Mengenrabatte entscheiden ueber reale Ersparnis.',
      interpretation: 'Sinkende Werte koennen Parser- oder Quellenluecken anzeigen.',
    },
    {
      key: 'comparisonSafetyRate',
      label: 'Comparison Safety Rate',
      value: offerSummary.comparisonSafetyRate || 0,
      numerator: offerSummary.comparisonSafeOffers || 0,
      denominator: offerSummary.activeOffers || 0,
      meaning: 'Anteil aktiver Angebote, die rechnerisch sicher vergleichbar sind.',
      relevance: 'Preisvergleiche duerfen nur bei sicherer Normalisierung gezeigt werden.',
      interpretation: 'Gut ab ca. 75%, kritisch unter ca. 50%.',
    },
    {
      key: 'imageCoverageRate',
      label: 'Image Coverage Rate',
      value: offerSummary.imageCoverageRate || 0,
      numerator: offerSummary.imageOffers || 0,
      denominator: offerSummary.activeOffers || 0,
      meaning: 'Anteil aktiver Angebote mit Bild.',
      relevance: 'Bilder helfen bei schneller Erkennung und Plausibilitaetspruefung.',
      interpretation: 'Gut ab ca. 80%, eingeschraenkt unter ca. 50%.',
    },
    {
      key: 'aggregatorRiskRate',
      label: 'Aggregator Risk Rate',
      value: offerSummary.aggregatorRiskRate || 0,
      numerator: offerSummary.aggregatorRiskOffers || 0,
      denominator: offerSummary.activeOffers || 0,
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

function buildExecutiveStatus({ latestCrawl, latestScheduledFullCrawl, activeCrawlRun, lockStatus, publishStatusSummary }) {
  const referenceRun = latestScheduledFullCrawl || latestCrawl;
  const reasons = [];
  let level = 'green';

  if (!referenceRun) {
    level = 'red';
    reasons.push('Keine CrawlRun-Lineage gefunden.');
  } else {
    if (referenceRun.status === 'failed') {
      level = 'red';
      reasons.push('Letzter Daily Crawl ist fehlgeschlagen.');
    } else if (referenceRun.status === 'stale') {
      level = 'red';
      reasons.push('Letzter Daily Crawl wurde stale, weil der Heartbeat oder Prozessstatus nicht mehr vertrauenswuerdig war.');
    } else if (!TERMINAL_CRAWL_STATUSES.has(referenceRun.status)) {
      level = 'red';
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
    level = 'red';
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

function buildActionableIssues({ latestCrawl, lockStatus, publishStatusSummary, retailerMatrix, offerSummary }) {
  const issues = [];

  if (latestCrawl?.status === 'stale') {
    issues.push({
      severity: 'red',
      title: 'Letzter Crawl stale',
      detail: 'Daily Crawl Reliability und Heartbeat/Restart-Verhalten pruefen.',
    });
  }

  if (latestCrawl?.status === 'failed') {
    issues.push({
      severity: 'red',
      title: 'Letzter Crawl failed',
      detail: compactStrings(latestCrawl.errorMessages, 1)[0] || 'Fehlerdetails im CrawlRun pruefen.',
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

  if (issues.length === 0) {
    issues.push({
      severity: 'green',
      title: 'Keine blockierenden Issues aus vorhandenen Daten abgeleitet',
      detail: 'Weiterhin naechsten scheduled Daily Crawl beobachten.',
    });
  }

  return issues;
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

async function buildDashboardSnapshot() {
  const currentAvailabilityMatch = buildCurrentAvailabilityMatch();
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
    activeOffers,
    offerSamples,
    recentFeedback,
    retailerSummary,
    retailerCoverage,
    comparisonSnapshot,
  ] = await Promise.all([
    Source.find().sort({ active: -1, retailerName: 1 }).lean(),
    CrawlJob.find().sort({ startedAt: -1 }).limit(20).lean(),
    CrawlRun.find().sort({ startedAt: -1, createdAt: -1 }).limit(14).lean(),
    CrawlRun.findOne({
      trigger: 'scheduled',
      mode: 'full',
      dryRun: false,
    }).sort({ startedAt: -1, createdAt: -1 }).lean(),
    CrawlRun.findOne({ status: { $in: ['queued', 'running'] } }).sort({ startedAt: -1, createdAt: -1 }).lean(),
    CrawlRunLock.findById(GLOBAL_CRAWL_LOCK_KEY).lean(),
    RawDocument.countDocuments(),
    Offer.countDocuments(),
    Offer.countDocuments({ 'adminReview.status': 'pending' }),
    Offer.countDocuments({ 'quality.issues.0': { $exists: true } }),
    Offer.find(
      currentAvailabilityMatch,
      {
        retailerKey: 1,
        retailerName: 1,
        sourceType: 1,
        sourceTypes: 1,
        sourceUrl: 1,
        sourceUrls: 1,
        evidenceUrls: 1,
        imageUrl: 1,
        validFrom: 1,
        validTo: 1,
        conditionsText: 1,
        hasConditions: 1,
        isMultiBuy: 1,
        effectiveDiscountType: 1,
        minimumPurchaseQty: 1,
        discountPercent: 1,
        discountUpToPercent: 1,
        quality: 1,
        normalizedUnitPrice: 1,
        publishStatus: 1,
        rawFacts: 1,
        lastSeenAt: 1,
        createdAt: 1,
        updatedAt: 1,
        crawlRunId: 1,
      }
    ).lean(),
    Offer.find(
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
      .lean(),
    AdminFeedback.find().sort({ createdAt: -1 }).limit(10).lean(),
    Retailer.find({})
      .select('retailerKey retailerName offerCount activeOfferCount comparisonSafeShare usableOfferShare coverageStatus activeCoverageSignal coverageGapReasons coveragePriorityScore sourceDiversity lastSuccessfulCrawlAt')
      .sort({ retailerName: 1 })
      .lean(),
    Retailer.find({})
      .select('retailerKey retailerName totalOffers activeOffers offersBySource offersByChannel firstSeenAt lastSeenAt lastSuccessfulCrawlAt activeCoverageSignal coverageStatus coveragePriorityScore coverageGapReasons activeCoverageTarget activeCoverageRatio sourceDiversity channelDiversity parsingConfidenceAverage comparisonSafeShare usableOfferShare crawlStabilityScore recentSuccessfulCrawlCount recentFailedCrawlCount repeatedLowYield')
      .sort({ coveragePriorityScore: -1, retailerName: 1 })
      .lean(),
    buildComparisonSnapshotSafely(),
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
  } = buildOfferDiagnostics(activeOffers);
  const qualityKpis = buildQualityKpis(offerSummary);
  const trendSeries = buildTrendSeries(crawlRuns, activeOffers);

  const qualitySummary = {
    sourceCount: activeSourceCount,
    inactiveSourceCount,
    registeredSourceCount: sources.length,
    crawlJobCount: latestJobs.length,
    rawDocumentCount: rawCount,
    storedOfferCount,
    activeOfferCount: offerSummary.activeOffers,
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
  const actionableIssues = buildActionableIssues({
    latestCrawl: latestScheduledFullCrawl || latestCrawl,
    lockStatus,
    publishStatusSummary,
    retailerMatrix,
    offerSummary,
  });
  const dataCompletenessWarnings = [
    trendSeries.length < 2
      ? 'Noch nicht genug historische Tagesdaten fuer belastbare KPI-Trends vorhanden.'
      : '',
    activeOffers.length === 0
      ? 'Keine aktiven Angebote in der aktuellen Verfuegbarkeitslogik gefunden.'
      : '',
    latestScheduledFullCrawl ? '' : 'Kein scheduled/full CrawlRun gefunden; Ampel nutzt den neuesten CrawlRun als Fallback.',
  ].filter(Boolean);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    health: {
      build: buildSafeBuildInfo(),
    },
    executiveStatus,
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
    actionableIssues,
    dataCompletenessWarnings,
    qualitySummary,
    sources,
    latestJobs,
    retailerSummary,
    retailerCoverage,
    comparisonSnapshot,
    offerSamples,
    latestEssence,
    recentFeedback,
  };
}

module.exports = {
  buildDashboardSnapshot,
  _private: {
    buildActionableIssues,
    buildExecutiveStatus,
    buildOfferDiagnostics,
    buildQualityKpis,
    buildTrendSeries,
    hasConditionEvidence,
    hasSafeValidity,
    isComparisonSafe,
    serializeLock,
  },
};
