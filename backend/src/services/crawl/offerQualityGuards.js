const { normalizeTitleForMatch, sanitizeWhitespace } = require('./sourceEvidence');
const { extractPromotionRequirement } = require('../offers/promotionMath');

const CLEAR_COMPARABLE_UNITS = new Set(['kg', 'l', 'Stk']);
const UNIT_UNCLEAR_REASON = 'Vergleichseinheit unklar';
const UNIT_CONFLICT_REASON = 'Vergleichseinheit widerspruechlich';
const QUANTITY_INCOMPLETE_REASON = 'Menge unvollstaendig';
const PACKAGE_SIZE_UNCLEAR_REASON = 'Packungsgroesse unklar';

function parsePositiveNumber(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeComparableUnit(unit) {
  const normalized = String(unit || '').trim();
  const lower = normalized.toLowerCase();

  if (!lower || ['unknown', 'unbekannt', 'na', 'n/a', 'null'].includes(lower)) {
    return '';
  }

  if (lower === 'kg' || lower.includes('kilogramm')) return 'kg';
  if (lower === 'g' || lower.includes('gramm')) return 'kg';
  if (lower === 'l' || lower.includes('liter')) return 'l';
  if (lower === 'ml' || lower.includes('milliliter')) return 'l';
  if (lower === 'cl' || lower.includes('zentiliter')) return 'l';
  if (lower === 'stk' || lower === 'stueck' || lower.includes('stueck')) return 'Stk';

  return CLEAR_COMPARABLE_UNITS.has(normalized) ? normalized : '';
}

function normalizeQuantityAmount(amount, unit) {
  const value = parsePositiveNumber(amount);
  const normalizedUnit = String(unit || '').toLowerCase();

  if (!value) {
    return null;
  }

  if (normalizedUnit === 'g' || normalizedUnit.includes('gramm')) return { amount: value / 1000, unit: 'kg' };
  if (normalizedUnit === 'kg' || normalizedUnit.includes('kilogramm')) return { amount: value, unit: 'kg' };
  if (normalizedUnit === 'ml' || normalizedUnit.includes('milliliter')) return { amount: value / 1000, unit: 'l' };
  if (normalizedUnit === 'cl' || normalizedUnit.includes('zentiliter')) return { amount: value / 100, unit: 'l' };
  if (normalizedUnit === 'l' || normalizedUnit.includes('liter')) return { amount: value, unit: 'l' };

  return null;
}

function parseQuantityTextBasis(quantityText, targetUnit) {
  const text = String(quantityText || '').replace(',', '.');
  const amountUnitMatch = text.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l|liter|gramm|kilogramm|milliliter|zentiliter)\b/i);

  if (amountUnitMatch) {
    const normalized = normalizeQuantityAmount(amountUnitMatch[1], amountUnitMatch[2]);

    if (normalized?.unit === targetUnit && normalized.amount > 0) {
      return normalized.amount;
    }
  }

  if (targetUnit !== 'Stk') {
    return null;
  }

  const pieceMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(stk|stueck|stuck|tabs?|kapseln?|kapsel|rollen?|waschladungen?|ladungen?|portionen?|beutel|flaschen|dosen|packungen?)\b/i
  );

  return pieceMatch ? parsePositiveNumber(pieceMatch[1]) : null;
}

function hasMultipackSignal(offer) {
  const packCount = parsePositiveNumber(offer?.packCount);
  const quantityText = normalizeTitleForMatch(offer?.quantityText || '');

  return Boolean(
    (packCount && packCount > 1) ||
    /\b\d+\s*(?:x|er|pack)\b/.test(quantityText) ||
    /\b(?:multipack|mehrpack|vorratspack|packung)\b/.test(quantityText)
  );
}

function hasReliableQuantityBasis(offer, comparableUnit) {
  const totalComparableAmount = parsePositiveNumber(offer?.totalComparableAmount);

  if (totalComparableAmount) {
    return true;
  }

  const unitValue = parsePositiveNumber(offer?.unitValue);
  const unitType = normalizeComparableUnit(offer?.unitType);

  if (unitValue && unitType === comparableUnit) {
    return true;
  }

  return Boolean(parseQuantityTextBasis(offer?.quantityText, comparableUnit));
}

function assessComparableSafety(offer = {}) {
  const normalizedUnitPrice = offer.normalizedUnitPrice || {};
  const priceUnit = normalizeComparableUnit(normalizedUnitPrice.unit);
  const comparableUnit = normalizeComparableUnit(offer.comparableUnit);
  const amount = parsePositiveNumber(normalizedUnitPrice.amount);
  const reasons = new Set();

  if (!comparableUnit) {
    reasons.add(UNIT_UNCLEAR_REASON);
  }

  if (priceUnit && comparableUnit && priceUnit !== comparableUnit) {
    reasons.add(UNIT_CONFLICT_REASON);
  }

  const resolvedUnit = comparableUnit || priceUnit;

  if (!amount || !resolvedUnit || !CLEAR_COMPARABLE_UNITS.has(resolvedUnit)) {
    reasons.add(UNIT_UNCLEAR_REASON);
  }

  if (resolvedUnit && !hasReliableQuantityBasis(offer, resolvedUnit)) {
    reasons.add(hasMultipackSignal(offer) ? PACKAGE_SIZE_UNCLEAR_REASON : QUANTITY_INCOMPLETE_REASON);
  }

  const safe = reasons.size === 0 && normalizedUnitPrice.comparable === true;
  const confidence = Number(normalizedUnitPrice.confidence || 0);

  return {
    safe,
    comparableUnit: comparableUnit || '',
    normalizedUnitPrice: {
      ...normalizedUnitPrice,
      unit: safe ? comparableUnit : (priceUnit || normalizedUnitPrice.unit || ''),
      comparable: safe,
      confidence: safe ? Math.max(confidence, 0.75) : Math.min(confidence || 0, 0.4),
    },
    reviewReasons: [...reasons],
  };
}

function textHaystack(offer = {}) {
  return normalizeTitleForMatch([
    offer.title,
    offer.description,
    offer.conditionsText,
    offer.rawFacts?.infoText,
    ...(Array.isArray(offer.rawFacts?.tags) ? offer.rawFacts.tags : []),
    ...(Array.isArray(offer.rawFacts?.loyaltyTags) ? offer.rawFacts.loyaltyTags : []),
  ].join(' '));
}

function detectCustomerProgramRequired(offer = {}) {
  const haystack = textHaystack(offer);

  return /\b(?:app|app preis|kundenkarte|vorteilskarte|clubpreis|club preis|nur mit karte|karte|konto|rabattmarke|lidl plus|jo|joe|payback)\b/.test(haystack);
}

function detectConditionalText(offer = {}) {
  const haystack = textHaystack(offer);

  return /\b(?:solange der vorrat reicht|solange vorrat|beim kauf von|ab \d+|nur mit|app|kundenkarte|vorteilskarte|clubpreis|rabattmarke)\b/.test(haystack);
}

function inferConditionFields(offer = {}) {
  const requirement = extractPromotionRequirement({
    title: offer.title || '',
    conditionsText: offer.conditionsText || '',
    rawFacts: offer.rawFacts || {},
    benefitType: offer.benefitType || '',
  });
  const customerProgramRequired = Boolean(offer.customerProgramRequired || detectCustomerProgramRequired(offer));
  const requiredQuantity = Math.max(1, Number(requirement.requiredQuantity || offer.minimumPurchaseQty || 1));
  const isMultiBuy = Boolean(
    offer.isMultiBuy ||
    ['x-plus-y', 'x-for-y', 'multi-buy'].includes(requirement.mechanic)
  );
  const hasConditions = Boolean(
    offer.hasConditions ||
    sanitizeWhitespace(offer.conditionsText) ||
    customerProgramRequired ||
    isMultiBuy ||
    requiredQuantity > 1 ||
    detectConditionalText(offer)
  );
  let effectiveDiscountType = offer.effectiveDiscountType || 'unknown';

  if (isMultiBuy) {
    effectiveDiscountType = 'multi-buy';
  } else if (requirement.mechanic === 'threshold' || requiredQuantity > 1) {
    effectiveDiscountType = 'threshold';
  } else if (customerProgramRequired && effectiveDiscountType === 'unknown') {
    effectiveDiscountType = 'card-required';
  }

  return {
    customerProgramRequired,
    hasConditions,
    isMultiBuy,
    minimumPurchaseQty: requiredQuantity,
    effectiveDiscountType,
    requirement,
  };
}

function isOfferSafelyComparable(offer = {}) {
  const comparableUnit = normalizeComparableUnit(offer.comparableUnit);
  const unit = normalizeComparableUnit(offer.normalizedUnitPrice?.unit);

  return Boolean(
    offer.quality?.comparisonSafe === true &&
    offer.normalizedUnitPrice?.comparable === true &&
    comparableUnit &&
    unit &&
    comparableUnit === unit &&
    parsePositiveNumber(offer.normalizedUnitPrice?.amount)
  );
}

module.exports = {
  UNIT_UNCLEAR_REASON,
  UNIT_CONFLICT_REASON,
  QUANTITY_INCOMPLETE_REASON,
  PACKAGE_SIZE_UNCLEAR_REASON,
  assessComparableSafety,
  inferConditionFields,
  isOfferSafelyComparable,
  normalizeComparableUnit,
};
