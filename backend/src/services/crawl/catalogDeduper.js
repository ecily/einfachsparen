const Offer = require('../../models/Offer');
const Source = require('../../models/Source');
const { dedupeSourceEvidence } = require('./sourceEvidence');
const { determineCategoryDecision } = require('./categoryClassifier');
const { buildRetailerFormatScopeKey } = require('./offerAuditEnrichment');

const CHANNEL_PRIORITY = {
  'official-flyer': 0,
  'official-site': 1,
  aggregator: 2,
  other: 3,
};

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return normalizeTitle(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function isWeakCategory(offer) {
  const primary = String(offer?.categoryPrimary || '');
  const secondary = String(offer?.categorySecondary || '');

  return (
    !primary
    || primary === 'Unkategorisiert'
    || !secondary
    || secondary === 'Sonstiges'
    || Number(offer?.subcategoryConfidence || 0) < 0.7
  );
}

function buildCategoryContext(offer) {
  return [
    offer?.description,
    offer?.rawFacts?.infoText,
    offer?.rawFacts?.category,
    offer?.rawFacts?.sourceCategory,
    offer?.rawFacts?.validityText,
  ].filter(Boolean).join(' ');
}

function reclassifyWeakCategory(offer) {
  if (!isWeakCategory(offer)) {
    return offer;
  }

  const decision = determineCategoryDecision({
    title: offer?.title || '',
    contextText: buildCategoryContext(offer),
    sourceCategory: offer?.rawFacts?.category || offer?.rawFacts?.sourceCategory || '',
  });

  if (!decision.primaryCategory || decision.primaryCategory === 'Unkategorisiert') {
    return offer;
  }

  const currentScore = getCategoryScore(offer);
  const categorySecondary = decision.secondaryCategory || '';
  const categoryKey = normalizeKey(categorySecondary || decision.primaryCategory);
  const candidate = {
    ...offer,
    categoryPrimary: decision.primaryCategory,
    categorySecondary,
    categoryKey,
    subcategoryKey: normalizeKey(categorySecondary),
    categoryConfidence: decision.categoryConfidence,
    subcategoryConfidence: decision.subcategoryConfidence,
    comparisonCategoryKey: categoryKey,
  };

  return getCategoryScore(candidate) > currentScore ? candidate : offer;
}

function buildDedupeKey(offer) {
  if (offer?.dedupeKey) {
    return offer.dedupeKey;
  }

  return [
    offer.retailerKey,
    buildRetailerFormatScopeKey(offer.appliesToRetailerFormats || []),
    offer.offerType || 'product',
    offer.promotionScope || '',
    offer.appliesToCategory || '',
    offer.comparisonSignature || '',
    offer.titleNormalized || normalizeKey(offer.title),
    offer.comparisonGroup || '',
    offer.comparableUnit || offer.normalizedUnitPrice?.unit || '',
    String(offer.totalComparableAmount ?? ''),
    String(offer.priceCurrent?.amount ?? ''),
    String(offer.discountPercent ?? ''),
    String(offer.discountUpToPercent ?? ''),
    offer.effectiveDiscountType || '',
    offer.customerProgramRequired ? 'program' : 'public',
    offer.validTo ? new Date(offer.validTo).toISOString().slice(0, 10) : '',
  ].join('::');
}

function getPriority(source) {
  return CHANNEL_PRIORITY[source?.channel] ?? 99;
}

function getOfferCompletenessScore(offer) {
  return Number(offer?.quality?.completenessScore || 0);
}

function getOfferConfidence(offer) {
  return Number(offer?.quality?.parsingConfidence || 0);
}

function getStructuredFieldScore(offer) {
  const candidates = [
    offer?.offerKey,
    offer?.dedupeKey,
    offer?.titleNormalized,
    offer?.categoryKey,
    offer?.comparisonGroup,
    offer?.packCount,
    offer?.unitValue,
    offer?.unitType,
    offer?.totalComparableAmount,
    offer?.comparableUnit,
    offer?.packageType,
    offer?.effectiveDiscountType,
    offer?.minimumPurchaseQty,
    offer?.status,
    offer?.searchText,
    offer?.sortScoreDefault,
  ];

  return candidates.filter((value) => value !== null && value !== undefined && value !== '').length;
}

function getCategoryScore(offer) {
  const primary = String(offer?.categoryPrimary || '');
  const secondary = String(offer?.categorySecondary || '');
  const secondaryKey = normalizeKey(secondary);
  const primaryKey = normalizeKey(primary);
  const sourceHint = normalizeTitle(`${offer?.rawFacts?.infoText || ''} ${offer?.rawFacts?.validityText || ''}`);
  let score = 0;

  if (primary && !/unkategorisiert/i.test(primary)) {
    score += 20;
  }

  if (secondary && secondaryKey !== primaryKey) {
    score += 70;
  }

  score += Math.round(Number(offer?.categoryConfidence || 0) * 40);
  score += Math.round(Number(offer?.subcategoryConfidence || 0) * 60);

  if (/^(lebensmittel|getraenke|drogerie hygiene|haushalt|haus garten|garten freizeit)$/.test(sourceHint)) {
    score -= 25;
  }

  if (/^(bier|wein-sekt|spirituosen|suesswaren-knabbereien|tiefkuehl-fertigprodukte|babyhygiene|waschmittel-reiniger)$/.test(secondaryKey)) {
    score += 20;
  }

  return score;
}

function pickBestCategoryOffer(offers) {
  return [...offers].sort((left, right) => {
    const categoryDelta = getCategoryScore(right) - getCategoryScore(left);

    if (categoryDelta !== 0) {
      return categoryDelta;
    }

    return getStructuredFieldScore(right) - getStructuredFieldScore(left);
  })[0];
}

function pickBestStructuredOffer(offers) {
  return [...offers].sort((left, right) => getStructuredFieldScore(right) - getStructuredFieldScore(left))[0];
}

function hasComparableUnitPrice(offer) {
  return Boolean(Number(offer?.normalizedUnitPrice?.amount) > 0 && offer?.normalizedUnitPrice?.unit);
}

function buildMergedReviewState({ canonical, bestCategoryOffer }) {
  const reasons = new Set(Array.isArray(canonical?.reviewReasons) ? canonical.reviewReasons : []);
  const issues = new Set(Array.isArray(canonical?.quality?.issues) ? canonical.quality.issues : []);

  if (bestCategoryOffer?.categorySecondary) {
    reasons.delete('category-low-confidence');
    reasons.delete('subcategory-low-confidence');
    issues.delete('category-low-confidence');
    issues.delete('subcategory-low-confidence');
  }

  return {
    reviewReasons: [...reasons],
    qualityIssues: [...issues],
  };
}

function compareOffersForCanonical(left, right, sourceMap) {
  const leftActive = Number(Boolean(left?.isActiveNow));
  const rightActive = Number(Boolean(right?.isActiveNow));

  if (rightActive !== leftActive) {
    return rightActive - leftActive;
  }

  const leftSafe = Number(Boolean(left?.quality?.comparisonSafe));
  const rightSafe = Number(Boolean(right?.quality?.comparisonSafe));

  if (rightSafe !== leftSafe) {
    return rightSafe - leftSafe;
  }

  const leftCompleteness = getOfferCompletenessScore(left);
  const rightCompleteness = getOfferCompletenessScore(right);

  if (rightCompleteness !== leftCompleteness) {
    return rightCompleteness - leftCompleteness;
  }

  const leftConfidence = getOfferConfidence(left);
  const rightConfidence = getOfferConfidence(right);

  if (rightConfidence !== leftConfidence) {
    return rightConfidence - leftConfidence;
  }

  const leftStructured = getStructuredFieldScore(left);
  const rightStructured = getStructuredFieldScore(right);

  if (rightStructured !== leftStructured) {
    return rightStructured - leftStructured;
  }

  const leftPriority = getPriority(sourceMap.get(String(left.sourceId)));
  const rightPriority = getPriority(sourceMap.get(String(right.sourceId)));

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

async function dedupeOffersAcrossSources({ retailerKeys = [] } = {}) {
  const filters = retailerKeys.length > 0 ? { retailerKey: { $in: retailerKeys } } : {};
  const [offers, sources] = await Promise.all([
    Offer.find(filters)
      .select(
        [
          '_id',
          'retailerKey',
          'sourceRetailerName',
          'sourceRetailerFormat',
          'retailerFormats',
          'appliesToRetailerFormats',
          'retailerFormatLabel',
          'sourceId',
          'title',
          'description',
          'priceCurrent',
          'normalizedUnitPrice',
          'quantityText',
          'titleNormalized',
          'categoryPrimary',
          'categorySecondary',
          'categoryKey',
          'subcategoryKey',
          'categoryConfidence',
          'subcategoryConfidence',
          'comparisonSignature',
          'comparisonGroup',
          'comparisonCategoryKey',
          'comparableUnit',
          'totalComparableAmount',
          'effectiveDiscountType',
          'customerProgramRequired',
          'offerKey',
          'packCount',
          'unitValue',
          'unitType',
          'packageType',
          'minimumPurchaseQty',
          'searchText',
          'sortScoreDefault',
          'validFrom',
          'validTo',
          'createdAt',
          'supportingSources',
          'sourceUrls',
          'evidenceUrls',
          'sourceTypes',
          'seenInSources',
          'firstSeenAt',
          'lastSeenAt',
          'dedupeKey',
          'isActiveNow',
          'quality',
          'rawFacts',
          'reviewReasons',
        ].join(' ')
      )
      .lean(),
    Source.find().select('_id channel retailerKey sourceUrl').lean(),
  ]);

  const sourceMap = new Map(sources.map((source) => [String(source._id), source]));
  const groups = new Map();

  for (const offer of offers) {
    const key = buildDedupeKey(offer);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(offer);
  }

  const duplicateIdsToDelete = [];
  const updates = [];
  let duplicateGroups = 0;

  for (const groupOffers of groups.values()) {
    if (groupOffers.length <= 1) {
      continue;
    }

    duplicateGroups += 1;

    const sorted = [...groupOffers].sort((left, right) => compareOffersForCanonical(left, right, sourceMap));
    const categoryCandidates = sorted.map(reclassifyWeakCategory);

    const canonical = sorted[0];
    const bestCategoryOffer = pickBestCategoryOffer(categoryCandidates);
    const bestStructuredOffer = pickBestStructuredOffer(sorted);
    const bestUnitPriceOffer = sorted.find(hasComparableUnitPrice) || canonical;
    const mergedReviewState = buildMergedReviewState({ canonical, bestCategoryOffer });
    const mergedSupportingSources = dedupeSourceEvidence(
      sorted.flatMap((offer) => offer.supportingSources || [])
    );
    const mergedSourceUrls = [...new Set(sorted.flatMap((offer) => offer.sourceUrls || []).filter(Boolean))];
    const mergedEvidenceUrls = [...new Set(sorted.flatMap((offer) => offer.evidenceUrls || []).filter(Boolean))];
    const mergedSourceTypes = [...new Set(sorted.flatMap((offer) => offer.sourceTypes || []).filter(Boolean))];
    const mergedSeenInSources = sorted.flatMap((offer) => offer.seenInSources || []);
    const firstSeenAt = sorted
      .map((offer) => offer.firstSeenAt || offer.createdAt)
      .filter(Boolean)
      .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0];
    const lastSeenAt = sorted
      .map((offer) => offer.lastSeenAt || offer.updatedAt)
      .filter(Boolean)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];

    updates.push({
      updateOne: {
        filter: { _id: canonical._id },
        update: {
          $set: {
            categoryPrimary: bestCategoryOffer.categoryPrimary || canonical.categoryPrimary,
            sourceRetailerName: canonical.sourceRetailerName || '',
            sourceRetailerFormat: canonical.sourceRetailerFormat || '',
            retailerFormats: canonical.retailerFormats || [],
            appliesToRetailerFormats: canonical.appliesToRetailerFormats || [],
            retailerFormatLabel: canonical.retailerFormatLabel || '',
            categorySecondary: bestCategoryOffer.categorySecondary || canonical.categorySecondary || '',
            categoryKey: bestCategoryOffer.categoryKey || canonical.categoryKey,
            subcategoryKey: bestCategoryOffer.subcategoryKey || normalizeKey(bestCategoryOffer.categorySecondary || ''),
            categoryConfidence: Math.max(
              Number(bestCategoryOffer.categoryConfidence || 0),
              Number(canonical.categoryConfidence || 0)
            ),
            subcategoryConfidence: Math.max(
              Number(bestCategoryOffer.subcategoryConfidence || 0),
              Number(canonical.subcategoryConfidence || 0)
            ),
            comparisonCategoryKey: bestCategoryOffer.comparisonCategoryKey || canonical.comparisonCategoryKey || '',
            quantityText: bestStructuredOffer.quantityText || canonical.quantityText || '',
            packCount: bestStructuredOffer.packCount ?? canonical.packCount ?? null,
            unitValue: bestStructuredOffer.unitValue ?? canonical.unitValue ?? null,
            unitType: bestStructuredOffer.unitType || canonical.unitType || '',
            totalComparableAmount: bestStructuredOffer.totalComparableAmount ?? canonical.totalComparableAmount ?? null,
            comparableUnit: bestStructuredOffer.comparableUnit || canonical.comparableUnit || '',
            packageType: bestStructuredOffer.packageType || canonical.packageType || '',
            normalizedUnitPrice: hasComparableUnitPrice(bestUnitPriceOffer)
              ? bestUnitPriceOffer.normalizedUnitPrice
              : canonical.normalizedUnitPrice,
            quality: {
              ...(canonical.quality || {}),
              issues: mergedReviewState.qualityIssues,
              comparisonSafe: Boolean(canonical.quality?.comparisonSafe || bestUnitPriceOffer.quality?.comparisonSafe),
            },
            reviewReasons: mergedReviewState.reviewReasons,
            needsReview: mergedReviewState.reviewReasons.some((reason) => reason !== 'action-price-only'),
            rawFacts: {
              ...(canonical.rawFacts || {}),
              mergedDuplicateCount: sorted.length,
              mergedCategoryCandidates: [...new Set(sorted
                .map((offer) => [offer.categoryPrimary, offer.categorySecondary].filter(Boolean).join(' > '))
                .filter(Boolean))].slice(0, 8),
            },
            supportingSources: mergedSupportingSources,
            sourceUrls: mergedSourceUrls,
            evidenceUrls: mergedEvidenceUrls,
            sourceTypes: mergedSourceTypes,
            seenInSources: mergedSeenInSources,
            firstSeenAt: firstSeenAt || canonical.firstSeenAt || canonical.createdAt,
            lastSeenAt: lastSeenAt || canonical.lastSeenAt || canonical.updatedAt,
          },
        },
      },
    });

    duplicateIdsToDelete.push(...sorted.slice(1).map((offer) => offer._id));
  }

  if (updates.length > 0) {
    await Offer.bulkWrite(updates, { ordered: false });
  }

  if (duplicateIdsToDelete.length > 0) {
    await Offer.deleteMany({ _id: { $in: duplicateIdsToDelete } });
  }

  return {
    duplicateGroups,
    removedOffers: duplicateIdsToDelete.length,
  };
}

module.exports = {
  dedupeOffersAcrossSources,
};
