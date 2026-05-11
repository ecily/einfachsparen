const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const {
  buildCasesFromOptions,
  buildRankingPerformanceDiagnostic,
  parseArgs,
  printReadableReport,
  writeJsonReport,
} = require('../src/services/diagnostics/rankingPerformanceDiagnostic');

async function run() {
  const options = parseArgs(process.argv.slice(2));

  await connectToDatabase();

  const report = await buildRankingPerformanceDiagnostic({
    cases: buildCasesFromOptions(options),
  });

  if (options.jsonPath) {
    const resolvedJsonPath = await writeJsonReport(options.jsonPath, report);
    printReadableReport(report, { jsonPath: resolvedJsonPath });
    return;
  }

  if (options.jsonToStdout) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReadableReport(report);
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
  run,
};
