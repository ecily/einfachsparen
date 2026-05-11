const fs = require('node:fs/promises');
const path = require('node:path');

const {
  buildOfferRanking,
  buildRankingCandidateMatch,
  clearRankingResponseCache,
  getRankingResponseCacheSize,
} = require('../offers/offerRankingService');

const DEFAULT_RANKING_PERFORMANCE_CASES = [
  { label: 'kaffee', params: { q: 'kaffee', limit: 20 }, args: { query: 'kaffee', limit: 20 } },
  { label: 'kaffee + retailer spar', params: { q: 'kaffee', retailers: 'spar', limit: 20 }, args: { query: 'kaffee', retailers: 'spar', limit: 20 } },
  { label: 'reis', params: { q: 'reis', limit: 20 }, args: { query: 'reis', limit: 20 } },
  { label: 'milch', params: { q: 'milch', limit: 20 }, args: { query: 'milch', limit: 20 } },
  { label: 'nudeln', params: { q: 'nudeln', limit: 20 }, args: { query: 'nudeln', limit: 20 } },
  { label: 'waschmittel', params: { q: 'waschmittel', limit: 20 }, args: { query: 'waschmittel', limit: 20 } },
  { label: 'bier', params: { q: 'bier', limit: 20 }, args: { query: 'bier', limit: 20 } },
];

const SECRET_KEY_PATTERN = /(secret|password|token|authorization|api[_-]?key|mongodb|uri|connection)/i;
const SAFE_TOKEN_FIELD_KEYS = new Set([
  'queryTokens',
  'searchTokens',
  'searchTokenVersion',
]);
const WRITE_METHOD_PATTERN = /\.(create|insertMany|insertOne|updateOne|updateMany|replaceOne|deleteOne|deleteMany|findOneAndUpdate|findByIdAndUpdate|bulkWrite|save)\s*\(/;

function classifyWarningLevel(totalMs) {
  const value = Number(totalMs) || 0;

  if (value >= 2000) return 'BLOCKER';
  if (value >= 1200) return 'SLOW';
  if (value >= 800) return 'WARN';
  if (value >= 400) return 'WARN';
  return 'OK';
}

function sanitizeForOutput(value, seen = new WeakSet()) {
  if (value instanceof RegExp) {
    return { $regex: value.source, $options: value.flags };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForOutput(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEY_PATTERN.test(key) && !SAFE_TOKEN_FIELD_KEYS.has(key) ? '[redacted]' : sanitizeForOutput(entry, seen),
    ])
  );
}

function walkPlan(node, visitor) {
  if (!node || typeof node !== 'object') {
    return;
  }

  visitor(node);

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      value.forEach((item) => walkPlan(item, visitor));
    } else if (value && typeof value === 'object') {
      walkPlan(value, visitor);
    }
  }
}

function extractPlanSummary(explain) {
  const winningPlan = explain?.queryPlanner?.winningPlan || null;
  const indexNames = new Set();
  const stages = new Set();
  let hasCollectionScan = false;

  walkPlan(winningPlan, (node) => {
    if (node.stage) {
      stages.add(node.stage);
      if (node.stage === 'COLLSCAN') {
        hasCollectionScan = true;
      }
    }

    if (node.indexName) {
      indexNames.add(node.indexName);
    }
  });

  return {
    stageSummary: [...stages],
    indexNames: [...indexNames],
    winningPlan: sanitizeForOutput(winningPlan),
    hasCollectionScan,
  };
}

function summarizeExecutionStats(explain) {
  const stats = explain?.executionStats || {};
  const plan = extractPlanSummary(explain);

  return {
    executionTimeMillis: stats.executionTimeMillis ?? null,
    totalDocsExamined: stats.totalDocsExamined ?? null,
    totalKeysExamined: stats.totalKeysExamined ?? null,
    nReturned: stats.nReturned ?? null,
    indexNames: plan.indexNames,
    winningPlanStages: plan.stageSummary,
    winningPlan: plan.winningPlan,
    hasCollectionScan: plan.hasCollectionScan,
  };
}

function estimateResponseSizeBytes(response) {
  return Buffer.byteLength(JSON.stringify(sanitizeForOutput(response)), 'utf8');
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function buildIndexRecommendations(cases = []) {
  const recommendations = [];

  for (const item of cases) {
    const stats = item.executionStats || {};
    const docsExamined = Number(stats.totalDocsExamined || 0);
    const returned = Number(stats.nReturned || 0);
    const highScanRatio = returned > 0 && docsExamined / returned >= 20;

    if (stats.hasCollectionScan) {
      recommendations.push(`${item.label}: Mongo winningPlan enthaelt COLLSCAN; pruefe einen selektiven Index fuer status/isActiveNow plus haeufige Filter/Suche.`);
    } else if (highScanRatio) {
      recommendations.push(`${item.label}: totalDocsExamined (${docsExamined}) ist hoch relativ zu nReturned (${returned}); pruefe selektivere Vorfilter oder Materialisierung suchbarer Tokens.`);
    }

    if (item.mongoQueryShape?.match?.$and?.some((part) => part?.$or?.some((entry) =>
      Object.values(entry).some((value) => value && typeof value === 'object' && value.$regex)
    ))) {
      recommendations.push(`${item.label}: Regex-Suche ueber mehrere Felder ist sichtbar; fuer Skalierung waeren normalisierte Such-Tokens oder ein passender Text-/Atlas-Search-Pfad naheliegend.`);
    }
  }

  return [...new Set(recommendations)];
}

async function diagnoseRankingCase(testCase) {
  clearRankingResponseCache();
  const result = await buildOfferRanking({
    ...testCase.args,
    diagnostics: true,
    debugCandidates: Boolean(testCase.debugCandidates),
  });
  const response = result.response;
  const timings = result.diagnostics.timings;
  const mongo = result.diagnostics.mongo || {};
  const serializationStartedAt = nowMs();
  const responseSizeBytes = estimateResponseSizeBytes(response);
  const serializationMs = nowMs() - serializationStartedAt;
  const primaryExecutionStats = summarizeExecutionStats(mongo.primaryExecutionStats || mongo.executionStats);
  const fallbackExecutionStats = mongo.fallbackExecutionStats
    ? summarizeExecutionStats(mongo.fallbackExecutionStats)
    : null;
  const totalDocsExamined = Number(primaryExecutionStats.totalDocsExamined || 0) +
    Number(fallbackExecutionStats?.totalDocsExamined || 0);
  const totalKeysExamined = Number(primaryExecutionStats.totalKeysExamined || 0) +
    Number(fallbackExecutionStats?.totalKeysExamined || 0);

  return {
    label: testCase.label,
    apiParams: testCase.params,
    mongoQueryShape: sanitizeForOutput({
      match: mongo.match || buildRankingCandidateMatch({
        query: testCase.args.query || '',
        selectedRetailers: testCase.args.retailers ? [testCase.args.retailers] : [],
      }),
      sort: mongo.sort || {},
      limit: mongo.limit ?? null,
      projectionFields: mongo.fields || [],
    }),
    queryTokens: mongo.queryMetadata?.queryTokens || [],
    usesSearchTokens: Boolean(mongo.queryMetadata?.usesSearchTokens),
    candidateQueryMode: mongo.queryMetadata?.candidateQueryMode || (testCase.args.query ? 'fallbackRegex' : 'noTextQuery'),
    fallbackUsed: Boolean(mongo.queryMetadata?.fallbackUsed),
    fallbackReason: mongo.queryMetadata?.fallbackReason || '',
    executionStats: primaryExecutionStats,
    primaryExecutionStats,
    fallbackExecutionStats,
    totalExecutionStats: {
      totalDocsExamined,
      totalKeysExamined,
    },
    projectionFieldCount: Array.isArray(mongo.fields) ? mongo.fields.length : 0,
    loadedDocumentCount: mongo.loadTimings?.loadedDocumentCount ?? response.summary?.candidateCount ?? null,
    loadedDocumentBytes: mongo.loadTimings?.loadedDocumentBytes ?? null,
    candidateCountBeforeRanking: response.summary?.candidateCount ?? null,
    debugCandidates: testCase.debugCandidates ? sanitizeForOutput(result.diagnostics.candidates || null) : null,
    timings: {
      ...timings,
      serializationMs: Number(serializationMs.toFixed(1)),
    },
    responseSizeBytes,
    resultCount: response.summary?.resultCount ?? null,
    displayedCount: response.summary?.displayedCount ?? null,
    warningLevel: classifyWarningLevel(timings.totalMs),
  };
}

async function measureCacheCase(testCase) {
  clearRankingResponseCache();
  const beforeCacheSize = getRankingResponseCacheSize();
  const coldStartedAt = nowMs();
  const coldResponse = await buildOfferRanking(testCase.args);
  const coldBuildMs = nowMs() - coldStartedAt;
  const coldSerializationStartedAt = nowMs();
  const coldResponseSizeBytes = estimateResponseSizeBytes(coldResponse);
  const coldSerializationMs = nowMs() - coldSerializationStartedAt;
  const afterColdCacheSize = getRankingResponseCacheSize();
  const warmStartedAt = nowMs();
  const warmResponse = await buildOfferRanking(testCase.args);
  const warmBuildMs = nowMs() - warmStartedAt;
  const warmSerializationStartedAt = nowMs();
  const warmResponseSizeBytes = estimateResponseSizeBytes(warmResponse);
  const warmSerializationMs = nowMs() - warmSerializationStartedAt;

  return {
    beforeCacheSize,
    afterColdCacheSize,
    afterWarmCacheSize: getRankingResponseCacheSize(),
    cold: {
      totalMs: Number((coldBuildMs + coldSerializationMs).toFixed(1)),
      buildMs: Number(coldBuildMs.toFixed(1)),
      serializationMs: Number(coldSerializationMs.toFixed(1)),
      responseSizeBytes: coldResponseSizeBytes,
      resultCount: coldResponse.summary?.resultCount ?? null,
      displayedCount: coldResponse.summary?.displayedCount ?? null,
      cacheHit: false,
    },
    warm: {
      totalMs: Number((warmBuildMs + warmSerializationMs).toFixed(1)),
      buildMs: Number(warmBuildMs.toFixed(1)),
      serializationMs: Number(warmSerializationMs.toFixed(1)),
      responseSizeBytes: warmResponseSizeBytes,
      resultCount: warmResponse.summary?.resultCount ?? null,
      displayedCount: warmResponse.summary?.displayedCount ?? null,
      cacheHit: afterColdCacheSize > beforeCacheSize,
    },
  };
}

async function buildRankingPerformanceDiagnostic({ cases = DEFAULT_RANKING_PERFORMANCE_CASES } = {}) {
  const results = [];

  for (const testCase of cases) {
    const diagnostic = await diagnoseRankingCase(testCase);
    diagnostic.cacheProbe = await measureCacheCase(testCase);
    results.push(diagnostic);
  }

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    mutatedCollections: [],
    cases: results,
    recommendations: buildIndexRecommendations(results),
  };
}

function parseArgs(argv = []) {
  const options = {
    jsonPath: '',
    jsonToStdout: false,
    query: '',
    debugCandidates: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--json') {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        options.jsonPath = next;
        index += 1;
      } else {
        options.jsonToStdout = true;
      }
      continue;
    }

    if (arg.startsWith('--json=')) {
      options.jsonPath = arg.slice('--json='.length);
      continue;
    }

    if (arg === '--query' || arg === '-q') {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        options.query = next;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith('--query=')) {
      options.query = arg.slice('--query='.length);
      continue;
    }

    if (arg === '--debug-candidates') {
      options.debugCandidates = true;
    }
  }

  return options;
}

function buildCasesFromOptions(options = {}) {
  const query = String(options.query || '').trim();

  if (!query) {
    return DEFAULT_RANKING_PERFORMANCE_CASES.map((testCase) => ({
      ...testCase,
      debugCandidates: Boolean(options.debugCandidates),
    }));
  }

  return [
    {
      label: query,
      params: { q: query, limit: 20 },
      args: { query, limit: 20 },
      debugCandidates: Boolean(options.debugCandidates),
    },
  ];
}

async function writeJsonReport(filePath, report) {
  const resolved = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return resolved;
}

function formatMs(value) {
  return `${Number(value || 0).toFixed(1)} ms`;
}

function printReadableReport(report, { jsonPath = '' } = {}) {
  console.log(`Ranking Performance Diagnostic (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} mutatedCollections=${report.mutatedCollections.length}`);
  if (jsonPath) {
    console.log(`json=${jsonPath}`);
  }

  for (const item of report.cases) {
    const stats = item.executionStats;
    console.log('');
    console.log(`[${item.warningLevel}] ${item.label}`);
    console.log(`  apiParams=${JSON.stringify(sanitizeForOutput(item.apiParams))}`);
    console.log(`  queryTokens=${JSON.stringify(item.queryTokens)} candidateQueryMode=${item.candidateQueryMode} usesSearchTokens=${item.usesSearchTokens} fallbackUsed=${item.fallbackUsed} fallbackReason=${item.fallbackReason || '-'}`);
    console.log(`  total=${formatMs(item.timings.totalMs)} db=${formatMs(item.timings.dbLoadMs)} ranking=${formatMs(item.timings.rankingMs)} mapping=${formatMs(item.timings.responseMappingMs)} serialization=${formatMs(item.timings.serializationMs)}`);
    console.log(`  dbSplit category=${formatMs(item.timings.categoryLoadMs)} candidateFind=${formatMs(item.timings.candidateFindMs)} retailers=${formatMs(item.timings.retailerLoadMs)} cacheLookup=${formatMs(item.timings.cacheLookupMs)} explain=${formatMs(item.timings.explainMs)}`);
    console.log(`  rankingSplit active=${formatMs(item.timings.activeFilterMs)} program=${formatMs(item.timings.programFilterMs)} unit=${formatMs(item.timings.unitFilterMs)} queryScore=${formatMs(item.timings.queryMatchMs)} dedupe=${formatMs(item.timings.dedupeMs)} scoreCache=${formatMs(item.timings.scoreCacheMs)} sort=${formatMs(item.timings.sortMs)}`);
    console.log(`  mappingSplit prepare=${formatMs(item.timings.responsePreparationMs)} finalDedupe=${formatMs(item.timings.finalDedupeMs)} visibleDedupe=${formatMs(item.timings.visibleDedupeMs)} hydrate=${formatMs(item.timings.responseHydrationMs)} mapOffers=${formatMs(item.timings.rankedOfferMappingMs)} assemble=${formatMs(item.timings.responseAssemblyMs)}`);
    console.log(`  candidates=${item.candidateCountBeforeRanking} loadedDocs=${item.loadedDocumentCount} loadedBytes=${item.loadedDocumentBytes ?? '-'} projectionFields=${item.projectionFieldCount} resultCount=${item.resultCount} displayed=${item.displayedCount} responseBytes=${item.responseSizeBytes}`);
    if (item.cacheProbe) {
      console.log(`  cache cold=${formatMs(item.cacheProbe.cold.totalMs)} (build=${formatMs(item.cacheProbe.cold.buildMs)} serialize=${formatMs(item.cacheProbe.cold.serializationMs)}) warm=${formatMs(item.cacheProbe.warm.totalMs)} (build=${formatMs(item.cacheProbe.warm.buildMs)} serialize=${formatMs(item.cacheProbe.warm.serializationMs)}) hit=${item.cacheProbe.warm.cacheHit}`);
    }
    console.log(`  primary execution=${stats.executionTimeMillis}ms docsExamined=${stats.totalDocsExamined} keysExamined=${stats.totalKeysExamined} nReturned=${stats.nReturned}`);
    console.log(`  primary plan indexes=${stats.indexNames.length ? stats.indexNames.join(',') : '-'} collscan=${stats.hasCollectionScan}`);
    if (item.fallbackExecutionStats) {
      const fallback = item.fallbackExecutionStats;
      console.log(`  fallback execution=${fallback.executionTimeMillis}ms docsExamined=${fallback.totalDocsExamined} keysExamined=${fallback.totalKeysExamined} nReturned=${fallback.nReturned}`);
      console.log(`  fallback plan indexes=${fallback.indexNames.length ? fallback.indexNames.join(',') : '-'} collscan=${fallback.hasCollectionScan}`);
    }
    console.log(`  totalDocsExamined=${item.totalExecutionStats.totalDocsExamined} totalKeysExamined=${item.totalExecutionStats.totalKeysExamined}`);
    if (item.debugCandidates?.stages?.length) {
      for (const stage of item.debugCandidates.stages) {
        console.log(`  debug ${stage.stage}: count=${stage.count}`);
        for (const candidate of stage.top.slice(0, 20)) {
          console.log(`    - id=${candidate.id} retailer=${candidate.retailerKey} score=${candidate.score ?? '-'} title=${candidate.title}`);
          console.log(`      searchTokens=${JSON.stringify(candidate.searchTokens)}`);
        }
        for (const removed of stage.removed || []) {
          console.log(`      removed id=${removed.id} reason=${removed.reason}`);
        }
      }
    }
  }

  if (report.recommendations.length > 0) {
    console.log('');
    console.log('Empfehlungen:');
    for (const recommendation of report.recommendations) {
      console.log(`- ${recommendation}`);
    }
  }
}

function assertReadOnlySource(source) {
  return !WRITE_METHOD_PATTERN.test(source);
}

module.exports = {
  DEFAULT_RANKING_PERFORMANCE_CASES,
  WRITE_METHOD_PATTERN,
  assertReadOnlySource,
  buildIndexRecommendations,
  buildCasesFromOptions,
  buildRankingPerformanceDiagnostic,
  classifyWarningLevel,
  estimateResponseSizeBytes,
  extractPlanSummary,
  parseArgs,
  printReadableReport,
  sanitizeForOutput,
  summarizeExecutionStats,
  writeJsonReport,
};
