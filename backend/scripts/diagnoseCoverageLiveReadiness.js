const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const RawDocument = require('../src/models/RawDocument');
const CrawlJob = require('../src/models/CrawlJob');
const { buildOfferRanking, clearRankingResponseCache } = require('../src/services/offers/offerRankingService');
const {
  DEFAULT_LIMIT,
  buildCoverageLiveReadinessDiagnostic,
} = require('../src/services/diagnostics/coverageLiveReadinessDiagnostic');

function parseArgs(argv = []) {
  const options = {
    json: false,
    limit: DEFAULT_LIMIT,
    baseUrl: 'https://www.kaufklug.at',
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isInteger(value) && value >= 50 && value <= 2000) {
        options.limit = value;
      }
      continue;
    }

    if (arg.startsWith('--base-url=')) {
      const value = arg.slice('--base-url='.length).trim();
      if (/^https?:\/\//i.test(value)) {
        options.baseUrl = value.replace(/\/$/, '');
      }
    }
  }

  return options;
}

function printTextSummary(report) {
  console.log(`Coverage Live Readiness (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} crawlStarted=${report.crawlStarted} deploymentStarted=${report.deploymentStarted}`);
  console.log('');
  console.log(`Recommended next block: ${report.summary.recommendedNextBlock}`);
  console.log(`Can proceed to live test soon: ${report.summary.canProceedToLiveTestSoon}`);
  console.log(`Why: ${report.summary.why}`);
  console.log('');
  console.log(`Butter: ${report.butter.rootCause} (${report.butter.recommendedAction})`);
  console.log(`Reis: ${report.reis.rootCause} (${report.reis.recommendedAction})`);
  console.log(`SPAR + Kaffee: ${report.sparCoffee.rootCause}; activeAggregatorCrawlHelp=${report.sparCoffee.canActiveAggregatorCrawlHelp}`);
  console.log('');
  console.log('Baseline commands:');
  for (const item of report.nextLiveTestPlan.baselineCommands) {
    console.log(`- ${item.command}`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();
  clearRankingResponseCache();

  const report = await buildCoverageLiveReadinessDiagnostic({
    Offer,
    Source,
    RawDocument,
    CrawlJob,
    buildOfferRanking,
    limit: options.limit,
    baseUrl: options.baseUrl,
  });

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
        mutatedCollections: [],
        crawlStarted: false,
        deploymentStarted: false,
        sourceActivationChanged: false,
        rankingChanged: false,
        parserCrawlerProductionChanged: false,
        uiOrMobileChanged: false,
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
  printTextSummary,
};
