const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const RawDocument = require('../src/models/RawDocument');
const Source = require('../src/models/Source');
const {
  buildBillaOfficialValidityRootCauseDiagnostic,
} = require('../src/services/diagnostics/billaOfficialValidityRootCauseDiagnostic');

function parseArgs(argv = []) {
  const options = {
    json: false,
    limit: 2500,
    rawDocumentLimit: 30,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isInteger(value) && value >= 100 && value <= 10000) {
        options.limit = value;
      }
    }

    if (arg.startsWith('--raw-document-limit=')) {
      const value = Number(arg.slice('--raw-document-limit='.length));
      if (Number.isInteger(value) && value >= 0 && value <= 100) {
        options.rawDocumentLimit = value;
      }
    }
  }

  return options;
}

function printTextSummary(report) {
  console.log(`BILLA Official Validity Root Cause (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} mutatedCollections=${report.mutatedCollections.length} diagnosticOnly=${report.diagnosticOnly}`);
  console.log(`likelyRootCause=${report.summary.likelyRootCause}`);
  console.log('');

  for (const retailer of report.retailers) {
    console.log(`${retailer.retailerKey} ${retailer.sourceKey}`);
    console.log(`  official=${retailer.officialCount} validTo=${retailer.fieldCoverage.validToPresentCount}/${retailer.officialCount} (${retailer.fieldCoverage.validToCoveragePct}%)`);
    console.log(`  rawValidityEvidence=${retailer.fieldCoverage.rawValidityEvidenceCount}`);
    console.log(`  rootCause=${retailer.rootCauseClassification}`);
    console.log(`  scopeRisks=${retailer.scopeRisks.join(', ') || 'none'}`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  await connectToDatabase();
  const report = await buildBillaOfficialValidityRootCauseDiagnostic({
    Offer,
    RawDocument,
    Source,
    limit: options.limit,
    rawDocumentLimit: options.rawDocumentLimit,
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
