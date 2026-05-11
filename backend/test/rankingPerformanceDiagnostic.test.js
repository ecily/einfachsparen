const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  assertReadOnlySource,
  buildCasesFromOptions,
  buildIndexRecommendations,
  classifyWarningLevel,
  parseArgs,
  printReadableReport,
  sanitizeForOutput,
  summarizeExecutionStats,
} = require('../src/services/diagnostics/rankingPerformanceDiagnostic');

test('classifies ranking performance warning levels', () => {
  assert.equal(classifyWarningLevel(399), 'OK');
  assert.equal(classifyWarningLevel(400), 'WARN');
  assert.equal(classifyWarningLevel(800), 'WARN');
  assert.equal(classifyWarningLevel(1200), 'SLOW');
  assert.equal(classifyWarningLevel(2000), 'BLOCKER');
});

test('parses optional JSON output path for Git Bash and PowerShell invocations', () => {
  assert.deepEqual(parseArgs([]), { jsonPath: '', jsonToStdout: false, query: '', debugCandidates: false });
  assert.deepEqual(parseArgs(['--json']), { jsonPath: '', jsonToStdout: true, query: '', debugCandidates: false });
  assert.deepEqual(parseArgs(['--json', 'tmp/ranking-performance.json']), {
    jsonPath: 'tmp/ranking-performance.json',
    jsonToStdout: false,
    query: '',
    debugCandidates: false,
  });
  assert.deepEqual(parseArgs(['--json=tmp/ranking-performance.json']), {
    jsonPath: 'tmp/ranking-performance.json',
    jsonToStdout: false,
    query: '',
    debugCandidates: false,
  });
  assert.deepEqual(parseArgs(['--query', 'reis', '--debug-candidates']), {
    jsonPath: '',
    jsonToStdout: false,
    query: 'reis',
    debugCandidates: true,
  });
});

test('builds a single debug diagnostic case from query options', () => {
  const cases = buildCasesFromOptions({ query: 'milch', debugCandidates: true });

  assert.equal(cases.length, 1);
  assert.equal(cases[0].label, 'milch');
  assert.deepEqual(cases[0].args, { query: 'milch', limit: 20 });
  assert.equal(cases[0].debugCandidates, true);
});

test('summarizes executionStats with index and COLLSCAN details', () => {
  const summary = summarizeExecutionStats({
    queryPlanner: {
      winningPlan: {
        stage: 'FETCH',
        inputStage: { stage: 'IXSCAN', indexName: 'status_1_isActiveNow_1_retailerKey_1' },
      },
    },
    executionStats: {
      executionTimeMillis: 12,
      totalDocsExamined: 42,
      totalKeysExamined: 45,
      nReturned: 20,
    },
  });

  assert.equal(summary.executionTimeMillis, 12);
  assert.equal(summary.totalDocsExamined, 42);
  assert.deepEqual(summary.indexNames, ['status_1_isActiveNow_1_retailerKey_1']);
  assert.equal(summary.hasCollectionScan, false);
});

test('readable output keeps a stable compact format and redacts secret-like fields', () => {
  const report = {
    generatedAt: '2026-05-11T12:00:00.000Z',
    readOnly: true,
    mutatedCollections: [],
    cases: [
      {
        label: 'kaffee',
        apiParams: { q: 'kaffee', ADMIN_API_KEY: 'should-not-print' },
        timings: { totalMs: 12.34, dbLoadMs: 4, rankingMs: 5, responseMappingMs: 3 },
        candidateCountBeforeRanking: 10,
        queryTokens: ['kaffee'],
        usesSearchTokens: true,
        candidateQueryMode: 'searchTokensOnly',
        fallbackUsed: false,
        fallbackReason: '',
        resultCount: 8,
        displayedCount: 5,
        responseSizeBytes: 1234,
        warningLevel: 'OK',
        executionStats: {
          executionTimeMillis: 2,
          totalDocsExamined: 10,
          totalKeysExamined: 12,
          nReturned: 10,
          indexNames: ['status_1_isActiveNow_1_retailerKey_1'],
          hasCollectionScan: false,
        },
        fallbackExecutionStats: null,
        totalExecutionStats: {
          totalDocsExamined: 10,
          totalKeysExamined: 12,
        },
      },
    ],
    recommendations: ['kaffee: Empfehlung'],
  };
  const lines = [];
  const originalLog = console.log;
  console.log = (line = '') => lines.push(String(line));

  try {
    printReadableReport(report);
  } finally {
    console.log = originalLog;
  }

  const output = lines.join('\n');
  assert.match(output, /Ranking Performance Diagnostic/);
  assert.match(output, /\[OK\] kaffee/);
  assert.match(output, /candidateQueryMode=searchTokensOnly/);
  assert.match(output, /fallbackUsed=false/);
  assert.match(output, /docsExamined=10/);
  assert.doesNotMatch(output, /should-not-print/);
  assert.match(output, /\[redacted\]/);
});

test('diagnostic sanitization redacts secrets and renders regex safely', () => {
  const sanitized = sanitizeForOutput({
    MONGODB_URI: 'mongodb+srv://secret',
    searchTokens: ['reis', 'risottoreis'],
    filter: /kaffee/i,
  });

  assert.equal(sanitized.MONGODB_URI, '[redacted]');
  assert.deepEqual(sanitized.searchTokens, ['reis', 'risottoreis']);
  assert.deepEqual(sanitized.filter, { $regex: 'kaffee', $options: 'i' });
});

test('ranking performance diagnostic sources do not use database write methods', () => {
  const files = [
    path.resolve(__dirname, '../scripts/rankingPerformanceSmoke.js'),
    path.resolve(__dirname, '../src/services/diagnostics/rankingPerformanceDiagnostic.js'),
  ];

  for (const file of files) {
    assert.equal(assertReadOnlySource(fs.readFileSync(file, 'utf8')), true, file);
  }
});

test('index recommendations mention collection scans and regex search pressure', () => {
  const recommendations = buildIndexRecommendations([
    {
      label: 'kaffee',
      executionStats: { hasCollectionScan: true, totalDocsExamined: 1000, nReturned: 10 },
      mongoQueryShape: {
        match: {
          $and: [
            { $or: [{ titleNormalized: { $regex: 'kaffee', $options: 'i' } }] },
          ],
        },
      },
    },
  ]);

  assert.equal(recommendations.length, 2);
  assert.match(recommendations.join('\n'), /COLLSCAN/);
  assert.match(recommendations.join('\n'), /Regex-Suche/);
});
