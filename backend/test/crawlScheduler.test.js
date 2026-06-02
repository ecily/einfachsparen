const assert = require('node:assert/strict');
const test = require('node:test');

const {
  executeScheduledCrawl,
  startCrawlScheduler,
  _private,
} = require('../src/services/crawl/crawlScheduler');

function env(overrides = {}) {
  return {
    NODE_ENV: 'test',
    CRAWL_REGION: 'Steiermark',
    CRAWL_RUN_ON_START: false,
    CRAWL_SCHEDULE_ENABLED: false,
    CRAWL_SCHEDULE_CRON: '0 2 * * *',
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

test('scheduler registers exactly one 02:00 Europe/Vienna cron job when enabled', () => {
  const cronCalls = [];
  const handle = startCrawlScheduler({
    envConfig: env({ CRAWL_SCHEDULE_ENABLED: true }),
    crawlRunServiceImpl: service([]),
    cronImpl: {
      validate(expression) {
        assert.equal(expression, '0 2 * * *');
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
  assert.equal(cronCalls[0][0], '0 2 * * *');
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

test('scheduler startup runs interrupted CrawlRun recovery without starting replacement crawl', async () => {
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

test('scheduler periodically retries interrupted CrawlRun recovery for fresh restart orphans', async () => {
  const recoveryCalls = [];
  const intervals = [];
  const intervalHandle = { unrefCalled: false, unref() { this.unrefCalled = true; } };

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
  });

  assert.equal(handle, intervalHandle);
  assert.equal(intervalHandle.unrefCalled, true);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].intervalMs, 120000);

  intervals[0].callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(recoveryCalls.length, 1);
  assert.match(recoveryCalls[0].reason, /periodic recovery/i);
});

test('scheduler startup recovery helper tolerates services without recovery support', () => {
  assert.equal(_private.recoverInterruptedCrawlRunsOnSchedulerStart({
    crawlRunServiceImpl: {},
  }), null);
});
