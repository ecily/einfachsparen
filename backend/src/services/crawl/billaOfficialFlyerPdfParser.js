const { PDFParse } = require('pdf-parse');
const {
  sanitizeWhitespace,
  normalizeTitleForMatch,
  buildSourceEvidence,
} = require('./sourceEvidence');
const {
  normalizePdfText,
  summarizeRejections,
  buildPdfSourceMetadata,
} = require('./pdfOfferParsing');
const {
  determineOfferCategory,
  determineOfferSubcategory,
  buildInclusiveScopeDecision,
} = require('./categoryClassifier');
const { applyManualCategoryOverridesToOfferSync } = require('../quality/manualCategoryOverrideService');
const { normalizeImageUrl } = require('../images/imageUrl');

const PARSER_VERSION = 'billa-official-flyer-pdf-v1';
const SOURCE_TYPE = 'billa-official-flyer-pdf';
const DEFAULT_MAX_PAGES = 8;
const MAX_PDF_BYTES = 60 * 1024 * 1024;

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

function normalizeForScan(value = '') {
  return normalizeTitleForMatch(normalizePdfText(value))
    .replace(/\s+/g, ' ')
    .trim();
}

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function parseAustrianDate(day, month, year, { endOfDay = false } = {}) {
  const numericYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
  return new Date(Date.UTC(
    numericYear,
    Number(month) - 1,
    Number(day),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  ));
}

function parseBillaFlyerValidity(text = '') {
  const normalized = normalizePdfText(text);
  const range = normalized.match(/von\s+(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)[,\s]+(\d{1,2})\.\s*(\d{1,2})\.\s+bis\s+(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)[,\s]+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})/i)
    || normalized.match(/alle angebote gueltig[\s\S]{0,140}?(\d{1,2})\.\s*(\d{1,2})\.[\s\S]{0,80}?(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})/i)
    || normalized.match(/alle angebote gÃ¼ltig[\s\S]{0,140}?(\d{1,2})\.\s*(\d{1,2})\.[\s\S]{0,80}?(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})/i);

  if (!range) {
    return {
      validFrom: null,
      validTo: null,
      validityText: '',
      confidence: 0,
    };
  }

  return {
    validFrom: parseAustrianDate(range[1], range[2], range[5]),
    validTo: parseAustrianDate(range[3], range[4], range[5], { endOfDay: true }),
    validityText: `VON ${range[1]}.${range[2]}. BIS ${range[3]}.${range[4]}.${range[5]}`,
    confidence: 0.84,
  };
}

function parseCompressedPrice(line = '') {
  const text = normalizePdfText(line)
    .replace(/\s+/g, ' ')
    .trim();

  if (!text || /%|kg|g|ml|liter|l\b|stk|stueck|stÃ¼ck|fl\.|pkg\.|packung|gueltig|gÃ¼ltig|bis\s+di|seite/i.test(text)) {
    return null;
  }

  const spaced = text.match(/^(\d{1,2})\s+(\d{2})(?:\s*(?:eur|euro|€))?$/i);
  if (spaced) {
    return money(`${spaced[1]}.${spaced[2]}`);
  }

  const compact = text.match(/^(\d{3,4})(?:\s*statt\b.*)?$/i) || text.match(/^(\d{3,4})statt\b/i);
  if (!compact) {
    return null;
  }

  const digits = compact[1];
  const euros = digits.slice(0, -2) || '0';
  const cents = digits.slice(-2);

  return money(`${euros}.${cents}`);
}

function parseReferencePrice(lines = []) {
  const text = normalizePdfText(lines.join(' '));
  const decimal = text.match(/\bstatt\s+(\d{1,3}[,.]\d{2})\b/i);
  if (decimal) return money(Number(decimal[1].replace(',', '.')));

  const compact = text.match(/\bstatt\s+(\d{3,4})\b/i);
  if (compact) {
    const digits = compact[1];
    return money(`${digits.slice(0, -2) || '0'}.${digits.slice(-2)}`);
  }

  const singleUnit = text.match(/\b1\s+(?:pkg|packung|fl|flasche|dose|stk|stueck|stÃ¼ck)\.?\s*€\s*(\d{1,3}[,.]\d{2})\b/i);
  return singleUnit ? money(Number(singleUnit[1].replace(',', '.'))) : null;
}

function lineHasQuantity(line = '') {
  const normalized = normalizePdfText(line);
  return /\b\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|liter|stk|stueck|stÃ¼ck|stuck)\b/i.test(normalized)
    || /\bper\s+(?:kilo|kg|stueck|stÃ¼ck|stuck)\b/i.test(normalized)
    || /\bpackung\b/i.test(normalized);
}

function extractQuantityText(lines = []) {
  const text = normalizePdfText(lines.join(' '));
  const multipack = text.match(/\b\d+\s*x\s*\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|liter)\b/i);
  if (multipack) return normalizePdfText(multipack[0]).replace(',', '.').replace(/\bliter\b/i, 'l');

  const quantity = text.match(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|liter|stk|stueck|stÃ¼ck|stuck)\b/i);
  if (quantity) return normalizePdfText(quantity[0]).replace(',', '.').replace(/\bliter\b/i, 'l').replace(/stueck|stÃ¼ck|stuck/i, 'Stk');

  if (/\bper\s+kilo\b/i.test(text)) return '1 kg';
  if (/\bper\s+(?:stueck|stÃ¼ck|stuck)\b/i.test(text)) return '1 Stk';

  return '';
}

function parseQuantity(quantityText = '') {
  const normalized = normalizeForScan(quantityText);
  const multipack = normalized.match(/\b(\d+)\s*x\s*(\d+(?:[,.]\d+)?)\s*(kg|g|ml|l|liter)\b/i);

  if (multipack) {
    const packCount = Number(multipack[1]);
    let unitValue = Number(multipack[2].replace(',', '.'));
    let unit = multipack[3].toLowerCase();
    if (unit === 'liter') unit = 'l';

    let comparableUnit = unit;
    let totalComparableAmount = packCount * unitValue;
    if (unit === 'g') {
      comparableUnit = 'kg';
      totalComparableAmount /= 1000;
    }
    if (unit === 'ml') {
      comparableUnit = 'l';
      totalComparableAmount /= 1000;
    }

    return {
      packCount,
      unitValue,
      unitType: unit,
      totalComparableAmount,
      comparableUnit,
    };
  }

  const single = normalized.match(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|ml|l|liter|stk|stueck|stuck)\b/i);
  if (!single) {
    return {
      packCount: null,
      unitValue: null,
      unitType: '',
      totalComparableAmount: null,
      comparableUnit: '',
    };
  }

  let value = Number(single[1].replace(',', '.'));
  let unit = single[2].toLowerCase();
  if (unit === 'liter') unit = 'l';
  if (unit === 'stueck' || unit === 'stuck') unit = 'stk';

  let comparableUnit = unit === 'stk' ? 'Stk' : unit;
  let totalComparableAmount = value;
  if (unit === 'g') {
    comparableUnit = 'kg';
    totalComparableAmount = value / 1000;
  }
  if (unit === 'ml') {
    comparableUnit = 'l';
    totalComparableAmount = value / 1000;
  }

  return {
    packCount: null,
    unitValue: value,
    unitType: unit === 'stk' ? 'Stk' : unit,
    totalComparableAmount,
    comparableUnit,
  };
}

function buildNormalizedUnitPrice({ price, quantityText }) {
  const quantity = parseQuantity(quantityText);
  const comparable = Boolean(price > 0 && quantity.totalComparableAmount > 0 && ['kg', 'l', 'Stk'].includes(quantity.comparableUnit));

  return {
    quantity,
    normalizedUnitPrice: comparable
      ? {
        amount: money(price / quantity.totalComparableAmount),
        unit: quantity.comparableUnit,
        comparable: true,
        confidence: 0.76,
      }
      : {
        amount: null,
        unit: '',
        comparable: false,
        confidence: 0,
      },
  };
}

function isNoiseProductLine(line = '') {
  const normalized = normalizeForScan(line);

  return !normalized
    || /^--\s*\d+\s+of\s+\d+\s*--$/.test(normalized)
    || /^seite\s+\d+$/.test(normalized)
    || /^(?:angebote?|alle angebote|mega wochenende|aktion|fr|sa|do|mo|di|nur|kurze zeit|statt|solange|nicht jeder|unsere statt-preise|ausgenommen|gueltig|gultig|gÃ¼ltig)\b/.test(normalized)
    || /^(?:ab|bei)\s+\d+\b/.test(normalized)
    || /^-?\d+\s*%$/.test(normalized)
    || /^[\d\s.,€-]+$/.test(line);
}

function buildProductBlocks(lines = []) {
  const blocks = [];
  let current = [];

  function flush() {
    const clean = current.filter((line) => !isNoiseProductLine(line));
    current = [];
    if (clean.length === 0) return;
    blocks.push(clean);
  }

  for (const line of lines) {
    if (isNoiseProductLine(line)) {
      continue;
    }

    current.push(line);

    if (lineHasQuantity(line) || current.length >= 8) {
      flush();
    }
  }

  flush();
  return blocks;
}

function buildTitleFromBlock(block = []) {
  const titleLines = [];

  for (const line of block) {
    if (lineHasQuantity(line)) {
      const beforeQuantity = line
        .replace(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|liter|stk|stueck|stÃ¼ck|stuck)\b.*$/i, '')
        .replace(/\bper\s+(?:kilo|kg|stueck|stÃ¼ck|stuck)\b.*$/i, '')
        .trim();
      if (beforeQuantity) titleLines.push(beforeQuantity);
      break;
    }

    titleLines.push(line);
  }

  return sanitizeWhitespace(titleLines.join(' '))
    .replace(/^(?:frei von\s+)?1o0%\s+/i, '')
    .replace(/^100\s*%\s*pflanzlich\s+/i, '')
    .replace(/\s*,\s*$/, '')
    .replace(/\*+$/g, '')
    .trim();
}

function hasPlausibleBillaTitle(title = '') {
  const normalized = normalizeForScan(title);
  const words = normalized.split(/\s+/).filter(Boolean);

  if (!title || title.length < 4 || title.length > 160) return false;
  if (!/[a-z]/.test(normalized)) return false;
  if (/^\s*[-\d]/.test(title) || /€/.test(title)) return false;
  if (words.length < 2 && title.length < 10) return false;
  if (/^(?:clever|billa|billa plus|aktion|gratis|statt|packung|per kilo|per stueck|div sorten)$/.test(normalized)) return false;

  return true;
}

function groupPriceLines(lines = []) {
  const groups = [];
  let current = null;

  function flush() {
    if (current) groups.push(current);
    current = null;
  }

  for (const line of lines) {
    const price = parseCompressedPrice(line);

    if (price) {
      flush();
      current = {
        price,
        lines: [line],
      };
      continue;
    }

    if (current && (isPriceContextLine(line) || isStattDecimalContinuation(current.lines, line))) {
      current.lines.push(line);
      continue;
    }

    flush();
  }

  flush();
  return groups;
}

function isStattDecimalContinuation(lines = [], line = '') {
  return /\bstatt\b/i.test(normalizePdfText(lines.join(' ')))
    && /^\d{1,3}[,.]\d{2}$/.test(normalizePdfText(line));
}

function isPriceContextLine(line = '') {
  const normalized = normalizeForScan(line);
  const raw = normalizePdfText(line);
  return Boolean(
    normalized
    && (
      /^(?:ab|bei)\s+\d+\b/.test(normalized)
      || /^1\s+(?:pkg|packung|fl|flasche|dose|stk|stueck)\b/.test(normalized)
      || /^(?:fr|sa|do|mo|di)\b/.test(normalized)
      || /^aktion$/.test(normalized)
      || /^statt\b/.test(normalized)
      || /^-?\s*\d+\s*%$/.test(raw)
    )
  );
}

function chooseBillaDatePricePair(first, second, now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Vienna',
    weekday: 'short',
  });
  const weekday = formatter.format(now).toLowerCase();
  const firstText = normalizeForScan(first.lines.join(' '));
  const secondText = normalizeForScan(second.lines.join(' '));
  const firstApplies = /fr|sa/.test(firstText) && ['fri', 'sat'].includes(weekday);
  const secondApplies = /do|mo|di/.test(secondText) && ['thu', 'mon', 'tue'].includes(weekday);

  const selected = firstApplies ? first : secondApplies ? second : first;

  return {
    price: selected.price,
    lines: selected.lines,
  };
}

function normalizePriceGroupsForProductCount(groups = [], productCount = 0, now = new Date()) {
  if (productCount > 0 && groups.length >= productCount * 2) {
    const paired = [];
    let index = 0;

    while (index + 1 < groups.length && paired.length < productCount) {
      const firstText = normalizeForScan(groups[index].lines.join(' '));
      const secondText = normalizeForScan(groups[index + 1].lines.join(' '));

      if ((/fr|sa/.test(firstText) && /do|mo|di/.test(secondText)) || (/fr|sa/.test(secondText) && /do|mo|di/.test(firstText))) {
        paired.push(chooseBillaDatePricePair(groups[index], groups[index + 1], now));
        index += 2;
      } else {
        paired.push(groups[index]);
        index += 1;
      }
    }

    while (index < groups.length && paired.length < productCount) {
      paired.push(groups[index]);
      index += 1;
    }

    if (paired.length === productCount) return paired;
  }

  return groups;
}

function addRejectedCandidate(candidates, pageNumber, reason, rawText) {
  candidates.push({
    id: `billa-p${pageNumber}-rejected-${candidates.length + 1}`,
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
    id: `billa-p${pageNumber}-${candidates.length + 1}`,
    page: pageNumber,
    productKind: 'billa-flyer-product',
    ...data,
  };
  const priceContextText = [candidate.conditionsText, candidate.rawText].filter(Boolean).join(' ');

  if (!candidate.title) {
    candidate.exclusionReason = 'product-unclear';
  } else if (!(candidate.price > 0)) {
    candidate.exclusionReason = 'price-missing';
  } else if (!candidate.quantityText) {
    candidate.exclusionReason = 'quantity-missing';
  } else if (!hasAnchoredBillaPriceContext(priceContextText)) {
    candidate.exclusionReason = 'product-price-ambiguous';
  } else if (!candidate.validFrom || !candidate.validTo) {
    candidate.exclusionReason = 'validity-missing';
  }

  candidates.push(candidate);
}

function hasAnchoredBillaPriceContext(value = '') {
  const text = normalizePdfText(value);
  const normalized = normalizeForScan(text);

  return Boolean(
    /\b(?:ab|bei)\s+\d+\b/i.test(normalized)
    || /\baktion\b/i.test(normalized)
    || /\b1\s+(?:pkg|packung|fl|flasche|dose|stk|stueck|stÃ¼ck)\b.*€\s*\d/i.test(text)
    || /\bstatt\s+\d{1,3}(?:[,.]\d{2})?\b/i.test(text)
  );
}

function normalizeBillaConditionUnit(value = '') {
  const normalized = normalizeForScan(value);

  if (/^(?:pkg|packung|packungen)$/.test(normalized)) return 'Packungen';
  if (/^(?:fl|flasche|flaschen)$/.test(normalized)) return 'Flaschen';
  if (/^(?:dose|dosen)$/.test(normalized)) return 'Dosen';
  if (/^(?:stk|stueck|stuck)$/.test(normalized)) return 'Stueck';

  return sanitizeWhitespace(value);
}

function normalizeBillaConditionFragment(line = '') {
  const raw = sanitizeWhitespace(normalizePdfText(line)).replace(/\s+/g, ' ').trim();
  const normalized = normalizeForScan(raw);

  if (!raw) return '';
  if (/alternative flyerpreise/i.test(raw)) return '';
  if (/^\d{1,4}$/.test(normalized)) return '';
  if (/^\d{1,4}\s+(?:fr|sa|do|mo|di)\b/.test(normalized)) return '';
  if (/^(?:fr|sa|do|mo|di)(?:\s*(?:&|und)?\s*(?:fr|sa|do|mo|di))*\.?$/.test(normalized)) return '';
  if (/^1\s+(?:pkg|packung|fl|flasche|dose|stk|stueck|stuck)\b/.test(normalized)) return '';

  const threshold = normalized.match(/^(ab|bei)\s+(\d+)\s*(pkg|packung|packungen|fl|flasche|flaschen|dose|dosen|stk|stueck|stuck)\.?(?:\s+je)?\b/);
  if (threshold) {
    return `${threshold[1]} ${threshold[2]} ${normalizeBillaConditionUnit(threshold[3])}`;
  }

  const multibuy = normalized.match(/\b(\d+\s*\+\s*\d+)\s+gratis\b/);
  if (multibuy) {
    return `${multibuy[1].replace(/\s+/g, '')} gratis`;
  }

  const percent = normalized.match(/^-?\s*(\d{1,2})\s*%$/);
  if (percent) {
    return `-${percent[1]}%`;
  }

  const statt = raw.match(/^statt\s+(\d{1,3}(?:[,.]\d{2})|\d{3,4})\b/i);
  if (statt) {
    return `statt ${statt[1].replace(',', '.')}`;
  }

  if (/^aktion$/.test(normalized)) return 'Aktion';

  return '';
}

function buildBillaConditionsText(lines = []) {
  const fragments = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = sanitizeWhitespace(normalizePdfText(lines[index]));
    const normalized = normalizeForScan(raw);

    if (/^statt$/.test(normalized)) {
      const next = sanitizeWhitespace(normalizePdfText(lines[index + 1] || ''));
      if (/^\d{1,3}(?:[,.]\d{2})$/.test(next)) {
        fragments.push(`statt ${next.replace(',', '.')}`);
        index += 1;
        continue;
      }
    }

    const fragment = normalizeBillaConditionFragment(raw);
    if (fragment) fragments.push(fragment);
  }

  const seen = new Set();
  return fragments
    .filter((fragment) => {
      const key = normalizeForScan(fragment);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' / ');
}

function extractMinimumPurchaseQtyFromConditions(conditionsText = '') {
  const match = normalizeForScan(conditionsText).match(/\b(?:ab|bei)\s+(\d+)\b/);
  if (!match) return 1;

  const quantity = Number(match[1]);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function buildCandidateFromPair({ productBlock, priceGroup, pageNumber, validity, sourceRetailerFormat }) {
  const title = buildTitleFromBlock(productBlock);
  const quantityText = extractQuantityText(productBlock);
  const rawText = sanitizeWhitespace([...productBlock, ...priceGroup.lines].join(' '));

  if (!hasPlausibleBillaTitle(title)) {
    return {
      id: '',
      page: pageNumber,
      title: '',
      price: null,
      quantityText: '',
      rawText,
      exclusionReason: 'product-unclear',
    };
  }

  return {
    title,
    brand: title.split(/\s+/)[0] || '',
    price: priceGroup.price,
    referencePrice: parseReferencePrice(priceGroup.lines),
    quantityText,
    conditionsText: buildBillaConditionsText(priceGroup.lines.slice(1)),
    rawText,
    validFrom: validity.validFrom,
    validTo: validity.validTo,
    validityText: validity.validityText,
    sourceRetailerFormat,
    comparisonSafe: Boolean(quantityText),
    parserHint: 'billa-pdf-text-layer-product-price-segment',
  };
}

function extractBillaPdfCandidatesFromPage(page, { validity = {}, sourceRetailerFormat = 'billa', now = new Date() } = {}) {
  const lines = String(page.text || '')
    .split(/\r?\n/)
    .map((line) => sanitizeWhitespace(line))
    .filter(Boolean);
  const candidates = [];
  let productBuffer = [];
  let index = 0;

  while (index < lines.length) {
    if (!parseCompressedPrice(lines[index])) {
      productBuffer.push(lines[index]);
      index += 1;
      continue;
    }

    const productBlocks = buildProductBlocks(productBuffer);
    productBuffer = [];
    const priceLines = [];

    while (index < lines.length) {
      const isPriceLine = Boolean(parseCompressedPrice(lines[index]));
      const isContext = !isPriceLine
        && (isPriceContextLine(lines[index]) || isStattDecimalContinuation(priceLines, lines[index]));

      if (!isPriceLine && !isContext) {
        break;
      }

      priceLines.push(lines[index]);
      index += 1;
    }

    let priceGroups = groupPriceLines(priceLines);
    priceGroups = normalizePriceGroupsForProductCount(priceGroups, productBlocks.length, now);

    if (productBlocks.length === 0) {
      addRejectedCandidate(candidates, page.pageNumber, 'product-unclear', priceLines.join(' '));
      continue;
    }

    if (priceGroups.length < productBlocks.length) {
      addRejectedCandidate(candidates, page.pageNumber, 'price-missing', productBlocks.flat().join(' '));
      continue;
    }

    if (priceGroups.length > productBlocks.length) {
      addRejectedCandidate(candidates, page.pageNumber, 'product-price-ambiguous', [...productBlocks.flat(), ...priceLines].join(' '));
      continue;
    }

    for (let pairIndex = 0; pairIndex < productBlocks.length; pairIndex += 1) {
      addCandidate(candidates, page.pageNumber, buildCandidateFromPair({
        productBlock: productBlocks[pairIndex],
        priceGroup: priceGroups[pairIndex],
        pageNumber: page.pageNumber,
        validity,
        sourceRetailerFormat,
      }));
    }
  }

  if (productBuffer.length > 0 && buildProductBlocks(productBuffer).length > 0) {
    addRejectedCandidate(candidates, page.pageNumber, 'price-missing', productBuffer.join(' '));
  }

  return candidates;
}

function extractBillaPdfCandidates({ pages = [], validity = {}, sourceRetailerFormat = 'billa', now = new Date() } = {}) {
  const candidates = [];
  const seen = new Set();

  for (const page of pages) {
    for (const candidate of extractBillaPdfCandidatesFromPage(page, { validity, sourceRetailerFormat, now })) {
      const key = [
        candidate.exclusionReason || '',
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

async function extractBillaPdfReference({ pdfBuffer, sourceUrl = '', sourceRetailerFormat = 'billa', maxPages = DEFAULT_MAX_PAGES } = {}) {
  if (!Buffer.isBuffer(pdfBuffer)) {
    throw new Error('BILLA PDF parser requires a PDF buffer.');
  }

  if (pdfBuffer.length > MAX_PDF_BYTES) {
    throw new Error(`BILLA PDF exceeds max parser size ${MAX_PDF_BYTES}.`);
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

    const fullText = pages.map((page) => page.text).join('\n');
    const validity = parseBillaFlyerValidity(fullText);
    const candidates = extractBillaPdfCandidates({
      pages,
      validity,
      sourceRetailerFormat,
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

function buildKey(value, fallback = '') {
  return normalizeTitleForMatch(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function sourceKeyForRetailer(retailerKey = 'billa') {
  return retailerKey === 'billa-plus'
    ? 'billa-plus-official-flyer-flyer'
    : 'billa-official-flyer-flyer';
}

function normalizeBillaPdfCandidateToOffer({ candidate, pdfReference, source, crawlJobId, region, pdfUrl, pdfSha256 = '' }) {
  if (candidate.exclusionReason || !candidate.title || !(candidate.price > 0)) {
    return null;
  }

  const validity = {
    validFrom: candidate.validFrom || pdfReference.validity?.validFrom || null,
    validTo: candidate.validTo || pdfReference.validity?.validTo || null,
    validityText: candidate.validityText || pdfReference.validity?.validityText || '',
    confidence: pdfReference.validity?.confidence || 0,
  };

  if (!validity.validFrom || !validity.validTo) {
    return null;
  }

  const now = new Date();
  const status = validity.validFrom > now ? 'upcoming' : validity.validTo < now ? 'expired' : 'active';
  if (status !== 'active') {
    return null;
  }

  const parsedUnit = buildNormalizedUnitPrice({
    price: candidate.price,
    quantityText: candidate.quantityText,
  });
  const categoryContext = [candidate.title, candidate.quantityText, candidate.rawText].join(' ');
  const categoryPrimary = determineOfferCategory({
    title: candidate.title,
    contextText: categoryContext,
  });
  const categorySecondary = determineOfferSubcategory({
    primaryCategory: categoryPrimary,
    title: candidate.title,
    contextText: categoryContext,
    fallbackLabel: candidate.productKind || '',
  });
  const sourceKey = sourceKeyForRetailer(source.retailerKey);
  const categoryKey = buildKey(categorySecondary || categoryPrimary, 'unkategorisiert');
  const comparisonSignature = normalizeTitleForMatch([candidate.brand, candidate.title].join(' '))
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join('-');
  const quantityKey = buildKey(candidate.quantityText || '', 'na');
  const conditionsText = sanitizeWhitespace(candidate.conditionsText || '');
  const issues = [];

  if (!parsedUnit.normalizedUnitPrice.comparable) {
    issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
  }

  if (conditionsText) {
    issues.push('Bedingung aus Flyer beachten');
  }

  const offerKey = [
    source.retailerKey,
    sourceKey,
    candidate.page,
    comparisonSignature,
    String(candidate.price),
    quantityKey,
    dateKey(validity.validTo),
  ].join('::');
  const dedupeKey = [
    source.retailerKey,
    sourceKey,
    comparisonSignature,
    String(candidate.price),
    quantityKey,
    dateKey(validity.validTo),
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

  const overrideResult = applyManualCategoryOverridesToOfferSync({
    crawlJobId,
    sourceId: source._id,
    retailerKey: source.retailerKey,
    retailerName: source.retailerName,
    sourceRetailerName: source.retailerName,
    sourceRetailerFormat: source.retailerKey,
    appliesToRetailerFormats: [source.retailerKey],
    retailerFormatLabel: source.retailerName,
    region,
    offerKey,
    dedupeKey,
    title: candidate.title,
    titleNormalized: normalizeTitleForMatch(candidate.title),
    brand: candidate.brand || '',
    searchText: normalizeTitleForMatch([
      source.retailerName,
      candidate.brand,
      candidate.title,
      candidate.quantityText,
      categoryPrimary,
      categorySecondary,
      conditionsText,
    ].join(' ')),
    categoryPrimary,
    categorySecondary,
    categoryKey,
    subcategoryKey: categoryKey,
    categoryConfidence: 0.76,
    subcategoryConfidence: 0.7,
    comparisonSignature,
    comparisonQuantityKey: quantityKey,
    comparisonCategoryKey: categoryKey,
    comparisonGroup: parsedUnit.normalizedUnitPrice.comparable ? `${categoryKey}:${comparisonSignature}:${quantityKey}` : '',
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
    status,
    isActiveNow: true,
    isActiveToday: true,
    benefitType: conditionsText ? 'conditional-price' : 'price-cut',
    effectiveDiscountType: conditionsText ? 'threshold' : 'price-cut',
    conditionsText,
    customerProgramRequired: false,
    hasConditions: Boolean(conditionsText),
    isMultiBuy: /ab\s+\d|bei\s+\d|gratis/i.test(conditionsText),
    minimumPurchaseQty: extractMinimumPurchaseQtyFromConditions(conditionsText),
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
    priceReferenceConfidence: candidate.referencePrice ? 0.78 : 0,
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
      parsingConfidence: parsedUnit.normalizedUnitPrice.comparable ? 0.76 : 0.68,
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

function normalizeBillaPdfCandidatesToOffers({ pdfReference, source, crawlJobId, region, pdfUrl, pdfSha256 = '' }) {
  return (pdfReference.candidates || [])
    .map((candidate) => normalizeBillaPdfCandidateToOffer({
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

module.exports = {
  DEFAULT_MAX_PAGES,
  MAX_PDF_BYTES,
  PARSER_VERSION,
  SOURCE_TYPE,
  extractBillaPdfCandidates,
  extractBillaPdfCandidatesFromPage,
  extractBillaPdfReference,
  normalizeBillaPdfCandidatesToOffers,
  parseBillaFlyerValidity,
  parseCompressedPrice,
  sourceKeyForRetailer,
  summarizeRejections,
};
