const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const Category = require('../src/models/Category');
const {
  RETAILER_SPECS,
  buildMarketCoverageDiagnostic,
} = require('../src/services/diagnostics/marketCoverageDiagnostic');

const DEFAULT_LIMIT = 150000;

function parseArgs(argv = []) {
  const options = {
    json: false,
    limit: DEFAULT_LIMIT,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isInteger(value) && value >= 100 && value <= 500000) {
        options.limit = value;
      }
    }
  }

  return options;
}

function targetRetailerKeys() {
  return [...new Set(RETAILER_SPECS.flatMap((spec) => spec.retailerKeys))];
}

async function fetchReadOnlyContext({ limit = DEFAULT_LIMIT } = {}) {
  const retailerKeys = targetRetailerKeys();
  const offers = await Offer.find({ retailerKey: { $in: retailerKeys } })
    .sort({ retailerKey: 1, sourceRetailerFormat: 1, categoryKey: 1, subcategoryKey: 1, updatedAt: -1 })
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
      'imageUrl',
      'quality',
      'sortScoreDefault',
      'rawFacts',
      'createdAt',
      'updatedAt',
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
      'parserHint',
    ].join(' '))
    .lean();

  const categories = await Category.find({ isActive: true })
    .sort({ offerCount: -1, mainCategoryLabel: 1 })
    .select('mainCategoryKey mainCategoryLabel offerCount subcategories isActive lastSeenAt')
    .lean();

  return { offers, sources, categories };
}

function statusRank(status) {
  return { critical: 0, weak: 1, unknown: 2, ok: 3 }[status] ?? 4;
}

function formatCountList(items = []) {
  if (!items.length) return '-';
  return items.map((item) => `${item.key}: ${item.count}`).join(', ');
}

function printHumanReport(report) {
  const worst = [...report.coverageMatrix]
    .sort((left, right) =>
      statusRank(left.status) - statusRank(right.status)
      || left.metrics.activeOfferCount - right.metrics.activeOfferCount
      || left.retailerLabel.localeCompare(right.retailerLabel, 'de')
    )
    .slice(0, 20);

  console.log('Market Coverage Diagnose');
  console.log('========================');
  console.log(`checkedAt: ${report.checkedAt}`);
  console.log(`databaseName: ${report.databaseName || 'unknown'}`);
  console.log(`readOnly: ${report.readOnly}`);
  console.log(`mutatedCollections: ${JSON.stringify(report.mutatedCollections)}`);
  console.log('');
  console.log('Summary');
  console.log('-------');
  console.log(`Retailers: ${report.summary.retailersChecked}`);
  console.log(`Categories: ${report.summary.categoriesChecked}`);
  console.log(`Keywords: ${report.summary.keywordsChecked}`);
  console.log(`critical: ${report.summary.criticalCount}`);
  console.log(`weak: ${report.summary.weakCount}`);
  console.log(`unknown: ${report.summary.unknownCount}`);
  console.log(`ok: ${report.summary.okCount}`);
  console.log(`Most critical retailers: ${formatCountList(report.summary.mostCriticalRetailers)}`);
  console.log(`Most critical categories/keywords: ${formatCountList(report.summary.mostCriticalCategories)}`);
  console.log('');
  console.log('Heuristik');
  console.log('---------');
  console.log(`Hinweis: ${report.heuristic.note}`);
  console.log(`Schwellen: ${JSON.stringify(report.heuristic.thresholds)}`);
  console.log('');
  console.log('Worst 20 Haendler/Kategorie- oder Keyword-Kombinationen');
  console.log('-------------------------------------------------------');
  for (const item of worst) {
    const dimension = item.dimensionType === 'category' ? item.categoryLabel : `keyword:${item.keyword}`;
    console.log(
      `${item.status.toUpperCase()} | ${item.retailerLabel} | ${dimension} | active=${item.metrics.activeOfferCount} total=${item.metrics.totalOfferCount} ranked=${item.metrics.rankedOffersCount}`
    );
    console.log(`  reasons: ${item.statusReasons.join('; ')}`);
  }
  console.log('');
  console.log('Haendleruebersicht');
  console.log('------------------');
  for (const retailer of report.retailerSummaries) {
    console.log(
      `${retailer.retailerLabel}: ${formatCountList(retailer.statuses)} | activeSources=${retailer.sourceHealth?.activeSourceCount ?? 0} disabledSources=${retailer.sourceHealth?.disabledSourceCount ?? 0}`
    );
  }
  console.log('');
  console.log('Quellenuebersicht');
  console.log('-----------------');
  for (const source of report.sourceHealth) {
    const flags = [
      source.hasActiveOfficialOrStructured ? 'official/structured' : '',
      source.hasOnlyAggregatorActive ? 'only-aggregator' : '',
      source.hasNoUsableSource ? 'no-usable-source' : '',
    ].filter(Boolean).join(', ') || 'mixed/unknown';
    console.log(`${source.retailerLabel}: active=${source.activeSourceCount} disabled=${source.disabledSourceCount} ${flags}`);
    for (const disabled of source.disabledSources.slice(0, 3)) {
      console.log(`  disabled: ${disabled.label} (${disabled.reason})`);
    }
  }
  console.log('');
  console.log('Empfohlene naechste Schritte nach Ursache');
  console.log('-----------------------------------------');
  for (const group of report.recommendedNextActions) {
    console.log(`${group.cause}: ${group.count}`);
    for (const item of group.items.slice(0, 5)) {
      const dimension = item.dimensionType === 'category' ? item.categoryLabel : `keyword:${item.keyword}`;
      console.log(`  - ${item.retailerLabel} / ${dimension}: ${item.detail}`);
    }
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();
  const context = await fetchReadOnlyContext(options);
  const report = buildMarketCoverageDiagnostic({
    ...context,
    databaseName: mongoose.connection.name,
    checkedAt: new Date(),
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }
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
  fetchReadOnlyContext,
  parseArgs,
  printHumanReport,
};
