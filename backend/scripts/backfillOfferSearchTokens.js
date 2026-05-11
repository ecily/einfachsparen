const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const {
  parseBackfillArgs,
  runOfferSearchTokenBackfill,
} = require('../src/services/offers/offerSearchTokenBackfill');

async function run() {
  const options = parseBackfillArgs(process.argv.slice(2));

  await connectToDatabase();

  const report = await runOfferSearchTokenBackfill(options);

  console.log(JSON.stringify({
    ok: true,
    readOnly: !options.apply,
    ...report,
  }, null, 2));
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        readOnly: !process.argv.slice(2).includes('--apply'),
        message: error.message,
      }, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  run,
};
