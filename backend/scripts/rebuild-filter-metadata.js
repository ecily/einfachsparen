const mongoose = require('mongoose');
const { connectToDatabase } = require('../src/config/mongodb');
const { rebuildFilterMetadata } = require('../src/services/filters/filterMetadataService');

async function run() {
  await connectToDatabase();

  try {
    const startedAt = Date.now();
    const result = await rebuildFilterMetadata({
      trigger: 'script',
      loggerContext: { invokedBy: 'backend/scripts/rebuild-filter-metadata.js' },
    });

    console.log(JSON.stringify({ ok: true, durationMs: Date.now() - startedAt, result }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
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
    mongoose.disconnect().finally(() => process.exit(1));
  });
