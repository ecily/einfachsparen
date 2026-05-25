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

function rawConditionHaystack(offer = {}) {
  return [
    offer.title,
    offer.description,
    offer.conditionsText,
    offer.rawFacts?.infoText,
    offer.rawFacts?.conditionsText,
    offer.rawFacts?.validityText,
    offer.rawFacts?.evidenceText,
    ...(Array.isArray(offer.rawFacts?.tags) ? offer.rawFacts.tags : []),
    ...(Array.isArray(offer.rawFacts?.loyaltyTags) ? offer.rawFacts.loyaltyTags : []),
  ].join(' ');
}

function normalizeConditionUnit(value) {
  const unit = normalizeTitleForMatch(value || '');

  if (/pack|pkg/.test(unit)) return 'Packungen';
  if (/fl/.test(unit)) return 'Flaschen';
  if (/dos/.test(unit)) return 'Dosen';

  return 'Stueck';
}

function addConditionHint(hints, seen, value) {
  const text = sanitizeWhitespace(value);
  const key = normalizeTitleForMatch(text);

  if (!text || !key || seen.has(key)) {
    return;
  }

  seen.add(key);
  hints.push(text);
}

function trimScope(value) {
  return sanitizeWhitespace(value)
    .replace(/\b(?:gueltig|gultig|nur|ausgenommen|statt|je)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function extractConditionHints(offer = {}) {
  const rawText = rawConditionHaystack(offer);
  const rawLower = String(rawText || '').toLowerCase();
  const text = normalizeTitleForMatch(rawText);
  const hints = [];
  const seen = new Set();

  for (const match of rawLower.matchAll(/\b(\d+)\s*\+\s*(\d+)(?:\s*gratis)?\b/g)) {
    addConditionHint(hints, seen, `${match[1]}+${match[2]} gratis`);
  }

  for (const match of text.matchAll(/\b(\d+)\s*(?:fur|fuer)\s*(\d+)\b/g)) {
    addConditionHint(hints, seen, `${match[1]} fuer ${match[2]}`);
  }

  for (const match of text.matchAll(/\bnimm\s+(\d+)\s+zahl\s+(\d+)\b/g)) {
    addConditionHint(hints, seen, `Nimm ${match[1]} zahl ${match[2]}`);
  }

  for (const match of text.matchAll(/\bab\s+(\d+)\s*(stueck|stuck|stk|pkg|packungen?|flaschen?|dosen?)\b/g)) {
    addConditionHint(hints, seen, `ab ${match[1]} ${normalizeConditionUnit(match[2])}`);
  }

  for (const match of text.matchAll(/\bbei\s+(\d+)\s*(stueck|stuck|stk|pkg|packungen?|flaschen?|dosen?)\b/g)) {
    addConditionHint(hints, seen, `bei ${match[1]} ${normalizeConditionUnit(match[2])}`);
  }

  for (const match of text.matchAll(/\b(?:bei\s+kauf\s+von|beim\s+kauf\s+von|kauf\s+von)\s+(\d+)\b/g)) {
    addConditionHint(hints, seen, `bei Kauf von ${match[1]}`);
  }

  for (const match of text.matchAll(/\bim\s+(\d+)er\s+pack\b/g)) {
    addConditionHint(hints, seen, `im ${match[1]}er Pack`);
  }

  if (/\bmultipack\b/.test(text)) {
    addConditionHint(hints, seen, 'Multipack');
  }

  for (const match of rawLower.matchAll(/(?:-|minus\s*)?(\d{1,2})\s*%\s*(?:rabatt\s*)?auf\s+(alle|die gesamte|das gesamte)\s+([a-z0-9a-z\u00c0-\u017f -]{3,80})/g)) {
    const scope = trimScope(`${match[2]} ${match[3]}`);
    addConditionHint(hints, seen, `-${match[1]}% auf ${scope}`);
  }

  for (const match of rawLower.matchAll(/\b(\d{1,2})\s*%\s+rabatt\s+auf\s+([a-z0-9a-z\u00c0-\u017f -]{3,80})/g)) {
    addConditionHint(hints, seen, `${match[1]}% Rabatt auf ${trimScope(match[2])}`);
  }

  if (/\bjeder\s+(?:2\.|zweite)\b/.test(text)) {
    addConditionHint(hints, seen, 'jeder 2.');
  }

  if (/\bnur\s+mit\s+(?:spar\s*)?app\b|\bapp[-\s]?preis\b/.test(text)) {
    addConditionHint(hints, seen, 'nur mit App');
  } else if (/\bmit\s+(?:spar\s*)?app\b/.test(text)) {
    addConditionHint(hints, seen, 'mit App');
  }

  if (/\bnur\s+mit\s+gutschein\b|\bgutschein\b|\bcoupon\b/.test(text)) {
    addConditionHint(hints, seen, text.includes('nur mit gutschein') ? 'nur mit Gutschein' : 'mit Gutschein/Coupon');
  }

  if (/\bkundenkarte\b|\bclub\b|\bjoe\b|\bjo\b/.test(text)) {
    addConditionHint(hints, seen, 'mit Kundenkarte/Club');
  }

  if (/\bnur\s+am\s+freitag\b/.test(text)) addConditionHint(hints, seen, 'nur am Freitag');
  if (/\bnur\s+am\s+samstag\b/.test(text)) addConditionHint(hints, seen, 'nur am Samstag');
  if (/\bfr\.?\s*(?:und|&)\s*sa\.?\b/.test(text)) addConditionHint(hints, seen, 'Fr. und Sa.');

  if (/\bnur\s+in\s+teilnehmenden\s+maerkten\b|\bteilnehmenden\s+maerkten\b/.test(text)) {
    addConditionHint(hints, seen, 'nur in teilnehmenden Maerkten');
  }

  if (/\bnur\s+bei\s+interspar\b/.test(text)) addConditionHint(hints, seen, 'nur bei INTERSPAR');
  if (/\bnur\s+bei\s+eurospar\b/.test(text)) addConditionHint(hints, seen, 'nur bei EUROSPAR');
  if (/\bnur\s+in\s+steiermark\b/.test(text)) addConditionHint(hints, seen, 'nur in Steiermark');
  if (/\bsolange\s+(?:der\s+)?vorrat\s+reicht\b/.test(text)) addConditionHint(hints, seen, 'solange der Vorrat reicht');

  return hints;
}

function buildInferredConditionsText(offer = {}) {
  const parts = [];
  const seen = new Set();

  addConditionHint(parts, seen, offer.conditionsText);
  for (const hint of extractConditionHints(offer)) {
    addConditionHint(parts, seen, hint);
  }

  return parts.join(' / ');
}

function detectCustomerProgramRequired(offer = {}) {
  const haystack = textHaystack(offer);

  return /\b(?:app|app preis|kundenkarte|vorteilskarte|clubpreis|club preis|nur mit karte|karte|konto|rabattmarke|lidl plus|club|jo|joe|payback)\b/.test(haystack);
}

function detectConditionalText(offer = {}) {
  const haystack = textHaystack(offer);

  return /\b(?:solange der vorrat reicht|solange vorrat|beim kauf von|ab \d+|nur mit|app|kundenkarte|vorteilskarte|clubpreis|rabattmarke|gutschein|coupon|teilnehmenden maerkten|nur am)\b/.test(haystack)
    || extractConditionHints(offer).length > 0;
}

function inferConditionFields(offer = {}) {
  const conditionsText = buildInferredConditionsText(offer);
  const requirement = extractPromotionRequirement({
    title: offer.title || '',
    conditionsText,
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
    conditionsText,
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

function hasTechnicalQuantityArtifact(value) {
  return /\$?\b(?:undefined|nan|null)\b|\[object object\]/i.test(String(value || ''));
}

function sanitizePublicQuantityText(value) {
  const raw = sanitizeWhitespace(value);

  if (!raw) {
    return '';
  }

  if (!hasTechnicalQuantityArtifact(raw)) {
    return raw;
  }

  return raw
    .split('/')
    .map((part) => sanitizeWhitespace(part))
    .filter((part) => part && !hasTechnicalQuantityArtifact(part))
    .join(' / ');
}

function sanitizePublicUnitField(value, { safelyComparable = false, artifactContext = false } = {}) {
  const raw = sanitizeWhitespace(value);

  if (!raw || hasTechnicalQuantityArtifact(raw)) {
    return '';
  }

  if (safelyComparable) {
    return raw;
  }

  if (artifactContext && !normalizeComparableUnit(raw)) {
    return '';
  }

  return raw;
}

function buildPublicComparableUnit(offer = {}, { safelyComparable = isOfferSafelyComparable(offer) } = {}) {
  if (!safelyComparable) {
    return '';
  }

  return normalizeComparableUnit(offer.comparableUnit || offer.normalizedUnitPrice?.unit);
}

function sanitizePublicOfferQuantityFields(offer = {}, { safelyComparable = isOfferSafelyComparable(offer) } = {}) {
  const rawQuantityText = String(offer.quantityText || '');
  const artifactContext = hasTechnicalQuantityArtifact(rawQuantityText)
    || hasTechnicalQuantityArtifact(offer.unitType)
    || hasTechnicalQuantityArtifact(offer.comparableUnit)
    || hasTechnicalQuantityArtifact(offer.normalizedUnitPrice?.unit);

  return {
    quantityText: sanitizePublicQuantityText(rawQuantityText),
    unitType: sanitizePublicUnitField(offer.unitType, { safelyComparable, artifactContext }),
    comparableUnit: buildPublicComparableUnit(offer, { safelyComparable }),
  };
}

module.exports = {
  UNIT_UNCLEAR_REASON,
  UNIT_CONFLICT_REASON,
  QUANTITY_INCOMPLETE_REASON,
  PACKAGE_SIZE_UNCLEAR_REASON,
  assessComparableSafety,
  inferConditionFields,
  extractConditionHints,
  isOfferSafelyComparable,
  sanitizePublicOfferQuantityFields,
  sanitizePublicQuantityText,
  normalizeComparableUnit,
};
