const test = require('node:test');
const assert = require('node:assert/strict');

const { _private: diagnostic } = require('../scripts/diagnostics/publicValidityImpactReadOnly');

const NOW = new Date('2026-08-10T12:00:00.000Z');

function run(overrides = {}) {
  return {
    _id: 'run-1',
    status: 'success',
    mode: 'full',
    dryRun: false,
    finishedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

function job(overrides = {}) {
  return {
    _id: 'job-a',
    crawlRunId: 'run-1',
    sourceId: 'source-1',
    status: 'success',
    finishedAt: '2026-08-10T00:00:00.000Z',
    stats: { foundRawItems: 10, offersStored: 10, productiveOffers: 10 },
    ...overrides,
  };
}

function source(overrides = {}) {
  return {
    _id: 'source-1',
    retailerKey: 'lidl',
    sourceType: 'flyer',
    crawlPolicy: { freshnessTtlHours: 48 },
    ...overrides,
  };
}

function offer(overrides = {}) {
  return {
    _id: 'offer-a',
    sourceId: 'source-1',
    crawlJobId: 'job-a',
    crawlRunId: 'run-1',
    validFrom: null,
    validTo: null,
    lastSeenAt: '2026-08-10T00:00:00.000Z',
    sourceRunStatus: 'success',
    ...overrides,
  };
}

function analyze(currentOffer, jobs = [job()], runs = [run()], currentSource = source(), now = NOW) {
  return diagnostic.classifyOffer(
    currentOffer,
    currentSource,
    diagnostic.buildJobIndex(jobs),
    diagnostic.buildRunIndex(runs),
    now,
  );
}

function item(currentOffer, analysis = analyze(currentOffer)) {
  return {
    offer: { ...currentOffer, retailerKey: currentOffer.retailerKey || 'lidl' },
    sourceKey: 'lidl:flyer',
    analysis,
  };
}

test('only the offer linked to the last job is confirmed', () => {
  const jobs = [job({ _id: 'job-a' })];
  const runs = [run()];
  const first = analyze(offer({ crawlJobId: 'job-a' }), jobs, runs);
  const second = analyze(offer({ _id: 'offer-b', crawlJobId: 'job-old', crawlRunId: 'run-old' }), jobs, runs);

  assert.equal(first.confirmed, true);
  assert.equal(second.confirmed, false);
  assert.equal(second.validityClass, 'unknown-lineage');
});

test('successful source job does not confirm an offer without an exact offer link', () => {
  const analysis = analyze(offer({ crawlJobId: '', crawlRunId: '', lastSeenRunId: '' }));
  assert.equal(analysis.confirmed, false);
  assert.equal(analysis.directLineage, false);
});

test('a CrawlRun ID is never looked up as a CrawlJob ID', () => {
  const analysis = analyze(offer({ crawlJobId: '', crawlRunId: 'run-1', lastSeenRunId: 'run-1' }));
  assert.equal(analysis.confirmed, false);
  assert.equal(analysis.evidenceField, '');
});

test('partial, zero-raw, and zero-stored jobs never confirm', () => {
  for (const currentJob of [
    job({ status: 'partial' }),
    job({ stats: { foundRawItems: 0, offersStored: 0, productiveOffers: 0 } }),
    job({ stats: { foundRawItems: 10, offersStored: 0, productiveOffers: 0 } }),
  ]) {
    const analysis = analyze(offer(), [currentJob]);
    assert.equal(analysis.confirmed, false);
  }
});

test('a correctly linked complete successful job and full run confirm', () => {
  const analysis = analyze(offer());
  assert.equal(analysis.confirmed, true);
  assert.equal(analysis.directLineage, true);
  assert.equal(analysis.confirmedJobId, 'job-a');
  assert.equal(analysis.confirmedRunId, 'run-1');
  assert.equal(analysis.lastConfirmedAt, '2026-08-10T00:00:00.000Z');
});

test('retained offers use the last real confirmation and grace', () => {
  const retained = offer({ publishStatus: 'retained-previous-data' });
  const analysis = analyze(retained);
  const retainedItem = item(retained, analysis);

  assert.equal(diagnostic.eligibilityDecision(retainedItem, {
    now: new Date('2026-08-10T12:00:00.000Z'),
    history: {},
    variant: 'evidence-based-ttl',
    graceHours: 12,
  }).eligible, true);
  assert.equal(diagnostic.eligibilityDecision(retainedItem, {
    now: new Date('2026-08-10T12:00:01.000Z'),
    history: {},
    variant: 'evidence-based-ttl',
    graceHours: 12,
  }).eligible, false);
});

test('a later partial run cannot extend retained grace', () => {
  const retained = offer({ publishStatus: 'retained-previous-data' });
  const jobs = [
    job({ _id: 'job-partial', status: 'partial', crawlRunId: 'run-partial', finishedAt: '2026-08-10T11:00:00.000Z' }),
    job({ _id: 'job-a', status: 'success' }),
  ];
  const runs = [run({ _id: 'run-partial', status: 'partial', finishedAt: '2026-08-10T11:00:00.000Z' }), run()];
  const analysis = analyze(retained, jobs, runs);
  const decision = diagnostic.eligibilityDecision(item(retained, analysis), {
    now: new Date('2026-08-10T11:00:01.000Z'),
    history: {},
    variant: 'evidence-based-ttl',
    graceHours: 12,
  });
  assert.equal(analysis.lastConfirmedAt, '2026-08-10T00:00:00.000Z');
  assert.equal(decision.eligible, true);
});

test('TTL probes produce boundary-sensitive results at 24/48/72/96/168 hours', () => {
  const currentOffer = offer();
  const currentItem = item(currentOffer);
  const history = {};
  for (const ttl of [24, 48, 72, 96, 168]) {
    const atBoundary = new Date(new Date('2026-08-10T00:00:00.000Z').getTime() + ttl * 3600000);
    const afterBoundary = new Date(atBoundary.getTime() + 1000);
    assert.equal(diagnostic.eligibilityDecision(currentItem, {
      now: atBoundary,
      history,
      variant: 'evidence-based-ttl',
      ttlOverride: ttl,
    }).eligible, true);
    assert.equal(diagnostic.eligibilityDecision(currentItem, {
      now: afterBoundary,
      history,
      variant: 'evidence-based-ttl',
      ttlOverride: ttl,
    }).eligible, false);
  }
});

test('future, expired, explicit current, and unknown lineage are fail-closed correctly', () => {
  assert.equal(diagnostic.eligibilityDecision(item(offer({ validFrom: '2026-08-11T00:00:00.000Z' })), { now: NOW, history: {}, variant: 'explicit-only' }).reason, 'future-validFrom');
  assert.equal(diagnostic.eligibilityDecision(item(offer({ validTo: '2026-08-09T23:59:59.000Z' })), { now: NOW, history: {}, variant: 'explicit-only' }).reason, 'expired-validTo');
  assert.equal(diagnostic.eligibilityDecision(item(offer({ crawlJobId: '', crawlRunId: '', validTo: '2026-08-11T00:00:00.000Z' }), analyze(offer({ crawlJobId: '', crawlRunId: '', validTo: '2026-08-11T00:00:00.000Z' }))), { now: NOW, history: {}, variant: 'explicit-only' }).eligible, true);
  const unknown = offer({ sourceId: 'missing-source', crawlJobId: '', crawlRunId: '' });
  const unknownAnalysis = analyze(unknown, [], [], {});
  assert.equal(diagnostic.eligibilityDecision(item(unknown, unknownAnalysis), { now: NOW, history: {}, variant: 'explicit-only' }).reason, 'no-complete-run-confirmation');
});

test('PAGRO is absent from public retailers and cannot enter the simulation contract', () => {
  assert.equal(diagnostic.PUBLIC_RETAILERS.includes('pagro'), false);
  const pagro = item(offer({ retailerKey: 'pagro' }));
  const result = diagnostic.buildSimulation([pagro], {}, { now: NOW, variant: 'explicit-only', graceHours: 0 });
  assert.equal(result.byRetailer.pagro?.total || 0, 0);
});
