const { normalizeTitleForMatch, dedupeSourceEvidence } = require('./sourceEvidence');
const { NORMALIZATION_VERSION } = require('./crawlAudit');
const {
  assessComparableSafety,
  inferConditionFields,
} = require('./offerQualityGuards');
const { resolveReferencePrice } = require('../offers/promotionMath');
const { buildOfferSearchTokens, SEARCH_TOKEN_VERSION } = require('../offers/searchTokens');

const VALIDITY_INCOMPLETE_REVIEW_REASON = 'Gueltigkeitszeitraum unvollstaendig';

function normalizeKey(value, fallback = '') {
  return normalizeTitleForMatch(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeRetailerFormat(value) {
  const normalized = normalizeTitleForMatch(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  if (normalized === 'interspar') return 'interspar';
  if (normalized === 'eurospar') return 'eurospar';
  if (normalized === 'spar') return 'spar';

  return normalized;
}

function uniqueFormats(values = []) {
  return uniqueStrings(values.map(normalizeRetailerFormat)).filter(Boolean);
}

function inferRetailerFormatMetadata({ offer = {}, source = {} }) {
  const retailerKey = normalizeKey(offer.retailerKey || source.retailerKey || '', '');
  const sourceRetailerFormat = normalizeRetailerFormat(
    offer.sourceRetailerFormat
    || source.sourceRetailerFormat
    || ''
  );
  const appliesToRetailerFormats = uniqueFormats(
    offer.appliesToRetailerFormats?.length
      ? offer.appliesToRetailerFormats
      : source.appliesToRetailerFormats?.length
        ? source.appliesToRetailerFormats
        : sourceRetailerFormat
          ? [sourceRetailerFormat]
          : []
  );
  let retailerFormats = uniqueFormats(offer.retailerFormats || []);

  if (['spar', 'eurospar', 'interspar'].includes(retailerKey)) {
    retailerFormats = appliesToRetailerFormats.length > 0
      ? appliesToRetailerFormats
      : sourceRetailerFormat
        ? [sourceRetailerFormat]
        : [retailerKey];
  }
  const sourceRetailerName = (
    offer.sourceRetailerName
    || source.sourceRetailerName
    || (sourceRetailerFormat ? source.retailerName : '')
    || ''
  );
  const retailerFormatLabel = (
    offer.retailerFormatLabel
    || source.retailerFormatLabel
    || (appliesToRetailerFormats.length > 0
      ? appliesToRetailerFormats.map((item) => item.toUpperCase()).join(' + ')
      : '')
  );

  return {
    sourceRetailerName,
    sourceRetailerFormat,
    retailerFormats,
    appliesToRetailerFormats,
    retailerFormatLabel,
  };
}

function buildRetailerFormatScopeKey(formats = []) {
  return uniqueFormats(formats).sort().join('+');
}

function isCurrentlyRelevantOffer(offer, now = new Date()) {
  if (offer?.status === 'expired' || offer?.status === 'upcoming') {
    return false;
  }

  const validFrom = offer?.validFrom ? new Date(offer.validFrom) : null;
  const validTo = offer?.validTo ? new Date(offer.validTo) : null;

  if (validFrom && !Number.isNaN(validFrom.getTime()) && validFrom > now) {
    return false;
  }

  if (validTo && !Number.isNaN(validTo.getTime()) && validTo < now) {
    return false;
  }

  return true;
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

function isPriceOptionalPromotion(offer = {}) {
  return ['category-promotion', 'percent-promotion'].includes(String(offer.offerType || ''));
}

function inferSavingsFields(offer) {
  if (isPriceOptionalPromotion(offer)) {
    return {
      hasReferencePrice: false,
      hasProspectNormalPrice: false,
      hasEstimatedReferencePrice: false,
      isActionPriceOnly: false,
      savingsDisplayType: 'unknown',
      savingsConfidence: 0,
      priceReferenceSource: offer?.priceReferenceSource || '',
      priceReferenceConfidence: Number(offer?.priceReferenceConfidence || 0),
    };
  }

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
  const hasDerivedReferencePrice = hasReferencePrice && /(derived|discount\s+percent|percent\s+derived|percentage\s+derived|source\s+percent)/i.test(sourceText);
  const hasProspectNormalPrice = hasReferencePrice && !hasDerivedReferencePrice && !/(estimate|estimated|historisch|history|produktseite|product-search|normalerweise|referenz)/i.test(sourceText);
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
    savingsConfidence: hasProspectNormalPrice && referenceAmount > currentAmount ? 0.95 : hasDerivedReferencePrice ? 0.72 : hasEstimatedReferencePrice ? 0.55 : 0,
    priceReferenceSource: offer?.priceReferenceSource || (hasProspectNormalPrice ? 'prospect' : hasEstimatedReferencePrice ? 'reference' : ''),
    priceReferenceConfidence: Number(offer?.priceReferenceConfidence || 0) || (hasProspectNormalPrice ? 0.95 : hasDerivedReferencePrice ? 0.72 : hasEstimatedReferencePrice ? 0.55 : 0),
  };
}

function applyDerivedReferencePrice(offer = {}) {
  const existingReferenceAmount = Number(offer?.priceReference?.amount);

  if (Number.isFinite(existingReferenceAmount) && existingReferenceAmount > 0) {
    return offer;
  }

  const reference = resolveReferencePrice(offer);

  if (reference.type !== 'source_percent_derived' || !(reference.amount > 0)) {
    return offer;
  }

  const currency = offer?.priceCurrent?.currency || offer?.priceReference?.currency || 'EUR';

  return {
    ...offer,
    priceReference: {
      ...(offer.priceReference || {}),
      amount: reference.amount,
      currency,
      originalText: `ca. ${reference.amount.toFixed(2)} ${currency}`,
    },
    priceReferenceSource: 'discount-percent-derived',
    priceReferenceConfidence: Math.max(Number(offer.priceReferenceConfidence || 0), reference.confidence || 0.72),
    rawFacts: {
      ...(offer.rawFacts || {}),
      discountPercentage: reference.discountPercent ?? offer.rawFacts?.discountPercentage,
      referencePriceType: 'source_percent_derived',
      referencePriceSource: 'discount-percent-derived',
      referencePriceDerived: true,
    },
  };
}

function hasReliableValidTo(offer) {
  if (!offer?.validTo) {
    return false;
  }

  const validTo = new Date(offer.validTo);
  return !Number.isNaN(validTo.getTime());
}

function hasIncompleteValidity(offer) {
  return !hasReliableValidTo(offer);
}

function buildQualityWithValidity(offer, reviewReasons) {
  const quality = {
    ...(offer?.quality || {}),
    issues: Array.isArray(offer?.quality?.issues) ? [...offer.quality.issues] : [],
  };

  if (!reviewReasons.includes(VALIDITY_INCOMPLETE_REVIEW_REASON)) {
    return quality;
  }

  quality.issues = [...new Set([...quality.issues, VALIDITY_INCOMPLETE_REVIEW_REASON])];
  quality.completenessScore = Math.max(0, Number(quality.completenessScore || 0) - 0.1);

  return quality;
}

function buildQualityWithComparableSafety(offer, reviewReasons, comparableSafety) {
  const quality = {
    ...(offer?.quality || {}),
    issues: Array.isArray(offer?.quality?.issues) ? [...offer.quality.issues] : [],
  };

  if (!comparableSafety.safe) {
    quality.comparisonSafe = false;
    if (!comparableSafety.priceOptional) {
      quality.parsingConfidence = Math.min(Number(quality.parsingConfidence || 0.75), 0.72);
    }
    quality.issues = [...new Set([...quality.issues, ...comparableSafety.reviewReasons])];
    comparableSafety.reviewReasons.forEach((reason) => reviewReasons.add(reason));
  } else {
    quality.comparisonSafe = Boolean(quality.comparisonSafe && offer?.comparisonGroup);
  }

  return quality;
}

function buildReviewReasons({ offer, categoryConfidence, subcategoryConfidence, savingsFields }) {
  const reasons = new Set(Array.isArray(offer?.reviewReasons) ? offer.reviewReasons : []);
  const priceOptional = isPriceOptionalPromotion(offer);

  if (!offer?.title) reasons.add('missing-title');
  if (!priceOptional && !(Number(offer?.priceCurrent?.amount) > 0)) reasons.add('missing-current-price');
  if (Number(offer?.quality?.parsingConfidence || 0) < 0.75) reasons.add('parser-low-confidence');
  if (categoryConfidence < 0.5) reasons.add('category-low-confidence');
  if (subcategoryConfidence < 0.4) reasons.add('subcategory-low-confidence');
  if (!priceOptional && !offer?.quantityText) reasons.add('missing-quantity');
  if (hasIncompleteValidity(offer)) reasons.add(VALIDITY_INCOMPLETE_REVIEW_REASON);
  if (!priceOptional && savingsFields.isActionPriceOnly) reasons.add('action-price-only');

  return [...reasons];
}

function enrichOfferForStorage(offer, { source, sourceType = '', parserVersion = '', normalizationVersion = NORMALIZATION_VERSION } = {}) {
  if (!offer) {
    return null;
  }

  let { scope, ...document } = offer;
  const now = new Date();

  if (!isCurrentlyRelevantOffer(document, now)) {
    return null;
  }

  document = applyDerivedReferencePrice(document);

  const resolvedSourceType = inferSourceType({ offer: document, source, sourceType });
  const formatMetadata = inferRetailerFormatMetadata({ offer: document, source });
  const formatScopeKey = buildRetailerFormatScopeKey(formatMetadata.appliesToRetailerFormats);
  const dedupeKey = document.dedupeKey && formatScopeKey
    ? `${document.dedupeKey}::formats:${formatScopeKey}`
    : document.dedupeKey;
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
  const reviewReasonSet = new Set(buildReviewReasons({
    offer: document,
    categoryConfidence,
    subcategoryConfidence,
    savingsFields,
  }));
  const conditionFields = inferConditionFields(document);
  const comparableSafety = isPriceOptionalPromotion(document)
    ? {
      safe: false,
      comparableUnit: '',
      normalizedUnitPrice: {
        ...(document.normalizedUnitPrice || {}),
        amount: null,
        unit: '',
        comparable: false,
        confidence: 0,
      },
      reviewReasons: [],
      priceOptional: true,
    }
    : assessComparableSafety({
      ...document,
      ...conditionFields,
    });
  const comparableQuality = buildQualityWithComparableSafety(document, reviewReasonSet, comparableSafety);
  const reviewReasons = [...reviewReasonSet];
  const quality = buildQualityWithValidity({
    ...document,
    normalizedUnitPrice: comparableSafety.normalizedUnitPrice,
    comparableUnit: comparableSafety.comparableUnit,
    quality: comparableQuality,
  }, reviewReasons);
  const subcategoryKey = normalizeKey(document.categorySecondary, '');
  const categoryKey = document.categoryKey || normalizeKey(document.categorySecondary || document.categoryPrimary, 'unkategorisiert');
  const tokenSource = {
    ...document,
    conditionsText: conditionFields.conditionsText || document.conditionsText || '',
    ...formatMetadata,
    sourceType: resolvedSourceType,
    categoryKey,
    subcategoryKey,
    categoryPrimary: document.categoryPrimary,
    categorySecondary: document.categorySecondary,
  };

  return {
    ...document,
    ...formatMetadata,
    dedupeKey,
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
    conditionsText: conditionFields.conditionsText || document.conditionsText || '',
    customerProgramRequired: conditionFields.customerProgramRequired,
    hasConditions: conditionFields.hasConditions,
    isMultiBuy: conditionFields.isMultiBuy,
    minimumPurchaseQty: conditionFields.minimumPurchaseQty,
    effectiveDiscountType: conditionFields.effectiveDiscountType,
    comparableUnit: comparableSafety.comparableUnit,
    normalizedUnitPrice: comparableSafety.normalizedUnitPrice,
    comparisonGroup: comparableSafety.safe ? document.comparisonGroup : '',
    searchTokens: buildOfferSearchTokens(tokenSource),
    searchTokenVersion: SEARCH_TOKEN_VERSION,
    ...savingsFields,
    normalizationVersion: normalizationVersion || document.normalizationVersion || NORMALIZATION_VERSION,
    parserVersion: parserVersion || document.parserVersion || source?.parserVersion || 'unknown-parser',
    firstSeenAt: document.firstSeenAt || now,
    lastSeenAt: now,
    quality,
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
      conditionsText: conditionFields.conditionsText || document.conditionsText || undefined,
      minimumPurchaseQuantity: conditionFields.minimumPurchaseQty > 1 ? conditionFields.minimumPurchaseQty : undefined,
      requiredQuantity: conditionFields.minimumPurchaseQty > 1 ? conditionFields.minimumPurchaseQty : undefined,
      sourceRetailerName: formatMetadata.sourceRetailerName,
      sourceRetailerFormat: formatMetadata.sourceRetailerFormat,
      retailerFormatLabel: formatMetadata.retailerFormatLabel,
      appliesToRetailerFormats: formatMetadata.appliesToRetailerFormats,
    },
  };
}

function enrichOffersForStorage(offers = [], options = {}) {
  return offers.map((offer) => enrichOfferForStorage(offer, options)).filter(Boolean);
}

module.exports = {
  enrichOfferForStorage,
  enrichOffersForStorage,
  inferRetailerFormatMetadata,
  buildRetailerFormatScopeKey,
  isCurrentlyRelevantOffer,
  isPriceOptionalPromotion,
};
