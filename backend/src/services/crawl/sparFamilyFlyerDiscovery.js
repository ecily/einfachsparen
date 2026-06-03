const axios = require('axios');
const cheerio = require('cheerio');
const { PDFParse } = require('pdf-parse');

const DEFAULT_ENTRY_POINTS = [
  'https://www.spar.at/aktionen/steiermark',
];

const DEFAULT_LIMITS = {
  maxEntryPoints: 3,
  maxLinks: 40,
  maxPdfMetadataLookups: 12,
  maxPdfBytes: 80 * 1024 * 1024,
  maxPdfTextPages: 48,
  timeoutMs: 15000,
  defaultMaxPages: 6,
  sparFamilyMaxPages24: 24,
};

const REQUEST_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8',
  'User-Agent': 'kaufklug-readonly-source-discovery/1.0',
};

const OFFICIAL_PDF_HOSTS = new Set([
  'flugblatt.spar.at',
  'flugblatt.interspar.at',
]);

const NON_FOOD_TERMS = [
  'haushalt',
  'non food',
  'non-food',
  'technik',
  'elektronik',
  'kueche',
  'kuche',
  'textil',
  'waesche',
  'wasche',
  'reinigung',
  'zuhause',
  'mein zuhause',
  'heissluftfritteuse',
  'heisluftfritteuse',
  'kaffeevollautomat',
  'rowenta',
  'tefal',
  'krups',
  'akkusauger',
  'splendid',
  'sloggi',
];

const VALIDITY_TERMS = [
  'gueltig',
  'gultig',
  'gültig',
  'bis',
  'von',
  'statt',
  'aktion',
  'gratis',
  'rabatt',
  'pickerl',
];

function normalizeForScan(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00df/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/[^a-z0-9%+./ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeUrlText(value) {
  return String(value || '')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&#x2[fF];/g, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'");
}

function toAbsoluteUrl(value, baseUrl = '') {
  const raw = decodeUrlText(value).trim();

  if (!raw || /^(?:javascript|mailto|tel):/i.test(raw)) {
    return '';
  }

  try {
    const parsed = new URL(raw, baseUrl || undefined);
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    return '';
  }
}

function canonicalDiscoveryUrl(value) {
  const url = toAbsoluteUrl(value);
  if (!url) return '';

  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    const wasAssetEndpoint = /\/(?:ViewPdf|Image)\.ashx$/i.test(parsed.pathname);
    parsed.pathname = parsed.pathname.replace(/\/(?:ViewPdf|Image)\.ashx$/i, '/getPdf.ashx');
    if (wasAssetEndpoint) {
      parsed.search = '';
    }
    parsed.searchParams.sort();
    return parsed.toString();
  } catch (error) {
    return '';
  }
}

function isOfficialSparFamilyPdfUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && OFFICIAL_PDF_HOSTS.has(parsed.hostname.toLowerCase())
      && /\/getPdf\.ashx$/i.test(parsed.pathname);
  } catch (error) {
    return false;
  }
}

function isRelevantSparFamilyPdfUrl(value) {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.toLowerCase();
    return path.includes('/steiermark/')
      || path.includes('/sonderfolder/')
      || path.includes('/weinwelt/');
  } catch (error) {
    return false;
  }
}

function derivePdfCandidateUrls(value) {
  const url = canonicalDiscoveryUrl(value);
  if (!url) return [];

  const candidates = [url];

  try {
    const parsed = new URL(url);
    if (OFFICIAL_PDF_HOSTS.has(parsed.hostname.toLowerCase()) && /\/(?:ViewPdf|Image)\.ashx$/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/\/(?:ViewPdf|Image)\.ashx$/i, '/getPdf.ashx');
      parsed.search = '';
      candidates.push(parsed.toString());
    }
  } catch (error) {
    return candidates;
  }

  return [...new Set(candidates.map(canonicalDiscoveryUrl).filter(Boolean))];
}

function extractUrlCandidatesFromText(text, baseUrl = '') {
  const decoded = decodeUrlText(text);
  const urls = [];
  const absolutePattern = /https?:\/\/[^\s"'<>\\)]+/gi;
  const relativePattern = /(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)+\/(?:getPdf|ViewPdf|Image)\.ashx(?:\?[^\s"'<>\\)]*)?/gi;

  for (const match of decoded.matchAll(absolutePattern)) {
    urls.push(match[0].replace(/[),.;\]]+$/, ''));
  }

  for (const match of decoded.matchAll(relativePattern)) {
    const relative = match[0].replace(/[),.;\]]+$/, '');
    if (relative.startsWith('//') || decoded[match.index - 1] === '/') {
      continue;
    }
    urls.push(toAbsoluteUrl(relative, baseUrl));
  }

  return urls.filter(Boolean);
}

function extractSparFamilyPdfLinksFromHtml(html, {
  baseUrl = '',
  discoveredFrom = baseUrl,
  maxLinks = DEFAULT_LIMITS.maxLinks,
  relevantOnly = true,
} = {}) {
  const $ = cheerio.load(html || '');
  const candidates = [];

  $('a[href], link[href], iframe[src], script[src], source[src], embed[src], object[data]').each((_, element) => {
    for (const attribute of ['href', 'src', 'data']) {
      const value = $(element).attr(attribute);
      if (value) {
        candidates.push(toAbsoluteUrl(value, baseUrl));
      }
    }
  });

  candidates.push(...extractUrlCandidatesFromText(html, baseUrl));

  const seen = new Set();
  const links = [];

  for (const candidate of candidates.flatMap(derivePdfCandidateUrls)) {
    if (
      !isOfficialSparFamilyPdfUrl(candidate)
      || (relevantOnly && !isRelevantSparFamilyPdfUrl(candidate))
      || seen.has(candidate)
    ) {
      continue;
    }

    seen.add(candidate);
    links.push({
      url: candidate,
      discoveredFrom,
    });

    if (links.length >= maxLinks) {
      break;
    }
  }

  return links;
}

function classifySparFamilyPdfUrl(value) {
  const url = canonicalDiscoveryUrl(value);
  if (!url || !isOfficialSparFamilyPdfUrl(url)) {
    return {
      allowed: false,
      reason: url ? 'not-official-spar-family-pdf' : 'invalid-url',
      sourceGuess: 'unknown',
      host: '',
      path: '',
    };
  }

  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const segments = path.split('/').filter(Boolean);
  let sourceGuess = 'unknown';

  if (segments.includes('weinwelt')) {
    sourceGuess = 'weinwelt';
  } else if (segments.includes('sonderfolder')) {
    sourceGuess = 'sonderfolder';
  } else if (host === 'flugblatt.interspar.at' || segments.includes('interspar')) {
    sourceGuess = 'interspar';
  } else if (segments.includes('eurospar')) {
    sourceGuess = 'eurospar';
  } else if (segments.includes('spar')) {
    sourceGuess = 'spar';
  }

  return {
    allowed: true,
    reason: '',
    sourceGuess,
    host,
    path: parsed.pathname,
  };
}

function findMatchedTerms(value, terms) {
  const normalized = ` ${normalizeForScan(value)} `;
  return terms.filter((term) => {
    const normalizedTerm = normalizeForScan(term);
    return normalizedTerm && normalized.includes(` ${normalizedTerm} `);
  });
}

function inferFolderType(url, text = '') {
  const normalizedUrl = normalizeForScan(url);
  const normalizedText = normalizeForScan(text);
  const normalized = `${normalizedUrl} ${normalizedText}`.trim();
  const classification = classifySparFamilyPdfUrl(url);
  const normalizedPath = normalizeForScan(classification.path || '');

  if (classification.sourceGuess === 'weinwelt' || /\bweinwelt\b|\bwein\b/.test(normalizedPath)) {
    return 'wine';
  }

  if (/\bgutscheinheft\b|\bgutscheine?\b|\bcoupon\b|\brabattmarke\b|\brabattmarken\b/.test(normalizedPath)) {
    return 'coupon booklet';
  }

  if (
    ['spar', 'eurospar', 'interspar'].includes(classification.sourceGuess)
    && (/\bflugblatt\b|\bkw\s*\d+\b|steiermark[_ -]kw\d+/.test(normalizedPath))
  ) {
    return 'regular flyer';
  }

  if (findMatchedTerms(normalized, NON_FOOD_TERMS).length > 0 || classification.sourceGuess === 'sonderfolder') {
    return 'household/non-food';
  }

  if (/\bobst\b|\bgemuese\b|\bgemuse\b|\bfrische\b|\bfrisch\b|\blebensmittel\b/.test(normalized)) {
    return 'grocery/fresh';
  }

  if (/\bflugblatt\b|\bkw\s*\d+\b|steiermark[_ -]kw\d+/.test(normalizedPath)) {
    return 'regular flyer';
  }

  return 'unknown';
}

function isBlockedLikely({ status = null, body = '' } = {}) {
  return [401, 403, 407, 429, 451].includes(Number(status))
    || /just a moment|attention required|cf-browser-verification|cf-chl|cdn-cgi\/challenge-platform|enable javascript and cookies/i.test(String(body || ''));
}

function mergeDiscoveredLinks(links, { maxLinks = DEFAULT_LIMITS.maxLinks } = {}) {
  const byUrl = new Map();

  for (const link of links || []) {
    const url = canonicalDiscoveryUrl(link.url);
    if (!url || !isOfficialSparFamilyPdfUrl(url)) continue;

    const existing = byUrl.get(url);
    if (existing) {
      existing.discoveredFrom = [...new Set([
        ...(Array.isArray(existing.discoveredFrom) ? existing.discoveredFrom : [existing.discoveredFrom]),
        link.discoveredFrom,
      ].filter(Boolean))];
      continue;
    }

    byUrl.set(url, {
      url,
      discoveredFrom: link.discoveredFrom ? [link.discoveredFrom] : [],
    });

    if (byUrl.size >= maxLinks) {
      break;
    }
  }

  return [...byUrl.values()];
}

function buildSafetyMetadata({
  url,
  discoveredFrom = [],
  pageCount = null,
  scannedText = '',
  fetchStatus = 'notFetched',
  fetchError = '',
  httpStatus = null,
  limits = DEFAULT_LIMITS,
} = {}) {
  const sourceClassification = classifySparFamilyPdfUrl(url);
  const matchedNonFoodTerms = findMatchedTerms(`${url} ${scannedText}`, NON_FOOD_TERMS);
  const matchedValidityTerms = findMatchedTerms(scannedText, VALIDITY_TERMS);

  return {
    url,
    discoveredFrom,
    sourceGuess: sourceClassification.sourceGuess,
    folderType: inferFolderType(url, scannedText),
    pageCount,
    wouldExceedDefaultMaxPages: Boolean(pageCount && pageCount > limits.defaultMaxPages),
    wouldExceedSparFamilyMaxPages24: Boolean(pageCount && pageCount > limits.sparFamilyMaxPages24),
    containsNonFoodTerms: matchedNonFoodTerms.length > 0,
    containsValidityTerms: matchedValidityTerms.length > 0,
    matchedNonFoodTerms,
    matchedValidityTerms,
    fetchStatus,
    fetchError,
    httpStatus,
  };
}

async function loadPdfMetadata(url, {
  httpClient = axios,
  timeoutMs = DEFAULT_LIMITS.timeoutMs,
  maxPdfBytes = DEFAULT_LIMITS.maxPdfBytes,
  maxPdfTextPages = DEFAULT_LIMITS.maxPdfTextPages,
} = {}) {
  const response = await httpClient.get(url, {
    timeout: timeoutMs,
    responseType: 'arraybuffer',
    maxRedirects: 5,
    maxContentLength: maxPdfBytes,
    headers: REQUEST_HEADERS,
    validateStatus: () => true,
  });
  const buffer = Buffer.from(response.data || '');
  const bodyPreview = /text|html|json/i.test(response.headers?.['content-type'] || '')
    ? buffer.toString('utf8', 0, Math.min(buffer.length, 1000))
    : '';

  if (!(response.status >= 200 && response.status < 300) || isBlockedLikely({ status: response.status, body: bodyPreview })) {
    return {
      fetchStatus: isBlockedLikely({ status: response.status, body: bodyPreview }) ? 'blocked' : 'fetchFailed',
      httpStatus: response.status,
      contentType: response.headers?.['content-type'] || '',
      pageCount: null,
      text: '',
      error: response.status ? `HTTP ${response.status}` : 'PDF fetch failed',
    };
  }

  const parser = new PDFParse({ data: buffer });

  try {
    const info = await parser.getInfo();
    const pageCount = Number(info.total || 0) || null;
    const pagesToScan = Math.min(pageCount || maxPdfTextPages, maxPdfTextPages);
    const textParts = [];

    for (let page = 1; page <= pagesToScan; page += 1) {
      try {
        const pageText = await parser.getText({ partial: [page] });
        textParts.push(pageText.text || '');
      } catch (error) {
        if (page === 1) throw error;
        break;
      }
    }

    return {
      fetchStatus: 'ok',
      httpStatus: response.status,
      contentType: response.headers?.['content-type'] || '',
      pageCount,
      text: textParts.join('\n'),
      error: '',
    };
  } finally {
    await parser.destroy();
  }
}

async function fetchEntrypoint(url, {
  httpClient = axios,
  timeoutMs = DEFAULT_LIMITS.timeoutMs,
  maxLinks = DEFAULT_LIMITS.maxLinks,
} = {}) {
  try {
    const response = await httpClient.get(url, {
      timeout: timeoutMs,
      responseType: 'text',
      maxRedirects: 5,
      headers: REQUEST_HEADERS,
      validateStatus: () => true,
    });
    const html = String(response.data || '');
    const blocked = isBlockedLikely({ status: response.status, body: html });

    return {
      url,
      finalUrl: response.request?.res?.responseUrl || url,
      httpStatus: response.status,
      contentType: response.headers?.['content-type'] || '',
      fetchStatus: blocked ? 'blocked' : (response.status >= 200 && response.status < 300 ? 'ok' : 'fetchFailed'),
      blockedLikely: blocked,
      error: blocked ? 'blocked-or-challenge-likely' : (response.status >= 200 && response.status < 300 ? '' : `HTTP ${response.status}`),
      links: blocked ? [] : extractSparFamilyPdfLinksFromHtml(html, {
        baseUrl: response.request?.res?.responseUrl || url,
        discoveredFrom: url,
        maxLinks,
      }),
    };
  } catch (error) {
    return {
      url,
      finalUrl: url,
      httpStatus: error.response?.status || null,
      contentType: error.response?.headers?.['content-type'] || '',
      fetchStatus: isBlockedLikely({ status: error.response?.status, body: error.response?.data }) ? 'blocked' : 'fetchFailed',
      blockedLikely: isBlockedLikely({ status: error.response?.status, body: error.response?.data }),
      error: error.message || String(error),
      links: [],
    };
  }
}

async function discoverSparFamilyFlyers({
  entryPoints = DEFAULT_ENTRY_POINTS,
  httpClient = axios,
  pdfMetadataLoader = loadPdfMetadata,
  limits = {},
} = {}) {
  const effectiveLimits = { ...DEFAULT_LIMITS, ...limits };
  const selectedEntryPoints = entryPoints.slice(0, effectiveLimits.maxEntryPoints);
  const entrypointResults = [];
  const discovered = [];

  for (const entryPoint of selectedEntryPoints) {
    const result = await fetchEntrypoint(entryPoint, {
      httpClient,
      timeoutMs: effectiveLimits.timeoutMs,
      maxLinks: effectiveLimits.maxLinks,
    });
    entrypointResults.push(result);
    discovered.push(...result.links);
  }

  const uniqueLinks = mergeDiscoveredLinks(discovered, { maxLinks: effectiveLimits.maxLinks });
  const enrichedLinks = [];

  for (let index = 0; index < uniqueLinks.length; index += 1) {
    const link = uniqueLinks[index];
    const shouldLoadMetadata = index < effectiveLimits.maxPdfMetadataLookups;
    let metadata = {
      fetchStatus: shouldLoadMetadata ? 'notFetched' : 'skipped',
      httpStatus: null,
      pageCount: null,
      text: '',
      error: shouldLoadMetadata ? '' : 'max-pdf-metadata-lookups-reached',
    };

    if (shouldLoadMetadata) {
      try {
        metadata = await pdfMetadataLoader(link.url, {
          httpClient,
          timeoutMs: effectiveLimits.timeoutMs,
          maxPdfBytes: effectiveLimits.maxPdfBytes,
          maxPdfTextPages: effectiveLimits.maxPdfTextPages,
        });
      } catch (error) {
        metadata = {
          fetchStatus: 'fetchFailed',
          httpStatus: null,
          pageCount: null,
          text: '',
          error: error.message || String(error),
        };
      }
    }

    enrichedLinks.push(buildSafetyMetadata({
      url: link.url,
      discoveredFrom: link.discoveredFrom,
      pageCount: metadata.pageCount,
      scannedText: metadata.text,
      fetchStatus: metadata.fetchStatus,
      fetchError: metadata.error,
      httpStatus: metadata.httpStatus,
      limits: effectiveLimits,
    }));
  }

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    mutatedCollections: [],
    limits: effectiveLimits,
    entryPoints: selectedEntryPoints,
    checkedPages: entrypointResults.map((result) => ({
      url: result.url,
      finalUrl: result.finalUrl,
      httpStatus: result.httpStatus,
      contentType: result.contentType,
      fetchStatus: result.fetchStatus,
      blockedLikely: result.blockedLikely,
      error: result.error,
      discoveredPdfCount: result.links.length,
    })),
    pdfs: enrichedLinks,
  };
}

function getBackendSparFamilyPdfSources(definitions = []) {
  return definitions
    .filter((definition) => {
      const url = definition.sourceUrl || '';
      return definition.channel === 'official-flyer' && isOfficialSparFamilyPdfUrl(canonicalDiscoveryUrl(url));
    })
    .map((definition) => ({
      retailerKey: definition.retailerKey || '',
      sourceRetailerFormat: definition.sourceRetailerFormat || '',
      label: definition.label || '',
      url: canonicalDiscoveryUrl(definition.sourceUrl),
      enabled: definition.enabled !== false,
      maxPdfPages: definition.crawlPolicy?.maxPdfPages ?? null,
      maxPdfBytes: definition.crawlPolicy?.maxPdfBytes ?? null,
      timeoutMs: definition.crawlPolicy?.timeoutMs ?? null,
    }));
}

function buildSparFamilyFlyerInventoryReport({
  discovery,
  backendSources = [],
} = {}) {
  const backendUrls = new Set((backendSources || []).map((source) => canonicalDiscoveryUrl(source.url)));
  const discoveredUrls = new Set((discovery?.pdfs || []).map((pdf) => canonicalDiscoveryUrl(pdf.url)));
  const missingInBackend = (discovery?.pdfs || []).filter((pdf) => !backendUrls.has(canonicalDiscoveryUrl(pdf.url)));
  const backendNotDiscovered = (backendSources || []).filter((source) => !discoveredUrls.has(canonicalDiscoveryUrl(source.url)));

  return {
    generatedAt: discovery?.generatedAt || new Date().toISOString(),
    readOnly: true,
    mutatedCollections: [],
    noProductionActions: true,
    limits: discovery?.limits || DEFAULT_LIMITS,
    checkedPages: discovery?.checkedPages || [],
    pdfs: discovery?.pdfs || [],
    backendSources,
    missingInBackend,
    backendNotDiscovered,
    summary: {
      checkedPageCount: (discovery?.checkedPages || []).length,
      discoveredPdfCount: (discovery?.pdfs || []).length,
      missingInBackendCount: missingInBackend.length,
      pageLimitRiskCount: (discovery?.pdfs || []).filter((pdf) => pdf.wouldExceedSparFamilyMaxPages24).length,
      nonFoodPdfCount: (discovery?.pdfs || []).filter((pdf) => pdf.containsNonFoodTerms || pdf.folderType === 'household/non-food').length,
      blockedEntryPointCount: (discovery?.checkedPages || []).filter((page) => page.blockedLikely).length,
    },
  };
}

module.exports = {
  DEFAULT_ENTRY_POINTS,
  DEFAULT_LIMITS,
  NON_FOOD_TERMS,
  VALIDITY_TERMS,
  buildSafetyMetadata,
  buildSparFamilyFlyerInventoryReport,
  canonicalDiscoveryUrl,
  classifySparFamilyPdfUrl,
  decodeUrlText,
  discoverSparFamilyFlyers,
  extractSparFamilyPdfLinksFromHtml,
  fetchEntrypoint,
  findMatchedTerms,
  getBackendSparFamilyPdfSources,
  inferFolderType,
  isBlockedLikely,
  isOfficialSparFamilyPdfUrl,
  isRelevantSparFamilyPdfUrl,
  mergeDiscoveredLinks,
  normalizeForScan,
  toAbsoluteUrl,
};
