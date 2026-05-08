const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const {
  TARGET_RETAILERS,
  buildRetailerReadinessDiagnostic,
} = require('../src/services/diagnostics/retailerReadinessDiagnostic');

const DEFAULT_LIMIT = 20000;

function parseArgs(argv = []) {
  const options = {
    limit: DEFAULT_LIMIT,
  };

  for (const arg of argv) {
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));

      if (Number.isInteger(value) && value >= 100 && value <= 100000) {
        options.limit = value;
      }
    }
  }

  return options;
}

async function fetchReadOnlyContext({ limit = DEFAULT_LIMIT } = {}) {
  const now = new Date();
  const retailerKeys = TARGET_RETAILERS.map((retailer) => retailer.retailerKey);
  const offers = await Offer.find({
    retailerKey: { $in: retailerKeys },
    $or: [
      { isActiveNow: true },
      { isActiveToday: true },
      {
        status: 'active',
        $or: [
          { validTo: { $gte: now } },
          { validTo: null },
        ],
      },
    ],
  })
    .sort({ retailerKey: 1, isActiveNow: -1, sortScoreDefault: -1, titleNormalized: 1 })
    .limit(limit)
    .select([
      '_id',
      'sourceId',
      'retailerKey',
      'retailerName',
      'sourceRetailerName',
      'sourceRetailerFormat',
      'retailerFormats',
      'appliesToRetailerFormats',
      'retailerFormatLabel',
      'sourceType',
      'sourceTypes',
      'sourceUrl',
      'sourceConfidence',
      'title',
      'titleNormalized',
      'categoryPrimary',
      'categorySecondary',
      'categoryKey',
      'subcategoryKey',
      'comparisonSignature',
      'comparisonGroup',
      'dedupeKey',
      'offerKey',
      'validFrom',
      'validTo',
      'status',
      'isActiveNow',
      'isActiveToday',
      'quantityText',
      'unitValue',
      'unitType',
      'normalizedUnitPrice',
      'quality',
      'conditionsText',
      'customerProgramRequired',
      'hasConditions',
      'isMultiBuy',
      'minimumPurchaseQty',
      'priceCurrent',
      'rawFacts',
    ].join(' '))
    .lean();

  const sources = await Source.find({ retailerKey: { $in: retailerKeys } })
    .select([
      'retailerKey',
      'retailerName',
      'channel',
      'label',
      'sourceRetailerName',
      'sourceRetailerFormat',
      'appliesToRetailerFormats',
      'retailerFormatLabel',
      'sourceUrl',
      'sourceType',
      'priority',
      'enabled',
      'active',
      'disabledReason',
      'parserHint',
      'latestStatus',
      'latestRunAt',
    ].join(' '))
    .lean();

  return { offers, sources };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();

  const generatedAt = new Date();
  const context = await fetchReadOnlyContext(options);
  const report = buildRetailerReadinessDiagnostic({
    ...context,
    generatedAt,
  });

  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        readOnly: true,
        mutatedCollections: [],
        message: error.message,
        stack: error.stack,
      }, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  parseArgs,
  fetchReadOnlyContext,
};
