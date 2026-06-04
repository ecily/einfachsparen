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
  assert.ok(progressStages.includes('source-jobs-finished'));
  assert.equal(result.filterMetadata.ok, true);
});

test('source timeout helper keeps configured source timeout bounded', () => {
  assert.equal(_private.sourceTimeoutMs({ crawlPolicy: { sourceTimeoutMs: 1 } }), 250);
  assert.equal(_private.sourceTimeoutMs({ crawlPolicy: { sourceTimeoutMs: 2000 } }), 2000);
  assert.equal(_private.sourceTimeoutMs({}), _private.DEFAULT_SOURCE_TIMEOUT_MS);
});
