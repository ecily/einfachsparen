const { RETAILER_DEFINITIONS } = require('../sources/sourceDefinitions');

const QUERY_MAX_TIME_MS = 1500;
const DEFAULT_LIMIT = 40;

const SPAR_TERMS = ['spar', 'interspar', 'eurospar'];
const OFFICIAL_SPAR_STEIERMARK_URL = 'https://www.spar.at/aktionen/steiermark';
const COFFEE_TERMS = [
  'kaffee',
  'cafe',
  'caffe',
  'cappuccino',
  'espresso',
  'tassimo',
  'nescafe',
  'nescafé',
  'meinl',
  'dallmayr',
  'regio gold',
  'cafe royal',
  'café royal',
  'coffee',
];

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTermRegex(terms = []) {
  return new RegExp(terms.map(escapeRegexLiteral).join('|'), 'i');
}

const SPAR_REGEX = buildTermRegex(SPAR_TERMS);
const COFFEE_REGEX = buildTermRegex(COFFEE_TERMS);
const SPAR_SOURCE_URL_REGEX = /spar|interspar|eurospar|aktionsfinder\.at\/pv\/(?:spar|interspar|eurospar)|marktguru\.at\/r\/spar/i;

function compact(values = []) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function uniqueCompact(values = []) {
  return [...new Set(compact(values))];
}

function dateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function sparFieldMatch() {
  return {
    $or: [
      { retailerKey: SPAR_REGEX },
      { retailerName: SPAR_REGEX },
      { sourceRetailerName: SPAR_REGEX },
      { sourceRetailerFormat: SPAR_REGEX },
      { retailerFormatLabel: SPAR_REGEX },
      { retailerFormats: SPAR_REGEX },
      { appliesToRetailerFormats: SPAR_REGEX },
    ],
  };
}

function coffeeFieldMatch() {
  return {
    $or: [
      { title: COFFEE_REGEX },
      { titleNormalized: COFFEE_REGEX },
      { brand: COFFEE_REGEX },
      { searchText: COFFEE_REGEX },
      { categoryPrimary: COFFEE_REGEX },
      { categorySecondary: COFFEE_REGEX },
      { categoryKey: COFFEE_REGEX },
      { subcategoryKey: COFFEE_REGEX },
      { comparisonGroup: COFFEE_REGEX },
      { description: COFFEE_REGEX },
    ],
  };
}

function activeApproxMatch(now = new Date()) {
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

function deriveSourceKey(definition = {}) {
  const url = String(definition.sourceUrl || '').toLowerCase();
  const format = definition.sourceRetailerFormat || definition.retailerKey || 'spar';

  if (url.includes('aktionsfinder.at')) return `aktionsfinder-${format}`;
  if (url.includes('marktguru.at')) return `marktguru-${format}`;
  if (url.includes('spar.at/aktionen/steiermark/eurospar') || (url.includes('spar.at/aktionen/steiermark') && format === 'eurospar')) return 'eurospar-official-actions-steiermark';
  if (url.includes('spar.at/aktionen/steiermark/interspar') || url.includes('interspar.at/aktionen/steiermark') || (url.includes('spar.at/aktionen/steiermark') && format === 'interspar')) return 'interspar-official-actions-steiermark';
  if (url.includes('spar.at/aktionen/steiermark')) return 'spar-official-actions-steiermark';
  if (url.includes('interspar.at/aktionen')) return 'interspar-official-actions';
  if (url.includes('flugblatt.interspar.at')) return 'interspar-official-flyer-pdf';
  if (url.includes('flugblatt.spar.at') && format === 'interspar') return 'interspar-official-flyer-pdf';
  if (url.includes('flugblatt.spar.at') && format === 'eurospar') return 'eurospar-official-flyer-pdf';
  if (url.includes('flugblatt.spar.at') && format === 'spar') return 'spar-official-flyer-pdf';
  if (url.includes('spar.at')) return 'spar-official-flyer';

  return compact([definition.channel, definition.retailerKey, format]).join('-');
}

function inferParserOrAdapter(definition = {}) {
  const url = String(definition.sourceUrl || '');

  if (definition.channel === 'aggregator' && url.includes('aktionsfinder.at')) return 'crawlAktionsfinderSource / aktionsfinderParser / offerNormalizer';
  if (definition.channel === 'aggregator' && url.includes('marktguru.at')) return 'crawlMarktguruSource';
  if (definition.channel === 'official-flyer' && definition.sourceType === 'pdf' && /flugblatt\.(?:spar|interspar)\.at/i.test(url)) {
    return 'crawlOfficialSource / sparOfficialFlyerPdfParser text-layer only';
  }
  if (definition.channel === 'official-flyer') return 'crawlOfficialSource generic link discovery; no SPAR-specific flyer/PDF offer parser branch';
  if (definition.channel === 'official-site' && definition.parserHint === 'official-category-actions') {
    return 'crawlOfficialSource / officialCategoryPromotionParser';
  }
  if (definition.channel === 'official-site') return 'crawlOfficialSource';

  return 'unknown';
}

function mapCodeSource(definition = {}) {
  const enabled = definition.enabled !== false;
  const latestStatus = definition.latestStatus || '';

  return {
    file: 'src/services/sources/sourceDefinitions.js',
    sourceKey: deriveSourceKey(definition),
    retailerKeys: uniqueCompact([
      definition.retailerKey,
      definition.sourceRetailerFormat,
      ...(definition.appliesToRetailerFormats || []),
    ]),
    retailerKey: definition.retailerKey || '',
    retailerName: definition.retailerName || '',
    sourceRetailerName: definition.sourceRetailerName || '',
    sourceRetailerFormat: definition.sourceRetailerFormat || '',
    sourceType: definition.sourceType || (definition.channel === 'official-flyer' ? 'flyer' : definition.channel || 'other'),
    channel: definition.channel || '',
    sourceUrl: definition.sourceUrl || '',
    parserOrAdapter: inferParserOrAdapter(definition),
    appearsActive: Boolean(enabled && latestStatus !== 'inactive'),
    enabled,
    disabledReason: definition.disabledReason || '',
    notes: definition.notes || '',
  };
}

function getSparCodeSources() {
  return RETAILER_DEFINITIONS
    .filter((definition) => {
      const haystack = compact([
        definition.retailerKey,
        definition.retailerName,
        definition.sourceRetailerName,
        definition.sourceRetailerFormat,
        definition.retailerFormatLabel,
        definition.sourceUrl,
        definition.label,
        ...(definition.appliesToRetailerFormats || []),
      ]).join(' ');
      return SPAR_REGEX.test(haystack);
    })
    .map(mapCodeSource);
}

function assessOfficialSparSteiermarkCoverage(codeSources = getSparCodeSources()) {
  const officialSources = codeSources.filter((source) =>
    source.channel === 'official-flyer' || /spar\.at\/aktionen/i.test(source.sourceUrl)
  );
  const exactSource = officialSources.find((source) =>
    String(source.sourceUrl || '').replace(/\/$/, '') === OFFICIAL_SPAR_STEIERMARK_URL.replace(/\/$/, '')
  );
  const equivalentEntry = officialSources.find((source) =>
    /spar\.at\/aktionen(?:\/|$)/i.test(source.sourceUrl || '')
  );

  return {
    referenceUrl: OFFICIAL_SPAR_STEIERMARK_URL,
    exactSourceExistsInCode: Boolean(exactSource),
    equivalentOfficialActionEntryExistsInCode: Boolean(equivalentEntry),
    existingOfficialEntries: officialSources.map((source) => ({
      sourceKey: source.sourceKey || '',
      sourceUrl: source.sourceUrl || '',
      channel: source.channel || '',
      appearsActive: Boolean(source.appearsActive),
      disabledReason: source.disabledReason || '',
      notes: source.notes || '',
    })),
    currentApplication:
      exactSource
        ? 'exact-url-present'
        : equivalentEntry
          ? 'generic-official-spar-actions-entry-present'
          : 'missing',
    suitabilityForFutureSupplementalSource: {
      suitable: true,
      reason: 'Official regional SPAR action source is suitable when the page is reachable and category promotion parsing yields trusted offers.',
      constraints: [
        'No login or protected access assumptions.',
        'Do not use aggregators as primary evidence when official action/PDF sources are reachable.',
        'Only successful complete action-source runs may replace previous active action offers.',
      ],
    },
  };
}

function summarizeOffer(offer = {}) {
  return {
    id: String(offer._id || ''),
    title: offer.title || '',
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
    sourceRetailerName: offer.sourceRetailerName || '',
    sourceRetailerFormat: offer.sourceRetailerFormat || '',
    appliesToRetailerFormats: offer.appliesToRetailerFormats || [],
    retailerFormatLabel: offer.retailerFormatLabel || '',
    sourceType: offer.sourceType || '',
    sourceKey: offer.rawFacts?.sourceKey || offer.rawFacts?.sourceMetadata?.sourceKey || '',
    sourceName: offer.rawFacts?.sourceName || offer.rawFacts?.sourceMetadata?.label || '',
    sourceUrl: offer.sourceUrl || '',
    sourceId: String(offer.sourceId || ''),
    categoryPrimary: offer.categoryPrimary || '',
    categorySecondary: offer.categorySecondary || '',
    categoryKey: offer.categoryKey || '',
    subcategoryKey: offer.subcategoryKey || '',
    priceCurrent: offer.priceCurrent?.amount ?? null,
    normalizedUnitPrice: offer.normalizedUnitPrice?.amount ?? null,
    normalizedUnit: offer.normalizedUnitPrice?.unit || offer.comparableUnit || '',
    quantityText: offer.quantityText || '',
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    status: offer.status || '',
    isActiveNow: Boolean(offer.isActiveNow),
    isActiveToday: Boolean(offer.isActiveToday),
    conditionsText: offer.conditionsText || '',
    comparisonSafe: Boolean(offer.quality?.comparisonSafe),
    reviewReasons: offer.reviewReasons || [],
  };
}

function inferLikelyRootCause({
  sparOffersInDb = 0,
  sparCoffeeOffersInDb = 0,
  activeSparOffersApprox = 0,
  activeSparCoffeeOffersApprox = 0,
  codeSources = [],
  possibleMisclassifiedCoffeeCandidates = [],
  possibleWrongRetailerCandidates = [],
  activeMissingValidityOrPrice = 0,
} = {}) {
  const activeOfficial = codeSources.some((source) =>
    source.channel === 'official-flyer' && source.appearsActive
  );

  if (sparOffersInDb === 0) return 'source-missing';
  if (!activeOfficial && sparCoffeeOffersInDb <= 1 && activeSparOffersApprox > 0) return 'source-disabled';
  if (possibleWrongRetailerCandidates.length > 0 && sparCoffeeOffersInDb === 0) return 'wrong-retailer-mapping';
  if (possibleMisclassifiedCoffeeCandidates.length > activeSparCoffeeOffersApprox) return 'wrong-category';
  if (activeMissingValidityOrPrice > 0 && activeSparCoffeeOffersApprox === 0) return 'validity-filter';
  if (sparOffersInDb > 0 && sparCoffeeOffersInDb === 0) return 'source-missing';

  return 'unclear';
}

function buildEvidence({ codeSources = [], db = {}, latestJobs = [], rawDocuments = [] } = {}) {
  const evidence = [];
  const activeAggregators = codeSources.filter((source) => source.channel === 'aggregator' && source.appearsActive);
  const disabledOfficial = codeSources.find((source) => source.channel === 'official-flyer' && !source.appearsActive);
  const officialSteiermark = assessOfficialSparSteiermarkCoverage(codeSources);

  evidence.push(`Code: ${activeAggregators.length} active-looking SPAR aggregator sources are defined.`);

  if (disabledOfficial) {
    evidence.push(`Code: official SPAR flyer/action source is disabled (${disabledOfficial.disabledReason || 'disabled'}): ${disabledOfficial.notes}`);
  }

  if (!officialSteiermark.exactSourceExistsInCode) {
    evidence.push(`Code: official regional SPAR Steiermark URL is not configured exactly (${OFFICIAL_SPAR_STEIERMARK_URL}).`);
  }

  evidence.push(`DB: ${db.sparOffersInDb || 0} SPAR-format offers found; ${db.sparCoffeeOffersInDb || 0} match coffee terms.`);

  const failedJobs = latestJobs.filter((job) => job.status === 'failed' || (job.errorMessages || []).length > 0);
  if (failedJobs.length > 0) {
    evidence.push(`DB: latest SPAR crawl jobs include ${failedJobs.length} failed/error job(s); inspect latestCrawlJobs for HTTP/parser details.`);
  }

  const emptyRawDocs = rawDocuments.filter((doc) => Number(doc.foundRawItems || 0) === 0 && Number(doc.parsedOffers || 0) === 0);
  if (emptyRawDocs.length > 0) {
    evidence.push(`DB: ${emptyRawDocs.length} recent SPAR raw document(s) report zero raw/parsed items.`);
  }

  return evidence;
}

function buildRecommendedNextActions({ likelyRootCause, hasOfficialSparFlyerCode }) {
  const actions = [];

  if (likelyRootCause === 'source-disabled' || !hasOfficialSparFlyerCode) {
    actions.push('Next fix block: add or repair a legal official SPAR flyer/action ingestion path as supplemental primary evidence, without weakening ranking filters.');
  }

  actions.push('Compare the latest active Aktionsfinder SPAR/INTERSPAR/EUROSPAR payload coverage against the visible SPAR flyer coffee products before changing parser logic.');
  actions.push('If official SPAR remains blocked, keep Aggregator offers but add a targeted source coverage audit for missing flyer-only coffee mechanics.');
  actions.push('Only after Offer documents exist with price, validity, quantity and condition fields should ranking/category behavior be revisited.');

  return [...new Set(actions)];
}

function buildSparSourceCoverageDiagnostic({
  checkedAt = new Date(),
  db = {},
  codeSources = getSparCodeSources(),
} = {}) {
  const hasOfficialSparFlyerCode = codeSources.some((source) => source.channel === 'official-flyer');
  const officialSparSteiermarkCoverage = assessOfficialSparSteiermarkCoverage(codeSources);
  const likelyRootCause = inferLikelyRootCause({
    sparOffersInDb: db.sparOffersInDb,
    sparCoffeeOffersInDb: db.sparCoffeeOffersInDb,
    activeSparOffersApprox: db.activeSparOffersApprox,
    activeSparCoffeeOffersApprox: db.activeSparCoffeeOffersApprox,
    codeSources,
    possibleMisclassifiedCoffeeCandidates: db.possibleMisclassifiedCoffeeCandidates || [],
    possibleWrongRetailerCandidates: db.possibleWrongRetailerCandidates || [],
    activeMissingValidityOrPrice: db.activeMissingValidityOrPrice || 0,
  });

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    performanceSafe: true,
    retailer: 'spar',
    checkedAt: checkedAt instanceof Date ? checkedAt.toISOString() : checkedAt,
    summary: {
      likelyRootCause,
      sparOffersInDb: Number(db.sparOffersInDb || 0),
      sparCoffeeOffersInDb: Number(db.sparCoffeeOffersInDb || 0),
      activeSparOffersApprox: Number(db.activeSparOffersApprox || 0),
      activeSparCoffeeOffersApprox: Number(db.activeSparCoffeeOffersApprox || 0),
      hasOfficialSparFlyerCode,
      activeOfficialSparFlyerSourceInCode: codeSources.some((source) => source.channel === 'official-flyer' && source.appearsActive),
      officialSparSteiermarkUrlInCode: officialSparSteiermarkCoverage.exactSourceExistsInCode,
      equivalentOfficialSparActionsEntryInCode: officialSparSteiermarkCoverage.equivalentOfficialActionEntryExistsInCode,
    },
    officialSparSteiermarkCoverage,
    codeSources,
    dbConfiguredSources: db.dbConfiguredSources || [],
    dbSourceBreakdown: db.dbSourceBreakdown || [],
    dbCategoryBreakdown: db.dbCategoryBreakdown || [],
    sparTopDbOffers: db.sparTopDbOffers || [],
    sparCoffeeDbCandidates: db.sparCoffeeDbCandidates || [],
    possibleMisclassifiedCoffeeCandidates: db.possibleMisclassifiedCoffeeCandidates || [],
    possibleWrongRetailerCandidates: db.possibleWrongRetailerCandidates || [],
    latestRawDocuments: db.latestRawDocuments || [],
    latestCrawlJobs: db.latestCrawlJobs || [],
    evidence: buildEvidence({
      codeSources,
      db,
      latestJobs: db.latestCrawlJobs || [],
      rawDocuments: db.latestRawDocuments || [],
    }),
    recommendedNextActions: buildRecommendedNextActions({ likelyRootCause, hasOfficialSparFlyerCode }),
  };
}

function selectOfferFields() {
  return [
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
    'title',
    'titleNormalized',
    'brand',
    'searchText',
    'categoryPrimary',
    'categorySecondary',
    'categoryKey',
    'subcategoryKey',
    'comparisonGroup',
    'priceCurrent',
    'normalizedUnitPrice',
    'quantityText',
    'comparableUnit',
    'conditionsText',
    'validFrom',
    'validTo',
    'status',
    'isActiveNow',
    'isActiveToday',
    'quality',
    'reviewReasons',
    'rawFacts',
    'sortScoreDefault',
  ].join(' ');
}

async function fetchSparSourceCoverageInputs({
  Offer,
  Source,
  RawDocument,
  CrawlJob,
  limit = DEFAULT_LIMIT,
} = {}) {
  const boundedLimit = Math.max(5, Math.min(Number(limit || DEFAULT_LIMIT), 100));
  const sparMatch = sparFieldMatch();
  const coffeeMatch = coffeeFieldMatch();
  const activeMatch = activeApproxMatch();
  const sparCoffeeMatch = { $and: [sparMatch, coffeeMatch] };
  const activeSparMatch = { $and: [sparMatch, activeMatch] };
  const activeSparCoffeeMatch = { $and: [sparMatch, coffeeMatch, activeMatch] };

  const [
    dbConfiguredSources,
    sparOffersInDb,
    sparCoffeeOffersInDb,
    activeSparOffersApprox,
    activeSparCoffeeOffersApprox,
    activeMissingValidityOrPriceRows,
    dbSourceBreakdown,
    dbCategoryBreakdown,
    sparTopDbOffers,
    sparCoffeeDbCandidates,
    possibleMisclassifiedCoffeeCandidates,
    latestRawDocuments,
    latestCrawlJobs,
  ] = await Promise.all([
    Source.find({
      $or: [
        { retailerKey: SPAR_REGEX },
        { retailerName: SPAR_REGEX },
        { sourceRetailerName: SPAR_REGEX },
        { sourceRetailerFormat: SPAR_REGEX },
        { sourceUrl: SPAR_SOURCE_URL_REGEX },
        { label: SPAR_REGEX },
      ],
    })
      .sort({ enabled: -1, channel: 1, label: 1 })
      .limit(80)
      .select('retailerKey retailerName channel label sourceRetailerName sourceRetailerFormat appliesToRetailerFormats retailerFormatLabel sourceUrl sourceType enabled active latestRunAt latestStatus disabledReason parserHint parserVersion notes')
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean(),
    Offer.countDocuments(sparMatch).maxTimeMS(QUERY_MAX_TIME_MS),
    Offer.countDocuments(sparCoffeeMatch).maxTimeMS(QUERY_MAX_TIME_MS),
    Offer.countDocuments(activeSparMatch).maxTimeMS(QUERY_MAX_TIME_MS),
    Offer.countDocuments(activeSparCoffeeMatch).maxTimeMS(QUERY_MAX_TIME_MS),
    Offer.aggregate([
      { $match: activeSparCoffeeMatch },
      {
        $match: {
          $or: [
            { 'priceCurrent.amount': { $in: [null, 0] } },
            { validTo: null },
            { status: { $nin: ['active'] } },
          ],
        },
      },
      { $count: 'count' },
    ]).option({ maxTimeMS: QUERY_MAX_TIME_MS }),
    Offer.aggregate([
      { $match: sparMatch },
      {
        $group: {
          _id: {
            retailerKey: '$retailerKey',
            retailerName: '$retailerName',
            sourceType: '$sourceType',
            sourceId: '$sourceId',
            sourceUrl: '$sourceUrl',
            sourceRetailerFormat: '$sourceRetailerFormat',
          },
          offers: { $sum: 1 },
          activeOffersApprox: { $sum: { $cond: ['$isActiveNow', 1, 0] } },
          coffeeOffers: {
            $sum: {
              $cond: [
                {
                  $regexMatch: {
                    input: {
                      $concat: [
                        { $ifNull: ['$title', ''] },
                        ' ',
                        { $ifNull: ['$titleNormalized', ''] },
                        ' ',
                        { $ifNull: ['$brand', ''] },
                        ' ',
                        { $ifNull: ['$searchText', ''] },
                        ' ',
                        { $ifNull: ['$categorySecondary', ''] },
                        ' ',
                        { $ifNull: ['$comparisonGroup', ''] },
                      ],
                    },
                    regex: COFFEE_REGEX,
                  },
                },
                1,
                0,
              ],
            },
          },
          sampleTitle: { $first: '$title' },
        },
      },
      { $sort: { offers: -1 } },
      { $limit: 60 },
    ]).option({ maxTimeMS: QUERY_MAX_TIME_MS }),
    Offer.aggregate([
      { $match: sparMatch },
      {
        $group: {
          _id: {
            categoryKey: '$categoryKey',
            categoryPrimary: '$categoryPrimary',
            categorySecondary: '$categorySecondary',
            subcategoryKey: '$subcategoryKey',
          },
          offers: { $sum: 1 },
          activeOffersApprox: { $sum: { $cond: ['$isActiveNow', 1, 0] } },
          sampleTitle: { $first: '$title' },
        },
      },
      { $sort: { offers: -1 } },
      { $limit: 40 },
    ]).option({ maxTimeMS: QUERY_MAX_TIME_MS }),
    Offer.find(sparMatch)
      .sort({ isActiveNow: -1, isActiveToday: -1, sortScoreDefault: -1, updatedAt: -1 })
      .limit(Math.min(boundedLimit, 25))
      .select(selectOfferFields())
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean(),
    Offer.find(sparCoffeeMatch)
      .sort({ isActiveNow: -1, isActiveToday: -1, sortScoreDefault: -1, updatedAt: -1 })
      .limit(boundedLimit)
      .select(selectOfferFields())
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean(),
    Offer.find({
      $and: [
        sparMatch,
        coffeeMatch,
        {
          $or: [
            { categoryKey: { $ne: 'kaffee-tee' } },
            { categoryKey: { $in: [null, ''] } },
            { comparisonGroup: { $in: [null, ''] } },
          ],
        },
      ],
    })
      .sort({ isActiveNow: -1, updatedAt: -1 })
      .limit(Math.min(boundedLimit, 30))
      .select(selectOfferFields())
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean(),
    RawDocument.find({
      $or: [
        { retailerKey: SPAR_REGEX },
        { url: SPAR_SOURCE_URL_REGEX },
        { finalUrl: SPAR_SOURCE_URL_REGEX },
        { canonicalUrl: SPAR_SOURCE_URL_REGEX },
      ],
    })
      .sort({ fetchedAt: -1 })
      .limit(12)
      .select('retailerKey sourceId sourceType documentType url finalUrl title fetchedAt httpStatus contentType foundRawItems parsedOffers rejectedOffers parserVersion payload')
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean(),
    CrawlJob.find({
      $or: [
        { retailerKey: SPAR_REGEX },
        { sourceUrl: SPAR_SOURCE_URL_REGEX },
      ],
    })
      .sort({ startedAt: -1 })
      .limit(12)
      .select('retailerKey sourceId status sourceType sourceUrl parserVersion startedAt finishedAt stats httpLog warningMessages errorMessages metadata')
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean(),
  ]);

  const sparSourceIds = dbConfiguredSources.map((source) => source._id).filter(Boolean);
  const possibleWrongRetailerCandidates = await Offer.find({
    $and: [
      coffeeMatch,
      { $nor: [sparMatch] },
      {
        $or: [
          { sourceId: { $in: sparSourceIds } },
          { sourceUrl: SPAR_SOURCE_URL_REGEX },
          { 'rawFacts.sourceMetadata.sourceUrl': SPAR_SOURCE_URL_REGEX },
        ],
      },
    ],
  })
    .sort({ isActiveNow: -1, updatedAt: -1 })
    .limit(Math.min(boundedLimit, 30))
    .select(selectOfferFields())
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();

  return {
    sparOffersInDb,
    sparCoffeeOffersInDb,
    activeSparOffersApprox,
    activeSparCoffeeOffersApprox,
    activeMissingValidityOrPrice: activeMissingValidityOrPriceRows[0]?.count || 0,
    dbConfiguredSources: dbConfiguredSources.map((source) => ({
      sourceId: String(source._id || ''),
      retailerKey: source.retailerKey || '',
      retailerName: source.retailerName || '',
      channel: source.channel || '',
      label: source.label || '',
      sourceRetailerName: source.sourceRetailerName || '',
      sourceRetailerFormat: source.sourceRetailerFormat || '',
      appliesToRetailerFormats: source.appliesToRetailerFormats || [],
      retailerFormatLabel: source.retailerFormatLabel || '',
      sourceUrl: source.sourceUrl || '',
      sourceType: source.sourceType || '',
      enabled: source.enabled !== false,
      active: source.active !== false,
      latestRunAt: source.latestRunAt || null,
      latestStatus: source.latestStatus || '',
      disabledReason: source.disabledReason || '',
      parserHint: source.parserHint || '',
      parserVersion: source.parserVersion || '',
      notes: source.notes || '',
    })),
    dbSourceBreakdown: dbSourceBreakdown.map((row) => ({
      retailerKey: row._id?.retailerKey || '',
      retailerName: row._id?.retailerName || '',
      sourceType: row._id?.sourceType || '',
      sourceId: String(row._id?.sourceId || ''),
      sourceUrl: row._id?.sourceUrl || '',
      sourceRetailerFormat: row._id?.sourceRetailerFormat || '',
      offers: row.offers || 0,
      activeOffersApprox: row.activeOffersApprox || 0,
      coffeeOffers: row.coffeeOffers || 0,
      sampleTitle: row.sampleTitle || '',
    })),
    dbCategoryBreakdown: dbCategoryBreakdown.map((row) => ({
      categoryKey: row._id?.categoryKey || '',
      categoryPrimary: row._id?.categoryPrimary || '',
      categorySecondary: row._id?.categorySecondary || '',
      subcategoryKey: row._id?.subcategoryKey || '',
      offers: row.offers || 0,
      activeOffersApprox: row.activeOffersApprox || 0,
      sampleTitle: row.sampleTitle || '',
    })),
    sparTopDbOffers: sparTopDbOffers.map(summarizeOffer),
    sparCoffeeDbCandidates: sparCoffeeDbCandidates.map(summarizeOffer),
    possibleMisclassifiedCoffeeCandidates: possibleMisclassifiedCoffeeCandidates.map(summarizeOffer),
    possibleWrongRetailerCandidates: possibleWrongRetailerCandidates.map(summarizeOffer),
    latestRawDocuments: latestRawDocuments.map((doc) => ({
      id: String(doc._id || ''),
      retailerKey: doc.retailerKey || '',
      sourceId: String(doc.sourceId || ''),
      sourceType: doc.sourceType || '',
      documentType: doc.documentType || '',
      url: doc.url || '',
      finalUrl: doc.finalUrl || '',
      title: doc.title || '',
      fetchedAt: doc.fetchedAt || null,
      httpStatus: doc.httpStatus ?? null,
      contentType: doc.contentType || '',
      foundRawItems: doc.foundRawItems || 0,
      parsedOffers: doc.parsedOffers || 0,
      rejectedOffers: doc.rejectedOffers || 0,
      parserVersion: doc.parserVersion || '',
      payload: {
        promotionCount: doc.payload?.promotionCount ?? null,
        categoryPageCount: doc.payload?.categoryPageCount ?? null,
        categoryPagePromotionCount: doc.payload?.categoryPagePromotionCount ?? null,
        linkCount: doc.payload?.linkCount ?? null,
        pdfLinkCount: doc.payload?.pdfLinkCount ?? null,
      },
    })),
    latestCrawlJobs: latestCrawlJobs.map((job) => ({
      id: String(job._id || ''),
      retailerKey: job.retailerKey || '',
      sourceId: String(job.sourceId || ''),
      status: job.status || '',
      sourceType: job.sourceType || '',
      sourceUrl: job.sourceUrl || '',
      parserVersion: job.parserVersion || '',
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      stats: job.stats || {},
      httpLog: job.httpLog || {},
      warningMessages: job.warningMessages || [],
      errorMessages: job.errorMessages || [],
      metadata: {
        rawDocumentId: job.metadata?.rawDocumentId || '',
        essence: job.metadata?.essence || '',
      },
    })),
  };
}

module.exports = {
  COFFEE_TERMS,
  SPAR_TERMS,
  activeApproxMatch,
    buildSparSourceCoverageDiagnostic,
  assessOfficialSparSteiermarkCoverage,
  coffeeFieldMatch,
  deriveSourceKey,
  fetchSparSourceCoverageInputs,
  getSparCodeSources,
  inferLikelyRootCause,
  mapCodeSource,
  sparFieldMatch,
  summarizeOffer,
};
