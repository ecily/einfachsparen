const mongoose = require('mongoose');
const path = require('node:path');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const {
  buildActiveOfferMatch,
  DEFAULT_QUERIES,
} = require('../src/services/diagnostics/imageCoverageDiagnostic');
const {
  TARGET_RETAILERS,
  buildBlockedReport,
  buildImageDedupeRepairPotentialDiagnostic,
  writeImageDedupeRepairPotentialReports,
} = require('../src/services/diagnostics/imageDedupeRepairPotentialDiagnostic');

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function parseArgs(argv = []) {
  const options = {
    retailers: TARGET_RETAILERS,
    queries: DEFAULT_QUERIES,
    limit: 50000,
    writeReports: true,
    json: false,
    outputDir: path.resolve(process.cwd(), 'tmp'),
  };

  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    if (arg === '--no-write') options.writeReports = false;
    if (arg.startsWith('--retailers=')) options.retailers = unique(arg.slice('--retailers='.length).split(','));
    if (arg.startsWith('--queries=')) options.queries = unique(arg.slice('--queries='.length).split(','));
    if (arg.startsWith('--output-dir=')) options.outputDir = path.resolve(process.cwd(), arg.slice('--output-dir='.length));
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isInteger(value) && value > 0 && value <= 200000) options.limit = value;
    }
  }

  return options;
}

async function fetchReadOnlyInputs({ retailers, limit }) {
  const offers = await Offer.find({
    retailerKey: { $in: retailers },
    ...buildActiveOfferMatch(new Date()),
  })
    .sort({ retailerKey: 1, titleNormalized: 1, sourceType: 1, createdAt: 1 })
    .limit(limit)
    .select([
      '_id',
      'retailerKey',
      'retailerName',
      'sourceRetailerName',
      'sourceRetailerFormat',
      'retailerFormats',
      'appliesToRetailerFormats',
      'retailerFormatLabel',
      'sourceId',
      'sourceKey',
      'sourceType',
      'sourceUrl',
      'title',
      'titleNormalized',
      'brand',
      'description',
      'searchText',
      'searchTokens',
      'priceCurrent',
      'normalizedUnitPrice',
      'quantityText',
      'categoryPrimary',
      'categorySecondary',
      'categoryKey',
      'subcategoryKey',
      'comparisonSignature',
      'comparisonGroup',
      'comparableUnit',
      'totalComparableAmount',
      'effectiveDiscountType',
      'benefitType',
      'conditionsText',
      'customerProgramRequired',
      'hasConditions',
      'isMultiBuy',
      'offerKey',
      'packCount',
      'unitValue',
      'unitType',
      'packageType',
      'minimumPurchaseQty',
      'sortScoreDefault',
      'validFrom',
      'validTo',
      'createdAt',
      'dedupeKey',
      'isActiveNow',
      'isActiveToday',
      'status',
      'quality',
      'rawFacts',
      'imageUrl',
    ].join(' '))
    .lean();

  const sources = await Source.find()
    .select('_id channel retailerKey sourceKey sourceType sourceUrl sourceRetailerFormat')
    .lean();

  return { offers, sources };
}

function printSummary(report) {
  console.log(`Image Dedupe Repair Potential (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} crawlStarted=${report.crawlStarted} mutatedCollections=${report.mutatedCollections.length}`);

  if (report.blocked?.db) {
    console.log(`blockedDb=true reason=${report.blocked.dbReason}`);
    return;
  }

  console.log(`activeOffersRead=${report.scope.activeOffersRead}`);
  console.log(`safeDuplicateGroups=${report.summary.safeDuplicateGroups}`);
  console.log(`canonicalWithoutImageGroups=${report.summary.canonicalWithoutImageGroups}`);
  console.log(`potentialRepairableGroups=${report.summary.potentialRepairableGroups}`);
  console.log(`nonRepairableDuplicateImageGaps=${report.summary.duplicateGroupCanonicalImageGapsWithoutSiblingImage}`);
  console.log('');
  console.log('Potential by retailer:');
  for (const row of report.potential.byRetailer) console.log(`  - ${row.key}: ${row.count}`);
  console.log('');
  console.log('Potential by query:');
  for (const row of report.potential.byQuery) console.log(`  - ${row.query}: ${row.count}`);
  console.log('');
  console.log('Reports:');
  console.log('  backend/tmp/image-dedupe-repair-potential-summary.json');
  console.log('  backend/tmp/image-dedupe-repair-potential-examples.json');
  console.log('  backend/tmp/image-dedupe-repair-potential-report.md');
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();

  const inputs = await fetchReadOnlyInputs(options);
  const report = buildImageDedupeRepairPotentialDiagnostic({
    offers: inputs.offers,
    sources: inputs.sources,
    queries: options.queries,
  });

  if (options.writeReports) {
    report.reportPaths = await writeImageDedupeRepairPotentialReports(report, { outputDir: options.outputDir });
  }

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printSummary(report);
}

if (require.main === module) {
  run()
    .catch(async (error) => {
      const options = parseArgs(process.argv.slice(2));
      const report = buildBlockedReport({ message: error.message });
      if (options.writeReports) {
        await writeImageDedupeRepairPotentialReports(report, { outputDir: options.outputDir }).catch(() => {});
      }
      console.error(JSON.stringify(report, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => {});
    });
}

module.exports = {
  fetchReadOnlyInputs,
  parseArgs,
};
