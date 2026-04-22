const Offer = require('../../models/Offer');
const Source = require('../../models/Source');
const { dedupeSourceEvidence } = require('./sourceEvidence');

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

function buildDedupeKey(offer) {
  if (offer?.dedupeKey) {
    return offer.dedupeKey;
  }

  return [
    offer.retailerKey,
    offer.categoryKey || '',
    offer.comparisonSignature || '',
    offer.titleNormalized || normalizeKey(offer.title),
    offer.comparisonGroup || '',
    offer.comparableUnit || offer.normalizedUnitPrice?.unit || '',
    String(offer.totalComparableAmount ?? ''),
    String(offer.priceCurrent?.amount ?? ''),
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
          'sourceId',
          'title',
          'priceCurrent',
          'normalizedUnitPrice',
          'quantityText',
          'titleNormalized',
          'categoryKey',
          'comparisonSignature',
          'comparisonGroup',
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
          'dedupeKey',
          'isActiveNow',
          'quality',
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

    const canonical = sorted[0];
    const mergedSupportingSources = dedupeSourceEvidence(
      sorted.flatMap((offer) => offer.supportingSources || [])
    );

    updates.push({
      updateOne: {
        filter: { _id: canonical._id },
        update: {
          $set: {
            supportingSources: mergedSupportingSources,
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
