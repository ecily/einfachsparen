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

async function reportCrawlProgress(onProgress, progress) {
  if (typeof onProgress !== 'function') {
    return;
  }

  try {
    await onProgress(progress);
  } catch (error) {
    logger.warn('CrawlRun progress marker failed', {
      stage: progress?.stage || '',
      message: error.message,
    });
  }
}

async function crawlSource({ source, region, trigger = 'manual', crawlRunId = null }) {
  if (source.channel === 'aggregator') {
    if (String(source.sourceUrl || '').includes('marktguru.at/')) {
      return crawlMarktguruSource({ source, region, trigger, crawlRunId });
    }

    if (String(source.sourceUrl || '').includes('wogibtswas.at/')) {
      return crawlWogibtswasSource({ source, region, trigger, crawlRunId });
    }

    return crawlAktionsfinderSource({ source, region, trigger, crawlRunId });
  }

  if (source.channel === 'official-site' || source.channel === 'official-flyer') {
    return crawlOfficialSource({ source, region, trigger, crawlRunId });
  }

  return crawlOfficialSource({ source, region, trigger, crawlRunId });
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
  crawlRunId = null,
  onProgress = null,
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

  await reportCrawlProgress(onProgress, {
    stage: 'sources-started',
    sourceCount: prioritizedSources.length,
  });

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
      const result = await crawlSource({ source, region, trigger, crawlRunId });
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

  await reportCrawlProgress(onProgress, {
    stage: 'source-jobs-finished',
    sourceCount: prioritizedSources.length,
    finishedSourceCount: results.length,
    retailerKeys: effectiveRetailerKeys,
  });

  await reportCrawlProgress(onProgress, {
    stage: 'dedupe-started',
    retailerKeys: effectiveRetailerKeys,
  });
  const dedupeResult = await dedupeOffersAcrossSources({ retailerKeys: effectiveRetailerKeys });
  await reportCrawlProgress(onProgress, {
    stage: 'dedupe-finished',
    duplicateGroups: dedupeResult.duplicateGroups,
    removedOffers: dedupeResult.removedOffers,
  });
  let filterMetadata = {
    ok: true,
    skipped: false,
  };

  try {
    await reportCrawlProgress(onProgress, {
      stage: 'filter-metadata-started',
    });
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
    await reportCrawlProgress(onProgress, {
      stage: 'filter-metadata-finished',
      processedOffers: syncResult.processedOffers,
      retailers: syncResult.retailers,
      categories: syncResult.categories,
    });
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
    await reportCrawlProgress(onProgress, {
      stage: 'filter-metadata-failed',
      message: error.message,
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
