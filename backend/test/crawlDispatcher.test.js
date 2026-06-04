const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { crawlAllSources, _private } = require('../src/services/crawl/crawlDispatcher');

function makeSourceQuery(result) {
  return {
    maxTimeMS() {
      return this;
    },
    select() {
      return this;
    },
    sort() {
      return this;
    },
    async lean() {
      return result;
    },
  };
}

test('crawlAllSources times out a hanging source and continues the full crawl', async () => {
  const runId = new mongoose.Types.ObjectId();
  const hangingSourceId = new mongoose.Types.ObjectId();
  const successSourceId = new mongoose.Types.ObjectId();
  const sources = [
    {
      _id: hangingSourceId,
      active: true,
      enabled: true,
      retailerKey: 'test-a',
      retailerName: 'Test A',
      channel: 'official-site',
      sourceType: 'offers-page',
      sourceUrl: 'https://example.test/a',
      label: 'A hanging source',
      crawlPolicy: { sourceTimeoutMs: 20 },
    },
    {
      _id: successSourceId,
      active: true,
      enabled: true,
      retailerKey: 'test-b',
      retailerName: 'Test B',
      channel: 'official-site',
      sourceType: 'offers-page',
      sourceUrl: 'https://example.test/b',
      label: 'B healthy source',
      crawlPolicy: { sourceTimeoutMs: 20 },
    },
  ];
  const timedOutJobs = [];
  const sourceCalls = [];
  const progressStages = [];

  const SourceModel = {
    async countDocuments(filter) {
      if (filter?.enabled === false) return 0;
      return sources.length;
    },
    find(filter = {}) {
      return makeSourceQuery(filter?.enabled === false ? [] : sources);
    },
  };
  const OfferModel = {
    async aggregate() {
      return [];
    },
  };
  const CrawlJobModel = {
    async updateOne(filter, update) {
      timedOutJobs.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };

  const result = await crawlAllSources({
    region: 'AT',
    trigger: 'scheduled',
    crawlRunId: runId,
    SourceModel,
    OfferModel,
    CrawlJobModel,
    async crawlSourceImpl({ source, signal }) {
      sourceCalls.push({ source, signal });
      if (source._id === hangingSourceId) {
        return new Promise(() => {});
      }
      return {
        sourceId: String(source._id),
        retailerKey: source.retailerKey,
        retailerName: source.retailerName,
        channel: source.channel,
        sourceType: source.sourceType,
        status: 'success',
        foundRawItems: 1,
        parsedOffers: 1,
        offersStored: 1,
      };
    },
    async dedupeOffersAcrossSourcesImpl() {
      return { duplicateGroups: 0, removedOffers: 0 };
    },
    async rebuildFilterMetadataImpl() {
      return { ok: true, processedOffers: 1 };
    },
    clearRankingResponseCacheImpl() {},
    async ensureManualCategoryOverrideCacheLoadedImpl() {},
    onProgress(progress) {
      progressStages.push(progress.stage);
    },
  });

  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].status, 'failed');
  assert.equal(result.sources[0].failureStage, 'source-timeout');
  assert.match(result.sources[0].error, /timed out/i);
  assert.equal(result.sources[1].status, 'success');
  assert.equal(sourceCalls.length, 2);
  assert.equal(sourceCalls[0].signal.aborted, true);
  assert.equal(timedOutJobs.length, 1);
  assert.deepEqual(timedOutJobs[0].filter, {
    crawlRunId: runId,
    sourceId: hangingSourceId,
    status: 'running',
  });
  assert.equal(timedOutJobs[0].update.$set.status, 'failed');
  assert.equal(timedOutJobs[0].update.$set.sourceUrl, 'https://example.test/a');
  assert.match(timedOutJobs[0].update.$push.errorMessages, /timed out/i);
  assert.ok(progressStages.includes('source-started'));
  assert.ok(progressStages.includes('source-finished'));
  assert.ok(progressStages.includes('source-jobs-finished'));
  assert.equal(result.filterMetadata.ok, true);
});

test('crawlAllSources records current source progress before awaiting an isolated source', async () => {
  const runId = new mongoose.Types.ObjectId();
  const sourceId = new mongoose.Types.ObjectId();
  const sources = [{
    _id: sourceId,
    active: true,
    enabled: true,
    retailerKey: 'billa',
    retailerName: 'BILLA',
    channel: 'official-site',
    sourceType: 'offers-page',
    sourceUrl: 'https://www.billa.at/unsere-aktionen/aktionen',
    label: 'BILLA Aktionen',
  }];
  const progress = [];

  const result = await crawlAllSources({
    region: 'AT',
    trigger: 'scheduled',
    crawlRunId: runId,
    SourceModel: {
      async countDocuments() {
        return sources.length;
      },
      find() {
        return makeSourceQuery(sources);
      },
    },
    OfferModel: {
      async aggregate() {
        return [];
      },
    },
    async runSourceInChildProcessImpl({ source, timeoutMs }) {
      assert.equal(source._id, sourceId);
      assert.equal(timeoutMs, _private.DEFAULT_SOURCE_TIMEOUT_MS);
      assert.equal(progress.at(-1).stage, 'source-started');
      assert.equal(progress.at(-1).currentSourceKey, 'billa-official-site-offers-page');
      return {
        sourceId: String(sourceId),
        retailerKey: 'billa',
        retailerName: 'BILLA',
        channel: 'official-site',
        sourceType: 'offers-page',
        status: 'success',
        foundRawItems: 1,
        parsedOffers: 1,
        offersStored: 1,
      };
    },
    async dedupeOffersAcrossSourcesImpl() {
      return { duplicateGroups: 0, removedOffers: 0 };
    },
    async rebuildFilterMetadataImpl() {
      return { ok: true, processedOffers: 1 };
    },
    clearRankingResponseCacheImpl() {},
    async ensureManualCategoryOverrideCacheLoadedImpl() {},
    onProgress(marker) {
      progress.push(marker);
    },
  });

  const started = progress.find((item) => item.stage === 'source-started');
  const finished = progress.find((item) => item.stage === 'source-finished');

  assert.equal(result.sources[0].status, 'success');
  assert.equal(started.currentSourceId, String(sourceId));
  assert.equal(started.currentRetailerKey, 'billa');
  assert.equal(started.currentSourceUrl, 'https://www.billa.at/unsere-aktionen/aktionen');
  assert.ok(started.currentSourceStartedAt instanceof Date);
  assert.equal(finished.sourceStatus, 'success');
  assert.equal(finished.finishedSourceCount, 1);
});

test('crawlAllSources marks isolated source process timeout failed and continues', async () => {
  const runId = new mongoose.Types.ObjectId();
  const timedOutSourceId = new mongoose.Types.ObjectId();
  const okSourceId = new mongoose.Types.ObjectId();
  const sources = [
    {
      _id: timedOutSourceId,
      active: true,
      enabled: true,
      retailerKey: 'billa',
      retailerName: 'BILLA',
      channel: 'official-site',
      sourceType: 'offers-page',
      sourceUrl: 'https://www.billa.at/unsere-aktionen/aktionen',
      label: 'BILLA Aktionen',
      crawlPolicy: { sourceTimeoutMs: 250 },
    },
    {
      _id: okSourceId,
      active: true,
      enabled: true,
      retailerKey: 'billa-plus',
      retailerName: 'BILLA Plus',
      channel: 'official-flyer',
      sourceType: 'flyer',
      sourceUrl: 'https://www.billa.at/unsere-aktionen/flugblatt',
      label: 'BILLA PLUS Flugblatt',
      crawlPolicy: { sourceTimeoutMs: 250 },
    },
  ];
  const timedOutJobs = [];

  const result = await crawlAllSources({
    region: 'AT',
    trigger: 'scheduled',
    crawlRunId: runId,
    SourceModel: {
      async countDocuments(filter) {
        if (filter?.enabled === false) return 0;
        return sources.length;
      },
      find(filter = {}) {
        return makeSourceQuery(filter?.enabled === false ? [] : sources);
      },
    },
    OfferModel: {
      async aggregate() {
        return [];
      },
    },
    CrawlJobModel: {
      async updateOne(filter, update) {
        timedOutJobs.push({ filter, update });
        return { matchedCount: 0, modifiedCount: 0 };
      },
      async create(document) {
        timedOutJobs.push({ create: document });
        return document;
      },
    },
    async runSourceInChildProcessImpl({ source }) {
      if (source._id === timedOutSourceId) {
        const error = new Error('Crawl source process timed out after 250ms.');
        error.code = _private.SOURCE_TIMEOUT_ERROR_CODE;
        error.diagnostic = {
          failureStage: 'source-timeout',
          timeoutMs: 250,
        };
        throw error;
      }

      return {
        sourceId: String(okSourceId),
        retailerKey: source.retailerKey,
        retailerName: source.retailerName,
        channel: source.channel,
        sourceType: source.sourceType,
        status: 'success',
        foundRawItems: 1,
        parsedOffers: 1,
        offersStored: 1,
      };
    },
    async dedupeOffersAcrossSourcesImpl() {
      return { duplicateGroups: 0, removedOffers: 0 };
    },
    async rebuildFilterMetadataImpl() {
      return { ok: true, processedOffers: 1 };
    },
    clearRankingResponseCacheImpl() {},
    async ensureManualCategoryOverrideCacheLoadedImpl() {},
  });

  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].status, 'failed');
  assert.equal(result.sources[0].failureStage, 'source-timeout');
  assert.equal(result.sources[0].diagnostic.sourceKey, 'billa-official-site-offers-page');
  assert.equal(result.sources[1].status, 'success');
  assert.equal(timedOutJobs[0].filter.status, 'running');
  assert.equal(timedOutJobs[1].create.status, 'failed');
  assert.match(timedOutJobs[1].create.warningMessages[0], /timed out/i);
  assert.equal(result.filterMetadata.ok, true);
});

test('source timeout helper keeps configured source timeout bounded', () => {
  assert.equal(_private.sourceTimeoutMs({ crawlPolicy: { sourceTimeoutMs: 1 } }), 250);
  assert.equal(_private.sourceTimeoutMs({ crawlPolicy: { sourceTimeoutMs: 2000 } }), 2000);
  assert.equal(_private.sourceTimeoutMs({}), _private.DEFAULT_SOURCE_TIMEOUT_MS);
});
