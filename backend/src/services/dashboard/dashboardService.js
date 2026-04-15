const Source = require('../../models/Source');
const CrawlJob = require('../../models/CrawlJob');
const RawDocument = require('../../models/RawDocument');
const Offer = require('../../models/Offer');
const AdminFeedback = require('../../models/AdminFeedback');
const { buildComparisonSnapshot } = require('../comparisons/comparisonService');

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
    buildComparisonSnapshot(),
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
