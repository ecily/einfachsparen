const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const RawDocument = require('../src/models/RawDocument');
const CrawlJob = require('../src/models/CrawlJob');
const { buildOfferRanking, clearRankingResponseCache } = require('../src/services/offers/offerRankingService');
const {
  DEFAULT_LIMIT,
  buildLaunchCoverageAudit,
} = require('../src/services/diagnostics/launchCoverageAudit');

function parseArgs(argv = []) {
  const options = {
    json: false,
    limit: DEFAULT_LIMIT,
    checkUrls: false,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--check-urls') {
      options.checkUrls = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isInteger(value) && value >= 50 && value <= 2000) {
        options.limit = value;
      }
    }
  }

  return options;
}

function printTextSummary(report) {
  console.log(`Launch Coverage Audit (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} crawlStarted=${report.crawlStarted} liveHttpChecked=${report.liveHttpChecked}`);
  console.log('');

  const butter = report.sections.butterReisRootCause.butter;
  const reis = report.sections.butterReisRootCause.reis;
  console.log(`Butter: true=${butter.trueCandidateCount} side=${butter.sideHitCount} sourceCoverageGap=${butter.likelySourceCoverageGap}`);
  console.log(`Reis: true=${reis.trueCandidateCount} side=${reis.sideHitCount} sourceCoverageGap=${reis.likelySourceCoverageGap}`);
  console.log(`SPAR: ${report.sections.sparKaffeeDecision.diagnosticSummary.likelyRootCause || 'unclear'}`);
  console.log(`PAGRO: ${report.sections.pagroOfficialOpportunity.classification.status}`);
  console.log(`dm: ${report.sections.dmBipaOfficialVisibilityGap.dm.hypothesis.hypothesis}`);
  console.log(`BIPA: ${report.sections.dmBipaOfficialVisibilityGap.bipa.hypothesis.hypothesis}`);
  console.log('');
  console.log('Top Fixbloecke:');
  for (const block of report.roadmap) {
    console.log(`${block.priority}. ${block.title} (${block.problemType}, value=${block.expectedUserValue}, risk=${block.risk})`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();
  clearRankingResponseCache();

  const report = await buildLaunchCoverageAudit({
    Offer,
    Source,
    RawDocument,
    CrawlJob,
    buildOfferRanking,
    limit: options.limit,
    checkUrls: options.checkUrls,
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
        deploymentStarted: false,
        sourceActivationChanged: false,
        rankingChanged: false,
        parserCrawlerProductionChanged: false,
        uiOrMobileChanged: false,
        existingAggregatorSourcesChanged: false,
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
  parseArgs,
  printTextSummary,
};
