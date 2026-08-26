const Offer = require('../../models/Offer');
const Retailer = require('../../models/Retailer');
const Category = require('../../models/Category');
const RetailerCategoryStat = require('../../models/RetailerCategoryStat');
const RetailerCategoryOfferCache = require('../../models/RetailerCategoryOfferCache');
const Source = require('../../models/Source');
const CrawlJob = require('../../models/CrawlJob');
const logger = require('../../lib/logger');
const { sanitizeWhitespace, normalizeTitleForMatch } = require('../crawl/sourceEvidence');
const { computeOfferSavings } = require('../offers/promotionMath');
const { isOfferFreshForActiveUse } = require('../offers/offerFreshness');

const FILTER_METADATA_BULK_BATCH_SIZE = 100;
const FILTER_METADATA_QUERY_MAX_TIME_MS = 15000;
const FILTER_METADATA_CRAWL_JOB_HISTORY_LIMIT = 5000;
const PUBLIC_DISABLED_RETAILER_KEYS = new Set(['eurospar']);
const HOFER_FRESHNESS_WARNING_THRESHOLD_HOURS = 72;
const SPAR_FAMILY_CURRENT_DISCOVERY_MAX_AGE_HOURS = 72;
const PUBLIC_FACET_SNAPSHOT_TTL_MS = 60 * 1000;

let publicFacetSnapshot = null;
let publicFacetSnapshotExpiresAt = 0;
let publicFacetSnapshotPromise = null;
let publicFacetOfferPool = null;
let publicFacetOfferPoolPromise = null;
let publicFacetOfferPoolDateKey = '';
let publicFacetCacheGeneration = 0;
const INTERSPAR_LIMITED_COVERAGE_MESSAGE = 'INTERSPAR derzeit eingeschränkt: Aktuelle Spezialangebote können sichtbar sein; das aktuelle Hauptflugblatt ist derzeit nicht zuverlässig automatisiert verfügbar.';

const FILTER_METADATA_OFFER_SELECT_FIELDS = [
  'retailerKey',
  'retailerName',
  'sourceRetailerName',
  'sourceRetailerFormat',
  'retailerFormats',
  'appliesToRetailerFormats',
  'retailerFormatLabel',
  'sourceId',
  'sourceUrl',
  'offerKey',
  'dedupeKey',
  'title',
  'brand',
  'titleNormalized',
  'offerType',
  'searchText',
  'categoryKey',
  'subcategoryKey',
  'categoryPrimary',
  'categorySecondary',
  'categoryConfidence',
  'subcategoryConfidence',
  'comparisonGroup',
  'validFrom',
  'validTo',
  'status',
  'isActiveNow',
  'isActiveToday',
  'quantityText',
  'packCount',
  'unitValue',
  'unitType',
  'totalComparableAmount',
  'comparableUnit',
  'packageType',
  'conditionsText',
  'discountPercent',
  'discountUpToPercent',
  'promotionScope',
  'appliesToCategory',
  'regionScope',
  'customerProgramRequired',
  'hasConditions',
  'isMultiBuy',
  'effectiveDiscountType',
  'sortScoreDefault',
  'normalizedUnitPrice',
  'priceCurrent',
  'priceReference',
  'priceReferenceSource',
  'priceReferenceConfidence',
  'savingsDisplayType',
  'savingsConfidence',
  'hasReferencePrice',
  'hasProspectNormalPrice',
  'hasEstimatedReferencePrice',
  'isActionPriceOnly',
  'quality',
  'imageUrl',
  'benefitType',
  'rawFacts',
  'supportingSources',
  'sourceType',
  'sourceTypes',
  'evidenceUrls',
  'publishStatus',
  'sourceRunStatus',
  'crawlRunId',
  'crawlJobId',
  'needsReview',
  'reviewReasons',
  'crawlJobId',
  'lastSeenAt',
  'lastSeenRunId',
  'lastSeenSourceRunId',
  'updatedAt',
  'createdAt',
];

const PUBLIC_FACET_OFFER_SELECT_FIELDS = [
  'retailerKey',
  'retailerName',
  'sourceRetailerName',
  'sourceRetailerFormat',
  'retailerFormats',
  'appliesToRetailerFormats',
  'retailerFormatLabel',
  'sourceId',
  'sourceUrl',
  'sourceUrls',
  'evidenceUrls',
  'sourceType',
  'sourceTypes',
  'supportingSources.sourceId',
  'supportingSources.sourceUrl',
  'supportingSources.observedUrl',
  'supportingSources.channel',
  'categoryPrimary',
  'categorySecondary',
  'validFrom',
  'validTo',
  'status',
  'isActiveNow',
  'title',
  'quantityText',
  'unitValue',
  'totalComparableAmount',
  'comparableUnit',
  'conditionsText',
  'customerProgramRequired',
  'priceCurrent.amount',
  'quality.comparisonSafe',
  'quality.parsingConfidence',
  'publishStatus',
  'sourceRunStatus',
  'crawlRunId',
  'crawlJobId',
  'lastSeenAt',
  'lastSeenRunId',
  'lastSeenSourceRunId',
  'updatedAt',
  'createdAt',
  'deactivationReason',
  'rawFacts.sourceType',
  'rawFacts.sourceKey',
  'rawFacts.validityText',
  'rawFacts.infoText',
  'rawFacts.validitySource',
  'rawFacts.validFrom',
  'rawFacts.validTo',
  'rawFacts.clickoutUrl',
  'rawFacts.leafletHref',
  'rawFacts.hoferAvailabilityEvidence',
  'rawFacts.stateAvailableText',
  'rawFacts.availabilityText',
  'rawFacts.freshnessTtlHours',
  'rawFacts.snapshotCurrent',
  'rawFacts.sourceRunStatus',
  'rawFacts.sourceId',
  'rawFacts.crawlRunId',
  'rawFacts.sourceRunId',
  'rawFacts.lastSeenSourceRunId',
  'rawFacts.crawlJobId',
  'rawFacts.dryRun',
  'rawFacts.retainedPreviousData',
  'rawFacts.retained',
  'rawFacts.retainedGraceHours',
  'rawFacts.explicitExpired',
  'rawFacts.conditionsText',
  'rawFacts.loyaltyTags',
];

function withFilterMetadataMaxTime(query) {
  return query && typeof query.maxTimeMS === 'function'
    ? query.maxTimeMS(FILTER_METADATA_QUERY_MAX_TIME_MS)
    : query;
}

function getViennaDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((result, part) => ({
    ...result,
    [part.type]: part.value,
  }), {});

  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

function buildFilterMetadataOfferMatch() {
  return {
    $or: [
      { status: 'active', isActiveNow: true },
      {
        retailerKey: 'hofer',
        status: 'upcoming',
        isActiveNow: false,
        $or: [
          { sourceType: 'hofer-official-html' },
          { 'rawFacts.sourceType': 'hofer-official-html' },
          { 'rawFacts.sourceKey': 'hofer-official-html' },
        ],
      },
    ],
  };
}

async function readPublicFacetOffers() {
  const generation = publicFacetCacheGeneration;
  const dateKey = getViennaDateKey(new Date());
  const offers = await withFilterMetadataMaxTime(
    Offer.find(buildFilterMetadataOfferMatch())
      .select(PUBLIC_FACET_OFFER_SELECT_FIELDS.join(' '))
  ).lean();

  if (generation === publicFacetCacheGeneration) {
    publicFacetOfferPool = offers;
    publicFacetOfferPoolDateKey = dateKey;
  }

  return offers;
}

async function getPublicFacetOfferPool() {
  const currentDateKey = getViennaDateKey(new Date());
  if (publicFacetOfferPool && publicFacetOfferPoolDateKey === currentDateKey) {
    return publicFacetOfferPool;
  }
  if (publicFacetOfferPoolDateKey !== currentDateKey) {
    publicFacetOfferPool = null;
  }
  if (publicFacetOfferPoolPromise) return publicFacetOfferPoolPromise;

  const promise = readPublicFacetOffers();
  publicFacetOfferPoolPromise = promise;

  try {
    return await promise;
  } finally {
    if (publicFacetOfferPoolPromise === promise) {
      publicFacetOfferPoolPromise = null;
    }
  }
}

async function readPublicFacetSnapshot() {
  const startedAt = Date.now();
  const now = new Date();
  const [offers, existingRetailers, sources] = await Promise.all([
    getPublicFacetOfferPool(),
    withFilterMetadataMaxTime(
      Retailer.find({ retailerKey: { $nin: [...PUBLIC_DISABLED_RETAILER_KEYS] } })
        .select('retailerKey retailerName offerCount activeOfferCount firstSeenAt lastSeenAt lastSuccessfulCrawlAt isActive sortOrder')
    ).lean(),
    withFilterMetadataMaxTime(
      Source.find({
        retailerKey: { $in: ['spar', 'interspar'] },
        parserHint: 'spar-family-flyer-discovery',
        'crawlPolicy.currentDiscovery': true,
      })
        .select('_id retailerKey retailerName sourceRetailerName sourceRetailerFormat appliesToRetailerFormats retailerFormatLabel label channel sourceUrl active enabled disabledReason notes latestRunAt latestStatus parserHint crawlPolicy')
    ).lean(),
  ]);

  const activityCache = new WeakMap();
  const snapshot = {
    now,
    offers,
    retailers: buildRetailerDocuments(existingRetailers, offers, now, sources, [], activityCache),
    categories: buildCategoryDocuments(offers, now, activityCache),
    retailerCategoryStats: buildRetailerCategoryStatDocuments(offers, now, activityCache),
    sources,
  };

  logger.info('Public facet snapshot built', {
    durationMs: Date.now() - startedAt,
    offerCount: offers.length,
    retailerCount: snapshot.retailers.length,
    categoryCount: snapshot.categories.length,
  });

  return snapshot;
}

async function getPublicFacetSnapshot() {
  const now = Date.now();

  if (publicFacetSnapshot && publicFacetSnapshotExpiresAt > now) {
    return publicFacetSnapshot;
  }

  if (!publicFacetSnapshotPromise) {
    const generation = publicFacetCacheGeneration;
    const promise = readPublicFacetSnapshot()
      .then((snapshot) => {
        if (generation === publicFacetCacheGeneration) {
          publicFacetSnapshot = snapshot;
          publicFacetSnapshotExpiresAt = Date.now() + PUBLIC_FACET_SNAPSHOT_TTL_MS;
        }
        return snapshot;
      })
      .finally(() => {
        if (publicFacetSnapshotPromise === promise) {
          publicFacetSnapshotPromise = null;
        }
      });
    publicFacetSnapshotPromise = promise;
  }

  return publicFacetSnapshotPromise;
}

function warmPublicFacetSnapshot() {
  return getPublicFacetSnapshot();
}

function clearPublicFacetCache() {
  publicFacetCacheGeneration += 1;
  publicFacetSnapshot = null;
  publicFacetSnapshotExpiresAt = 0;
  publicFacetSnapshotPromise = null;
  publicFacetOfferPool = null;
  publicFacetOfferPoolPromise = null;
  publicFacetOfferPoolDateKey = '';
}

function normalizeFilterKey(value, fallback = 'unknown') {
  const normalized = normalizeTitleForMatch(value).replace(/\s+/g, '-');
  return normalized || fallback;
}

function normalizeRetailerKey({ retailerKey, retailerName }) {
  return normalizeFilterKey(retailerKey || retailerName, 'unknown-retailer');
}

function isPublicRetailerEnabled(retailerKey) {
  return !PUBLIC_DISABLED_RETAILER_KEYS.has(String(retailerKey || '').trim().toLowerCase());
}

function formatAustrianShortDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }

  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
  ].join('.');
}

function getMostRecentActiveSourceSeenAt(retailer = {}) {
  return (retailer.offersBySource || [])
    .filter((source) => Number(source?.activeOfferCount || 0) > 0)
    .map((source) => source?.lastSeenAt)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0] || null;
}

function buildRetailerFreshnessWarning(retailer = {}, now = new Date()) {
  const retailerKey = String(retailer.retailerKey || '').trim().toLowerCase();

  if (retailerKey !== 'hofer') {
    return null;
  }

  const lastConfirmedAt = getMostRecentActiveSourceSeenAt(retailer);
  const ageHours = lastConfirmedAt
    ? (now.getTime() - lastConfirmedAt.getTime()) / (1000 * 60 * 60)
    : Infinity;
  const hasRepeatedErrors = (retailer.coverageGapReasons || []).some((reason) => /wiederholte crawl-fehler/i.test(String(reason || '')));
  const staleEnough = !Number.isFinite(ageHours) || ageHours > HOFER_FRESHNESS_WARNING_THRESHOLD_HOURS;

  if (!staleEnough && !hasRepeatedErrors) {
    return null;
  }

  const lastConfirmedDate = formatAustrianShortDate(lastConfirmedAt);

  return {
    active: true,
    type: 'freshness',
    severity: staleEnough ? 'warning' : 'info',
    thresholdHours: HOFER_FRESHNESS_WARNING_THRESHOLD_HOURS,
    lastConfirmedAt: lastConfirmedAt ? lastConfirmedAt.toISOString() : null,
    lastConfirmedDate,
    message: lastConfirmedDate
      ? `Aktualitaet eingeschraenkt - letzter bestaetigter Stand ${lastConfirmedDate}.`
      : 'Aktualitaet eingeschraenkt.',
  };
}

function withPublicFreshnessWarning(retailer = {}, now = new Date()) {
  const freshnessWarning = buildRetailerFreshnessWarning(retailer, now);

  return freshnessWarning
    ? { ...retailer, freshnessWarning }
    : retailer;
}

function isFreshSuccessfulCurrentDiscovery(source = {}, now = new Date()) {
  const latestRunAt = source.latestRunAt ? new Date(source.latestRunAt) : null;
  const ageHours = latestRunAt && !Number.isNaN(latestRunAt.getTime())
    ? (now.getTime() - latestRunAt.getTime()) / (1000 * 60 * 60)
    : Infinity;

  return source.enabled !== false
    && source.active !== false
    && source.parserHint === 'spar-family-flyer-discovery'
    && source.crawlPolicy?.currentDiscovery === true
    && source.latestStatus === 'success'
    && ageHours >= 0
    && ageHours <= SPAR_FAMILY_CURRENT_DISCOVERY_MAX_AGE_HOURS;
}

function buildCurrentDiscoverySourceLookup(sources = []) {
  return new Map((sources || []).map((source) => [
    String(source.retailerKey || '').trim().toLowerCase(),
    source,
  ]));
}

function shouldExposePublicRetailer(retailer = {}, currentDiscoverySources = new Map(), now = new Date()) {
  const retailerKey = String(retailer.retailerKey || '').trim().toLowerCase();

  if (retailerKey !== 'spar') {
    return true;
  }

  return isFreshSuccessfulCurrentDiscovery(currentDiscoverySources.get(retailerKey), now);
}

function withPublicRetailerTrustMetadata(retailer = {}, currentDiscoverySources = new Map(), now = new Date()) {
  const publicRetailer = withPublicFreshnessWarning(retailer, now);
  const retailerKey = String(retailer.retailerKey || '').trim().toLowerCase();

  if (
    retailerKey !== 'interspar'
    || isFreshSuccessfulCurrentDiscovery(currentDiscoverySources.get(retailerKey), now)
  ) {
    return publicRetailer;
  }

  return {
    ...publicRetailer,
    coverageStatus: 'gap',
    limitedCoverage: true,
    currentFlyerUnavailable: true,
    officialDigitalSourceUnavailable: true,
    publicTrustWarning: {
      active: true,
      type: 'coverage',
      severity: 'warning',
      scope: 'special-offers-only',
      message: INTERSPAR_LIMITED_COVERAGE_MESSAGE,
    },
  };
}

function normalizeCategoryKey(value, fallback = 'unkategorisiert') {
  return normalizeFilterKey(value, fallback);
}

function cleanRetailerName(value, fallback) {
  return sanitizeWhitespace(value) || fallback;
}

function cleanCategoryLabel(value, fallback = 'Unkategorisiert') {
  return sanitizeWhitespace(value) || fallback;
}

function cleanSubcategoryLabel(mainCategoryLabel, subcategoryLabel) {
  const main = normalizeCategoryKey(mainCategoryLabel, '');
  const sub = normalizeCategoryKey(subcategoryLabel, '');

  if (!sub || sub === main) {
    return '';
  }

  return sanitizeWhitespace(subcategoryLabel);
}

function getOfferLastSeenAt(offer) {
  return offer.updatedAt || offer.createdAt || offer.validTo || offer.validFrom || new Date();
}

function buildCacheRawFacts(rawFacts = {}) {
  const compact = {
    sourceType: rawFacts?.sourceType || '',
    sourceKey: rawFacts?.sourceKey || '',
    validityText: rawFacts?.validityText || '',
    infoText: rawFacts?.infoText || '',
    discountPercentage: rawFacts?.discountPercentage ?? null,
    discountPercent: rawFacts?.discountPercent ?? null,
    discountScope: rawFacts?.discountScope || '',
    discountLevel: rawFacts?.discountLevel || '',
    isCampaignDiscount: rawFacts?.isCampaignDiscount ?? null,
    discountAppliesToProduct: rawFacts?.discountAppliesToProduct ?? null,
    referencePriceType: rawFacts?.referencePriceType || '',
    referencePriceSource: rawFacts?.referencePriceSource || '',
    referencePriceDerived: rawFacts?.referencePriceDerived ?? null,
    minimalAcceptance: rawFacts?.minimalAcceptance ?? null,
    minimumPurchaseQuantity: rawFacts?.minimumPurchaseQuantity ?? null,
    requiredQuantity: rawFacts?.requiredQuantity ?? null,
    snapshotCurrent: Boolean(rawFacts?.snapshotCurrent),
    savingsDisplayType: rawFacts?.savingsDisplayType || '',
    hasProspectNormalPrice: rawFacts?.hasProspectNormalPrice ?? null,
    hasEstimatedReferencePrice: rawFacts?.hasEstimatedReferencePrice ?? null,
    isActionPriceOnly: rawFacts?.isActionPriceOnly ?? null,
    categoryConfidence: rawFacts?.categoryConfidence ?? null,
    subcategoryConfidence: rawFacts?.subcategoryConfidence ?? null,
    sourceRetailerName: rawFacts?.sourceRetailerName || '',
    sourceRetailerFormat: rawFacts?.sourceRetailerFormat || '',
    retailerFormatLabel: rawFacts?.retailerFormatLabel || '',
    appliesToRetailerFormats: rawFacts?.appliesToRetailerFormats || [],
    discountUpToPercent: rawFacts?.discountUpToPercent ?? null,
    promotionScope: rawFacts?.promotionScope || '',
    appliesToCategory: rawFacts?.appliesToCategory || '',
    regionScope: rawFacts?.regionScope || '',
  };

  return Object.fromEntries(
    Object.entries(compact).filter(([, value]) => value !== '' && value !== null && value !== undefined && value !== false)
  );
}

function isOfferActive(offer, now = new Date(), activityCache = null) {
  // Facets must use exactly the same strict public contract as ranking.
  // A weaker source-level fallback can advertise retailers/categories that
  // the public ranking correctly excludes.
  if (activityCache?.has(offer)) return activityCache.get(offer);

  const active = isOfferFreshForActiveUse(offer, now);
  activityCache?.set(offer, active);
  return active;
}

const RETAILER_ACTIVE_COVERAGE_TARGETS = {
  hofer: 60,
  lidl: 100,
  spar: 80,
  eurospar: 55,
  interspar: 55,
  billa: 90,
  'billa-plus': 90,
  penny: 40,
  adeg: 35,
  dm: 35,
  bipa: 45,
  mueller: 45,
};

function getRetailerCoverageTarget(retailerKey) {
  return RETAILER_ACTIVE_COVERAGE_TARGETS[retailerKey] || 25;
}

function createRetailerCoverageDraft(retailerKey, retailerName, existingRetailer = {}) {
  return {
    retailerKey,
    retailerName: cleanRetailerName(retailerName, retailerKey),
    offerCount: 0,
    activeOfferCount: 0,
    totalOffers: 0,
    activeOffers: 0,
    offersBySource: new Map(),
    offersByChannel: new Map(),
    firstSeenAt: existingRetailer.firstSeenAt || null,
    lastSeenAt: existingRetailer.lastSeenAt || null,
    lastSuccessfulCrawlAt: existingRetailer.lastSuccessfulCrawlAt || null,
    isActive: typeof existingRetailer.isActive === 'boolean' ? existingRetailer.isActive : false,
    sortOrder: Number(existingRetailer.sortOrder || 0),
    sourceIds: new Set(),
    channels: new Set(),
    parsingConfidenceSum: 0,
    parsingConfidenceCount: 0,
    activeComparisonSafeCount: 0,
    activeUsableOfferCount: 0,
    recentSuccessfulCrawlCount: 0,
    recentFailedCrawlCount: 0,
    repeatedLowYield: false,
    crawlStabilityScore: 0,
    coverageGapReasons: [],
    coveragePriorityScore: 0,
    activeCoverageSignal: 'empty',
    coverageStatus: 'gap',
    activeCoverageTarget: getRetailerCoverageTarget(retailerKey),
    activeCoverageRatio: 0,
    sourceDiversity: 0,
    channelDiversity: 0,
    parsingConfidenceAverage: 0,
    comparisonSafeShare: 0,
    usableOfferShare: 0,
  };
}

function registerSourceContribution(retailer, sourceKey, sourceMeta, isActive, lastSeenAt) {
  if (!sourceKey) {
    return;
  }

  if (!retailer.offersBySource.has(sourceKey)) {
    retailer.offersBySource.set(sourceKey, {
      sourceId: sourceMeta.sourceId || null,
      label: sourceMeta.label || sourceMeta.sourceUrl || sourceKey,
      channel: sourceMeta.channel || '',
      offerCount: 0,
      activeOfferCount: 0,
      lastSeenAt: lastSeenAt || null,
    });
  }

  const current = retailer.offersBySource.get(sourceKey);
  current.offerCount += 1;
  current.activeOfferCount += isActive ? 1 : 0;

  if (lastSeenAt && (!current.lastSeenAt || lastSeenAt > current.lastSeenAt)) {
    current.lastSeenAt = lastSeenAt;
  }

  if (current.sourceId) {
    retailer.sourceIds.add(String(current.sourceId));
  } else {
    retailer.sourceIds.add(sourceKey);
  }

  if (current.channel) {
    retailer.channels.add(current.channel);
  }
}

function registerChannelContribution(retailer, channel, isActive) {
  const normalizedChannel = sanitizeWhitespace(channel || 'other') || 'other';

  if (!retailer.offersByChannel.has(normalizedChannel)) {
    retailer.offersByChannel.set(normalizedChannel, {
      channel: normalizedChannel,
      offerCount: 0,
      activeOfferCount: 0,
    });
  }

  const current = retailer.offersByChannel.get(normalizedChannel);
  current.offerCount += 1;
  current.activeOfferCount += isActive ? 1 : 0;
}

function buildRetailerCoverageReasons(retailer, recentJobs) {
  const reasons = [];
  const dominantSource = retailer.offersBySource[0] || null;
  const now = new Date();
  const hoursSinceSuccessfulCrawl = retailer.lastSuccessfulCrawlAt
    ? (now.getTime() - retailer.lastSuccessfulCrawlAt.getTime()) / (1000 * 60 * 60)
    : Infinity;

  if (retailer.activeOffers === 0) {
    reasons.push('keine aktiven Offers erfasst');
  } else if (retailer.activeCoverageRatio < 0.6) {
    reasons.push('aktive Abdeckung deutlich unter Zielwert');
  } else if (retailer.activeCoverageRatio < 1) {
    reasons.push('aktive Abdeckung nur mittelmaessig');
  }

  if (retailer.sourceDiversity <= 1 && retailer.activeOffers > 0) {
    reasons.push('aktive Abdeckung haengt an nur einer Quelle');
  }

  if (dominantSource && retailer.activeOffers > 0 && dominantSource.activeOfferCount / retailer.activeOffers >= 0.75) {
    reasons.push('starke Abhaengigkeit von einer einzelnen Quelle');
  }

  if (retailer.totalOffers >= Math.max(20, retailer.activeCoverageTarget) && retailer.activeOffers <= Math.max(5, Math.round(retailer.totalOffers * 0.2))) {
    reasons.push('viele Gesamtangebote, aber sehr wenige aktive Offers');
  }

  if (!Number.isFinite(hoursSinceSuccessfulCrawl) || hoursSinceSuccessfulCrawl > 72) {
    reasons.push('kein frischer erfolgreicher Crawl');
  }

  if (retailer.recentFailedCrawlCount >= 2) {
    reasons.push('wiederholte Crawl-Fehler');
  }

  if (retailer.repeatedLowYield) {
    reasons.push('wiederholt niedrige Crawl-Ausbeute');
  }

  if (recentJobs.length === 0) {
    reasons.push('keine aktuellen Crawl-Runs vorhanden');
  }

  return reasons;
}

function finalizeRetailerCoverage(retailer, recentJobs) {
  retailer.offerCount = retailer.totalOffers;
  retailer.activeOfferCount = retailer.activeOffers;
  retailer.isActive = retailer.activeOffers > 0;
  retailer.sourceDiversity = retailer.sourceIds.size;
  retailer.channelDiversity = retailer.channels.size;
  retailer.parsingConfidenceAverage = retailer.parsingConfidenceCount > 0
    ? Number((retailer.parsingConfidenceSum / retailer.parsingConfidenceCount).toFixed(3))
    : 0;
  retailer.comparisonSafeShare = retailer.activeOffers > 0
    ? Number((retailer.activeComparisonSafeCount / retailer.activeOffers).toFixed(3))
    : 0;
  retailer.usableOfferShare = retailer.activeOffers > 0
    ? Number((retailer.activeUsableOfferCount / retailer.activeOffers).toFixed(3))
    : 0;
  retailer.activeCoverageRatio = retailer.activeCoverageTarget > 0
    ? Number((retailer.activeOffers / retailer.activeCoverageTarget).toFixed(3))
    : 0;
  retailer.offersBySource = [...retailer.offersBySource.values()]
    .sort((left, right) => {
      if (right.activeOfferCount !== left.activeOfferCount) {
        return right.activeOfferCount - left.activeOfferCount;
      }

      if (right.offerCount !== left.offerCount) {
        return right.offerCount - left.offerCount;
      }

      return String(left.label || '').localeCompare(String(right.label || ''), 'de');
    });
  retailer.offersByChannel = [...retailer.offersByChannel.values()]
    .sort((left, right) => {
      if (right.activeOfferCount !== left.activeOfferCount) {
        return right.activeOfferCount - left.activeOfferCount;
      }

      return String(left.channel || '').localeCompare(String(right.channel || ''), 'de');
    });

  if (retailer.activeOffers === 0) {
    retailer.activeCoverageSignal = 'empty';
  } else if (retailer.activeCoverageRatio >= 1 && retailer.sourceDiversity >= 2) {
    retailer.activeCoverageSignal = 'strong';
  } else if (retailer.activeCoverageRatio >= 0.6) {
    retailer.activeCoverageSignal = 'medium';
  } else {
    retailer.activeCoverageSignal = 'weak';
  }

  const consideredRuns = recentJobs.length;
  retailer.crawlStabilityScore = consideredRuns > 0
    ? Number((retailer.recentSuccessfulCrawlCount / consideredRuns).toFixed(3))
    : 0;

  retailer.coverageGapReasons = buildRetailerCoverageReasons(retailer, recentJobs);

  if (
    retailer.activeCoverageSignal === 'strong'
    && retailer.crawlStabilityScore >= 0.66
    && retailer.coverageGapReasons.length === 0
  ) {
    retailer.coverageStatus = 'trusted';
  } else if (retailer.activeCoverageSignal === 'empty' || retailer.activeCoverageSignal === 'weak') {
    retailer.coverageStatus = 'gap';
  } else {
    retailer.coverageStatus = 'watch';
  }

  retailer.coveragePriorityScore = [
    retailer.activeCoverageSignal === 'empty' ? 60 : 0,
    retailer.activeCoverageSignal === 'weak' ? 40 : 0,
    retailer.activeCoverageSignal === 'medium' ? 15 : 0,
    retailer.sourceDiversity <= 1 ? 20 : 0,
    retailer.recentFailedCrawlCount >= 2 ? 15 : 0,
    retailer.repeatedLowYield ? 15 : 0,
    retailer.lastSuccessfulCrawlAt ? ((Date.now() - retailer.lastSuccessfulCrawlAt.getTime()) > 72 * 60 * 60 * 1000 ? 10 : 0) : 15,
    retailer.activeCoverageRatio < 0.35 ? 15 : 0,
  ].reduce((sum, value) => sum + value, 0);

  delete retailer.sourceIds;
  delete retailer.channels;
  delete retailer.parsingConfidenceSum;
  delete retailer.parsingConfidenceCount;
  delete retailer.activeComparisonSafeCount;
  delete retailer.activeUsableOfferCount;

  return retailer;
}

function buildRetailerDocuments(existingRetailers, offers, now, sources, crawlJobs, activityCache = null) {
  const retailers = new Map();
  const sourceLookup = new Map(
    sources.map((source) => [
      String(source._id),
      {
        sourceId: source._id,
        label: sanitizeWhitespace(source.label),
        channel: sanitizeWhitespace(source.channel),
        sourceUrl: sanitizeWhitespace(source.sourceUrl),
      },
    ])
  );
  const crawlJobsByRetailer = crawlJobs.reduce((accumulator, job) => {
    const retailerKey = normalizeRetailerKey(job);

    if (!accumulator.has(retailerKey)) {
      accumulator.set(retailerKey, []);
    }

    accumulator.get(retailerKey).push(job);
    return accumulator;
  }, new Map());

  for (const retailer of existingRetailers) {
    const retailerKey = normalizeRetailerKey(retailer);

    retailers.set(
      retailerKey,
      createRetailerCoverageDraft(retailerKey, retailer.retailerName, retailer)
    );
  }

  for (const source of sources) {
    const retailerKey = normalizeRetailerKey(source);

    if (!retailers.has(retailerKey)) {
      retailers.set(
        retailerKey,
        createRetailerCoverageDraft(retailerKey, source.retailerName)
      );
    }
  }

  for (const offer of offers) {
    const retailerKey = normalizeRetailerKey(offer);
    const retailerName = cleanRetailerName(offer.retailerName, retailerKey);
    const isActive = isOfferActive(offer, now, activityCache);
    const lastSeenAt = getOfferLastSeenAt(offer);

    if (!retailers.has(retailerKey)) {
      retailers.set(retailerKey, createRetailerCoverageDraft(retailerKey, retailerName));
    }

    const current = retailers.get(retailerKey);
    current.totalOffers += 1;
    current.activeOffers += isActive ? 1 : 0;
    current.firstSeenAt = !current.firstSeenAt || lastSeenAt < current.firstSeenAt ? lastSeenAt : current.firstSeenAt;

    if (!current.retailerName || !current.lastSeenAt || lastSeenAt >= current.lastSeenAt) {
      current.retailerName = retailerName;
    }

    if (!current.lastSeenAt || lastSeenAt > current.lastSeenAt) {
      current.lastSeenAt = lastSeenAt;
    }

    current.parsingConfidenceSum += Number(offer?.quality?.parsingConfidence || 0);
    current.parsingConfidenceCount += 1;
    current.activeComparisonSafeCount += isActive && Boolean(offer?.quality?.comparisonSafe) ? 1 : 0;
    current.activeUsableOfferCount += (
      isActive
      && Boolean(offer?.quality?.comparisonSafe)
      && Boolean(offer?.priceCurrent?.amount)
    ) ? 1 : 0;

    const sourceMeta = sourceLookup.get(String(offer.sourceId || '')) || {
      sourceId: offer.sourceId || null,
      label: sanitizeWhitespace(offer.sourceUrl || ''),
      channel: '',
      sourceUrl: sanitizeWhitespace(offer.sourceUrl || ''),
    };

    registerSourceContribution(
      current,
      String(sourceMeta.sourceId || sourceMeta.sourceUrl || offer.sourceId || offer.sourceUrl || ''),
      sourceMeta,
      isActive,
      lastSeenAt
    );
    registerChannelContribution(current, sourceMeta.channel || 'other', isActive);

    for (const evidence of offer.supportingSources || []) {
      const evidenceSourceKey = String(evidence.sourceId || evidence.sourceUrl || evidence.observedUrl || '');

      if (evidenceSourceKey) {
        current.sourceIds.add(evidenceSourceKey);
      }

      if (evidence.channel) {
        current.channels.add(evidence.channel);
      }
    }
  }

  for (const [retailerKey, retailer] of retailers.entries()) {
    const recentJobs = (crawlJobsByRetailer.get(retailerKey) || [])
      .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
      .slice(0, 8);

    retailer.lastSuccessfulCrawlAt = recentJobs
      .filter((job) => ['success', 'partial'].includes(job.status) && job.finishedAt)
      .map((job) => job.finishedAt)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || retailer.lastSuccessfulCrawlAt;
    retailer.recentSuccessfulCrawlCount = recentJobs.filter((job) => ['success', 'partial'].includes(job.status)).length;
    retailer.recentFailedCrawlCount = recentJobs.filter((job) => job.status === 'failed').length;
    retailer.repeatedLowYield = recentJobs
      .filter((job) => ['success', 'partial'].includes(job.status))
      .filter((job) => Number(job?.stats?.offersStored || 0) < Math.max(5, Math.round(retailer.activeCoverageTarget * 0.2)))
      .length >= 2;

    finalizeRetailerCoverage(retailer, recentJobs);
  }

  return [...retailers.values()].sort((left, right) => {
    if (right.coveragePriorityScore !== left.coveragePriorityScore) {
      return right.coveragePriorityScore - left.coveragePriorityScore;
    }

    return left.retailerName.localeCompare(right.retailerName, 'de');
  });
}

function buildCategoryDocuments(offers, now, activityCache = null) {
  const categories = new Map();

  for (const offer of offers) {
    const mainCategoryLabel = cleanCategoryLabel(offer.categoryPrimary);
    const mainCategoryKey = normalizeCategoryKey(mainCategoryLabel);
    const subcategoryLabel = cleanSubcategoryLabel(mainCategoryLabel, offer.categorySecondary);
    const subcategoryKey = subcategoryLabel ? normalizeCategoryKey(subcategoryLabel) : '';
    const isActive = isOfferActive(offer, now, activityCache);
    const lastSeenAt = getOfferLastSeenAt(offer);

    if (!categories.has(mainCategoryKey)) {
      categories.set(mainCategoryKey, {
        mainCategoryKey,
        mainCategoryLabel,
        offerCount: 0,
        subcategories: new Map(),
        lastSeenAt,
        isActive: false,
      });
    }

    const category = categories.get(mainCategoryKey);
    category.offerCount += isActive ? 1 : 0;
    category.isActive = category.offerCount > 0;

    if (lastSeenAt > category.lastSeenAt) {
      category.lastSeenAt = lastSeenAt;
      category.mainCategoryLabel = mainCategoryLabel;
    }

    if (!subcategoryKey) {
      continue;
    }

    if (!category.subcategories.has(subcategoryKey)) {
      category.subcategories.set(subcategoryKey, {
        subcategoryKey,
        subcategoryLabel,
        offerCount: 0,
        lastSeenAt,
      });
    }

    const subcategory = category.subcategories.get(subcategoryKey);
    subcategory.offerCount += isActive ? 1 : 0;

    if (lastSeenAt > subcategory.lastSeenAt) {
      subcategory.lastSeenAt = lastSeenAt;
      subcategory.subcategoryLabel = subcategoryLabel;
    }
  }

  return [...categories.values()]
    .map((category) => ({
      mainCategoryKey: category.mainCategoryKey,
      mainCategoryLabel: category.mainCategoryLabel,
      offerCount: category.offerCount,
      subcategories: [...category.subcategories.values()]
        .filter((subcategory) => subcategory.offerCount > 0)
        .sort((left, right) => {
          if (right.offerCount !== left.offerCount) {
            return right.offerCount - left.offerCount;
          }

          return left.subcategoryLabel.localeCompare(right.subcategoryLabel, 'de');
        })
        .map(({ subcategoryKey, subcategoryLabel, offerCount }) => ({
          subcategoryKey,
          subcategoryLabel,
          offerCount,
        })),
      lastSeenAt: category.lastSeenAt,
      isActive: category.offerCount > 0,
    }))
    .sort((left, right) => left.mainCategoryLabel.localeCompare(right.mainCategoryLabel, 'de'));
}

function buildRetailerCategoryStatDocuments(offers, now, activityCache = null) {
  const stats = new Map();

  for (const offer of offers) {
    const retailerKey = normalizeRetailerKey(offer);
    const mainCategoryLabel = cleanCategoryLabel(offer.categoryPrimary);
    const mainCategoryKey = normalizeCategoryKey(mainCategoryLabel);
    const subcategoryLabel = cleanSubcategoryLabel(mainCategoryLabel, offer.categorySecondary);
    const subcategoryKey = subcategoryLabel ? normalizeCategoryKey(subcategoryLabel) : '';
    const lastSeenAt = getOfferLastSeenAt(offer);
    const isActive = isOfferActive(offer, now, activityCache);
    const statKey = [retailerKey, mainCategoryKey, subcategoryKey].join('::');

    if (!stats.has(statKey)) {
      stats.set(statKey, {
        retailerKey,
        mainCategoryKey,
        mainCategoryLabel,
        subcategoryKey,
        subcategoryLabel,
        offerCount: 0,
        activeOfferCount: 0,
        lastSeenAt,
      });
    }

    const current = stats.get(statKey);
    current.offerCount += 1;
    current.activeOfferCount += isActive ? 1 : 0;

    if (lastSeenAt > current.lastSeenAt) {
      current.lastSeenAt = lastSeenAt;
      current.mainCategoryLabel = mainCategoryLabel;
      current.subcategoryLabel = subcategoryLabel;
    }
  }

  return [...stats.values()].sort((left, right) => {
    if (left.retailerKey !== right.retailerKey) {
      return left.retailerKey.localeCompare(right.retailerKey, 'de');
    }

    if (left.mainCategoryLabel !== right.mainCategoryLabel) {
      return left.mainCategoryLabel.localeCompare(right.mainCategoryLabel, 'de');
    }

    return left.subcategoryLabel.localeCompare(right.subcategoryLabel, 'de');
  });
}

function buildOfferCacheDocuments(offers, now) {
  const caches = new Map();

  for (const offer of offers) {
    if (!isOfferActive(offer, now)) {
      continue;
    }

    const retailerKey = normalizeRetailerKey(offer);
    const retailerName = cleanRetailerName(offer.retailerName, retailerKey);
    const mainCategoryLabel = cleanCategoryLabel(offer.categoryPrimary);
    const mainCategoryKey = normalizeCategoryKey(mainCategoryLabel);
    const subcategoryLabel = cleanSubcategoryLabel(mainCategoryLabel, offer.categorySecondary);
    const subcategoryKey = subcategoryLabel ? normalizeCategoryKey(subcategoryLabel) : '';
    const lastSeenAt = getOfferLastSeenAt(offer);
    const cacheKey = [retailerKey, mainCategoryKey, subcategoryKey].join('::');
    const savings = computeOfferSavings(offer);

    if (!caches.has(cacheKey)) {
      caches.set(cacheKey, {
        retailerKey,
        retailerName,
        mainCategoryKey,
        mainCategoryLabel,
        subcategoryKey,
        subcategoryLabel,
        offerCount: 0,
        activeOfferCount: 0,
        lastSeenAt,
        offers: [],
      });
    }

    const current = caches.get(cacheKey);
    current.offerCount += 1;
    current.activeOfferCount += 1;

    if (lastSeenAt > current.lastSeenAt) {
      current.lastSeenAt = lastSeenAt;
    }

    current.offers.push({
      id: String(offer._id),
      offerKey: offer.offerKey || '',
      dedupeKey: offer.dedupeKey || '',
      retailerKey,
      retailerName,
      sourceRetailerName: offer.sourceRetailerName || '',
      sourceRetailerFormat: offer.sourceRetailerFormat || '',
      retailerFormats: offer.retailerFormats || [],
      appliesToRetailerFormats: offer.appliesToRetailerFormats || [],
      retailerFormatLabel: offer.retailerFormatLabel || '',
      title: offer.title,
      titleNormalized: offer.titleNormalized || '',
      brand: offer.brand || '',
      offerType: offer.offerType || 'product',
      searchText: offer.searchText || [offer.title, offer.brand, mainCategoryLabel, subcategoryLabel, retailerName].filter(Boolean).join(' '),
      categoryPrimary: mainCategoryLabel,
      categorySecondary: subcategoryLabel || '',
      categoryKey: offer.categoryKey || mainCategoryKey,
      subcategoryKey: offer.subcategoryKey || subcategoryKey,
      categoryConfidence: Number(offer.categoryConfidence || 0),
      subcategoryConfidence: Number(offer.subcategoryConfidence || 0),
      quantityText: offer.quantityText || '',
      conditionsText: offer.conditionsText || '',
      discountPercent: offer.discountPercent ?? null,
      discountUpToPercent: offer.discountUpToPercent ?? null,
      promotionScope: offer.promotionScope || '',
      appliesToCategory: offer.appliesToCategory || '',
      regionScope: offer.regionScope || '',
      customerProgramRequired: Boolean(offer.customerProgramRequired),
      hasConditions: Boolean(offer.hasConditions),
      isMultiBuy: Boolean(offer.isMultiBuy),
      effectiveDiscountType: offer.effectiveDiscountType || 'unknown',
      comparisonGroup: offer.comparisonGroup || '',
      status: offer.status || 'unknown',
      isActiveNow: Boolean(offer.isActiveNow),
      isActiveToday: Boolean(offer.isActiveToday),
      sortScoreDefault: Number(offer.sortScoreDefault || 0),
      quality: {
        comparisonSafe: Boolean(offer?.quality?.comparisonSafe),
        parsingConfidence: Number(offer?.quality?.parsingConfidence || 0),
        completenessScore: Number(offer?.quality?.completenessScore || 0),
      },
      validFrom: offer.validFrom || null,
      validTo: offer.validTo || null,
      packCount: offer.packCount ?? null,
      unitValue: offer.unitValue ?? null,
      unitType: offer.unitType || '',
      totalComparableAmount: offer.totalComparableAmount ?? null,
      comparableUnit: offer.comparableUnit || '',
      packageType: offer.packageType || '',
      normalizedUnitPrice: offer.normalizedUnitPrice || {},
      priceCurrent: offer.priceCurrent || {},
      priceReference: offer.priceReference || {},
      priceReferenceSource: offer.priceReferenceSource || '',
      priceReferenceConfidence: Number(offer.priceReferenceConfidence || 0),
      savingsDisplayType: offer.savingsDisplayType || '',
      savingsConfidence: Number(offer.savingsConfidence || 0),
      hasReferencePrice: Boolean(offer.hasReferencePrice),
      hasProspectNormalPrice: Boolean(offer.hasProspectNormalPrice),
      hasEstimatedReferencePrice: Boolean(offer.hasEstimatedReferencePrice),
      isActionPriceOnly: Boolean(offer.isActionPriceOnly),
      imageUrl: offer.imageUrl || '',
      benefitType: offer.benefitType || 'unknown',
      rawFacts: buildCacheRawFacts(offer.rawFacts),
      evidenceCount: Array.isArray(offer.supportingSources) ? offer.supportingSources.length : 0,
      sourceType: offer.sourceType || '',
      sourceTypes: offer.sourceTypes || [],
      evidenceUrls: offer.evidenceUrls || [],
      needsReview: Boolean(offer.needsReview),
      reviewReasons: offer.reviewReasons || [],
      savingsAmount: savings.savingsAmount,
      savingsPercent: savings.savingsPercent,
      referencePrice: savings.referencePrice,
      savings: savings.savings,
      minimumPurchaseQuantity: savings.requiredQuantity,
    });
  }

  return [...caches.values()]
    .map((item) => ({
      ...item,
      offers: item.offers.sort((left, right) => {
        const leftSavings = Number(left.savingsAmount ?? -1);
        const rightSavings = Number(right.savingsAmount ?? -1);

        if (rightSavings !== leftSavings) {
          return rightSavings - leftSavings;
        }

        const leftUnit = Number(left.normalizedUnitPrice?.amount ?? Number.MAX_SAFE_INTEGER);
        const rightUnit = Number(right.normalizedUnitPrice?.amount ?? Number.MAX_SAFE_INTEGER);

        if (leftUnit !== rightUnit) {
          return leftUnit - rightUnit;
        }

        return String(left.title || '').localeCompare(String(right.title || ''), 'de');
      }),
    }))
    .sort((left, right) => {
      if (left.retailerName !== right.retailerName) {
        return left.retailerName.localeCompare(right.retailerName, 'de');
      }

      if (left.mainCategoryLabel !== right.mainCategoryLabel) {
        return left.mainCategoryLabel.localeCompare(right.mainCategoryLabel, 'de');
      }

      return left.subcategoryLabel.localeCompare(right.subcategoryLabel, 'de');
    });
}

function chunkArray(items, size = FILTER_METADATA_BULK_BATCH_SIZE) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function buildKeyFilter(document, keyFields) {
  return Object.fromEntries(keyFields.map((field) => [field, document[field] ?? '']));
}

function buildStableKey(document, keyFields) {
  return keyFields.map((field) => String(document[field] ?? '')).join('\u001f');
}

function stripPersistenceFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripPersistenceFields);
  }

  if (!value || typeof value !== 'object' || value instanceof Date) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['_id', '__v', 'createdAt', 'updatedAt'].includes(key))
      .map(([key, nestedValue]) => [key, stripPersistenceFields(nestedValue)])
  );
}

function stableJson(value) {
  return JSON.stringify(stripPersistenceFields(value));
}

function isSameFilterDocument(existingDocument, nextDocument) {
  return stableJson(existingDocument) === stableJson(nextDocument);
}

function normalizeBulkWriteResult(result = {}) {
  return {
    matched: Number(result.matchedCount || result.nMatched || 0),
    modified: Number(result.modifiedCount || result.nModified || 0),
    upserted: Number(result.upsertedCount || result.nUpserted || 0),
  };
}

async function runBulkWriteBatches(Model, operations, batchSize = FILTER_METADATA_BULK_BATCH_SIZE) {
  const totals = {
    matched: 0,
    modified: 0,
    upserted: 0,
  };

  for (const batch of chunkArray(operations, batchSize)) {
    if (batch.length === 0) {
      continue;
    }

    const result = normalizeBulkWriteResult(await Model.bulkWrite(batch, { ordered: false }));
    totals.matched += result.matched;
    totals.modified += result.modified;
    totals.upserted += result.upserted;
  }

  return totals;
}

async function syncFilterMetadataCollection({
  name,
  Model,
  documents,
  keyFields,
  deactivateUpdate,
  batchSize = FILTER_METADATA_BULK_BATCH_SIZE,
}) {
  const now = new Date();
  const existingDocuments = await Model.find({}).lean();
  const existingByKey = new Map(
    existingDocuments.map((document) => [buildStableKey(document, keyFields), document])
  );
  const documentsToWrite = documents.filter((document) => {
    const existingDocument = existingByKey.get(buildStableKey(document, keyFields));
    return !existingDocument || !isSameFilterDocument(existingDocument, document);
  });
  const unchanged = documents.length - documentsToWrite.length;
  const upsertOperations = documentsToWrite.map((document) => ({
    updateOne: {
      filter: buildKeyFilter(document, keyFields),
      update: {
        $set: document,
        $setOnInsert: { createdAt: now },
      },
      upsert: true,
    },
  }));
  const upsertCounts = await runBulkWriteBatches(Model, upsertOperations, batchSize);
  const activeKeys = new Set(documents.map((document) => buildStableKey(document, keyFields)));
  const missingDocuments = existingDocuments.filter((document) => !activeKeys.has(buildStableKey(document, keyFields)));
  let deactivateCounts = { matched: 0, modified: 0, upserted: 0 };

  if (missingDocuments.length > 0 && deactivateUpdate) {
    const deactivateOperations = missingDocuments.map((document) => ({
      updateOne: {
        filter: buildKeyFilter(document, keyFields),
        update: { $set: typeof deactivateUpdate === 'function' ? deactivateUpdate(document) : deactivateUpdate },
        upsert: false,
      },
    }));

    deactivateCounts = await runBulkWriteBatches(Model, deactivateOperations, batchSize);
  }

  return {
    collection: name,
    desired: documents.length,
    upserted: upsertCounts.upserted,
    modified: upsertCounts.modified,
    kept: Math.max(0, unchanged + upsertCounts.matched - upsertCounts.modified),
    deactivated: deactivateCounts.modified,
    staleMatched: deactivateCounts.matched,
  };
}

async function rebuildFilterMetadata({ trigger = 'manual', loggerContext = {} } = {}) {
  const now = new Date();
  const [offers, existingRetailers, sources, crawlJobs] = await Promise.all([
    withFilterMetadataMaxTime(
      Offer.find(buildFilterMetadataOfferMatch())
        .select(FILTER_METADATA_OFFER_SELECT_FIELDS.join(' '))
    ).lean(),
    withFilterMetadataMaxTime(
      Retailer.find({})
        .select('retailerKey retailerName offerCount activeOfferCount firstSeenAt lastSeenAt lastSuccessfulCrawlAt isActive sortOrder')
    ).lean(),
    withFilterMetadataMaxTime(
      Source.find({})
        .select('_id retailerKey retailerName sourceRetailerName sourceRetailerFormat appliesToRetailerFormats retailerFormatLabel label channel sourceUrl active enabled disabledReason notes latestRunAt latestStatus')
    ).lean(),
    withFilterMetadataMaxTime(
      CrawlJob.find({})
        .select('retailerKey status startedAt finishedAt stats')
        .sort({ startedAt: -1 })
        .limit(FILTER_METADATA_CRAWL_JOB_HISTORY_LIMIT)
    ).lean(),
  ]);

  const retailerDocuments = buildRetailerDocuments(existingRetailers, offers, now, sources, crawlJobs);
  const categoryDocuments = buildCategoryDocuments(offers, now);
  const retailerCategoryStatDocuments = buildRetailerCategoryStatDocuments(offers, now);
  const offerCacheDocuments = buildOfferCacheDocuments(offers, now);
  const collectionCounts = {};

  for (const syncConfig of [
    {
      name: 'retailers',
      Model: Retailer,
      documents: retailerDocuments,
      keyFields: ['retailerKey'],
      deactivateUpdate: {
        isActive: false,
        offerCount: 0,
        activeOfferCount: 0,
        totalOffers: 0,
        activeOffers: 0,
        offersBySource: [],
        offersByChannel: [],
        coverageStatus: 'gap',
        activeCoverageSignal: 'empty',
        coveragePriorityScore: 0,
        coverageGapReasons: ['not present in latest filter metadata rebuild'],
      },
    },
    {
      name: 'categories',
      Model: Category,
      documents: categoryDocuments,
      keyFields: ['mainCategoryKey'],
      deactivateUpdate: {
        isActive: false,
        offerCount: 0,
        subcategories: [],
      },
    },
    {
      name: 'retailerCategoryStats',
      Model: RetailerCategoryStat,
      documents: retailerCategoryStatDocuments,
      keyFields: ['retailerKey', 'mainCategoryKey', 'subcategoryKey'],
      deactivateUpdate: {
        offerCount: 0,
        activeOfferCount: 0,
      },
    },
    {
      name: 'retailerCategoryOfferCaches',
      Model: RetailerCategoryOfferCache,
      documents: offerCacheDocuments,
      keyFields: ['retailerKey', 'mainCategoryKey', 'subcategoryKey'],
      deactivateUpdate: {
        offerCount: 0,
        activeOfferCount: 0,
        offers: [],
      },
    },
  ]) {
    collectionCounts[syncConfig.name] = await syncFilterMetadataCollection(syncConfig);
  }

  const summary = {
    trigger,
    retailers: retailerDocuments.length,
    categories: categoryDocuments.length,
    retailerCategoryStats: retailerCategoryStatDocuments.length,
    offerCacheBuckets: offerCacheDocuments.length,
    activeRetailers: retailerDocuments.filter((item) => item.isActive).length,
    trustedRetailers: retailerDocuments.filter((item) => item.coverageStatus === 'trusted').length,
    watchRetailers: retailerDocuments.filter((item) => item.coverageStatus === 'watch').length,
    gapRetailers: retailerDocuments.filter((item) => item.coverageStatus === 'gap').length,
    activeCategories: categoryDocuments.filter((item) => item.isActive).length,
    processedOffers: offers.length,
    counts: collectionCounts,
    syncedAt: now.toISOString(),
    ...loggerContext,
  };

  logger.info('Filter metadata rebuilt', summary);
  return summary;
}

async function getRetailerFilters() {
  const snapshot = await getPublicFacetSnapshot();
  const currentDiscoverySources = snapshot.sources.filter((source) => (
    ['spar', 'interspar'].includes(String(source.retailerKey || '').trim().toLowerCase())
    && source.parserHint === 'spar-family-flyer-discovery'
    && source.crawlPolicy?.currentDiscovery === true
  ));
  const sourceLookup = buildCurrentDiscoverySourceLookup(currentDiscoverySources);
  const now = snapshot.now;

  return snapshot.retailers
    .filter((retailer) => retailer.isActive && Number(retailer.activeOfferCount || 0) > 0)
    .filter((retailer) => !PUBLIC_DISABLED_RETAILER_KEYS.has(retailer.retailerKey))
    .filter((retailer) => shouldExposePublicRetailer(retailer, sourceLookup, now))
    .map((retailer) => withPublicRetailerTrustMetadata(retailer, sourceLookup, now));
}

async function getCategoryFilters({ retailerKeys = [] } = {}) {
  const snapshot = await getPublicFacetSnapshot();

  if (Array.isArray(retailerKeys) && retailerKeys.length > 0) {
    const publicRetailerKeys = retailerKeys.filter(isPublicRetailerEnabled);

    if (publicRetailerKeys.length === 0) {
      return [];
    }

    const stats = snapshot.retailerCategoryStats.filter((stat) => (
      publicRetailerKeys.includes(stat.retailerKey)
      && Number(stat.activeOfferCount || 0) > 0
    ));

    return buildCategoryResponseFromStats(stats);
  }

  return snapshot.categories;
}

function buildCategoryResponseFromStats(stats) {
  const categories = new Map();

  for (const stat of stats) {
    if (!categories.has(stat.mainCategoryKey)) {
      categories.set(stat.mainCategoryKey, {
        mainCategoryKey: stat.mainCategoryKey,
        mainCategoryLabel: stat.mainCategoryLabel,
        offerCount: 0,
        subcategories: new Map(),
        lastSeenAt: stat.lastSeenAt || null,
        isActive: false,
      });
    }

    const category = categories.get(stat.mainCategoryKey);
    category.offerCount += stat.activeOfferCount || 0;
    category.isActive = category.offerCount > 0;

    if (stat.lastSeenAt && (!category.lastSeenAt || stat.lastSeenAt > category.lastSeenAt)) {
      category.lastSeenAt = stat.lastSeenAt;
    }

    if (!stat.subcategoryKey) {
      continue;
    }

    if (!category.subcategories.has(stat.subcategoryKey)) {
      category.subcategories.set(stat.subcategoryKey, {
        subcategoryKey: stat.subcategoryKey,
        subcategoryLabel: stat.subcategoryLabel,
        offerCount: 0,
      });
    }

    const subcategory = category.subcategories.get(stat.subcategoryKey);
    subcategory.offerCount += stat.activeOfferCount || 0;
  }

  return [...categories.values()]
    .sort((left, right) => left.mainCategoryLabel.localeCompare(right.mainCategoryLabel, 'de'))
    .map((category) => ({
      mainCategoryKey: category.mainCategoryKey,
      mainCategoryLabel: category.mainCategoryLabel,
      offerCount: category.offerCount,
      subcategories: [...category.subcategories.values()].sort((left, right) => {
        if (right.offerCount !== left.offerCount) {
          return right.offerCount - left.offerCount;
        }

        return left.subcategoryLabel.localeCompare(right.subcategoryLabel, 'de');
      }),
      lastSeenAt: category.lastSeenAt,
      isActive: category.isActive,
    }));
}

module.exports = {
  rebuildFilterMetadata,
  warmPublicFacetSnapshot,
  clearPublicFacetCache,
  getRetailerFilters,
  getCategoryFilters,
  normalizeRetailerKey,
  normalizeCategoryKey,
  _private: {
    FILTER_METADATA_CRAWL_JOB_HISTORY_LIMIT,
    FILTER_METADATA_OFFER_SELECT_FIELDS,
    PUBLIC_FACET_OFFER_SELECT_FIELDS,
    FILTER_METADATA_QUERY_MAX_TIME_MS,
    HOFER_FRESHNESS_WARNING_THRESHOLD_HOURS,
    INTERSPAR_LIMITED_COVERAGE_MESSAGE,
    SPAR_FAMILY_CURRENT_DISCOVERY_MAX_AGE_HOURS,
    buildFilterMetadataOfferMatch,
    buildCurrentDiscoverySourceLookup,
    buildRetailerFreshnessWarning,
    buildRetailerDocuments,
    isFreshSuccessfulCurrentDiscovery,
    shouldExposePublicRetailer,
    withPublicFreshnessWarning,
    withPublicRetailerTrustMetadata,
    isPublicRetailerEnabled,
    buildKeyFilter,
    buildStableKey,
    isSameFilterDocument,
    getPublicFacetOfferPool,
    resetPublicFacetSnapshot: clearPublicFacetCache,
    syncFilterMetadataCollection,
  },
};
