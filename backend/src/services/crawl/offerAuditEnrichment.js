const { normalizeTitleForMatch, dedupeSourceEvidence } = require('./sourceEvidence');
const { NORMALIZATION_VERSION } = require('./crawlAudit');

function normalizeKey(value, fallback = '') {
  return normalizeTitleForMatch(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function inferSourceType({ offer, source, sourceType }) {
  return (
    sourceType
    || offer?.sourceType
    || offer?.rawFacts?.sourceType
    || source?.sourceType
    || source?.channel
    || 'other'
  );
}

function inferCategoryConfidence(offer) {
  if (Number.isFinite(Number(offer?.categoryConfidence)) && Number(offer.categoryConfidence) > 0) {
    return Number(offer.categoryConfidence);
  }

  const primary = String(offer?.categoryPrimary || '');
  const secondary = String(offer?.categorySecondary || '');

  if (!primary || /unkategorisiert/i.test(primary)) {
    return 0.25;
  }

  if (secondary && normalizeKey(primary) !== normalizeKey(secondary)) {
    return 0.78;
  }

  return 0.58;
}

function inferSubcategoryConfidence(offer, categoryConfidence) {
  if (Number.isFinite(Number(offer?.subcategoryConfidence)) && Number(offer.subcategoryConfidence) > 0) {
    return Number(offer.subcategoryConfidence);
  }

  const primary = String(offer?.categoryPrimary || '');
  const secondary = String(offer?.categorySecondary || '');

  if (!secondary || normalizeKey(primary) === normalizeKey(secondary)) {
    return 0.25;
  }

  return Math.min(0.85, Math.max(0.45, categoryConfidence - 0.05));
}

function inferSavingsFields(offer) {
  const currentAmount = Number(offer?.priceCurrent?.amount);
  const referenceAmount = Number(offer?.priceReference?.amount);
  const sourceText = normalizeTitleForMatch(
    [
      offer?.rawFacts?.sourceType,
      offer?.rawFacts?.priceReferenceSource,
      offer?.priceReferenceSource,
      offer?.conditionsText,
      offer?.rawFacts?.infoText,
    ].join(' ')
  );
  const hasReferencePrice = Number.isFinite(referenceAmount) && referenceAmount > 0;
  const hasProspectNormalPrice = hasReferencePrice && !/(estimate|estimated|historisch|history|produktseite|product-search|normalerweise|referenz)/i.test(sourceText);
  const hasEstimatedReferencePrice = hasReferencePrice && !hasProspectNormalPrice;
  const isActionPriceOnly = !hasReferencePrice;
  const savingsDisplayType = hasProspectNormalPrice
    ? 'prospect-saving'
    : hasEstimatedReferencePrice
      ? 'estimated-reference-price'
      : isActionPriceOnly
        ? 'action-price-only'
        : 'unknown';

  return {
    hasReferencePrice,
    hasProspectNormalPrice,
    hasEstimatedReferencePrice,
    isActionPriceOnly,
    savingsDisplayType,
    savingsConfidence: hasProspectNormalPrice && referenceAmount > currentAmount ? 0.95 : hasEstimatedReferencePrice ? 0.55 : 0,
    priceReferenceSource: offer?.priceReferenceSource || (hasProspectNormalPrice ? 'prospect' : hasEstimatedReferencePrice ? 'reference' : ''),
    priceReferenceConfidence: Number(offer?.priceReferenceConfidence || 0) || (hasProspectNormalPrice ? 0.95 : hasEstimatedReferencePrice ? 0.55 : 0),
  };
}

function buildReviewReasons({ offer, categoryConfidence, subcategoryConfidence, savingsFields }) {
  const reasons = new Set(Array.isArray(offer?.reviewReasons) ? offer.reviewReasons : []);

  if (!offer?.title) reasons.add('missing-title');
  if (!(Number(offer?.priceCurrent?.amount) > 0)) reasons.add('missing-current-price');
  if (Number(offer?.quality?.parsingConfidence || 0) < 0.75) reasons.add('parser-low-confidence');
  if (categoryConfidence < 0.5) reasons.add('category-low-confidence');
  if (subcategoryConfidence < 0.4) reasons.add('subcategory-low-confidence');
  if (!offer?.quantityText) reasons.add('missing-quantity');
  if (!offer?.validTo && !offer?.rawFacts?.snapshotCurrent) reasons.add('validity-incomplete');
  if (savingsFields.isActionPriceOnly) reasons.add('action-price-only');

  return [...reasons];
}

function enrichOfferForStorage(offer, { source, sourceType = '', parserVersion = '', normalizationVersion = NORMALIZATION_VERSION } = {}) {
  if (!offer) {
    return null;
  }

  const { scope, ...document } = offer;
  const now = new Date();
  const resolvedSourceType = inferSourceType({ offer: document, source, sourceType });
  const supportingSources = dedupeSourceEvidence(document.supportingSources || []);
  const sourceUrls = uniqueStrings([
    document.sourceUrl,
    source?.sourceUrl,
    ...supportingSources.map((item) => item.sourceUrl),
  ]);
  const evidenceUrls = uniqueStrings([
    document.sourceUrl,
    ...supportingSources.flatMap((item) => [item.observedUrl, item.sourceUrl]),
  ]);
  const sourceTypes = uniqueStrings([
    resolvedSourceType,
    document.rawFacts?.sourceType,
    source?.channel,
  ]);
  const categoryConfidence = inferCategoryConfidence(document);
  const subcategoryConfidence = inferSubcategoryConfidence(document, categoryConfidence);
  const savingsFields = inferSavingsFields(document);
  const reviewReasons = buildReviewReasons({
    offer: document,
    categoryConfidence,
    subcategoryConfidence,
    savingsFields,
  });
  const subcategoryKey = normalizeKey(document.categorySecondary, '');
  const categoryKey = document.categoryKey || normalizeKey(document.categorySecondary || document.categoryPrimary, 'unkategorisiert');

  return {
    ...document,
    sourceType: resolvedSourceType,
    sourceUrls,
    evidenceUrls,
    sourceTypes,
    seenInSources: [
      {
        sourceId: source?._id || document.sourceId || null,
        sourceType: resolvedSourceType,
        channel: source?.channel || '',
        sourceUrl: source?.sourceUrl || document.sourceUrl || '',
        observedUrl: evidenceUrls[0] || document.sourceUrl || source?.sourceUrl || '',
        firstSeenAt: document.firstSeenAt || now,
        lastSeenAt: now,
      },
    ],
    sourceConfidence: Number(document.sourceConfidence || 0) || (source?.channel?.startsWith('official') ? 0.9 : 0.78),
    extractionConfidence: Number(document.extractionConfidence || 0) || Number(document?.quality?.parsingConfidence || 0),
    supportingSources,
    categoryKey,
    subcategoryKey,
    categoryConfidence,
    subcategoryConfidence,
    ...savingsFields,
    normalizationVersion: normalizationVersion || document.normalizationVersion || NORMALIZATION_VERSION,
    parserVersion: parserVersion || document.parserVersion || source?.parserVersion || 'unknown-parser',
    firstSeenAt: document.firstSeenAt || now,
    lastSeenAt: now,
    needsReview: Boolean(document.needsReview || reviewReasons.some((reason) => reason !== 'action-price-only')),
    reviewReasons,
    rawFacts: {
      ...(document.rawFacts || {}),
      sourceType: document.rawFacts?.sourceType || resolvedSourceType,
      categoryConfidence,
      subcategoryConfidence,
      savingsDisplayType: savingsFields.savingsDisplayType,
      hasProspectNormalPrice: savingsFields.hasProspectNormalPrice,
      hasEstimatedReferencePrice: savingsFields.hasEstimatedReferencePrice,
      isActionPriceOnly: savingsFields.isActionPriceOnly,
    },
  };
}

function enrichOffersForStorage(offers = [], options = {}) {
  return offers.map((offer) => enrichOfferForStorage(offer, options)).filter(Boolean);
}

module.exports = {
  enrichOfferForStorage,
  enrichOffersForStorage,
};
