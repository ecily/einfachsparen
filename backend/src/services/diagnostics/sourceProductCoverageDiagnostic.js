const { buildQuerySearchTokens } = require('../offers/searchTokens');
const { normalizeTitleForMatch } = require('../crawl/sourceEvidence');
const {
  CORE_PRODUCT_QUERIES,
  classifyCoreOffer,
} = require('./coreProductCoverageDiagnostic');

const DEFAULT_LIMIT = 500;
const QUERY_MAX_TIME_MS = 3000;
const TARGET_RETAILERS = ['spar', 'eurospar', 'interspar', 'billa', 'billa-plus', 'penny', 'hofer', 'lidl', 'dm', 'bipa'];
const FALSE_POSITIVE_KEYS = ['eier', 'oel', 'fleisch', 'obst', 'gemuese'];

const FALSE_POSITIVE_PATTERNS = {
  eier: [
    ['soup-or-pasta-shape', ['eiermuschel', 'eiermuschelsuppe']],
    ['salad-or-prepared-food', ['eiersalat']],
    ['seasonal-candy', ['osterei', 'schokoeier']],
    ['word-fragment', ['steiermark', 'schleierkraut']],
  ],
  oel: [
    ['hair-cosmetics', ['haaroel', 'oleo', 'haarfarbe', 'coloration']],
    ['ingredient-context', ['in oel', 'mit oel', 'frischkaese', 'thunfisch']],
    ['non-food-technical', ['motoroel']],
  ],
  fleisch: [
    ['plant-variety', ['fleischtomaten', 'fleisch oder ovaltomaten', 'tomatenpflanzen']],
    ['dental-care-fragment', ['zahnfleisch', 'mundspuelung']],
    ['prepared-or-substitute', ['fleischersatz', 'pflanzlich', 'moussaka']],
    ['animal-food', ['hundefutter', 'katzenfutter']],
  ],
  obst: [
    ['dishwasher-tabs-fruit-scent', ['zitrone', 'limette', 'geschirrspuel']],
    ['plants-not-fruit', ['salatpflanzen', 'pflanzen']],
    ['fruit-bar-or-dessert', ['obstriegel', 'obstgarten']],
  ],
  gemuese: [
    ['ingredient-context', ['in gemuese', 'mit gemuese', 'thunfisch']],
    ['seasoning-or-soup', ['gemuesesuppe', 'gewuerz']],
  ],
};

function compact(values = []) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function unique(values = []) {
  return [...new Set(compact(values))];
}

function normalize(value) {
  return normalizeTitleForMatch(value);
}

function textForOffer(offer = {}) {
  return compact([
    offer.title,
    offer.titleNormalized,
    offer.brand,
    offer.searchText,
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.categoryKey,
    offer.subcategoryKey,
    offer.comparisonGroup,
    Array.isArray(offer.searchTokens) ? offer.searchTokens.join(' ') : '',
  ]).join(' ');
}

function rawText(doc = {}) {
  return compact([
    doc.title,
    doc.contentSnippet,
    ...(doc.extractedPreview || []),
    ...(doc.payload?.sampleNames || []),
    ...(doc.payload?.sampleTitles || []),
    ...(doc.payload?.sampleTexts || []),
  ]).join(' ');
}

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function regexForTerms(terms = []) {
  const escaped = unique(terms).map(escapeRegexLiteral).filter(Boolean);
  return new RegExp(escaped.length > 0 ? escaped.join('|') : '$a', 'i');
}

function buildActiveMatch(now = new Date()) {
  return {
    $or: [
      { status: 'active', isActiveNow: true },
      { isActiveNow: true },
      { isActiveToday: true },
      {
        status: 'active',
        $or: [{ validTo: { $gte: now } }, { validTo: null }],
      },
    ],
  };
}

function normalizeQueryKey(query = '') {
  return String(query || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function definitionForQuery(query = 'butter') {
  const rawQuery = String(query || '').trim() || 'butter';
  const normalized = normalize(rawQuery);
  const knownDefinition = CORE_PRODUCT_QUERIES.find((item) =>
    item.key === normalized ||
    normalize(item.query) === normalized ||
    normalizeQueryKey(item.key) === normalizeQueryKey(rawQuery)
  );

  if (knownDefinition) {
    return knownDefinition;
  }

  return {
    key: normalizeQueryKey(rawQuery) || normalized || 'custom',
    query: rawQuery,
    trueTerms: [rawQuery],
    sideTerms: [],
    requiredContext: [],
  };
}

function allDefinitionTerms(definition = {}) {
  return unique([
    definition.query,
    ...(definition.trueTerms || []),
    ...(definition.sideTerms || []),
  ]);
}

function trueDefinitionTerms(definition = {}) {
  return unique([
    definition.query,
    ...(definition.trueTerms || []),
  ]);
}

function sideDefinitionTerms(definition = {}) {
  return unique(definition.sideTerms || []);
}

function offerFindMatch(definition = {}) {
  const regex = regexForTerms(allDefinitionTerms(definition));
  const queryTokens = buildQuerySearchTokens(definition.query);
  const termTokens = allDefinitionTerms(definition).map(normalize).filter(Boolean);

  return {
    ...buildActiveMatch(),
    $and: [
      {
        $or: [
          { searchTokens: { $in: unique([...queryTokens, ...termTokens]) } },
          { title: regex },
          { titleNormalized: regex },
          { comparisonGroup: regex },
        ],
      },
    ],
  };
}

function selectOfferFields() {
  return [
    '_id',
    'crawlJobId',
    'sourceId',
    'retailerKey',
    'retailerName',
    'sourceType',
    'sourceKey',
    'sourceUrl',
    'title',
    'titleNormalized',
    'brand',
    'searchText',
    'searchTokens',
    'searchTokenVersion',
    'categoryPrimary',
    'categorySecondary',
    'categoryKey',
    'subcategoryKey',
    'comparisonGroup',
    'priceCurrent',
    'validFrom',
    'validTo',
    'validityLabel',
    'status',
    'isActiveNow',
    'isActiveToday',
    'quality',
    'reviewReasons',
    'rawFacts.sourceKey',
    'rawFacts.channel',
    'rawFacts.sourceMetadata',
    'dedupeKey',
    'offerKey',
  ].join(' ');
}

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function sourceKeyFor(offer = {}, source = {}) {
  return offer.sourceKey ||
    offer.rawFacts?.sourceKey ||
    offer.rawFacts?.sourceMetadata?.sourceKey ||
    source.label ||
    source.sourceKey ||
    '';
}

function summarizeOffer(offer = {}, source = {}, definition = {}) {
  const classification = classifyCoreOffer(offer, definition);

  return {
    id: String(offer._id || ''),
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
    sourceKey: sourceKeyFor(offer, source),
    sourceType: offer.sourceType || source.sourceType || '',
    channel: offer.rawFacts?.channel || offer.rawFacts?.sourceMetadata?.channel || source.channel || '',
    sourceId: String(offer.sourceId || ''),
    crawlJobId: String(offer.crawlJobId || ''),
    title: offer.title || '',
    classification: classification.classification,
    classificationReason: classification.reason,
    categoryPrimary: offer.categoryPrimary || '',
    categorySecondary: offer.categorySecondary || '',
    categoryKey: offer.categoryKey || '',
    subcategoryKey: offer.subcategoryKey || '',
    price: offer.priceCurrent?.amount ?? null,
    validity: {
      validFrom: dateKey(offer.validFrom),
      validTo: dateKey(offer.validTo),
      label: offer.validityLabel || offer.rawFacts?.validityLabel || '',
    },
    qualityIssues: offer.quality?.issues || [],
    reviewReasons: offer.reviewReasons || [],
    dedupeKey: offer.dedupeKey || '',
    searchTokens: Array.isArray(offer.searchTokens) ? offer.searchTokens.slice(0, 20) : [],
  };
}

function classifyRawDocument(doc = {}, definition = {}) {
  const text = rawText(doc);
  const pseudoOffer = {
    title: text,
    titleNormalized: normalize(text),
    searchText: text,
    searchTokens: normalize(text).split(/\s+/).filter(Boolean),
  };
  const classification = classifyCoreOffer(pseudoOffer, definition);

  return {
    classification: classification.classification,
    reason: classification.reason,
    matchedTrueTerms: trueDefinitionTerms(definition).filter((term) => normalize(text).includes(normalize(term))).slice(0, 10),
    matchedSideTerms: sideDefinitionTerms(definition).filter((term) => normalize(text).includes(normalize(term))).slice(0, 10),
  };
}

function summarizeRawDocument(doc = {}, source = {}, definition = {}) {
  const classification = classifyRawDocument(doc, definition);

  return {
    id: String(doc._id || ''),
    retailerKey: doc.retailerKey || '',
    sourceKey: source.label || '',
    sourceType: doc.sourceType || source.sourceType || '',
    channel: source.channel || '',
    sourceId: String(doc.sourceId || ''),
    crawlJobId: String(doc.crawlJobId || ''),
    documentType: doc.documentType || '',
    title: doc.title || '',
    fetchedAt: dateKey(doc.fetchedAt),
    httpStatus: doc.httpStatus ?? null,
    foundRawItems: Number(doc.foundRawItems || 0),
    parsedOffers: Number(doc.parsedOffers || 0),
    rejectedOffers: Number(doc.rejectedOffers || 0),
    parserVersion: doc.parserVersion || '',
    rejectionReasons: (doc.rejectionReasons || []).map((item) => ({
      reason: item.reason || '',
      count: Number(item.count || 0),
    })),
    classification: classification.classification,
    classificationReason: classification.reason,
    matchedTrueTerms: classification.matchedTrueTerms,
    matchedSideTerms: classification.matchedSideTerms,
    extractedPreview: (doc.extractedPreview || []).slice(0, 5),
    payloadSummary: {
      promotionCount: doc.payload?.promotionCount ?? null,
      categoryPageCount: doc.payload?.categoryPageCount ?? null,
      categoryPagePromotionCount: doc.payload?.categoryPagePromotionCount ?? null,
      hitCount: doc.payload?.hitCount ?? null,
      sampleNames: (doc.payload?.sampleNames || []).slice(0, 5),
      sampleTitles: (doc.payload?.sampleTitles || []).slice(0, 5),
      sampleTexts: (doc.payload?.sampleTexts || []).slice(0, 5),
    },
  };
}

function summarizeCrawlJob(job = {}, source = {}) {
  return {
    id: String(job._id || ''),
    retailerKey: job.retailerKey || source.retailerKey || '',
    sourceKey: source.label || '',
    sourceType: job.sourceType || source.sourceType || '',
    channel: source.channel || '',
    sourceId: String(job.sourceId || source._id || ''),
    status: job.status || '',
    startedAt: dateKey(job.startedAt),
    finishedAt: dateKey(job.finishedAt),
    foundRawItems: Number(job.stats?.foundRawItems || 0),
    parsedOffers: Number(job.stats?.parsedOffers || job.stats?.offersExtracted || 0),
    offersStored: Number(job.stats?.offersStored || job.stats?.productiveOffers || 0),
    rejectedOffers: Number(job.stats?.rejectedOffers || 0),
    rawDocuments: Number(job.stats?.rawDocuments || 0),
    rejectionReasons: (job.rejectionReasons || []).map((item) => ({
      reason: item.reason || '',
      count: Number(item.count || 0),
    })),
    warningMessages: (job.warningMessages || []).slice(0, 5),
    errorMessages: (job.errorMessages || []).slice(0, 3),
  };
}

function emptyRetailerRow(retailerKey) {
  return {
    retailerKey,
    sourceCount: 0,
    latestCrawlJobs: [],
    activeOfferSignals: 0,
    trueActiveOffers: 0,
    sideOrUnclearActiveOffers: 0,
    rawDocumentsWithSignal: 0,
    trueRawDocuments: 0,
    rawParserLossDocuments: 0,
    sourceStatus: 'no-source-evidence',
  };
}

function inferRetailerSourceStatus(row = {}) {
  if (row.trueActiveOffers > 0) return 'true-active-offer-visible';
  if (row.trueRawDocuments > 0 && row.rawParserLossDocuments > 0) return 'raw-true-evidence-parser-loss';
  if (row.trueRawDocuments > 0) return 'raw-true-evidence-no-active-offer';
  if (row.rawDocumentsWithSignal > 0 || row.activeOfferSignals > 0) return 'only-side-or-unclear-signals';
  if (row.sourceCount > 0) return 'sources-present-no-product-evidence';
  return 'no-source-configured';
}

function buildRetailerCoverage({ sources = [], crawlJobs = [], offers = [], rawDocuments = [], definition = {} } = {}) {
  const rows = new Map(TARGET_RETAILERS.map((retailerKey) => [retailerKey, emptyRetailerRow(retailerKey)]));

  for (const source of sources) {
    const retailerKey = source.retailerKey || 'unknown';
    if (!rows.has(retailerKey)) rows.set(retailerKey, emptyRetailerRow(retailerKey));
    rows.get(retailerKey).sourceCount += 1;
  }

  for (const job of crawlJobs) {
    const retailerKey = job.retailerKey || 'unknown';
    if (!rows.has(retailerKey)) rows.set(retailerKey, emptyRetailerRow(retailerKey));
    rows.get(retailerKey).latestCrawlJobs.push(job);
  }

  for (const offer of offers) {
    const retailerKey = offer.retailerKey || 'unknown';
    const classification = classifyCoreOffer(offer, definition).classification;
    if (!rows.has(retailerKey)) rows.set(retailerKey, emptyRetailerRow(retailerKey));
    rows.get(retailerKey).activeOfferSignals += 1;
    if (classification === 'true') {
      rows.get(retailerKey).trueActiveOffers += 1;
    } else {
      rows.get(retailerKey).sideOrUnclearActiveOffers += 1;
    }
  }

  for (const doc of rawDocuments) {
    const retailerKey = doc.retailerKey || 'unknown';
    const classification = classifyRawDocument(doc, definition).classification;
    if (!rows.has(retailerKey)) rows.set(retailerKey, emptyRetailerRow(retailerKey));
    rows.get(retailerKey).rawDocumentsWithSignal += 1;
    if (classification === 'true') {
      rows.get(retailerKey).trueRawDocuments += 1;
      if (Number(doc.foundRawItems || 0) > Number(doc.parsedOffers || 0)) {
        rows.get(retailerKey).rawParserLossDocuments += 1;
      }
    }
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      latestCrawlJobs: row.latestCrawlJobs.slice(0, 3),
      sourceStatus: inferRetailerSourceStatus(row),
    }))
    .sort((left, right) => TARGET_RETAILERS.indexOf(left.retailerKey) - TARGET_RETAILERS.indexOf(right.retailerKey));
}

function classifyFalsePositiveTitle(key, title) {
  const normalized = normalize(title);
  for (const [className, terms] of FALSE_POSITIVE_PATTERNS[key] || []) {
    if (terms.some((term) => normalized.includes(normalize(term)))) {
      return className;
    }
  }
  return 'other-side-or-broad-context';
}

function buildFalsePositiveClasses(cases = []) {
  return cases
    .filter((item) => FALSE_POSITIVE_KEYS.includes(item.key))
    .map((item) => {
      const groups = new Map();
      for (const offer of item.offers || []) {
        const classification = classifyCoreOffer(offer, item.definition).classification;
        const className = classifyFalsePositiveTitle(item.key, offer.title || offer.titleNormalized || '');
        if (classification === 'true' && className === 'other-side-or-broad-context') continue;
        const group = groups.get(className) || { className, count: 0, examples: [] };
        group.count += 1;
        if (group.examples.length < 5) {
          group.examples.push({
            title: offer.title || '',
            retailerKey: offer.retailerKey || '',
            categorySecondary: offer.categorySecondary || '',
          });
        }
        groups.set(className, group);
      }

      return {
        key: item.key,
        topClasses: [...groups.values()].sort((left, right) => right.count - left.count).slice(0, 6),
      };
    });
}

function inferProductRootCause({ offers = [], rawDocuments = [], definition = {} } = {}) {
  const offerClassifications = offers.map((offer) => classifyCoreOffer(offer, definition).classification);
  const rawClassifications = rawDocuments.map((doc) => classifyRawDocument(doc, definition));
  const trueOffers = offerClassifications.filter((item) => item === 'true').length;
  const trueRawDocs = rawClassifications.filter((item) => item.classification === 'true').length;
  const parserLoss = rawDocuments.some((doc, index) =>
    rawClassifications[index]?.classification === 'true' &&
    Number(doc.foundRawItems || 0) > Number(doc.parsedOffers || 0)
  );

  if (trueOffers > 0) return 'true-active-offer-exists';
  if (trueRawDocs > 0 && parserLoss) return 'raw-true-evidence-parser-loss';
  if (trueRawDocs > 0) return 'raw-true-evidence-no-active-offer';
  if (offers.length > 0 || rawDocuments.length > 0) return 'only-side-or-unclear-evidence';
  return 'no-source-evidence-found';
}

async function fetchSources(Source) {
  return Source.find({ retailerKey: { $in: TARGET_RETAILERS } })
    .select('_id retailerKey retailerName channel label sourceType sourceUrl enabled active latestRunAt latestStatus parserHint parserVersion')
    .sort({ retailerKey: 1, priority: 1, label: 1 })
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

async function fetchLatestCrawlJobs(CrawlJob, sourceIds = []) {
  if (!CrawlJob || sourceIds.length === 0) return [];
  return CrawlJob.find({ sourceId: { $in: sourceIds } })
    .select('_id sourceId retailerKey status startedAt finishedAt stats sourceType parserVersion rejectionReasons warningMessages errorMessages')
    .sort({ startedAt: -1 })
    .limit(300)
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

async function fetchLatestCrawlRun(CrawlRun) {
  if (!CrawlRun) return null;
  return CrawlRun.findOne({})
    .select('_id status trigger mode dryRun startedAt finishedAt summary perRetailer result.sources result.filterMetadata warnings errorMessages')
    .sort({ createdAt: -1 })
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

async function fetchOffers(Offer, definition, limit) {
  return Offer.find(offerFindMatch(definition))
    .select(selectOfferFields())
    .sort({ isActiveNow: -1, isActiveToday: -1, sortScoreDefault: -1, updatedAt: -1 })
    .limit(Math.max(100, Math.min(Number(limit || DEFAULT_LIMIT), 3000)))
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

async function fetchRawDocuments(RawDocument, definition, limit) {
  if (!RawDocument) return [];
  const regex = regexForTerms(allDefinitionTerms(definition));
  return RawDocument.find({
    retailerKey: { $in: TARGET_RETAILERS },
    $or: [
      { title: regex },
      { contentSnippet: regex },
      { extractedPreview: regex },
      { 'payload.sampleNames': regex },
      { 'payload.sampleTitles': regex },
      { 'payload.sampleTexts': regex },
    ],
  })
    .select('_id sourceId crawlJobId retailerKey sourceType documentType title fetchedAt httpStatus foundRawItems parsedOffers rejectedOffers parserVersion rejectionReasons contentSnippet extractedPreview payload')
    .sort({ fetchedAt: -1 })
    .limit(Math.max(50, Math.min(Number(limit || DEFAULT_LIMIT), 1000)))
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

function buildSourceMap(sources = []) {
  return new Map(sources.map((source) => [String(source._id || ''), source]));
}

function latestJobsBySource(crawlJobs = []) {
  const map = new Map();
  for (const job of crawlJobs) {
    const key = String(job.sourceId || '');
    if (!map.has(key)) map.set(key, job);
  }
  return map;
}

async function buildSourceProductCoverageDiagnostic({
  query = 'butter',
  Offer,
  Source,
  RawDocument,
  CrawlJob,
  CrawlRun,
  limit = DEFAULT_LIMIT,
} = {}) {
  const definition = definitionForQuery(query);
  const [sources, offers, rawDocuments, latestCrawlRun] = await Promise.all([
    fetchSources(Source),
    fetchOffers(Offer, definition, limit),
    fetchRawDocuments(RawDocument, definition, limit),
    fetchLatestCrawlRun(CrawlRun),
  ]);
  const sourceIds = sources.map((source) => source._id).filter(Boolean);
  const crawlJobs = await fetchLatestCrawlJobs(CrawlJob, sourceIds);
  const sourcesById = buildSourceMap(sources);
  const jobsBySource = latestJobsBySource(crawlJobs);
  const summarizedOffers = offers.map((offer) =>
    summarizeOffer(offer, sourcesById.get(String(offer.sourceId || '')) || {}, definition)
  );
  const summarizedRawDocuments = rawDocuments.map((doc) =>
    summarizeRawDocument(doc, sourcesById.get(String(doc.sourceId || '')) || {}, definition)
  );
  const falsePositiveCases = [];

  for (const key of FALSE_POSITIVE_KEYS) {
    const fpDefinition = definitionForQuery(key);
    falsePositiveCases.push({
      key,
      definition: fpDefinition,
      offers: await fetchOffers(Offer, fpDefinition, 250),
    });
  }

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    crawlStarted: false,
    generatedAt: new Date().toISOString(),
    query: definition.query,
    key: definition.key,
    queryTokens: buildQuerySearchTokens(definition.query),
    rootCause: inferProductRootCause({ offers, rawDocuments, definition }),
    latestCrawlRun: latestCrawlRun ? {
      id: String(latestCrawlRun._id || ''),
      status: latestCrawlRun.status || '',
      mode: latestCrawlRun.mode || '',
      dryRun: Boolean(latestCrawlRun.dryRun),
      startedAt: dateKey(latestCrawlRun.startedAt),
      finishedAt: dateKey(latestCrawlRun.finishedAt),
      summary: latestCrawlRun.summary || {},
      filterMetadataOk: latestCrawlRun.result?.filterMetadata?.ok ?? null,
    } : null,
    activeOfferSignals: summarizedOffers,
    activeOfferSummary: {
      total: summarizedOffers.length,
      true: summarizedOffers.filter((item) => item.classification === 'true').length,
      sideHit: summarizedOffers.filter((item) => item.classification === 'sideHit').length,
      unclear: summarizedOffers.filter((item) => item.classification === 'unclear').length,
    },
    rawDocuments: summarizedRawDocuments,
    rawDocumentSummary: {
      total: summarizedRawDocuments.length,
      true: summarizedRawDocuments.filter((item) => item.classification === 'true').length,
      sideHit: summarizedRawDocuments.filter((item) => item.classification === 'sideHit').length,
      unclear: summarizedRawDocuments.filter((item) => item.classification === 'unclear').length,
    },
    sourceStats: sources.map((source) => ({
      sourceId: String(source._id || ''),
      retailerKey: source.retailerKey || '',
      retailerName: source.retailerName || '',
      sourceKey: source.label || '',
      sourceType: source.sourceType || '',
      channel: source.channel || '',
      enabled: Boolean(source.enabled),
      active: Boolean(source.active),
      latestStatus: source.latestStatus || '',
      latestRunAt: dateKey(source.latestRunAt),
      latestCrawlJob: summarizeCrawlJob(jobsBySource.get(String(source._id || '')) || {}, source),
    })),
    retailerCoverage: buildRetailerCoverage({
      sources,
      crawlJobs: crawlJobs.map((job) => summarizeCrawlJob(job, sourcesById.get(String(job.sourceId || '')) || {})),
      offers,
      rawDocuments,
      definition,
    }),
    falsePositivePreparation: buildFalsePositiveClasses(falsePositiveCases),
  };
}

function readNextValue(argv, index) {
  const next = argv[index + 1];
  return next && !String(next).startsWith('--') ? String(next).trim() : '';
}

function parseArgs(argv = []) {
  const options = {
    query: 'butter',
    json: false,
    limit: DEFAULT_LIMIT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '');

    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--query') {
      const query = readNextValue(argv, index);
      if (query) {
        options.query = query;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--query=')) {
      const query = arg.slice('--query='.length).trim();
      if (query) options.query = query;
      continue;
    }
    if (arg === '--limit') {
      const limit = Number(readNextValue(argv, index));
      if (Number.isInteger(limit) && limit >= 50 && limit <= 3000) {
        options.limit = limit;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const limit = Number(arg.slice('--limit='.length));
      if (Number.isInteger(limit) && limit >= 50 && limit <= 3000) {
        options.limit = limit;
      }
      continue;
    }
    if (!arg.startsWith('--') && arg.trim()) {
      options.query = arg.trim();
    }
  }

  return options;
}

module.exports = {
  FALSE_POSITIVE_KEYS,
  TARGET_RETAILERS,
  buildFalsePositiveClasses,
  buildSourceProductCoverageDiagnostic,
  classifyFalsePositiveTitle,
  classifyRawDocument,
  definitionForQuery,
  inferProductRootCause,
  normalizeQueryKey,
  parseArgs,
};
