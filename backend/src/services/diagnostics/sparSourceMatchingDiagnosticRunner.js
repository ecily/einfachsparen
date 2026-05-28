const Offer = require('../../models/Offer');
const CrawlJob = require('../../models/CrawlJob');
const {
  buildSparSourceMatchingDiagnostic,
} = require('./sparSourceMatchingDiagnostic');

const TARGET_RETAILERS = ['spar', 'interspar', 'eurospar'];
const PDF_SOURCE_KEYS = [
  'spar-official-flyer-pdf',
  'interspar-official-flyer-pdf',
  'eurospar-official-flyer-pdf',
];
const AGGREGATOR_SOURCE_KEYS = [
  'aktionsfinder-spar',
  'aktionsfinder-interspar',
  'aktionsfinder-eurospar',
];
const DEFAULT_LIMIT_PDF = 500;
const DEFAULT_LIMIT_AGGREGATOR = 1500;
const MAX_LIMIT_PDF = 1500;
const MAX_LIMIT_AGGREGATOR = 5000;
const DEFAULT_MAX_EXAMPLES = 8;
const MAX_EXAMPLES = 25;
const QUERY_MAX_TIME_MS = 5000;

const OFFER_SELECT_FIELDS = [
  '_id',
  'retailerKey',
  'retailerName',
  'sourceRetailerName',
  'sourceRetailerFormat',
  'retailerFormats',
  'appliesToRetailerFormats',
  'retailerFormatLabel',
  'sourceType',
  'sourceUrl',
  'sourceUrls',
  'evidenceUrls',
  'sourceTypes',
  'title',
  'titleNormalized',
  'brand',
  'categoryPrimary',
  'categorySecondary',
  'categoryKey',
  'subcategoryKey',
  'priceCurrent',
  'quantityText',
  'packCount',
  'unitValue',
  'unitType',
  'totalComparableAmount',
  'comparableUnit',
  'packageType',
  'normalizedUnitPrice',
  'validFrom',
  'validTo',
  'conditionsText',
  'customerProgramRequired',
  'hasConditions',
  'isMultiBuy',
  'minimumPurchaseQty',
  'imageUrl',
  'comparisonGroup',
  'comparisonSignature',
  'dedupeKey',
  'offerKey',
  'quality',
  'rawFacts.sourceType',
  'rawFacts.sourceKey',
  'rawFacts.sourceMetadata',
  'rawFacts.validityText',
  'rawFacts.infoText',
  'rawFacts.minimumPurchaseQuantity',
  'rawFacts.requiredQuantity',
  'rawFacts.discountPercentage',
  'rawFacts.minimalAcceptance',
  'supportingSources',
  'createdAt',
  'updatedAt',
].join(' ');

function parseInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function parseBoolean(value, fallback = true) {
  if (typeof value === 'undefined' || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'ja'].includes(String(value).toLowerCase());
}

function parseRetailer(value = 'all') {
  const normalized = String(value || 'all').trim().toLowerCase();
  if (normalized === 'all') return 'all';
  return TARGET_RETAILERS.includes(normalized) ? normalized : 'all';
}

function parseSparMatchingDiagnosticQuery(query = {}) {
  return {
    retailer: parseRetailer(query.retailer),
    limitPdf: parseInteger(query.limitPdf, DEFAULT_LIMIT_PDF, 1, MAX_LIMIT_PDF),
    limitAggregator: parseInteger(query.limitAggregator, DEFAULT_LIMIT_AGGREGATOR, 1, MAX_LIMIT_AGGREGATOR),
    maxExamples: parseInteger(query.maxExamples, DEFAULT_MAX_EXAMPLES, 0, MAX_EXAMPLES),
    includeSamples: parseBoolean(query.includeSamples, true),
  };
}

function activeOfferMatch(now = new Date()) {
  return {
    $or: [
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

function retailerMatch(retailer = 'all') {
  return retailer === 'all'
    ? { retailerKey: { $in: TARGET_RETAILERS } }
    : { retailerKey: retailer };
}

function buildPdfOfferQuery({ retailer = 'all', now = new Date() } = {}) {
  return {
    $and: [
      retailerMatch(retailer),
      activeOfferMatch(now),
      {
        $or: [
          { sourceType: 'spar-official-pdf' },
          { 'rawFacts.sourceKey': { $in: PDF_SOURCE_KEYS } },
          { 'rawFacts.sourceMetadata.sourceKey': { $in: PDF_SOURCE_KEYS } },
        ],
      },
    ],
  };
}

function buildAggregatorOfferQuery({ retailer = 'all', now = new Date() } = {}) {
  return {
    $and: [
      retailerMatch(retailer),
      activeOfferMatch(now),
      {
        $or: [
          { sourceType: 'aktionsfinder-json' },
          { 'rawFacts.sourceKey': { $in: AGGREGATOR_SOURCE_KEYS } },
          { 'rawFacts.sourceMetadata.sourceKey': { $in: AGGREGATOR_SOURCE_KEYS } },
        ],
      },
    ],
  };
}

function findReadOnlyOffers(Model, query, { limit, sort } = {}) {
  return Model.find(query)
    .select(OFFER_SELECT_FIELDS)
    .sort(sort)
    .limit(limit)
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

function summarizeSourceFieldCoverage(offers = []) {
  const total = offers.length;
  const present = (predicate) => offers.filter(predicate).length;

  return {
    total,
    sourceKey: present((offer) => Boolean(offer.sourceKey || offer.rawFacts?.sourceKey || offer.rawFacts?.sourceMetadata?.sourceKey)),
    sourceType: present((offer) => Boolean(offer.sourceType || offer.rawFacts?.sourceType)),
    retailerKey: present((offer) => Boolean(offer.retailerKey)),
    title: present((offer) => Boolean(offer.title)),
    priceCurrent: present((offer) => Number.isFinite(Number(offer.priceCurrent?.amount))),
    quantity: present((offer) => Boolean(offer.quantityText || offer.unitValue || offer.totalComparableAmount)),
    validity: present((offer) => Boolean(offer.validFrom || offer.validTo)),
    conditionsText: present((offer) => Boolean(offer.conditionsText)),
    imageUrl: present((offer) => Boolean(offer.imageUrl)),
    category: present((offer) => Boolean(offer.categoryKey || offer.subcategoryKey || offer.categoryPrimary || offer.categorySecondary)),
  };
}

function trimExamples(items = [], { includeSamples = true, maxExamples = DEFAULT_MAX_EXAMPLES } = {}) {
  if (!includeSamples || maxExamples <= 0) return [];
  return items.slice(0, maxExamples);
}

function shapeSparSourceMatchingReport(report = {}, options = {}) {
  const {
    includeSamples = true,
    maxExamples = DEFAULT_MAX_EXAMPLES,
    query = {},
    fieldCoverage = {},
    productionRejectionReasonHistogram = {},
  } = options;
  const {
    matches,
    unsafeExamples = [],
    topStrongExamples = [],
    topMediumExamples = [],
    weakMatchExamples = [],
    topNoMatchExamples = [],
    topRejectedCandidateSamples = [],
    ...safeReport
  } = report;

  return {
    ...safeReport,
    query,
    limits: {
      maxExamples,
      includeSamples,
    },
    dataFieldCoverage: fieldCoverage,
    unsafeExamples: Number(report.summary?.unsafeExamples || unsafeExamples.length || 0),
    topUnsafeExamples: trimExamples(unsafeExamples, { includeSamples, maxExamples }),
    topStrongExamples: trimExamples(topStrongExamples, { includeSamples, maxExamples }),
    topMediumExamples: trimExamples(topMediumExamples, { includeSamples, maxExamples }),
    weakMatchExamples: trimExamples(weakMatchExamples, { includeSamples, maxExamples }),
    topNoMatchExamples: trimExamples(topNoMatchExamples, { includeSamples, maxExamples }),
    topRejectedCandidateSamples: trimExamples(topRejectedCandidateSamples, { includeSamples, maxExamples }),
    rejectionEvidenceAvailable: topRejectedCandidateSamples.length > 0,
    productionRejectionReasonHistogram,
    fullMatchRowsReturned: false,
  };
}

async function fetchProductionRejectionReasonHistogram(CrawlJobModel, { retailer = 'all' } = {}) {
  const match = {
    sourceType: 'spar-official-pdf',
    ...(retailer === 'all' ? { retailerKey: { $in: TARGET_RETAILERS } } : { retailerKey: retailer }),
  };

  const rows = await CrawlJobModel.aggregate([
    { $match: match },
    { $sort: { startedAt: -1 } },
    { $limit: 25 },
    { $unwind: '$rejectionReasons' },
    {
      $group: {
        _id: '$rejectionReasons.reason',
        count: { $sum: '$rejectionReasons.count' },
      },
    },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 25 },
  ]).option({ maxTimeMS: QUERY_MAX_TIME_MS });

  return Object.fromEntries(rows.map((row) => [row._id || 'unknown', row.count]));
}

async function buildProductionSparSourceMatchingDiagnostic({
  query = {},
  OfferModel = Offer,
  CrawlJobModel = CrawlJob,
  generatedAt = new Date(),
} = {}) {
  const options = parseSparMatchingDiagnosticQuery(query);
  const now = new Date();
  const [pdfOffers, aggregatorOffers, productionRejectionReasonHistogram] = await Promise.all([
    findReadOnlyOffers(OfferModel, buildPdfOfferQuery({ retailer: options.retailer, now }), {
      limit: options.limitPdf,
      sort: { retailerKey: 1, validTo: -1, titleNormalized: 1, updatedAt: -1 },
    }),
    findReadOnlyOffers(OfferModel, buildAggregatorOfferQuery({ retailer: options.retailer, now }), {
      limit: options.limitAggregator,
      sort: { retailerKey: 1, validTo: -1, titleNormalized: 1, updatedAt: -1 },
    }),
    fetchProductionRejectionReasonHistogram(CrawlJobModel, { retailer: options.retailer }),
  ]);

  const report = buildSparSourceMatchingDiagnostic({
    offers: [...pdfOffers, ...aggregatorOffers],
    rejectedCandidateSamples: [],
    generatedAt,
    maxExamples: options.maxExamples,
  });

  return shapeSparSourceMatchingReport(report, {
    includeSamples: options.includeSamples,
    maxExamples: options.maxExamples,
    query: {
      retailer: options.retailer,
      limitPdf: options.limitPdf,
      limitAggregator: options.limitAggregator,
    },
    fieldCoverage: {
      pdf: summarizeSourceFieldCoverage(pdfOffers),
      aggregator: summarizeSourceFieldCoverage(aggregatorOffers),
    },
    productionRejectionReasonHistogram,
  });
}

module.exports = {
  AGGREGATOR_SOURCE_KEYS,
  DEFAULT_LIMIT_AGGREGATOR,
  DEFAULT_LIMIT_PDF,
  MAX_EXAMPLES,
  MAX_LIMIT_AGGREGATOR,
  MAX_LIMIT_PDF,
  PDF_SOURCE_KEYS,
  TARGET_RETAILERS,
  activeOfferMatch,
  buildAggregatorOfferQuery,
  buildPdfOfferQuery,
  buildProductionSparSourceMatchingDiagnostic,
  parseSparMatchingDiagnosticQuery,
  shapeSparSourceMatchingReport,
  summarizeSourceFieldCoverage,
};
