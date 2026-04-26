const axios = require('axios');
const cheerio = require('cheerio');
const Source = require('../../models/Source');
const CrawlJob = require('../../models/CrawlJob');
const Offer = require('../../models/Offer');
const { buildPayloadDigest } = require('./aktionsfinderParser');
const { normalizePromotionToOffer } = require('./offerNormalizer');
const { clearRawDocumentsForSource, createCompactRawDocument } = require('./rawDocumentStorage');
const { sanitizeWhitespace, normalizeTitleForMatch } = require('./sourceEvidence');
const { enrichOffersForStorage } = require('./offerAuditEnrichment');
const { NORMALIZATION_VERSION, buildCrawlJobUpdate, buildHttpLogFromResponse } = require('./crawlAudit');

const PARSER_VERSION = 'wogibtswas-v2-coverage';

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

function parseDate(value) {
  const match = String(value || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);

  if (!match) {
    return null;
  }

  const [day, month, year] = match.slice(1).map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
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

  if (/^(stk|stueck|stuck)$/.test(normalized)) {
    return { shortName: 'Stk', type: 'PRODUCT' };
  }

  if (/^(packung|pack|netz|becher|flasche|dose|glas|tube|rolle|karton|sack)$/.test(normalized)) {
    return { shortName: sanitizeWhitespace(unitText), type: 'PACKAGING' };
  }

  return null;
}

function buildProductFromTitle(title) {
  const matches = [...sanitizeWhitespace(title).matchAll(
    /(\d+(?:[.,]\d+)?)\s*(Kilogramm|kg|Gramm|g|Liter|l|Milliliter|ml|St(?:u|ü)?ck|Stk|Packung|Pack|Netz|Becher|Flasche|Dose|Glas|Tube|Rolle|Karton|Sack)\b/gi
  )];
  const product = {};

  if (matches.length === 0) {
    return product;
  }

  const primaryAmount = parseNumericAmount(matches[0][1]);
  const primaryUnit = normalizeProductUnitMatch(matches[0][2]);

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

function extractBrochureValidTo(html) {
  const $ = cheerio.load(html);
  const dates = $('a[href^="/b/"]')
    .map((index, element) => parseDate($(element).text()))
    .get()
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime());

  return dates[0] || null;
}

function parseProductLinks({ html, source, validTo }) {
  const $ = cheerio.load(html);
  const promotions = [];
  const now = new Date();

  $('a[href^="/p/"]').each((index, element) => {
    const anchor = $(element);
    const href = sanitizeWhitespace(anchor.attr('href'));
    const text = sanitizeWhitespace(anchor.text());

    if (!href || !/preis nur/i.test(text)) {
      return;
    }

    const priceMatch = text.match(/Preis nur\s+([\d,.]+)\s*€/i);
    const categoryMatch = text.match(/Kategorie:\s*([^]+)$/i);
    const title = sanitizeWhitespace(text.replace(/Preis nur\s+[\d,.]+\s*€[\s\S]*$/i, ''));
    const description = sanitizeWhitespace(
      text
        .replace(/^.+?Preis nur\s+[\d,.]+\s*€/i, '')
        .replace(/Entfernt:\s*[\d,.]+\s*km/i, '')
        .replace(/Kategorie:\s*([^]+)$/i, '')
    );
    const categoryTitle = sanitizeWhitespace(categoryMatch?.[1] || '');
    const currentPrice = parseNumericAmount(priceMatch?.[1]);
    const observedUrl = toAbsoluteUrl(href, source.sourceUrl);
    const imageUrl = sanitizeWhitespace(anchor.find('img').first().attr('src') || anchor.closest('li,div,article').find('img').first().attr('src') || '');

    if (!title || !currentPrice || !observedUrl) {
      return;
    }

    promotions.push({
      id: `${source.retailerKey}::${normalizeTitleForMatch(title)}::${currentPrice}::${href}`,
      title,
      fullDisplayName: title,
      description,
      discountedPrice: currentPrice,
      originalPrice: null,
      validFrom: now.toISOString(),
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
      tags: ['wogibtswas-html'],
      productGroups: categoryTitle ? [{ title: categoryTitle }] : [],
      product: buildProductFromTitle(title),
    });
  });

  return promotions;
}

async function crawlWogibtswasSource({ source, region, trigger = 'manual' }) {
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
    const digest = buildPayloadDigest(html);
    const validTo = extractBrochureValidTo(html);
    const promotions = parseProductLinks({
      html,
      source,
      validTo,
    });

    await createCompactRawDocument({
      sourceId: source._id,
      crawlJobId: crawlJob._id,
      retailerKey: source.retailerKey,
      region,
      documentType: 'html',
      sourceType: source.sourceType || source.channel,
      url: source.sourceUrl,
      canonicalUrl: response.request?.res?.responseUrl || source.sourceUrl,
      finalUrl: response.request?.res?.responseUrl || source.sourceUrl,
      title: source.label,
      httpStatus: response.status,
      contentType: response.headers?.['content-type'] || '',
      downloadBytes: httpLog.downloadBytes,
      contentHash: digest.contentHash,
      contentSnippet: digest.contentSnippet,
      extractedPreview: promotions.slice(0, 8).map((promotion) => promotion.title),
      foundRawItems: promotions.length,
      parserVersion: PARSER_VERSION,
      payload: {
        promotionCount: promotions.length,
        validTo,
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
      .filter(Boolean)
      .map((offer) => ({
        ...offer,
        parserVersion: 'wogibtswas-v1',
        rawFacts: {
          ...offer.rawFacts,
          sourceType: 'wogibtswas-html',
          snapshotCurrent: true,
        },
      }));
    const offerDocuments = enrichOffersForStorage(normalizedOffers, {
      source,
      sourceType: 'wogibtswas-html',
      parserVersion: PARSER_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
    });

    if (offerDocuments.length > 0) {
      await Offer.insertMany(offerDocuments, { ordered: false });
    }

    const status = offerDocuments.length > 0 ? 'success' : 'partial';

    await CrawlJob.findByIdAndUpdate(crawlJob._id, buildCrawlJobUpdate({
      status,
      discoveredPages: 1,
      rawDocuments: 1,
      rawCandidateCount: promotions.length,
      offers: offerDocuments,
      source,
      sourceType: 'aggregator',
      parserVersion: PARSER_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
      httpLog,
      warningMessages: [],
      errorMessages: [],
      metadata: {
        sourceLabel: source.label,
        sourceUrl: source.sourceUrl,
        validTo,
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
      sourceUrl: source.sourceUrl,
      offersStored: offerDocuments.length,
      discoveredLinks: promotions.length,
      evidenceMatched: 0,
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

module.exports = {
  crawlWogibtswasSource,
};
