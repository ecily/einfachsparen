const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCoverageMetrics, buildCrawlJobUpdate } = require('../src/services/crawl/crawlAudit');
const { __private } = require('../src/services/crawl/officialSourceCrawler');

test('coverage metrics mark expired source validity as stale even when offers were stored', () => {
  const metrics = buildCoverageMetrics({
    foundRawItems: 12,
    parsedOffers: 10,
    offersStored: 10,
    rejectedOffers: 2,
    validFrom: new Date('2000-01-01T00:00:00.000Z'),
    validTo: new Date('2000-01-07T23:59:59.999Z'),
    now: new Date('2026-05-28T12:00:00.000Z'),
  });

  assert.equal(metrics.freshnessStatus, 'expired');
  assert.equal(metrics.flags.sourcePossiblyStale, true);
  assert.equal(metrics.flags.rawItemsFoundButZeroStored, false);
});

test('coverage metrics classify upcoming source validity without stale flag', () => {
  const metrics = buildCoverageMetrics({
    foundRawItems: 12,
    parsedOffers: 0,
    offersStored: 0,
    rejectedOffers: 12,
    validFrom: new Date('2099-01-01T00:00:00.000Z'),
    validTo: new Date('2099-01-07T23:59:59.999Z'),
    now: new Date('2026-05-28T12:00:00.000Z'),
  });

  assert.equal(metrics.freshnessStatus, 'upcoming');
  assert.equal(metrics.flags.sourcePossiblyStale, false);
});

test('crawl job update persists source validity freshness in coverage metrics', () => {
  const update = buildCrawlJobUpdate({
    status: 'success',
    rawCandidateCount: 2,
    offers: [{ title: 'Test', quantityText: '1 l', imageUrl: 'https://example.test/img.jpg' }],
    source: { sourceUrl: 'https://flugblatt.spar.at/test/getPdf.ashx', sourceType: 'pdf' },
    validFrom: new Date('2000-01-01T00:00:00.000Z'),
    validTo: new Date('2000-01-07T23:59:59.999Z'),
  });

  assert.equal(update.metadata.coverageMetrics.freshnessStatus, 'expired');
  assert.equal(update.metadata.qualityFlags.sourcePossiblyStale, true);
});

test('SPAR official source coverage fields use PDF source validity', () => {
  const fields = __private.sourceCoverageFields({
    foundRawItems: 8,
    parsedOffers: 6,
    offersStored: 6,
    rejectedOffers: 2,
    validFrom: new Date('2000-01-01T00:00:00.000Z'),
    validTo: new Date('2000-01-07T23:59:59.999Z'),
  });

  assert.equal(fields.freshnessStatus, 'expired');
  assert.equal(fields.flags.sourcePossiblyStale, true);
});
