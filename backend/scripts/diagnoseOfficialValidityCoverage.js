const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const {
  buildOfficialValidityCoverageDiagnostic,
} = require('../src/services/diagnostics/officialValidityCoverageDiagnostic');

function parseArgs(argv = []) {
  const options = {
    json: false,
    limit: 25,
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
  console.log(`Official Validity Coverage (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} mutatedCollections=${report.mutatedCollections.length} diagnosticOnly=${report.diagnosticOnly}`);
  console.log(`retailers=${report.summary.checkedRetailers.join(', ')}`);
  console.log('');

  for (const retailer of report.retailers) {
    console.log(`${retailer.displayName} (${retailer.retailerKey})`);
    console.log(`  offers=${retailer.coverage.totalOffers} official=${retailer.coverage.officialOfferCount} aggregator=${retailer.coverage.aggregatorOfferCount}`);
    console.log(`  sources=${retailer.sourceBreakdown.map((source) => `${source.sourceKey}:${source.offerCount}`).join(', ') || 'none'}`);
    console.log(`  risks=${retailer.risks.join(', ') || 'none'}`);
    console.log(`  next=${retailer.recommendedNextAction}`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  await connectToDatabase();
  const report = await buildOfficialValidityCoverageDiagnostic({
    Offer,
    limit: options.limit,
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
        diagnosticOnly: true,
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
