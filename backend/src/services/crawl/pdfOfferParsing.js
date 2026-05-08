const { sanitizeWhitespace, normalizeTitleForMatch } = require('./sourceEvidence');

const DEFAULT_BAD_LINE_PATTERNS = [
  /penny\.at|billa\.at|spar\.at|hofer\.at|lidl\.at|dm\.at|bipa\.at/i,
  /impressum|medieninhaber|herausgeber|druck- und satzfehler/i,
  /teilnahmebedingungen|rechtstext|datenschutz/i,
  /solange der vorrat reicht|statt-preise|stattpreise/i,
  /gueltig\s+(von|bis)|gultig\s+(von|bis)|gültig\s+(von|bis)/i,
  /^g.+nstig\.?$/i,
  /^g.+nstig\b/i,
  /^guenstig\.?$/i,
  /^guenstig\b/i,
  /^\d+\s*(?:wg|g|kg|ml|l|cl|stk|stueck|stuck|stück)\b/i,
  /^pack\s+ab\s+\d+\s*(?:stk|stueck|stuck|stück)$/i,
  /^ab\s+\d+\s*(?:stk|stueck|stuck|stück)$/i,
  /^div\.\s*sorten\b/i,
  /^seite\s+\d+$/i,
  /^\d+\s*\/\s*\d+$/,
  /^www\./i,
];

function normalizePdfText(value) {
  return sanitizeWhitespace(String(value || '').replace(/\u00a0/g, ' '));
}

function parsePdfPriceAmount(value, { min = 0.05, max = 999 } = {}) {
  const text = normalizePdfText(value);

  if (!text) {
    return null;
  }

  const candidates = [];
  const euroPattern = /(?:eur|euro|€)\s*(\d{1,3})(?:[,.]\s?|\s+)(\d{2})\b/gi;
  const plainPattern = /\b(\d{1,3})(?:[,.]\s?|\s+)(\d{2})\b/g;
  const wholeEuroPattern = /\b(\d{1,4})\.-(?!\d)/g;

  for (const match of text.matchAll(euroPattern)) {
    candidates.push(`${match[1]}.${match[2]}`);
  }

  for (const match of text.matchAll(plainPattern)) {
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 12);

    if (
      /\d{1,2}\.\d{1,2}\.$/.test(before)
      || /[\d.,]\s*$/.test(before)
      || /=\s*$/.test(before)
      || /^\s*(?:g|kg|ml|l|cl|stk|stueck|stuck|stück|wg|kapsel|kapseln)\b/i.test(after)
      || /^\.\d{2,4}/.test(after)
    ) {
      continue;
    }

    candidates.push(`${match[1]}.${match[2]}`);
  }

  for (const match of text.matchAll(wholeEuroPattern)) {
    candidates.push(String(match[1]));
  }

  for (const candidate of candidates) {
    const amount = Number(candidate);

    if (Number.isFinite(amount) && amount >= min && amount <= max) {
      return amount;
    }
  }

  return null;
}

function hasPdfPriceSignal(value) {
  return parsePdfPriceAmount(value) !== null;
}

function isBadPdfLine(value, extraPatterns = []) {
  const text = normalizePdfText(value);
  const normalized = normalizeTitleForMatch(text);

  if (!text || text.length < 3) {
    return true;
  }

  if (/^[\d\s.,€%+\-=/]+$/.test(text)) {
    return true;
  }

  if (/^[a-z]$/i.test(text)) {
    return true;
  }

  if (/^\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|cl|stk|stueck|stuck|stück|fl|pkg|packung|cm)$/i.test(normalized)) {
    return true;
  }

  return [...DEFAULT_BAD_LINE_PATTERNS, ...extraPatterns].some((pattern) => pattern.test(text) || pattern.test(normalized));
}

function hasPlausibleProductTitle(value) {
  const text = normalizePdfText(value).replace(/\*/g, '');
  const normalized = normalizeTitleForMatch(text);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const letterTokens = tokens.filter((token) => /[a-z]/.test(token));

  if (text.length < 4 || text.length > 140) {
    return false;
  }

  if (hasPdfPriceSignal(text)) {
    return false;
  }

  if (letterTokens.length < 1) {
    return false;
  }

  if (/^(penny|preis|aktion|angebot|gratis|guenstig|gueltig|gultig|seite|nur|statt|pro)$/.test(normalized)) {
    return false;
  }

  if (/^(?:pack\s+)?ab\s+\d+\s*(?:stk|stueck|stuck|stuck)$/.test(normalized)) {
    return false;
  }

  if (/^div\s+sorten\b/.test(normalized)) {
    return false;
  }

  if (/^\d+\s*(?:wg|g|kg|ml|l|cl|stk|stueck|stuck)\b/.test(normalized)) {
    return false;
  }

  if (letterTokens.length === 1 && /^(?:pack|stk|stueck|stuck|wg|gramm|kilogramm|liter)$/.test(letterTokens[0])) {
    return false;
  }

  if (/^\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|cl|stk|stueck|stuck|stück|fl|pkg|packung|cm)$/.test(normalized)) {
    return false;
  }

  if (/^\d+(?:[,.]\d+)?$/.test(normalized)) {
    return false;
  }

  return true;
}

function validatePdfOfferCandidate(candidate = {}) {
  const price = Number(candidate.price);

  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: 'missing-price' };
  }

  if (!hasPlausibleProductTitle(candidate.title)) {
    return { ok: false, reason: 'implausible-title' };
  }

  if (isBadPdfLine(candidate.title)) {
    return { ok: false, reason: 'bad-title-line' };
  }

  const normalizedTitle = normalizeTitleForMatch(candidate.title);

  if (/^(gueltig|gultig|seite|penny|impressum)\b/.test(normalizedTitle)) {
    return { ok: false, reason: 'non-offer-title' };
  }

  return { ok: true, reason: '' };
}

function summarizeRejections(candidates = []) {
  const counts = new Map();

  for (const candidate of candidates) {
    const reason = candidate?.exclusionReason || '';

    if (!reason) {
      continue;
    }

    counts.set(reason, (counts.get(reason) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => ({ reason, count }));
}

function buildPdfSourceMetadata({
  source,
  sourceKey,
  pdfUrl = '',
  page = null,
  parserVersion = '',
  evidence = '',
  flyer = {},
} = {}) {
  return {
    sourceKind: 'pdf',
    sourceKey,
    sourceId: source?._id ? String(source._id) : '',
    retailerKey: source?.retailerKey || '',
    retailerName: source?.retailerName || '',
    pdfUrl,
    flyer: {
      page,
      publicationId: flyer.publicationId || '',
      revisionId: flyer.revisionId || '',
    },
    parserVersion,
    evidence: normalizePdfText(evidence).slice(0, 260),
  };
}

module.exports = {
  normalizePdfText,
  parsePdfPriceAmount,
  hasPdfPriceSignal,
  isBadPdfLine,
  hasPlausibleProductTitle,
  validatePdfOfferCandidate,
  summarizeRejections,
  buildPdfSourceMetadata,
};
