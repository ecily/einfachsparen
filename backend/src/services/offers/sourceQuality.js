const { parseAktionsfinderDateRange } = require('./offerFreshness');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FRESH_CRAWL_EVIDENCE_MAX_AGE_DAYS = 14;

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function toDateOrNull(value) {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function collectOfferUrls(offer = {}) {
  return [
    offer.sourceUrl,
    ...(Array.isArray(offer.sourceUrls) ? offer.sourceUrls : []),
    ...(Array.isArray(offer.evidenceUrls) ? offer.evidenceUrls : []),
    offer.rawFacts?.clickoutUrl,
    offer.rawFacts?.leafletHref,
  ].filter(Boolean).map(String);
}

function collectOfferSourceTypes(offer = {}) {
  return [
    offer.sourceType,
    ...(Array.isArray(offer.sourceTypes) ? offer.sourceTypes : []),
    offer.rawFacts?.sourceType,
  ].filter(Boolean).map(normalizeText);
}

function hasAktionsfinderEvidence(offer = {}) {
  const haystack = [
    ...collectOfferSourceTypes(offer),
    ...collectOfferUrls(offer),
  ].join(' ');

  return /aktionsfinder/i.test(haystack);
}

function hasOfficialEvidence(offer = {}) {
  const sourceTypes = collectOfferSourceTypes(offer);

  if (sourceTypes.some((type) => /official|algolia/.test(type))) {
    return true;
  }

  return collectOfferUrls(offer).some((url) => (
    /(billa|penny|hofer|lidl|spar|interspar|dm|bipa|pagro)\.at/i.test(url)
    && !/aktionsfinder\.at|marketguru\.at|wogibtswas\.at/i.test(url)
  ));
}

function hasAktionsfinderPpcvEvidence(offer = {}) {
  return collectOfferUrls(offer).some((url) => /aktionsfinder\.at\/ppcv\//i.test(url));
}

function hasAktionsfinderDetailEvidence(offer = {}) {
  return collectOfferUrls(offer).some((url) => {
    if (!/aktionsfinder\.at\//i.test(url)) return false;
    if (/aktionsfinder\.at\/(?:pv|ppcv)\//i.test(url)) return false;

    return true;
  });
}

function hasValidityEvidence(offer = {}) {
  if (offer.validTo) return true;
  if (offer.rawFacts?.validTo) return true;
  if (offer.rawFacts?.validitySource) return true;

  return collectOfferUrls(offer).some((url) => {
    const range = parseAktionsfinderDateRange(url);
    return Boolean(range.validFrom && range.validTo);
  });
}

function hasFreshCrawlEvidence(
  offer = {},
  now = new Date(),
  maxAgeDays = DEFAULT_FRESH_CRAWL_EVIDENCE_MAX_AGE_DAYS
) {
  const observedAt =
    toDateOrNull(offer.lastSeenAt)
    || toDateOrNull(offer.createdAt);
  const hasRunEvidence = Boolean(
    offer.lastSeenRunId
    || offer.lastSeenSourceRunId
    || offer.crawlJobId
    || offer.rawFacts?.crawlRunId
    || offer.rawFacts?.sourceRunId
  );

  if (!observedAt || !hasRunEvidence) {
    return false;
  }

  return now.getTime() - observedAt.getTime() <= maxAgeDays * DAY_MS;
}

function classifyOfferSourceQuality(offer = {}) {
  const sourceTypes = collectOfferSourceTypes(offer);
  const isOfficial = hasOfficialEvidence(offer);
  const isAktionsfinder = hasAktionsfinderEvidence(offer);
  const isAggregator = isAktionsfinder
    || sourceTypes.some((type) => /aggregator|marketguru|wogibtswas/.test(type))
    || collectOfferUrls(offer).some((url) => /marketguru\.at|wogibtswas\.at/i.test(url));
  const isPpcv = isAktionsfinder && hasAktionsfinderPpcvEvidence(offer);
  const hasDetailEvidence = isAktionsfinder ? hasAktionsfinderDetailEvidence(offer) : false;
  const validityEvidence = hasValidityEvidence(offer);
  const freshCrawlEvidence = hasFreshCrawlEvidence(offer);
  const lowConfidencePpcv = Boolean(
    isPpcv
    && !isOfficial
    && !validityEvidence
    && !hasDetailEvidence
    && !freshCrawlEvidence
  );
  let sourceClass = 'unknown';

  if (isOfficial) {
    sourceClass = sourceTypes.some((type) => /flyer|pdf/.test(type)) ? 'official-flyer' : 'official';
  } else if (isPpcv) {
    sourceClass = 'aggregator-ppcv';
  } else if (isAggregator) {
    sourceClass = 'aggregator';
  }

  return {
    sourceClass,
    sourceTrustLevel: isOfficial ? 'high' : (isAggregator ? 'medium' : 'unknown'),
    freshnessConfidence: lowConfidencePpcv ? 'low' : (isOfficial || validityEvidence || freshCrawlEvidence ? 'high' : 'medium'),
    validityConfidence: validityEvidence ? 'high' : (isOfficial ? 'medium' : 'low'),
    hasOfficialEvidence: isOfficial,
    hasValidityEvidence: validityEvidence,
    hasFreshCrawlEvidence: freshCrawlEvidence,
    hasDetailEvidence,
    sourceQualityRisk: lowConfidencePpcv ? 'aktionsfinder-ppcv-missing-validity-evidence' : '',
    isLowConfidenceAggregator: lowConfidencePpcv,
  };
}

function isLowConfidenceAggregatorOffer(offer = {}) {
  return classifyOfferSourceQuality(offer).isLowConfidenceAggregator;
}

module.exports = {
  classifyOfferSourceQuality,
  collectOfferUrls,
  hasAktionsfinderPpcvEvidence,
  hasFreshCrawlEvidence,
  hasOfficialEvidence,
  hasValidityEvidence,
  isLowConfidenceAggregatorOffer,
};
