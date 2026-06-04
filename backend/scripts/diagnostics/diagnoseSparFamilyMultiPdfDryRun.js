const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const {
  buildValidityFromSource,
  extractSparPdfReference,
  normalizeSparPdfCandidatesToOffers,
  summarizeRejections,
} = require('../../src/services/crawl/sparOfficialFlyerPdfParser');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'tmp', 'diagnostics', 'spar-family-multi-pdf-dry-run');
const OUT_JSON = path.join(OUT_DIR, 'report.json');

const TARGETS = [
  {
    id: 'spar-kw23-main',
    label: 'SPAR/EUROSPAR/INTERSPAR Hauptflugblatt KW23',
    file: path.join(ROOT, '..', 'tmp', 'diagnostics', 'spar-kw23-pdf-validation', 'spar.pdf'),
    sourceRetailerFormat: 'spar',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    appliesToRetailerFormats: ['spar'],
    validFrom: '2026-06-03T00:00:00.000Z',
    validTo: '2026-06-17T21:59:59.999Z',
    maxPages: 32,
  },
  {
    id: 'eurospar-kw23',
    label: 'EUROSPAR Flugblatt KW23',
    file: path.join(ROOT, '..', 'tmp', 'diagnostics', 'spar-kw23-pdf-validation', 'eurospar.pdf'),
    sourceRetailerFormat: 'eurospar',
    retailerKey: 'eurospar',
    retailerName: 'EUROSPAR',
    appliesToRetailerFormats: ['eurospar'],
    validFrom: '2026-06-03T00:00:00.000Z',
    validTo: '2026-06-17T21:59:59.999Z',
    maxPages: 24,
  },
  {
    id: 'interspar-kw23',
    label: 'INTERSPAR Online-Flugblatt KW23',
    file: path.join(ROOT, '..', 'tmp', 'diagnostics', 'spar-kw23-pdf-validation', 'interspar.pdf'),
    sourceRetailerFormat: 'interspar',
    retailerKey: 'interspar',
    retailerName: 'INTERSPAR',
    appliesToRetailerFormats: ['interspar'],
    validFrom: '2026-06-03T00:00:00.000Z',
    validTo: '2026-06-17T21:59:59.999Z',
    maxPages: 32,
  },
  {
    id: 'monatssparer-kw20',
    label: 'SPAR Monatssparer KW20',
    file: path.join(ROOT, 'tmp', 'diagnostics', 'spar-family-flyer-inventory', 'pdfs', 'steiermark-spar-260513-3-monatssparer-kw-20-168cde3e01.pdf'),
    sourceRetailerFormat: 'spar',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    appliesToRetailerFormats: ['spar', 'eurospar', 'interspar'],
    validFrom: '2026-05-13T00:00:00.000Z',
    validTo: '2026-06-10T21:59:59.999Z',
    maxPages: 24,
  },
  {
    id: 'grillen-kw20',
    label: 'SPAR/EUROSPAR/INTERSPAR Grillen KW20',
    file: path.join(ROOT, 'tmp', 'diagnostics', 'spar-family-flyer-inventory', 'pdfs', 'steiermark-spar-260513-2-grillen-kw-20-5a7dc572c9.pdf'),
    sourceRetailerFormat: 'spar',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    appliesToRetailerFormats: ['spar', 'eurospar', 'interspar'],
    validFrom: '2026-05-13T00:00:00.000Z',
    validTo: '2026-06-10T21:59:59.999Z',
    maxPages: 24,
  },
  {
    id: 'gutscheinheft-kw22',
    label: 'SPAR Gutscheinheft KW22',
    file: path.join(ROOT, 'tmp', 'diagnostics', 'spar-family-flyer-inventory', 'pdfs', 'steiermark-spar-260528-3-spar-gutscheinheft-kw-22-4740a7734e.pdf'),
    sourceRetailerFormat: 'spar',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    appliesToRetailerFormats: ['spar', 'eurospar', 'interspar'],
    validFrom: '2026-05-28T00:00:00.000Z',
    validTo: '2026-06-17T21:59:59.999Z',
    maxPages: 24,
    requireCouponCondition: true,
  },
  {
    id: 'obst-gemuese-kw23',
    label: 'SPAR Obst & Gemuese KW23',
    file: path.join(ROOT, 'tmp', 'diagnostics', 'spar-family-flyer-inventory', 'pdfs', 'steiermark-spar-260525-1-obst-gemuse-kw-22-e892238f16.pdf'),
    sourceRetailerFormat: 'spar',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    appliesToRetailerFormats: ['spar', 'eurospar', 'interspar'],
    validFrom: '2026-05-25T00:00:00.000Z',
    validTo: '2026-06-06T21:59:59.999Z',
    maxPages: 16,
  },
];

function sourceFor(target) {
  return {
    _id: `dry-run-${target.id}`,
    retailerKey: target.retailerKey,
    retailerName: target.retailerName,
    channel: 'official-flyer',
    label: target.label,
    sourceUrl: `file://${target.file}`,
    sourceType: 'pdf',
    sourceRetailerName: target.retailerName,
    sourceRetailerFormat: target.sourceRetailerFormat,
    appliesToRetailerFormats: target.appliesToRetailerFormats,
    retailerFormatLabel: target.appliesToRetailerFormats.join('/'),
    crawlPolicy: {
      validFrom: target.validFrom,
      validTo: target.validTo,
      validityText: `${target.validFrom.slice(0, 10)} bis ${target.validTo.slice(0, 10)}`,
      requireCouponCondition: target.requireCouponCondition === true,
    },
  };
}

function compactCandidate(candidate) {
  if (!candidate) return null;
  return {
    page: candidate.page,
    title: candidate.title || '',
    brand: candidate.brand || '',
    price: candidate.price || null,
    quantityText: candidate.quantityText || '',
    conditionsText: candidate.conditionsText || '',
    parserHint: candidate.parserHint || '',
    exclusionReason: candidate.exclusionReason || '',
    rawText: String(candidate.rawText || '').replace(/\s+/g, ' ').trim().slice(0, 220),
  };
}

function topReasons(candidates) {
  return summarizeRejections(candidates).slice(0, 10);
}

async function inspectTarget(target) {
  if (!fs.existsSync(target.file)) {
    return {
      id: target.id,
      label: target.label,
      file: target.file,
      exists: false,
      error: 'fixture-pdf-not-found',
    };
  }

  const buffer = fs.readFileSync(target.file);
  const source = sourceFor(target);
  const pdfReference = await extractSparPdfReference({
    pdfBuffer: buffer,
    sourceUrl: source.sourceUrl,
    sourceRetailerFormat: target.sourceRetailerFormat,
    validity: buildValidityFromSource(source),
    maxPages: target.maxPages,
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference,
    source,
    crawlJobId: `dry-run-${target.id}`,
    region: 'AT',
    pdfUrl: source.sourceUrl,
    pdfSha256: createHash('sha256').update(buffer).digest('hex'),
  });
  const acceptedCandidates = pdfReference.candidates.filter((candidate) => !candidate.exclusionReason);
  const normalizedTitles = new Set(offers.map((offer) => offer.title));
  const falseRejectedCandidates = pdfReference.candidates
    .filter((candidate) => candidate.exclusionReason)
    .filter((candidate) => candidate.price && /(milka|kaffee|dallmayr|jacobs|goesser|gösser|hirter|obst|radieschen|nektarinen|kiwi|philadelphia|danone|kelly|bier|cola|lavazza|eskimo|persil|pampers|kaese|käse|butter|eis)/i.test(`${candidate.title || ''} ${candidate.rawText || ''}`))
    .slice(0, 8);
  const fragmentRiskCandidates = offers.filter((offer) => {
    const title = String(offer.title || '');
    return title.length < 7
      || /^(gratis|statt|ab|bis|aktion|vorteil|ausgenommen|solange|nur|gültig|gueltig)\b/i.test(title)
      || /[.!?]$/.test(title);
  });

  return {
    id: target.id,
    label: target.label,
    file: target.file,
    exists: true,
    retailerKey: target.retailerKey,
    sourceRetailerFormat: target.sourceRetailerFormat,
    appliesToRetailerFormats: target.appliesToRetailerFormats,
    pagesRead: pdfReference.file.pages,
    bytes: buffer.length,
    validity: {
      validFrom: pdfReference.validity?.validFrom?.toISOString?.() || null,
      validTo: pdfReference.validity?.validTo?.toISOString?.() || null,
      validityText: pdfReference.validity?.validityText || '',
      confidence: pdfReference.validity?.confidence ?? pdfReference.validity?.validityConfidence ?? null,
    },
    raw: pdfReference.candidates.length,
    accepted: offers.length,
    acceptedBeforeOfferNormalization: acceptedCandidates.length,
    rejected: Math.max(0, pdfReference.candidates.length - offers.length),
    rejectReasons: topReasons(pdfReference.candidates),
    fragmentRisk: fragmentRiskCandidates.length,
    sampleGood: offers.slice(0, 8).map((offer) => ({
      title: offer.title,
      price: offer.priceCurrent?.amount ?? null,
      quantityText: offer.quantityText,
      validTo: offer.validTo?.toISOString?.() || offer.validTo || null,
      conditionsText: offer.conditionsText || '',
      sourceType: offer.sourceType,
      appliesToRetailerFormats: offer.appliesToRetailerFormats,
    })),
    sampleFalseRejected: falseRejectedCandidates.map(compactCandidate),
    sampleCorrectRejected: pdfReference.candidates
      .filter((candidate) => candidate.exclusionReason)
      .slice(0, 8)
      .map(compactCandidate),
    sampleAcceptedButDroppedInOfferNormalization: acceptedCandidates
      .filter((candidate) => !normalizedTitles.has(candidate.title))
      .slice(0, 8)
      .map(compactCandidate),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pdfs = [];
  for (const target of TARGETS) {
    pdfs.push(await inspectTarget(target));
  }
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    mutatedCollections: [],
    crawlStarted: false,
    pdfs,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
