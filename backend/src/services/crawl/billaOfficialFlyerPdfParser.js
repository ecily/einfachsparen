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

function buildViennaWallClockDate(year, zeroBasedMonth, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const desiredUtcMs = Date.UTC(year, zeroBasedMonth, day, hour, minute, second, millisecond);
  const guess = new Date(desiredUtcMs);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(guess).map((part) => [part.type, part.value]));
  const observedUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    millisecond
  );

  return new Date(desiredUtcMs + (desiredUtcMs - observedUtcMs));
}

function parseAustrianDate(day, month, year, { endOfDay = false } = {}) {
  const numericYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
  return buildViennaWallClockDate(
    numericYear,
    Number(month) - 1,
    Number(day),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  );
}

function parseBillaFlyerValidity(text = '') {
  const normalized = normalizePdfText(text);
  const range = normalized.match(/von[\s,]*(?:(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)[,\s]+)?(\d{1,2})\.\s*(\d{1,2})\.\s+bis\s+(?:(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)[,\s]+)?(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})/i)
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
  const compactStatt = text.match(/\b\d{2,4}\s*statt\s+(\d{1,3}[,.]\d{2})\b/i);
  if (compactStatt) return money(Number(compactStatt[1].replace(',', '.')));

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
  if (/\bper\s+bund\b/i.test(normalized)) return true;
  if (/\bper\s+st(?:ue|ü|u)ck\b/i.test(normalized)) return true;
  return /\b\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|liter|stk|stueck|stÃ¼ck|stuck)\b/i.test(normalized)
    || /\bper\s+(?:kilo|kg|stueck|stÃ¼ck|stuck)\b/i.test(normalized)
    || /\b\d+\s*(?:waschgaenge|waschg\S*nge|waschgange|wg)\b/i.test(normalized)
    || /\b\d+\s*x\s*\d+\s*blatt\b/i.test(normalized)
    || /\bpackung\b/i.test(normalized);
}

function extractQuantityText(lines = []) {
  const text = normalizePdfText(lines.join(' '));
  const multipack = text.match(/\b\d+\s*x\s*\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|liter)\b/i);
  if (multipack) return normalizePdfText(multipack[0]).replace(',', '.').replace(/\bliter\b/i, 'l');

  const quantity = text.match(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|liter|stk|stueck|stÃ¼ck|stuck)\b/i);
  if (quantity) return normalizePdfText(quantity[0]).replace(',', '.').replace(/\bliter\b/i, 'l').replace(/stueck|stÃ¼ck|stuck/i, 'Stk');

  const washes = text.match(/\b\d+\s*(?:waschgaenge|waschg\S*nge|waschgange|wg)\b/i);
  if (washes) {
    const count = washes[0].match(/\d+/)?.[0] || '';
    if (count) return `${count} WG`;
  }

  const sheets = text.match(/\b\d+\s*x\s*\d+\s*blatt\b/i) || text.match(/\b\d+\s*blatt\b/i);
  if (sheets) return normalizePdfText(sheets[0]).replace(/\s+/g, ' ');

  if (/\bper\s+kilo\b/i.test(text)) return '1 kg';
  if (/\bper\s+bund\b/i.test(text)) return '1 Bund';
  if (/\bper\s+st(?:ue|ü|u)ck\b/i.test(text)) return '1 Stk';
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
        .replace(/\b\d+\s*(?:waschgaenge|waschg\S*nge|waschgange|wg)\b.*$/i, '')
        .replace(/\b\d+\s*x\s*\d+\s*blatt\b.*$/i, '')
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

function hasBillaTitlePriceArtifact(title = '') {
  const text = sanitizeWhitespace(normalizePdfText(title));
  const normalized = normalizeForScan(text);

  return Boolean(
    /\b\d{1,2}[,.]\d{2}\s*\/\s*\d{1,2}[,.]\d{2}\b/.test(text)
    || /\b\d{1,2}[,.]\d{2}\s*\/\s*[A-Z]/i.test(text)
    || /\b(?:nur\s+)?kurze\s+zeit\b/.test(normalized)
    || /^all in one$/.test(normalized)
    || /^inhalt\b/.test(normalized)
    || /\bper\s+(?:flasche|packung|pkg|dose|glas)\s*\(/.test(normalized)
    || /\b\d+\s*kiste\s*=\s*\d+\s*flaschen\b/.test(normalized)
    || /\b\d+\s*\+\s*\d+\b/.test(normalized)
    || /\(\s*$/.test(text)
    || /\begger\s+puntigamer\b/.test(normalized)
  );
}

function hasPlausiblePositionedProduceTitle(title = '') {
  const normalized = normalizeForScan(title);

  return Boolean(
    title
    && title.length >= 6
    && title.length <= 80
    && /[a-z]/.test(normalized)
    && !/^\s*[-\d]/.test(title)
    && !/â‚¬/.test(title)
    && !/^(?:billa|aktion|gratis|statt|packung|per kilo|per stueck|div sorten)$/.test(normalized)
  );
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
  return /statt\b/i.test(normalizePdfText(lines.join(' ')))
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

function hasStrongBillaOfferAnchor(value = '') {
  const text = normalizePdfText(value);
  const normalized = normalizeForScan(text);

  return Boolean(
    /\b(?:ab|bei)\s+\d+\b/i.test(normalized)
    || /\baktion\b/i.test(normalized)
    || /\b1\s+(?:pkg|packung|fl|flasche|dose|stk|stueck|stÃƒÂ¼ck)\b.*â‚¬\s*\d/i.test(text)
  );
}

function hasSuspiciousLowUnitPriceMismatch(candidate = {}) {
  const price = Number(candidate.price);
  const referencePrice = Number(candidate.referencePrice);

  if (!Number.isFinite(price) || price >= 1) return false;
  if (!Number.isFinite(referencePrice) || referencePrice > 1.5) return false;
  if (!/^statt\b/i.test(normalizeForScan(candidate.conditionsText || ''))) return false;

  const anchorText = [candidate.conditionsText, candidate.rawText].filter(Boolean).join(' ');
  if (hasStrongBillaOfferAnchor(anchorText)) return false;

  const quantity = parseQuantity(candidate.quantityText || '');
  return ['kg', 'l'].includes(quantity.comparableUnit)
    && Number(quantity.totalComparableAmount || 0) >= 0.75;
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
  } else if (hasBillaTitlePriceArtifact(candidate.title)) {
    candidate.exclusionReason = 'title-price-artifact';
  } else if (!(candidate.price > 0)) {
    candidate.exclusionReason = 'price-missing';
  } else if (!candidate.quantityText) {
    candidate.exclusionReason = 'quantity-missing';
  } else if (hasSuspiciousLowUnitPriceMismatch(candidate)) {
    candidate.exclusionReason = 'price-quantity-implausible';
  } else if (!hasAnchoredBillaPriceContext(priceContextText) && !/^billa-pdf-(?:inline|positioned)-/.test(candidate.parserHint || '')) {
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

function buildCandidateFromPair({ productBlock, priceGroup, pageNumber, validity, sourceRetailerFormat, allowShortProduceTitle = false }) {
  const title = cleanInlineBillaTitle(buildTitleFromBlock(productBlock));
  const quantityText = extractQuantityText(productBlock);
  const rawText = sanitizeWhitespace([...productBlock, ...priceGroup.lines].join(' '));

  if (!hasPlausibleBillaTitle(title) && !(allowShortProduceTitle && hasPlausiblePositionedProduceTitle(title))) {
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

function compactBillaPriceToMoney(value = '') {
  const digits = String(value || '').replace(/\D/g, '');

  if (!/^\d{2,4}$/.test(digits)) return null;

  return money(`${digits.slice(0, -2) || '0'}.${digits.slice(-2)}`);
}

function extractCompactBillaPriceFromMixedLine(line = '') {
  const text = sanitizeWhitespace(normalizePdfText(line));
  const normalized = normalizeForScan(text);

  if (!text || /--\s*\d+\s+of\s+\d+\s*--/i.test(text)) return null;
  if (/^\d+\s*\+\s*\d+$/.test(normalized)) return null;
  if (/^\d{1,3}[,.]\d{2}$/.test(text)) return null;
  if (/^1\s+(?:pkg|packung|fl|flasche|dose|stk|stueck|stuck|glas)\b/i.test(normalized)) return null;
  if (/^\(?\s*(?:1\s+(?:kg|l|liter|wg|stk|stueck|stuck|glas)|100\s*(?:g|ml))\s+\d{1,3}[,.]\d{2}(?:\s*[-/]\s*\d{1,3}[,.]\d{2})?\s*\)?$/i.test(normalized)) return null;

  const direct = parseCompressedPrice(text);
  if (direct) return direct;

  if (/^-?\d{2,4}$/.test(normalized)) return null;

  const suffix = text.match(/(?:^|[^\d,])(\d{2,4})(?:\s*statt\b)?$/i);
  if (!suffix || /^(?:19|20)\d{2}$/.test(suffix[1])) return null;

  return compactBillaPriceToMoney(suffix[1]);
}

function mergeBillaQuantityContinuationLines(lines = []) {
  const merged = [];

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];

    while (lineHasQuantity(line) && index + 1 < lines.length) {
      const next = lines[index + 1] || '';
      const normalizedNext = normalizePdfText(next);
      const openParens = (line.match(/\(/g) || []).length > (line.match(/\)/g) || []).length;

      if (!/^(?:per\b|\()/i.test(normalizedNext) && !openParens) break;

      line = `${line} ${next}`;
      index += 1;
    }

    merged.push(line);
  }

  return merged;
}

function isSeparatedClusterNoiseLine(line = '') {
  const normalized = normalizeForScan(line);
  const raw = normalizePdfText(line);

  return isNoiseProductLine(line)
    || /\b(?:ausgenommen:\s*billa online shop|nicht mit anderen rabatten|solange der vorrat reicht|unsere statt-preise)\b/i.test(raw)
    || /^auf\b/.test(normalized)
    || /^\d+\s*\+\s*\d+$/.test(normalized)
    || /^1\s+(?:pkg|packung|fl|flasche|dose|stk|stueck|stuck|glas)\b.*\d/.test(normalized)
    || /^-?\s*\d{1,3}$/.test(normalized)
    || /^\d{1,3}[,.]\d{2}$/.test(raw)
    || /^\d{2,4}\s*statt\b/i.test(normalized)
    || Boolean(extractCompactBillaPriceFromMixedLine(line));
}

function buildSeparatedClusterProductBlocks(lines = []) {
  const blocks = [];
  let current = [];

  function flush() {
    const clean = current.filter((line) => !isSeparatedClusterNoiseLine(line));
    current = [];
    if (clean.length === 0) return;

    const title = cleanInlineBillaTitle(buildTitleFromBlock(clean));
    if (clean.some((line) => lineHasQuantity(line)) && hasPlausibleBillaTitle(title)) {
      blocks.push(clean);
    }
  }

  for (const line of lines) {
    if (isSeparatedClusterNoiseLine(line)) {
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

function groupMixedBillaPriceLines(lines = []) {
  const groups = [];

  for (let index = 0; index < lines.length; index += 1) {
    const price = extractCompactBillaPriceFromMixedLine(lines[index]);
    if (!price) continue;

    const group = {
      price,
      lines: [lines[index]],
    };

    for (let next = index + 1; next < lines.length && group.lines.length < 5; next += 1) {
      if (!isPriceContextLine(lines[next]) && !isStattDecimalContinuation(group.lines, lines[next])) break;
      group.lines.push(lines[next]);
    }

    groups.push(group);
  }

  return groups;
}

function isForwardProductContinuationLine(line = '') {
  const raw = sanitizeWhitespace(normalizePdfText(line));
  const normalized = normalizeForScan(raw);

  if (!raw || isBillaRecoveryBoundaryLine(raw) || extractCompactBillaPriceFromMixedLine(raw)) return false;
  return /^\(/.test(raw)
    || /^[a-zÃ¤Ã¶Ã¼ÃŸ]/.test(raw)
    || /,\s*$/.test(raw)
    || lineHasQuantity(raw)
    || /^per\b/.test(normalized);
}

function cleanInlineBillaTitle(value = '') {
  return sanitizeWhitespace(normalizePdfText(value))
    .replace(/\bchry\s*-\s*santhemen\b/gi, 'Chrysanthmen')
    .replace(/-\s+/g, '-')
    .replace(/^.*?\bNicht mit anderen Rabatten und Bons kombinierbar\.\s*/i, '')
    .replace(/^.*?\bAusgenommen:\s*BILLA Online Shop\.\s*/i, '')
    .replace(/^.*?\b\d+\s*\+\s*\d+\s+/i, '')
    .replace(/^\d+\s*\+\s*\d+\s+/i, '')
    .replace(/^.*\b(?:aktion|extrem preis)\b\s*/i, '')
    .replace(/\bper\s+st(?:ue|ü|u)ck\b.*$/i, ' ')
    .replace(/^.*\bper\s+(?:kilo|kg|stueck|stück|stuck)\s+/i, '')
    .replace(/\b(?:aktion|extrem preis|nur kurze zeit|-?\d+\s*%)\b/gi, ' ')
    .replace(/\b\d+\s+stiele\b.*$/i, ' ')
    .replace(/\b(?:kl\.?\s*i|im ganzen|kernarm|in selbstbedienung|div\.?\s*sorten)\b/gi, ' ')
    .replace(/\s*,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\*+$/g, '');
}

function normalizeInlineBillaQuantity(value = '') {
  const normalized = sanitizeWhitespace(normalizePdfText(value)).replace(',', '.');

  if (/per\s+kilo/i.test(normalized)) return '1 kg';
  if (/per\s+(?:stueck|stÃƒÂ¼ck|stuck)/i.test(normalized)) return '1 Stk';

  return normalized.replace(/\bliter\b/i, 'l');
}

function extractInlineBillaConditions(value = '') {
  const text = normalizePdfText(value);
  const parts = [];
  const threshold = text.match(/\b(?:ab|bei)\s+(\d+)\s*(pkg|packung|packungen|fl|flasche|flaschen|dose|dosen|stk|stueck|stuck)\.?\s*(?:je)?\b/i);
  const multibuy = text.match(/\b(\d+\s*\+\s*\d+)\b/);
  const single = text.match(/\b1\s+(pkg|packung|fl|flasche|dose|stk|stueck)\.?\s*â‚¬\s*(\d{1,3}[,.]\d{2})/i);

  if (multibuy) parts.push(`${multibuy[1].replace(/\s+/g, '')} gratis`);
  if (threshold) parts.push(`${threshold[0].toLowerCase().replace(/\s+je\b/i, '').replace(/pkg\.?/i, 'Packungen')}`);
  if (single) parts.push(`1 ${normalizeBillaConditionUnit(single[1])} ${single[2].replace(',', '.')}`);

  return parts.join(' / ');
}

function addInlineBillaCandidate({ candidates, pageNumber, match, validity, sourceRetailerFormat, parserHint }) {
  const title = cleanInlineBillaTitle(match.title);
  const quantityText = normalizeInlineBillaQuantity(match.quantity);
  const price = compactBillaPriceToMoney(match.price);
  const contextText = sanitizeWhitespace(match.context || '');

  if (!hasPlausibleBillaTitle(title) || !quantityText || !(price > 0)) {
    return;
  }

  addCandidate(candidates, pageNumber, {
    title,
    brand: title.split(/\s+/)[0] || '',
    price,
    referencePrice: parseReferencePrice([contextText]),
    quantityText,
    conditionsText: buildBillaConditionsText([contextText]) || extractInlineBillaConditions(contextText),
    rawText: sanitizeWhitespace(`${match.title} ${match.quantity} ${match.price} ${contextText}`),
    validFrom: validity.validFrom,
    validTo: validity.validTo,
    validityText: validity.validityText,
    sourceRetailerFormat,
    comparisonSafe: Boolean(quantityText),
    parserHint,
  });
}

function isBillaRecoveryBoundaryLine(line = '') {
  const normalized = normalizeForScan(line);

  return !normalized
    || /^--\s*\d+\s+of\s+\d+\s*--$/.test(normalized)
    || /^(?:medieninhaber|angebote gueltig|abgabe nur|bitte sammeln|das recycling|solange der vorrat|nur kurze zeit)$/.test(normalized)
    || /^-?\s*\d+\s*%$/.test(normalized)
    || /^(?:aktion|statt)$/.test(normalized)
    || /^(?:ab|bei)\s+\d+\b/.test(normalized)
    || /^1\s+(?:pkg|packung|fl|flasche|dose|stk|stueck)\b/.test(normalized);
}

function collectForwardBillaProductBlock(lines = [], startIndex = 0, maxLines = 8) {
  const block = [];

  for (let index = startIndex; index < lines.length && block.length < maxLines; index += 1) {
    const line = lines[index];

    if (block.length > 0 && (isBillaRecoveryBoundaryLine(line) || parseCompressedPrice(line) || /^\d{3,4}\s*[A-ZÄÖÜa-zäöüß]/.test(line))) {
      break;
    }

    if (!isBillaRecoveryBoundaryLine(line)) {
      block.push(line);
    }

    if (lineHasQuantity(line)) {
      break;
    }
  }

  return block;
}

function collectBackwardBillaProductBlock(lines = [], priceIndex = 0, maxLines = 10) {
  const block = [];

  for (let index = priceIndex - 1; index >= 0 && block.length < maxLines; index -= 1) {
    const line = lines[index];

    if (/^\([^)]{0,120}\)$/.test(line)) {
      continue;
    }

    if (isBillaRecoveryBoundaryLine(line) || parseCompressedPrice(line) || /^\d{3,4}\s*[A-ZÄÖÜa-zäöüß]/.test(line)) {
      break;
    }

    if (lineHasQuantity(line) && block.length > 0) {
      break;
    }

    block.unshift(line);

    if (block.length >= maxLines) break;
  }

  return block;
}

function addRecoveryBillaPdfCandidate({ candidates, pageNumber, productBlock, price, contextLines = [], validity, sourceRetailerFormat, parserHint }) {
  const title = cleanInlineBillaTitle(buildTitleFromBlock(productBlock));
  const quantityText = extractQuantityText(productBlock);
  const conditionsText = buildBillaConditionsText(contextLines);

  if (!hasPlausibleBillaTitle(title) || !quantityText || !(price > 0)) {
    return;
  }

  addCandidate(candidates, pageNumber, {
    title,
    brand: title.split(/\s+/)[0] || '',
    price,
    referencePrice: parseReferencePrice(contextLines),
    quantityText,
    conditionsText,
    rawText: sanitizeWhitespace([...productBlock, String(price), ...contextLines].join(' ')),
    validFrom: validity.validFrom,
    validTo: validity.validTo,
    validityText: validity.validityText,
    sourceRetailerFormat,
    comparisonSafe: Boolean(quantityText),
    parserHint,
  });
}

function extractRecoveryBillaPdfCandidatesFromPage(page, { validity = {}, sourceRetailerFormat = 'billa' } = {}) {
  const lines = String(page.text || '')
    .split(/\r?\n/)
    .map((line) => sanitizeWhitespace(line))
    .filter(Boolean);
  const candidates = [];
  const quantityPriceLinePattern = /^(.+\b\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|liter)\b.*)\s+(\d{3,4})$/i;

  if (!lines.some((line) => /^\d{3,4}(?!\s*(?:g|kg|ml|l|liter)\b)\s*[A-ZÄÖÜa-zäöüß]/.test(line) || quantityPriceLinePattern.test(line))) {
    return candidates;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const prefixed = lines[index].match(/^(\d{3,4})(?!\s*(?:g|kg|ml|l|liter)\b)\s*([A-ZÄÖÜa-zäöüß].+)$/);

    if (prefixed) {
      const productBlock = collectForwardBillaProductBlock([prefixed[2], ...lines.slice(index + 1)], 0);
      addRecoveryBillaPdfCandidate({
        candidates,
        pageNumber: page.pageNumber,
        productBlock,
        price: compactBillaPriceToMoney(prefixed[1]),
        validity,
        sourceRetailerFormat,
        parserHint: 'billa-pdf-inline-prefixed-price-recovery',
      });
      continue;
    }

    const quantityPrice = lines[index].match(quantityPriceLinePattern);
    if (quantityPrice) {
      const productBlock = [
        ...collectBackwardBillaProductBlock(lines, index, 4),
        quantityPrice[1],
      ];
      const contextLines = [];
      for (let next = index + 1; next < lines.length && contextLines.length < 4; next += 1) {
        if (!isPriceContextLine(lines[next])) break;
        contextLines.push(lines[next]);
      }
      addRecoveryBillaPdfCandidate({
        candidates,
        pageNumber: page.pageNumber,
        productBlock,
        price: compactBillaPriceToMoney(quantityPrice[2]),
        contextLines,
        validity,
        sourceRetailerFormat,
        parserHint: 'billa-pdf-inline-quantity-price-line-recovery',
      });
      continue;
    }

    const price = parseCompressedPrice(lines[index]);
    if (!price) continue;

    const productBlock = collectBackwardBillaProductBlock(lines, index);
    const contextLines = [];
    for (let next = index + 1; next < lines.length && contextLines.length < 4; next += 1) {
      if (!isPriceContextLine(lines[next])) break;
      contextLines.push(lines[next]);
    }

    addRecoveryBillaPdfCandidate({
      candidates,
      pageNumber: page.pageNumber,
      productBlock,
      price,
      contextLines,
      validity,
      sourceRetailerFormat,
      parserHint: 'billa-pdf-inline-trailing-price-recovery',
    });
  }

  return candidates;
}

function extractInlineBillaPdfCandidatesFromPage(page, { validity = {}, sourceRetailerFormat = 'billa' } = {}) {
  const rawLines = String(page.text || '')
    .split(/\r?\n/)
    .map((line) => sanitizeWhitespace(line))
    .filter(Boolean);
  const rawText = sanitizeWhitespace(normalizePdfText(String(page.text || '')));

  if (
    !rawLines.some((line) => line.length > 160)
    && !rawLines.some((line) => /\b(?:per\s+kilo|\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|liter))\b[\s\S]{0,140}\b\d{2,4}\b/i.test(line))
  ) {
    return [];
  }

  const text = rawText
    .replace(/[–—]/g, '-');
  const scanTexts = rawLines.some((line) => line.length > 160) ? [text] : rawLines;
  const candidates = [];
  const patterns = [
    {
      hint: 'billa-pdf-inline-per-kilo-price',
      regex: /(?<title>[A-ZÃƒÄÖÜa-zÃ¤Ã¶Ã¼ÃŸ][A-ZÃƒÄÖÜa-zÃ¤Ã¶Ã¼ÃŸ0-9!.'’´`&,\- ]{3,150}?)[, ]+(?<quantity>per\s+kilo)\s+(?<price>\d{1,2}\s?\d{2})\b(?<context>[\s\S]{0,90})/gi,
    },
    {
      hint: 'billa-pdf-inline-quantity-threshold-price',
      regex: /(?<title>[A-ZÃƒÄÖÜa-zÃ¤Ã¶Ã¼ÃŸ][A-ZÃƒÄÖÜa-zÃ¤Ã¶Ã¼ÃŸ0-9!.'’´`&,\- ]{3,150}?)[, ]+(?<quantity>\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|liter))\b(?<context>[\s\S]{0,160}?(?:ab\s+\d+|bei\s+\d+|1\s+pkg|1\s+dose|1\s+flasche|aktion|gratis|statt)[\s\S]{0,80}?)\b(?<price>\d{1,2}\s?\d{2})\b/gi,
    },
    {
      hint: 'billa-pdf-inline-quantity-price-context',
      regex: /(?<title>[A-ZÃƒÄÖÜa-zÃ¤Ã¶Ã¼ÃŸ][A-ZÃƒÄÖÜa-zÃ¤Ã¶Ã¼ÃŸ0-9!.'’´`&,\- ]{3,150}?)[, ]+(?<quantity>\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|liter))\b(?:\s+(?:packung|flasche|dose|tafel))?(?:\s*\([^)]{0,80}\))?\s+(?<price>\d{1,2}\s?\d{2})\b(?<context>[\s\S]{0,110}(?:ab\s+\d+|bei\s+\d+|1\s+pkg|1\s+dose|1\s+flasche|\d+\s*\+\s*\d+|statt|aktion|$))/gi,
    },
    {
      hint: 'billa-pdf-inline-quantity-price',
      regex: /(?<title>[A-ZÃƒÄÖÜa-zÃ¤Ã¶Ã¼ÃŸ][A-ZÃƒÄÖÜa-zÃ¤Ã¶Ã¼ÃŸ0-9!.'’´`&,\- ]{3,150}?)[, ]+(?<quantity>\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|liter))\s+(?<price>\d{1,2}\s?\d{2})\b(?<context>[\s\S]{0,90}?(?:ab\s+\d+|bei\s+\d+|1\s+pkg|1\s+dose|1\s+flasche|statt|aktion|$))/gi,
    },
  ];

  for (const scanText of scanTexts) {
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      for (const match of scanText.matchAll(pattern.regex)) {
        addInlineBillaCandidate({
          candidates,
          pageNumber: page.pageNumber,
          match: match.groups,
          validity,
          sourceRetailerFormat,
          parserHint: pattern.hint,
        });
      }
    }
  }

  return candidates;
}

function extractSeparatedClusterBillaPdfCandidatesFromPage(page, { validity = {}, sourceRetailerFormat = 'billa', now = new Date() } = {}) {
  const lines = mergeBillaQuantityContinuationLines(String(page.text || '')
    .split(/\r?\n/)
    .map((line) => sanitizeWhitespace(line))
    .filter(Boolean));
  const candidates = [];

  const hasDenseUnitMarker = lines.some((line) => /\b(?:waschgaenge|waschg\S*nge|waschgange|wg|blatt)\b/i.test(normalizePdfText(line)));
  const firstPriceIndex = lines.findIndex((line) => Boolean(extractCompactBillaPriceFromMixedLine(line)));
  const lastQuantityIndex = lines.reduce((last, line, index) => (lineHasQuantity(line) ? index : last), -1);

  if (!hasDenseUnitMarker && (firstPriceIndex < 0 || firstPriceIndex <= lastQuantityIndex)) {
    return candidates;
  }

  const productBlocks = buildSeparatedClusterProductBlocks(lines);
  const priceGroups = normalizePriceGroupsForProductCount(groupMixedBillaPriceLines(lines), productBlocks.length, now);

  if (productBlocks.length < 4 || priceGroups.length < productBlocks.length) {
    return candidates;
  }

  for (let index = 0; index < productBlocks.length; index += 1) {
    const candidate = buildCandidateFromPair({
      productBlock: productBlocks[index],
      priceGroup: priceGroups[index],
      pageNumber: page.pageNumber,
      validity,
      sourceRetailerFormat,
    });
    candidate.parserHint = 'billa-pdf-separated-product-price-cluster';
    addCandidate(candidates, page.pageNumber, candidate);
  }

  return candidates;
}

function extractForwardProductPriceBillaPdfCandidatesFromPage(page, { validity = {}, sourceRetailerFormat = 'billa' } = {}) {
  const lines = mergeBillaQuantityContinuationLines(String(page.text || '')
    .split(/\r?\n/)
    .map((line) => sanitizeWhitespace(line))
    .filter(Boolean));
  const candidates = [];

  if (lines.some((line) => /\b(?:waschgaenge|waschg\S*nge|waschgange|wg|blatt)\b/i.test(normalizePdfText(line)))) {
    return candidates;
  }

  const firstPriceIndex = lines.findIndex((line) => Boolean(extractCompactBillaPriceFromMixedLine(line)));
  const lastQuantityIndex = lines.reduce((last, line, index) => (lineHasQuantity(line) ? index : last), -1);
  if (firstPriceIndex > lastQuantityIndex && lastQuantityIndex >= 0 && buildSeparatedClusterProductBlocks(lines).length >= 3) {
    return candidates;
  }

  for (let start = 0; start < lines.length; start += 1) {
    if (isBillaRecoveryBoundaryLine(lines[start]) || extractCompactBillaPriceFromMixedLine(lines[start])) {
      continue;
    }

    const productBlock = [];
    let index = start;
    let foundQuantity = false;
    let priceGroup = null;
    let hasContinuationAfterQuantity = false;

    for (; index < lines.length && productBlock.length < 8; index += 1) {
      const line = lines[index];

      if (productBlock.length > 0 && (isBillaRecoveryBoundaryLine(line) || extractCompactBillaPriceFromMixedLine(line))) {
        break;
      }

      productBlock.push(line);
      if (lineHasQuantity(line)) {
        foundQuantity = true;
        break;
      }
    }

    if (!foundQuantity) continue;

    for (let priceIndex = index; priceIndex < Math.min(lines.length, index + 5); priceIndex += 1) {
      const price = extractCompactBillaPriceFromMixedLine(lines[priceIndex]);
      if (!price) {
        if (priceIndex > index && !isForwardProductContinuationLine(lines[priceIndex])) break;
        if (priceIndex > index) {
          productBlock.push(lines[priceIndex]);
          hasContinuationAfterQuantity = true;
        }
        continue;
      }

      const hasInlineBaseEvidence = productBlock.some((line) => /\(\s*(?:1\s+(?:kg|l|liter)|100\s*(?:g|ml))\b/i.test(normalizePdfText(line)));
      if (priceIndex > index && !hasContinuationAfterQuantity && !hasInlineBaseEvidence) break;

      priceGroup = {
        price,
        lines: [lines[priceIndex]],
      };

      for (let next = priceIndex + 1; next < lines.length && priceGroup.lines.length < 5; next += 1) {
        if (!isPriceContextLine(lines[next]) && !isStattDecimalContinuation(priceGroup.lines, lines[next])) break;
        priceGroup.lines.push(lines[next]);
      }
      break;
    }

    if (!priceGroup) continue;

    const title = cleanInlineBillaTitle(buildTitleFromBlock(productBlock));
    if (!hasPlausibleBillaTitle(title)) continue;

    const candidate = buildCandidateFromPair({
      productBlock,
      priceGroup,
      pageNumber: page.pageNumber,
      validity,
      sourceRetailerFormat,
    });
    candidate.parserHint = 'billa-pdf-inline-forward-product-price';
    addCandidate(candidates, page.pageNumber, candidate);
  }

  return candidates;
}

function isPositionedProduceNoise(value = '') {
  const raw = sanitizeWhitespace(normalizePdfText(value));
  const normalized = normalizeForScan(value);

  return !normalized
    || isBillaRecoveryBoundaryLine(value)
    || isPriceContextLine(value)
    || /\b(?:solange der vorrat|nicht jeder artikel|statt-preise)\b/i.test(raw)
    || /^\d{1,3}(?:[,.]\d{2})?$/.test(raw)
    || /^\d{1,3}(?:[,.]\d{2})?$/.test(normalized)
    || /^-?\d+\s*%$/.test(normalized)
    || /^(?:da komm|ich her|stefan bauer|suess|suss|fruchtig|leicht|saeuerlich|sauerlich|vollreif|taeglich|taglich|geerntet|harmonisch)/.test(normalized);
}

function buildPositionedRows(items = []) {
  return items
    .map((item) => ({
      text: sanitizeWhitespace(normalizePdfText(item.str || item.text || '')),
      x: Number(item.x),
      y: Number(item.y),
      width: Number(item.width || 0),
      height: Number(item.height || 0),
    }))
    .filter((item) => item.text && Number.isFinite(item.x) && Number.isFinite(item.y));
}

function extractPositionedBillaPriceClusters(rows = []) {
  const clusters = [];
  const used = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    const euro = rows[index];
    if (!/^\d{1,2}$/.test(euro.text) || used.has(index)) continue;

    let centsIndex = -1;
    let centsDistance = Infinity;
    for (let next = 0; next < rows.length; next += 1) {
      const cents = rows[next];
      const xDistance = cents.x - euro.x;
      const yDistance = Math.abs(cents.y - euro.y);
      if (!/^\d{2}$/.test(cents.text) || used.has(next) || xDistance < 10 || xDistance > 75 || yDistance > 35) continue;
      const distance = xDistance + yDistance;
      if (distance < centsDistance) {
        centsDistance = distance;
        centsIndex = next;
      }
    }

    if (centsIndex < 0) continue;
    const cents = rows[centsIndex];
    let referencePrice = null;

    for (const reference of rows) {
      const xDistance = reference.x - cents.x;
      const yDistance = Math.abs(reference.y - euro.y);
      if (!/^\d{1,3}[,.]\d{2}$/.test(reference.text) || xDistance < 5 || xDistance > 95 || yDistance > 18) continue;
      referencePrice = money(Number(reference.text.replace(',', '.')));
      break;
    }

    used.add(index);
    used.add(centsIndex);
    clusters.push({
      price: money(`${euro.text}.${cents.text}`),
      referencePrice,
      x: euro.x,
      y: euro.y,
      lines: referencePrice ? [`${euro.text}${cents.text}`, `statt ${referencePrice.toFixed(2)}`] : [`${euro.text}${cents.text}`],
    });
  }

  return clusters.filter((cluster) => cluster.price > 0);
}

function extractPositionedBillaProduceBlocks(rows = []) {
  const blocks = [];
  const anchors = rows
    .filter((row) => lineHasQuantity(row.text))
    .filter((row) => !/^\(\s*(?:1\s+(?:kg|l|liter)|100\s*(?:g|ml))\b/i.test(normalizePdfText(row.text)))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  for (const anchor of anchors) {
    const sameColumnRows = rows
      .filter((row) => {
        if (Math.abs(row.y - anchor.y) > 110) return false;
        if (Math.abs(row.x - anchor.x) > 95) return false;
        if (isPositionedProduceNoise(row.text)) return false;
        return true;
      });

    const titleRows = sameColumnRows.filter((row) => !lineHasQuantity(row.text));
    const quantityRows = sameColumnRows.filter((row) => lineHasQuantity(row.text));
    const titleDirection = titleRows.some((row) => row.y > anchor.y) ? -1 : 1;
    const block = [
      ...titleRows.sort((a, b) => titleDirection * (a.y - b.y) || a.x - b.x),
      ...quantityRows.sort((a, b) => Math.abs(a.y - anchor.y) - Math.abs(b.y - anchor.y)),
    ].map((row) => row.text);
    const title = cleanInlineBillaTitle(buildTitleFromBlock(block));
    if (!block.some((line) => lineHasQuantity(line)) || !hasPlausiblePositionedProduceTitle(title)) continue;

    const key = `${Math.round(anchor.x)}:${Math.round(anchor.y)}:${normalizeForScan(title)}`;
    if (blocks.some((blockItem) => blockItem.key === key)) continue;
    blocks.push({
      key,
      lines: block,
      x: anchor.x,
      y: anchor.y,
    });
  }

  return blocks;
}

function choosePositionedPriceForBlock(block, priceClusters = [], usedPrices = new Set()) {
  let selected = null;
  let selectedScore = Infinity;

  for (let index = 0; index < priceClusters.length; index += 1) {
    if (usedPrices.has(index)) continue;
    const price = priceClusters[index];
    const yDistance = Math.abs(block.y - price.y);
    const xDistance = price.x - block.x;
    const sameBandRight = xDistance > 10 && xDistance < 230 && yDistance <= 55;
    const nearColumnAbove = Math.abs(xDistance) <= 120 && block.y - price.y >= 0 && block.y - price.y <= 140;
    if (!sameBandRight && !nearColumnAbove) continue;

    const score = (sameBandRight ? 0 : 200) + Math.abs(xDistance) + yDistance;
    if (score < selectedScore) {
      selectedScore = score;
      selected = { index, price };
    }
  }

  return selected;
}

function extractPositionedFrontloadedProduceBillaPdfCandidatesFromPage(page, { validity = {}, sourceRetailerFormat = 'billa' } = {}) {
  const rows = buildPositionedRows(page.positionedItems || []);
  const candidates = [];

  if (rows.length < 20) {
    return candidates;
  }

  const priceClusters = extractPositionedBillaPriceClusters(rows);
  const productBlocks = extractPositionedBillaProduceBlocks(rows);
  const usedPrices = new Set();

  if (priceClusters.length < 3 || productBlocks.length < 3) {
    return candidates;
  }

  for (const productBlock of productBlocks) {
    const match = choosePositionedPriceForBlock(productBlock, priceClusters, usedPrices);
    if (!match) continue;
    usedPrices.add(match.index);

    const candidate = buildCandidateFromPair({
      productBlock: productBlock.lines,
      priceGroup: match.price,
      pageNumber: page.pageNumber,
      validity,
      sourceRetailerFormat,
      allowShortProduceTitle: true,
    });
    candidate.parserHint = 'billa-pdf-positioned-frontloaded-produce';
    addCandidate(candidates, page.pageNumber, candidate);
  }

  return candidates;
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

  const inlineCandidates = [
    ...extractInlineBillaPdfCandidatesFromPage(page, { validity, sourceRetailerFormat }),
    ...extractRecoveryBillaPdfCandidatesFromPage(page, { validity, sourceRetailerFormat }),
    ...extractPositionedFrontloadedProduceBillaPdfCandidatesFromPage(page, { validity, sourceRetailerFormat }),
    ...extractSeparatedClusterBillaPdfCandidatesFromPage(page, { validity, sourceRetailerFormat, now }),
    ...extractForwardProductPriceBillaPdfCandidatesFromPage(page, { validity, sourceRetailerFormat }),
  ];
  const seenOfferKeys = new Set(candidates
    .filter((candidate) => !candidate.exclusionReason)
    .map((candidate) => [
      normalizeForScan(candidate.title || ''),
      candidate.price || '',
      normalizeForScan(candidate.quantityText || ''),
    ].join('::')));

  for (const candidate of inlineCandidates) {
    const key = [
      normalizeForScan(candidate.title || ''),
      candidate.price || '',
      normalizeForScan(candidate.quantityText || ''),
    ].join('::');

    if (!seenOfferKeys.has(key)) {
      candidates.push(candidate);
      seenOfferKeys.add(key);
    }
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

function shouldExtractBillaPositionedPages(text = '') {
  const raw = normalizePdfText(text);
  const normalized = normalizeForScan(text);
  return (/\bkl\.?\s*i\b/.test(normalized) || /\bkl\.\s*i\b/i.test(raw)) && /\bda komm\b/.test(normalized);
}

async function extractBillaPositionedPages({ pdfBuffer, maxPages = DEFAULT_MAX_PAGES } = {}) {
  const positionedPages = new Map();

  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer),
      disableWorker: true,
    });
    const document = await loadingTask.promise;
    const pageCount = Math.min(maxPages, document.numPages || maxPages);

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      positionedPages.set(pageNumber, textContent.items
        .map((item) => ({
          str: item.str || '',
          x: Number(item.transform?.[4] || 0),
          y: Number(item.transform?.[5] || 0),
          width: Number(item.width || 0),
          height: Number(item.height || 0),
        }))
        .filter((item) => item.str));
    }

    await document.destroy?.();
  } catch (error) {
    return positionedPages;
  }

  return positionedPages;
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
    if (shouldExtractBillaPositionedPages(fullText)) {
      const positionedPages = await extractBillaPositionedPages({ pdfBuffer, maxPages });
      for (const page of pages) {
        page.positionedItems = positionedPages.get(page.pageNumber) || [];
      }
    }
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

function sourceKeyForRetailer(retailerKey = 'billa', sourceUrl = '') {
  const url = String(sourceUrl || '').toLowerCase();
  if (url.includes('view.publitas.com/billa-at/billa_fb_kw24_2026_steiermark')) return 'billa-official-flyer-steiermark';
  if (url.includes('view.publitas.com/billa-plus/billa_plus_fb_kw24_2026_steiermark')) return 'billa-plus-official-flyer-steiermark';

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
  const sourceKey = sourceKeyForRetailer(source.retailerKey, source.sourceUrl);
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
      region,
      regionLevel: source.crawlPolicy?.regionLevel || '',
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
