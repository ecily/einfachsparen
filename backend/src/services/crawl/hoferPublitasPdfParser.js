const { PDFParse } = require('pdf-parse');
const { extractCandidatesFromPage, parseNumericAmount } = require('./pennyPdfLeafletParser');
const { sanitizeWhitespace, normalizeTitleForMatch, buildSourceEvidence } = require('./sourceEvidence');

const PARSER_VERSION = 'hofer-publitas-pdf-v1';
const SOURCE_TYPE = 'hofer-official-publitas-pdf';
const SOURCE_KEY = 'hofer-official-publitas-pdf';
const NON_PRODUCT_TITLE = /newsletter|fix tarif|sparen bis zu|brutto|mitarbeiter|sortimentsartikel|gewinnspiel|karriere|bewerbung|gutschein|service|rezept|magazin/i;

function parseDate(text) {
  const match = String(text || '').match(/(?:ab\s+)?(?:\w+\.?\s+)?(\d{1,2})\.(\d{1,2})\.?\s*(?:bis|[-–])\s*(?:\w+\.?\s+)?(\d{1,2})\.(\d{1,2})\.?/i);
  if (!match) return { validFrom: null, validTo: null, validityText: '' };
  const year = new Date().getUTCFullYear();
  return {
    validFrom: new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1]), 12)),
    validTo: new Date(Date.UTC(year, Number(match[4]) - 1, Number(match[3]), 23, 59, 59)),
    validityText: match[0],
  };
}

function parseQuantity(text) {
  const match = String(text || '').match(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml|cl)\b/i);
  if (!match) return { unitValue: null, unitType: '', totalComparableAmount: null, comparableUnit: '' };
  const value = Number(match[1].replace(',', '.'));
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return { unitValue: null, unitType: '', totalComparableAmount: null, comparableUnit: '' };
  const factors = { kg: [1, 'kg'], g: [0.001, 'kg'], l: [1, 'l'], ml: [0.001, 'l'], cl: [0.01, 'l'] };
  return { unitValue: value, unitType: unit, totalComparableAmount: value * factors[unit][0], comparableUnit: factors[unit][1] };
}

function normalizeCandidate(candidate, { source, crawlJobId, region, pdfUrl, validity }) {
  if (candidate.exclusionReason || NON_PRODUCT_TITLE.test(String(candidate.title || ''))) return null;
  const title = sanitizeWhitespace(candidate.title);
  const price = Number(candidate.price || parseNumericAmount(candidate.rawText));
  if (!title || !Number.isFinite(price) || price <= 0) return null;
  const quantity = parseQuantity(candidate.quantityText);
  const validFrom = validity.validFrom;
  const validTo = validity.validTo;
  const now = new Date();
  if (!validFrom || !validTo || validFrom > now || validTo < now) return null;
  const comparable = Boolean(quantity.comparableUnit && quantity.totalComparableAmount);
  const unitPrice = comparable ? Number((price / quantity.totalComparableAmount).toFixed(2)) : null;
  const titleNormalized = normalizeTitleForMatch(title);
  return {
    sourceId: source._id,
    crawlJobId,
    retailerKey: 'hofer',
    retailerName: 'Hofer',
    region,
    title,
    titleNormalized,
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Sonstiges',
    categoryKey: 'sonstiges',
    sourceUrl: pdfUrl,
    validFrom,
    validTo,
    status: 'active',
    isActiveNow: true,
    isActiveToday: true,
    priceCurrent: { amount: price, currency: 'EUR', originalText: `${price.toFixed(2)} EUR` },
    priceReference: { amount: null, currency: 'EUR', originalText: '' },
    quantityText: candidate.quantityText || '',
    unitValue: quantity.unitValue,
    unitType: quantity.unitType,
    totalComparableAmount: quantity.totalComparableAmount,
    comparableUnit: quantity.comparableUnit,
    normalizedUnitPrice: { amount: unitPrice, unit: quantity.comparableUnit, comparable, confidence: comparable ? 0.65 : 0 },
    comparisonGroup: `${titleNormalized}::${quantity.comparableUnit || 'na'}`,
    quality: { completenessScore: 0.8, parsingConfidence: 0.65, comparisonSafe: comparable, issues: comparable ? [] : ['Menge nicht belastbar vergleichbar'] },
    needsReview: true,
    reviewReasons: ['HOFER-Publitas-PDF automatisch extrahiert'],
    rawFacts: {
      sourceType: SOURCE_TYPE,
      sourceKey: SOURCE_KEY,
      sourceId: String(source._id || ''),
      crawlJobId: String(crawlJobId || ''),
      sourceText: candidate.rawText || title,
      pdfUrl,
      validityText: validity.validityText,
      snapshotCurrent: true,
    },
    supportingSources: [buildSourceEvidence({ source, observedUrl: pdfUrl, matchType: 'primary' })],
  };
}

async function extractHoferPublitasPdf({ pdfBuffer, source, crawlJobId, region, pdfUrl, catalogText = '' }) {
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const full = await parser.getText();
    const pages = [];
    for (let page = 1; page <= full.total; page += 1) {
      const result = await parser.getText({ partial: [page] });
      pages.push({ page, text: result.text });
    }
    const validity = parseDate([catalogText, full.text].join(' '));
    const candidates = pages.flatMap(extractCandidatesFromPage)
      .map((candidate) => normalizeCandidate(candidate, { source, crawlJobId, region, pdfUrl, validity }))
      .filter(Boolean);
    return { candidates, validity, pages: pages.length, textLength: full.text.length };
  } finally {
    await parser.destroy();
  }
}

module.exports = { PARSER_VERSION, SOURCE_TYPE, SOURCE_KEY, extractHoferPublitasPdf, parseDate, parseQuantity };
