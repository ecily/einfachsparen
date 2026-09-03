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
const { runSourceInChildProcess } = require('./sourceProcessRunner');
const {
  deriveSourceKey,
  resolveCrawlSourceSelection,
  summarizeSource,
} = require('./crawlSourceSelection');
const { getScheduledHealthPolicy } = require('../sources/sourceHealthPolicy');
const logger = require('../../lib/logger');

const DEFAULT_SOURCE_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_SOURCE_TIMEOUT_MS = 250;
const SOURCE_TIMEOUT_ERROR_CODE = 'CRAWL_SOURCE_TIMEOUT';
const FULL_CRAWL_BOUNDED_SOURCE_KEYS = new Set([
  'spar-official-flyer-pdf',
]);
const FULL_CRAWL_ALLOWED_CURRENT_DISCOVERY_FORMATS = new Set([
  'spar',
  'eurospar',
  'interspar',
]);

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

function isFullCrawlBoundedSource(source = {}) {
  const sourceKey = deriveSourceKey(source);
  const sourceRetailerFormat = String(source.sourceRetailerFormat || source.retailerKey || '').toLowerCase();
  const isAllowedSparFamilyCurrentDiscovery = source?.crawlPolicy?.currentDiscovery === true
    && source.parserHint === 'spar-family-flyer-discovery'
    && source.channel === 'official-flyer'
    && FULL_CRAWL_ALLOWED_CURRENT_DISCOVERY_FORMATS.has(sourceRetailerFormat);

  if (isAllowedSparFamilyCurrentDiscovery) {
    return false;
  }

  return (
    FULL_CRAWL_BOUNDED_SOURCE_KEYS.has(sourceKey)
    || source?.crawlPolicy?.fullCrawlDisabled === true
    || source?.crawlPolicy?.scopedOnly === true
  );
}

function buildSourceProgress(source = {}, index = 0, total = 0, startedAt = new Date()) {
  return {
    sourceIndex: index,
    sourceCount: total,
    currentSourceKey: deriveSourceKey(source),
    currentSourceId: sourceIdString(source),
    currentRetailerKey: source.retailerKey || '',
    currentSourceChannel: source.channel || '',
    currentSourceType: source.sourceType || '',
    currentSourceUrl: source.sourceUrl || '',
    currentSourceStartedAt: startedAt,
  };
}

function buildBoundedSourceResult(sourceSummary = {}, source = {}) {
  return {
    ...sourceSummary,
    retailerKey: source.retailerKey || sourceSummary.retailerKey,
    retailerName: source.retailerName || sourceSummary.retailerName,
    channel: source.channel || sourceSummary.channel,
    sourceType: source.sourceType || sourceSummary.sourceType || '',
    sourceUrl: source.sourceUrl || sourceSummary.sourceUrl,
    offersStored: 0,
    discoveredLinks: 0,
    foundRawItems: 0,
    parsedOffers: 0,
    rejectedOffers: 0,
    status: 'skipped',
    skipped: true,
    skippedReason: 'full-crawl-scoped-only-source',
    message: 'Source is scoped-only for crawl reliability and was not executed in full crawl.',
    error: '',
    failureStage: 'source-bounded-before-execution',
    httpStatus: null,
    contentType: '',
    finalUrl: source.sourceUrl || sourceSummary.sourceUrl,
    diagnostic: {
      failureStage: 'source-bounded-before-execution',
      sourceKey: sourceSummary.sourceKey,
      sourceId: sourceSummary.sourceId,
      sourceUrl: source.sourceUrl || sourceSummary.sourceUrl,
      boundedReason: 'full-crawl-scoped-only-source',
      notExecutedByPolicy: true,
      policyBounded: true,
    },
  };
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

async function createBoundedSourceJob({
  CrawlJobModel = CrawlJob,
  source = {},
  sourceSummary = summarizeSource(source),
  crawlRunId = null,
  trigger = 'manual',
  region = '',
  now = new Date(),
} = {}) {
  if (!CrawlJobModel || typeof CrawlJobModel.create !== 'function' || !crawlRunId || !sourceSummary.sourceId) {
    return { skipped: true };
  }

  return CrawlJobModel.create({
    crawlRunId,
    sourceId: source._id || source.id || sourceSummary.sourceId,
    retailerKey: source.retailerKey || sourceSummary.retailerKey,
    region,
    trigger,
    status: 'skipped',
    startedAt: now,
    finishedAt: now,
    sourceType: source.sourceType || source.channel || sourceSummary.sourceType || '',
    sourceUrl: source.sourceUrl || sourceSummary.sourceUrl,
    stats: {
      errors: 0,
      warnings: 1,
      rawCandidates: 0,
      offersStored: 0,
      rejected: 0,
    },
    errorMessages: [],
    warningMessages: ['Source was bounded before execution so the full CrawlRun can terminalize.'],
    metadata: {
      sourceLabel: source.label || sourceSummary.label || '',
      sourceUrl: source.sourceUrl || sourceSummary.sourceUrl,
      sourceKey: sourceSummary.sourceKey,
      boundedSource: {
        boundedAt: now,
        reason: 'full-crawl-scoped-only-source',
        failureStage: 'source-bounded-before-execution',
        notExecutedByPolicy: true,
        policyBounded: true,
      },
    },
  });
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
  runSourceInChildProcessImpl = runSourceInChildProcess,
  sourceIsolation = true,
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

  sourceCoverage.requiredForScheduledHealthSources = selection.sources
    .filter((source) => getScheduledHealthPolicy(source).requiredForScheduledHealth === true)
    .length;

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

  const useIsolatedSourceRunner = sourceIsolation !== false && crawlSourceImpl === crawlSource;

  for (const [index, source] of prioritizedSources.entries()) {
    const sourceSummary = summarizeSource(source);
    const currentSourceStartedAt = new Date();

    try {
      const timeoutMs = sourceTimeoutMs(source);
      await reportCrawlProgress(onProgress, {
        stage: 'source-started',
        ...buildSourceProgress(source, index + 1, prioritizedSources.length, currentSourceStartedAt),
        timeoutMs,
      });

      if (!sourceSelectionRequested && isFullCrawlBoundedSource(source)) {
        await createBoundedSourceJob({
          CrawlJobModel,
          source,
          sourceSummary,
          crawlRunId,
          trigger,
          region,
          now: currentSourceStartedAt,
        });
        const boundedResult = buildBoundedSourceResult(sourceSummary, source);
        results.push(boundedResult);
        await reportCrawlProgress(onProgress, {
          stage: 'source-finished',
          ...buildSourceProgress(source, index + 1, prioritizedSources.length, currentSourceStartedAt),
          sourceStatus: 'skipped',
          failureStage: boundedResult.failureStage,
          warning: boundedResult.message,
          finishedSourceCount: results.length,
        });
        continue;
      }

      const result = useIsolatedSourceRunner
        ? await runSourceInChildProcessImpl({
          source,
          region,
          trigger,
          crawlRunId,
          timeoutMs,
        })
        : await withSourceTimeout(
          ({ signal }) => crawlSourceImpl({ source, region, trigger, crawlRunId, signal }),
          { source, timeoutMs }
        );
      results.push({
        ...sourceSummary,
        ...result,
        status: result.status || 'success',
      });
      await reportCrawlProgress(onProgress, {
        stage: 'source-finished',
        ...buildSourceProgress(source, index + 1, prioritizedSources.length, currentSourceStartedAt),
        sourceStatus: result.status || 'success',
        finishedSourceCount: results.length,
      });
    } catch (error) {
      const diagnostic = {
        ...(error.diagnostic || {}),
        sourceKey: error.diagnostic?.sourceKey || sourceSummary.sourceKey,
        sourceId: error.diagnostic?.sourceId || sourceSummary.sourceId,
      };
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
      await reportCrawlProgress(onProgress, {
        stage: 'source-finished',
        ...buildSourceProgress(source, index + 1, prioritizedSources.length, currentSourceStartedAt),
        sourceStatus: 'failed',
        failureStage: diagnostic.failureStage || 'fetch',
        error: error.message,
        finishedSourceCount: results.length,
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
    FULL_CRAWL_BOUNDED_SOURCE_KEYS,
    buildBoundedSourceResult,
    createSourceTimeoutError,
    createBoundedSourceJob,
    isSourceTimeoutError,
    isFullCrawlBoundedSource,
    markRunningSourceJobTimedOut,
    buildSourceProgress,
    sourceTimeoutMs,
    withSourceTimeout,
  },
};
