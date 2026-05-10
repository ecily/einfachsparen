const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const { buildOfferRanking, clearRankingResponseCache } = require('../src/services/offers/offerRankingService');
const {
  QUERY_TERMS,
  buildQueryQualityGapsDiagnostic,
} = require('../src/services/diagnostics/queryQualityGapsDiagnostic');

const DEFAULT_LIMIT = 600;
const QUERY_MAX_TIME_MS = 1500;

function parseArgs(argv = []) {
  const options = {
    json: false,
    limit: DEFAULT_LIMIT,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));

      if (Number.isInteger(value) && value >= 50 && value <= 3000) {
        options.limit = value;
      }
    }
  }

  return options;
}

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegex(terms = []) {
  return new RegExp(terms.map(escapeRegexLiteral).join('|'), 'i');
}

function buildActiveMatch() {
  const now = new Date();

  return {
    $or: [
      { status: 'active', isActiveNow: true },
      { isActiveNow: true },
      { isActiveToday: true },
      {
        status: 'active',
        $or: [
          { validTo: { $gte: now } },
          { validTo: null },
        ],
      },
    ],
  };
}

function buildTextMatch(terms, extraOr = []) {
  const regex = buildRegex(terms);

  return {
    ...buildActiveMatch(),
    $and: [
      {
        $or: [
          { title: regex },
          { titleNormalized: regex },
          { brand: regex },
          { searchText: regex },
          { categoryPrimary: regex },
          { categorySecondary: regex },
          { categoryKey: regex },
          { subcategoryKey: regex },
          { comparisonGroup: regex },
          ...extraOr,
        ],
      },
    ],
  };
}

function selectFields() {
  return [
    '_id',
    'retailerKey',
    'retailerName',
    'sourceId',
    'sourceType',
    'sourceUrl',
    'sourceUrls',
    'title',
    'titleNormalized',
    'brand',
    'searchText',
    'categoryPrimary',
    'categorySecondary',
    'categoryKey',
    'subcategoryKey',
    'comparisonSignature',
    'comparisonGroup',
    'dedupeKey',
    'offerKey',
    'priceCurrent',
    'normalizedUnitPrice',
    'quantityText',
    'packCount',
    'unitValue',
    'unitType',
    'totalComparableAmount',
    'comparableUnit',
    'packageType',
    'benefitType',
    'effectiveDiscountType',
    'conditionsText',
    'customerProgramRequired',
    'hasConditions',
    'isMultiBuy',
    'minimumPurchaseQty',
    'validFrom',
    'validTo',
    'status',
    'isActiveNow',
    'isActiveToday',
    'quality',
    'rawFacts',
  ].join(' ');
}

async function fetchOffersForTerms({ terms, limit, sort = { sortScoreDefault: -1, retailerName: 1, title: 1 }, extraOr = [] }) {
  return Offer.find(buildTextMatch(terms, extraOr))
    .sort(sort)
    .limit(limit)
    .select(selectFields())
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

async function fetchReadOnlyInputs(limit) {
  const [butterOffers, reisOffers, waschmittelOffers, butterRanking, reisRanking, waschmittelRanking] = await Promise.all([
    fetchOffersForTerms({
      terms: QUERY_TERMS.butter,
      limit,
      extraOr: [
        { categoryPrimary: /Milchprodukte|Fruehstueck|Frühstück|Backen|Grundnahrungsmittel/i },
        { categorySecondary: /Milchprodukte|Fruehstueck|Frühstück|Backen|Grundnahrungsmittel|Aufstrich/i },
      ],
    }),
    fetchOffersForTerms({ terms: QUERY_TERMS.reis, limit }),
    fetchOffersForTerms({ terms: QUERY_TERMS.waschmittel, limit }),
    buildOfferRanking({ query: 'butter', limit: 20 }),
    buildOfferRanking({ query: 'reis', limit: 20 }),
    buildOfferRanking({ query: 'waschmittel', limit: 60 }),
  ]);

  return {
    butterOffers,
    reisOffers,
    waschmittelOffers,
    rankings: {
      butter: butterRanking,
      reis: reisRanking,
      waschmittel: waschmittelRanking,
    },
  };
}

function printTextSummary(report) {
  console.log(`Query Quality Gaps Diagnostic (${report.checkedAt})`);
  console.log(`readOnly=${report.readOnly} mutatedCollections=${report.mutatedCollections.length}`);
  console.log(`butter true=${report.butter.trueCandidateCount} sideHits=${report.butter.sideHitCount} excludedByIntent=${report.butter.excludedByIntent.length}`);
  console.log(`reis true=${report.reis.trueCandidateCount} weak=${report.reis.weakCandidateCount} sideHits=${report.reis.sideHitCount} excludedByIntent=${report.reis.excludedByIntent.length}`);
  console.log(`waschmittel duplicateGroups=${report.waschmittelDuplicates.duplicateGroupCount}`);
  for (const action of report.recommendedNextActions) {
    console.log(`- ${action}`);
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();
  clearRankingResponseCache();

  const checkedAt = new Date();
  const inputs = await fetchReadOnlyInputs(options.limit);
  const report = buildQueryQualityGapsDiagnostic({ checkedAt, ...inputs });

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
  parseArgs,
  buildActiveMatch,
  buildTextMatch,
  fetchOffersForTerms,
  fetchReadOnlyInputs,
};
