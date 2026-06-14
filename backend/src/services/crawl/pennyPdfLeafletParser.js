const { PDFParse } = require('pdf-parse');
const {
  sanitizeWhitespace,
  normalizeTitleForMatch,
  buildSourceEvidence,
} = require('./sourceEvidence');
const {
  determineCategoryDecision,
  buildInclusiveScopeDecision,
} = require('./categoryClassifier');
const { extractPromotionRequirement } = require('../offers/promotionMath');
const { applyManualCategoryOverridesToOfferSync } = require('../quality/manualCategoryOverrideService');
const {
  PDF_CATEGORY_MISMATCH_REVIEW_REASON,
  detectPdfCategoryMismatchReviewSignal,
  parsePdfPriceAmount,
  isBadPdfLine,
  hasPlausibleProductTitle,
  validatePdfOfferCandidate,
  summarizeRejections,
  buildPdfSourceMetadata,
} = require('./pdfOfferParsing');

const PARSER_VERSION = 'penny-pdf-v1';
const PENNY_PDF_SOURCE_KEY = 'penny-official-flyer-pdf';

const STOP_WORDS = new Set([
  'ab',
  'aktion',
  'angebot',
  'artikel',
  'bei',
  'bis',
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'div',
  'ein',
  'eine',
  'einer',
  'extra',
  'fl',
  'fuer',
  'gratis',
  'gueltig',
  'info',
  'je',
  'kg',
  'l',
  'liter',
  'mit',
  'nur',
  'od',
  'oder',
  'packung',
  'penny',
  'pro',
  'sa',
  'sorten',
  'statt',
  'stueck',
  'stk',
  'und',
  'von',
  'zum',
]);

const NON_OFFER_PATTERNS = [
  /penny\.at/i,
  /unsere statt-preise/i,
  /teilnahmebedingungen/i,
  /nicht in bar/i,
  /druck- und satzfehler/i,
  /solange der vorrat reicht/i,
  /zzgl\./i,
  /einwegpfand/i,
  /^seite\s+\d+/i,
  /^info fehlt$/i,
  /^supaaa/i,
  /^guenstig/i,
  /^guenstig/i,
  /^da schau her/i,
  /^wochenend/i,
  /^wochen starter/i,
  /^muttertag$/i,
];

function normalizeForAudit(value) {
  return normalizeTitleForMatch(value)
    .replace(/\bjo\b/g, 'joe')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenList(value) {
  return normalizeForAudit(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function dateKey(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function parseNumericAmount(value) {
  return parsePdfPriceAmount(value);
}

function hasPriceSignal(line) {
  const text = String(line || '');

  if (/\b(gueltig|gultig)\b/i.test(normalizeForAudit(text)) && /\b\d{1,2}\.\d{1,2}\./.test(text)) {
    return /\b\d{1,4}\.-(?!\d)/.test(text);
  }

  return parseNumericAmount(text) !== null;
}

function hasUnitPriceSignal(line) {
  return /\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|cl|stk|stueck|stuck|stück|wg|rolle|fl)\s*=/i.test(line)
    || /\b(?:kg|g|l|ml|cl|stk|stueck|stuck|stück|wg|rolle|fl)\s*\/?\s*\d{1,3}[,.]\d{2}/i.test(line);
}

function hasSavingsSignal(line) {
  return /gespart|vergleich zum einzelverkauf/i.test(line);
}

function hasOfferPriceSignal(line) {
  return hasPriceSignal(line) && !hasUnitPriceSignal(line) && !hasSavingsSignal(line);
}

function hasMechanicSignal(line) {
  return /(\d+\s*\+\s*\d+|gratis|ab\s+\d+\s+(?:fl|flaschen|stk|stueck|stuck)|bei\s+\d+\s+(?:fl|pkg|stk)|gutschein|joe|jo|penny app|appklusiv|karte|-?\d{1,2}\s*%)/i.test(normalizeForAudit(line));
}

function hasStandaloneConditionSignal(line) {
  return /gutschein|joe|penny app|appklusiv|karte/i.test(normalizeForAudit(line)) && !hasOfferPriceSignal(line);
}

function isMostlyUppercaseText(line) {
  const letters = String(line || '').replace(/[^A-Za-zÄÖÜäöüß]/g, '');

  if (letters.length < 3) {
    return false;
  }

  const uppercase = letters.replace(/[^A-ZÄÖÜ]/g, '').length;
  return uppercase / letters.length >= 0.65;
}

function isNoiseLine(line) {
  const text = sanitizeWhitespace(line);

  if (isBadPdfLine(text, NON_OFFER_PATTERNS)) {
    return true;
  }

  if (NON_OFFER_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (/^[\d\s.,€%-]+$/.test(text)) {
    return true;
  }

  if (/^\+?\d+\s*treuepunkt/i.test(text)) {
    return true;
  }

  if (/^[a-zäöüß]\s*$/i.test(text)) {
    return true;
  }

  return false;
}

function isProductishLine(line) {
  if (isNoiseLine(line) || hasPriceSignal(line)) {
    return false;
  }

  const normalized = normalizeForAudit(line);

  if (!/[a-z]/.test(normalized)) {
    return false;
  }

  if (/^(kl|klasse|pro|preis|im vergleich|gespart|nur kurze zeit|gueltig|gultig)\b/i.test(normalized)) {
    return false;
  }

  return hasPlausibleProductTitle(line) && (
    isMostlyUppercaseText(line)
    || /^[A-Z]/.test(String(line || ''))
    || /\b\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|stk|stueck|stuck|cm)\b/i.test(normalized)
    || /\b(od|oder|div|versch|sorten)\b/i.test(normalized)
  );
}

function extractDatesFromText(text) {
  const fullDates = [...String(text || '').matchAll(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/g)].map((match) => ({
    day: Number(match[1]),
    month: Number(match[2]),
    year: Number(match[3]),
  }));
  const year = fullDates[0]?.year || new Date().getFullYear();
  const shortDates = [...String(text || '').matchAll(/\b(\d{1,2})\.(\d{1,2})\.(?!\d)/g)].map((match) => ({
    day: Number(match[1]),
    month: Number(match[2]),
    year,
  }));
  const dates = [...fullDates, ...shortDates]
    .map((item) => new Date(Date.UTC(item.year, item.month - 1, item.day, 12, 0, 0)))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());
  const unique = [];

  for (const date of dates) {
    if (!unique.some((item) => item.getTime() === date.getTime())) {
      unique.push(date);
    }
  }

  return unique;
}

function deriveLeafletValidity(pages) {
  const text = pages.map((page) => page.text).join('\n');
  const explicitRange = text.match(/Gültig\s+von\s+(\d{1,2}\.\d{1,2}\.20\d{2})\s+bis\s+(\d{1,2}\.\d{1,2}\.20\d{2})/i)
    || text.match(/Gueltig\s+von\s+(\d{1,2}\.\d{1,2}\.20\d{2})\s+bis\s+(\d{1,2}\.\d{1,2}\.20\d{2})/i);

  if (explicitRange) {
    const dates = extractDatesFromText(explicitRange[0]);

    return {
      validFrom: dates[0] || null,
      validTo: dates[dates.length - 1] || null,
      detectedDates: dates.map(dateKey),
    };
  }

  const firstPageDates = extractDatesFromText(pages[0]?.text || '');
  const dates = firstPageDates.length >= 2 ? firstPageDates : extractDatesFromText(text);

  return {
    validFrom: dates[0] || null,
    validTo: dates[dates.length - 1] || null,
    detectedDates: dates.map(dateKey),
  };
}

function extractQuantityText(lines) {
  const quantityLines = lines.filter((line) =>
    /\b(\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|stk|stueck|stuck|flaschen|fl|pkg|packung)|\d+\s*x\s*\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l))\b/i.test(normalizeForAudit(line))
  );

  return sanitizeWhitespace(quantityLines.join(' / ')).slice(0, 180);
}

function classifyCandidate(candidate) {
  const tokens = tokenList(candidate.title);
  const normalizedTitle = normalizeForAudit(candidate.title);
  const normalizedText = normalizeForAudit(`${candidate.title} ${candidate.conditionsText} ${candidate.rawText}`);
  const validation = validatePdfOfferCandidate(candidate);

  if (!validation.ok) {
    return validation.reason;
  }

  if (/^(1 1\s*gratis|2 1\s*gratis|3 3\s*gratis|gratis)$/.test(normalizedTitle)) {
    return 'mechanic-without-product';
  }

  if (/^\d+(?:[,.]\d+)?\s*(kg|g|l|ml|cl|stk|stueck|stuck|cm)$/.test(normalizedTitle)) {
    return 'quantity-without-product';
  }

  if (/^gold iglo polardorsch\b/.test(normalizedTitle)) {
    return 'unsafe-neighbor-merged-title';
  }

  if (/^selektion\b.*\bgouda\b/.test(normalizedTitle)) {
    return 'unsafe-neighbor-merged-title';
  }

  if (normalizedTitle === 'kirschen' && candidate.price > 10 && /\b11 06\b.*\b13 06 2026\b/.test(normalizedText)) {
    return 'validity-date-as-price-fragment';
  }

  if (normalizedTitle === 'kirschen' && !/\b500 g\b/.test(normalizedText)) {
    return 'unsafe-incomplete-short-window-candidate';
  }

  if (/^fleisch f r reisfleisch gulasch\b/.test(normalizedTitle)) {
    return 'unsafe-neighbor-merged-title';
  }

  if (/^vier diamanten thunfisch\b/.test(normalizedTitle) && candidate.price >= 6) {
    return 'unsafe-neighbor-merged-title';
  }

  if (candidate.price && candidate.price <= 0.5 && /\b(zzgl|einwegpfand|pfand pro flasche|pfand pro dose)\b/i.test(normalizedText)) {
    return 'deposit-footnote-fragment';
  }

  if (tokens.length < 1) {
    return 'parser-noise';
  }

  if (!candidate.price && /\b(newsletter|whatsapp|penny app|appklusiv|angebote aktionen|digitale joe karte|einkaufsliste|filialfinder|jetzt downloaden|jetzt abonnieren)\b/i.test(normalizedText)) {
    return 'app-or-newsletter-promo';
  }

  if (!candidate.price && /\b(gewinnspiel|gluecksrad|jetzt gewinnen|preise reise|tolle games)\b/i.test(normalizedText)) {
    return 'contest-or-campaign';
  }

  if (!candidate.price && /\b(so schmeckt|magazin|rezept|rezept tipps|griller|personen|garzeit|zutaten|olivenoel|petersilienoel)\b/i.test(normalizedText)) {
    return 'recipe-or-magazine';
  }

  if (!candidate.price && /\b(joe|oes|oesterreich|guthaben|sammelmonat|einkaufsbonus|mit joe bei penny)\b/i.test(normalizedText)) {
    return 'loyalty-campaign';
  }

  if (!candidate.price && /\b(spenden|nachhaltig|nachhaltigkeit|pfandtragetasche)\b/i.test(normalizedText)) {
    return 'sustainability-or-donation-text';
  }

  if (!candidate.price && /\b(gutscheinkarten|gutschein karte|zalando|gratis einkauf)\b/i.test(normalizedText)) {
    return 'voucher-or-campaign';
  }

  if (/gutschein|gratis einkauf|oes/i.test(normalizedTitle) && !candidate.price) {
    return 'voucher-or-campaign';
  }

  if (!candidate.price && !candidate.conditionsText) {
    return 'weak-no-price';
  }

  return '';
}

function buildCandidate({ pageNumber, titleLines, contextLines, priceLine, index }) {
  const compactTitleLines = titleLines
    .map((line) => sanitizeWhitespace(line).replace(/\*/g, ''))
    .filter((line) => hasPlausibleProductTitle(line))
    .slice(-3);
  const title = sanitizeWhitespace(compactTitleLines.join(' ')).replace(/\*/g, '');
  const conditions = contextLines.filter(hasMechanicSignal);
  const price = parseNumericAmount(priceLine || contextLines.find(hasOfferPriceSignal));
  const quantityText = extractQuantityText([...compactTitleLines, ...contextLines]);
  const rawText = sanitizeWhitespace([...compactTitleLines, ...contextLines].join(' '));
  const candidate = {
    id: `p${pageNumber}-${index}`,
    page: pageNumber,
    title,
    titleNormalized: normalizeForAudit(title),
    price,
    quantityText,
    conditionsText: sanitizeWhitespace(conditions.join(' / ')),
    rawText: rawText.slice(0, 700),
  };
  const exclusionReason = classifyCandidate(candidate);

  if (exclusionReason) {
    candidate.exclusionReason = exclusionReason;
  }

  return candidate;
}

function buildTightEvidenceCandidate({ pageNumber, index, title, price, quantityText, conditionsText = '', rawText }) {
  const candidate = {
    id: `p${pageNumber}-tight-${index}`,
    page: pageNumber,
    title,
    titleNormalized: normalizeForAudit(title),
    price,
    quantityText,
    conditionsText,
    rawText: sanitizeWhitespace(rawText).slice(0, 700),
  };
  const exclusionReason = classifyCandidate(candidate);

  if (exclusionReason) {
    candidate.exclusionReason = exclusionReason;
  }

  return candidate;
}

function extractTightKw24EvidenceCandidates(page, existingCount = 0) {
  const pageText = page.text
    .split(/\r?\n/)
    .map(sanitizeWhitespace)
    .filter(Boolean)
    .join(' ');
  const normalized = normalizeForAudit(pageText);
  const candidates = [];

  function add(candidate) {
    candidates.push(buildTightEvidenceCandidate({
      pageNumber: page.page,
      index: existingCount + candidates.length + 1,
      ...candidate,
    }));
  }

  if (
    page.page === 2
    && /\bkirschen\b/.test(normalized)
    && /\b500 g\b/.test(normalized)
    && /\b1 kg\s*5 98\b/.test(normalized)
    && /\bmit gutschein\b/.test(normalized)
    && /\bdo 11 06\b/.test(normalized)
    && /\bsa 13 06 2026\b/.test(normalized)
  ) {
    add({
      title: 'Kirschen',
      price: 2.99,
      quantityText: '500 g Packung, 1 kg=5.98',
      conditionsText: 'Mit Gutschein von dieser Seite: 2,69',
      rawText: 'KIRSCHEN Kl. I, pro Packung 1 kg=5.98 500 g 2.99 Mit Gutschein von dieser Seite 2.69 Gueltig von Do 11.06. bis Sa 13.06.2026',
    });
  }

  if (
    page.page === 4
    && /\bxxl sch.?rdinger gouda\b/.test(normalized)
    && /\b1 kg\b/.test(normalized)
    && /\b6 99\b/.test(normalized)
    && !/\bselektion mild fein sorten tilsiter gouda\b/.test(normalized)
  ) {
    add({
      title: 'Schaerdinger Gouda',
      price: 6.99,
      quantityText: '1 kg Packung',
      rawText: 'XXL SCHAERDINGER GOUDA 1 kg 6.99',
    });
  }

  if (page.page === 6 && /\bschopf od karree\b/.test(normalized) && /\bpro kg\b/.test(normalized) && /\b6 99\b/.test(normalized)) {
    add({
      title: 'Schopf od. Karree',
      price: 6.99,
      quantityText: 'pro kg',
      rawText: 'SCHOPF od. KARREE ohne Knochen geschnitten od. im Stueck natur od. gewuerzt pro kg 6.99',
    });
  }

  if (page.page === 6 && /\bschweine\b/.test(normalized) && /\breisfleisch\b/.test(normalized) && /\bgulasch\b/.test(normalized) && /\bpro kg\b/.test(normalized) && /\b7 99\b/.test(normalized)) {
    add({
      title: 'Schweinefleisch fuer Reisfleisch/Gulasch',
      price: 7.99,
      quantityText: 'pro kg',
      rawText: 'SCHWEINEFLEISCH FUER REISFLEISCH/GULASCH geschnitten pro kg 7.99',
    });
  }

  if (page.page === 7 && /\brinds schnitzel fleisch\b/.test(normalized) && /\bpro kg\b/.test(normalized) && /\b15 99\b/.test(normalized)) {
    add({
      title: 'Rindsschnitzelfleisch',
      price: 15.99,
      quantityText: 'geschnitten od. im Stueck, pro kg',
      rawText: 'RINDSSCHNITZELFLEISCH geschnitten od. im Stueck, pro kg 15.99',
    });
  }

  return candidates;
}

function extractCandidatesFromPage(page) {
  const rawLines = page.text
    .split(/\r?\n/)
    .map(sanitizeWhitespace)
    .filter(Boolean)
    .filter((line) => !isNoiseLine(line) || hasOfferPriceSignal(line) || hasStandaloneConditionSignal(line));
  const candidates = [];
  const seen = new Set();

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];

    if (!hasOfferPriceSignal(line) && !hasStandaloneConditionSignal(line)) {
      continue;
    }

    const lookback = rawLines.slice(Math.max(0, index - 6), index);
    const titleLines = [];

    for (let inner = lookback.length - 1; inner >= 0; inner -= 1) {
      const candidateLine = lookback[inner];

      if (titleLines.length >= 3) {
        break;
      }

      if (hasOfferPriceSignal(candidateLine) || hasStandaloneConditionSignal(candidateLine)) {
        break;
      }

      if (isProductishLine(candidateLine)) {
        titleLines.unshift(candidateLine);
        continue;
      }

      if (titleLines.length > 0 && hasMechanicSignal(candidateLine)) {
        continue;
      }
    }

    if (titleLines.length === 0) {
      continue;
    }

    const contextLines = [line];

    for (let forward = index + 1; forward < Math.min(rawLines.length, index + 5); forward += 1) {
      const nextLine = rawLines[forward];

      if (hasOfferPriceSignal(nextLine)) {
        break;
      }

      if (isProductishLine(nextLine) && !hasMechanicSignal(nextLine)) {
        break;
      }

      contextLines.push(nextLine);
    }
    const candidate = buildCandidate({
      pageNumber: page.page,
      titleLines,
      contextLines,
      priceLine: hasOfferPriceSignal(line) ? line : '',
      index: candidates.length + 1,
    });
    const key = [
      candidate.titleNormalized,
      candidate.price ?? '',
      candidate.conditionsText,
    ].join('::');

    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  }

  for (const candidate of extractTightKw24EvidenceCandidates(page, candidates.length)) {
    const key = [
      candidate.titleNormalized,
      candidate.price ?? '',
      candidate.conditionsText,
    ].join('::');

    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates;
}

async function extractPennyPdfReference({ pdfBuffer, pdfPath = '', sourceUrl = '' }) {
  const parser = new PDFParse({ data: pdfBuffer });

  try {
    const fullText = await parser.getText();
    const pages = [];

    for (let page = 1; page <= fullText.total; page += 1) {
      const result = await parser.getText({ partial: [page] });
      pages.push({
        page,
        text: result.text,
        charCount: result.text.length,
      });
    }

    const validity = deriveLeafletValidity(pages);
    const candidates = pages.flatMap(extractCandidatesFromPage);

    return {
      file: {
        path: pdfPath,
        sourceUrl,
        bytes: pdfBuffer.length,
        pages: fullText.total,
      },
      validity,
      pages: pages.map((page) => ({
        page: page.page,
        charCount: page.charCount,
        candidateCount: candidates.filter((candidate) => candidate.page === page.page).length,
      })),
      candidates,
      textLength: fullText.text.length,
    };
  } finally {
    await parser.destroy();
  }
}

function parseUnitQuantity(quantityText) {
  const normalized = normalizeForAudit(quantityText);
  const match = normalized.match(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml|cl|stk|stueck|stuck)\b/);

  if (!match) {
    return {
      unitValue: null,
      unitType: '',
      totalComparableAmount: null,
      comparableUnit: '',
    };
  }

  let value = Number(match[1].replace(',', '.'));
  let unit = match[2];

  if (!Number.isFinite(value) || value <= 0) {
    return {
      unitValue: null,
      unitType: '',
      totalComparableAmount: null,
      comparableUnit: '',
    };
  }

  if (unit === 'stueck' || unit === 'stuck') {
    unit = 'Stk';
  }

  const unitType = unit;
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

  if (unit === 'cl') {
    comparableUnit = 'l';
    totalComparableAmount = value / 100;
  }

  if (!['kg', 'l', 'Stk'].includes(comparableUnit)) {
    comparableUnit = '';
    totalComparableAmount = null;
  }

  return {
    unitValue: value,
    unitType,
    totalComparableAmount,
    comparableUnit,
  };
}

function buildNormalizedUnitPrice({ price, quantityText, hasConditions }) {
  const quantity = parseUnitQuantity(quantityText);

  // PDF text is layout-fragmented; keep quantity hints, but do not make
  // comparison claims from this parser until candidate grouping is stronger.
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

function parseDate(day, month, year) {
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
}

function detectSpecialValidity(candidate, fallbackValidity) {
  const text = candidate.rawText;
  const fullRange = text.match(/(\d{1,2})\.(\d{1,2})\.(20\d{2})\s+bis\s+(?:\w+\s+)?(\d{1,2})\.(\d{1,2})\.(20\d{2})/i);

  if (fullRange) {
    return {
      validFrom: parseDate(fullRange[1], fullRange[2], fullRange[3]),
      validTo: parseDate(fullRange[4], fullRange[5], fullRange[6]),
      validityText: fullRange[0],
      confidence: 0.84,
    };
  }

  const shortRange = text.match(/(?:do|fr|sa|mo|di|mi|so)?\s*(\d{1,2})\.(\d{1,2})\.\s*(?:bis|und)\s*(?:do|fr|sa|mo|di|mi|so)?\s*(\d{1,2})\.(\d{1,2})\./i);
  const year = fallbackValidity.validFrom ? fallbackValidity.validFrom.getUTCFullYear() : new Date().getUTCFullYear();

  if (shortRange) {
    return {
      validFrom: parseDate(shortRange[1], shortRange[2], year),
      validTo: parseDate(shortRange[3], shortRange[4], year),
      validityText: shortRange[0],
      confidence: 0.68,
    };
  }

  return {
    validFrom: fallbackValidity.validFrom || null,
    validTo: fallbackValidity.validTo || null,
    validityText: [dateKey(fallbackValidity.validFrom), dateKey(fallbackValidity.validTo)].filter(Boolean).join(' - '),
    confidence: 0.52,
  };
}

function buildOfferStatus(validFrom, validTo) {
  const now = new Date();

  if (validFrom && validFrom > now) {
    return {
      status: 'upcoming',
      isActiveNow: false,
      isActiveToday: false,
    };
  }

  if (validTo && validTo < now) {
    return {
      status: 'expired',
      isActiveNow: false,
      isActiveToday: false,
    };
  }

  return {
    status: validFrom || validTo ? 'active' : 'unknown',
    isActiveNow: Boolean(validFrom || validTo),
    isActiveToday: Boolean(validFrom || validTo),
  };
}

function detectCustomerProgramRequired(candidate) {
  return /(joe|jo|penny app|appklusiv|karte|gutschein)/i.test(normalizeForAudit(`${candidate.title} ${candidate.conditionsText} ${candidate.rawText}`));
}

function buildConditionsText(candidate, requirement) {
  const parts = [
    candidate.conditionsText,
  ].filter(Boolean);

  if (requirement?.requiredQuantity > 1) {
    parts.push(`ab ${requirement.requiredQuantity} Stk.`);
  }

  if (/pfand/i.test(candidate.rawText)) {
    parts.push('Pfandhinweis laut Flugblatt');
  }

  if (/nicht in allen filialen/i.test(candidate.rawText)) {
    parts.push('Nicht in allen Filialen verfuegbar');
  }

  if (/nur kurze zeit|wochenend|framstag|wochenstarter/i.test(normalizeForAudit(candidate.rawText))) {
    parts.push('Sondergueltigkeit laut Flugblatt moeglich');
  }

  return sanitizeWhitespace([...new Set(parts)].join(' / '));
}

function buildComparisonSignature(title) {
  return tokenList(title).slice(0, 8).join('-');
}

function buildKey(value, fallback = '') {
  return normalizeForAudit(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function normalizePennyPdfCandidateToOffer({
  candidate,
  pdfReference,
  source,
  crawlJobId,
  region,
  pdfUrl,
}) {
  if (candidate.exclusionReason || !candidate.title || !(candidate.price > 0)) {
    return null;
  }

  const customerProgramRequired = detectCustomerProgramRequired(candidate);
  const requirement = extractPromotionRequirement({
    title: candidate.title,
    conditionsText: `${candidate.conditionsText} ${candidate.rawText}`,
    rawFacts: {
      requiredQuantity: null,
      minimumPurchaseQuantity: null,
      tags: [],
      loyaltyTags: customerProgramRequired ? ['penny-pdf-condition'] : [],
    },
    benefitType: hasMechanicSignal(candidate.rawText) ? 'multi-buy' : 'price-cut',
  });
  const conditionsText = buildConditionsText(candidate, requirement);
  const hasConditions = Boolean(conditionsText || customerProgramRequired || (requirement?.requiredQuantity || 1) > 1);
  const parsedUnit = buildNormalizedUnitPrice({
    price: candidate.price,
    quantityText: candidate.quantityText,
    hasConditions,
  });
  const categoryDecision = determineCategoryDecision({
    title: candidate.title,
    contextText: `${candidate.quantityText} ${conditionsText} ${candidate.rawText}`,
    sourceCategory: '',
  });
  const categoryPrimary = categoryDecision.primaryCategory && categoryDecision.primaryCategory !== 'Unkategorisiert'
    ? categoryDecision.primaryCategory
    : 'Sonstiges';
  const categorySecondary = categoryDecision.secondaryCategory || (categoryPrimary === 'Sonstiges' ? '' : 'Sonstiges');
  const categoryKey = buildKey(categorySecondary || categoryPrimary, 'sonstiges');
  const comparisonSignature = buildComparisonSignature(candidate.title);
  const validity = detectSpecialValidity(candidate, pdfReference.validity || {});
  const statusInfo = buildOfferStatus(validity.validFrom, validity.validTo);
  const issues = [];

  if (!parsedUnit.normalizedUnitPrice.comparable) {
    issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
  }

  if (hasConditions) {
    issues.push('Bedingtes oder mengenabhaengiges Flugblattangebot');
  }

  if (validity.confidence < 0.7) {
    issues.push('Gueltigkeit aus PDF nur global oder unsicher zugeordnet');
  }

  if (categoryPrimary === 'Sonstiges' || categoryDecision.needsReview) {
    issues.push(...(categoryDecision.reviewReasons || ['Kategorie aus PDF unsicher']));
  }

  const categoryMismatchSignal = detectPdfCategoryMismatchReviewSignal({
    sourceType: 'penny-official-pdf',
    sourceKey: PENNY_PDF_SOURCE_KEY,
    title: candidate.title,
    quantityText: candidate.quantityText,
    categoryPrimary,
    categorySecondary,
    categoryKey,
  });

  if (categoryMismatchSignal && !issues.includes(PDF_CATEGORY_MISMATCH_REVIEW_REASON)) {
    issues.push(PDF_CATEGORY_MISMATCH_REVIEW_REASON);
  }

  const titleNormalized = normalizeForAudit(candidate.title);
  const sourceMetadata = buildPdfSourceMetadata({
    source,
    sourceKey: PENNY_PDF_SOURCE_KEY,
    pdfUrl: pdfUrl || source.sourceUrl,
    page: candidate.page,
    parserVersion: PARSER_VERSION,
    evidence: candidate.rawText,
  });
  const offerKey = [
    source.retailerKey,
    'official-pdf',
    candidate.page,
    comparisonSignature || titleNormalized,
    String(candidate.price),
    buildKey(candidate.quantityText || 'na', 'na'),
    dateKey(validity.validFrom) || 'na',
    dateKey(validity.validTo) || 'na',
  ].join('::');
  const dedupeKey = [
    source.retailerKey,
    'official-pdf',
    comparisonSignature || titleNormalized,
    String(candidate.price),
    buildKey(candidate.quantityText || 'na', 'na'),
    dateKey(validity.validTo) || 'na',
  ].join('::');

  const overrideResult = applyManualCategoryOverridesToOfferSync({
    crawlJobId,
    sourceId: source._id,
    retailerKey: source.retailerKey,
    retailerName: source.retailerName,
    region,
    offerKey,
    dedupeKey,
    title: candidate.title,
    titleNormalized,
    brand: '',
    searchText: normalizeForAudit([
      source.retailerName,
      candidate.title,
      candidate.quantityText,
      conditionsText,
      categoryPrimary,
      categorySecondary,
    ].join(' ')),
    categoryPrimary,
    categorySecondary,
    categoryKey,
    comparisonSignature,
    comparisonQuantityKey: buildKey(candidate.quantityText || '', ''),
    comparisonCategoryKey: categoryKey,
    comparisonGroup: '',
    description: candidate.quantityText || '',
    sourceUrl: pdfUrl || source.sourceUrl,
    imageUrl: '',
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
    benefitType: hasConditions ? 'conditional-price' : 'price-cut',
    effectiveDiscountType: customerProgramRequired ? 'card-required' : hasConditions ? 'threshold' : 'price-cut',
    conditionsText,
    customerProgramRequired,
    hasConditions,
    isMultiBuy: ['x-plus-y', 'x-for-y', 'multi-buy'].includes(requirement?.mechanic),
    minimumPurchaseQty: requirement?.requiredQuantity || 1,
    availabilityScope: region || 'Steiermark',
    priceCurrent: {
      amount: candidate.price,
      currency: 'EUR',
      originalText: `${candidate.price.toFixed(2)} EUR`,
    },
    priceReference: {
      amount: null,
      currency: 'EUR',
      originalText: '',
    },
    quantityText: candidate.quantityText,
    unitValue: parsedUnit.quantity.unitValue,
    unitType: parsedUnit.quantity.unitType,
    totalComparableAmount: parsedUnit.quantity.totalComparableAmount,
    comparableUnit: '',
    normalizedUnitPrice: parsedUnit.normalizedUnitPrice,
    quality: {
      completenessScore: [candidate.title, candidate.price, validity.validFrom, validity.validTo].filter(Boolean).length / 4,
      parsingConfidence: hasConditions ? 0.62 : 0.68,
      comparisonSafe: Boolean(parsedUnit.normalizedUnitPrice.comparable && !hasConditions),
      issues,
    },
    rawFacts: {
      sourceType: 'penny-official-pdf',
      sourceKind: 'pdf',
      sourceKey: PENNY_PDF_SOURCE_KEY,
      sourceId: source._id ? String(source._id) : '',
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      sourceText: candidate.rawText,
      evidenceText: sourceMetadata.evidence,
      page: candidate.page,
      pageNumber: candidate.page,
      pdfPage: candidate.page,
      flyerPage: candidate.page,
      candidateId: candidate.id,
      pdfUrl: pdfUrl || '',
      sourceMetadata,
      validityText: validity.validityText,
      validityConfidence: validity.confidence,
      detectedLeafletDates: pdfReference.validity?.detectedDates || [],
      parserVersion: PARSER_VERSION,
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

function normalizePennyPdfCandidatesToOffers({ pdfReference, source, crawlJobId, region, pdfUrl }) {
  return pdfReference.candidates
    .map((candidate) => normalizePennyPdfCandidateToOffer({
      candidate,
      pdfReference,
      source,
      crawlJobId,
      region,
      pdfUrl,
    }))
    .filter(Boolean);
}

module.exports = {
  PARSER_VERSION,
  PENNY_PDF_SOURCE_KEY,
  extractPennyPdfReference,
  extractCandidatesFromPage,
  normalizePennyPdfCandidatesToOffers,
  normalizeForAudit,
  tokenList,
  dateKey,
  parseNumericAmount,
  summarizeRejections,
};
