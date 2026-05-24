const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('node:crypto');
const https = require('node:https');
const { Types } = require('mongoose');
const Source = require('../../models/Source');
const CrawlJob = require('../../models/CrawlJob');
const Offer = require('../../models/Offer');
const {
  sanitizeWhitespace,
  normalizeTitleForMatch,
  buildSourceEvidence,
} = require('./sourceEvidence');
const { clearRawDocumentsForSource, createCompactRawDocument } = require('./rawDocumentStorage');
const {
  determineOfferCategory,
  determineOfferSubcategory,
  buildInclusiveScopeDecision,
} = require('./categoryClassifier');
const { applyManualCategoryOverridesToOfferSync } = require('../quality/manualCategoryOverrideService');
const { enrichOffersForStorage } = require('./offerAuditEnrichment');
const { NORMALIZATION_VERSION, buildCrawlJobUpdate, buildHttpLogFromResponse } = require('./crawlAudit');
const { replaceOffersForSource } = require('./offerRefreshGuard');
const {
  PARSER_VERSION: PENNY_PDF_PARSER_VERSION,
  PENNY_PDF_SOURCE_KEY,
  extractPennyPdfReference,
  normalizePennyPdfCandidatesToOffers,
  summarizeRejections,
} = require('./pennyPdfLeafletParser');
const {
  PARSER_VERSION: SPAR_PDF_PARSER_VERSION,
  SOURCE_TYPE: SPAR_PDF_SOURCE_TYPE,
  buildValidityFromSource,
  extractSparPdfReference,
  normalizeSparPdfCandidatesToOffers,
  sourceKeyForFormat,
  summarizeRejections: summarizeSparPdfRejections,
} = require('./sparOfficialFlyerPdfParser');
const {
  PARSER_VERSION: CATEGORY_PROMOTION_PARSER_VERSION,
  SOURCE_TYPE: CATEGORY_PROMOTION_SOURCE_TYPE,
  extractAndNormalizeOfficialCategoryPromotions,
  sourceKeyForActionSource,
} = require('./officialCategoryPromotionParser');
const {
  extractIssuuDocumentsFromHtml,
  resolveIssuuOriginalPdfUrl,
} = require('./issuuPdfResolver');
const { normalizeImageUrl } = require('../images/imageUrl');
const logger = require('../../lib/logger');

const PARSER_VERSION = 'official-v3-coverage';
const DM_CONTENT_PATH = 'https://content.services.dmtech.com/rootpage-dm-shop-de-at/ausverkauf';
const DM_PRODUCT_SEARCH_URL = 'https://product-search.services.dmtech.com/at/search';
const DM_SALE_PAGE_SIZE = 48;
const DM_SALE_MAX_PAGES = 20;
const DM_SALE_PAGE_DELAY_MS = 300;
const PENNY_PRODUCT_GROUP_PAGE_SIZE = 100;
const PENNY_PRODUCT_GROUP_MAX_PAGES = 10;
const HOFER_OFFICIAL_OFFER_PAGES = [
  'https://www.hofer.at/de/angebote/angebote-im-ueberblick.html?productState=In+der+Filiale+erh%C3%A4ltlich',
  'https://www.hofer.at/de/angebote/aktionen.html',
  'https://www.hofer.at/de/angebote/hofer-preiswochen.html',
  'https://www.hofer.at/de/angebote/hofer-preis-dauerhaft-guenstiger.html',
  'https://www.hofer.at/de/angebote/technik-und-haushalt.html',
  'https://www.hofer.at/de/angebote/handys-und-router.html',
];
const LIDL_OFFICIAL_CAMPAIGN_PAGES = [
  'https://www.lidl.at/c/mega-deals/s10091719',
  'https://www.lidl.at/c/aktion/a10095240',
  'https://www.lidl.at/c/frische-angebote/a10095239',
  'https://www.lidl.at/c/jeden-tag-deine-guenstigen-preise/a10095237',
  'https://www.lidl.at/c/blumen-pflanzen/a10095234',
  'https://www.lidl.at/c/super-frische/s10013062',
  'https://www.lidl.at/c/mit-jedem-bissen-kurzurlaub-machen/a10095235',
  'https://www.lidl.at/c/beim-grillen-richtig-kohle-sparen/a10095236',
];
const LIDL_CAMPAIGN_PAGE_LIMIT = 14;
const FETCH_DIAGNOSTIC_PREVIEW_LIMIT = 260;

function responseContentType(response = {}) {
  return response.headers?.['content-type'] || response.headers?.['Content-Type'] || '';
}

function bodyPreview(value, limit = 300) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function responseBodyAsText(payload) {
  if (Buffer.isBuffer(payload)) {
    return payload.toString('utf8');
  }

  if (typeof payload === 'string') {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    return JSON.stringify(payload);
  }

  return String(payload || '');
}

function htmlTitleFromBody(payload) {
  const text = responseBodyAsText(payload);

  if (!text) {
    return '';
  }

  try {
    return sanitizeWhitespace(cheerio.load(text)('title').text()).slice(0, 160);
  } catch (error) {
    return '';
  }
}

function isTlsLikeError(error = {}) {
  return /CERT|TLS|SSL|LEAF|certificate|unable to verify/i.test(`${error.code || ''} ${error.message || ''}`);
}

function buildFetchDiagnostic(url, error = {}) {
  const response = error.response || {};
  const data = response.data;
  const contentType = responseContentType(response);
  const preview = bodyPreview(data || error.message, FETCH_DIAGNOSTIC_PREVIEW_LIMIT);
  const title = htmlTitleFromBody(data);
  const status = response.status ?? null;

  return {
    failureStage: 'fetch',
    url,
    finalUrl: response.request?.res?.responseUrl || response.config?.url || url,
    httpStatus: status,
    statusText: response.statusText || '',
    contentType,
    downloadBytes: data ? Buffer.byteLength(responseBodyAsText(data), 'utf8') : 0,
    errorCode: error.code || '',
    errorMessage: bodyPreview(error.message, 220),
    tlsLike: isTlsLikeError(error),
    isHtml: isHtmlPayload(data || '', contentType),
    isJson: isJsonPayload(data, contentType),
    htmlTitle: title,
    blockedLikely: [401, 403, 407, 429, 451].includes(Number(status))
      || /just a moment|cloudflare|attention required|cf-browser-verification|cf-chl/i.test(`${title} ${preview}`),
    bodyPreview: preview,
  };
}

function attachFetchDiagnostic(error, url) {
  error.diagnostic = {
    ...(error.diagnostic || {}),
    ...buildFetchDiagnostic(url, error),
  };
  return error;
}

function isHtmlPayload(payload, contentType = '') {
  return /html/i.test(contentType) || (typeof payload === 'string' && /^\s*<!doctype html|^\s*<html[\s>]/i.test(payload));
}

function isJsonPayload(payload, contentType = '') {
  return /json/i.test(contentType) && payload && typeof payload === 'object' && !Buffer.isBuffer(payload);
}

function buildDmEndpointDiagnostic({ url, response = {}, payload, canonicalUrl }) {
  const contentType = responseContentType(response);

  return {
    url,
    finalUrl: canonicalUrl || response.request?.res?.responseUrl || response.config?.url || url,
    httpStatus: response.status ?? null,
    contentType,
    bodyPreview: bodyPreview(payload),
    isJson: isJsonPayload(payload, contentType),
    isHtml: isHtmlPayload(payload, contentType),
  };
}

function buildDmNetworkDiagnostic(url, error) {
  return {
    url,
    finalUrl: url,
    httpStatus: error.response?.status ?? null,
    contentType: responseContentType(error.response || {}),
    bodyPreview: bodyPreview(error.response?.data || error.message),
    isJson: isJsonPayload(error.response?.data, responseContentType(error.response || {})),
    isHtml: isHtmlPayload(error.response?.data || '', responseContentType(error.response || {})),
    error: error.message,
  };
}

function createDmEndpointError(message, diagnostic) {
  const error = new Error(message);
  error.diagnostic = diagnostic;
  return error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAbsoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch (error) {
    return '';
  }
}

function createHash(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value || '')).digest('hex');
}

function parseNumericAmount(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(
    String(value)
      .replace(/[^\d,.-]+/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')
  );

  return Number.isFinite(numeric) ? numeric : null;
}

function extractRelevantLinks({ html, baseUrl, retailerKey }) {
  const $ = cheerio.load(html);
  const links = [];
  const seen = new Set();

  function pushLink(url, label, type) {
    const normalizedUrl = sanitizeWhitespace(url);

    if (!normalizedUrl || seen.has(normalizedUrl)) {
      return;
    }

    seen.add(normalizedUrl);
    links.push({
      url: normalizedUrl,
      label: sanitizeWhitespace(label) || normalizedUrl,
      type,
    });
  }

  $('a[href]').each((index, element) => {
    const href = $(element).attr('href');
    const text = sanitizeWhitespace($(element).text());
    const absoluteUrl = toAbsoluteUrl(href, baseUrl);
    const haystack = `${absoluteUrl} ${text}`.toLowerCase();

    if (!absoluteUrl.startsWith('http')) {
      return;
    }

    if (/\.(pdf)(\?|$)/i.test(absoluteUrl)) {
      pushLink(absoluteUrl, text, 'pdf');
      return;
    }

    if (/(flugblatt|aktionen|angebote|prospekt|broschuere|download|blaettern|blättern)/i.test(haystack)) {
      pushLink(absoluteUrl, text, 'page');
    }
  });

  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]+)?/gi)) {
    pushLink(match[0], match[0], 'pdf');
  }

  if (retailerKey === 'spar') {
    const regionalFirst = links.filter((item) => /steiermark|graz/i.test(`${item.url} ${item.label}`));
    const fallback = links.filter((item) => !regionalFirst.includes(item));
    return [...regionalFirst, ...fallback].slice(0, 25);
  }

  return links.slice(0, 25);
}

function parseDateFromText(value) {
  const match = String(value || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);

  if (!match) {
    return null;
  }

  const [day, month, year] = match.slice(1).map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function parseHoferDateFromUrl(url) {
  const match = String(url || '').match(/\/d\.(\d{2})-(\d{2})-(\d{4})\.html/i);

  if (!match) {
    return null;
  }

  const [day, month, year] = match.slice(1).map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function addDays(date, days) {
  if (!date) {
    return null;
  }

  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function endOfUtcDay(date) {
  if (!date) {
    return null;
  }

  const copy = new Date(date);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}

function buildOfferStatus(validFrom, validTo, snapshotCurrent = false) {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  let status = 'unknown';

  if (snapshotCurrent) {
    status = 'active';
  } else if (validFrom && validFrom > now) {
    status = 'upcoming';
  } else if (validTo && validTo < now) {
    status = 'expired';
  } else if ((validFrom || validTo) && (!validFrom || validFrom <= now) && (!validTo || validTo >= now)) {
    status = 'active';
  }

  return {
    status,
    isActiveNow: status === 'active',
    isActiveToday:
      status === 'active'
      || ((!validFrom || validFrom <= endOfToday) && (!validTo || validTo >= startOfToday)),
  };
}

function parseDateWithWeekday(value) {
  const match = String(value || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);

  if (!match) {
    return null;
  }

  const [day, month, year] = match.slice(1).map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function normalizeUnitFromText(value) {
  const normalized = normalizeTitleForMatch(value);

  if (/stuck|stueck|stk/.test(normalized)) {
    return 'Stk';
  }

  if (/(kilogramm|kg)/.test(normalized)) {
    return 'kg';
  }

  if (/(liter| l )/.test(` ${normalized} `)) {
    return 'l';
  }

  if (/(milliliter| ml )/.test(` ${normalized} `)) {
    return 'ml';
  }

  if (/(gramm| g )/.test(` ${normalized} `)) {
    return 'g';
  }

  return '';
}

function buildOfficialNormalizedUnitPrice({ priceAmount, quantityText }) {
  const normalizedQuantityText = normalizeTitleForMatch(quantityText);
  const directPerMatch = normalizedQuantityText.match(/per\s+(stuck|stueck|stk|kg|kilogramm|l|liter|ml|milliliter|g|gramm)/);

  if (directPerMatch) {
    const unit = normalizeUnitFromText(directPerMatch[1]);

    if (unit === 'Stk') {
      return {
        amount: priceAmount,
        unit,
        comparable: true,
        confidence: 0.84,
      };
    }

    if (['kg', 'l'].includes(unit)) {
      return {
        amount: priceAmount,
        unit,
        comparable: true,
        confidence: 0.8,
      };
    }
  }

  const quantityMatch = normalizedQuantityText.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilogramm|g|gramm|l|liter|ml|milliliter)/);

  if (!quantityMatch) {
    return {
      amount: null,
      unit: '',
      comparable: false,
      confidence: 0,
    };
  }

  let quantity = Number(quantityMatch[1].replace(',', '.'));
  let unit = normalizeUnitFromText(quantityMatch[2]);

  if (!quantity || !unit) {
    return {
      amount: null,
      unit: '',
      comparable: false,
      confidence: 0,
    };
  }

  if (unit === 'g') {
    quantity /= 1000;
    unit = 'kg';
  }

  if (unit === 'ml') {
    quantity /= 1000;
    unit = 'l';
  }

  if (quantity <= 0 || !['kg', 'l'].includes(unit)) {
    return {
      amount: null,
      unit: '',
      comparable: false,
      confidence: 0,
    };
  }

  return {
    amount: Number((priceAmount / quantity).toFixed(2)),
    unit,
    comparable: true,
    confidence: 0.86,
  };
}

function buildUnitPriceFromLabel(label, currentPrice) {
  const text = sanitizeWhitespace(label);
  const slashUnitMatch = text.match(/([\d,.]+)\s*\/\s*(?:(\d+(?:[.,]\d+)?)\s*)?(kg|kilogramm|g|gramm|l|liter|ml|milliliter|stuck|stueck|stk|waschgang)\b/i);
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:per\s+)?(kg|kilogramm|g|gramm|l|liter|ml|milliliter|stuck|stueck|stk|waschgang)\s*(?:=|:)?\s*(?:€|eur)?\s*([\d,.]+)/i);

  if (!match && slashUnitMatch) {
    let amount = parseNumericAmount(slashUnitMatch[1]);
    const basisQuantity = parseNumericAmount(slashUnitMatch[2] || '1') || 1;
    const unit = normalizeUnitFromText(slashUnitMatch[3]);
    const comparableUnit = unit === 'g' ? 'kg' : unit === 'ml' ? 'l' : unit;

    if (amount && unit === 'g') {
      amount = Number((amount * (1000 / basisQuantity)).toFixed(2));
    }

    if (amount && unit === 'ml') {
      amount = Number((amount * (1000 / basisQuantity)).toFixed(2));
    }

    return {
      amount,
      unit: comparableUnit || unit,
      comparable: Boolean(amount && ['kg', 'l', 'Stk'].includes(comparableUnit || unit)),
      confidence: amount ? 0.88 : 0,
    };
  }

  if (!match) {
    return buildOfficialNormalizedUnitPrice({
      priceAmount: currentPrice,
      quantityText: text,
    });
  }

  const basisQuantity = parseNumericAmount(match[1]);
  let amount = parseNumericAmount(match[3]);
  const unit = normalizeUnitFromText(match[2]);
  const comparableUnit = unit === 'g' ? 'kg' : unit === 'ml' ? 'l' : unit;

  if (amount && basisQuantity && unit === 'g') {
    amount = Number((amount * (1000 / basisQuantity)).toFixed(2));
  }

  if (amount && basisQuantity && unit === 'ml') {
    amount = Number((amount * (1000 / basisQuantity)).toFixed(2));
  }

  return {
    amount,
    unit: comparableUnit || unit,
    comparable: Boolean(amount && ['kg', 'l', 'Stk'].includes(comparableUnit || unit)),
    confidence: amount ? 0.9 : 0,
  };
}

function extractEuroPriceTexts(value) {
  const text = sanitizeWhitespace(value);
  const matches = [];

  for (const match of text.matchAll(/(?:\u20ac\s*(\d+(?:[,.]\d{1,2})?)|(\d+(?:[,.]\d{1,2})?)\s*\u20ac)/g)) {
    const originalText = sanitizeWhitespace(match[0]);
    const amount = parseNumericAmount(match[1] || match[2]);

    if (amount) {
      matches.push({ amount, originalText });
    }
  }

  return matches;
}

function extractUnitPriceTextFromText(value) {
  const text = sanitizeWhitespace(value);
  const match = text.match(/(?:100\s*(?:g|ml)|1\s*(?:kg|l|Stk|stueck|stuck|waschgang))\s+\d+(?:[,.]\d+)/i);
  return sanitizeWhitespace(match?.[0] || '');
}

function extractImageUrl(card) {
  const imageCandidates = [
    ['.at-product-images_img', 'data-src'],
    ['.at-product-images_img', 'data-srcset'],
    ['.at-product-images_img', 'srcset'],
    ['.at-product-images_img', 'data-original'],
    ['.at-product-images_img', 'data-lazy-src'],
    ['.at-product-images_img', 'src'],
    ['picture source', 'srcset'],
    ['picture source', 'data-srcset'],
    ['picture source', 'data-src'],
    ['source', 'srcset'],
    ['source', 'data-srcset'],
    ['source', 'data-src'],
    ['img', 'data-src'],
    ['img', 'data-srcset'],
    ['img', 'srcset'],
    ['img', 'data-original'],
    ['img', 'data-lazy-src'],
    ['img', 'src'],
  ];

  for (const [selector, attribute] of imageCandidates) {
    const value = sanitizeWhitespace(card.find(selector).first().attr(attribute));

    if (value) {
      return value;
    }
  }

  return '';
}

function extractHoferProductUrl(card, pageUrl) {
  const href = sanitizeWhitespace(card.closest('a[href]').attr('href') || card.find('a[href]').first().attr('href'));
  const absoluteUrl = href ? toAbsoluteUrl(href, pageUrl) : '';

  if (!/hofer\.at\/de\/p\./i.test(absoluteUrl)) {
    return '';
  }

  return absoluteUrl;
}

function extractHoferAvailabilityDate(cardText) {
  const match = String(cardText || '').match(/verf(?:\u00fc|ue)gbar\s+ab\s+(\d{2})\.(\d{2})\.(\d{4})/i);

  if (!match) {
    return null;
  }

  const [day, month, year] = match.slice(1).map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function isHoferSoldOutCard(cardText) {
  return /\bausverkauft\b/i.test(String(cardText || ''));
}

function isHoferOfferPageUrl(url) {
  const value = String(url || '');
  return /\/de\/angebote\/(?:d\.\d{2}-\d{2}-\d{4}|angebote-im-ueberblick|aktionen|hofer-preiswochen|hofer-preis-dauerhaft-guenstiger|technik-und-haushalt|handys-und-router)\.html/i.test(value);
}

function hoferPageOfferContext(url) {
  const value = String(url || '');

  if (/\/de\/angebote\/d\.\d{2}-\d{2}-\d{4}\.html/i.test(value)) {
    return 'dated-offers';
  }

  if (/\/de\/angebote\/angebote-im-ueberblick\.html/i.test(value)) {
    return 'offers-overview';
  }

  if (/\/de\/angebote\/aktionen\.html/i.test(value)) {
    return 'hofer-actions';
  }

  if (/\/de\/angebote\/hofer-preiswochen\.html/i.test(value)) {
    return 'hofer-preiswochen';
  }

  if (/\/de\/angebote\/hofer-preis-dauerhaft-guenstiger\.html/i.test(value)) {
    return 'hofer-preis-dauerhaft-guenstiger';
  }

  if (/\/de\/angebote\/technik-und-haushalt\.html/i.test(value)) {
    return 'technik-und-haushalt';
  }

  if (/\/de\/angebote\/handys-und-router\.html/i.test(value)) {
    return 'handys-und-router';
  }

  return 'unknown';
}

function extractHoferCards($, pageContext) {
  if (pageContext === 'hofer-actions') {
    return $('.gallery .wrapper')
      .filter((index, element) => {
        const text = sanitizeWhitespace($(element).text());
        return !/{{/.test(text) && /(?:€|\beur\b|\bstatt\b|\d+[,.]\d{2})/i.test(text);
      });
  }

  return $('.plp_product');
}

function extractHoferCardTitle(card, pageContext) {
  if (pageContext === 'hofer-actions') {
    return sanitizeWhitespace(card.find('h3').first().text());
  }

  return sanitizeWhitespace(card.find('.product-title').text());
}

function extractHoferCurrentPrice(card, cardText, pageContext) {
  if (pageContext !== 'hofer-actions') {
    return parseNumericAmount(card.find('.at-product-price_lbl').text());
  }

  const euroMatch = String(cardText || '').match(/€\s*([\d,.]+)/i);
  return parseNumericAmount(euroMatch?.[1] || '');
}

function extractHoferOldPrice(card, cardText, pageContext) {
  if (pageContext !== 'hofer-actions') {
    return parseNumericAmount(card.find('.price_before').text());
  }

  const oldPriceMatch = String(cardText || '').match(/\bstatt\s*(?:€\s*)?([\d,.]+)/i);
  return parseNumericAmount(oldPriceMatch?.[1] || '');
}

function extractHoferAdditionalInfo(card, cardText, pageContext) {
  if (pageContext !== 'hofer-actions') {
    return sanitizeWhitespace(card.find('.additional-product-info').text());
  }

  const title = extractHoferCardTitle(card, pageContext);
  return sanitizeWhitespace(String(cardText || '').replace(title, ''));
}

function parseHoferActionDateRange(pageText) {
  const text = sanitizeWhitespace(pageText);
  const rangeMatch = text.match(/(?:Mo|Di|Mi|Do|Fr|Sa|So)\.\s*(\d{1,2})\.(\d{1,2})\.\s*(?:bis|und)\s*(?:(?:Mo|Di|Mi|Do|Fr|Sa|So)\.\s*)?(\d{1,2})\.(\d{1,2})\./i);

  if (!rangeMatch) {
    return null;
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const [, fromDay, fromMonth, toDay, toMonth] = rangeMatch.map(Number);
  let validFrom = new Date(Date.UTC(year, fromMonth - 1, fromDay, 12, 0, 0));
  let validTo = endOfUtcDay(new Date(Date.UTC(year, toMonth - 1, toDay, 12, 0, 0)));

  if (validTo < validFrom) {
    validTo = endOfUtcDay(new Date(Date.UTC(year + 1, toMonth - 1, toDay, 12, 0, 0)));
  }

  return { validFrom, validTo, validityText: rangeMatch[0] };
}

function extractHoferActionValidity(card, $) {
  let node = card;

  for (let depth = 0; depth < 8; depth += 1) {
    const headingText = sanitizeWhitespace(node.prevAll('h1,h2,h3').first().text());
    const parsed = parseHoferActionDateRange(headingText);

    if (parsed) {
      return parsed;
    }

    const previousSiblings = node.prevAll().toArray();

    for (const sibling of previousSiblings) {
      const siblingNode = $(sibling);
      const siblingHeadings = [];

      if (/^h[1-3]$/i.test(siblingNode.prop('tagName') || '')) {
        siblingHeadings.push(sanitizeWhitespace(siblingNode.text()));
      }

      siblingNode.find('h1,h2,h3').each((index, heading) => {
        siblingHeadings.push(sanitizeWhitespace($(heading).text()));
      });

      for (const candidate of siblingHeadings) {
        const candidateParsed = parseHoferActionDateRange(candidate);

        if (candidateParsed) {
          return candidateParsed;
        }
      }
    }

    node = node.parent();

    if (!node?.length) {
      break;
    }
  }

  return null;
}

function extractHoferConditionsText({ cardText, pageContext, validTo }) {
  const snippets = [];

  if (/aktion nicht in allen filialen/i.test(cardText)) {
    snippets.push('Aktion nicht in allen Filialen gueltig.');
  }

  if (/nur regional erh(?:ä|ae)ltlich/i.test(cardText)) {
    snippets.push('Dieser Artikel ist nur regional erhaeltlich.');
  }

  if (/ausgew(?:ä|ae)hlten filialen/i.test(cardText)) {
    snippets.push('Nur in ausgewaehlten Filialen erhaeltlich.');
  }

  if (/pfand/i.test(cardText)) {
    snippets.push('Pfandhinweis aus Quelle vorhanden.');
  }

  if (pageContext === 'hofer-preis-dauerhaft-guenstiger') {
    snippets.push('Offizielle HOFER Dauerpreis-Seite; kein befristetes Enddatum erkannt.');
  }

  if (!validTo) {
    snippets.push('Aktuell gefunden - bitte im Markt pruefen.');
  }

  return [...new Set(snippets)].join(' ');
}

function extractHoferProductId({ card, productUrl, imageUrl }) {
  return sanitizeWhitespace(
    card.attr('data-productid')
    || productUrl.match(/\.([0-9]{10,})\.html/i)?.[1]
    || imageUrl.match(/\/([A-Za-z0-9_-]+)(?:\?|$)/)?.[1]
    || ''
  );
}

function buildHoferDedupeKey({ title, currentPrice, productUrl, productId, quantityText }) {
  const priceKey = Number(currentPrice || 0).toFixed(2);

  if (productId) {
    return `hofer::product::${normalizeTitleForMatch(productId)}::${priceKey}`;
  }

  if (productUrl) {
    return `hofer::url::${normalizeTitleForMatch(productUrl)}::${priceKey}`;
  }

  return [
    'hofer',
    'title',
    normalizeTitleForMatch(title).split(' ').slice(0, 10).join('-'),
    normalizeTitleForMatch(quantityText).split(' ').slice(0, 8).join('-'),
    priceKey,
  ].join('::');
}

function hoferOfferPreferenceScore(offer) {
  let score = 0;
  const pageContext = offer?.rawFacts?.pageContext || '';

  if (offer?.validTo) score += 30;
  if (offer?.validFrom) score += 10;
  if (offer?.priceReference?.amount) score += 8;
  if (offer?.productUrl || offer?.sourceUrl?.includes('/de/p.')) score += 6;
  if (pageContext === 'dated-offers') score += 12;
  if (pageContext === 'hofer-actions') score += 10;
  if (pageContext === 'offers-overview') score -= 2;

  return score;
}

function dedupeHoferOffers(offers = [], diagnostics) {
  const unique = [];
  const keyToIndex = new Map();
  let duplicateCount = 0;

  offers.forEach((offer) => {
    const key = offer?.dedupeKey;

    if (!key) {
      unique.push(offer);
      return;
    }

    const duplicateIndex = keyToIndex.get(key);

    if (duplicateIndex === undefined) {
      keyToIndex.set(key, unique.length);
      unique.push(offer);
      return;
    }

    duplicateCount += 1;

    if (hoferOfferPreferenceScore(offer) > hoferOfferPreferenceScore(unique[duplicateIndex])) {
      unique[duplicateIndex] = offer;
    }
  });

  if (diagnostics && duplicateCount > 0) {
    diagnostics.skipReasons = diagnostics.skipReasons || {};
    diagnostics.skipReasons.duplicate = (diagnostics.skipReasons.duplicate || 0) + duplicateCount;
    diagnostics.dedupedOffers = duplicateCount;
  }

  return unique;
}

function extractNonPlaceholderImageUrl(card) {
  const imageUrl = sanitizeWhitespace(extractImageUrl(card));

  return /^data:/i.test(imageUrl) ? '' : imageUrl;
}

function decodeHtmlEntities(value) {
  return sanitizeWhitespace(cheerio.load(`<span>${String(value || '')}</span>`)('span').text());
}

function extractLidlFlyerIdentifiers(html) {
  const $ = cheerio.load(html);
  const identifiers = new Set();

  $('a[href*="/l/de/flugblatt/"]').each((index, element) => {
    const href = sanitizeWhitespace($(element).attr('href'));
    const match = href.match(/\/l\/de\/flugblatt\/([^/]+)\/ar\/\d+/i);

    if (match?.[1]) {
      identifiers.add(match[1]);
    }
  });

  return [...identifiers];
}

function parseLidlFlyerDate(value) {
  const match = String(value || '').match(/(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match.map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function parseLidlStoreTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 100000000000 ? numeric * 1000 : numeric)
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function buildLidlDedupeKey({ productId = '', productUrl = '', title = '', brand = '', quantityText = '', currentPrice = null }) {
  const priceKey = Number(currentPrice || 0).toFixed(2);
  const normalizedProductId = sanitizeWhitespace(productId);

  if (normalizedProductId) {
    return `lidl::product::${normalizeTitleForMatch(normalizedProductId)}::${priceKey}`;
  }

  if (productUrl) {
    return `lidl::url::${normalizeTitleForMatch(productUrl)}::${priceKey}`;
  }

  return [
    'lidl',
    'title',
    normalizeTitleForMatch(`${brand} ${title}`).split(' ').slice(0, 10).join('-'),
    normalizeTitleForMatch(quantityText).split(' ').slice(0, 8).join('-'),
    priceKey,
  ].join('::');
}

function buildLidlNormalizedUnitPrice(description, currentPrice) {
  const text = normalizeTitleForMatch(decodeHtmlEntities(description));
  const perUnitMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(eur|euro)?\s*\/\s*(kg|kilogramm|l|liter|stk|stueck|stuck)/i);

  if (perUnitMatch) {
    return {
      amount: parseNumericAmount(perUnitMatch[1]),
      unit: normalizeUnitFromText(perUnitMatch[3]),
      comparable: Boolean(parseNumericAmount(perUnitMatch[1])),
      confidence: 0.9,
    };
  }

  return buildOfficialNormalizedUnitPrice({
    priceAmount: currentPrice,
    quantityText: decodeHtmlEntities(description),
  });
}

function extractLidlQuantityText(description) {
  const text = decodeHtmlEntities(description);
  const quantityMatch = text.match(
    /(\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl|stk|stueck|stuck)|\d+\s*x\s*\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl))/i
  );

  return sanitizeWhitespace(quantityMatch?.[1] || '');
}

function buildLidlSiteNormalizedUnitPrice(basePriceText, currentPrice) {
  const text = sanitizeWhitespace(basePriceText);

  if (/\bje\s+Stk\.?\b|\bje\s+Stueck\b|\bje\s+Stuck\b/i.test(text)) {
    return {
      amount: currentPrice,
      unit: 'Stk',
      comparable: Boolean(currentPrice),
      confidence: currentPrice ? 0.84 : 0,
    };
  }

  const explicitMatch = text.match(/\((?:\d+(?:[.,]\d+)?\s*)?(kg|kilogramm|g|gramm|l|liter|ml|milliliter|stk|stueck|stuck)\s*=\s*(\d+(?:[.,]\d+)?)\)/i)
    || text.match(/(?:\d+(?:[.,]\d+)?\s*)?(kg|kilogramm|g|gramm|l|liter|ml|milliliter|stk|stueck|stuck)\s*=\s*(\d+(?:[.,]\d+)?)/i);

  if (explicitMatch) {
    const unit = normalizeUnitFromText(explicitMatch[1]);
    const amount = parseNumericAmount(explicitMatch[2]);
    const comparableUnit = unit === 'g' ? 'kg' : unit === 'ml' ? 'l' : unit;

    return {
      amount,
      unit: comparableUnit || unit,
      comparable: Boolean(amount && ['kg', 'l', 'Stk'].includes(comparableUnit || unit)),
      confidence: amount ? 0.9 : 0,
    };
  }

  return buildUnitPriceFromLabel(text, currentPrice);
}

function extractLidlSiteQuantityText(basePriceText) {
  const text = sanitizeWhitespace(basePriceText);
  const multiMatch = text.match(/(\d+\s*x\s*\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl|stk|stueck|stuck))/i);
  const singleMatch = text.match(/(?:Je|Z\.B\.:|je)\s*(\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl|stk|stueck|stuck))/i)
    || text.match(/Ab\s+\d+\s*Stk\.\s*je\s*(\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl|stk|stueck|stuck))/i)
    || text.match(/^(\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl|stk|stueck|stuck))/i);

  return sanitizeWhitespace(multiMatch?.[1] || singleMatch?.[1] || '');
}

function parseLidlGridDataCardsFromHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const cards = [];

  $('[data-grid-data]').each((index, element) => {
    const raw = $(element).attr('data-grid-data');

    try {
      const product = JSON.parse(raw || '{}');
      cards.push({
        product,
        pageUrl,
      });
    } catch (error) {
      cards.push({
        product: null,
        pageUrl,
        parseError: error.message,
      });
    }
  });

  return cards;
}

function isLidlCampaignPageUrl(url) {
  const value = String(url || '');

  return /https:\/\/www\.lidl\.at\/c\/(?!flugblatt\/|sortiment\/|shop\/)[a-z0-9-]+\/[as]\d+/i.test(value);
}

function extractLidlCampaignPageLinksFromHtml(html, baseUrl = 'https://www.lidl.at/') {
  const $ = cheerio.load(html || '');
  const links = [];
  const seen = new Set();

  function push(url) {
    const absoluteUrl = toAbsoluteUrl(url, baseUrl);
    const normalizedUrl = sanitizeWhitespace(absoluteUrl).replace(/#.*$/, '');

    if (!normalizedUrl || seen.has(normalizedUrl) || !isLidlCampaignPageUrl(normalizedUrl)) {
      return;
    }

    seen.add(normalizedUrl);
    links.push(normalizedUrl);
  }

  $('a[href]').each((index, element) => {
    push($(element).attr('href'));
  });

  for (const match of String(html || '').matchAll(/https:\/\/www\.lidl\.at\/c\/[a-z0-9-]+\/[as]\d+(?:[/?#][^\s"'<>]*)?/gi)) {
    push(match[0]);
  }

  return links;
}

function getLidlCampaignPagesForCrawl({ html, source }) {
  const configuredSeeds = Array.isArray(source?.crawlPolicy?.campaignSeedUrls) && source.crawlPolicy.campaignSeedUrls.length > 0
    ? source.crawlPolicy.campaignSeedUrls
    : LIDL_OFFICIAL_CAMPAIGN_PAGES;
  const discovered = extractLidlCampaignPageLinksFromHtml(html, source?.sourceUrl || 'https://www.lidl.at/');
  const pages = [];
  const seen = new Set();

  for (const url of [...discovered, ...configuredSeeds, ...LIDL_OFFICIAL_CAMPAIGN_PAGES]) {
    const normalizedUrl = sanitizeWhitespace(url).replace(/#.*$/, '');

    if (!normalizedUrl || seen.has(normalizedUrl) || !isLidlCampaignPageUrl(normalizedUrl)) {
      continue;
    }

    seen.add(normalizedUrl);
    pages.push(normalizedUrl);
  }

  return pages.slice(0, LIDL_CAMPAIGN_PAGE_LIMIT);
}

function normalizeLidlSiteProductToOffer({
  product,
  source,
  crawlJobId,
  region,
  pageUrl,
}) {
  const currentPrice = parseNumericAmount(product?.price?.price);
  const title = sanitizeWhitespace(product?.title || product?.fullTitle);
  const brand = sanitizeWhitespace(product?.brand?.showBrand === false ? '' : product?.brand?.name);
  const productUrl = product?.canonicalUrl ? toAbsoluteUrl(product.canonicalUrl, pageUrl || source.sourceUrl) : '';
  const imageUrl = normalizeImageUrl(
    product?.image || product?.imageList_V1?.[0]?.image || '',
    productUrl || pageUrl || source.sourceUrl
  );
  const basePriceText = sanitizeWhitespace(product?.price?.basePrice?.text);
  const discountText = sanitizeWhitespace(product?.price?.discount?.discountText);
  const quantityText = extractLidlSiteQuantityText(basePriceText);
  const normalizedUnitPrice = buildLidlSiteNormalizedUnitPrice(basePriceText || quantityText, currentPrice);
  const validFrom = parseLidlStoreTimestamp(product?.storeStartDate);
  const validTo = parseLidlStoreTimestamp(product?.storeEndDate);
  const statusInfo = buildOfferStatus(validFrom, validTo, !validFrom && !validTo);
  const customerProgramRequired = Boolean(product?.lidlPlus) || /lidl\s*plus/i.test(JSON.stringify(product || {}));
  const productId = sanitizeWhitespace(product?.productId || product?.itemId || product?.erpNumber);
  const conditions = [
    discountText,
    /^Ab\s+\d+/i.test(basePriceText) ? basePriceText : '',
    customerProgramRequired ? 'Nur gueltig mit Lidl Plus' : '',
    !validTo ? 'Aktuell gefunden - bitte im Markt pruefen.' : '',
  ].filter(Boolean);
  const conditionsText = sanitizeWhitespace([...new Set(conditions)].join('; '));
  const sourceCategory = sanitizeWhitespace([
    product?.productType,
    product?.productOrigin,
    pageUrl?.split('/c/')[1]?.split('/')[0],
  ].filter(Boolean).join(' '));
  const categoryPrimary = determineOfferCategory({
    title: sanitizeWhitespace(`${brand} ${title}`),
    contextText: [basePriceText, discountText, sourceCategory].filter(Boolean).join(' '),
    sourceCategory,
  });
  const issues = [];

  if (!title || !currentPrice) {
    return null;
  }

  if (!normalizedUnitPrice.comparable) {
    issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
  }

  if (!validTo) {
    issues.push('Gueltigkeitszeitraum unvollstaendig');
  }

  if (customerProgramRequired) {
    issues.push('Angebot erfordert Kundenprogramm oder App');
  }

  const isMultiBuy = /(?:1\+1|2\s*fuer\s*1|gratis|ab\s+\d+\s*stk|\+\d+\s*(?:g|ml|kg|l)\s*gratis)/i.test(`${discountText} ${basePriceText}`);
  const comparisonSignature = normalizeTitleForMatch(`${brand} ${title}`).split(' ').slice(0, 8).join('-');
  const comparisonQuantityKey = quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '';
  const comparisonCategoryKey = normalizeTitleForMatch(sourceCategory || categoryPrimary).replace(/[^a-z0-9]+/g, '-');

  const overrideResult = applyManualCategoryOverridesToOfferSync({
    crawlJobId,
    sourceId: source._id,
    retailerKey: source.retailerKey,
    retailerName: source.retailerName,
    region,
    title,
    brand,
    categoryPrimary,
    categorySecondary: determineOfferSubcategory({
      primaryCategory: categoryPrimary,
      sourceCategory,
      fallbackLabel: categoryPrimary,
      title,
      contextText: `${basePriceText} ${discountText}`,
    }),
    comparisonSignature,
    comparisonQuantityKey,
    comparisonCategoryKey,
    comparisonGroup: normalizedUnitPrice.comparable
      ? `${comparisonCategoryKey}:${comparisonSignature}:${comparisonQuantityKey}`
      : '',
    description: sanitizeWhitespace([brand, title, basePriceText, discountText].filter(Boolean).join(' ')),
    sourceUrl: productUrl || pageUrl || source.sourceUrl,
    imageUrl,
    supportingSources: [
      buildSourceEvidence({
        source,
        observedUrl: productUrl || pageUrl || source.sourceUrl,
        matchType: 'primary',
      }),
    ],
    validFrom,
    validTo,
    status: statusInfo.status,
    isActiveNow: statusInfo.isActiveNow,
    isActiveToday: statusInfo.isActiveToday,
    benefitType: customerProgramRequired ? 'conditional-price' : isMultiBuy ? 'multi-buy' : 'price-cut',
    conditionsText,
    customerProgramRequired,
    availabilityScope: region || 'Grossraum Graz',
    priceCurrent: {
      amount: currentPrice,
      currency: product?.price?.currencyCode || 'EUR',
      originalText: `${currentPrice.toFixed(2)} EUR`,
    },
    priceReference: {
      amount: parseNumericAmount(product?.price?.oldPrice || product?.price?.discount?.deletedPrice),
      currency: product?.price?.currencyCode || 'EUR',
      originalText: parseNumericAmount(product?.price?.oldPrice || product?.price?.discount?.deletedPrice)
        ? `${parseNumericAmount(product?.price?.oldPrice || product?.price?.discount?.deletedPrice).toFixed(2)} EUR`
        : '',
    },
    priceReferenceSource: product?.price?.oldPrice || product?.price?.discount?.deletedPrice ? 'prospect' : '',
    priceReferenceConfidence: product?.price?.oldPrice || product?.price?.discount?.deletedPrice ? 0.95 : 0,
    quantityText,
    normalizedUnitPrice,
    dedupeKey: buildLidlDedupeKey({
      productId,
      productUrl,
      title,
      brand,
      quantityText,
      currentPrice,
    }),
    quality: {
      completenessScore: [currentPrice, validFrom, validTo, categoryPrimary].filter(Boolean).length / 4,
      parsingConfidence: normalizedUnitPrice.comparable ? 0.88 : 0.76,
      comparisonSafe: normalizedUnitPrice.comparable,
      issues,
    },
    rawFacts: {
      sourceType: 'lidl-official-html',
      pageContext: 'lidl-campaign-page',
      pageUrl,
      validityText: [validFrom?.toISOString?.(), validTo?.toISOString?.()].filter(Boolean).join(' - '),
      validityLabel: validTo ? '' : 'Aktuell gefunden - bitte im Markt pruefen.',
      infoText: sanitizeWhitespace([basePriceText, discountText].filter(Boolean).join(' / ')),
      basePriceText,
      discountText,
      productId,
      itemId: sanitizeWhitespace(product?.itemId),
      erpNumber: sanitizeWhitespace(product?.erpNumber),
      productUrl,
      snapshotCurrent: !validTo,
    },
    adminReview: {
      status: issues.length > 0 ? 'pending' : 'reviewed',
      note: conditionsText,
      feedbackDigest: '',
    },
    scope: buildInclusiveScopeDecision(),
  });

  return overrideResult.offer || null;
}

function parseLidlOfficialSiteOffersFromHtml({
  html,
  source,
  crawlJobId,
  region,
  pageUrl,
  diagnostics,
}) {
  const cards = parseLidlGridDataCardsFromHtml(html, pageUrl);
  const offers = [];
  const skipReasons = {};

  for (const card of cards) {
    if (!card.product) {
      skipReasons['invalid-grid-json'] = (skipReasons['invalid-grid-json'] || 0) + 1;
      continue;
    }

    const currentPrice = parseNumericAmount(card.product?.price?.price);
    const title = sanitizeWhitespace(card.product?.title || card.product?.fullTitle);
    const validFrom = parseLidlStoreTimestamp(card.product?.storeStartDate);
    const validTo = parseLidlStoreTimestamp(card.product?.storeEndDate);
    const statusInfo = buildOfferStatus(validFrom, validTo, !validFrom && !validTo);

    if (!title) {
      skipReasons['missing-title'] = (skipReasons['missing-title'] || 0) + 1;
      continue;
    }

    if (!currentPrice) {
      skipReasons['missing-current-price'] = (skipReasons['missing-current-price'] || 0) + 1;
      continue;
    }

    if (statusInfo.status === 'expired' || statusInfo.status === 'upcoming') {
      skipReasons[`status-${statusInfo.status}`] = (skipReasons[`status-${statusInfo.status}`] || 0) + 1;
      continue;
    }

    const offer = normalizeLidlSiteProductToOffer({
      product: card.product,
      source,
      crawlJobId,
      region,
      pageUrl,
    });

    if (offer) {
      offers.push(offer);
    }
  }

  if (diagnostics) {
    diagnostics.rawCards = (diagnostics.rawCards || 0) + cards.length;
    diagnostics.parsedOffers = (diagnostics.parsedOffers || 0) + offers.length;
    diagnostics.skipReasons = {
      ...(diagnostics.skipReasons || {}),
    };
    Object.entries(skipReasons).forEach(([reason, count]) => {
      diagnostics.skipReasons[reason] = (diagnostics.skipReasons[reason] || 0) + count;
    });
    diagnostics.pages = diagnostics.pages || [];
    diagnostics.pages.push({
      url: pageUrl,
      rawCards: cards.length,
      parsedOffers: offers.length,
      skipReasons,
    });
  }

  return offers;
}

function lidlOfferPreferenceScore(offer) {
  let score = 0;

  if (offer?.validTo) score += 20;
  if (offer?.validFrom) score += 8;
  if (offer?.priceReference?.amount) score += 8;
  if (offer?.normalizedUnitPrice?.comparable) score += 6;
  if (offer?.rawFacts?.productUrl || offer?.sourceUrl?.includes('/p/')) score += 5;
  if (offer?.rawFacts?.sourceType === 'lidl-official-html') score += 4;

  return score;
}

function dedupeLidlOffers(offers = [], diagnostics) {
  const unique = [];
  const keyToIndex = new Map();
  let duplicateCount = 0;

  offers.forEach((offer) => {
    const key = offer?.dedupeKey || buildLidlDedupeKey({
      productId: offer?.rawFacts?.productId,
      productUrl: offer?.rawFacts?.productUrl || offer?.sourceUrl,
      title: offer?.title,
      brand: offer?.brand,
      quantityText: offer?.quantityText,
      currentPrice: offer?.priceCurrent?.amount,
    });

    if (!key) {
      unique.push(offer);
      return;
    }

    const duplicateIndex = keyToIndex.get(key);

    if (duplicateIndex === undefined) {
      keyToIndex.set(key, unique.length);
      unique.push({
        ...offer,
        dedupeKey: key,
      });
      return;
    }

    duplicateCount += 1;

    if (lidlOfferPreferenceScore(offer) > lidlOfferPreferenceScore(unique[duplicateIndex])) {
      unique[duplicateIndex] = {
        ...offer,
        dedupeKey: key,
      };
    }
  });

  if (diagnostics && duplicateCount > 0) {
    diagnostics.skipReasons = diagnostics.skipReasons || {};
    diagnostics.skipReasons.duplicate = (diagnostics.skipReasons.duplicate || 0) + duplicateCount;
    diagnostics.dedupedOffers = duplicateCount;
  }

  return unique;
}

function normalizeLidlProductToOffer({
  product,
  flyer,
  source,
  crawlJobId,
  region,
}) {
  const currentPrice = parseNumericAmount(product?.price);
  const title = sanitizeWhitespace(product?.title);
  const brand = sanitizeWhitespace(product?.brand);
  const description = decodeHtmlEntities(product?.description);
  const quantityText = extractLidlQuantityText(description);
  const normalizedUnitPrice = buildLidlNormalizedUnitPrice(description, currentPrice);
  const categoryPrimary = determineOfferCategory({
    title: sanitizeWhitespace(`${brand} ${title}`),
    contextText: [description, product?.wonCategoryPrimary, product?.categoryPrimary].filter(Boolean).join(' '),
    sourceCategory: product?.wonCategoryPrimary || product?.categoryPrimary || '',
  });
  const validFrom = parseLidlFlyerDate(flyer?.offerStartDate || flyer?.startDate);
  const validTo = parseLidlFlyerDate(flyer?.offerEndDate || flyer?.endDate);
  const statusInfo = buildOfferStatus(validFrom, validTo);
  const customerProgramRequired = /lidl plus/i.test(description);
  const issues = [];

  if (!title || !currentPrice) {
    return null;
  }

  if (!normalizedUnitPrice.comparable) {
    issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
  }

  if (!validFrom || !validTo) {
    issues.push('Gueltigkeitszeitraum unvollstaendig');
  }

  if (customerProgramRequired) {
    issues.push('Angebot erfordert Kundenprogramm oder App');
  }

  const overrideResult = applyManualCategoryOverridesToOfferSync({
    crawlJobId,
    sourceId: source._id,
    retailerKey: source.retailerKey,
    retailerName: source.retailerName,
    region,
    title,
    brand,
    categoryPrimary,
    categorySecondary: determineOfferSubcategory({
      primaryCategory: categoryPrimary,
      sourceCategory: product?.wonCategoryPrimary || product?.categoryPrimary || '',
      fallbackLabel: categoryPrimary,
      title,
      contextText: description,
    }),
    comparisonSignature: normalizeTitleForMatch(`${brand} ${title}`).split(' ').slice(0, 8).join('-'),
    comparisonQuantityKey: quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '',
    comparisonCategoryKey: normalizeTitleForMatch(product?.wonCategoryPrimary || categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
    description,
    sourceUrl: product?.url || source.sourceUrl,
    imageUrl: normalizeImageUrl(product?.image || '', product?.url || source.sourceUrl),
    supportingSources: [
      buildSourceEvidence({
        source,
        observedUrl: product?.url || flyer?.flyerUrlAbsolute || source.sourceUrl,
        matchType: 'primary',
      }),
    ],
    validFrom,
    validTo,
    status: statusInfo.status,
    isActiveNow: statusInfo.isActiveNow,
    isActiveToday: statusInfo.isActiveToday,
    benefitType: customerProgramRequired ? 'conditional-price' : 'price-cut',
    conditionsText: customerProgramRequired ? 'Nur gueltig mit Lidl Plus' : '',
    customerProgramRequired,
    availabilityScope: region || 'Grossraum Graz',
    priceCurrent: {
      amount: currentPrice,
      currency: 'EUR',
      originalText: `${currentPrice.toFixed(2)} EUR`,
    },
    priceReference: {
      amount: null,
      currency: 'EUR',
      originalText: '',
    },
    quantityText,
    normalizedUnitPrice,
    dedupeKey: buildLidlDedupeKey({
      productId: product?.productId,
      productUrl: product?.url,
      title,
      brand,
      quantityText,
      currentPrice,
    }),
    quality: {
      completenessScore: [currentPrice, validFrom, validTo, categoryPrimary].filter(Boolean).length / 4,
      parsingConfidence: normalizedUnitPrice.comparable ? 0.88 : 0.76,
      comparisonSafe: normalizedUnitPrice.comparable,
      issues,
    },
    rawFacts: {
      sourceType: 'lidl-official-flyer-api',
      validityText: [flyer?.offerStartDate, flyer?.offerEndDate].filter(Boolean).join(' - '),
      infoText: sanitizeWhitespace([product?.categoryPrimary, product?.wonCategoryPrimary].filter(Boolean).join(' / ')),
      productId: sanitizeWhitespace(product?.productId),
      snapshotCurrent: false,
    },
    adminReview: {
      status: issues.length > 0 ? 'pending' : 'reviewed',
      note: '',
      feedbackDigest: '',
    },
    scope: buildInclusiveScopeDecision(),
  });

  return overrideResult.offer || null;
}

async function fetchLidlFlyerByIdentifier(identifier) {
  const response = await axios.get('https://endpoints.leaflets.schwarz/v4/flyer', {
    timeout: 30000,
    params: {
      flyer_identifier: identifier,
      region_id: 0,
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
    },
  });

  return response.data?.flyer || null;
}

function parseNuxtDataPayload(html) {
  const $ = cheerio.load(html);
  const rawPayload = $('#__NUXT_DATA__').html();

  if (!rawPayload) {
    return [];
  }

  try {
    return JSON.parse(rawPayload);
  } catch (error) {
    return [];
  }
}

function hydrateNuxtIndex(payload, index, depth = 0) {
  if (!Number.isInteger(index) || index < 0 || index >= payload.length || depth > 30) {
    return null;
  }

  return hydrateNuxtValue(payload, payload[index], depth);
}

function hydrateNuxtValue(payload, value, depth = 0) {
  if (depth > 30) {
    return null;
  }

  if (Array.isArray(value)) {
    if (typeof value[0] === 'string' && ['Reactive', 'ShallowReactive', 'Ref'].includes(value[0])) {
      return hydrateNuxtIndex(payload, value[1], depth + 1);
    }

    if (typeof value[0] === 'string' && value[0] === 'EmptyRef') {
      return null;
    }

    if (typeof value[0] === 'string' && value[0] === 'Set') {
      return [];
    }

    return value.map((item) => typeof item === 'number'
      ? hydrateNuxtIndex(payload, item, depth + 1)
      : hydrateNuxtValue(payload, item, depth + 1));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        typeof item === 'number'
          ? hydrateNuxtIndex(payload, item, depth + 1)
          : hydrateNuxtValue(payload, item, depth + 1),
      ])
    );
  }

  return value;
}

function extractPennyNuxtProductsFromHtml(html) {
  const payload = parseNuxtDataPayload(html);
  const products = [];
  const bySlug = new Map();
  const byPath = new Map();

  for (let index = 0; index < payload.length; index += 1) {
    const raw = payload[index];

    if (
      raw
      && typeof raw === 'object'
      && !Array.isArray(raw)
      && raw.productId !== undefined
      && raw.price !== undefined
      && raw.name !== undefined
      && raw.slug !== undefined
    ) {
      const product = hydrateNuxtIndex(payload, index);
      const slug = sanitizeWhitespace(product?.slug);

      if (!slug || bySlug.has(slug)) {
        continue;
      }

      products.push(product);
      bySlug.set(slug, product);
      byPath.set(`/produkte/${slug}`, product);
    }
  }

  return { products, bySlug, byPath };
}

function parsePennyDateFromIso(value, endOfDay = false) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, endOfDay ? 23 : 12, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0));

  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePennyDateFromText(value, endOfDay = false) {
  const match = String(value || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, endOfDay ? 23 : 12, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0));

  return Number.isNaN(date.getTime()) ? null : date;
}

function extractPennyProductSlug(productUrl = '') {
  const match = String(productUrl || '').match(/\/produkte\/([^/?#]+)/i);
  return sanitizeWhitespace(match?.[1] || '');
}

function splitPennyTitleAndBrand(titleLine = '') {
  const parts = sanitizeWhitespace(titleLine)
    .split(/\s*(?:•|&bull;|â€¢)\s*/)
    .map((value) => sanitizeWhitespace(value))
    .filter(Boolean);

  return {
    title: parts[0] || '',
    brand: parts.slice(1).join(' ') || '',
  };
}

function centsToEuroAmount(value) {
  const amount = Number(value);

  return Number.isFinite(amount) ? Number((amount / 100).toFixed(2)) : null;
}

function buildPennyQuantityTextFromProduct(product = {}) {
  return sanitizeWhitespace([product.amount, product.volumeLabelShort || product.volumeLabelLong, product.packageLabel].filter(Boolean).join(' '));
}

function extractPennySourceCategory(product = {}) {
  product = product || {};
  const categoryNames = [product.category];

  for (const group of product.parentCategories || []) {
    for (const category of Array.isArray(group) ? group : []) {
      if (category?.name) {
        categoryNames.push(category.name);
      }
    }
  }

  return [...new Set(categoryNames.map(sanitizeWhitespace).filter(Boolean))].join(' / ');
}

function extractPennyProductGroupSlugsFromHtml(html) {
  const slugs = [];
  const seen = new Set();

  function pushSlug(value) {
    const slug = sanitizeWhitespace(value).toLowerCase();

    if (!/^angebote-ab-\d{4}(?:-[a-z0-9-]+)?$/.test(slug) || seen.has(slug)) {
      return;
    }

    seen.add(slug);
    slugs.push(slug);
  }

  for (const match of String(html || '').matchAll(/product-group-([a-z0-9-]+)-\\?\{/gi)) {
    pushSlug(match[1]);
  }

  const $ = cheerio.load(html || '');
  $('a[href*="/angebote?tab=angebote-ab-"], a[href*="/kategorie/angebote-ab-"]').each((index, element) => {
    const href = sanitizeWhitespace($(element).attr('href'));
    const tabMatch = href.match(/tab=angebote-ab-(\d{2})-(\d{2})/i);
    const categoryMatch = href.match(/\/kategorie\/(angebote-ab-\d{4}(?:-[a-z0-9-]+)?)/i);

    if (tabMatch) {
      pushSlug(`angebote-ab-${tabMatch[1]}${tabMatch[2]}`);
    }

    if (categoryMatch) {
      pushSlug(categoryMatch[1]);
    }
  });

  return slugs;
}

function extractPennyProductFromCard({ productUrl, nuxtProducts }) {
  const slug = extractPennyProductSlug(productUrl);

  try {
    const path = new URL(productUrl).pathname;
    return nuxtProducts.bySlug.get(slug) || nuxtProducts.byPath.get(path) || null;
  } catch (error) {
    return nuxtProducts.bySlug.get(slug) || null;
  }
}

function extractPennyReferencePrice(card, product = {}) {
  const referenceText = sanitizeWhitespace(
    card.find('.ws-product-price-strike').first().attr('aria-label')
    || card.find('.ws-product-price-strike s').first().text()
    || card.find('s').first().text()
  );
  const referenceAmount = extractEuroPriceTexts(referenceText)[0]?.amount
    || parseNumericAmount(referenceText)
    || centsToEuroAmount(product?.price?.crossed);

  return {
    amount: referenceAmount,
    originalText: referenceAmount ? (referenceText || `${referenceAmount.toFixed(2)} EUR`) : '',
  };
}

function extractPennyTabsAndLinks(html, pageUrl = 'https://www.penny.at/angebote') {
  const $ = cheerio.load(html);
  const tabs = [];
  const paginationLinks = [];
  const seenTabs = new Set();
  const seenPages = new Set();

  $('a[href]').each((index, element) => {
    const href = sanitizeWhitespace($(element).attr('href'));
    const text = sanitizeWhitespace($(element).text());
    const absoluteUrl = toAbsoluteUrl(href, pageUrl);

    if (!absoluteUrl) {
      return;
    }

    if (/\/angebote(?:\?|$)/i.test(absoluteUrl) && (/tab=/.test(absoluteUrl) || /angebote ab|flugbl/i.test(text))) {
      const key = `${absoluteUrl}|${text}`;
      if (!seenTabs.has(key)) {
        seenTabs.add(key);
        tabs.push({ label: text, url: absoluteUrl });
      }
    }

    if (/\/angebote\?page=\d+/i.test(absoluteUrl) && !seenPages.has(absoluteUrl)) {
      seenPages.add(absoluteUrl);
      paginationLinks.push({ label: text, url: absoluteUrl });
    }
  });

  return { tabs, paginationLinks };
}

function detectPennyScopeHint(html) {
  const text = sanitizeWhitespace(cheerio.load(html)('body').text());

  if (/filiale|filialfinder|verfuegbarkeit|verfügbarkeit|markt/i.test(text)) {
    return {
      type: 'unknown',
      reason: 'Seite enthaelt Filial-/Markt-Kontext; keine belastbare österreichweite Gueltigkeit aus Parser ableitbar.',
    };
  }

  return {
    type: 'unknown',
    reason: 'Keine explizite regionale oder österreichweite Angebotsgueltigkeit in der Angebotskarte erkannt.',
  };
}

function parsePennyOffersFromHtml({ html, source, crawlJobId, region, pageUrl }) {
  const $ = cheerio.load(html);
  const offers = [];
  const seenOfferKeys = new Set();
  const nuxtProducts = extractPennyNuxtProductsFromHtml(html);
  const scopeHint = detectPennyScopeHint(html);

  $('[data-test="product-tile"], .ws-product-tile').each((index, element) => {
    const card = $(element);
    const link = card.find('a[href*="/produkte/"]').first();
    const productUrl = toAbsoluteUrl(link.attr('href'), pageUrl) || pageUrl;
    const payloadProduct = extractPennyProductFromCard({ productUrl, nuxtProducts });
    const titleLine = sanitizeWhitespace(card.find('[data-test="product-title"]').first().text());
    const splitTitle = splitPennyTitleAndBrand(titleLine);
    const title = splitTitle.title || sanitizeWhitespace(link.text()) || sanitizeWhitespace(payloadProduct?.name);
    const brand = splitTitle.brand || sanitizeWhitespace(payloadProduct?.brand?.name);
    const quantityText = sanitizeWhitespace(
      card.find('[data-test="product-information-piece-description"]').first().text()
    ) || buildPennyQuantityTextFromProduct(payloadProduct);
    const validityNodes = card.find('[data-test="product-price-validity"] div');
    const validFrom = parsePennyDateFromText(sanitizeWhitespace(validityNodes.eq(0).text()))
      || parsePennyDateFromIso(payloadProduct?.price?.validityStart);
    const validTo = parsePennyDateFromText(sanitizeWhitespace(validityNodes.eq(1).text()), true)
      || parsePennyDateFromIso(payloadProduct?.price?.validityEnd, true);
    const currentPrice = parseNumericAmount(
      card.find('.ws-product-price-value__main').first().text()
      || card.find('[data-test="product-price-type-value"]').first().text()
    );
    const unitPriceLabel = sanitizeWhitespace(card.find('[data-test="product-price-type-label"]').first().text());
    const normalizedUnitPrice = buildUnitPriceFromLabel(unitPriceLabel, currentPrice);
    const priceReference = extractPennyReferencePrice(card, payloadProduct);
    const statusInfo = buildOfferStatus(validFrom, validTo);
    const sourceCategory = extractPennySourceCategory(payloadProduct);
    const categoryPrimary = determineOfferCategory({
      title: sanitizeWhitespace(`${brand} ${title}`),
      contextText: [brand, quantityText, unitPriceLabel, sourceCategory].filter(Boolean).join(' '),
      sourceCategory,
    });
    const issues = [];
    const offerKey = [productUrl, validFrom?.toISOString() || '', validTo?.toISOString() || '', currentPrice].join('|');

    if (!title || !currentPrice || statusInfo.status === 'expired' || seenOfferKeys.has(offerKey)) {
      return;
    }

    seenOfferKeys.add(offerKey);

    if (!normalizedUnitPrice.comparable) {
      issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
    }

    if (!validFrom || !validTo) {
      issues.push('Gueltigkeitszeitraum unvollstaendig');
    }

    const overrideResult = applyManualCategoryOverridesToOfferSync({
      crawlJobId,
      sourceId: source._id,
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      region,
      title,
      brand,
      categoryPrimary,
      categorySecondary: determineOfferSubcategory({
        primaryCategory: categoryPrimary,
        sourceCategory,
        fallbackLabel: sourceCategory || categoryPrimary,
        title: sanitizeWhitespace(`${brand} ${title}`),
        contextText: [brand, quantityText, unitPriceLabel, sourceCategory].filter(Boolean).join(' '),
      }),
      comparisonSignature: normalizeTitleForMatch(`${brand} ${title}`).split(' ').slice(0, 8).join('-'),
      comparisonQuantityKey: quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '',
      comparisonCategoryKey: normalizeTitleForMatch(categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
      description: '',
      sourceUrl: productUrl,
      imageUrl: normalizeImageUrl(
        extractNonPlaceholderImageUrl(card) || sanitizeWhitespace(payloadProduct?.images?.[0]),
        productUrl
      ),
      supportingSources: [
        buildSourceEvidence({
          source,
          observedUrl: productUrl,
          matchType: 'primary',
        }),
      ],
      validFrom,
      validTo,
      status: statusInfo.status,
      isActiveNow: statusInfo.isActiveNow,
      isActiveToday: statusInfo.isActiveToday,
      benefitType: priceReference.amount ? 'price-cut' : 'unknown',
      conditionsText: '',
      customerProgramRequired: false,
      availabilityScope: 'unknown',
      priceCurrent: {
        amount: currentPrice,
        currency: 'EUR',
        originalText: `${currentPrice.toFixed(2)} EUR`,
      },
      priceReference: {
        amount: priceReference.amount,
        currency: 'EUR',
        originalText: priceReference.originalText,
      },
      quantityText,
      normalizedUnitPrice,
      quality: {
        completenessScore: [currentPrice, validFrom, validTo, categoryPrimary].filter(Boolean).length / 4,
        parsingConfidence: normalizedUnitPrice.comparable ? 0.9 : 0.78,
        comparisonSafe: normalizedUnitPrice.comparable,
        issues,
      },
      rawFacts: {
        sourceType: 'penny-official-html',
        sourceKind: 'official',
        validityText: sanitizeWhitespace(card.find('[data-test="product-price-validity"]').text()),
        infoText: unitPriceLabel,
        sourceCategory,
        productSlug: extractPennyProductSlug(productUrl),
        productId: sanitizeWhitespace(payloadProduct?.productId),
        sku: sanitizeWhitespace(payloadProduct?.sku),
        imageSource: sanitizeWhitespace(payloadProduct?.images?.[0]) ? 'nuxt-payload' : '',
        availabilityScope: scopeHint,
        pageUrl,
        snapshotCurrent: false,
      },
      adminReview: {
        status: issues.length > 0 ? 'pending' : 'reviewed',
        note: '',
        feedbackDigest: '',
      },
      scope: buildInclusiveScopeDecision(),
    });

    if (overrideResult.offer) {
      offers.push(overrideResult.offer);
    }
  });

  return offers;
}

function buildPennyApiUnitPrice(product = {}, currentPrice = null) {
  const price = product?.price || {};
  const unit = normalizeUnitFromText(price.baseUnitShort || price.baseUnitLong);
  const basePriceFactor = parseNumericAmount(price.basePriceFactor);
  const perStandardizedQuantity = centsToEuroAmount(price.regular?.perStandardizedQuantity);

  if (perStandardizedQuantity && unit) {
    if (unit === 'g' && basePriceFactor) {
      return {
        amount: Number((perStandardizedQuantity * (1000 / basePriceFactor)).toFixed(2)),
        unit: 'kg',
        comparable: true,
        confidence: 0.92,
      };
    }

    if (unit === 'ml' && basePriceFactor) {
      return {
        amount: Number((perStandardizedQuantity * (1000 / basePriceFactor)).toFixed(2)),
        unit: 'l',
        comparable: true,
        confidence: 0.92,
      };
    }

    if (['kg', 'l', 'Stk'].includes(unit)) {
      return {
        amount: perStandardizedQuantity,
        unit,
        comparable: true,
        confidence: 0.92,
      };
    }
  }

  return buildOfficialNormalizedUnitPrice({
    priceAmount: currentPrice,
    quantityText: buildPennyQuantityTextFromProduct(product),
  });
}

function hasPennyApiOfferSignal(product = {}) {
  const price = product?.price || {};
  const tags = Array.isArray(price.regular?.tags) ? price.regular.tags : [];

  return Boolean(
    product?.inPromotion
    || price.validityStart
    || price.validityEnd
    || price.crossed
    || price.discountPercentage
    || tags.length > 0
  );
}

function normalizePennyApiProductsToOffers({ products = [], source, crawlJobId, region, pageUrl, categorySlug = '' }) {
  const offers = [];
  const seenOfferKeys = new Set();
  const scopeHint = {
    type: 'unknown',
    reason: 'Offizielle PENNY Product-Discovery-API; keine belastbare oesterreichweite Gueltigkeit aus API ableitbar.',
  };

  for (const product of products) {
    const productSlug = sanitizeWhitespace(product?.slug);
    const productUrl = toAbsoluteUrl(`/produkte/${productSlug}`, pageUrl || source.sourceUrl);
    const title = sanitizeWhitespace(product?.name);
    const brand = sanitizeWhitespace(product?.brand?.name);
    const quantityText = buildPennyQuantityTextFromProduct(product);
    const currentPrice = centsToEuroAmount(product?.price?.regular?.value);
    const referencePrice = centsToEuroAmount(product?.price?.crossed);
    const validFrom = parsePennyDateFromIso(product?.price?.validityStart);
    const validTo = parsePennyDateFromIso(product?.price?.validityEnd, true);
    const statusInfo = buildOfferStatus(validFrom, validTo);
    const normalizedUnitPrice = buildPennyApiUnitPrice(product, currentPrice);
    const sourceCategory = extractPennySourceCategory(product);
    const categoryPrimary = determineOfferCategory({
      title: sanitizeWhitespace(`${brand} ${title}`),
      contextText: [brand, quantityText, sourceCategory].filter(Boolean).join(' '),
      sourceCategory,
    });
    const issues = [];
    const offerKey = [productUrl, validFrom?.toISOString() || '', validTo?.toISOString() || '', currentPrice].join('|');
    const conditionsText = validTo ? '' : 'Aktuell gefunden - bitte im Markt pruefen.';

    if (
      !title
      || !productSlug
      || !currentPrice
      || !hasPennyApiOfferSignal(product)
      || statusInfo.status === 'expired'
      || seenOfferKeys.has(offerKey)
    ) {
      continue;
    }

    seenOfferKeys.add(offerKey);

    if (!normalizedUnitPrice.comparable) {
      issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
    }

    if (!validFrom || !validTo) {
      issues.push('Gueltigkeitszeitraum unvollstaendig');
    }

    const overrideResult = applyManualCategoryOverridesToOfferSync({
      crawlJobId,
      sourceId: source._id,
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      region,
      title,
      brand,
      categoryPrimary,
      categorySecondary: determineOfferSubcategory({
        primaryCategory: categoryPrimary,
        sourceCategory,
        fallbackLabel: sourceCategory || categoryPrimary,
        title: sanitizeWhitespace(`${brand} ${title}`),
        contextText: [brand, quantityText, sourceCategory].filter(Boolean).join(' '),
      }),
      comparisonSignature: normalizeTitleForMatch(`${brand} ${title}`).split(' ').slice(0, 8).join('-'),
      comparisonQuantityKey: quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '',
      comparisonCategoryKey: normalizeTitleForMatch(categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
      description: sanitizeWhitespace(product?.descriptionShort || product?.descriptionLong),
      sourceUrl: productUrl,
      imageUrl: normalizeImageUrl(sanitizeWhitespace(product?.images?.[0]), productUrl),
      supportingSources: [
        buildSourceEvidence({
          source,
          observedUrl: productUrl,
          matchType: 'primary',
        }),
      ],
      validFrom,
      validTo,
      status: statusInfo.status,
      isActiveNow: statusInfo.isActiveNow,
      isActiveToday: statusInfo.isActiveToday,
      benefitType: referencePrice && referencePrice > currentPrice ? 'price-cut' : 'unknown',
      conditionsText,
      customerProgramRequired: false,
      availabilityScope: 'unknown',
      priceCurrent: {
        amount: currentPrice,
        currency: 'EUR',
        originalText: `${currentPrice.toFixed(2)} EUR`,
      },
      priceReference: {
        amount: referencePrice && referencePrice > currentPrice ? referencePrice : null,
        currency: 'EUR',
        originalText: referencePrice && referencePrice > currentPrice ? `${referencePrice.toFixed(2)} EUR` : '',
      },
      priceReferenceSource: referencePrice && referencePrice > currentPrice ? 'penny-official-api-crossed' : '',
      quantityText,
      normalizedUnitPrice,
      quality: {
        completenessScore: [currentPrice, validFrom, validTo, categoryPrimary].filter(Boolean).length / 4,
        parsingConfidence: normalizedUnitPrice.comparable ? 0.92 : 0.8,
        comparisonSafe: normalizedUnitPrice.comparable,
        issues,
      },
      rawFacts: {
        sourceType: 'penny-official-html',
        sourceKind: 'official',
        extractionMethod: 'penny-product-discovery-api',
        apiCategorySlug: categorySlug,
        sourceCategory,
        productSlug,
        productId: sanitizeWhitespace(product?.productId),
        sku: sanitizeWhitespace(product?.sku),
        priceTags: Array.isArray(product?.price?.regular?.tags) ? product.price.regular.tags : [],
        discountPercentage: product?.price?.discountPercentage ?? null,
        baseUnitShort: sanitizeWhitespace(product?.price?.baseUnitShort),
        basePriceFactor: sanitizeWhitespace(product?.price?.basePriceFactor),
        availabilityScope: scopeHint,
        pageUrl,
        snapshotCurrent: false,
      },
      adminReview: {
        status: issues.length > 0 ? 'pending' : 'reviewed',
        note: conditionsText,
        feedbackDigest: '',
      },
      scope: buildInclusiveScopeDecision(),
    });

    if (overrideResult.offer) {
      offers.push(overrideResult.offer);
    }
  }

  return offers;
}

function diagnosePennyOfficialSiteHtml({ html, sourceUrl = 'https://www.penny.at/angebote', response = {}, fetchError = '' } = {}) {
  const $ = cheerio.load(html || '');
  const source = {
    _id: new Types.ObjectId(),
    retailerKey: 'penny',
    retailerName: 'PENNY',
    channel: 'official-site',
    sourceUrl,
    label: 'PENNY Angebote',
    sourceType: 'offers-page',
  };
  const offers = parsePennyOffersFromHtml({
    html,
    source,
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: sourceUrl,
  });
  const { products } = extractPennyNuxtProductsFromHtml(html || '');
  const { tabs, paginationLinks } = extractPennyTabsAndLinks(html || '', sourceUrl);
  const productGroupSlugs = extractPennyProductGroupSlugsFromHtml(html || '');
  const cardCount = $('[data-test="product-tile"], .ws-product-tile').length;
  const skipRejectReasons = [];

  if (fetchError) {
    skipRejectReasons.push({ reason: 'fetch-error', count: 1, detail: fetchError });
  }

  const skippedCards = Math.max(0, cardCount - offers.length);
  if (skippedCards > 0) {
    skipRejectReasons.push({ reason: 'missing-title-price-expired-or-duplicate', count: skippedCards });
  }

  return {
    sourceUrl,
    httpStatus: response.status ?? null,
    contentType: response.headers?.['content-type'] || '',
    bodyPreview: bodyPreview($('body').text(), 500),
    recognizedOfferCards: cardCount,
    nuxtPayloadProducts: products.length,
    parsedRawOffers: offers.length,
    withPrice: offers.filter((offer) => offer.priceCurrent?.amount).length,
    withValidFrom: offers.filter((offer) => offer.validFrom).length,
    withValidTo: offers.filter((offer) => offer.validTo).length,
    withStattpreis: offers.filter((offer) => offer.priceReference?.amount).length,
    withGrundpreis: offers.filter((offer) => offer.normalizedUnitPrice?.amount).length,
    withImageUrl: offers.filter((offer) => offer.imageUrl).length,
    examples: offers.slice(0, 8).map((offer) => ({
      title: offer.title,
      brand: offer.brand,
      quantityText: offer.quantityText,
      priceCurrent: offer.priceCurrent?.amount ?? null,
      priceReference: offer.priceReference?.amount ?? null,
      basePrice: offer.normalizedUnitPrice?.amount ? `${offer.normalizedUnitPrice.amount}/${offer.normalizedUnitPrice.unit}` : '',
      validFrom: offer.validFrom ? offer.validFrom.toISOString().slice(0, 10) : null,
      validTo: offer.validTo ? offer.validTo.toISOString().slice(0, 10) : null,
      categoryMain: offer.categoryPrimary,
      categorySecondary: offer.categorySecondary,
      imageUrl: Boolean(offer.imageUrl),
      sourceUrl: offer.sourceUrl,
    })),
    skipRejectReasons,
    tabs,
    paginationLinks,
    productGroupSlugs,
    regionScopeHint: detectPennyScopeHint(html || ''),
    detailPagesOrApiNeeded: paginationLinks.length > 0
      ? 'Listing HTML enthaelt verwertbare Seite-1-Angebote und Nuxt-Payload-Bilder; weitere offizielle Offers liegen in der Product-Discovery-API des sichtbaren Product-Group-Slugs.'
      : 'Listing HTML reicht fuer erkannte Angebote; Detailseiten sind fuer diese Offers nicht noetig.',
    expectedProductionEffect: productGroupSlugs.length
      ? `Targeted Crawl sollte die offizielle PENNY Product-Discovery-API fuer ${productGroupSlugs[0]} seitenweise auslesen; HTML-Seite 1 bleibt Fallback.`
      : offers.length > 18
        ? `Targeted Crawl sollte mindestens ${offers.length} offizielle PENNY-HTML-Angebote speichern, sofern Production TLS/HTML identisch ist.`
      : 'Erwarteter Effekt unter Ziel; Parser/Quelle erneut pruefen.',
  };
}

function parseBipaTilePriceInfo(card) {
  const textNodes = card.find('p').map((index, element) => sanitizeWhitespace(card.find('p').eq(index).text())).get();
  const priceText = textNodes.find((value) => value.startsWith('€'));
  const unitPriceText = textNodes.find((value) => /\d+(?:[.,]\d+)?\s*(kg|l|Stk|waschgang|100 g|100 ml)/i.test(value));

  return {
    currentPrice: parseNumericAmount(priceText),
    priceText,
    unitPriceText: unitPriceText || '',
  };
}

function parseBipaTilePriceInfoV2(card) {
  return parseBipaTilePriceInfoV3(card);
}

function parseBipaTilePriceInfoV3(card) {
  const textNodes = card.find('p').map((index, element) => sanitizeWhitespace(card.find('p').eq(index).text())).get();
  const cardText = sanitizeWhitespace(card.text());
  const euroPrices = extractEuroPriceTexts(cardText);
  const euroTextNodes = textNodes
    .filter((value) => value.charCodeAt(0) === 8364 || value.startsWith('â'))
    .map((value) => ({ amount: parseNumericAmount(value), originalText: value }))
    .filter((value) => value.amount);
  const priceCandidates = euroTextNodes.length > 0 ? euroTextNodes : euroPrices;
  const priceText = priceCandidates.at(-1)?.originalText || '';
  const unitPriceText = textNodes.find((value) => /\d+(?:[.,]\d+)?\s*(kg|l|Stk|waschgang|100 g|100 ml)/i.test(value));

  return {
    currentPrice: parseNumericAmount(priceText),
    referencePrice: priceCandidates.length > 1 ? priceCandidates[0].amount : null,
    referencePriceText: priceCandidates.length > 1 ? priceCandidates[0].originalText : '',
    priceText,
    unitPriceText: unitPriceText || extractUnitPriceTextFromText(cardText),
  };
}

function extractBipaValidityDate(html) {
  const now = new Date();
  const startOfTomorrow = new Date(now);
  startOfTomorrow.setUTCHours(0, 0, 0, 0);
  startOfTomorrow.setUTCDate(startOfTomorrow.getUTCDate() + 1);
  const dates = [...String(html || '').matchAll(/(?:Gueltig bis|Gültig bis)\s+(\d{2}\.\d{2}\.\d{4})/gi)]
    .map((match) => parseDateWithWeekday(match[1]))
    .filter(Boolean)
    .map((date) => {
      const endOfDay = new Date(date);
      endOfDay.setUTCHours(23, 59, 59, 999);
      return endOfDay;
    })
    .filter((date) => date >= startOfTomorrow)
    .sort((left, right) => left.getTime() - right.getTime());

  return dates[0] || null;
}

function parseBipaOffersFromHtml({ html, source, crawlJobId, region, pageUrl, validToHint = null }) {
  const $ = cheerio.load(html);
  const offers = [];
  const validFrom = new Date();
  const validTo = validToHint || extractBipaValidityDate(html);
  const statusInfo = buildOfferStatus(validFrom, validTo, true);
  const seenProductUrls = new Set();

  $('a[href*="/p/"]').each((index, element) => {
    const card = $(element);
    const href = sanitizeWhitespace(card.attr('href') || '');
    const productUrl = href ? new URL(href, pageUrl || source.sourceUrl).toString().split(/[?#]/)[0] : '';

    if (productUrl && seenProductUrls.has(productUrl)) {
      return;
    }

    if (productUrl) {
      seenProductUrls.add(productUrl);
    }

    const paragraphs = card.find('p').map((i, el) => sanitizeWhitespace($(el).text())).get().filter(Boolean);
    const cardText = sanitizeWhitespace(card.text());
    const linkLabel = sanitizeWhitespace(card.attr('aria-label') || card.attr('title') || cardText);
    const brand = paragraphs[0] || sanitizeWhitespace(linkLabel.split(/\s{2,}/)[0] || '');
    const title = paragraphs[1] || sanitizeWhitespace(linkLabel.replace(brand, '').split(/\s+\d+\s*(?:ml|g|kg|Stk|stueck|stuck)\b/i)[0]);
    const quantityText = paragraphs[2] || sanitizeWhitespace((linkLabel.match(/\d+(?:[.,]\d+)?\s*(?:ml|g|kg|l|Stk|stueck|stuck)\b/i) || [])[0] || '');
    const {
      currentPrice,
      referencePrice,
      referencePriceText,
      priceText,
      unitPriceText,
    } = parseBipaTilePriceInfoV3(card);
    const normalizedUnitPrice = unitPriceText
      ? buildUnitPriceFromLabel(unitPriceText, currentPrice)
      : buildOfficialNormalizedUnitPrice({
        priceAmount: currentPrice,
        quantityText,
      });
    const categoryPrimary = determineOfferCategory({
      title,
      contextText: [brand, quantityText, unitPriceText].filter(Boolean).join(' '),
    });
    const issues = [];

    if (!title || !currentPrice) {
      return;
    }

    if (!normalizedUnitPrice.comparable) {
      issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
    }

    if (!validTo) {
      issues.push('Gueltigkeitsende aus offizieller Quelle nicht eindeutig ableitbar');
    }

    const overrideResult = applyManualCategoryOverridesToOfferSync({
      crawlJobId,
      sourceId: source._id,
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      region,
      title,
      brand,
      categoryPrimary,
      categorySecondary: determineOfferSubcategory({
        primaryCategory: categoryPrimary,
        fallbackLabel: categoryPrimary,
        title,
        contextText: [brand, quantityText, unitPriceText].filter(Boolean).join(' '),
      }),
      comparisonSignature: normalizeTitleForMatch(`${brand} ${title}`).split(' ').slice(0, 8).join('-'),
      comparisonQuantityKey: quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '',
      comparisonCategoryKey: normalizeTitleForMatch(categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
      description: '',
      sourceUrl: toAbsoluteUrl(card.attr('href'), pageUrl) || pageUrl,
      imageUrl: normalizeImageUrl(extractImageUrl(card), pageUrl || source.sourceUrl),
      supportingSources: [
        buildSourceEvidence({
          source,
          observedUrl: toAbsoluteUrl(card.attr('href'), pageUrl) || pageUrl,
          matchType: pageUrl === source.sourceUrl ? 'primary' : 'official-related',
        }),
      ],
      validFrom,
      validTo,
      status: statusInfo.status,
      isActiveNow: statusInfo.isActiveNow,
      isActiveToday: statusInfo.isActiveToday,
      benefitType: /gratis/i.test([title, unitPriceText].join(' ')) ? 'multi-buy' : 'price-cut',
      conditionsText: '',
      customerProgramRequired: false,
      availabilityScope: region || 'Grossraum Graz',
      priceCurrent: {
        amount: currentPrice,
        currency: 'EUR',
        originalText: priceText || `${currentPrice.toFixed(2)} EUR`,
      },
      priceReference: {
        amount: referencePrice && referencePrice > currentPrice ? referencePrice : null,
        currency: 'EUR',
        originalText: referencePrice && referencePrice > currentPrice ? referencePriceText : '',
      },
      quantityText,
      normalizedUnitPrice,
      quality: {
        completenessScore: [currentPrice, title, categoryPrimary, quantityText].filter(Boolean).length / 4,
        parsingConfidence: normalizedUnitPrice.comparable ? 0.88 : 0.76,
        comparisonSafe: normalizedUnitPrice.comparable,
        issues,
      },
      rawFacts: {
        sourceType: 'bipa-official-html',
        validityText: validTo ? `bis ${validTo.toISOString().slice(0, 10)}` : '',
        infoText: unitPriceText,
        availabilityScope: {
          type: 'unknown',
          country: 'AT',
          label: 'offizielle BIPA-Aktionsseite; Online-/Filialgueltigkeit nicht eindeutig je Produkt extrahiert',
          sourceEvidence: pageUrl,
        },
        snapshotCurrent: true,
      },
      adminReview: {
        status: issues.length > 0 ? 'pending' : 'reviewed',
        note: '',
        feedbackDigest: '',
      },
      scope: buildInclusiveScopeDecision(),
    });

    if (overrideResult.offer) {
      offers.push(overrideResult.offer);
    }
  });

  return offers;
}

function collectBipaPromotionLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const links = [];

  $('a[href]').each((index, element) => {
    const href = $(element).attr('href');
    const text = sanitizeWhitespace($(element).text());
    const absoluteUrl = toAbsoluteUrl(href, baseUrl);

    if (!absoluteUrl || seen.has(absoluteUrl)) {
      return;
    }

    if (!/bipa\.at/i.test(absoluteUrl)) {
      return;
    }

    if (/\/cp\/aktionen|\/cp\/onlineonly|prefn0=pricebadges|\/c\//i.test(absoluteUrl)) {
      seen.add(absoluteUrl);
      links.push({
        url: absoluteUrl,
        label: text || absoluteUrl,
      });
    }
  });

  return links.slice(0, 10);
}

function buildDmSaleUnitPrice(basePriceText, currentPrice) {
  const text = sanitizeWhitespace(basePriceText);
  const perUnitMatch = text.match(/\(([\d,.]+)\s*\u20ac\s*je\s*1\s*(kg|l|St|Stk|stueck|stuck|100\s*ml|100\s*g)\)/i);

  if (perUnitMatch) {
    let rawAmount = parseNumericAmount(perUnitMatch[1]);
    const rawUnit = perUnitMatch[2];
    let unit = /kg/i.test(rawUnit) ? 'kg' : /l/i.test(rawUnit) ? 'l' : 'Stk';

    if (/100\s*ml/i.test(rawUnit)) {
      rawAmount = rawAmount ? Number((rawAmount * 10).toFixed(2)) : rawAmount;
      unit = 'l';
    } else if (/100\s*g/i.test(rawUnit)) {
      rawAmount = rawAmount ? Number((rawAmount * 10).toFixed(2)) : rawAmount;
      unit = 'kg';
    }

    return {
      amount: rawAmount,
      unit,
      comparable: Boolean(rawAmount && ['kg', 'l', 'Stk'].includes(unit)),
      confidence: rawAmount ? 0.9 : 0,
    };
  }

  return buildOfficialNormalizedUnitPrice({
    priceAmount: currentPrice,
    quantityText: text,
  });
}

function extractDmQuantityText(title, basePriceText) {
  const titleMatch = sanitizeWhitespace(title).match(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|St|Stk|stueck|stuck)\b/i);

  if (titleMatch) {
    return sanitizeWhitespace(titleMatch[0]);
  }

  const baseMatch = sanitizeWhitespace(basePriceText).match(/^\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|St|Stk|stueck|stuck)\b/i);
  return sanitizeWhitespace(baseMatch?.[0] || '');
}

function readNestedValue(source, paths = []) {
  for (const path of paths) {
    const value = String(path || '')
      .split('.')
      .reduce((current, key) => (current && current[key] !== undefined ? current[key] : undefined), source);

    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return '';
}

function dmProductUrl(product, pageUrl) {
  const rawSelf = readNestedValue(product, [
    'tileData.self.href',
    'tileData.self.url',
    'tileData.self.path',
    'tileData.self',
    'self.href',
    'self.url',
  ]);

  if (typeof rawSelf === 'string' && rawSelf.trim()) {
    return toAbsoluteUrl(rawSelf, pageUrl || 'https://www.dm.at/ausverkauf') || pageUrl;
  }

  return pageUrl;
}

function dmProductImageUrl(product) {
  const images = product?.tileData?.images || product?.images || [];
  const first = Array.isArray(images) ? images[0] : null;
  return normalizeImageUrl(first?.tileSrc || first?.src || first?.url || '', 'https://www.dm.at/');
}

function dmHasSaleContext(product, contextText = '') {
  const eyecatchers = product?.tileData?.eyecatchers || [];
  const eyecatcherText = Array.isArray(eyecatchers)
    ? eyecatchers.map((item) => item?.alt || item?.label || item?.type || '').join(' ')
    : '';
  const haystack = normalizeTitleForMatch([
    contextText,
    product?.tileData?.a11yLabel,
    product?.context,
    eyecatcherText,
  ].filter(Boolean).join(' '));

  return /\b(ausverkauf|sellout|sale)\b/.test(haystack);
}

function buildDmSaleOfferFromFields({
  source,
  crawlJobId,
  region,
  pageUrl,
  brand,
  title,
  priceText,
  referencePriceText,
  basePriceText,
  contextText,
  imageUrl = '',
  productUrl = '',
  rawProduct = null,
}) {
  const currentPrice = parseNumericAmount(priceText);
  const referencePrice = parseNumericAmount(referencePriceText);
  const quantityText = extractDmQuantityText(title, basePriceText);
  const normalizedUnitPrice = buildDmSaleUnitPrice(basePriceText, currentPrice);
  const validFrom = new Date();
  const statusInfo = buildOfferStatus(validFrom, null, true);
  const categoryPrimary = determineOfferCategory({
    title,
    contextText: [brand, quantityText, basePriceText, contextText].filter(Boolean).join(' '),
  });
  const issues = ['Gueltigkeitsende aus offizieller Quelle nicht eindeutig ableitbar'];

  if (!title || !currentPrice) {
    return null;
  }

  if (!normalizedUnitPrice.comparable) {
    issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
  }

  if (!referencePrice || referencePrice <= currentPrice) {
    issues.push('Vorheriger Preis aus offizieller Quelle nicht eindeutig ableitbar');
  }

  const observedUrl = productUrl || pageUrl;
  const overrideResult = applyManualCategoryOverridesToOfferSync({
    crawlJobId,
    sourceId: source._id,
    retailerKey: source.retailerKey,
    retailerName: source.retailerName,
    region,
    title,
    brand,
    categoryPrimary,
    categorySecondary: determineOfferSubcategory({
      primaryCategory: categoryPrimary,
      fallbackLabel: categoryPrimary,
      title,
      contextText: [brand, quantityText, basePriceText].filter(Boolean).join(' '),
    }),
    comparisonSignature: normalizeTitleForMatch(`${brand} ${title}`).split(' ').slice(0, 8).join('-'),
    comparisonQuantityKey: quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '',
    comparisonCategoryKey: normalizeTitleForMatch(categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
    description: 'Ausverkauf',
    sourceUrl: observedUrl,
    imageUrl,
    supportingSources: [
      buildSourceEvidence({
        source,
        observedUrl,
        matchType: 'primary',
      }),
    ],
    validFrom,
    validTo: null,
    status: statusInfo.status,
    isActiveNow: statusInfo.isActiveNow,
    isActiveToday: statusInfo.isActiveToday,
    benefitType: referencePrice && referencePrice > currentPrice ? 'price-cut' : 'unknown',
    conditionsText: 'Ausverkauf; nur solange der Vorrat reicht',
    customerProgramRequired: false,
    availabilityScope: 'online/filialabhaengig',
    priceCurrent: {
      amount: currentPrice,
      currency: 'EUR',
      originalText: priceText,
    },
    priceReference: {
      amount: referencePrice && referencePrice > currentPrice ? referencePrice : null,
      currency: 'EUR',
      originalText: referencePrice && referencePrice > currentPrice ? referencePriceText : '',
    },
    quantityText,
    normalizedUnitPrice,
    quality: {
      completenessScore: [currentPrice, title, categoryPrimary, quantityText].filter(Boolean).length / 4,
      parsingConfidence: normalizedUnitPrice.comparable ? 0.86 : 0.74,
      comparisonSafe: normalizedUnitPrice.comparable,
      issues,
    },
    rawFacts: {
      sourceType: 'dm-official-product-search',
      validityText: 'Ausverkauf; nur solange der Vorrat reicht',
      infoText: basePriceText,
      availabilityText: sanitizeWhitespace(contextText.match(/Verf(?:ue|Ã¼|\u00fc)gbarkeit:\s*([^;]+)/i)?.[1] || ''),
      availabilityScope: {
        type: 'unknown',
        country: 'AT',
        label: 'dm Ausverkauf; Online-/Filialverfuegbarkeit produktabhaengig',
        sourceEvidence: observedUrl,
      },
      snapshotCurrent: true,
      dmDan: rawProduct?.dan || rawProduct?.tileData?.dan || null,
      dmGtin: rawProduct?.gtin || rawProduct?.tileData?.gtin || null,
      priceReferenceSource: referencePrice && referencePrice > currentPrice ? 'dm-product-search-previous-price' : '',
    },
    adminReview: {
      status: issues.length > 0 ? 'pending' : 'reviewed',
      note: '',
      feedbackDigest: '',
    },
    scope: buildInclusiveScopeDecision(),
  });

  return overrideResult.offer || null;
}

function parseDmSaleOffersFromHtml({ html, source, crawlJobId, region, pageUrl }) {
  const $ = cheerio.load(html);
  const bodyText = sanitizeWhitespace($('body').text());
  const offers = [];
  const validFrom = new Date();
  const statusInfo = buildOfferStatus(validFrom, null, true);
  const productPattern = /Marke:\s*([^;]+);\s*Produktname:\s*([^;]+);\s*Preis:\s*([^;]+);\s*Grundpreis:\s*([^;]+);([\s\S]*?)(?=Marke:\s*[^;]+;\s*Produktname:|Ende der Auflistung|$)/gi;

  for (const match of bodyText.matchAll(productPattern)) {
    const brand = sanitizeWhitespace(match[1]);
    const title = sanitizeWhitespace(match[2]);
    const priceText = sanitizeWhitespace(match[3]);
    const basePriceText = sanitizeWhitespace(match[4]);
    const contextText = sanitizeWhitespace(match[5]);
    const currentPrice = parseNumericAmount(priceText);
    const previousPriceMatch = contextText.match(/Vorheriger Preis:\s*([\d,.]+)\s*\u20ac/i);
    const referencePrice = parseNumericAmount(previousPriceMatch?.[1]);
    const quantityText = extractDmQuantityText(title, basePriceText);
    const normalizedUnitPrice = buildDmSaleUnitPrice(basePriceText, currentPrice);
    const categoryPrimary = determineOfferCategory({
      title,
      contextText: [brand, quantityText, basePriceText, contextText].filter(Boolean).join(' '),
    });
    const issues = ['Gueltigkeitsende aus offizieller Quelle nicht eindeutig ableitbar'];

    if (!title || !currentPrice) {
      continue;
    }

    if (!normalizedUnitPrice.comparable) {
      issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
    }

    if (!referencePrice || referencePrice <= currentPrice) {
      issues.push('Vorheriger Preis aus offizieller Quelle nicht eindeutig ableitbar');
    }

    const overrideResult = applyManualCategoryOverridesToOfferSync({
      crawlJobId,
      sourceId: source._id,
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      region,
      title,
      brand,
      categoryPrimary,
      categorySecondary: determineOfferSubcategory({
        primaryCategory: categoryPrimary,
        fallbackLabel: categoryPrimary,
        title,
        contextText: [brand, quantityText, basePriceText].filter(Boolean).join(' '),
      }),
      comparisonSignature: normalizeTitleForMatch(`${brand} ${title}`).split(' ').slice(0, 8).join('-'),
      comparisonQuantityKey: quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '',
      comparisonCategoryKey: normalizeTitleForMatch(categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
      description: 'Ausverkauf',
      sourceUrl: pageUrl,
      imageUrl: '',
      supportingSources: [
        buildSourceEvidence({
          source,
          observedUrl: pageUrl,
          matchType: 'primary',
        }),
      ],
      validFrom,
      validTo: null,
      status: statusInfo.status,
      isActiveNow: statusInfo.isActiveNow,
      isActiveToday: statusInfo.isActiveToday,
      benefitType: referencePrice && referencePrice > currentPrice ? 'price-cut' : 'unknown',
      conditionsText: 'Ausverkauf; nur solange der Vorrat reicht',
      customerProgramRequired: false,
      availabilityScope: 'online/filialabhaengig',
      priceCurrent: {
        amount: currentPrice,
        currency: 'EUR',
        originalText: priceText,
      },
      priceReference: {
        amount: referencePrice && referencePrice > currentPrice ? referencePrice : null,
        currency: 'EUR',
        originalText: referencePrice && referencePrice > currentPrice ? previousPriceMatch[0] : '',
      },
      quantityText,
      normalizedUnitPrice,
      quality: {
        completenessScore: [currentPrice, title, categoryPrimary, quantityText].filter(Boolean).length / 4,
        parsingConfidence: normalizedUnitPrice.comparable ? 0.86 : 0.74,
        comparisonSafe: normalizedUnitPrice.comparable,
        issues,
      },
      rawFacts: {
        sourceType: 'dm-official-html',
        validityText: 'Ausverkauf; nur solange der Vorrat reicht',
        infoText: basePriceText,
        availabilityText: contextText.match(/Verfügbarkeit:\s*([^;]+)/i)?.[1] || '',
        availabilityScope: {
          type: 'unknown',
          country: 'AT',
          label: 'dm Ausverkauf; Online-/Filialverfuegbarkeit produktabhaengig',
          sourceEvidence: pageUrl,
        },
        snapshotCurrent: true,
      },
      adminReview: {
        status: issues.length > 0 ? 'pending' : 'reviewed',
        note: '',
        feedbackDigest: '',
      },
      scope: buildInclusiveScopeDecision(),
    });

    if (overrideResult.offer) {
      offers.push(overrideResult.offer);
    }
  }

  return offers;
}

function addDmSkipReason(diagnostics, reason) {
  if (!diagnostics) return;
  diagnostics.skipReasons = diagnostics.skipReasons || {};
  diagnostics.skipReasons[reason] = (diagnostics.skipReasons[reason] || 0) + 1;
}

function parseDmSaleOffersFromProductSearchJson({ payload, source, crawlJobId, region, pageUrl, diagnostics = null }) {
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const offers = [];

  if (diagnostics) {
    diagnostics.rawProducts = (diagnostics.rawProducts || 0) + products.length;
  }

  for (const product of products) {
    const price = product?.tileData?.price?.price || product?.price?.price || {};
    const tileInfos = product?.tileData?.price?.tileInfos || product?.tileData?.tileInfos || [];
    const contextText = sanitizeWhitespace([
      product?.tileData?.a11yLabel,
      product?.tileData?.price?.prefix,
      product?.tileData?.infoHint,
      Array.isArray(product?.tileData?.eyecatchers)
        ? product.tileData.eyecatchers.map((item) => item?.alt || '').join(' ')
        : '',
    ].filter(Boolean).join(' '));

    if (!dmHasSaleContext(product, contextText)) {
      addDmSkipReason(diagnostics, 'missing-sellout-context');
      continue;
    }

    const title = sanitizeWhitespace(product?.title || product?.tileData?.title || '');
    const priceText = sanitizeWhitespace(price?.current?.value || product?.tileData?.a11yLabel?.match(/Preis:\s*([^;]+)/i)?.[1] || '');

    if (!title) {
      addDmSkipReason(diagnostics, 'missing-title');
      continue;
    }

    if (!parseNumericAmount(priceText)) {
      addDmSkipReason(diagnostics, 'missing-current-price');
      continue;
    }

    const offer = buildDmSaleOfferFromFields({
      source,
      crawlJobId,
      region,
      pageUrl,
      brand: sanitizeWhitespace(product?.brandName || product?.tileData?.brand?.name || ''),
      title,
      priceText,
      referencePriceText: sanitizeWhitespace(price?.previous?.value || ''),
      basePriceText: sanitizeWhitespace(Array.isArray(tileInfos) ? tileInfos[0] : tileInfos),
      contextText,
      imageUrl: dmProductImageUrl(product),
      productUrl: dmProductUrl(product, pageUrl),
      rawProduct: product,
    });

    if (offer) {
      offers.push(offer);
    } else {
      addDmSkipReason(diagnostics, 'offer-normalization-failed');
    }
  }

  if (diagnostics) {
    diagnostics.parsedOffers = (diagnostics.parsedOffers || 0) + offers.length;
  }

  return offers;
}

function parseHoferOffersFromPage({
  html,
  pageUrl,
  source,
  crawlJobId,
  region,
  pageDate,
  nextPageDate,
  diagnostics,
}) {
  const $ = cheerio.load(html);
  const offers = [];
  const pageContext = hoferPageOfferContext(pageUrl);
  const cards = extractHoferCards($, pageContext);
  const isSnapshotOfferPage = !pageDate && pageContext !== 'unknown' && pageContext !== 'hofer-actions';

  if (diagnostics) {
    diagnostics.pages = diagnostics.pages || [];
    diagnostics.skipReasons = diagnostics.skipReasons || {};
    diagnostics.rawCards = (diagnostics.rawCards || 0) + cards.length;
  }

  cards.each((index, element) => {
    const card = $(element);
    const cardText = sanitizeWhitespace(card.text());
    const title = extractHoferCardTitle(card, pageContext);
    const currentPrice = extractHoferCurrentPrice(card, cardText, pageContext);
    const oldPrice = extractHoferOldPrice(card, cardText, pageContext);
    const additionalInfo = extractHoferAdditionalInfo(card, cardText, pageContext);
    const actionValidity = pageContext === 'hofer-actions' ? extractHoferActionValidity(card, $) : null;
    const validFrom = actionValidity?.validFrom || extractHoferAvailabilityDate(cardText) || parseDateFromText(cardText) || pageDate || (isSnapshotOfferPage ? new Date() : null);
    const validTo = actionValidity?.validTo || (validFrom && nextPageDate ? endOfUtcDay(addDays(nextPageDate, -1)) : null);
    const statusInfo = buildOfferStatus(validFrom, validTo, isSnapshotOfferPage);
    const quantityText = additionalInfo || '';
    const normalizedUnitPrice = buildUnitPriceFromLabel(quantityText, currentPrice);
    const brandAndTitle = title;
    const categoryPrimary = determineOfferCategory({
      title: brandAndTitle,
      contextText: additionalInfo,
    });
    const scopeDecision = buildInclusiveScopeDecision();
    const issues = [];

    if (!title) {
      if (diagnostics) diagnostics.skipReasons['missing-title'] = (diagnostics.skipReasons['missing-title'] || 0) + 1;
      return;
    }

    if (!currentPrice) {
      if (diagnostics) diagnostics.skipReasons['missing-current-price'] = (diagnostics.skipReasons['missing-current-price'] || 0) + 1;
      return;
    }

    if (isHoferSoldOutCard(cardText)) {
      if (diagnostics) diagnostics.skipReasons['sold-out'] = (diagnostics.skipReasons['sold-out'] || 0) + 1;
      return;
    }

    if (statusInfo.status === 'expired' || statusInfo.status === 'upcoming') {
      if (diagnostics) diagnostics.skipReasons[`status-${statusInfo.status}`] = (diagnostics.skipReasons[`status-${statusInfo.status}`] || 0) + 1;
      return;
    }

    if (!normalizedUnitPrice.comparable) {
      issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
    }

    if (!validTo) {
      issues.push('Gueltigkeitsende aus offizieller Quelle nicht eindeutig ableitbar');
    }

    const conditionsText = extractHoferConditionsText({ cardText, pageContext, validTo });
    const productUrl = extractHoferProductUrl(card, pageUrl);
    const imageUrl = normalizeImageUrl(extractImageUrl(card), pageUrl);
    const productId = extractHoferProductId({ card, productUrl, imageUrl });
    const dedupeKey = buildHoferDedupeKey({
      title,
      currentPrice,
      productUrl,
      productId,
      quantityText,
    });

    const overrideResult = applyManualCategoryOverridesToOfferSync({
      crawlJobId,
      sourceId: source._id,
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      region,
      title,
      brand: '',
      categoryPrimary,
      categorySecondary: determineOfferSubcategory({
        primaryCategory: categoryPrimary,
        fallbackLabel: categoryPrimary,
        title,
        contextText: additionalInfo,
      }),
      comparisonSignature: normalizeTitleForMatch(title).split(' ').slice(0, 8).join('-'),
      comparisonQuantityKey: quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '',
      comparisonCategoryKey: normalizeTitleForMatch(categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
      description: '',
      sourceUrl: productUrl || pageUrl,
      imageUrl,
      supportingSources: [
        buildSourceEvidence({
          source,
          observedUrl: pageUrl,
          matchType: 'primary',
        }),
      ],
      validFrom,
      validTo,
      status: statusInfo.status,
      isActiveNow: statusInfo.isActiveNow,
      isActiveToday: statusInfo.isActiveToday,
      benefitType: oldPrice && oldPrice > currentPrice ? 'price-cut' : 'unknown',
      conditionsText,
      customerProgramRequired: false,
      availabilityScope: region || 'Grossraum Graz',
      priceCurrent: {
        amount: currentPrice,
        currency: 'EUR',
        originalText: `${currentPrice.toFixed(2)} EUR`,
      },
      priceReference: {
        amount: oldPrice,
        currency: 'EUR',
        originalText: oldPrice ? `${oldPrice.toFixed(2)} EUR` : '',
      },
      dedupeKey,
      quantityText,
      comparableUnit: normalizedUnitPrice.unit || '',
      normalizedUnitPrice,
      quality: {
        completenessScore: [currentPrice, validFrom, categoryPrimary].filter(Boolean).length / 3,
        parsingConfidence: normalizedUnitPrice.comparable ? 0.84 : 0.72,
        comparisonSafe: normalizedUnitPrice.comparable,
        issues,
      },
      rawFacts: {
        sourceType: 'hofer-official-html',
        additionalInfo,
        pageContext,
        pageUrl,
        productUrl,
        productId,
        actionValidityText: actionValidity?.validityText || '',
        validityText: validTo
          ? [validFrom?.toISOString?.().slice(0, 10), validTo.toISOString().slice(0, 10)].filter(Boolean).join(' - ')
          : conditionsText,
      },
      adminReview: {
        status: issues.length > 0 ? 'pending' : 'reviewed',
        note: conditionsText,
        feedbackDigest: '',
      },
      scope: scopeDecision,
    });

    if (overrideResult.offer) {
      offers.push(overrideResult.offer);
    }
  });

  if (diagnostics) {
    diagnostics.parsedOffers = (diagnostics.parsedOffers || 0) + offers.length;
    diagnostics.pages.push({
      url: pageUrl,
      pageContext,
      rawCards: cards.length,
      parsedOffers: offers.length,
    });
  }

  return offers;
}

async function fetchHtml(url) {
  let response;

  try {
    response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/json',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
      },
    });
  } catch (error) {
    throw attachFetchDiagnostic(error, url);
  }

  return {
    response,
    html: String(response.data),
    canonicalUrl: response.request?.res?.responseUrl || url,
  };
}

async function fetchLidlOfficialPageHtml(url) {
  try {
    return await fetchHtml(url);
  } catch (error) {
    if (!/CERT|TLS|LEAF|certificate|unable to verify/i.test(error.code || error.message || '')) {
      throw error;
    }

    const response = await axios.get(url, {
      timeout: 30000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/json',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
      },
    });

    return {
      response,
      html: String(response.data),
      canonicalUrl: response.request?.res?.responseUrl || url,
    };
  }
}

async function fetchPennyProductGroupProducts({ categorySlug, page, pageSize = PENNY_PRODUCT_GROUP_PAGE_SIZE, referer = 'https://www.penny.at/angebote' }) {
  const url = `https://www.penny.at/api/product-discovery/categories/${encodeURIComponent(categorySlug)}/products`;
  const requestConfig = {
    timeout: 30000,
    validateStatus: () => true,
    params: { page, pageSize },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
      Referer: referer,
    },
  };

  let response;

  try {
    response = await axios.get(url, requestConfig);
  } catch (error) {
    if (!/CERT|TLS|LEAF|certificate/i.test(error.code || error.message || '')) {
      throw error;
    }

    response = await axios.get(url, {
      ...requestConfig,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
  }

  if (response.status < 200 || response.status >= 300 || !response.data || typeof response.data !== 'object') {
    const error = new Error(`PENNY product group API returned unusable payload (${response.status})`);
    error.response = response;
    throw error;
  }

  return response.data;
}

async function fetchDmJson(url, { referer = 'https://www.dm.at/ausverkauf' } = {}) {
  let response;

  try {
    response = await axios.get(url, {
      timeout: 30000,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        Accept: 'application/json,text/plain,*/*',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
        Origin: 'https://www.dm.at',
        Referer: referer,
      },
    });
  } catch (error) {
    error.diagnostic = buildDmNetworkDiagnostic(url, error);
    throw error;
  }

  const canonicalUrl = response.request?.res?.responseUrl || url;
  const diagnostic = buildDmEndpointDiagnostic({
    url,
    response,
    payload: response.data,
    canonicalUrl,
  });

  if (response.status < 200 || response.status >= 300) {
    throw createDmEndpointError(`dm endpoint returned HTTP ${response.status}`, diagnostic);
  }

  if (!diagnostic.isJson || diagnostic.isHtml) {
    throw createDmEndpointError(
      diagnostic.isHtml ? 'dm endpoint returned non-json/html' : 'dm endpoint returned non-json response',
      diagnostic
    );
  }

  return {
    response,
    payload: response.data,
    canonicalUrl,
    diagnostic,
  };
}

function extractDmSaleGridQuery(contentPayload = {}) {
  const modules = collectDmContentModules(contentPayload);
  const grid = modules.find((item) => item?.type === 'DMSearchProductGrid' && /isSellout:true/i.test(String(item?.query?.filters || '')));
  return grid?.query || null;
}

function collectDmContentModules(value, modules = []) {
  if (!value || typeof value !== 'object') {
    return modules;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectDmContentModules(item, modules);
    }
    return modules;
  }

  if (value.type) {
    modules.push(value);
  }

  for (const entry of Object.values(value)) {
    if (entry && typeof entry === 'object') {
      collectDmContentModules(entry, modules);
    }
  }

  return modules;
}

function buildDmSaleProductSearchUrl(query = {}, page = 0) {
  const params = new URLSearchParams();
  params.set('sort', query.sort || 'rating');
  params.set('filters', query.filters || 'isSellout:true');
  params.set('pageSize', String(DM_SALE_PAGE_SIZE));
  params.set('currentPage', String(page));
  params.set('enablePharmacy', 'false');

  if (query.queryTerms) {
    params.set('queryTerms', query.queryTerms);
  }

  return `${DM_PRODUCT_SEARCH_URL}?${params.toString()}`;
}

async function fetchDmSaleProductSearchPages({ sourceUrl }) {
  const content = await fetchDmJson(DM_CONTENT_PATH, { referer: sourceUrl });
  const gridQuery = extractDmSaleGridQuery(content.payload);
  const query = gridQuery || {
    sort: 'rating',
    filters: 'isSellout:true',
  };
  const pages = [];
  const diagnostics = {
    content: content.diagnostic,
    gridFound: Boolean(gridQuery),
    gridQuery: gridQuery || null,
    productSearchPages: [],
    productSearchPageMode: 'currentPage-zero-based',
  };
  let totalPages = 1;

  for (let page = 0; page < Math.min(totalPages, DM_SALE_MAX_PAGES); page += 1) {
    const url = buildDmSaleProductSearchUrl(query, page);
    let result;

    try {
      result = await fetchDmJson(url, { referer: sourceUrl });
    } catch (error) {
      const diagnostic = error.diagnostic || buildDmNetworkDiagnostic(url, error);
      diagnostics.productSearchPages.push({
        ...diagnostic,
        count: null,
        currentPage: page,
        pageSize: DM_SALE_PAGE_SIZE,
        totalPages,
        rawProducts: null,
        error: error.message,
      });
      diagnostics.productSearchError = {
        page,
        message: error.message,
        diagnostic,
      };

      if (pages.length === 0) {
        throw error;
      }

      break;
    }

    const payload = result.payload || {};

    pages.push({
      url,
      payload,
      httpStatus: result.response.status,
      contentType: result.response.headers?.['content-type'] || '',
      diagnostic: result.diagnostic,
    });
    diagnostics.productSearchPages.push({
      ...result.diagnostic,
      count: payload.count ?? null,
      currentPage: payload.currentPage ?? null,
      pageSize: payload.pageSize ?? null,
      totalPages: payload.totalPages ?? null,
      rawProducts: Array.isArray(payload.products) ? payload.products.length : null,
    });

    totalPages = Math.max(1, Number(payload.totalPages || 1));

    if (!Array.isArray(payload.products) || payload.products.length === 0) {
      break;
    }

    if (page + 1 < Math.min(totalPages, DM_SALE_MAX_PAGES)) {
      await delay(DM_SALE_PAGE_DELAY_MS);
    }
  }

  return {
    content,
    query,
    pages,
    diagnostics,
  };
}

async function fetchBinary(url, accept = 'application/pdf,*/*', { timeoutMs = 45000, maxContentLength = 40 * 1024 * 1024 } = {}) {
  const response = await axios.get(url, {
    timeout: timeoutMs,
    responseType: 'arraybuffer',
    maxContentLength,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept: accept,
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
    },
  });

  return {
    response,
    buffer: Buffer.from(response.data),
    canonicalUrl: response.request?.res?.responseUrl || url,
  };
}

function isSparOfficialPdfSource(source = {}) {
  const url = String(source.sourceUrl || '');
  const sourceRetailerFormat = String(source.sourceRetailerFormat || '').toLowerCase();
  return ['spar', 'eurospar', 'interspar'].includes(sourceRetailerFormat)
    && (source.sourceType === 'pdf' || /\/(?:getPdf|ViewPdf)\.ashx$/i.test(url))
    && /https:\/\/flugblatt\.(?:spar|interspar)\.at\//i.test(url);
}

async function crawlSparOfficialPdfSource({ source, crawlJobId, region }) {
  const sourceRetailerFormat = source.sourceRetailerFormat || 'spar';
  const sourceKey = sourceKeyForFormat(sourceRetailerFormat);
  const maxPdfBytes = Number(source.crawlPolicy?.maxPdfBytes || 40 * 1024 * 1024);
  const maxPages = Number(source.crawlPolicy?.maxPdfPages || 6);
  const { response, buffer, canonicalUrl } = await fetchBinary(source.sourceUrl, 'application/pdf,*/*', {
    timeoutMs: Number(source.crawlPolicy?.timeoutMs || 120000),
    maxContentLength: maxPdfBytes,
  });

  if (buffer.length > maxPdfBytes) {
    throw new Error(`SPAR PDF exceeds configured maxPdfBytes ${maxPdfBytes}.`);
  }

  const pdfSha256 = createHash(buffer);
  const validity = buildValidityFromSource(source);
  const pdfReference = await extractSparPdfReference({
    pdfBuffer: buffer,
    sourceUrl: canonicalUrl || source.sourceUrl,
    sourceRetailerFormat,
    validity,
    maxPages,
  });
  const normalizedOffers = normalizeSparPdfCandidatesToOffers({
    pdfReference,
    source,
    crawlJobId,
    region,
    pdfUrl: canonicalUrl || source.sourceUrl,
    pdfSha256,
  });
  const rejectionReasons = summarizeSparPdfRejections(pdfReference.candidates);

  const rawDocument = await createCompactRawDocument({
    sourceId: source._id,
    crawlJobId,
    retailerKey: source.retailerKey,
    region,
    documentType: 'pdf',
    sourceType: SPAR_PDF_SOURCE_TYPE,
    url: source.sourceUrl,
    canonicalUrl: source.sourceUrl,
    finalUrl: canonicalUrl,
    title: source.label || 'SPAR official PDF flyer',
    httpStatus: response.status,
    contentType: response.headers?.['content-type'] || '',
    downloadBytes: buffer.length,
    contentHash: pdfSha256,
    contentSnippet: pdfReference.candidates.slice(0, 8).map((candidate) => candidate.title || candidate.exclusionReason).join(' | '),
    extractedPreview: pdfReference.candidates.slice(0, 12).map((candidate) => candidate.title || candidate.exclusionReason).filter(Boolean),
    foundRawItems: pdfReference.candidates.length,
    parsedOffers: normalizedOffers.length,
    rejectedOffers: Math.max(0, pdfReference.candidates.length - normalizedOffers.length),
    parserVersion: SPAR_PDF_PARSER_VERSION,
    extractionConfidence: 0.8,
    rejectionReasons,
    payload: {
      sourceKind: 'pdf',
      sourceKey,
      sourceType: SPAR_PDF_SOURCE_TYPE,
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      sourceRetailerFormat,
      parserVersion: SPAR_PDF_PARSER_VERSION,
      extractionMethod: 'text-layer',
      pdfUrl: canonicalUrl || source.sourceUrl,
      pdfSha256,
      detectedPageCount: pdfReference.file.pages,
      detectedValidity: {
        validFrom: validity.validFrom ? validity.validFrom.toISOString() : null,
        validTo: validity.validTo ? validity.validTo.toISOString() : null,
        validityText: validity.validityText || '',
      },
      pageCandidateCounts: pdfReference.pages,
    },
  });

  const seen = new Set();
  const offerDocuments = normalizedOffers
    .map((offer) => enrichOffersForStorage([offer], {
      source,
      sourceType: SPAR_PDF_SOURCE_TYPE,
      parserVersion: SPAR_PDF_PARSER_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
    })[0])
    .filter(Boolean)
    .filter((offer) => {
      const key = [
        offer.rawFacts?.candidateId || '',
        offer.rawFacts?.page || '',
        normalizeTitleForMatch(offer.title || ''),
        String(offer.priceCurrent?.amount ?? ''),
        String(offer.quantityText || ''),
      ].join('::');

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const refreshResult = await replaceOffersForSource({
    sourceId: source._id,
    offerDocuments,
    coverageGuard: {
      minBaseline: Number(source.crawlPolicy?.coverageGuard?.minBaseline ?? 50),
      minReplacementRatio: Number(source.crawlPolicy?.coverageGuard?.minReplacementRatio ?? 0.35),
      minAbsoluteDrop: Number(source.crawlPolicy?.coverageGuard?.minAbsoluteDrop ?? 25),
    },
  });
  const replacementQuality = refreshResult.replacementQuality || (refreshResult.reason === 'coverage-drop-quality-risk' ? 'quality-risk' : 'complete');

  logger.info('SPAR PDF crawl parsed flyer', {
    sourceKey,
    sourceRetailerFormat,
    pages: pdfReference.file.pages,
    rawCandidates: pdfReference.candidates.length,
    rejectedCandidates: Math.max(0, pdfReference.candidates.length - offerDocuments.length),
    offersStored: offerDocuments.length,
    replacementQuality,
    refreshReason: refreshResult.reason || '',
  });

  return {
    offerDocuments,
    rawDocuments: 1,
    rawCandidateCount: pdfReference.candidates.length,
    pdfReports: [{
      sourceKey,
      sourceRetailerFormat,
      status: 'success',
      foundRawItems: pdfReference.candidates.length,
      parsedOffers: offerDocuments.length,
      rejectedCandidates: Math.max(0, pdfReference.candidates.length - offerDocuments.length),
      rejectionReasons,
      replacementQuality,
      refreshResult,
      pages: pdfReference.file.pages,
      rawDocumentId: rawDocument._id,
    }],
    httpLog: {
      status: response.status,
      contentType: response.headers?.['content-type'] || '',
      finalUrl: canonicalUrl || source.sourceUrl,
      downloadBytes: buffer.length,
      contentHash: pdfSha256,
    },
    refreshResult,
  };
}

function buildBillaPrice(hit) {
  const currentPrice = hit?.price?.regular?.value ? Number((hit.price.regular.value / 100).toFixed(2)) : null;
  const referencePrice = hit?.price?.crossed ? Number((hit.price.crossed / 100).toFixed(2)) : null;

  return {
    currentPrice,
    referencePrice,
    unit: normalizeUnitFromText(hit?.volumeLabelShort || hit?.price?.baseUnitShort || hit?.price?.baseUnitLong),
  };
}

function buildBillaNormalizedUnitPrice(hit, currentPrice) {
  const quantity = parseNumericAmount(hit?.amount);
  let unit = normalizeUnitFromText(hit?.volumeLabelShort || hit?.price?.baseUnitShort || hit?.price?.baseUnitLong);

  if (!quantity || !unit || !currentPrice) {
    return {
      amount: null,
      unit: '',
      comparable: false,
      confidence: 0,
    };
  }

  let comparableQuantity = quantity;

  if (unit === 'g') {
    comparableQuantity = quantity / 1000;
    unit = 'kg';
  }

  if (unit === 'ml') {
    comparableQuantity = quantity / 1000;
    unit = 'l';
  }

  if (!['kg', 'l', 'Stk'].includes(unit) || comparableQuantity <= 0) {
    return {
      amount: null,
      unit: '',
      comparable: false,
      confidence: 0,
    };
  }

  return {
    amount: Number((currentPrice / comparableQuantity).toFixed(2)),
    unit,
    comparable: true,
    confidence: 0.88,
  };
}

async function fetchBillaAlgoliaPromotionHits() {
  const endpoint = 'https://1L8FZ3LLKJ-dsn.algolia.net/1/indexes/prod_product_search/query';
  const headers = {
    'X-Algolia-API-Key': '4872917f97ea7474bd5a4efd496e16fb',
    'X-Algolia-Application-Id': '1L8FZ3LLKJ',
    'Content-Type': 'application/json',
  };
  const hits = [];
  const hitsPerPage = 500;

  for (let page = 0; page < 3; page += 1) {
    const response = await axios.post(
      endpoint,
      {
        query: '',
        page,
        hitsPerPage,
        filters: 'inPromotion:true',
      },
      {
        timeout: 30000,
        headers,
      }
    );

    const pageHits = Array.isArray(response.data?.hits) ? response.data.hits : [];
    hits.push(...pageHits);

    if (pageHits.length < hitsPerPage) {
      break;
    }
  }

  return hits;
}

function buildOfficialMatchKey({ title, currentPrice, unitPrice, unit }) {
  return [
    normalizeTitleForMatch(title),
    String(currentPrice ?? ''),
    String(unitPrice ?? ''),
    String(unit || ''),
  ].join('::');
}

async function attachBillaOfficialEvidence({ source, crawlJobId, region }) {
  const hits = await fetchBillaAlgoliaPromotionHits();
  const payload = {
    retailerKey: source.retailerKey,
    hitCount: hits.length,
    sample: hits.slice(0, 25),
  };

  await createCompactRawDocument({
    sourceId: source._id,
    crawlJobId,
    retailerKey: source.retailerKey,
    region,
    documentType: 'json',
    sourceType: 'json',
    url: source.sourceUrl,
    canonicalUrl: source.sourceUrl,
    finalUrl: source.sourceUrl,
    title: `${source.label} Algolia Promotions`,
    contentHash: createHash(JSON.stringify(payload)),
    contentSnippet: `Official BILLA promotion hits: ${hits.length}`,
    extractedPreview: hits.slice(0, 10).map((hit) => hit.name).filter(Boolean),
    foundRawItems: hits.length,
    parserVersion: PARSER_VERSION,
    payload: {
      retailerKey: source.retailerKey,
      hitCount: hits.length,
      sampleNames: hits.slice(0, 5).map((hit) => sanitizeWhitespace(hit?.name || '')).filter(Boolean),
    },
  });

  const now = new Date();
  const currentOffers = await Offer.find({
    retailerKey: source.retailerKey,
    validFrom: { $lte: now },
    validTo: { $gte: now },
  })
    .select('_id title brand priceCurrent normalizedUnitPrice imageUrl')
    .lean();

  const offerMap = new Map();

  for (const offer of currentOffers) {
    const exactKey = buildOfficialMatchKey({
      title: `${offer.brand || ''} ${offer.title}`,
      currentPrice: offer.priceCurrent?.amount,
      unitPrice: offer.normalizedUnitPrice?.amount,
      unit: offer.normalizedUnitPrice?.unit,
    });
    const titlePriceKey = [
      normalizeTitleForMatch(`${offer.brand || ''} ${offer.title}`),
      String(offer.priceCurrent?.amount ?? ''),
    ].join('::');

    if (!offerMap.has(exactKey)) {
      offerMap.set(exactKey, []);
    }

    if (!offerMap.has(titlePriceKey)) {
      offerMap.set(titlePriceKey, []);
    }

    offerMap.get(exactKey).push(offer);
    offerMap.get(titlePriceKey).push(offer);
  }

  const evidence = buildSourceEvidence({
    source,
    observedUrl: source.sourceUrl,
    matchType: 'official-confirmed',
  });
  const updates = [];
  let matchedOffers = 0;

  for (const hit of hits) {
    const { currentPrice, unit } = buildBillaPrice(hit);
    const normalizedUnitPrice = buildBillaNormalizedUnitPrice(hit, currentPrice);
    const exactKey = buildOfficialMatchKey({
      title: `${hit.brand?.name || ''} ${hit.name || ''}`,
      currentPrice,
      unitPrice: normalizedUnitPrice.amount,
      unit: normalizedUnitPrice.unit || unit,
    });
    const titlePriceKey = [
      normalizeTitleForMatch(`${hit.brand?.name || ''} ${hit.name || ''}`),
      String(currentPrice ?? ''),
    ].join('::');
    const matches = offerMap.get(exactKey) || offerMap.get(titlePriceKey) || [];

    for (const match of matches) {
      matchedOffers += 1;
      updates.push({
        updateOne: {
          filter: { _id: match._id },
          update: {
            $addToSet: {
              supportingSources: evidence,
            },
            ...(match.imageUrl ? {} : { $set: { imageUrl: normalizeImageUrl(hit.images?.[0] || '', source.sourceUrl) } }),
          },
        },
      });
    }
  }

  if (updates.length > 0) {
    await Offer.bulkWrite(updates, { ordered: false });
  }

  return {
    hitCount: hits.length,
    matchedOffers,
    rawDocuments: 1,
  };
}

function determineBillaBenefitType(hit) {
  const tags = [...(hit?.price?.regular?.tags || []), ...(hit?.price?.loyalty?.tags || [])].join(' ');

  if (/pt-multi|pt-2plus1|pt-4plus2|pt-7plus1/i.test(tags)) {
    return 'multi-buy';
  }

  if (hit?.price?.crossed || hit?.price?.discountPercentage) {
    return 'price-cut';
  }

  return 'unknown';
}

function buildBillaConditionsText(hit) {
  return sanitizeWhitespace(
    [
      hit?.price?.regular?.promotionText || '',
      hit?.price?.loyalty?.promotionText || '',
    ]
      .filter(Boolean)
      .join(' / ')
  );
}

function normalizeBillaPromotionToOffer({ hit, source, crawlJobId, region, observedUrl }) {
  const { currentPrice, referencePrice } = buildBillaPrice(hit);
  const normalizedUnitPrice = buildBillaNormalizedUnitPrice(hit, currentPrice);
  const title = sanitizeWhitespace(`${hit?.brand?.name || ''} ${hit?.name || ''}`) || sanitizeWhitespace(hit?.name || '');
  const categoryPrimary = determineOfferCategory({
    title,
    contextText: hit?.category || '',
    sourceCategory: hit?.category || '',
  });
  const scopeDecision = buildInclusiveScopeDecision();
  const quantityText = sanitizeWhitespace(
    [hit?.amount, hit?.volumeLabelShort || hit?.packageLabel || hit?.packageLabelKey].filter(Boolean).join(' ')
  );
  const conditionsText = buildBillaConditionsText(hit);
  const customerProgramRequired = Boolean(hit?.price?.loyalty);
  const statusInfo = buildOfferStatus(new Date(), null, true);
  const issues = [];

  if (!normalizedUnitPrice.comparable) {
    issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
  }

  issues.push('Gueltigkeitsende aus offizieller Quelle nicht eindeutig ableitbar');

  if (customerProgramRequired) {
    issues.push('Angebot erfordert Kundenprogramm oder App');
  }

  const overrideResult = applyManualCategoryOverridesToOfferSync({
    crawlJobId,
    sourceId: source._id,
    retailerKey: source.retailerKey,
    retailerName: source.retailerName,
    region,
    title,
    brand: sanitizeWhitespace(hit?.brand?.name || ''),
    categoryPrimary,
    categorySecondary: determineOfferSubcategory({
      primaryCategory: categoryPrimary,
      sourceCategory: hit?.category || '',
      fallbackLabel: categoryPrimary,
      title,
      contextText: hit?.category || '',
    }),
    comparisonSignature: normalizeTitleForMatch(title).split(' ').slice(0, 8).join('-'),
    comparisonQuantityKey: quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '',
    comparisonCategoryKey: normalizeTitleForMatch(hit?.category || categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
    description: sanitizeWhitespace(hit?.descriptionShort || hit?.descriptionLong || ''),
    sourceUrl: observedUrl || source.sourceUrl,
    imageUrl: normalizeImageUrl(hit?.images?.[0] || '', source.sourceUrl),
    supportingSources: [
      buildSourceEvidence({
        source,
        observedUrl: observedUrl || source.sourceUrl,
        matchType: 'primary',
      }),
    ],
    validFrom: new Date(),
    validTo: null,
    status: statusInfo.status,
    isActiveNow: statusInfo.isActiveNow,
    isActiveToday: statusInfo.isActiveToday,
    benefitType: determineBillaBenefitType(hit),
    conditionsText,
    customerProgramRequired,
    availabilityScope: region || 'Grossraum Graz',
    priceCurrent: {
      amount: currentPrice,
      currency: 'EUR',
      originalText: currentPrice ? `${currentPrice.toFixed(2)} EUR` : '',
    },
    priceReference: {
      amount: referencePrice,
      currency: 'EUR',
      originalText: referencePrice ? `${referencePrice.toFixed(2)} EUR` : '',
    },
    quantityText,
    normalizedUnitPrice,
    quality: {
      completenessScore: [currentPrice, title, categoryPrimary].filter(Boolean).length / 3,
      parsingConfidence: normalizedUnitPrice.comparable ? 0.88 : 0.76,
      comparisonSafe: normalizedUnitPrice.comparable,
      issues,
    },
    rawFacts: {
      sourceType: 'billa-official-algolia',
      objectID: hit?.objectID || '',
      sku: hit?.sku || '',
      category: hit?.category || '',
      tags: hit?.price?.regular?.tags || [],
      loyaltyTags: hit?.price?.loyalty?.tags || [],
      discountPercentage: parseNumericAmount(hit?.price?.discountPercentage),
      snapshotCurrent: true,
    },
    adminReview: {
      status: issues.length > 0 ? 'pending' : 'reviewed',
      note: '',
      feedbackDigest: '',
    },
    scope: scopeDecision,
  });

  return overrideResult.offer || null;
}

async function crawlBillaOfficialPromotions({ source, crawlJobId, region }) {
  const hits = await fetchBillaAlgoliaPromotionHits();
  const payload = {
    retailerKey: source.retailerKey,
    hitCount: hits.length,
    sample: hits.slice(0, 25),
  };

  await createCompactRawDocument({
    sourceId: source._id,
    crawlJobId,
    retailerKey: source.retailerKey,
    region,
    documentType: 'json',
    url: source.sourceUrl,
    canonicalUrl: source.sourceUrl,
    title: `${source.label} Algolia Promotions`,
    contentHash: createHash(JSON.stringify(payload)),
    contentSnippet: `Official BILLA promotion hits: ${hits.length}`,
    extractedPreview: hits.slice(0, 10).map((hit) => hit.name).filter(Boolean),
    payload: {
      retailerKey: source.retailerKey,
      hitCount: hits.length,
      sampleNames: hits.slice(0, 5).map((hit) => sanitizeWhitespace(hit?.name || '')).filter(Boolean),
    },
  });

  const normalizedOffers = hits.map((hit) =>
    normalizeBillaPromotionToOffer({
      hit,
      source,
      crawlJobId,
      region,
      observedUrl: source.sourceUrl,
    })
  );
  const offerDocuments = enrichOffersForStorage(normalizedOffers, {
    source,
    sourceType: 'billa-official-algolia',
    parserVersion: PARSER_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
  });

  const refreshResult = await replaceOffersForSource({
    sourceId: source._id,
    offerDocuments,
  });

  return {
    hitCount: hits.length,
    offerDocuments,
    rawDocuments: 1,
    refreshResult,
  };
}

async function collectPennyOfficialApiOffers({
  html,
  source,
  crawlJobId,
  region,
  pageUrl,
  fetchProductsPage = fetchPennyProductGroupProducts,
}) {
  const categorySlugs = extractPennyProductGroupSlugsFromHtml(html).slice(0, 1);
  const offers = [];
  const diagnostics = {
    categorySlugs,
    pagesFetched: 0,
    productsFetched: 0,
    totalAvailable: 0,
    errors: [],
  };

  for (const categorySlug of categorySlugs) {
    let page = 0;
    let total = 0;

    while (page < PENNY_PRODUCT_GROUP_MAX_PAGES) {
      let payload;

      try {
        payload = await fetchProductsPage({
          categorySlug,
          page,
          pageSize: PENNY_PRODUCT_GROUP_PAGE_SIZE,
          referer: pageUrl || source.sourceUrl,
        });
      } catch (error) {
        diagnostics.errors.push({
          categorySlug,
          page,
          message: error.message,
          httpStatus: error.response?.status ?? null,
        });
        break;
      }

      const products = Array.isArray(payload?.results) ? payload.results : [];
      total = Number(payload?.total || products.length || 0);
      diagnostics.pagesFetched += 1;
      diagnostics.productsFetched += products.length;
      diagnostics.totalAvailable = Math.max(diagnostics.totalAvailable, total);

      offers.push(...normalizePennyApiProductsToOffers({
        products,
        source,
        crawlJobId,
        region,
        pageUrl,
        categorySlug,
      }));

      page += 1;

      if (!products.length || page >= Math.ceil(total / PENNY_PRODUCT_GROUP_PAGE_SIZE)) {
        break;
      }

      await delay(150);
    }
  }

  return {
    offers,
    diagnostics,
  };
}

async function crawlPennyOfficialOffers({ source, crawlJobId, region, html, canonicalUrl }) {
  const htmlOffers = parsePennyOffersFromHtml({
    html,
    source,
    crawlJobId,
    region,
    pageUrl: canonicalUrl || source.sourceUrl,
  });
  const apiResult = await collectPennyOfficialApiOffers({
    html,
    source,
    crawlJobId,
    region,
    pageUrl: canonicalUrl || source.sourceUrl,
  });
  const seen = new Set();
  const normalizedOffers = [];

  for (const offer of [...apiResult.offers, ...htmlOffers]) {
    const key = [
      offer.sourceUrl,
      offer.validFrom?.toISOString?.() || '',
      offer.validTo?.toISOString?.() || '',
      offer.priceCurrent?.amount || '',
    ].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalizedOffers.push(offer);
  }

  const offerDocuments = enrichOffersForStorage(normalizedOffers, {
    source,
    sourceType: 'penny-official-html',
    parserVersion: PARSER_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
  });

  const refreshResult = await replaceOffersForSource({
    sourceId: source._id,
    offerDocuments,
  });

  return {
    offerDocuments,
    rawDocuments: 0,
    rawCandidateCount: htmlOffers.length + apiResult.diagnostics.productsFetched,
    diagnostics: apiResult.diagnostics,
    refreshResult,
  };
}

async function crawlPennyOfficialFlyers({ source, crawlJobId, region, html, links }) {
  const pdfLinks = links.filter((link) => link.type === 'pdf');
  const issuuDocuments = extractIssuuDocumentsFromHtml(html);
  const collectedOffers = [];
  const pdfReports = [];
  const rawDocuments = [];

  const pdfTargets = [];

  for (const link of pdfLinks) {
    pdfTargets.push({
      kind: 'direct-pdf',
      label: link.label,
      pdfUrl: link.url,
      observedUrl: link.url,
    });
  }

  for (const document of issuuDocuments.slice(0, 3)) {
    try {
      const resolved = await resolveIssuuOriginalPdfUrl(document);
      pdfTargets.push({
        kind: 'issuu-original-pdf',
        label: resolved.title,
        pdfUrl: resolved.pdfUrl,
        observedUrl: document.documentUrl,
        publicationId: resolved.publicationId,
        revisionId: resolved.revisionId,
        pageCount: resolved.pageCount,
      });
    } catch (error) {
      pdfReports.push({
        kind: 'issuu-original-pdf',
        observedUrl: document.documentUrl,
        status: 'failed',
        error: error.message,
      });
    }
  }

  const seenPdfUrls = new Set();

  for (const target of pdfTargets) {
    if (!target.pdfUrl || seenPdfUrls.has(target.pdfUrl)) {
      continue;
    }

    seenPdfUrls.add(target.pdfUrl);

    try {
      const { response, buffer, canonicalUrl } = await fetchBinary(target.pdfUrl);
      const pdfReference = await extractPennyPdfReference({
        pdfBuffer: buffer,
        sourceUrl: target.observedUrl || canonicalUrl || target.pdfUrl,
      });
      const normalizedOffers = normalizePennyPdfCandidatesToOffers({
        pdfReference,
        source,
        crawlJobId,
        region,
        pdfUrl: target.observedUrl || canonicalUrl || target.pdfUrl,
      });
      const rejectionReasons = summarizeRejections(pdfReference.candidates);
      const rawDocument = await createCompactRawDocument({
        sourceId: source._id,
        crawlJobId,
        retailerKey: source.retailerKey,
        region,
        documentType: 'pdf',
        sourceType: 'penny-official-pdf',
        url: target.observedUrl || target.pdfUrl,
        canonicalUrl: target.observedUrl || target.pdfUrl,
        finalUrl: canonicalUrl,
        title: target.label || 'PENNY official PDF leaflet',
        httpStatus: response.status,
        contentType: response.headers?.['content-type'] || '',
        downloadBytes: buffer.length,
        contentHash: createHash(buffer),
        contentSnippet: pdfReference.candidates.slice(0, 8).map((candidate) => candidate.title).join(' | '),
        extractedPreview: pdfReference.candidates.slice(0, 12).map((candidate) => candidate.title).filter(Boolean),
        foundRawItems: pdfReference.candidates.length,
        parsedOffers: normalizedOffers.length,
        rejectedOffers: Math.max(0, pdfReference.candidates.length - normalizedOffers.length),
        parserVersion: PENNY_PDF_PARSER_VERSION,
        extractionConfidence: 0.68,
        rejectionReasons,
        payload: {
          kind: target.kind,
          sourceKind: 'pdf',
          sourceKey: PENNY_PDF_SOURCE_KEY,
          sourceType: 'penny-official-pdf',
          retailerKey: source.retailerKey,
          retailerName: source.retailerName,
          parserVersion: PENNY_PDF_PARSER_VERSION,
          observedUrl: target.observedUrl || '',
          publicationId: target.publicationId || '',
          revisionId: target.revisionId || '',
          detectedPageCount: pdfReference.file.pages,
          sourcePageCount: target.pageCount || 0,
          detectedValidity: {
            validFrom: pdfReference.validity.validFrom ? pdfReference.validity.validFrom.toISOString() : null,
            validTo: pdfReference.validity.validTo ? pdfReference.validity.validTo.toISOString() : null,
            detectedDates: pdfReference.validity.detectedDates,
          },
          pageCandidateCounts: pdfReference.pages,
        },
      });

      rawDocuments.push(rawDocument);
      collectedOffers.push(...normalizedOffers);
      logger.info('PENNY PDF crawl parsed flyer', {
        sourceKey: PENNY_PDF_SOURCE_KEY,
        observedUrl: target.observedUrl || '',
        pages: pdfReference.file.pages,
        rawCandidates: pdfReference.candidates.length,
        rejectedCandidates: Math.max(0, pdfReference.candidates.length - normalizedOffers.length),
        rejectionReasons: rejectionReasons.slice(0, 6),
        offersCreated: normalizedOffers.length,
      });
      pdfReports.push({
        kind: target.kind,
        sourceKey: PENNY_PDF_SOURCE_KEY,
        observedUrl: target.observedUrl || '',
        status: 'success',
        foundRawItems: pdfReference.candidates.length,
        parsedOffers: normalizedOffers.length,
        rejectedCandidates: Math.max(0, pdfReference.candidates.length - normalizedOffers.length),
        rejectionReasons: rejectionReasons.slice(0, 6),
        pages: pdfReference.file.pages,
      });
    } catch (error) {
      pdfReports.push({
        kind: target.kind,
        observedUrl: target.observedUrl || target.pdfUrl,
        status: 'failed',
        error: error.message,
      });
    }
  }

  const seen = new Set();
  const offerDocuments = collectedOffers
    .map((offer) => enrichOffersForStorage([offer], {
      source,
      sourceType: 'penny-official-pdf',
      parserVersion: PENNY_PDF_PARSER_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
    })[0])
    .filter(Boolean)
    .filter((offer) => {
      const key = [
        offer.rawFacts?.candidateId || '',
        offer.rawFacts?.page || '',
        normalizeTitleForMatch(offer.title || ''),
        String(offer.priceCurrent?.amount ?? ''),
        String(offer.quantityText || ''),
      ].join('::');

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

  const refreshResult = await replaceOffersForSource({
    sourceId: source._id,
    offerDocuments,
  });

  logger.info('PENNY PDF crawl summary', {
    sourceKey: PENNY_PDF_SOURCE_KEY,
    pdfTargets: seenPdfUrls.size,
    pages: pdfReports.reduce((sum, item) => sum + Number(item.pages || 0), 0),
    rawCandidates: pdfReports.reduce((sum, item) => sum + Number(item.foundRawItems || 0), 0),
    rejectedCandidates: pdfReports.reduce((sum, item) => sum + Number(item.rejectedCandidates || 0), 0),
    offersStored: offerDocuments.length,
  });

  return {
    offerDocuments,
    rawDocuments: rawDocuments.length,
    rawCandidateCount: pdfReports.reduce((sum, item) => sum + Number(item.foundRawItems || 0), 0),
    pdfReports,
    refreshResult,
  };
}

async function crawlLidlOfficialFlyers({ source, crawlJobId, region, html }) {
  const flyerIdentifiers = extractLidlFlyerIdentifiers(html);
  const collectedOffers = [];
  const seenFlyers = [];
  const diagnostics = {
    flyerIdentifiers: flyerIdentifiers.length,
    flyerRawProducts: 0,
    campaignPagesDiscovered: 0,
    campaignPagesSeeded: 0,
    campaignPages: [],
    campaignRawCards: 0,
    campaignParsedOffers: 0,
    skipReasons: {},
  };

  for (const identifier of flyerIdentifiers.slice(0, 8)) {
    let flyer = null;

    try {
      flyer = await fetchLidlFlyerByIdentifier(identifier);
    } catch (error) {
      continue;
    }

    if (!flyer?.isActive || !flyer?.products || Object.keys(flyer.products).length === 0) {
      continue;
    }

    seenFlyers.push({
      id: flyer.id,
      name: flyer.name,
      title: flyer.title,
      productCount: Object.keys(flyer.products).length,
      offerStartDate: flyer.offerStartDate || flyer.startDate,
      offerEndDate: flyer.offerEndDate || flyer.endDate,
      url: flyer.flyerUrlAbsolute,
    });

    const flyerProducts = Object.values(flyer.products);
    diagnostics.flyerRawProducts += flyerProducts.length;

    for (const product of flyerProducts) {
      const normalized = normalizeLidlProductToOffer({
        product,
        flyer,
        source,
        crawlJobId,
        region,
      });

      if (normalized) {
        collectedOffers.push(normalized);
      }
    }
  }

  const campaignPagesForCrawl = getLidlCampaignPagesForCrawl({ html, source });
  diagnostics.campaignPagesDiscovered = extractLidlCampaignPageLinksFromHtml(html, source.sourceUrl).length;
  diagnostics.campaignPagesSeeded = campaignPagesForCrawl.length;

  for (const pageUrl of campaignPagesForCrawl) {
    try {
      const page = await fetchLidlOfficialPageHtml(pageUrl);
      const pageDiagnostics = {};
      const pageOffers = parseLidlOfficialSiteOffersFromHtml({
        html: page.html,
        source,
        crawlJobId,
        region,
        pageUrl: page.canonicalUrl || pageUrl,
        diagnostics: pageDiagnostics,
      });

      diagnostics.campaignPages.push({
        url: pageUrl,
        finalUrl: page.canonicalUrl || pageUrl,
        httpStatus: page.response?.status || null,
        rawCards: pageDiagnostics.rawCards || 0,
        parsedOffers: pageOffers.length,
        skipReasons: pageDiagnostics.skipReasons || {},
      });
      diagnostics.campaignRawCards += pageDiagnostics.rawCards || 0;
      diagnostics.campaignParsedOffers += pageOffers.length;
      Object.entries(pageDiagnostics.skipReasons || {}).forEach(([reason, count]) => {
        diagnostics.skipReasons[reason] = (diagnostics.skipReasons[reason] || 0) + count;
      });
      collectedOffers.push(...pageOffers);
    } catch (error) {
      diagnostics.campaignPages.push({
        url: pageUrl,
        finalUrl: pageUrl,
        httpStatus: error.response?.status || null,
        rawCards: 0,
        parsedOffers: 0,
        error: error.message,
      });
      diagnostics.skipReasons['campaign-page-fetch-failed'] = (diagnostics.skipReasons['campaign-page-fetch-failed'] || 0) + 1;
    }
  }

  const dedupedOffers = dedupeLidlOffers(collectedOffers, diagnostics);
  const offerDocuments = dedupedOffers
    .map((offer) => enrichOffersForStorage([offer], {
      source,
      sourceType: offer.rawFacts?.sourceType || 'lidl-official-flyer-api',
      parserVersion: PARSER_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
    })[0])
    .filter(Boolean);

  const refreshResult = await replaceOffersForSource({
    sourceId: source._id,
    offerDocuments,
  });
  const flyerParsedOffers = collectedOffers.filter((offer) => offer.rawFacts?.sourceType === 'lidl-official-flyer-api').length;

  await createCompactRawDocument({
    sourceId: source._id,
    crawlJobId,
    retailerKey: source.retailerKey,
    region,
    documentType: 'json',
    sourceType: 'flyer',
    url: source.sourceUrl,
    canonicalUrl: source.sourceUrl,
    finalUrl: source.sourceUrl,
    title: `${source.label} Flyer Snapshot`,
    contentHash: createHash(JSON.stringify(seenFlyers)),
    contentSnippet: `Lidl official flyer API: ${seenFlyers.length} produktfaehige Flyer, ${flyerParsedOffers} Offers.`,
    extractedPreview: seenFlyers.slice(0, 5).map((item) => `${item.name} (${item.productCount})`),
    foundRawItems: diagnostics.flyerRawProducts,
    parsedOffers: flyerParsedOffers,
    rejectedOffers: Math.max(0, diagnostics.flyerRawProducts - flyerParsedOffers),
    parserVersion: PARSER_VERSION,
    payload: {
      flyerCount: seenFlyers.length,
      offerCount: flyerParsedOffers,
      flyers: seenFlyers.slice(0, 6),
    },
  });

  await createCompactRawDocument({
    sourceId: source._id,
    crawlJobId,
    retailerKey: source.retailerKey,
    region,
    documentType: 'json',
    sourceType: 'lidl-official-html',
    url: source.sourceUrl,
    canonicalUrl: source.sourceUrl,
    finalUrl: source.sourceUrl,
    title: 'Lidl official campaign pages snapshot',
    contentHash: createHash(JSON.stringify(diagnostics.campaignPages)),
    contentSnippet: `Lidl official campaign pages: ${diagnostics.campaignPages.length} Seiten, ${diagnostics.campaignRawCards} Karten, ${diagnostics.campaignParsedOffers} Offers vor Dedupe.`,
    extractedPreview: diagnostics.campaignPages.map((item) => `${item.url} (${item.rawCards}/${item.parsedOffers})`).slice(0, 8),
    foundRawItems: diagnostics.campaignRawCards,
    parsedOffers: diagnostics.campaignParsedOffers,
    rejectedOffers: Math.max(0, diagnostics.campaignRawCards - diagnostics.campaignParsedOffers),
    parserVersion: PARSER_VERSION,
    rejectionReasons: Object.entries(diagnostics.skipReasons).map(([reason, count]) => ({ reason, count })),
    payload: {
      campaignPages: diagnostics.campaignPages,
      skipReasons: diagnostics.skipReasons,
      dedupedOffers: diagnostics.dedupedOffers || 0,
    },
  });

  return {
    offerDocuments,
    rawDocuments: 2,
    rawCandidateCount: diagnostics.flyerRawProducts + diagnostics.campaignRawCards,
    refreshResult,
    diagnostics,
  };
}

async function crawlBipaOfficialOffers({ source, crawlJobId, region, html, canonicalUrl }) {
  const collectedOffers = [];
  const validToHint = extractBipaValidityDate(html);
  const pageCandidates = [
    { url: canonicalUrl || source.sourceUrl, html },
  ];
  const additionalLinks = collectBipaPromotionLinks(html, canonicalUrl || source.sourceUrl);

  for (const link of additionalLinks) {
    if (pageCandidates.some((item) => item.url === link.url)) {
      continue;
    }

    try {
      const nested = await fetchHtml(link.url);
      pageCandidates.push({
        url: nested.canonicalUrl || link.url,
        html: nested.html,
      });
    } catch (error) {
      // Continue with the pages that were fetched successfully.
    }
  }

  for (const page of pageCandidates) {
    const pageOffers = parseBipaOffersFromHtml({
      html: page.html,
      source,
      crawlJobId,
      region,
      pageUrl: page.url,
      validToHint,
    });

    collectedOffers.push(...pageOffers);
  }

  const seen = new Set();
  const offerDocuments = collectedOffers
    .map((offer) => enrichOffersForStorage([offer], {
      source,
      sourceType: 'bipa-official-html',
      parserVersion: PARSER_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
    })[0])
    .filter(Boolean)
    .filter((offer) => {
      const key = [
        normalizeTitleForMatch(`${offer.brand || ''} ${offer.title || ''}`),
        String(offer.priceCurrent?.amount ?? ''),
        String(offer.quantityText || ''),
      ].join('::');

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

  const refreshResult = await replaceOffersForSource({
    sourceId: source._id,
    offerDocuments,
  });

  return {
    offerDocuments,
    rawDocuments: 0,
    rawCandidateCount: collectedOffers.length,
    refreshResult,
  };
}

function compactDmSkipReasons(skipReasons = {}) {
  return Object.entries(skipReasons || {})
    .filter(([, count]) => Number(count) > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => ({ reason, count }));
}

function summarizeDmOfficialSaleMessage(report = {}) {
  const productPages = Array.isArray(report.productSearchPages) ? report.productSearchPages : [];
  const firstProductPage = productPages[0] || {};
  const rawProducts = Number(report.rawProducts || 0);
  const parsedOffers = Number(report.parsedBeforeEnrichment || report.parsedOffers || 0);
  const storedOffers = Number(report.enrichedBeforeDedupe || report.storedOffers || 0);
  const skipReasons = compactDmSkipReasons(report.skipReasons);
  const topSkip = skipReasons[0];

  if (storedOffers > 0) {
    return `dm Ausverkauf product search stored ${storedOffers} offers from ${rawProducts} raw products (count=${firstProductPage.count ?? report.reportedTotalResults ?? 'unknown'}, pages=${report.pagesFetched ?? productPages.length}).`;
  }

  if (report.error) {
    const diagnostic = report.errorDiagnostic || {};
    const stage = report.failureStage || 'dm endpoint';
    const status = diagnostic.httpStatus ? ` HTTP ${diagnostic.httpStatus}` : '';
    const html = diagnostic.isHtml ? ' html' : '';
    const preview = diagnostic.bodyPreview ? ` preview="${diagnostic.bodyPreview}"` : '';
    return `${stage} failed:${status}${html} ${report.error}.${preview}`.trim();
  }

  if (report.content && report.content.isHtml) {
    return 'dm content endpoint returned non-json/html.';
  }

  if (report.content && report.content.isJson === false) {
    return 'dm content endpoint returned non-json response.';
  }

  if (firstProductPage.httpStatus && (firstProductPage.httpStatus < 200 || firstProductPage.httpStatus >= 300)) {
    return `dm product search returned HTTP ${firstProductPage.httpStatus}.`;
  }

  if (firstProductPage.isHtml) {
    return 'dm product search returned non-json/html.';
  }

  if (!report.gridFound && rawProducts === 0) {
    return 'No DMSearchProductGrid found and product search returned no raw products.';
  }

  if (Number(firstProductPage.count) === 0) {
    return 'dm product search count=0.';
  }

  if (rawProducts === 0) {
    return 'No products parsed from dm product-search response shape.';
  }

  if (parsedOffers === 0 && rawProducts > 0) {
    return topSkip
      ? `All dm products skipped: ${topSkip.reason} (${topSkip.count}/${rawProducts}).`
      : 'All dm products skipped before offer normalization.';
  }

  if (parsedOffers > 0 && storedOffers === 0) {
    return `All parsed dm offers rejected during enrichment/current relevance (${parsedOffers}/${rawProducts}).`;
  }

  return 'dm Ausverkauf produced no offers; diagnostics did not identify a narrower reason.';
}

async function diagnoseDmOfficialSaleSource({ source, region = 'AT', crawlJobId = null } = {}) {
  const effectiveSource = {
    retailerKey: 'dm',
    retailerName: 'dm',
    channel: 'official-site',
    sourceUrl: 'https://www.dm.at/ausverkauf',
    label: 'dm Ausverkauf',
    sourceType: 'offers-page',
    ...source,
  };
  const report = {
    url: effectiveSource.sourceUrl,
    region,
    initialPage: null,
    htmlParsedOffers: 0,
    content: null,
    gridFound: false,
    extractedProductSearchUrl: '',
    productSearchPages: [],
    rawProducts: 0,
    sampleRawProduct: null,
    parsedOffers: 0,
    sampleParsedOffer: null,
    skipReasons: {},
    message: '',
  };

  try {
    const { response, html, canonicalUrl } = await fetchHtml(effectiveSource.sourceUrl);
    report.initialPage = buildDmEndpointDiagnostic({
      url: effectiveSource.sourceUrl,
      response,
      payload: html,
      canonicalUrl,
    });
    report.htmlParsedOffers = parseDmSaleOffersFromHtml({
      html,
      source: effectiveSource,
      crawlJobId,
      region,
      pageUrl: canonicalUrl || effectiveSource.sourceUrl,
    }).length;

    const productSearch = await fetchDmSaleProductSearchPages({ sourceUrl: canonicalUrl || effectiveSource.sourceUrl });
    const parseDiagnostics = {};
    const products = productSearch.pages.flatMap((page) => (
      Array.isArray(page.payload?.products) ? page.payload.products : []
    ));
    const parsedOffers = productSearch.pages.flatMap((page) => parseDmSaleOffersFromProductSearchJson({
      payload: page.payload,
      source: effectiveSource,
      crawlJobId,
      region,
      pageUrl: canonicalUrl || effectiveSource.sourceUrl,
      diagnostics: parseDiagnostics,
    }));

    report.content = productSearch.diagnostics.content;
    report.gridFound = productSearch.diagnostics.gridFound;
    report.gridQuery = productSearch.diagnostics.gridQuery;
    report.extractedProductSearchUrl = productSearch.pages[0]?.url || buildDmSaleProductSearchUrl(productSearch.query, 0);
    report.productSearchPages = productSearch.diagnostics.productSearchPages;
    report.productSearchError = productSearch.diagnostics.productSearchError || null;
    report.rawProducts = products.length;
    report.sampleRawProduct = products[0]
      ? {
        dan: products[0].dan || products[0]?.tileData?.dan || null,
        brandName: products[0].brandName || products[0]?.tileData?.brand?.name || '',
        title: products[0].title || products[0]?.tileData?.title || '',
        price: products[0]?.tileData?.price || null,
        eyecatchers: products[0]?.tileData?.eyecatchers || [],
      }
      : null;
    report.parsedOffers = parsedOffers.length;
    report.sampleParsedOffer = parsedOffers[0]
      ? {
        title: parsedOffers[0].title,
        brand: parsedOffers[0].brand,
        priceCurrent: parsedOffers[0].priceCurrent?.amount,
        priceReference: parsedOffers[0].priceReference?.amount,
        quantityText: parsedOffers[0].quantityText,
        validTo: parsedOffers[0].validTo || null,
        categoryPrimary: parsedOffers[0].categoryPrimary,
        categorySecondary: parsedOffers[0].categorySecondary,
      }
      : null;
    report.skipReasons = parseDiagnostics.skipReasons || {};
    report.message = summarizeDmOfficialSaleMessage({
      ...productSearch.diagnostics,
      rawProducts: products.length,
      parsedBeforeEnrichment: parsedOffers.length,
      enrichedBeforeDedupe: parsedOffers.length,
      skipReasons: parseDiagnostics.skipReasons || {},
      productSearchPages: productSearch.diagnostics.productSearchPages,
    });
  } catch (error) {
    const diagnostic = error.diagnostic || buildDmNetworkDiagnostic(report.extractedProductSearchUrl || DM_CONTENT_PATH, error);
    report.error = error.message;
    report.errorDiagnostic = diagnostic;
    report.message = summarizeDmOfficialSaleMessage({
      error: error.message,
      failureStage: diagnostic.url === DM_CONTENT_PATH ? 'dm content endpoint' : 'dm product search',
      errorDiagnostic: diagnostic,
    });
  }

  return report;
}

async function crawlDmOfficialSaleOffers({ source, crawlJobId, region, html, canonicalUrl }) {
  const pageUrl = canonicalUrl || source.sourceUrl;
  const htmlOffers = parseDmSaleOffersFromHtml({
    html,
    source,
    crawlJobId,
    region,
    pageUrl,
  });
  let normalizedOffers = htmlOffers;
  let rawCandidateCount = htmlOffers.length;
  let rawDocuments = 0;
  let productSearchReport = null;
  const productParseDiagnostics = {};

  try {
    const productSearch = await fetchDmSaleProductSearchPages({ sourceUrl: pageUrl });
    const products = productSearch.pages.flatMap((page) => (
      Array.isArray(page.payload?.products) ? page.payload.products : []
    ));
    const apiOffers = productSearch.pages.flatMap((page) => parseDmSaleOffersFromProductSearchJson({
      payload: page.payload,
      source,
      crawlJobId,
      region,
      pageUrl,
      diagnostics: productParseDiagnostics,
    }));

    if (apiOffers.length > 0 || products.length > 0) {
      normalizedOffers = apiOffers;
      rawCandidateCount = products.length;
    }

    productSearchReport = {
      ...productSearch.diagnostics,
      contentPath: DM_CONTENT_PATH,
      productSearchUrl: DM_PRODUCT_SEARCH_URL,
      filters: productSearch.query?.filters || '',
      sort: productSearch.query?.sort || '',
      pagesFetched: productSearch.pages.length,
      reportedTotalResults: productSearch.pages[0]?.payload?.count || 0,
      reportedTotalPages: productSearch.pages[0]?.payload?.totalPages || 0,
      productSearchError: productSearch.diagnostics.productSearchError || null,
      rawProducts: products.length,
      parsedOffers: apiOffers.length,
      skipReasons: productParseDiagnostics.skipReasons || {},
      sampleRawProduct: products[0]
        ? {
          dan: products[0].dan || products[0]?.tileData?.dan || null,
          brandName: products[0].brandName || products[0]?.tileData?.brand?.name || '',
          title: products[0].title || products[0]?.tileData?.title || '',
          price: products[0]?.tileData?.price || null,
          eyecatchers: products[0]?.tileData?.eyecatchers || [],
        }
        : null,
    };

    await createCompactRawDocument({
      sourceId: source._id,
      crawlJobId,
      retailerKey: source.retailerKey,
      region,
      documentType: 'json',
      sourceType: 'dm-official-product-search',
      url: DM_PRODUCT_SEARCH_URL,
      canonicalUrl: DM_PRODUCT_SEARCH_URL,
      finalUrl: productSearch.pages[0]?.url || DM_PRODUCT_SEARCH_URL,
      title: 'dm Ausverkauf Product Search',
      httpStatus: productSearch.pages[0]?.httpStatus || null,
      contentType: productSearch.pages[0]?.contentType || '',
      downloadBytes: Buffer.byteLength(JSON.stringify(productSearch.pages.map((page) => page.payload || {})), 'utf8'),
      contentHash: createHash(JSON.stringify(productSearch.pages.map((page) => page.payload || {}))),
      contentSnippet: products.slice(0, 8).map((item) => item.title || item?.tileData?.title || '').filter(Boolean).join(' | '),
      extractedPreview: products.slice(0, 12).map((item) => item.title || item?.tileData?.title || '').filter(Boolean),
      foundRawItems: products.length,
      parsedOffers: apiOffers.length,
      rejectedOffers: Math.max(0, products.length - apiOffers.length),
      parserVersion: PARSER_VERSION,
      extractionConfidence: apiOffers.length > 0 ? 0.86 : 0.55,
      rejectionReasons: products.length > apiOffers.length ? [{ reason: 'not-sellout-or-missing-price', count: products.length - apiOffers.length }] : [],
      payload: {
        ...productSearchReport,
        sample: products.slice(0, 20).map((item) => ({
          dan: item.dan || item?.tileData?.dan || null,
          brandName: item.brandName || item?.tileData?.brand?.name || '',
          title: item.title || item?.tileData?.title || '',
          price: item?.tileData?.price || null,
          eyecatchers: item?.tileData?.eyecatchers || [],
        })),
      },
    });
    rawDocuments += 1;
  } catch (error) {
    const diagnostic = error.diagnostic || buildDmNetworkDiagnostic(DM_PRODUCT_SEARCH_URL, error);
    const isContentFailure = diagnostic.url === DM_CONTENT_PATH;
    productSearchReport = {
      contentPath: DM_CONTENT_PATH,
      productSearchUrl: DM_PRODUCT_SEARCH_URL,
      error: error.message,
      errorDiagnostic: diagnostic,
      failureStage: isContentFailure ? 'dm content endpoint' : 'dm product search',
      fallback: htmlOffers.length > 0 ? 'html-parser' : 'none',
    };
  }

  const offerDocuments = enrichOffersForStorage(normalizedOffers, {
    source,
    sourceType: 'dm-official-product-search',
    parserVersion: PARSER_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
  });
  const rejectedByCurrentRelevance = Math.max(0, normalizedOffers.length - offerDocuments.length);

  const refreshResult = await replaceOffersForSource({
    sourceId: source._id,
    offerDocuments,
  });

  return {
    offerDocuments,
    rawDocuments,
    rawCandidateCount,
    refreshResult,
    message: summarizeDmOfficialSaleMessage({
      ...productSearchReport,
      parsedBeforeEnrichment: normalizedOffers.length,
      enrichedBeforeDedupe: offerDocuments.length,
      storedOffers: offerDocuments.length,
    }),
    diagnostics: {
      ...productSearchReport,
      parsedBeforeEnrichment: normalizedOffers.length,
      enrichedBeforeDedupe: offerDocuments.length,
      enrichedAfterDedupe: offerDocuments.length,
      rejectedByCurrentRelevance,
      message: summarizeDmOfficialSaleMessage({
        ...productSearchReport,
        parsedBeforeEnrichment: normalizedOffers.length,
        enrichedBeforeDedupe: offerDocuments.length,
        storedOffers: offerDocuments.length,
      }),
      sampleOffers: offerDocuments.slice(0, 5).map((offer) => ({
        title: offer.title,
        brand: offer.brand,
        priceCurrent: offer.priceCurrent?.amount,
        priceReference: offer.priceReference?.amount,
        quantityText: offer.quantityText,
        validTo: offer.validTo || null,
      })),
    },
  };
}

async function fetchNestedHtmlDocuments({ source, crawlJobId, region, links, limit = 4 }) {
  const baseHost = new URL(source.sourceUrl).host;
  const pageLinks = links
    .filter((item) => item.type === 'page')
    .filter((item) => {
      try {
        return new URL(item.url).host === baseHost;
      } catch (error) {
        return false;
      }
    })
    .slice(0, limit);
  const rawDocuments = [];

  for (const link of pageLinks) {
    try {
      const { html, canonicalUrl } = await fetchHtml(link.url);
      const title = sanitizeWhitespace(cheerio.load(html)('title').text()) || link.label;

      rawDocuments.push(
        await createCompactRawDocument({
          sourceId: source._id,
          crawlJobId,
          retailerKey: source.retailerKey,
          region,
          documentType: 'html',
          sourceType: source.sourceType || source.channel,
          url: link.url,
          canonicalUrl,
          finalUrl: canonicalUrl,
          title,
          contentHash: createHash(html),
          contentSnippet: sanitizeWhitespace(cheerio.load(html)('body').text()).slice(0, 500),
          extractedPreview: [],
          parserVersion: PARSER_VERSION,
          payload: {
            parentSourceUrl: source.sourceUrl,
            discoveredFrom: source.label,
          },
        })
      );
    } catch (error) {
      rawDocuments.push({
        error: error.message,
        url: link.url,
      });
    }
  }

  return rawDocuments;
}

async function crawlHoferOfficialPages({ source, crawlJobId, region, links }) {
  const hoferLinks = [];
  const seenHoferUrls = new Set();
  const configuredSeeds = Array.isArray(source?.crawlPolicy?.discoverySeedUrls) && source.crawlPolicy.discoverySeedUrls.length > 0
    ? source.crawlPolicy.discoverySeedUrls
    : HOFER_OFFICIAL_OFFER_PAGES;

  [...(Array.isArray(links) ? links : []), ...configuredSeeds.map((url) => ({ url, label: url, type: 'page' }))].forEach((item) => {
    const normalizedUrl = sanitizeWhitespace(item?.url);

    if (!normalizedUrl || seenHoferUrls.has(normalizedUrl)) {
      return;
    }

    seenHoferUrls.add(normalizedUrl);
    hoferLinks.push(item);
  });

  const datedLinks = hoferLinks
    .filter((item) => /\/de\/angebote\/d\.\d{2}-\d{2}-\d{4}\.html/i.test(item.url))
    .map((item) => ({
      ...item,
      pageDate: parseHoferDateFromUrl(item.url),
    }))
    .filter((item) => item.pageDate)
    .sort((left, right) => left.pageDate.getTime() - right.pageDate.getTime());
  const datedUrlSet = new Set(datedLinks.map((item) => item.url));
  const offerLinks = [
    ...datedLinks,
    ...hoferLinks
      .filter((item) => isHoferOfferPageUrl(item.url) && !datedUrlSet.has(item.url))
      .map((item) => ({
        ...item,
        pageDate: null,
      })),
  ];
  const allOffers = [];
  let rawDocumentCount = 0;
  const diagnostics = {
    pageCount: offerLinks.length,
    rawCards: 0,
    parsedOffers: 0,
    skipReasons: {},
    pages: [],
  };

  for (let index = 0; index < offerLinks.length; index += 1) {
    const current = offerLinks[index];
    const next = current.pageDate
      ? datedLinks.find((item) => item.pageDate && item.pageDate.getTime() > current.pageDate.getTime())
      : null;
    const { html, canonicalUrl } = await fetchHtml(current.url);
    const title = sanitizeWhitespace(cheerio.load(html)('title').text()) || current.label;

    await createCompactRawDocument({
      sourceId: source._id,
      crawlJobId,
      retailerKey: source.retailerKey,
      region,
      documentType: 'html',
      sourceType: source.sourceType || source.channel,
      url: current.url,
      canonicalUrl,
      finalUrl: canonicalUrl,
      title,
      contentHash: createHash(html),
      contentSnippet: sanitizeWhitespace(cheerio.load(html)('body').text()).slice(0, 500),
      extractedPreview: [],
      parserVersion: PARSER_VERSION,
      payload: {
        parentSourceUrl: source.sourceUrl,
        pageDate: current.pageDate,
      },
    });

    rawDocumentCount += 1;

    const pageOffers = parseHoferOffersFromPage({
      html,
      pageUrl: current.url,
      source,
      crawlJobId,
      region,
      pageDate: current.pageDate,
      nextPageDate: next?.pageDate || null,
      diagnostics,
    });

    allOffers.push(...pageOffers);
  }

  const dedupedOffers = dedupeHoferOffers(allOffers, diagnostics);

  const offerDocuments = enrichOffersForStorage(dedupedOffers, {
    source,
    sourceType: 'hofer-official-html',
    parserVersion: PARSER_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
  });

  const refreshResult = await replaceOffersForSource({
    sourceId: source._id,
    offerDocuments,
  });

  return {
    offerDocuments,
    rawDocumentCount,
    rawCandidateCount: diagnostics.rawCards || allOffers.length,
    diagnostics,
    rejectionReasons: Object.entries(diagnostics.skipReasons || {}).map(([reason, count]) => ({ reason, count })),
    refreshResult,
  };
}

async function crawlOfficialSource({ source, region, trigger = 'manual' }) {
  const crawlJob = await CrawlJob.create({
    sourceId: source._id,
    retailerKey: source.retailerKey,
    region,
    trigger,
    metadata: {
      sourceLabel: source.label,
      sourceUrl: source.sourceUrl,
    },
  });

  try {
    await clearRawDocumentsForSource(source._id);

    if (isSparOfficialPdfSource(source)) {
      const sparPdfResult = await crawlSparOfficialPdfSource({
        source,
        crawlJobId: crawlJob._id,
        region,
      });
      const sourceKey = sourceKeyForFormat(source.sourceRetailerFormat || 'spar');
      const offersStored = sparPdfResult.offerDocuments.length;
      const replacementQuality = sparPdfResult.replacementQuality || 'complete';
      const status = replacementQuality === 'quality-risk'
        ? 'partial'
        : (offersStored > 0 || sparPdfResult.rawCandidateCount > 0 ? 'success' : 'partial');
      const warningMessages = replacementQuality === 'quality-risk'
        ? [`SPAR PDF source protected previous offers because replacement coverage dropped sharply (${sparPdfResult.refreshResult?.coverageRisk?.previousActiveCount || 0} -> ${sparPdfResult.refreshResult?.coverageRisk?.nextCount || offersStored}).`]
        : [];

      await CrawlJob.findByIdAndUpdate(crawlJob._id, buildCrawlJobUpdate({
        status,
        discoveredPages: 1,
        rawDocuments: sparPdfResult.rawDocuments,
        rawCandidateCount: sparPdfResult.rawCandidateCount,
        offers: sparPdfResult.offerDocuments,
        source,
        sourceType: SPAR_PDF_SOURCE_TYPE,
        parserVersion: SPAR_PDF_PARSER_VERSION,
        normalizationVersion: NORMALIZATION_VERSION,
        httpLog: sparPdfResult.httpLog || {},
        warningMessages,
        errorMessages: [],
        metadata: {
          sourceLabel: source.label,
          sourceUrl: source.sourceUrl,
          sourceKey,
          sparPdfReports: sparPdfResult.pdfReports,
          replacementQuality,
          refreshResult: sparPdfResult.refreshResult,
        },
      }));

      await Source.findByIdAndUpdate(source._id, {
        latestRunAt: new Date(),
        latestStatus: status,
      });

      return {
        retailerKey: source.retailerKey,
        retailerName: source.retailerName,
        channel: source.channel,
        sourceType: source.sourceType || SPAR_PDF_SOURCE_TYPE,
        sourceKey,
        status,
        offersStored,
        foundRawItems: sparPdfResult.rawCandidateCount,
        parsedOffers: offersStored,
        rejectedOffers: Math.max(0, sparPdfResult.rawCandidateCount - offersStored),
        evidenceMatched: 0,
        discoveredLinks: 1,
        sourceUrl: source.sourceUrl,
        pdfReports: sparPdfResult.pdfReports,
      };
    }

    const { response, html, canonicalUrl } = await fetchHtml(source.sourceUrl);
    const httpLog = buildHttpLogFromResponse(response, html);
    const links = extractRelevantLinks({
      html,
      baseUrl: canonicalUrl,
      retailerKey: source.retailerKey,
    });
    const pageTitle = sanitizeWhitespace(cheerio.load(html)('title').text()) || source.label;

    const rootDocument = await createCompactRawDocument({
      sourceId: source._id,
      crawlJobId: crawlJob._id,
      retailerKey: source.retailerKey,
      region,
      documentType: 'html',
      sourceType: source.sourceType || source.channel,
      url: source.sourceUrl,
      canonicalUrl,
      finalUrl: canonicalUrl,
      title: pageTitle,
      httpStatus: response.status,
      contentType: response.headers?.['content-type'] || '',
      downloadBytes: httpLog.downloadBytes,
      contentHash: createHash(html),
      contentSnippet: sanitizeWhitespace(cheerio.load(html)('body').text()).slice(0, 500),
      extractedPreview: links.slice(0, 10).map((item) => `${item.type.toUpperCase()}: ${item.label}`),
      foundRawItems: links.length,
      parserVersion: PARSER_VERSION,
      payload: {
        linkCount: links.length,
        pageLinkCount: links.filter((item) => item.type === 'page').length,
        pdfLinkCount: links.filter((item) => item.type === 'pdf').length,
      },
    });

    let offersStored = 0;
    let evidenceMatched = 0;
    let extraRawDocuments = 0;
    let warningMessages = [];
    let rawCandidateCount = links.length;
    const allStoredOffers = [];
    let parserDetails = {};
    let sourceMessage = '';
    let extraRejectionReasons = [];
    let forcePartialStatus = false;

    if (source.retailerKey === 'hofer' && source.channel === 'official-flyer') {
      const hoferResult = await crawlHoferOfficialPages({
        source,
        crawlJobId: crawlJob._id,
        region,
        links,
      });

      offersStored += hoferResult.offerDocuments.length;
      extraRawDocuments += hoferResult.rawDocumentCount;
      rawCandidateCount += hoferResult.rawCandidateCount || 0;
      allStoredOffers.push(...hoferResult.offerDocuments);
      parserDetails.hoferOfficial = hoferResult.diagnostics || {};
      extraRejectionReasons = extraRejectionReasons.concat(hoferResult.rejectionReasons || []);
    } else if (source.sourceUrl.includes('billa.at/unsere-aktionen/aktionen')) {
      const billaOfficialResult = await crawlBillaOfficialPromotions({
        source,
        crawlJobId: crawlJob._id,
        region,
      });

      offersStored += billaOfficialResult.offerDocuments.length;
      extraRawDocuments += billaOfficialResult.rawDocuments;
      rawCandidateCount += billaOfficialResult.hitCount || billaOfficialResult.offerDocuments.length;
      allStoredOffers.push(...billaOfficialResult.offerDocuments);
    } else if (source.retailerKey === 'penny' && source.channel === 'official-flyer') {
      const pennyFlyerResult = await crawlPennyOfficialFlyers({
        source,
        crawlJobId: crawlJob._id,
        region,
        html,
        links,
      });

      offersStored += pennyFlyerResult.offerDocuments.length;
      extraRawDocuments += pennyFlyerResult.rawDocuments;
      rawCandidateCount += pennyFlyerResult.rawCandidateCount || 0;
      allStoredOffers.push(...pennyFlyerResult.offerDocuments);
      parserDetails.pennyPdfReports = pennyFlyerResult.pdfReports;
      warningMessages = warningMessages.concat(
        pennyFlyerResult.pdfReports
          .filter((item) => item.status === 'failed')
          .map((item) => `PENNY PDF flyer could not be parsed: ${item.observedUrl || item.kind} (${item.error})`)
      );
    } else if (source.retailerKey === 'penny' && source.sourceUrl.includes('penny.at/angebote')) {
      const pennyOfficialResult = await crawlPennyOfficialOffers({
        source,
        crawlJobId: crawlJob._id,
        region,
        html,
        canonicalUrl,
      });

      offersStored += pennyOfficialResult.offerDocuments.length;
      extraRawDocuments += pennyOfficialResult.rawDocuments;
      rawCandidateCount += pennyOfficialResult.rawCandidateCount || 0;
      allStoredOffers.push(...pennyOfficialResult.offerDocuments);
      parserDetails.pennyOfficialSite = pennyOfficialResult.diagnostics || {};
    } else if (source.parserHint === 'official-category-actions') {
      const promotionResult = extractAndNormalizeOfficialCategoryPromotions({
        html,
        source,
        crawlJobId: crawlJob._id,
        region,
      });
      const seenPromotionKeys = new Set();
      const offerDocuments = enrichOffersForStorage(promotionResult.offers, {
        source,
        sourceType: CATEGORY_PROMOTION_SOURCE_TYPE,
        parserVersion: CATEGORY_PROMOTION_PARSER_VERSION,
        normalizationVersion: NORMALIZATION_VERSION,
      })
        .filter((offer) => {
          const key = offer.dedupeKey || offer.offerKey || offer.title;
          if (seenPromotionKeys.has(key)) return false;
          seenPromotionKeys.add(key);
          return true;
        });
      const refreshResult = await replaceOffersForSource({
        sourceId: source._id,
        offerDocuments,
        crawlJobId: crawlJob._id,
        sourceRunStatus: offerDocuments.length > 0 ? 'success' : 'partial',
        replacementQuality: offerDocuments.length > 0 ? 'complete' : 'partial',
      });

      offersStored += offerDocuments.length;
      rawCandidateCount += promotionResult.candidates.length || 0;
      allStoredOffers.push(...offerDocuments);
      parserDetails.officialCategoryPromotions = {
        parserVersion: CATEGORY_PROMOTION_PARSER_VERSION,
        sourceKey: sourceKeyForActionSource(source),
        rawCandidateCount: promotionResult.candidates.length,
        parsedOffers: offerDocuments.length,
        refreshResult,
        diagnostics: promotionResult.diagnostics || {},
      };

      if (offerDocuments.length === 0) {
        forcePartialStatus = true;
        sourceMessage = 'Official category action source fetched but no trusted category promotions were parsed.';
      }
    } else if (source.retailerKey === 'lidl' && source.sourceUrl.includes('lidl.at/c/flugblatt')) {
      const lidlOfficialResult = await crawlLidlOfficialFlyers({
        source,
        crawlJobId: crawlJob._id,
        region,
        html,
      });

      offersStored += lidlOfficialResult.offerDocuments.length;
      extraRawDocuments += lidlOfficialResult.rawDocuments;
      rawCandidateCount += lidlOfficialResult.rawCandidateCount || 0;
      allStoredOffers.push(...lidlOfficialResult.offerDocuments);
      parserDetails.lidlOfficial = lidlOfficialResult.diagnostics || {};
    } else if (source.retailerKey === 'dm' && source.sourceUrl.includes('dm.at/ausverkauf')) {
      const dmOfficialResult = await crawlDmOfficialSaleOffers({
        source,
        crawlJobId: crawlJob._id,
        region,
        html,
        canonicalUrl,
      });

      offersStored += dmOfficialResult.offerDocuments.length;
      extraRawDocuments += dmOfficialResult.rawDocuments;
      rawCandidateCount += dmOfficialResult.rawCandidateCount || 0;
      allStoredOffers.push(...dmOfficialResult.offerDocuments);
      parserDetails.dmOfficialSale = dmOfficialResult.diagnostics || {};
      sourceMessage = dmOfficialResult.message || dmOfficialResult.diagnostics?.message || '';
    } else if (source.retailerKey === 'bipa' && source.sourceUrl.includes('bipa.at/cp/aktionen')) {
      const bipaOfficialResult = await crawlBipaOfficialOffers({
        source,
        crawlJobId: crawlJob._id,
        region,
        html,
        canonicalUrl,
      });

      offersStored += bipaOfficialResult.offerDocuments.length;
      extraRawDocuments += bipaOfficialResult.rawDocuments;
      rawCandidateCount += bipaOfficialResult.rawCandidateCount || 0;
      allStoredOffers.push(...bipaOfficialResult.offerDocuments);
    } else {
      const nestedDocuments = await fetchNestedHtmlDocuments({
        source,
        crawlJobId: crawlJob._id,
        region,
        links,
      });

      extraRawDocuments += nestedDocuments.filter((item) => item && !item.error).length;
    }

    const status = forcePartialStatus ? 'partial' : (offersStored > 0 || evidenceMatched > 0 || links.length > 0 ? 'success' : 'partial');
    if (status === 'partial' && sourceMessage) {
      warningMessages = warningMessages.concat(sourceMessage);
    }

    await CrawlJob.findByIdAndUpdate(crawlJob._id, buildCrawlJobUpdate({
      status,
      discoveredPages: Math.max(links.length, 1),
      rawDocuments: 1 + extraRawDocuments,
      rawCandidateCount: Math.max(rawCandidateCount, offersStored),
      offers: allStoredOffers,
      source,
      sourceType: source.sourceType || source.channel || 'offers-page',
      parserVersion: PARSER_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
      httpLog,
      warningMessages,
      errorMessages: [],
      extraRejectionReasons,
      metadata: {
        sourceLabel: source.label,
        sourceUrl: source.sourceUrl,
        rawDocumentId: rootDocument._id,
        extractedLinkCount: links.length,
        evidenceMatched,
        ...parserDetails,
      },
    }));

    await Source.findByIdAndUpdate(source._id, {
      latestRunAt: new Date(),
      latestStatus: status,
    });

    const isCategoryActionSource = source.parserHint === 'official-category-actions';

    return {
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      channel: source.channel,
      sourceType: source.sourceType || source.channel,
      status,
      foundRawItems: rawCandidateCount,
      parsedOffers: offersStored,
      rejectedOffers: Math.max(0, rawCandidateCount - offersStored),
      offersStored,
      evidenceMatched,
      discoveredLinks: links.length,
      sourceUrl: source.sourceUrl,
      message: sourceMessage,
      httpStatus: response.status ?? null,
      contentType: response.headers?.['content-type'] || '',
      finalUrl: canonicalUrl,
      ...(isCategoryActionSource ? {
        sourceKey: sourceKeyForActionSource(source),
        failureStage: status === 'partial' ? 'parser' : '',
        diagnostic: {
          failureStage: status === 'partial' ? 'parser' : '',
          httpStatus: response.status ?? null,
          contentType: response.headers?.['content-type'] || '',
          finalUrl: canonicalUrl,
          extractedLinkCount: links.length,
          ...(parserDetails.officialCategoryPromotions?.diagnostics || {}),
        },
      } : {}),
    };
  } catch (error) {
    const diagnostic = error.diagnostic || buildFetchDiagnostic(source.sourceUrl, error);
    await CrawlJob.findByIdAndUpdate(crawlJob._id, {
      status: 'failed',
      finishedAt: new Date(),
      sourceType: source.sourceType || source.channel || '',
      sourceUrl: source.sourceUrl,
      parserVersion: PARSER_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
      stats: {
        foundRawItems: 0,
        parsedOffers: 0,
        productiveOffers: 0,
        rejectedOffers: 0,
        discoveredPages: 1,
        rawDocuments: 0,
        offersExtracted: 0,
        offersStored: 0,
        warnings: 0,
        errors: 1,
      },
      httpLog: {
        status: diagnostic.httpStatus ?? null,
        contentType: diagnostic.contentType || '',
        finalUrl: diagnostic.finalUrl || source.sourceUrl,
        downloadBytes: Number(diagnostic.downloadBytes || 0),
        contentHash: '',
      },
      warningMessages: [],
      errorMessages: [error.message],
      metadata: {
        sourceLabel: source.label,
        sourceUrl: source.sourceUrl,
        sourceKey: source.parserHint === 'official-category-actions' ? sourceKeyForActionSource(source) : '',
        fetchDiagnostic: diagnostic,
      },
    });

    await Source.findByIdAndUpdate(source._id, {
      latestRunAt: new Date(),
      latestStatus: 'failed',
    });

    throw error;
  }
}

module.exports = {
  crawlOfficialSource,
  __private: {
    parseBipaOffersFromHtml,
    parsePennyOffersFromHtml,
    extractPennyNuxtProductsFromHtml,
    extractPennyTabsAndLinks,
    extractPennyProductGroupSlugsFromHtml,
    normalizePennyApiProductsToOffers,
    collectPennyOfficialApiOffers,
    diagnosePennyOfficialSiteHtml,
    parseDmSaleOffersFromHtml,
    parseDmSaleOffersFromProductSearchJson,
    extractDmSaleGridQuery,
    buildDmSaleProductSearchUrl,
    fetchDmSaleProductSearchPages,
    summarizeDmOfficialSaleMessage,
    diagnoseDmOfficialSaleSource,
    parseHoferOffersFromPage,
    dedupeHoferOffers,
    isHoferOfferPageUrl,
    parseLidlOfficialSiteOffersFromHtml,
    dedupeLidlOffers,
    LIDL_OFFICIAL_CAMPAIGN_PAGES,
    extractLidlCampaignPageLinksFromHtml,
    getLidlCampaignPagesForCrawl,
    isLidlCampaignPageUrl,
    normalizeImageUrl,
  },
};
