const axios = require('axios');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { PDFParse } = require('pdf-parse');
const { parsePdfPriceAmount, normalizePdfText } = require('../crawl/pdfOfferParsing');
const { parseSparOfficialValidity } = require('../crawl/sparOfficialFlyerParser');

const execFileAsync = promisify(execFile);
const SOURCE_KEY = 'spar-official-flyer-pdf-evidence';
const MAX_URLS = 6;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_PDF_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_PDF_PAGES = 8;
const RANGE_HEADER = 'bytes=0-4095';

const COFFEE_TERMS = [
  'kaffee',
  'cafe',
  'café',
  'caffe',
  'espresso',
  'cappuccino',
  'tassimo',
  'nescafe',
  'nescafé',
  'meinl',
  'dallmayr',
  'regio gold',
  'café royal',
  'cafe royal',
  'tchibo',
  'eduscho',
  'lavazza',
  'jacobs',
];

const DEFAULT_SEED_URLS = [
  {
    source: 'public-spar-page-steiermark',
    sourceKey: SOURCE_KEY,
    retailerScope: 'spar',
    regionKey: 'steiermark',
    label: 'SPAR Steiermark Flugblatt KW 19',
    validityText: 'Do., 07.05.26 - Mi., 20.05.26',
    url: 'https://flugblatt.spar.at/steiermark/spar/260507-1-flugblatt-kw-19/getPdf.ashx',
  },
  {
    source: 'public-spar-page-steiermark',
    sourceKey: SOURCE_KEY,
    retailerScope: 'eurospar',
    regionKey: 'steiermark',
    label: 'EUROSPAR Steiermark Flugblatt KW 19',
    validityText: 'Do., 07.05.26 - Mi., 20.05.26',
    url: 'https://flugblatt.spar.at/steiermark/eurospar/260507-1-flugblatt-kw-19/getPdf.ashx',
  },
  {
    source: 'public-spar-page-steiermark',
    sourceKey: SOURCE_KEY,
    retailerScope: 'interspar',
    regionKey: 'steiermark',
    label: 'INTERSPAR Steiermark Online-Flugblatt KW 19',
    validityText: 'Do., 07.05.26 - Mi., 20.05.26',
    url: 'https://flugblatt.interspar.at/steiermark/steiermark_kw19/getPdf.ashx',
  },
];

function normalizeForSearch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function uniqueCompact(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function redactUrl(value) {
  const text = String(value || '');

  if (!text) {
    return '';
  }

  try {
    const parsed = new URL(text);
    if (parsed.search) {
      parsed.search = '?[redacted]';
    }
    return parsed.toString();
  } catch (error) {
    return text.split('?')[0] + (text.includes('?') ? '?[redacted]' : '');
  }
}

function classifySparFlyerPdfUrl(url) {
  const text = String(url || '').trim();

  if (!/^https:\/\//i.test(text)) {
    return {
      allowed: false,
      reason: 'not-https',
      host: '',
      regionKey: '',
      retailerScope: '',
      pdfEndpointType: '',
    };
  }

  let parsed;

  try {
    parsed = new URL(text);
  } catch (error) {
    return {
      allowed: false,
      reason: 'invalid-url',
      host: '',
      regionKey: '',
      retailerScope: '',
      pdfEndpointType: '',
    };
  }

  const host = parsed.hostname.toLowerCase();
  const allowedHost = ['flugblatt.spar.at', 'flugblatt.interspar.at'].includes(host);
  const endpointMatch = parsed.pathname.match(/\/(ViewPdf|getPdf)\.ashx$/i);
  const directPdf = /\.pdf$/i.test(parsed.pathname);

  if (!allowedHost) {
    return {
      allowed: false,
      reason: 'host-not-allowed',
      host,
      regionKey: '',
      retailerScope: '',
      pdfEndpointType: '',
    };
  }

  if (!endpointMatch && !directPdf) {
    return {
      allowed: false,
      reason: 'not-pdf-endpoint',
      host,
      regionKey: '',
      retailerScope: '',
      pdfEndpointType: '',
    };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const regionKey = normalizeForSearch(segments[0] || '').replace(/\s+/g, '-');
  let retailerScope = normalizeForSearch(segments[1] || '').replace(/\s+/g, '-');

  if (host === 'flugblatt.interspar.at') {
    retailerScope = 'interspar';
  }

  if (!['spar', 'eurospar', 'interspar', 'spar-gourmet'].includes(retailerScope)) {
    retailerScope = retailerScope.includes('gourmet') ? 'spar-gourmet' : retailerScope;
  }

  return {
    allowed: true,
    reason: '',
    host,
    regionKey,
    retailerScope,
    pdfEndpointType: endpointMatch?.[1]?.toLowerCase() || 'direct-pdf',
  };
}

function buildSeedMetadata(seed = {}) {
  const urlInfo = classifySparFlyerPdfUrl(seed.url);
  const validity = parseSparOfficialValidity(seed.validityText || '', { contextYear: 2026 });

  return {
    source: seed.source || 'configured-seed',
    sourceKey: seed.sourceKey || SOURCE_KEY,
    label: seed.label || '',
    url: seed.url || '',
    regionKey: seed.regionKey || urlInfo.regionKey,
    retailerScope: seed.retailerScope || urlInfo.retailerScope,
    validityText: seed.validityText || '',
    validFrom: validity.validFrom,
    validTo: validity.validTo,
    validityWarnings: validity.parseWarnings || [],
    urlInfo,
  };
}

function hasCoffeeTerm(value, terms = COFFEE_TERMS) {
  const normalized = ` ${normalizeForSearch(value)} `;

  return terms.some((term) => {
    const normalizedTerm = normalizeForSearch(term);
    return normalizedTerm && normalized.includes(` ${normalizedTerm} `);
  });
}

function findMatchedCoffeeTerms(value, terms = COFFEE_TERMS) {
  const normalized = ` ${normalizeForSearch(value)} `;

  return uniqueCompact(terms.filter((term) => {
    const normalizedTerm = normalizeForSearch(term);
    return normalizedTerm && normalized.includes(` ${normalizedTerm} `);
  }));
}

function extractQuantityHint(value) {
  const text = normalizePdfText(value);
  return text.match(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|gramm|l|liter|ml|stk|stueck|stück|kapseln?|tabs?)\b/i)?.[0] || '';
}

function buildEvidenceSnippetsFromPages(pages = [], { terms = COFFEE_TERMS, maxSnippets = 12 } = {}) {
  const snippets = [];

  for (const page of pages) {
    const lines = String(page.text || '')
      .split(/\r?\n/)
      .map((line) => normalizePdfText(line))
      .filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
      if (!hasCoffeeTerm(lines[index], terms)) {
        continue;
      }

      const contextLines = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 4));
      const context = normalizePdfText(contextLines.join(' | '));
      snippets.push({
        page: page.pageNumber,
        line: index + 1,
        matchedTerms: findMatchedCoffeeTerms(context, terms),
        snippet: context.slice(0, 500),
        priceHint: parsePdfPriceAmount(context),
        quantityHint: extractQuantityHint(context),
      });

      if (snippets.length >= maxSnippets) {
        return snippets;
      }
    }
  }

  return snippets;
}

function classifyEvidenceResult(result = {}) {
  if (result.urlInfo && !result.urlInfo.allowed) {
    return 'unsafe-for-production';
  }

  if (!result.reachable) {
    return 'pdf-not-reachable';
  }

  if (!result.plausiblePdf) {
    return 'unsafe-for-production';
  }

  if (result.error && !result.pdf) {
    return 'needs-manual-snapshot';
  }

  if ((result.coffeeEvidence || []).length === 0) {
    return 'pdf-reachable-no-coffee';
  }

  if (!result.validFrom || !result.validTo || !result.retailerScope || !result.regionKey) {
    return 'needs-manual-snapshot';
  }

  const hasStructuredHints = result.coffeeEvidence.some((item) => item.priceHint || item.quantityHint);
  return hasStructuredHints ? 'parser-ready' : 'pdf-reachable-with-coffee-evidence';
}

function buildNextParserFixPlan(results = []) {
  const usable = results.filter((result) => ['parser-ready', 'pdf-reachable-with-coffee-evidence'].includes(result.classification));

  if (usable.length === 0) {
    return null;
  }

  return {
    sourceKey: 'spar-official-flyer-pdf',
    sourceUrl: usable[0].sourceUrl,
    retailerScope: uniqueCompact(usable.map((item) => item.retailerScope)),
    validFromValidToSource: 'SPAR page/card validity text captured beside the direct PDF link; do not infer from fetchedAt.',
    titleProductExtraction: 'Use PDF textlayer snippets around coffee terms; create fixture tests before Offer storage.',
    priceExtraction: 'Use existing PDF price parser on local text context and reject ambiguous/no-price snippets.',
    quantityExtraction: 'Extract nearby g/kg/Stk/Kapseln package hints; mark comparison unsafe if missing.',
    conditionExtraction: 'Capture nearby coupon/app/exclusion lines as conditionsText, especially campaign exclusions.',
    tests: [
      'fixture PDF text snippet with REGIO/Jacobs/Lavazza coffee product, price and quantity',
      'campaign-only percentage coffee block remains evidence-only unless product rows are explicit',
      'validity must come from source metadata/card text, never fetchedAt',
    ],
    targetedCrawlCommand: 'POST /api/crawl/run with retailerKeys=["spar"], sourceKeys=["spar-official-flyer-pdf"], dryRun=false after parser activation and baseline checks',
    beforeAfterApiChecks: [
      '/api/offers/ranking?q=kaffee&retailers=spar&limit=20',
      '/api/offers/ranking?q=kaffee&limit=20',
      '/api/offers/ranking?q=butter&limit=20',
      '/api/offers/ranking?q=reis&limit=20',
    ],
  };
}

async function probePdfRange(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const response = await axios.get(url, {
    timeout: timeoutMs,
    responseType: 'arraybuffer',
    maxRedirects: 5,
    headers: {
      Accept: 'application/pdf,*/*',
      Range: RANGE_HEADER,
    },
    validateStatus: () => true,
  });

  return {
    httpStatus: response.status,
    contentType: response.headers?.['content-type'] || '',
    contentLength: Number(response.headers?.['content-length'] || 0) || null,
    contentRange: response.headers?.['content-range'] || '',
    downloadedBytes: Buffer.byteLength(response.data || ''),
    finalUrl: response.request?.res?.responseUrl || url,
    bufferStart: Buffer.from(response.data || '').slice(0, 8).toString('latin1'),
  };
}

async function fetchPdfBuffer(url, { timeoutMs = DEFAULT_TIMEOUT_MS, maxPdfBytes = DEFAULT_MAX_PDF_BYTES } = {}) {
  const response = await axios.get(url, {
    timeout: timeoutMs,
    responseType: 'arraybuffer',
    maxRedirects: 5,
    maxContentLength: maxPdfBytes,
    headers: {
      Accept: 'application/pdf,*/*',
    },
    validateStatus: () => true,
  });

  return {
    httpStatus: response.status,
    contentType: response.headers?.['content-type'] || '',
    contentLength: Number(response.headers?.['content-length'] || 0) || null,
    downloadedBytes: Buffer.byteLength(response.data || ''),
    finalUrl: response.request?.res?.responseUrl || url,
    buffer: Buffer.from(response.data || ''),
  };
}

async function extractTextPagesWithPdftotext(buffer, { maxPdfPages = DEFAULT_MAX_PDF_PAGES } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spar-flyer-pdf-'));
  const pdfPath = path.join(tempDir, 'flyer.pdf');
  const textPath = path.join(tempDir, 'flyer.txt');

  try {
    await fs.writeFile(pdfPath, buffer);
    await execFileAsync('pdftotext', ['-f', '1', '-l', String(maxPdfPages), '-layout', pdfPath, textPath], {
      timeout: 60000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });

    const text = await fs.readFile(textPath, 'utf8');
    const pages = text.split('\f').map((pageText, index) => ({
      pageNumber: index + 1,
      text: pageText,
    })).filter((page) => page.text.trim());

    return {
      pageCount: pages.length,
      textLength: pages.reduce((sum, page) => sum + String(page.text || '').length, 0),
      pageLimit: maxPdfPages,
      textExtractor: 'pdftotext',
      pages,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function extractTextPagesFromPdfBuffer(buffer, {
  maxPdfPages = DEFAULT_MAX_PDF_PAGES,
  textExtractor = 'pdf-parse',
} = {}) {
  if (textExtractor === 'pdftotext') {
    return extractTextPagesWithPdftotext(buffer, { maxPdfPages });
  }

  const parser = new PDFParse({ data: buffer });

  try {
    const pages = [];

    for (let page = 1; page <= maxPdfPages; page += 1) {
      try {
        const result = await parser.getText({ partial: [page] });
        const text = result.text || '';

        if (!text && page > 1) {
          break;
        }

        pages.push({
          pageNumber: page,
          text,
        });
      } catch (error) {
        if (page === 1) {
          throw error;
        }
        break;
      }
    }

    return {
      pageCount: pages.length,
      textLength: pages.reduce((sum, page) => sum + String(page.text || '').length, 0),
      pageLimit: maxPdfPages,
      textExtractor: 'pdf-parse',
      pages,
    };
  } finally {
    await parser.destroy();
  }
}

function isPlausiblePdfProbe(probe = {}) {
  return /application\/pdf/i.test(probe.contentType || '') || String(probe.bufferStart || '').startsWith('%PDF');
}

function parseContentRangeTotal(value) {
  const match = String(value || '').match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function inspectSeed(seed, options = {}) {
  const metadata = buildSeedMetadata(seed);
  const maxPdfBytes = options.maxPdfBytes || DEFAULT_MAX_PDF_BYTES;
  const base = {
    ...metadata,
    sourceUrl: metadata.url,
    reachable: false,
    httpStatus: null,
    contentType: '',
    contentLength: null,
    contentRange: '',
    totalBytes: null,
    downloadedBytes: 0,
    finalUrl: '',
    plausiblePdf: false,
    pdf: null,
    coffeeEvidence: [],
    extractionSkippedReason: '',
    error: '',
  };

  if (!metadata.urlInfo.allowed) {
    const result = {
      ...base,
      classification: classifyEvidenceResult(base),
    };
    return result;
  }

  try {
    const probe = await probePdfRange(metadata.url, options);
    base.reachable = probe.httpStatus >= 200 && probe.httpStatus < 400;
    base.httpStatus = probe.httpStatus;
    base.contentType = probe.contentType;
    base.contentLength = probe.contentLength;
    base.contentRange = probe.contentRange;
    base.totalBytes = parseContentRangeTotal(probe.contentRange);
    base.downloadedBytes = probe.downloadedBytes;
    base.finalUrl = redactUrl(probe.finalUrl);
    base.plausiblePdf = isPlausiblePdfProbe(probe);

    if (!base.reachable || !base.plausiblePdf) {
      return {
        ...base,
        classification: classifyEvidenceResult(base),
      };
    }

    if (base.totalBytes && base.totalBytes > maxPdfBytes) {
      const result = {
        ...base,
        extractionSkippedReason: 'pdf-exceeds-configured-max-bytes',
        error: `PDF size ${base.totalBytes} exceeds configured max ${maxPdfBytes}`,
      };

      return {
        ...result,
        classification: classifyEvidenceResult(result),
      };
    }

    const download = await fetchPdfBuffer(metadata.url, options);

    if (!(download.httpStatus >= 200 && download.httpStatus < 400)) {
      return {
        ...base,
        httpStatus: download.httpStatus,
        downloadedBytes: download.downloadedBytes,
        finalUrl: redactUrl(download.finalUrl),
        classification: 'pdf-not-reachable',
      };
    }

    const pdfText = await extractTextPagesFromPdfBuffer(download.buffer, options);
    const coffeeEvidence = buildEvidenceSnippetsFromPages(pdfText.pages);
    const result = {
      ...base,
      httpStatus: download.httpStatus,
      contentType: download.contentType || base.contentType,
      contentLength: download.contentLength || base.contentLength,
      downloadedBytes: download.downloadedBytes,
      finalUrl: redactUrl(download.finalUrl),
      plausiblePdf: true,
      pdf: {
        pages: pdfText.pageCount,
        pageLimit: pdfText.pageLimit,
        textLength: pdfText.textLength,
        textExtractor: pdfText.textExtractor,
      },
      coffeeEvidence,
    };

    return {
      ...result,
      classification: classifyEvidenceResult(result),
    };
  } catch (error) {
    const extractionSkippedReason = /maxContentLength|exceeded/i.test(error.message || '')
      ? 'pdf-exceeds-configured-max-bytes'
      : '';
    const result = {
      ...base,
      extractionSkippedReason,
      error: error.message,
    };
    return {
      ...result,
      classification: classifyEvidenceResult(result),
    };
  }
}

async function buildSparFlyerPdfEvidenceDiagnostic({
  seeds = DEFAULT_SEED_URLS,
  maxUrls = MAX_URLS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxPdfBytes = DEFAULT_MAX_PDF_BYTES,
  maxPdfPages = DEFAULT_MAX_PDF_PAGES,
  textExtractor = 'pdf-parse',
  retailerScopes = [],
} = {}) {
  const allowedRetailerScopes = new Set((retailerScopes || []).map((scope) => String(scope).trim()).filter(Boolean));
  const scopedSeeds = allowedRetailerScopes.size > 0
    ? seeds.filter((seed) => allowedRetailerScopes.has(seed.retailerScope || buildSeedMetadata(seed).retailerScope))
    : seeds;
  const selectedSeeds = scopedSeeds.slice(0, maxUrls);
  const results = [];

  for (const seed of selectedSeeds) {
    results.push(await inspectSeed(seed, { timeoutMs, maxPdfBytes, maxPdfPages, textExtractor }));
  }

  const coffeeEvidenceCount = results.reduce((sum, result) => sum + result.coffeeEvidence.length, 0);
  const extractionSkippedCount = results.filter((result) => result.extractionSkippedReason).length;
  const classifications = results.reduce((acc, result) => {
    acc[result.classification] = (acc[result.classification] || 0) + 1;
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    mutatedCollections: [],
    sourceKey: SOURCE_KEY,
    maxUrls,
    checkedUrlCount: results.length,
    coffeeTerms: COFFEE_TERMS,
    summary: {
      reachablePdfCount: results.filter((result) => result.reachable && result.plausiblePdf).length,
      coffeeEvidenceCount,
      extractionSkippedCount,
      classifications,
      productionRecommendation: coffeeEvidenceCount > 0
        ? 'Evidence is sufficient for a fixture-backed parser prep step, but not for productive Offer storage until product/price/quantity extraction tests pass.'
        : extractionSkippedCount > 0
          ? 'Direct PDFs are reachable, but bounded extraction skipped at least one large PDF; use a controlled manual/current snapshot or raise local byte/page limits before any productive activation.'
        : 'No productive SPAR PDF source activation; needs manual/current flyer snapshot with coffee evidence.',
    },
    results,
    nextParserFixPlan: buildNextParserFixPlan(results),
  };
}

module.exports = {
  COFFEE_TERMS,
  DEFAULT_SEED_URLS,
  SOURCE_KEY,
  buildEvidenceSnippetsFromPages,
  buildNextParserFixPlan,
  buildSeedMetadata,
  buildSparFlyerPdfEvidenceDiagnostic,
  classifyEvidenceResult,
  classifySparFlyerPdfUrl,
  findMatchedCoffeeTerms,
  hasCoffeeTerm,
  normalizeForSearch,
  redactUrl,
};
