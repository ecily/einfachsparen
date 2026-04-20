const mongoose = require('mongoose');
const Offer = require('../../models/Offer');
const Retailer = require('../../models/Retailer');
const Category = require('../../models/Category');
const RetailerCategoryStat = require('../../models/RetailerCategoryStat');
const logger = require('../../lib/logger');
const { sanitizeWhitespace, normalizeTitleForMatch } = require('../crawl/sourceEvidence');

function normalizeFilterKey(value, fallback = 'unknown') {
  const normalized = normalizeTitleForMatch(value).replace(/\s+/g, '-');
  return normalized || fallback;
}

function normalizeRetailerKey({ retailerKey, retailerName }) {
  return normalizeFilterKey(retailerKey || retailerName, 'unknown-retailer');
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

function getOfferLastSeenAt(offer) {
  return offer.updatedAt || offer.createdAt || offer.validTo || offer.validFrom || new Date();
}

function isOfferActive(offer, now = new Date()) {
  const snapshotCurrent = Boolean(offer?.rawFacts?.snapshotCurrent);
  const validFrom = offer?.validFrom ? new Date(offer.validFrom) : null;
  const validTo = offer?.validTo ? new Date(offer.validTo) : null;

  const hasStarted = validFrom ? validFrom <= now : snapshotCurrent;
  const hasNotEnded = validTo ? validTo >= now : snapshotCurrent;

  return hasStarted && hasNotEnded;
}

function buildRetailerDocuments(offers, now) {
  const retailers = new Map();

  for (const offer of offers) {
    const retailerKey = normalizeRetailerKey(offer);
    const retailerName = cleanRetailerName(offer.retailerName, retailerKey);
    const isActive = isOfferActive(offer, now);
    const lastSeenAt = getOfferLastSeenAt(offer);

    if (!retailers.has(retailerKey)) {
      retailers.set(retailerKey, {
        retailerKey,
        retailerName,
        offerCount: 0,
        activeOfferCount: 0,
        lastSeenAt,
        isActive: false,
        sortOrder: 0,
      });
    }

    const current = retailers.get(retailerKey);
    current.offerCount += 1;
    current.activeOfferCount += isActive ? 1 : 0;
    current.isActive = current.activeOfferCount > 0;

    if (!current.retailerName || lastSeenAt >= current.lastSeenAt) {
      current.retailerName = retailerName;
    }

    if (lastSeenAt > current.lastSeenAt) {
      current.lastSeenAt = lastSeenAt;
    }
  }

  return [...retailers.values()].sort((left, right) => left.retailerName.localeCompare(right.retailerName, 'de'));
}

function buildCategoryDocuments(offers, now) {
  const categories = new Map();

  for (const offer of offers) {
    const mainCategoryLabel = cleanCategoryLabel(offer.categoryPrimary);
    const mainCategoryKey = normalizeCategoryKey(mainCategoryLabel);
    const subcategoryLabel = sanitizeWhitespace(offer.categorySecondary);
    const subcategoryKey = subcategoryLabel ? normalizeCategoryKey(subcategoryLabel) : '';
    const isActive = isOfferActive(offer, now);
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

function buildRetailerCategoryStatDocuments(offers, now) {
  const stats = new Map();

  for (const offer of offers) {
    const retailerKey = normalizeRetailerKey(offer);
    const mainCategoryLabel = cleanCategoryLabel(offer.categoryPrimary);
    const mainCategoryKey = normalizeCategoryKey(mainCategoryLabel);
    const subcategoryLabel = sanitizeWhitespace(offer.categorySecondary);
    const subcategoryKey = subcategoryLabel ? normalizeCategoryKey(subcategoryLabel) : '';
    const lastSeenAt = getOfferLastSeenAt(offer);
    const isActive = isOfferActive(offer, now);
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

async function replaceCollection(Model, documents, session) {
  await Model.deleteMany({}, { session });

  if (documents.length > 0) {
    await Model.insertMany(documents, { session, ordered: false });
  }
}

async function rebuildFilterMetadata({ trigger = 'manual', loggerContext = {} } = {}) {
  const now = new Date();
  const offers = await Offer.find({})
    .select(
      'retailerKey retailerName categoryPrimary categorySecondary validFrom validTo rawFacts updatedAt createdAt'
    )
    .lean();

  const retailerDocuments = buildRetailerDocuments(offers, now);
  const categoryDocuments = buildCategoryDocuments(offers, now);
  const retailerCategoryStatDocuments = buildRetailerCategoryStatDocuments(offers, now);
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await replaceCollection(Retailer, retailerDocuments, session);
      await replaceCollection(Category, categoryDocuments, session);
      await replaceCollection(RetailerCategoryStat, retailerCategoryStatDocuments, session);
    });
  } finally {
    await session.endSession();
  }

  const summary = {
    trigger,
    retailers: retailerDocuments.length,
    categories: categoryDocuments.length,
    retailerCategoryStats: retailerCategoryStatDocuments.length,
    activeRetailers: retailerDocuments.filter((item) => item.isActive).length,
    activeCategories: categoryDocuments.filter((item) => item.isActive).length,
    processedOffers: offers.length,
    syncedAt: now.toISOString(),
    ...loggerContext,
  };

  logger.info('Filter metadata rebuilt', summary);
  return summary;
}

async function getRetailerFilters() {
  return Retailer.find({ isActive: true })
    .sort({ sortOrder: 1, retailerName: 1 })
    .lean();
}

async function getCategoryFilters({ retailerKeys = [] } = {}) {
  if (Array.isArray(retailerKeys) && retailerKeys.length > 0) {
    const stats = await RetailerCategoryStat.find({
      retailerKey: { $in: retailerKeys },
      activeOfferCount: { $gt: 0 },
    })
      .sort({ mainCategoryLabel: 1, subcategoryLabel: 1 })
      .lean();

    return buildCategoryResponseFromStats(stats);
  }

  const categories = await Category.find({ isActive: true }).sort({ mainCategoryLabel: 1 }).lean();

  return categories.map((category) => ({
    mainCategoryKey: category.mainCategoryKey,
    mainCategoryLabel: category.mainCategoryLabel,
    offerCount: category.offerCount,
    subcategories: (category.subcategories || []).map((subcategory) => ({
      subcategoryKey: subcategory.subcategoryKey,
      subcategoryLabel: subcategory.subcategoryLabel,
      offerCount: subcategory.offerCount,
    })),
    lastSeenAt: category.lastSeenAt,
    isActive: category.isActive,
  }));
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
  getRetailerFilters,
  getCategoryFilters,
  normalizeRetailerKey,
  normalizeCategoryKey,
};
