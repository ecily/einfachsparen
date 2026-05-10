const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const RawDocument = require('../src/models/RawDocument');
const CrawlJob = require('../src/models/CrawlJob');
const {
  buildSparSourceCoverageDiagnostic,
  fetchSparSourceCoverageInputs,
} = require('../src/services/diagnostics/sparSourceCoverageDiagnostic');

function parseArgs(argv = []) {
  const options = {
    json: false,
    limit: 40,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));

      if (Number.isInteger(value) && value >= 5 && value <= 100) {
        options.limit = value;
      }
    }
  }

  return options;
}

function printTextSummary(report) {
  console.log(`SPAR Source Coverage Diagnostic (${report.checkedAt})`);
  console.log(`readOnly=${report.readOnly} mutatedCollections=${report.mutatedCollections.length} performanceSafe=${report.performanceSafe}`);
  console.log(`likelyRootCause=${report.summary.likelyRootCause}`);
  console.log(`sparOffersInDb=${report.summary.sparOffersInDb} activeApprox=${report.summary.activeSparOffersApprox}`);
  console.log(`sparCoffeeOffersInDb=${report.summary.sparCoffeeOffersInDb} activeCoffeeApprox=${report.summary.activeSparCoffeeOffersApprox}`);
  console.log('');
  console.log('Code sources:');
  for (const source of report.codeSources) {
    console.log(`- ${source.sourceKey}: ${source.channel}/${source.sourceType} active=${source.appearsActive} ${source.sourceUrl}`);
  }
  console.log('');
  console.log('DB source breakdown:');
  for (const source of report.dbSourceBreakdown.slice(0, 12)) {
    console.log(`- ${source.sourceType || 'unknown'} ${source.sourceRetailerFormat || ''}: offers=${source.offers} active=${source.activeOffersApprox} coffee=${source.coffeeOffers}`);
  }
  console.log('');
  for (const action of report.recommendedNextActions) {
    console.log(`- ${action}`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  await connectToDatabase();

  const db = await fetchSparSourceCoverageInputs({
    Offer,
    Source,
    RawDocument,
    CrawlJob,
    limit: options.limit,
  });
  const report = buildSparSourceCoverageDiagnostic({
    checkedAt: new Date(),
    db,
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
        performanceSafe: true,
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
