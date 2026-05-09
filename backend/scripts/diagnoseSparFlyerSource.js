process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const {
  buildSparFlyerSourceDiagnostic,
  DEFAULT_CANDIDATE_SOURCES,
} = require('../src/services/diagnostics/sparFlyerSourceDiagnostic');

async function run() {
  const report = await buildSparFlyerSourceDiagnostic({
    candidates: DEFAULT_CANDIDATE_SOURCES,
    now: new Date(),
  });

  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  run().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      readOnly: true,
      mutatedCollections: [],
      message: error.message,
      stack: error.stack,
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  run,
};
