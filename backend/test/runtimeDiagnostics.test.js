const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCrawlRuntimePayload,
  buildMemorySnapshot,
  buildRuntimeSnapshot,
  serializeErrorForRuntimeLog,
} = require('../src/services/runtime/runtimeDiagnostics');

test('buildMemorySnapshot exposes only numeric process memory fields', () => {
  const snapshot = buildMemorySnapshot({
    rss: 100,
    heapTotal: 80,
    heapUsed: 40,
    external: 12,
    arrayBuffers: 6,
    ignored: 'secret',
  });

  assert.deepEqual(snapshot, {
    rss: 100,
    heapTotal: 80,
    heapUsed: 40,
    external: 12,
    arrayBuffers: 6,
  });
});

test('buildRuntimeSnapshot includes safe process lifecycle metadata', () => {
  const snapshot = buildRuntimeSnapshot({
    env: { NODE_ENV: 'production' },
    buildInfo: {
      nodeEnv: 'production',
      buildTime: '2026-06-19T06:00:00.000Z',
      processStartedAt: '2026-06-19T05:59:00.000Z',
      commitShort: 'abc123',
    },
    pid: 1234,
    uptimeSeconds: 42.4,
    memoryUsage: {
      rss: 100,
      heapTotal: 80,
      heapUsed: 40,
      external: 12,
      arrayBuffers: 6,
    },
  });

  assert.equal(snapshot.pid, 1234);
  assert.equal(snapshot.uptimeSeconds, 42);
  assert.equal(snapshot.nodeEnv, 'production');
  assert.equal(snapshot.buildTime, '2026-06-19T06:00:00.000Z');
  assert.equal(snapshot.processStartedAt, '2026-06-19T05:59:00.000Z');
  assert.equal(snapshot.commitShort, 'abc123');
  assert.equal(snapshot.memoryUsage.heapUsed, 40);
});

test('buildCrawlRuntimePayload picks only safe crawl progress fields', () => {
  const payload = buildCrawlRuntimePayload({
    runId: '6a34cb9d935027be0402b516',
    trigger: 'scheduled',
    event: 'progress',
    progress: {
      stage: 'source-started',
      currentSourceKey: 'penny-official-site',
      currentSourceId: 'source-id',
      currentRetailerKey: 'penny',
      sourceIndex: 20,
      sourceCount: 34,
      currentSourceStartedAt: '2026-06-19T04:56:00.662Z',
      authorization: 'should-not-leak',
      token: 'should-not-leak',
    },
  });

  assert.equal(payload.runId, '6a34cb9d935027be0402b516');
  assert.equal(payload.trigger, 'scheduled');
  assert.equal(payload.progressStage, 'source-started');
  assert.equal(payload.currentSourceKey, 'penny-official-site');
  assert.equal(payload.currentSourceIndex, 20);
  assert.equal(payload.currentSourceCount, 34);
  assert.equal(payload.authorization, undefined);
  assert.equal(payload.token, undefined);
  assert.doesNotMatch(JSON.stringify(payload), /should-not-leak/);
  assert.equal(typeof payload.runtime.pid, 'number');
  assert.equal(typeof payload.runtime.memoryUsage.rss, 'number');
});

test('serializeErrorForRuntimeLog compacts error diagnostics', () => {
  const error = new Error('runtime failed');
  error.code = 'RUNTIME_FAIL';
  const serialized = serializeErrorForRuntimeLog(error);

  assert.equal(serialized.name, 'Error');
  assert.equal(serialized.code, 'RUNTIME_FAIL');
  assert.equal(serialized.message, 'runtime failed');
  assert.match(serialized.stack, /runtime failed/);
});
