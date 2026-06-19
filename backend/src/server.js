const app = require('./app');
const env = require('./config/env');
const mongoose = require('mongoose');
const { connectToDatabase } = require('./config/mongodb');
const { ensureSourceRegistry } = require('./services/sources/sourceRegistry');
const { startCrawlScheduler } = require('./services/crawl/crawlScheduler');
const { interruptCurrentProcessCrawlRuns } = require('./services/crawl/crawlRunService');
const {
  installProcessLifecycleDiagnostics,
  logBackendRuntimeStarted,
} = require('./services/runtime/runtimeDiagnostics');
const logger = require('./lib/logger');

const SHUTDOWN_TIMEOUT_MS = 8000;

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server || typeof server.close !== 'function') {
      resolve();
      return;
    }

    server.close(() => resolve());
  });
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({ timedOut: true, label });
      }, timeoutMs).unref?.();
    }),
  ]);
}

function installShutdownHandlers(server) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.warn('Backend shutdown started', { signal });

    try {
      const interruption = await withTimeout(
        interruptCurrentProcessCrawlRuns({
          signal,
          reason: 'Backend process received shutdown signal.',
        }),
        SHUTDOWN_TIMEOUT_MS,
        'crawl-run-interruption'
      );

      logger.warn('Backend shutdown CrawlRun interruption completed', {
        signal,
        interruption,
      });
    } catch (error) {
      logger.error('Backend shutdown CrawlRun interruption failed', {
        signal,
        message: error.message,
      });
    }

    try {
      await withTimeout(closeServer(server), 2000, 'server-close');
      await withTimeout(mongoose.disconnect(), 2000, 'mongo-disconnect');
    } catch (error) {
      logger.error('Backend shutdown cleanup failed', {
        signal,
        message: error.message,
      });
    } finally {
      process.exit(0);
    }
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

async function start() {
  installProcessLifecycleDiagnostics({ loggerImpl: logger });
  logBackendRuntimeStarted({ loggerImpl: logger });

  await connectToDatabase();
  await ensureSourceRegistry();

  const server = app.listen(env.PORT, () => {
    logger.info('Backend listening', {
      port: env.PORT,
      region: env.CRAWL_REGION,
      environment: env.NODE_ENV,
    });
  });

  installShutdownHandlers(server);
  startCrawlScheduler();
}

start().catch((error) => {
  logger.error('Failed to start backend', { message: error.message, stack: error.stack });
  process.exit(1);
});
