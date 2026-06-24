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

const OFFICIAL_VIEWER_HOSTS = new Set([
  'flugblatt.spar.at',
  'flugblatt.interspar.at',
  'www.spar.at',
  'www.interspar.at',
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

const CURRENT_FALLBACK_VIEWER_PATTERNS = [
  /kw[-_ ]?25\b/i,
  /steiermark_kw25/i,
  /260618/i,
];

const STALE_CURRENT_FALLBACK_PATTERNS = [
  /kw[-_ ]?24\b/i,
  /steiermark_kw24/i,
  /260611/i,
  /260603/i,
];

const ACTION_INDEX_FOLDER_TYPES = Object.freeze({
  MAIN_FLYER: 'main-flyer',
  ENJOY: 'enjoy',
  FRUIT_VEGETABLE: 'fruit-vegetable',
  GRILLEN: 'grillen',
  MONATSSPARER: 'monatssparer',
  COUPON: 'coupon/gutschein',
  INSERT: 'insert/einleger',
  ONLINE_FLYER: 'online-flyer',
  MAGAZINE: 'magazine',
  HOME_NONFOOD: 'home/nonfood',
  SCHOOL: 'school',
  PARTYSERVICE: 'partyservice',
  WINE: 'wine',
  UNKNOWN: 'unknown',
});

const ACTION_INDEX_LOW_RISK_FOLDERS = new Set([
  ACTION_INDEX_FOLDER_TYPES.MAIN_FLYER,
  ACTION_INDEX_FOLDER_TYPES.ONLINE_FLYER,
]);

const ACTION_INDEX_MEDIUM_RISK_FOLDERS = new Set([
  ACTION_INDEX_FOLDER_TYPES.ENJOY,
  ACTION_INDEX_FOLDER_TYPES.FRUIT_VEGETABLE,
  ACTION_INDEX_FOLDER_TYPES.GRILLEN,
  ACTION_INDEX_FOLDER_TYPES.MONATSSPARER,
  ACTION_INDEX_FOLDER_TYPES.COUPON,
  ACTION_INDEX_FOLDER_TYPES.INSERT,
]);

const ACTION_INDEX_HIGH_RISK_FOLDERS = new Set([
  ACTION_INDEX_FOLDER_TYPES.MAGAZINE,
  ACTION_INDEX_FOLDER_TYPES.HOME_NONFOOD,
  ACTION_INDEX_FOLDER_TYPES.SCHOOL,
  ACTION_INDEX_FOLDER_TYPES.PARTYSERVICE,
  ACTION_INDEX_FOLDER_TYPES.WINE,
]);

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

function isOfficialSparFamilyViewerUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');

    if (parsed.protocol !== 'https:' || !OFFICIAL_VIEWER_HOSTS.has(host)) {
      return false;
    }

    if (OFFICIAL_PDF_HOSTS.has(host)) {
      return (
        /\/steiermark\/(?:spar|eurospar)\/[^/]+$/i.test(path)
        || /\/steiermark\/steiermark_kw\d+$/i.test(path)
        || /\/sonderfolder\/[^/]+$/i.test(path)
        || /\/weinwelt\/[^/]+$/i.test(path)
      );
    }

    return /\/aktionen\/(?:steiermark|sonderfolder|weinwelt)\/[^/]+$/i.test(path);
  } catch (error) {
    return false;
  }
}

function isRelevantSparFamilyPdfUrl(value) {
  if (!isOfficialSparFamilyPdfUrl(value)) return false;

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

function isRelevantSparFamilyViewerUrl(value) {
  if (!isOfficialSparFamilyViewerUrl(value)) return false;

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

function isCurrentFallbackViewerUrl(value) {
  const url = canonicalDiscoveryUrl(value);
  if (!url) {
    return false;
  }

  if (STALE_CURRENT_FALLBACK_PATTERNS.some((pattern) => pattern.test(url))) {
    return false;
  }

  if (!isRelevantSparFamilyViewerUrl(url) && !isRelevantSparFamilyPdfUrl(url)) {
    return false;
  }

  return CURRENT_FALLBACK_VIEWER_PATTERNS.some((pattern) => pattern.test(url));
}

function buildFallbackViewerLinks(fallbackViewerUrls = [], {
  maxLinks = DEFAULT_LIMITS.maxLinks,
} = {}) {
  const links = [];
  const seen = new Set();

  for (const fallbackUrl of fallbackViewerUrls || []) {
    const url = canonicalDiscoveryUrl(fallbackUrl);
    if (!url || !isCurrentFallbackViewerUrl(url) || seen.has(url)) {
      continue;
    }

    seen.add(url);
    links.push({
      url,
      discoveredFrom: 'configured-current-viewer-fallback',
      kind: isOfficialSparFamilyPdfUrl(url) ? 'pdf' : 'viewer',
    });

    if (links.length >= maxLinks) {
      break;
    }
  }

  return links;
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

function extractSparFamilyViewerLinksFromHtml(html, {
  baseUrl = '',
  discoveredFrom = baseUrl,
  maxLinks = DEFAULT_LIMITS.maxLinks,
  relevantOnly = true,
} = {}) {
  const $ = cheerio.load(html || '');
  const candidates = [];

  $('a[href], link[href]').each((_, element) => {
    const value = $(element).attr('href');
    if (value) {
      candidates.push(toAbsoluteUrl(value, baseUrl));
    }
  });

  candidates.push(...extractUrlCandidatesFromText(html, baseUrl));

  const seen = new Set();
  const links = [];

  for (const candidate of candidates.map(canonicalDiscoveryUrl).filter(Boolean)) {
    if (
      !isOfficialSparFamilyViewerUrl(candidate)
      || (relevantOnly && !isRelevantSparFamilyViewerUrl(candidate))
      || seen.has(candidate)
    ) {
      continue;
    }

    seen.add(candidate);
    links.push({
      url: candidate,
      discoveredFrom,
      kind: 'viewer',
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

function classifySparFamilyFlyerUrl(value) {
  const url = canonicalDiscoveryUrl(value);
  const pdfClassification = classifySparFamilyPdfUrl(url);
  if (pdfClassification.allowed) {
    return {
      ...pdfClassification,
      kind: 'pdf',
    };
  }

  if (!isOfficialSparFamilyViewerUrl(url)) {
    return {
      allowed: false,
      reason: url ? 'not-official-spar-family-flyer' : 'invalid-url',
      sourceGuess: 'unknown',
      host: '',
      path: '',
      kind: 'unknown',
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
  } else if (host === 'flugblatt.interspar.at' || host === 'www.interspar.at' || segments.includes('interspar')) {
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
    kind: 'viewer',
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
  const classification = classifySparFamilyFlyerUrl(url);
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

function inferActionIndexFolderType(url = '', text = '') {
  const normalizedUrl = normalizeForScan(url);
  const normalizedText = normalizeForScan(text);
  const normalized = `${normalizedUrl} ${normalizedText}`.trim();

  if (/\bpartyservice\b/.test(normalized)) return ACTION_INDEX_FOLDER_TYPES.PARTYSERVICE;
  if (/\bschule\b|\bschul\b/.test(normalized)) return ACTION_INDEX_FOLDER_TYPES.SCHOOL;
  if (/\bweinwelt\b|\bwein\b|\bbestseller\b/.test(normalized)) return ACTION_INDEX_FOLDER_TYPES.WINE;
  if (/\bmein zuhause\b|\bzuhause\b|\bhaushalt\b|\bnonfood\b|\bnon food\b/.test(normalized)) return ACTION_INDEX_FOLDER_TYPES.HOME_NONFOOD;
  if (/\bmagazin\b|\bmagazine\b/.test(normalized)) return ACTION_INDEX_FOLDER_TYPES.MAGAZINE;
  if (/\beinleger\b|\beiinleger\b|\bbeileger\b|\binsert\b/.test(normalized)) return ACTION_INDEX_FOLDER_TYPES.INSERT;
  if (/\bgutschein\b|\bgutscheinheft\b|\bcoupon\b|\brabattmarke\b|\brabattmarken\b/.test(normalized)) return ACTION_INDEX_FOLDER_TYPES.COUPON;
  if (/\bmonatssparer\b|\bmonat\s*sparer\b/.test(normalized)) return ACTION_INDEX_FOLDER_TYPES.MONATSSPARER;
  if (/\bgrillen\b|\bgrill\b/.test(normalized)) return ACTION_INDEX_FOLDER_TYPES.GRILLEN;
  if (/\bobst\b|\bgemuese\b|\bgemuse\b|\bfrucht\b|\bfrische\b/.test(normalized)) return ACTION_INDEX_FOLDER_TYPES.FRUIT_VEGETABLE;
  if (/\benjoy\b/.test(normalized)) return ACTION_INDEX_FOLDER_TYPES.ENJOY;
  if (/\bonline\s*flugblatt\b|\bonline-flugblatt\b|steiermark[_ -]kw\d+/.test(normalized)) return ACTION_INDEX_FOLDER_TYPES.ONLINE_FLYER;
  if (/\bflugblatt\b|\bkw\s*\d+\b/.test(normalized)) return ACTION_INDEX_FOLDER_TYPES.MAIN_FLYER;

  return ACTION_INDEX_FOLDER_TYPES.UNKNOWN;
}

function inferActionIndexRetailerFormat(url = '', text = '') {
  const classification = classifySparFamilyFlyerUrl(url);
  if (['spar', 'eurospar', 'interspar'].includes(classification.sourceGuess)) {
    return classification.sourceGuess;
  }

  const normalized = normalizeForScan(`${url} ${text}`);
  if (/\beurospar\b/.test(normalized)) return 'eurospar';
  if (/\binterspar\b/.test(normalized) || /flugblatt\.interspar\.at/i.test(url)) return 'interspar';
  if (/\bspar\b/.test(normalized) || /flugblatt\.spar\.at/i.test(url)) return 'spar';

  return 'unknown';
}

function inferActionIndexRegion(url = '', text = '') {
  const normalized = normalizeForScan(`${url} ${text}`);
  if (/\bsteiermark\b|\/steiermark\//.test(normalized)) return 'steiermark';
  if (/\boesterreich\b|\bosterreich\b|\baustria\b|\/oesterreich\/|\/osterreich\//.test(normalized)) return 'austria';
  return 'unknown';
}

function inferActionIndexLinkType(url = '') {
  const canonicalUrl = canonicalDiscoveryUrl(url);
  if (isOfficialSparFamilyPdfUrl(canonicalUrl)) return 'pdf';
  if (isOfficialSparFamilyViewerUrl(canonicalUrl)) return 'viewer';

  try {
    const parsed = new URL(canonicalUrl || url);
    if (/^https?:$/i.test(parsed.protocol)) return 'html';
  } catch (error) {
    return 'unknown';
  }

  return 'unknown';
}

function parseActionIndexDate(value = '') {
  const match = String(value || '').match(/\b(\d{1,2})\.(\d{1,2})\.(?:(\d{2}|\d{4}))?\b/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = match[3] ? Number(match[3]) : 2026;
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  if (!day || !month || !year) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseActionIndexValidity(text = '') {
  const value = String(text || '');
  const matches = [...value.matchAll(/\b\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4})?\b/g)].map((match) => match[0]);
  if (matches.length === 0) {
    return {
      validFrom: null,
      validTo: null,
      unknown: true,
    };
  }

  return {
    validFrom: parseActionIndexDate(matches[0]),
    validTo: parseActionIndexDate(matches[1] || matches[0]),
    unknown: false,
  };
}

function inferActionIndexRisk(folderType) {
  if (ACTION_INDEX_LOW_RISK_FOLDERS.has(folderType)) return 'low';
  if (ACTION_INDEX_MEDIUM_RISK_FOLDERS.has(folderType)) return 'medium';
  if (ACTION_INDEX_HIGH_RISK_FOLDERS.has(folderType)) return 'high';
  return 'high';
}

function inferActionIndexSupport({ retailerFormat, folderType }) {
  if (retailerFormat === 'eurospar') {
    return {
      kaufklugSupport: 'public-disabled',
      reason: 'EUROSPAR current discovery exists but remains policy-bounded/public-disabled until official current coverage is proven.',
    };
  }

  if (retailerFormat === 'spar' && folderType === ACTION_INDEX_FOLDER_TYPES.MAIN_FLYER) {
    return {
      kaufklugSupport: 'supported-currently',
      reason: 'SPAR current flyer discovery/parser is active, but only the primary discovered link is parsed.',
    };
  }

  if (retailerFormat === 'interspar' && folderType === ACTION_INDEX_FOLDER_TYPES.ONLINE_FLYER) {
    return {
      kaufklugSupport: 'supported-currently',
      reason: 'INTERSPAR current flyer discovery/parser is active for Steiermark online flyers, but only the primary discovered link is parsed.',
    };
  }

  if (
    retailerFormat === 'spar'
    && [
      ACTION_INDEX_FOLDER_TYPES.ENJOY,
      ACTION_INDEX_FOLDER_TYPES.FRUIT_VEGETABLE,
      ACTION_INDEX_FOLDER_TYPES.GRILLEN,
      ACTION_INDEX_FOLDER_TYPES.MONATSSPARER,
      ACTION_INDEX_FOLDER_TYPES.COUPON,
    ].includes(folderType)
  ) {
    return {
      kaufklugSupport: 'partially-supported',
      reason: 'Official SPAR supplemental flyers are recognized or exist as scoped snapshots, but current multi-link parsing is not productive.',
    };
  }

  if (
    retailerFormat === 'interspar'
    && [
      ACTION_INDEX_FOLDER_TYPES.HOME_NONFOOD,
      ACTION_INDEX_FOLDER_TYPES.WINE,
      ACTION_INDEX_FOLDER_TYPES.MAGAZINE,
    ].includes(folderType)
  ) {
    return {
      kaufklugSupport: 'partially-supported',
      reason: 'Some INTERSPAR special PDFs exist as scoped diagnostics/snapshots, but they are high-risk and not broad current public truth.',
    };
  }

  if (retailerFormat === 'interspar' && [
    ACTION_INDEX_FOLDER_TYPES.SCHOOL,
    ACTION_INDEX_FOLDER_TYPES.PARTYSERVICE,
  ].includes(folderType)) {
    return {
      kaufklugSupport: 'unsupported',
      reason: 'Special INTERSPAR folder type is not part of current productive offer extraction.',
    };
  }

  return {
    kaufklugSupport: 'unsupported',
    reason: 'No current safe productive parser/support path is registered for this official folder type.',
  };
}

function recommendedActionIndexNextStep({ retailerFormat, folderType, risk, kaufklugSupport }) {
  if (risk === 'low' && kaufklugSupport === 'supported-currently') {
    return 'Keep as first P1b candidate for combined parse-then-replace; prove multiple links cannot overwrite each other.';
  }

  if (risk === 'low' && retailerFormat === 'eurospar') {
    return 'Keep diagnostic-only until EUROSPAR current coverage and public policy are explicitly approved.';
  }

  if (risk === 'medium') {
    return 'Keep in diagnostic matrix; add fixtures and reject-sample tests before any productive parse scope.';
  }

  return 'Keep diagnostic-only; do not include in P1b production scope before separate parser/evidence audit.';
}

function classifySparFamilyActionIndexLink({ url = '', label = '', discoveredFrom = '' } = {}) {
  const canonicalUrl = canonicalDiscoveryUrl(url) || toAbsoluteUrl(url);
  const retailerFormat = inferActionIndexRetailerFormat(canonicalUrl, label);
  const folderType = inferActionIndexFolderType(canonicalUrl, label);
  const region = inferActionIndexRegion(canonicalUrl, label);
  const linkType = inferActionIndexLinkType(canonicalUrl);
  const validity = parseActionIndexValidity(label);
  const risk = inferActionIndexRisk(folderType);
  const support = inferActionIndexSupport({ retailerFormat, folderType });

  return {
    url: canonicalUrl,
    urlClass: canonicalUrl.replace(/\?.*$/, ''),
    label: String(label || '').replace(/\s+/g, ' ').trim(),
    discoveredFrom,
    retailerFormat,
    folderType,
    region,
    linkType,
    validity,
    risk,
    kaufklugSupport: support.kaufklugSupport,
    reason: support.reason,
    expectedBenefit: risk === 'low' ? 'high' : (risk === 'medium' ? 'medium' : 'low'),
    parserRisk: risk,
    recommendedNextStep: recommendedActionIndexNextStep({
      retailerFormat,
      folderType,
      risk,
      kaufklugSupport: support.kaufklugSupport,
    }),
  };
}

function buildSparFamilyActionIndexMatrix(links = []) {
  const rows = (Array.isArray(links) ? links : []).map(classifySparFamilyActionIndexLink);
  const groupOrder = {
    spar: 0,
    eurospar: 1,
    interspar: 2,
    unknown: 3,
  };
  const riskOrder = {
    low: 0,
    medium: 1,
    high: 2,
  };

  return [...rows].sort((left, right) => {
    const formatCompare = (groupOrder[left.retailerFormat] ?? 99) - (groupOrder[right.retailerFormat] ?? 99);
    if (formatCompare !== 0) return formatCompare;
    const riskCompare = (riskOrder[left.risk] ?? 99) - (riskOrder[right.risk] ?? 99);
    if (riskCompare !== 0) return riskCompare;
    return `${left.folderType} ${left.urlClass}`.localeCompare(`${right.folderType} ${right.urlClass}`);
  });
}

function isBlockedLikely({ status = null, body = '' } = {}) {
  return [401, 403, 407, 429, 451].includes(Number(status))
    || /just a moment|attention required|cf-browser-verification|cf-chl|cdn-cgi\/challenge-platform|enable javascript and cookies/i.test(String(body || ''));
}

function mergeDiscoveredLinks(links, { maxLinks = DEFAULT_LIMITS.maxLinks } = {}) {
  const byUrl = new Map();

  for (const link of links || []) {
    const url = canonicalDiscoveryUrl(link.url);
    if (!url || (!isOfficialSparFamilyPdfUrl(url) && !isOfficialSparFamilyViewerUrl(url))) continue;

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
      kind: link.kind || (isOfficialSparFamilyPdfUrl(url) ? 'pdf' : 'viewer'),
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
  const flyerClassification = classifySparFamilyFlyerUrl(url);
  const matchedNonFoodTerms = findMatchedTerms(`${url} ${scannedText}`, NON_FOOD_TERMS);
  const matchedValidityTerms = findMatchedTerms(scannedText, VALIDITY_TERMS);

  return {
    url,
    discoveredFrom,
    kind: flyerClassification.kind,
    sourceGuess: flyerClassification.sourceGuess || sourceClassification.sourceGuess,
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

function extractAssignedJsonObject(html, assignmentName) {
  const source = String(html || '');
  const assignmentIndex = source.indexOf(assignmentName);
  if (assignmentIndex < 0) return null;

  const startIndex = source.indexOf('{', assignmentIndex);
  if (startIndex < 0) return null;

  let depth = 0;
  let inString = false;
  let stringQuote = '';
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parseAssignedJsonObject(html, assignmentName) {
  const json = extractAssignedJsonObject(html, assignmentName);
  if (!json) return {};

  try {
    return JSON.parse(json);
  } catch (error) {
    return {};
  }
}

async function loadViewerMetadata(url, {
  httpClient = axios,
  timeoutMs = DEFAULT_LIMITS.timeoutMs,
  maxPdfTextPages = DEFAULT_LIMITS.maxPdfTextPages,
} = {}) {
  const response = await httpClient.get(url, {
    timeout: timeoutMs,
    responseType: 'text',
    maxRedirects: 5,
    headers: REQUEST_HEADERS,
    validateStatus: () => true,
  });
  const html = String(response.data || '');
  const blocked = isBlockedLikely({ status: response.status, body: html });

  if (!(response.status >= 200 && response.status < 300) || blocked) {
    return {
      fetchStatus: blocked ? 'blocked' : 'fetchFailed',
      httpStatus: response.status,
      contentType: response.headers?.['content-type'] || '',
      pageCount: null,
      text: '',
      error: response.status ? `HTTP ${response.status}` : 'Viewer fetch failed',
    };
  }

  const staticSettings = parseAssignedJsonObject(html, 'window.staticSettings');
  const pageTexts = Array.isArray(staticSettings.pageTexts)
    ? staticSettings.pageTexts.slice(0, maxPdfTextPages).map((part) => String(part || ''))
    : [];
  const pageCount = Array.isArray(staticSettings.pages)
    ? staticSettings.pages.length
    : (pageTexts.length || null);
  const titleParts = [
    staticSettings.paperCompleteUrl,
    staticSettings.name,
    staticSettings.pageTitle,
  ].filter(Boolean).map((part) => String(part));

  return {
    fetchStatus: 'ok',
    httpStatus: response.status,
    contentType: response.headers?.['content-type'] || '',
    pageCount,
    text: [...titleParts, ...pageTexts].join('\n'),
    error: '',
  };
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
      links: blocked ? [] : [
        ...extractSparFamilyPdfLinksFromHtml(html, {
          baseUrl: response.request?.res?.responseUrl || url,
          discoveredFrom: url,
          maxLinks,
        }),
        ...extractSparFamilyViewerLinksFromHtml(html, {
          baseUrl: response.request?.res?.responseUrl || url,
          discoveredFrom: url,
          maxLinks,
        }),
      ],
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
  fallbackViewerUrls = [],
  httpClient = axios,
  pdfMetadataLoader = loadPdfMetadata,
  viewerMetadataLoader = loadViewerMetadata,
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

  if (discovered.length === 0 && Array.isArray(fallbackViewerUrls) && fallbackViewerUrls.length > 0) {
    discovered.push(...buildFallbackViewerLinks(fallbackViewerUrls, {
      maxLinks: effectiveLimits.maxLinks,
    }));
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
        const metadataLoader = link.kind === 'viewer' ? viewerMetadataLoader : pdfMetadataLoader;
        metadata = await metadataLoader(link.url, {
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
    fallbackViewerUrls: buildFallbackViewerLinks(fallbackViewerUrls, {
      maxLinks: effectiveLimits.maxLinks,
    }).map((link) => link.url),
    checkedPages: entrypointResults.map((result) => ({
      url: result.url,
      finalUrl: result.finalUrl,
      httpStatus: result.httpStatus,
      contentType: result.contentType,
      fetchStatus: result.fetchStatus,
      blockedLikely: result.blockedLikely,
      error: result.error,
      discoveredPdfCount: result.links.length,
      discoveredViewerCount: result.links.filter((link) => link.kind === 'viewer').length,
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
      scopedOnly: definition.crawlPolicy?.scopedOnly === true,
      currentSnapshot: definition.crawlPolicy?.currentSnapshot !== false,
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
  ACTION_INDEX_FOLDER_TYPES,
  buildSparFamilyActionIndexMatrix,
  buildSafetyMetadata,
  buildFallbackViewerLinks,
  buildSparFamilyFlyerInventoryReport,
  canonicalDiscoveryUrl,
  classifySparFamilyActionIndexLink,
  classifySparFamilyPdfUrl,
  classifySparFamilyFlyerUrl,
  decodeUrlText,
  discoverSparFamilyFlyers,
  extractSparFamilyPdfLinksFromHtml,
  extractSparFamilyViewerLinksFromHtml,
  fetchEntrypoint,
  findMatchedTerms,
  getBackendSparFamilyPdfSources,
  inferFolderType,
  isBlockedLikely,
  isCurrentFallbackViewerUrl,
  isOfficialSparFamilyPdfUrl,
  isOfficialSparFamilyViewerUrl,
  isRelevantSparFamilyPdfUrl,
  loadViewerMetadata,
  mergeDiscoveredLinks,
  normalizeForScan,
  toAbsoluteUrl,
};
