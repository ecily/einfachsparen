process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const {
  parseArgs,
  runLaunchE2eSmoke,
} = require('../src/services/diagnostics/launchE2eSmoke');

function printTextReport(report) {
  const readiness = report.launchReadiness || {};

  console.log(`Launch E2E Smoke (${report.checkedAt})`);
  console.log(`Read-only: ${report.readOnly}; mutatedCollections=${JSON.stringify(report.mutatedCollections)}`);
  console.log(`Status: ${readiness.status}`);
  console.log(`Backend commands: ${Object.values(report.backend || {}).filter((item) => item.ok).length}/${Object.keys(report.backend || {}).length} ok`);
  console.log(`API mode: ${report.api?.mode || 'unknown'}`);
  console.log(`Risky claim matches: ${report.claims?.matchCount ?? 0}`);
  console.log('');

  console.log('Blockers');
  if (!readiness.blockers?.length) {
    console.log('- none');
  } else {
    for (const blocker of readiness.blockers) {
      console.log(`- ${blocker.area}/${blocker.key}: ${blocker.message}`);
    }
  }

  console.log('');
  console.log('Watch Items');
  if (!readiness.watchItems?.length) {
    console.log('- none');
  } else {
    for (const item of readiness.watchItems.slice(0, 40)) {
      console.log(`- ${item.area}/${item.key}: ${item.message}`);
    }
  }

  console.log('');
  console.log('Acceptable Gaps');
  if (!readiness.acceptableGaps?.length) {
    console.log('- none');
  } else {
    for (const item of readiness.acceptableGaps.slice(0, 40)) {
      console.log(`- ${item.area}/${item.key}: ${item.message}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runLaunchE2eSmoke(options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    readOnly: true,
    mutatedCollections: [],
    message: error.message,
    stack: error.stack,
  }, null, 2));
  process.exitCode = 1;
});
