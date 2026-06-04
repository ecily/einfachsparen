const Source = require('../../models/Source');
const Offer = require('../../models/Offer');
const CrawlJob = require('../../models/CrawlJob');
const { crawlAktionsfinderSource } = require('./aktionsfinderCrawler');
const { crawlOfficialSource } = require('./officialSourceCrawler');
const { crawlMarktguruSource } = require('./marketguruCrawler');
const { crawlWogibtswasSource } = require('./wogibtswasCrawler');
const { dedupeOffersAcrossSources } = require('./catalogDeduper');
const { rebuildFilterMetadata } = require('../filters/filterMetadataService');
const { clearRankingResponseCache } = require('../offers/offerRankingService');
const { ensureManualCategoryOverrideCacheLoaded } = require('../quality/manualCategoryOverrideService');
const {
  deriveSourceKey,
  resolveCrawlSourceSelection,
  summarizeSource,
} = require('./crawlSourceSelection');
const logger = require('../../lib/logger');

const DEFAULT_SOURCE_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_SOURCE_TIMEOUT_MS = 250;
const SOURCE_TIMEOUT_ERROR_CODE = 'CRAWL_SOURCE_TIMEOUT';

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

async function crawlSource({ source, region, trigger = 'manual', crawlRunId = null, signal = null }) {
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
    return crawlOfficialSource({ source, region, trigger, crawlRunId, signal });
  }

  return crawlOfficialSource({ source, region, trigger, crawlRunId, signal });
}

function sourceIdString(source = {}) {
  return String(source?._id || source?.id || '');
}

function sourceTimeoutMs(source = {}) {
  const configured = Number(
    source?.crawlPolicy?.sourceTimeoutMs
    ?? source?.crawlPolicy?.maxSourceRuntimeMs
    ?? source?.crawlPolicy?.sourceTimeoutMillis
    ?? DEFAULT_SOURCE_TIMEOUT_MS
  );

  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_SOURCE_TIMEOUT_MS;
  }

  return Math.max(MIN_SOURCE_TIMEOUT_MS, Math.round(configured));
}

function createSourceTimeoutError({ source = {}, timeoutMs = DEFAULT_SOURCE_TIMEOUT_MS } = {}) {
  const sourceKey = deriveSourceKey(source);
  const error = new Error(`Crawl source timed out after ${timeoutMs}ms: ${sourceKey}`);
  error.code = SOURCE_TIMEOUT_ERROR_CODE;
  error.diagnostic = {
    failureStage: 'source-timeout',
    timeoutMs,
    sourceKey,
    sourceId: sourceIdString(source),
    sourceUrl: source.sourceUrl || '',
  };
  return error;
}

function isSourceTimeoutError(error) {
  return error?.code === SOURCE_TIMEOUT_ERROR_CODE;
}

async function withSourceTimeout(task, { source = {}, timeoutMs = sourceTimeoutMs(source) } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeoutId = null;

  try {
    return await Promise.race([
      task({ signal: controller?.signal || null }),
      new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
          if (controller) {
            controller.abort();
          }
          reject(createSourceTimeoutError({ source, timeoutMs }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function markRunningSourceJobTimedOut({
  CrawlJobModel = CrawlJob,
  source = {},
  crawlRunId = null,
  trigger = 'manual',
  region = '',
  error,
  now = new Date(),
} = {}) {
  if (!CrawlJobModel || typeof CrawlJobModel.updateOne !== 'function') {
    return { matchedCount: 0, modifiedCount: 0, skipped: true };
  }

  const sourceId = source?._id || source?.id || null;
  if (!sourceId || !crawlRunId) {
    return { matchedCount: 0, modifiedCount: 0, skipped: true };
  }

  const timeoutMs = Number(error?.diagnostic?.timeoutMs || 0) || sourceTimeoutMs(source);
  const update = {
    $set: {
      status: 'failed',
      finishedAt: now,
      sourceType: source.sourceType || source.channel || '',
      sourceUrl: source.sourceUrl || '',
      parserVersion: '',
      normalizationVersion: '',
      'stats.errors': 1,
      'stats.warnings': 1,
      'httpLog.finalUrl': source.sourceUrl || '',
      metadata: {
        sourceLabel: source.label || '',
        sourceUrl: source.sourceUrl || '',
        sourceTimeout: {
          timedOutAt: now,
          timeoutMs,
          reason: 'source-timeout',
        },
      },
    },
    $push: {
      errorMessages: error?.message || `Crawl source timed out after ${timeoutMs}ms.`,
      warningMessages: 'Source timed out and was marked failed so the CrawlRun can continue.',
    },
  };

  const result = await CrawlJobModel.updateOne(
    {
      crawlRunId,
      sourceId,
      status: 'running',
    },
    update
  );

  const matched = Number(result?.matchedCount ?? result?.n ?? 0);
  if (matched > 0 || typeof CrawlJobModel.create !== 'function') {
    return result;
  }

  return CrawlJobModel.create({
    crawlRunId,
    sourceId,
    retailerKey: source.retailerKey || '',
    region,
    trigger,
    status: 'failed',
    finishedAt: now,
    sourceType: source.sourceType || source.channel || '',
    sourceUrl: source.sourceUrl || '',
    stats: {
      errors: 1,
      warnings: 1,
    },
    errorMessages: [error?.message || `Crawl source timed out after ${timeoutMs}ms.`],
    warningMessages: ['Source timed out before a running CrawlJob could be updated.'],
    metadata: update.$set.metadata,
  });
}

async function fetchDisabledSourcesForRetailers({ retailerKeys = [], SourceModel = Source } = {}) {
  const disabledFilter = retailerKeys.length > 0
    ? { active: true, enabled: false, retailerKey: { $in: retailerKeys } }
    : { active: true, enabled: false };

  return SourceModel.find(disabledFilter)
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
  crawlSourceImpl = crawlSource,
  CrawlJobModel = CrawlJob,
  SourceModel = Source,
  OfferModel = Offer,
  dedupeOffersAcrossSourcesImpl = dedupeOffersAcrossSources,
  rebuildFilterMetadataImpl = rebuildFilterMetadata,
  clearRankingResponseCacheImpl = clearRankingResponseCache,
  ensureManualCategoryOverrideCacheLoadedImpl = ensureManualCategoryOverrideCacheLoaded,
} = {}) {
  const sourceCoverage = {
    totalRegisteredSources: await SourceModel.countDocuments({ active: true }),
    activeEligibleSources: await SourceModel.countDocuments({ active: true, enabled: { $ne: false } }),
    disabledSourcesCount: await SourceModel.countDocuments({ active: true, enabled: false }),
  };
  const sourceSelectionRequested = explicitSourceSelectionRequested || sourceKeys.length > 0 || sourceIds.length > 0;
  const selection = await resolveCrawlSourceSelection({
    Source: SourceModel,
    Offer: OfferModel,
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

  await ensureManualCategoryOverrideCacheLoadedImpl();
  const prioritizedSources = selection.sources;
  const results = [];

  await reportCrawlProgress(onProgress, {
    stage: 'sources-started',
    sourceCount: prioritizedSources.length,
  });

  if (prioritizedSources.length === 0) {
    const disabledSources = sourceSelectionRequested
      ? selection.disabledSources
      : (await fetchDisabledSourcesForRetailers({ retailerKeys, SourceModel })).map((source) => ({
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
      const timeoutMs = sourceTimeoutMs(source);
      const result = await withSourceTimeout(
        ({ signal }) => crawlSourceImpl({ source, region, trigger, crawlRunId, signal }),
        { source, timeoutMs }
      );
      results.push({
        ...sourceSummary,
        ...result,
        status: result.status || 'success',
      });
    } catch (error) {
      const diagnostic = error.diagnostic || {};
      if (isSourceTimeoutError(error)) {
        await markRunningSourceJobTimedOut({
          CrawlJobModel,
          source,
          crawlRunId,
          trigger,
          region,
          error,
        });
      }
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
  const dedupeResult = await dedupeOffersAcrossSourcesImpl({ retailerKeys: effectiveRetailerKeys, crawlRunId });
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
    const syncResult = await rebuildFilterMetadataImpl({
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
    clearRankingResponseCacheImpl();
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
    : (await fetchDisabledSourcesForRetailers({ retailerKeys, SourceModel })).map((source) => ({
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
  _private: {
    DEFAULT_SOURCE_TIMEOUT_MS,
    SOURCE_TIMEOUT_ERROR_CODE,
    createSourceTimeoutError,
    isSourceTimeoutError,
    markRunningSourceJobTimedOut,
    sourceTimeoutMs,
    withSourceTimeout,
  },
};
