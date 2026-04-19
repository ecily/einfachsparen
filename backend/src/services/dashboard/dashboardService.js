const Source = require('../../models/Source');
const CrawlJob = require('../../models/CrawlJob');
const RawDocument = require('../../models/RawDocument');
const Offer = require('../../models/Offer');
const AdminFeedback = require('../../models/AdminFeedback');
const { buildComparisonSnapshot } = require('../comparisons/comparisonService');
const logger = require('../../lib/logger');

const COMPARISON_SNAPSHOT_TIMEOUT_MS = 8000;

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
    rawCount,
    storedOfferCount,
    activeOfferCount,
    offersPendingReview,
    comparisonSafeOffers,
    offersWithIssues,
    offerSamples,
    recentFeedback,
    retailerSummary,
    comparisonSnapshot,
  ] = await Promise.all([
    Source.find().sort({ active: -1, retailerName: 1 }).lean(),
    CrawlJob.find().sort({ startedAt: -1 }).limit(20).lean(),
    RawDocument.countDocuments(),
    Offer.countDocuments(),
    Offer.countDocuments(currentAvailabilityMatch),
    Offer.countDocuments({ 'adminReview.status': 'pending' }),
    Offer.countDocuments({
      ...currentAvailabilityMatch,
      'quality.comparisonSafe': true,
    }),
    Offer.countDocuments({ 'quality.issues.0': { $exists: true } }),
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
    Offer.aggregate([
      {
        $match: currentAvailabilityMatch,
      },
      {
        $group: {
          _id: '$retailerKey',
          retailerName: { $first: '$retailerName' },
          offerCount: { $sum: 1 },
          comparisonSafeCount: {
            $sum: {
              $cond: [{ $eq: ['$quality.comparisonSafe', true] }, 1, 0],
            },
          },
          issueCount: {
            $sum: {
              $cond: [{ $gt: [{ $size: { $ifNull: ['$quality.issues', []] } }, 0] }, 1, 0],
            },
          },
        },
      },
      { $sort: { retailerName: 1 } },
    ]),
    buildComparisonSnapshotSafely(),
  ]);

  const activeSourceCount = sources.filter((source) => source.active).length;
  const inactiveSourceCount = sources.filter((source) => !source.active).length;

  const qualitySummary = {
    sourceCount: activeSourceCount,
    inactiveSourceCount,
    registeredSourceCount: sources.length,
    crawlJobCount: latestJobs.length,
    rawDocumentCount: rawCount,
    storedOfferCount,
    activeOfferCount,
    offersPendingReview,
    comparisonSafeOffers,
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

  return {
    generatedAt: new Date().toISOString(),
    qualitySummary,
    sources,
    latestJobs,
    retailerSummary,
    comparisonSnapshot,
    offerSamples,
    latestEssence,
    recentFeedback,
  };
}

module.exports = {
  buildDashboardSnapshot,
};
