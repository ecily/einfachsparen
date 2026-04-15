const Offer = require('../../models/Offer');

function buildOfferCard(offer, bestUnitPrice) {
  const priceGap = bestUnitPrice
    ? Number((((offer.normalizedUnitPrice.amount - bestUnitPrice) / bestUnitPrice) * 100).toFixed(2))
    : 0;

  return {
    id: offer._id,
    retailerKey: offer.retailerKey,
    retailerName: offer.retailerName,
    title: offer.title,
    brand: offer.brand,
    categoryPrimary: offer.categoryPrimary,
    categorySecondary: offer.categorySecondary,
    quantityText: offer.quantityText,
    conditionsText: offer.conditionsText,
    validTo: offer.validTo,
    normalizedUnitPrice: offer.normalizedUnitPrice,
    priceCurrent: offer.priceCurrent,
    priceGapPercent: priceGap,
  };
}

function uniqueRetailerCount(offers) {
  return new Set(offers.map((offer) => offer.retailerKey)).size;
}

function createGroupMap(offers, keyBuilder, labelBuilder) {
  const groups = new Map();

  for (const offer of offers) {
    const key = keyBuilder(offer);

    if (!key) {
      continue;
    }

    const dedupeKey = `${offer.retailerKey}:${offer.title}:${offer.normalizedUnitPrice.amount}:${offer.validTo?.toISOString?.() || offer.validTo}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: labelBuilder(offer),
        offers: [],
        dedupe: new Set(),
      });
    }

    const group = groups.get(key);

    if (group.dedupe.has(dedupeKey)) {
      continue;
    }

    group.dedupe.add(dedupeKey);
    group.offers.push(offer);
  }

  return groups;
}

function finalizeGroups(groupMap, { minRetailers = 2, topN = 8 }) {
  return [...groupMap.values()]
    .map((group) => {
      const sortedOffers = group.offers.sort(
        (left, right) => left.normalizedUnitPrice.amount - right.normalizedUnitPrice.amount
      );
      const retailerCount = uniqueRetailerCount(sortedOffers);
      const bestUnitPrice = sortedOffers[0]?.normalizedUnitPrice?.amount || null;

      return {
        key: group.key,
        label: group.label,
        retailerCount,
        offerCount: sortedOffers.length,
        unit: sortedOffers[0]?.normalizedUnitPrice?.unit || '',
        bestUnitPrice,
        offers: sortedOffers.slice(0, 4).map((offer) => buildOfferCard(offer, bestUnitPrice)),
      };
    })
    .filter((group) => group.retailerCount >= minRetailers && group.offerCount >= 2)
    .sort((left, right) => {
      if (right.retailerCount !== left.retailerCount) {
        return right.retailerCount - left.retailerCount;
      }

      if (right.offerCount !== left.offerCount) {
        return right.offerCount - left.offerCount;
      }

      return (left.bestUnitPrice || 0) - (right.bestUnitPrice || 0);
    })
    .slice(0, topN);
}

async function buildComparisonSnapshot() {
  const now = new Date();
  const offers = await Offer.find({
    'quality.comparisonSafe': true,
    'normalizedUnitPrice.amount': { $ne: null },
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
  }).lean();

  const exactGroups = createGroupMap(
    offers,
    (offer) =>
      offer.comparisonSignature && offer.comparisonQuantityKey
        ? `${offer.comparisonSignature}::${offer.comparisonQuantityKey}::${offer.normalizedUnitPrice.unit}`
        : '',
    (offer) => offer.title
  );

  const categoryGroups = createGroupMap(
    offers,
    (offer) => {
      const categoryKey = offer.comparisonCategoryKey || offer.categorySecondary || offer.categoryPrimary;
      return categoryKey ? `${categoryKey}::${offer.normalizedUnitPrice.unit}` : '';
    },
    (offer) => `${offer.categorySecondary || offer.categoryPrimary} / ${offer.normalizedUnitPrice.unit}`
  );

  return {
    generatedAt: new Date().toISOString(),
    comparableOfferCount: offers.length,
    exactMatches: finalizeGroups(exactGroups, { minRetailers: 2, topN: 6 }),
    categoryBenchmarks: finalizeGroups(categoryGroups, { minRetailers: 2, topN: 8 }),
  };
}

module.exports = {
  buildComparisonSnapshot,
};
