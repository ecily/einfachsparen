const mongoose = require('mongoose');
const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const {
  DEFAULT_EXAMPLE_LIMIT,
  DEFAULT_MAX_AGE_DAYS,
  runStaleAktionsfinderRepair,
} = require('../src/services/repairs/staleOfferRepair');

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    apply: false,
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    exampleLimit: DEFAULT_EXAMPLE_LIMIT,
    retailerKeys: [],
    sourceKeys: [],
    titleIncludes: '',
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    const [rawKey, ...rest] = String(arg || '').split('=');
    const value = rest.join('=').trim();
    const key = rawKey.replace(/^--/, '');

    if (key === 'max-age-days') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.maxAgeDays = parsed;
      }
    } else if (key === 'limit') {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 100) {
        options.exampleLimit = parsed;
      }
    } else if (key === 'retailerKey' || key === 'retailerKeys') {
      options.retailerKeys = value.split(',').map((item) => item.trim()).filter(Boolean);
    } else if (key === 'sourceKey' || key === 'sourceKeys') {
      options.sourceKeys = value.split(',').map((item) => item.trim()).filter(Boolean);
    } else if (key === 'titleIncludes') {
      options.titleIncludes = value;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  await connectToDatabase();

  const result = await runStaleAktionsfinderRepair({
    OfferModel: Offer,
    SourceModel: Source,
    apply: options.apply,
    maxAgeDays: options.maxAgeDays,
    exampleLimit: options.exampleLimit,
    retailerKeys: options.retailerKeys,
    sourceKeys: options.sourceKeys,
    titleIncludes: options.titleIncludes,
  });

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    repair: 'stale-aktionsfinder-offers',
    mutationRequiresApplyFlag: true,
    ...result,
  }, null, 2));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        dryRun: !process.argv.includes('--apply'),
        error: error?.name || 'Error',
        message: error?.message || 'Stale Aktionsfinder repair failed.',
      }, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  parseArgs,
};
