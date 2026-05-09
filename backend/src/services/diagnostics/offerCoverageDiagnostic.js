const { normalizeTitleForMatch } = require('../crawl/sourceEvidence');

const TARGET_COMBINATIONS = [
  {
    id: 'spar-kaffee-tee',
    retailerLabel: 'SPAR / INTERSPAR / EUROSPAR',
    retailerKeys: ['spar'],
    categoryLabel: 'Kaffee & Tee',
    categoryAliases: ['Kaffee & Tee'],
    minExpectedActiveOffers: 5,
    keywords: ['kaffee', 'espresso', 'tassimo', 'nescafe', 'cafe royal', 'meinl', 'dallmayr', 'regio gold'],
  },
  {
    id: 'billa-kaffee-tee',
    retailerLabel: 'BILLA',
    retailerKeys: ['billa'],
    categoryLabel: 'Kaffee & Tee',
    categoryAliases: ['Kaffee & Tee'],
    minExpectedActiveOffers: 3,
    keywords: ['kaffee', 'espresso', 'nescafe', 'jacobs', 'dallmayr'],
  },
  {
    id: 'billa-plus-kaffee-tee',
    retailerLabel: 'BILLA PLUS',
    retailerKeys: ['billa-plus'],
    categoryLabel: 'Kaffee & Tee',
    categoryAliases: ['Kaffee & Tee'],
    minExpectedActiveOffers: 3,
    keywords: ['kaffee', 'espresso', 'nescafe', 'jacobs', 'dallmayr'],
  },
  {
    id: 'penny-obst-gemuese',
    retailerLabel: 'PENNY',
    retailerKeys: ['penny'],
    categoryLabel: 'Obst & Gemuese',
    categoryAliases: ['Obst & Gemuese', 'Obst & Gemüse'],
    minExpectedActiveOffers: 5,
    keywords: ['obst', 'gemuese', 'gemuse', 'erdbeere', 'tomate', 'paprika', 'salat'],
  },
  {
    id: 'lidl-milchprodukte',
    retailerLabel: 'LIDL',
    retailerKeys: ['lidl'],
    categoryLabel: 'Milchprodukte',
    categoryAliases: ['Milchprodukte'],
    minExpectedActiveOffers: 5,
    keywords: ['milch', 'joghurt', 'butter', 'topfen', 'skyr'],
  },
  {
    id: 'hofer-fleisch-wurst-fisch',
    retailerLabel: 'HOFER',
    retailerKeys: ['hofer'],
    categoryLabel: 'Fleisch, Wurst & Fisch',
    categoryAliases: ['Fleisch, Wurst & Fisch'],
    minExpectedActiveOffers: 5,
    keywords: ['fleisch', 'wurst', 'fisch', 'huhn', 'hendl', 'rind', 'schwein'],
  },
  {
    id: 'dm-haushalt',
    retailerLabel: 'dm',
    retailerKeys: ['dm'],
    categoryLabel: 'Haushalt',
    categoryAliases: ['Haushalt', 'Waschmittel & Reiniger'],
    minExpectedActiveOffers: 3,
    keywords: ['haushalt', 'waschmittel', 'reiniger', 'spuelmittel'],
  },
  {
    id: 'dm-koerperpflege',
    retailerLabel: 'dm',
    retailerKeys: ['dm'],
    categoryLabel: 'Koerperpflege',
    categoryAliases: ['Koerperpflege', 'Körperpflege'],
    minExpectedActiveOffers: 3,
    keywords: ['koerperpflege', 'pflege', 'duschgel', 'deo', 'seife'],
  },
  {
    id: 'bipa-koerperpflege',
    retailerLabel: 'BIPA',
    retailerKeys: ['bipa'],
    categoryLabel: 'Koerperpflege',
    categoryAliases: ['Koerperpflege', 'Körperpflege'],
    minExpectedActiveOffers: 3,
    keywords: ['koerperpflege', 'pflege', 'duschgel', 'deo', 'seife'],
  },
];

function pct(part, total) {
  return total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;
}

function dateKey(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function normalizeKey(value) {
  return normalizeTitleForMatch(value).replace(/\s+/g, '-');
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function countBy(items = [], resolveKey) {
  const counts = new Map();

  for (const item of items) {
    const key = String(resolveKey(item) || 'unknown').trim() || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'de'))
    .map(([key, count]) => ({ key, count }));
}

function hasDate(value) {
  return Boolean(dateKey(value));
}

function hasPrice(offer = {}) {
  return Number.isFinite(Number(offer.priceCurrent?.amount));
}

function hasQuantityOrUnit(offer = {}) {
  return Boolean(
    String(offer.quantityText || '').trim()
    || (Number.isFinite(Number(offer.unitValue)) && String(offer.unitType || '').trim())
    || (Number.isFinite(Number(offer.totalComparableAmount)) && String(offer.comparableUnit || '').trim())
    || (Number.isFinite(Number(offer.normalizedUnitPrice?.amount)) && String(offer.normalizedUnitPrice?.unit || '').trim())
  );
}

function hasConditions(offer = {}) {
  return Boolean(
    String(offer.conditionsText || '').trim()
    || offer.hasConditions
    || offer.customerProgramRequired
    || offer.isMultiBuy
    || Number(offer.minimumPurchaseQty || 1) > 1
    || !['', 'unknown', undefined, null].includes(offer.effectiveDiscountType)
  );
}

function buildSourceLookup(sources = []) {
  return new Map(sources.map((source) => [String(source._id || ''), source]));
}

function sourceForOffer(offer = {}, sourceLookup = new Map()) {
  return sourceLookup.get(String(offer.sourceId || '')) || {};
}

function sourceHaystack(offer = {}, source = {}) {
  return normalizeTitleForMatch([
    offer.sourceType,
    ...(Array.isArray(offer.sourceTypes) ? offer.sourceTypes : []),
    offer.sourceUrl,
    ...(Array.isArray(offer.sourceUrls) ? offer.sourceUrls : []),
    ...(Array.isArray(offer.evidenceUrls) ? offer.evidenceUrls : []),
    source.channel,
    source.sourceType,
    source.label,
    source.sourceUrl,
  ].filter(Boolean).join(' '));
}

function isOfficialSource(offer = {}, source = {}) {
  const haystack = sourceHaystack(offer, source);
  return /official|algolia|api/.test(haystack) || ['official-site', 'official-flyer'].includes(source.channel);
}

function isAggregatorSource(offer = {}, source = {}) {
  const haystack = sourceHaystack(offer, source);
  return source.channel === 'aggregator' || /aktionsfinder|wogibtswas|marktguru|marketguru|aggregator/.test(haystack);
}

function isFlyerSource(offer = {}, source = {}) {
  return /flyer|flugblatt|prospekt/.test(sourceHaystack(offer, source)) || source.channel === 'official-flyer';
}

function isPdfSource(offer = {}, source = {}) {
  return /pdf/.test(sourceHaystack(offer, source));
}

function isHtmlSource(offer = {}, source = {}) {
  return /html/.test(sourceHaystack(offer, source));
}

function isCurrentOffer(offer = {}, now = new Date()) {
  if (offer.isActiveNow === true || offer.isActiveToday === true) {
    return true;
  }

  if (offer.status !== 'active') {
    return false;
  }

  if (!offer.validTo) {
    return true;
  }

  const validTo = new Date(offer.validTo);
  return !Number.isNaN(validTo.getTime()) && validTo >= now;
}

function offerMatchesRetailers(offer = {}, retailerKeys = []) {
  return retailerKeys.includes(String(offer.retailerKey || '').trim());
}

function buildCategoryKeys(target = {}) {
  return unique([
    target.categoryLabel,
    ...(target.categoryAliases || []),
  ]).map(normalizeKey);
}

function offerMatchesCategory(offer = {}, target = {}) {
  const categoryKeys = new Set(buildCategoryKeys(target));
  const offerKeys = [
    offer.categoryKey,
    offer.subcategoryKey,
    offer.categoryPrimary,
    offer.categorySecondary,
  ].map(normalizeKey).filter(Boolean);

  return offerKeys.some((key) => categoryKeys.has(key));
}

function offerMatchesKeywords(offer = {}, keywords = []) {
  if (!keywords.length) {
    return false;
  }

  const haystack = normalizeTitleForMatch([
    offer.title,
    offer.titleNormalized,
    offer.brand,
    offer.searchText,
    offer.description,
    offer.rawFacts?.infoText,
    offer.rawFacts?.validityText,
  ].filter(Boolean).join(' '));

  return keywords.some((keyword) => haystack.includes(normalizeTitleForMatch(keyword)));
}

function buildOfferPreview(offer = {}) {
  return {
    id: String(offer._id || offer.id || ''),
    title: offer.title || '',
    retailerKey: offer.retailerKey || '',
    sourceRetailerFormat: offer.sourceRetailerFormat || '',
    appliesToRetailerFormats: offer.appliesToRetailerFormats || [],
    categoryPrimary: offer.categoryPrimary || '',
    categorySecondary: offer.categorySecondary || '',
    categoryKey: offer.categoryKey || '',
    subcategoryKey: offer.subcategoryKey || '',
    sourceType: offer.sourceType || '',
    sourceTypes: offer.sourceTypes || [],
    priceCurrent: offer.priceCurrent?.amount ?? null,
    quantityText: offer.quantityText || '',
    normalizedUnitPrice: offer.normalizedUnitPrice || {},
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    customerProgramRequired: Boolean(offer.customerProgramRequired),
    conditionsText: offer.conditionsText || '',
  };
}

function buildSourceCounts(offers = [], sourceLookup = new Map()) {
  let official = 0;
  let aggregator = 0;
  let flyer = 0;
  let pdf = 0;
  let html = 0;

  for (const offer of offers) {
    const source = sourceForOffer(offer, sourceLookup);
    if (isOfficialSource(offer, source)) official += 1;
    if (isAggregatorSource(offer, source)) aggregator += 1;
    if (isFlyerSource(offer, source)) flyer += 1;
    if (isPdfSource(offer, source)) pdf += 1;
    if (isHtmlSource(offer, source)) html += 1;
  }

  return {
    official,
    aggregator,
    flyer,
    pdf,
    html,
    flyerPdfHtml: offers.filter((offer) => {
      const source = sourceForOffer(offer, sourceLookup);
      return isFlyerSource(offer, source) || isPdfSource(offer, source) || isHtmlSource(offer, source);
    }).length,
  };
}

function buildWarnings({ target, retailerOffers, categoryOffers, combinedOffers, sourceCounts, keywordMatches }) {
  const warnings = [];

  if (combinedOffers.length < target.minExpectedActiveOffers) {
    warnings.push({
      code: 'low-retailer-category-coverage',
      message: `${target.retailerLabel} / ${target.categoryLabel} hat nur ${combinedOffers.length} aktive Treffer; Zielschwelle ${target.minExpectedActiveOffers}.`,
    });
  }

  if (retailerOffers.length > 0 && combinedOffers.length === 0 && categoryOffers.length > 0) {
    warnings.push({
      code: 'retailer-category-empty-while-category-exists',
      message: 'Kategorie ist bei anderen Haendlern sichtbar, aber fuer diesen Haendler leer.',
    });
  }

  if (keywordMatches.length > combinedOffers.length) {
    warnings.push({
      code: 'possible-category-mapping-loss',
      message: `${keywordMatches.length} Haendler-Treffer passen auf Keywords, aber nur ${combinedOffers.length} liegen in der Zielkategorie.`,
    });
  }

  if (combinedOffers.length > 0 && sourceCounts.official === 0) {
    warnings.push({
      code: 'no-official-offers-for-combination',
      message: 'Aktive Treffer stammen nicht aus einer offiziellen/strukturierten Quelle.',
    });
  }

  if (combinedOffers.length === 0 && retailerOffers.length > 0) {
    warnings.push({
      code: 'retailer-has-offers-but-combination-empty',
      message: 'Haendler hat aktive Angebote, aber keine Treffer fuer diese Kategorie/Subkategorie.',
    });
  }

  return warnings;
}

function summarizeCombination({ target, currentOffers, sourceLookup }) {
  const retailerOffers = currentOffers.filter((offer) => offerMatchesRetailers(offer, target.retailerKeys));
  const categoryOffers = currentOffers.filter((offer) => offerMatchesCategory(offer, target));
  const combinedOffers = retailerOffers.filter((offer) => offerMatchesCategory(offer, target));
  const keywordMatches = retailerOffers.filter((offer) => offerMatchesKeywords(offer, target.keywords));
  const publicOffers = combinedOffers.filter((offer) => !offer.customerProgramRequired);
  const programOffers = combinedOffers.filter((offer) => offer.customerProgramRequired);
  const sourceCounts = buildSourceCounts(combinedOffers, sourceLookup);
  const withBothValidity = combinedOffers.filter((offer) => hasDate(offer.validFrom) && hasDate(offer.validTo));
  const withPrice = combinedOffers.filter(hasPrice);
  const withQuantity = combinedOffers.filter(hasQuantityOrUnit);
  const withCondition = combinedOffers.filter(hasConditions);

  return {
    id: target.id,
    retailerLabel: target.retailerLabel,
    retailerKeys: target.retailerKeys,
    categoryLabel: target.categoryLabel,
    categoryKeys: buildCategoryKeys(target),
    minExpectedActiveOffers: target.minExpectedActiveOffers,
    counts: {
      currentOffersInDbOrApiUniverse: currentOffers.length,
      afterRetailerFilter: retailerOffers.length,
      afterCategoryOrSubcategoryFilter: categoryOffers.length,
      afterRetailerAndCategoryFilter: combinedOffers.length,
      publicOffers: publicOffers.length,
      customerProgramRequiredOffers: programOffers.length,
      withValidFromAndValidTo: withBothValidity.length,
      withPrice: withPrice.length,
      withQuantityOrUnit: withQuantity.length,
      withConditions: withCondition.length,
      keywordMatchesWithinRetailer: keywordMatches.length,
      officialSources: sourceCounts.official,
      aggregatorSources: sourceCounts.aggregator,
      flyerPdfHtmlSources: sourceCounts.flyerPdfHtml,
      flyerSources: sourceCounts.flyer,
      pdfSources: sourceCounts.pdf,
      htmlSources: sourceCounts.html,
    },
    percentages: {
      validFromToPct: pct(withBothValidity.length, combinedOffers.length),
      pricePct: pct(withPrice.length, combinedOffers.length),
      quantityOrUnitPct: pct(withQuantity.length, combinedOffers.length),
      conditionsPct: pct(withCondition.length, combinedOffers.length),
      officialSourcePct: pct(sourceCounts.official, combinedOffers.length),
      aggregatorSourcePct: pct(sourceCounts.aggregator, combinedOffers.length),
      flyerPdfHtmlSourcePct: pct(sourceCounts.flyerPdfHtml, combinedOffers.length),
    },
    sourceTypeDistribution: countBy(combinedOffers, (offer) => offer.sourceType),
    retailerFormatDistribution: countBy(combinedOffers, (offer) => offer.sourceRetailerFormat),
    sampleOffers: combinedOffers.slice(0, 8).map(buildOfferPreview),
    sampleKeywordMatchesOutsideTargetCategory: keywordMatches
      .filter((offer) => !combinedOffers.some((candidate) => String(candidate._id || candidate.id) === String(offer._id || offer.id)))
      .slice(0, 8)
      .map(buildOfferPreview),
    warnings: buildWarnings({
      target,
      retailerOffers,
      categoryOffers,
      combinedOffers,
      sourceCounts,
      keywordMatches,
    }),
  };
}

function buildOfferCoverageDiagnostic({
  offers = [],
  sources = [],
  targetCombinations = TARGET_COMBINATIONS,
  generatedAt = new Date(),
} = {}) {
  const now = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  const currentOffers = offers.filter((offer) => isCurrentOffer(offer, now));
  const sourceLookup = buildSourceLookup(sources);
  const combinations = targetCombinations.map((target) =>
    summarizeCombination({
      target,
      currentOffers,
      sourceLookup,
    })
  );
  const warningCount = combinations.reduce((sum, item) => sum + item.warnings.length, 0);

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: now.toISOString(),
    principle: 'Qualitaet der Daten ist kein Nebenthema - sie IST das Produkt.',
    summary: {
      currentOffersAnalyzed: currentOffers.length,
      sourceDocumentsAnalyzed: sources.length,
      combinationsAnalyzed: combinations.length,
      combinationsWithWarnings: combinations.filter((item) => item.warnings.length > 0).length,
      warningCount,
      lowestCoverage: [...combinations]
        .sort((left, right) => left.counts.afterRetailerAndCategoryFilter - right.counts.afterRetailerAndCategoryFilter)
        .slice(0, 5)
        .map((item) => ({
          id: item.id,
          retailerLabel: item.retailerLabel,
          categoryLabel: item.categoryLabel,
          activeOffers: item.counts.afterRetailerAndCategoryFilter,
          warnings: item.warnings.map((warning) => warning.code),
        })),
    },
    combinations,
  };
}

module.exports = {
  TARGET_COMBINATIONS,
  buildOfferCoverageDiagnostic,
  isCurrentOffer,
  offerMatchesCategory,
  offerMatchesKeywords,
  normalizeKey,
};
