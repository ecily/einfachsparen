const cron = require('node-cron');
const env = require('../../config/env');
const logger = require('../../lib/logger');
const crawlRunService = require('./crawlRunService');

const SAFE_PRODUCTION_DAILY_CRON = '37 6 * * *';
const RISKY_VIENNA_DAILY_CRONS = new Set(['0 1 * * *', '0 2 * * *', '0 4 * * *', '0 6 * * *']);
const DEFERRED_START_BUFFER_MS = 1000;
const deferredScheduledStarts = new Map();

function resolveDailySchedule(envConfig = env) {
  const cronExpression = String(envConfig.CRAWL_SCHEDULE_CRON || '').trim();
  const timezone = String(envConfig.CRAWL_SCHEDULE_TIMEZONE || '').trim();

  if (
    envConfig.NODE_ENV === 'production'
    && timezone === 'Europe/Vienna'
    && RISKY_VIENNA_DAILY_CRONS.has(cronExpression)
  ) {
    return {
      cron: SAFE_PRODUCTION_DAILY_CRON,
      timezone,
      normalizedFrom: cronExpression,
    };
  }

  return {
    cron: cronExpression,
    timezone,
    normalizedFrom: '',
  };
}

async function executeScheduledCrawl({ trigger = 'scheduled', envConfig = env, crawlRunServiceImpl = crawlRunService } = {}) {
  const result = await crawlRunServiceImpl.startCrawlRun({
    trigger,
    region: envConfig.CRAWL_REGION,
    options: {
      dryRun: false,
    },
    envConfig,
  });
  const run = crawlRunServiceImpl.serializeCrawlRun(result.run);

  if (result.alreadyRunning) {
    logger.warn('Scheduled crawl skipped because another CrawlRun is active', {
      trigger,
      runId: run?.id || '',
      status: run?.status || '',
    });
    return result;
  }

  logger.info('Scheduled crawl accepted', {
    trigger,
    runId: run?.id || '',
    status: run?.status || '',
  });

  return result;
}

function isStartupGraceError(error) {
  return error?.code === 'CRAWL_STARTUP_GRACE';
}

function retryDelayMsFromStartupGrace(error) {
  const retryAfterSeconds = Number(error?.retryAfterSeconds);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.ceil(retryAfterSeconds * 1000) + DEFERRED_START_BUFFER_MS;
  }
  return Math.max(60 * 1000, DEFERRED_START_BUFFER_MS);
}

function scheduleDeferredStart({
  key,
  delayMs,
  run,
  setTimeoutImpl = setTimeout,
} = {}) {
  const deferredKey = String(key || '').trim();

  if (!deferredKey || typeof run !== 'function') {
    return {
      scheduled: false,
      reason: 'invalid-deferred-start',
    };
  }

  if (deferredScheduledStarts.has(deferredKey)) {
    return {
      scheduled: false,
      reason: 'deferred-start-already-planned',
    };
  }

  const handle = setTimeoutImpl(async () => {
    deferredScheduledStarts.delete(deferredKey);
    try {
      await run();
    } catch (error) {
      logger.error('Deferred scheduled crawl failed', {
        key: deferredKey,
        message: error.message,
        code: error.code,
      });
    }
  }, Math.max(1000, Number(delayMs) || 0));

  if (handle && typeof handle.unref === 'function') {
    handle.unref();
  }

  deferredScheduledStarts.set(deferredKey, handle);

  return {
    scheduled: true,
    reason: 'deferred-start-planned',
    key: deferredKey,
    delayMs: Math.max(1000, Number(delayMs) || 0),
  };
}

async function executeScheduledCrawlWithDeferredStartup({
  trigger = 'scheduled',
  envConfig = env,
  crawlRunServiceImpl = crawlRunService,
  setTimeoutImpl = setTimeout,
  allowDefer = true,
} = {}) {
  try {
    return await executeScheduledCrawl({ trigger, envConfig, crawlRunServiceImpl });
  } catch (error) {
    if (!allowDefer || !isStartupGraceError(error)) {
      throw error;
    }

    const delayMs = retryDelayMsFromStartupGrace(error);
    const deferred = scheduleDeferredStart({
      key: `${trigger}:daily`,
      delayMs,
      setTimeoutImpl,
      run: () => executeScheduledCrawlWithDeferredStartup({
        trigger,
        envConfig,
        crawlRunServiceImpl,
        setTimeoutImpl,
        allowDefer: false,
      }),
    });

    logger.warn('Scheduled crawl deferred during backend startup grace period', {
      trigger,
      delayMs,
      deferred,
      retryAfterSeconds: error.retryAfterSeconds,
    });

    return {
      accepted: false,
      alreadyRunning: false,
      deferred: true,
      deferredStart: deferred,
      reason: 'deferred_due_to_recent_startup',
    };
  }
}

async function executeScheduledReplacementCrawlWithDeferredStartup({
  originalRunId,
  envConfig = env,
  crawlRunServiceImpl = crawlRunService,
  setTimeoutImpl = setTimeout,
  allowDefer = true,
} = {}) {
  if (typeof crawlRunServiceImpl.startScheduledReplacementCrawlRun !== 'function') {
    return {
      accepted: false,
      replacementSkipped: true,
      reason: 'replacement-start-not-supported',
    };
  }

  try {
    return await crawlRunServiceImpl.startScheduledReplacementCrawlRun({
      originalRunId,
      region: envConfig.CRAWL_REGION,
      envConfig,
    });
  } catch (error) {
    if (!allowDefer || !isStartupGraceError(error)) {
      throw error;
    }

    const delayMs = retryDelayMsFromStartupGrace(error);
    const deferred = scheduleDeferredStart({
      key: `scheduled-replacement:${originalRunId}`,
      delayMs,
      setTimeoutImpl,
      run: () => executeScheduledReplacementCrawlWithDeferredStartup({
        originalRunId,
        envConfig,
        crawlRunServiceImpl,
        setTimeoutImpl,
        allowDefer: false,
      }),
    });

    logger.warn('Scheduled replacement crawl deferred during backend startup grace period', {
      originalRunId,
      delayMs,
      deferred,
      retryAfterSeconds: error.retryAfterSeconds,
    });

    return {
      accepted: false,
      replacementDeferred: true,
      deferredStart: deferred,
      reason: 'replacement_deferred_due_to_recent_startup',
    };
  }
}

async function planRecoveredScheduledReplacements({
  recoveryResult,
  envConfig = env,
  crawlRunServiceImpl = crawlRunService,
  setTimeoutImpl = setTimeout,
} = {}) {
  const recovered = Array.isArray(recoveryResult?.recovered) ? recoveryResult.recovered : [];
  const planned = [];

  for (const item of recovered) {
    if (!item?.replacementCandidate || !item.runId) {
      continue;
    }

    try {
      const result = await executeScheduledReplacementCrawlWithDeferredStartup({
        originalRunId: item.runId,
        envConfig,
        crawlRunServiceImpl,
        setTimeoutImpl,
      });
      planned.push({
        originalRunId: item.runId,
        accepted: result.accepted === true,
        deferred: result.replacementDeferred === true,
        skipped: result.replacementSkipped === true,
        reason: result.reason || '',
      });
    } catch (error) {
      logger.error('Scheduled replacement crawl planning failed', {
        originalRunId: item.runId,
        message: error.message,
        code: error.code,
      });
      planned.push({
        originalRunId: item.runId,
        accepted: false,
        deferred: false,
        skipped: false,
        reason: error.code || error.message,
      });
    }
  }

  if (planned.length > 0) {
    logger.warn('Scheduled replacement crawl planning finished', { planned });
  }

  return planned;
}

async function findPendingScheduledReplacementItems({ crawlRunServiceImpl = crawlRunService } = {}) {
  if (typeof crawlRunServiceImpl.findPendingScheduledReplacementCandidates !== 'function') {
    return [];
  }

  return crawlRunServiceImpl.findPendingScheduledReplacementCandidates();
}

async function reconcileScheduledReplacementCandidates({
  recoveryResult,
  envConfig = env,
  crawlRunServiceImpl = crawlRunService,
  setTimeoutImpl = setTimeout,
} = {}) {
  const recovered = Array.isArray(recoveryResult?.recovered) ? recoveryResult.recovered : [];
  const pending = await findPendingScheduledReplacementItems({ crawlRunServiceImpl });
  const seen = new Set();
  const candidates = [];

  for (const item of [...recovered, ...pending]) {
    const runId = String(item?.runId || '');
    if (!runId || seen.has(runId)) {
      continue;
    }
    seen.add(runId);
    candidates.push(item);
  }

  return planRecoveredScheduledReplacements({
    recoveryResult: { recovered: candidates },
    envConfig,
    crawlRunServiceImpl,
    setTimeoutImpl,
  });
}

function scheduleStartupCrawl({ envConfig = env, crawlRunServiceImpl = crawlRunService } = {}) {
  if (!envConfig.CRAWL_RUN_ON_START) {
    return null;
  }

  if (envConfig.NODE_ENV === 'production') {
    logger.warn('CRAWL_RUN_ON_START is true in production; startup crawl suppressed for deploy safety.');
    return null;
  }

  return setTimeout(() => {
    executeScheduledCrawl({
      trigger: 'manual',
      envConfig,
      crawlRunServiceImpl,
    }).catch((error) => {
      logger.error('Startup crawl failed', {
        message: error.message,
      });
    });
  }, 1500);
}

function recoverInterruptedCrawlRunsOnSchedulerStart({
  envConfig = env,
  crawlRunServiceImpl = crawlRunService,
  setTimeoutImpl = setTimeout,
} = {}) {
  if (typeof crawlRunServiceImpl.recoverInterruptedCrawlRunsAfterRestart !== 'function') {
    return null;
  }

  return crawlRunServiceImpl.recoverInterruptedCrawlRunsAfterRestart({
    reason: 'Scheduler startup found an active CrawlRun from a previous process with a stale lock heartbeat.',
  }).then((result) => reconcileScheduledReplacementCandidates({
    recoveryResult: result,
    envConfig,
    crawlRunServiceImpl,
    setTimeoutImpl,
  })).catch((error) => {
    logger.error('Interrupted CrawlRun startup recovery failed', {
      message: error.message,
    });
  });
}

function scheduleInterruptedCrawlRunRecovery({
  envConfig = env,
  crawlRunServiceImpl = crawlRunService,
  setIntervalImpl = setInterval,
  setTimeoutImpl = setTimeout,
} = {}) {
  if (typeof crawlRunServiceImpl.recoverInterruptedCrawlRunsAfterRestart !== 'function') {
    return null;
  }

  const staleHeartbeatMinutes = Number(envConfig.CRAWL_RUN_STALE_HEARTBEAT_MINUTES || 15);
  const intervalMs = Math.max(60 * 1000, staleHeartbeatMinutes * 60 * 1000);
  const runRecovery = () => {
    crawlRunServiceImpl.recoverInterruptedCrawlRunsAfterRestart({
      reason: 'Scheduler periodic recovery found an active CrawlRun from a previous process with a stale lock heartbeat.',
    }).then((result) => reconcileScheduledReplacementCandidates({
      recoveryResult: result,
      envConfig,
      crawlRunServiceImpl,
      setTimeoutImpl,
    })).catch((error) => {
      logger.error('Interrupted CrawlRun periodic recovery failed', {
        message: error.message,
      });
    });
  };
  const firstCheck = setTimeoutImpl(runRecovery, 60 * 1000);
  const interval = setIntervalImpl(runRecovery, intervalMs);

  if (firstCheck && typeof firstCheck.unref === 'function') {
    firstCheck.unref();
  }
  if (interval && typeof interval.unref === 'function') {
    interval.unref();
  }

  return { firstCheck, interval };
}

function startCrawlScheduler({
  envConfig = env,
  crawlRunServiceImpl = crawlRunService,
  cronImpl = cron,
  setTimeoutImpl = setTimeout,
  setIntervalImpl = setInterval,
} = {}) {
  recoverInterruptedCrawlRunsOnSchedulerStart({ envConfig, crawlRunServiceImpl, setTimeoutImpl });
  scheduleInterruptedCrawlRunRecovery({ envConfig, crawlRunServiceImpl, setTimeoutImpl, setIntervalImpl });

  const startupHandle = scheduleStartupCrawl({ envConfig, crawlRunServiceImpl });
  const dailySchedule = resolveDailySchedule(envConfig);

  if (envConfig.CRAWL_SCHEDULE_ENABLED !== true) {
    logger.info('Daily crawl scheduler disabled', {
      scheduleEnabled: envConfig.CRAWL_SCHEDULE_ENABLED,
      runOnStart: envConfig.CRAWL_RUN_ON_START,
      legacyIntervalMinutes: envConfig.CRAWL_INTERVAL_MINUTES,
    });
    return startupHandle;
  }

  if (typeof cronImpl.validate === 'function' && !cronImpl.validate(dailySchedule.cron)) {
    logger.error('Daily crawl scheduler not started because cron expression is invalid', {
      cron: dailySchedule.cron,
      timezone: dailySchedule.timezone,
    });
    return startupHandle;
  }

  const task = cronImpl.schedule(
    dailySchedule.cron,
    () => {
      executeScheduledCrawlWithDeferredStartup({
        trigger: 'scheduled',
        envConfig,
        crawlRunServiceImpl,
        setTimeoutImpl,
      }).catch((error) => {
        logger.error('Scheduled crawl failed before CrawlRun acceptance', {
          message: error.message,
        });
      });
    },
    {
      timezone: dailySchedule.timezone,
    }
  );

  logger.info('Daily crawl scheduler started', {
    cron: dailySchedule.cron,
    timezone: dailySchedule.timezone,
    normalizedFrom: dailySchedule.normalizedFrom,
    runOnStart: envConfig.CRAWL_RUN_ON_START,
  });

  return task;
}

module.exports = {
  executeScheduledCrawl,
  executeScheduledCrawlWithDeferredStartup,
  startCrawlScheduler,
  _private: {
    executeScheduledReplacementCrawlWithDeferredStartup,
    findPendingScheduledReplacementItems,
    isStartupGraceError,
    planRecoveredScheduledReplacements,
    reconcileScheduledReplacementCandidates,
    recoverInterruptedCrawlRunsOnSchedulerStart,
    resolveDailySchedule,
    retryDelayMsFromStartupGrace,
    scheduleDeferredStart,
    scheduleInterruptedCrawlRunRecovery,
    scheduleStartupCrawl,
  },
};
