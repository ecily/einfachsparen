const { normalizeTitleForMatch, sanitizeWhitespace } = require('../crawl/sourceEvidence');
const { determineCategoryDecision } = require('../crawl/categoryClassifier');

const HOFER_SOURCE_PATTERN = /\bhofer\b/i;
const HOFER_TECHNICAL_TITLE_PATTERN = /^(?:max\.?\s|gr\.?\s|ca\.?\s|kapazit(?:aet|ät)|kochkapazit(?:aet|ät)|umfang\s*:|verschi(?:e|ä)dene\s+(?:farben|groessen|größen|modelle|designs)|(?:und\s+)?modelle\b|beim\s+[„"']?statt|werbetermin\b|t\s*ef\b|tiefpreis\s*$|xxl[- ]?packung\s+sortiments|xxl\s+kefir\s+sortiments|sortiments[- ]?artikel)/i;
const HOFER_UNSAFE_QUANTITY_PATTERN = /(?:belastbarkeit|kapazit(?:aet|ät)|kochkapazit(?:aet|ät)|wassertank|ma(?:ss|ß)e|hoehe|höhe|umfang|durchmesser|seiten|designs?|modelle?|sortimentsartikel|werbetermin|statt[- ]?preis)/i;
const HOFER_QUANTITY_PATTERN = /\b(?:\d+(?:[,.]\d+)?\s*[x×]\s*)?\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|cl)\b/i;
const HOFER_PACKAGE_CONTEXT_PATTERN = /(?:pack(?:ung)?|becher|dose|flasche|beutel|kapsel(?:n)?|portion|glas|tube|stück|stk|[x×])/i;

function isHoferPublitasOffer(offer = {}) {
  const sourceText = [
    offer.retailerKey,
    offer.sourceType,
    offer.sourceKey,
    offer.rawFacts?.sourceType,
    offer.rawFacts?.sourceKey,
    offer.sourceUrl,
  ].filter(Boolean).join(' ');

  return String(offer.retailerKey || '').toLowerCase() === 'hofer'
    || HOFER_SOURCE_PATTERN.test(sourceText);
}

function cleanHoferTitle(value) {
  let title = sanitizeWhitespace(value)
    .replace(/^[\u2022\u00b7]\s*/, '')
    .split(/\s*[\u2022\u00b7]\s*/)[0]
    .replace(/\s*:\s*$/, '')
    .replace(/^\d+\.\s+/, '')
    .trim();

  if (!title || HOFER_TECHNICAL_TITLE_PATTERN.test(title)) {
    return '';
  }

  const normalized = normalizeTitleForMatch(title);
  if (!normalized || normalized.split(/\s+/).every((token) => /^\d+$/.test(token))) {
    return '';
  }

  return title;
}

function isSafeHoferQuantityText(quantityText, title = '') {
  const text = sanitizeWhitespace(`${title} ${quantityText}`);

  return Boolean(
    quantityText
    && HOFER_QUANTITY_PATTERN.test(quantityText)
    && !HOFER_UNSAFE_QUANTITY_PATTERN.test(text)
    && HOFER_PACKAGE_CONTEXT_PATTERN.test(text)
  );
}

function hasHoferPublicQuantityEvidence(offer = {}) {
  return isHoferPublitasOffer(offer)
    && offer.rawFacts?.hoferQuantityEvidence === 'explicit-product-quantity'
    && isSafeHoferQuantityText(offer.quantityText, offer.title);
}

function getHoferDisplayCategory(offer = {}) {
  const title = cleanHoferTitle(offer.title);
  const decision = determineCategoryDecision({
    title,
    contextText: `${title} ${offer.rawFacts?.sourceText || ''}`,
    sourceCategory: '',
  });

  if (
    decision.secondaryCategory
    && decision.primaryCategory !== 'Unkategorisiert'
    && decision.categoryConfidence >= 0.72
  ) {
    return decision.secondaryCategory;
  }

  return 'HOFER Angebot';
}

function getHoferPublicPresentation(offer = {}) {
  const title = cleanHoferTitle(offer.title);
  const safeQuantity = hasHoferPublicQuantityEvidence(offer);

  return {
    title,
    displayCategory: getHoferDisplayCategory(offer),
    quantityText: safeQuantity ? sanitizeWhitespace(offer.quantityText) : '',
    comparable: safeQuantity,
  };
}

module.exports = {
  cleanHoferTitle,
  getHoferDisplayCategory,
  getHoferPublicPresentation,
  hasHoferPublicQuantityEvidence,
  isHoferPublitasOffer,
  isSafeHoferQuantityText,
};
