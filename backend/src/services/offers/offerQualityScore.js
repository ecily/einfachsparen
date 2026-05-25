const { normalizeTitleForMatch } = require('../crawl/sourceEvidence');
const { isOfferSafelyComparable, normalizeComparableUnit } = require('../crawl/offerQualityGuards');
const { classifyOfferSourceQuality } = require('./sourceQuality');

const CATEGORY_MISMATCH_REASONS = new Set([
  'pdf_category_mismatch_strong',
  'category-low-confidence',
  'subcategory-low-confidence',
]);

const TECHNICAL_UNIT_VALUES = new Set([
  '$undefined',
  'undefined',
  'nan',
  'null',
  'unknown',
  '[object object]',
  'object object',
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function compactStrings(values = []) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function collectReviewSignals(offer = {}) {
  return [
    ...(Array.isArray(offer.reviewReasons) ? offer.reviewReasons : []),
    ...(Array.isArray(offer.quality?.issues) ? offer.quality.issues : []),
  ].map((item) => String(item || '').trim()).filter(Boolean);
}

function hasUsableImage(offer = {}) {
  return /^https?:\/\//i.test(String(offer.imageUrl || '').trim());
}

function hasConditionSignal(offer = {}) {
  return Boolean(
    String(offer.conditionsText || '').trim() ||
    offer.hasConditions ||
    offer.customerProgramRequired ||
    offer.isMultiBuy ||
    Number(offer.minimumPurchaseQty || 1) > 1
  );
}

function hasClearCategory(offer = {}) {
  const confidence = Number(offer.categoryConfidence || 0);
  const primary = normalizeTitleForMatch(offer.categoryPrimary || '');
  const secondary = normalizeTitleForMatch(offer.categorySecondary || offer.subcategoryKey || '');
  const categoryKey = normalizeTitleForMatch(offer.categoryKey || '');

  if (/unkategorisiert|unknown/.test(`${primary} ${secondary} ${categoryKey}`)) {
    return false;
  }

  return Boolean((secondary || categoryKey) && confidence >= 0.5);
}

function hasCategoryContradiction(offer = {}) {
  return collectReviewSignals(offer).some((reason) => CATEGORY_MISMATCH_REASONS.has(reason));
}

function normalizedUnitArtifact(value) {
  const raw = String(value ?? '').trim();
  const normalized = raw.toLowerCase();

  if (!raw || TECHNICAL_UNIT_VALUES.has(normalized)) {
    return true;
  }

  return /\b(undefined|nan|null|\[object object\])\b/i.test(raw);
}

function hasQuantityArtifact(offer = {}) {
  const visibleText = compactStrings([
    offer.quantityText,
    offer.unitType,
    offer.comparableUnit,
    offer.normalizedUnitPrice?.unit,
  ]).join(' ');

  if (/\$?\b(undefined|nan|null)\b|\[object object\]/i.test(visibleText)) {
    return true;
  }

  const unitPriceAmount = Number(offer.normalizedUnitPrice?.amount);
  if (Number.isFinite(unitPriceAmount) && unitPriceAmount > 0) {
    if (normalizedUnitArtifact(offer.normalizedUnitPrice?.unit)) {
      return true;
    }

    if (!normalizeComparableUnit(offer.normalizedUnitPrice?.unit)) {
      return true;
    }
  }

  return false;
}

function hasUnsafeUnitPrice(offer = {}) {
  const amount = Number(offer.normalizedUnitPrice?.amount);

  return Number.isFinite(amount) &&
    amount > 0 &&
    !isOfferSafelyComparable(offer);
}

function calculateOfferQualityScore(offer = {}) {
  const source = classifyOfferSourceQuality(offer);
  const reviewSignals = collectReviewSignals(offer);
  const positiveSignals = [];
  const negativeSignals = [];
  let score = 50;

  if (source.hasOfficialEvidence) {
    score += 8;
    positiveSignals.push('official-source');
  }

  if (hasUsableImage(offer)) {
    score += 5;
    positiveSignals.push('image-present');
  }

  if (hasConditionSignal(offer)) {
    score += 4;
    positiveSignals.push('condition-visible');
  }

  if (isOfferSafelyComparable(offer)) {
    score += 7;
    positiveSignals.push('safe-unit-price');
  }

  if (hasClearCategory(offer)) {
    score += 4;
    positiveSignals.push('clear-category');
  }

  if (reviewSignals.length === 0) {
    score += 5;
    positiveSignals.push('no-review-signals');
  }

  if (source.sourceTrustLevel === 'high') {
    score += 3;
    positiveSignals.push('high-source-trust');
  }

  if (hasUnsafeUnitPrice(offer)) {
    score -= 7;
    negativeSignals.push('unsafe-unit-price');
  }

  if (offer.quality?.comparisonSafe === false && Number(offer.normalizedUnitPrice?.amount || 0) > 0) {
    score -= 4;
    negativeSignals.push('comparison-not-safe');
  }

  if (reviewSignals.length > 0) {
    score -= Math.min(12, reviewSignals.length * 3);
    negativeSignals.push('review-or-quality-issues');
  }

  if (hasQuantityArtifact(offer)) {
    score -= 9;
    negativeSignals.push('quantity-artifact');
  }

  if (hasCategoryContradiction(offer)) {
    score -= 8;
    negativeSignals.push('category-contradiction');
  }

  if (source.isLowConfidenceAggregator) {
    score -= 8;
    negativeSignals.push('low-confidence-aggregator');
  }

  if (
    source.sourceTrustLevel === 'medium' &&
    !hasUsableImage(offer) &&
    !hasConditionSignal(offer) &&
    !isOfferSafelyComparable(offer)
  ) {
    score -= 3;
    negativeSignals.push('thin-aggregator-card');
  }

  if (/pdf/i.test(String(offer.sourceType || '')) && hasQuantityArtifact(offer)) {
    score -= 3;
    negativeSignals.push('pdf-or-layout-artifact');
  }

  const normalizedScore = clamp(Math.round(score), 0, 100);

  return {
    score: normalizedScore,
    band: normalizedScore >= 75 ? 'high' : normalizedScore >= 55 ? 'medium' : 'low',
    positiveSignals,
    negativeSignals,
    sourceClass: source.sourceClass,
    sourceTrustLevel: source.sourceTrustLevel,
  };
}

function buildOfferQualityRankingAdjustment(offer = {}) {
  const quality = calculateOfferQualityScore(offer);
  const centered = quality.score - 55;

  return clamp(Math.round(centered / 5), -8, 8);
}

module.exports = {
  calculateOfferQualityScore,
  buildOfferQualityRankingAdjustment,
  hasCategoryContradiction,
  hasConditionSignal,
  hasQuantityArtifact,
  hasUnsafeUnitPrice,
};
