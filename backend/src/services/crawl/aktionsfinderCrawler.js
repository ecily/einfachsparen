const axios = require('axios');
const cheerio = require('cheerio');
const Source = require('../../models/Source');
const CrawlJob = require('../../models/CrawlJob');
const Offer = require('../../models/Offer');
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
const { enrichOffersForStorage } = require('./offerAuditEnrichment');
const { NORMALIZATION_VERSION, buildCrawlJobUpdate, buildHttpLogFromResponse } = require('./crawlAudit');

const PARSER_VERSION = 'aktionsfinder-v3-coverage';

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
        type: secondaryUnit.type,
      };
    }
  }

  return product;
}

function parseDatesFromLeafletHref(href) {
  const match = String(href || '').match(/-(\d{2})-(\d{2})-(\d{4})-(\d{2})-(\d{2})-(\d{4})\/?$/);

  if (!match) {
    return {
      validFrom: null,
      validTo: null,
    };
  }

  const [, fromDay, fromMonth, fromYear, toDay, toMonth, toYear] = match.map(Number);

  return {
    validFrom: new Date(Date.UTC(fromYear, fromMonth - 1, fromDay, 12, 0, 0)),
    validTo: new Date(Date.UTC(toYear, toMonth - 1, toDay, 12, 0, 0)),
  };
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
    });
  });

  return promotions;
}

function uniquePromotions(promotions) {
  const seen = new Map();

  for (const promotion of promotions) {
    if (!promotion?.id) {
      continue;
    }

    if (!seen.has(promotion.id)) {
      seen.set(promotion.id, promotion);
    }
  }

  return [...seen.values()];
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

  return uniquePromotions([...sectionPromotions, ...groupedPromotions, ...fallbackPromotions]);
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
    const basePromotions = extractAllPromotions(recordStrings, sections);
    const categoryPageLinks = extractCategoryPageLinks(html, source.sourceUrl)
      .slice(0, source.retailerKey === 'pagro' ? 18 : 14);
    const categoryPagePromotions = [];
    const digest = buildPayloadDigest(html);
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

    const promotions = uniquePromotions([...basePromotions, ...categoryPagePromotions]);

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
      foundRawItems: promotions.length,
      parserVersion: PARSER_VERSION,
      payload: {
        promotionCount: promotions.length,
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

    await Offer.deleteMany({ sourceId: source._id });

    const normalizedOffers = promotions
      .map((promotion) =>
        normalizePromotionToOffer({
          promotion,
          retailerKey: source.retailerKey,
          retailerName: source.retailerName,
          sourceId: source._id,
          crawlJobId: crawlJob._id,
          region,
          sourceUrl: source.sourceUrl,
        })
      )
      .filter(Boolean);
    const offerDocuments = enrichOffersForStorage(normalizedOffers, {
      source,
      sourceType: 'aktionsfinder-json',
      parserVersion: PARSER_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
    });

    if (offerDocuments.length > 0) {
      await Offer.insertMany(offerDocuments, { ordered: false });
    }

    const essence = buildEssence({
      retailerName: source.retailerName,
      promotions: offerDocuments,
      grouped: sections.grouped,
      categoryPageCount: categoryPageLinks.length,
      categoryPagePromotions: categoryPagePromotions.length,
    });

    await CrawlJob.findByIdAndUpdate(crawlJob._id, buildCrawlJobUpdate({
      status: offerDocuments.length > 0 ? 'success' : 'partial',
      discoveredPages: 1 + categoryPageLinks.length,
      rawDocuments: 1,
      rawCandidateCount: promotions.length,
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
      metadata: {
        sourceLabel: source.label,
        sourceUrl: source.sourceUrl,
        rawDocumentId: rawDocument._id,
        essence,
        fallbackOfficial,
      },
    }));

    await Source.findByIdAndUpdate(source._id, {
      latestRunAt: new Date(),
      latestStatus: offerDocuments.length > 0 ? 'success' : 'partial',
    });

    return {
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      offersStored: offerDocuments.length,
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
};
