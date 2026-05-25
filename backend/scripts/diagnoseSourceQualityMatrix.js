const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const {
  buildSourceQualityMatrixDiagnostic,
  fetchSourceQualityMatrixInputs,
} = require('../src/services/diagnostics/sourceQualityMatrixDiagnostic');

function parseArgs(argv = []) {
  const options = {
    json: false,
    activeOnly: true,
    maxTimeMS: 5000,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--include-inactive') {
      options.activeOnly = false;
      continue;
    }

    if (arg.startsWith('--maxTimeMS=')) {
      const value = Number(arg.slice('--maxTimeMS='.length));
      if (Number.isInteger(value) && value >= 1000 && value <= 30000) {
        options.maxTimeMS = value;
      }
    }
  }

  return options;
}

function fmtPct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function printTextSummary(report) {
  console.log(`Source Quality Matrix (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} mutatedCollections=${report.mutatedCollections.length} scope=${report.scope}`);
  console.log(`offersAnalyzed=${report.summary.offersAnalyzed} sourceRows=${report.summary.sourceRows}`);
  console.log('');
  console.log([
    'Haendler',
    'Quelle',
    'Count',
    'Bildquote',
    'Conditionquote',
    'sichere Basispreise',
    'Quality-Issues',
    'Hauptprobleme',
    'Empfehlung',
  ].join(' | '));
  console.log([
    '---',
    '---',
    '---:',
    '---:',
    '---:',
    '---:',
    '---:',
    '---',
    '---',
  ].join(' | '));

  for (const row of report.table) {
    console.log([
      row.retailer,
      row.source,
      row.count,
      fmtPct(row.imageQuote),
      fmtPct(row.conditionQuote),
      fmtPct(row.safeBasePriceQuote),
      fmtPct(row.qualityIssueQuote),
      row.mainProblems.join(', ') || '-',
      row.recommendation,
    ].join(' | '));
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  await connectToDatabase();
  const inputs = await fetchSourceQualityMatrixInputs({
    Offer,
    Source,
    activeOnly: options.activeOnly,
    maxTimeMS: options.maxTimeMS,
  });
  const report = buildSourceQualityMatrixDiagnostic({
    ...inputs,
    scope: options.activeOnly ? 'active-now' : 'all-target-retailer-offers',
    dbAccess: true,
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
        message: error.message,
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
