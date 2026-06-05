process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const {
  DEFAULT_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  SOURCE_TRANSPORT_CLIENTS,
  SOURCE_TRANSPORT_TARGETS,
  runSourceTransportMatrix,
} = require('../../src/services/diagnostics/sourceTransportMatrix');

function splitList(value = '') {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseInteger(value, fallback, { min = 0, max = 120000 } = {}) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseArgs(argv = []) {
  const options = {
    json: false,
    targets: ['spar-productworld-inangebot', 'spar-productworld-preisgesenkt', 'pagro-angebote', 'aktionsfinder-pagro'],
    clients: ['global-fetch', 'undici', 'native-https', 'axios', 'http2', 'curl'],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    delayMs: DEFAULT_DELAY_MS,
    maxCombinations: 40,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--list') {
      options.list = true;
      continue;
    }

    if (arg.startsWith('--targets=')) {
      options.targets = splitList(arg.slice('--targets='.length));
      continue;
    }

    if (arg.startsWith('--clients=')) {
      options.clients = splitList(arg.slice('--clients='.length));
      continue;
    }

    if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = parseInteger(arg.slice('--timeout-ms='.length), DEFAULT_TIMEOUT_MS, { min: 1000, max: 60000 });
      continue;
    }

    if (arg.startsWith('--delay-ms=')) {
      options.delayMs = parseInteger(arg.slice('--delay-ms='.length), DEFAULT_DELAY_MS, { min: 0, max: 10000 });
      continue;
    }

    if (arg.startsWith('--max-combinations=')) {
      options.maxCombinations = parseInteger(arg.slice('--max-combinations='.length), 40, { min: 1, max: 80 });
    }
  }

  return options;
}

function printList() {
  console.log('Targets:');
  for (const target of SOURCE_TRANSPORT_TARGETS) {
    console.log(`  ${target.id} | ${target.retailerKey} | ${target.expectedContentKind} | ${target.url}`);
  }
  console.log('');
  console.log('Clients:');
  for (const client of SOURCE_TRANSPORT_CLIENTS) {
    console.log(`  ${client.id} | deployable=${client.deployable === true}`);
  }
}

function printTextSummary(report) {
  console.log(`Source Transport Matrix (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} mutatedCollections=${report.mutatedCollections.length} node=${report.runtime.nodeVersion} platform=${report.runtime.platform}`);
  console.log(`targets=${report.targetIds.join(', ')} clients=${report.clientIds.join(', ')}`);
  console.log(`summary usable=${report.summary.usable} blocked=${report.summary.blocked} challenges=${report.summary.challenges} unavailable=${report.summary.unavailable}`);
  console.log('');

  console.log('Transport-Matrix:');
  console.log('target | client | status | content-type | kind | json | waf | http | decision');
  for (const result of report.results) {
    console.log([
      result.targetId,
      result.clientId,
      result.status || 'ERR',
      result.contentType || '-',
      result.responseKind,
      result.jsonReturned ? 'yes' : 'no',
      result.cloudflare?.signals?.join('+') || '-',
      result.httpVersion || '-',
      result.decision,
    ].join(' | '));
  }
  console.log('');

  console.log('Readiness:');
  for (const row of report.readiness) {
    console.log(`${row.targetId}: verdict=${row.verdict} deployable=${row.deployable} usableClients=${row.usableClients.join(',') || '-'} reason=${row.reason}`);
  }
  console.log('');

  console.log('Retailer-Matrix:');
  for (const row of report.retailers) {
    console.log(`${row.retailerKey}: targets=${row.targetCount} usableTargets=${row.usableTargetCount} blockedTargets=${row.blockedTargetCount} challenges=${row.challengeCount} recommendation=${row.recommendation}`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  if (options.list) {
    printList();
    return;
  }

  const report = await runSourceTransportMatrix({
    targetIds: options.targets,
    clientIds: options.clients,
    timeoutMs: options.timeoutMs,
    delayMs: options.delayMs,
    maxCombinations: options.maxCombinations,
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
      message: error.message,
      details: error.details || {},
      stack: error.stack,
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  printList,
  printTextSummary,
};
