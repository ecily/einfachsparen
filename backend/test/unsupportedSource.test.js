const test = require('node:test');
const assert = require('node:assert/strict');
const { RETAILER_DEFINITIONS } = require('../src/services/sources/sourceDefinitions');
const { normalizeHealthPolicy, getScheduledHealthPolicy } = require('../src/services/sources/sourceHealthPolicy');
const { applySourceSelection } = require('../src/services/crawl/crawlSourceSelection');
const { _private: crawl } = require('../src/services/crawl/crawlRunService');
const { _private: dashboard } = require('../src/services/dashboard/dashboardService');
const { isPublicValidityEligible } = require('../src/services/offers/publicValidity');
const { filterFreshActiveOffers } = require('../src/services/offers/offerRankingService');
const { getRetailerFilters, _private: filters } = require('../src/services/filters/filterMetadataService');
const Offer = require('../src/models/Offer');
const Retailer = require('../src/models/Retailer');
const Source = require('../src/models/Source');
const mueller = RETAILER_DEFINITIONS.find((s) => s.sourceType === 'mueller-official-online-offers');

test('unsupported cannot be required or executed, including allowDisabled scoped selection', () => {
  const policy = normalizeHealthPolicy({ healthCriticality: 'unsupported', requiredForScheduledHealth: true, publicRequired: true });
  assert.equal(policy.requiredForScheduledHealth, false);
  assert.equal(policy.publicRequired, false);
  for (const allowDisabled of [false, true]) {
    const selected = applySourceSelection({ sources: [{ ...mueller, enabled: true }], sourceKeys: ['mueller-official-online-offers'], allowDisabled });
    assert.equal(selected.selectedSources.length, 0);
    assert.equal(selected.disabledSources[0].skippedReason, 'unsupported-source');
  }
});

test('full selection excludes unsupported while PENNY optional partial stays visible and required failure blocks success', () => {
  const selected = applySourceSelection({ sources: RETAILER_DEFINITIONS }).selectedSources;
  assert.equal(selected.some((s) => s.retailerKey === 'mueller'), false);
  assert.equal(selected.some((s) => s.retailerKey === 'pagro'), false);
  const primary = selected.find((s) => s.sourceUrl === 'https://www.penny.at/angebote');
  const flyer = selected.find((s) => s.sourceUrl === 'https://www.penny.at/angebote/flugblaetter');
  const rows = [primary, flyer].map((s, i) => ({ ...s, sourceKey: i ? 'penny-official-flyer' : 'penny-official-site', status: i ? 'partial' : 'success', scheduledHealthPolicy: getScheduledHealthPolicy(s) }));
  const result = crawl.buildRunSummary({ sources: rows, matchedSources: rows });
  assert.equal(result.summary.optionalProblemSourcesCount, 1);
  assert.equal(crawl.determineFinalStatus({ summary: result.summary }), 'success');
  rows[0].status = 'failed';
  assert.equal(crawl.determineFinalStatus({ summary: crawl.buildRunSummary({ sources: rows, matchedSources: rows }).summary }), 'partial');
});

test('unavailable coverage remains visible independently of successful current full run and historical partial', () => {
  const historical = { id: 'old', mode: 'full', trigger: 'scheduled', status: 'partial', startedAt: '2026-09-17T04:37:00Z', finishedAt: '2026-09-17T04:41:00Z' };
  const current = { id: 'new', mode: 'full', trigger: 'manual', status: 'success', startedAt: '2026-09-17T12:00:00Z', finishedAt: '2026-09-17T12:04:00Z' };
  const args = { latestScheduledFullCrawl: historical, latestCrawl: current, lockStatus: { isBlocked: false }, publishStatusSummary: { status: 'final', openCount: 0 } };
  assert.equal(dashboard.buildExecutiveStatus(args).level, 'green');
  assert.equal(dashboard.buildExecutiveStatus(args).referenceRunId, 'new');
  assert.equal(historical.status, 'partial');
  assert.equal(dashboard.buildExecutiveStatus({ ...args, latestCrawl: { ...current, mode: 'scoped' } }).level, 'yellow');
  assert.equal(dashboard.buildExecutiveStatus({ ...args, latestCrawl: { ...current, dryRun: true } }).level, 'yellow');
  const issues = dashboard.buildActionableIssues({ sources: [mueller], retailerMatrix: [] });
  assert.equal(issues[0].kind, 'retailer-coverage-unavailable');
  assert.match(issues[0].title, /unsupported/);
  const matrix = dashboard.withUnsupportedCoverage([{ retailerKey: 'mueller', activeOffers: 118, publicValidityEligibleOffers: 0, warningStatus: 'green' }], [mueller]);
  assert.equal(matrix[0].warningStatus, 'yellow');
  assert.equal(matrix[0].coverageStatus, 'unsupported');
  assert.equal(matrix[0].activeOffers, 118);
  assert.equal(matrix[0].publicValidityEligibleOffers, 0);
});

test('historical Mueller snapshot stays excluded from ranking and cannot create a zero-count filter', async () => {
  const now = new Date('2026-09-17T12:00:00Z');
  const offer = { retailerKey: 'mueller', sourceType: 'mueller-official-online-offers', sourceId: 'source', crawlRunId: 'old-run', crawlJobId: 'old-job', sourceRunStatus: 'success', publishStatus: 'crawl-run-success', lastSeenAt: new Date('2026-09-07T04:41:00Z'), status: 'active', isActiveNow: true, rawFacts: { freshnessTtlHours: 48 } };
  assert.equal(isPublicValidityEligible(offer, now).eligible, false);
  assert.equal(filterFreshActiveOffers([offer], now).length, 0);
  const originals = [Offer.find, Retailer.find, Source.find];
  const query = (rows) => ({ select: () => ({ lean: async () => rows }) });
  try {
    filters.resetPublicFacetSnapshot();
    Offer.find = () => query([offer]);
    Retailer.find = () => query([{ retailerKey: 'mueller', activeOfferCount: 118, isActive: true }]);
    Source.find = () => query([]);
    assert.equal((await getRetailerFilters()).some((r) => r.retailerKey === 'mueller'), false);
  } finally {
    [Offer.find, Retailer.find, Source.find] = originals;
    filters.resetPublicFacetSnapshot();
  }
});
