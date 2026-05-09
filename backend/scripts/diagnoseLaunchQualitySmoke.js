const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const {
  DEFAULT_TOP_N,
  runLaunchQualitySmoke,
} = require('../src/services/diagnostics/launchQualitySmoke');

function parseArgs(argv) {
  const options = {
    json: false,
    top: DEFAULT_TOP_N,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg.startsWith('--top=')) {
      const value = Number(arg.slice('--top='.length));

      if (Number.isInteger(value) && value >= 5 && value <= 25) {
        options.top = value;
      }
    }
  }

  return options;
}

function resultIssueWeight(result) {
  return result.severeIssueCount * 100 +
    result.duplicateIssueCount * 20 +
    result.missingCoreFieldCount * 5 +
    result.top10IssueCount;
}

function worstResults(results, limit = 8) {
  return [...results]
    .sort((left, right) => {
      const statusWeight = { fail: 3, watch: 2, pass: 1 };
      const statusDelta = statusWeight[right.status] - statusWeight[left.status];

      if (statusDelta !== 0) {
        return statusDelta;
      }

      return resultIssueWeight(right) - resultIssueWeight(left);
    })
    .slice(0, limit);
}

function printResultLine(result) {
  const label = result.retailer ? `${result.query} / ${result.retailer.retailerName}` : result.query;
  console.log(
    `[${result.status}] ${label}: resultCount=${result.resultCount}, severe=${result.severeIssueCount}, ` +
    `missingCore=${result.missingCoreFieldCount}, duplicates=${result.duplicateIssueCount}, issues=${result.top10IssueCount}`
  );

  for (const reason of result.reasons || []) {
    console.log(`  - ${reason}`);
  }
}

function issueFlagNames(flags = {}) {
  return Object.entries(flags)
    .filter(([key, value]) => typeof value === 'boolean' && value && key !== 'needsManualReview')
    .map(([key]) => key);
}

function printSevereExamples(results, limit = 10) {
  const examples = [];

  for (const result of results) {
    for (const offer of result.rankedOffers || []) {
      const flags = offer.qualityFlags || {};
      const severe = Boolean(
        flags.likelySideHit && flags.sideHitEvidence?.severe ||
        flags.missingPrice ||
        flags.likelyDuplicateVisible ||
        flags.misleadingSavingsRisk
      );

      if (!severe) {
        continue;
      }

      examples.push({ result, offer, flags: issueFlagNames(flags) });
    }
  }

  for (const item of examples.slice(0, limit)) {
    const label = item.result.retailer
      ? `${item.result.query}/${item.result.retailer.retailerName}`
      : item.result.query;

    console.log(
      `  - ${label} #${item.offer.rank}: ${item.offer.title} ` +
      `[${item.offer.retailerName || item.offer.retailerKey}] flags=${item.flags.join(', ')}`
    );
  }

  if (examples.length === 0) {
    console.log('  - No severe visible examples found.');
  }
}

function printReadinessSection(title, items, emptyText) {
  console.log(title);

  if (!items || items.length === 0) {
    console.log(`- ${emptyText}`);
    return;
  }

  for (const item of items) {
    const reasons = (item.failReasons || []).join(', ') || 'n/a';
    console.log(
      `- ${item.label}: priority=${item.queryPriority}, resultCount=${item.resultCount}, ` +
      `severe=${item.severeIssueCount}, reasons=${reasons}`
    );
  }
}

function printReadinessRecommendations(title, items, emptyText) {
  console.log(title);

  if (!items || items.length === 0) {
    console.log(`- ${emptyText}`);
    return;
  }

  for (const item of items) {
    console.log(`- ${item}`);
  }
}

function printTextReport(report) {
  const allResults = report.queryResults.concat(report.retailerQueryResults);
  const worstQueries = worstResults(report.queryResults, 8);
  const worstRetailerQueries = worstResults(report.retailerQueryResults, 12);
  const readiness = report.launchReadiness || {};

  console.log(`Launch Quality Smoke (${report.checkedAt})`);
  console.log(`Database: ${report.databaseName || 'unknown'}`);
  console.log(`Read-only: ${report.readOnly}; mutatedCollections=${JSON.stringify(report.mutatedCollections)}`);
  console.log('');
  console.log(
    `Summary: queries=${report.summary.queriesChecked}, retailerFilters=${report.summary.retailerFiltersChecked}, ` +
    `pass=${report.summary.passCount}, watch=${report.summary.watchCount}, fail=${report.summary.failCount}, ` +
    `severe=${report.summary.severeIssueCount}`
  );
  console.log(
    `MVP status: ${readiness.status || 'unknown'}; blockers=${readiness.blockerCount ?? 0}, ` +
    `watch=${readiness.watchCount ?? 0}, acceptableGaps=${readiness.acceptableGapCount ?? 0}`
  );

  console.log('');
  printReadinessSection('Blockers', readiness.blockers, 'No MVP launch blockers classified.');

  console.log('');
  printReadinessSection('Watch Items', readiness.watchItems, 'No MVP watch items classified.');

  console.log('');
  printReadinessSection('Acceptable MVP Gaps', readiness.acceptableGaps, 'No acceptable MVP gaps classified.');

  console.log('');
  printReadinessRecommendations(
    'Recommended Scope Limits',
    readiness.recommendedMvpScopeLimits,
    'No explicit MVP scope limits recommended by this smoke.'
  );

  console.log('');
  printReadinessRecommendations(
    'Recommended Next Fixes',
    readiness.recommendedBeforeLaunchFixes,
    'No before-launch fixes recommended by the readiness classifier.'
  );

  console.log('');
  console.log('Worst Queries');
  worstQueries.forEach(printResultLine);

  console.log('');
  console.log('Worst Retailer/Query Combinations');
  worstRetailerQueries.forEach(printResultLine);

  console.log('');
  console.log('Examples With Severe Issues');
  printSevereExamples(allResults);

  console.log('');
  console.log('Recommended Next Actions');
  for (const action of report.recommendedNextActions) {
    console.log(`- ${action}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  await connectToDatabase();

  const report = await runLaunchQualitySmoke({
    databaseName: mongoose.connection.name,
    top: options.top,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
