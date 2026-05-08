const { sanitizeWhitespace, normalizeTitleForMatch } = require('./sourceEvidence');
const {
  parsePdfPriceAmount,
  isBadPdfLine,
  hasPlausibleProductTitle,
} = require('./pdfOfferParsing');

function normalizeLayoutLine(value) {
  return sanitizeWhitespace(String(value || '').replace(/\u00a0/g, ' '));
}

function splitTextLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(normalizeLayoutLine)
    .filter(Boolean);
}

function isUnitOrSavingsPriceLine(line) {
  const normalized = normalizeTitleForMatch(line);

  if (/\b(gültig|gueltig|gultig|do|mo|di|mi|fr|sa|so)\b/i.test(line) && /\b\d{1,2}\.\d{1,2}\./.test(line)) {
    return true;
  }

  return /\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|cl|stk|stueck|stuck|stück|wg|rolle|fl|kapsel|kapseln)\s*=/i.test(line)
    || /\b(?:kg|g|l|ml|cl|stk|stueck|stuck|stück|wg|rolle|fl|kapsel|kapseln)\s*\/?\s*\d{1,3}[,.]\d{2}\b/i.test(line)
    || /\b(gespart|vergleich zum einzelverkauf|pfand|einwegpfand)\b/i.test(normalized);
}

function findPriceCandidatesFromLines(lines = []) {
  return lines
    .map((line, lineIndex) => {
      const amount = parsePdfPriceAmount(line);

      if (amount === null || isUnitOrSavingsPriceLine(line)) {
        return null;
      }

      return {
        text: line,
        amount,
        lineIndex,
        bbox: null,
      };
    })
    .filter(Boolean);
}

function isProductishLayoutLine(line) {
  if (!line || isBadPdfLine(line) || parsePdfPriceAmount(line) !== null) {
    return false;
  }

  const normalized = normalizeTitleForMatch(line);

  if (!/[a-z]/.test(normalized)) {
    return false;
  }

  if (/^(aktion|angebot|preis|statt|gratis|gueltig|gultig|seite|nur|ab|bei|je|pro)\b/.test(normalized)) {
    return false;
  }

  return hasPlausibleProductTitle(line);
}

function getNearbyText(lines = [], lineIndex, radius = 4) {
  const start = Math.max(0, Number(lineIndex) - radius);
  const end = Math.min(lines.length, Number(lineIndex) + radius + 1);

  return {
    before: lines.slice(start, lineIndex),
    line: lines[lineIndex] || '',
    after: lines.slice(lineIndex + 1, end),
  };
}

function buildLayoutCandidate({
  retailerKey = '',
  sourceType = '',
  sourceKey = '',
  pageNumber,
  lines = [],
  priceCandidate,
  layoutMode = 'text-flow',
} = {}) {
  const nearbyText = getNearbyText(lines, priceCandidate.lineIndex, 4);
  const nearbyLines = [...nearbyText.before, ...nearbyText.after];
  const productLinesBefore = nearbyText.before.filter(isProductishLayoutLine);
  const productLinesAfter = nearbyText.after.filter(isProductishLayoutLine);
  const productLines = [...productLinesBefore, ...productLinesAfter];
  const rejectionHints = [];
  const confidenceHints = [];

  if (layoutMode === 'text-flow') {
    rejectionHints.push('bbox-unavailable-text-flow-only');
  }

  if (productLines.length === 0) {
    rejectionHints.push('no-nearby-product-text');
  }

  if (productLines.length > 2) {
    rejectionHints.push('multiple-nearby-product-lines');
  }

  if (productLinesBefore.length > 1 && productLinesAfter.length > 0) {
    rejectionHints.push('possible-adjacent-offer-merge');
  }

  if (nearbyLines.some((line) => /\b\d+\s*\+\s*\d+|gratis|ab\s+\d+|bei\s+\d+\b/i.test(normalizeTitleForMatch(line)))) {
    confidenceHints.push('promotion-mechanic-nearby');
  }

  if (productLines.length === 1) {
    confidenceHints.push('single-product-line-near-price');
  }

  if (priceCandidate.amount > 0) {
    confidenceHints.push('plausible-price');
  }

  return {
    retailerKey,
    sourceType,
    sourceKey,
    pageNumber,
    layoutMode,
    bboxAvailable: false,
    priceCandidate,
    nearbyText,
    candidateText: sanitizeWhitespace([...productLines.slice(-3), priceCandidate.text].join(' ')).slice(0, 280),
    confidenceHints,
    rejectionHints,
  };
}

function buildPageLayoutDiagnostics({
  retailerKey = '',
  sourceType = '',
  sourceKey = '',
  pageNumber,
  text = '',
  layoutMode = 'text-flow',
} = {}) {
  const lines = splitTextLines(text);
  const priceCandidates = findPriceCandidatesFromLines(lines);
  const blockCandidates = priceCandidates.map((priceCandidate) => buildLayoutCandidate({
    retailerKey,
    sourceType,
    sourceKey,
    pageNumber,
    lines,
    priceCandidate,
    layoutMode,
  }));

  return {
    pageNumber,
    lineCount: lines.length,
    priceCandidateCount: priceCandidates.length,
    problemCandidateCount: blockCandidates.filter((candidate) => candidate.rejectionHints.length > 1).length,
    priceCandidates,
    blockCandidates,
    problemCandidates: blockCandidates
      .filter((candidate) => candidate.rejectionHints.includes('multiple-nearby-product-lines')
        || candidate.rejectionHints.includes('possible-adjacent-offer-merge'))
      .slice(0, 12),
  };
}

function buildPdfLayoutDiagnosticsFromPages({
  retailerKey = '',
  sourceType = '',
  sourceKey = '',
  pages = [],
  layoutMode = 'text-flow',
} = {}) {
  const pageDiagnostics = pages.map((page) => buildPageLayoutDiagnostics({
    retailerKey,
    sourceType,
    sourceKey,
    pageNumber: page.pageNumber || page.page || 0,
    text: page.text || '',
    layoutMode,
  }));

  return {
    layoutMode,
    bboxAvailable: false,
    pages: pageDiagnostics,
    totals: {
      pages: pageDiagnostics.length,
      priceCandidates: pageDiagnostics.reduce((sum, page) => sum + page.priceCandidateCount, 0),
      blockCandidates: pageDiagnostics.reduce((sum, page) => sum + page.blockCandidates.length, 0),
      problemCandidates: pageDiagnostics.reduce((sum, page) => sum + page.problemCandidateCount, 0),
    },
  };
}

module.exports = {
  normalizeLayoutLine,
  splitTextLines,
  findPriceCandidatesFromLines,
  getNearbyText,
  buildLayoutCandidate,
  buildPageLayoutDiagnostics,
  buildPdfLayoutDiagnosticsFromPages,
};
