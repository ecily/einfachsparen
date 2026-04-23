const ManualCategoryOverride = require('../../models/ManualCategoryOverride');
const Offer = require('../../models/Offer');
const { normalizeTitleForMatch, sanitizeWhitespace } = require('../crawl/sourceEvidence');
const { rebuildFilterMetadata } = require('../filters/filterMetadataService');
const { clearRankingResponseCache } = require('../offers/offerRankingService');

let overrideCache = {
  loadedAt: 0,
  articleOverrides: [],
  subcategoryOverrides: [],
};

function buildNormalizedKey(value, fallback = '') {
  return normalizeTitleForMatch(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function normalizeOverrideRetailerKey(value) {
  return buildNormalizedKey(value, '');
}

function createSearchTextFromOffer(offer = {}) {
  return normalizeTitleForMatch(
    [
      offer.retailerName,
      offer.brand,
      offer.title,
      offer.titleNormalized,
      offer.categoryPrimary,
      offer.categorySecondary,
      offer.categoryKey,
      offer.quantityText,
      offer.conditionsText,
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function buildCategoryKey({ categoryPrimary = '', categorySecondary = '' }) {
  return buildNormalizedKey(categorySecondary || categoryPrimary, 'unkategorisiert');
}

function buildComparisonCategoryKey({ categoryPrimary = '', categorySecondary = '' }) {
  return buildNormalizedKey(categorySecondary || categoryPrimary, '');
}

async function reloadManualCategoryOverrideCache() {
  const documents = await ManualCategoryOverride.find({ active: true })
    .sort({ updatedAt: -1 })
    .lean();

  overrideCache = {
    loadedAt: Date.now(),
    articleOverrides: documents.filter((item) => item.scope === 'article-subcategory'),
    subcategoryOverrides: documents.filter((item) => item.scope === 'subcategory-category'),
  };

  return overrideCache;
}

async function ensureManualCategoryOverrideCacheLoaded() {
  if (!overrideCache.loadedAt) {
    await reloadManualCategoryOverrideCache();
  }

  return overrideCache;
}

function findMatchingArticleOverride(offer = {}) {
  const titleNormalized = sanitizeWhitespace(offer.titleNormalized || normalizeTitleForMatch(`${offer.brand || ''} ${offer.title || ''}`));
  const retailerKey = normalizeOverrideRetailerKey(offer.retailerKey);

  return overrideCache.articleOverrides.find((item) => {
    if (!item.titleNormalized || item.titleNormalized !== titleNormalized) {
      return false;
    }

    if (item.retailerKey && normalizeOverrideRetailerKey(item.retailerKey) !== retailerKey) {
      return false;
    }

    return true;
  }) || null;
}

function findMatchingSubcategoryOverride(offer = {}) {
  const subcategoryKey = buildNormalizedKey(offer.categorySecondary || '');

  if (!subcategoryKey) {
    return null;
  }

  return overrideCache.subcategoryOverrides.find((item) => item.matchSubcategoryKey === subcategoryKey) || null;
}

function applyManualCategoryOverridesToOfferSync(offer = {}) {
  const articleOverride = findMatchingArticleOverride(offer);
  const subcategoryOverride = articleOverride ? null : findMatchingSubcategoryOverride(offer);
  const override = articleOverride || subcategoryOverride;

  if (!override) {
    return {
      offer,
      changed: false,
      override: null,
    };
  }

  const nextOffer = {
    ...offer,
    categoryPrimary: override.targetCategoryPrimary || offer.categoryPrimary,
    categorySecondary: override.targetCategorySecondary || offer.categorySecondary || '',
  };

  nextOffer.categoryKey = buildCategoryKey({
    categoryPrimary: nextOffer.categoryPrimary,
    categorySecondary: nextOffer.categorySecondary,
  });
  nextOffer.comparisonCategoryKey = buildComparisonCategoryKey({
    categoryPrimary: nextOffer.categoryPrimary,
    categorySecondary: nextOffer.categorySecondary,
  });
  nextOffer.searchText = createSearchTextFromOffer(nextOffer);

  return {
    offer: nextOffer,
    changed:
      nextOffer.categoryPrimary !== offer.categoryPrimary
      || nextOffer.categorySecondary !== offer.categorySecondary
      || nextOffer.categoryKey !== offer.categoryKey,
    override,
  };
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function applyManualOverridesToExistingOffers({ scope, retailerKey = '', titleNormalized = '', matchSubcategoryLabel = '' }) {
  const filter = {};

  if (scope === 'article-subcategory') {
    filter.titleNormalized = titleNormalized;

    if (retailerKey) {
      filter.retailerKey = retailerKey;
    }
  } else if (scope === 'subcategory-category') {
    filter.categorySecondary = new RegExp(`^${escapeRegex(matchSubcategoryLabel)}$`, 'i');
  } else {
    return { matched: 0, modified: 0 };
  }

  const offers = await Offer.find(filter)
    .select('retailerKey retailerName brand title titleNormalized categoryPrimary categorySecondary categoryKey comparisonCategoryKey searchText quantityText conditionsText')
    .lean();

  if (offers.length === 0) {
    return { matched: 0, modified: 0 };
  }

  const operations = [];
  let modified = 0;

  for (const offer of offers) {
    const result = applyManualCategoryOverridesToOfferSync(offer);

    if (!result.changed) {
      continue;
    }

    modified += 1;
    operations.push({
      updateOne: {
        filter: { _id: offer._id },
        update: {
          $set: {
            categoryPrimary: result.offer.categoryPrimary,
            categorySecondary: result.offer.categorySecondary,
            categoryKey: result.offer.categoryKey,
            comparisonCategoryKey: result.offer.comparisonCategoryKey,
            searchText: result.offer.searchText,
          },
        },
      },
    });
  }

  if (operations.length > 0) {
    await Offer.bulkWrite(operations, { ordered: false });
  }

  await rebuildFilterMetadata({
    trigger: 'quality-override',
    loggerContext: {
      scope,
      retailerKey,
      titleNormalized,
      matchSubcategoryLabel,
    },
  });
  clearRankingResponseCache();

  return {
    matched: offers.length,
    modified,
  };
}

async function upsertSubcategoryCategoryOverride({ matchSubcategoryLabel, targetCategoryPrimary, note = '' }) {
  const cleanSubcategory = sanitizeWhitespace(matchSubcategoryLabel);
  const cleanCategory = sanitizeWhitespace(targetCategoryPrimary);

  const document = await ManualCategoryOverride.findOneAndUpdate(
    {
      scope: 'subcategory-category',
      matchSubcategoryKey: buildNormalizedKey(cleanSubcategory),
    },
    {
      $set: {
        active: true,
        matchSubcategoryLabel: cleanSubcategory,
        matchSubcategoryKey: buildNormalizedKey(cleanSubcategory),
        targetCategoryPrimary: cleanCategory,
        targetCategorySecondary: cleanSubcategory,
        note: sanitizeWhitespace(note),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  await reloadManualCategoryOverrideCache();
  const applyResult = await applyManualOverridesToExistingOffers({
    scope: 'subcategory-category',
    matchSubcategoryLabel: cleanSubcategory,
  });

  return {
    override: document,
    applyResult,
  };
}

async function upsertArticleSubcategoryOverride({
  retailerKey = '',
  titleNormalized,
  titleDisplay = '',
  targetCategoryPrimary,
  targetCategorySecondary,
  note = '',
}) {
  const cleanRetailerKey = normalizeOverrideRetailerKey(retailerKey);
  const cleanTitleNormalized = sanitizeWhitespace(titleNormalized || normalizeTitleForMatch(titleDisplay));
  const cleanTitleDisplay = sanitizeWhitespace(titleDisplay);
  const cleanCategoryPrimary = sanitizeWhitespace(targetCategoryPrimary);
  const cleanCategorySecondary = sanitizeWhitespace(targetCategorySecondary);

  const document = await ManualCategoryOverride.findOneAndUpdate(
    {
      scope: 'article-subcategory',
      retailerKey: cleanRetailerKey,
      titleNormalized: cleanTitleNormalized,
    },
    {
      $set: {
        active: true,
        retailerKey: cleanRetailerKey,
        titleNormalized: cleanTitleNormalized,
        titleDisplay: cleanTitleDisplay,
        targetCategoryPrimary: cleanCategoryPrimary,
        targetCategorySecondary: cleanCategorySecondary,
        note: sanitizeWhitespace(note),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  await reloadManualCategoryOverrideCache();
  const applyResult = await applyManualOverridesToExistingOffers({
    scope: 'article-subcategory',
    retailerKey: cleanRetailerKey,
    titleNormalized: cleanTitleNormalized,
  });

  return {
    override: document,
    applyResult,
  };
}

module.exports = {
  ensureManualCategoryOverrideCacheLoaded,
  reloadManualCategoryOverrideCache,
  applyManualCategoryOverridesToOfferSync,
  upsertSubcategoryCategoryOverride,
  upsertArticleSubcategoryOverride,
};
