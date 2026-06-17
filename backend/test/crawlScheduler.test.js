const assert = require('node:assert/strict');
const test = require('node:test');

const {
  executeScheduledCrawl,
  executeScheduledCrawlWithDeferredStartup,
  startCrawlScheduler,
  _private,
} = require('../src/services/crawl/crawlScheduler');
const { _private: crawlRunServicePrivate } = require('../src/services/crawl/crawlRunService');

function env(overrides = {}) {
  return {
    NODE_ENV: 'test',
    CRAWL_REGION: 'Steiermark',
    CRAWL_RUN_ON_START: false,
    CRAWL_SCHEDULE_ENABLED: false,
    CRAWL_SCHEDULE_CRON: '37 6 * * *',
    CRAWL_SCHEDULE_TIMEZONE: 'Europe/Vienna',
    CRAWL_INTERVAL_MINUTES: 360,
    ...overrides,
  };
}

function service(calls, startResult = null) {
  return {
    async startCrawlRun(payload) {
      calls.push(payload);
      return startResult || {
        accepted: true,
        alreadyRunning: false,
        run: { _id: 'run-1', status: 'queued', result: {} },
      };
    },
    serializeCrawlRun(run) {
      return run ? { id: String(run._id || ''), status: run.status || '' } : null;
    },
  };
}

function startupGraceError(retryAfterSeconds = 900) {
  const error = new Error('Crawl start blocked during startup grace period.');
  error.code = 'CRAWL_STARTUP_GRACE';
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

test('scheduler does not register a cron job when CRAWL_SCHEDULE_ENABLED is not true', () => {
  const calls = [];
  const cronCalls = [];
  const handle = startCrawlScheduler({
    envConfig: env(),
    crawlRunServiceImpl: service(calls),
    cronImpl: {
      validate() { return true; },
      schedule(...args) { cronCalls.push(args); },
    },
  });

  assert.equal(handle, null);
  assert.equal(calls.length, 0);
  assert.equal(cronCalls.length, 0);
});

test('scheduler registers exactly one quiet-window Europe/Vienna cron job when enabled', () => {
  const cronCalls = [];
  const handle = startCrawlScheduler({
    envConfig: env({ CRAWL_SCHEDULE_ENABLED: true }),
    crawlRunServiceImpl: service([]),
    cronImpl: {
      validate(expression) {
        assert.equal(expression, '37 6 * * *');
        return true;
      },
      schedule(...args) {
        cronCalls.push(args);
        return { task: 'scheduled' };
      },
    },
  });

  assert.deepEqual(handle, { task: 'scheduled' });
  assert.equal(cronCalls.length, 1);
  assert.equal(cronCalls[0][0], '37 6 * * *');
  assert.equal(cronCalls[0][2].timezone, 'Europe/Vienna');
});

test('scheduler uses configured 01:00 Europe/Vienna cron job when provided by env', () => {
  const cronCalls = [];
  const handle = startCrawlScheduler({
    envConfig: env({
      CRAWL_SCHEDULE_ENABLED: true,
      CRAWL_SCHEDULE_CRON: '0 1 * * *',
      CRAWL_SCHEDULE_TIMEZONE: 'Europe/Vienna',
    }),
    crawlRunServiceImpl: service([]),
    cronImpl: {
      validate(expression) {
        assert.equal(expression, '0 1 * * *');
        return true;
      },
      schedule(...args) {
        cronCalls.push(args);
        return { task: 'scheduled' };
      },
    },
  });

  assert.deepEqual(handle, { task: 'scheduled' });
  assert.equal(cronCalls.length, 1);
  assert.equal(cronCalls[0][0], '0 1 * * *');
  assert.equal(cronCalls[0][2].timezone, 'Europe/Vienna');
});

test('production scheduler normalizes risky Vienna cron jobs away from deploy window', () => {
  assert.deepEqual(_private.resolveDailySchedule(env({
    NODE_ENV: 'production',
    CRAWL_SCHEDULE_CRON: '0 1 * * *',
    CRAWL_SCHEDULE_TIMEZONE: 'Europe/Vienna',
  })), {
    cron: '37 6 * * *',
    timezone: 'Europe/Vienna',
    normalizedFrom: '0 1 * * *',
  });

  assert.deepEqual(_private.resolveDailySchedule(env({
    NODE_ENV: 'production',
    CRAWL_SCHEDULE_CRON: '0 2 * * *',
    CRAWL_SCHEDULE_TIMEZONE: 'Europe/Vienna',
  })), {
    cron: '37 6 * * *',
    timezone: 'Europe/Vienna',
    normalizedFrom: '0 2 * * *',
  });

  assert.deepEqual(_private.resolveDailySchedule(env({
    NODE_ENV: 'production',
    CRAWL_SCHEDULE_CRON: '0 4 * * *',
    CRAWL_SCHEDULE_TIMEZONE: 'Europe/Vienna',
  })), {
    cron: '37 6 * * *',
    timezone: 'Europe/Vienna',
    normalizedFrom: '0 4 * * *',
  });

  assert.deepEqual(_private.resolveDailySchedule(env({
    NODE_ENV: 'production',
    CRAWL_SCHEDULE_CRON: '0 6 * * *',
    CRAWL_SCHEDULE_TIMEZONE: 'Europe/Vienna',
  })), {
    cron: '37 6 * * *',
    timezone: 'Europe/Vienna',
    normalizedFrom: '0 6 * * *',
  });

  assert.equal(_private.resolveDailySchedule(env({
    NODE_ENV: 'test',
    CRAWL_SCHEDULE_CRON: '0 1 * * *',
    CRAWL_SCHEDULE_TIMEZONE: 'Europe/Vienna',
  })).cron, '0 1 * * *');
});

test('scheduled execution starts a full CrawlRun through CrawlRun service and skips parallel runs', async () => {
  const calls = [];
  const accepted = await executeScheduledCrawl({
    envConfig: env(),
    crawlRunServiceImpl: service(calls),
  });

  assert.equal(accepted.accepted, true);
  assert.equal(calls[0].trigger, 'scheduled');
  assert.deepEqual(calls[0].options, { dryRun: false });
  assert.equal(calls[0].region, 'Steiermark');
  assert.equal(calls[0].envConfig.CRAWL_REGION, 'Steiermark');

  const skipped = await executeScheduledCrawl({
    envConfig: env(),
    crawlRunServiceImpl: service([], {
      accepted: false,
      alreadyRunning: true,
      run: { _id: 'run-2', status: 'running', result: {} },
    }),
  });

  assert.equal(skipped.alreadyRunning, true);
});

test('scheduled execution during startup grace is deferred once without creating a failed CrawlRun', async () => {
  const calls = [];
  const timeouts = [];
  const result = await executeScheduledCrawlWithDeferredStartup({
    envConfig: env(),
    crawlRunServiceImpl: {
      async startCrawlRun(payload) {
        calls.push(payload);
        throw startupGraceError(5);
      },
      serializeCrawlRun() { return null; },
    },
    setTimeoutImpl(callback, delayMs) {
      timeouts.push({ callback, delayMs });
      return { unref() {} };
    },
  });

  assert.equal(result.accepted, false);
  assert.equal(result.deferred, true);
  assert.equal(result.reason, 'deferred_due_to_recent_startup');
  assert.equal(calls.length, 1);
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].delayMs, 6000);
});

test('scheduled execution after startup grace starts normally without deferral', async () => {
  const calls = [];
  const result = await executeScheduledCrawlWithDeferredStartup({
    envConfig: env(),
    crawlRunServiceImpl: service(calls),
    setTimeoutImpl() {
      throw new Error('unexpected timeout');
    },
  });

  assert.equal(result.accepted, true);
  assert.equal(calls.length, 1);
});

test('CRAWL_RUN_ON_START is separate from daily scheduler and is suppressed in production', () => {
  const cronCalls = [];
  const handle = startCrawlScheduler({
    envConfig: env({
      NODE_ENV: 'production',
      CRAWL_RUN_ON_START: true,
      CRAWL_SCHEDULE_ENABLED: false,
    }),
    crawlRunServiceImpl: service([]),
    cronImpl: {
      validate() { return true; },
      schedule(...args) { cronCalls.push(args); },
    },
  });

  assert.equal(handle, null);
  assert.equal(cronCalls.length, 0);
});

test('scheduler startup recovery does not start replacement when no candidate is recovered', async () => {
  const calls = [];
  const cronCalls = [];
  const recoveryCalls = [];
  const handle = startCrawlScheduler({
    envConfig: env({
      CRAWL_SCHEDULE_ENABLED: false,
    }),
    crawlRunServiceImpl: {
      async recoverInterruptedCrawlRunsAfterRestart(payload) {
        recoveryCalls.push(payload);
        return { recovered: [], skipped: [] };
      },
      async startCrawlRun(payload) {
        calls.push(payload);
        return {
          accepted: true,
          alreadyRunning: false,
          run: { _id: 'run-1', status: 'queued', result: {} },
        };
      },
      serializeCrawlRun(run) {
        return run ? { id: String(run._id || ''), status: run.status || '' } : null;
      },
    },
    cronImpl: {
      validate() { return true; },
      schedule(...args) { cronCalls.push(args); },
    },
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(handle, null);
  assert.equal(recoveryCalls.length, 1);
  assert.match(recoveryCalls[0].reason, /Scheduler startup/i);
  assert.equal(calls.length, 0);
  assert.equal(cronCalls.length, 0);
});

test('scheduler startup recovery plans exactly one deferred replacement for source-less scheduled restart', async () => {
  const replacementCalls = [];
  const recoveryCalls = [];
  const timeouts = [];

  const promise = _private.recoverInterruptedCrawlRunsOnSchedulerStart({
    envConfig: env(),
    crawlRunServiceImpl: {
      async recoverInterruptedCrawlRunsAfterRestart(payload) {
        recoveryCalls.push(payload);
        return {
          recovered: [
            {
              runId: 'original-run-1',
              trigger: 'scheduled',
              mode: 'full',
              dryRun: false,
              sourceLess: true,
              replacementCandidate: true,
            },
          ],
          skipped: [],
        };
      },
      async startScheduledReplacementCrawlRun(payload) {
        replacementCalls.push(payload);
        throw startupGraceError(10);
      },
    },
    setTimeoutImpl(callback, delayMs) {
      timeouts.push({ callback, delayMs });
      return { unref() {} };
    },
  });

  await promise;

  assert.equal(recoveryCalls.length, 1);
  assert.equal(replacementCalls.length, 1);
  assert.equal(replacementCalls[0].originalRunId, 'original-run-1');
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].delayMs, 11000);
});

test('scheduler startup recovery reconciles persisted replacement-required runs after a second restart', async () => {
  const replacementCalls = [];
  const pendingCalls = [];

  await _private.recoverInterruptedCrawlRunsOnSchedulerStart({
    envConfig: env(),
    crawlRunServiceImpl: {
      async recoverInterruptedCrawlRunsAfterRestart() {
        return { recovered: [], skipped: [] };
      },
      async findPendingScheduledReplacementCandidates() {
        pendingCalls.push(true);
        return [
          {
            runId: 'persisted-original-run',
            trigger: 'scheduled',
            mode: 'full',
            dryRun: false,
            sourceLess: true,
            replacementCandidate: true,
          },
        ];
      },
      async startScheduledReplacementCrawlRun(payload) {
        replacementCalls.push(payload);
        return {
          accepted: true,
          alreadyRunning: false,
          run: { _id: 'replacement-run', status: 'queued', result: {} },
        };
      },
    },
    setTimeoutImpl() {
      throw new Error('unexpected timeout');
    },
  });

  assert.equal(pendingCalls.length, 1);
  assert.equal(replacementCalls.length, 1);
  assert.equal(replacementCalls[0].originalRunId, 'persisted-original-run');
});

test('scheduler replacement reconciliation deduplicates active recovery and persisted pending candidates', async () => {
  const replacementCalls = [];

  await _private.reconcileScheduledReplacementCandidates({
    recoveryResult: {
      recovered: [
        {
          runId: 'same-original-run',
          replacementCandidate: true,
        },
      ],
    },
    envConfig: env(),
    crawlRunServiceImpl: {
      async findPendingScheduledReplacementCandidates() {
        return [
          {
            runId: 'same-original-run',
            replacementCandidate: true,
          },
        ];
      },
      async startScheduledReplacementCrawlRun(payload) {
        replacementCalls.push(payload);
        return {
          accepted: true,
          alreadyRunning: false,
          run: { _id: 'replacement-run', status: 'queued', result: {} },
        };
      },
    },
  });

  assert.equal(replacementCalls.length, 1);
});

test('scheduler replacement reconciliation ignores services without persisted pending support', async () => {
  const planned = await _private.reconcileScheduledReplacementCandidates({
    recoveryResult: { recovered: [] },
    envConfig: env(),
    crawlRunServiceImpl: {},
  });

  assert.deepEqual(planned, []);
});

test('deferred replacement planning is not duplicated for the same original run', async () => {
  const timeouts = [];
  const first = await _private.executeScheduledReplacementCrawlWithDeferredStartup({
    originalRunId: 'original-run-2',
    envConfig: env(),
    crawlRunServiceImpl: {
      async startScheduledReplacementCrawlRun() {
        throw startupGraceError(3);
      },
    },
    setTimeoutImpl(callback, delayMs) {
      timeouts.push({ callback, delayMs });
      return { unref() {} };
    },
  });
  const second = await _private.executeScheduledReplacementCrawlWithDeferredStartup({
    originalRunId: 'original-run-2',
    envConfig: env(),
    crawlRunServiceImpl: {
      async startScheduledReplacementCrawlRun() {
        throw startupGraceError(3);
      },
    },
    setTimeoutImpl(callback, delayMs) {
      timeouts.push({ callback, delayMs });
      return { unref() {} };
    },
  });

  assert.equal(first.replacementDeferred, true);
  assert.equal(second.replacementDeferred, true);
  assert.equal(first.deferredStart.scheduled, true);
  assert.equal(second.deferredStart.scheduled, false);
  assert.equal(second.deferredStart.reason, 'deferred-start-already-planned');
  assert.equal(timeouts.length, 1);
});

test('replacement candidate guard only accepts source-less scheduled full restart failures', () => {
  const base = {
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    status: 'failed',
    result: { sources: [] },
    summary: { successfulSourcesCount: 0, failedSourcesCount: 0 },
    metadata: {
      shutdown: { signal: 'process-restart-recovery' },
      progress: { stage: 'process-restart-recovery' },
    },
  };

  assert.equal(crawlRunServicePrivate.isSourceLessScheduledRestartRecoveryRun(base), true);
  assert.equal(crawlRunServicePrivate.isSourceLessScheduledRestartRecoveryRun({
    ...base,
    summary: { successfulSourcesCount: 1, failedSourcesCount: 0 },
  }), false);
  assert.equal(crawlRunServicePrivate.isSourceLessScheduledRestartRecoveryRun({
    ...base,
    summary: { successfulSourcesCount: 0, failedSourcesCount: 1 },
  }), false);
  assert.equal(crawlRunServicePrivate.isSourceLessScheduledRestartRecoveryRun({
    ...base,
    status: 'partial',
  }), false);
  assert.equal(crawlRunServicePrivate.isSourceLessScheduledRestartRecoveryRun({
    ...base,
    status: 'success',
  }), false);
  assert.equal(crawlRunServicePrivate.isSourceLessScheduledRestartRecoveryRun({
    ...base,
    trigger: 'manual',
  }), false);
});

test('replacement CrawlRun documents keep scheduled trigger and original run metadata', () => {
  const run = crawlRunServicePrivate.buildRunDocument({
    runId: '507f1f77bcf86cd799439011',
    trigger: 'scheduled',
    region: 'Steiermark',
    options: {
      dryRun: false,
      scheduledReplacement: {
        originalRunId: '507f1f77bcf86cd799439012',
        reason: 'eligible-source-less-scheduled-restart',
        plannedAt: new Date('2026-06-17T06:55:00.000Z'),
      },
    },
  });

  assert.equal(run.trigger, 'scheduled');
  assert.equal(run.mode, 'full');
  assert.equal(run.metadata.scheduledReplacement.originalRunId, '507f1f77bcf86cd799439012');
  assert.equal(run.metadata.scheduledReplacement.reason, 'eligible-source-less-scheduled-restart');
});

test('scheduler periodically retries interrupted CrawlRun recovery for fresh restart orphans', async () => {
  const recoveryCalls = [];
  const intervals = [];
  const timeouts = [];
  const intervalHandle = { type: 'interval', unrefCalled: false, unref() { this.unrefCalled = true; } };
  const timeoutHandle = { type: 'timeout', unrefCalled: false, unref() { this.unrefCalled = true; } };

  const handle = _private.scheduleInterruptedCrawlRunRecovery({
    envConfig: env({ CRAWL_RUN_STALE_HEARTBEAT_MINUTES: 2 }),
    crawlRunServiceImpl: {
      async recoverInterruptedCrawlRunsAfterRestart(payload) {
        recoveryCalls.push(payload);
        return { recovered: [], skipped: [] };
      },
    },
    setIntervalImpl(callback, intervalMs) {
      intervals.push({ callback, intervalMs });
      return intervalHandle;
    },
    setTimeoutImpl(callback, delayMs) {
      timeouts.push({ callback, delayMs });
      return timeoutHandle;
    },
  });

  assert.deepEqual(handle, { firstCheck: timeoutHandle, interval: intervalHandle });
  assert.equal(timeoutHandle.unrefCalled, true);
  assert.equal(intervalHandle.unrefCalled, true);
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].delayMs, 60000);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].intervalMs, 120000);

  timeouts[0].callback();
  intervals[0].callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(recoveryCalls.length, 2);
  assert.match(recoveryCalls[0].reason, /periodic recovery/i);
});

test('scheduler startup recovery helper tolerates services without recovery support', () => {
  assert.equal(_private.recoverInterruptedCrawlRunsOnSchedulerStart({
    crawlRunServiceImpl: {},
  }), null);
});
