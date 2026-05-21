const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const {
  buildOfficialSourceMatrix,
} = require('../src/services/diagnostics/officialSourceMatrixDiagnostic');

function parseArgs(argv = []) {
  const options = {
    json: false,
    checkUrls: false,
    limit: 20,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--check-urls') {
      options.checkUrls = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isInteger(value) && value >= 5 && value <= 50) {
        options.limit = value;
      }
    }
  }

  return options;
}

function printTextSummary(report) {
  console.log(`Official Source Matrix (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} mutatedCollections=${report.mutatedCollections.length} reachabilityChecked=${report.reachabilityChecked}`);
  console.log(`retailers=${report.summary.retailerCount} officialUrlsChecked=${report.summary.officialUrlsChecked}`);
  console.log(`resourceMatrix=${report.summary.resourceMatrix.resourceCount} planned=${report.summary.resourceMatrix.plannedOfficialResources} blockedOrUnclear=${report.summary.resourceMatrix.blockedOrUnclearResources}`);
  console.log('');

  for (const retailer of report.retailers) {
    console.log(`${retailer.displayName} (${retailer.retailerKey})`);
    console.log(`  offers=${retailer.dbCoverage.offerCountApprox} activeApprox=${retailer.dbCoverage.activeOfferCountApprox}`);
    console.log(`  parser=${retailer.structureAssessment.existingParserCoverage} confidence=${retailer.structureAssessment.confidence}`);
    console.log(`  officialSources=${retailer.codeSources.filter((source) => source.sourceKind === 'official').map((source) => `${source.sourceKey}:${source.active ? 'active' : 'inactive'}`).join(', ') || 'none'}`);
    console.log(`  matrixResources=${retailer.resourceAudit.resourceCount} officialFirst=${retailer.resourceAudit.officialFirstDecision}`);
    console.log(`  next=${retailer.recommendedNextAction}`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  await connectToDatabase();
  const report = await buildOfficialSourceMatrix({
    Offer,
    limit: options.limit,
    checkUrls: options.checkUrls,
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
