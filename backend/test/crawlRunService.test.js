const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');

const {
  serializeCrawlRun,
  _private,
} = require('../src/services/crawl/crawlRunService');

test('determineMode marks full and scoped CrawlRuns correctly', () => {
  assert.equal(_private.determineMode({}), 'full');
  assert.equal(_private.determineMode({ retailerKeys: ['spar'] }), 'scoped');
  assert.equal(_private.determineMode({ sourceKeys: ['spar-official-flyer-pdf'] }), 'scoped');
  assert.equal(_private.determineMode({ sourceSelectionRequested: true }), 'scoped');
});

test('buildRunSummary aggregates source, retailer, type, dedupe and filter metadata inputs compactly', () => {
  const result = {
    sourceCoverage: {
      totalRegisteredSources: 5,
      activeEligibleSources: 3,
      disabledSourcesCount: 2,
    },
    matchedSources: [
      { sourceId: 's1', sourceKey: 'aktionsfinder-spar', retailerKey: 'spar', channel: 'aggregator', sourceType: 'aggregator' },
      { sourceId: 's2', sourceKey: 'lidl-official-flyer', retailerKey: 'lidl', channel: 'official-flyer', sourceType: 'flyer' },
    ],
    disabledSources: [{ sourceKey: 'marktguru-spar' }],
    sources: [
      {
        sourceId: 's1',
        sourceKey: 'aktionsfinder-spar',
        retailerKey: 'spar',
        channel: 'aggregator',
        sourceType: 'aggregator',
        status: 'success',
        foundRawItems: 12,
        parsedOffers: 10,
        offersStored: 10,
        rejectedOffers: 2,
      },
      {
        sourceId: 's2',
        sourceKey: 'lidl-official-flyer',
        retailerKey: 'lidl',
        channel: 'official-flyer',
        sourceType: 'flyer',
        status: 'failed',
        error: 'upstream timeout',
        failureStage: 'fetch',
        httpStatus: 403,
        contentType: 'text/html; charset=UTF-8',
        finalUrl: 'https://www.lidl.at/c/flugblatt/s10012330',
        diagnostic: {
          failureStage: 'fetch',
          httpStatus: 403,
          htmlTitle: 'Just a moment...',
          bodyPreview: 'challenge page',
          requestHeaders: {
            Authorization: 'Bearer secret',
            Cookie: 'session=secret',
            Accept: 'text/html',
          },
        },
      },
    ],
    filterMetadata: { ok: true, processedOffers: 120 },
  };

  const summary = _private.buildRunSummary(result);

  assert.equal(summary.summary.totalRegisteredSources, 5);
  assert.equal(summary.summary.activeEligibleSources, 3);
  assert.equal(summary.summary.matchedSourcesCount, 2);
  assert.equal(summary.summary.disabledSourcesCount, 1);
  assert.equal(summary.summary.failedSourcesCount, 1);
  assert.equal(summary.summary.successfulSourcesCount, 1);
  assert.equal(summary.summary.foundRawItemsTotal, 12);
  assert.equal(summary.summary.parsedOffersTotal, 10);
  assert.equal(summary.summary.offersStoredTotal, 10);
  assert.equal(summary.summary.rejectedOffersTotal, 2);
  assert.equal(summary.summary.processedOffers, 120);
  assert.equal(summary.perRetailer.find((item) => item.retailerKey === 'spar').offersStored, 10);
  assert.equal(summary.sourceTypes.find((item) => item.channel === 'aggregator').offersStored, 10);
  assert.equal(summary.sources[1].error, 'upstream timeout');
  assert.equal(summary.sources[1].failureStage, 'fetch');
  assert.equal(summary.sources[1].httpStatus, 403);
  assert.equal(summary.sources[1].diagnostic.htmlTitle, 'Just a moment...');
  assert.equal(summary.sources[1].diagnostic.requestHeaders.Authorization, '[redacted]');
  assert.equal(summary.sources[1].diagnostic.requestHeaders.Cookie, '[redacted]');
  assert.equal(summary.sources[1].diagnostic.requestHeaders.Accept, 'text/html');
});

test('determineFinalStatus is success only for complete successful crawl results', () => {
  assert.equal(_private.determineFinalStatus({
    mode: 'full',
    crawlResult: { filterMetadata: { ok: true } },
    summary: { matchedSourcesCount: 3, activeEligibleSources: 3, failedSourcesCount: 0, partialSourcesCount: 0 },
  }), 'success');

  assert.equal(_private.determineFinalStatus({
    mode: 'full',
    crawlResult: { filterMetadata: { ok: true } },
    summary: { matchedSourcesCount: 3, activeEligibleSources: 3, failedSourcesCount: 1, partialSourcesCount: 0 },
  }), 'partial');

  assert.equal(_private.determineFinalStatus({
    mode: 'full',
    crawlResult: { filterMetadata: { ok: false } },
    summary: { matchedSourcesCount: 3, activeEligibleSources: 3, failedSourcesCount: 0, partialSourcesCount: 0 },
  }), 'failed');

  assert.equal(_private.determineFinalStatus({
    mode: 'full',
    crawlResult: { filterMetadata: { ok: true } },
    summary: { matchedSourcesCount: 0, activeEligibleSources: 0, failedSourcesCount: 0, partialSourcesCount: 0 },
  }), 'skipped');

  assert.equal(_private.determineFinalStatus({
    mode: 'full',
    crawlResult: { filterMetadata: { ok: true } },
    summary: { matchedSourcesCount: 2, activeEligibleSources: 3, failedSourcesCount: 0, partialSourcesCount: 0 },
  }), 'partial');
});

test('serializeCrawlRun returns status payload without raw offers or raw documents', () => {
  const serialized = serializeCrawlRun({
    _id: { toString: () => '665000000000000000000010' },
    status: 'success',
    trigger: 'manual',
    mode: 'full',
    dryRun: false,
    region: 'Steiermark',
    startedAt: new Date('2026-05-10T00:00:00.000Z'),
    finishedAt: new Date('2026-05-10T00:01:00.000Z'),
    durationMs: 60000,
    summary: { matchedSourcesCount: 1 },
    result: {
      sources: [{
        sourceKey: 'spar',
        status: 'success',
        offersStored: 1,
        rawDocuments: [{ secret: 'nope' }],
        diagnostic: { bodyPreview: 'ok', apiKey: 'nope' },
      }],
      offers: [{ title: 'nope' }],
      dedupe: { duplicateGroups: 0 },
      filterMetadata: { ok: true },
      effectiveRetailerKeys: ['spar'],
      requestedSourceKeys: [],
      requestedSourceIds: [],
    },
  });

  assert.equal(serialized.id, '665000000000000000000010');
  assert.equal(serialized.startedAt, '2026-05-10T00:00:00.000Z');
  assert.equal(serialized.result.offers, undefined);
  assert.equal(serialized.result.sources[0].rawDocuments, undefined);
  assert.equal(serialized.result.sources[0].diagnostic.apiKey, '[redacted]');
});

test('serializeCrawlRun tolerates malformed compact source entries', () => {
  const serialized = serializeCrawlRun({
    _id: { toString: () => '665000000000000000000011' },
    status: 'failed',
    trigger: 'manual',
    mode: 'full',
    result: {
      sources: [null],
    },
  });

  assert.equal(serialized.result.sources.length, 1);
  assert.equal(serialized.result.sources[0].sourceKey, '');
  assert.equal(serialized.result.sources[0].status, 'success');
});

test('serializeCrawlRun sanitizes mixed result payloads for JSON responses', () => {
  const runId = new mongoose.Types.ObjectId();
  const sourceId = new mongoose.Types.ObjectId();
  const serialized = serializeCrawlRun({
    _id: runId,
    status: 'success',
    trigger: 'manual',
    mode: 'full',
    summary: { processedOffers: 12n },
    result: {
      sources: [{ sourceId, sourceKey: 'spar', status: 'success' }],
      dedupe: { duplicateGroups: 1n },
      filterMetadata: { ok: true, processedOffers: 12n },
    },
  });

  assert.equal(serialized.id, String(runId));
  assert.equal(serialized.result.sources[0].sourceId, String(sourceId));
  assert.equal(serialized.summary.processedOffers, 12);
  assert.equal(serialized.result.dedupe.duplicateGroups, 1);
  assert.equal(serialized.result.filterMetadata.processedOffers, 12);
  assert.doesNotThrow(() => JSON.stringify(serialized));
});

test('stale lock detection only recovers long-running stuck CrawlRuns', () => {
  const now = new Date('2026-05-10T20:00:00.000Z');

  assert.equal(_private.isRunStale({
    status: 'running',
    startedAt: new Date('2026-05-10T03:00:00.000Z'),
  }, now), false);

  assert.equal(_private.isRunStale({
    status: 'running',
    startedAt: new Date('2026-05-10T01:00:00.000Z'),
  }, now), true);
});

test('explicit stale recovery classifies active orphan runs conservatively', () => {
  const now = new Date(_private.PROCESS_STARTED_AT.getTime() + 60 * 60 * 1000);
  const staleRun = {
    _id: new mongoose.Types.ObjectId(),
    status: 'running',
    startedAt: new Date(now.getTime() - 60 * 60 * 1000),
  };
  const freshRun = {
    _id: new mongoose.Types.ObjectId(),
    status: 'running',
    startedAt: new Date(now.getTime() - 15 * 60 * 1000),
  };
  const otherRunLock = {
    runId: new mongoose.Types.ObjectId(),
    status: 'running',
    heartbeatAt: new Date(now.getTime() - 60 * 1000),
  };

  assert.deepEqual(_private.isRecoverableStaleRun({
    run: staleRun,
    lock: { runId: staleRun._id, status: 'running' },
    now,
    staleAfterMs: 30 * 60 * 1000,
  }).recoverable, true);

  assert.equal(_private.isRecoverableStaleRun({
    run: freshRun,
    lock: { runId: freshRun._id, status: 'running' },
    now,
    staleAfterMs: 30 * 60 * 1000,
  }).reason, 'not-stale-enough');

  assert.equal(_private.isRecoverableStaleRun({
    run: staleRun,
    lock: otherRunLock,
    now,
    staleAfterMs: 30 * 60 * 1000,
  }).reason, 'lock-owned-by-different-run');
});
