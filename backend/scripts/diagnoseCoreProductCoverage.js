const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const {
  buildCoreProductCoverageDiagnostic,
  parseArgs,
} = require('../src/services/diagnostics/coreProductCoverageDiagnostic');

function printTextReport(report) {
  console.log(`Core Product Coverage Diagnostic (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} mutatedCollections=${report.mutatedCollections.length}`);
  console.log('');
  console.log('query | tokens | candidates | result/displayed | dbSignals true/side/unclear | reason | retailers');
  console.log('--- | --- | ---: | ---: | ---: | --- | ---');

  for (const item of report.cases) {
    const retailers = item.retailerCoverage
      .slice(0, 5)
      .map((row) => `${row.retailerKey}:${row.count}`)
      .join(', ') || '-';

    console.log([
      item.key,
      item.queryTokens.join(','),
      item.candidateCountBeforeRanking,
      `${item.resultCount}/${item.finalDisplayed}`,
      `${item.likelyTrueDbSignalCount}/${item.sideHitDbSignalCount}/${item.unclearDbSignalCount}`,
      item.zeroOrWeakReason,
      retailers,
    ].join(' | '));
  }

  for (const item of report.cases) {
    console.log('');
    console.log(`[${item.key}] final=${item.finalDisplayed} candidates=${item.candidateCountBeforeRanking} dbSignals=${item.dbSignalCount} true=${item.likelyTrueDbSignalCount}`);
    console.log(`  candidateQueryMode=${item.candidateQueryMode} fallbackUsed=${item.fallbackUsed} reason=${item.zeroOrWeakReason}`);
    console.log('  topDbSignals:');
    for (const offer of item.topDbSignals.slice(0, 5)) {
      console.log(`    - ${offer.diagnosticClassification}: ${offer.title} [${offer.retailerKey}] score=${offer.rankingScore} reason=${offer.diagnosticReason}`);
    }
    console.log('  finalResults:');
    for (const offer of item.finalResults.slice(0, 5)) {
      console.log(`    - ${offer.title} [${offer.retailerKey}] price=${offer.price.amount ?? '-'} validTo=${offer.validTo || '-'} source=${offer.sourceType || '-'}`);
    }
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  await connectToDatabase();

  const report = await buildCoreProductCoverageDiagnostic({
    limit: options.limit,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
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
      }, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  printTextReport,
  run,
};
