const {
  buildBillaAlgoliaHitSampleDiagnostic,
} = require('../src/services/diagnostics/billaAlgoliaHitSampleDiagnostic');

function parseArgs(argv = []) {
  const options = {
    json: false,
    hits: 8,
    timeoutMs: 8000,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg.startsWith('--hits=')) {
      const value = Number(arg.slice('--hits='.length));
      if (Number.isInteger(value) && value >= 1 && value <= 10) {
        options.hits = value;
      }
    }

    if (arg.startsWith('--timeout-ms=')) {
      const value = Number(arg.slice('--timeout-ms='.length));
      if (Number.isInteger(value) && value >= 1000 && value <= 20000) {
        options.timeoutMs = value;
      }
    }
  }

  return options;
}

function printTextSummary(report) {
  console.log(`BILLA Algolia Hit Sample (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} liveHttpChecked=${report.liveHttpChecked} mutatedCollections=${report.mutatedCollections.length}`);
  if (report.fetchError) {
    console.log(`fetchError=${report.fetchError.message}`);
  }
  console.log(`BILLA=${report.summary.billaClassification}`);
  console.log(`BILLA_PLUS=${report.summary.billaPlusClassification}`);
  console.log(`explicitFields=${report.summary.explicitPerHitValidityFieldsFound.join(', ') || 'none'}`);
  console.log(`next=${report.summary.recommendedNextAction}`);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildBillaAlgoliaHitSampleDiagnostic({
    hitsPerRetailer: options.hits,
    timeoutMs: options.timeoutMs,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextSummary(report);
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      readOnly: true,
      mutatedCollections: [],
      diagnosticOnly: true,
      message: error.message,
      stack: error.stack,
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  printTextSummary,
};
