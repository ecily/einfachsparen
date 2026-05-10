const cheerio = require('cheerio');

const SOURCE_KEY = 'spar-official-flyer';
const DEFAULT_SOURCE_URL = 'https://www.spar.at/aktionen/steiermark';

const RETAILER_SCOPES = [
  { key: 'spar-gourmet', pattern: /\bSPAR[-\s]?GOURMET\b/i },
  { key: 'interspar', pattern: /\bINTERSPAR\b/i },
  { key: 'eurospar', pattern: /\bEUROSPAR\b/i },
  { key: 'spar', pattern: /\bSPAR\b/i },
];

const FLYER_TYPE_PATTERNS = [
  { type: 'coupon-book', pattern: /coupon|gutschein|pickerl|rabattmark/i },
  { type: 'monthly-saver', pattern: /monat|monats|dauerpreis|sparen/i },
  { type: 'magazine', pattern: /magazin|journal|zeitung/i },
  { type: 'weekly-flyer', pattern: /flugblatt|wochen|kw\s*\d+/i },
];

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueCompact(values = []) {
  return [...new Set(values.map(compactWhitespace).filter(Boolean))];
}

function dateKey(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function normalizeYear(year) {
  if (!year) return null;
  const numeric = Number(year);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 100) return 2000 + numeric;
  return numeric;
}

function extractDateParts(text) {
  const parts = [];
  const normalized = String(text || '').replace(/[–—]/g, '-');
  const pattern = /(\d{1,2})\.(\d{1,2})\.(?:(\d{2,4}))?/g;
  let match;

  while ((match = pattern.exec(normalized))) {
    parts.push({
      day: Number(match[1]),
      month: Number(match[2]),
      year: normalizeYear(match[3]),
      raw: match[0],
    });
  }

  return parts;
}

function parseSparOfficialValidity(validityText, options = {}) {
  const warnings = [];
  const parts = extractDateParts(validityText);

  if (parts.length === 0) {
    return {
      validFrom: null,
      validTo: null,
      validityText: compactWhitespace(validityText),
      parseWarnings: compactWhitespace(validityText) ? ['validity-date-not-found'] : [],
    };
  }

  const explicitYear = parts.find((part) => part.year)?.year || null;
  const contextYear = normalizeYear(options.contextYear);
  const inferredYear = explicitYear || contextYear;

  if (!inferredYear) {
    return {
      validFrom: null,
      validTo: null,
      validityText: compactWhitespace(validityText),
      parseWarnings: ['validity-year-missing'],
    };
  }

  const normalizedParts = parts.map((part) => ({
    ...part,
    year: part.year || inferredYear,
  }));
  const start = normalizedParts[0];
  const end = normalizedParts[normalizedParts.length - 1];
  const validFrom = dateKey(start.year, start.month, start.day);
  let validTo = dateKey(end.year, end.month, end.day);

  if (!validFrom || !validTo) {
    warnings.push('validity-date-invalid');
  }

  if (validFrom && validTo && validTo < validFrom) {
    const nextYearDate = dateKey(end.year + 1, end.month, end.day);
    if (nextYearDate && nextYearDate >= validFrom) {
      validTo = nextYearDate;
      warnings.push('validity-end-year-rolled-forward');
    } else {
      warnings.push('validity-range-inverted');
    }
  }

  if (!explicitYear && contextYear) {
    warnings.push('validity-year-inferred-from-context');
  }

  return {
    validFrom,
    validTo,
    validityText: compactWhitespace(validityText),
    parseWarnings: warnings,
  };
}

function toAbsoluteUrl(href, baseUrl = DEFAULT_SOURCE_URL) {
  if (!compactWhitespace(href)) {
    return '';
  }

  try {
    return new URL(href, baseUrl).toString();
  } catch (error) {
    return '';
  }
}

function detectRetailerScope(text) {
  const haystack = compactWhitespace(text);
  const match = RETAILER_SCOPES.find((scope) => scope.pattern.test(haystack));
  return match?.key || '';
}

function detectFlyerType(text) {
  const haystack = compactWhitespace(text);
  const match = FLYER_TYPE_PATTERNS.find((entry) => entry.pattern.test(haystack));
  return match?.type || 'unknown';
}

function detectRegion({ $, sourceUrl, explicitRegionKey, explicitRegionName }) {
  const urlRegion = String(sourceUrl || '').match(/\/aktionen\/([^/?#]+)/i)?.[1] || '';
  const htmlRegionKey = $('[data-region-key]').first().attr('data-region-key') || '';
  const htmlRegionName = $('[data-region-name]').first().attr('data-region-name') || '';
  const bodyText = compactWhitespace($('body').text());

  const regionKey = compactWhitespace(explicitRegionKey || htmlRegionKey || urlRegion).toLowerCase();
  let regionName = compactWhitespace(explicitRegionName || htmlRegionName);

  if (!regionName && /steiermark/i.test(bodyText)) {
    regionName = 'Steiermark';
  }

  return {
    regionKey,
    regionName,
  };
}

function collectPageContextYear(html, options = {}) {
  const optionYear = normalizeYear(options.contextYear);
  if (optionYear) return optionYear;

  const explicitYears = extractDateParts(html)
    .map((part) => part.year)
    .filter(Boolean);

  return explicitYears.length > 0 ? explicitYears[0] : null;
}

function closestText($, element, selectors) {
  for (const selector of selectors) {
    const value = compactWhitespace($(element).find(selector).first().text());
    if (value) return value;
  }

  return '';
}

function linkByText($, element, textPattern) {
  let found = '';

  $(element).find('a[href]').each((index, link) => {
    if (found) return;
    const label = compactWhitespace($(link).text());
    const href = $(link).attr('href');
    if (textPattern.test(`${label} ${href || ''}`)) {
      found = href;
    }
  });

  return found;
}

function extractFlyerCards($) {
  const explicit = $('[data-spar-official-flyer], [data-flyer-card], article, .flyer-card, .leaflet-card').toArray();

  if (explicit.length > 0) {
    return explicit;
  }

  return $('a[href*="flugblatt.spar.at"], a[href$=".pdf"], a[href*=".pdf"]').toArray()
    .map((link) => $(link).closest('section, article, div').get(0))
    .filter(Boolean);
}

function buildFlyerCandidate({ $, element, region, sourceUrl, contextYear }) {
  const text = compactWhitespace($(element).text());
  const title = closestText($, element, [
    '[data-flyer-title]',
    '.flyer-title',
    'h1',
    'h2',
    'h3',
    'strong',
  ]) || text.split(' ').slice(0, 10).join(' ');
  const validityText = closestText($, element, [
    '[data-validity]',
    '.validity',
    '.date',
    'time',
  ]) || (text.match(/(?:\d{1,2}\.\d{1,2}\.(?:\d{2,4})?).{0,30}(?:\d{1,2}\.\d{1,2}\.(?:\d{2,4})?)/)?.[0] || '');
  const pdfViewHref = $(element).attr('data-pdf-view-url')
    || linkByText($, element, /pdf\s*(?:anzeigen|ansehen)|flugblatt\.spar\.at/i);
  const pdfDownloadHref = $(element).attr('data-pdf-download-url')
    || linkByText($, element, /pdf\s*(?:download|herunterladen)|download/i);
  const retailerScope = $(element).attr('data-retailer-scope') || detectRetailerScope(text);
  const parsedValidity = parseSparOfficialValidity(validityText, { contextYear });
  const parseWarnings = [...parsedValidity.parseWarnings];

  if (!retailerScope) parseWarnings.push('retailer-scope-not-found');
  if (!region.regionKey && !region.regionName) parseWarnings.push('region-not-found');
  if (!parsedValidity.validFrom || !parsedValidity.validTo) parseWarnings.push('validity-not-parseable');

  const pdfViewUrl = toAbsoluteUrl(pdfViewHref, sourceUrl);
  const pdfDownloadUrl = toAbsoluteUrl(pdfDownloadHref, sourceUrl);

  if (!pdfViewUrl && !pdfDownloadUrl) parseWarnings.push('pdf-url-not-found');

  return {
    sourceKey: SOURCE_KEY,
    sourceUrl,
    regionKey: region.regionKey,
    regionName: region.regionName,
    retailerScope,
    banner: retailerScope,
    flyerTitle: title,
    flyerType: detectFlyerType(`${title} ${text}`),
    validityText: parsedValidity.validityText,
    validFrom: parsedValidity.validFrom,
    validTo: parsedValidity.validTo,
    pdfViewUrl,
    pdfDownloadUrl,
    rawText: text.slice(0, 500),
    notes: closestText($, element, ['[data-notes]', '.notes', '.condition', '.conditions']),
    quality: {
      hasValidity: Boolean(parsedValidity.validFrom && parsedValidity.validTo),
      hasPdfUrl: Boolean(pdfViewUrl || pdfDownloadUrl),
      hasRetailerScope: Boolean(retailerScope),
      hasRegion: Boolean(region.regionKey || region.regionName),
      parseWarnings: uniqueCompact(parseWarnings),
    },
  };
}

function flyerDedupeKey(flyer) {
  return [
    flyer.regionKey,
    flyer.retailerScope,
    flyer.flyerTitle,
    flyer.validFrom,
    flyer.validTo,
    flyer.pdfViewUrl || flyer.pdfDownloadUrl,
  ].map((part) => String(part || '').toLowerCase()).join('|');
}

function dedupeFlyers(flyers) {
  const seen = new Set();
  const deduped = [];

  for (const flyer of flyers) {
    const key = flyerDedupeKey(flyer);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(flyer);
  }

  return deduped;
}

function extractDiscountText(text) {
  return compactWhitespace(String(text || '').match(/-\s?\d+\s?%|\d+\s?%\s*(?:Rabatt|guenstiger|günstiger)/i)?.[0] || '');
}

function extractProductScopeText(text, discountText) {
  const escapedDiscount = discountText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const afterDiscount = escapedDiscount
    ? String(text || '').match(new RegExp(`${escapedDiscount}\\s*(?:auf)?\\s*([^.;\\n]+)`, 'i'))?.[1]
    : '';

  return compactWhitespace(afterDiscount || String(text || '').replace(discountText, ''));
}

function extractActionCards($) {
  return $('[data-spar-official-action], [data-action-card], .action-card, .promotion-card').toArray();
}

function buildActionCandidate({ $, element, region, sourceUrl, contextYear }) {
  const text = compactWhitespace($(element).text());
  const title = closestText($, element, [
    '[data-action-title]',
    '.action-title',
    '.promotion-title',
    'h1',
    'h2',
    'h3',
    'strong',
  ]) || text;
  const validityText = closestText($, element, [
    '[data-validity]',
    '.validity',
    '.date',
    'time',
  ]);
  const conditionsText = closestText($, element, [
    '[data-conditions]',
    '.conditions',
    '.condition',
    '.notes',
    'small',
  ]);
  const retailerScope = $(element).attr('data-retailer-scope') || detectRetailerScope(text);
  const parsedValidity = parseSparOfficialValidity(validityText, { contextYear });
  const discountText = extractDiscountText(title || text);
  const parseWarnings = [...parsedValidity.parseWarnings];

  if (!discountText) parseWarnings.push('discount-not-found');
  if (!retailerScope) parseWarnings.push('retailer-scope-not-found');

  return {
    sourceKey: SOURCE_KEY,
    sourceUrl,
    regionKey: region.regionKey,
    regionName: region.regionName,
    retailerScope,
    title,
    text,
    discountText,
    productScopeText: extractProductScopeText(title || text, discountText),
    validityText: parsedValidity.validityText,
    validFrom: parsedValidity.validFrom,
    validTo: parsedValidity.validTo,
    conditionsText,
    quality: {
      hasValidity: Boolean(parsedValidity.validFrom && parsedValidity.validTo),
      hasRetailerScope: Boolean(retailerScope),
      hasRegion: Boolean(region.regionKey || region.regionName),
      parseWarnings: uniqueCompact(parseWarnings),
    },
  };
}

function extractSparOfficialFlyerPage(html, options = {}) {
  const sourceUrl = options.sourceUrl || DEFAULT_SOURCE_URL;
  const $ = cheerio.load(html || '');
  const contextYear = collectPageContextYear(html, options);
  const region = detectRegion({
    $,
    sourceUrl,
    explicitRegionKey: options.regionKey,
    explicitRegionName: options.regionName,
  });
  const flyers = dedupeFlyers(extractFlyerCards($).map((element) =>
    buildFlyerCandidate({ $, element, region, sourceUrl, contextYear })
  ));
  const actionCandidates = extractActionCards($).map((element) =>
    buildActionCandidate({ $, element, region, sourceUrl, contextYear })
  );

  return {
    sourceKey: SOURCE_KEY,
    sourceUrl,
    region,
    flyers,
    actionCandidates,
    extractedOffers: [],
  };
}

module.exports = {
  SOURCE_KEY,
  detectFlyerType,
  detectRetailerScope,
  extractSparOfficialFlyerPage,
  parseSparOfficialValidity,
  toAbsoluteUrl,
};
