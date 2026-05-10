const { PDFParse } = require('pdf-parse');
const {
  sanitizeWhitespace,
  normalizeTitleForMatch,
  buildSourceEvidence,
} = require('./sourceEvidence');
const { buildInclusiveScopeDecision } = require('./categoryClassifier');
const { buildPdfSourceMetadata, normalizePdfText } = require('./pdfOfferParsing');
const { applyManualCategoryOverridesToOfferSync } = require('../quality/manualCategoryOverrideService');

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
  const match = normalized.match(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml|kapseln|kapsel|stk|stueck)\b/i);

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

  if (!['kg', 'l', 'stk', 'kapseln'].includes(comparableUnit)) {
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

  if (!comparisonSafe || !price || !quantity.totalComparableAmount || !['kg', 'l', 'Stk'].includes(quantity.comparableUnit)) {
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
    ...data,
  };

  if (!candidate.title || !(candidate.price > 0)) {
    candidate.exclusionReason = candidate.title ? 'missing-price' : 'unclear-product';
  } else if (!candidate.quantityText) {
    candidate.exclusionReason = 'missing-quantity';
  }

  candidates.push(candidate);
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
    for (const candidate of extractKnownCoffeeCandidatesFromPage(page, { sourceRetailerFormat, validity })) {
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

  const categoryPrimary = 'Getraenke';
  const categorySecondary = 'Kaffee & Tee';
  const categoryKey = 'kaffee-tee';
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
      'kaffee espresso bohne gemahlen',
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
