const Source = require('../../models/Source');
const Offer = require('../../models/Offer');
const { crawlAktionsfinderSource } = require('./aktionsfinderCrawler');
const { crawlOfficialSource } = require('./officialSourceCrawler');
const { crawlMarktguruSource } = require('./marketguruCrawler');
const { crawlWogibtswasSource } = require('./wogibtswasCrawler');
const { dedupeOffersAcrossSources } = require('./catalogDeduper');
const { rebuildFilterMetadata } = require('../filters/filterMetadataService');
const { clearRankingResponseCache } = require('../offers/offerRankingService');
const { ensureManualCategoryOverrideCacheLoaded } = require('../quality/manualCategoryOverrideService');
const {
  resolveCrawlSourceSelection,
  summarizeSource,
} = require('./crawlSourceSelection');
const logger = require('../../lib/logger');

async function crawlSource({ source, region, trigger = 'manual' }) {
  if (source.channel === 'aggregator') {
    if (String(source.sourceUrl || '').includes('marktguru.at/')) {
      return crawlMarktguruSource({ source, region, trigger });
    }

    if (String(source.sourceUrl || '').includes('wogibtswas.at/')) {
      return crawlWogibtswasSource({ source, region, trigger });
    }

    return crawlAktionsfinderSource({ source, region, trigger });
  }

  if (source.channel === 'official-site' || source.channel === 'official-flyer') {
    return crawlOfficialSource({ source, region, trigger });
  }

  return crawlOfficialSource({ source, region, trigger });
}

async function fetchDisabledSourcesForRetailers({ retailerKeys = [] } = {}) {
  const disabledFilter = retailerKeys.length > 0
    ? { active: true, enabled: false, retailerKey: { $in: retailerKeys } }
    : { active: true, enabled: false };

  return Source.find(disabledFilter)
      .select('retailerKey retailerName channel label sourceUrl sourceType sourceRetailerFormat enabled active disabledReason notes latestStatus latestRunAt')
      .sort({ retailerName: 1, label: 1 })
      .lean();
}

async function crawlAllSources({
  region,
  retailerKeys = [],
  sourceKeys = [],
  sourceIds = [],
  allowDisabled = false,
  dryRun = false,
  sourceSelectionRequested: explicitSourceSelectionRequested = false,
  trigger = 'manual',
} = {}) {
  const sourceCoverage = {
    totalRegisteredSources: await Source.countDocuments({ active: true }),
    activeEligibleSources: await Source.countDocuments({ active: true, enabled: { $ne: false } }),
    disabledSourcesCount: await Source.countDocuments({ active: true, enabled: false }),
  };
  const sourceSelectionRequested = explicitSourceSelectionRequested || sourceKeys.length > 0 || sourceIds.length > 0;
  const selection = await resolveCrawlSourceSelection({
    Source,
    Offer,
    retailerKeys,
    sourceKeys,
    sourceIds,
    allowDisabled,
    dryRun,
    sourceSelectionRequested,
  });

  if (dryRun) {
    return {
      dryRun: true,
      crawlStarted: false,
      matchedSources: selection.matchedSources,
      skippedSources: selection.skippedSources,
      disabledSources: selection.disabledSources,
      unknownSourceKeys: selection.unknownSourceKeys,
      unknownSourceIds: selection.unknownSourceIds,
      effectiveRetailerKeys: selection.effectiveRetailerKeys,
      requestedRetailerKeys: selection.requestedRetailerKeys,
      requestedSourceKeys: selection.requestedSourceKeys,
      requestedSourceIds: selection.requestedSourceIds,
      wouldRunCount: selection.wouldRunCount,
      sourceCoverage,
    };
  }

  await ensureManualCategoryOverrideCacheLoaded();
  const prioritizedSources = selection.sources;
  const results = [];

  if (prioritizedSources.length === 0) {
    const disabledSources = sourceSelectionRequested
      ? selection.disabledSources
      : (await fetchDisabledSourcesForRetailers({ retailerKeys })).map((source) => ({
        ...summarizeSource(source),
        skippedReason: 'disabled-source',
      }));

    return {
      sources: [],
      matchedSources: [],
      skippedSources: selection.skippedSources || [],
      disabledSources,
      unknownSourceKeys: selection.unknownSourceKeys || [],
      unknownSourceIds: selection.unknownSourceIds || [],
      effectiveRetailerKeys: [],
      requestedSourceKeys: selection.requestedSourceKeys,
      requestedSourceIds: selection.requestedSourceIds,
      dedupe: {
        skipped: true,
        reason: 'no-active-eligible-sources',
      },
      filterMetadata: {
        ok: false,
        skipped: true,
        message: 'No active eligible crawl sources matched this run.',
      },
      sourceCoverage,
      warnings: ['No active eligible crawl sources matched this run.'],
    };
  }

  for (const source of prioritizedSources) {
    const sourceSummary = summarizeSource(source);

    try {
      const result = await crawlSource({ source, region, trigger });
      results.push({
        ...sourceSummary,
        ...result,
        status: result.status || 'success',
      });
    } catch (error) {
      const diagnostic = error.diagnostic || {};
      results.push({
        ...sourceSummary,
        retailerKey: source.retailerKey,
        retailerName: source.retailerName,
        channel: source.channel,
        sourceType: source.sourceType || '',
        sourceUrl: source.sourceUrl,
        offersStored: 0,
        discoveredLinks: 0,
        status: 'failed',
        error: error.message,
        failureStage: diagnostic.failureStage || 'fetch',
        httpStatus: diagnostic.httpStatus ?? null,
        contentType: diagnostic.contentType || '',
        finalUrl: diagnostic.finalUrl || source.sourceUrl,
        diagnostic,
      });
    }
  }

  const effectiveRetailerKeys = selection.effectiveRetailerKeys.length > 0
    ? selection.effectiveRetailerKeys
    : retailerKeys;
  const dedupeResult = await dedupeOffersAcrossSources({ retailerKeys: effectiveRetailerKeys });
  let filterMetadata = {
    ok: true,
    skipped: false,
  };

  try {
    const syncResult = await rebuildFilterMetadata({
      trigger: `crawl:${trigger}`,
      loggerContext: {
        region,
        retailerScope: effectiveRetailerKeys,
        sourceScope: selection.requestedSourceKeys,
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
      retailerKeys: effectiveRetailerKeys,
    });
  }
  const disabledSources = sourceSelectionRequested
    ? selection.disabledSources
    : (await fetchDisabledSourcesForRetailers({ retailerKeys })).map((source) => ({
      ...summarizeSource(source),
      skippedReason: 'disabled-source',
    }));

  return {
    sources: results,
    matchedSources: selection.matchedSources,
    skippedSources: sourceSelectionRequested ? selection.skippedSources : [],
    disabledSources,
    effectiveRetailerKeys,
    requestedSourceKeys: selection.requestedSourceKeys,
    requestedSourceIds: selection.requestedSourceIds,
    dedupe: dedupeResult,
    filterMetadata,
    sourceCoverage,
  };
}

module.exports = {
  crawlAllSources,
  crawlSource,
  fetchDisabledSourcesForRetailers,
};
