const mongoose = require('mongoose');
const env = require('../src/config/env');
const { connectToDatabase } = require('../src/config/mongodb');
const { ensureSourceRegistry } = require('../src/services/sources/sourceRegistry');
const { crawlAllSources } = require('../src/services/crawl/crawlDispatcher');

async function run() {
  await connectToDatabase();
  await ensureSourceRegistry();

  const result = await crawlAllSources({
    region: env.CRAWL_REGION,
    trigger: 'manual',
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        region: env.CRAWL_REGION,
        result,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error.message,
        stack: error.stack,
      },
      null,
      2
    )
  );

  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
