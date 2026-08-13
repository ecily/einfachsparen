const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isPublicValidityEligible,
  parseValidityDate,
} = require('../src/services/offers/publicValidity');
const { filterFreshActiveOffers } = require('../src/services/offers/offerRankingService');

const NOW = new Date('2026-01-15T12:00:00.000Z');

function snapshotOffer(overrides = {}) {
  return {
    sourceId: 'source-1',
    crawlRunId: 'run-1',
    crawlJobId: 'job-1',
    lastSeenSourceRunId: 'job-1',
    lastSeenAt: new Date('2026-01-15T00:00:00.000Z'),
    sourceRunStatus: 'success',
    publishStatus: 'crawl-run-success',
    sourceType: 'billa-official-algolia',
    rawFacts: {
      snapshotCurrent: true,
      freshnessTtlHours: 72,
    },
    ...overrides,
  };
}

test('explicit current validity is eligible and uses Europe/Vienna date-only end', () => {
  const decision = isPublicValidityEligible({
    validFrom: '2026-01-15',
    validTo: '2026-01-15',
  }, NOW);

  assert.equal(decision.eligible, true);
  assert.equal(decision.validityClass, 'explicit-validity');
  assert.equal(decision.evidenceType, 'explicit-validity');
  assert.equal(decision.publicUntil, '2026-01-15T22:59:59.999Z');
});

test('explicit validity rejects expired, future and contradictory windows', () => {
  assert.equal(isPublicValidityEligible({ validFrom: '2025-01-01', validTo: '2025-01-02' }, NOW).reasonCode, 'expired-validTo');
  assert.equal(isPublicValidityEligible({ validFrom: '2026-01-16', validTo: '2026-01-20' }, NOW).reasonCode, 'future-validFrom');
  assert.equal(isPublicValidityEligible({ validFrom: '2026-01-20', validTo: '2026-01-10' }, NOW).reasonCode, 'contradictory-validity');
});

test('snapshot confirmation is offer-specific and eligible inside its TTL', () => {
  const decision = isPublicValidityEligible(snapshotOffer(), NOW);

  assert.equal(decision.eligible, true);
  assert.equal(decision.validityClass, 'snapshot-confirmed');
  assert.equal(decision.sourceTtlHours, 72);
  assert.equal(decision.evidenceType, 'official-snapshot-lineage');
});

test('official current offer lineage is a valid snapshot even when snapshotCurrent flag is absent', () => {
  const decision = isPublicValidityEligible({
    ...snapshotOffer({
      retailerKey: 'mueller',
      sourceType: 'mueller-official-online-offers',
      rawFacts: { freshnessTtlHours: 48 },
    }),
  }, NOW);

  assert.equal(decision.eligible, true);
  assert.equal(decision.validityClass, 'snapshot-confirmed');
  assert.equal(decision.sourceTtlHours, 48);
});

test('official source proximity without offer-specific lineage remains fail closed', () => {
  const decision = isPublicValidityEligible({
    retailerKey: 'mueller',
    sourceType: 'mueller-official-online-offers',
    sourceRunStatus: 'success',
    sourceId: 'source-1',
    lastSeenAt: new Date('2026-01-15T00:00:00.000Z'),
    rawFacts: { freshnessTtlHours: 48 },
  }, NOW);

  assert.equal(decision.reasonCode, 'source-not-approved-snapshot');
});

test('configured official snapshot retailers use their conservative source TTLs', () => {
  for (const [retailerKey, sourceType, ttl] of [
    ['billa-plus', 'billa-plus-official-algolia', 72],
    ['dm', 'dm-official-product-search', 72],
    ['mueller', 'mueller-official-online-offers', 48],
    ['bipa', 'bipa-official-category-expanded', 96],
  ]) {
    const decision = isPublicValidityEligible(snapshotOffer({
      retailerKey,
      sourceType,
      rawFacts: { snapshotCurrent: true },
    }), NOW);
    assert.equal(decision.eligible, true);
    assert.equal(decision.sourceTtlHours, ttl);
  }
});

test('snapshot is rejected exactly after TTL and without an approved TTL', () => {
  const atBoundary = isPublicValidityEligible(snapshotOffer({
    lastSeenAt: new Date('2026-01-12T12:00:00.000Z'),
  }), NOW);
  const outside = isPublicValidityEligible(snapshotOffer({
    lastSeenAt: new Date('2026-01-12T11:59:59.999Z'),
  }), NOW);
  const noTtl = isPublicValidityEligible(snapshotOffer({
    retailerKey: 'unknown-retailer',
    sourceType: 'official-snapshot',
    rawFacts: { snapshotCurrent: true },
  }), NOW);

  assert.equal(atBoundary.eligible, true);
  assert.equal(outside.reasonCode, 'snapshot-ttl-expired');
  assert.equal(noTtl.reasonCode, 'missing-source-ttl');
});

test('snapshot rejects missing, wrong, partial, failed and dry-run lineage evidence', () => {
  const cases = [
    [{ crawlJobId: '', lastSeenSourceRunId: '' }, 'no-offer-specific-confirmation'],
    [{ sourceId: '', rawFacts: { snapshotCurrent: true, freshnessTtlHours: 72 } }, 'no-offer-specific-confirmation'],
    [{ sourceRunStatus: 'partial' }, 'no-offer-specific-confirmation'],
    [{ sourceRunStatus: 'failed' }, 'no-offer-specific-confirmation'],
    [{ rawFacts: { snapshotCurrent: true, freshnessTtlHours: 72, dryRun: true } }, 'no-offer-specific-confirmation'],
    [{ sourceType: 'aktionsfinder-json' }, 'source-not-approved-snapshot'],
  ];

  for (const [overrides, reasonCode] of cases) {
    assert.equal(isPublicValidityEligible(snapshotOffer(overrides), NOW).reasonCode, reasonCode);
  }
});

test('retained snapshot uses the last real confirmation and does not extend without configured grace', () => {
  const inside = isPublicValidityEligible(snapshotOffer({
    lastSeenAt: new Date('2026-01-15T00:00:00.000Z'),
    rawFacts: { snapshotCurrent: true, freshnessTtlHours: 72, retainedPreviousData: true, retainedGraceHours: 24 },
  }), NOW);
  const outside = isPublicValidityEligible(snapshotOffer({
    lastSeenAt: new Date('2026-01-14T11:59:59.999Z'),
    rawFacts: { snapshotCurrent: true, freshnessTtlHours: 72, retainedPreviousData: true, retainedGraceHours: 24 },
  }), NOW);
  const unconfigured = isPublicValidityEligible(snapshotOffer({
    rawFacts: { snapshotCurrent: true, freshnessTtlHours: 72, retainedPreviousData: true },
  }), NOW);

  assert.equal(inside.reasonCode, 'retained-within-grace');
  assert.equal(outside.reasonCode, 'retained-grace-expired');
  assert.equal(unconfigured.reasonCode, 'retained-grace-not-configured');
});

test('date-only Vienna conversion handles summer and winter boundaries', () => {
  assert.equal(parseValidityDate('2026-01-15', { endOfDay: true }).toISOString(), '2026-01-15T22:59:59.999Z');
  assert.equal(parseValidityDate('2026-07-15', { endOfDay: true }).toISOString(), '2026-07-15T21:59:59.999Z');
});

test('explicit validity remains independent from snapshot lineage', () => {
  const decision = isPublicValidityEligible({
    validFrom: '2026-01-01',
    validTo: '2026-01-20',
    sourceType: 'unknown-source',
  }, NOW);

  assert.equal(decision.eligible, true);
  assert.equal(decision.validityClass, 'explicit-validity');
});

test('ranking freshness filter applies the same public contract to snapshot and unknown offers', () => {
  const visible = filterFreshActiveOffers([
    {
      ...snapshotOffer(),
      status: 'active',
      isActiveNow: true,
    },
    {
      status: 'active',
      isActiveNow: true,
      sourceType: 'unknown-source',
      validTo: null,
    },
  ], NOW);

  assert.equal(visible.length, 1);
  assert.equal(visible[0].sourceType, 'billa-official-algolia');
});
