const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const {
  buildImageCoverageDiagnostic,
  buildLiveApiOnlyImageCoverageDiagnostic,
  parseArgs,
} = require('../src/services/diagnostics/imageCoverageDiagnostic');

function printSummary(report) {
  console.log(`Image Coverage Diagnostic (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} crawlStarted=${report.crawlStarted} mutatedCollections=${report.mutatedCollections.length}`);
  console.log(`total=${report.summary.total} withImage=${report.summary.withImage} imagePct=${report.summary.imagePct}% withoutImage=${report.summary.withoutImage}`);
  console.log(`invalidImageUrl=${report.summary.invalidImageUrl} imageLikeFieldsOnly=${report.summary.imageLikeFieldsOnly} missingWithSiblingImage=${report.summary.missingWithSiblingImage}`);
  console.log('');

  console.log('Retailer coverage:');
  console.log('retailer | total | withImage | withoutImage | imagePct | siblingImage');
  console.log('--- | ---: | ---: | ---: | ---: | ---:');
  for (const row of report.coverage.byRetailer) {
    console.log(`${row.key} | ${row.total} | ${row.withImage} | ${row.withoutImage} | ${row.imagePct}% | ${row.missingWithSiblingImage || 0}`);
  }
  console.log('');

  console.log('Query coverage:');
  console.log('query | dbTotal | dbWithImage | dbImagePct | localApiTotal | localApiWithImage | liveApiTotal | liveApiWithImage');
  console.log('--- | ---: | ---: | ---: | ---: | ---: | ---: | ---:');
  for (const row of report.coverage.byQuery) {
    console.log(`${row.query} | ${row.dbTotal} | ${row.dbWithImage} | ${row.dbImagePct}% | ${row.localApiTotal} | ${row.localApiWithImage} | ${row.liveApiTotal} | ${row.liveApiWithImage}`);
  }
  console.log('');

  console.log('Cause counts from examples:');
  for (const row of report.causeCounts) {
    console.log(`  - ${row.cause}: ${row.count}`);
  }
  console.log('');

  console.log('Reports:');
  console.log('  backend/tmp/image-coverage-summary.json');
  console.log('  backend/tmp/image-coverage-missing-examples.json');
  console.log('  backend/tmp/image-coverage-report.md');
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  let report;

  if (options.apiOnly) {
    report = await buildLiveApiOnlyImageCoverageDiagnostic({
      retailers: options.retailers,
      queries: options.queries,
      topLimit: options.topLimit,
      apiBaseUrl: options.apiBaseUrl,
      writeReports: options.writeReports,
      outputDir: options.outputDir,
    });
  } else {
    await connectToDatabase();
    report = await buildImageCoverageDiagnostic({
      Offer,
      Source,
      retailers: options.retailers,
      queries: options.queries,
      topLimit: options.topLimit,
      apiBaseUrl: options.apiBaseUrl,
      includeLiveApi: options.includeLiveApi,
      writeReports: options.writeReports,
      outputDir: options.outputDir,
    });
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report);
  }
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        readOnly: true,
        crawlStarted: false,
        mutatedCollections: [],
        message: error.message,
      }, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => {});
    });
}

module.exports = {
  printSummary,
};
