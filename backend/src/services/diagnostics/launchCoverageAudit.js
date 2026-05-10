const { RETAILER_DEFINITIONS } = require('../sources/sourceDefinitions');
const {
  QUERY_TERMS,
  buildQueryQualityGapsDiagnostic,
  classifyButterOffer,
  classifyRiceOffer,
  summarizeOffer,
} = require('./queryQualityGapsDiagnostic');
const {
  buildSparSourceCoverageDiagnostic,
  fetchSparSourceCoverageInputs,
  getSparCodeSources,
} = require('./sparSourceCoverageDiagnostic');
const {
  OFFICIAL_RETAILERS,
  buildOfficialSourceMatrix,
} = require('./officialSourceMatrixDiagnostic');
const {
  buildOfficialValidityCoverageDiagnostic,
} = require('./officialValidityCoverageDiagnostic');

const QUERY_MAX_TIME_MS = 1500;
const DEFAULT_LIMIT = 700;

const PAGRO_OFFICIAL_URL = 'https://www.pagro.at/angebote';

function compact(values = []) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function unique(values = []) {
  return [...new Set(compact(values))];
}

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegex(terms = []) {
  return new RegExp(terms.map(escapeRegexLiteral).join('|'), 'i');
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

function termOfferMatch(terms = []) {
  const regex = buildRegex(terms);
  return {
    ...activeApproxMatch(),
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
      { description: regex },
    ],
  };
}

function selectOfferFields() {
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
    'sortScoreDefault',
  ].join(' ');
}

function sourceDefinitionIsActive(definition = {}) {
  return definition.enabled !== false && definition.latestStatus !== 'inactive';
}

function isOfficialDefinition(definition = {}) {
  return /official|spar\.at|billa\.at|hofer\.at|dm\.at|bipa\.at|lidl\.at|penny\.at|pagro\.at/i.test([
    definition.channel,
    definition.sourceType,
    definition.sourceUrl,
    definition.label,
  ].join(' '));
}

function sourceKeyFromDefinition(definition = {}) {
  const url = String(definition.sourceUrl || '').toLowerCase();
  if (url.includes('aktionsfinder.at')) return `aktionsfinder-${definition.sourceRetailerFormat || definition.retailerKey || 'unknown'}`;
  if (url.includes('marktguru.at')) return `marktguru-${definition.sourceRetailerFormat || definition.retailerKey || 'unknown'}`;
  if (url.includes('wogibtswas.at')) return `wogibtswas-${definition.retailerKey || 'unknown'}`;
  if (url.includes('pagro.at')) return 'pagro-official-site';
  return compact([definition.retailerKey, definition.channel, definition.sourceType]).join('-') || 'unknown';
}

function summarizeDefinition(definition = {}) {
  return {
    sourceKey: sourceKeyFromDefinition(definition),
    retailerKey: definition.retailerKey || '',
    retailerName: definition.retailerName || '',
    channel: definition.channel || '',
    sourceType: definition.sourceType || '',
    label: definition.label || '',
    sourceUrl: definition.sourceUrl || '',
    enabled: definition.enabled !== false,
    appearsActive: sourceDefinitionIsActive(definition),
    disabledReason: definition.disabledReason || '',
    parserHint: definition.parserHint || '',
    notes: definition.notes || '',
  };
}

function topRows(rows = [], field = 'offers', limit = 5) {
  return [...rows]
    .sort((left, right) => Number(right[field] || 0) - Number(left[field] || 0))
    .slice(0, limit);
}

function summarizeRawDocument(doc = {}) {
  return {
    id: String(doc._id || ''),
    retailerKey: doc.retailerKey || '',
    sourceId: String(doc.sourceId || ''),
    sourceType: doc.sourceType || '',
    documentType: doc.documentType || '',
    url: doc.url || '',
    title: doc.title || '',
    fetchedAt: doc.fetchedAt || null,
    httpStatus: doc.httpStatus ?? null,
    foundRawItems: doc.foundRawItems || 0,
    parsedOffers: doc.parsedOffers || 0,
    rejectedOffers: doc.rejectedOffers || 0,
    parserVersion: doc.parserVersion || '',
    extractedPreview: (doc.extractedPreview || []).slice(0, 8),
    payloadSummary: {
      hitCount: doc.payload?.hitCount ?? null,
      sampleNames: doc.payload?.sampleNames || [],
      linkCount: doc.payload?.linkCount ?? null,
      pdfLinkCount: doc.payload?.pdfLinkCount ?? null,
      offerCount: doc.payload?.offerCount ?? null,
      flyerCount: doc.payload?.flyerCount ?? null,
    },
  };
}

function classifyPagroOfficialOpportunity({ codeSources = [], db = {}, urlReferenced = false } = {}) {
  const officialSources = codeSources.filter((source) => isOfficialDefinition(source));
  const activeSources = codeSources.filter((source) => sourceDefinitionIsActive(source));
  const officialUrlInSourceDefinitions = codeSources.some((source) => source.sourceUrl === PAGRO_OFFICIAL_URL);

  if (officialUrlInSourceDefinitions || officialSources.length > 0) {
    return {
      status: 'official-source-present',
      recommendedPreparation: 'keep disabled until fixture/parser proof exists',
      evidence: 'PAGRO official code source already exists.',
    };
  }

  if ((db.offerCount || 0) > 0 && activeSources.some((source) => source.channel === 'aggregator')) {
    return {
      status: 'official-opportunity',
      recommendedPreparation: 'add disabled source config plus fixture parser or snapshot fetch diagnostic; no productive activation',
      evidence: 'PAGRO has aggregator coverage, but no official source definition.',
      urlReferenced,
    };
  }

  return {
    status: 'coverage-unclear',
    recommendedPreparation: 'first confirm aggregator coverage and official page shape read-only',
    evidence: 'No official source definition and weak or unknown observed coverage.',
    urlReferenced,
  };
}

function classifyOfficialVisibilityHypothesis({ retailerKey, codeSources = [], db = {}, rawDocuments = [], crawlJobs = [] } = {}) {
  const officialDefinitions = codeSources.filter((source) => isOfficialDefinition(source));
  const activeOfficialDefinitions = officialDefinitions.filter((source) => sourceDefinitionIsActive(source));
  const officialOfferRows = (db.sourceBreakdown || []).filter((row) => /official/i.test(row.sourceType || ''));
  const aggregatorRows = (db.sourceBreakdown || []).filter((row) => /aktionsfinder|aggregator|wogibtswas|marktguru/i.test(`${row.sourceType || ''} ${row.sourceUrl || ''}`));
  const officialRawDocs = rawDocuments.filter((doc) => /official|dm\.at|bipa\.at/i.test(`${doc.sourceType || ''} ${doc.url || ''}`));
  const officialJobs = crawlJobs.filter((job) => /official|dm\.at|bipa\.at/i.test(`${job.sourceType || ''} ${job.sourceUrl || ''}`));

  if (activeOfficialDefinitions.length === 0 && officialDefinitions.length > 0) {
    return {
      hypothesis: 'registered-but-disabled',
      confidence: 'high',
      reason: `${retailerKey} official source exists in code but is not active-looking.`,
    };
  }

  if (officialOfferRows.length > 0) {
    return {
      hypothesis: 'official-visible-under-expected-source-type',
      confidence: 'high',
      reason: `${retailerKey} has observed official Offer sourceTypes.`,
    };
  }

  if (activeOfficialDefinitions.length > 0 && officialJobs.length === 0 && officialRawDocs.length === 0 && aggregatorRows.length > 0) {
    return {
      hypothesis: 'active-but-not-crawled',
      confidence: 'medium',
      reason: `${retailerKey} official source is active in code, but current DB evidence is aggregator-only.`,
    };
  }

  if (activeOfficialDefinitions.length > 0 && officialRawDocs.length > 0 && officialOfferRows.length === 0) {
    return {
      hypothesis: 'parser-produced-no-offers-or-field-loss',
      confidence: 'medium',
      reason: `${retailerKey} has official raw/job evidence but no official Offer rows.`,
    };
  }

  if (aggregatorRows.length > 0 && officialOfferRows.length === 0) {
    return {
      hypothesis: 'offers-saved-as-aggregator-only',
      confidence: 'medium',
      reason: `${retailerKey} offers are visible only through aggregator-like sourceTypes.`,
    };
  }

  return {
    hypothesis: 'no-observed-coverage',
    confidence: 'low',
    reason: `${retailerKey} has no clear official or aggregator DB evidence in the inspected sample.`,
  };
}

function expectedUserValueRank(value) {
  return { high: 3, medium: 2, low: 1 }[value] || 0;
}

function riskRank(risk) {
  return { low: 3, medium: 2, high: 1 }[risk] || 0;
}

function prioritizeFixBlocks(blocks = []) {
  return [...blocks]
    .map((block) => ({
      ...block,
      priorityScore: expectedUserValueRank(block.expectedUserValue) * 10 + riskRank(block.risk),
    }))
    .sort((left, right) => right.priorityScore - left.priorityScore || left.title.localeCompare(right.title, 'de'))
    .map((block, index) => ({
      priority: index + 1,
      ...block,
    }));
}

function exactVerificationPlan({
  needsCrawl = false,
  needsCacheRebuild = false,
  apiQueries = ['ranking?q=butter', 'ranking?q=reis'],
} = {}) {
  return [
    'baseline before',
    'code active proof',
    needsCrawl ? 'crawl if needed' : 'crawl explicitly skipped for diagnostic/prep',
    needsCrawl ? 'crawl completion proof' : 'no crawl completion proof required until targeted crawl phase',
    needsCacheRebuild ? 'cache/filter rebuild if needed' : 'cache/filter rebuild not required unless crawl or cache-affecting change occurs',
    `API before/after queries: ${apiQueries.join(', ')}`,
    'live performance smoke only after deployment/crawl phase',
  ];
}

function buildRoadmap({ butterReis, pagro, dmBipa, spar, officialValidity } = {}) {
  const butterMissing = (butterReis?.butter?.trueCandidateCount || 0) === 0;
  const reisMissing = (butterReis?.reis?.trueCandidateCount || 0) === 0;
  const pagroOpportunity = pagro?.classification?.status === 'official-opportunity';
  const dmBipaGap = ['dm', 'bipa'].some((key) =>
    ['active-but-not-crawled', 'parser-produced-no-offers-or-field-loss', 'offers-saved-as-aggregator-only'].includes(dmBipa?.[key]?.hypothesis?.hypothesis)
  );
  const billaValidityRisk = (officialValidity?.retailers || []).some((retailer) =>
    ['billa', 'billa-plus'].includes(retailer.retailerKey) && (retailer.risks || []).some((risk) => /validity|parser-field-loss/.test(risk))
  );

  const blocks = [
    {
      title: 'Butter/Reis Source Coverage Proof',
      affectedRetailers: unique([
        ...((butterReis?.butter?.likelyRetailerSourceLevers || []).map((row) => row.retailerKey)),
        ...((butterReis?.reis?.likelyRetailerSourceLevers || []).map((row) => row.retailerKey)),
      ]).slice(0, 6),
      problemType: butterMissing || reisMissing ? 'category-coverage' : 'source-priority-risk',
      expectedUserValue: 'high',
      risk: 'low',
      requiresCrawl: 'no',
      requiresDbMutation: 'no',
      recommendedMode: 'read-only diagnostic',
      exactVerificationPlan: exactVerificationPlan({ apiQueries: ['ranking?q=butter', 'ranking?q=reis'] }),
      suggestedCodexPromptTitle: 'Read-only Butter/Reis source coverage proof and first targeted crawl candidate',
      triggerEvidence: { butterMissing, reisMissing },
    },
    {
      title: 'dm/BIPA Official Visibility Gap',
      affectedRetailers: ['dm', 'bipa'],
      problemType: dmBipaGap ? 'crawl-required' : 'source-priority-risk',
      expectedUserValue: 'high',
      risk: 'medium',
      requiresCrawl: 'later',
      requiresDbMutation: 'later',
      recommendedMode: 'read-only diagnostic',
      exactVerificationPlan: exactVerificationPlan({ needsCrawl: true, needsCacheRebuild: true, apiQueries: ['filters', 'ranking?q=waschmittel&retailers=dm', 'ranking?q=shampoo&retailers=bipa'] }),
      suggestedCodexPromptTitle: 'dm/BIPA official source visibility root-cause proof before targeted crawl',
      triggerEvidence: dmBipa,
    },
    {
      title: 'PAGRO Official Source Preparation',
      affectedRetailers: ['pagro'],
      problemType: pagroOpportunity ? 'source-missing' : 'source-disabled',
      expectedUserValue: 'medium',
      risk: 'low',
      requiresCrawl: 'no',
      requiresDbMutation: 'no',
      recommendedMode: 'fixture parser prep',
      exactVerificationPlan: exactVerificationPlan({ apiQueries: ['ranking?retailers=pagro', 'filters'] }),
      suggestedCodexPromptTitle: 'Prepare disabled PAGRO official source and fixture diagnostic without activation',
      triggerEvidence: pagro?.classification || null,
    },
    {
      title: 'BILLA/BILLA PLUS Validity Evidence Guard',
      affectedRetailers: ['billa', 'billa-plus'],
      problemType: billaValidityRisk ? 'validity-missing' : 'source-priority-risk',
      expectedUserValue: 'medium',
      risk: 'medium',
      requiresCrawl: 'later',
      requiresDbMutation: 'later',
      recommendedMode: 'parser fix',
      exactVerificationPlan: exactVerificationPlan({ needsCrawl: true, needsCacheRebuild: true, apiQueries: ['ranking?q=kaffee&retailers=billa', 'ranking?q=butter&retailers=billa-plus'] }),
      suggestedCodexPromptTitle: 'BILLA official validity evidence without artificial validTo derivation',
      triggerEvidence: { billaValidityRisk },
    },
    {
      title: 'PENNY PDF Condition Clarity',
      affectedRetailers: ['penny'],
      problemType: 'condition-unclear',
      expectedUserValue: 'medium',
      risk: 'medium',
      requiresCrawl: 'later',
      requiresDbMutation: 'later',
      recommendedMode: 'parser fix',
      exactVerificationPlan: exactVerificationPlan({ needsCrawl: true, needsCacheRebuild: true, apiQueries: ['ranking?retailers=penny', 'ranking?q=kaffee&retailers=penny'] }),
      suggestedCodexPromptTitle: 'PENNY PDF condition extraction fixture block',
      triggerEvidence: 'official coverage strong; PDF conditions remain unclear',
    },
    {
      title: 'SPAR Official Snapshot Evidence',
      affectedRetailers: ['spar'],
      problemType: 'source-disabled',
      expectedUserValue: 'high',
      risk: 'high',
      requiresCrawl: 'later',
      requiresDbMutation: 'later',
      recommendedMode: 'fixture parser prep',
      exactVerificationPlan: exactVerificationPlan({ needsCrawl: false, apiQueries: ['ranking?q=kaffee&retailers=spar'] }),
      suggestedCodexPromptTitle: 'SPAR official manual snapshot fixture proof without 403 bypass',
      triggerEvidence: spar?.summary || null,
    },
  ];

  return prioritizeFixBlocks(blocks).slice(0, 5);
}

function buildCrawlGuardrailChecklist() {
  return [
    'Wann darf gecrawlt werden? Nur nach expliziter Freigabe, mit benannter Quelle/Haendler, Ziel-DB, Limit und Rollback-/Stop-Kriterium.',
    'Welche Baseline muss vorher gespeichert werden? Ranking/API-Snapshots, Source/Offer/RawDocument/CrawlJob Counts, relevante Query-Ergebnisse und Performance-Zeiten.',
    'Welche DB wird verwendet? Exakte MongoDB-URI-Umgebung und DB-Name aus ENV dokumentieren, keine lokale oder versehentliche Alternativ-DB.',
    'Welche Quelle/Händler werden gecrawlt? SourceId, sourceUrl, retailerKey, channel, enabled/active Status und Parser-Version festhalten.',
    'Wann startete/endete der Crawl? startedAt/finishedAt je CrawlJob speichern.',
    'Wie viele Offers erstellt/aktualisiert/übersprungen? CrawlJob stats und Offer-Deltas gegen Baseline ausweisen.',
    'Wurde Ranking-/Filter-Cache invalidiert oder rebuildet? Falls ja Zeitpunkt und Script, falls nein begruenden.',
    'Welche API-Abfragen wurden vor/nach dem Crawl gespeichert? Mindestens betroffene Ranking-Queries, filters und health.',
    'Welche konkrete Verbesserung ist in rankedOffers sichtbar? Neue echte aktive Angebote mit Preis, Menge, Gueltigkeit und Bedingung benennen.',
    'Ohne diese Punkte keine Aussage, dass Datenqualitaet wirklich verbessert wurde.',
  ];
}

function buildSparDecisionSection(sparDiagnostic = {}) {
  return {
    proven: [
      'SPAR aggregator/code sources for SPAR, INTERSPAR and EUROSPAR exist and should remain visible.',
      'The official SPAR actions source exists as an inactive/disabled code path.',
      'The regional official URL is relevant evidence, but a previous Node fetch returned 403.',
      'The SPAR official parser path is fixture-oriented and not productive active.',
    ],
    notProven: [
      'That the productive backend can legally and reliably crawl SPAR official HTML today.',
      'That official SPAR HTML would contain better price, quantity, validity and condition fields than current aggregator rows.',
      'That missing SPAR coffee coverage is a ranking problem.',
    ],
    whyNoProductiveHtmlCrawlNow: [
      '403/bot-protection risk is known and must not be bypassed.',
      'Parser evidence is fixture-only and extractedOffers were previously empty.',
      'Aggregator rows must not be displaced by official rows unless official fields are complete enough.',
      'This audit is explicitly read-only and launch-planning oriented.',
    ],
    safeOptions: [
      'Manual snapshot fixture from official page evidence.',
      'PDF/flyer link proof and parser fixture before activation.',
      'Keep Aggregator SPAR/INTERSPAR/EUROSPAR active.',
      'Add official campaign/condition data later only with field-level evidence.',
    ],
    diagnosticSummary: sparDiagnostic.summary || {},
  };
}

function buildPennyConditionSection(officialValidity = {}) {
  const penny = (officialValidity.retailers || []).find((retailer) => retailer.retailerKey === 'penny');
  return {
    summary: [
      'PENNY official HTML/PDF coverage is comparatively strong.',
      'The remaining risk is condition-unclear, especially for flyer/PDF mechanics and exclusions.',
      'No fix is part of this audit.',
    ],
    observedRisks: penny?.risks || ['condition-unclear'],
    laterSmallFixBlock: [
      'Build PENNY PDF/HTML condition fixtures.',
      'Extract customer-program, multibuy, threshold and exclusion text into explicit condition fields.',
      'Verify official rows do not displace aggregator rows when conditions are weaker.',
    ],
  };
}

function buildButterReisRootCause({ quality = {}, rawHints = {}, sourceSummaries = {} } = {}) {
  function section(query) {
    const data = quality[query] || {};
    const levers = topRows(sourceSummaries[query] || [], 'candidateCount', 8);
    return {
      ...data,
      realCandidatesPresentInOffers: (data.trueCandidateCount || 0) > 0,
      likelyMisclassified: (data.trueCandidateCount || 0) > 0 && (data.excludedByIntentCount || 0) > 0,
      likelySourceCoverageGap: (data.trueCandidateCount || 0) === 0,
      likelyRetailerSourceLevers: levers,
      rawDocumentHints: rawHints[query] || [],
      conclusion: (data.trueCandidateCount || 0) === 0
        ? `${query}: no safe true product candidates observed in active Offer rows; keep ranking strict and improve source coverage first.`
        : `${query}: true product candidates exist; inspect exclusion/category/validity examples before source work.`,
    };
  }

  return {
    butter: section('butter'),
    reis: section('reis'),
  };
}

async function fetchTermOffers({ Offer, terms, limit = DEFAULT_LIMIT }) {
  return Offer.find(termOfferMatch(terms))
    .sort({ isActiveNow: -1, isActiveToday: -1, sortScoreDefault: -1, updatedAt: -1 })
    .limit(Math.max(50, Math.min(Number(limit || DEFAULT_LIMIT), 2000)))
    .select(selectOfferFields())
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

async function fetchRawHints({ RawDocument, terms, limit = 12 }) {
  const regex = buildRegex(terms);
  if (!RawDocument) return [];
  const docs = await RawDocument.find({
    $or: [
      { title: regex },
      { contentSnippet: regex },
      { extractedPreview: regex },
      { url: regex },
    ],
  })
    .sort({ fetchedAt: -1 })
    .limit(Math.max(3, Math.min(Number(limit || 12), 25)))
    .select('retailerKey sourceId sourceType documentType url title fetchedAt httpStatus foundRawItems parsedOffers rejectedOffers parserVersion extractedPreview payload')
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();

  return docs.map(summarizeRawDocument);
}

async function fetchSourceSummaryForTerms({ Offer, terms, classifier, limit = 40 }) {
  const offers = await fetchTermOffers({ Offer, terms, limit: Math.max(200, limit * 20) });
  const groups = new Map();

  for (const offer of offers) {
    const key = [
      offer.retailerKey || 'unknown',
      offer.retailerName || '',
      offer.sourceType || 'unknown',
      offer.sourceUrl || '',
      offer.categoryKey || 'unknown',
    ].join('|');
    const current = groups.get(key) || {
      retailerKey: offer.retailerKey || '',
      retailerName: offer.retailerName || '',
      sourceType: offer.sourceType || '',
      sourceUrl: offer.sourceUrl || '',
      categoryKey: offer.categoryKey || '',
      candidateCount: 0,
      trueCount: 0,
      sideHitCount: 0,
      unclearCount: 0,
      sampleTitles: [],
    };
    const classification = classifier(offer).classification;
    current.candidateCount += 1;
    if (classification === 'true' || classification === 'weakTrue') current.trueCount += 1;
    if (classification === 'sideHit') current.sideHitCount += 1;
    if (classification === 'unclear') current.unclearCount += 1;
    if (current.sampleTitles.length < 4) current.sampleTitles.push(offer.title || '');
    groups.set(key, current);
  }

  return topRows([...groups.values()], 'candidateCount', limit);
}

async function fetchRetailerDbContext({ Offer, Source, RawDocument, CrawlJob, retailerKey }) {
  const sourceRegex = new RegExp(escapeRegexLiteral(retailerKey), 'i');
  const [dbSources, sourceBreakdown, categoryBreakdown, latestRawDocuments, latestCrawlJobs] = await Promise.all([
    Source.find({ retailerKey })
      .sort({ enabled: -1, channel: 1, label: 1 })
      .limit(40)
      .select('retailerKey retailerName channel label sourceUrl sourceType enabled active latestRunAt latestStatus disabledReason parserHint parserVersion notes')
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean(),
    Offer.aggregate([
      { $match: { retailerKey } },
      {
        $group: {
          _id: { sourceType: '$sourceType', sourceUrl: '$sourceUrl', sourceId: '$sourceId' },
          offers: { $sum: 1 },
          activeApprox: { $sum: { $cond: [{ $or: ['$isActiveNow', '$isActiveToday'] }, 1, 0] } },
          sampleTitle: { $first: '$title' },
        },
      },
      { $sort: { offers: -1 } },
      { $limit: 30 },
    ]).option({ maxTimeMS: QUERY_MAX_TIME_MS }),
    Offer.aggregate([
      { $match: { retailerKey } },
      {
        $group: {
          _id: { categoryKey: '$categoryKey', categoryPrimary: '$categoryPrimary', categorySecondary: '$categorySecondary' },
          offers: { $sum: 1 },
          activeApprox: { $sum: { $cond: [{ $or: ['$isActiveNow', '$isActiveToday'] }, 1, 0] } },
          sampleTitle: { $first: '$title' },
        },
      },
      { $sort: { offers: -1 } },
      { $limit: 25 },
    ]).option({ maxTimeMS: QUERY_MAX_TIME_MS }),
    RawDocument.find({
      $or: [
        { retailerKey },
        { url: sourceRegex },
        { title: sourceRegex },
      ],
    })
      .sort({ fetchedAt: -1 })
      .limit(12)
      .select('retailerKey sourceId sourceType documentType url title fetchedAt httpStatus foundRawItems parsedOffers rejectedOffers parserVersion extractedPreview payload')
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean(),
    CrawlJob.find({
      $or: [
        { retailerKey },
        { sourceUrl: sourceRegex },
      ],
    })
      .sort({ startedAt: -1 })
      .limit(12)
      .select('retailerKey sourceId status sourceType sourceUrl parserVersion startedAt finishedAt stats warningMessages errorMessages metadata')
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean(),
  ]);

  const mappedSourceBreakdown = sourceBreakdown.map((row) => ({
    sourceType: row._id?.sourceType || '',
    sourceUrl: row._id?.sourceUrl || '',
    sourceId: String(row._id?.sourceId || ''),
    offers: row.offers || 0,
    activeApprox: row.activeApprox || 0,
    sampleTitle: row.sampleTitle || '',
  }));

  return {
    offerCount: mappedSourceBreakdown.reduce((sum, row) => sum + Number(row.offers || 0), 0),
    dbSources: dbSources.map((source) => ({
      sourceId: String(source._id || ''),
      retailerKey: source.retailerKey || '',
      retailerName: source.retailerName || '',
      channel: source.channel || '',
      label: source.label || '',
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
    sourceBreakdown: mappedSourceBreakdown,
    categoryBreakdown: categoryBreakdown.map((row) => ({
      categoryKey: row._id?.categoryKey || '',
      categoryPrimary: row._id?.categoryPrimary || '',
      categorySecondary: row._id?.categorySecondary || '',
      offers: row.offers || 0,
      activeApprox: row.activeApprox || 0,
      sampleTitle: row.sampleTitle || '',
    })),
    latestRawDocuments: latestRawDocuments.map(summarizeRawDocument),
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
      warningMessages: job.warningMessages || [],
      errorMessages: job.errorMessages || [],
    })),
  };
}

async function buildLaunchCoverageAudit({
  Offer,
  Source,
  RawDocument,
  CrawlJob,
  buildOfferRanking,
  generatedAt = new Date(),
  limit = DEFAULT_LIMIT,
  checkUrls = false,
} = {}) {
  const [
    butterOffers,
    reisOffers,
    butterRawHints,
    reisRawHints,
    butterSourceSummary,
    reisSourceSummary,
    sparDb,
    officialMatrix,
    officialValidity,
    pagroDb,
    dmDb,
    bipaDb,
  ] = await Promise.all([
    fetchTermOffers({ Offer, terms: QUERY_TERMS.butter, limit }),
    fetchTermOffers({ Offer, terms: QUERY_TERMS.reis, limit }),
    fetchRawHints({ RawDocument, terms: QUERY_TERMS.butter }),
    fetchRawHints({ RawDocument, terms: QUERY_TERMS.reis }),
    fetchSourceSummaryForTerms({ Offer, terms: QUERY_TERMS.butter, classifier: classifyButterOffer }),
    fetchSourceSummaryForTerms({ Offer, terms: QUERY_TERMS.reis, classifier: classifyRiceOffer }),
    fetchSparSourceCoverageInputs({ Offer, Source, RawDocument, CrawlJob, limit: 80 }),
    buildOfficialSourceMatrix({ Offer, limit: 20, checkUrls }),
    buildOfficialValidityCoverageDiagnostic({ Offer, limit: 25 }),
    fetchRetailerDbContext({ Offer, Source, RawDocument, CrawlJob, retailerKey: 'pagro' }),
    fetchRetailerDbContext({ Offer, Source, RawDocument, CrawlJob, retailerKey: 'dm' }),
    fetchRetailerDbContext({ Offer, Source, RawDocument, CrawlJob, retailerKey: 'bipa' }),
  ]);

  const rankings = buildOfferRanking
    ? {
      butter: await buildOfferRanking({ query: 'butter', limit: 20 }),
      reis: await buildOfferRanking({ query: 'reis', limit: 20 }),
    }
    : {};
  const queryQuality = buildQueryQualityGapsDiagnostic({
    checkedAt: generatedAt,
    butterOffers,
    reisOffers,
    waschmittelOffers: [],
    rankings,
  });
  const sparDiagnostic = buildSparSourceCoverageDiagnostic({
    checkedAt: generatedAt,
    db: sparDb,
    codeSources: getSparCodeSources(),
  });
  const butterReis = buildButterReisRootCause({
    quality: {
      butter: queryQuality.butter,
      reis: queryQuality.reis,
    },
    rawHints: {
      butter: butterRawHints,
      reis: reisRawHints,
    },
    sourceSummaries: {
      butter: butterSourceSummary,
      reis: reisSourceSummary,
    },
  });
  const pagroCodeSources = RETAILER_DEFINITIONS.filter((source) => source.retailerKey === 'pagro');
  const pagroUrlReferenced = OFFICIAL_RETAILERS.some((retailer) =>
    retailer.retailerKey === 'pagro' && retailer.officialUrls.includes(PAGRO_OFFICIAL_URL)
  );
  const pagro = {
    officialUrl: PAGRO_OFFICIAL_URL,
    codeSources: pagroCodeSources.map(summarizeDefinition),
    activeSources: pagroCodeSources.filter(sourceDefinitionIsActive).map(summarizeDefinition),
    sourceTypesObserved: pagroDb.sourceBreakdown.map((row) => ({ sourceType: row.sourceType, offers: row.offers, activeApprox: row.activeApprox })),
    relevantCategories: topRows(pagroDb.categoryBreakdown, 'offers', 10),
    urlReferencedInCodeOrDiagnostics: pagroUrlReferenced || pagroCodeSources.some((source) => source.sourceUrl === PAGRO_OFFICIAL_URL),
    db: pagroDb,
    classification: classifyPagroOfficialOpportunity({
      codeSources: pagroCodeSources,
      db: pagroDb,
      urlReferenced: pagroUrlReferenced,
    }),
  };
  const dmCodeSources = RETAILER_DEFINITIONS.filter((source) => source.retailerKey === 'dm');
  const bipaCodeSources = RETAILER_DEFINITIONS.filter((source) => source.retailerKey === 'bipa');
  const dmBipa = {
    dm: {
      codeSources: dmCodeSources.map(summarizeDefinition),
      db: dmDb,
      hypothesis: classifyOfficialVisibilityHypothesis({
        retailerKey: 'dm',
        codeSources: dmCodeSources,
        db: dmDb,
        rawDocuments: dmDb.latestRawDocuments,
        crawlJobs: dmDb.latestCrawlJobs,
      }),
    },
    bipa: {
      codeSources: bipaCodeSources.map(summarizeDefinition),
      db: bipaDb,
      hypothesis: classifyOfficialVisibilityHypothesis({
        retailerKey: 'bipa',
        codeSources: bipaCodeSources,
        db: bipaDb,
        rawDocuments: bipaDb.latestRawDocuments,
        crawlJobs: bipaDb.latestCrawlJobs,
      }),
    },
  };
  const roadmap = buildRoadmap({
    butterReis,
    pagro,
    dmBipa,
    spar: sparDiagnostic,
    officialValidity,
  });

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    crawlStarted: false,
    deploymentStarted: false,
    sourceActivationChanged: false,
    rankingChanged: false,
    parserCrawlerProductionChanged: false,
    uiOrMobileChanged: false,
    existingAggregatorSourcesChanged: false,
    liveHttpChecked: Boolean(checkUrls),
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    principle: 'Qualitaet der Daten ist kein Nebenthema - sie IST das Produkt.',
    productQuestions: [
      'Was ist es?',
      'Wo gilt es?',
      'Wann gilt es?',
      'Welche Menge/Einheit?',
      'Welche Bedingung?',
    ],
    sections: {
      butterReisRootCause: butterReis,
      sparKaffeeDecision: buildSparDecisionSection(sparDiagnostic),
      pagroOfficialOpportunity: pagro,
      dmBipaOfficialVisibilityGap: dmBipa,
      pennyPdfConditions: buildPennyConditionSection(officialValidity),
      officialSourceMatrix: officialMatrix.summary,
      officialValidityCoverage: officialValidity.summary,
    },
    roadmap,
    recommendation: roadmap[0] || null,
    crawlGuardrailChecklist: buildCrawlGuardrailChecklist(),
  };
}

module.exports = {
  DEFAULT_LIMIT,
  PAGRO_OFFICIAL_URL,
  buildCrawlGuardrailChecklist,
  buildLaunchCoverageAudit,
  buildRoadmap,
  classifyOfficialVisibilityHypothesis,
  classifyPagroOfficialOpportunity,
  exactVerificationPlan,
  prioritizeFixBlocks,
  summarizeDefinition,
};
