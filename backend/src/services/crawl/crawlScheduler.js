const env = require('../../config/env');
const logger = require('../../lib/logger');
const { crawlAllSources } = require('./crawlDispatcher');

let crawlInFlight = false;
let intervalHandle = null;

async function executeScheduledCrawl(trigger) {
  if (crawlInFlight) {
    logger.warn('Scheduled crawl skipped because another crawl is still running', { trigger });
    return;
  }

  crawlInFlight = true;

  try {
    const crawlResult = await crawlAllSources({
      region: env.CRAWL_REGION,
      trigger,
    });

    logger.info('Scheduled crawl completed', {
      trigger,
      retailers: crawlResult.sources.map((item) => ({
        retailerKey: item.retailerKey,
        channel: item.channel,
        offersStored: item.offersStored,
        evidenceMatched: item.evidenceMatched || 0,
      })),
      dedupe: crawlResult.dedupe,
    });
  } catch (error) {
    logger.error('Scheduled crawl failed', {
      trigger,
      message: error.message,
    });
  } finally {
    crawlInFlight = false;
  }
}

function startCrawlScheduler() {
  const intervalMs = env.CRAWL_INTERVAL_MINUTES * 60 * 1000;

  if (env.CRAWL_RUN_ON_START) {
    setTimeout(() => {
      executeScheduledCrawl('startup').catch(() => {});
    }, 1500);
  }

  intervalHandle = setInterval(() => {
    executeScheduledCrawl('scheduled').catch(() => {});
  }, intervalMs);

  logger.info('Crawl scheduler started', {
    runOnStart: env.CRAWL_RUN_ON_START,
    intervalMinutes: env.CRAWL_INTERVAL_MINUTES,
  });

  return intervalHandle;
}

module.exports = {
  startCrawlScheduler,
};
