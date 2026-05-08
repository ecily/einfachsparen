const axios = require('axios');
const mongoose = require('mongoose');
const { PDFParse } = require('pdf-parse');
const { connectToDatabase } = require('../src/config/mongodb');
const RawDocument = require('../src/models/RawDocument');
const {
  buildPdfLayoutDiagnosticsFromPages,
} = require('../src/services/crawl/pdfLayoutDiagnostics');

const PENNY_PDF_SOURCE_TYPE = 'penny-official-pdf';
const PENNY_PDF_SOURCE_KEY = 'penny-official-flyer-pdf';

async function fetchPdfBuffer(url) {
  const response = await axios.get(url, {
    timeout: 45000,
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept: 'application/pdf,*/*',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
    },
  });

  return {
    buffer: Buffer.from(response.data),
    httpStatus: response.status,
    contentType: response.headers?.['content-type'] || '',
    finalUrl: response.request?.res?.responseUrl || url,
  };
}

async function extractTextPagesFromPdfBuffer(buffer) {
  const parser = new PDFParse({ data: buffer });

  try {
    const fullText = await parser.getText();
    const pages = [];

    for (let page = 1; page <= fullText.total; page += 1) {
      const result = await parser.getText({ partial: [page] });
      pages.push({
        pageNumber: page,
        text: result.text,
      });
    }

    return {
      pageCount: fullText.total,
      textLength: fullText.text.length,
      pages,
    };
  } finally {
    await parser.destroy();
  }
}

function pickPdfUrl(rawDocument = {}) {
  return rawDocument.finalUrl || rawDocument.canonicalUrl || rawDocument.url || rawDocument.payload?.observedUrl || '';
}

function redactUrl(value) {
  const text = String(value || '');

  if (!text) {
    return '';
  }

  try {
    const parsed = new URL(text);
    parsed.search = parsed.search ? '?[redacted]' : '';
    return parsed.toString();
  } catch (error) {
    return text.split('?')[0] + (text.includes('?') ? '?[redacted]' : '');
  }
}

function buildToolchainHints() {
  return [
    {
      tool: 'pdf-poppler / pdftoppm',
      purpose: 'PDF-Seiten lokal als Bilder rendern, damit OCR echte Bildkoordinaten bekommt.',
      status: 'optional-system-tool',
    },
    {
      tool: 'PaddleOCR',
      purpose: 'Lokale OCR mit Textboxen/Polygonen; fachlich bester naechster Schritt fuer Angebotsbloecke.',
      status: 'recommended-next',
    },
    {
      tool: 'externes tesseract oder tesseract.js',
      purpose: 'Alternative lokale OCR; meist einfacher, aber Layout-/BBox-Qualitaet schwankt staerker.',
      status: 'optional',
    },
  ];
}

async function buildPennyPdfLayoutReport() {
  const rawDocument = await RawDocument.findOne({
    retailerKey: 'penny',
    documentType: 'pdf',
    sourceType: PENNY_PDF_SOURCE_TYPE,
  })
    .sort({ fetchedAt: -1 })
    .select('retailerKey sourceType documentType url canonicalUrl finalUrl title fetchedAt downloadBytes parserVersion foundRawItems parsedOffers rejectedOffers rejectionReasons payload')
    .lean();

  if (!rawDocument) {
    return {
      ok: false,
      readOnly: true,
      message: 'No PENNY PDF RawDocument found.',
      toolchainHints: buildToolchainHints(),
    };
  }

  const pdfUrl = pickPdfUrl(rawDocument);
  const baseReport = {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    source: {
      rawDocumentId: String(rawDocument._id || ''),
      retailerKey: rawDocument.retailerKey,
      sourceType: rawDocument.sourceType,
      sourceKey: rawDocument.payload?.sourceKey || PENNY_PDF_SOURCE_KEY,
      parserVersion: rawDocument.parserVersion || rawDocument.payload?.parserVersion || '',
      fetchedAt: rawDocument.fetchedAt,
      title: rawDocument.title,
      url: redactUrl(rawDocument.url),
      finalUrl: redactUrl(rawDocument.finalUrl),
      selectedPdfUrl: redactUrl(pdfUrl),
      storedPageCount: rawDocument.payload?.detectedPageCount || 0,
      storedParsedOffers: rawDocument.parsedOffers || 0,
    },
    bbox: {
      available: false,
      mode: 'text-flow',
      reason: 'Die vorhandene pdf-parse-Nutzung liefert Seiten-Text, aber keine stabilen Wort-/Zeilen-Bounding-Boxes.',
    },
    toolchainHints: buildToolchainHints(),
  };

  if (!pdfUrl) {
    return {
      ...baseReport,
      ok: false,
      message: 'Latest PENNY PDF RawDocument has no usable PDF URL.',
    };
  }

  try {
    const download = await fetchPdfBuffer(pdfUrl);
    const extracted = await extractTextPagesFromPdfBuffer(download.buffer);
    const diagnostics = buildPdfLayoutDiagnosticsFromPages({
      retailerKey: 'penny',
      sourceType: PENNY_PDF_SOURCE_TYPE,
      sourceKey: rawDocument.payload?.sourceKey || PENNY_PDF_SOURCE_KEY,
      pages: extracted.pages,
      layoutMode: 'text-flow',
    });
    const sampleBlockCandidates = diagnostics.pages
      .flatMap((page) => page.blockCandidates)
      .slice(0, 20);
    const sampleProblemCandidates = diagnostics.pages
      .flatMap((page) => page.problemCandidates)
      .slice(0, 20);

    return {
      ...baseReport,
      download: {
        httpStatus: download.httpStatus,
        contentType: download.contentType,
        finalUrl: redactUrl(download.finalUrl),
        bytes: download.buffer.length,
      },
      pdf: {
        pageCount: extracted.pageCount,
        textLength: extracted.textLength,
      },
      totals: diagnostics.totals,
      pages: diagnostics.pages.map((page) => ({
        pageNumber: page.pageNumber,
        lineCount: page.lineCount,
        priceCandidateCount: page.priceCandidateCount,
        problemCandidateCount: page.problemCandidateCount,
        priceCandidates: page.priceCandidates.slice(0, 5),
      })),
      sampleBlockCandidates,
      sampleProblemCandidates,
    };
  } catch (error) {
    return {
      ...baseReport,
      ok: false,
      message: error.message,
      hint: 'Falls die gespeicherte finale PDF-URL abgelaufen ist, zuerst einen frischen Crawl ausfuehren und danach diese Diagnose erneut starten.',
    };
  }
}

async function run() {
  await connectToDatabase();
  const report = await buildPennyPdfLayoutReport();
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      readOnly: true,
      message: error.message,
      stack: error.stack,
    }, null, 2));
    mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = {
  buildPennyPdfLayoutReport,
  extractTextPagesFromPdfBuffer,
  pickPdfUrl,
  redactUrl,
};
