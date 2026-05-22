const { PDFParse } = require('pdf-parse');
const {
  sanitizeWhitespace,
  normalizeTitleForMatch,
  buildSourceEvidence,
} = require('./sourceEvidence');
const { buildPdfSourceMetadata, normalizePdfText } = require('./pdfOfferParsing');
const {
  determineOfferCategory,
  determineOfferSubcategory,
  buildInclusiveScopeDecision,
} = require('./categoryClassifier');
const { applyManualCategoryOverridesToOfferSync } = require('../quality/manualCategoryOverrideService');
const { normalizeImageUrl } = require('../images/imageUrl');

const PARSER_VERSION = 'spar-official-flyer-pdf-v1';
const SOURCE_TYPE = 'spar-official-pdf';
const MAX_PDF_BYTES = 40 * 1024 * 1024;
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
  const match = normalized.match(/\b(\d+(?:[,.]\d+)?)\s*-?\s*(kg|g|l|ml|kapseln|kapsel|stk|stueck|waschgange|waschgaenge|waschgang)\b/i);

  if (!match) {
    return {
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
    unitValue: value,
    unitType: unit === 'stk' ? 'Stk' : unit,
    totalComparableAmount,
    comparableUnit: comparableUnit === 'stk' ? 'Stk' : comparableUnit,
  };
}

function buildNormalizedUnitPrice({ price, quantityText, comparisonSafe }) {
  const quantity = parseQuantity(quantityText);

  if (!comparisonSafe || !price || !quantity.totalComparableAmount || !['kg', 'l', 'Stk', 'waschgang'].includes(quantity.comparableUnit)) {
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
  if (candidate.validToOverride) {
    return {
      validFrom: fallbackValidity.validFrom || null,
      validTo: candidate.validToOverride,
      validityText: `${dateKey(fallbackValidity.validFrom)} - ${dateKey(candidate.validToOverride)}`,
      confidence: 0.86,
    };
  }

  return {
    validFrom: fallbackValidity.validFrom || null,
    validTo: fallbackValidity.validTo || null,
    validityText: [dateKey(fallbackValidity.validFrom), dateKey(fallbackValidity.validTo)].filter(Boolean).join(' - '),
    confidence: fallbackValidity.validFrom && fallbackValidity.validTo ? 0.82 : 0,
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

function addRejectedCandidate(candidates, pageNumber, reason, rawText) {
  candidates.push({
    id: `spar-p${pageNumber}-rejected-${candidates.length + 1}`,
    page: pageNumber,
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
  const xPackMatch = text.match(/\b\d+\s*x\s*\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml)\b/i);
  if (xPackMatch) return sanitizeWhitespace(xPackMatch[0]).replace(',', '.');

  const packMatch = text.match(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|stk|stueck|kapseln|waschg.nge|waschgänge|waschgaenge|waschgang)\b/i);
  if (packMatch) return sanitizeWhitespace(packMatch[0]).replace(',', '.');

  const packageMatch = text.match(/\b\d+(?:[,.]\d+)?[-\s]?(?:kg|g|l|ml)[-\s]?(?:packung|flasche|dose|beutel|glas|pkg)\b/i);
  if (packageMatch) {
    const quantity = packageMatch[0].match(/\d+(?:[,.]\d+)?[-\s]?(?:kg|g|l|ml)/i)?.[0] || '';
    return sanitizeWhitespace(quantity).replace(',', '.');
  }

  return '';
}

function looksLikeNonProductLine(line = '') {
  const normalized = normalizeForScan(line);

  return !normalized
    || normalized.length < 3
    || /\bangebote?\s+gueltig\b/i.test(normalized)
    || /^(?:statt|per|= per|angebot|gueltig|gilt|noch|zusaetzlich|mengenvorteil|im einzelverkauf|ab \d+|je|nur|-?\d+\s*%|seite \d+)$/i.test(normalized)
    || /^\d{1,3}[,.]\d{2}$/.test(normalized)
    || /\b(?:do|fr|sa|so|mo|di|mi)[,.]?\s*\d{1,2}[,.]\d{1,2}/i.test(normalized);
}

function lineContainsQuantity(line = '') {
  return /\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|stk|stueck|kapseln|waschg.nge|waschgänge|waschgaenge|waschgang)\b/i.test(line)
    || /\b\d+(?:[,.]\d+)?[-\s]?(?:kg|g|l|ml)[-\s]?(?:packung|flasche|dose|beutel|glas|pkg)\b/i.test(line);
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
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|stk|stueck|kapseln|waschg.nge|waschgänge|waschgaenge|waschgang)\b.*$/i, '')
    .replace(/\b(?:ganze bohne|gemahlen|packung|flasche|dose|beutel|glas)\b[,\s]*$/i, '')
    .trim();

  return sanitizeWhitespace(rawTitle);
}

function extractGenericFlyerCandidatesFromPage(page) {
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
    const title = buildGenericTitle(blockLines);
    const quantityText = extractQuantityTextFromBlock(blockLines);

    if (!title || title.length < 4 || !/[a-zA-Z]/.test(title)) {
      addRejectedCandidate(candidates, page.pageNumber, 'generic-unclear-product', blockLines.join(' '));
      continue;
    }

    if (!quantityText) {
      addRejectedCandidate(candidates, page.pageNumber, 'generic-missing-quantity', blockLines.join(' '));
      continue;
    }

    addCandidate(candidates, page.pageNumber, {
      productKind: 'generic-flyer-product',
      title,
      brand: title.split(/\s+/)[0] || '',
      price,
      referencePrice: parseReferencePriceFromBlock(blockLines),
      quantityText,
      conditionsText: '',
      rawText: blockLines.join(' '),
      comparisonSafe: true,
      parserHint: 'generic-text-layer-price-block',
    });
  }

  return candidates;
}

function genericCandidateOverlapsKnown(candidate = {}, knownCandidates = []) {
  if (!candidate || candidate.exclusionReason) return false;

  const candidateTitle = normalizeTitleForMatch(candidate.title || '');
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

    return Boolean(
      knownTitle
      && (
        candidateTitle.includes(knownTitle)
        || knownTitle.includes(candidateTitle)
        || (knownBrand && candidateTitle.includes(knownBrand))
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

function hasText(text, pattern) {
  return pattern.test(normalizeForScan(text));
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

function extractKnownBeerCandidatesFromPage(page, { sourceRetailerFormat } = {}) {
  const text = normalizePdfText(page.text || '');
  const normalized = normalizeForScan(text);
  const candidates = [];
  const extraPercentCondition = 'Zusaetzlich -25% am Fr., 22.5. und Sa., 23.5.2026 laut Flugblatt';

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

function extractSparPdfCandidates({ pages = [], sourceRetailerFormat = 'spar', validity = {} } = {}) {
  const candidates = [];
  const seen = new Set();

  for (const page of pages) {
    const knownCandidates = [
      ...extractKnownCoffeeCandidatesFromPage(page, { sourceRetailerFormat, validity }),
      ...extractKnownBeerCandidatesFromPage(page, { sourceRetailerFormat, validity }),
    ];
    const genericCandidates = extractGenericFlyerCandidatesFromPage(page)
      .filter((candidate) => !genericCandidateOverlapsKnown(candidate, knownCandidates));
    const pageCandidates = [
      ...knownCandidates,
      ...genericCandidates,
    ];

    for (const candidate of pageCandidates) {
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

    const candidates = extractSparPdfCandidates({
      pages,
      sourceRetailerFormat,
      validity,
    });

    return {
      file: {
        sourceUrl,
        bytes: pdfBuffer.length,
        pages: pages.length,
      },
      validity,
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
  });
  const conditionsText = sanitizeWhitespace(candidate.conditionsText || '');
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
  const categoryPrimary = candidate.categoryPrimary || inferredCategoryPrimary || 'Unkategorisiert';
  const categorySecondary = candidate.categorySecondary || inferredCategorySecondary || categoryPrimary;
  const categoryKey = candidate.categoryKey || buildKey(categorySecondary || categoryPrimary, 'unkategorisiert');
  const searchKeywords = candidate.searchKeywords || [
    candidate.brand,
    candidate.title,
    candidate.quantityText,
    categoryPrimary,
    categorySecondary,
  ].join(' ');
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
    imageUrl: normalizeImageUrl(candidate.imageUrl || '', pdfUrl || source.sourceUrl),
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
    availabilityScope: region || 'Grossraum Graz',
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
      evidenceText: sourceMetadata.evidence,
      page: candidate.page,
      pageNumber: candidate.page,
      pdfPage: candidate.page,
      candidateId: candidate.id,
      pdfUrl: pdfUrl || '',
      pdfSha256,
      sourceMetadata,
      validityText: validity.validityText,
      validityConfidence: validity.confidence,
      parserVersion: PARSER_VERSION,
      extractionMethod: 'text-layer',
      snapshotCurrent: false,
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
  };
}

module.exports = {
  DEFAULT_MAX_PAGES,
  MAX_PDF_BYTES,
  PARSER_VERSION,
  SOURCE_KEYS_BY_FORMAT,
  SOURCE_TYPE,
  buildValidityFromSource,
  dateKey,
  extractSparPdfCandidates,
  extractSparPdfReference,
  normalizeSparPdfCandidatesToOffers,
  priceFromUnitPrice,
  sourceKeyForFormat,
  summarizeRejections,
};
