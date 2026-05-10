const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Source = require('../src/models/Source');
const Offer = require('../src/models/Offer');
const {
  compactStrings,
  resolveCrawlSourceSelection,
} = require('../src/services/crawl/crawlSourceSelection');

function parseCsvArg(value = '') {
  return compactStrings(String(value || '').split(','));
}

function parseArgs(argv = []) {
  const options = {
    json: false,
    retailerKeys: [],
    sourceKeys: [],
    sourceIds: [],
    allowDisabled: false,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--allowDisabled=true' || arg === '--allow-disabled') {
      options.allowDisabled = true;
      continue;
    }

    if (arg.startsWith('--retailerKeys=')) {
      options.retailerKeys = parseCsvArg(arg.slice('--retailerKeys='.length));
      continue;
    }

    if (arg.startsWith('--sourceKeys=')) {
      options.sourceKeys = parseCsvArg(arg.slice('--sourceKeys='.length));
      continue;
    }

    if (arg.startsWith('--sourceIds=')) {
      options.sourceIds = parseCsvArg(arg.slice('--sourceIds='.length));
    }
  }

  return options;
}

function printTextSummary(report) {
  console.log('Crawl Source Selection Diagnostic');
  console.log(`dryRun=${report.dryRun} crawlStarted=false wouldRunCount=${report.wouldRunCount}`);
  console.log(`effectiveRetailerKeys=${report.effectiveRetailerKeys.join(',') || 'none'}`);
  console.log('Matched sources:');
  for (const source of report.matchedSources) {
    console.log(`- ${source.sourceKey} (${source.retailerKey}, enabled=${source.enabled}, active=${source.active}) ${source.sourceUrl}`);
  }
  if (report.disabledSources.length > 0) {
    console.log('Disabled sources:');
    for (const source of report.disabledSources) {
      console.log(`- ${source.sourceKey} (${source.disabledReason || 'disabled'})`);
    }
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();

  const selection = await resolveCrawlSourceSelection({
    Source,
    Offer,
    retailerKeys: options.retailerKeys,
    sourceKeys: options.sourceKeys,
    sourceIds: options.sourceIds,
    allowDisabled: options.allowDisabled,
    dryRun: true,
    sourceSelectionRequested: options.sourceKeys.length > 0 || options.sourceIds.length > 0,
  });
  const report = {
    ok: true,
    readOnly: true,
    dryRun: true,
    crawlStarted: false,
    mutatedCollections: [],
    requestedRetailerKeys: selection.requestedRetailerKeys,
    requestedSourceKeys: selection.requestedSourceKeys,
    requestedSourceIds: selection.requestedSourceIds,
    effectiveRetailerKeys: selection.effectiveRetailerKeys,
    matchedSources: selection.matchedSources,
    skippedSources: selection.skippedSources,
    disabledSources: selection.disabledSources,
    unknownSourceKeys: selection.unknownSourceKeys,
    unknownSourceIds: selection.unknownSourceIds,
    wouldRunCount: selection.wouldRunCount,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextSummary(report);
  }
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        readOnly: true,
        dryRun: true,
        crawlStarted: false,
        mutatedCollections: [],
        message: error.message,
        details: error.details || {},
      }, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  parseArgs,
  parseCsvArg,
};
