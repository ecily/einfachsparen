const app = require('./app');
const env = require('./config/env');
const { connectToDatabase } = require('./config/mongodb');
const { ensureSourceRegistry } = require('./services/sources/sourceRegistry');
const { startCrawlScheduler } = require('./services/crawl/crawlScheduler');
const logger = require('./lib/logger');

async function start() {
  await connectToDatabase();
  await ensureSourceRegistry();

  app.listen(env.PORT, () => {
    logger.info('Backend listening', {
      port: env.PORT,
      region: env.CRAWL_REGION,
      environment: env.NODE_ENV,
    });
  });

  startCrawlScheduler();
}

start().catch((error) => {
  logger.error('Failed to start backend', { message: error.message, stack: error.stack });
  process.exit(1);
});
