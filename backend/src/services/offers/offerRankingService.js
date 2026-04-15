const Offer = require('../../models/Offer');

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function normalizeProgramRetailers(value) {
  return normalizeStringList(value);
}

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

function isUsefulCategory(category) {
  const value = String(category || '').trim();

  if (!value) {
    return false;
  }

  return !/(bluetooth lautsprecher|gartengeraete|garten|spielzeug|bekleidung|katzenpflege|katzen|hunde|nassfutter|trockenfutter|haustier|motoroel|reifen|tv|notebook|laptop|monitor|tablet|smartphone|akku|helm|cardigan|leggings|shirt|unterhemd|pflanze|blume|orchidee)/i.test(
    value
  );
}

function isGenericCategory(category) {
  return /^(lebensmittel|getraenke|getränke|haushalt|drogerie \/ hygiene|dose|in öl)$/i.test(String(category || '').trim());
}

function selectDisplayCategory(offer) {
  const primary = String(offer?.categoryPrimary || '').trim();
  const secondary = String(offer?.categorySecondary || '').trim();

  if (secondary && isUsefulCategory(secondary) && !isGenericCategory(secondary)) {
    return secondary;
  }

  if (primary && isUsefulCategory(primary)) {
    return primary;
  }

  return secondary || primary || '';
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenizeSearchText(value) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

function buildWordString(value) {
  const tokens = tokenizeSearchText(value);
  return tokens.length > 0 ? ` ${tokens.join(' ')} ` : ' ';
}

function hasPhrase(wordString, queryTokens) {
  if (queryTokens.length === 0) {
    return false;
  }

  return wordString.includes(` ${queryTokens.join(' ')} `);
}

function scoreOfferAgainstQuery(offer, query) {
  const queryTokens = tokenizeSearchText(query);

  if (queryTokens.length === 0) {
    return 1;
  }

  const titleWords = buildWordString(offer.title);
  const brandWords = buildWordString(offer.brand);
  const primaryWords = buildWordString(offer.categoryPrimary);
  const secondaryWords = buildWordString(offer.categorySecondary);
  const retailerWords = buildWordString(offer.retailerName);
  let score = 0;

  if (hasPhrase(titleWords, queryTokens)) {
    score += 120;
  }

  if (hasPhrase(brandWords, queryTokens)) {
    score += 90;
  }

  if (hasPhrase(secondaryWords, queryTokens)) {
    score += 95;
  }

  if (hasPhrase(primaryWords, queryTokens)) {
    score += 75;
  }

  if (hasPhrase(retailerWords, queryTokens)) {
    score += 25;
  }

  for (const token of queryTokens) {
    if (titleWords.includes(` ${token} `)) {
      score += 24;
    }

    if (brandWords.includes(` ${token} `)) {
      score += 16;
    }

    if (secondaryWords.includes(` ${token} `)) {
      score += 18;
    }

    if (primaryWords.includes(` ${token} `)) {
      score += 12;
    }
  }

  return score;
}

function applyQueryMatch(offers, query) {
  if (!query) {
    return offers;
  }

  return offers
    .map((offer) => ({
      offer,
      score: scoreOfferAgainstQuery(offer, query),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.offer.normalizedUnitPrice.amount !== right.offer.normalizedUnitPrice.amount) {
        return left.offer.normalizedUnitPrice.amount - right.offer.normalizedUnitPrice.amount;
      }

      return String(left.offer.title).localeCompare(String(right.offer.title), 'de');
    })
    .map((item) => item.offer);
}

function applyProgramEligibility(offers, { programRetailers = [], onlyWithoutProgram = false }) {
  const allowedRetailers = new Set(normalizeProgramRetailers(programRetailers));
  const restrictToPublicOnly = normalizeBoolean(onlyWithoutProgram);

  return offers.filter((offer) => {
    if (!offer.customerProgramRequired) {
      return true;
    }

    if (restrictToPublicOnly) {
      return false;
    }

    return allowedRetailers.has(offer.retailerKey);
  });
}

function buildFilters({ categories, query, unit, retailers, onlyWithoutProgram }) {
  const filters = {
    'quality.comparisonSafe': true,
    'normalizedUnitPrice.amount': { $ne: null },
    ...buildCurrentAvailabilityMatch(),
  };

  const selectedCategories = normalizeStringList(categories);
  const selectedRetailers = normalizeStringList(retailers);

  if (selectedCategories.length > 0) {
    const categoryConditions = selectedCategories.flatMap((category) => [
      { categorySecondary: category },
      { categoryPrimary: category },
      { comparisonCategoryKey: category.toLowerCase().replace(/[^a-z0-9]+/g, '-') },
    ]);

    filters.$and.push({
      $or: categoryConditions,
    });
  }

  if (selectedRetailers.length > 0) {
    filters.retailerKey = { $in: selectedRetailers };
  }

  if (unit && unit !== 'all') {
    filters['normalizedUnitPrice.unit'] = unit;
  }

  if (normalizeBoolean(onlyWithoutProgram)) {
    filters.customerProgramRequired = false;
  }

  return filters;
}

function buildRankedOffer(offer, bestUnitPrice, worstUnitPrice) {
  const priceGapPercent = bestUnitPrice
    ? Number((((offer.normalizedUnitPrice.amount - bestUnitPrice) / bestUnitPrice) * 100).toFixed(2))
    : 0;
  const spread = worstUnitPrice && bestUnitPrice && worstUnitPrice !== bestUnitPrice
    ? (offer.normalizedUnitPrice.amount - bestUnitPrice) / (worstUnitPrice - bestUnitPrice)
    : 0;

  return {
    id: offer._id,
    retailerKey: offer.retailerKey,
    retailerName: offer.retailerName,
    title: offer.title,
    brand: offer.brand,
    imageUrl: offer.imageUrl,
    categoryPrimary: offer.categoryPrimary,
    categorySecondary: offer.categorySecondary,
    displayCategory: selectDisplayCategory(offer),
    quantityText: offer.quantityText,
    conditionsText: offer.conditionsText,
    customerProgramRequired: offer.customerProgramRequired,
    sourceUrl: offer.sourceUrl,
    supportingSources: Array.isArray(offer.supportingSources)
      ? offer.supportingSources
          .map((item) => ({
            label: item.label || item.channel || 'Quelle',
            channel: item.channel || '',
            sourceUrl: item.sourceUrl || '',
            observedUrl: item.observedUrl || '',
            matchType: item.matchType || '',
          }))
          .filter((item) => item.label || item.sourceUrl || item.observedUrl)
      : [],
    supportingSourceCount: Array.isArray(offer.supportingSources) ? offer.supportingSources.length : 0,
    supportingSourceLabels: Array.isArray(offer.supportingSources)
      ? offer.supportingSources.map((item) => item.label).filter(Boolean)
      : [],
    validTo: offer.validTo,
    normalizedUnitPrice: offer.normalizedUnitPrice,
    priceCurrent: offer.priceCurrent,
    priceReference: offer.priceReference,
    priceGapPercent,
    relativeScore: Number((spread * 100).toFixed(2)),
    savingsAmount:
      offer.priceReference?.amount && offer.priceCurrent?.amount
        ? Number((offer.priceReference.amount - offer.priceCurrent.amount).toFixed(2))
        : null,
    savingsPercent:
      offer.priceReference?.amount && offer.priceCurrent?.amount && offer.priceReference.amount > 0
        ? Number((((offer.priceReference.amount - offer.priceCurrent.amount) / offer.priceReference.amount) * 100).toFixed(2))
        : null,
    validityLabel: offer.validTo ? 'gueltig bis' : 'aktueller Live-Snapshot',
  };
}

function buildRetailerDistribution(offers) {
  const grouped = new Map();

  for (const offer of offers) {
    if (!grouped.has(offer.retailerKey)) {
      grouped.set(offer.retailerKey, {
        retailerKey: offer.retailerKey,
        retailerName: offer.retailerName,
        offerCount: 0,
        bestUnitPrice: offer.normalizedUnitPrice.amount,
      });
    }

    const current = grouped.get(offer.retailerKey);
    current.offerCount += 1;
    current.bestUnitPrice = Math.min(current.bestUnitPrice, offer.normalizedUnitPrice.amount);
  }

  return [...grouped.values()].sort((left, right) => {
    if (right.offerCount !== left.offerCount) {
      return right.offerCount - left.offerCount;
    }

    return left.bestUnitPrice - right.bestUnitPrice;
  });
}

function dedupeOffers(offers) {
  const seen = new Set();
  const unique = [];

  for (const offer of offers) {
    const dedupeKey = [
      offer.retailerKey,
      offer.title,
      offer.normalizedUnitPrice?.amount,
      offer.normalizedUnitPrice?.unit,
      offer.validTo?.toISOString?.() || offer.validTo,
    ].join('::');

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    unique.push(offer);
  }

  return unique;
}

function dedupeByQuery(offers) {
  const seen = new Set();
  const unique = [];

  for (const offer of offers) {
    const dedupeKey = [
      offer.retailerKey,
      offer.title,
      offer.quantityText,
      offer.normalizedUnitPrice?.amount,
      offer.normalizedUnitPrice?.unit,
    ].join('::');

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    unique.push(offer);
  }

  return unique;
}

function buildGroupedRankings(offers) {
  const groups = new Map();

  for (const offer of offers) {
    const unit = offer.normalizedUnitPrice?.unit || 'unbekannt';

    if (!groups.has(unit)) {
      groups.set(unit, []);
    }

    groups.get(unit).push(offer);
  }

  return [...groups.entries()]
    .map(([unit, unitOffers]) => ({
      unit,
      offers: unitOffers.sort((left, right) => {
        const leftSavings = left.savingsAmount ?? -1;
        const rightSavings = right.savingsAmount ?? -1;

        if (rightSavings !== leftSavings) {
          return rightSavings - leftSavings;
        }

        const leftEvidence = Array.isArray(left.supportingSources) ? left.supportingSources.length : 0;
        const rightEvidence = Array.isArray(right.supportingSources) ? right.supportingSources.length : 0;

        if (rightEvidence !== leftEvidence) {
          return rightEvidence - leftEvidence;
        }

        if (left.customerProgramRequired !== right.customerProgramRequired) {
          return Number(left.customerProgramRequired) - Number(right.customerProgramRequired);
        }

        if (left.normalizedUnitPrice.amount !== right.normalizedUnitPrice.amount) {
          return left.normalizedUnitPrice.amount - right.normalizedUnitPrice.amount;
        }

        return String(left.title).localeCompare(String(right.title), 'de');
      }),
    }))
    .sort((left, right) => {
      const leftTopSavings = left.offers[0]?.savingsAmount ?? -1;
      const rightTopSavings = right.offers[0]?.savingsAmount ?? -1;

      if (rightTopSavings !== leftTopSavings) {
        return rightTopSavings - leftTopSavings;
      }

      return left.unit.localeCompare(right.unit, 'de');
    });
}

function buildRetailerOptions(items) {
  return items
    .map((item) => ({
      key: item._id,
      retailerKey: item._id,
      retailerName: item.name,
      offerCount: item.offerCount,
    }))
    .filter((item) => item.key && item.retailerName)
    .sort((left, right) => left.retailerName.localeCompare(right.retailerName, 'de'));
}

function parseShoppingItems(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

async function buildBasketSuggestions({
  items = '',
  categories = '',
  retailers = '',
  programRetailers = '',
  onlyWithoutProgram = false,
}) {
  const shoppingItems = parseShoppingItems(items);
  const selectedCategories = normalizeStringList(categories);
  const selectedRetailers = normalizeStringList(retailers);
  const selectedProgramRetailers = normalizeProgramRetailers(programRetailers);
  const withoutProgram = normalizeBoolean(onlyWithoutProgram);

  if (shoppingItems.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      filters: {
        categories: selectedCategories,
        retailers: selectedRetailers,
        programRetailers: selectedProgramRetailers,
        onlyWithoutProgram: withoutProgram,
      },
      items: [],
      summary: {
        itemCount: 0,
        matchedItemCount: 0,
        totalCurrentAmount: 0,
        retailerCount: 0,
      },
      retailerMix: [],
    };
  }

  const results = [];
  const baseFilters = buildFilters({
    categories: selectedCategories,
    retailers: selectedRetailers,
    onlyWithoutProgram: withoutProgram,
    unit: 'all',
    query: '',
  });
  const baseOffers = await Offer.find(baseFilters)
    .sort({ 'normalizedUnitPrice.amount': 1, validTo: 1, retailerName: 1, title: 1 })
    .limit(500)
    .lean();
  const eligibleOffers = applyProgramEligibility(baseOffers, {
    programRetailers: selectedProgramRetailers,
    onlyWithoutProgram: withoutProgram,
  });

  for (const item of shoppingItems) {
    const matches = dedupeByQuery(applyQueryMatch(eligibleOffers, item)).slice(0, 12);

    results.push({
      query: item,
      matchCount: matches.length,
      bestOffer: matches[0] ? buildRankedOffer(matches[0], matches[0].normalizedUnitPrice.amount, matches[matches.length - 1]?.normalizedUnitPrice.amount || matches[0].normalizedUnitPrice.amount) : null,
      alternatives: matches.slice(0, 3).map((offer) =>
        buildRankedOffer(
          offer,
          matches[0]?.normalizedUnitPrice?.amount || offer.normalizedUnitPrice.amount,
          matches[matches.length - 1]?.normalizedUnitPrice?.amount || offer.normalizedUnitPrice.amount
        )
      ),
    });
  }

  const matchedOffers = results.map((item) => item.bestOffer).filter(Boolean);
  const retailerMap = new Map();

  for (const offer of matchedOffers) {
    if (!retailerMap.has(offer.retailerKey)) {
      retailerMap.set(offer.retailerKey, {
        retailerKey: offer.retailerKey,
        retailerName: offer.retailerName,
        itemCount: 0,
        totalCurrentAmount: 0,
      });
    }

    const current = retailerMap.get(offer.retailerKey);
    current.itemCount += 1;
    current.totalCurrentAmount = Number((current.totalCurrentAmount + (offer.priceCurrent?.amount || 0)).toFixed(2));
  }

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      categories: selectedCategories,
      retailers: selectedRetailers,
      programRetailers: selectedProgramRetailers,
      onlyWithoutProgram: withoutProgram,
    },
    items: results,
    summary: {
      itemCount: shoppingItems.length,
      matchedItemCount: matchedOffers.length,
      totalCurrentAmount: Number(
        matchedOffers.reduce((sum, offer) => sum + (offer.priceCurrent?.amount || 0), 0).toFixed(2)
      ),
      retailerCount: retailerMap.size,
    },
    retailerMix: [...retailerMap.values()].sort((left, right) => {
      if (right.itemCount !== left.itemCount) {
        return right.itemCount - left.itemCount;
      }

      return left.totalCurrentAmount - right.totalCurrentAmount;
    }),
  };
}

async function buildOfferRanking({
  categories = '',
  query = '',
  unit = 'all',
  retailers = '',
  programRetailers = '',
  onlyWithoutProgram = false,
  limit = 30,
}) {
  const safeLimit = Math.max(5, Math.min(Number(limit) || 30, 200));
  const selectedCategories = normalizeStringList(categories);
  const selectedRetailers = normalizeStringList(retailers);
  const selectedProgramRetailers = normalizeProgramRetailers(programRetailers);
  const withoutProgram = normalizeBoolean(onlyWithoutProgram);
  const rawFetchLimit = query ? 500 : safeLimit * 4;
  const filters = buildFilters({
    categories: selectedCategories,
    query: '',
    unit,
    retailers: selectedRetailers,
    onlyWithoutProgram: withoutProgram,
  });

  const [rawOffers, countSeedOffers, categorySeeds, units, retailerOptions] = await Promise.all([
    Offer.find(filters)
      .sort({ 'normalizedUnitPrice.amount': 1, validTo: 1, retailerName: 1, title: 1 })
      .limit(rawFetchLimit)
      .lean(),
    Offer.find(filters)
      .select(
        'retailerKey retailerName title brand categoryPrimary categorySecondary customerProgramRequired normalizedUnitPrice quantityText validTo'
      )
      .limit(10000)
      .lean(),
    Offer.find({
      ...buildCurrentAvailabilityMatch(),
      'quality.comparisonSafe': true,
      'normalizedUnitPrice.amount': { $ne: null },
    })
      .select('categoryPrimary categorySecondary')
      .limit(5000)
      .lean(),
    Offer.distinct('normalizedUnitPrice.unit', {
      ...buildCurrentAvailabilityMatch(),
      'quality.comparisonSafe': true,
      'normalizedUnitPrice.amount': { $ne: null },
    }),
    Offer.aggregate([
      {
        $match: {
          ...buildCurrentAvailabilityMatch(),
          'quality.comparisonSafe': true,
          'normalizedUnitPrice.amount': { $ne: null },
        },
      },
      {
        $group: {
          _id: '$retailerKey',
          name: { $first: '$retailerName' },
          offerCount: { $sum: 1 },
        },
      },
      { $sort: { name: 1 } },
    ]),
  ]);

  const fullyFilteredOffers = dedupeOffers(
    applyQueryMatch(
      applyProgramEligibility(rawOffers, {
        programRetailers: selectedProgramRetailers,
        onlyWithoutProgram: withoutProgram,
      }),
      query
    )
  );
  const fullMatchingOffers = dedupeOffers(
    applyQueryMatch(
      applyProgramEligibility(countSeedOffers, {
        programRetailers: selectedProgramRetailers,
        onlyWithoutProgram: withoutProgram,
      }),
      query
    )
  );
  const offers = fullyFilteredOffers
    .sort((left, right) => {
      const leftSavings =
        left.priceReference?.amount && left.priceCurrent?.amount
          ? Number((left.priceReference.amount - left.priceCurrent.amount).toFixed(2))
          : -1;
      const rightSavings =
        right.priceReference?.amount && right.priceCurrent?.amount
          ? Number((right.priceReference.amount - right.priceCurrent.amount).toFixed(2))
          : -1;

      if (rightSavings !== leftSavings) {
        return rightSavings - leftSavings;
      }

      const leftEvidence = Array.isArray(left.supportingSources) ? left.supportingSources.length : 0;
      const rightEvidence = Array.isArray(right.supportingSources) ? right.supportingSources.length : 0;

      if (rightEvidence !== leftEvidence) {
        return rightEvidence - leftEvidence;
      }

      if (left.normalizedUnitPrice.amount !== right.normalizedUnitPrice.amount) {
        return left.normalizedUnitPrice.amount - right.normalizedUnitPrice.amount;
      }

      return String(left.title).localeCompare(String(right.title), 'de');
    })
    .slice(0, safeLimit);

  const bestUnitPrice = offers[0]?.normalizedUnitPrice?.amount || null;
  const worstUnitPrice = offers[offers.length - 1]?.normalizedUnitPrice?.amount || null;
  const rankedOffers = offers.map((offer) => buildRankedOffer(offer, bestUnitPrice, worstUnitPrice));

  const categoryCounts = new Map();

  for (const seed of categorySeeds) {
    const label = selectDisplayCategory(seed);

    if (!label || !isUsefulCategory(label) || isGenericCategory(label)) {
      continue;
    }

    categoryCounts.set(label, (categoryCounts.get(label) || 0) + 1);
  }

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      categories: selectedCategories,
      query,
      unit,
      retailers: selectedRetailers,
      programRetailers: selectedProgramRetailers,
      onlyWithoutProgram: withoutProgram,
      limit: safeLimit,
    },
    categories: [...categoryCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }

        return left[0].localeCompare(right[0], 'de');
      })
      .map(([label]) => label),
    retailers: buildRetailerOptions(retailerOptions),
    units: units.filter(Boolean).sort(),
    summary: {
      resultCount: fullMatchingOffers.length,
      displayedCount: rankedOffers.length,
      bestUnitPrice,
      worstUnitPrice,
      spreadPercent:
        bestUnitPrice && worstUnitPrice
          ? Number((((worstUnitPrice - bestUnitPrice) / bestUnitPrice) * 100).toFixed(2))
          : 0,
    },
    retailerDistribution: buildRetailerDistribution(rankedOffers),
    rankedGroups: buildGroupedRankings(rankedOffers),
    rankedOffers,
  };
}

module.exports = {
  buildOfferRanking,
  buildBasketSuggestions,
};
