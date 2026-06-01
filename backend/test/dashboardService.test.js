const assert = require('node:assert/strict');
const test = require('node:test');

const { _private } = require('../src/services/dashboard/dashboardService');

test('dashboard offer diagnostics aggregate official, validity, comparison, images and publish status', () => {
  const result = _private.buildOfferDiagnostics([
    {
      retailerKey: 'spar',
      retailerName: 'SPAR',
      sourceType: 'spar-official-pdf',
      sourceUrl: 'https://www.spar.at/angebote',
      validFrom: new Date('2026-06-01T00:00:00.000Z'),
      validTo: new Date('2026-06-02T00:00:00.000Z'),
      conditionsText: '1+1 gratis',
      imageUrl: 'https://img.example.test/spar.jpg',
      quality: { comparisonSafe: true },
      publishStatus: 'crawl-run-success',
    },
    {
      retailerKey: 'billa',
      retailerName: 'BILLA',
      sourceType: 'aktionsfinder-json',
      sourceUrl: 'https://www.aktionsfinder.at/ppcv/billa/offers',
      validFrom: null,
      validTo: null,
      conditionsText: '',
      imageUrl: '',
      quality: { comparisonSafe: false },
      publishStatus: 'source-written',
    },
  ]);

  assert.equal(result.offerSummary.activeOffers, 2);
  assert.equal(result.offerSummary.officialOffers, 1);
  assert.equal(result.offerSummary.aggregatorOffers, 1);
  assert.equal(result.offerSummary.safeValidityOffers, 1);
  assert.equal(result.offerSummary.conditionOffers, 1);
  assert.equal(result.offerSummary.comparisonSafeOffers, 1);
  assert.equal(result.offerSummary.imageOffers, 1);
  assert.equal(result.offerSummary.aggregatorRiskOffers, 1);
  assert.equal(result.publishStatusSummary.status, 'open');
  assert.equal(result.publishStatusSummary.openCount, 1);
  assert.equal(result.retailerMatrix.find((row) => row.retailerKey === 'billa').warningStatus, 'red');
});

test('dashboard executive status turns red for stale crawl, blocked lock or open publish status', () => {
  const status = _private.buildExecutiveStatus({
    latestCrawl: null,
    latestScheduledFullCrawl: {
      id: 'run-1',
      status: 'stale',
      trigger: 'scheduled',
      mode: 'full',
      finishedAt: '2026-06-01T12:47:22.991Z',
    },
    activeCrawlRun: null,
    lockStatus: { isBlocked: false },
    publishStatusSummary: { status: 'final' },
  });

  assert.equal(status.level, 'red');
  assert.match(status.reason, /stale/i);

  const blocked = _private.buildExecutiveStatus({
    latestCrawl: { status: 'success', finishedAt: '2026-06-01T00:00:00.000Z' },
    latestScheduledFullCrawl: null,
    activeCrawlRun: null,
    lockStatus: { isBlocked: true, reason: 'Globaler Crawl-Lock ist blockiert.' },
    publishStatusSummary: { status: 'final' },
  });

  assert.equal(blocked.level, 'red');
  assert.ok(blocked.reasons.some((reason) => /blockiert/i.test(reason)));
});

test('dashboard lock serialization marks stale heartbeat locks as blocked', () => {
  const now = new Date('2026-06-01T13:00:00.000Z');
  const lock = _private.serializeLock({
    runId: '665000000000000000000001',
    status: 'running',
    acquiredAt: new Date('2026-06-01T12:00:00.000Z'),
    heartbeatAt: new Date('2026-06-01T12:40:00.000Z'),
    expiresAt: new Date('2026-06-02T12:00:00.000Z'),
    owner: 'host:pid:scheduled',
  }, now);

  assert.equal(lock.isBlocked, true);
  assert.equal(lock.staleHeartbeat, true);
  assert.equal(lock.state, 'blocked-stale-heartbeat');
});
