const cron = require('node-cron');
const env = require('../../config/env');
const logger = require('../../lib/logger');
const crawlRunService = require('./crawlRunService');

async function executeScheduledCrawl({ trigger = 'scheduled', envConfig = env, crawlRunServiceImpl = crawlRunService } = {}) {
  const result = await crawlRunServiceImpl.startCrawlRun({
    trigger,
    region: envConfig.CRAWL_REGION,
    options: {
      dryRun: false,
    },
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

function recoverInterruptedCrawlRunsOnSchedulerStart({ crawlRunServiceImpl = crawlRunService } = {}) {
  if (typeof crawlRunServiceImpl.recoverInterruptedCrawlRunsAfterRestart !== 'function') {
    return null;
  }

  return crawlRunServiceImpl.recoverInterruptedCrawlRunsAfterRestart({
    reason: 'Scheduler startup found an active CrawlRun from a previous process with a stale lock heartbeat.',
  }).catch((error) => {
    logger.error('Interrupted CrawlRun startup recovery failed', {
      message: error.message,
    });
  });
}

function startCrawlScheduler({
  envConfig = env,
  crawlRunServiceImpl = crawlRunService,
  cronImpl = cron,
} = {}) {
  recoverInterruptedCrawlRunsOnSchedulerStart({ crawlRunServiceImpl });

  const startupHandle = scheduleStartupCrawl({ envConfig, crawlRunServiceImpl });

  if (envConfig.CRAWL_SCHEDULE_ENABLED !== true) {
    logger.info('Daily crawl scheduler disabled', {
      scheduleEnabled: envConfig.CRAWL_SCHEDULE_ENABLED,
      runOnStart: envConfig.CRAWL_RUN_ON_START,
      legacyIntervalMinutes: envConfig.CRAWL_INTERVAL_MINUTES,
    });
    return startupHandle;
  }

  if (typeof cronImpl.validate === 'function' && !cronImpl.validate(envConfig.CRAWL_SCHEDULE_CRON)) {
    logger.error('Daily crawl scheduler not started because cron expression is invalid', {
      cron: envConfig.CRAWL_SCHEDULE_CRON,
      timezone: envConfig.CRAWL_SCHEDULE_TIMEZONE,
    });
    return startupHandle;
  }

  const task = cronImpl.schedule(
    envConfig.CRAWL_SCHEDULE_CRON,
    () => {
      executeScheduledCrawl({
        trigger: 'scheduled',
        envConfig,
        crawlRunServiceImpl,
      }).catch((error) => {
        logger.error('Scheduled crawl failed before CrawlRun acceptance', {
          message: error.message,
        });
      });
    },
    {
      timezone: envConfig.CRAWL_SCHEDULE_TIMEZONE,
    }
  );

  logger.info('Daily crawl scheduler started', {
    cron: envConfig.CRAWL_SCHEDULE_CRON,
    timezone: envConfig.CRAWL_SCHEDULE_TIMEZONE,
    runOnStart: envConfig.CRAWL_RUN_ON_START,
  });

  return task;
}

module.exports = {
  executeScheduledCrawl,
  startCrawlScheduler,
  _private: {
    recoverInterruptedCrawlRunsOnSchedulerStart,
    scheduleStartupCrawl,
  },
};
