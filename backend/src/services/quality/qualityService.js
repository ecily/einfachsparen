const Offer = require('../../models/Offer');
const ManualCategoryOverride = require('../../models/ManualCategoryOverride');
const Retailer = require('../../models/Retailer');
const CrawlJob = require('../../models/CrawlJob');
const { sanitizeWhitespace, normalizeTitleForMatch } = require('../crawl/sourceEvidence');
const { CATEGORY_TAXONOMY } = require('../crawl/categoryClassifier');

function buildNormalizedKey(value, fallback = '') {
  return normalizeTitleForMatch(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function parseLimit(value, fallback = 200, max = 500) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(max, Math.round(numeric));
}

async function buildQualitySnapshot({
  query = '',
  retailerKey = '',
  categoryPrimary = '',
  categorySecondary = '',
  limit = 200,
} = {}) {
  const safeLimit = parseLimit(limit);
  const match = {};

  if (retailerKey) {
    match.retailerKey = retailerKey;
  }

  if (categoryPrimary) {
    match.categoryPrimary = categoryPrimary;
  }

  if (categorySecondary) {
    match.categorySecondary = categorySecondary;
  }

  if (query) {
    match.$or = [
      { title: new RegExp(query, 'i') },
      { titleNormalized: new RegExp(buildNormalizedKey(query), 'i') },
      { categorySecondary: new RegExp(query, 'i') },
      { categoryPrimary: new RegExp(query, 'i') },
    ];
  }

  const [offers, retailers, categoryList, overrides, crawlCoverage, rejectionReasons, sourceTypeCounts, normalPriceStats] = await Promise.all([
    Offer.find(match)
      .select('retailerKey retailerName title titleNormalized categoryPrimary categorySecondary categoryConfidence subcategoryConfidence status isActiveNow validFrom validTo quality savingsDisplayType hasProspectNormalPrice hasEstimatedReferencePrice isActionPriceOnly needsReview reviewReasons sourceType updatedAt createdAt')
      .sort({ updatedAt: -1 })
      .limit(Math.max(safeLimit * 4, 400))
      .lean(),
    Retailer.find({})
      .select('retailerKey retailerName')
      .sort({ retailerName: 1 })
      .lean(),
    Offer.aggregate([
      { $match: categoryPrimary ? { categoryPrimary } : {} },
      {
        $group: {
          _id: '$categoryPrimary',
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    ManualCategoryOverride.find({ active: true })
      .sort({ updatedAt: -1 })
      .lean(),
    CrawlJob.aggregate([
      { $sort: { startedAt: -1 } },
      { $limit: 250 },
      {
        $group: {
          _id: {
            retailerKey: '$retailerKey',
            sourceType: '$sourceType',
            status: '$status',
          },
          runs: { $sum: 1 },
          foundRawItems: { $sum: '$stats.foundRawItems' },
          parsedOffers: { $sum: '$stats.parsedOffers' },
          productiveOffers: { $sum: '$stats.productiveOffers' },
          rejectedOffers: { $sum: '$stats.rejectedOffers' },
          lastRunAt: { $max: '$startedAt' },
        },
      },
      { $sort: { '_id.retailerKey': 1, productiveOffers: -1 } },
    ]),
    CrawlJob.aggregate([
      { $sort: { startedAt: -1 } },
      { $limit: 250 },
      { $unwind: '$rejectionReasons' },
      {
        $group: {
          _id: '$rejectionReasons.reason',
          count: { $sum: '$rejectionReasons.count' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 25 },
    ]),
    Offer.aggregate([
      {
        $group: {
          _id: '$sourceType',
          offerCount: { $sum: 1 },
          activeOfferCount: { $sum: { $cond: ['$isActiveNow', 1, 0] } },
        },
      },
      { $sort: { activeOfferCount: -1 } },
    ]),
    Offer.aggregate([
      {
        $group: {
          _id: '$savingsDisplayType',
          offerCount: { $sum: 1 },
          activeOfferCount: { $sum: { $cond: ['$isActiveNow', 1, 0] } },
        },
      },
      { $sort: { activeOfferCount: -1 } },
    ]),
  ]);

  const subcategoryMap = new Map();
  const articleMap = new Map();

  for (const offer of offers) {
    const subcategoryLabel = sanitizeWhitespace(offer.categorySecondary);
    const primaryLabel = sanitizeWhitespace(offer.categoryPrimary || 'Unkategorisiert');
    const normalizedTitle = sanitizeWhitespace(offer.titleNormalized || normalizeTitleForMatch(offer.title));
    const articleKey = [
      offer.retailerKey || '',
      normalizedTitle,
      primaryLabel,
      subcategoryLabel,
    ].join('::');

    if (subcategoryLabel) {
      if (!subcategoryMap.has(subcategoryLabel)) {
        subcategoryMap.set(subcategoryLabel, {
          subcategoryLabel,
          subcategoryKey: buildNormalizedKey(subcategoryLabel),
          categoryPrimary: primaryLabel,
          offerCount: 0,
          activeOfferCount: 0,
          retailerCount: 0,
          retailers: new Set(),
          sampleTitles: [],
        });
      }

      const current = subcategoryMap.get(subcategoryLabel);
      current.offerCount += 1;
      current.activeOfferCount += offer.isActiveNow ? 1 : 0;
      current.retailers.add(offer.retailerKey || '');

      if (current.sampleTitles.length < 3) {
        current.sampleTitles.push(sanitizeWhitespace(offer.title));
      }
    }

    if (!articleMap.has(articleKey)) {
      articleMap.set(articleKey, {
        retailerKey: offer.retailerKey || '',
        retailerName: offer.retailerName || '',
        titleNormalized: normalizedTitle,
        titleDisplay: sanitizeWhitespace(offer.title),
        categoryPrimary: primaryLabel,
        categorySecondary: subcategoryLabel,
        offerCount: 0,
        activeOfferCount: 0,
        lastSeenAt: offer.updatedAt || offer.createdAt || null,
      });
    }

    const article = articleMap.get(articleKey);
    article.offerCount += 1;
    article.activeOfferCount += offer.isActiveNow ? 1 : 0;
    if ((offer.updatedAt || offer.createdAt) > article.lastSeenAt) {
      article.lastSeenAt = offer.updatedAt || offer.createdAt;
    }
  }

  const subcategoryOverrides = overrides
    .filter((item) => item.scope === 'subcategory-category')
    .map((item) => ({
      id: String(item._id),
      matchSubcategoryLabel: item.matchSubcategoryLabel,
      targetCategoryPrimary: item.targetCategoryPrimary,
      updatedAt: item.updatedAt,
      note: item.note || '',
    }));

  const articleOverrides = overrides
    .filter((item) => item.scope === 'article-subcategory')
    .map((item) => ({
      id: String(item._id),
      retailerKey: item.retailerKey || '',
      titleNormalized: item.titleNormalized,
      titleDisplay: item.titleDisplay || '',
      targetCategoryPrimary: item.targetCategoryPrimary,
      targetCategorySecondary: item.targetCategorySecondary,
      updatedAt: item.updatedAt,
      note: item.note || '',
    }));

  const articleIgnoreOverrides = overrides
    .filter((item) => item.scope === 'article-ignore')
    .map((item) => ({
      id: String(item._id),
      retailerKey: item.retailerKey || '',
      titleNormalized: item.titleNormalized,
      titleDisplay: item.titleDisplay || '',
      updatedAt: item.updatedAt,
      note: item.note || '',
    }));

  const subcategoryOptionsByCategory = CATEGORY_TAXONOMY.reduce((accumulator, category) => {
    accumulator[category.main] = (category.subcategories || []).map((subcategory) => subcategory.label);
    return accumulator;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      query,
      retailerKey,
      categoryPrimary,
      categorySecondary,
      limit: safeLimit,
    },
    retailers: retailers.map((item) => ({
      retailerKey: item.retailerKey,
      retailerName: item.retailerName,
    })),
    categories: categoryList.map((item) => ({
      categoryPrimary: item._id || 'Unkategorisiert',
      offerCount: item.count,
    })),
    subcategoryOptionsByCategory,
    subcategoryMappings: [...subcategoryMap.values()]
      .map((item) => ({
        ...item,
        retailerCount: item.retailers.size,
        retailers: undefined,
      }))
      .sort((left, right) => {
        if (right.offerCount !== left.offerCount) return right.offerCount - left.offerCount;
        return left.subcategoryLabel.localeCompare(right.subcategoryLabel, 'de');
      })
      .slice(0, safeLimit),
    articleMappings: [...articleMap.values()]
      .sort((left, right) => {
        if (right.activeOfferCount !== left.activeOfferCount) return right.activeOfferCount - left.activeOfferCount;
        if (right.offerCount !== left.offerCount) return right.offerCount - left.offerCount;
        return left.titleDisplay.localeCompare(right.titleDisplay, 'de');
      })
      .slice(0, safeLimit),
    manualOverrides: {
      subcategoryCategory: subcategoryOverrides,
      articleSubcategory: articleOverrides,
      articleIgnore: articleIgnoreOverrides,
    },
    crawlCoverage: crawlCoverage.map((item) => ({
      retailerKey: item._id?.retailerKey || '',
      sourceType: item._id?.sourceType || '',
      status: item._id?.status || '',
      runs: item.runs || 0,
      foundRawItems: item.foundRawItems || 0,
      parsedOffers: item.parsedOffers || 0,
      productiveOffers: item.productiveOffers || 0,
      rejectedOffers: item.rejectedOffers || 0,
      lastRunAt: item.lastRunAt || null,
    })),
    rejectionReasons: rejectionReasons.map((item) => ({
      reason: item._id || '',
      count: item.count || 0,
    })),
    sourceTypeCounts: sourceTypeCounts.map((item) => ({
      sourceType: item._id || '',
      offerCount: item.offerCount || 0,
      activeOfferCount: item.activeOfferCount || 0,
    })),
    normalPriceStats: normalPriceStats.map((item) => ({
      savingsDisplayType: item._id || 'unknown',
      offerCount: item.offerCount || 0,
      activeOfferCount: item.activeOfferCount || 0,
    })),
  };
}

module.exports = {
  buildQualitySnapshot,
};
