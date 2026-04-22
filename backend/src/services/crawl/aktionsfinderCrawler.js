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

function buildEssence({ retailerName, promotions, grouped }) {
  const groupNames = (grouped?.initialPromotionGroupList?.content || [])
    .slice(0, 5)
    .map((item) => item.group?.title)
    .filter(Boolean);

  return [
    `${retailerName}: ${promotions.length} aktuelle Angebotsobjekte extrahiert.`,
    groupNames.length > 0 ? `Schwerpunktgruppen: ${groupNames.join(', ')}.` : 'Keine Produktgruppen erkannt.',
  ].join(' ');
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
    const recordStrings = getScriptPushStrings(html);
    const sections = extractSections(recordStrings, source.retailerName);
    const promotions = extractAllPromotions(recordStrings, sections);
    const digest = buildPayloadDigest(html);
    let fallbackOfficial = null;

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
      url: source.sourceUrl,
      canonicalUrl: response.request?.res?.responseUrl || source.sourceUrl,
      title: sections.popular?.title || source.label,
      contentHash: digest.contentHash,
      contentSnippet: digest.contentSnippet,
      extractedPreview: promotions.slice(0, 5).map((promotion) => promotion.title).filter(Boolean),
      payload: {
        promotionCount: promotions.length,
        popularSectionTitle: sections.popular?.title || null,
        assortmentSectionTitle: sections.assortment?.title || null,
        groupedVendor: sections.grouped?.vendor?.name || null,
        groupCount: sections.grouped?.initialPromotionGroupList?.content?.length || 0,
        fallbackOfficialUrl: fallbackOfficial?.officialUrl || '',
        fallbackOfficialTeaser: fallbackOfficial?.teaser || '',
      },
    });

    await Offer.deleteMany({ sourceId: source._id });

    const normalizedOffers = promotions.map((promotion) =>
      normalizePromotionToOffer({
        promotion,
        retailerKey: source.retailerKey,
        retailerName: source.retailerName,
        sourceId: source._id,
        crawlJobId: crawlJob._id,
        region,
        sourceUrl: source.sourceUrl,
      })
    );
    const offerDocuments = normalizedOffers.map(({ scope, ...offer }) => offer);

    if (offerDocuments.length > 0) {
      await Offer.insertMany(offerDocuments, { ordered: false });
    }

    const essence = buildEssence({
      retailerName: source.retailerName,
      promotions: offerDocuments,
      grouped: sections.grouped,
    });

    await CrawlJob.findByIdAndUpdate(crawlJob._id, {
      status: offerDocuments.length > 0 ? 'success' : 'partial',
      finishedAt: new Date(),
      stats: {
        discoveredPages: 1,
        rawDocuments: 1,
        offersExtracted: promotions.length,
        offersStored: offerDocuments.length,
        warnings: offerDocuments.filter((offer) => offer.quality.issues.length > 0).length,
        errors: 0,
      },
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
    });

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
      stats: {
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
