const Source = require('../../models/Source');
const Offer = require('../../models/Offer');
const { crawlAktionsfinderSource } = require('./aktionsfinderCrawler');
const { crawlOfficialSource } = require('./officialSourceCrawler');
const { crawlMarktguruSource } = require('./marketguruCrawler');
const { dedupeOffersAcrossSources } = require('./catalogDeduper');
const { rebuildFilterMetadata } = require('../filters/filterMetadataService');
const { clearRankingResponseCache } = require('../offers/offerRankingService');
const { ensureManualCategoryOverrideCacheLoaded } = require('../quality/manualCategoryOverrideService');
const logger = require('../../lib/logger');

const CHANNEL_PRIORITY = {
  'official-site': 0,
  'official-flyer': 1,
  aggregator: 2,
  other: 3,
};

const RETAILER_PRIORITY = {
  spar: 0,
  lidl: 1,
  penny: 2,
  dm: 3,
  pagro: 4,
  bipa: 5,
  adeg: 6,
  hofer: 7,
  billa: 8,
  'billa-plus': 9,
};

async function crawlSource({ source, region, trigger = 'manual' }) {
  if (source.channel === 'aggregator') {
    if (String(source.sourceUrl || '').includes('marktguru.at/')) {
      return crawlMarktguruSource({ source, region, trigger });
    }

    return crawlAktionsfinderSource({ source, region, trigger });
  }

  if (source.channel === 'official-site' || source.channel === 'official-flyer') {
    return crawlOfficialSource({ source, region, trigger });
  }

  return crawlOfficialSource({ source, region, trigger });
}

async function crawlAllSources({ region, retailerKeys = [], trigger = 'manual' }) {
  await ensureManualCategoryOverrideCacheLoaded();
  const filter = retailerKeys.length > 0
    ? { active: true, retailerKey: { $in: retailerKeys } }
    : { active: true };

  const [sources, activeOfferCounts] = await Promise.all([
    Source.find(filter).lean(),
    Offer.aggregate([
      {
        $match: retailerKeys.length > 0
          ? { retailerKey: { $in: retailerKeys }, status: 'active', isActiveNow: true }
          : { status: 'active', isActiveNow: true },
      },
      {
        $group: {
          _id: '$retailerKey',
          activeOfferCount: { $sum: 1 },
        },
      },
    ]),
  ]);
  const activeOfferCountMap = new Map(
    activeOfferCounts.map((item) => [String(item._id || ''), Number(item.activeOfferCount || 0)])
  );
  const prioritizedSources = [...sources].sort((left, right) => {
    const leftRetailerPriority = RETAILER_PRIORITY[left.retailerKey] ?? 50;
    const rightRetailerPriority = RETAILER_PRIORITY[right.retailerKey] ?? 50;

    if (leftRetailerPriority !== rightRetailerPriority) {
      return leftRetailerPriority - rightRetailerPriority;
    }

    const leftCoverage = activeOfferCountMap.get(left.retailerKey) ?? 0;
    const rightCoverage = activeOfferCountMap.get(right.retailerKey) ?? 0;

    if (leftCoverage !== rightCoverage) {
      return leftCoverage - rightCoverage;
    }

    const leftChannelPriority = CHANNEL_PRIORITY[left.channel] ?? 99;
    const rightChannelPriority = CHANNEL_PRIORITY[right.channel] ?? 99;

    if (leftChannelPriority !== rightChannelPriority) {
      return leftChannelPriority - rightChannelPriority;
    }

    return `${left.retailerName} ${left.label}`.localeCompare(`${right.retailerName} ${right.label}`, 'de');
  });
  const results = [];

  for (const source of prioritizedSources) {
    try {
      const result = await crawlSource({ source, region, trigger });
      results.push({
        ...result,
        status: 'success',
      });
    } catch (error) {
      results.push({
        retailerKey: source.retailerKey,
        retailerName: source.retailerName,
        channel: source.channel,
        sourceUrl: source.sourceUrl,
        offersStored: 0,
        discoveredLinks: 0,
        status: 'failed',
        error: error.message,
      });
    }
  }

  const dedupeResult = await dedupeOffersAcrossSources({ retailerKeys });
  let filterMetadata = {
    ok: true,
    skipped: false,
  };

  try {
    const syncResult = await rebuildFilterMetadata({
      trigger: `crawl:${trigger}`,
      loggerContext: {
        region,
        retailerScope: retailerKeys,
      },
    });

    filterMetadata = {
      ok: true,
      skipped: false,
      ...syncResult,
    };
    clearRankingResponseCache();
  } catch (error) {
    filterMetadata = {
      ok: false,
      skipped: false,
      message: error.message,
    };

    logger.error('Filter metadata rebuild failed after crawl', {
      message: error.message,
      stack: error.stack,
      trigger,
      region,
      retailerKeys,
    });
  }

  return {
    sources: results,
    dedupe: dedupeResult,
    filterMetadata,
  };
}

module.exports = {
  crawlAllSources,
  crawlSource,
};
