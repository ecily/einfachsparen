const axios = require('axios');
const cheerio = require('cheerio');
const Source = require('../../models/Source');
const CrawlJob = require('../../models/CrawlJob');
const {
  buildPayloadDigest,
  getScriptPushStrings,
  parseGroupRecord,
  parseAllPromotionSections,
  parseSectionRecord,
} = require('./aktionsfinderParser');
const { normalizePromotionToOffer } = require('./offerNormalizer');
const { clearRawDocumentsForSource, createCompactRawDocument } = require('./rawDocumentStorage');
const { sanitizeWhitespace, normalizeTitleForMatch } = require('./sourceEvidence');
const { enrichOfferForStorage } = require('./offerAuditEnrichment');
const { NORMALIZATION_VERSION, buildCoverageMetrics, buildCrawlJobUpdate, buildHttpLogFromResponse } = require('./crawlAudit');
const { replaceOffersForSource } = require('./offerRefreshGuard');
const { parseAktionsfinderDateRange } = require('../offers/offerFreshness');

const PARSER_VERSION = 'aktionsfinder-v3-coverage';

const SUPPLEMENTAL_CATEGORY_SLUGS_BY_RETAILER = {
  spar: ['haushalt', 'milchprodukte'],
  eurospar: ['haushalt', 'milchprodukte'],
  interspar: ['haushalt', 'milchprodukte'],
};

function toAbsoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch (error) {
    return '';
  }
}

function parseNumericAmount(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value)
    .replace(/[^\d,.-]+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');

  if (!cleaned) {
    return null;
  }

  const numeric = Number(cleaned);

  return Number.isFinite(numeric) ? numeric : null;
}

function humanizeSlug(value) {
  return sanitizeWhitespace(String(value || '').replace(/-/g, ' '));
}

function normalizeProductUnitMatch(unitText) {
  const normalized = normalizeTitleForMatch(unitText);

  if (/^(kg|kilogramm)$/.test(normalized)) {
    return { shortName: 'kg', type: 'PRODUCT' };
  }

  if (/^(g|gramm)$/.test(normalized)) {
    return { shortName: 'g', type: 'PRODUCT' };
  }

  if (/^(l|liter)$/.test(normalized)) {
    return { shortName: 'l', type: 'PRODUCT' };
  }

  if (/^(ml|milliliter)$/.test(normalized)) {
    return { shortName: 'ml', type: 'PRODUCT' };
  }

  if (/^(cl|zentiliter)$/.test(normalized)) {
    return { shortName: 'cl', type: 'PRODUCT' };
  }

  if (/^(stk|stueck|stuck)$/.test(normalized)) {
    return { shortName: 'Stk', type: 'PRODUCT' };
  }

  if (/^(packung|pack|netz|becher|flasche|dose|glas|tube|rolle|karton|sack)$/.test(normalized)) {
    return { shortName: humanizeSlug(normalized), type: 'PACKAGING' };
  }

  return null;
}

function buildProductFromCardTitle(title) {
  const matches = [...sanitizeWhitespace(title).matchAll(
    /(\d+(?:[.,]\d+)?)\s*(Kilogramm|kg|Gramm|g|Liter|l|Milliliter|ml|Zentiliter|cl|St(?:u|ü)?ck|Stk|Packung|Pack|Netz|Becher|Flasche|Dose|Glas|Tube|Rolle|Karton|Sack)\b/gi
  )];
  const product = {};

  if (matches.length === 0) {
    return product;
  }

  const [primaryAmount, primaryUnitText] = [parseNumericAmount(matches[0][1]), matches[0][2]];
  const primaryUnit = normalizeProductUnitMatch(primaryUnitText);

  if (primaryAmount && primaryUnit) {
    product.productQuantity = primaryAmount;
    product.productQuantityUnit = {
      shortName: primaryUnit.shortName,
      type: primaryUnit.type,
    };
  }

  if (matches.length > 1) {
    const secondaryAmount = parseNumericAmount(matches[1][1]);
    const secondaryUnit = normalizeProductUnitMatch(matches[1][2]);

    if (secondaryAmount && secondaryUnit) {
      product.packageQuantity = secondaryAmount;
      product.packageQuantityUnit = {
        shortName: secondaryUnit.shortName,
        type: secondaryUnit.shortName === 'Stk' ? 'PACKAGING' : secondaryUnit.type,
      };
    }
  }

  return product;
}

function parseDatesFromLeafletHref(href) {
  return parseAktionsfinderDateRange(href);
}

function extractCategoryPageLinks(html, sourceUrl) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const links = [];

  $('a[href^="/ppcv/"]').each((index, element) => {
    const absoluteUrl = toAbsoluteUrl($(element).attr('href'), sourceUrl);

    if (!absoluteUrl || seen.has(absoluteUrl)) {
      return;
    }

    seen.add(absoluteUrl);
    links.push(absoluteUrl);
  });

  return links;
}

function buildSupplementalCategoryPageLinks(source = {}) {
  const slugs = SUPPLEMENTAL_CATEGORY_SLUGS_BY_RETAILER[source.retailerKey] || [];

  return slugs
    .map((slug) => toAbsoluteUrl(`/ppcv/${slug}/${source.retailerKey}/`, source.sourceUrl))
    .filter(Boolean);
}

function buildCategoryPageLinks(html, source) {
  return uniquePromotions(
    [
      ...extractCategoryPageLinks(html, source.sourceUrl).map((url) => ({ id: url, url })),
      ...buildSupplementalCategoryPageLinks(source).map((url) => ({ id: url, url })),
    ]
  ).map((item) => item.url);
}

function buildPromotionId({ source, title, currentPrice, leafletHref, categorySlug }) {
  return [
    source.retailerKey,
    normalizeTitleForMatch(title),
    categorySlug,
    String(currentPrice ?? ''),
    leafletHref,
  ].join('::');
}

function parsePromotionsFromCategoryPage({ html, source, pageUrl }) {
  const $ = cheerio.load(html);
  const categorySlugMatch = String(pageUrl || '').match(/\/ppcv\/([^/]+)\//i);
  const categorySlug = sanitizeWhitespace(categorySlugMatch?.[1] || '');
  const categoryTitle = humanizeSlug(categorySlug);
  const promotions = [];

  $('article').each((index, element) => {
    const article = $(element);
    const linkElement = article.find('a[href^="/l/"]').first();
    const leafletHref = sanitizeWhitespace(linkElement.attr('href'));
    const observedUrl = toAbsoluteUrl(leafletHref, pageUrl);
    const title = sanitizeWhitespace(
      article.find('p.text-card-text-primary').first().text()
      || article.find('img').first().attr('alt')
      || ''
    );
    const currentPrice = parseNumericAmount(article.find('.text-card-text-accent').first().text());
    const originalPrice = parseNumericAmount(article.find('.line-through').first().text());
    const unitPriceText = article
      .find('.text-card-text-secondary')
      .map((innerIndex, innerElement) => sanitizeWhitespace($(innerElement).text()))
      .get()
      .find((value) => /\/\s*(kg|g|l|ml|cl|stk|stueck|stuck)/i.test(value))
      || '';
    const imageUrl = sanitizeWhitespace(article.find('img').first().attr('src'));
    const { validFrom, validTo } = parseDatesFromLeafletHref(leafletHref);

    if (!title || !currentPrice || !observedUrl) {
      return;
    }

    promotions.push({
      id: buildPromotionId({
        source,
        title,
        currentPrice,
        leafletHref,
        categorySlug,
      }),
      title,
      fullDisplayName: title,
      description: sanitizeWhitespace([categoryTitle, unitPriceText].filter(Boolean).join(' / ')),
      discountedPrice: currentPrice,
      originalPrice,
      validFrom: validFrom ? validFrom.toISOString() : null,
      validTo: validTo ? validTo.toISOString() : null,
      validitySource: validFrom && validTo ? 'aktionsfinder-leaflet-range' : '',
      leafletHref,
      clickoutUrl: observedUrl,
      currency: {
        iso: 'EUR',
        symbol: '€',
      },
      image: {
        small: imageUrl,
        medium: imageUrl,
      },
      tags: [`aktionsfinder-category:${categorySlug}`],
      productGroups: categoryTitle ? [{ title: categoryTitle }] : [],
      product: buildProductFromCardTitle(title),
      snapshotCurrent: !validFrom && !validTo,
    });
  });

  return promotions;
}

function addRejectionReason(reasons, reason, count = 1) {
  if (!reason || !(Number(count) > 0)) {
    return;
  }

  reasons.push({ reason, count: Number(count) });
}

function uniquePromotions(promotions, diagnostics = null) {
  const seen = new Map();
  let duplicateCount = 0;
  let missingIdCount = 0;

  for (const promotion of promotions) {
    if (!promotion?.id) {
      missingIdCount += 1;
      continue;
    }

    if (!seen.has(promotion.id)) {
      seen.set(promotion.id, promotion);
    } else {
      duplicateCount += 1;
    }
  }

  if (diagnostics && duplicateCount > 0) {
    diagnostics.dedupeDropped = (diagnostics.dedupeDropped || 0) + duplicateCount;
  }

  if (diagnostics && missingIdCount > 0) {
    diagnostics.parserNoOfferCandidate = (diagnostics.parserNoOfferCandidate || 0) + missingIdCount;
  }

  return [...seen.values()];
}

function collectAllPromotions(recordStrings, fallbackSections) {
  const parsed = parseAllPromotionSections(recordStrings);
  const sectionPromotions = parsed.sectionRecords.flatMap((record) => record?.initialData?.content || []);
  const groupedPromotions = parsed.groupRecords.flatMap(
    (record) => record?.initialPromotionGroupList?.content?.flatMap((item) => item.items || []) || []
  );
  const fallbackPromotions = [
    ...(fallbackSections.popular?.initialData?.content || []),
    ...(fallbackSections.assortment?.initialData?.content || []),
    ...(fallbackSections.grouped?.initialPromotionGroupList?.content?.flatMap((item) => item.items || []) || []),
  ];

  return [...sectionPromotions, ...groupedPromotions, ...fallbackPromotions];
}

function extractSections(recordStrings, retailerName) {
  const popular = recordStrings
    .map((record) => parseSectionRecord(record, `Beliebte Aktionen bei ${retailerName}`))
    .find(Boolean);

  const assortment = recordStrings
    .map((record) => parseSectionRecord(record, `Sortimentsaktionen bei ${retailerName}`))
    .find(Boolean);

  const grouped = recordStrings.map(parseGroupRecord).find(Boolean);

  return { popular, assortment, grouped };
}

function extractAllPromotions(recordStrings, fallbackSections) {
  return uniquePromotions(collectAllPromotions(recordStrings, fallbackSections));
}

function buildEssence({ retailerName, promotions, grouped, categoryPageCount = 0, categoryPagePromotions = 0 }) {
  const groupNames = (grouped?.initialPromotionGroupList?.content || [])
    .slice(0, 5)
    .map((item) => item.group?.title)
    .filter(Boolean);

  return [
    `${retailerName}: ${promotions.length} aktuelle Angebotsobjekte extrahiert.`,
    categoryPageCount > 0 ? `${categoryPagePromotions} weitere Treffer aus ${categoryPageCount} Kategorie-Unterseiten.` : '',
    groupNames.length > 0 ? `Schwerpunktgruppen: ${groupNames.join(', ')}.` : 'Keine Produktgruppen erkannt.',
  ].filter(Boolean).join(' ');
}

function classifyAktionsfinderNormalizationDrop(promotion = {}) {
  const title = sanitizeWhitespace(promotion.fullDisplayName || promotion.title);
  const priceCurrentAmount = parseNumericAmount(promotion.discountedPrice ?? promotion.newPrice);

  if (!title && !priceCurrentAmount) {
    return 'parser-no-offer-candidate';
  }

  if (!title) {
    return 'title-missing';
  }

  if (!priceCurrentAmount) {
    return 'price-missing';
  }

  return 'parse-failed';
}

function classifyAktionsfinderAuditDrop(offer = {}) {
  if (offer?.status === 'expired') {
    return 'validity-expired';
  }

  if (offer?.status === 'upcoming') {
    return 'validity-upcoming';
  }

  return 'audit-filtered';
}

function normalizeAktionsfinderPromotions({
  promotions = [],
  source,
  region,
  crawlJobId,
} = {}) {
  const normalizedOffers = [];
  const rejectionReasons = [];

  for (const promotion of promotions) {
    const offer = normalizePromotionToOffer({
      promotion,
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      sourceId: source._id,
      crawlJobId,
      region,
      sourceUrl: source.sourceUrl,
    });

    if (offer) {
      normalizedOffers.push(offer);
    } else {
      addRejectionReason(rejectionReasons, classifyAktionsfinderNormalizationDrop(promotion));
    }
  }

  return {
    normalizedOffers,
    rejectionReasons,
  };
}

function enrichAktionsfinderOffersForStorage({
  normalizedOffers = [],
  source,
  sourceType = 'aktionsfinder-json',
  parserVersion = PARSER_VERSION,
  normalizationVersion = NORMALIZATION_VERSION,
} = {}) {
  const offerDocuments = [];
  const rejectionReasons = [];

  for (const offer of normalizedOffers) {
    const document = enrichOfferForStorage(offer, {
      source,
      sourceType,
      parserVersion,
      normalizationVersion,
    });

    if (document) {
      offerDocuments.push(document);
    } else {
      addRejectionReason(rejectionReasons, classifyAktionsfinderAuditDrop(offer));
    }
  }

  return {
    offerDocuments,
    rejectionReasons,
  };
}

async function fetchAdegFallbackSnapshot() {
  const officialUrl = 'https://www.adeg.at/flugblatt-aktionen/adeg-flugblatt';
  const response = await axios.get(officialUrl, {
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
    },
  });

  const html = String(response.data);
  const $ = cheerio.load(html);
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const teaserMatches = [...bodyText.matchAll(/(Achtung Preisturz!|Aktuelle Angebote|Jetzt entdecken!|Angebot von[^.]+)/gi)]
    .map((match) => match[0])
    .slice(0, 5);

  return {
    officialUrl,
    teaser: teaserMatches.join(' | '),
    snippet: bodyText.slice(0, 500),
  };
}

async function crawlAktionsfinderSource({ source, region, trigger = 'manual' }) {
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

    const response = await axios.get(source.sourceUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
      },
    });

    const html = String(response.data);
    const httpLog = buildHttpLogFromResponse(response, html);
    const recordStrings = getScriptPushStrings(html);
    const sections = extractSections(recordStrings, source.retailerName);
    const basePromotionCandidates = collectAllPromotions(recordStrings, sections);
    const categoryPageLinks = buildCategoryPageLinks(html, source)
      .slice(0, source.retailerKey === 'pagro' ? 18 : 14);
    const categoryPagePromotions = [];
    const digest = buildPayloadDigest(html);
    const dedupeDiagnostics = {};
    let fallbackOfficial = null;

    for (const categoryPageUrl of categoryPageLinks) {
      try {
        const categoryResponse = await axios.get(categoryPageUrl, {
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
          },
        });

        categoryPagePromotions.push(
          ...parsePromotionsFromCategoryPage({
            html: String(categoryResponse.data),
            source,
            pageUrl: categoryPageUrl,
          })
        );
      } catch (error) {
        // Continue with the category pages that are publicly reachable.
      }
    }

    const rawPromotionCandidates = [...basePromotionCandidates, ...categoryPagePromotions];
    const promotions = uniquePromotions(rawPromotionCandidates, dedupeDiagnostics);

    if (source.retailerKey === 'adeg' && promotions.length === 0) {
      try {
        fallbackOfficial = await fetchAdegFallbackSnapshot();
      } catch (fallbackError) {
        fallbackOfficial = {
          officialUrl: 'https://www.adeg.at/flugblatt-aktionen/adeg-flugblatt',
          teaser: '',
          snippet: `ADEG official fallback could not be loaded: ${fallbackError.message}`,
        };
      }
    }

    const rawDocument = await createCompactRawDocument({
      sourceId: source._id,
      crawlJobId: crawlJob._id,
      retailerKey: source.retailerKey,
      region,
      documentType: 'html',
      sourceType: source.sourceType || source.channel,
      url: source.sourceUrl,
      canonicalUrl: response.request?.res?.responseUrl || source.sourceUrl,
      finalUrl: response.request?.res?.responseUrl || source.sourceUrl,
      title: sections.popular?.title || source.label,
      httpStatus: response.status,
      contentType: response.headers?.['content-type'] || '',
      downloadBytes: httpLog.downloadBytes,
      contentHash: digest.contentHash,
      contentSnippet: digest.contentSnippet,
      extractedPreview: promotions.slice(0, 5).map((promotion) => promotion.title).filter(Boolean),
      foundRawItems: rawPromotionCandidates.length,
      parserVersion: PARSER_VERSION,
        payload: {
          promotionCount: promotions.length,
          rawPromotionCandidateCount: rawPromotionCandidates.length,
          dedupeDropped: dedupeDiagnostics.dedupeDropped || 0,
          parserNoOfferCandidate: dedupeDiagnostics.parserNoOfferCandidate || 0,
          categoryPageCount: categoryPageLinks.length,
        categoryPagePromotionCount: categoryPagePromotions.length,
        popularSectionTitle: sections.popular?.title || null,
        assortmentSectionTitle: sections.assortment?.title || null,
        groupedVendor: sections.grouped?.vendor?.name || null,
        groupCount: sections.grouped?.initialPromotionGroupList?.content?.length || 0,
        fallbackOfficialUrl: fallbackOfficial?.officialUrl || '',
        fallbackOfficialTeaser: fallbackOfficial?.teaser || '',
      },
    });

    const normalizationResult = normalizeAktionsfinderPromotions({
      promotions,
      source,
      crawlJobId: crawlJob._id,
      region,
    });
    const normalizedOffers = normalizationResult.normalizedOffers;
    const enrichmentResult = enrichAktionsfinderOffersForStorage({
      normalizedOffers,
      source,
      sourceType: 'aktionsfinder-json',
      parserVersion: PARSER_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
    });
    const offerDocuments = enrichmentResult.offerDocuments;
    const extraRejectionReasons = [
      ...(dedupeDiagnostics.dedupeDropped > 0 ? [{ reason: 'dedupe-dropped', count: dedupeDiagnostics.dedupeDropped }] : []),
      ...(dedupeDiagnostics.parserNoOfferCandidate > 0 ? [{ reason: 'parser-no-offer-candidate', count: dedupeDiagnostics.parserNoOfferCandidate }] : []),
      ...normalizationResult.rejectionReasons,
      ...enrichmentResult.rejectionReasons,
    ];

    const refreshResult = await replaceOffersForSource({
      sourceId: source._id,
      offerDocuments,
      crawlJobId: crawlJob._id,
      allowEmptyReplacement: normalizedOffers.length > 0,
    });

    const essence = buildEssence({
      retailerName: source.retailerName,
      promotions: offerDocuments,
      grouped: sections.grouped,
      categoryPageCount: categoryPageLinks.length,
      categoryPagePromotions: categoryPagePromotions.length,
    });

    const status = normalizedOffers.length > 0 ? 'success' : offerDocuments.length > 0 ? 'success' : 'partial';

    await CrawlJob.findByIdAndUpdate(crawlJob._id, buildCrawlJobUpdate({
      status,
      discoveredPages: 1 + categoryPageLinks.length,
      rawDocuments: 1,
      rawCandidateCount: rawPromotionCandidates.length,
      offers: offerDocuments,
      source,
      sourceType: 'aggregator',
      parserVersion: PARSER_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
      httpLog,
      warningMessages: [
        ...(fallbackOfficial ? ['ADEG liefert aktuell nur einen offiziellen Flugblatt-Hinweis, aber keine extrahierbaren Einzelangebote.'] : []),
      ],
      errorMessages: [],
      extraRejectionReasons,
      metadata: {
        sourceLabel: source.label,
        sourceUrl: source.sourceUrl,
        rawDocumentId: rawDocument._id,
        essence,
        refreshResult,
        fallbackOfficial,
        aktionsfinderAudit: {
          rawPromotionCandidateCount: rawPromotionCandidates.length,
          uniquePromotionCount: promotions.length,
          normalizedOfferCount: normalizedOffers.length,
          offerDocumentCount: offerDocuments.length,
          dedupeDropped: dedupeDiagnostics.dedupeDropped || 0,
          parserNoOfferCandidate: dedupeDiagnostics.parserNoOfferCandidate || 0,
        },
      },
    }));

    await Source.findByIdAndUpdate(source._id, {
      latestRunAt: new Date(),
      latestStatus: status,
    });

    const coverageMetrics = buildCoverageMetrics({
      foundRawItems: rawPromotionCandidates.length,
      parsedOffers: offerDocuments.length,
      offersStored: offerDocuments.length,
      rejectedOffers: Math.max(0, rawPromotionCandidates.length - offerDocuments.length),
      offers: offerDocuments,
      rejectionReasons: extraRejectionReasons,
    });

    return {
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      channel: source.channel,
      sourceType: source.sourceType || source.channel,
      status,
      foundRawItems: rawPromotionCandidates.length,
      parsedOffers: offerDocuments.length,
      rejectedOffers: Math.max(0, rawPromotionCandidates.length - offerDocuments.length),
      offersStored: offerDocuments.length,
      rejectionReasons: coverageMetrics.rejectionReasons,
      rejectedByReason: coverageMetrics.rejectedByReason,
      missingImageCount: coverageMetrics.missingImageCount,
      withImageCount: coverageMetrics.withImageCount,
      missingQuantityCount: coverageMetrics.missingQuantityCount,
      unclearProductCount: coverageMetrics.unclearProductCount,
      upcomingCount: coverageMetrics.upcomingCount,
      expiredCount: coverageMetrics.expiredCount,
      parseFailedCount: coverageMetrics.parseFailedCount,
      categoryUnclearCount: coverageMetrics.categoryUnclearCount,
      storedRatio: coverageMetrics.storedRatio,
      imageCoverageRatio: coverageMetrics.imageCoverageRatio,
      freshnessStatus: coverageMetrics.freshnessStatus,
      flags: coverageMetrics.flags,
      essence,
    };
  } catch (error) {
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
      warningMessages: [],
      errorMessages: [error.message],
    });

    await Source.findByIdAndUpdate(source._id, {
      latestRunAt: new Date(),
      latestStatus: 'failed',
    });

    throw error;
  }
}

async function crawlAllAktionsfinderSources({ region, retailerKeys = [], trigger = 'manual' }) {
  const filter = retailerKeys.length > 0
    ? { active: true, channel: 'aggregator', retailerKey: { $in: retailerKeys } }
    : { active: true, channel: 'aggregator' };

  const sources = await Source.find(filter).sort({ retailerName: 1 });
  const results = [];

  for (const source of sources) {
    const result = await crawlAktionsfinderSource({ source, region, trigger });
    results.push(result);
  }

  return results;
}

module.exports = {
  crawlAllAktionsfinderSources,
  crawlAktionsfinderSource,
  _private: {
    addRejectionReason,
    buildCategoryPageLinks,
    buildSupplementalCategoryPageLinks,
    classifyAktionsfinderAuditDrop,
    classifyAktionsfinderNormalizationDrop,
    collectAllPromotions,
    enrichAktionsfinderOffersForStorage,
    extractCategoryPageLinks,
    normalizeAktionsfinderPromotions,
    uniquePromotions,
  },
};
