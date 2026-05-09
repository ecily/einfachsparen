const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const {
  TARGET_COMBINATIONS,
  buildOfferCoverageDiagnostic,
} = require('../src/services/diagnostics/offerCoverageDiagnostic');

const DEFAULT_LIMIT = 30000;

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

function targetRetailerKeys() {
  return [...new Set(TARGET_COMBINATIONS.flatMap((target) => target.retailerKeys))];
}

async function fetchReadOnlyContext({ limit = DEFAULT_LIMIT } = {}) {
  const retailerKeys = targetRetailerKeys();
  const now = new Date();
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
    .sort({ retailerKey: 1, categoryKey: 1, subcategoryKey: 1, sourceType: 1, titleNormalized: 1 })
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
      'title',
      'titleNormalized',
      'brand',
      'searchText',
      'description',
      'categoryPrimary',
      'categorySecondary',
      'categoryKey',
      'subcategoryKey',
      'categoryConfidence',
      'subcategoryConfidence',
      'sourceType',
      'sourceTypes',
      'sourceUrl',
      'sourceUrls',
      'evidenceUrls',
      'validFrom',
      'validTo',
      'status',
      'isActiveNow',
      'isActiveToday',
      'priceCurrent',
      'quantityText',
      'unitValue',
      'unitType',
      'totalComparableAmount',
      'comparableUnit',
      'normalizedUnitPrice',
      'conditionsText',
      'customerProgramRequired',
      'hasConditions',
      'isMultiBuy',
      'minimumPurchaseQty',
      'effectiveDiscountType',
      'rawFacts',
    ].join(' '))
    .lean();

  const sources = await Source.find({ retailerKey: { $in: retailerKeys } })
    .select([
      '_id',
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
      'enabled',
      'active',
      'priority',
      'latestStatus',
      'latestRunAt',
      'disabledReason',
      'notes',
    ].join(' '))
    .lean();

  return { offers, sources };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();

  const generatedAt = new Date();
  const context = await fetchReadOnlyContext(options);
  const report = buildOfferCoverageDiagnostic({
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
