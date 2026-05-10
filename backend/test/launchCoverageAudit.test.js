const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildCrawlGuardrailChecklist,
  buildRoadmap,
  classifyOfficialVisibilityHypothesis,
  classifyPagroOfficialOpportunity,
  exactVerificationPlan,
  prioritizeFixBlocks,
} = require('../src/services/diagnostics/launchCoverageAudit');
const {
  classifyButterOffer,
  classifyRiceOffer,
} = require('../src/services/diagnostics/queryQualityGapsDiagnostic');

function source(overrides = {}) {
  return {
    retailerKey: 'pagro',
    retailerName: 'PAGRO',
    channel: 'aggregator',
    sourceUrl: 'https://www.aktionsfinder.at/pv/pagro-libro/',
    label: 'Aktionsfinder PAGRO & LIBRO Aktionen',
    ...overrides,
  };
}

function offer(overrides = {}) {
  return {
    title: 'Ja Natuerlich Teebutter 250 g',
    titleNormalized: 'ja natuerlich teebutter 250 g',
    brand: 'Ja Natuerlich',
    searchText: '',
    categoryPrimary: 'Milchprodukte',
    categorySecondary: 'Butter',
    categoryKey: 'milchprodukte',
    subcategoryKey: 'butter',
    comparisonGroup: 'teebutter',
    quantityText: '250 g',
    ...overrides,
  };
}

test('Butter/Reis helpers separate true products from side hits for launch audit', () => {
  assert.equal(classifyButterOffer(offer()).classification, 'true');
  assert.equal(classifyButterOffer(offer({
    title: 'Body Butter Kokos',
    titleNormalized: 'body butter kokos',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: 'Koerperpflege',
    categoryKey: 'drogerie-hygiene',
    subcategoryKey: 'koerperpflege',
    comparisonGroup: 'body-butter-kokos',
  })).classification, 'sideHit');
  assert.equal(classifyRiceOffer(offer({
    title: 'Basmati Reis 1 kg',
    titleNormalized: 'basmati reis 1 kg',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Grundnahrungsmittel',
  })).classification, 'true');
  assert.equal(classifyRiceOffer(offer({
    title: 'Tomaten Sugo Basilico',
    titleNormalized: 'tomaten sugo basilico',
  })).classification, 'sideHit');
});

test('PAGRO official opportunity is classified as missing official source with aggregator coverage', () => {
  const result = classifyPagroOfficialOpportunity({
    codeSources: [source()],
    db: { offerCount: 42 },
    urlReferenced: true,
  });

  assert.equal(result.status, 'official-opportunity');
  assert.match(result.recommendedPreparation, /disabled source config/);
  assert.equal(result.urlReferenced, true);
});

test('PAGRO official source presence is detected before recommending missing-source prep', () => {
  const result = classifyPagroOfficialOpportunity({
    codeSources: [
      source(),
      source({
        channel: 'official-site',
        sourceUrl: 'https://www.pagro.at/angebote',
        label: 'PAGRO Angebote',
      }),
    ],
    db: { offerCount: 42 },
  });

  assert.equal(result.status, 'official-source-present');
});

test('dm/BIPA visibility hypothesis detects active official source with aggregator-only DB rows', () => {
  const result = classifyOfficialVisibilityHypothesis({
    retailerKey: 'bipa',
    codeSources: [
      source({
        retailerKey: 'bipa',
        channel: 'official-site',
        sourceUrl: 'https://www.bipa.at/cp/aktionen',
        label: 'BIPA Aktionen',
      }),
      source({
        retailerKey: 'bipa',
        sourceUrl: 'https://www.aktionsfinder.at/pv/bipa/',
      }),
    ],
    db: {
      sourceBreakdown: [
        { sourceType: 'aktionsfinder-json', sourceUrl: 'https://www.aktionsfinder.at/pv/bipa/', offers: 20 },
      ],
    },
    rawDocuments: [],
    crawlJobs: [],
  });

  assert.equal(result.hypothesis, 'active-but-not-crawled');
  assert.equal(result.confidence, 'medium');
});

test('dm/BIPA visibility hypothesis detects official raw docs without official offers', () => {
  const result = classifyOfficialVisibilityHypothesis({
    retailerKey: 'dm',
    codeSources: [
      source({
        retailerKey: 'dm',
        channel: 'official-site',
        sourceUrl: 'https://www.dm.at/',
        label: 'dm Startseite',
      }),
    ],
    db: { sourceBreakdown: [] },
    rawDocuments: [{ sourceType: 'offers-page', url: 'https://www.dm.at/' }],
    crawlJobs: [{ sourceType: 'offers-page', sourceUrl: 'https://www.dm.at/' }],
  });

  assert.equal(result.hypothesis, 'parser-produced-no-offers-or-field-loss');
});

test('risk/value prioritization favors high-value low-risk blocks', () => {
  const prioritized = prioritizeFixBlocks([
    { title: 'High High', expectedUserValue: 'high', risk: 'high' },
    { title: 'Medium Low', expectedUserValue: 'medium', risk: 'low' },
    { title: 'High Low', expectedUserValue: 'high', risk: 'low' },
  ]);

  assert.equal(prioritized[0].title, 'High Low');
  assert.equal(prioritized[0].priority, 1);
});

test('roadmap contains launch fixblock contract fields', () => {
  const roadmap = buildRoadmap({
    butterReis: {
      butter: { trueCandidateCount: 0, likelyRetailerSourceLevers: [{ retailerKey: 'hofer' }] },
      reis: { trueCandidateCount: 0, likelyRetailerSourceLevers: [{ retailerKey: 'lidl' }] },
    },
    pagro: { classification: { status: 'official-opportunity' } },
    dmBipa: {
      dm: { hypothesis: { hypothesis: 'active-but-not-crawled' } },
      bipa: { hypothesis: { hypothesis: 'offers-saved-as-aggregator-only' } },
    },
    spar: { summary: { likelyRootCause: 'source-disabled' } },
    officialValidity: { retailers: [] },
  });

  assert.equal(roadmap.length, 5);
  for (const block of roadmap) {
    assert.ok(block.title);
    assert.ok(block.problemType);
    assert.ok(block.expectedUserValue);
    assert.ok(block.risk);
    assert.ok(block.requiresCrawl);
    assert.ok(block.requiresDbMutation);
    assert.ok(block.recommendedMode);
    assert.ok(Array.isArray(block.exactVerificationPlan));
    assert.ok(block.suggestedCodexPromptTitle);
  }
});

test('verification and crawl guardrail generation are explicit', () => {
  const plan = exactVerificationPlan({ needsCrawl: true, needsCacheRebuild: true, apiQueries: ['ranking?q=butter'] });
  const checklist = buildCrawlGuardrailChecklist();

  assert.ok(plan.some((item) => item.includes('crawl if needed')));
  assert.ok(plan.some((item) => item.includes('cache/filter rebuild')));
  assert.ok(checklist.some((item) => item.includes('Welche DB wird verwendet')));
  assert.ok(checklist.some((item) => item.includes('Ohne diese Punkte')));
});
