const Source = require('../../models/Source');
const { crawlAktionsfinderSource } = require('./aktionsfinderCrawler');
const { crawlOfficialSource } = require('./officialSourceCrawler');
const { crawlMarktguruSource } = require('./marketguruCrawler');
const { dedupeOffersAcrossSources } = require('./catalogDeduper');
const { rebuildFilterMetadata } = require('../filters/filterMetadataService');
const logger = require('../../lib/logger');

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
  const filter = retailerKeys.length > 0
    ? { active: true, retailerKey: { $in: retailerKeys } }
    : { active: true };

  const sources = await Source.find(filter).sort({ retailerName: 1, channel: 1 }).lean();
  const results = [];

  for (const source of sources) {
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
