const fs = require('node:fs/promises');
const path = require('node:path');

const {
  buildOfferRanking,
  buildRankingCandidateMatch,
  clearRankingResponseCache,
} = require('../offers/offerRankingService');

const DEFAULT_RANKING_PERFORMANCE_CASES = [
  { label: 'kaffee', params: { q: 'kaffee', limit: 20 }, args: { query: 'kaffee', limit: 20 } },
  { label: 'kaffee + retailer spar', params: { q: 'kaffee', retailers: 'spar', limit: 20 }, args: { query: 'kaffee', retailers: 'spar', limit: 20 } },
  { label: 'butter', params: { q: 'butter', limit: 20 }, args: { query: 'butter', limit: 20 } },
  { label: 'reis', params: { q: 'reis', limit: 20 }, args: { query: 'reis', limit: 20 } },
  { label: 'waschmittel', params: { q: 'waschmittel', limit: 20 }, args: { query: 'waschmittel', limit: 20 } },
  { label: 'milch', params: { q: 'milch', limit: 20 }, args: { query: 'milch', limit: 20 } },
  { label: 'joghurt', params: { q: 'joghurt', limit: 20 }, args: { query: 'joghurt', limit: 20 } },
  { label: 'nudeln', params: { q: 'nudeln', limit: 20 }, args: { query: 'nudeln', limit: 20 } },
  { label: 'bier', params: { q: 'bier', limit: 20 }, args: { query: 'bier', limit: 20 } },
];

const SECRET_KEY_PATTERN = /(secret|password|token|authorization|api[_-]?key|mongodb|uri|connection)/i;
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
      SECRET_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeForOutput(entry, seen),
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
  });
  const response = result.response;
  const timings = result.diagnostics.timings;
  const mongo = result.diagnostics.mongo || {};
  const executionStats = summarizeExecutionStats(mongo.executionStats);

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
    executionStats,
    candidateCountBeforeRanking: response.summary?.candidateCount ?? null,
    timings,
    responseSizeBytes: estimateResponseSizeBytes(response),
    resultCount: response.summary?.resultCount ?? null,
    displayedCount: response.summary?.displayedCount ?? null,
    warningLevel: classifyWarningLevel(timings.totalMs),
  };
}

async function buildRankingPerformanceDiagnostic({ cases = DEFAULT_RANKING_PERFORMANCE_CASES } = {}) {
  const results = [];

  for (const testCase of cases) {
    results.push(await diagnoseRankingCase(testCase));
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
    }
  }

  return options;
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
    console.log(`  queryTokens=${JSON.stringify(item.queryTokens)} candidateQueryMode=${item.candidateQueryMode} usesSearchTokens=${item.usesSearchTokens}`);
    console.log(`  total=${formatMs(item.timings.totalMs)} db=${formatMs(item.timings.dbLoadMs)} ranking=${formatMs(item.timings.rankingMs)} mapping=${formatMs(item.timings.responseMappingMs)}`);
    console.log(`  candidates=${item.candidateCountBeforeRanking} resultCount=${item.resultCount} displayed=${item.displayedCount} responseBytes=${item.responseSizeBytes}`);
    console.log(`  mongo execution=${stats.executionTimeMillis}ms docsExamined=${stats.totalDocsExamined} keysExamined=${stats.totalKeysExamined} nReturned=${stats.nReturned}`);
    console.log(`  plan indexes=${stats.indexNames.length ? stats.indexNames.join(',') : '-'} collscan=${stats.hasCollectionScan}`);
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
