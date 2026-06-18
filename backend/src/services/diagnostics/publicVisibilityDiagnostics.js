const Offer = require('../../models/Offer');
const {
  applyProgramEligibility,
  buildOfferRanking,
  buildRankingCandidateMatch,
  filterFreshActiveOffers,
} = require('../offers/offerRankingService');
const {
  hasCurrentRunFreshnessEvidence,
  hasExplicitExpiredEvidence,
  hasExpiredUrlRange,
  hasPlausiblePublicOfferShape,
  hasVisibleCustomerProgramCondition,
  isSnapshotTooOld,
  isStaleRetainedAggregatorWithoutPublicFreshness,
} = require('../offers/offerFreshness');
const {
  classifyOfferSourceQuality,
  hasFreshCrawlEvidence,
} = require('../offers/sourceQuality');

const ALLOWED_RETAILERS = new Set(['spar', 'interspar']);
const DEFAULT_RETAILERS = ['spar', 'interspar'];
const CANDIDATE_LIMIT = 1000;
const EXAMPLES_PER_RETAILER = 20;
const EXAMPLES_PER_REASON = 3;

const VISIBILITY_DIAGNOSTIC_FIELDS = [
  '_id',
  'retailerKey',
  'retailerName',
  'sourceRetailerName',
  'sourceRetailerFormat',
  'appliesToRetailerFormats',
  'title',
  'sourceType',
  'sourceTypes',
  'sourceUrl',
  'sourceUrls',
  'evidenceUrls',
  'crawlJobId',
  'lastSeenAt',
  'lastSeenRunId',
  'lastSeenSourceRunId',
  'sourceRunStatus',
  'publishStatus',
  'status',
  'isActiveNow',
  'validFrom',
  'validTo',
  'quality',
  'normalizedUnitPrice',
  'comparableUnit',
  'comparisonGroup',
  'customerProgramRequired',
  'conditionsText',
  'priceCurrent',
  'quantityText',
  'unitValue',
  'totalComparableAmount',
  'rawFacts.sourceKey',
  'rawFacts.sourceType',
  'rawFacts.sourceRunStatus',
  'rawFacts.validityText',
  'rawFacts.validitySource',
  'rawFacts.validTo',
  'rawFacts.expired',
  'rawFacts.isExpired',
  'rawFacts.explicitExpired',
  'rawFacts.clickoutUrl',
  'rawFacts.leafletHref',
  'createdAt',
  'updatedAt',
].join(' ');

const RANKING_SORT = {
  sortScoreDefault: -1,
  'normalizedUnitPrice.amount': 1,
  validTo: 1,
  retailerName: 1,
  title: 1,
};

function toDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoOrNull(value) {
  const date = toDateOrNull(value);
  return date ? date.toISOString() : null;
}

function normalizeRetailerList(value) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  const normalized = rawValues
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  const retailers = normalized.length > 0 ? normalized : DEFAULT_RETAILERS;
  const unique = [...new Set(retailers)];
  const invalid = unique.filter((retailer) => !ALLOWED_RETAILERS.has(retailer));

  if (invalid.length > 0) {
    const error = new Error(`Unsupported retailer for visibility diagnostics: ${invalid.join(', ')}`);
    error.statusCode = 400;
    error.details = {
      allowedRetailers: [...ALLOWED_RETAILERS],
      invalidRetailers: invalid,
    };
    throw error;
  }

  return unique;
}

function sourceKeyOf(offer = {}) {
  return (
    offer.rawFacts?.sourceKey
    || offer.sourceType
    || (Array.isArray(offer.sourceTypes) ? offer.sourceTypes[0] : '')
    || ''
  );
}

function collectFreshnessRejectReasons(offer = {}, now = new Date()) {
  const reasons = [];

  if (offer.status && offer.status !== 'active') reasons.push('status-not-active');
  if (offer.isActiveNow === false) reasons.push('isActiveNow-false');

  const validTo = toDateOrNull(offer.validTo);
  if (validTo && validTo < now) reasons.push('validTo-expired');
  if (hasExplicitExpiredEvidence(offer.rawFacts) || hasExplicitExpiredEvidence(offer)) {
    reasons.push('explicit-expired-evidence');
  }
  if (hasExpiredUrlRange(offer, now)) reasons.push('expired-url-range');
  if (isSnapshotTooOld(offer, now)) reasons.push('snapshot-too-old');
  if (!hasVisibleCustomerProgramCondition(offer)) {
    reasons.push('customer-program-condition-not-visible');
  }

  const sourceQuality = classifyOfferSourceQuality(offer);
  if (isStaleRetainedAggregatorWithoutPublicFreshness(offer, sourceQuality, now)) {
    reasons.push('stale-retained-aggregator-without-public-freshness');
  }
  if (sourceQuality.isLowConfidenceAggregator) {
    reasons.push('low-confidence-aggregator');
  }
  if (
    sourceQuality.sourceClass === 'aggregator-ppcv'
    && !sourceQuality.hasValidityEvidence
    && !sourceQuality.hasDetailEvidence
    && (
      !hasCurrentRunFreshnessEvidence(offer, now)
      || !hasPlausiblePublicOfferShape(offer)
      || !hasVisibleCustomerProgramCondition(offer)
    )
  ) {
    reasons.push('aktionsfinder-ppcv-missing-validity-detail-current-evidence');
  }

  return reasons;
}

function addCount(counter, key) {
  const safeKey = key || 'unknown';
  counter[safeKey] = (counter[safeKey] || 0) + 1;
}

function sourceClassLabel(sourceQuality = {}) {
  if (sourceQuality.hasOfficialEvidence) return 'official';
  if (String(sourceQuality.sourceClass || '').startsWith('aggregator')) return 'aggregator';
  return sourceQuality.sourceClass || 'unknown';
}

function buildRejectExample(offer = {}, primaryRejectReason, secondaryRejectReasons = [], now = new Date()) {
  const sourceQuality = classifyOfferSourceQuality(offer);

  return {
    offerReference: String(offer._id || offer.id || ''),
    title: String(offer.title || ''),
    retailer: {
      retailerKey: offer.retailerKey || '',
      retailerName: offer.retailerName || '',
      sourceRetailerName: offer.sourceRetailerName || '',
      sourceRetailerFormat: offer.sourceRetailerFormat || '',
      appliesToRetailerFormats: Array.isArray(offer.appliesToRetailerFormats)
        ? offer.appliesToRetailerFormats
        : [],
    },
    sourceKey: sourceKeyOf(offer),
    status: offer.status || '',
    isActiveNow: offer.isActiveNow,
    validFrom: toIsoOrNull(offer.validFrom),
    validTo: toIsoOrNull(offer.validTo),
    officialOrAggregator: sourceClassLabel(sourceQuality),
    freshness: {
      lastSeenAt: toIsoOrNull(offer.lastSeenAt),
      updatedAt: toIsoOrNull(offer.updatedAt),
      createdAt: toIsoOrNull(offer.createdAt),
      publishStatus: offer.publishStatus || '',
      sourceRunStatus: offer.sourceRunStatus || offer.rawFacts?.sourceRunStatus || '',
      lastSeenRunId: offer.lastSeenRunId || '',
      lastSeenSourceRunId: offer.lastSeenSourceRunId || '',
      hasFreshCrawlEvidence: hasFreshCrawlEvidence(offer, now),
      hasCurrentRunFreshnessEvidence: hasCurrentRunFreshnessEvidence(offer, now),
      hasValidityEvidence: sourceQuality.hasValidityEvidence,
      hasDetailEvidence: sourceQuality.hasDetailEvidence,
      sourceClass: sourceQuality.sourceClass,
      sourceTrustLevel: sourceQuality.sourceTrustLevel,
      freshnessConfidence: sourceQuality.freshnessConfidence,
      validityConfidence: sourceQuality.validityConfidence,
      sourceQualityRisk: sourceQuality.sourceQualityRisk || '',
      rawValidityText: String(offer.rawFacts?.validityText || '').slice(0, 160),
      rawValiditySource: String(offer.rawFacts?.validitySource || '').slice(0, 120),
    },
    primaryRejectReason,
    secondaryRejectReasons,
  };
}

async function findCandidateOffers({ retailerKey, OfferModel = Offer }) {
  const match = buildRankingCandidateMatch({
    selectedRetailers: [retailerKey],
    selectedCategories: [],
    unit: 'all',
    onlyWithoutProgram: false,
    query: '',
  });

  return OfferModel.find(match)
    .select(VISIBILITY_DIAGNOSTIC_FIELDS)
    .sort(RANKING_SORT)
    .limit(CANDIDATE_LIMIT)
    .lean();
}

async function buildRetailerVisibilityDiagnostics({
  retailerKey,
  OfferModel = Offer,
  rankingService = { buildOfferRanking },
  now = new Date(),
} = {}) {
  const candidateOffers = await findCandidateOffers({ retailerKey, OfferModel });
  const freshOffers = filterFreshActiveOffers(candidateOffers, now);
  const programEligibleOffers = applyProgramEligibility(freshOffers, {
    programRetailers: [retailerKey],
    onlyWithoutProgram: false,
  });
  const rankingResult = await rankingService.buildOfferRanking({
    retailers: retailerKey,
    programRetailers: retailerKey,
    unit: 'all',
    limit: 'all',
    offset: 0,
  });
  const publicResultCount = Number(rankingResult?.summary?.resultCount || 0);
  const freshIds = new Set(freshOffers.map((offer) => String(offer._id || offer.id || '')));
  const programIds = new Set(programEligibleOffers.map((offer) => String(offer._id || offer.id || '')));
  const rejectReasonCounts = {};
  const rejectExamples = [];
  const rejectExamplesByReason = {};
  const sourceClassCounts = {};
  const sourceKeyCounts = {};

  for (const offer of candidateOffers) {
    const sourceQuality = classifyOfferSourceQuality(offer);
    addCount(sourceClassCounts, sourceQuality.sourceClass);
    addCount(sourceKeyCounts, sourceKeyOf(offer));

    const offerId = String(offer._id || offer.id || '');
    const freshnessReasons = collectFreshnessRejectReasons(offer, now);
    const reasons = [];

    if (!freshIds.has(offerId)) {
      reasons.push(...freshnessReasons);
    } else if (!programIds.has(offerId)) {
      reasons.push('program-eligibility-filter');
    }

    if (reasons.length === 0) {
      continue;
    }

    const primary = reasons[0];
    addCount(rejectReasonCounts, primary);

    const example = buildRejectExample(offer, primary, reasons.slice(1), now);

    if (rejectExamples.length < EXAMPLES_PER_RETAILER) {
      rejectExamples.push(example);
    }

    rejectExamplesByReason[primary] = rejectExamplesByReason[primary] || [];
    if (rejectExamplesByReason[primary].length < EXAMPLES_PER_REASON) {
      rejectExamplesByReason[primary].push(example);
    }
  }

  return {
    retailerKey,
    generatedAt: now.toISOString(),
    candidateCount: candidateOffers.length,
    publicResultCount,
    stageCounts: {
      afterCandidateLoad: candidateOffers.length,
      afterFreshnessFilter: freshOffers.length,
      afterProgramEligibility: programEligibleOffers.length,
      publicResultCount,
    },
    rejectReasonCounts,
    rejectExamples,
    rejectExamplesByReason,
    sourceClassCounts,
    sourceKeyCounts,
  };
}

async function buildPublicVisibilityDiagnostics({
  retailers,
  OfferModel = Offer,
  rankingService = { buildOfferRanking },
  now = new Date(),
} = {}) {
  const retailerKeys = normalizeRetailerList(retailers);
  const items = [];

  for (const retailerKey of retailerKeys) {
    items.push(await buildRetailerVisibilityDiagnostics({
      retailerKey,
      OfferModel,
      rankingService,
      now,
    }));
  }

  return {
    ok: true,
    readOnly: true,
    generatedAt: now.toISOString(),
    allowedRetailers: [...ALLOWED_RETAILERS],
    retailers: items,
  };
}

module.exports = {
  buildPublicVisibilityDiagnostics,
  _private: {
    ALLOWED_RETAILERS,
    CANDIDATE_LIMIT,
    EXAMPLES_PER_REASON,
    EXAMPLES_PER_RETAILER,
    VISIBILITY_DIAGNOSTIC_FIELDS,
    buildRejectExample,
    buildRetailerVisibilityDiagnostics,
    collectFreshnessRejectReasons,
    normalizeRetailerList,
    sourceKeyOf,
  },
};
