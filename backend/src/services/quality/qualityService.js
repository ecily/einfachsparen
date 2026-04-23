const Offer = require('../../models/Offer');
const ManualCategoryOverride = require('../../models/ManualCategoryOverride');
const Retailer = require('../../models/Retailer');
const { sanitizeWhitespace, normalizeTitleForMatch } = require('../crawl/sourceEvidence');

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

  const [offers, retailers, categoryList, overrides] = await Promise.all([
    Offer.find(match)
      .select('retailerKey retailerName title titleNormalized categoryPrimary categorySecondary status isActiveNow validFrom validTo quality updatedAt createdAt')
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
    },
  };
}

module.exports = {
  buildQualitySnapshot,
};
