/*
 * One-shot, read-only Public-Validity lineage and impact diagnostic.
 *
 * Run from the deployed backend shell with the production environment already
 * loaded. The script only reads Offer, Source, CrawlRun and CrawlJob data and
 * writes JSON to stdout. Redirect stdout to a temporary diagnostic file.
 */

const mongoose = require('mongoose');
const { connectToDatabase } = require('../../src/config/mongodb');
const Offer = require('../../src/models/Offer');
const Source = require('../../src/models/Source');
const CrawlRun = require('../../src/models/CrawlRun');
const CrawlJob = require('../../src/models/CrawlJob');
const { buildOfferRanking } = require('../../src/services/offers/offerRankingService');
const { buildTopDeals } = require('../../src/services/offers/topDealsService');
const { deriveSourceKey } = require('../../src/services/crawl/crawlSourceSelection');

const PUBLIC_RETAILERS = [
  'billa', 'billa-plus', 'lidl', 'penny', 'dm', 'bipa', 'mueller',
  'spar', 'eurospar', 'interspar', 'hofer',
];
const HISTORY_RUN_LIMIT = 14;
const GRACE_HOURS = [0, 12, 24, 48];
const TTL_PROBES_HOURS = [24, 48, 72, 96, 168];
const VARIANTS = [
  'explicit-only',
  'existing-ttl',
  'evidence-based-ttl',
  'ttl-plus-grace',
  'conservative',
];

function id(value) {
  return value == null ? '' : String(value);
}

function shortId(value) {
  const text = id(value);
  return text ? text.slice(-8) : '';
}

function date(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function iso(value) {
  const parsed = date(value);
  return parsed ? parsed.toISOString() : null;
}

function safeErrorMessage(error) {
  return String(error?.message || 'Diagnostic failed.')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, '[redacted-mongodb-uri]')
    .replace(/https?:\/\/[^\s]+/gi, '[redacted-url]');
}

function hoursBetween(left, right) {
  const a = date(left);
  const b = date(right);
  return a && b ? Math.max(0, (b.getTime() - a.getTime()) / 3600000) : null;
}

function safeSourceKey(source = {}) {
  return deriveSourceKey(source) || `${source.retailerKey || 'unknown'}:${source.sourceType || source.channel || 'unknown'}`;
}

function sourcePolicy(source = {}) {
  const policy = source.crawlPolicy || {};
  const ttl = Number(policy.freshnessTtlHours);
  const grace = Number(policy.retainedGraceHours);
  const policyBounded = policy.scopedOnly === true
    || (policy.currentDiscovery !== true && policy.scopedOnly === true)
    || policy.scheduledHealthPolicy?.healthCriticality === 'policy-bounded';
  return {
    validityMode: policy.validityMode || (policy.currentSnapshot ? 'current-snapshot' : 'explicit-or-unknown'),
    existingTtlHours: Number.isFinite(ttl) && ttl > 0 ? ttl : null,
    retainedGraceHours: Number.isFinite(grace) && grace >= 0 ? grace : null,
    requiresCompleteSourceRun: policy.requiresCompleteSourceRun !== false,
    allowPartialConfirmation: policy.allowPartialConfirmation === true,
    currentSnapshot: policy.currentSnapshot === true,
    policyBounded,
  };
}

function hasExplicitValidity(offer, now) {
  const from = date(offer.validFrom);
  const to = date(offer.validTo);
  if (from && to && from > to) return false;
  return (!from || from <= now) && Boolean(to && to >= now);
}

function hasContradictoryValidity(offer) {
  const from = date(offer.validFrom);
  const to = date(offer.validTo);
  return Boolean(from && to && from > to);
}

function isFuture(offer, now) {
  const from = date(offer.validFrom);
  return Boolean(from && from > now);
}

function isExpired(offer, now) {
  const to = date(offer.validTo);
  return Boolean(to && to < now);
}

function jobHasNonZeroOutput(job) {
  const stats = job?.stats || {};
  return Number(stats.foundRawItems || 0) > 0
    && (Number(stats.offersStored || 0) > 0 || Number(stats.productiveOffers || 0) > 0);
}

function isCompleteSuccessfulRun(run) {
  return Boolean(run
    && run.status === 'success'
    && run.mode === 'full'
    && run.dryRun !== true
    && date(run.finishedAt));
}

function isCompleteSuccessfulJob(job, runIndex) {
  const run = job ? runIndex.byId.get(id(job.crawlRunId)) : null;
  return Boolean(job
    && job.status === 'success'
    && date(job.finishedAt)
    && job.sourceId
    && job.crawlRunId
    && jobHasNonZeroOutput(job)
    && isCompleteSuccessfulRun(run));
}

function hasExplicitRetentionMarker(offer) {
  return Boolean(
    offer.rawFacts?.retainedPreviousData === true
    || offer.rawFacts?.retained === true
    || /retained|previous-data/i.test(String(offer.publishStatus || ''))
    || /retained|previous-data/i.test(String(offer.deactivationReason || ''))
  );
}

function buildRunIndex(runs = []) {
  const byId = new Map();
  for (const run of runs) byId.set(id(run._id || run.id), run);
  return { byId };
}

function buildJobIndex(jobs = []) {
  const byId = new Map();
  const bySource = new Map();
  for (const job of jobs) {
    const jobId = id(job._id || job.id);
    byId.set(jobId, job);
    const sourceId = id(job.sourceId);
    if (!sourceId) continue;
    if (!bySource.has(sourceId)) bySource.set(sourceId, []);
    bySource.get(sourceId).push(job);
  }
  for (const list of bySource.values()) {
    list.sort((left, right) => date(right.finishedAt || right.startedAt) - date(left.finishedAt || left.startedAt));
  }
  return { byId, bySource };
}

function getOfferJobReferences(offer = {}) {
  return [
    ['crawlJobId', offer.crawlJobId],
    ['lastSeenSourceRunId', offer.lastSeenSourceRunId],
    ['rawFacts.crawlJobId', offer.rawFacts?.crawlJobId],
    // The writer uses lastSeenRunId as a job-id fallback only when no run id exists.
    ['lastSeenRunId-as-job-fallback', offer.lastSeenRunId],
  ].filter(([, value]) => Boolean(value)).map(([field, value]) => ({ field, value: id(value) }));
}

function resolveOfferJob(offer, jobIndex, expectedSourceId = '') {
  for (const reference of getOfferJobReferences(offer)) {
    const job = jobIndex.byId.get(reference.value);
    if (job && (!expectedSourceId || id(job.sourceId) === id(expectedSourceId))) {
      return { job, evidenceField: reference.field };
    }
  }
  return { job: null, evidenceField: '' };
}

function resolveOfferRun(offer, job, runIndex) {
  const candidates = [
    ['crawlRunId', offer.crawlRunId],
    ['job.crawlRunId', job?.crawlRunId],
    ['lastSeenRunId', offer.lastSeenRunId],
    ['rawFacts.crawlRunId', offer.rawFacts?.crawlRunId],
    ['rawFacts.sourceRunId', offer.rawFacts?.sourceRunId],
  ];
  for (const [field, value] of candidates) {
    const run = value ? runIndex.byId.get(id(value)) : null;
    if (run) return { run, evidenceField: field };
  }
  return { run: null, evidenceField: '' };
}

function latestSuccessfulJob(sourceId, jobIndex, runIndex) {
  return (jobIndex.bySource.get(id(sourceId)) || []).find((job) => isCompleteSuccessfulJob(job, runIndex)) || null;
}

function isZeroRawJob(job) {
  return Boolean(job && Number(job.stats?.foundRawItems || 0) === 0);
}

function isZeroStoredJob(job) {
  return Boolean(job
    && Number(job.stats?.foundRawItems || 0) > 0
    && Number(job.stats?.offersStored || 0) === 0
    && Number(job.stats?.productiveOffers || 0) === 0);
}

function latestConfirmedJobForOffer(offer, jobIndex, runIndex) {
  const resolved = resolveOfferJob(offer, jobIndex, offer.sourceId);
  if (!resolved.job) {
    return { job: null, evidenceField: resolved.evidenceField };
  }
  return {
    job: isCompleteSuccessfulJob(resolved.job, runIndex) ? resolved.job : null,
    evidenceField: resolved.evidenceField,
  };
}

function classifyOffer(offer, source, jobIndex, runIndex, now) {
  const explicit = hasExplicitValidity(offer, now);
  const future = isFuture(offer, now);
  const expired = isExpired(offer, now);
  const contradictory = hasContradictoryValidity(offer);
  const retained = hasExplicitRetentionMarker(offer);
  const policy = sourcePolicy(source);
  const resolved = latestConfirmedJobForOffer(offer, jobIndex, runIndex);
  const confirmedJob = resolved.job;
  const resolvedRun = resolveOfferRun(offer, resolved.job, runIndex);
  const sourceKnown = Boolean(source?._id || source?.id);
  const directLineage = Boolean(confirmedJob && resolvedRun.run && isCompleteSuccessfulRun(resolvedRun.run));
  const indirectLineage = sourceKnown && !directLineage;
  const partialJob = getOfferJobReferences(offer)
    .map((reference) => jobIndex.byId.get(reference.value))
    .find((candidate) => candidate && candidate.status === 'partial');
  const zeroRaw = getOfferJobReferences(offer)
    .map((reference) => jobIndex.byId.get(reference.value))
    .some(isZeroRawJob);
  const zeroStored = getOfferJobReferences(offer)
    .map((reference) => jobIndex.byId.get(reference.value))
    .some(isZeroStoredJob);

  let validityClass = 'unknown-lineage';
  if (contradictory) validityClass = 'contradictory-validity';
  else if (future) validityClass = 'future';
  else if (expired) validityClass = 'expired';
  else if (explicit) validityClass = 'explicit-validity';
  else if (policy.policyBounded) validityClass = 'policy-bounded';
  else if (retained && directLineage) validityClass = 'retained-confirmed';
  else if (retained) validityClass = 'retained-unconfirmed';
  else if (partialJob) validityClass = 'partial-only';
  else if (zeroRaw) validityClass = 'zero-raw';
  else if (zeroStored) validityClass = 'zero-stored';
  else if (directLineage) validityClass = 'snapshot-confirmed';
  else if (sourceKnown) validityClass = 'unknown-lineage';

  const lastConfirmedAt = directLineage
    ? date(confirmedJob.finishedAt || resolvedRun.run.finishedAt)
    : null;

  return {
    explicit,
    future,
    expired,
    contradictory,
    retained,
    sourceKnown,
    directLineage,
    indirectLineage,
    unknownLineage: !sourceKnown,
    confirmed: directLineage,
    partialOnly: Boolean(partialJob && !directLineage),
    zeroRaw,
    zeroStored,
    validityClass,
    sourcePolicy: policy,
    evidenceField: resolved.evidenceField,
    confirmedJobId: confirmedJob ? id(confirmedJob._id || confirmedJob.id) : '',
    confirmedRunId: resolvedRun.run ? id(resolvedRun.run._id || resolvedRun.run.id) : '',
    lastConfirmedAt: lastConfirmedAt ? lastConfirmedAt.toISOString() : null,
    lastSeenAt: iso(offer.lastSeenAt),
    sourceRunStatus: offer.sourceRunStatus || offer.rawFacts?.sourceRunStatus || '',
  };
}

function ttlForVariant(item, history, variant, ttlOverride = null) {
  if (Number.isFinite(ttlOverride)) return ttlOverride;
  if (variant === 'existing-ttl') return item.analysis.sourcePolicy.existingTtlHours;
  if (variant === 'evidence-based-ttl' || variant === 'ttl-plus-grace') {
    return history[item.sourceKey]?.candidateTtlHours ?? null;
  }
  if (variant === 'conservative') {
    const evidence = history[item.sourceKey]?.candidateTtlHours;
    return Number.isFinite(evidence) ? Math.min(evidence, 48) : null;
  }
  return null;
}

function retainedGraceForVariant(item, variant, graceHours) {
  if (variant === 'explicit-only') return 0;
  return Number.isFinite(graceHours)
    ? graceHours
    : (item.analysis.sourcePolicy.retainedGraceHours ?? 0);
}

function eligibilityDecision(item, { now, history, variant, graceHours = 0, ttlOverride = null } = {}) {
  const analysis = item.analysis;
  if (analysis.contradictory) return { eligible: false, reason: 'contradictory-validity' };
  if (analysis.future) return { eligible: false, reason: 'future-validFrom' };
  if (analysis.expired) return { eligible: false, reason: 'expired-validTo' };
  if (analysis.explicit) return { eligible: true, reason: 'explicit-validity' };
  if (analysis.sourcePolicy.policyBounded) return { eligible: false, reason: 'source-unknown' };
  if (!analysis.confirmed) {
    return { eligible: false, reason: analysis.retained ? 'no-complete-run-confirmation' : 'no-complete-run-confirmation' };
  }

  const confirmedAt = date(analysis.lastConfirmedAt);
  if (!confirmedAt) return { eligible: false, reason: 'no-complete-run-confirmation' };

  if (analysis.retained) {
    const grace = retainedGraceForVariant(item, variant, graceHours);
    return now.getTime() <= confirmedAt.getTime() + grace * 3600000
      ? { eligible: true, reason: 'retained-within-grace' }
      : { eligible: false, reason: 'retained-grace-expired' };
  }

  const ttl = ttlForVariant(item, history, variant, ttlOverride);
  if (!Number.isFinite(ttl)) return { eligible: false, reason: 'missing-validity' };
  return now.getTime() <= confirmedAt.getTime() + ttl * 3600000
    ? { eligible: true, reason: 'confirmed-within-ttl' }
    : { eligible: false, reason: 'ttl-expired' };
}

function increment(map, key, amount = 1) {
  const safeKey = key || 'unknown';
  map.set(safeKey, (map.get(safeKey) || 0) + amount);
}

function mapObject(map) {
  return Object.fromEntries([...map.entries()].sort((left, right) => right[1] - left[1]));
}

function summarizeItems(items, decisions = null) {
  const summary = {
    total: items.length,
    withValidTo: 0,
    withoutValidTo: 0,
    explicitValidity: 0,
    snapshotConfirmed: 0,
    retained: 0,
    unknown: 0,
    stale: 0,
    future: 0,
    expired: 0,
    directLineage: 0,
    indirectLineage: 0,
    noReliableLineage: 0,
    reasons: new Map(),
  };
  for (const item of items) {
    if (item.offer.validTo) summary.withValidTo += 1;
    else summary.withoutValidTo += 1;
    if (item.analysis.explicit) summary.explicitValidity += 1;
    if (item.analysis.confirmed) summary.snapshotConfirmed += 1;
    if (item.analysis.retained) summary.retained += 1;
    if (item.analysis.unknownLineage) summary.unknown += 1;
    if (item.analysis.future) summary.future += 1;
    if (item.analysis.expired) summary.expired += 1;
    if (item.analysis.directLineage) summary.directLineage += 1;
    if (item.analysis.indirectLineage) summary.indirectLineage += 1;
    if (!item.analysis.directLineage) summary.noReliableLineage += 1;
    if (decisions) {
      const decision = decisions.get(item);
      if (decision && !decision.eligible) increment(summary.reasons, decision.reason);
      if (decision && decision.reason === 'ttl-expired') summary.stale += 1;
      if (decision && decision.reason === 'retained-grace-expired') summary.stale += 1;
    } else if (!item.analysis.explicit && !item.analysis.confirmed) {
      increment(summary.reasons, item.analysis.validityClass);
    }
  }
  return { ...summary, reasons: mapObject(summary.reasons) };
}

function summarizeBy(items, keyFn, decisions = null) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => [key, summarizeItems(group, decisions)]));
}

function candidateTtlFromEvidence(gaps, existing) {
  if (Number.isFinite(existing)) return existing;
  if (!gaps.length) return null;
  const observed = Math.max(...gaps);
  const rounded = Math.ceil(observed / 24) * 24;
  return rounded <= 168 ? rounded : null;
}

function sourceRunEvidence(run, source) {
  const sources = Array.isArray(run?.result?.sources) ? run.result.sources : [];
  return sources.find((entry) => (
    id(entry.sourceId) === id(source._id)
    || entry.sourceKey === safeSourceKey(source)
  )) || null;
}

function classifyJobForHistory(job, run, source) {
  const evidence = sourceRunEvidence(run, source);
  const bounded = evidence?.skipped === true
    && (evidence.skippedReason === 'full-crawl-scoped-only-source' || evidence.diagnostic?.policyBounded === true);
  if (bounded || sourcePolicy(source).policyBounded) return 'policy-bounded';
  if (evidence?.diagnostic?.retainedPreviousData === true || evidence?.retainedPreviousData === true) return 'retained';
  if (!job) return 'missing';
  if (isZeroRawJob(job)) return 'zero-raw';
  if (isZeroStoredJob(job)) return 'zero-stored';
  if (job.status === 'partial') return 'partial';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'success' && jobHasNonZeroOutput(job)) return 'success';
  return job.status || 'unknown';
}

function runHistory(sources, jobs, runs, now) {
  const jobIndex = buildJobIndex(jobs);
  const scheduledRuns = runs
    .filter((run) => run.trigger === 'scheduled' && run.mode === 'full' && run.dryRun !== true && date(run.finishedAt))
    .sort((left, right) => date(right.finishedAt) - date(left.finishedAt))
    .slice(0, HISTORY_RUN_LIMIT);
  const result = {};
  for (const source of sources) {
    const sourceId = id(source._id);
    const rows = scheduledRuns.map((run) => {
      const job = (jobIndex.bySource.get(sourceId) || []).find((candidate) => id(candidate.crawlRunId) === id(run._id));
      return {
        runId: shortId(run._id),
        finishedAt: iso(run.finishedAt),
        status: classifyJobForHistory(job, run, source),
        jobId: shortId(job?._id),
        foundRawItems: Number(job?.stats?.foundRawItems || 0),
        offersStored: Number(job?.stats?.offersStored || 0),
      };
    });
    const successful = rows.filter((row) => row.status === 'success');
    const gaps = successful.slice(0, -1)
      .map((row, index) => hoursBetween(successful[index + 1].finishedAt, row.finishedAt))
      .filter(Number.isFinite);
    result[safeSourceKey(source)] = {
      retailerKey: source.retailerKey,
      sourceType: source.sourceType || source.channel || '',
      existingTtlHours: sourcePolicy(source).existingTtlHours,
      latestCompleteSuccessfulRun: successful[0] ? {
        jobId: successful[0].jobId,
        runId: successful[0].runId,
        finishedAt: successful[0].finishedAt,
        ageHours: hoursBetween(successful[0].finishedAt, now),
      } : null,
      latestByStatus: rows.reduce((accumulator, row) => {
        if (!accumulator[row.status]) accumulator[row.status] = row;
        return accumulator;
      }, {}),
      runs: rows,
      successfulRunCount: successful.length,
      maxObservedGapHours: gaps.length ? Math.max(...gaps) : null,
      candidateTtlHours: candidateTtlFromEvidence(gaps, sourcePolicy(source).existingTtlHours),
    };
  }
  return result;
}

function buildSimulation(items, history, { now, variant, graceHours = 0, ttlOverride = null } = {}) {
  const scopedItems = items.filter((item) => item?.offer?.retailerKey !== 'pagro');
  const decisions = new Map();
  const eligible = [];
  for (const item of scopedItems) {
    const decision = eligibilityDecision(item, { now, history, variant, graceHours, ttlOverride });
    decisions.set(item, decision);
    if (decision.eligible) eligible.push(item);
  }
  return {
    publicCount: eligible.length,
    diffAbsolute: eligible.length - scopedItems.length,
    diffPercent: scopedItems.length ? Number((((eligible.length - scopedItems.length) / scopedItems.length) * 100).toFixed(2)) : 0,
    byRetailer: summarizeBy(eligible, (item) => item.offer.retailerKey),
    bySource: summarizeBy(eligible, (item) => item.sourceKey),
    excludedReasons: mapObject(scopedItems.reduce((map, item) => {
      const decision = decisions.get(item);
      if (decision && !decision.eligible) increment(map, decision.reason);
      return map;
    }, new Map())),
    sourceCountsBelow25Percent: Object.fromEntries(Object.entries(summarizeBy(scopedItems, (item) => item.sourceKey)).map(([key, baseline]) => {
      const current = eligible.filter((item) => item.sourceKey === key).length;
      return [key, { baseline: baseline.total, eligible: current }];
    }).filter(([, row]) => row.baseline > 0 && row.eligible / row.baseline < 0.25)),
  };
}

function buildTtlSensitivity(items, history, now) {
  return Object.fromEntries(TTL_PROBES_HOURS.map((ttl) => [
    `${ttl}h`, buildSimulation(items, history, {
      now,
      variant: 'evidence-based-ttl',
      graceHours: 0,
      ttlOverride: ttl,
    }),
  ]));
}

async function loadPublicOffers() {
  const rankingOffers = [];
  for (const retailerKey of PUBLIC_RETAILERS) {
    const ranking = await buildOfferRanking({ retailers: retailerKey, limit: 'all', offset: 0, offsetExplicit: false });
    for (const offer of ranking.rankedOffers || []) rankingOffers.push({ ...offer, publicPath: 'ranking' });
  }
  const ids = [...new Set(rankingOffers.map((offer) => id(offer.id)).filter(Boolean))];
  const offers = await Offer.find({ _id: { $in: ids } })
    .select('_id retailerKey retailerName sourceId sourceType sourceTypes crawlRunId crawlJobId lastSeenAt lastSeenRunId lastSeenSourceRunId sourceRunStatus publishStatus validFrom validTo status isActiveNow rawFacts deactivationReason')
    .lean();
  const byId = new Map(offers.map((offer) => [id(offer._id), offer]));
  return rankingOffers.map((publicOffer) => ({
    offer: byId.get(id(publicOffer.id)),
    publicOffer,
  })).filter((item) => item.offer);
}

async function main() {
  const now = new Date();
  await connectToDatabase();
  const [sources, runs, jobs] = await Promise.all([
    Source.find({ retailerKey: { $ne: 'pagro' } }).select('_id retailerKey retailerName channel sourceType crawlPolicy enabled active latestStatus latestRunAt').lean(),
    CrawlRun.find({ mode: 'full', trigger: 'scheduled', finishedAt: { $ne: null } }).sort({ finishedAt: -1 }).limit(HISTORY_RUN_LIMIT).lean(),
    CrawlJob.find({ finishedAt: { $ne: null } }).sort({ finishedAt: -1 }).limit(5000).lean(),
  ]);
  const runIndex = buildRunIndex(runs);
  const jobIndex = buildJobIndex(jobs);
  const sourceById = new Map(sources.map((source) => [id(source._id), source]));
  const publicItems = await loadPublicOffers();
  const items = publicItems.map(({ offer, publicOffer }) => {
    const source = sourceById.get(id(offer.sourceId)) || {};
    const analysis = classifyOffer(offer, source, jobIndex, runIndex, now);
    return {
      offer: {
        id: shortId(offer._id),
        retailerKey: offer.retailerKey,
        sourceId: shortId(offer.sourceId),
        sourceType: offer.sourceType || '',
        crawlRunId: shortId(offer.crawlRunId),
        crawlJobId: shortId(offer.crawlJobId),
        lastSeenAt: iso(offer.lastSeenAt),
        lastSeenRunId: shortId(offer.lastSeenRunId),
        lastSeenSourceRunId: shortId(offer.lastSeenSourceRunId),
        validFrom: iso(offer.validFrom),
        validTo: iso(offer.validTo),
        status: offer.status,
        isActiveNow: offer.isActiveNow,
        publishStatus: offer.publishStatus,
        sourceRunStatus: offer.sourceRunStatus,
      },
      sourceKey: safeSourceKey(source),
      sourceStatus: source.latestStatus || '',
      publicPath: publicOffer.publicPath,
      analysis,
    };
  }).filter((item) => item.offer.retailerKey !== 'pagro');
  const history = runHistory(sources, jobs, runs, now);
  const baseline = summarizeItems(items);
  const simulations = {};
  for (const variant of VARIANTS) {
    for (const graceHours of GRACE_HOURS) {
      simulations[`${variant}+grace-${graceHours}h`] = buildSimulation(items, history, { now, variant, graceHours });
    }
  }
  const topDeals = await buildTopDeals({ limit: 1000 }).catch(() => null);
  const output = {
    generatedAt: now.toISOString(),
    timezone: 'Europe/Vienna',
    readOnly: true,
    sourceOfTruth: 'server-side Offer/Source/CrawlRun/CrawlJob collections plus existing ranking guard',
    publicRetailers: PUBLIC_RETAILERS,
    historyRunLimit: HISTORY_RUN_LIMIT,
    baseline: {
      publicRanking: baseline,
      internalActiveCount: await Offer.countDocuments({ status: 'active', isActiveNow: true, retailerKey: { $ne: 'pagro' } }),
      topDealsCandidateCount: Number(topDeals?.candidateCount || 0),
      topDealsPublicCount: Number(topDeals?.count || 0),
      byRetailer: summarizeBy(items, (item) => item.offer.retailerKey),
      bySource: summarizeBy(items, (item) => item.sourceKey),
    },
    lineage: {
      direct: items.filter((item) => item.analysis.directLineage).length,
      indirect: items.filter((item) => item.analysis.indirectLineage).length,
      unknown: items.filter((item) => item.analysis.unknownLineage).length,
      confirmedCompleteRun: items.filter((item) => item.analysis.confirmed).length,
      classifications: mapObject(items.reduce((map, item) => { increment(map, item.analysis.validityClass); return map; }, new Map())),
      samples: items.filter((item) => !item.analysis.confirmed).slice(0, 10).map((item) => ({
        retailerKey: item.offer.retailerKey,
        sourceKey: item.sourceKey,
        offerId: item.offer.id,
        validityClass: item.analysis.validityClass,
        evidenceField: item.analysis.evidenceField,
        lastSeenAt: item.analysis.lastSeenAt,
        lastConfirmedAt: item.analysis.lastConfirmedAt,
        sourceRunStatus: item.analysis.sourceRunStatus,
      })),
    },
    sourceRunHistory: history,
    ttlProbesHours: TTL_PROBES_HOURS,
    graceProbesHours: GRACE_HOURS,
    ttlSensitivity: buildTtlSensitivity(items, history, now),
    simulations,
    limitations: [
      'Confirmation is offer-specific: only an Offer crawlJobId, lastSeenSourceRunId, rawFacts.crawlJobId, or the documented lastSeenRunId job fallback may resolve a CrawlJob.',
      'A complete confirmation requires the linked CrawlJob to be successful, finished, non-zero, and linked to a successful non-dry-run full CrawlRun.',
      'No timestamp is promoted to lastConfirmedAt unless linked to that exact complete CrawlJob/Run.',
      'PAGRO is excluded from source loading, public ranking, baseline, and simulations.',
    ],
  };
  console.log(JSON.stringify(output, null, 2));
}

module.exports = {
  _private: {
    PUBLIC_RETAILERS,
    GRACE_HOURS,
    TTL_PROBES_HOURS,
    VARIANTS,
    sourcePolicy,
    hasExplicitValidity,
    hasContradictoryValidity,
    isCompleteSuccessfulRun,
    isCompleteSuccessfulJob,
    buildRunIndex,
    buildJobIndex,
    getOfferJobReferences,
    resolveOfferJob,
    resolveOfferRun,
    latestConfirmedJobForOffer,
    classifyOffer,
    eligibilityDecision,
    buildSimulation,
    buildTtlSensitivity,
    summarizeItems,
    runHistory,
  },
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(JSON.stringify({ readOnly: true, ok: false, error: error?.name || 'Error', message: safeErrorMessage(error) }));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
