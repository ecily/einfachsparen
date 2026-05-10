const {
  QUERY_TERMS,
  classifyButterOffer,
  classifyRiceOffer,
} = require('./queryQualityGapsDiagnostic');
const {
  CASES,
  buildCoverageBaselineDiagnostic,
  classifyCoffeeOffer,
} = require('./coverageBaselineDiagnostic');
const {
  COFFEE_TERMS,
  buildSparSourceCoverageDiagnostic,
  fetchSparSourceCoverageInputs,
  getSparCodeSources,
} = require('./sparSourceCoverageDiagnostic');

const QUERY_MAX_TIME_MS = 1500;
const DEFAULT_LIMIT = 700;

const BUTTER_TERMS = [
  'Butter',
  'Teebutter',
  'Markenbutter',
  'Alpenbutter',
  'Suessrahmbutter',
  'Sauerrahmbutter',
  'Streichbutter',
  'Süßrahmbutter',
];

const REIS_TERMS = [
  'Basmati',
  'Jasmin',
  'Langkorn',
  'Rundkorn',
  'Risotto',
  'Parboiled',
  'Reis',
];

const BUTTER_SIDE_TERMS = [
  'Buttermilch',
  'Buttergemuese',
  'Buttergemüse',
  'Roestgemuese',
  'Röstgemüse',
  'Butterpinze',
  'Body Butter',
  'Peanut Butter',
  'Erdnussbutter',
];

const REIS_SIDE_TERMS = [
  'Reiswaffeln',
  'Reischips',
  'Reisdrink',
  'Reiscracker',
  'Jasmine-Duft',
  'Fertiggericht',
  'Fertiggerichte',
];

const SPAR_COFFEE_TERMS = [
  'REGIO Gold',
  'Tassimo',
  'Nescafe',
  'Nescafé',
  'Cafe Royal',
  'Café Royal',
  'Meinl',
  'Dallmayr',
  'Kaffee',
  'Espresso',
  'Cappuccino',
];

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

function sourceKeyFromSource(source = {}) {
  const url = String(source.sourceUrl || '').toLowerCase();
  const format = source.sourceRetailerFormat || source.retailerKey || '';

  if (url.includes('aktionsfinder.at')) return `aktionsfinder-${format || 'unknown'}`;
  if (url.includes('marktguru.at')) return `marktguru-${format || 'unknown'}`;
  if (url.includes('spar.at')) return 'spar-official-flyer';

  return compact([source.retailerKey, source.channel, source.sourceType]).join('-') || 'unknown';
}

function buildActiveMatch(now = new Date()) {
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
    { description: regex },
  ];
}

function buildOfferTermMatch(terms = [], { sparOnly = false } = {}) {
  const match = {
    ...buildActiveMatch(),
    $or: termFields(buildRegex(terms)),
  };

  if (sparOnly) {
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

function selectOfferFields() {
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
    'priceCurrent',
    'normalizedUnitPrice',
    'quantityText',
    'comparableUnit',
    'conditionsText',
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

function summarizeSourceLever(row = {}) {
  return {
    sourceKey: row.sourceKey || sourceKeyFromSource(row),
    retailerKey: row._id?.retailerKey || row.retailerKey || '',
    retailerName: row._id?.retailerName || row.retailerName || '',
    sourceType: row._id?.sourceType || row.sourceType || '',
    sourceUrl: row._id?.sourceUrl || row.sourceUrl || '',
    sourceId: String(row._id?.sourceId || row.sourceId || ''),
    categoryKey: row._id?.categoryKey || row.categoryKey || '',
    candidateCount: Number(row.candidateCount || row.offers || 0),
    trueCount: Number(row.trueCount || 0),
    weakCount: Number(row.weakCount || 0),
    sideHitCount: Number(row.sideHitCount || 0),
    unclearCount: Number(row.unclearCount || 0),
    sampleTitles: row.sampleTitles || compact([row.sampleTitle]).slice(0, 4),
  };
}

function classifySourceEvidence({ baselineCase = {}, rawEvidence = [] } = {}) {
  const trueCount = Number(baselineCase.likelyTrueProductCount || baselineCase.trueCandidateCount || 0);
  const rankedCount = Number(baselineCase.rankedResultCount || 0);
  const examples = baselineCase.examplesExcludedWithReason || [];
  const rawHits = rawEvidence.filter((item) => item.matchClassification === 'trueProduct');
  const parserLoss = rawHits.some((item) =>
    Number(item.foundRawItems || 0) > Number(item.parsedOffers || 0) ||
    (Number(item.foundRawItems || 0) > 0 && Number(item.parsedOffers || 0) === 0)
  );

  if (trueCount > 0 && examples.some((item) => item.exclusionReason === 'category-filter')) {
    return 'wrong-category';
  }

  if (trueCount > 0 && rankedCount === 0) {
    return 'offer-exists-but-filtered';
  }

  if (parserLoss) {
    return 'parser-field-loss';
  }

  if (rawHits.length > 0 && trueCount === 0) {
    return 'raw-evidence-but-no-offer';
  }

  if (rawEvidence.length === 0 && trueCount === 0) {
    return 'no-source-evidence';
  }

  return 'unclear';
}

function rawText(doc = {}) {
  return compact([
    doc.title,
    doc.url,
    doc.finalUrl,
    doc.canonicalUrl,
    doc.contentSnippet,
    ...(doc.extractedPreview || []),
    ...(doc.payload?.sampleNames || []),
    ...(doc.payload?.sampleTitles || []),
    ...(doc.payload?.sampleTexts || []),
  ]).join(' ');
}

function classifyRawEvidenceText({ text = '', trueTerms = [], sideTerms = [] } = {}) {
  const sideRegex = buildRegex(sideTerms);
  const trueRegex = buildRegex(trueTerms);

  if (sideTerms.length > 0 && sideRegex.test(text)) {
    return 'sideHit';
  }

  if (trueRegex.test(text)) {
    return 'trueProduct';
  }

  return 'unclear';
}

function summarizeRawEvidence(doc = {}, { trueTerms = [], sideTerms = [] } = {}) {
  const text = rawText(doc);

  return {
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
    foundRawItems: Number(doc.foundRawItems || 0),
    parsedOffers: Number(doc.parsedOffers || 0),
    rejectedOffers: Number(doc.rejectedOffers || 0),
    parserVersion: doc.parserVersion || '',
    matchedTerms: unique(trueTerms.filter((term) => buildRegex([term]).test(text))).slice(0, 8),
    sideHitTerms: unique(sideTerms.filter((term) => buildRegex([term]).test(text))).slice(0, 8),
    matchClassification: classifyRawEvidenceText({ text, trueTerms, sideTerms }),
    extractedPreview: (doc.extractedPreview || []).slice(0, 5),
    payloadSummary: {
      promotionCount: doc.payload?.promotionCount ?? null,
      categoryPageCount: doc.payload?.categoryPageCount ?? null,
      categoryPagePromotionCount: doc.payload?.categoryPagePromotionCount ?? null,
      linkCount: doc.payload?.linkCount ?? null,
      pdfLinkCount: doc.payload?.pdfLinkCount ?? null,
      sampleNames: (doc.payload?.sampleNames || []).slice(0, 5),
    },
  };
}

function buildBaselineCommands({ baseUrl = 'https://www.kaufklug.at' } = {}) {
  return [
    {
      name: 'SPAR Kaffee before',
      command: `curl.exe -sS "${baseUrl}/api/offers/ranking?q=kaffee&retailers=spar&limit=20" -o tmp/baseline-spar-kaffee-before.json`,
      outputFile: 'tmp/baseline-spar-kaffee-before.json',
    },
    {
      name: 'Kaffee before',
      command: `curl.exe -sS "${baseUrl}/api/offers/ranking?q=kaffee&limit=20" -o tmp/baseline-kaffee-before.json`,
      outputFile: 'tmp/baseline-kaffee-before.json',
    },
    {
      name: 'Butter before',
      command: `curl.exe -sS "${baseUrl}/api/offers/ranking?q=butter&limit=20" -o tmp/baseline-butter-before.json`,
      outputFile: 'tmp/baseline-butter-before.json',
    },
    {
      name: 'Reis before',
      command: `curl.exe -sS "${baseUrl}/api/offers/ranking?q=reis&limit=20" -o tmp/baseline-reis-before.json`,
      outputFile: 'tmp/baseline-reis-before.json',
    },
  ];
}

function buildAfterBaselineCommands({ baseUrl = 'https://www.kaufklug.at' } = {}) {
  return [
    `curl.exe -sS "${baseUrl}/api/offers/ranking?q=kaffee&retailers=spar&limit=20" -o tmp/baseline-spar-kaffee-after.json`,
    `curl.exe -sS "${baseUrl}/api/offers/ranking?q=kaffee&limit=20" -o tmp/baseline-kaffee-after.json`,
    `curl.exe -sS "${baseUrl}/api/offers/ranking?q=butter&limit=20" -o tmp/baseline-butter-after.json`,
    `curl.exe -sS "${baseUrl}/api/offers/ranking?q=reis&limit=20" -o tmp/baseline-reis-after.json`,
  ];
}

function buildSuccessCriteria({ target = 'spar-aktionsfinder-coffee' } = {}) {
  if (target === 'spar-aktionsfinder-coffee') {
    return [
      'SPAR Kaffee API resultCount/displayed count increases beyond the current one-off baseline without side hits.',
      'At least two visible SPAR coffee offers answer product, retailer/format, validity, quantity/unit and condition fields.',
      'CrawlJob rows for the targeted SPAR Aktionsfinder sources finish with status success or partial and nonzero parsed/offersStored counts.',
      'No SPAR official source was activated and no 403 bypass was introduced.',
      'Butter/Reis API baselines remain honest: no ranking relaxation and no artificial side-hit increase.',
    ];
  }

  return [
    'Target query improves with real active offers only.',
    'Every new visible offer has price, validity, quantity/unit and condition evidence or is explicitly marked uncertain.',
  ];
}

function buildPostCrawlChecks() {
  return [
    'Query CrawlJob by retailerKey=spar, sourceUrl in Aktionsfinder SPAR/INTERSPAR/EUROSPAR, startedAt >= baseline timestamp.',
    'Confirm status is success/partial, finishedAt is set, stats.foundRawItems/parsedOffers/offersStored are recorded.',
    'Inspect RawDocument samples for sourceId/sourceUrl and foundRawItems/parsedOffers counts.',
    'Confirm filterMetadata in crawl response is ok or run npm run rebuild:filters if the crawl path reports rebuild failure.',
    'Compare tmp/baseline-spar-kaffee-before.json with tmp/baseline-spar-kaffee-after.json.',
  ];
}

function buildLiveSmokeCommands({ baseUrl = 'https://www.kaufklug.at' } = {}) {
  return [
    `curl.exe -sS "${baseUrl}/api/health"`,
    ...buildAfterBaselineCommands({ baseUrl }),
  ];
}

function decideActiveAggregatorCrawlHelp({ sparDiagnostic = {}, sparRawEvidence = [] } = {}) {
  const activeAggregatorSources = (sparDiagnostic.codeSources || [])
    .filter((source) => source.channel === 'aggregator' && source.appearsActive);
  const activeCoffeeRawHits = sparRawEvidence
    .filter((item) => item.matchClassification === 'trueProduct')
    .filter((item) => /aktionsfinder|spar|interspar|eurospar/i.test(`${item.sourceType} ${item.url} ${item.finalUrl}`));
  const sourceBreakdownCoffee = (sparDiagnostic.dbSourceBreakdown || [])
    .reduce((sum, row) => sum + Number(row.coffeeOffers || 0), 0);

  if (activeCoffeeRawHits.length > 0) {
    return true;
  }

  if (sourceBreakdownCoffee > Number(sparDiagnostic.summary?.sparCoffeeOffersInDb || 0)) {
    return true;
  }

  if (activeAggregatorSources.length > 0 && Number(sparDiagnostic.summary?.sparOffersInDb || 0) > 0) {
    return null;
  }

  return false;
}

function chooseNextBlock({ butter = {}, reis = {}, sparCoffee = {} } = {}) {
  if (sparCoffee.canActiveAggregatorCrawlHelp === true) {
    return 'Targeted SPAR Aktionsfinder coffee crawl/parser verification';
  }

  if (
    sparCoffee.canActiveAggregatorCrawlHelp === null &&
    ['source-disabled', 'source-missing'].includes(sparCoffee.rootCause)
  ) {
    return 'SPAR Aktionsfinder source freshness proof before official SPAR prep';
  }

  if (['raw-evidence-but-no-offer', 'parser-field-loss'].includes(butter.rootCause)) {
    return 'Butter parser/source field-loss fixture block';
  }

  if (['raw-evidence-but-no-offer', 'parser-field-loss'].includes(reis.rootCause)) {
    return 'Reis parser/source field-loss fixture block';
  }

  return 'SPAR official flyer snapshot parser prep without activation';
}

function buildNextLiveTestPlan({ recommendedNextBlock, sparCoffee = {}, baseUrl = 'https://www.kaufklug.at' } = {}) {
  const canCrawlRetailerScoped = sparCoffee.canActiveAggregatorCrawlHelp !== false;
  const sourceActivationRequired = /^SPAR official|official flyer snapshot/i.test(recommendedNextBlock);
  const requiresParserChange = /parser|fixture|official/i.test(recommendedNextBlock) && !recommendedNextBlock.includes('freshness');

  return {
    title: recommendedNextBlock,
    targetRetailers: ['spar'],
    targetSources: sourceActivationRequired
      ? ['spar-official-flyer disabled fixture/snapshot only']
      : ['aktionsfinder-spar', 'aktionsfinder-interspar', 'aktionsfinder-eurospar'],
    targetQueries: ['kaffee', 'spar+kaffee', 'butter', 'reis'],
    codeArea: sourceActivationRequired
      ? ['src/services/crawl/sparOfficialFlyerParser.js', 'test/fixtures/spar-official-steiermark-real-snapshot.html']
      : ['src/services/crawl/aktionsfinderCrawler.js', 'src/services/crawl/aktionsfinderParser.js', 'src/services/crawl/offerNormalizer.js'],
    expectedVisibleImprovement: sourceActivationRequired
      ? 'Noch kein Live-Coverage-Win; zuerst fixturebasierter offizieller SPAR-Flyer-Beweis ohne Aktivierung.'
      : 'SPAR + Kaffee soll live mehr als den bisherigen Einzeltreffer zeigen, sofern Aktionsfinder aktuelle Kaffeeangebote liefert.',
    riskLevel: sourceActivationRequired ? 'medium' : 'low-medium',
    requiresParserChange: requiresParserChange ? 'yes' : 'no',
    requiresSourceActivation: sourceActivationRequired ? 'yes-later-not-in-next-readiness-step' : 'no',
    requiresCrawl: canCrawlRetailerScoped && !sourceActivationRequired,
    requiresFilterRebuild: canCrawlRetailerScoped && !sourceActivationRequired,
    requiresDeployment: true,
    baselineCommands: buildBaselineCommands({ baseUrl }),
    exactBaselineCommands: buildBaselineCommands({ baseUrl }).map((item) => item.command),
    exactImplementationScope: sourceActivationRequired
      ? [
        'Use or add real snapshot fixture for https://www.spar.at/aktionen/steiermark without live fetch dependency.',
        'Extend SPAR official parser until fixture extracts coffee offers with product, retailer format, validity, quantity and condition fields.',
        'Keep source disabled; no scheduler or production activation.',
      ]
      : [
        'Add a targeted crawl runner or admin endpoint option that accepts sourceIds/sourceKeys for enabled sources only.',
        'Limit first run to Aktionsfinder SPAR, INTERSPAR and EUROSPAR; keep SPAR official and Marktguru disabled.',
        'If parser drops coffee fields, patch Aktionsfinder parser/normalizer with fixture tests before live crawl.',
      ],
    exactCrawlCommandOrAdminEndpointToUse: canCrawlRetailerScoped && !sourceActivationRequired
      ? [
        'Current available endpoint: POST /api/crawl/run with body {"retailerKeys":["spar"]} and x-admin-api-key header.',
        'Safer next implementation target: add sourceId/sourceKey-scoped manual crawl so only Aktionsfinder SPAR/INTERSPAR/EUROSPAR run.',
      ]
      : ['No productive crawl recommended until parser/source prep is proven.'],
    crawlSafety: {
      fullCrawl: false,
      sourceScope: sourceActivationRequired ? 'no crawl' : 'SPAR enabled Aktionsfinder sources only',
      maxRuntimeOrTimeout: 'Use existing request/process timeout; if adding runner, set explicit per-source timeout before use.',
      crawlRunOnStartChange: false,
      forbidden: ['no SPAR 403 bypass', 'no disabled source activation', 'no ranking relaxation'],
    },
    exactPostCrawlChecks: buildPostCrawlChecks(),
    exactLiveSmokeCommands: buildLiveSmokeCommands({ baseUrl }),
    rollbackNotes: [
      'If crawl creates bad SPAR offers, disable only the newly added targeted runner path or revert the parser change.',
      'Do not delete historical raw documents as rollback; use status/source inspection and restore previous parser deployment if needed.',
      'Keep Aggregator offers visible unless a better complete official row exists.',
    ],
    successCriteria: buildSuccessCriteria({ target: 'spar-aktionsfinder-coffee' }),
  };
}

function buildGuardrails() {
  return [
    'read-only diagnostic only',
    'no DB mutation',
    'no crawl execution',
    'no deployment',
    'no version bump',
    'no UI or mobile change',
    'no ranking relaxation',
    'no productive source activation',
    'no scheduler or CRAWL_RUN_ON_START change',
    'no full crawl',
    'no OCR',
    'no 403 or bot-protection bypass',
    'tests use pure helper functions only and require no DB/live HTTP',
  ];
}

function buildProductCoverageSection({ key, baselineCase = {}, sourceLevers = [], rawEvidence = [] } = {}) {
  const rootCause = classifySourceEvidence({ baselineCase, rawEvidence });

  return {
    rootCause,
    sourceEvidence: sourceLevers.slice(0, 8),
    rawEvidence: rawEvidence.slice(0, 8),
    offerEvidence: {
      dbCandidateCount: baselineCase.dbCandidateCount || 0,
      trueCandidateCount: baselineCase.likelyTrueProductCount || 0,
      sideHitCount: baselineCase.likelySideHitCount || 0,
      weakOrUnclearCount: baselineCase.weakOrUnclearCount || 0,
      rankedResultCount: baselineCase.rankedResultCount ?? null,
      missingLikelyReason: baselineCase.missingLikelyReason || '',
      examplesExcludedWithReason: (baselineCase.examplesExcludedWithReason || []).slice(0, 5),
    },
    recommendedAction: rootCause === 'no-source-evidence'
      ? `${key}: first targeted source coverage proof; ranking must stay strict.`
      : rootCause === 'raw-evidence-but-no-offer'
        ? `${key}: parser/source extraction proof; raw evidence exists but no safe Offer is visible.`
        : rootCause === 'parser-field-loss'
          ? `${key}: inspect parser field loss before crawl; raw items appear to be dropped or not normalized.`
          : rootCause === 'wrong-category'
            ? `${key}: fix category/comparison mapping for real candidates before source work.`
            : `${key}: inspect listed evidence; avoid broad query relaxation.`,
  };
}

function buildSparCoffeeSection({ sparDiagnostic = {}, sparRawEvidence = [] } = {}) {
  const activeSourceEvidence = (sparDiagnostic.dbSourceBreakdown || [])
    .filter((row) => /aktionsfinder|aggregator/i.test(`${row.sourceType || ''} ${row.sourceUrl || ''}`))
    .slice(0, 8);
  const canActiveAggregatorCrawlHelp = decideActiveAggregatorCrawlHelp({ sparDiagnostic, sparRawEvidence });
  const rootCause = sparDiagnostic.summary?.likelyRootCause || 'unclear';

  return {
    rootCause,
    activeSourceEvidence,
    rawEvidence: sparRawEvidence.slice(0, 10),
    officialSourceStatus: sparDiagnostic.summary?.activeOfficialSparFlyerSourceInCode
      ? 'official-active-in-code'
      : 'spar-official-flyer disabled/fixture-only; previous Node fetch 403 must not be bypassed',
    codeSources: (sparDiagnostic.codeSources || []).filter((source) =>
      ['aktionsfinder-spar', 'aktionsfinder-interspar', 'aktionsfinder-eurospar', 'spar-official-flyer', 'marktguru-spar'].includes(source.sourceKey)
    ),
    canActiveAggregatorCrawlHelp,
    recommendedAction: canActiveAggregatorCrawlHelp === true
      ? 'Prepare a targeted enabled Aktionsfinder SPAR/INTERSPAR/EUROSPAR crawl plus parser verification.'
      : canActiveAggregatorCrawlHelp === null
        ? 'First add source-scoped crawl readiness/freshness proof; current evidence does not prove a crawl will find coffee.'
        : 'Do not run a productive SPAR coffee crawl yet; prepare official snapshot/parser fixture without activation.',
  };
}

function buildSummary({ recommendedNextBlock, sparCoffee = {}, butter = {}, reis = {} } = {}) {
  const canProceedToLiveTestSoon = sparCoffee.canActiveAggregatorCrawlHelp !== false &&
    !recommendedNextBlock.includes('official flyer snapshot');

  return {
    recommendedNextBlock,
    canProceedToLiveTestSoon,
    why: canProceedToLiveTestSoon
      ? 'A limited SPAR Aktionsfinder-focused block can be prepared without source activation or ranking relaxation.'
      : 'Current evidence is not strong enough for a safe productive crawl; fixture/source prep should come first.',
    mainBlocker: sparCoffee.canActiveAggregatorCrawlHelp === false
      ? 'No reliable active-source coffee evidence for SPAR was found.'
      : `Butter=${butter.rootCause || 'unclear'}, Reis=${reis.rootCause || 'unclear'}, SPAR+Kaffee=${sparCoffee.rootCause || 'unclear'}`,
    expectedFirstVisibleWin: canProceedToLiveTestSoon
      ? 'SPAR + Kaffee live result count increases with real active coffee offers.'
      : 'Parser/source readiness becomes provable before any live mutation.',
  };
}

async function fetchOffersForCase({ Offer, queryCase, limit = DEFAULT_LIMIT }) {
  const terms = CASES[queryCase].terms;
  return Offer.find(buildOfferTermMatch(terms, { sparOnly: queryCase === 'spar-kaffee' }))
    .sort({ isActiveNow: -1, isActiveToday: -1, sortScoreDefault: -1, updatedAt: -1 })
    .limit(Math.max(50, Math.min(Number(limit || DEFAULT_LIMIT), 2000)))
    .select(selectOfferFields())
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

async function fetchSourceLevers({ Offer, terms, classifier, sparOnly = false, limit = 12 }) {
  const offers = await Offer.find(buildOfferTermMatch(terms, { sparOnly }))
    .sort({ isActiveNow: -1, isActiveToday: -1, sortScoreDefault: -1, updatedAt: -1 })
    .limit(1200)
    .select(selectOfferFields())
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
  const groups = new Map();

  for (const offer of offers) {
    const key = [
      offer.retailerKey || 'unknown',
      offer.retailerName || '',
      offer.sourceType || '',
      offer.sourceUrl || '',
      String(offer.sourceId || ''),
      offer.categoryKey || '',
    ].join('|');
    const current = groups.get(key) || {
      retailerKey: offer.retailerKey || '',
      retailerName: offer.retailerName || '',
      sourceType: offer.sourceType || '',
      sourceUrl: offer.sourceUrl || '',
      sourceId: String(offer.sourceId || ''),
      categoryKey: offer.categoryKey || '',
      candidateCount: 0,
      trueCount: 0,
      weakCount: 0,
      sideHitCount: 0,
      unclearCount: 0,
      sampleTitles: [],
    };
    const classification = classifier(offer).classification;
    current.candidateCount += 1;
    if (classification === 'true') current.trueCount += 1;
    if (classification === 'weakTrue') current.weakCount += 1;
    if (classification === 'sideHit') current.sideHitCount += 1;
    if (classification === 'unclear') current.unclearCount += 1;
    if (current.sampleTitles.length < 4) current.sampleTitles.push(offer.title || '');
    groups.set(key, current);
  }

  return [...groups.values()]
    .map(summarizeSourceLever)
    .sort((left, right) =>
      (right.trueCount + right.weakCount) - (left.trueCount + left.weakCount) ||
      right.candidateCount - left.candidateCount ||
      left.retailerName.localeCompare(right.retailerName, 'de')
    )
    .slice(0, limit);
}

async function fetchRawEvidence({ RawDocument, terms, sideTerms = [], sparOnly = false, limit = 12 }) {
  const termRegex = buildRegex(terms);
  const sparRegex = /spar|interspar|eurospar|aktionsfinder\.at\/pv\/(?:spar|interspar|eurospar)|marktguru\.at\/r\/spar/i;
  const match = {
    $or: [
      { title: termRegex },
      { contentSnippet: termRegex },
      { extractedPreview: termRegex },
      { url: termRegex },
      { finalUrl: termRegex },
      { canonicalUrl: termRegex },
    ],
  };

  if (sparOnly) {
    match.$and = [
      {
        $or: [
          { retailerKey: sparRegex },
          { url: sparRegex },
          { finalUrl: sparRegex },
          { canonicalUrl: sparRegex },
        ],
      },
    ];
  }

  const docs = await RawDocument.find(match)
    .sort({ fetchedAt: -1 })
    .limit(Math.max(3, Math.min(Number(limit || 12), 25)))
    .select('retailerKey sourceId sourceType documentType url canonicalUrl finalUrl title fetchedAt httpStatus contentSnippet extractedPreview foundRawItems parsedOffers rejectedOffers parserVersion payload')
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();

  return docs.map((doc) => summarizeRawEvidence(doc, { trueTerms: terms, sideTerms }));
}

async function fetchSourcesByOfferIds({ Source, offers = [] }) {
  const sourceIds = unique(offers.map((offer) => String(offer.sourceId || '')));
  if (sourceIds.length === 0) return [];

  return Source.find({ _id: { $in: sourceIds } })
    .select('retailerKey retailerName channel label sourceUrl sourceType sourceRetailerFormat enabled active latestRunAt latestStatus parserHint parserVersion')
    .limit(120)
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

async function buildCoverageLiveReadinessDiagnostic({
  Offer,
  Source,
  RawDocument,
  CrawlJob,
  buildOfferRanking,
  generatedAt = new Date(),
  limit = DEFAULT_LIMIT,
  baseUrl = 'https://www.kaufklug.at',
} = {}) {
  const [
    butterOffers,
    reisOffers,
    sparKaffeeOffers,
    butterSourceLevers,
    reisSourceLevers,
    butterRawEvidence,
    reisRawEvidence,
    sparRawEvidence,
    sparDb,
  ] = await Promise.all([
    fetchOffersForCase({ Offer, queryCase: 'butter', limit }),
    fetchOffersForCase({ Offer, queryCase: 'reis', limit }),
    fetchOffersForCase({ Offer, queryCase: 'spar-kaffee', limit }),
    fetchSourceLevers({ Offer, terms: QUERY_TERMS.butter, classifier: classifyButterOffer }),
    fetchSourceLevers({ Offer, terms: QUERY_TERMS.reis, classifier: classifyRiceOffer }),
    fetchRawEvidence({ RawDocument, terms: BUTTER_TERMS, sideTerms: BUTTER_SIDE_TERMS }),
    fetchRawEvidence({ RawDocument, terms: REIS_TERMS, sideTerms: REIS_SIDE_TERMS }),
    fetchRawEvidence({ RawDocument, terms: SPAR_COFFEE_TERMS, sideTerms: [], sparOnly: true, limit: 20 }),
    fetchSparSourceCoverageInputs({ Offer, Source, RawDocument, CrawlJob, limit: 80 }),
  ]);
  const sources = await fetchSourcesByOfferIds({
    Source,
    offers: [...butterOffers, ...reisOffers, ...sparKaffeeOffers],
  });
  const rankings = buildOfferRanking
    ? {
      butter: await buildOfferRanking({ query: 'butter', limit: 20 }),
      reis: await buildOfferRanking({ query: 'reis', limit: 20 }),
      'spar-kaffee': await buildOfferRanking({ query: 'kaffee', retailers: 'spar', categories: 'Kaffee & Tee', limit: 20 }),
    }
    : {};
  const coverageBaseline = buildCoverageBaselineDiagnostic({
    checkedAt: generatedAt,
    caseOffers: {
      butter: butterOffers,
      reis: reisOffers,
      'spar-kaffee': sparKaffeeOffers,
    },
    sources,
    rankings,
    sparSourceSummary: {
      activeOfferCount: Number(sparDb.activeSparOffersApprox || 0),
      configuredSourceCount: (sparDb.dbConfiguredSources || []).length,
      configuredSources: sparDb.dbConfiguredSources || [],
    },
  });
  const sparDiagnostic = buildSparSourceCoverageDiagnostic({
    checkedAt: generatedAt,
    db: sparDb,
    codeSources: getSparCodeSources(),
  });
  const caseByKey = new Map(coverageBaseline.cases.map((item) => [item.queryCase, item]));
  const butter = buildProductCoverageSection({
    key: 'butter',
    baselineCase: caseByKey.get('butter'),
    sourceLevers: butterSourceLevers,
    rawEvidence: butterRawEvidence,
  });
  const reis = buildProductCoverageSection({
    key: 'reis',
    baselineCase: caseByKey.get('reis'),
    sourceLevers: reisSourceLevers,
    rawEvidence: reisRawEvidence,
  });
  const sparCoffee = buildSparCoffeeSection({
    sparDiagnostic,
    sparRawEvidence,
  });
  const recommendedNextBlock = chooseNextBlock({ butter, reis, sparCoffee });
  const nextLiveTestPlan = buildNextLiveTestPlan({
    recommendedNextBlock,
    sparCoffee,
    baseUrl,
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
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    summary: buildSummary({ recommendedNextBlock, sparCoffee, butter, reis }),
    butter,
    reis,
    sparCoffee,
    nextLiveTestPlan,
    apiBaselinesForLater: {
      commands: buildBaselineCommands({ baseUrl }),
      files: [
        'tmp/baseline-spar-kaffee-before.json',
        'tmp/baseline-kaffee-before.json',
        'tmp/baseline-butter-before.json',
        'tmp/baseline-reis-before.json',
      ],
      note: 'Commands are emitted only; this diagnostic does not call live HTTP.',
    },
    supportingDiagnostics: {
      coverageBaseline,
      sparSourceCoverage: sparDiagnostic,
    },
    guardrails: buildGuardrails(),
  };
}

module.exports = {
  BUTTER_SIDE_TERMS,
  BUTTER_TERMS,
  DEFAULT_LIMIT,
  REIS_SIDE_TERMS,
  REIS_TERMS,
  SPAR_COFFEE_TERMS,
  buildBaselineCommands,
  buildCoverageLiveReadinessDiagnostic,
  buildGuardrails,
  buildLiveSmokeCommands,
  buildNextLiveTestPlan,
  buildPostCrawlChecks,
  buildSuccessCriteria,
  chooseNextBlock,
  classifyRawEvidenceText,
  classifySourceEvidence,
  decideActiveAggregatorCrawlHelp,
  summarizeRawEvidence,
};
