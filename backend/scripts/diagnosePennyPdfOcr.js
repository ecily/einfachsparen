const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');
const mongoose = require('mongoose');
const { PDFParse } = require('pdf-parse');
const { connectToDatabase } = require('../src/config/mongodb');
const RawDocument = require('../src/models/RawDocument');
const Source = require('../src/models/Source');
const {
  buildPdfLayoutDiagnosticsFromPages,
} = require('../src/services/crawl/pdfLayoutDiagnostics');
const {
  checkExecutableAvailable,
  renderPdfPagesForDiagnostics,
} = require('../src/services/crawl/pdfRenderDiagnostics');
const {
  buildPaddleOcrCompatibilityReport,
  runPaddleOcrCliTrial,
} = require('../src/services/crawl/paddleOcrDiagnostics');
const {
  buildTesseractInstallHint,
  runTesseractOnRenderedPages,
} = require('../src/services/crawl/tesseractOcrDiagnostics');
const {
  normalizeOcrBoxes,
  summarizeOcrDiagnostics,
  buildPriceCandidateComparison,
  buildCandidateBlockPreviews,
} = require('../src/services/crawl/ocrBoxDiagnostics');
const {
  pickPdfUrl,
  redactUrl,
} = require('./diagnosePennyPdfLayout');
const {
  extractIssuuDocumentFromUrl,
  extractIssuuDocumentsFromHtml,
  resolveIssuuOriginalPdfUrl,
} = require('../src/services/crawl/issuuPdfResolver');

const PENNY_PDF_SOURCE_TYPE = 'penny-official-pdf';
const PENNY_PDF_SOURCE_KEY = 'penny-official-flyer-pdf';
const DEFAULT_PAGE_LIMIT = 3;
const DEFAULT_CANDIDATE_PREVIEW_LIMIT = 20;

function buildPaddleOcrInstallHint() {
  return [
    'Windows Git Bash:',
    '1. cd /c/coding/einfachsparen/backend',
    '2. python -m venv .venv-ocr',
    '3. source .venv-ocr/Scripts/activate',
    '4. python -m pip install --upgrade pip',
    '5. python -m pip install paddleocr paddlepaddle',
    '6. pruefen: paddleocr --help',
    '7. neue CLI pruefen: paddleocr ocr --help',
    'Optional fuer diese Diagnose: PaddleOCR-Ausgabe als JSON speichern und mit PENNY_PDF_OCR_JSON_PATH=/pfad/result.json npm run diagnose:penny-pdf-ocr einlesen.',
  ].join('\n');
}

function buildLocalOcrWorkflowHint({ renderedPages = [], outputDir = '', pageLimit = DEFAULT_PAGE_LIMIT } = {}) {
  const renderedPath = outputDir ? outputDir.replace(/\\/g, '/') : '/pfad/zu/backend/tmp/diagnostics/penny-pdf-ocr-...';
  const imageInputs = renderedPages.length > 0
    ? renderedPages.map((page) => page.path.replace(/\\/g, '/')).join(' ')
    : `${renderedPath}/page-1.png ${renderedPath}/page-2.png`;

  return {
    purpose: 'Lokaler Diagnose-Workflow: PDF-Seiten rendern, OCR ausfuehren, OCR-JSON wieder einlesen.',
    renderPages: `PENNY_PDF_OCR_PAGE_LIMIT=${pageLimit} npm run diagnose:penny-pdf-ocr`,
    paddleOcrCli: [
      'source .venv-ocr/Scripts/activate',
      `paddleocr ocr --input "${renderedPath}" --lang german --save_path "${renderedPath}/paddle-output" --device cpu --enable_mkldnn False --use_doc_orientation_classify False --use_doc_unwarping False --use_textline_orientation False`,
    ],
    paddleOcrRunner: [
      'source .venv-ocr/Scripts/activate',
      `python scripts/paddleOcrRunner.py --input ${imageInputs} --output "${renderedPath}/ocr-result.json" --lang german`,
    ],
    tesseract: [
      'tesseract --version',
      `PENNY_PDF_OCR_TESSERACT_LANG=deu+eng npm run diagnose:penny-pdf-ocr`,
      `tesseract "${renderedPath}/page-01.png" stdout -l deu+eng --psm 6 tsv`,
    ],
    jsonInput: `PENNY_PDF_OCR_JSON_PATH=${renderedPath}/ocr-result.json npm run diagnose:penny-pdf-ocr`,
    expectedOcrShape: {
      pages: [
        {
          pageNumber: 1,
          lines: [
            {
              text: 'Beispiel Produkt',
              confidence: 0.95,
              bbox: { x: 10, y: 20, width: 120, height: 30 },
              polygon: [[10, 20], [130, 20], [130, 50], [10, 50]],
            },
          ],
        },
      ],
    },
    renderedImageInputs: imageInputs,
  };
}

function buildCandidateSummary({ diagnostics = {}, comparison = {}, activeOcrBoxes = [], render = {}, activeOcrSource = '' } = {}) {
  return {
    renderedPages: (render.renderedPages || []).length,
    ocrActiveSource: activeOcrSource,
    ocrBoxes: activeOcrBoxes.length,
    bboxAvailable: Boolean(diagnostics.bbox?.available),
    detectedPriceBoxes: (diagnostics.detectedPriceBoxes || []).length,
    candidateBlocks: (diagnostics.candidateBlocks || []).length,
    cleanCandidateBlocks: (diagnostics.cleanCandidateBlocks || []).length,
    problemBlocks: (diagnostics.problemBlocks || []).length,
    textFlowPriceCandidates: comparison.totals?.textFlowPriceCandidates || 0,
    matchedByPageAndAmount: comparison.totals?.matchedByPageAndAmount || 0,
  };
}

async function writeCandidateDiagnosticsFile({
  outputDir = '',
  baseReport = {},
  renderedPages = [],
  activeOcrSource = '',
  summary = {},
  candidateBlocksPreview = [],
  cleanCandidateBlocksPreview = [],
  problemBlocksPreview = [],
} = {}) {
  if (!outputDir) {
    return '';
  }

  const filePath = path.join(outputDir, 'penny-pdf-ocr-candidates.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    source: baseReport.source || {},
    selectedPdfUrlSource: baseReport.source?.selectedPdfUrlSource || '',
    renderedPages,
    ocrActiveSource: activeOcrSource,
    summary,
    candidateBlocksPreview,
    cleanCandidateBlocksPreview,
    problemBlocksPreview,
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

  return filePath;
}

function buildConsoleReport(report = {}) {
  return {
    ok: report.ok,
    readOnly: report.readOnly,
    mutatedCollections: report.mutatedCollections || [],
    source: report.source,
    attemptedDownloadUrls: report.attemptedDownloadUrls,
    download: report.download,
    pdfUrlRefresh: report.pdfUrlRefresh,
    rendering: report.rendering,
    renderedPages: report.renderedPages,
    tools: report.tools,
    ocr: {
      available: report.ocr?.available,
      source: report.ocr?.source,
      activeSource: report.ocr?.activeSource,
      boxes: report.ocr?.boxes,
      tesseract: report.ocr?.tesseract ? {
        available: report.ocr.tesseract.available,
        command: report.ocr.tesseract.command,
        lang: report.ocr.tesseract.lang,
        requestedLang: report.ocr.tesseract.requestedLang,
        availableLanguages: report.ocr.tesseract.availableLanguages,
        languageFallbackReason: report.ocr.tesseract.languageFallbackReason,
        reason: report.ocr.tesseract.reason,
      } : null,
      reason: report.ocr?.reason,
    },
    bbox: report.bbox,
    summary: report.summary,
    candidateBlocksPreview: report.candidateBlocksPreview,
    cleanCandidateBlocksPreview: report.cleanCandidateBlocksPreview,
    problemBlocksPreview: report.problemBlocksPreview,
    diagnosticArtifacts: report.diagnosticArtifacts,
    nextHint: report.nextHint,
  };
}

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

function getAxiosStatus(error) {
  return error?.response?.status || error?.status || null;
}

function getDownloadFailure(error) {
  const statusCode = getAxiosStatus(error);

  return {
    ok: false,
    statusCode,
    reason: statusCode
      ? `HTTP ${statusCode}: ${error?.response?.statusText || error.message}`
      : error.message,
    finalUrl: error?.response?.request?.res?.responseUrl || error?.config?.url || '',
  };
}

function buildDownloadNextHint({ statusCode, refreshAttempted = false, refreshFound = false } = {}) {
  if (statusCode === 403) {
    return refreshAttempted
      ? 'Die gespeicherte PDF-URL wurde mit HTTP 403 abgelehnt. Die Diagnose hat versucht, aus der Originalquelle eine frische Issuu/PDF-URL zu ermitteln; wenn das nicht gelingt, ist vermutlich ein neuer offizieller Crawl oder ein manueller PENNY_PDF_URL-Override mit einer aktuell erreichbaren PDF-URL noetig.'
      : 'Die gespeicherte PDF-URL wurde mit HTTP 403 abgelehnt. Pruefe die Originalquelle oder starte die Diagnose mit PENNY_PDF_URL=<aktuelle-pdf-url>.';
  }

  if (refreshAttempted && !refreshFound) {
    return 'Die gespeicherte PDF-URL konnte nicht geladen werden und aus der Originalquelle wurde keine frische PDF-URL erkannt. Pruefe source.url/sourceUrl oder nutze PENNY_PDF_URL nur fuer diese Diagnose.';
  }

  return 'PDF konnte nicht geladen werden. Pruefe Netzwerk, Originalquelle oder nutze PENNY_PDF_URL=<aktuelle-pdf-url> fuer diese Diagnose.';
}

function collectRefreshSourceUrls(rawDocument = {}, source = {}) {
  return [
    source.sourceUrl,
    rawDocument.payload?.observedUrl,
    rawDocument.url,
    rawDocument.canonicalUrl,
    rawDocument.finalUrl,
  ].filter(Boolean);
}

async function fetchHtmlForPdfRefresh(url) {
  const response = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/json',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
    },
  });

  return {
    html: String(response.data || ''),
    finalUrl: response.request?.res?.responseUrl || url,
    statusCode: response.status,
  };
}

async function refreshPennyPdfUrlFromSource(rawDocument = {}, source = {}) {
  const attemptedSourceUrls = [];
  const errors = [];

  for (const sourceUrl of collectRefreshSourceUrls(rawDocument, source)) {
    if (attemptedSourceUrls.includes(sourceUrl)) {
      continue;
    }

    attemptedSourceUrls.push(sourceUrl);

    const directIssuuDocument = extractIssuuDocumentFromUrl(sourceUrl);

    if (directIssuuDocument) {
      try {
        const resolved = await resolveIssuuOriginalPdfUrl(directIssuuDocument);
        return {
          ok: true,
          pdfUrl: resolved.pdfUrl,
          sourceUrl,
          attemptedSourceUrls,
          reason: '',
          document: {
            documentUrl: directIssuuDocument.documentUrl,
            publicationId: resolved.publicationId || '',
            revisionId: resolved.revisionId || '',
            pageCount: resolved.pageCount || 0,
            title: resolved.title || '',
          },
        };
      } catch (error) {
        errors.push({ sourceUrl, reason: error.message });
        continue;
      }
    }

    if (!/^https?:\/\//i.test(sourceUrl) || /\.pdf(?:\?|$)/i.test(sourceUrl)) {
      continue;
    }

    try {
      const fetched = await fetchHtmlForPdfRefresh(sourceUrl);
      const documents = extractIssuuDocumentsFromHtml(fetched.html, fetched.finalUrl || sourceUrl);

      for (const document of documents.slice(0, 3)) {
        try {
          const resolved = await resolveIssuuOriginalPdfUrl(document);
          return {
            ok: true,
            pdfUrl: resolved.pdfUrl,
            sourceUrl: fetched.finalUrl || sourceUrl,
            attemptedSourceUrls,
            reason: '',
            document: {
              documentUrl: document.documentUrl,
              publicationId: resolved.publicationId || '',
              revisionId: resolved.revisionId || '',
              pageCount: resolved.pageCount || 0,
              title: resolved.title || '',
            },
          };
        } catch (error) {
          errors.push({ sourceUrl: document.documentUrl || sourceUrl, reason: error.message });
        }
      }
    } catch (error) {
      errors.push({
        sourceUrl,
        statusCode: getAxiosStatus(error),
        reason: error.message,
      });
    }
  }

  return {
    ok: false,
    pdfUrl: '',
    attemptedSourceUrls,
    reason: errors.length > 0
      ? errors.map((item) => [item.sourceUrl, item.statusCode ? `HTTP ${item.statusCode}` : '', item.reason].filter(Boolean).join(': ')).join(' | ')
      : 'Keine verwertbare Issuu-Quellseite gefunden.',
    errors,
  };
}

async function resolvePdfDownloadForDiagnostics({
  rawDocument = {},
  source = {},
  env = process.env,
  fetchPdfBufferFn = fetchPdfBuffer,
  refreshPdfUrlFn = refreshPennyPdfUrlFromSource,
} = {}) {
  const envPdfUrl = env.PENNY_PDF_URL || '';
  const storedPdfUrl = pickPdfUrl(rawDocument);
  const initialPdfUrl = envPdfUrl || storedPdfUrl;
  const initialSource = envPdfUrl ? 'env:PENNY_PDF_URL' : 'rawDocument.selectedPdfUrl';
  const attemptedDownloadUrls = [];

  async function attemptDownload(url, selectedPdfUrlSource) {
    attemptedDownloadUrls.push(url);

    try {
      const download = await fetchPdfBufferFn(url);

      return {
        ok: true,
        download,
        selectedPdfUrl: url,
        selectedPdfUrlSource,
        attemptedDownloadUrls,
        refresh: null,
        failure: null,
      };
    } catch (error) {
      return {
        ok: false,
        selectedPdfUrl: url,
        selectedPdfUrlSource,
        failure: getDownloadFailure(error),
      };
    }
  }

  if (!initialPdfUrl) {
    return {
      ok: false,
      download: null,
      selectedPdfUrl: '',
      selectedPdfUrlSource: initialSource,
      attemptedDownloadUrls,
      refresh: null,
      failure: {
        ok: false,
        statusCode: null,
        reason: 'Keine PDF-URL vorhanden.',
        finalUrl: '',
      },
      nextHint: 'RawDocument enthaelt keine PDF-URL. Pruefe source.url/sourceUrl oder nutze PENNY_PDF_URL=<aktuelle-pdf-url> fuer diese Diagnose.',
    };
  }

  const firstAttempt = await attemptDownload(initialPdfUrl, initialSource);

  if (firstAttempt.ok || envPdfUrl) {
    return {
      ...firstAttempt,
      download: firstAttempt.download || null,
      refresh: null,
      nextHint: firstAttempt.ok
        ? ''
        : buildDownloadNextHint({ statusCode: firstAttempt.failure.statusCode, refreshAttempted: false }),
    };
  }

  const refresh = await refreshPdfUrlFn(rawDocument, source);

  if (refresh.ok && refresh.pdfUrl && !attemptedDownloadUrls.includes(refresh.pdfUrl)) {
    const refreshedAttempt = await attemptDownload(refresh.pdfUrl, 'refreshed-from-source-url');

    return {
      ...refreshedAttempt,
      download: refreshedAttempt.download || null,
      refresh,
      nextHint: refreshedAttempt.ok
        ? ''
        : buildDownloadNextHint({
          statusCode: refreshedAttempt.failure.statusCode || firstAttempt.failure.statusCode,
          refreshAttempted: true,
          refreshFound: true,
        }),
    };
  }

  return {
    ok: false,
    download: null,
    selectedPdfUrl: initialPdfUrl,
    selectedPdfUrlSource: initialSource,
    attemptedDownloadUrls,
    refresh,
    failure: firstAttempt.failure,
    nextHint: buildDownloadNextHint({
      statusCode: firstAttempt.failure.statusCode,
      refreshAttempted: true,
      refreshFound: Boolean(refresh.ok && refresh.pdfUrl),
    }),
  };
}

async function extractTextPagesFromPdfBuffer(buffer, pageLimit = DEFAULT_PAGE_LIMIT) {
  const parser = new PDFParse({ data: buffer });

  try {
    const fullText = await parser.getText();
    const pages = [];
    const endPage = Math.min(fullText.total, pageLimit);

    for (let page = 1; page <= endPage; page += 1) {
      const result = await parser.getText({ partial: [page] });
      pages.push({
        pageNumber: page,
        text: result.text,
      });
    }

    return {
      pageCount: fullText.total,
      comparedPages: pages.length,
      textLength: pages.reduce((sum, page) => sum + page.text.length, 0),
      pages,
    };
  } finally {
    await parser.destroy();
  }
}

function flattenPaddleLikeOcrJson(value, defaults = {}) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (Array.isArray(item) && Array.isArray(item[0]) && Array.isArray(item[1])) {
        return [{
          polygon: item[0],
          text: item[1][0],
          confidence: item[1][1],
          pageNumber: defaults.pageNumber,
        }];
      }

      return flattenPaddleLikeOcrJson(item, defaults);
    });
  }

  if (Array.isArray(value.pages)) {
    return value.pages.flatMap((page, index) => {
      const pageNumber = page.pageNumber || page.page || index + 1;
      return flattenPaddleLikeOcrJson(page.words || page.lines || page.boxes || page.ocr || page.results || [], { pageNumber });
    });
  }

  if (Array.isArray(value.data)) {
    return flattenPaddleLikeOcrJson(value.data, defaults);
  }

  if (Array.isArray(value.words) || Array.isArray(value.lines) || Array.isArray(value.boxes) || Array.isArray(value.results)) {
    return flattenPaddleLikeOcrJson(value.words || value.lines || value.boxes || value.results, defaults);
  }

  if (value.text || value.value || value.label) {
    return [{
      ...value,
      pageNumber: value.pageNumber || value.page || defaults.pageNumber || 1,
    }];
  }

  return [];
}

async function readOptionalOcrJson() {
  const jsonPath = process.env.PENNY_PDF_OCR_JSON_PATH || process.env.PENNY_PDF_OCR_JSON || '';

  if (!jsonPath) {
    return {
      available: false,
      source: '',
      boxes: [],
      reason: 'Keine lokale OCR-JSON-Datei angegeben.',
      installHint: buildPaddleOcrInstallHint(),
    };
  }

  try {
    const raw = await fs.readFile(path.resolve(jsonPath), 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    const boxes = normalizeOcrBoxes(flattenPaddleLikeOcrJson(parsed));

    return {
      available: boxes.length > 0,
      source: path.resolve(jsonPath),
      boxes,
      reason: boxes.length > 0 ? '' : 'OCR-JSON wurde gelesen, enthaelt aber keine normalisierbaren OCR-Boxen.',
      installHint: buildPaddleOcrInstallHint(),
    };
  } catch (error) {
    return {
      available: false,
      source: path.resolve(jsonPath),
      boxes: [],
      reason: error.message,
      installHint: buildPaddleOcrInstallHint(),
    };
  }
}

async function findLatestPennyPdfRawDocument() {
  return RawDocument.findOne({
    retailerKey: 'penny',
    documentType: 'pdf',
    sourceType: PENNY_PDF_SOURCE_TYPE,
  })
    .sort({ fetchedAt: -1 })
    .select('sourceId retailerKey sourceType documentType url canonicalUrl finalUrl title fetchedAt downloadBytes parserVersion foundRawItems parsedOffers rejectedOffers rejectionReasons payload')
    .lean();
}

async function findRawDocumentSource(rawDocument = {}) {
  if (!rawDocument.sourceId) {
    return null;
  }

  return Source.findById(rawDocument.sourceId)
    .select('retailerKey retailerName channel label sourceUrl sourceType enabled active parserHint parserVersion latestStatus')
    .lean();
}

async function buildPennyPdfOcrReport() {
  const pageLimit = Math.max(1, Math.min(10, Number(process.env.PENNY_PDF_OCR_PAGE_LIMIT || DEFAULT_PAGE_LIMIT)));
  const rawDocument = await findLatestPennyPdfRawDocument();
  const source = rawDocument ? await findRawDocumentSource(rawDocument) : null;
  const projectRoot = path.join(__dirname, '..');
  const tools = {
    poppler: await checkExecutableAvailable('pdftoppm'),
    paddleocr: await checkExecutableAvailable('paddleocr'),
    tesseract: await checkExecutableAvailable('tesseract'),
  };
  const paddleOcrCompatibility = await buildPaddleOcrCompatibilityReport({
    projectRoot,
    inputDir: '<diagnostics-dir>',
    outputDir: '<diagnostics-dir>/paddle-output',
  });

  if (!rawDocument) {
    return {
      ok: false,
      readOnly: true,
      mutatedCollections: [],
      message: 'No PENNY PDF RawDocument found.',
      tools,
      paddleOcrCompatibility,
      ocr: {
        available: false,
        reason: 'Ohne PENNY PDF RawDocument gibt es keine lokale OCR-Diagnosebasis.',
        installHint: buildPaddleOcrInstallHint(),
        tesseractInstallHint: buildTesseractInstallHint(),
      },
      bbox: { available: false, mode: 'unavailable' },
    };
  }

  const storedPdfUrl = pickPdfUrl(rawDocument);
  const selectedPdfUrlSource = process.env.PENNY_PDF_URL ? 'env:PENNY_PDF_URL' : 'rawDocument.selectedPdfUrl';
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
      selectedPdfUrl: redactUrl(process.env.PENNY_PDF_URL || storedPdfUrl),
      selectedPdfUrlSource,
      storedParsedOffers: rawDocument.parsedOffers || 0,
    },
    pageSelection: {
      pageStart: 1,
      pageEnd: pageLimit,
    },
    tools,
    paddleOcrCompatibility,
  };

  const downloadResult = await resolvePdfDownloadForDiagnostics({
    rawDocument,
    source: source || {},
  });
  const downloadDiagnostics = {
    statusCode: downloadResult.download?.httpStatus || downloadResult.failure?.statusCode || null,
    reason: downloadResult.failure?.reason || '',
    finalUrl: redactUrl(downloadResult.download?.finalUrl || downloadResult.failure?.finalUrl || ''),
    contentType: downloadResult.download?.contentType || '',
    bytes: downloadResult.download?.buffer?.length || 0,
  };
  const refreshDiagnostics = downloadResult.refresh ? {
    ok: downloadResult.refresh.ok,
    sourceUrl: redactUrl(downloadResult.refresh.sourceUrl || ''),
    attemptedSourceUrls: (downloadResult.refresh.attemptedSourceUrls || []).map(redactUrl),
    reason: downloadResult.refresh.reason || '',
    document: downloadResult.refresh.document || null,
  } : null;

  baseReport.source.selectedPdfUrl = redactUrl(downloadResult.selectedPdfUrl || process.env.PENNY_PDF_URL || storedPdfUrl);
  baseReport.source.selectedPdfUrlSource = downloadResult.selectedPdfUrlSource || selectedPdfUrlSource;
  baseReport.attemptedDownloadUrls = downloadResult.attemptedDownloadUrls.map(redactUrl);
  baseReport.download = downloadDiagnostics;
  baseReport.pdfUrlRefresh = refreshDiagnostics;

  if (!downloadResult.selectedPdfUrl) {
    return {
      ...baseReport,
      ok: false,
      message: 'Latest PENNY PDF RawDocument has no usable PDF URL.',
      renderedPages: [],
      ocr: {
        available: false,
        reason: 'Keine PDF-URL vorhanden.',
        installHint: buildPaddleOcrInstallHint(),
        tesseractInstallHint: buildTesseractInstallHint(),
      },
      bbox: { available: false, mode: 'unavailable' },
      nextHint: downloadResult.nextHint,
    };
  }

  if (!downloadResult.ok) {
    return {
      ...baseReport,
      ok: false,
      message: downloadResult.failure?.reason || 'PDF konnte nicht geladen werden.',
      renderedPages: [],
      ocr: {
        available: false,
        reason: downloadResult.failure?.reason || 'PDF konnte nicht geladen werden.',
        installHint: buildPaddleOcrInstallHint(),
        tesseractInstallHint: buildTesseractInstallHint(),
      },
      bbox: { available: false, mode: 'unavailable' },
      nextHint: downloadResult.nextHint,
    };
  }

  const { download } = downloadResult;

  const outputRoot = path.join(__dirname, '..', 'tmp', 'diagnostics');
  const render = await renderPdfPagesForDiagnostics({
    pdfBuffer: download.buffer,
    outputRoot,
    pageStart: 1,
    pageEnd: pageLimit,
  });
  const paddleInputDir = render.outputDir || '';
  const paddleOutputDir = paddleInputDir ? path.join(paddleInputDir, 'paddle-output') : '';
  const paddleCliTrial = process.env.PENNY_PDF_OCR_RUN_PADDLE_CLI === '1'
    ? await runPaddleOcrCliTrial({
      command: paddleOcrCompatibility.command?.command,
      cliForm: paddleOcrCompatibility.cliForm,
      inputDir: paddleInputDir,
      outputDir: paddleOutputDir,
      cwd: projectRoot,
    })
    : {
      enabled: false,
      reason: 'Setze PENNY_PDF_OCR_RUN_PADDLE_CLI=1, um den PaddleOCR-CLI-Lauf in der Diagnose optional zu starten.',
      recommendedCommand: paddleOcrCompatibility.recommendedCommand,
    };
  const ocr = await readOptionalOcrJson();
  const tesseract = ocr.available
    ? {
      available: false,
      skipped: true,
      reason: 'Lokale OCR-JSON-Datei wurde angegeben; Tesseract-Fallback wurde nicht gestartet.',
      installHint: '',
      boxes: [],
      pages: [],
    }
    : await runTesseractOnRenderedPages({
      renderedPages: render.renderedPages || [],
      cwd: projectRoot,
    });
  const activeOcrBoxes = ocr.available ? ocr.boxes : tesseract.boxes;
  const activeOcrSource = ocr.available ? 'json' : 'tesseract';
  const previewLimit = Math.max(1, Math.min(50, Number(process.env.PENNY_PDF_OCR_CANDIDATE_PREVIEW_LIMIT || DEFAULT_CANDIDATE_PREVIEW_LIMIT)));
  const diagnostics = summarizeOcrDiagnostics(activeOcrBoxes, {
    maxDistance: 260,
    maxItems: 10,
    previewLimit,
  });
  const extracted = await extractTextPagesFromPdfBuffer(download.buffer, pageLimit);
  const layoutDiagnostics = buildPdfLayoutDiagnosticsFromPages({
    retailerKey: 'penny',
    sourceType: PENNY_PDF_SOURCE_TYPE,
    sourceKey: rawDocument.payload?.sourceKey || PENNY_PDF_SOURCE_KEY,
    pages: extracted.pages,
    layoutMode: 'text-flow',
  });
  const comparison = buildPriceCandidateComparison({
    layoutDiagnostics,
    ocrDiagnostics: diagnostics,
  });
  const summary = buildCandidateSummary({
    diagnostics,
    comparison,
    activeOcrBoxes,
    render,
    activeOcrSource,
  });
  const candidateBlocksPreview = buildCandidateBlockPreviews(diagnostics.candidateBlocks, { limit: previewLimit });
  const cleanCandidateBlocksPreview = buildCandidateBlockPreviews(diagnostics.cleanCandidateBlocks, { limit: previewLimit });
  const problemBlocksPreview = buildCandidateBlockPreviews(diagnostics.problemBlocks, { limit: previewLimit });
  const candidateDiagnosticsPath = await writeCandidateDiagnosticsFile({
    outputDir: render.outputDir || '',
    baseReport,
    renderedPages: render.renderedPages || [],
    activeOcrSource,
    summary,
    candidateBlocksPreview,
    cleanCandidateBlocksPreview,
    problemBlocksPreview,
  });

  return {
    ...baseReport,
    download: {
      httpStatus: download.httpStatus,
      statusCode: download.httpStatus,
      reason: '',
      contentType: download.contentType,
      finalUrl: redactUrl(download.finalUrl),
      bytes: download.buffer.length,
    },
    rendering: {
      available: render.available,
      tool: render.tool,
      outputDir: render.outputDir || '',
      reason: render.reason || '',
      installHint: render.available ? '' : render.installHint,
    },
    renderedPages: render.renderedPages || [],
    localWorkflow: buildLocalOcrWorkflowHint({
      renderedPages: render.renderedPages || [],
      outputDir: render.outputDir || '',
      pageLimit,
    }),
    ocr: {
      available: activeOcrBoxes.length > 0,
      source: ocr.available ? ocr.source : tesseract.source,
      jsonInputAvailable: ocr.available,
      boxes: activeOcrBoxes.length,
      activeSource: activeOcrSource,
      paddleocrCliFound: tools.paddleocr.available || paddleOcrCompatibility.available,
      paddleCompatibility: paddleOcrCompatibility,
      paddleCliTrial,
      tesseract,
      reason: activeOcrBoxes.length > 0 ? '' : [ocr.reason, tesseract.reason].filter(Boolean).join(' | '),
      installHint: ocr.available ? '' : ocr.installHint,
      tesseractInstallHint: tesseract.available || tesseract.skipped ? '' : tesseract.installHint,
    },
    textFlow: {
      available: true,
      pageCount: extracted.pageCount,
      comparedPages: extracted.comparedPages,
      priceCandidates: layoutDiagnostics.totals.priceCandidates,
      problemCandidates: layoutDiagnostics.totals.problemCandidates,
      samplePriceCandidates: layoutDiagnostics.pages
        .flatMap((page) => page.priceCandidates.map((candidate) => ({
          pageNumber: page.pageNumber,
          text: candidate.text,
          amount: candidate.amount,
          lineIndex: candidate.lineIndex,
        })))
        .slice(0, 20),
    },
    bbox: diagnostics.bbox,
    summary,
    comparison,
    detectedPriceBoxes: diagnostics.detectedPriceBoxes.slice(0, 30),
    nearbyTextByDistance: diagnostics.nearbyTextByDistance.slice(0, 20),
    candidateBlocks: diagnostics.candidateBlocks.length,
    cleanCandidateBlocks: diagnostics.cleanCandidateBlocks.length,
    problemBlocks: diagnostics.problemBlocks.length,
    candidateBlocksPreview,
    cleanCandidateBlocksPreview,
    problemBlocksPreview,
    diagnosticArtifacts: {
      candidateBlocksJson: candidateDiagnosticsPath,
      candidateBlocksJsonHint: candidateDiagnosticsPath && diagnostics.candidateBlocks.length > previewLimit
        ? `Konsole zeigt ${previewLimit} von ${diagnostics.candidateBlocks.length} candidateBlocks; vollstaendige Preview im Diagnose-JSON.`
        : '',
    },
    examples: diagnostics.candidateBlocks.slice(0, 10).map((candidate) => ({
      pageNumber: candidate.pageNumber,
      price: candidate.price,
      priceText: candidate.priceText,
      nearestTitleText: candidate.nearestTitleText,
      nearestTitleDistance: candidate.nearestTitleDistance,
      rejectionHints: candidate.rejectionHints,
    })),
  };
}

async function run() {
  await connectToDatabase();
  const report = await buildPennyPdfOcrReport();
  console.log(JSON.stringify(buildConsoleReport(report), null, 2));
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
  buildPennyPdfOcrReport,
  buildLocalOcrWorkflowHint,
  extractTextPagesFromPdfBuffer,
  flattenPaddleLikeOcrJson,
  getDownloadFailure,
  buildCandidateSummary,
  buildConsoleReport,
  readOptionalOcrJson,
  refreshPennyPdfUrlFromSource,
  resolvePdfDownloadForDiagnostics,
  writeCandidateDiagnosticsFile,
};
