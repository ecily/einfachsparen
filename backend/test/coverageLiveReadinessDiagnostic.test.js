const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildBaselineCommands,
  buildGuardrails,
  buildNextLiveTestPlan,
  buildSuccessCriteria,
  chooseNextBlock,
  classifyRawEvidenceText,
  classifySourceEvidence,
  decideActiveAggregatorCrawlHelp,
  summarizeRawEvidence,
} = require('../src/services/diagnostics/coverageLiveReadinessDiagnostic');

test('raw evidence classification separates true product terms from side hits', () => {
  assert.equal(classifyRawEvidenceText({
    text: 'SPAR Teebutter 250 g gueltig bis Samstag',
    trueTerms: ['Teebutter', 'Butter'],
    sideTerms: ['Buttermilch', 'Body Butter'],
  }), 'trueProduct');

  assert.equal(classifyRawEvidenceText({
    text: 'Body Butter mit Vanilleduft',
    trueTerms: ['Butter'],
    sideTerms: ['Body Butter'],
  }), 'sideHit');
});

test('raw evidence summary stays compact and reports matched terms', () => {
  const summary = summarizeRawEvidence({
    _id: 'raw-a',
    retailerKey: 'spar',
    sourceType: 'aktionsfinder-json',
    url: 'https://www.aktionsfinder.at/pv/spar/',
    title: 'Meinl Kaffee',
    fetchedAt: new Date('2026-05-10T10:00:00.000Z'),
    httpStatus: 200,
    foundRawItems: 10,
    parsedOffers: 8,
    extractedPreview: ['Meinl Praesident Kaffee 500 g', 'Andere Aktion'],
    payload: { promotionCount: 10, sampleNames: ['Meinl Kaffee'] },
  }, {
    trueTerms: ['Meinl', 'Kaffee'],
    sideTerms: [],
  });

  assert.equal(summary.id, 'raw-a');
  assert.equal(summary.matchClassification, 'trueProduct');
  assert.deepEqual(summary.matchedTerms, ['Meinl', 'Kaffee']);
  assert.equal(summary.payloadSummary.promotionCount, 10);
});

test('source evidence root cause detects no source, raw-only, parser loss and filtered offers', () => {
  assert.equal(classifySourceEvidence({
    baselineCase: { likelyTrueProductCount: 0, rankedResultCount: 0 },
    rawEvidence: [],
  }), 'no-source-evidence');

  assert.equal(classifySourceEvidence({
    baselineCase: { likelyTrueProductCount: 0, rankedResultCount: 0 },
    rawEvidence: [{ matchClassification: 'trueProduct', foundRawItems: 0, parsedOffers: 0 }],
  }), 'raw-evidence-but-no-offer');

  assert.equal(classifySourceEvidence({
    baselineCase: { likelyTrueProductCount: 0, rankedResultCount: 0 },
    rawEvidence: [{ matchClassification: 'trueProduct', foundRawItems: 12, parsedOffers: 0 }],
  }), 'parser-field-loss');

  assert.equal(classifySourceEvidence({
    baselineCase: { likelyTrueProductCount: 2, rankedResultCount: 0, examplesExcludedWithReason: [] },
    rawEvidence: [],
  }), 'offer-exists-but-filtered');

  assert.equal(classifySourceEvidence({
    baselineCase: {
      likelyTrueProductCount: 2,
      rankedResultCount: 0,
      examplesExcludedWithReason: [{ exclusionReason: 'category-filter' }],
    },
    rawEvidence: [],
  }), 'wrong-category');
});

test('SPAR active aggregator readiness uses raw/source evidence without requiring HTTP', () => {
  assert.equal(decideActiveAggregatorCrawlHelp({
    sparDiagnostic: {
      codeSources: [{ channel: 'aggregator', appearsActive: true }],
      summary: { sparOffersInDb: 448, sparCoffeeOffersInDb: 1 },
      dbSourceBreakdown: [],
    },
    sparRawEvidence: [{
      matchClassification: 'trueProduct',
      sourceType: 'aktionsfinder-json',
      url: 'https://www.aktionsfinder.at/pv/spar/',
    }],
  }), true);

  assert.equal(decideActiveAggregatorCrawlHelp({
    sparDiagnostic: {
      codeSources: [{ channel: 'aggregator', appearsActive: true }],
      summary: { sparOffersInDb: 448, sparCoffeeOffersInDb: 1 },
      dbSourceBreakdown: [],
    },
    sparRawEvidence: [],
  }), null);

  assert.equal(decideActiveAggregatorCrawlHelp({
    sparDiagnostic: {
      codeSources: [],
      summary: { sparOffersInDb: 0, sparCoffeeOffersInDb: 0 },
      dbSourceBreakdown: [],
    },
    sparRawEvidence: [],
  }), false);
});

test('next block prioritization keeps SPAR coffee as first visible live-test candidate when possible', () => {
  assert.equal(chooseNextBlock({
    butter: { rootCause: 'no-source-evidence' },
    reis: { rootCause: 'no-source-evidence' },
    sparCoffee: { rootCause: 'source-disabled', canActiveAggregatorCrawlHelp: true },
  }), 'Targeted SPAR Aktionsfinder coffee crawl/parser verification');

  assert.equal(chooseNextBlock({
    butter: { rootCause: 'parser-field-loss' },
    reis: { rootCause: 'no-source-evidence' },
    sparCoffee: { rootCause: 'source-disabled', canActiveAggregatorCrawlHelp: false },
  }), 'Butter parser/source field-loss fixture block');
});

test('baseline command generation includes requested API files', () => {
  const commands = buildBaselineCommands({ baseUrl: 'https://www.kaufklug.at' });

  assert.equal(commands.length, 4);
  assert.ok(commands.some((item) => item.command.includes('q=kaffee&retailers=spar&limit=20')));
  assert.ok(commands.some((item) => item.outputFile === 'tmp/baseline-butter-before.json'));
  assert.ok(commands.every((item) => item.command.startsWith('curl.exe -sS')));
});

test('next live test plan emits crawl, post-crawl and smoke details', () => {
  const plan = buildNextLiveTestPlan({
    recommendedNextBlock: 'Targeted SPAR Aktionsfinder coffee crawl/parser verification',
    sparCoffee: { canActiveAggregatorCrawlHelp: true },
    baseUrl: 'https://www.kaufklug.at',
  });

  assert.equal(plan.requiresCrawl, true);
  assert.equal(plan.requiresSourceActivation, 'no');
  assert.deepEqual(plan.targetSources, ['aktionsfinder-spar', 'aktionsfinder-interspar', 'aktionsfinder-eurospar']);
  assert.ok(plan.exactCrawlCommandOrAdminEndpointToUse.some((item) => item.includes('POST /api/crawl/run')));
  assert.ok(plan.exactPostCrawlChecks.some((item) => item.includes('CrawlJob')));
  assert.ok(plan.exactLiveSmokeCommands.some((item) => item.includes('/api/offers/ranking?q=kaffee')));
});

test('SPAR freshness proof stays scoped to active aggregators, not official activation', () => {
  const plan = buildNextLiveTestPlan({
    recommendedNextBlock: 'SPAR Aktionsfinder source freshness proof before official SPAR prep',
    sparCoffee: { canActiveAggregatorCrawlHelp: null },
    baseUrl: 'https://www.kaufklug.at',
  });

  assert.equal(plan.requiresCrawl, true);
  assert.equal(plan.requiresSourceActivation, 'no');
  assert.deepEqual(plan.targetSources, ['aktionsfinder-spar', 'aktionsfinder-interspar', 'aktionsfinder-eurospar']);
});

test('success criteria and guardrails preserve product quality constraints', () => {
  const criteria = buildSuccessCriteria({ target: 'spar-aktionsfinder-coffee' });
  const guardrails = buildGuardrails();

  assert.ok(criteria.some((item) => item.includes('product, retailer/format, validity, quantity/unit and condition')));
  assert.ok(criteria.some((item) => item.includes('No SPAR official source was activated')));
  assert.ok(guardrails.includes('no DB mutation'));
  assert.ok(guardrails.includes('no ranking relaxation'));
  assert.ok(guardrails.includes('tests use pure helper functions only and require no DB/live HTTP'));
});
