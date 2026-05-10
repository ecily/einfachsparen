const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const { buildOfferRanking, clearRankingResponseCache } = require('../src/services/offers/offerRankingService');
const {
  CASES,
  buildCoverageBaselineDiagnostic,
} = require('../src/services/diagnostics/coverageBaselineDiagnostic');

const DEFAULT_LIMIT = 700;
const QUERY_MAX_TIME_MS = 1500;

function parseArgs(argv = []) {
  const options = {
    json: false,
    limit: DEFAULT_LIMIT,
    skipRanking: false,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--skip-ranking') {
      options.skipRanking = true;
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

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegex(terms = []) {
  return new RegExp(terms.map(escapeRegexLiteral).join('|'), 'i');
}

function termFields(regex) {
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

function buildCaseMatch(queryCase) {
  const definition = CASES[queryCase];
  const match = {
    $or: termFields(buildRegex(definition.terms)),
  };

  if (queryCase === 'spar-kaffee') {
    const sparRegex = /spar|interspar|eurospar/i;
    match.$and = [
      {
        $or: [
          { retailerKey: sparRegex },
          { retailerName: sparRegex },
          { sourceRetailerName: sparRegex },
          { sourceRetailerFormat: sparRegex },
          { retailerFormatLabel: sparRegex },
          { retailerFormats: sparRegex },
          { appliesToRetailerFormats: sparRegex },
        ],
      },
    ];
  }

  return match;
}

function selectFields() {
  return [
    '_id',
    'retailerKey',
    'retailerName',
    'sourceRetailerName',
    'sourceRetailerFormat',
    'retailerFormats',
    'appliesToRetailerFormats',
    'retailerFormatLabel',
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
    'categoryConfidence',
    'subcategoryConfidence',
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
    'validityLabel',
    'status',
    'isActiveNow',
    'isActiveToday',
    'quality',
    'rawFacts',
    'sortScoreDefault',
  ].join(' ');
}

async function fetchOffersForCase(queryCase, limit) {
  return Offer.find(buildCaseMatch(queryCase))
    .sort({ isActiveNow: -1, isActiveToday: -1, sortScoreDefault: -1, retailerName: 1, title: 1 })
    .limit(limit)
    .select(selectFields())
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

function activeMatch() {
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

async function fetchSparSourceSummary() {
  const [sources, rows] = await Promise.all([
    Source.find({
      $or: [
        { retailerKey: /spar/i },
        { retailerName: /spar/i },
        { sourceRetailerName: /spar/i },
        { sourceRetailerFormat: /spar|interspar|eurospar/i },
      ],
    })
      .sort({ retailerKey: 1, priority: 1, label: 1 })
      .select('retailerKey retailerName channel label sourceRetailerName sourceRetailerFormat retailerFormatLabel sourceUrl sourceType enabled active latestRunAt latestStatus parserHint parserVersion')
      .limit(80)
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean(),
    Offer.aggregate([
      {
        $match: {
          ...activeMatch(),
          $or: [
            { retailerKey: /spar/i },
            { retailerName: /spar/i },
            { sourceRetailerFormat: /spar|interspar|eurospar/i },
            { retailerFormatLabel: /spar|interspar|eurospar/i },
          ],
        },
      },
      {
        $group: {
          _id: {
            retailerKey: '$retailerKey',
            sourceType: '$sourceType',
            sourceId: '$sourceId',
          },
          offers: { $sum: 1 },
          sampleTitle: { $first: '$title' },
        },
      },
      { $sort: { offers: -1 } },
      { $limit: 40 },
    ]).option({ maxTimeMS: QUERY_MAX_TIME_MS }),
  ]);

  return {
    configuredSourceCount: sources.length,
    configuredSources: sources.map((source) => ({
      sourceId: String(source._id || ''),
      retailerKey: source.retailerKey || '',
      retailerName: source.retailerName || '',
      channel: source.channel || '',
      sourceType: source.sourceType || '',
      label: source.label || '',
      sourceRetailerName: source.sourceRetailerName || '',
      sourceRetailerFormat: source.sourceRetailerFormat || '',
      retailerFormatLabel: source.retailerFormatLabel || '',
      enabled: Boolean(source.enabled),
      active: Boolean(source.active),
      latestRunAt: source.latestRunAt || null,
      latestStatus: source.latestStatus || '',
      parserHint: source.parserHint || '',
      parserVersion: source.parserVersion || '',
    })),
    activeOfferCount: rows.reduce((sum, row) => sum + Number(row.offers || 0), 0),
    activeOfferSourceBreakdown: rows.map((row) => ({
      retailerKey: row._id?.retailerKey || '',
      sourceType: row._id?.sourceType || '',
      sourceId: String(row._id?.sourceId || ''),
      offers: row.offers || 0,
      sampleTitle: row.sampleTitle || '',
    })),
  };
}

async function fetchRankings(skipRanking = false) {
  if (skipRanking) {
    return {};
  }

  const [butter, reis, sparKaffee] = await Promise.all([
    buildOfferRanking({ query: 'butter', limit: 20 }),
    buildOfferRanking({ query: 'reis', limit: 20 }),
    buildOfferRanking({ query: 'kaffee', retailers: 'spar', categories: 'Kaffee & Tee', limit: 20 }),
  ]);

  return {
    butter,
    reis,
    'spar-kaffee': sparKaffee,
  };
}

async function fetchReadOnlyInputs({ limit = DEFAULT_LIMIT, skipRanking = false } = {}) {
  const [butterOffers, reisOffers, sparKaffeeOffers] = await Promise.all([
    fetchOffersForCase('butter', limit),
    fetchOffersForCase('reis', limit),
    fetchOffersForCase('spar-kaffee', limit),
  ]);
  const sourceIds = [...new Set([...butterOffers, ...reisOffers, ...sparKaffeeOffers]
    .map((offer) => String(offer.sourceId || ''))
    .filter(Boolean))];
  const [sources, rankings, sparSourceSummary] = await Promise.all([
    Source.find({ _id: { $in: sourceIds } })
      .select('retailerKey retailerName channel label sourceUrl sourceType parserHint parserVersion latestRunAt latestStatus')
      .lean(),
    fetchRankings(skipRanking),
    fetchSparSourceSummary(),
  ]);

  return {
    caseOffers: {
      butter: butterOffers,
      reis: reisOffers,
      'spar-kaffee': sparKaffeeOffers,
    },
    sources,
    rankings,
    sparSourceSummary,
  };
}

function printTextSummary(report) {
  console.log(`Coverage Baseline Diagnostic (${report.checkedAt})`);
  console.log(`readOnly=${report.readOnly} mutatedCollections=${report.mutatedCollections.length} performanceSafe=${report.performanceSafe}`);
  for (const item of report.cases) {
    console.log(`${item.queryCase}: db=${item.dbCandidateCount} true=${item.likelyTrueProductCount} side=${item.likelySideHitCount} ranked=${item.rankedResultCount} reason=${item.missingLikelyReason}`);
    for (const action of item.recommendedNextActions) {
      console.log(`- ${action}`);
    }
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();
  clearRankingResponseCache();

  const inputs = await fetchReadOnlyInputs(options);
  const report = buildCoverageBaselineDiagnostic({
    checkedAt: new Date(),
    ...inputs,
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
  parseArgs,
  buildCaseMatch,
  fetchOffersForCase,
  fetchReadOnlyInputs,
};
