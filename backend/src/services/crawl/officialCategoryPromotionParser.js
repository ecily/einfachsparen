const cheerio = require('cheerio');
const { normalizeTitleForMatch, sanitizeWhitespace, buildSourceEvidence } = require('./sourceEvidence');
const { buildOfferStatus } = require('../offers/offerFreshness');

const PARSER_VERSION = 'official-category-promotions-v1';
const SOURCE_TYPE = 'official-action';

const PROMOTION_SCOPES = [
  {
    key: 'bier',
    appliesToCategory: 'bier',
    titleScope: 'alle Biere',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    keywords: [
      'bier',
      'biere',
      'flaschenbier',
      'dosenbier',
      'maerzen',
      'maerzenbier',
      'maerzen',
      'pils',
      'lager',
      'radler',
    ],
    pattern: /\b(?:bier|biere|flaschenbier|dosenbier|maerzen|marzen|pils|lager|radler)\b/,
  },
  {
    key: 'tiernahrung',
    appliesToCategory: 'tiernahrung',
    titleScope: 'alle Tiernahrungs-Artikel',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Tiernahrung',
    categoryKey: 'tiernahrung',
    keywords: [
      'tiernahrung',
      'tierfutter',
      'hundefutter',
      'katzenfutter',
      'tierzubehoer',
      'streu',
      'katzenstreu',
    ],
    pattern: /\b(?:tiernahrung|tiernahrungs|tierfutter|hundefutter|katzenfutter|tierzubehoer|tierzubehor|streu|katzenstreu)\b/,
  },
  {
    key: 'waschmittel',
    appliesToCategory: 'waschmittel',
    titleScope: 'alle Waschmittel, Fein- & Spezialwaschmittel inkl. Weichspueler',
    categoryPrimary: 'Haushalt',
    categorySecondary: 'Waschmittel & Reiniger',
    categoryKey: 'waschmittel-reiniger',
    keywords: [
      'waschmittel',
      'weichspueler',
      'feinwaschmittel',
      'spezialwaschmittel',
      'vollwaschmittel',
    ],
    pattern: /\b(?:waschmittel|weichspueler|weichspuler|feinwaschmittel|spezialwaschmittel|vollwaschmittel)\b/,
  },
  {
    key: 'frotteewaren',
    appliesToCategory: 'frotteewaren',
    titleScope: 'alle Frotteewaren inkl. Strandtuecher und Badematten',
    categoryPrimary: 'Haushalt',
    categorySecondary: 'Frotteewaren',
    categoryKey: 'frotteewaren',
    keywords: [
      'frottee',
      'frotteewaren',
      'strandtuch',
      'strandtuecher',
      'badematte',
      'badematten',
    ],
    pattern: /\b(?:frottee|frotteewaren|strandtuch|strandtuecher|strandtucher|badematte|badematten)\b/,
  },
];

function normalizeForScan(value) {
  return normalizeTitleForMatch(value)
    .replace(/\bma rzen\b/g, 'maerzen')
    .replace(/\bweichsp uler\b/g, 'weichspueler')
    .replace(/\btierzubeh or\b/g, 'tierzubehoer');
}

function toYear(value, fallbackYear) {
  if (!value) return fallbackYear;
  const numeric = Number(value);
  if (numeric < 100) return 2000 + numeric;
  return numeric;
}

function endOfDay(date) {
  if (!date) return null;
  const value = new Date(date);
  value.setUTCHours(23, 59, 59, 999);
  return value;
}

function parseDateParts(day, month, year, fallbackYear) {
  const parsedDay = Number(day);
  const parsedMonth = Number(month);
  const parsedYear = toYear(year, fallbackYear);

  if (!parsedDay || !parsedMonth || !parsedYear) return null;

  const date = new Date(Date.UTC(parsedYear, parsedMonth - 1, parsedDay, 0, 0, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateRange(text, now = new Date()) {
  const fallbackYear = now.getFullYear();
  const normalized = String(text || '').replace(/\s+/g, ' ');
  const dateToken = '(?:[a-zäöü]{2,3}\\.?,?\\s*)?(\\d{1,2})\\.\\s*(\\d{1,2})\\.?\\s*(\\d{2,4})?';
  const rangeMatch = normalized.match(new RegExp(`${dateToken}\\s*(?:-|bis|und)\\s*${dateToken}`, 'i'));

  if (rangeMatch) {
    const validFrom = parseDateParts(rangeMatch[1], rangeMatch[2], rangeMatch[3] || rangeMatch[6], fallbackYear);
    let validTo = endOfDay(parseDateParts(rangeMatch[4], rangeMatch[5], rangeMatch[6] || rangeMatch[3], fallbackYear));

    if (validFrom && validTo && validTo < validFrom) {
      validTo = endOfDay(parseDateParts(rangeMatch[4], rangeMatch[5], Number(validTo.getUTCFullYear()) + 1, fallbackYear));
    }

    return {
      validFrom,
      validTo,
      validityText: sanitizeWhitespace(rangeMatch[0]),
      confidence: validFrom && validTo ? 0.86 : 0.4,
    };
  }

  const untilMatch = normalized.match(/(?:gueltig|gultig)?\s*(?:bis|bzw\.)\s*(?:[a-z]{2,3}\.?,?\s*)?(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{2,4})?/i);

  if (untilMatch) {
    const validTo = endOfDay(parseDateParts(untilMatch[1], untilMatch[2], untilMatch[3], fallbackYear));
    return {
      validFrom: null,
      validTo,
      validityText: sanitizeWhitespace(untilMatch[0]),
      confidence: validTo ? 0.65 : 0,
    };
  }

  return {
    validFrom: null,
    validTo: null,
    validityText: '',
    confidence: 0,
  };
}

function sourceKeyForActionSource(source = {}) {
  const url = String(source.sourceUrl || '').toLowerCase();

  if (url.includes('spar.at/aktionen/steiermark')) return 'spar-official-actions-steiermark';
  if (url.includes('interspar.at/aktionen')) return 'interspar-official-actions';

  return `${source.retailerKey || 'unknown'}-official-actions`;
}

function detectDiscount(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/\u00e4/g, 'ae')
    .replace(/\u00f6/g, 'oe')
    .replace(/\u00fc/g, 'ue')
    .replace(/\u00df/g, 'ss')
    .replace(/\s+/g, ' ');
  const match = normalized.match(/(?:bis\s+zu\s*)?-?\s*(\d{1,2})\s*%/);

  if (!match) {
    return null;
  }

  const percent = Number(match[1]);

  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
    return null;
  }

  return {
    percent,
    isUpTo: /\bbis\s+zu\b/.test(normalized.slice(Math.max(0, match.index - 20), match.index + match[0].length + 20)),
  };
}

function extractTextFragments(html) {
  const $ = cheerio.load(html || '');
  const fragments = [];
  const add = (text) => {
    const cleaned = sanitizeWhitespace(text);

    if (cleaned.length >= 8 && cleaned.length <= 900 && /%/.test(cleaned)) {
      fragments.push(cleaned);
    }
  };

  $('article, section, li, a, div, [data-spar-official-action], [data-category-promotion]').each((_, element) => {
    const item = $(element);
    add([
      item.text(),
      item.attr('title'),
      item.attr('aria-label'),
      item.find('img').map((__, image) => [$(image).attr('alt'), $(image).attr('title')].filter(Boolean).join(' ')).get().join(' '),
    ].filter(Boolean).join(' '));
  });

  if (fragments.length === 0) {
    const bodyText = sanitizeWhitespace($('body').text() || $.root().text());
    const parts = bodyText.split(/(?<=%)\s+|\s+(?=-?\d{1,2}\s*%)/);
    parts.forEach(add);
  }

  return [...new Set(fragments)];
}

function diagnoseOfficialCategoryPromotionHtml({ html, candidates = [] } = {}) {
  const $ = cheerio.load(html || '');
  const fragments = extractTextFragments(html);
  const bodyText = sanitizeWhitespace($('body').text() || $.root().text());
  const normalized = normalizeForScan(bodyText);
  const title = sanitizeWhitespace($('title').text());
  const expectedScopeHits = PROMOTION_SCOPES
    .filter((scope) => scope.pattern.test(normalized))
    .map((scope) => scope.key);
  const blockedChallengeLikely = /just a moment|cloudflare|attention required|cf-browser-verification|cf-chl/i.test(
    `${title} ${bodyText} ${String(html || '').slice(0, 2000)}`
  );

  return {
    htmlTitle: title.slice(0, 160),
    bodyTextLength: bodyText.length,
    percentFragmentCount: fragments.length,
    parserCandidateCount: candidates.length,
    expectedScopeHits,
    discountSeen: Boolean(detectDiscount(bodyText)),
    blockedChallengeLikely,
  };
}

function extractOfficialCategoryPromotionCandidates({ html, source = {}, now = new Date() } = {}) {
  const candidates = [];
  const seen = new Set();
  const sourceKey = sourceKeyForActionSource(source);
  const regionScope = source.regionScope || (sourceKey === 'spar-official-actions-steiermark' ? 'Steiermark' : '');

  for (const fragment of extractTextFragments(html)) {
    const discount = detectDiscount(fragment);
    const normalized = normalizeForScan(fragment);

    if (!discount) {
      continue;
    }

    for (const scope of PROMOTION_SCOPES) {
      if (!scope.pattern.test(normalized)) {
        continue;
      }

      const key = `${sourceKey}::${scope.key}::${discount.percent}::${discount.isUpTo ? 'upto' : 'exact'}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const validity = parseDateRange(fragment, now);
      const prefix = discount.isUpTo ? `bis zu -${discount.percent}%` : `-${discount.percent}%`;

      candidates.push({
        id: key,
        sourceKey,
        scopeKey: scope.key,
        title: `${prefix} auf ${scope.titleScope}`,
        rawText: fragment,
        discountPercent: discount.isUpTo ? null : discount.percent,
        discountUpToPercent: discount.isUpTo ? discount.percent : null,
        promotionScope: scope.key,
        regionScope,
        appliesToCategory: scope.appliesToCategory,
        categoryPrimary: scope.categoryPrimary,
        categorySecondary: scope.categorySecondary,
        categoryKey: scope.categoryKey,
        keywords: scope.keywords,
        validity,
      });
    }
  }

  return candidates;
}

function normalizeOfficialCategoryPromotionCandidateToOffer({ candidate, source, crawlJobId, region }) {
  const sourceKey = candidate.sourceKey || sourceKeyForActionSource(source);
  const validity = candidate.validity || {};
  const validFrom = validity.validFrom || null;
  const validTo = validity.validTo || null;
  const snapshotCurrent = !validTo;
  const statusInfo = buildOfferStatus(validFrom, validTo, snapshotCurrent);
  const discountValue = candidate.discountPercent || candidate.discountUpToPercent || '';
  const titleNormalized = normalizeTitleForMatch(candidate.title);
  const dedupeKey = [
    source.retailerKey,
    sourceKey,
    candidate.promotionScope,
    String(discountValue),
    candidate.discountUpToPercent ? 'up-to' : 'exact',
    validTo ? validTo.toISOString().slice(0, 10) : 'snapshot',
  ].join('::');
  const conditionsText = sanitizeWhitespace(candidate.rawText).slice(0, 700);
  const searchKeywords = [
    ...candidate.keywords,
    candidate.title,
    candidate.categoryPrimary,
    candidate.categorySecondary,
    candidate.appliesToCategory,
    conditionsText,
  ].join(' ');

  return {
    crawlJobId,
    sourceId: source._id,
    retailerKey: source.retailerKey,
    retailerName: source.retailerName,
    sourceRetailerName: source.sourceRetailerName || source.retailerName,
    sourceRetailerFormat: source.sourceRetailerFormat || source.retailerKey,
    appliesToRetailerFormats: source.appliesToRetailerFormats?.length
      ? source.appliesToRetailerFormats
      : [source.sourceRetailerFormat || source.retailerKey].filter(Boolean),
    retailerFormatLabel: source.retailerFormatLabel || source.retailerName,
    region: region || source.regionScope || '',
    offerKey: dedupeKey,
    dedupeKey,
    title: candidate.title,
    titleNormalized,
    brand: '',
    offerType: 'category-promotion',
    searchText: normalizeTitleForMatch(searchKeywords),
    categoryPrimary: candidate.categoryPrimary,
    categorySecondary: candidate.categorySecondary,
    categoryKey: candidate.categoryKey,
    subcategoryKey: candidate.categoryKey,
    categoryConfidence: 0.92,
    subcategoryConfidence: 0.9,
    comparisonSignature: '',
    comparisonQuantityKey: '',
    comparisonCategoryKey: candidate.categoryKey,
    comparisonGroup: '',
    description: candidate.title,
    sourceUrl: source.sourceUrl,
    sourceType: SOURCE_TYPE,
    supportingSources: [
      buildSourceEvidence({
        source,
        observedUrl: source.sourceUrl,
        matchType: 'primary',
      }),
    ],
    validFrom,
    validTo,
    status: statusInfo.status,
    isActiveNow: statusInfo.isActiveNow,
    isActiveToday: statusInfo.isActiveToday,
    benefitType: 'sticker',
    effectiveDiscountType: 'price-cut',
    conditionsText,
    customerProgramRequired: false,
    hasConditions: Boolean(conditionsText),
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    discountPercent: candidate.discountPercent,
    discountUpToPercent: candidate.discountUpToPercent,
    promotionScope: candidate.promotionScope,
    appliesToCategory: candidate.appliesToCategory,
    regionScope: candidate.regionScope || source.regionScope || '',
    availabilityScope: candidate.regionScope || source.regionScope || region || '',
    priceCurrent: { amount: null, currency: 'EUR', originalText: '' },
    priceReference: { amount: null, currency: 'EUR', originalText: '' },
    priceReferenceSource: '',
    priceReferenceConfidence: 0,
    quantityText: '',
    comparableUnit: '',
    normalizedUnitPrice: { amount: null, unit: '', comparable: false, confidence: 0 },
    parserVersion: PARSER_VERSION,
    quality: {
      completenessScore: validity.validTo ? 0.86 : 0.74,
      parsingConfidence: 0.86,
      comparisonSafe: false,
      issues: validity.validTo ? [] : ['Gueltigkeitszeitraum unvollstaendig'],
    },
    rawFacts: {
      sourceType: SOURCE_TYPE,
      sourceKind: 'official-category-promotion',
      sourceKey,
      sourceId: source._id ? String(source._id) : '',
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      sourceRetailerFormat: source.sourceRetailerFormat || '',
      evidenceText: candidate.rawText,
      validityText: validity.validityText || '',
      validityConfidence: validity.confidence || 0,
      discountPercent: candidate.discountPercent,
      discountUpToPercent: candidate.discountUpToPercent,
      discountScope: 'category',
      discountLevel: 'campaign',
      isCampaignDiscount: true,
      discountAppliesToProduct: false,
      promotionScope: candidate.promotionScope,
      appliesToCategory: candidate.appliesToCategory,
      regionScope: candidate.regionScope || source.regionScope || '',
      parserVersion: PARSER_VERSION,
      snapshotCurrent,
    },
    needsReview: !validity.validTo,
    reviewReasons: validity.validTo ? [] : ['Gueltigkeitszeitraum unvollstaendig'],
    adminReview: {
      status: 'pending',
      note: '',
      feedbackDigest: '',
    },
  };
}

function normalizeOfficialCategoryPromotionCandidatesToOffers({ candidates = [], source, crawlJobId, region }) {
  return candidates
    .map((candidate) => normalizeOfficialCategoryPromotionCandidateToOffer({
      candidate,
      source,
      crawlJobId,
      region,
    }))
    .filter(Boolean);
}

function extractAndNormalizeOfficialCategoryPromotions({ html, source, crawlJobId, region, now = new Date() }) {
  const candidates = extractOfficialCategoryPromotionCandidates({ html, source, now });
  return {
    candidates,
    offers: normalizeOfficialCategoryPromotionCandidatesToOffers({
      candidates,
      source,
      crawlJobId,
      region,
    }),
    diagnostics: diagnoseOfficialCategoryPromotionHtml({ html, candidates }),
  };
}

module.exports = {
  PARSER_VERSION,
  SOURCE_TYPE,
  PROMOTION_SCOPES,
  diagnoseOfficialCategoryPromotionHtml,
  extractOfficialCategoryPromotionCandidates,
  extractAndNormalizeOfficialCategoryPromotions,
  normalizeOfficialCategoryPromotionCandidatesToOffers,
  sourceKeyForActionSource,
  _private: {
    detectDiscount,
    extractTextFragments,
    parseDateRange,
  },
};
