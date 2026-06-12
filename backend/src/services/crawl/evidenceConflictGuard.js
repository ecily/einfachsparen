const { sanitizeWhitespace, normalizeTitleForMatch } = require('./sourceEvidence');

const PDF_WEB_PRICE_QUANTITY_CONFLICT_REASON = 'pdf-web-price-quantity-conflict';
const PUBLIC_PDF_WEB_PRICE_QUANTITY_HINT = 'Preis/Menge im Angebotsbild pruefen';

const MEAT_FISH_SAUSAGE_TERMS = [
  'bauch',
  'bratfertig',
  'bratwuerstel',
  'cevapcici',
  'faschiert',
  'fisch',
  'fleisch',
  'forelle',
  'goldbrasse',
  'gulasch',
  'hendl',
  'huehner',
  'karree',
  'keulen',
  'minutenschnitzel',
  'polardorsch',
  'reisfleisch',
  'rind',
  'rindsschnitzel',
  'ribs',
  'schopf',
  'schwein',
  'spare',
  'suppenfleisch',
  'wurst',
];

const TITLE_STOP_WORDS = new Set([
  'oder',
  'od',
  'xxl',
  'delikatessa',
  'frisch',
  'frische',
  'fuer',
  'fur',
  'ohne',
  'knochen',
  'geschnitten',
  'stuck',
  'stueck',
  'natur',
  'gewurzt',
  'gewuertzt',
  'gewuetzt',
  'roh',
  'packung',
  'pro',
  'per',
  'kg',
  'gramm',
]);

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const normalized = String(value ?? '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return normalized ? Number(normalized[0]) : null;
}

function roundCurrency(value) {
  return Math.round(Number(value) * 100) / 100;
}

function parseFixedQuantityKg(value) {
  const text = normalizeTitleForMatch(value);
  const match = text.match(/\b(\d+(?:[,.]\d+)?)\s*(kg|kilogramm|g|gramm)\b/);

  if (!match) {
    return null;
  }

  const amount = toNumber(match[1]);

  if (!amount) {
    return null;
  }

  return match[2].startsWith('kg') || match[2] === 'kilogramm'
    ? amount
    : amount / 1000;
}

function hasExplicitPerKgEvidence(pdfEvidence = {}) {
  const evidenceText = normalizeTitleForMatch([
    pdfEvidence.title,
    pdfEvidence.description,
    pdfEvidence.quantityText,
    pdfEvidence.unitText,
    pdfEvidence.priceText,
    pdfEvidence.rawText,
    pdfEvidence.priceBasis,
  ].filter(Boolean).join(' '));

  return /\b(?:pro|je|per)\s*kg\b/.test(evidenceText)
    || /\bkg\s*(?:basis|angebot)\b/.test(evidenceText)
    || (String(pdfEvidence.unit || '').toLowerCase() === 'kg' && /pro|je|per/.test(evidenceText));
}

function titleTokens(value) {
  return normalizeTitleForMatch(value)
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !TITLE_STOP_WORDS.has(token));
}

function hasTightTitleMatch(offer = {}, pdfEvidence = {}) {
  const offerTitle = normalizeTitleForMatch([offer.brand, offer.title].filter(Boolean).join(' '));
  const pdfTitle = normalizeTitleForMatch([pdfEvidence.brand, pdfEvidence.title].filter(Boolean).join(' '));

  if (!offerTitle || !pdfTitle) {
    return false;
  }

  if (offerTitle.includes(pdfTitle) || pdfTitle.includes(offerTitle)) {
    return true;
  }

  const pdfTokens = titleTokens(pdfTitle);
  const offerTokens = new Set(titleTokens(offerTitle));
  const overlap = pdfTokens.filter((token) => offerTokens.has(token)).length;

  return overlap >= Math.min(2, pdfTokens.length);
}

function isVariableWeightFoodArea(offer = {}, pdfEvidence = {}) {
  const text = normalizeTitleForMatch([
    offer.title,
    offer.brand,
    offer.categoryPrimary,
    offer.categorySecondary,
    pdfEvidence.title,
    pdfEvidence.description,
  ].filter(Boolean).join(' '));

  return MEAT_FISH_SAUSAGE_TERMS.some((term) => text.includes(term));
}

function validityOverlaps(offer = {}, pdfEvidence = {}) {
  const offerFrom = offer.validFrom ? new Date(offer.validFrom).getTime() : null;
  const offerTo = offer.validTo ? new Date(offer.validTo).getTime() : null;
  const pdfFrom = pdfEvidence.validFrom ? new Date(pdfEvidence.validFrom).getTime() : null;
  const pdfTo = pdfEvidence.validTo ? new Date(pdfEvidence.validTo).getTime() : null;

  if (!offerFrom || !offerTo || !pdfFrom || !pdfTo) {
    return true;
  }

  return offerFrom <= pdfTo && pdfFrom <= offerTo;
}

function detectPdfWebPriceQuantityConflict({ offer = {}, pdfEvidence = {} } = {}) {
  if (!offer || !pdfEvidence) {
    return { conflict: false, reason: 'missing-evidence' };
  }

  if (!hasExplicitPerKgEvidence(pdfEvidence)) {
    return { conflict: false, reason: 'pdf-not-explicit-per-kg' };
  }

  if (!isVariableWeightFoodArea(offer, pdfEvidence)) {
    return { conflict: false, reason: 'not-variable-weight-food-area' };
  }

  if (!hasTightTitleMatch(offer, pdfEvidence)) {
    return { conflict: false, reason: 'title-mismatch' };
  }

  if (!validityOverlaps(offer, pdfEvidence)) {
    return { conflict: false, reason: 'validity-mismatch' };
  }

  const pdfPrice = toNumber(pdfEvidence.price ?? pdfEvidence.priceCurrent?.amount);
  const webPrice = toNumber(offer.priceCurrent?.amount);
  const webQuantityKg = parseFixedQuantityKg(offer.quantityText);

  if (!pdfPrice || !webPrice || !webQuantityKg) {
    return { conflict: false, reason: 'missing-price-or-quantity' };
  }

  if (webQuantityKg >= 0.75) {
    return { conflict: false, reason: 'web-quantity-not-small-fixed-unit' };
  }

  const expectedFixedPrice = roundCurrency(pdfPrice * webQuantityKg);
  const fixedPriceMatches = Math.abs(expectedFixedPrice - webPrice) <= 0.03;
  const unitPrice = toNumber(offer.normalizedUnitPrice?.amount);
  const unitPriceMatches = unitPrice ? Math.abs(unitPrice - pdfPrice) <= 0.05 : false;

  if (!fixedPriceMatches && !unitPriceMatches) {
    return { conflict: false, reason: 'price-pattern-not-matching', pdfPrice, webPrice, webQuantityKg };
  }

  return {
    conflict: true,
    reason: 'pdf-pro-kg-vs-web-fixed-quantity',
    confidence: fixedPriceMatches && unitPriceMatches ? 'high' : 'medium',
    pdfPrice,
    webPrice,
    webQuantityKg,
    expectedFixedPrice,
    webUnitPrice: unitPrice,
  };
}

function appendUniqueHint(existing, hint) {
  const parts = sanitizeWhitespace(existing)
    .split(/\s*\/\s*/)
    .map((item) => sanitizeWhitespace(item))
    .filter(Boolean);

  if (!parts.includes(hint)) {
    parts.push(hint);
  }

  return parts.join(' / ');
}

function applyPdfWebPriceQuantityConflictGuard(offer = {}, pdfEvidence = {}, { publicHint = true } = {}) {
  const detection = detectPdfWebPriceQuantityConflict({ offer, pdfEvidence });

  if (!detection.conflict) {
    return offer;
  }

  const reviewReasons = Array.isArray(offer.reviewReasons) ? offer.reviewReasons.slice() : [];

  if (!reviewReasons.includes(PDF_WEB_PRICE_QUANTITY_CONFLICT_REASON)) {
    reviewReasons.push(PDF_WEB_PRICE_QUANTITY_CONFLICT_REASON);
  }

  const conditionsText = publicHint
    ? appendUniqueHint(offer.conditionsText, PUBLIC_PDF_WEB_PRICE_QUANTITY_HINT)
    : offer.conditionsText;

  return {
    ...offer,
    conditionsText,
    hasConditions: Boolean(conditionsText) || Boolean(offer.hasConditions),
    needsReview: true,
    reviewReasons,
    rawFacts: {
      ...(offer.rawFacts || {}),
      evidenceConflict: {
        type: PDF_WEB_PRICE_QUANTITY_CONFLICT_REASON,
        confidence: detection.confidence,
        reason: detection.reason,
        pdfPrice: detection.pdfPrice,
        pdfQuantityText: sanitizeWhitespace(pdfEvidence.quantityText || pdfEvidence.unitText || 'pro kg'),
        webPrice: detection.webPrice,
        webQuantityText: sanitizeWhitespace(offer.quantityText),
        webUnitPrice: detection.webUnitPrice ?? null,
      },
    },
  };
}

module.exports = {
  PDF_WEB_PRICE_QUANTITY_CONFLICT_REASON,
  PUBLIC_PDF_WEB_PRICE_QUANTITY_HINT,
  detectPdfWebPriceQuantityConflict,
  applyPdfWebPriceQuantityConflictGuard,
};
