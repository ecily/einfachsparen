const { classifyOfferSourceQuality } = require('../offers/sourceQuality');

const DEFAULT_SEARCH_TERMS = [
  'Gösser Märzen',
  'goesser',
  'bier',
  'kaffee',
  'waschmittel',
  'butter',
  'öl',
  'milch',
  'reis',
  'hundefutter',
];

function normalizeText(value) {
  return String(value || '').trim();
}

function compact(values = []) {
  return values.map(normalizeText).filter(Boolean);
}

function dateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function summarizeOffer(offer = {}) {
  const sourceQuality = classifyOfferSourceQuality(offer);

  return {
    id: String(offer._id || offer.id || ''),
    title: offer.title || '',
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
    sourceType: offer.sourceType || '',
    sourceClass: sourceQuality.sourceClass,
    sourceQualityRisk: sourceQuality.sourceQualityRisk,
    sourceUrl: offer.sourceUrl || '',
    priceCurrent: offer.priceCurrent?.amount ?? null,
    quantityText: offer.quantityText || '',
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    conditionsText: offer.conditionsText || '',
  };
}

function increment(map, key) {
  const normalized = normalizeText(key) || 'unknown';
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function topBreakdown(map, limit = 8) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, 'de'))
    .slice(0, limit);
}

function isAggregatorWithValidity(sourceQuality) {
  return (
    ['aggregator', 'aggregator-ppcv'].includes(sourceQuality.sourceClass)
    && sourceQuality.hasValidityEvidence
  );
}

function buildSearchCoverageTermReport({ query, ranking = {}, candidates = [] } = {}) {
  const displayedOffers = Array.isArray(ranking.rankedOffers) ? ranking.rankedOffers : [];
  const visibleRetailers = new Map();
  const visibleSourceTypes = new Map();
  const displayedQuality = displayedOffers.map((offer) => ({
    offer,
    sourceQuality: classifyOfferSourceQuality(offer),
  }));
  const candidateQuality = candidates.map((offer) => ({
    offer,
    sourceQuality: classifyOfferSourceQuality(offer),
  }));

  for (const offer of displayedOffers) {
    increment(visibleRetailers, offer.retailerKey || offer.retailerName);
    increment(visibleSourceTypes, offer.sourceType || offer.rawFacts?.sourceType);
  }

  const lowConfidenceCandidates = candidateQuality.filter((item) => item.sourceQuality.isLowConfidenceAggregator);
  const lowConfidenceDisplayed = displayedQuality.filter((item) => item.sourceQuality.isLowConfidenceAggregator);

  return {
    query,
    totalCount: Number(ranking.summary?.totalCount ?? displayedOffers.length),
    displayedCount: Number(ranking.summary?.displayedCount ?? displayedOffers.length),
    officialCount: displayedQuality.filter((item) => item.sourceQuality.sourceClass === 'official').length,
    officialFlyerCount: displayedQuality.filter((item) => item.sourceQuality.sourceClass === 'official-flyer').length,
    aggregatorWithValidityCount: displayedQuality.filter((item) => isAggregatorWithValidity(item.sourceQuality)).length,
    aggregatorPpcvLowConfidenceCount: lowConfidenceCandidates.length,
    excludedLowConfidenceCount: Math.max(0, lowConfidenceCandidates.length - lowConfidenceDisplayed.length),
    topRetailers: topBreakdown(visibleRetailers),
    topSourceTypes: topBreakdown(visibleSourceTypes),
    examples: displayedOffers.slice(0, 8).map(summarizeOffer),
    excludedLowConfidenceExamples: lowConfidenceCandidates.slice(0, 8).map((item) => summarizeOffer(item.offer)),
    resultSetTokenVisible: Boolean(ranking.summary?.resultSetToken),
    hasMore: Boolean(ranking.summary?.hasMore),
    nextOffset: ranking.summary?.nextOffset ?? null,
  };
}

function buildSearchCoverageDiagnostic({ checkedAt = new Date(), terms = DEFAULT_SEARCH_TERMS, reports = [] } = {}) {
  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    performanceSafe: true,
    checkedAt: checkedAt instanceof Date ? checkedAt.toISOString() : checkedAt,
    terms: compact(terms),
    reports,
    summary: {
      termCount: reports.length,
      termsWithZeroDisplayed: reports.filter((report) => report.displayedCount === 0).map((report) => report.query),
      termsWithLowConfidenceExclusions: reports
        .filter((report) => report.excludedLowConfidenceCount > 0)
        .map((report) => ({
          query: report.query,
          excludedLowConfidenceCount: report.excludedLowConfidenceCount,
        })),
      termsWithoutOfficialCoverage: reports
        .filter((report) => report.displayedCount > 0 && report.officialCount === 0 && report.officialFlyerCount === 0)
        .map((report) => report.query),
    },
  };
}

module.exports = {
  DEFAULT_SEARCH_TERMS,
  buildSearchCoverageDiagnostic,
  buildSearchCoverageTermReport,
  summarizeOffer,
};
