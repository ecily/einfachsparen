const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const {
  TARGET_RETAILERS,
  buildSourceDedupeDiagnostic,
  writeDiagnosticArtifact,
} = require('../src/services/diagnostics/sourceDedupeDiagnostic');

const DEFAULT_LIMIT = 12000;

function parseArgs(argv = []) {
  const options = {
    limit: DEFAULT_LIMIT,
    writeArtifact: true,
  };

  for (const arg of argv) {
    if (arg === '--no-artifact') {
      options.writeArtifact = false;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));

      if (Number.isInteger(value) && value >= 100 && value <= 50000) {
        options.limit = value;
      }
    }
  }

  return options;
}

async function fetchReadOnlyOffers(limit = DEFAULT_LIMIT) {
  const now = new Date();
  const retailerKeys = TARGET_RETAILERS.map((retailer) => retailer.retailerKey);

  return Offer.find({
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
    .sort({ retailerKey: 1, titleNormalized: 1, sourceType: 1, validTo: 1 })
    .limit(limit)
    .select([
      '_id',
      'retailerKey',
      'retailerName',
      'sourceType',
      'sourceUrl',
      'title',
      'titleNormalized',
      'brand',
      'priceCurrent',
      'normalizedUnitPrice',
      'validFrom',
      'validTo',
      'categoryKey',
      'subcategoryKey',
      'comparisonGroup',
      'comparisonSignature',
      'dedupeKey',
      'offerKey',
      'quantityText',
      'packCount',
      'unitValue',
      'unitType',
      'totalComparableAmount',
      'comparableUnit',
      'packageType',
      'sourceConfidence',
      'extractionConfidence',
      'quality',
      'createdAt',
    ].join(' '))
    .lean();
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();

  const generatedAt = new Date();
  const offers = await fetchReadOnlyOffers(options.limit);
  const report = buildSourceDedupeDiagnostic({ offers, generatedAt });

  if (options.writeArtifact) {
    report.artifactPath = writeDiagnosticArtifact(report, {
      baseDir: process.cwd(),
      generatedAt,
    });
  }

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
  fetchReadOnlyOffers,
};
