const assert = require('node:assert/strict');
const test = require('node:test');
const CrawlRun = require('../src/models/CrawlRun');
const { _private: crawl } = require('../src/services/crawl/crawlRunService');
const { _private: dashboard } = require('../src/services/dashboard/dashboardService');
const { getScheduledHealthPolicy } = require('../src/services/sources/sourceHealthPolicy');
const { RETAILER_DEFINITIONS } = require('../src/services/sources/sourceDefinitions');

const pennyFlyer = RETAILER_DEFINITIONS.find((source) => source.sourceUrl === 'https://www.penny.at/angebote/flugblaetter');
const sources = [
  { sourceKey: 'penny-official-site', retailerKey: 'penny', channel: 'official-site', status: 'success', foundRawItems: 224, offersStored: 161,
    scheduledHealthPolicy: getScheduledHealthPolicy({ retailerKey: 'penny', channel: 'official-site' }) },
  { sourceKey: 'penny-official-flyer', retailerKey: 'penny', channel: 'official-flyer', status: 'partial', foundRawItems: 11, offersStored: 0,
    rejectionReasons: [{ reason: 'official-source-zero-stored', count: 11 }], scheduledHealthPolicy: getScheduledHealthPolicy(pennyFlyer) },
];

function roundTrip(rows, summary = {}) {
  const stored = new CrawlRun({ status: 'partial', trigger: 'scheduled', mode: 'full', summary, result: { sources: rows } }).toObject();
  return CrawlRun.hydrate(JSON.parse(JSON.stringify(stored)));
}

test('source health survives Mongoose storage and dashboard serialization', () => {
  const run = roundTrip(sources);
  const serialized = dashboard.serializeCrawlRun(run);
  assert.equal(serialized.sources[1].scheduledHealthPolicy.healthCriticality, 'optional');
  const diagnosis = dashboard.buildSourceFailureDiagnosis(serialized);
  assert.equal(diagnosis.requiredProblemSourcesCount, 0);
  assert.equal(diagnosis.optionalProblemSourcesCount, 1);
  assert.equal(diagnosis.optionalProblemSources[0].status, 'partial');
  const rebuilt = crawl.buildRunSummary({ sources: run.toObject().result.sources, matchedSources: sources });
  assert.equal(rebuilt.summary.requiredPartialSourcesCount, 0);
  assert.equal(rebuilt.summary.optionalProblemSourcesCount, 1);
  assert.equal(crawl.determineFinalStatus({ summary: rebuilt.summary }), 'success');
  const extraction = dashboard.buildSourceExtractionSummary({ latestScheduledFullCrawl: serialized });
  assert.equal(extraction.sources[1].healthCriticality, 'optional');
  assert.equal(extraction.sources[1].reasonCode, 'official-source-zero-stored');
});

test('required primary failure stays globally partial even with successful optional flyer', () => {
  const rows = sources.map((source, index) => ({ ...source, status: index === 0 ? 'failed' : 'success' }));
  const rebuilt = crawl.buildRunSummary({ sources: roundTrip(rows).toObject().result.sources, matchedSources: rows });
  assert.equal(crawl.determineFinalStatus({ summary: rebuilt.summary }), 'partial');
});

test('historical missing policies use recorded aggregate counts without guessing source assignments', () => {
  const legacy = [
    { ...sources[1], scheduledHealthPolicy: null },
    { sourceKey: 'mueller-official-online-offers', retailerKey: 'mueller', status: 'failed', httpStatus: 403, failureStage: 'fetch' },
  ];
  const serialized = dashboard.serializeCrawlRun(roundTrip(legacy, {
    requiredFailedSourcesCount: 1, requiredPartialSourcesCount: 0, optionalProblemSourcesCount: 1,
  }));
  const diagnosis = dashboard.buildSourceFailureDiagnosis(serialized);
  assert.equal(diagnosis.requiredProblemSourcesCount, 1);
  assert.equal(diagnosis.optionalProblemSourcesCount, 1);
  assert.equal(diagnosis.level, 'yellow');
  assert.equal(diagnosis.policyEvidence, 'recorded-run-summary');
  assert.equal(diagnosis.unknownPolicyProblemSources.length, 2);
  assert.equal(diagnosis.groups.length, 0);
  assert.equal(serialized.status, 'partial');
  const extraction = dashboard.buildSourceExtractionSummary({ latestScheduledFullCrawl: serialized });
  assert.equal(extraction.sources[0].healthCriticality, 'unknown');
  assert.equal(extraction.sources[0].requiredForScheduledHealth, null);
  assert.equal(extraction.sources[1].reasonCode, 'transport-blocked');
});

test('missing or inconsistent historical summary cannot hide unclassified source failures', () => {
  for (const summary of [{}, { requiredFailedSourcesCount: 0, requiredPartialSourcesCount: 0, optionalProblemSourcesCount: 0 }]) {
    const run = dashboard.serializeCrawlRun(roundTrip([{ sourceKey: 'unknown', status: 'failed' }], summary));
    assert.equal(dashboard.buildSourceFailureDiagnosis(run).level, 'yellow');
    assert.equal(dashboard.buildSourceFailureDiagnosis(run).requiredProblemSourcesCount, 1);
  }
});

test('historical totals cannot override explicit required source failures', () => {
  const rows = [{ ...sources[0], status: 'failed' }, { sourceKey: 'unknown', status: 'partial' }];
  const run = dashboard.serializeCrawlRun(roundTrip(rows, {
    requiredFailedSourcesCount: 0, requiredPartialSourcesCount: 0, optionalProblemSourcesCount: 2,
  }));
  const diagnosis = dashboard.buildSourceFailureDiagnosis(run);
  assert.equal(diagnosis.level, 'yellow');
  assert.equal(diagnosis.requiredProblemSourcesCount, 2);
});
