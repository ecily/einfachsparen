const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const RawDocument = require('../src/models/RawDocument');
const CrawlJob = require('../src/models/CrawlJob');
const CrawlRun = require('../src/models/CrawlRun');
const {
  buildSourceProductCoverageDiagnostic,
  parseArgs,
} = require('../src/services/diagnostics/sourceProductCoverageDiagnostic');

function printTextSummary(report) {
  console.log(`Source Product Coverage Diagnostic (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} mutatedCollections=${report.mutatedCollections.length} crawlStarted=${report.crawlStarted}`);
  console.log(`query=${report.query} tokens=${report.queryTokens.join(',')} rootCause=${report.rootCause}`);
  console.log('');

  console.log('Active offer signals:');
  console.log(`  total=${report.activeOfferSummary.total} true=${report.activeOfferSummary.true} sideHit=${report.activeOfferSummary.sideHit} unclear=${report.activeOfferSummary.unclear}`);
  for (const item of report.activeOfferSignals.slice(0, 12)) {
    console.log(`  - ${item.classification}: ${item.title} [${item.retailerKey}] source=${item.sourceKey || item.sourceType} price=${item.price ?? '-'} reason=${item.classificationReason}`);
  }
  console.log('');

  console.log('RawDocument signals:');
  console.log(`  total=${report.rawDocumentSummary.total} true=${report.rawDocumentSummary.true} sideHit=${report.rawDocumentSummary.sideHit} unclear=${report.rawDocumentSummary.unclear}`);
  for (const item of report.rawDocuments.slice(0, 12)) {
    console.log(`  - ${item.classification}: ${item.title || item.sourceKey || item.sourceType} [${item.retailerKey}] source=${item.sourceKey || item.sourceType} found=${item.foundRawItems} parsed=${item.parsedOffers} rejected=${item.rejectedOffers} reason=${item.classificationReason}`);
    if (item.rejectionReasons.length > 0) {
      console.log(`    rejectionReasons=${item.rejectionReasons.map((reason) => `${reason.reason}:${reason.count}`).join(', ')}`);
    }
  }
  console.log('');

  console.log('Retailer coverage:');
  console.log('retailer | sources | offers true/side | raw true/total | parserLossDocs | status');
  console.log('--- | ---: | ---: | ---: | ---: | ---');
  for (const item of report.retailerCoverage) {
    console.log(`${item.retailerKey} | ${item.sourceCount} | ${item.trueActiveOffers}/${item.sideOrUnclearActiveOffers} | ${item.trueRawDocuments}/${item.rawDocumentsWithSignal} | ${item.rawParserLossDocuments} | ${item.sourceStatus}`);
  }
  console.log('');

  console.log('Latest source stats:');
  for (const item of report.sourceStats.slice(0, 20)) {
    const job = item.latestCrawlJob || {};
    console.log(`  - ${item.retailerKey}/${item.sourceKey}: status=${job.status || item.latestStatus || '-'} found=${job.foundRawItems || 0} parsed=${job.parsedOffers || 0} stored=${job.offersStored || 0} rejected=${job.rejectedOffers || 0}`);
  }
  console.log('');

  console.log('False-positive preparation:');
  for (const item of report.falsePositivePreparation) {
    const classes = item.topClasses.map((row) => `${row.className}:${row.count}`).join(', ');
    console.log(`  - ${item.key}: ${classes || '-'}`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();
  const report = await buildSourceProductCoverageDiagnostic({
    query: options.query,
    Offer,
    Source,
    RawDocument,
    CrawlJob,
    CrawlRun,
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
        crawlStarted: false,
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
  printTextSummary,
};
