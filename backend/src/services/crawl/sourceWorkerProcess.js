const mongoose = require('mongoose');
const env = require('../../config/env');
const { crawlSource } = require('./crawlDispatcher');

function serializeError(error) {
  return {
    message: error?.message || 'Unknown source worker error.',
    code: error?.code || '',
    stack: error?.stack || '',
    diagnostic: error?.diagnostic || {},
  };
}

async function runSourceWorker(message = {}) {
  await mongoose.connect(env.MONGODB_URI);

  try {
    const result = await crawlSource({
      source: message.source,
      region: message.region,
      trigger: message.trigger,
      crawlRunId: message.crawlRunId,
    });

    if (process.send) {
      process.send({ ok: true, result });
    }
  } finally {
    await mongoose.disconnect();
  }
}

process.once('message', (message) => {
  runSourceWorker(message).catch(async (error) => {
    try {
      await mongoose.disconnect();
    } catch (_) {
      // Ignore disconnect failures while reporting the original source error.
    }

    if (process.send) {
      process.send({ ok: false, error: serializeError(error) });
      return;
    }

    process.exitCode = 1;
  });
});
