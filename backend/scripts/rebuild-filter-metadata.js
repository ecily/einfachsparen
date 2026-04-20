const mongoose = require('mongoose');
const { connectToDatabase } = require('../src/config/mongodb');
const { rebuildFilterMetadata } = require('../src/services/filters/filterMetadataService');

async function run() {
  await connectToDatabase();
  const result = await rebuildFilterMetadata({
    trigger: 'script',
    loggerContext: { invokedBy: 'backend/scripts/rebuild-filter-metadata.js' },
  });

  console.log(JSON.stringify({ ok: true, result }, null, 2));
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
