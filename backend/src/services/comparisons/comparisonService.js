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
    titleNormalized: offer.titleNormalized || '',
    brand: offer.brand,
    categoryKey: offer.categoryKey || '',
    comparisonGroup: offer.comparisonGroup || '',
    categoryPrimary: offer.categoryPrimary,
    categorySecondary: offer.categorySecondary,
    quantityText: offer.quantityText,
    conditionsText: offer.conditionsText,
    customerProgramRequired: Boolean(offer.customerProgramRequired),
    effectiveDiscountType: offer.effectiveDiscountType || 'unknown',
    validTo: offer.validTo,
    normalizedUnitPrice: offer.normalizedUnitPrice,
    priceCurrent: offer.priceCurrent,
    priceGapPercent: priceGap,
  };
}

function uniqueRetailerCount(offers) {
  return new Set(offers.map((offer) => offer.retailerKey)).size;
}

function finalizeGroups(groups = [], { minRetailers = 2, topN = 8 }) {
  return groups
    .map((group) => {
      const sortedOffers = group.offers.sort(
        (left, right) => left.normalizedUnitPrice.amount - right.normalizedUnitPrice.amount
      );
      const retailerCount = group.retailerCount || uniqueRetailerCount(sortedOffers);
      const bestUnitPrice = group.bestUnitPrice || sortedOffers[0]?.normalizedUnitPrice?.amount || null;

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

function buildCurrentAvailabilityMatch(now) {
  return {
    status: 'active',
    isActiveNow: true,
    'quality.comparisonSafe': true,
    comparisonGroup: { $ne: '' },
    'normalizedUnitPrice.amount': { $ne: null },
  };
}

function buildDateStringExpression(fieldPath) {
  return {
    $cond: [
      { $ifNull: [fieldPath, false] },
      { $dateToString: { date: fieldPath, format: '%Y-%m-%dT%H:%M:%S.%LZ' } },
      '',
    ],
  };
}

function buildNonEmptyFieldExpression(fieldPath) {
  return {
    $cond: [
      { $gt: [{ $strLenCP: { $ifNull: [fieldPath, ''] } }, 0] },
      fieldPath,
      null,
    ],
  };
}

function buildExactGroupKeyExpression() {
  return buildNonEmptyFieldExpression('$comparisonGroup');
}

function buildCategoryBaseExpression() {
  return {
    $ifNull: [
      buildNonEmptyFieldExpression('$categoryKey'),
      {
        $ifNull: [
          buildNonEmptyFieldExpression('$categorySecondary'),
          buildNonEmptyFieldExpression('$categoryPrimary'),
        ],
      },
    ],
  };
}

function buildCategoryGroupKeyExpression() {
  const categoryBaseExpression = buildCategoryBaseExpression();

  return {
    $cond: [
      {
        $and: [
          { $ifNull: [categoryBaseExpression, false] },
          { $gt: [{ $strLenCP: { $ifNull: ['$normalizedUnitPrice.unit', ''] } }, 0] },
        ],
      },
      {
        $concat: [categoryBaseExpression, '::', '$normalizedUnitPrice.unit'],
      },
      null,
    ],
  };
}

function buildComparisonGroupsPipeline({ keyExpression, labelExpression, topN }) {
  return [
    {
      $addFields: {
        comparisonGroupKey: keyExpression,
        comparisonGroupLabel: labelExpression,
        comparisonDedupeKey: {
          $ifNull: [
            buildNonEmptyFieldExpression('$dedupeKey'),
            {
              $concat: [
                '$retailerKey',
                ':',
                '$titleNormalized',
                ':',
                '$comparisonGroup',
                ':',
                { $toString: '$normalizedUnitPrice.amount' },
                ':',
                buildDateStringExpression('$validTo'),
              ],
            },
          ],
        },
      },
    },
    {
      $match: {
        comparisonGroupKey: { $ne: null },
      },
    },
    {
      $sort: {
        comparisonGroupKey: 1,
        'normalizedUnitPrice.amount': 1,
        retailerName: 1,
        title: 1,
      },
    },
    {
      $group: {
        _id: {
          key: '$comparisonGroupKey',
          dedupeKey: '$comparisonDedupeKey',
        },
        key: { $first: '$comparisonGroupKey' },
        label: { $first: '$comparisonGroupLabel' },
        unit: { $first: '$normalizedUnitPrice.unit' },
        retailerKey: { $first: '$retailerKey' },
        offer: {
          $first: {
            _id: '$_id',
            retailerKey: '$retailerKey',
            retailerName: '$retailerName',
            title: '$title',
            titleNormalized: '$titleNormalized',
            brand: '$brand',
            categoryKey: '$categoryKey',
            comparisonGroup: '$comparisonGroup',
            categoryPrimary: '$categoryPrimary',
            categorySecondary: '$categorySecondary',
            quantityText: '$quantityText',
            conditionsText: '$conditionsText',
            customerProgramRequired: '$customerProgramRequired',
            effectiveDiscountType: '$effectiveDiscountType',
            validTo: '$validTo',
            normalizedUnitPrice: '$normalizedUnitPrice',
            priceCurrent: '$priceCurrent',
          },
        },
      },
    },
    {
      $sort: {
        key: 1,
        'offer.normalizedUnitPrice.amount': 1,
        'offer.title': 1,
      },
    },
    {
      $group: {
        _id: '$key',
        key: { $first: '$key' },
        label: { $first: '$label' },
        unit: { $first: '$unit' },
        retailerKeys: { $addToSet: '$retailerKey' },
        offerCount: { $sum: 1 },
        bestUnitPrice: { $first: '$offer.normalizedUnitPrice.amount' },
        offers: { $push: '$offer' },
      },
    },
    {
      $addFields: {
        retailerCount: { $size: '$retailerKeys' },
      },
    },
    {
      $match: {
        retailerCount: { $gte: 2 },
        offerCount: { $gte: 2 },
      },
    },
    {
      $project: {
        _id: 0,
        key: 1,
        label: 1,
        unit: 1,
        retailerCount: 1,
        offerCount: 1,
        bestUnitPrice: 1,
        offers: { $slice: ['$offers', 4] },
      },
    },
    {
      $sort: {
        retailerCount: -1,
        offerCount: -1,
        bestUnitPrice: 1,
      },
    },
    {
      $limit: topN,
    },
  ];
}

async function buildComparisonSnapshot() {
  const now = new Date();
  const categoryBaseExpression = buildCategoryBaseExpression();
  const [snapshot] = await Offer.aggregate([
    {
      $match: buildCurrentAvailabilityMatch(now),
    },
    {
      $project: {
        retailerKey: 1,
        retailerName: 1,
        title: 1,
        titleNormalized: 1,
        brand: 1,
        categoryPrimary: 1,
        categorySecondary: 1,
        comparisonSignature: 1,
        comparisonQuantityKey: 1,
        comparisonCategoryKey: 1,
        comparisonGroup: 1,
        categoryKey: 1,
        comparableUnit: 1,
        totalComparableAmount: 1,
        customerProgramRequired: 1,
        effectiveDiscountType: 1,
        dedupeKey: 1,
        status: 1,
        isActiveNow: 1,
        quantityText: 1,
        conditionsText: 1,
        validTo: 1,
        normalizedUnitPrice: 1,
        priceCurrent: 1,
      },
    },
    {
      $facet: {
        comparableOfferCount: [{ $count: 'count' }],
        exactMatches: buildComparisonGroupsPipeline({
          keyExpression: buildExactGroupKeyExpression(),
          labelExpression: {
            $ifNull: [
              buildNonEmptyFieldExpression('$categorySecondary'),
              '$title',
            ],
          },
          topN: 6,
        }),
        categoryBenchmarks: buildComparisonGroupsPipeline({
          keyExpression: buildCategoryGroupKeyExpression(),
          labelExpression: {
            $concat: [categoryBaseExpression, ' / ', '$normalizedUnitPrice.unit'],
          },
          topN: 8,
        }),
      },
    },
  ]).option({ maxTimeMS: 7000 });

  return {
    generatedAt: new Date().toISOString(),
    comparableOfferCount: snapshot?.comparableOfferCount?.[0]?.count || 0,
    exactMatches: finalizeGroups(snapshot?.exactMatches || [], { minRetailers: 2, topN: 6 }),
    categoryBenchmarks: finalizeGroups(snapshot?.categoryBenchmarks || [], { minRetailers: 2, topN: 8 }),
  };
}

module.exports = {
  buildComparisonSnapshot,
};
