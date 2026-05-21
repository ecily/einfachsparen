const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const { buildOfferRanking, clearRankingResponseCache } = require('../src/services/offers/offerRankingService');
const {
  DEFAULT_SEARCH_TERMS,
  buildSearchCoverageDiagnostic,
  buildSearchCoverageTermReport,
} = require('../src/services/diagnostics/searchCoverageDiagnostic');

const QUERY_MAX_TIME_MS = 1500;

function parseArgs(argv = []) {
  const options = {
    json: false,
    terms: DEFAULT_SEARCH_TERMS,
    limit: 120,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg.startsWith('--terms=')) {
      options.terms = arg
        .slice('--terms='.length)
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isInteger(value) && value >= 10 && value <= 200) {
        options.limit = value;
      }
    }
  }

  return options;
}

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeGermanSearch(value) {
  return String(value || '')
    .replace(/ö/gi, (match) => (match === 'Ö' ? 'Oe' : 'oe'))
    .replace(/ä/gi, (match) => (match === 'Ä' ? 'Ae' : 'ae'))
    .replace(/ü/gi, (match) => (match === 'Ü' ? 'Ue' : 'ue'))
    .replace(/ß/g, 'ss');
}

function buildTermRegex(query) {
  const variants = [...new Set([
    query,
    normalizeGermanSearch(query),
  ].filter(Boolean))];

  return new RegExp(variants.map(escapeRegexLiteral).join('|'), 'i');
}

function activeMatch() {
  return {
    status: 'active',
    isActiveNow: true,
  };
}

function textFields(regex) {
  return [
    { title: regex },
    { titleNormalized: regex },
    { brand: regex },
    { searchText: regex },
    { categoryPrimary: regex },
    { categorySecondary: regex },
    { categoryKey: regex },
    { subcategoryKey: regex },
    { comparisonGroup: regex },
  ];
}

async function fetchCandidateOffers(query, limit) {
  const regex = buildTermRegex(query);

  return Offer.find({
    ...activeMatch(),
    $or: textFields(regex),
  })
    .sort({ sortScoreDefault: -1, updatedAt: -1 })
    .limit(limit)
    .select([
      '_id',
      'retailerKey',
      'retailerName',
      'sourceType',
      'sourceTypes',
      'sourceUrl',
      'sourceUrls',
      'evidenceUrls',
      'title',
      'brand',
      'priceCurrent',
      'quantityText',
      'validFrom',
      'validTo',
      'conditionsText',
      'rawFacts',
    ].join(' '))
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

function printTextSummary(report) {
  console.log(`Search Coverage Diagnostic (${report.checkedAt})`);
  console.log(`readOnly=${report.readOnly} mutatedCollections=${report.mutatedCollections.length} performanceSafe=${report.performanceSafe}`);

  for (const item of report.reports) {
    console.log(`${item.query}: total=${item.totalCount} displayed=${item.displayedCount} official=${item.officialCount} officialFlyer=${item.officialFlyerCount} aggregatorWithValidity=${item.aggregatorWithValidityCount} lowConfidenceCandidates=${item.aggregatorPpcvLowConfidenceCount} excludedLowConfidence=${item.excludedLowConfidenceCount}`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();
  clearRankingResponseCache();

  const reports = [];
  for (const query of options.terms) {
    const [ranking, candidates] = await Promise.all([
      buildOfferRanking({ query, limit: options.limit }),
      fetchCandidateOffers(query, options.limit),
    ]);

    reports.push(buildSearchCoverageTermReport({ query, ranking, candidates }));
  }

  const report = buildSearchCoverageDiagnostic({
    checkedAt: new Date(),
    terms: options.terms,
    reports,
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
        performanceSafe: true,
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
  buildTermRegex,
  fetchCandidateOffers,
  parseArgs,
  printTextSummary,
};
