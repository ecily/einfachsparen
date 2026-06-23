const { PDFParse } = require('pdf-parse');
const {
  sanitizeWhitespace,
  normalizeTitleForMatch,
  buildSourceEvidence,
} = require('./sourceEvidence');
const {
  PDF_CATEGORY_MISMATCH_REVIEW_REASON,
  buildPdfSourceMetadata,
  detectPdfCategoryMismatchReviewSignal,
  normalizePdfText,
} = require('./pdfOfferParsing');
const {
  determineOfferCategory,
  determineOfferSubcategory,
  buildInclusiveScopeDecision,
} = require('./categoryClassifier');
const { inferAustrianBeerCrateQuantityFields } = require('./offerQualityGuards');
const { applyManualCategoryOverridesToOfferSync } = require('../quality/manualCategoryOverrideService');
const { normalizeImageUrl } = require('../images/imageUrl');
const { extractOfficialFlyerValidityFromPages } = require('./officialFlyerValidity');
const { extractSparFamilyPdfLayoutCandidates } = require('./sparFamilyPdfLayoutExtractor');
const { getStaticSparPdfCropForCandidate } = require('./sparPdfStaticImageCrops');

const PARSER_VERSION = 'spar-official-flyer-pdf-v6';
const SOURCE_TYPE = 'spar-official-pdf';
const MAX_PDF_BYTES = 60 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 6;

const SOURCE_KEYS_BY_FORMAT = {
  spar: 'spar-official-flyer-pdf',
  eurospar: 'eurospar-official-flyer-pdf',
  interspar: 'interspar-official-flyer-pdf',
};

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseAustrianDate(day, month, year = 2026) {
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
}

function buildKey(value, fallback = '') {
  return normalizeTitleForMatch(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function normalizeForScan(value) {
  return normalizePdfText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

function money(amount) {
  const number = Number(amount);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

function priceFromUnitPrice(quantityText, unitPriceText) {
  const quantityMatch = normalizeForScan(quantityText).match(/\b(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l)\b/i);
  const unitPrice = Number(String(unitPriceText || '').replace(',', '.'));

  if (!quantityMatch || !Number.isFinite(unitPrice) || unitPrice <= 0) {
    return null;
  }

  let quantity = Number(quantityMatch[1].replace(',', '.'));
  let unit = quantityMatch[2].toLowerCase();

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  if (unit === 'g') quantity /= 1000;
  if (unit === 'ml') quantity /= 1000;

  return money(quantity * unitPrice);
}

function parseQuantity(quantityText) {
  const normalized = normalizeForScan(quantityText);
  const multipackMatch = normalized.match(/\b(\d+)\s*x\s*(\d+(?:[,.]\d+)?)\s*-?\s*(kg|g|l|liter|ml)\b/i);

  if (multipackMatch) {
    const packCount = Number(multipackMatch[1]);
    let unitValue = Number(multipackMatch[2].replace(',', '.'));
    let unit = multipackMatch[3].toLowerCase();

    if (unit === 'liter') unit = 'l';

    if (!Number.isFinite(packCount) || packCount <= 0 || !Number.isFinite(unitValue) || unitValue <= 0) {
      return {
        packCount: null,
        unitValue: null,
        unitType: '',
        totalComparableAmount: null,
        comparableUnit: '',
      };
    }

    let comparableUnit = unit;
    let totalComparableAmount = packCount * unitValue;

    if (unit === 'g') {
      comparableUnit = 'kg';
      totalComparableAmount = (packCount * unitValue) / 1000;
    }

    if (unit === 'ml') {
      comparableUnit = 'l';
      totalComparableAmount = (packCount * unitValue) / 1000;
    }

    return {
      packCount,
      unitValue,
      unitType: unit,
      totalComparableAmount,
      comparableUnit,
    };
  }

  const match = normalized.match(/\b(\d+(?:[,.]\d+)?)\s*-?\s*(kg|g|l|ml|kapseln|kapsel|stk|stueck|waschgange|waschgaenge|waschgang)\b/i);

  if (!match) {
    return {
      packCount: null,
      unitValue: null,
      unitType: '',
      totalComparableAmount: null,
      comparableUnit: '',
    };
  }

  let value = Number(match[1].replace(',', '.'));
  let unit = match[2].toLowerCase();

  if (!Number.isFinite(value) || value <= 0) {
    return {
      packCount: null,
      unitValue: null,
      unitType: '',
      totalComparableAmount: null,
      comparableUnit: '',
    };
  }

  if (unit === 'stueck') unit = 'stk';
  if (unit === 'kapsel') unit = 'kapseln';
  if (unit === 'waschgange' || unit === 'waschgaenge') unit = 'waschgang';

  let comparableUnit = unit;
  let totalComparableAmount = value;

  if (unit === 'g') {
    comparableUnit = 'kg';
    totalComparableAmount = value / 1000;
  }

  if (unit === 'ml') {
    comparableUnit = 'l';
    totalComparableAmount = value / 1000;
  }

  if (!['kg', 'l', 'stk', 'kapseln', 'waschgang'].includes(comparableUnit)) {
    comparableUnit = '';
    totalComparableAmount = null;
  }

  return {
    packCount: null,
    unitValue: value,
    unitType: unit === 'stk' ? 'Stk' : unit,
    totalComparableAmount,
    comparableUnit: comparableUnit === 'stk' ? 'Stk' : comparableUnit,
  };
}

function buildNormalizedUnitPrice({ price, quantityText, comparisonSafe, context = {} }) {
  const inferredCrateQuantity = inferAustrianBeerCrateQuantityFields({
    ...context,
    quantityText,
  });
  const quantity = inferredCrateQuantity || parseQuantity(quantityText);
  const effectiveComparisonSafe = Boolean(comparisonSafe || inferredCrateQuantity);

  if (!effectiveComparisonSafe || !price || !quantity.totalComparableAmount || !['kg', 'l', 'Stk', 'waschgang'].includes(quantity.comparableUnit)) {
    return {
      quantity,
      normalizedUnitPrice: {
        amount: null,
        unit: '',
        comparable: false,
        confidence: 0,
      },
    };
  }

  return {
    quantity,
    normalizedUnitPrice: {
      amount: money(price / quantity.totalComparableAmount),
      unit: quantity.comparableUnit,
      comparable: true,
      confidence: 0.82,
    },
  };
}

function inferValidity(candidate, fallbackValidity = {}) {
  if (candidate.validFromOverride || candidate.validToOverride) {
    const validFrom = candidate.validFromOverride || fallbackValidity.validFrom || null;
    const validTo = candidate.validToOverride || fallbackValidity.validTo || null;
    return {
      validFrom,
      validTo,
      validityText: [dateKey(validFrom), dateKey(validTo)].filter(Boolean).join(' - '),
      validitySource: 'offer-level-pdf-condition',
      confidence: 0.86,
    };
  }

  return {
    validFrom: fallbackValidity.validFrom || null,
    validTo: fallbackValidity.validTo || null,
    validityText: [dateKey(fallbackValidity.validFrom), dateKey(fallbackValidity.validTo)].filter(Boolean).join(' - '),
    validitySource: fallbackValidity.validitySource || '',
    confidence: fallbackValidity.validityConfidence ?? (fallbackValidity.validFrom && fallbackValidity.validTo ? 0.82 : 0),
  };
}

function buildOfferStatus(validFrom, validTo) {
  const now = new Date();

  if (validFrom && validFrom > now) {
    return { status: 'upcoming', isActiveNow: false, isActiveToday: false };
  }

  if (validTo && validTo < now) {
    return { status: 'expired', isActiveNow: false, isActiveToday: false };
  }

  return {
    status: validFrom || validTo ? 'active' : 'unknown',
    isActiveNow: Boolean(validFrom || validTo),
    isActiveToday: Boolean(validFrom || validTo),
  };
}

function sourceKeyForFormat(format) {
  return SOURCE_KEYS_BY_FORMAT[format] || SOURCE_KEYS_BY_FORMAT.spar;
}

function sourceRetailerNameForFormat(format) {
  if (format === 'interspar') return 'INTERSPAR';
  if (format === 'eurospar') return 'EUROSPAR';
  return 'SPAR';
}

function addRejectedCandidate(candidates, pageNumber, reason, rawText, metadata = {}) {
  candidates.push({
    id: `spar-p${pageNumber}-rejected-${candidates.length + 1}`,
    page: pageNumber,
    blockIndex: metadata.blockIndex ?? null,
    stage: metadata.stage || metadata.parserHint || 'pdf-candidate-filter',
    title: '',
    brand: '',
    price: null,
    quantityText: '',
    conditionsText: '',
    rawText: sanitizeWhitespace(rawText).slice(0, 700),
    exclusionReason: reason,
  });
}

function addCandidate(candidates, pageNumber, data) {
  const candidate = {
    id: `spar-p${pageNumber}-${candidates.length + 1}`,
    page: pageNumber,
    productKind: 'coffee',
    ...data,
  };

  if (!candidate.title || !(candidate.price > 0)) {
    candidate.exclusionReason = candidate.title ? 'missing-price' : 'unclear-product';
  } else if (!candidate.quantityText) {
    candidate.exclusionReason = 'missing-quantity';
  }

  candidates.push(candidate);
}

function normalizePriceText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parsePriceAmountFromLine(line = '') {
  const text = normalizePriceText(line);

  if (!text || /(?:per|\/)\s*(?:kg|g|l|ml|stk|stueck|stuck)|statt|gueltig|gültig|bis\s+di|bis\s+mi|bis\s+sa|%/i.test(text)) {
    return null;
  }

  const match = text.match(/(?:^|(?:nur|je|preis|um)\s+)(\d{1,3}[,.]\d{2})(?:\s*(?:eur|euro)?)?$/i)
    || text.match(/^(\d{1,3}[,.]\d{2})$/);

  if (!match) {
    return null;
  }

  const amount = Number(match[1].replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? money(amount) : null;
}

function parseReferencePriceFromBlock(blockLines = []) {
  const text = normalizePriceText(blockLines.join(' '));
  const match = text.match(/\bstatt\s+(\d{1,3}[,.]\d{2})\b/i);
  return match ? money(Number(match[1].replace(',', '.'))) : null;
}

function extractQuantityTextFromBlock(blockLines = []) {
  const text = normalizePriceText(blockLines.join(' '));
  const xPackMatch = text.match(/\b\d+\s*x\s*\d+(?:[,.]\d+)?[-\s]*(?:kg|g|l|liter|ml)\b/i);
  if (xPackMatch) return sanitizeWhitespace(xPackMatch[0]).replace(',', '.').replace(/\bliter\b/i, 'l');

  const packMatch = text.match(/\b\d+(?:[,.]\d+)?[-\s]*(?:kg|g|l|liter|ml|stk|stueck|kapseln|waschg.nge|waschgänge|waschgaenge|waschgang)\b/i);
  if (packMatch) return sanitizeWhitespace(packMatch[0]).replace(',', '.').replace(/\bliter\b/i, 'l');

  const packageMatch = text.match(/\b\d+(?:[,.]\d+)?[-\s]?(?:kg|g|l|liter|ml)[-\s]?(?:packung|flasche|dose|beutel|glas|pkg)\b/i);
  if (packageMatch) {
    const quantity = packageMatch[0].match(/\d+(?:[,.]\d+)?[-\s]?(?:kg|g|l|liter|ml)/i)?.[0] || '';
    return sanitizeWhitespace(quantity).replace(',', '.').replace(/\bliter\b/i, 'l');
  }

  const unitPriceMatch = text.match(/\bper\s+(kg|kilogramm|l|liter|100\s*g|100\s*ml)\b/i);
  if (unitPriceMatch) {
    const unit = normalizeForScan(unitPriceMatch[1]);
    if (unit === 'kg' || unit === 'kilogramm') return '1 kg';
    if (unit === 'l' || unit === 'liter') return '1 l';
    if (unit === '100 g') return '100 g';
    if (unit === '100 ml') return '100 ml';
  }

  return '';
}

function isSparFamilyPdfFormat(sourceRetailerFormat = '') {
  return ['spar', 'eurospar', 'interspar'].includes(String(sourceRetailerFormat || '').toLowerCase());
}

function isTrustedRadieschenFreshLine(line = '') {
  const normalized = normalizeForScan(line);

  return /\bradieschen\b/.test(normalized) &&
    /\bbund\b/.test(normalized) &&
    (
      /\baus\s+(?:oesterreich|osterreich)\b/.test(normalized) ||
      /\baus\s+\S*sterreich\b/i.test(line)
    );
}

function isClearFreshRadieschenBoundaryLine(line = '') {
  const text = String(line || '');
  const normalized = normalizeForScan(text);

  if (!normalized || isTrustedRadieschenFreshLine(text)) {
    return false;
  }

  return /\bblue\s+star\b/.test(normalized)
    || /\bwc\b/.test(normalized)
    || /\b(?:spuelkasten|sp.lkasten)\w*/.test(normalized)
    || /\bduft\w*/.test(normalized)
    || /\breinigung\w*/.test(normalized)
    || /\bhygiene\b/.test(normalized);
}

function buildTrustedFreshRadieschenBlockLines(blockLines = [], freshIndex = -1, price = null) {
  if (freshIndex < 0) {
    return [];
  }

  const result = [blockLines[freshIndex]];
  const priceIndex = blockLines.findIndex((line) => parsePriceAmountFromLine(line) === price);

  if (
    priceIndex >= 0 &&
    priceIndex !== freshIndex &&
    Math.abs(priceIndex - freshIndex) <= 2 &&
    !isClearFreshRadieschenBoundaryLine(blockLines[priceIndex])
  ) {
    result.push(blockLines[priceIndex]);
  }

  return result;
}

function buildTrustedFreshCandidateFromMergedBlock(blockLines = [], price = null, { sourceRetailerFormat = 'spar' } = {}) {
  if (!(Number(price) > 0)) {
    return null;
  }

  if (!isSparFamilyPdfFormat(sourceRetailerFormat)) {
    return null;
  }

  const freshIndex = blockLines.findIndex(isTrustedRadieschenFreshLine);
  const freshLine = blockLines[freshIndex];

  if (!freshLine) {
    return null;
  }

  const productBlockLines = buildTrustedFreshRadieschenBlockLines(blockLines, freshIndex, price);

  const title = sanitizeWhitespace(
    freshLine
      .replace(/\bangebot\s+g(?:Ã¼|u|ue|ü)ltig\b.*$/i, '')
      .replace(/\bper\s+bund\b.*$/i, '')
      .replace(/[,.]\s*$/, '')
  );

  if (!/\bradieschen\b/i.test(title) || !/\bbund\b/i.test(title)) {
    return null;
  }

  return {
    productKind: 'generic-flyer-product',
    title,
    brand: /^spar\b/i.test(title) ? 'SPAR' : title.split(/\s+/)[0] || '',
    price,
    referencePrice: parseReferencePriceFromBlock(productBlockLines),
    quantityText: '1 Bund',
    conditionsText: extractGenericConditionsText(productBlockLines),
    rawText: productBlockLines.join(' '),
    comparisonSafe: false,
    parserHint: 'generic-text-layer-price-block',
    searchKeywords: `${title} Radieschen Bund Aus Oesterreich Obst Gemuese`,
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Obst & Gemuese',
    categoryKey: 'obst-gemuese',
  };
}

function looksLikeNonProductLine(line = '') {
  const normalized = normalizeForScan(line);

  return !normalized
    || normalized.length < 3
    || /\bersparnis\b/i.test(normalized)
    || /^bis\s+zu\b/i.test(normalized)
    || /\bangebote?\s+gueltig\b/i.test(normalized)
    || /^statt\s+\d{1,3}[,.]\d{2}\b/i.test(normalized)
    || /^(?:statt|per|= per|angebot|aktion|gueltig|gilt|noch|zusaetzlich|mengenvorteil|im einzelverkauf|ab \d+|je|nur|-?\d+\s*%|seite \d+)$/i.test(normalized)
    || /^\d{1,3}[,.]\d{2}$/.test(normalized)
    || /\b(?:do|fr|sa|so|mo|di|mi)[,.]?\s*\d{1,2}[,.]\d{1,2}/i.test(normalized);
}

function lineContainsQuantity(line = '') {
  return /\b\d+(?:[,.]\d+)?[-\s]*(?:kg|g|l|liter|ml|stk|stueck|kapseln|waschg.nge|waschgänge|waschgaenge|waschgang)\b/i.test(line)
    || /\b\d+(?:[,.]\d+)?[-\s]?(?:kg|g|l|liter|ml)[-\s]?(?:packung|flasche|dose|beutel|glas|pkg)\b/i.test(line);
}

function buildGenericTitle(blockLines = []) {
  const titleLines = [];

  for (const line of blockLines) {
    if (looksLikeNonProductLine(line)) continue;
    if (/^\(?=?\s*per\s+(?:kg|l|100\s*g|100\s*ml)/i.test(line)) continue;
    if (/^\d+\s*(?:pkg|ds|fl|flaschen|dosen)\.?/i.test(line)) continue;

    titleLines.push(line);

    if (lineContainsQuantity(line) && titleLines.length > 1) {
      break;
    }
  }

  const rawTitle = titleLines
    .join(' ')
    .replace(/^(?:do|fr|sa|so|mo|di|mi)[.,]*\s*\d{1,2}[.,]\d{1,2}\.?(?:\s*und\s*(?:do|fr|sa|so|mo|di|mi)[.,]*\s*\d{1,2}[.,]\d{1,2}\.?)?(?:\s*\d{2,4})?\s*/i, '')
    .replace(/^\d{1,3}[,.]\d{2}\s*\([^)]*\)\s*/i, '')
    .replace(/^ab\s+\d+\s+\S+\s+je\s+\d{1,3}[,.]\d{2}\s*/i, '')
    .replace(/^jetzt\s+probieren!?\s*/i, '')
    .replace(/^\(?=?\s*per\s+(?:kg|l|liter|100\s*g|100\s*ml)\s+\d{1,3}[,.]\d{2}\)?\s*/i, '')
    .replace(/\b\d+(?:[,.]\d+)?[-\s]*(?:kg|g|l|liter|ml|stk|stueck|kapseln|waschgaenge|waschgang)\b.*$/i, '')
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|liter|ml|stk|stueck|kapseln|waschg.nge|waschgänge|waschgaenge|waschgang)\b.*$/i, '')
    .replace(/\b(?:ganze bohne|gemahlen|packung|flasche|dose|beutel|glas)\b[,\s]*$/i, '')
    .trim();

  return sanitizeWhitespace(rawTitle);
}

function hasUnsafeGenericTitleStart(title = '') {
  const normalized = normalizeForScan(title);
  const cleanTitle = sanitizeWhitespace(title);

  if (/^(?:abgabe\s+nur|seite\s+(?:xx|\d+)|angebote?\s+g(?:ue|u)ltig|gueltig|gultig|in\s+selbstbedienung|nur\s*f(?:ue|u)r\s+kurze\s+zeit)\b/i.test(normalized)) {
    return true;
  }
  if (/^-?\d{1,2}\s*%\s*-?\d{0,2}\s*%?\s*auf\s+alle\b/i.test(normalized)) {
    return true;
  }

  return /^[a-zäöüß]/.test(cleanTitle)
    || /^(?:mit|natur\s+xxl|geraeuchert|gerauchert|gefüllt|gefuellt|in\s+bedienung|per\s+kg)\b/i.test(normalized)
    || /^(?:statt|aktion|ersparnis|bis\s+zu|gratis|artikel|neubei|immer\s+billig|preisgesenkt|olen|versch|oder)\b/i.test(normalized)
    || /^f.{1,4}r\s+jeden\s+geschmack\b/i.test(cleanTitle)
    || /^(?:fuer|für)\s+jeden\s+geschmack\b/i.test(normalized)
    || /^alles\s+selbstgemacht\b/i.test(normalized)
    || /^(?:smoothieflasche|geradehalsflaschen)\b/i.test(normalized)
    || /\bimmer\s+billig\b/i.test(normalized);
}

function hasPlausibleProductCoreAfterMarketingPrefix(title = '') {
  const normalized = normalizeForScan(title);
  const meaningfulWords = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !/^(?:versch|verschiedene|sorten|oder|und|ganze|bohne|gemahlen|packung|pkg)$/.test(word));

  return meaningfulWords.length >= 2;
}

function stripGenericPriceReducedMarketingPrefix(title = '', { price = null, quantityText = '' } = {}) {
  const cleanTitle = sanitizeWhitespace(title);

  if (!(Number(price) > 0) || !quantityText) {
    return cleanTitle;
  }

  const match = cleanTitle.match(/^preis\s*gesenkt\s+seit\s+\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*(?:\d{2}|\d{4})\s+(.+)$/i);
  if (!match) {
    return cleanTitle;
  }

  const strippedTitle = sanitizeWhitespace(match[1]);
  if (
    !hasPlausibleProductCoreAfterMarketingPrefix(strippedTitle)
    || !isPlausibleGenericFlyerTitle(strippedTitle)
    || hasUnsafeGenericTitleStart(strippedTitle)
  ) {
    return cleanTitle;
  }

  return strippedTitle;
}

function keepSafeCleanedGenericTitle(originalTitle = '', cleanedTitle = '') {
  const original = sanitizeWhitespace(originalTitle);
  const cleaned = sanitizeWhitespace(cleanedTitle);

  return cleaned !== original
    && hasPlausibleProductCoreAfterMarketingPrefix(cleaned)
    && isPlausibleGenericFlyerTitle(cleaned)
    && !hasUnsafeGenericTitleStart(cleaned);
}

function stripGenericPdfTitleFragments(title = '') {
  const cleanTitle = sanitizeWhitespace(title);
  const candidates = [
    cleanTitle.replace(/^seite\s+(?:xx|\d+)\s+stattpreise\s+sind\s+unsere\s+bisherigen\s+verkaufspreise\s+in\s+spar-m(?:ä|ae)rkten\.\s*/i, ''),
    cleanTitle
      .replace(/^seite\s+(?:xx|\d+)\s+qualität\s*&\s*frische\s+zu\s*/i, '')
      .replace(/^aktuell!\s*/i, ''),
    cleanTitle.replace(/^nur\s*f(?:ür|uer|ur)\s+kurze\s+zeit!\s*/i, ''),
    cleanTitle.replace(/^angebote?\s+gültig\s+bei\s+\d+\s+[^.]{0,80}\.\s*/i, ''),
    cleanTitle.replace(/\s+niedrigster\s+30-tage-preis\s+\d{1,3}[,.]\d{2}\s+aktion!?\s*\d+\s*$/i, ''),
    cleanTitle.replace(/\s+aktion!?\s*\d{2,}\s*$/i, ''),
  ];

  for (const candidate of candidates) {
    if (keepSafeCleanedGenericTitle(cleanTitle, candidate)) {
      return sanitizeWhitespace(candidate);
    }
  }

  return cleanTitle;
}

function hasGenericMergeRisk(blockLines = [], quantityText = '') {
  if (!quantityText) return false;

  const text = normalizeForScan(blockLines.join(' '));
  const quantity = normalizeForScan(quantityText);
  const quantityIndex = text.indexOf(quantity);
  if (quantityIndex < 0) return false;

  const afterQuantity = text.slice(quantityIndex + quantity.length);
  return /\bangebote?\s+g.{0,6}ltig\b/i.test(afterQuantity)
    || /\bstattpreise\s+sind\b/i.test(afterQuantity)
    || /\baktionen\s+nicht\s+g.{0,6}ltig\b/i.test(afterQuantity);
}

function extractGenericConditionsText(blockLines = []) {
  const text = normalizePriceText(blockLines.join(' '));
  const conditions = [];

  if (/\b1\s*\+\s*1\s*gratis\b/i.test(text)) conditions.push('1+1 gratis');
  if (/\b2\s*\+\s*1\s*gratis\b/i.test(text) || /\b2\s*\+\s*1\b/i.test(text)) conditions.push('2+1 gratis');
  if (/\b3\s*\+\s*3\s*gratis\b/i.test(text) || /\b3\s*\+\s*3\b/i.test(text)) conditions.push('3+3 gratis');
  if (/\b12\s*\+\s*12\s*gratis\b/i.test(text) || /\b12\s*\+\s*12\b/i.test(text)) conditions.push('12+12 gratis');

  const threshold = text.match(/\b(?:ab|bei)\s+(\d+)\s*(?:stk|stueck|fl|flaschen|ds|dosen|pkg|packungen|gl|glaeser)?\.?\s+(?:je\s+)?\d{1,3}[,.]\d{2}\b/i);
  if (threshold) conditions.push(`ab/bei ${threshold[1]} Stueck laut Flugblatt`);

  return sanitizeWhitespace([...new Set(conditions)].join(' / '));
}

function isPlausibleGenericFlyerTitle(title = '') {
  const cleanTitle = sanitizeWhitespace(title);
  const normalized = normalizeForScan(cleanTitle);
  const words = normalized.split(/\s+/).filter(Boolean);

  if (!cleanTitle || cleanTitle.length > 180) return false;
  if (!/\p{L}/u.test(cleanTitle)) return false;
  if (words.length < 2 && cleanTitle.length < 12) return false;
  if (/\bangebote?\s+g(?:ue|u)ltig\b/i.test(normalized)) return false;
  if (/^(?:frische|starke)\s+angebote\b/i.test(normalized)) return false;
  if (/^-?\d{1,2}\s*%\s*-?\d{0,2}\s*%?\s*auf\b/i.test(normalized)) return false;

  return !(
    /\bangebote?\s+gueltig\b/i.test(normalized)
    || /so\s+spart\s+oesterreich/i.test(normalized)
    || /so\s+spart\s+osterreich/i.test(normalized)
    || /^(?:ersparnis|bis\s+zu|aktion|statt|mit\s+%-?aktion)\b/i.test(normalized)
    || /^-?\s*\d{1,2}\s*%\s+auf\b/i.test(normalized)
    || /^(?:1\/2\s+preis|halbpreis|rabattmarken?|prozentpickerl|joker)\b/i.test(normalized)
    || /\bauf\s+alle\s+(?:elektrische\s+)?(?:haushaltsprodukte|haushaltsgeraete|haushaltsgerate|artikel|produkte)\b/i.test(normalized)
    || /^ab\s+\d+\b/i.test(normalized)
    || /^ganze\s+bohne\s+oder$/i.test(normalized)
    || /^aus\s+oesterreich\b/i.test(normalized)
    || /^aus\s+osterreich\b/i.test(normalized)
    || /^gef(?:u|ue)llt\s+mit\b/i.test(normalized)
    || /^tem\s+kunststoff\b/i.test(normalized)
    || /^nahrung\s+versch\b/i.test(normalized)
  );
}

function hasExplicitQuantityHint(text = '') {
  return /\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|liter|ml|stk|stueck|kapseln|waschg.nge|waschgÃ¤nge|waschgaenge|waschgang|packungen?|pkg|flaschen?|dosen?|beutel|rollen?)\b/i.test(text)
    || /\b\d+\s*x\s*\d+(?:[,.]\d+)?\s*(?:kg|g|l|liter|ml)\b/i.test(text);
}

function hasCriticalFoodOrDrinkSignal(title = '') {
  const normalized = normalizeForScan(title);

  return /\b(joghurt|jogurt|milch|butter|kaese|kase|wurst|schinken|fleisch|huhn|pute|rind|schwein|fisch|lachs|brot|semmel|toast|nudeln|pasta|reis|mehl|zucker|schokolade|kekse|chips|bier|radler|wein|sekt|wasser|cola|limonade|saft|sirup|kaffee|espresso|tee)\b/.test(normalized)
    && !/\b(kaffeevollautomat|kaffee vollautomat|kaffeemaschine|espressoautomat)\b/.test(normalized);
}

function hasNonFoodPieceSignal(title = '', blockLines = []) {
  const normalized = normalizeForScan([title, ...blockLines].join(' '));

  return /\b(kaffeevollautomat|kaffee vollautomat|kaffeemaschine|espressoautomat|heissluftfritteuse|heisluftfritteuse|optigrill|kontaktgrill|akkusauger|akku sauger|staubsauger|handstaubsauger|dampfglatter|dampfglaetter|dampfglÃ¤tter|aerosteam|einweghandschuhe|reinigungstucher|reinigungstuecher|putztucher|putztuecher|wischtucher|wischtuecher|sloggi|slip|tai|midi|maxi)\b/.test(normalized);
}

function inferSparFamilyNonFoodPieceQuantity({
  title = '',
  blockLines = [],
  sourceRetailerFormat = 'spar',
} = {}) {
  if (!isSparFamilyPdfFormat(sourceRetailerFormat)) {
    return '';
  }

  if (!title || hasCriticalFoodOrDrinkSignal(title) || !hasNonFoodPieceSignal(title, blockLines)) {
    return '';
  }

  if (hasExplicitQuantityHint(blockLines.join(' '))) {
    return '';
  }

  return '1 Stueck';
}

function isTrustedSparFamilyNonFoodGenericCandidate(candidate = {}, categoryPrimary = '', categorySecondary = '') {
  if (candidate.productKind !== 'generic-flyer-product') {
    return false;
  }

  if (!isSparFamilyPdfFormat(candidate.sourceRetailerFormat)) {
    return false;
  }

  if (!candidate.title || !(Number(candidate.price) > 0) || !candidate.quantityText) {
    return false;
  }

  if (!hasNonFoodPieceSignal(candidate.title, [candidate.rawText || ''])) {
    return false;
  }

  const allowedPrimaryCategories = new Set([
    'Haushalt',
    'Technik / Elektronik',
    'Kleidung / Mode',
    'Drogerie / Hygiene',
    'Non-Food',
  ]);

  return allowedPrimaryCategories.has(categoryPrimary)
    && categoryPrimary !== 'Unkategorisiert'
    && categorySecondary !== 'Unkategorisiert';
}

function extractGenericFlyerCandidatesFromPage(page, { sourceRetailerFormat = 'spar' } = {}) {
  const text = String(page.text || '').replace(/\u00a0/g, ' ');
  const lines = text
    .split(/\r?\n/)
    .map(sanitizeWhitespace)
    .filter(Boolean);
  const candidates = [];

  for (let index = 0; index < lines.length; index += 1) {
    const price = parsePriceAmountFromLine(lines[index]);

    if (!(price > 0)) {
      continue;
    }

    let start = Math.max(0, index - 7);
    for (let previous = index - 1; previous >= start; previous -= 1) {
      if (parsePriceAmountFromLine(lines[previous])) {
        start = previous + 1;
        break;
      }
    }
    const end = Math.min(lines.length, index + 4);
    const blockLines = lines.slice(start, end);
    const trustedFreshCandidate = buildTrustedFreshCandidateFromMergedBlock(blockLines, price, {
      sourceRetailerFormat,
    });

    if (trustedFreshCandidate) {
      addCandidate(candidates, page.pageNumber, trustedFreshCandidate);
      continue;
    }

    const rawTitle = buildGenericTitle(blockLines);
    const extractedQuantityText = extractQuantityTextFromBlock(blockLines);
    const fallbackQuantityText = !extractedQuantityText
      ? inferSparFamilyNonFoodPieceQuantity({
        title: rawTitle,
        blockLines,
        sourceRetailerFormat,
      })
      : '';
    const quantityText = extractedQuantityText || fallbackQuantityText;
    const title = stripGenericPdfTitleFragments(
      stripGenericPriceReducedMarketingPrefix(rawTitle, { price, quantityText })
    );
    const genericConditionsText = extractGenericConditionsText(blockLines);

    if (!isPlausibleGenericFlyerTitle(title)) {
      addRejectedCandidate(candidates, page.pageNumber, 'generic-unclear-product', blockLines.join(' '), {
        blockIndex: index,
        parserHint: 'generic-text-layer-price-block',
      });
      continue;
    }

    if (hasUnsafeGenericTitleStart(title)) {
      addRejectedCandidate(candidates, page.pageNumber, 'generic-fragment-title', blockLines.join(' '), {
        blockIndex: index,
        parserHint: 'generic-text-layer-price-block',
      });
      continue;
    }

    if (!quantityText) {
      addRejectedCandidate(candidates, page.pageNumber, 'generic-missing-quantity', blockLines.join(' '), {
        blockIndex: index,
        parserHint: 'generic-text-layer-price-block',
      });
      continue;
    }

    if (hasGenericMergeRisk(blockLines, quantityText)) {
      addRejectedCandidate(candidates, page.pageNumber, 'generic-merge-risk', blockLines.join(' '), {
        blockIndex: index,
        parserHint: 'generic-text-layer-price-block',
      });
      continue;
    }

    addCandidate(candidates, page.pageNumber, {
      productKind: 'generic-flyer-product',
      sourceRetailerFormat,
      title,
      brand: title.split(/\s+/)[0] || '',
      price,
      referencePrice: parseReferencePriceFromBlock(blockLines),
      quantityText,
      conditionsText: genericConditionsText,
      rawText: blockLines.join(' '),
      comparisonSafe: fallbackQuantityText ? false : true,
      quantityFallbackReason: fallbackQuantityText ? 'spar-family-non-food-piece' : '',
      parserHint: 'generic-text-layer-price-block',
    });
  }

  return candidates;
}

const OVERLAP_STOP_TOKENS = new Set([
  'ab',
  'aktion',
  'bei',
  'big',
  'der',
  'die',
  'das',
  'ein',
  'eine',
  'einer',
  'fuer',
  'je',
  'laut',
  'mit',
  'oder',
  'pack',
  'pkg',
  'spar',
  'statt',
  'und',
  'versch',
  'verschiedene',
  'von',
]);

function significantOverlapTokens(value = '') {
  return new Set(
    normalizeTitleForMatch(value)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !OVERLAP_STOP_TOKENS.has(token))
  );
}

function countTokenOverlap(leftTokens, rightTokens) {
  let count = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) count += 1;
  }
  return count;
}

function genericCandidateOverlapsKnown(candidate = {}, knownCandidates = []) {
  if (!candidate || candidate.exclusionReason) return false;

  const candidateTitle = normalizeTitleForMatch(candidate.title || '');
  const candidateTokens = significantOverlapTokens(candidate.title || '');
  const candidateQuantity = parseQuantity(candidate.quantityText || '');
  const candidateQuantityKey = candidateQuantity.comparableUnit && candidateQuantity.totalComparableAmount
    ? `${candidateQuantity.comparableUnit}:${candidateQuantity.totalComparableAmount}`
    : normalizeTitleForMatch(candidate.quantityText || '');
  const candidatePrice = Number(candidate.price || 0);

  return knownCandidates.some((known) => {
    if (!known || known.exclusionReason) return false;
    if (Number(known.price || 0) !== candidatePrice) return false;
    const knownQuantity = parseQuantity(known.quantityText || '');
    const knownQuantityKey = knownQuantity.comparableUnit && knownQuantity.totalComparableAmount
      ? `${knownQuantity.comparableUnit}:${knownQuantity.totalComparableAmount}`
      : normalizeTitleForMatch(known.quantityText || '');
    if (knownQuantityKey !== candidateQuantityKey) return false;

    const knownTitle = normalizeTitleForMatch(known.title || '');
    const knownBrand = normalizeTitleForMatch(known.brand || '');
    const knownTokens = significantOverlapTokens(`${known.title || ''} ${known.brand || ''}`);
    const overlapCount = countTokenOverlap(candidateTokens, knownTokens);

    return Boolean(
      knownTitle
      && (
        candidateTitle.includes(knownTitle)
        || knownTitle.includes(candidateTitle)
        || (knownBrand && candidateTitle.includes(knownBrand))
        || overlapCount >= 2
      )
    );
  });
}

function beerCandidate(data = {}) {
  return {
    productKind: 'beer',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    searchKeywords: 'bier maerzen marzen pils radler lager hell helles flaschenbier dosenbier',
    ...data,
  };
}

function sweetCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Suesswaren & Knabbereien',
    categoryKey: 'suesswaren-knabbereien',
    ...data,
  };
}

function produceCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Obst & Gemuese',
    categoryKey: 'obst-gemuese',
    searchKeywords: 'obst gemuese frisch frische steiermark spar',
    parserHint: 'known-spar-fresh-produce-kw23',
    ...data,
  };
}

function dairyCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte & Eier',
    categoryKey: 'milchprodukte-eier',
    searchKeywords: 'butter milchprodukte molkerei nahrungsmittel',
    parserHint: 'known-interspar-kw23-layout',
    ...data,
  };
}

function meatCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch & Wurst',
    categoryKey: 'fleisch-wurst',
    searchKeywords: 'fleisch wurst grillen oesterreich frisch',
    parserHint: 'known-interspar-kw23-layout',
    ...data,
  };
}

function householdCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    categoryPrimary: 'Haushalt',
    categorySecondary: 'Waschmittel & Reinigung',
    categoryKey: 'waschmittel-reinigung',
    searchKeywords: 'waschmittel putzen reinigung drogerie haushalt',
    parserHint: 'known-interspar-kw23-layout',
    ...data,
  };
}

function wineCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wein & Sekt',
    categoryKey: 'wein-sekt',
    searchKeywords: 'wein sekt frizzante schaumwein interspar weinwelt',
    parserHint: 'known-interspar-weinwelt-bestseller-layout',
    ...data,
  };
}

function nonFoodPieceCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    quantityText: '1 Stueck',
    comparisonSafe: false,
    quantityFallbackReason: 'spar-family-non-food-piece',
    parserHint: 'known-interspar-non-food-layout',
    ...data,
  };
}

function groceryCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Vorrat & Grundnahrungsmittel',
    categoryKey: 'vorrat-grundnahrungsmittel',
    searchKeywords: 'lebensmittel vorrat grundnahrungsmittel spar',
    parserHint: 'known-spar-family-shared-folder-layout',
    ...data,
  };
}

function frozenCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Tiefkuehlprodukte',
    categoryKey: 'tiefkuehlprodukte',
    searchKeywords: 'tiefkuehl tiefkuehlprodukte eis frozen spar',
    parserHint: 'known-spar-family-shared-folder-layout',
    ...data,
  };
}

function bakeryCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Brot & Backwaren',
    categoryKey: 'brot-backwaren',
    searchKeywords: 'brot backwaren gebaeck spar',
    parserHint: 'known-spar-family-shared-folder-layout',
    ...data,
  };
}

function gardenCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    categoryPrimary: 'Garten',
    categorySecondary: 'Pflanzenpflege',
    categoryKey: 'pflanzenpflege',
    searchKeywords: 'garten pflanzen balkon terrasse spar',
    parserHint: 'known-spar-family-shared-folder-layout',
    ...data,
  };
}

function hasText(text, pattern) {
  return pattern.test(normalizeForScan(text));
}

function parseCompactLayoutPriceAmount(token = '') {
  const digits = String(token || '').replace(/\D/g, '');

  if (!/^\d{3,5}$/.test(digits)) {
    return null;
  }

  const cents = Number(digits.slice(-2));
  const euros = Number(digits.slice(0, -2));
  if (!Number.isFinite(euros) || !Number.isFinite(cents)) {
    return null;
  }

  return money(euros + (cents / 100));
}

function hasCompactLayoutPriceToken(text = '', token = '') {
  const digits = String(token || '').replace(/\D/g, '');
  if (!digits) return false;
  return new RegExp(`(?:^|\\D)${digits}(?=\\D|$)`).test(String(text || ''));
}

function parseLayoutPricePairFromLine(line = '') {
  const text = normalizePriceText(line);
  const prices = [];
  let match;
  const dashPattern = /(\d{1,3})\s*,-/g;
  while ((match = dashPattern.exec(text)) !== null) {
    prices.push({
      amount: money(Number(match[1])),
      index: match.index,
      kind: 'dash',
    });
  }

  const decimalPattern = /\b(\d{1,3}[,.]\d{2})\b/g;
  while ((match = decimalPattern.exec(text)) !== null) {
    prices.push({
      amount: money(Number(match[1].replace(',', '.'))),
      index: match.index,
      kind: 'decimal',
    });
  }

  const compactPattern = /\b(\d{3,5})\b/g;
  while ((match = compactPattern.exec(text)) !== null) {
    const amount = parseCompactLayoutPriceAmount(match[1]);
    if (amount) {
      prices.push({
        amount,
        index: match.index,
        kind: 'compact',
      });
    }
  }

  const ordered = prices
    .filter((price) => price.amount > 0)
    .sort((left, right) => left.index - right.index);
  const regularPrice = ordered.find((price) => price.kind === 'dash' || price.kind === 'decimal')?.amount
    || ordered[0]?.amount
    || null;
  const discountedPrice = [...ordered]
    .reverse()
    .find((price) => (
      price.kind === 'compact'
      && (!regularPrice || (price.amount < regularPrice && price.amount > regularPrice * 0.5))
    ))?.amount || null;

  return {
    regularPrice,
    discountedPrice,
    price: discountedPrice || regularPrice,
    tokens: ordered,
  };
}

function findLineIndexByPattern(lines = [], pattern, start = 0, end = lines.length) {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(lines.length, end);

  for (let index = safeStart; index < safeEnd; index += 1) {
    if (pattern.test(normalizeForScan(lines[index]))) {
      return index;
    }
  }

  return -1;
}

function parseReferencePriceNearLines(lines = [], startIndex = 0, endIndex = lines.length, expected = null) {
  const safeStart = Math.max(0, startIndex);
  const safeEnd = Math.min(lines.length, endIndex);

  for (let index = safeStart; index < safeEnd; index += 1) {
    const text = normalizePriceText(lines[index]);
    const matches = [
      ...text.matchAll(/\bstatt\*?\s*(\d{1,3}[,.]\d{2})\b/ig),
      ...text.matchAll(/\bpreis\s*statt\*?\s*(\d{1,3}[,.]\d{2})\b/ig),
    ];

    for (const match of matches) {
      const amount = money(Number(match[1].replace(',', '.')));
      if (!expected || amount === expected) {
        return amount;
      }
    }
  }

  return null;
}

function parseCurrentPriceNearLines(lines = [], startIndex = 0, endIndex = lines.length, expectedRegular = null, expectedDiscounted = null) {
  const safeStart = Math.max(0, startIndex);
  const safeEnd = Math.min(lines.length, endIndex);

  for (let index = safeStart; index < safeEnd; index += 1) {
    if (/\bstatt\*?\b/i.test(normalizeForScan(lines[index]))) continue;
    const parsed = parseLayoutPricePairFromLine(lines[index]);
    if (!parsed.price) continue;

    const hasExpectedRegular = !expectedRegular || parsed.tokens.some((price) => price.amount === expectedRegular);
    const hasExpectedDiscounted = !expectedDiscounted || parsed.tokens.some((price) => price.amount === expectedDiscounted);
    if (hasExpectedRegular && hasExpectedDiscounted) {
      return expectedDiscounted || expectedRegular || parsed.price;
    }
  }

  return null;
}

function extractKnownSparFreshProduceKw23CandidatesFromPage(page, { sourceRetailerFormat } = {}) {
  if (sourceRetailerFormat !== 'spar') {
    return [];
  }

  const text = normalizePdfText(page.text || '');
  const normalized = normalizeForScan(text);

  if (
    (
      !/\bobst[-\s]+und\s+gemueseangebote\s+gueltig\s+bis\s+sa[,.]*\s*6\.6\.2026/.test(normalized)
      && !/\bobst[-\s]+und\s+gemuseangebote\s+gultig\s+bis\s+sa[,.]*\s*6\.6\.2026/.test(normalized)
    )
    || !hasText(text, /spar nektarinen/)
    || !hasText(text, /s-budget/)
    || !hasText(text, /zespri/)
  ) {
    return [];
  }

  const candidates = [];
  const appCondition = 'Nur mit SPAR-App-Gutschein laut Flugblatt';
  const freshValidToOverride = new Date('2026-06-06T21:59:59.999Z');
  const freshCandidate = (data) => produceCandidate({
    validToOverride: freshValidToOverride,
    ...data,
  });

  addCandidate(candidates, page.pageNumber, freshCandidate({
    title: 'SPAR Nektarinen',
    brand: 'SPAR',
    price: 2.49,
    referencePrice: 2.99,
    quantityText: '1 kg',
    rawText: 'SPAR Nektarinen Klasse 1, 1-kg-Tasse, 2,49, niedrigster 30-Tage-Preis 2,99',
    comparisonSafe: true,
    searchKeywords: 'SPAR Nektarinen Obst Gemuese Steinobst 1 kg',
  }));

  addCandidate(candidates, page.pageNumber, freshCandidate({
    title: 'Bio-Beilagenkartoffel aus Oesterreich',
    brand: 'SPAR Natur pur',
    price: 1.29,
    referencePrice: 1.99,
    quantityText: '1 kg',
    rawText: 'Bio-Beilagenkartoffel aus Oesterreich, Klasse 1, 1-kg-Netz, 1,29 statt 1,99',
    comparisonSafe: true,
    searchKeywords: 'Bio Beilagenkartoffel Kartoffel Oesterreich Obst Gemuese 1 kg',
  }));

  addCandidate(candidates, page.pageNumber, freshCandidate({
    title: 'Radieschen aus Oesterreich',
    brand: '',
    price: 0.89,
    referencePrice: 1.29,
    quantityText: '1 Bund',
    rawText: 'Radieschen aus Oesterreich, per Bund, 0,89 statt 1,29',
    comparisonSafe: false,
    searchKeywords: 'Radieschen Bund Oesterreich Obst Gemuese',
  }));

  addCandidate(candidates, page.pageNumber, freshCandidate({
    title: 'Bio-Zitronen zur Hollerbluete',
    brand: 'SPAR Natur pur',
    price: 1.29,
    referencePrice: null,
    quantityText: '500 g',
    rawText: 'Bio-Zitronen zur Hollerbluete, Klasse 1, 500-g-Netz, 1,29 per Netz',
    comparisonSafe: true,
    searchKeywords: 'Bio Zitronen Hollerbluete Zitrus Obst 500 g',
  }));

  addCandidate(candidates, page.pageNumber, freshCandidate({
    title: 'ZESPRI Kiwi Gold',
    brand: 'ZESPRI',
    price: 2.49,
    referencePrice: 3.99,
    quantityText: '4 Stueck',
    conditionsText: appCondition,
    rawText: 'ZESPRI Kiwi Gold, Klasse 1, 4-Stueck-Tasse, nur mit SPAR-App-Gutschein 2,49 statt 3,99',
    comparisonSafe: true,
    searchKeywords: 'ZESPRI Kiwi Gold Obst Gemuese 4 Stueck SPAR-App-Gutschein',
  }));

  addCandidate(candidates, page.pageNumber, freshCandidate({
    title: 'S-BUDGET Spitzpaprika Rot',
    brand: 'S-BUDGET',
    price: 1.99,
    referencePrice: 2.99,
    quantityText: '500 g',
    conditionsText: appCondition,
    rawText: 'S-BUDGET Spitzpaprika Rot, Klasse 1, 500-g-Packung, nur mit SPAR-App-Gutschein 1,99 statt 2,99',
    comparisonSafe: true,
    searchKeywords: 'S-BUDGET Spitzpaprika Rot Paprika Obst Gemuese 500 g SPAR-App-Gutschein',
  }));

  return candidates;
}

function extractKnownIntersparKw23CandidatesFromPage(page, { sourceRetailerFormat } = {}) {
  if (sourceRetailerFormat !== 'interspar') {
    return [];
  }

  const text = normalizePdfText(page.text || '');
  const normalized = normalizeForScan(text);
  const candidates = [];

  if (
    hasText(text, /lavazza crema e gusto/)
    && hasText(text, /espresso italiano/)
    && hasText(text, /250[-\s]?g[-\s]?packung/)
    && (hasCompactLayoutPriceToken(normalized, '699') || /699\s*1\s+packung/.test(normalized))
  ) {
    addCandidate(candidates, page.pageNumber, {
      title: 'Lavazza Crema e Gusto oder Espresso Italiano',
      brand: 'Lavazza',
      price: 6.99,
      referencePrice: /1\s+packung\s+8[,.]99|1\s+packung\s+8[,.]49/i.test(normalized) ? 8.99 : null,
      quantityText: '250 g',
      conditionsText: 'ab 2 Packungen laut Flugblatt',
      rawText: 'Lavazza Crema e Gusto oder Espresso Italiano, gemahlen, 250-g-Packung, ab 2 Packungen je 6,99',
      comparisonSafe: true,
      searchKeywords: 'Lavazza Crema e Gusto Espresso Italiano Kaffee gemahlen 250 g',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      categoryKey: 'kaffee-tee',
      parserHint: 'known-interspar-kw23-layout',
    });
  }

  if (
    hasText(text, /kimbo espresso classico/)
    && hasText(text, /1[-\s]?kg[-\s]?packung/)
    && hasCompactLayoutPriceToken(normalized, '2349')
  ) {
    addCandidate(candidates, page.pageNumber, {
      title: 'Kimbo Espresso Classico',
      brand: 'Kimbo',
      price: 23.49,
      referencePrice: null,
      quantityText: '1 kg',
      conditionsText: '',
      rawText: 'Kimbo Espresso Classico, ganze Bohne, 1-kg-Packung, 23,49',
      comparisonSafe: true,
      searchKeywords: 'Kimbo Espresso Classico Kaffee ganze Bohne 1 kg',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      categoryKey: 'kaffee-tee',
      parserHint: 'known-interspar-kw23-layout',
    });
  }

  if (
    hasText(text, /mokaflor miscela blu/)
    && hasText(text, /miscela rossa/)
    && hasText(text, /1[-\s]?kg[-\s]?packung/)
    && hasCompactLayoutPriceToken(normalized, '2299')
  ) {
    addCandidate(candidates, page.pageNumber, {
      title: 'Mokaflor Miscela Blu, Rossa oder Oro',
      brand: 'Mokaflor',
      price: 22.99,
      referencePrice: null,
      quantityText: '1 kg',
      conditionsText: '',
      rawText: 'Mokaflor Miscela Blu, Miscela Rossa oder Oro, ganze Bohne, 1-kg-Packung, 22,99',
      comparisonSafe: true,
      searchKeywords: 'Mokaflor Miscela Kaffee ganze Bohne 1 kg',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      categoryKey: 'kaffee-tee',
      parserHint: 'known-interspar-kw23-layout',
    });
  }

  if (
    hasText(text, /(?:noem|nom)\s+o(?:e)?sterreichische teebutter/)
    && hasText(text, /streichzart/)
    && hasText(text, /250[-\s]?g[-\s]?packung/)
    && (hasCompactLayoutPriceToken(normalized, '179') || /179\s*1\s+packung/.test(normalized))
  ) {
    addCandidate(candidates, page.pageNumber, dairyCandidate({
      title: 'Noem Oesterreichische Teebutter streichzart',
      brand: 'Noem',
      price: 1.79,
      referencePrice: /1\s+packung\s+2[,.]69/i.test(normalized) ? 2.69 : null,
      quantityText: '250 g',
      conditionsText: '2+1 gratis / ab 3 Packungen laut Flugblatt',
      rawText: 'Noem Oesterreichische Teebutter streichzart, 250-g-Packung, ab 3 Packungen je 1,79',
      comparisonSafe: true,
      searchKeywords: 'Noem Oesterreichische Teebutter Butter 250 g',
    }));
  }

  if (
    hasText(text, /s-budget spare-ribs/)
    && hasText(text, /in selbstbedienung per kg/)
    && hasCompactLayoutPriceToken(normalized, '1590')
  ) {
    addCandidate(candidates, page.pageNumber, meatCandidate({
      title: 'S-BUDGET Spare-Ribs aus Oesterreich',
      brand: 'S-BUDGET',
      price: 15.90,
      referencePrice: null,
      quantityText: '1 kg',
      conditionsText: '',
      rawText: 'S-BUDGET Spare-Ribs aus Oesterreich, in Selbstbedienung per kg, 15,90',
      comparisonSafe: true,
      searchKeywords: 'S-BUDGET Spare-Ribs Oesterreich Fleisch Grillen per kg',
    }));
  }

  if (
    hasText(text, /s-budget hendl-unterkeulen/)
    && hasText(text, /800[-\s]?g[-\s]?packung/)
    && hasCompactLayoutPriceToken(normalized, '539')
  ) {
    addCandidate(candidates, page.pageNumber, meatCandidate({
      title: 'S-BUDGET Hendl-Unterkeulen aus Oesterreich',
      brand: 'S-BUDGET',
      price: 5.39,
      referencePrice: null,
      quantityText: '800 g',
      conditionsText: '',
      rawText: 'S-BUDGET Hendl-Unterkeulen aus Oesterreich, 800-g-Packung, 5,39',
      comparisonSafe: true,
      searchKeywords: 'S-BUDGET Hendl Unterkeulen Oesterreich Fleisch 800 g',
    }));
  }

  if (
    hasText(text, /polnische oder ka(?:e)?sewurst/)
    && hasText(text, /1[-\s]?kg[-\s]?stange/)
    && (hasCompactLayoutPriceToken(normalized, '499') || /499\s*1\s+packung/.test(normalized))
  ) {
    addCandidate(candidates, page.pageNumber, meatCandidate({
      title: 'Polnische oder Kaesewurst',
      brand: '',
      price: 4.99,
      referencePrice: /1\s+packung\s+6[,.]29/i.test(normalized) ? 6.29 : null,
      quantityText: '1 kg',
      conditionsText: 'ab 2 Packungen laut Flugblatt',
      rawText: 'Polnische oder Kaesewurst, 1-kg-Stange, ab 2 Packungen je 4,99',
      comparisonSafe: true,
      searchKeywords: 'Polnische Kaesewurst Wurst 1 kg Oesterreich',
    }));
  }

  if (
    hasText(text, /champignon aufschnittwurst/)
    && hasText(text, /in bedienung per 100\s*g/)
    && hasCompactLayoutPriceToken(normalized, '149')
  ) {
    addCandidate(candidates, page.pageNumber, meatCandidate({
      title: 'Kaesewurst, Krakauer, Wiener oder Champignon Aufschnittwurst',
      brand: '',
      price: 1.49,
      referencePrice: /statt\s+2[,.]09|statt\s+2[,.]09\/1[,.]99/i.test(normalized) ? 2.09 : null,
      quantityText: '100 g',
      conditionsText: '',
      rawText: 'Kaesewurst, Krakauer, Wiener oder Champignon Aufschnittwurst, in Bedienung per 100 g, 1,49',
      comparisonSafe: true,
      searchKeywords: 'Kaesewurst Krakauer Wiener Champignon Aufschnittwurst Wurst 100 g',
    }));
  }

  if (
    hasText(text, /salsiccia/)
    && hasText(text, /300[-\s]?g[-\s]?packung/)
    && hasCompactLayoutPriceToken(normalized, '399')
  ) {
    addCandidate(candidates, page.pageNumber, meatCandidate({
      title: 'Salsiccia oder Salsiccia fine pikant',
      brand: '',
      price: 3.99,
      referencePrice: /1\s+packung\s+4[,.]99/i.test(normalized) ? 4.99 : null,
      quantityText: '280-300 g',
      conditionsText: 'ab 2 Packungen laut Flugblatt',
      rawText: 'Salsiccia 300-g-Packung oder Salsiccia fine pikant 280-g-Packung, ab 2 Packungen je 3,99',
      comparisonSafe: false,
      searchKeywords: 'Salsiccia Bratwurst Grillen Wurst 280 g 300 g',
    }));
  }

  if (
    hasText(text, /persil pulver/)
    && hasText(text, /persil gel/)
    && hasText(text, /persil discs/)
    && /je\s+60\s+wg/i.test(normalized)
    && hasCompactLayoutPriceToken(normalized, '2198')
  ) {
    addCandidate(candidates, page.pageNumber, householdCandidate({
      title: 'Persil Gel, Pulver oder Discs',
      brand: 'Persil',
      price: 21.98,
      referencePrice: null,
      quantityText: '120 Waschgang',
      conditionsText: '2 Flaschen oder 2 Packungen laut Flugblatt',
      rawText: '2 Flaschen Persil Gel je 60 WG, 2 Packungen Persil Pulver je 54 WG oder 2 Packungen Persil Discs je 44 WG, 21,98',
      comparisonSafe: false,
      searchKeywords: 'Persil Pulver Gel Discs Waschmittel Waschgang',
    }));
  }

  return candidates;
}

function extractKnownIntersparKw22NonFoodCandidatesFromPage(page, { sourceRetailerFormat } = {}) {
  if (sourceRetailerFormat !== 'interspar') {
    return [];
  }

  const text = String(page.text || '').replace(/\u00a0/g, ' ');
  const normalized = normalizeForScan(text);
  if (
    !/\belektrische\b.{0,60}\bhaushaltsprodukte\b/.test(normalized)
    || !/\bkrups\b/.test(normalized)
    || !/\btefal\b/.test(normalized)
    || !/\browenta\b/.test(normalized)
  ) {
    return [];
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => sanitizeWhitespace(normalizePdfText(line)))
    .filter(Boolean);
  const candidates = [];
  const applianceConditions = 'Zusaetzlich -20% auf den Aktionspreis von Do, 28.5. bis Di, 2.6. laut Flugblatt';
  const definitions = [
    {
      title: 'KRUPS Kaffeevollautomat my Coffee',
      brand: 'KRUPS',
      anchor: /kaffeevollautomat.*my\s+coffee|my\s+coffee/,
      referencePrice: 439.99,
      regularPrice: 349,
      rawWindow: 24,
      categoryPrimary: 'Technik / Elektronik',
      categorySecondary: 'Kuechengeraete',
      categoryKey: 'kuechengeraete',
      searchKeywords: 'KRUPS Kaffeevollautomat my Coffee Kaffeemaschine Espressoautomat',
    },
    {
      title: 'Tefal Heissluftfritteuse Easy Fry XL Surface',
      brand: 'Tefal',
      anchor: /tefal\s+heissluft|heissluftfritteuse/,
      referencePrice: 229.99,
      regularPrice: 149,
      discountedPrice: 119.20,
      rawWindow: 34,
      categoryPrimary: 'Technik / Elektronik',
      categorySecondary: 'Kuechengeraete',
      categoryKey: 'kuechengeraete',
      searchKeywords: 'Tefal Heissluftfritteuse Easy Fry XL Surface Kuechengeraet',
    },
    {
      title: 'Tefal OptiGrill',
      brand: 'Tefal',
      anchor: /tefal\s+op(?:t|tr)i\s*grill|optigrill|optrigrill/,
      referencePrice: 309.99,
      regularPrice: 124.90,
      discountedPrice: 99.92,
      rawWindow: 34,
      categoryPrimary: 'Technik / Elektronik',
      categorySecondary: 'Kuechengeraete',
      categoryKey: 'kuechengeraete',
      searchKeywords: 'Tefal OptiGrill Kontaktgrill Kuechengeraet',
    },
    {
      title: 'Rowenta Akkusauger X-Force Flex 9.60',
      brand: 'Rowenta',
      anchor: /akkusauger|x-force\s+flex/,
      referencePrice: 499.99,
      regularPrice: 199,
      discountedPrice: 159.20,
      rawWindow: 40,
      categoryPrimary: 'Technik / Elektronik',
      categorySecondary: 'Werkzeug & Akkus',
      categoryKey: 'werkzeug-akkus',
      searchKeywords: 'Rowenta Akkusauger X-Force Flex 9.60 Staubsauger',
    },
    {
      title: 'Tefal Dampfglatter AeroSteam',
      brand: 'Tefal',
      anchor: /dampfglatter|dampfglaetter|aerosteam/,
      referencePrice: 199.99,
      regularPrice: 119,
      discountedPrice: 95.20,
      rawWindow: 42,
      categoryPrimary: 'Technik / Elektronik',
      categorySecondary: 'Kuechengeraete',
      categoryKey: 'kuechengeraete',
      searchKeywords: 'Tefal Dampfglatter AeroSteam Dampfgeraet',
    },
  ];

  for (const definition of definitions) {
    const anchorIndex = findLineIndexByPattern(lines, definition.anchor);
    if (anchorIndex < 0) continue;

    const endIndex = Math.min(lines.length, anchorIndex + definition.rawWindow);
    const referencePrice = parseReferencePriceNearLines(
      lines,
      anchorIndex,
      endIndex,
      definition.referencePrice
    );
    const price = parseCurrentPriceNearLines(
      lines,
      anchorIndex,
      endIndex,
      definition.regularPrice,
      definition.discountedPrice
    );

    if (!(price > 0) || referencePrice !== definition.referencePrice) {
      continue;
    }

    addCandidate(candidates, page.pageNumber, nonFoodPieceCandidate({
      title: definition.title,
      brand: definition.brand,
      price,
      referencePrice,
      conditionsText: applianceConditions,
      rawText: lines.slice(anchorIndex, endIndex).join(' '),
      categoryPrimary: definition.categoryPrimary,
      categorySecondary: definition.categorySecondary,
      categoryKey: definition.categoryKey,
      searchKeywords: definition.searchKeywords,
    }));
  }

  const sloggiIndex = findLineIndexByPattern(lines, /sloggi\s+damen\s+tai|pure\s+comfort/);
  if (sloggiIndex >= 0) {
    const endIndex = Math.min(lines.length, sloggiIndex + 12);
    const referencePrice = parseReferencePriceNearLines(lines, sloggiIndex, endIndex, 29.97);
    const price = parseCurrentPriceNearLines(lines, sloggiIndex, endIndex, null, 14.98);

    if (price === 14.98 && referencePrice === 29.97) {
      addCandidate(candidates, page.pageNumber, {
        productKind: 'generic-flyer-product',
        title: 'Sloggi Damen Tai-, Midi- oder Maxi-Slip Serie Pure Comfort',
        brand: 'Sloggi',
        price,
        referencePrice,
        quantityText: '3 Stueck',
        conditionsText: '1/2 Preis / 2+1, 3er-Packung laut Flugblatt',
        rawText: lines.slice(sloggiIndex, endIndex).join(' '),
        comparisonSafe: false,
        parserHint: 'known-interspar-non-food-layout',
        searchKeywords: 'Sloggi Damen Tai Midi Maxi Slip Pure Comfort Unterwaesche',
        categoryPrimary: 'Kleidung / Mode',
        categorySecondary: 'Damenbekleidung',
        categoryKey: 'damenbekleidung',
      });
    }
  }

  return candidates;
}

function extractKnownIntersparWeinweltBestsellerCandidatesFromPage(page, { sourceRetailerFormat } = {}) {
  if (sourceRetailerFormat !== 'interspar') {
    return [];
  }

  const text = normalizePdfText(page.text || '');
  const normalized = normalizeForScan(text);
  const candidates = [];
  const ab2Condition = 'ab 2 Flaschen laut Weinwelt';

  if (
    hasText(text, /allacher\s+all\s+red/)
    && hasText(text, /0[,.]75\s*l/)
    && /statt\s+9[,.]\s*99/.test(normalized)
    && /7[,.]\s*99/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, wineCandidate({
      title: 'Allacher All Red 2024',
      brand: 'Allacher',
      price: 7.99,
      referencePrice: 9.99,
      quantityText: '0,75 l',
      conditionsText: ab2Condition,
      rawText: 'Allacher All Red 2024, 0,75 l, statt 9,99, 7,99, ab 2 Flaschen',
      comparisonSafe: true,
      searchKeywords: 'Allacher All Red Rotwein Burgenland 0,75 l Weinwelt',
    }));
  }

  if (
    hasText(text, /allacher\s+st\.?\s+laurent/)
    && hasText(text, /apfelgrund/)
    && /10[,.]\s*99/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, wineCandidate({
      title: 'Allacher St. Laurent Ried Apfelgrund 2023',
      brand: 'Allacher',
      price: 10.99,
      referencePrice: null,
      quantityText: '0,75 l',
      conditionsText: '',
      rawText: 'Allacher St. Laurent Ried Apfelgrund 2023, 0,75 l, 10,99',
      comparisonSafe: true,
      searchKeywords: 'Allacher St Laurent Apfelgrund Rotwein Burgenland 0,75 l Weinwelt',
    }));
  }

  if (
    hasText(text, /allacher\s+all\s+zero\s+white/)
    && hasText(text, /all\s+zero\s+red/)
    && /statt\s+9[,.]\s*99/.test(normalized)
    && /7[,.]\s*99/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, wineCandidate({
      title: 'Allacher All Zero White oder All Zero Red',
      brand: 'Allacher',
      price: 7.99,
      referencePrice: 9.99,
      quantityText: '0,75 l',
      conditionsText: ab2Condition,
      rawText: 'Allacher All Zero White und All Zero Red, 0,75 l, statt 9,99, 7,99, ab 2 Flaschen',
      comparisonSafe: false,
      searchKeywords: 'Allacher All Zero White Red alkoholfrei Wein 0,75 l Weinwelt',
    }));
  }

  if (
    hasText(text, /weinkellerei\s+schloss\s+fels/)
    && hasText(text, /wein\s*&?\s*soda\s+sommer/)
    && hasText(text, /wein\s*&?\s*soda\s+pink\s+mango/)
    && /statt\s+1[,.]\s*29/.test(normalized)
    && /0[,.]\s*99/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, wineCandidate({
      title: 'Weinkellerei Schloss Fels Wein & Soda Sommer',
      brand: 'Schloss Fels',
      price: 0.99,
      referencePrice: 1.29,
      quantityText: '0,33 l',
      conditionsText: ab2Condition,
      rawText: 'Weinkellerei Schloss Fels Wein & Soda Sommer, 0,33 l, statt 1,29, 0,99, ab 2 Flaschen',
      comparisonSafe: true,
      searchKeywords: 'Schloss Fels Wein Soda Sommer Spritzer 0,33 l Weinwelt',
    }));
  }

  if (
    hasText(text, /weinkellerei\s+schloss\s+fels/)
    && hasText(text, /pink\s+mango/)
    && /statt\s+1[,.]\s*69/.test(normalized)
    && /1[,.]\s*39/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, wineCandidate({
      title: 'Weinkellerei Schloss Fels Wein & Soda Pink Mango',
      brand: 'Schloss Fels',
      price: 1.39,
      referencePrice: 1.69,
      quantityText: '0,33 l',
      conditionsText: ab2Condition,
      rawText: 'Weinkellerei Schloss Fels Wein & Soda Pink Mango, 0,33 l, statt 1,69, 1,39, ab 2 Flaschen',
      comparisonSafe: true,
      searchKeywords: 'Schloss Fels Wein Soda Pink Mango Spritzer 0,33 l Weinwelt',
    }));
  }

  if (
    hasText(text, /nittnaus.*freddo/)
    && hasText(text, /0[,.]75\s*l\s+burgenland/)
    && /statt\s+7[,.]\s*99/.test(normalized)
    && /5[,.]\s*99/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, wineCandidate({
      title: 'Gebrueder Nittnaus Zweigelt Freddo 2024',
      brand: 'Gebrueder Nittnaus',
      price: 5.99,
      referencePrice: 7.99,
      quantityText: '0,75 l',
      conditionsText: ab2Condition,
      rawText: 'Gebrueder Nittnaus Zweigelt Freddo 2024, 0,75 l, statt 7,99, 5,99, ab 2 Flaschen',
      comparisonSafe: true,
      searchKeywords: 'Nittnaus Zweigelt Freddo Rotwein Burgenland 0,75 l Weinwelt',
    }));
  }

  if (
    hasText(text, /walter\s+skoff/)
    && hasText(text, /weissburgunder|wei(?:ss|ß)burgunder/)
    && /statt\s+9[,.]\s*99/.test(normalized)
    && /7[,.]\s*49/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, wineCandidate({
      title: 'Walter Skoff Weissburgunder Suedsteiermark DAC 2025',
      brand: 'Walter Skoff',
      price: 7.49,
      referencePrice: 9.99,
      quantityText: '0,75 l',
      conditionsText: '',
      rawText: 'Walter Skoff Weissburgunder Suedsteiermark DAC 2025, 0,75 l, statt 9,99, 7,49',
      comparisonSafe: true,
      searchKeywords: 'Walter Skoff Weissburgunder Suedsteiermark DAC 0,75 l Weinwelt',
    }));
  }

  if (
    hasText(text, /kattus\s+frizzante/)
    && hasText(text, /muskateller\s+frizzante/)
    && /statt\s+47[,.]\s*96/.test(normalized)
    && /39[,.]\s*99/.test(normalized)
    && /4[,.]\s*99/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, wineCandidate({
      title: 'Kattus Frizzante oder Muskateller Frizzante Rose',
      brand: 'Kattus',
      price: 4.99,
      referencePrice: null,
      quantityText: '0,75 l',
      conditionsText: '',
      rawText: 'Kattus Frizzante, Frizzante, Muskateller Frizzante Rose, 0,75 l, 4,99',
      comparisonSafe: false,
      searchKeywords: 'Kattus Frizzante Muskateller Rose Schaumwein 0,75 l Weinwelt',
    }));
  }

  if (
    hasText(text, /don\s+papa/)
    && hasText(text, /baroko/)
    && hasText(text, /0[,.]7\s*l/)
    && /statt\s+39[,.]\s*90/.test(normalized)
    && /34[,.]\s*90/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, wineCandidate({
      title: 'Don Papa Baroko',
      brand: 'Don Papa',
      price: 34.90,
      referencePrice: 39.90,
      quantityText: '0,7 l',
      conditionsText: '',
      rawText: 'Don Papa Baroko, 0,7 l, 40 % Vol., statt 39,90, 34,90',
      comparisonSafe: true,
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Spirituosen',
      categoryKey: 'spirituosen',
      searchKeywords: 'Don Papa Baroko Rum Spirituosen 0,7 l Weinwelt',
    }));
  }

  if (
    hasText(text, /walter\s+skoff/)
    && hasText(text, /sauvignon\s+blanc/)
    && hasText(text, /privat\s+selektion/)
    && /statt\s+17[,.]\s*99/.test(normalized)
    && /8[,.]\s*99/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, wineCandidate({
      title: 'Walter Skoff Sauvignon Blanc Privat Selektion Suedsteiermark DAC 2024',
      brand: 'Walter Skoff',
      price: 8.99,
      referencePrice: 17.99,
      quantityText: '0,75 l',
      conditionsText: '1+1 gratis laut Weinwelt',
      rawText: 'Walter Skoff Sauvignon Blanc Privat Selektion Suedsteiermark DAC 2024, 0,75 l, statt 17,99, 8,99, 1+1 gratis',
      comparisonSafe: true,
      searchKeywords: 'Walter Skoff Sauvignon Blanc Privat Selektion Suedsteiermark DAC 0,75 l Weinwelt',
    }));
  }

  return candidates;
}

function extractKnownIntersparMeinZuhauseSommerCandidatesFromPage(page, { sourceRetailerFormat } = {}) {
  if (sourceRetailerFormat !== 'interspar') {
    return [];
  }

  const text = normalizePdfText(page.text || '');
  const normalized = normalizeForScan(text);
  const candidates = [];
  const householdAvailability = 'Preise gueltig bis 31.07.2026 und solange der Vorrat reicht laut Mein Zuhause';
  const householdValidToOverride = new Date('2026-07-31T21:59:59.999Z');
  const addHomeCandidate = (data) => addCandidate(candidates, page.pageNumber, nonFoodPieceCandidate({
    conditionsText: householdAvailability,
    validToOverride: householdValidToOverride,
    ...data,
  }));

  if (
    hasText(text, /simpex\s+basic\s+stabmixer/)
    && /24[,.]\s*99/.test(normalized)
  ) {
    addHomeCandidate({
      title: 'SIMPEX BASIC Stabmixer-Set',
      brand: 'SIMPEX BASIC',
      price: 24.99,
      referencePrice: null,
      rawText: 'SIMPEX BASIC Stabmixer-Set, 400 Watt, 24,99',
      categoryPrimary: 'Technik / Elektronik',
      categorySecondary: 'Kuechengeraete',
      categoryKey: 'kuechengeraete',
      searchKeywords: 'SIMPEX BASIC Stabmixer Set Mixer Kuechengeraet',
    });
  }

  if (
    hasText(text, /spar\s+butterdose/)
    && /6[,.]\s*99/.test(normalized)
  ) {
    addHomeCandidate({
      title: 'SPAR Butterdose',
      brand: 'SPAR',
      price: 6.99,
      referencePrice: null,
      rawText: 'SPAR Butterdose, 6,99',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Kueche & Aufbewahrung',
      categoryKey: 'kueche-aufbewahrung',
      searchKeywords: 'SPAR Butterdose Kueche Aufbewahrung',
    });
  }

  if (
    hasText(text, /spar\s+wie\s+frueher\s+universal-erde|spar\s+wie\s+fruher\s+universal-erde/)
    && /40\s*l/.test(normalized)
    && /7[,.]\s*99/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, {
      productKind: 'generic-flyer-product',
      title: 'SPAR wie frueher Universal-Erde',
      brand: 'SPAR wie frueher',
      price: 7.99,
      referencePrice: null,
      quantityText: '40 l',
      conditionsText: householdAvailability,
      validToOverride: householdValidToOverride,
      rawText: 'SPAR wie frueher Universal-Erde, 40 l, 7,99',
      comparisonSafe: true,
      parserHint: 'known-interspar-mein-zuhause-layout',
      categoryPrimary: 'Garten',
      categorySecondary: 'Pflanzen & Erde',
      categoryKey: 'pflanzen-erde',
      searchKeywords: 'SPAR wie frueher Universal Erde Garten 40 l',
    });
  }

  if (
    hasText(text, /pamela\s+reif\s+topf/)
    && /34[,.]\s*99/.test(normalized)
  ) {
    addHomeCandidate({
      title: 'Pamela Reif Topf inkl. Glasdeckel 20 cm',
      brand: 'Pamela Reif',
      price: 34.99,
      referencePrice: null,
      rawText: 'Pamela Reif Topf inkl. Glasdeckel 20 cm, 34,99',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Kueche & Kochen',
      categoryKey: 'kueche-kochen',
      searchKeywords: 'Pamela Reif Topf Glasdeckel Kueche Kochen 20 cm',
    });
  }

  if (
    hasText(text, /pamela\s+reif\s+hochrandpfanne/)
    && /34[,.]\s*90/.test(normalized)
  ) {
    addHomeCandidate({
      title: 'Pamela Reif Hochrandpfanne 28 cm',
      brand: 'Pamela Reif',
      price: 34.90,
      referencePrice: null,
      rawText: 'Pamela Reif Hochrandpfanne 28 cm, 34,90',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Kueche & Kochen',
      categoryKey: 'kueche-kochen',
      searchKeywords: 'Pamela Reif Hochrandpfanne Pfanne Kueche Kochen 28 cm',
    });
  }

  if (
    hasText(text, /pamela\s+reif\s+universalmesser/)
    && hasText(text, /pamela\s+reif\s+gemuesemesser|pamela\s+reif\s+gemusemesser/)
    && /4[,.]\s*99/.test(normalized)
  ) {
    addHomeCandidate({
      title: 'Pamela Reif Universalmesser oder Gemuesemesser',
      brand: 'Pamela Reif',
      price: 4.99,
      referencePrice: null,
      rawText: 'Pamela Reif Universalmesser 22,5 cm oder Gemuesemesser 19 cm, je 4,99',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Kueche & Kochen',
      categoryKey: 'kueche-kochen',
      searchKeywords: 'Pamela Reif Universalmesser Gemuesemesser Messer Kueche',
    });
  }

  if (
    hasText(text, /naturally\s+pam\s+by\s+pamela\s+reif\s+porridge/)
    && /350[-\s]?g/.test(normalized)
    && /5[,.]\s*99/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, {
      productKind: 'generic-flyer-product',
      title: 'Naturally Pam by Pamela Reif Porridge',
      brand: 'Naturally Pam by Pamela Reif',
      price: 5.99,
      referencePrice: null,
      quantityText: '350 g',
      conditionsText: householdAvailability,
      validToOverride: householdValidToOverride,
      rawText: 'Naturally Pam by Pamela Reif Porridge Brownie Style oder Apple Pie Style, 350-g-Packung, je 5,99',
      comparisonSafe: true,
      parserHint: 'known-interspar-mein-zuhause-layout',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Muesli & Cerealien',
      categoryKey: 'muesli-cerealien',
      searchKeywords: 'Naturally Pam Pamela Reif Porridge Brownie Apple Pie 350 g',
    });
  }

  if (
    hasText(text, /naturally\s+pam\s+by\s+pamela\s+reif\s+oat\s+bar/)
    && /40\s*g/.test(normalized)
    && /2[,.]\s*29/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, {
      productKind: 'generic-flyer-product',
      title: 'Naturally Pam by Pamela Reif Oat Bar',
      brand: 'Naturally Pam by Pamela Reif',
      price: 2.29,
      referencePrice: null,
      quantityText: '40 g',
      conditionsText: householdAvailability,
      validToOverride: householdValidToOverride,
      rawText: 'Naturally Pam by Pamela Reif Oat Bar Dark & White oder Chunky Chocolate, 40 g, je 2,29',
      comparisonSafe: true,
      parserHint: 'known-interspar-mein-zuhause-layout',
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesses & Snacks',
      categoryKey: 'suesses-snacks',
      searchKeywords: 'Naturally Pam Pamela Reif Oat Bar Dark White Chunky Chocolate 40 g',
    });
  }

  if (
    hasText(text, /simpex\s+basic\s+heissluftfritteuse|simpex\s+basic\s+heissluftfritteuse/)
    && /4[,.]2\s*l/.test(normalized)
    && /59[,.]\s*90/.test(normalized)
  ) {
    addHomeCandidate({
      title: 'SIMPEX BASIC Heissluftfritteuse 4,2 l',
      brand: 'SIMPEX BASIC',
      price: 59.90,
      referencePrice: null,
      rawText: 'SIMPEX BASIC Heissluftfritteuse, 4,2 l Fassungsvermoegen, 1.300 Watt, 59,90',
      categoryPrimary: 'Technik / Elektronik',
      categorySecondary: 'Kuechengeraete',
      categoryKey: 'kuechengeraete',
      searchKeywords: 'SIMPEX BASIC Heissluftfritteuse 4,2 l Kuechengeraet',
    });
  }

  if (
    hasText(text, /splendid\s+nature\s+glasreiniger|splendid\s+nature\s+glasreininger/)
    && /750\s*ml/.test(normalized)
    && /2[,.]\s*09/.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, {
      productKind: 'generic-flyer-product',
      title: 'Splendid nature Glasreiniger',
      brand: 'Splendid nature',
      price: 2.09,
      referencePrice: null,
      quantityText: '750 ml',
      conditionsText: householdAvailability,
      validToOverride: householdValidToOverride,
      rawText: 'Splendid nature Glasreiniger, 750 ml, 2,09',
      comparisonSafe: true,
      parserHint: 'known-interspar-mein-zuhause-layout',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reinigung',
      categoryKey: 'waschmittel-reinigung',
      searchKeywords: 'Splendid nature Glasreiniger Fensterreiniger Reinigung 750 ml',
    });
  }

  if (
    hasText(text, /splendid\s+fenster-wischer-set/)
    && /7[,.]\s*99/.test(normalized)
  ) {
    addHomeCandidate({
      title: 'Splendid Fenster-Wischer-Set 3-fach-Funktion',
      brand: 'Splendid',
      price: 7.99,
      referencePrice: null,
      rawText: 'Splendid Fenster-Wischer-Set 3-fach-Funktion, 7,99',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Waschmittel & Reinigung',
      categoryKey: 'waschmittel-reinigung',
      searchKeywords: 'Splendid Fenster Wischer Set Reinigung Fensterputzen',
    });
  }

  if (
    hasText(text, /waterdrop\s+tumbler/)
    && /1[,.]1\s*l/.test(normalized)
    && /34[,.]\s*90/.test(normalized)
  ) {
    addHomeCandidate({
      title: 'Waterdrop Tumbler 1,1 l',
      brand: 'Waterdrop',
      price: 34.90,
      referencePrice: null,
      rawText: 'Waterdrop Tumbler, 1,1 l Fuellmenge, 34,90',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Kueche & Aufbewahrung',
      categoryKey: 'kueche-aufbewahrung',
      searchKeywords: 'Waterdrop Tumbler Trinkbecher 1,1 l Haushalt',
    });
  }

  return candidates;
}

function extractKnownSparFamilySharedFolderCandidatesFromPage(page, { sourceRetailerFormat } = {}) {
  if (!isSparFamilyPdfFormat(sourceRetailerFormat)) {
    return [];
  }

  const text = normalizePdfText(page.text || '');
  const normalized = normalizeForScan(text);
  const candidates = [];
  const sharedCondition = 'laut offiziellem SPAR-Family Folder';
  const couponCondition = 'mit Gutschein laut SPAR-Family Gutscheinheft';

  const addSharedCandidate = (candidate) => addCandidate(candidates, page.pageNumber, {
    parserHint: 'known-spar-family-shared-folder-layout',
    ...candidate,
  });

  if (
    hasText(text, /dallmayr/)
    && hasText(text, /crema\s+d.?oro/)
    && /1\s*kg/.test(normalized)
    && /19[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: "Dallmayr Crema d'Oro ganze Bohne",
      brand: 'Dallmayr',
      price: 19.99,
      referencePrice: 30.99,
      quantityText: '1 kg',
      conditionsText: `ab 2 Packungen je 19,99; -35%; ${sharedCondition}`,
      rawText: "Dallmayr Crema d'Oro ganze Bohne, 1 kg, ab 2 Pkg. je 19,99",
      comparisonSafe: true,
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      categoryKey: 'kaffee-tee',
      searchKeywords: "Dallmayr Crema d'Oro Kaffee ganze Bohne 1 kg Monatssparer",
    }));
  }

  if (
    hasText(text, /jacobs\s+cronat/)
    && /200\s*g/.test(normalized)
    && /6[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'Jacobs Cronat Kraeftig oder Mild',
      brand: 'Jacobs',
      price: 6.99,
      referencePrice: 13.99,
      quantityText: '200 g',
      conditionsText: `1+1 gratis; ${sharedCondition}`,
      rawText: 'Jacobs Cronat Kraeftig oder Mild, 200 g, ab 2 Glaesern je 6,99',
      comparisonSafe: true,
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      categoryKey: 'kaffee-tee',
      searchKeywords: 'Jacobs Cronat Kaffee Kraeftig Mild 200 g Monatssparer',
    }));
  }

  if (
    hasText(text, /bahlsen\s+ohne\s+gleichen/)
    && /125\s*g/.test(normalized)
    && /1[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'Bahlsen Ohne Gleichen',
      brand: 'Bahlsen',
      price: 1.99,
      referencePrice: 3.99,
      quantityText: '125 g',
      conditionsText: `2+2 gratis; ${sharedCondition}`,
      rawText: 'Bahlsen Ohne Gleichen, verschiedene Sorten, 125 g, ab 4 Pkg. je 1,99',
      comparisonSafe: true,
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      categoryKey: 'suesswaren-knabbereien',
      searchKeywords: 'Bahlsen Ohne Gleichen Kekse 125 g Monatssparer',
    }));
  }

  if (
    hasText(text, /eskimo/)
    && hasText(text, /cornetto/)
    && /360\s*[-–]\s*540\s*ml/.test(normalized)
    && /4[,.]\s*49/.test(normalized)
  ) {
    addSharedCandidate(frozenCandidate({
      title: 'Eskimo Cornetto Classico, Erdbeer, Max oder Mini Mix',
      brand: 'Eskimo',
      price: 4.49,
      referencePrice: 6.99,
      quantityText: '360-540 ml',
      conditionsText: `ab 2 Packungen je 4,49; -35%; ${sharedCondition}`,
      rawText: 'Eskimo Cornetto Classico, Erdbeer, Max oder Mini Mix, 360-540 ml, ab 2 Pkg. je 4,49',
      comparisonSafe: false,
      searchKeywords: 'Eskimo Cornetto Eis Tiefkuehl 360 540 ml Monatssparer',
    }));
  }

  if (
    hasText(text, /iglo/)
    && hasText(text, /geniesserpfanne|genießerpfanne/)
    && /500\s*[-–]\s*700\s*g/.test(normalized)
    && /4[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(frozenCandidate({
      title: 'Iglo Geniesserpfanne oder Lasagne al Forno',
      brand: 'Iglo',
      price: 4.99,
      referencePrice: 7.49,
      quantityText: '500-700 g',
      conditionsText: `2+1 gratis; ${sharedCondition}`,
      rawText: 'Iglo Geniesserpfanne oder Lasagne al Forno, tiefgekuehlt, 500-700 g, ab 3 Pkg. je 4,99',
      comparisonSafe: false,
      searchKeywords: 'Iglo Geniesserpfanne Lasagne Tiefkuehl 500 700 g Monatssparer',
    }));
  }

  if (
    /philadelphia/.test(normalized)
    && /175\s*g/.test(normalized)
    && /1[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(dairyCandidate({
      title: 'Philadelphia Frischkaese',
      brand: 'Philadelphia',
      price: 1.99,
      referencePrice: 2.49,
      quantityText: '175 g',
      conditionsText: `ab 2 Bechern je 1,99; ${sharedCondition}`,
      rawText: 'Philadelphia Frischkaese, verschiedene Sorten, 175 g, ab 2 Bechern je 1,99',
      comparisonSafe: true,
      searchKeywords: 'Philadelphia Frischkaese 175 g Monatssparer',
    }));
  }

  if (
    /formil/.test(normalized)
    && /haltbare\s+vollmilch/.test(normalized)
    && /1\s*liter/.test(normalized)
    && /0[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(dairyCandidate({
      title: 'Schaerdinger Formil haltbare Vollmilch oder Leichtmilch',
      brand: 'Schaerdinger',
      price: 0.99,
      referencePrice: 1.69,
      quantityText: '1 l',
      conditionsText: `ab 12 Packungen je 0,99; -41%; ${sharedCondition}`,
      rawText: 'Schaerdinger Formil haltbare Vollmilch 3,5% oder Leichtmilch 0,5% Fett, 1 Liter, ab 12 Pkg. je 0,99',
      comparisonSafe: true,
      searchKeywords: 'Schaerdinger Formil haltbare Vollmilch Leichtmilch 1 l Monatssparer',
    }));
  }

  if (
    hasText(text, /loidl\s+salami/)
    && /80\s*g/.test(normalized)
    && /1[,.]\s*52/.test(normalized)
  ) {
    addSharedCandidate(meatCandidate({
      title: 'Loidl Salami Sticks oder Salami Pralinen',
      brand: 'Loidl',
      price: 1.52,
      referencePrice: 2.29,
      quantityText: '80 g',
      conditionsText: `2+1 gratis; ${sharedCondition}`,
      rawText: 'Loidl Salami Sticks Edel, Klassisch oder Salami Pralinen, 80 g, ab 3 Pkg. je 1,52',
      comparisonSafe: true,
      searchKeywords: 'Loidl Salami Sticks Pralinen 80 g Monatssparer',
    }));
  }

  if (
    hasText(text, /reiter/)
    && hasText(text, /kantwurst/)
    && /400\s*g/.test(normalized)
    && /6[,.]\s*49/.test(normalized)
  ) {
    addSharedCandidate(meatCandidate({
      title: 'Kantwurst oder ungarische Salami von Reiter',
      brand: 'Reiter',
      price: 6.49,
      referencePrice: 7.99,
      quantityText: '400 g',
      conditionsText: `bis zu -18%; ${sharedCondition}`,
      rawText: 'Reiter Kantwurst oder ungarische Salami, 400 g, 6,49',
      comparisonSafe: true,
      searchKeywords: 'Reiter Kantwurst ungarische Salami 400 g Monatssparer',
    }));
  }

  if (
    /rosinenzopf/.test(normalized)
    && /600\s*g/.test(normalized)
    && /3[,.]\s*79/.test(normalized)
  ) {
    addSharedCandidate(bakeryCandidate({
      title: 'Meisterbaecker Oelz Rosinenzopf',
      brand: 'Oelz',
      price: 3.79,
      referencePrice: 4.49,
      quantityText: '600 g',
      conditionsText: `-15%; ${sharedCondition}`,
      rawText: 'Meisterbaecker Oelz Rosinenzopf, 600 g, 3,79',
      comparisonSafe: true,
      searchKeywords: 'Oelz Rosinenzopf 600 g Monatssparer',
    }));
  }

  if (
    hasText(text, /lorenz\s+pommels/)
    && /75\s*g/.test(normalized)
    && /0[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(sweetCandidate({
      title: 'Lorenz Pommels',
      brand: 'Lorenz',
      price: 0.99,
      referencePrice: 1.99,
      quantityText: '75 g',
      conditionsText: `1+1 gratis; ${sharedCondition}`,
      rawText: 'Lorenz Pommels, 75 g, ab 2 Pkg. je 0,99',
      comparisonSafe: true,
      searchKeywords: 'Lorenz Pommels 75 g Monatssparer',
    }));
  }

  if (
    /spar\s*(?:mullsack|muellsack)\s*mit\s*zugband/.test(normalized)
    && /35,\s*45\s+oder\s+70\s*liter/.test(normalized)
    && (/1[,.]\s*32/.test(normalized) || /1[,.]\s*99/.test(normalized))
  ) {
    const currentThresholdDeal = /2[,.]\s*19/.test(normalized)
      && /ab\s*2\s*pkg/.test(normalized)
      && /1[,.]\s*99/.test(normalized);
    addSharedCandidate(householdCandidate({
      title: 'SPAR Muellsack mit Zugband',
      brand: 'SPAR',
      price: currentThresholdDeal ? 1.99 : 1.32,
      referencePrice: currentThresholdDeal ? 2.19 : 1.99,
      quantityText: '35-70 l',
      conditionsText: currentThresholdDeal
        ? `ab 2 Packungen je 1,99; ${sharedCondition}`
        : `2+1 gratis; ${sharedCondition}`,
      rawText: currentThresholdDeal
        ? 'SPAR Muellsack mit Zugband, 35, 45 oder 70 Liter, 1 Pkg. 2,19, ab 2 Pkg. je 1,99'
        : 'SPAR Muellsack mit Zugband, 35, 45 oder 70 Liter, ab 3 Pkg. je 1,32',
      comparisonSafe: false,
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Aufbewahrung & Folien',
      categoryKey: 'aufbewahrung-folien',
      searchKeywords: 'SPAR Muellsack mit Zugband 35 45 70 Liter Monatssparer Haushalt',
    }));
  }

  if (
    hasText(text, /milka\s+kekse/)
    && /150\s*[-–]\s*260\s*g/.test(normalized)
    && /2[,.]\s*46/.test(normalized)
  ) {
    addSharedCandidate(sweetCandidate({
      title: 'Milka Kekse',
      brand: 'Milka',
      price: 2.46,
      referencePrice: 3.69,
      quantityText: '150-260 g',
      conditionsText: `2+1 gratis; ${sharedCondition}`,
      rawText: 'Milka Kekse, verschiedene Sorten, 150-260 g, ab 3 Pkg. je 2,46',
      comparisonSafe: false,
      searchKeywords: 'Milka Kekse 150 260 g Monatssparer',
    }));
  }

  if (
    hasText(text, /bio-aceto\s+balsamico/)
    && /0[,.]\s*5\s*liter/.test(normalized)
    && /3[,.]\s*79/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'Bio-Aceto Balsamico di Modena IGP oder Bio-Condimento Bianco',
      brand: 'SPAR Natur pur',
      price: 3.79,
      referencePrice: 4.79,
      quantityText: '0.5 l',
      conditionsText: `ab 2 Flaschen je 3,79; ${sharedCondition}`,
      rawText: 'Bio-Aceto Balsamico di Modena IGP oder Bio-Condimento Bianco, 0,5 Liter, ab 2 Fl. je 3,79',
      comparisonSafe: true,
      searchKeywords: 'Bio Aceto Balsamico Condimento Bianco 0.5 l Monatssparer',
    }));
  }

  if (
    hasText(text, /wiener\s+gelierzucker/)
    && /1\s*kg/.test(normalized)
    && /1[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'Wiener Gelierzucker 1:1 oder 2:1 XXL',
      brand: 'Wiener Zucker',
      price: 1.99,
      referencePrice: 2.19,
      quantityText: '1 kg',
      conditionsText: `ab 2 Packungen je 1,99; ${sharedCondition}`,
      rawText: 'Wiener Gelierzucker 1:1 oder 2:1 XXL, 1 kg, ab 2 Pkg. je 1,99',
      comparisonSafe: true,
      searchKeywords: 'Wiener Zucker Gelierzucker 1 kg Monatssparer',
    }));
  }

  if (
    hasText(text, /wiener\s+gelierzucker/)
    && /3:1/.test(normalized)
    && /500\s*g/.test(normalized)
    && /1[,.]\s*32/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'Wiener Gelierzucker 3:1',
      brand: 'Wiener Zucker',
      price: 1.32,
      referencePrice: 1.99,
      quantityText: '500 g',
      conditionsText: `2+1 gratis; ${sharedCondition}`,
      rawText: 'Wiener Gelierzucker 3:1, 500 g, ab 3 Pkg. je 1,32',
      comparisonSafe: true,
      searchKeywords: 'Wiener Zucker Gelierzucker 3:1 500 g Monatssparer',
    }));
  }

  if (
    hasText(text, /spar/)
    && hasText(text, /knoblauchbaguette|kraeuter-\s*oder\s+knoblauchbaguette|kräuter-\s*oder\s+knoblauchbaguette/)
    && /175\s*g/.test(normalized)
    && /0[,.]\s*89/.test(normalized)
  ) {
    addSharedCandidate(bakeryCandidate({
      title: 'SPAR Kraeuter- oder Knoblauchbaguette',
      brand: 'SPAR',
      price: 0.89,
      referencePrice: 0.99,
      quantityText: '175 g',
      conditionsText: `ab 2 Packungen je 0,89; ${sharedCondition}`,
      rawText: 'SPAR Kraeuter- oder Knoblauchbaguette, gekuehlt, 175 g, ab 2 Pkg. je 0,89',
      comparisonSafe: true,
      searchKeywords: 'SPAR Kraeuterbaguette Knoblauchbaguette 175 g Grillfolder',
    }));
  }

  if (
    hasText(text, /kuner\s+sauce/)
    && /250\s*ml/.test(normalized)
    && /1[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'Kuner Sauce',
      brand: 'Kuner',
      price: 1.99,
      referencePrice: 2.79,
      quantityText: '250 ml',
      conditionsText: `-28%; ${sharedCondition}`,
      rawText: 'Kuner Sauce, verschiedene Sorten, 250 ml, 1,99',
      comparisonSafe: true,
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Saucen & Gewuerze',
      categoryKey: 'saucen-gewuerze',
      searchKeywords: 'Kuner Sauce 250 ml Grillfolder',
    }));
  }

  if (
    hasText(text, /berner\s+wuerstl|berner\s+würstl/)
    && hasText(text, /grillzwerge/)
    && /450\s*\/\s*500\s*g/.test(normalized)
    && /4[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(meatCandidate({
      title: 'Berner Wuerstl oder Grillzwerge',
      brand: '',
      price: 4.99,
      referencePrice: 5.99,
      quantityText: '450-500 g',
      conditionsText: `ab 2 Packungen je 4,99; ${sharedCondition}`,
      rawText: 'Berner Wuerstl oder Grillzwerge, 450/500 g, ab 2 Pkg. je 4,99',
      comparisonSafe: false,
      searchKeywords: 'Berner Wuerstl Grillzwerge 450 500 g Grillfolder',
    }));
  }

  if (
    hasText(text, /hendl\s+filetschnitzel/)
    && /400\s*g/.test(normalized)
    && /4[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(meatCandidate({
      title: 'SPAR feinstes Gefluegel Hendl Filetschnitzel gewuerzt',
      brand: 'SPAR',
      price: 4.99,
      referencePrice: 6.29,
      quantityText: '400 g',
      conditionsText: `ab 2 Packungen je 4,99; ${sharedCondition}`,
      rawText: 'SPAR feinstes Gefluegel Hendl Filetschnitzel gewuerzt, 400 g, ab 2 Pkg. je 4,99',
      comparisonSafe: true,
      searchKeywords: 'SPAR Hendl Filetschnitzel 400 g Grillfolder',
    }));
  }

  if (
    hasText(text, /spar\s+bbq\s+hendl-\s*grillteller|spar\s+bbq\s+hendl\s+grillteller/)
    && /600\s*g/.test(normalized)
    && /4[,.]\s*39/.test(normalized)
  ) {
    addSharedCandidate(meatCandidate({
      title: 'SPAR BBQ Hendl-Grillteller',
      brand: 'SPAR BBQ',
      price: 4.39,
      referencePrice: 5.39,
      quantityText: '600 g',
      conditionsText: `ab 2 Packungen je 4,39; ${sharedCondition}`,
      rawText: 'SPAR BBQ Hendl-Grillteller, 600 g, ab 2 Pkg. je 4,39',
      comparisonSafe: true,
      searchKeywords: 'SPAR BBQ Hendl Grillteller 600 g Grillfolder',
    }));
  }

  if (
    hasText(text, /spar\s+veggie/)
    && hasText(text, /bratwuerstel|bratwürstel/)
    && /240\s*g/.test(normalized)
    && /3[,.]\s*49/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'SPAR Veggie vegane Bratwuerstel',
      brand: 'SPAR Veggie',
      price: 3.49,
      referencePrice: 3.99,
      quantityText: '240 g',
      conditionsText: `ab 2 Packungen je 3,49; ${sharedCondition}`,
      rawText: 'SPAR Veggie vegane Bratwuerstel, gekuehlt, 240 g, ab 2 Pkg. je 3,49',
      comparisonSafe: true,
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Vegetarisch & Vegan',
      categoryKey: 'vegetarisch-vegan',
      searchKeywords: 'SPAR Veggie vegane Bratwuerstel 240 g Grillfolder',
    }));
  }

  if (
    hasText(text, /meggle/)
    && /krauterbutter|kraeuterbutter/.test(normalized)
    && /125\s*g/.test(normalized)
    && /1[,.]\s*49/.test(normalized)
  ) {
    addSharedCandidate(dairyCandidate({
      title: 'Meggle Kraeuterbutter',
      brand: 'Meggle',
      price: 1.49,
      referencePrice: 2.49,
      quantityText: '125 g',
      conditionsText: `ab 2 Stueck je 1,49; -40%; ${sharedCondition}`,
      rawText: 'Meggle Kraeuterbutter, 125 g, ab 2 Stk. je 1,49',
      comparisonSafe: true,
      searchKeywords: 'Meggle Kraeuterbutter 125 g Grillfolder',
    }));
  }

  if (
    /kasekrainer|kaesekrainer/.test(normalized)
    && hasText(text, /bratwurst/)
    && /360\s*g/.test(normalized)
    && /3[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(meatCandidate({
      title: 'Kaesekrainer, Puten-Kaesekrainer oder Bratwurst',
      brand: '',
      price: 3.99,
      referencePrice: 4.99,
      quantityText: '360 g',
      conditionsText: `ab 2 Packungen je 3,99; ${sharedCondition}`,
      rawText: 'Kaesekrainer, Puten-Kaesekrainer oder Bratwurst, 360 g, ab 2 Pkg. je 3,99',
      comparisonSafe: true,
      searchKeywords: 'Kaesekrainer Putenkaesekrainer Bratwurst 360 g Grillfolder',
    }));
  }

  if (
    hasText(text, /spar\s+bbq\s+grill-/)
    && /bratkase|bratkaese/.test(normalized)
    && /250\s*g/.test(normalized)
    && /2[,.]\s*89/.test(normalized)
  ) {
    addSharedCandidate(dairyCandidate({
      title: 'SPAR BBQ Grill- und Bratkaese',
      brand: 'SPAR BBQ',
      price: 2.89,
      referencePrice: 3.49,
      quantityText: '250 g',
      conditionsText: `ab 2 Packungen je 2,89; ${sharedCondition}`,
      rawText: 'SPAR BBQ Grill- und Bratkaese in Scheiben, 250 g, ab 2 Pkg. je 2,89',
      comparisonSafe: true,
      searchKeywords: 'SPAR BBQ Grillkaese Bratkaese 250 g Grillfolder',
    }));
  }

  if (
    hasText(text, /spar\s+bbq\s+coleslaw/)
    && /300\s*g\s*\/\s*350\s*g/.test(normalized)
    && /1[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'SPAR BBQ Coleslaw, Kartoffel- oder Nudelsalat',
      brand: 'SPAR BBQ',
      price: 1.99,
      referencePrice: 2.49,
      quantityText: '300-350 g',
      conditionsText: `ab 2 Bechern je 1,99; ${sharedCondition}`,
      rawText: 'SPAR BBQ Coleslaw, Kartoffel- oder Nudelsalat, 300 g/350 g, ab 2 Be. je 1,99',
      comparisonSafe: false,
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Feinkost & Fertiggerichte',
      categoryKey: 'feinkost-fertiggerichte',
      searchKeywords: 'SPAR BBQ Coleslaw Kartoffelsalat Nudelsalat 300 350 g Grillfolder',
    }));
  }

  if (
    hasText(text, /hellmann/)
    && hasText(text, /sauce|mayonnaise/)
    && /250\s*ml/.test(normalized)
    && /2[,.]\s*69/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: "Hellmann's Sauce oder Mayonnaise",
      brand: "Hellmann's",
      price: 2.69,
      referencePrice: 3.49,
      quantityText: '250 ml',
      conditionsText: `-22%; ${sharedCondition}`,
      rawText: "Hellmann's Sauce oder Mayonnaise, verschiedene Sorten, 250 ml, 2,69",
      comparisonSafe: true,
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Saucen & Gewuerze',
      categoryKey: 'saucen-gewuerze',
      searchKeywords: "Hellmann's Sauce Mayonnaise 250 ml Grillfolder",
    }));
  }

  if (
    hasText(text, /goesser|gösser/)
    && hasText(text, /soda\s+zitron\s+radler/)
    && /0[,.]\s*5\s*liter/.test(normalized)
    && /1[,.]\s*19/.test(normalized)
  ) {
    addSharedCandidate(beerCandidate({
      title: 'Goesser Soda Zitron Radler',
      brand: 'Goesser',
      price: 1.19,
      referencePrice: 1.49,
      quantityText: '0.5 l',
      conditionsText: `ab 6 Flaschen je 1,19; ${sharedCondition}`,
      rawText: 'Goesser Soda Zitron Radler, 0,5 Liter, ab 6 Fl. je 1,19',
      comparisonSafe: true,
      searchKeywords: 'Goesser Soda Zitron Radler 0.5 l Grillfolder',
    }));
  }

  if (
    hasText(text, /domaene\s+krems|domäne\s+krems/)
    && hasText(text, /gruener\s+veltliner|grüner\s+veltliner/)
    && /0[,.]\s*75\s*liter/.test(normalized)
    && /4[,.]\s*49/.test(normalized)
  ) {
    addSharedCandidate(wineCandidate({
      title: 'Domaene Krems Gruener Veltliner Niederoesterreich',
      brand: 'Domaene Krems',
      price: 4.49,
      referencePrice: 8.99,
      quantityText: '0.75 l',
      conditionsText: `ab 6 Flaschen je 4,49; keine weiteren Rabatte moeglich; ${sharedCondition}`,
      rawText: 'Domaene Krems Gruener Veltliner Niederoesterreich, 0,75 Liter, ab 6 Fl. je 4,49',
      comparisonSafe: true,
      searchKeywords: 'Domaene Krems Gruener Veltliner 0.75 l Grillfolder',
    }));
  }

  if (
    hasText(text, /woerle\s+american\s+toast/)
    && /200[-\s]?g/.test(normalized)
    && /2[,.]\s*19/.test(normalized)
  ) {
    addSharedCandidate(dairyCandidate({
      title: 'Woerle American Toast Schmelzkaese Scheiben oder XXL Burgerscheiben',
      brand: 'Woerle',
      price: 2.19,
      referencePrice: 2.89,
      quantityText: '200 g',
      conditionsText: `ab 2 Packungen je 2,19; ${sharedCondition}`,
      rawText: 'Woerle American Toast Schmelzkaese Scheiben oder XXL Burgerscheiben, 200-g-Packung, ab 2 Pkg. je 2,19',
      comparisonSafe: true,
      searchKeywords: 'Woerle American Toast Schmelzkaese 200 g Grillfolder',
    }));
  }

  if (
    hasText(text, /bio-halloumi\s+klassik/)
    && /200\s*g/.test(normalized)
    && /3[,.]\s*49/.test(normalized)
  ) {
    addSharedCandidate(dairyCandidate({
      title: 'Bio-Halloumi Klassik',
      brand: '',
      price: 3.49,
      referencePrice: 3.99,
      quantityText: '200 g',
      conditionsText: `ab 2 Packungen je 3,49; ${sharedCondition}`,
      rawText: 'Bio-Halloumi Klassik, 200 g, ab 2 Pkg. je 3,49',
      comparisonSafe: true,
      searchKeywords: 'Bio Halloumi Klassik 200 g Grillfolder',
    }));
  }

  if (
    hasText(text, /bio-ketchup/)
    && /550\s*g/.test(normalized)
    && /2[,.]\s*59/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'Bio-Ketchup',
      brand: '',
      price: 2.59,
      referencePrice: 3.49,
      quantityText: '550 g',
      conditionsText: `-25%; ${sharedCondition}`,
      rawText: 'Bio-Ketchup, 550 g, 2,59',
      comparisonSafe: true,
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Saucen & Gewuerze',
      categoryKey: 'saucen-gewuerze',
      searchKeywords: 'Bio Ketchup 550 g Grillfolder',
    }));
  }

  if (
    hasText(text, /bio-ajvar/)
    && /200\s*g/.test(normalized)
    && /3[,.]\s*69/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'Bio-Ajvar',
      brand: '',
      price: 3.69,
      referencePrice: 4.99,
      quantityText: '200 g',
      conditionsText: `-26%; ${sharedCondition}`,
      rawText: 'Bio-Ajvar, 200 g, 3,69',
      comparisonSafe: true,
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Saucen & Gewuerze',
      categoryKey: 'saucen-gewuerze',
      searchKeywords: 'Bio Ajvar 200 g Grillfolder',
    }));
  }

  if (
    hasText(text, /italienisches\s+natives\s+bio-olivenoel|italienisches\s+natives\s+bio-olivenöl/)
    && /0[,.]\s*75\s*liter/.test(normalized)
    && /10[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'Italienisches natives Bio-Olivenoel extra',
      brand: '',
      price: 10.99,
      referencePrice: 13.99,
      quantityText: '0.75 l',
      conditionsText: `ab 2 Flaschen je 10,99; ${sharedCondition}`,
      rawText: 'Italienisches natives Bio-Olivenoel extra, 0,75 Liter, ab 2 Fl. je 10,99',
      comparisonSafe: true,
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Oel & Essig',
      categoryKey: 'oel-essig',
      searchKeywords: 'Bio Olivenoel extra 0.75 l Grillfolder',
    }));
  }

  if (
    hasText(text, /ferrero\s+eis\s+cream/)
    && /270\s*[-–]\s*280\s*ml/.test(normalized)
    && /3[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(frozenCandidate({
      title: 'Ferrero Eis Cream',
      brand: 'Ferrero',
      price: 3.99,
      referencePrice: 5.49,
      quantityText: '270-280 ml',
      conditionsText: `${couponCondition}; beim Kauf von 2 Packungen`,
      rawText: 'Ferrero Eis Cream, verschiedene Sorten, 270-280 ml, mit Gutschein je Packung 3,99',
      comparisonSafe: false,
      searchKeywords: 'Ferrero Eis Cream 270 280 ml Gutscheinheft',
    }));
  }

  if (
    hasText(text, /eskimo\s+cremissimo/)
    && /1000\s*ml/.test(normalized)
    && /3[,.]\s*49/.test(normalized)
  ) {
    addSharedCandidate(frozenCandidate({
      title: 'Eskimo Cremissimo',
      brand: 'Eskimo',
      price: 3.49,
      referencePrice: 4.99,
      quantityText: '1000 ml',
      conditionsText: `${couponCondition}; beim Kauf von 2 Packungen`,
      rawText: 'Eskimo Cremissimo, verschiedene Sorten, 1000 ml, mit Gutschein je Packung 3,49',
      comparisonSafe: true,
      searchKeywords: 'Eskimo Cremissimo 1000 ml Gutscheinheft',
    }));
  }

  if (
    hasText(text, /spar\s+extra\s+natives\s+olivenoel|spar\s+extra\s+natives\s+olivenöl/)
    && /0[,.]\s*5\s*liter/.test(normalized)
    && /4[,.]\s*66/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'SPAR extra natives Olivenoel',
      brand: 'SPAR',
      price: 4.66,
      referencePrice: 6.99,
      quantityText: '0.5 l',
      conditionsText: `${couponCondition}; 2+1 gratis; beim Kauf von 3 Flaschen`,
      rawText: 'SPAR extra natives Olivenoel, 0,5 Liter, mit Gutschein je Flasche 4,66',
      comparisonSafe: true,
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Oel & Essig',
      categoryKey: 'oel-essig',
      searchKeywords: 'SPAR Olivenoel 0.5 l Gutscheinheft',
    }));
  }

  if (
    hasText(text, /original\s+bio-kornspitz/)
    && /0[,.]\s*50/.test(normalized)
  ) {
    addSharedCandidate(bakeryCandidate({
      title: 'Original Bio-Kornspitz',
      brand: '',
      price: 0.50,
      referencePrice: 0.89,
      quantityText: '1 Stueck',
      conditionsText: `${couponCondition}; beim Kauf von 4 Stueck`,
      rawText: 'Original Bio-Kornspitz, mit Gutschein je Stueck 0,50, 4 Stk. 2,-',
      comparisonSafe: true,
      searchKeywords: 'Original Bio Kornspitz 1 Stueck Gutscheinheft',
    }));
  }

  if (
    hasText(text, /ritter\s+sport\s+schokolade/)
    && /100\s*g/.test(normalized)
    && /1[,.]\s*46/.test(normalized)
  ) {
    addSharedCandidate(sweetCandidate({
      title: 'Ritter Sport Schokolade Bunte Vielfalt oder Nussklasse',
      brand: 'Ritter Sport',
      price: 1.46,
      referencePrice: 2.19,
      quantityText: '100 g',
      conditionsText: `${couponCondition}; 2+1 gratis; beim Kauf von 3 Tafeln`,
      rawText: 'Ritter Sport Schokolade Bunte Vielfalt oder Nussklasse, 100 g, mit Gutschein je Tafel 1,46',
      comparisonSafe: true,
      searchKeywords: 'Ritter Sport Schokolade 100 g Gutscheinheft',
    }));
  }

  if (
    hasText(text, /wiener\s+feinkristallzucker/)
    && /1\s*kg/.test(normalized)
    && /0[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'Wiener Feinkristallzucker',
      brand: 'Wiener Zucker',
      price: 0.99,
      referencePrice: 1.59,
      quantityText: '1 kg',
      conditionsText: `${couponCondition}; beim Kauf von 10 Packungen`,
      rawText: 'Wiener Feinkristallzucker, 1 kg, mit Gutschein je Packung 0,99 bei 10 Packungen',
      comparisonSafe: true,
      searchKeywords: 'Wiener Feinkristallzucker 1 kg Gutscheinheft',
    }));
  }

  if (
    hasText(text, /rauch\s+eistee/)
    && /1[,.]\s*5\s*liter/.test(normalized)
    && /1[,.]\s*09/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'Rauch Eistee',
      brand: 'Rauch',
      price: 1.09,
      referencePrice: 2.19,
      quantityText: '1.5 l',
      conditionsText: `${couponCondition}; 3+3 gratis; beim Kauf von 6 Flaschen`,
      rawText: 'Rauch Eistee, verschiedene Sorten, 1,5 Liter, mit Gutschein je Flasche 1,09',
      comparisonSafe: true,
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Alkoholfreie Getraenke',
      categoryKey: 'alkoholfreie-getraenke',
      searchKeywords: 'Rauch Eistee 1.5 l Gutscheinheft',
    }));
  }

  if (
    hasText(text, /happy\s+day/)
    && /1\s*liter/.test(normalized)
    && /1[,.]\s*79/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'Happy Day Apfel oder Multivitamin',
      brand: 'Happy Day',
      price: 1.79,
      referencePrice: 2.79,
      quantityText: '1 l',
      conditionsText: `${couponCondition}; beim Kauf von 4 Packungen`,
      rawText: 'Happy Day Apfel, Apfel trueb, Apfel mild, Multivitamin, Multivitamin mild oder Multivitamin rot, 1 Liter, mit Gutschein je Packung 1,79',
      comparisonSafe: true,
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Alkoholfreie Getraenke',
      categoryKey: 'alkoholfreie-getraenke',
      searchKeywords: 'Happy Day Apfel Multivitamin 1 l Gutscheinheft',
    }));
  }

  if (
    hasText(text, /zweigelt\s+lieblich/)
    && /0[,.]\s*75\s*liter/.test(normalized)
    && /2[,.]\s*49/.test(normalized)
  ) {
    addSharedCandidate(wineCandidate({
      title: 'Zweigelt lieblich Oesterreich',
      brand: '',
      price: 2.49,
      referencePrice: 4.99,
      quantityText: '0.75 l',
      conditionsText: `${couponCondition}; beim Kauf von 6 Flaschen`,
      rawText: 'Zweigelt lieblich Oesterreich, 0,75 Liter, mit Gutschein je Flasche 2,49',
      comparisonSafe: true,
      searchKeywords: 'Zweigelt lieblich 0.75 l Gutscheinheft',
    }));
  }

  if (
    hasText(text, /schwechater\s+bier/)
    && /0[,.]\s*5\s*liter/.test(normalized)
    && /0[,.]\s*59/.test(normalized)
  ) {
    addSharedCandidate(beerCandidate({
      title: 'Schwechater Bier',
      brand: 'Schwechater',
      price: 0.59,
      referencePrice: 1.38,
      quantityText: '0.5 l',
      conditionsText: `${couponCondition}; beim Kauf von 24 Dosen`,
      rawText: 'Schwechater Bier, 0,5 Liter, mit Gutschein je Dose 0,59, 24er-Tray 14,16',
      comparisonSafe: true,
      searchKeywords: 'Schwechater Bier 0.5 l Dose Gutscheinheft',
    }));
  }

  if (
    hasText(text, /meinl\s+jubilaeum|meinl\s+jubiläum/)
    && /500\s*g/.test(normalized)
    && /8[,.]\s*24/.test(normalized)
  ) {
    addSharedCandidate(groceryCandidate({
      title: 'Meinl Jubilaeum ganze Bohne oder gemahlen',
      brand: 'Meinl',
      price: 8.24,
      referencePrice: 16.49,
      quantityText: '500 g',
      conditionsText: `${couponCondition}; 1+1 gratis; beim Kauf von 2 Packungen`,
      rawText: 'Meinl Jubilaeum ganze Bohne oder gemahlen, 500 g, mit Gutschein je Packung 8,24',
      comparisonSafe: true,
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      categoryKey: 'kaffee-tee',
      searchKeywords: 'Meinl Jubilaeum Kaffee 500 g Gutscheinheft',
    }));
  }

  if (
    hasText(text, /substral\s+balkonpflanzenduenger|substral\s+balkonpflanzendünger/)
    && /2\s*liter/.test(normalized)
    && /7[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(gardenCandidate({
      title: 'Substral Balkonpflanzenduenger',
      brand: 'Substral',
      price: 7.99,
      referencePrice: 9.99,
      quantityText: '2 l',
      conditionsText: `${couponCondition}; beim Kauf von 2 Stueck`,
      rawText: 'Substral Balkonpflanzenduenger, fluessige Nahrung, 2 Liter, mit Gutschein je Stueck 7,99',
      comparisonSafe: true,
      searchKeywords: 'Substral Balkonpflanzenduenger 2 l Gutscheinheft',
    }));
  }

  if (
    hasText(text, /lovely\s+toilettenpapier/)
    && /10er-packung/.test(normalized)
    && /2[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate({
      productKind: 'generic-flyer-product',
      title: 'Lovely Toilettenpapier',
      brand: 'Lovely',
      price: 2.99,
      referencePrice: 3.89,
      quantityText: '10 Stueck',
      conditionsText: `${couponCondition}; beim Kauf von 3 Packungen`,
      rawText: 'Lovely Toilettenpapier, verschiedene Sorten, 3-lagig, 10er-Packung, mit Gutschein je Packung 2,99',
      comparisonSafe: true,
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Papier & Hygiene',
      categoryKey: 'papier-hygiene',
      searchKeywords: 'Lovely Toilettenpapier 10er Packung Gutscheinheft',
    });
  }

  if (
    hasText(text, /persil\s+pulver\s+oder\s+gel/)
    && /6[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(householdCandidate({
      title: 'Persil Pulver oder Gel, Megaperls oder Discs',
      brand: 'Persil',
      price: 6.99,
      referencePrice: 9.99,
      quantityText: '20-30 Waschgaenge',
      conditionsText: `${couponCondition}; beim Kauf von 2 Stueck`,
      rawText: 'Persil Pulver oder Gel 28/30 WG, Megaperls 23 WG oder Discs 20/22 WG, mit Gutschein je Stueck 6,99',
      comparisonSafe: false,
      searchKeywords: 'Persil Pulver Gel Megaperls Discs Waschmittel Gutscheinheft',
    }));
  }

  if (
    sourceRetailerFormat === 'interspar'
    && hasText(text, /simpex\s+basic\s+besteckset/)
    && hasText(text, /30-teilig/)
    && /29[,.]\s*99/.test(normalized)
  ) {
    addSharedCandidate(nonFoodPieceCandidate({
      title: 'SIMPEX BASIC Besteckset 30-teilig',
      brand: 'SIMPEX BASIC',
      price: 29.99,
      referencePrice: null,
      rawText: 'SIMPEX BASIC Besteckset 30-teilig, 29,99',
      conditionsText: 'Preise gueltig bis 31.07.2026 und solange der Vorrat reicht laut Mein Zuhause',
      validToOverride: new Date('2026-07-31T21:59:59.999Z'),
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Kueche & Kochen',
      categoryKey: 'kueche-kochen',
      searchKeywords: 'SIMPEX BASIC Besteckset 30-teilig Kueche Haushalt',
    }));
  }

  return candidates;
}

function extractKnownSparFamilyKw23RecoveryCandidatesFromPage(page, { sourceRetailerFormat } = {}) {
  if (!isSparFamilyPdfFormat(sourceRetailerFormat)) {
    return [];
  }

  const text = normalizePdfText(page.text || '');
  const normalized = normalizeForScan(text);
  const candidates = [];
  const appCondition = 'mit SPAR-App-Gutschein laut Flugblatt';
  const shortPromoCondition = 'von Mi., 03.06.2026 bis Sa., 06.06.2026 laut Flugblatt';

  const addRecoveryCandidate = (candidate) => addCandidate(candidates, page.pageNumber, {
    parserHint: 'known-spar-family-kw23-recovery-layout',
    ...candidate,
  });

  if (
    sourceRetailerFormat === 'spar'
    && /metaxa\s+5/.test(normalized)
    && /weinbrand/.test(normalized)
    && /0[,.]\s*7\s*liter/.test(normalized)
    && /29[,.]\s*92/.test(normalized)
  ) {
    addRecoveryCandidate(groceryCandidate({
      title: 'Metaxa 5 Sterne Weinbrand',
      brand: 'Metaxa',
      price: 29.92,
      referencePrice: 49.90,
      quantityText: '0.7 l',
      conditionsText: `${appCondition}; ${shortPromoCondition}`,
      rawText: 'Metaxa 5 Sterne Weinbrand Griechenland, 0,7 Liter, mit SPAR-App-Gutschein 29,92',
      comparisonSafe: true,
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Spirituosen',
      categoryKey: 'spirituosen',
      searchKeywords: 'Metaxa Weinbrand 0.7 l SPAR App Gutschein',
    }));
  }

  if (
    sourceRetailerFormat === 'spar'
    && /henkell\s+sekt/.test(normalized)
    && /13[,.]\s*99/.test(normalized)
  ) {
    addRecoveryCandidate(wineCandidate({
      title: 'Henkell Sekt',
      brand: 'Henkell',
      price: 13.99,
      referencePrice: 17.99,
      quantityText: '0.75 l',
      conditionsText: appCondition,
      rawText: 'Henkell Sekt, verschiedene Sorten, mit SPAR-App-Gutschein 13,99',
      comparisonSafe: true,
      searchKeywords: 'Henkell Sekt 0.75 l SPAR App Gutschein',
    }));
  }

  if (
    ['spar', 'eurospar'].includes(sourceRetailerFormat)
    && /roemerquelle|mineralwasser/.test(normalized)
    && /6\s*\+?\s*6\s+gratis/.test(normalized)
    && /1[,.]\s*5\s*liter/.test(normalized)
    && /5[,.]\s*64/.test(normalized)
  ) {
    addRecoveryCandidate(groceryCandidate({
      title: 'Roemerquelle Mineralwasser',
      brand: 'Roemerquelle',
      price: 5.64,
      referencePrice: 11.28,
      quantityText: '12 x 1.5 l',
      conditionsText: '6+6 gratis; 2x6er-Tray laut Flugblatt',
      rawText: 'Roemerquelle Mineralwasser, verschiedene Sorten, 1,5 Liter, 2x6er-Tray, 5,64',
      comparisonSafe: true,
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Alkoholfreie Getraenke',
      categoryKey: 'alkoholfreie-getraenke',
      searchKeywords: 'Roemerquelle Mineralwasser 1.5 l 6+6 gratis 2x6er Tray',
    }));
  }

  if (
    sourceRetailerFormat === 'eurospar'
    && /coca/.test(normalized)
    && /cola/.test(normalized)
    && /limonaden/.test(normalized)
    && /0[,.]\s*33\s*liter/.test(normalized)
    && /24er/.test(normalized)
    && /tray/.test(normalized)
    && /(?:16[,.]\s*56|1656)/.test(normalized)
  ) {
    addRecoveryCandidate(groceryCandidate({
      title: 'Coca-Cola Limonaden',
      brand: 'Coca-Cola',
      price: 16.56,
      referencePrice: 33.36,
      quantityText: '24 x 0.33 l',
      conditionsText: 'ab 24 Dosen je 0,69 laut Flugblatt',
      rawText: 'Coca-Cola Limonaden, verschiedene Sorten, 0,33 Liter, 24er-Tray, 16,56',
      comparisonSafe: true,
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Alkoholfreie Getraenke',
      categoryKey: 'alkoholfreie-getraenke',
      searchKeywords: 'Coca Cola Limonaden 0.33 l 24er Tray',
    }));
  }

  if (
    sourceRetailerFormat === 'eurospar'
    && /goesser\s+maerzen|gosser\s+marzen/.test(normalized)
    && /20er-kiste/.test(normalized)
    && /14[,.]\s*90/.test(normalized)
  ) {
    addRecoveryCandidate(beerCandidate({
      title: 'Goesser Maerzen',
      brand: 'Goesser',
      price: 14.90,
      referencePrice: 29.80,
      quantityText: '20 x 0.5 l',
      conditionsText: '-50%; 20er-Kiste laut Flugblatt',
      rawText: 'Goesser Maerzen, 0,5 Liter, 20er-Kiste, 14,90',
      comparisonSafe: true,
      searchKeywords: 'Goesser Maerzen Bier 20er Kiste 0.5 l',
    }));
  }

  if (
    sourceRetailerFormat === 'spar'
    && /pampers\s+(?:baby\s+dry|premium\s+protection)|baby\s+dry\s+pants/.test(normalized)
    && /ab\s+2\s+pkg/.test(normalized)
    && /7[,.]\s*99/.test(normalized)
  ) {
    addRecoveryCandidate({
      productKind: 'generic-flyer-product',
      title: 'Pampers Baby Dry Windeln, Pants oder Premium Protection',
      brand: 'Pampers',
      price: 7.99,
      referencePrice: 9.99,
      quantityText: '1 Packung',
      conditionsText: 'ab 2 Packungen je 7,99; -20% laut Flugblatt',
      rawText: 'Pampers Baby Dry Windeln, Baby Dry Pants oder Premium Protection, verschiedene Groessen, ab 2 Pkg. je 7,99',
      comparisonSafe: false,
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Baby & Kind',
      categoryKey: 'baby-kind',
      searchKeywords: 'Pampers Baby Dry Windeln Pants Premium Protection',
    });
  }

  if (
    sourceRetailerFormat === 'spar'
    && /farina\s+mehl\s+t480/.test(normalized)
    && /2[,.]\s*5\s*kg/.test(normalized)
    && /3[,.]\s*19/.test(normalized)
  ) {
    addRecoveryCandidate(groceryCandidate({
      title: 'Farina Mehl T480',
      brand: 'Farina',
      price: 3.19,
      referencePrice: 3.99,
      quantityText: '2.5 kg',
      conditionsText: '-20% laut Flugblatt',
      rawText: 'Farina Mehl T480, 2,5 kg, 3,19 statt 3,99',
      comparisonSafe: true,
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Backen & Grundnahrungsmittel',
      categoryKey: 'backen-grundnahrungsmittel',
      searchKeywords: 'Farina Mehl T480 2.5 kg SPAR',
    }));
  }

  if (
    sourceRetailerFormat === 'spar'
    && /gefrorene\s+fruchte|gefrorene\s+fruechte/.test(normalized)
    && /schokolade/.test(normalized)
    && /200\s*g/.test(normalized)
    && /3[,.]\s*99/.test(normalized)
  ) {
    addRecoveryCandidate(frozenCandidate({
      title: 'Gefrorene Fruechte in Schokolade',
      brand: '',
      price: 3.99,
      referencePrice: 5.79,
      quantityText: '200 g',
      conditionsText: '-31% laut Flugblatt',
      rawText: 'Gefrorene Fruechte eingetaucht in zwei Schichten Schokolade, verschiedene Sorten, tiefgekuehlt, 200 g, 3,99',
      comparisonSafe: true,
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Suesswaren & Knabbereien',
      categoryKey: 'suesswaren-knabbereien',
      searchKeywords: 'gefrorene Fruechte Schokolade tiefgekuehlt 200 g SPAR',
    }));
  }

  if (
    sourceRetailerFormat === 'spar'
    && /knackig,\s*susse\s+kirschen|knackig,\s*sue?e\s+kirschen|kirschen\s+klasse\s+1/.test(normalized)
    && /per\s+kg/.test(normalized)
    && /4[,.]\s*99/.test(normalized)
  ) {
    addRecoveryCandidate(produceCandidate({
      title: 'Kirschen Klasse 1',
      brand: '',
      price: 4.99,
      referencePrice: 6.99,
      quantityText: '1 kg',
      conditionsText: 'Kirschen-Angebot gueltig bis Sa., 06.06.2026 laut Flugblatt',
      rawText: 'Knackig, suesse Kirschen Klasse 1, aus Spanien, per kg 4,99 statt 6,99',
      comparisonSafe: true,
      searchKeywords: 'Kirschen Klasse 1 Obst 1 kg SPAR',
    }));
  }

  if (
    /always\s*ultra\s*binden(?:\s*big\s*pack)?/.test(normalized)
    && /big\s*pack|12\s*-\s*26\s*(?:stuck|stueck)/.test(normalized)
    && /12\s*-\s*26\s*(?:stuck|stueck)/.test(normalized)
    && /3[,.]\s*19/.test(normalized)
  ) {
    addRecoveryCandidate({
      productKind: 'generic-flyer-product',
      title: 'Always Ultra Binden Big Pack',
      brand: 'Always',
      price: 3.19,
      referencePrice: 4.08,
      quantityText: '12-26 Stueck',
      conditionsText: 'ab 2 Packungen je 3,19; -21% laut Flugblatt',
      rawText: 'Always Ultra Binden Big Pack, verschiedene Sorten, 12-26 Stueck, ab 2 Pkg. je 3,19',
      comparisonSafe: false,
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Damenhygiene',
      categoryKey: 'damenhygiene',
      searchKeywords: 'Always Ultra Binden Big Pack 12 26 Stueck SPAR',
    });
  }

  if (
    sourceRetailerFormat === 'eurospar'
    && /pepsi\s+oder\s+pepsi\s+zero|pepsi\s+cola/.test(normalized)
    && /1[,.]\s*5\s*liter/.test(normalized)
    && /0[,.]\s*99/.test(normalized)
  ) {
    addRecoveryCandidate(groceryCandidate({
      title: 'Pepsi oder Pepsi Zero',
      brand: 'Pepsi',
      price: 0.99,
      referencePrice: 1.99,
      quantityText: '1.5 l',
      conditionsText: '3+3 gratis; ab 6 Flaschen je 0,99 laut Flugblatt',
      rawText: 'Pepsi oder Pepsi Zero, 1,5 Liter, ab 6 Fl. je 0,99, 6er-Tray 5,94',
      comparisonSafe: true,
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Softdrinks & Energy',
      categoryKey: 'softdrinks-energy',
      searchKeywords: 'Pepsi Pepsi Zero Cola 1.5 l EUROSPAR',
    }));
  }

  if (
    sourceRetailerFormat === 'eurospar'
    && /la\s+gioiosa\s+prosecco/.test(normalized)
    && /7[,.]\s*49/.test(normalized)
  ) {
    addRecoveryCandidate(wineCandidate({
      title: 'La Gioiosa Prosecco',
      brand: 'La Gioiosa',
      price: 7.49,
      referencePrice: 14.99,
      quantityText: '0.75 l',
      conditionsText: '1+1 gratis laut Flugblatt',
      rawText: 'La Gioiosa Prosecco, 0,75 Liter, ab 2 Fl. je 7,49',
      comparisonSafe: true,
      searchKeywords: 'La Gioiosa Prosecco 0.75 l EUROSPAR',
    }));
  }

  if (
    sourceRetailerFormat === 'eurospar'
    && /faschiertes\s+gemischt/.test(normalized)
    && /9[,.]\s*99/.test(normalized)
    && /per\s+kg/.test(normalized)
  ) {
    addRecoveryCandidate(meatCandidate({
      title: 'Faschiertes gemischt',
      brand: '',
      price: 9.99,
      referencePrice: 12.99,
      quantityText: '1 kg',
      conditionsText: '-23% laut Flugblatt',
      rawText: 'Faschiertes gemischt aus Oesterreich, aus Rind- und Schweinefleisch, in Bedienung, per kg 9,99',
      comparisonSafe: true,
      searchKeywords: 'Faschiertes gemischt Rind Schwein 1 kg EUROSPAR',
    }));
  }

  if (
    sourceRetailerFormat === 'eurospar'
    && /landle\s+klostertaler|laendle\s+klostertaler/.test(normalized)
    && /100\s*g/.test(normalized)
    && /2[,.]\s*79/.test(normalized)
  ) {
    addRecoveryCandidate(dairyCandidate({
      title: 'Laendle Klostertaler',
      brand: 'Laendle',
      price: 2.79,
      referencePrice: 3.29,
      quantityText: '100 g',
      conditionsText: '-15% laut Flugblatt',
      rawText: 'Laendle Klostertaler, 100 g, 2,79 statt 3,29',
      comparisonSafe: true,
      categoryPrimary: 'Lebensmittel',
      categorySecondary: 'Kaese',
      categoryKey: 'kaese',
      searchKeywords: 'Laendle Klostertaler Kaese 100 g EUROSPAR',
    }));
  }

  return candidates;
}

function extractKnownCoffeeCandidatesFromPage(page, { sourceRetailerFormat, validity }) {
  const text = normalizePdfText(page.text || '');
  const normalized = normalizeForScan(text);
  const candidates = [];

  if (/\bbis zu\s*-?25\s*%\s+auf kaffee/i.test(normalized)) {
    addRejectedCandidate(candidates, page.pageNumber, 'campaign-not-product', 'bis zu -25% auf Kaffee');
  }

  const validToMay12 = /angebot gueltig bis\s+di[,.]?\s*12\.5\.26/i.test(normalized)
    || /di[,.]?\s*12\.5\.2026/i.test(normalized)
    ? parseAustrianDate(12, 5, 2026)
    : null;

  if (
    sourceRetailerFormat === 'spar'
    && hasText(text, /eduscho crema elegante/)
    && hasText(text, /ganze bohne/)
    && hasText(text, /1\s*kg/)
    && /15[,\s]*99/i.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, {
      title: 'Eduscho Crema Elegante',
      brand: 'Eduscho',
      price: 15.99,
      referencePrice: null,
      quantityText: '1 kg',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      categoryKey: 'kaffee-tee',
      conditionsText: '',
      rawText: 'Eduscho Crema Elegante ganze Bohne, 1 kg',
      comparisonSafe: true,
    });
  }

  if (hasText(text, /meinl praesident/) && hasText(text, /500[-\s]?g(?:ramm)?|500[-\s]?g-packung/)) {
    const unitPriceMatch = normalized.match(/per kg\s+14[,.]\s*50/) || normalized.match(/per kg\s+10[,.]\s*88/);
    const price = unitPriceMatch
      ? priceFromUnitPrice('500 g', unitPriceMatch[0].match(/(\d{1,2}[,.]\s*\d{2})/)?.[1])
      : null;

    addCandidate(candidates, page.pageNumber, {
      title: 'Meinl Praesident ganze Bohne oder gemahlen',
      brand: 'Meinl',
      price,
      referencePrice: null,
      quantityText: '500 g',
      conditionsText: validToMay12 ? 'Angebot gueltig bis Di., 12.5.2026 laut Flugblatt' : '',
      validToOverride: validToMay12,
      rawText: 'Meinl Praesident ganze Bohne oder gemahlen, 500 g',
      comparisonSafe: true,
      rejectionHint: '',
    });
  }

  if (hasText(text, /dallmayr prodomo/) && hasText(text, /500[-\s]?g-packung|500\s*g/)) {
    const unitPriceMatch = normalized.match(/per kg\s+23[,.]\s*98/);
    const price = unitPriceMatch
      ? priceFromUnitPrice('500 g', unitPriceMatch[0].match(/(\d{1,2}[,.]\s*\d{2})/)?.[1])
      : null;

    addCandidate(candidates, page.pageNumber, {
      title: 'Dallmayr Prodomo ganze Bohne oder gemahlen',
      brand: 'Dallmayr',
      price,
      referencePrice: null,
      quantityText: '500 g',
      conditionsText: '',
      rawText: 'Dallmayr Prodomo ganze Bohne oder gemahlen, 500-g-Packung',
      comparisonSafe: true,
    });
  }

  const hasLavazzaEspressoBlock = hasText(text, /lavazza espresso/)
    && hasText(text, /cremoso/)
    && hasText(text, /crema e aroma/)
    && hasText(text, /1000\s*g|1[-\s]?kg-packung|1\s*kg/);
  if (hasLavazzaEspressoBlock && /(?:statt\s+28[,\s]*99|22[,\s]*99)/i.test(normalized)) {
    addCandidate(candidates, page.pageNumber, {
      title: 'Lavazza Espresso Cremoso, Espresso Aromatico oder Crema e Aroma',
      brand: 'Lavazza',
      price: 22.99,
      referencePrice: hasText(text, /statt\s+28[,.]\s*99/) ? 28.99 : null,
      quantityText: '1 kg',
      conditionsText: '',
      rawText: 'Lavazza Espresso Cremoso, Espresso Aromatico oder Crema e Aroma, ganze Bohne, 1 kg',
      comparisonSafe: true,
    });
  } else if (hasLavazzaEspressoBlock) {
    addCandidate(candidates, page.pageNumber, {
      title: 'Lavazza Espresso Cremoso, Espresso Aromatico oder Crema e Aroma',
      brand: 'Lavazza',
      price: null,
      referencePrice: null,
      quantityText: '1 kg',
      conditionsText: '',
      rawText: 'Lavazza Espresso Cremoso, Espresso Aromatico oder Crema e Aroma, ganze Bohne, 1 kg',
      comparisonSafe: false,
    });
  }

  if (
    sourceRetailerFormat === 'interspar'
    && hasText(text, /lavazza caffe crema classico/)
    && hasText(text, /crema edition/)
    && hasText(text, /1[-\s]?kg-packung|1\s*kg/)
    && /(?:statt\s+27[,\s]*49|19[,\s]*99)/i.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, {
      title: 'Lavazza Caffe Crema Classico oder Crema Edition',
      brand: 'Lavazza',
      price: 19.99,
      referencePrice: hasText(text, /statt\s+27[,.]\s*49/) ? 27.49 : null,
      quantityText: '1 kg',
      conditionsText: '',
      rawText: 'Lavazza Caffe Crema Classico oder Crema Edition, ganze Bohne, 1-kg-Packung',
      comparisonSafe: true,
    });
  }

  return candidates;
}

function extractKnownChocolateCandidatesFromPage(page, { sourceRetailerFormat } = {}) {
  const text = normalizePdfText(page.text || '');
  const normalized = normalizeForScan(text);
  const candidates = [];

  if (
    sourceRetailerFormat === 'spar'
    && hasText(text, /milka schokolade/)
    && /ab\s+2\s+pkg\.?\s+je\s*5[,.]\s*49/i.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, sweetCandidate({
      title: 'Milka Schokolade versch. Sorten',
      brand: 'Milka',
      price: 5.49,
      referencePrice: /1\s+pkg\.?\s+6[,.]\s*49/i.test(normalized) ? 6.49 : null,
      quantityText: '85-100 g',
      conditionsText: 'ab 2 Packungen laut Flugblatt',
      rawText: 'Milka Schokolade versch. Sorten, 85-100 g, ab 2 Packungen je 5,49',
      comparisonSafe: false,
    }));
  }

  if (
    sourceRetailerFormat === 'spar'
    && hasText(text, /schogetten/)
    && /ab\s+4\s+pkg\.?\s+je\s*0[,.]\s*99/i.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, sweetCandidate({
      title: 'Schogetten Schokolade versch. Sorten',
      brand: 'Schogetten',
      price: 0.99,
      referencePrice: /1\s+pkg\.?\s+1[,.]\s*99/i.test(normalized) ? 1.99 : null,
      quantityText: '100 g',
      conditionsText: '2+2 gratis / ab 4 Packungen laut Flugblatt',
      rawText: 'Schogetten Schokolade versch. Sorten, 100 g, ab 4 Packungen je 0,99',
      comparisonSafe: true,
    }));
  }

  return candidates;
}

function extractKnownBeerCandidatesFromPage(page, { sourceRetailerFormat } = {}) {
  const text = normalizePdfText(page.text || '');
  const normalized = normalizeForScan(text);
  const candidates = [];
  const extraPercentCondition = 'Zusaetzlich -25% am Fr., 22.5. und Sa., 23.5.2026 laut Flugblatt';

  const hasPuntigamerCrateDeal = hasText(text, /puntigamer/)
    && hasText(text, /kiste/)
    && hasText(text, /1\s*\+\s*1\s*gratis/)
    && /29[,\s]*80/i.test(normalized)
    && /(?:14[,\s]*90|1490)/i.test(normalized);

  if (hasPuntigamerCrateDeal) {
    const explicitTwentyPack = /20\s*x\s*0[,.]\s*5\s*-?\s*(?:liter|l)/i.test(normalized);
    const title = hasText(text, /bierige/) ? 'Puntigamer das bierige Bier' : 'Puntigamer Maerzen';
    const fallbackCrateQuantity = inferAustrianBeerCrateQuantityFields({
      title,
      brand: 'Puntigamer',
      quantityText: 'Kiste, 0.5 l Flaschen',
      conditionsText: '1+1 gratis / 1 Kiste 29,80 / ab 2 Kisten je 14,90 / Keine weiteren Rabatte/Joker moeglich',
      rawFacts: { sourceText: text },
    });
    const safeCrateQuantityText = explicitTwentyPack ? '20 x 0.5 l' : fallbackCrateQuantity?.quantityText || 'Kiste, 0.5 l Flaschen';

    addCandidate(candidates, page.pageNumber, beerCandidate({
      title,
      brand: 'Puntigamer',
      price: 14.90,
      referencePrice: 29.80,
      quantityText: safeCrateQuantityText,
      conditionsText: '1+1 gratis / 1 Kiste 29,80 / ab 2 Kisten je 14,90 / Keine weiteren Rabatte/Joker moeglich',
      rawText: `${title}, 0,5 Liter, 1+1 gratis, 1 Kiste 29,80, ab 2 Kisten je 14,90`,
      comparisonSafe: Boolean(explicitTwentyPack || fallbackCrateQuantity),
    }));
  }

  if (hasText(text, /puntigamer\s*(?:maerzen|marzen)/) && hasText(text, /0[,.]\s*5\s*liter/) && /ab\s+24\s+ds\.?\s+je\s*0[,.]\s*99/i.test(normalized)) {
    addCandidate(candidates, page.pageNumber, beerCandidate({
      title: 'Puntigamer Maerzen',
      brand: 'Puntigamer',
      price: 0.99,
      referencePrice: hasText(text, /1\s*ds\.?\s+1[,.]\s*54/) ? 1.54 : null,
      quantityText: '0.5 l',
      conditionsText: `ab 24 Dosen. ${extraPercentCondition}`,
      rawText: 'Puntigamer Maerzen, 0,5 Liter, ab 24 Dosen je 0,99',
      comparisonSafe: true,
    }));
  }

  if (
    sourceRetailerFormat === 'spar'
    && hasText(text, /puntigamer das.*bierige.* bier/)
    && hasText(text, /0[,\s.]*5\s*liter/)
    && /ab\s+6\s+ds\.?\s+je\s*0[,\s.]*79/i.test(normalized)
  ) {
    addCandidate(candidates, page.pageNumber, beerCandidate({
      title: 'Puntigamer das bierige Bier',
      brand: 'Puntigamer',
      price: 0.79,
      referencePrice: /1\s+ds\.?\s+1[,\s.]*19/i.test(normalized) ? 1.19 : null,
      quantityText: '0.5 l',
      conditionsText: 'ab 6 Dosen laut Flugblatt',
      rawText: 'Puntigamer das bierige Bier, 0,5 Liter, ab 6 Dosen je 0,79',
      comparisonSafe: true,
    }));
  }

  if (
    hasText(text, /(?:goesser|gosser|g.sser)\s*(?:maerzen|marzen|m.rzen)/)
    && hasText(text, /naturradler/)
    && hasText(text, /0[,.]\s*5\s*(?:-\s*)?liter/)
    && (/ab\s+6\s+(?:ds|dosen)\.?\s+je\s*0[,.]\s*99/i.test(normalized) || (sourceRetailerFormat === 'interspar' && /mengen\s*vorteil\s*099/i.test(normalized)))
  ) {
    addCandidate(candidates, page.pageNumber, beerCandidate({
      title: 'Goesser Maerzen, Naturradler Zitrone oder Naturradler Zitrone alkoholfrei',
      brand: 'Goesser',
      price: 0.99,
      referencePrice: /1\s+(?:ds|dose)\.?\s+1[,.]\s*59/i.test(normalized) ? 1.59 : null,
      quantityText: '0.5 l',
      conditionsText: `ab 6 Dosen. ${extraPercentCondition}`,
      rawText: 'Goesser Maerzen, Naturradler Zitrone oder Naturradler Zitrone alkoholfrei, 0,5 Liter, ab 6 Dosen je 0,99',
      comparisonSafe: true,
    }));
  }

  if (
    hasText(text, /hirter\s*privat pils/)
    && hasText(text, /0[,.]\s*5\s*(?:-\s*)?liter/)
    && (/ab\s+6\s+(?:fl|flaschen)\.?\s+je\s*1[,.]\s*19/i.test(normalized) || (sourceRetailerFormat === 'interspar' && /mengen\s*vorteil\s*119/i.test(normalized)))
  ) {
    addCandidate(candidates, page.pageNumber, beerCandidate({
      title: 'Hirter Privat Pils',
      brand: 'Hirter',
      price: 1.19,
      referencePrice: /1\s+(?:fl|flasche)\.?\s+1[,.]\s*47/i.test(normalized) ? 1.47 : null,
      quantityText: '0.5 l',
      conditionsText: `ab 6 Flaschen. ${extraPercentCondition}`,
      rawText: 'Hirter Privat Pils, 0,5 Liter, ab 6 Flaschen je 1,19',
      comparisonSafe: true,
    }));
  }

  if (hasText(text, /schwechater\s*bier/) && (hasText(text, /20\s*x\s*0[,.]\s*5\s*(?:-\s*)?liter/) || hasText(text, /20er-kiste/)) && /16[,.]\s*80/i.test(normalized)) {
    addCandidate(candidates, page.pageNumber, beerCandidate({
      title: 'Schwechater Bier 20 x 0,5 Liter',
      brand: 'Schwechater',
      price: 16.80,
      referencePrice: /statt\s+19[,.]\s*40/i.test(normalized) ? 19.40 : null,
      quantityText: '20 x 0.5 l',
      conditionsText: extraPercentCondition,
      rawText: 'Schwechater Bier, 20 x 0,5 Liter, 16,80',
      comparisonSafe: true,
    }));
  }

  if (
    hasText(text, /ottakringer\s*helles/)
    && hasText(text, /frucade\s*radler/)
    && hasText(text, /0[,.]\s*5\s*(?:-\s*)?liter/)
    && (/ab\s+(?:12|24)\s+ds\.?\s+je\s*0[,.]\s*69/i.test(normalized) || (sourceRetailerFormat === 'interspar' && /12\+12\s+gratis\s*ottakringer|ottakringer[\s\S]{0,180}\b069\b/i.test(normalized)))
  ) {
    addCandidate(candidates, page.pageNumber, beerCandidate({
      title: 'Ottakringer Helles oder Frucade Radler',
      brand: 'Ottakringer',
      price: 0.69,
      referencePrice: /1\s+ds\.?\s+1[,.]\s*39/i.test(normalized) ? 1.39 : null,
      quantityText: '0.5 l',
      conditionsText: `12+12 gratis bzw. Mengenpreis laut Flugblatt. ${extraPercentCondition}`,
      rawText: 'Ottakringer Helles oder Frucade Radler, 0,5 Liter, ab 12/24 Dosen je 0,69',
      comparisonSafe: true,
    }));
  }

  if (sourceRetailerFormat === 'interspar' && hasText(text, /peroni nastro azzurro/) && /16\s*80|1680/i.test(normalized)) {
    addCandidate(candidates, page.pageNumber, beerCandidate({
      title: 'Peroni Nastro Azzurro',
      brand: 'Peroni',
      price: 16.80,
      referencePrice: /statt\s+19[,.]\s*40/i.test(normalized) ? 19.40 : null,
      quantityText: '20 x 0.33 l',
      conditionsText: extraPercentCondition,
      rawText: 'Peroni Nastro Azzurro, 0,33-Liter-Flasche, 16,80',
      comparisonSafe: false,
    }));
  }

  if (sourceRetailerFormat === 'interspar' && hasText(text, /puntigamer das .*bierige.* bier/) && /ab\s+24\s+dosen\s+je/i.test(normalized) && /099|0[,.]\s*99/i.test(normalized)) {
    addCandidate(candidates, page.pageNumber, beerCandidate({
      title: 'Puntigamer das bierige Bier',
      brand: 'Puntigamer',
      price: 0.99,
      referencePrice: /1\s+dose\s+1[,.]\s*54/i.test(normalized) ? 1.54 : null,
      quantityText: '0.5 l',
      conditionsText: `ab 24 Dosen. ${extraPercentCondition}`,
      rawText: 'Puntigamer das bierige Bier, 0,5-Liter-Dose, ab 24 Dosen je 0,99',
      comparisonSafe: true,
    }));
  }

  return candidates;
}

function fishCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    categoryKey: 'fleisch-wurst-fisch',
    searchKeywords: 'fisch frisch tiefkuehl lachs goldbrasse garnelen spar interspar',
    parserHint: 'known-spar-family-kw24-layout',
    ...data,
  };
}

function cheeseCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Kaese',
    categoryKey: 'kaese',
    searchKeywords: 'kaese mozzarella appenzeller feinkost spar',
    parserHint: 'known-spar-family-kw24-layout',
    ...data,
  };
}

function drugstoreCandidate(data = {}) {
  return {
    productKind: 'generic-flyer-product',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Drogerie',
    categoryKey: 'drogerie',
    searchKeywords: 'drogerie hygiene waschmittel reinigung haushalt spar',
    parserHint: 'known-spar-family-kw24-layout',
    ...data,
  };
}

function addKnownCandidateIf(candidates, page, condition, candidate) {
  if (!condition) return;
  addCandidate(candidates, page.pageNumber, {
    parserHint: 'known-spar-family-kw24-layout',
    comparisonSafe: true,
    ...candidate,
  });
}

function addKnownCurrentCandidateIf(candidates, page, condition, candidate) {
  if (!condition) return;
  addCandidate(candidates, page.pageNumber, {
    comparisonSafe: true,
    ...candidate,
    parserHint: 'known-spar-family-kw25-current-layout',
  });
}

function matchesPriceToken(normalizedText = '', euro, cents) {
  const euroPart = String(euro);
  const centsPart = String(cents).padStart(2, '0');
  const compact = `${euroPart}${centsPart}`;
  return new RegExp(`(?:^|\\D)(?:${euroPart}[,\\s]*${centsPart}|${compact})(?!\\d)`, 'i').test(normalizedText);
}

function extractKnownSparFamilyKw25CurrentCandidatesFromPage(page, { sourceRetailerFormat } = {}) {
  const text = normalizePdfText(page.text || '');
  const normalized = normalizeForScan(text);
  const candidates = [];
  const isSpar = sourceRetailerFormat === 'spar';
  const isInterspar = sourceRetailerFormat === 'interspar';
  const hasNiveaKw25ThresholdPrice = matchesPriceToken(normalized, 3, 49)
    || /je\s*3[,\s]*49/i.test(normalized);
  const hasNiveaKw25ReferencePrice = matchesPriceToken(normalized, 4, 39)
    || /stk\.?\s*4[,\s]*39/i.test(normalized);
  const hasAperolKw25Price = matchesPriceToken(normalized, 8, 99)
    || /(?:^|\D)899(?=1\s*flasche|ab\s*2\s*flaschen|statt)/i.test(normalized);

  addKnownCurrentCandidateIf(candidates, page, isSpar
    && hasText(text, /s-budget\s+hendlfilet/)
    && /700\s*g/i.test(normalized)
    && matchesPriceToken(normalized, 7, 79), meatCandidate({
      title: 'S-BUDGET Hendlfilet grillfertig',
      brand: 'S-BUDGET',
      price: 7.79,
      referencePrice: matchesPriceToken(normalized, 9, 9) ? 9.09 : null,
      quantityText: '700 g',
      conditionsText: '',
      rawText: 'S-BUDGET Hendlfilet aus Oesterreich, 700 g, 7,79',
    }));

  addKnownCurrentCandidateIf(candidates, page, isSpar
    && hasText(text, /spar\s+nektarinen|frische\s+spar\s+nektarinen|nektarinen/)
    && /1-?kg-tasse|1\s*kg\s*tasse/i.test(normalized)
    && /aktion\s*!?\s*2\s*[-,]?|\b2\s*[-,]\b/i.test(normalized), produceCandidate({
      title: 'SPAR Nektarinen',
      brand: 'SPAR',
      price: 2.00,
      referencePrice: matchesPriceToken(normalized, 2, 99) ? 2.99 : null,
      quantityText: '1 kg',
      conditionsText: 'Nektarinen-Angebot gueltig bis Sa., 20.6.2026 laut Flugblatt',
      rawText: 'Fruchtig frische SPAR Nektarinen, 1-kg-Tasse, Aktion 2,-',
      validToOverride: new Date('2026-06-20T21:59:59.999Z'),
    }));

  addKnownCurrentCandidateIf(candidates, page, isSpar
    && hasText(text, /nivea\s+creme\s+dose/)
    && /creme\s*soft/i.test(normalized)
    && hasNiveaKw25ThresholdPrice, drugstoreCandidate({
      title: 'Nivea Creme Dose oder Creme Soft Tiegel',
      brand: 'Nivea',
      price: 3.49,
      referencePrice: hasNiveaKw25ReferencePrice ? 4.39 : null,
      quantityText: '200-250 ml',
      conditionsText: 'ab 2 Stueck je 3,49 / zusaetzlich -25% auf NIVEA-Produkte und LABELLO laut Flugblatt',
      rawText: 'Nivea Creme Dose 250 ml oder Creme Soft Tiegel 200 ml, ab 2 Stueck je 3,49',
      comparisonSafe: false,
    }));

  addKnownCurrentCandidateIf(candidates, page, isSpar
    && hasText(text, /iglo\s+feinste\s+backhendlstreifen/)
    && /200\s*-\s*250\s*g/i.test(normalized)
    && matchesPriceToken(normalized, 4, 49), frozenCandidate({
      title: 'Iglo Feinste Backhendlstreifen',
      brand: 'Iglo',
      price: 4.49,
      referencePrice: matchesPriceToken(normalized, 8, 99) ? 8.99 : null,
      quantityText: '200-250 g',
      conditionsText: '1+1 gratis / ab 2 Packungen je 4,49 laut Flugblatt',
      rawText: 'Iglo Feinste Backhendlstreifen, 200-250 g, ab 2 Packungen je 4,49',
      comparisonSafe: false,
    }));

  addKnownCurrentCandidateIf(candidates, page, isSpar
    && hasText(text, /iglo\s+dorsch/)
    && hasText(text, /zander\s+naturfilets|premium\s+atlantik\s+lachs|goldbrasse/)
    && /200\s*-\s*480\s*g/i.test(normalized)
    && matchesPriceToken(normalized, 8, 49), fishCandidate({
      title: 'Iglo Dorsch, Zander, Lachs, Forelle oder Goldbrasse',
      brand: 'Iglo',
      price: 8.49,
      referencePrice: matchesPriceToken(normalized, 16, 99) ? 16.99 : null,
      quantityText: '200-480 g',
      conditionsText: '1+1 gratis / ab 2 Packungen je 8,49 laut Flugblatt',
      rawText: 'Iglo Dorsch, Zander Naturfilets, Premium Atlantik Lachs, Forelle oder Goldbrasse, 200-480 g, ab 2 Packungen je 8,49',
      comparisonSafe: false,
      searchKeywords: 'iglo fisch dorsch zander lachs forelle goldbrasse tiefkuehl',
    }));

  addKnownCurrentCandidateIf(candidates, page, isSpar
    && hasText(text, /dr\.?\s*oetker\s+pizza\s+ristorante/)
    && /320\s*-\s*390\s*g/i.test(normalized)
    && matchesPriceToken(normalized, 2, 66), frozenCandidate({
      title: 'Dr. Oetker Pizza Ristorante',
      brand: 'Dr. Oetker',
      price: 2.66,
      referencePrice: matchesPriceToken(normalized, 3, 99) ? 3.99 : null,
      quantityText: '320-390 g',
      conditionsText: '2+1 gratis / ab 3 Packungen je 2,66 laut Flugblatt',
      rawText: 'Dr. Oetker Pizza Ristorante, 320-390 g, ab 3 Packungen je 2,66',
      comparisonSafe: false,
    }));

  addKnownCurrentCandidateIf(candidates, page, isSpar
    && hasText(text, /bio-lachsfilet/)
    && /200\s*g/i.test(normalized)
    && matchesPriceToken(normalized, 6, 99), fishCandidate({
      title: 'Bio-Lachsfilet',
      brand: 'SPAR Natur Pur',
      price: 6.99,
      referencePrice: matchesPriceToken(normalized, 7, 99) ? 7.99 : null,
      quantityText: '200 g',
      conditionsText: 'ab 2 Packungen je 6,99 / nur gueltig am Fr., 19.6. und Sa., 20.6.2026 laut Flugblatt',
      rawText: 'Bio-Lachsfilet, 200 g, ab 2 Packungen je 6,99',
      validFromOverride: new Date('2026-06-18T22:00:00.000Z'),
      validToOverride: new Date('2026-06-20T21:59:59.999Z'),
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /rindsschnitzel\s+aus\s+(?:oesterreich|osterreich)/)
    && /per\s+kg/i.test(normalized)
    && matchesPriceToken(normalized, 14, 99), meatCandidate({
      title: 'TANN Rindsschnitzel aus Oesterreich',
      brand: 'TANN',
      price: 14.99,
      quantityText: '1 kg',
      conditionsText: 'in Bedienung laut Flugblatt',
      rawText: 'Rindsschnitzel aus Oesterreich, in Bedienung, per kg, 14,99',
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /zewa\s+simply\s+soft\s+toilettenpapier/)
    && hasText(text, /zewa\s+premium\s+toilettenpapier/)
    && matchesPriceToken(normalized, 6, 79), drugstoreCandidate({
      title: 'Zewa Simply Soft oder Premium Toilettenpapier',
      brand: 'Zewa',
      price: 6.79,
      quantityText: '18-20 Rollen',
      conditionsText: '',
      rawText: 'Zewa Simply Soft Toilettenpapier 20er-Packung oder Zewa Premium Toilettenpapier 18er-Packung, 6,79',
      comparisonSafe: false,
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /goesser\s+naturradler|g.sser\s+naturradler/)
    && /0[,\s]*33[-\s]*liter[-\s]*flasche/i.test(normalized)
    && matchesPriceToken(normalized, 0, 71), beerCandidate({
      title: 'Goesser Naturradler alkoholfrei oder Naturgold alkoholfrei',
      brand: 'Goesser',
      price: 0.71,
      referencePrice: matchesPriceToken(normalized, 1, 43) ? 1.43 : null,
      quantityText: '0.33 l',
      conditionsText: '12+12 gratis / ab 24 Flaschen je 0,71 laut Flugblatt',
      rawText: 'Goesser Naturradler Zitrone alkoholfrei oder Naturgold alkoholfrei, 0,33-Liter-Flasche, ab 24 Flaschen je 0,71',
      comparisonSafe: false,
      searchKeywords: 'goesser naturradler naturgold alkoholfrei bier radler',
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /la\s+gioiosa\s+sparkling/)
    && /0[,\s]*75[-\s]*liter[-\s]*flasche/i.test(normalized)
    && matchesPriceToken(normalized, 4, 99), wineCandidate({
      title: 'La Gioiosa Sparkling alkoholfrei',
      brand: 'La Gioiosa',
      price: 4.99,
      referencePrice: matchesPriceToken(normalized, 6, 99) ? 6.99 : null,
      quantityText: '0.75 l',
      conditionsText: 'laut Flugblatt',
      rawText: 'La Gioiosa Sparkling alkoholfrei oder Sparkling Rose alkoholfrei, 0,75-Liter-Flasche, 4,99',
      comparisonSafe: false,
      searchKeywords: 'la gioiosa sparkling alkoholfrei schaumwein alkoholfrei',
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /pitu\s+cachaca/)
    && /0[,\s]*7[-\s]*liter[-\s]*flasche/i.test(normalized)
    && matchesPriceToken(normalized, 14, 99), groceryCandidate({
      title: 'Pitu Cachaca',
      brand: 'Pitu',
      price: 14.99,
      quantityText: '0.7 l',
      conditionsText: 'Aktion laut Flugblatt',
      rawText: 'Pitu Cachaca, 0,7-Liter-Flasche, 14,99',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Spirituosen',
      categoryKey: 'spirituosen',
      searchKeywords: 'pitu cachaca spirituosen caipirinha',
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /isostar\s+sport-riegel/)
    && /3\s*x\s*40\s*g/i.test(normalized)
    && matchesPriceToken(normalized, 2, 49), sweetCandidate({
      title: 'Isostar Sport- oder Protein-Riegel',
      brand: 'Isostar',
      price: 2.49,
      referencePrice: matchesPriceToken(normalized, 3, 69) ? 3.69 : null,
      quantityText: '3 x 35-40 g',
      conditionsText: 'ab 2 Packungen je 2,49 laut Flugblatt',
      rawText: 'Isostar Sport-Riegel 3 x 40 g oder Protein-Riegel 3 x 35 g, ab 2 Packungen je 2,49',
      comparisonSafe: false,
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /schaerdinger\s+protein\s+traum|sch.r.dinger\s+protein\s+traum/)
    && /200[-\s]*g[-\s]*becher/i.test(normalized)
    && matchesPriceToken(normalized, 0, 86), dairyCandidate({
      title: 'Schaerdinger Protein Traum Pudding',
      brand: 'Schaerdinger',
      price: 0.86,
      referencePrice: matchesPriceToken(normalized, 1, 29) ? 1.29 : null,
      quantityText: '200 g',
      conditionsText: '2+1 gratis / ab 3 Bechern je 0,86 laut Flugblatt',
      rawText: 'Schaerdinger Protein Traum Pudding, 200-g-Becher, ab 3 Bechern je 0,86',
      comparisonSafe: false,
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /nocco/)
    && /0[,\s]*33[-\s]*liter[-\s]*dose/i.test(normalized)
    && matchesPriceToken(normalized, 1, 79), groceryCandidate({
      title: 'Nocco',
      brand: 'Nocco',
      price: 1.79,
      referencePrice: matchesPriceToken(normalized, 1, 99) ? 1.99 : null,
      quantityText: '0.33 l',
      conditionsText: 'ab 2 Dosen je 1,79 laut Flugblatt',
      rawText: 'Nocco, verschiedene Sorten, 0,33-Liter-Dose, ab 2 Dosen je 1,79',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Alkoholfreie Getraenke',
      categoryKey: 'alkoholfreie-getraenke',
      searchKeywords: 'nocco energy drink alkoholfrei dose',
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /rindfleischlasagne/)
    && /per\s+st(?:ueck|uck)/i.test(normalized)
    && matchesPriceToken(normalized, 4, 99), groceryCandidate({
      title: 'Rindfleischlasagne oder Spinatlasagne',
      brand: 'INTERSPAR',
      price: 4.99,
      referencePrice: matchesPriceToken(normalized, 6, 49) ? 6.49 : null,
      quantityText: '1 Stueck',
      conditionsText: 'Heisse Theke / per Stueck laut Flugblatt',
      rawText: 'Rindfleischlasagne oder Spinatlasagne, per Stueck, 4,99',
      categorySecondary: 'Fertiggerichte',
      categoryKey: 'fertiggerichte',
      searchKeywords: 'lasagne rindfleischlasagne spinatlasagne heisse theke',
      comparisonSafe: false,
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /branzino/)
    && /per\s+100\s*g/i.test(normalized)
    && matchesPriceToken(normalized, 2, 49), fishCandidate({
      title: 'Branzino',
      brand: 'INTERSPAR',
      price: 2.49,
      quantityText: '100 g',
      conditionsText: 'in Bedienung / Angebot gueltig bis Mi., 8.7.2026 laut Flugblatt',
      rawText: 'Branzino, in Bedienung, per 100 g, 2,49',
      validToOverride: new Date('2026-07-08T21:59:59.999Z'),
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /bio-mohnflesserl/)
    && /bei\s+3\s+st(?:ueck|uck)\s+je/i.test(normalized)
    && matchesPriceToken(normalized, 0, 83), bakeryCandidate({
      title: 'Bio-Mohnflesserl',
      brand: 'INTERSPAR',
      price: 0.83,
      referencePrice: matchesPriceToken(normalized, 1, 25) ? 1.25 : null,
      quantityText: '1 Stueck',
      conditionsText: '2+1 gratis / bei 3 Stueck je 0,83 laut Flugblatt',
      rawText: 'Bio-Mohnflesserl, bei 3 Stueck je 0,83',
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /focaccia\s+tomate\s*&?\s*oliven|focaccia\s+tomate/)
    && /350\s*g/i.test(normalized)
    && matchesPriceToken(normalized, 3, 29), bakeryCandidate({
      title: 'Focaccia Tomate & Oliven',
      brand: 'INTERSPAR',
      price: 3.29,
      referencePrice: matchesPriceToken(normalized, 3, 79) ? 3.79 : null,
      quantityText: '350 g',
      conditionsText: 'per Stueck laut Flugblatt',
      rawText: 'Focaccia Tomate & Oliven, 350 g, per Stueck, 3,29',
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /thomy\s+ketch&co|thomy\s+ketch/)
    && /170[-\s]*g.*190[-\s]*g/i.test(normalized)
    && matchesPriceToken(normalized, 1, 99), groceryCandidate({
      title: 'Thomy Ketch&Co, Mayonnaise oder Hot Sriracha Mayo',
      brand: 'Thomy',
      price: 1.99,
      referencePrice: matchesPriceToken(normalized, 2, 29) ? 2.29 : null,
      quantityText: '170-190 g',
      conditionsText: 'laut Flugblatt',
      rawText: 'Thomy Ketch&Co, Mayonnaise oder Hot Sriracha Mayo, 170-190 g, 1,99',
      categorySecondary: 'Saucen & Gewuerze',
      categoryKey: 'saucen-gewuerze',
      comparisonSafe: false,
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /hornig\s+caff/)
    && /1[-\s]*kg[-\s]*packung/i.test(normalized)
    && matchesPriceToken(normalized, 23, 99), groceryCandidate({
      title: 'Hornig Caffe Crema',
      brand: 'Hornig',
      price: 23.99,
      referencePrice: matchesPriceToken(normalized, 29, 99) ? 29.99 : null,
      quantityText: '1 kg',
      conditionsText: 'laut Flugblatt',
      rawText: 'Hornig Caffe Crema oder Caffe Crema Intenso, 1-kg-Packung, 23,99',
      categoryPrimary: 'Getraenke',
      categorySecondary: 'Kaffee & Tee',
      categoryKey: 'kaffee-tee',
      searchKeywords: 'hornig caffe crema kaffee ganze bohne',
      comparisonSafe: false,
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /somat\s+vorteilspack/)
    && /(?:caps|tabs)/i.test(normalized)
    && matchesPriceToken(normalized, 13, 49), drugstoreCandidate({
      title: 'Somat Vorteilspack Caps oder Tabs',
      brand: 'Somat',
      price: 13.49,
      quantityText: '75-100 WG',
      conditionsText: 'Aktion laut Flugblatt',
      rawText: 'Somat Vorteilspack Caps 75/84 WG oder Tabs 84/100 WG, 13,49',
      comparisonSafe: false,
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /felix\s+katzensnacks/)
    && /180[-\s]*g.*200[-\s]*g|12\s*x\s*10[-\s]*g/i.test(normalized)
    && matchesPriceToken(normalized, 3, 49), groceryCandidate({
      title: 'Felix Katzensnacks oder Deli Moments',
      brand: 'Felix',
      price: 3.49,
      referencePrice: matchesPriceToken(normalized, 3, 99) ? 3.99 : null,
      quantityText: '120-200 g',
      conditionsText: 'ab 2 Packungen je 3,49 laut Flugblatt',
      rawText: 'Felix Katzensnacks 180-200 g oder Felix Deli Moments 12 x 10 g, ab 2 Packungen je 3,49',
      categoryPrimary: 'Tierbedarf',
      categorySecondary: 'Katzenfutter',
      categoryKey: 'katzenfutter',
      searchKeywords: 'felix katzensnacks deli moments katzenfutter tierbedarf',
      comparisonSafe: false,
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /spar\s+alufolie/)
    && /30\s*m/i.test(normalized)
    && matchesPriceToken(normalized, 2, 99), nonFoodPieceCandidate({
      title: 'SPAR Alufolie 30 m',
      brand: 'SPAR',
      price: 2.99,
      referencePrice: matchesPriceToken(normalized, 3, 49) ? 3.49 : null,
      conditionsText: 'ab 2 Stueck je 2,99 laut Flugblatt',
      rawText: 'SPAR Alufolie 30 m, ab 2 Stueck je 2,99',
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Kueche & Aufbewahrung',
      categoryKey: 'kueche-aufbewahrung',
      searchKeywords: 'spar alufolie haushalt kueche 30 m',
    }));

  addKnownCurrentCandidateIf(candidates, page, isInterspar
    && hasText(text, /delonghi\s+kaffeevollautomat/)
    && /ecam220\.?20w/i.test(normalized)
    && (matchesPriceToken(normalized, 299, 0) || /(?:^|\D)299\s*[-,](?!\d)/i.test(normalized)), nonFoodPieceCandidate({
      title: 'DeLonghi Kaffeevollautomat ECAM220.20W',
      brand: 'DeLonghi',
      price: 299.00,
      referencePrice: (matchesPriceToken(normalized, 349, 0) || /(?:^|\D)349\s*[-,](?!\d)/i.test(normalized)) ? 349.00 : null,
      conditionsText: 'laut Flugblatt',
      rawText: 'DeLonghi Kaffeevollautomat ECAM220.20W, 299,- statt 349,-',
      categoryPrimary: 'Technik / Elektronik',
      categorySecondary: 'Kuechengeraete',
      categoryKey: 'kuechengeraete',
      searchKeywords: 'delonghi kaffeevollautomat kaffeemaschine ecam22020w',
    }));

  addKnownCurrentCandidateIf(candidates, page, hasText(text, /aperol/)
    && /0[,\s]*7[-\s]*(?:liter|l)/i.test(normalized)
    && hasAperolKw25Price, groceryCandidate({
      title: 'Aperol',
      brand: 'Aperol',
      price: 8.99,
      referencePrice: matchesPriceToken(normalized, 17, 99) ? 17.99 : null,
      quantityText: '0.7 l',
      conditionsText: '1+1 gratis / ab 2 Flaschen je 8,99 laut Flugblatt',
      rawText: 'Aperol, 0,7 Liter, 1+1 gratis, ab 2 Flaschen je 8,99',
    }));

  return candidates;
}

function extractKnownSparFamilyKw24CandidatesFromPage(page, { sourceRetailerFormat } = {}) {
  const text = normalizePdfText(page.text || '');
  const normalized = normalizeForScan(text);
  const candidates = [];
  const isSpar = sourceRetailerFormat === 'spar';
  const isInterspar = sourceRetailerFormat === 'interspar';
  const isEurospar = sourceRetailerFormat === 'eurospar';
  const frSaKw24 = 'Zusatzpreis nur am Fr., 12.6. und Sa., 13.6.2026 laut Flugblatt';
  const frSaKw24Window = {
    validFromOverride: new Date('2026-06-11T22:00:00.000Z'),
    validToOverride: new Date('2026-06-13T21:59:59.999Z'),
  };

  addKnownCandidateIf(candidates, page, hasText(text, /stiegl\s*goldbraeu|stiegl\s*goldbr.u/) && /(20er-kiste|20\s*x\s*0[,\s]*5).*14[,\s]*80/i.test(normalized), beerCandidate({
    title: 'Stiegl Goldbraeu',
    brand: 'Stiegl',
    price: 14.80,
    referencePrice: 29.60,
    quantityText: '20 x 0.5 l',
    conditionsText: 'Biermarkenwoche / -50% auf Stiegl Biere laut Flugblatt',
    rawText: 'Stiegl Goldbraeu 0,5 Liter, 20er-Kiste 29,60, Aktionspreis 14,80',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /coca-cola\s+limonaden/) && /24er-tray\s*16[,\s]*56/i.test(normalized), beerCandidate({
    title: 'Coca-Cola Limonaden',
    brand: 'Coca-Cola',
    price: 16.56,
    referencePrice: /1\s+(?:ds|dose)\.?\s+1[,\s]*39/i.test(normalized) ? 1.39 : null,
    quantityText: '24 x 0.33 l',
    conditionsText: '12+12 gratis / ab 24 Dosen je 0,69 laut Flugblatt',
    rawText: 'Coca-Cola Limonaden, 0,33 Liter, 24er-Tray 16,56, ab 24 Dosen je 0,69',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /milka\s*schokolade/) && /(?:2[,\s]*66|\b266\b)/i.test(normalized), sweetCandidate({
    title: 'Milka Schokolade',
    brand: 'Milka',
    price: 2.66,
    referencePrice: /1\s+tafel\s+3[,\s]*99/i.test(normalized) ? 3.99 : null,
    quantityText: '190 g',
    conditionsText: '2+1 gratis / ab 3 Tafeln laut Flugblatt',
    rawText: 'Milka Schokolade, 190 g, ab 3 Tafeln je 2,66',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /lotus\s*biscoff\s*doppelkeks/) && /(?:1[,\s]*32|\b132\b)/i.test(normalized), sweetCandidate({
    title: 'Lotus Biscoff Doppelkeks',
    brand: 'Lotus',
    price: 1.32,
    referencePrice: /1\s+rolle\s+1[,\s]*99/i.test(normalized) ? 1.99 : null,
    quantityText: '150 g',
    conditionsText: '2+1 gratis / ab 3 Rollen laut Flugblatt',
    rawText: 'Lotus Biscoff Doppelkeks, 150 g, ab 3 Rollen je 1,32',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /bio-salzstangerl/) && /(?:0[,\s]*66|\b066\b)/i.test(normalized), bakeryCandidate({
    title: 'Bio-Salzstangerl',
    brand: 'SPAR',
    price: 0.66,
    referencePrice: /1\s+st(?:ueck|uck)\s+0[,\s]*99/i.test(normalized) ? 0.99 : null,
    quantityText: '1 Stueck',
    conditionsText: '2+1 gratis / bei 3 Stueck laut Flugblatt',
    rawText: 'Bio-Salzstangerl, bei 3 Stueck je 0,66, Fr/Sa ggf. 0,49',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /bio-salzstangerl/) && /bei\s+3\s+st(?:ueck|uck)\s+je\s*0[,\s]*49/i.test(normalized), bakeryCandidate({
    title: 'Bio-Salzstangerl',
    brand: 'SPAR',
    price: 0.49,
    referencePrice: /1\s+st(?:ueck|uck)\s+0[,\s]*99/i.test(normalized) ? 0.99 : null,
    quantityText: '1 Stueck',
    conditionsText: `2+1 gratis / bei 3 Stueck laut Flugblatt / ${frSaKw24}`,
    rawText: 'Bio-Salzstangerl, bei 3 Stueck je 0,49, Fr/Sa Zusatzpreis',
    ...frSaKw24Window,
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /s-budget\s*lachsfilet/) && /per\s+kg/i.test(normalized), fishCandidate({
    title: 'S-BUDGET Lachsfilet frisch mit Haut',
    brand: 'S-BUDGET',
    price: 19.90,
    quantityText: '1 kg',
    conditionsText: 'nur gueltig am Fr., 12.6. und Sa., 13.6.2026 laut Flugblatt',
    rawText: 'S-BUDGET Lachsfilet frisch mit Haut, ca. 1,3-kg-Filet, per kg 19,90',
    ...frSaKw24Window,
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /bio-butter/) && /ab\s+2\s+packungen\s+je\s*2[,\s]*29/i.test(normalized), dairyCandidate({
    title: 'Bio-Butter',
    brand: 'SPAR Natur Pur',
    price: 2.29,
    quantityText: '250 g',
    conditionsText: 'ab 2 Packungen je 2,29 laut Flugblatt',
    rawText: 'Bio-Butter, 250 g, ab 2 Packungen je 2,29, Fr/Sa Zusatzpreis 1,72',
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /bio-butter/) && /1[,\s]*72/i.test(normalized), dairyCandidate({
    title: 'Bio-Butter',
    brand: 'SPAR Natur Pur',
    price: 1.72,
    quantityText: '250 g',
    conditionsText: `ab 2 Packungen laut Flugblatt / ${frSaKw24}`,
    rawText: 'Bio-Butter, 250 g, Fr/Sa Zusatzpreis 1,72',
    ...frSaKw24Window,
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /bio-hendl-oberkeule/) && /500-g-packung/i.test(normalized), meatCandidate({
    title: 'Bio-Hendl-Oberkeule',
    brand: 'SPAR Natur Pur',
    price: 7.19,
    quantityText: '500 g',
    conditionsText: 'ab 2 Packungen laut Flugblatt',
    rawText: 'Bio-Hendl-Oberkeule, 500-g-Packung, Fr/Sa Zusatzpreis 5,39',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /bio-hendl-oberkeule/) && /500-g-packung/i.test(normalized) && /5[,\s]*39/i.test(normalized), meatCandidate({
    title: 'Bio-Hendl-Oberkeule',
    brand: 'SPAR Natur Pur',
    price: 5.39,
    quantityText: '500 g',
    conditionsText: `ab 2 Packungen laut Flugblatt / ${frSaKw24}`,
    rawText: 'Bio-Hendl-Oberkeule, 500-g-Packung, Fr/Sa Zusatzpreis 5,39',
    ...frSaKw24Window,
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /bio-rindsschnitzel/) && /per\s+kg/i.test(normalized), meatCandidate({
    title: 'Bio-Rindsschnitzel',
    brand: 'SPAR Natur Pur',
    price: 24.99,
    quantityText: '1 kg',
    conditionsText: '',
    rawText: 'Bio-Rindsschnitzel aus Oesterreich, per kg, Fr/Sa Zusatzpreis 18,74',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /bio-rindsschnitzel/) && /per\s+kg/i.test(normalized) && /18[,\s]*74/i.test(normalized), meatCandidate({
    title: 'Bio-Rindsschnitzel',
    brand: 'SPAR Natur Pur',
    price: 18.74,
    quantityText: '1 kg',
    conditionsText: frSaKw24,
    rawText: 'Bio-Rindsschnitzel aus Oesterreich, per kg, Fr/Sa Zusatzpreis 18,74',
    ...frSaKw24Window,
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /bio-goldbrasse/) && /per\s+100\s*g/i.test(normalized), fishCandidate({
    title: 'Bio-Goldbrasse',
    brand: 'SPAR Natur Pur',
    price: 2.99,
    quantityText: '100 g',
    conditionsText: '',
    rawText: 'Bio-Goldbrasse, per 100 g, Fr/Sa Zusatzpreis 2,24',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /bio-goldbrasse/) && /per\s+100\s*g/i.test(normalized) && /2[,\s]*24/i.test(normalized), fishCandidate({
    title: 'Bio-Goldbrasse',
    brand: 'SPAR Natur Pur',
    price: 2.24,
    quantityText: '100 g',
    conditionsText: frSaKw24,
    rawText: 'Bio-Goldbrasse, per 100 g, Fr/Sa Zusatzpreis 2,24',
    ...frSaKw24Window,
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /s-budget\s+leberkaese|s-budget\s+leberk.se/) && /500-g-packung/i.test(normalized), meatCandidate({
    title: 'S-BUDGET Leberkaese',
    brand: 'S-BUDGET',
    price: 3.99,
    quantityText: '500 g',
    conditionsText: '',
    rawText: 'S-BUDGET Leberkaese aus Oesterreich, 500-g-Packung, 3,99',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /s-budget\s+bernerw(?:ue|u)rstl/) && /1-?kg-packung|1\s+kg/i.test(normalized), meatCandidate({
    title: 'S-BUDGET Bernerwuerstl',
    brand: 'S-BUDGET',
    price: 7.99,
    quantityText: '1 kg',
    conditionsText: '',
    rawText: 'S-BUDGET Bernerwuerstl aus Oesterreich, 1-kg-Packung, 7,99',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /spar\s*wassermelone/) && /per\s+kg/i.test(normalized), produceCandidate({
    title: 'SPAR Wassermelone kernarm',
    brand: 'SPAR',
    price: 1.00,
    referencePrice: /statt\s+1[,\s]*99/i.test(normalized) ? 1.99 : null,
    quantityText: '1 kg',
    conditionsText: 'Wassermelonen-Angebot gueltig bis Sa., 13.6.2026 laut Flugblatt',
    rawText: 'SPAR Wassermelone kernarm, Klasse 1, per kg, Aktion 1,00',
    validToOverride: frSaKw24Window.validToOverride,
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /recheis\s+gold-?\s*marke/) && /1[,\s]*99/i.test(normalized) && /1[,\s]*49/i.test(normalized), groceryCandidate({
    title: 'Recheis Goldmarke, Recheis Vollkorn oder Naturgenuss Dinkel Teigwaren',
    brand: 'Recheis',
    price: 1.99,
    referencePrice: /1\s+pkg\.?\s+2[,\s]*49/i.test(normalized) ? 2.49 : null,
    quantityText: '400-500 g',
    conditionsText: 'ab 2 Packungen laut Flugblatt',
    rawText: 'Recheis Goldmarke/Vollkorn oder Naturgenuss Dinkel Teigwaren, ab 2 Pkg. je 1,99, Fr/Sa 1,49',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /recheis\s+gold-?\s*marke/) && /1[,\s]*99/i.test(normalized) && /1[,\s]*49/i.test(normalized), groceryCandidate({
    title: 'Recheis Goldmarke, Recheis Vollkorn oder Naturgenuss Dinkel Teigwaren',
    brand: 'Recheis',
    price: 1.49,
    referencePrice: /1\s+pkg\.?\s+2[,\s]*49/i.test(normalized) ? 2.49 : null,
    quantityText: '400-500 g',
    conditionsText: `ab 2 Packungen laut Flugblatt / ${frSaKw24}`,
    rawText: 'Recheis Goldmarke/Vollkorn oder Naturgenuss Dinkel Teigwaren, Fr/Sa Zusatzpreis 1,49',
    comparisonSafe: false,
    ...frSaKw24Window,
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /despar\s+olio/) && /7[,\s]*99/i.test(normalized) && /5[,\s]*99/i.test(normalized), groceryCandidate({
    title: 'DESPAR Olio extra vergine di Oliva',
    brand: 'DESPAR',
    price: 7.99,
    referencePrice: /1\s+fl\.?\s+10[,\s]*99/i.test(normalized) ? 10.99 : null,
    quantityText: '1 l',
    conditionsText: 'ab 2 Flaschen laut Flugblatt',
    rawText: 'DESPAR Olio extra vergine di Oliva, 1 Liter, ab 2 Flaschen je 7,99, Fr/Sa 5,99',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /despar\s+olio/) && /7[,\s]*99/i.test(normalized) && /5[,\s]*99/i.test(normalized), groceryCandidate({
    title: 'DESPAR Olio extra vergine di Oliva',
    brand: 'DESPAR',
    price: 5.99,
    referencePrice: /1\s+fl\.?\s+10[,\s]*99/i.test(normalized) ? 10.99 : null,
    quantityText: '1 l',
    conditionsText: `ab 2 Flaschen laut Flugblatt / ${frSaKw24}`,
    rawText: 'DESPAR Olio extra vergine di Oliva, 1 Liter, Fr/Sa Zusatzpreis 5,99',
    ...frSaKw24Window,
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /ben.?s\s+original/) && /4[,\s]*19/i.test(normalized) && /3[,\s]*14/i.test(normalized), groceryCandidate({
    title: "Ben's Original Langkorn-Reis",
    brand: "Ben's Original",
    price: 4.19,
    quantityText: '1 kg',
    conditionsText: 'ab 2 Packungen laut Flugblatt',
    rawText: "Ben's Original Langkorn-Reis, 1 kg, ab 2 Pkg. je 4,19, Fr/Sa 3,14",
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /ben.?s\s+original/) && /4[,\s]*19/i.test(normalized) && /3[,\s]*14/i.test(normalized), groceryCandidate({
    title: "Ben's Original Langkorn-Reis",
    brand: "Ben's Original",
    price: 3.14,
    quantityText: '1 kg',
    conditionsText: `ab 2 Packungen laut Flugblatt / ${frSaKw24}`,
    rawText: "Ben's Original Langkorn-Reis, 1 kg, Fr/Sa Zusatzpreis 3,14",
    ...frSaKw24Window,
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /despar\s+pasta/) && /0[,\s]*99/i.test(normalized) && /0[,\s]*74/i.test(normalized), groceryCandidate({
    title: 'DESPAR Pasta',
    brand: 'DESPAR',
    price: 0.99,
    quantityText: '500 g',
    conditionsText: 'ab 2 Packungen laut Flugblatt',
    rawText: 'DESPAR Pasta, 500 g, ab 2 Pkg. je 0,99, Fr/Sa 0,74',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /despar\s+pasta/) && /0[,\s]*99/i.test(normalized) && /0[,\s]*74/i.test(normalized), groceryCandidate({
    title: 'DESPAR Pasta',
    brand: 'DESPAR',
    price: 0.74,
    quantityText: '500 g',
    conditionsText: `ab 2 Packungen laut Flugblatt / ${frSaKw24}`,
    rawText: 'DESPAR Pasta, 500 g, Fr/Sa Zusatzpreis 0,74',
    ...frSaKw24Window,
  }));

  addKnownCandidateIf(candidates, page, isSpar && /spar\s*natives\s*oliven(?:oel|ol|.l)/i.test(normalized) && /4[,\s]*66/i.test(normalized) && /3[,\s]*49/i.test(normalized), groceryCandidate({
    title: 'SPAR natives Olivenoel extra',
    brand: 'SPAR',
    price: 4.66,
    quantityText: '0.5 l',
    conditionsText: '2+1 gratis laut Flugblatt',
    rawText: 'SPAR natives Olivenoel extra, 0,5-Liter-Flasche, 2+1, Fr/Sa 3,49',
  }));

  addKnownCandidateIf(candidates, page, isSpar && /spar\s*natives\s*oliven(?:oel|ol|.l)/i.test(normalized) && /4[,\s]*66/i.test(normalized) && /3[,\s]*49/i.test(normalized), groceryCandidate({
    title: 'SPAR natives Olivenoel extra',
    brand: 'SPAR',
    price: 3.49,
    quantityText: '0.5 l',
    conditionsText: `2+1 gratis laut Flugblatt / ${frSaKw24}`,
    rawText: 'SPAR natives Olivenoel extra, 0,5-Liter-Flasche, Fr/Sa Zusatzpreis 3,49',
    ...frSaKw24Window,
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /spar\s+steinofen\s+weizen-roggenbrot/) && /400\s*g/i.test(normalized) && /1[,\s]*99/i.test(normalized), bakeryCandidate({
    title: 'SPAR Steinofen Weizen-Roggenbrot',
    brand: 'SPAR',
    price: 1.99,
    referencePrice: /statt\s+2[,\s]*49/i.test(normalized) ? 2.49 : null,
    quantityText: '400 g',
    conditionsText: '',
    rawText: 'SPAR Steinofen Weizen-Roggenbrot, 400 g, 1,99',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /fussball\s+donut|fu.ball\s+donut|fu.*ball\s+donut/) && /(?:6er-packung|348\s*g)/i.test(normalized) && /3[,\s]*99/i.test(normalized), bakeryCandidate({
    title: 'Fussball Donut',
    brand: '',
    price: 3.99,
    quantityText: '6er-Packung',
    conditionsText: '',
    rawText: 'Fussball Donut, 6er-Packung, 3,99',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /spar\s+linzerstangerl/) && /200\s*g/i.test(normalized) && /2[,\s]*19/i.test(normalized), bakeryCandidate({
    title: 'SPAR Linzerstangerl',
    brand: 'SPAR',
    price: 2.19,
    quantityText: '200 g',
    conditionsText: '',
    rawText: 'SPAR Linzerstangerl, 200-g-Packung, 2,19',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /bio-spitzweckerl/) && /bei\s+3\s+st(?:ueck|uck)\s+je\s*0[,\s]*66/i.test(normalized), bakeryCandidate({
    title: 'Bio-Spitzweckerl',
    brand: 'SPAR',
    price: 0.66,
    referencePrice: /1\s+stk\.?\s+0[,\s]*99/i.test(normalized) ? 0.99 : null,
    quantityText: '1 Stueck',
    conditionsText: '2+1 gratis / bei 3 Stueck laut Flugblatt',
    rawText: 'Bio-Spitzweckerl, bei 3 Stueck je 0,66',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /spar\s+feinstes\s+gefl(?:ue|u)gel\s+hendlfilet/) && /per\s+kg/i.test(normalized), meatCandidate({
    title: 'SPAR Feinstes Gefluegel Hendlfilet',
    brand: 'SPAR',
    price: 14.99,
    referencePrice: /statt\s+16[,\s]*19/i.test(normalized) ? 16.19 : null,
    quantityText: '1 kg',
    conditionsText: '',
    rawText: 'SPAR Feinstes Gefluegel Hendlfilet aus Oesterreich, per kg, 14,99',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /hendl\s*filetschnitzerl/) && /400-g-packung/i.test(normalized), meatCandidate({
    title: 'SPAR Feinstes Gefluegel Hendl Filetschnitzerl gewuerzt',
    brand: 'SPAR',
    price: 4.99,
    referencePrice: /1\s+pkg\.?\s+6[,\s]*29/i.test(normalized) ? 6.29 : null,
    quantityText: '400 g',
    conditionsText: 'ab 2 Packungen je 4,99 laut Flugblatt',
    rawText: 'SPAR Feinstes Gefluegel Hendl Filetschnitzerl, 400-g-Packung, ab 2 Pkg. je 4,99',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /beef\s+burger/) && /220-g-packung/i.test(normalized) && /3[,\s]*99/i.test(normalized), meatCandidate({
    title: 'Beef Burger',
    brand: '',
    price: 3.99,
    quantityText: '220 g',
    conditionsText: '',
    rawText: 'Beef Burger aus Oesterreich, 220-g-Packung, 3,99',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /leberkaese\s+classic|leberk.se\s+classic/) && /500(?:-g|\s*g)/i.test(normalized) && /4[,\s]*49/i.test(normalized), meatCandidate({
    title: 'Leberkaese classic, Kaese oder Chili Cheese',
    brand: '',
    price: 4.49,
    quantityText: '500 g',
    conditionsText: '',
    rawText: 'Leberkaese classic, Kaese oder Chili Cheese, 500-g-Packung, 4,49',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /kaesewurst|k.sewurst|krakauer|wiener/) && /100\s*g/i.test(normalized) && /1[,\s]*49/i.test(normalized), meatCandidate({
    title: 'Kaesewurst, Krakauer oder Wiener',
    brand: '',
    price: 1.49,
    quantityText: '100 g',
    conditionsText: '',
    rawText: 'Kaesewurst, Krakauer oder Wiener, per 100 g, 1,49',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /gulasch-\s*oder\s*kochfleisch|gulasch.*kochfleisch/) && /per\s+kg/i.test(normalized), meatCandidate({
    title: 'Gulasch- oder Kochfleisch',
    brand: '',
    price: 11.99,
    referencePrice: /statt\s+18[,\s]*99/i.test(normalized) ? 18.99 : null,
    quantityText: '1 kg',
    conditionsText: '',
    rawText: 'Gulasch- oder Kochfleisch aus Oesterreich, per kg, 11,99',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /bauernschinken|farmerschinken|jubilaeumsschinken|jubil.umsschinken/) && /per\s+100\s*g/i.test(normalized), meatCandidate({
    title: 'Farmerschinken, Bauernschinken oder Jubilaeumsschinken',
    brand: '',
    price: 1.79,
    referencePrice: /statt\s+2[,\s]*19|statt\s+2[,\s]*09/i.test(normalized) ? 2.19 : null,
    quantityText: '100 g',
    conditionsText: '',
    rawText: 'Farmerschinken, Bauernschinken oder Jubilaeumsschinken, in Bedienung, per 100 g, 1,79',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /frankfurter/) && /1\s*kg/i.test(normalized) && /7[,\s]*99/i.test(normalized), meatCandidate({
    title: 'Frankfurter',
    brand: '',
    price: 7.99,
    quantityText: '1 kg',
    conditionsText: '',
    rawText: 'Frankfurter aus Oesterreich, 1-kg-Packung, 7,99',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /appenzeller/) && /100\s*g/i.test(normalized), cheeseCandidate({
    title: 'Appenzeller Switzerland A.O.P.',
    brand: 'Appenzeller',
    price: 2.99,
    referencePrice: /statt\s+3[,\s]*79/i.test(normalized) ? 3.79 : null,
    quantityText: '100 g',
    conditionsText: '',
    rawText: 'Appenzeller Switzerland A.O.P., 100 g, 2,99',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /schaerdinger\s+mozzarella|schardinger\s+mozzarella|sch.r.dinger\s+mozzarella/) && /125\s*g/i.test(normalized), cheeseCandidate({
    title: 'Schaerdinger Mozzarella',
    brand: 'Schaerdinger',
    price: /0[,\s]*79/i.test(normalized) ? 0.79 : 1.19,
    referencePrice: /1\s+pkg\.?\s+1[,\s]*59/i.test(normalized) ? 1.59 : null,
    quantityText: '125 g',
    conditionsText: /2\+2\s+gratis/i.test(normalized) ? '2+2 gratis / ab 4 Packungen je 0,79 laut Flugblatt' : '',
    rawText: 'Schaerdinger Mozzarella, 125 g, 2+2 gratis, ab 4 Pkg. je 0,79',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /schaerdinger\s+moosbacher|sch.r.dinger\s+moosbacher|sch.*moosbacher/) && /100\s*g/i.test(normalized) && /1[,\s]*29/i.test(normalized), cheeseCandidate({
    title: 'Schaerdinger Moosbacher',
    brand: 'Schaerdinger',
    price: 1.29,
    referencePrice: /statt\s+1[,\s]*79/i.test(normalized) ? 1.79 : null,
    quantityText: '100 g',
    conditionsText: '',
    rawText: 'Schaerdinger Moosbacher, 100 g, 1,29',
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /kaerntnermilch\s+mascarpone|k.rntnermilch\s+mascarpone/) && /500\s*g/i.test(normalized) && /3[,\s]*49/i.test(normalized), dairyCandidate({
    title: 'Kaerntnermilch Mascarpone',
    brand: 'Kaerntnermilch',
    price: 3.49,
    quantityText: '500 g',
    conditionsText: '',
    rawText: 'Kaerntnermilch Mascarpone, 500-g-Packung, 3,49',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /dr\.?\s*oetker\s+creme\s+vega/) && /150(?:-g|\s*g)/i.test(normalized) && /0[,\s]*74/i.test(normalized), dairyCandidate({
    title: 'Dr. Oetker Creme Vega',
    brand: 'Dr. Oetker',
    price: 0.74,
    referencePrice: /1\s+becher\s+1[,\s]*49/i.test(normalized) ? 1.49 : null,
    quantityText: '150 g',
    conditionsText: '1+1 gratis / ab 2 Becher je 0,74 laut Flugblatt',
    rawText: 'Dr. Oetker Creme Vega, 150-g-Becher, ab 2 Becher je 0,74',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /kelly.s\s+erdnuss|linsen\s+snips|donuts\s+peanuts/) && /1[,\s]*49/i.test(normalized), sweetCandidate({
    title: "Kelly's Erdnuss, Linsen Snips oder Donuts Peanuts Caramel",
    brand: "Kelly's",
    price: 1.49,
    quantityText: '100-150 g',
    conditionsText: '1+1 gratis / ab 2 Packungen je 1,49 laut Flugblatt',
    rawText: "Kelly's Erdnuss/Linsen Snips/Donuts Peanuts Caramel, ab 2 Packungen je 1,49",
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /bahlsen\s+choco\s+leibniz/) && /125(?:-g|\s*g)/i.test(normalized) && /1[,\s]*89/i.test(normalized), sweetCandidate({
    title: 'Bahlsen Choco Leibniz',
    brand: 'Bahlsen',
    price: 1.89,
    quantityText: '125 g',
    conditionsText: '2+2 gratis / ab 4 Packungen je 1,89 laut Flugblatt',
    rawText: 'Bahlsen Choco Leibniz, 125-g-Packung, ab 4 Packungen je 1,89',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /dr\.?\s*oetker\s+high\s+protein/) && /400(?:-g|\s*g)/i.test(normalized) && /1[,\s]*34/i.test(normalized), dairyCandidate({
    title: 'Dr. Oetker High Protein Pudding oder Milchreis',
    brand: 'Dr. Oetker',
    price: 1.34,
    quantityText: '400 g',
    conditionsText: '1+1 gratis / ab 2 Packungen je 1,34 laut Flugblatt',
    rawText: 'Dr. Oetker High Protein Pudding/Milchreis, 400-g-Packung, ab 2 Pkg. je 1,34',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /iglo\s+huehner\s+sticks|iglo\s+h.hner\s+sticks|huehner\s+nuggets|h.hner\s+nuggets/) && /2[,\s]*89/i.test(normalized), frozenCandidate({
    title: 'Iglo Huhnchen Sticks oder Huhnchen Nuggets',
    brand: 'Iglo',
    price: 2.89,
    quantityText: '220-250 g',
    conditionsText: 'ab 2 Packungen je 2,89 laut Flugblatt',
    rawText: 'Iglo Huhnchen Sticks oder Nuggets, 220-250 g, ab 2 Packungen je 2,89',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /dr\.?\s*oetker\s+bistro\s+baguette/) && /250(?:-g|\s*g)/i.test(normalized) && /1[,\s]*99/i.test(normalized), frozenCandidate({
    title: 'Dr. Oetker Bistro Baguette',
    brand: 'Dr. Oetker',
    price: 1.99,
    quantityText: '250 g',
    conditionsText: '',
    rawText: 'Dr. Oetker Bistro Baguette, 250-g-Packung, 1,99',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /frosta\s+wokpfanne|frosta\s+paella|frosta\s+couscous/) && /500(?:-g|\s*g)/i.test(normalized) && /3[,\s]*86/i.test(normalized), frozenCandidate({
    title: 'Frosta Wokpfanne, Paella oder Couscous',
    brand: 'Frosta',
    price: 3.86,
    quantityText: '500 g',
    conditionsText: '2+1 gratis / ab 3 Packungen je 3,86 laut Flugblatt',
    rawText: 'Frosta Wokpfanne/Paella/Couscous, 500-g-Packung, ab 3 Packungen je 3,86',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /aperol/) && /0[,\s]*7\s*liter/i.test(normalized) && /8[,\s]*99/i.test(normalized), groceryCandidate({
    title: 'Aperol',
    brand: 'Aperol',
    price: 8.99,
    quantityText: '0.7 l',
    conditionsText: '',
    rawText: 'Aperol, 0,7 Liter, 8,99',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /iglo\s+polardorsch|fisch.n\s+crunch|scholle/) && /(?:ab\s+2\s+pkg\.?\s+je\s+4[,\s]*99|ab\s+3\s+pkg\.?\s+je\s+3[,\s]*86)/i.test(normalized), fishCandidate({
    title: "Iglo Polardorsch, Scholle oder Fisch'n Crunch",
    brand: 'Iglo',
    price: 4.99,
    quantityText: '1 Packung',
    conditionsText: '1+1 gratis / ab 2 Packungen je 4,99 laut Flugblatt',
    rawText: "Iglo Polardorsch/Scholle/Fisch'n Crunch, 1+1 gratis, ab 2 Pkg. je 4,99",
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /puntigamer\s+maerzen|puntigamer\s+m.rzen/) && /24er-tray|ab\s+24\s+(?:ds|dosen)/i.test(normalized), beerCandidate({
    title: 'Puntigamer Maerzen Dose',
    brand: 'Puntigamer',
    price: 0.69,
    referencePrice: /1\s+ds\.?\s+1[,\s]*39/i.test(normalized) ? 1.39 : null,
    quantityText: '0.5 l',
    conditionsText: '12+12 gratis / ab 24 Dosen je 0,69 laut Flugblatt',
    rawText: 'Puntigamer Maerzen, 0,5 l Dose, ab 24 Dosen je 0,69',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /ariel\s+pulver/) && /23[,\s]*99/i.test(normalized), drugstoreCandidate({
    title: 'Ariel Pulver, Fluessig oder Pods',
    brand: 'Ariel',
    price: 23.99,
    quantityText: '82-111 WG',
    conditionsText: /spar-app-gutschein/i.test(normalized) ? 'mit SPAR-App-Gutschein 19,99 laut Flugblatt' : '',
    rawText: 'Ariel Pulver 100 WG, Fluessig 111 WG oder Pods 82 WG, 23,99, App 19,99',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /axe\s+duschgel/) && /1[,\s]*92/i.test(normalized), drugstoreCandidate({
    title: 'Axe Duschgel',
    brand: 'Axe',
    price: 1.92,
    referencePrice: /1\s+stk\.?\s+2[,\s]*89/i.test(normalized) ? 2.89 : null,
    quantityText: '250 ml',
    conditionsText: '2+1 gratis / ab 3 Stueck laut Flugblatt',
    rawText: 'Axe Duschgel, 250 ml, ab 3 Stueck je 1,92',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /zewa\s+toilettenpapier/) && /6[,\s]*79/i.test(normalized), drugstoreCandidate({
    title: 'Zewa Toilettenpapier',
    brand: 'Zewa',
    price: 6.79,
    quantityText: '18-20 Rollen',
    conditionsText: '',
    rawText: 'Zewa Toilettenpapier, 18er/20er-Packung, 6,79',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /plenty\s+kuechenrolle|plenty\s+k.chenrolle/) && /5[,\s]*49/i.test(normalized), drugstoreCandidate({
    title: 'Plenty Kuechenrolle',
    brand: 'Plenty',
    price: 5.49,
    quantityText: '6-8 Rollen',
    conditionsText: '',
    rawText: 'Plenty Kuechenrolle, 6er/8er-Packung, 5,49',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /syoss\s+shampoo|syoss\s+haarspray|syoss\s+haarschaum/) && /3[,\s]*32/i.test(normalized), drugstoreCandidate({
    title: 'Syoss Shampoo, Haarspray oder Haarschaum',
    brand: 'Syoss',
    price: 3.32,
    quantityText: '250-440 ml',
    conditionsText: '2+1 gratis / ab 3 Stueck je 3,32 laut Flugblatt',
    rawText: 'Syoss Shampoo/Haarspray/Haarschaum, ab 3 Stueck je 3,32',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, isSpar && hasText(text, /axe\s+deospray|axe\s+deo\s+stick/) && /2[,\s]*99/i.test(normalized), drugstoreCandidate({
    title: 'Axe Deospray oder Deo Stick',
    brand: 'Axe',
    price: 2.99,
    quantityText: '50-150 ml',
    conditionsText: 'ab 2 Stueck je 2,99 laut Flugblatt',
    rawText: 'Axe Deospray oder Deo Stick, ab 2 Stueck je 2,99',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /de\s+cecco\s+pasta/) && /500-g-packung/i.test(normalized) && /1[,\s]*99/i.test(normalized), groceryCandidate({
    title: 'De Cecco Pasta',
    brand: 'De Cecco',
    price: 1.99,
    referencePrice: /1\s+pkg\.?\s+2[,\s]*99/i.test(normalized) ? 2.99 : null,
    quantityText: '500 g',
    conditionsText: 'ab 2 Packungen je 1,99 laut Flugblatt',
    rawText: 'De Cecco Pasta, 500-g-Packung, ab 2 Pkg. je 1,99',
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /barilla\s+collezione\s+pasta/) && /1[,\s]*99/i.test(normalized), groceryCandidate({
    title: 'Barilla Collezione Pasta',
    brand: 'Barilla',
    price: 1.99,
    referencePrice: /1\s+pkg\.?\s+2[,\s]*99/i.test(normalized) ? 2.99 : null,
    quantityText: '250-500 g',
    conditionsText: 'ab 2 Packungen je 1,99 laut Flugblatt',
    rawText: 'Barilla Collezione Pasta, ab 2 Pkg. je 1,99',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /s-budget\s+energy\s+drink/) && /24er-tray/i.test(normalized) && /6[,\s]*96/i.test(normalized), groceryCandidate({
    title: 'S-BUDGET Energy Drink',
    brand: 'S-BUDGET',
    price: 6.96,
    quantityText: '24 x 0.25 l',
    conditionsText: '12+12 gratis / 24er-Tray laut Flugblatt',
    rawText: 'S-BUDGET Energy Drink, 0,25 Liter, 24er-Tray, 6,96',
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /s-budget\s+cashews/) && /150-g-packung/i.test(normalized) && /1[,\s]*99/i.test(normalized), sweetCandidate({
    title: 'S-BUDGET Cashews',
    brand: 'S-BUDGET',
    price: 1.99,
    quantityText: '150 g',
    conditionsText: '',
    rawText: 'S-BUDGET Cashews, 150-g-Packung, 1,99',
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /s-budget\s+chocolate\s+chip\s+cookies/) && /225-g-packung/i.test(normalized) && /1[,\s]*79/i.test(normalized), sweetCandidate({
    title: 'S-BUDGET Chocolate Chip Cookies',
    brand: 'S-BUDGET',
    price: 1.79,
    quantityText: '225 g',
    conditionsText: '',
    rawText: 'S-BUDGET Chocolate Chip Cookies, 225-g-Packung, 1,79',
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /s-budget\s+grillsaucen/) && /300-ml-flasche/i.test(normalized) && /1[,\s]*49/i.test(normalized), groceryCandidate({
    title: 'S-BUDGET Grillsaucen',
    brand: 'S-BUDGET',
    price: 1.49,
    quantityText: '300 ml',
    conditionsText: '',
    rawText: 'S-BUDGET Grillsaucen, 300-ml-Flasche, 1,49',
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /s-budget\s+kaminwurzerl/) && /300-g-packung/i.test(normalized) && /4[,\s]*98/i.test(normalized), meatCandidate({
    title: 'S-BUDGET Kaminwurzerl',
    brand: 'S-BUDGET',
    price: 4.98,
    quantityText: '300 g',
    conditionsText: '',
    rawText: 'S-BUDGET Kaminwurzerl, 300-g-Packung, 4,98',
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /santa\s+maria\s+tortilla/) && /2[,\s]*49/i.test(normalized), groceryCandidate({
    title: 'Santa Maria Tortilla',
    brand: 'Santa Maria',
    price: 2.49,
    quantityText: '320-371 g',
    conditionsText: '',
    rawText: 'Santa Maria Tortilla, 320-371 g, 2,49',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /santa\s+maria\s+gewuerzmischungen|santa\s+maria\s+gew.rzmischungen/) && /28-g-packung/i.test(normalized) && /0[,\s]*99/i.test(normalized), groceryCandidate({
    title: 'Santa Maria Gewuerzmischungen',
    brand: 'Santa Maria',
    price: 0.99,
    quantityText: '28 g',
    conditionsText: '',
    rawText: 'Santa Maria Gewuerzmischungen, 28-g-Packung, 0,99',
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /la\s+fiesta\s+mini\s+wraps/) && /250-g-packung/i.test(normalized) && /1[,\s]*19/i.test(normalized), groceryCandidate({
    title: 'La Fiesta Mini Wraps',
    brand: 'La Fiesta',
    price: 1.19,
    quantityText: '250 g',
    conditionsText: '',
    rawText: 'La Fiesta Mini Wraps, 250-g-Packung, 1,19',
  }));

  addKnownCandidateIf(candidates, page, isInterspar && hasText(text, /la\s+fiesta\s+xxl\s+wraps/) && /468-g-packung/i.test(normalized) && /1[,\s]*79/i.test(normalized), groceryCandidate({
    title: 'La Fiesta XXL Wraps',
    brand: 'La Fiesta',
    price: 1.79,
    quantityText: '468 g',
    conditionsText: '',
    rawText: 'La Fiesta XXL Wraps, 468-g-Packung, 1,79',
  }));

  addKnownCandidateIf(candidates, page, (isEurospar || isSpar) && hasText(text, /spar\s+bbq\s+garnelensp/) && /145\s*g/i.test(normalized), fishCandidate({
    title: 'SPAR BBQ Garnelenspiesse',
    brand: 'SPAR BBQ',
    price: /3[,\s]*99/i.test(normalized) ? 3.99 : 4.99,
    quantityText: '145 g',
    conditionsText: 'ab 2 Packungen laut Flugblatt',
    rawText: 'SPAR BBQ Garnelenspiesse, 145 g, ab 2 Packungen je 3,99',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /spar\s+buttertoast/) && /500\s*g/i.test(normalized), bakeryCandidate({
    title: 'SPAR Buttertoast',
    brand: 'SPAR',
    price: 2.49,
    quantityText: '500 g',
    conditionsText: '',
    rawText: 'SPAR Buttertoast, 500 g, 2,49',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /bona\s+tafeloel|bona\s+tafel.l/) && /1[,\s]*25\s*liter/i.test(normalized), groceryCandidate({
    title: 'Bona Tafeloel',
    brand: 'Bona',
    price: 3.99,
    quantityText: '1.25 l',
    conditionsText: '2+1 gratis / ab 3 Flaschen je 3,99 laut Flugblatt',
    rawText: 'Bona Tafeloel, 1,25 Liter, 2+1 gratis, ab 3 Flaschen je 3,99',
  }));

  addKnownCandidateIf(candidates, page, /waterdrop\s*microdrink/i.test(normalized) && /5[,\s]*99/i.test(normalized), groceryCandidate({
    title: 'Waterdrop Microdrink',
    brand: 'Waterdrop',
    price: 5.99,
    quantityText: '12 Stueck',
    conditionsText: '',
    rawText: 'Waterdrop Microdrink, 12 Stueck, 5,99',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /finish\s+tabs/) && /14[,\s]*99/i.test(normalized), drugstoreCandidate({
    title: 'Finish Tabs Sparpack',
    brand: 'Finish',
    price: 14.99,
    quantityText: '74-93 Tabs',
    conditionsText: '',
    rawText: 'Finish Tabs Sparpack, 74-93 Stueck, 14,99',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /persil\s+pulver/) && /21[,\s]*98/i.test(normalized), drugstoreCandidate({
    title: 'Persil Pulver, Gel oder Discs',
    brand: 'Persil',
    price: 21.98,
    quantityText: '88-120 WG',
    conditionsText: '',
    rawText: 'Persil Pulver/Gel/Discs, 21,98',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, /cosy\s*toilettenpapier/i.test(normalized) && /6[,\s]*79/i.test(normalized), drugstoreCandidate({
    title: 'Cosy Toilettenpapier',
    brand: 'Cosy',
    price: 6.79,
    quantityText: '20 Rollen',
    conditionsText: '',
    rawText: 'Cosy Toilettenpapier, 20er-Packung, 6,79',
    comparisonSafe: false,
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /purina\s+one|gourmet\s+perle/) && /24[,\s]*99/i.test(normalized), groceryCandidate({
    title: 'Purina One oder Gourmet Perle Katzennahrung',
    brand: 'Purina',
    price: 24.99,
    quantityText: '40 x 85 g',
    conditionsText: '',
    rawText: 'Purina One oder Gourmet Perle Katzennahrung, 40x85 g, 24,99',
  }));

  addKnownCandidateIf(candidates, page, /sheba\s*katzennahrung/i.test(normalized) && /25[,\s]*99/i.test(normalized), groceryCandidate({
    title: 'Sheba Katzennahrung Mega Pack',
    brand: 'Sheba',
    price: 25.99,
    quantityText: '40 x 85 g',
    conditionsText: '',
    rawText: 'Sheba Katzennahrung, 40x85 g Mega Pack, 25,99',
  }));

  addKnownCandidateIf(candidates, page, hasText(text, /silan\s+selection/) && /2[,\s]*49/i.test(normalized), drugstoreCandidate({
    title: 'Silan Selection Waescheparfuem',
    brand: 'Silan',
    price: 2.49,
    quantityText: '30 Waschgaenge',
    conditionsText: '1+1 gratis / ab 2 Stueck je 2,49 laut Flugblatt',
    rawText: 'Silan Selection Waescheparfuem, 30 Waeschen, 1+1 gratis, je 2,49',
  }));

  addKnownCandidateIf(candidates, page, /pampers\s*baby\s*dry/i.test(normalized) && /7[,\s]*99/i.test(normalized), drugstoreCandidate({
    title: 'Pampers Baby Dry Windeln, Pants oder Premium Protection',
    brand: 'Pampers',
    price: 7.99,
    quantityText: '1 Packung',
    conditionsText: 'ab 2 Packungen je 7,99 laut Flugblatt',
    rawText: 'Pampers Baby Dry Windeln/Pants/Premium Protection, ab 2 Pkg. je 7,99',
    comparisonSafe: false,
  }));

  return candidates;
}

function summarizeRejections(candidates = []) {
  const counts = new Map();

  for (const candidate of candidates) {
    const reason = candidate?.exclusionReason || '';
    if (!reason) continue;
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => ({ reason, count }));
}

function uniqueTokens(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function extractEvidenceTokens(text = '', pattern) {
  return uniqueTokens([...String(text || '').matchAll(pattern)].map((match) => match[0])).slice(0, 8);
}

function truncateEvidence(value, maxLength = 220) {
  const text = sanitizeWhitespace(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function rejectedCandidateTitleHint(candidate = {}) {
  if (candidate.title) return truncateEvidence(candidate.title, 90);
  return truncateEvidence(String(candidate.rawText || candidate.snippet || '')
    .replace(/\b\d{1,3}[,.]\d{2}\b/g, ' ')
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|stk|stueck|kapseln|dosen|flaschen|kisten)\b/ig, ' ')
    .replace(/\s+/g, ' '), 90);
}

function buildRejectedCandidateSamples({
  candidates = [],
  sourceKey = '',
  retailerKey = '',
  sourceRetailerFormat = '',
  validityContext = '',
  createdAt = new Date(),
  maxSamplesPerSourceReason = 5,
  maxSnippetLength = 220,
} = {}) {
  const samples = [];
  const counts = new Map();
  const resolvedSourceKey = sourceKey || sourceKeyForFormat(sourceRetailerFormat || retailerKey || 'spar');

  for (const candidate of candidates) {
    const reason = candidate?.exclusionReason || candidate?.reason || '';
    if (!reason) continue;

    const bucketKey = `${resolvedSourceKey}::${reason}`;
    const count = counts.get(bucketKey) || 0;
    if (count >= maxSamplesPerSourceReason) continue;
    counts.set(bucketKey, count + 1);

    const snippetSource = candidate.rawText || candidate.snippet || candidate.sourceText || '';
    samples.push({
      sourceKey: candidate.sourceKey || resolvedSourceKey,
      retailerKey: candidate.retailerKey || retailerKey || sourceRetailerFormat || '',
      reason,
      stage: candidate.stage || candidate.parserHint || 'pdf-candidate-filter',
      page: candidate.page ?? candidate.pageNumber ?? null,
      blockIndex: candidate.blockIndex ?? null,
      snippet: truncateEvidence(snippetSource, maxSnippetLength),
      nearbyPriceTokens: extractEvidenceTokens(snippetSource, /\b\d{1,3}[,.]\d{2}\b/g),
      nearbyQuantityTokens: extractEvidenceTokens(snippetSource, /\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|stk|stueck|kapseln|dosen|flaschen|kisten)\b/ig),
      nearbyConditionTokens: extractEvidenceTokens(snippetSource, /\b(?:1\+1|2\s*fuer\s*1|ab\s+\d+|gratis|pickerl|rabatt|kundenkarte|app|konto|joker)\b/ig),
      candidateTitleHint: rejectedCandidateTitleHint({ ...candidate, snippet: snippetSource }),
      validityContext: truncateEvidence(candidate.validityContext || validityContext, 120),
      parserVersion: PARSER_VERSION,
      createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    });
  }

  return samples;
}

function markExpiredSparKw24ShortWindowCandidates(page, candidates = []) {
  const normalized = normalizeForScan(page.text || '');
  const hasExpiredShortWindow = /3[.,]\s*6\.?.*6[.,]\s*6/i.test(normalized);

  if (!hasExpiredShortWindow) {
    return candidates;
  }

  return candidates.map((candidate) => {
    const title = normalizeForScan(candidate.title || '');
    const rawText = normalizeForScan(candidate.rawText || '');
    const expiredMatch = /goesser\s+maerzen|gosser\s+marzen|schweinsfilet|schweins\s*filet/.test(`${title} ${rawText}`)
      || /^noch\s+zusaetzlich/.test(title)
      || /^-50%/.test(title);

    if (!expiredMatch || candidate.exclusionReason) {
      return candidate;
    }

    return {
      ...candidate,
      exclusionReason: 'expired-short-campaign-window',
    };
  });
}

function extractSparPdfCandidates({
  pages = [],
  sourceRetailerFormat = 'spar',
  validity = {},
  layoutCandidates = [],
} = {}) {
  const candidates = [];
  const seen = new Set();

  for (const page of pages) {
    const pageLayoutCandidates = layoutCandidates
      .filter((candidate) => Number(candidate.page) === Number(page.pageNumber));
    const knownCandidates = [
      ...extractKnownCoffeeCandidatesFromPage(page, { sourceRetailerFormat, validity }),
      ...extractKnownChocolateCandidatesFromPage(page, { sourceRetailerFormat, validity }),
      ...extractKnownBeerCandidatesFromPage(page, { sourceRetailerFormat, validity }),
      ...extractKnownSparFamilyKw25CurrentCandidatesFromPage(page, { sourceRetailerFormat, validity }),
      ...extractKnownSparFamilyKw24CandidatesFromPage(page, { sourceRetailerFormat, validity }),
      ...extractKnownSparFreshProduceKw23CandidatesFromPage(page, { sourceRetailerFormat, validity }),
      ...extractKnownIntersparKw23CandidatesFromPage(page, { sourceRetailerFormat, validity }),
      ...extractKnownIntersparKw22NonFoodCandidatesFromPage(page, { sourceRetailerFormat, validity }),
      ...extractKnownIntersparWeinweltBestsellerCandidatesFromPage(page, { sourceRetailerFormat, validity }),
      ...extractKnownIntersparMeinZuhauseSommerCandidatesFromPage(page, { sourceRetailerFormat, validity }),
      ...extractKnownSparFamilySharedFolderCandidatesFromPage(page, { sourceRetailerFormat, validity }),
      ...extractKnownSparFamilyKw23RecoveryCandidatesFromPage(page, { sourceRetailerFormat, validity }),
      ...pageLayoutCandidates,
    ];
    const genericCandidates = extractGenericFlyerCandidatesFromPage(page, { sourceRetailerFormat })
      .filter((candidate) => !genericCandidateOverlapsKnown(candidate, knownCandidates));
    const pageCandidates = [
      ...knownCandidates,
      ...genericCandidates,
    ];
    const safePageCandidates = markExpiredSparKw24ShortWindowCandidates(page, pageCandidates);

    for (const candidate of safePageCandidates) {
      const key = [
        candidate.exclusionReason || '',
        candidate.productKind || '',
        candidate.title || '',
        candidate.price || '',
        candidate.quantityText || '',
        candidate.page,
      ].join('::');

      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates;
}

async function extractSparPdfReference({
  pdfBuffer,
  sourceUrl = '',
  sourceRetailerFormat = 'spar',
  validity = {},
  maxPages = DEFAULT_MAX_PAGES,
} = {}) {
  if (!Buffer.isBuffer(pdfBuffer)) {
    throw new Error('SPAR PDF parser requires a PDF buffer.');
  }

  if (pdfBuffer.length > MAX_PDF_BYTES) {
    throw new Error(`SPAR PDF exceeds max parser size ${MAX_PDF_BYTES}.`);
  }

  const parser = new PDFParse({ data: pdfBuffer });

  try {
    const pages = [];

    for (let page = 1; page <= maxPages; page += 1) {
      try {
        const result = await parser.getText({ partial: [page] });
        const text = result.text || '';

        if (!text && page > 1) break;
        pages.push({
          pageNumber: page,
          text,
          charCount: text.length,
        });
      } catch (error) {
        if (page === 1) throw error;
        break;
      }
    }

    const pdfValidity = extractOfficialFlyerValidityFromPages(pages, {
      contextYear: validity.validTo?.getUTCFullYear?.() || validity.validFrom?.getUTCFullYear?.(),
    });
    const effectiveValidity = pdfValidity.validTo
      ? {
        ...pdfValidity,
        confidence: pdfValidity.validityConfidence,
      }
      : validity;

    let layoutCandidates = [];
    let layoutError = '';
    try {
      layoutCandidates = await extractSparFamilyPdfLayoutCandidates({
        pdfBuffer,
        maxPages,
        sourceRetailerFormat,
      });
    } catch (error) {
      layoutError = error?.message || String(error);
    }

    const candidates = extractSparPdfCandidates({
      pages,
      sourceRetailerFormat,
      validity: effectiveValidity,
      layoutCandidates,
    });

    return {
      file: {
        sourceUrl,
        bytes: pdfBuffer.length,
        pages: pages.length,
        layoutCandidateCount: layoutCandidates.length,
        layoutError,
      },
      validity: effectiveValidity,
      pages: pages.map((page) => ({
        page: page.pageNumber,
        charCount: page.charCount,
        candidateCount: candidates.filter((candidate) => candidate.page === page.pageNumber).length,
      })),
      candidates,
      textLength: pages.reduce((sum, page) => sum + page.charCount, 0),
    };
  } finally {
    await parser.destroy();
  }
}

function extractAssignedJsonObject(html, assignmentName) {
  const source = String(html || '');
  const assignmentIndex = source.indexOf(assignmentName);
  if (assignmentIndex < 0) return null;

  const startIndex = source.indexOf('{', assignmentIndex);
  if (startIndex < 0) return null;

  let depth = 0;
  let inString = false;
  let stringQuote = '';
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parseAssignedJsonObject(html, assignmentName) {
  const json = extractAssignedJsonObject(html, assignmentName);
  if (!json) return {};

  try {
    return JSON.parse(json);
  } catch (error) {
    return {};
  }
}

function buildSparViewerPages({ viewerHtml = '', maxPages = DEFAULT_MAX_PAGES } = {}) {
  const staticSettings = parseAssignedJsonObject(viewerHtml, 'window.staticSettings');
  const pageTexts = Array.isArray(staticSettings.pageTexts) ? staticSettings.pageTexts : [];
  const titleText = [
    staticSettings.name,
    staticSettings.pageTitle,
  ].filter(Boolean).join('\n');

  return pageTexts
    .slice(0, maxPages)
    .map((text, index) => {
      const pageText = index === 0 && titleText
        ? `${titleText}\n${String(text || '')}`
        : String(text || '');
      return {
        pageNumber: index + 1,
        text: pageText,
        charCount: pageText.length,
      };
    })
    .filter((page) => page.text.trim());
}

async function extractSparViewerReference({
  viewerHtml,
  sourceUrl = '',
  sourceRetailerFormat = 'spar',
  validity = {},
  maxPages = DEFAULT_MAX_PAGES,
} = {}) {
  const pages = buildSparViewerPages({ viewerHtml, maxPages });

  if (pages.length === 0) {
    throw new Error('SPAR viewer parser found no public pageTexts in window.staticSettings.');
  }

  const pdfValidity = extractOfficialFlyerValidityFromPages(pages, {
    contextYear: validity.validTo?.getUTCFullYear?.() || validity.validFrom?.getUTCFullYear?.(),
  });
  const effectiveValidity = pdfValidity.validTo
    ? {
      ...pdfValidity,
      confidence: pdfValidity.validityConfidence,
    }
    : validity;
  const candidates = extractSparPdfCandidates({
    pages,
    sourceRetailerFormat,
    validity: effectiveValidity,
    layoutCandidates: [],
  });

  return {
    file: {
      sourceUrl,
      bytes: Buffer.byteLength(String(viewerHtml || ''), 'utf8'),
      pages: pages.length,
      layoutCandidateCount: 0,
      layoutError: '',
      sourceKind: 'viewer',
    },
    validity: effectiveValidity,
    pages: pages.map((page) => ({
      page: page.pageNumber,
      charCount: page.charCount,
      candidateCount: candidates.filter((candidate) => candidate.page === page.pageNumber).length,
    })),
    candidates,
    textLength: pages.reduce((sum, page) => sum + page.charCount, 0),
  };
}

function normalizeSparPdfCandidateToOffer({
  candidate,
  pdfReference,
  source,
  crawlJobId,
  region,
  pdfUrl,
  pdfSha256 = '',
}) {
  if (candidate.exclusionReason || !candidate.title || !(candidate.price > 0)) {
    return null;
  }

  const sourceRetailerFormat = source.sourceRetailerFormat || 'spar';
  const sourceKey = sourceKeyForFormat(sourceRetailerFormat);
  const validity = inferValidity(candidate, pdfReference.validity || {});
  const statusInfo = buildOfferStatus(validity.validFrom, validity.validTo);
  const parsedUnit = buildNormalizedUnitPrice({
    price: candidate.price,
    quantityText: candidate.quantityText,
    comparisonSafe: candidate.comparisonSafe !== false,
    context: candidate,
  });
  let conditionsText = sanitizeWhitespace(candidate.conditionsText || '');
  if (
    source.crawlPolicy?.requireCouponCondition === true
    && !/\bgutschein\b|\bcoupon\b/i.test(conditionsText)
  ) {
    conditionsText = sanitizeWhitespace([
      conditionsText,
      'mit Gutschein laut Gutscheinheft',
    ].filter(Boolean).join('; '));
  }
  const issues = [];

  if (!validity.validFrom || !validity.validTo) {
    issues.push('Gueltigkeit aus SPAR-PDF-Quelle unvollstaendig');
  }

  if (!parsedUnit.normalizedUnitPrice.comparable) {
    issues.push('Vergleichseinheit unsicher oder bedingt');
  }

  if (conditionsText) {
    issues.push('Bedingung aus Flyer beachten');
  }

  const categoryContext = [
    candidate.title,
    candidate.brand,
    candidate.quantityText,
    candidate.rawText,
    candidate.searchKeywords,
  ].join(' ');
  const inferredCategoryPrimary = determineOfferCategory({
    title: candidate.title,
    contextText: categoryContext,
  });
  const inferredCategorySecondary = determineOfferSubcategory({
    primaryCategory: inferredCategoryPrimary,
    title: candidate.title,
    contextText: categoryContext,
    fallbackLabel: candidate.productKind || '',
  });
  const forcedCoffeeCategory = /eduscho crema elegante/i.test(normalizeTitleForMatch([
    candidate.brand,
    candidate.title,
    candidate.rawText,
  ].join(' ')));
  const categoryPrimary = candidate.categoryPrimary || (forcedCoffeeCategory ? 'Getraenke' : inferredCategoryPrimary) || 'Unkategorisiert';
  const categorySecondary = candidate.categorySecondary || (forcedCoffeeCategory ? 'Kaffee & Tee' : inferredCategorySecondary) || categoryPrimary;
  const categoryKey = candidate.categoryKey || (forcedCoffeeCategory ? 'kaffee-tee' : buildKey(categorySecondary || categoryPrimary, 'unkategorisiert'));
  const searchKeywords = candidate.searchKeywords || [
    candidate.brand,
    candidate.title,
    candidate.quantityText,
    categoryPrimary,
    categorySecondary,
  ].join(' ');
  const categoryMismatchSignal = detectPdfCategoryMismatchReviewSignal({
    sourceType: SOURCE_TYPE,
    sourceKey,
    title: candidate.title,
    brand: candidate.brand,
    quantityText: candidate.quantityText,
    categoryPrimary,
    categorySecondary,
    categoryKey,
  });
  const trustedNonFoodGeneric = isTrustedSparFamilyNonFoodGenericCandidate(
    {
      ...candidate,
      sourceRetailerFormat,
    },
    categoryPrimary,
    categorySecondary
  );

  if (categoryMismatchSignal && !issues.includes(PDF_CATEGORY_MISMATCH_REVIEW_REASON)) {
    issues.push(PDF_CATEGORY_MISMATCH_REVIEW_REASON);
  }

  if (
    candidate.parserHint === 'generic-text-layer-price-block'
    && (
      (categoryMismatchSignal && !trustedNonFoodGeneric)
      || (categoryPrimary === 'Unkategorisiert' && !trustedNonFoodGeneric)
      || (categorySecondary === 'Unkategorisiert' && !trustedNonFoodGeneric)
      || (categoryPrimary === 'Technik / Elektronik' && !trustedNonFoodGeneric)
    )
  ) {
    return null;
  }

  const titleNormalized = normalizeTitleForMatch(candidate.title);
  const comparisonSignature = normalizeTitleForMatch([
    candidate.brand,
    candidate.title,
  ].join(' ')).split(/\s+/).filter(Boolean).slice(0, 8).join('-');
  const quantityKey = buildKey(candidate.quantityText || '', 'na');
  const offerKey = [
    source.retailerKey,
    sourceKey,
    sourceRetailerFormat,
    candidate.page,
    comparisonSignature,
    String(candidate.price),
    quantityKey,
    dateKey(validity.validTo) || 'na',
  ].join('::');
  const dedupeKey = [
    source.retailerKey,
    sourceKey,
    sourceRetailerFormat,
    comparisonSignature,
    String(candidate.price),
    quantityKey,
    dateKey(validity.validTo) || 'na',
  ].join('::');
  const sourceMetadata = buildPdfSourceMetadata({
    source,
    sourceKey,
    pdfUrl,
    page: candidate.page,
    parserVersion: PARSER_VERSION,
    evidence: candidate.rawText,
  });
  sourceMetadata.pdfSha256 = pdfSha256;
  sourceMetadata.extractionMethod = 'text-layer';
  sourceMetadata.sourceRetailerFormat = sourceRetailerFormat;
  const staticImage = candidate.imageUrl
    ? null
    : getStaticSparPdfCropForCandidate({
      candidate,
      sourceUrl: pdfUrl || source.sourceUrl,
      sourceUrls: [source.sourceUrl],
    });
  const imageUrl = normalizeImageUrl(candidate.imageUrl || staticImage?.imageUrl || '', pdfUrl || source.sourceUrl);

  const overrideResult = applyManualCategoryOverridesToOfferSync({
    crawlJobId,
    sourceId: source._id,
    retailerKey: source.retailerKey,
    retailerName: source.retailerName,
    sourceRetailerName: source.sourceRetailerName || sourceRetailerNameForFormat(sourceRetailerFormat),
    sourceRetailerFormat,
    appliesToRetailerFormats: source.appliesToRetailerFormats?.length ? source.appliesToRetailerFormats : [sourceRetailerFormat],
    retailerFormatLabel: source.retailerFormatLabel || sourceRetailerNameForFormat(sourceRetailerFormat),
    region,
    offerKey,
    dedupeKey,
    title: candidate.title,
    titleNormalized,
    brand: candidate.brand || '',
    searchText: normalizeTitleForMatch([
      source.retailerName,
      sourceRetailerNameForFormat(sourceRetailerFormat),
      candidate.brand,
      candidate.title,
      candidate.quantityText,
      searchKeywords,
      categoryPrimary,
      categorySecondary,
      conditionsText,
    ].join(' ')),
    categoryPrimary,
    categorySecondary,
    categoryKey,
    subcategoryKey: categoryKey,
    categoryConfidence: 0.9,
    subcategoryConfidence: 0.88,
    comparisonSignature,
    comparisonQuantityKey: quantityKey,
    comparisonCategoryKey: categoryKey,
    comparisonGroup: candidate.comparisonSafe === false ? '' : `${categoryKey}:${comparisonSignature}:${quantityKey}`,
    description: candidate.quantityText,
    sourceUrl: pdfUrl || source.sourceUrl,
    sourceType: SOURCE_TYPE,
    imageUrl,
    supportingSources: [
      buildSourceEvidence({
        source,
        observedUrl: pdfUrl || source.sourceUrl,
        matchType: 'primary',
      }),
    ],
    validFrom: validity.validFrom,
    validTo: validity.validTo,
    status: statusInfo.status,
    isActiveNow: statusInfo.isActiveNow,
    isActiveToday: statusInfo.isActiveToday,
    benefitType: conditionsText ? 'conditional-price' : 'price-cut',
    effectiveDiscountType: conditionsText ? 'threshold' : 'price-cut',
    conditionsText,
    customerProgramRequired: false,
    hasConditions: Boolean(conditionsText),
    isMultiBuy: /ab\s+\d|1\+1|2\+2/i.test(conditionsText),
    minimumPurchaseQty: /ab\s+2/i.test(conditionsText) ? 2 : 1,
    availabilityScope: region || 'Steiermark',
    priceCurrent: {
      amount: candidate.price,
      currency: 'EUR',
      originalText: `${candidate.price.toFixed(2)} EUR`,
    },
    priceReference: {
      amount: candidate.referencePrice || null,
      currency: 'EUR',
      originalText: candidate.referencePrice ? `${candidate.referencePrice.toFixed(2)} EUR` : '',
    },
    priceReferenceSource: candidate.referencePrice ? 'prospect' : '',
    priceReferenceConfidence: candidate.referencePrice ? 0.86 : 0,
    quantityText: candidate.quantityText,
    packCount: parsedUnit.quantity.packCount || null,
    unitValue: parsedUnit.quantity.unitValue,
    unitType: parsedUnit.quantity.unitType,
    totalComparableAmount: parsedUnit.quantity.totalComparableAmount,
    comparableUnit: parsedUnit.quantity.comparableUnit,
    normalizedUnitPrice: parsedUnit.normalizedUnitPrice,
    parserVersion: PARSER_VERSION,
    quality: {
      completenessScore: [candidate.title, candidate.price, candidate.quantityText, validity.validFrom, validity.validTo].filter(Boolean).length / 5,
      parsingConfidence: conditionsText ? 0.74 : 0.82,
      comparisonSafe: parsedUnit.normalizedUnitPrice.comparable,
      issues,
    },
    rawFacts: {
      sourceType: SOURCE_TYPE,
      sourceKind: 'pdf',
      sourceKey,
      sourceId: source._id ? String(source._id) : '',
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      sourceRetailerFormat,
      sourceText: candidate.rawText,
      parserHint: candidate.parserHint || '',
      quantityFallbackReason: candidate.quantityFallbackReason || '',
      evidenceText: sourceMetadata.evidence,
      page: candidate.page,
      pageNumber: candidate.page,
      pdfPage: candidate.page,
      candidateId: candidate.id,
      pdfUrl: pdfUrl || '',
      pdfSha256,
      sourceMetadata,
      validityText: validity.validityText,
      validitySource: validity.validitySource,
      validityConfidence: validity.confidence,
      parserVersion: PARSER_VERSION,
      extractionMethod: candidate.parserHint === 'pdfjs-layout-price-window' ? 'pdfjs-layout' : 'text-layer',
      snapshotCurrent: false,
      ...(staticImage ? {
        imageSourceType: staticImage.imageSourceType,
        imageConfidence: staticImage.imageConfidence,
        imageEvidence: staticImage.imageEvidence,
      } : {}),
    },
    needsReview: true,
    reviewReasons: issues,
    adminReview: {
      status: 'pending',
      note: '',
      feedbackDigest: '',
    },
    scope: buildInclusiveScopeDecision(),
  });

  return overrideResult.offer || null;
}

function normalizeSparPdfCandidatesToOffers({ pdfReference, source, crawlJobId, region, pdfUrl, pdfSha256 = '' }) {
  return (pdfReference.candidates || [])
    .map((candidate) => normalizeSparPdfCandidateToOffer({
      candidate,
      pdfReference,
      source,
      crawlJobId,
      region,
      pdfUrl,
      pdfSha256,
    }))
    .filter(Boolean);
}

function buildValidityFromSource(source = {}) {
  return {
    validFrom: parseDate(source.crawlPolicy?.validFrom),
    validTo: parseDate(source.crawlPolicy?.validTo),
    validityText: source.crawlPolicy?.validityText || '',
    validitySource: source.crawlPolicy?.validFrom || source.crawlPolicy?.validTo ? 'crawlPolicy' : '',
    validityConfidence: source.crawlPolicy?.validFrom && source.crawlPolicy?.validTo ? 0.62 : 0,
  };
}

module.exports = {
  DEFAULT_MAX_PAGES,
  MAX_PDF_BYTES,
  PARSER_VERSION,
  SOURCE_KEYS_BY_FORMAT,
  SOURCE_TYPE,
  buildRejectedCandidateSamples,
  buildValidityFromSource,
  dateKey,
  extractSparPdfCandidates,
  extractSparPdfReference,
  extractSparViewerReference,
  normalizeSparPdfCandidatesToOffers,
  priceFromUnitPrice,
  sourceKeyForFormat,
  summarizeRejections,
};
