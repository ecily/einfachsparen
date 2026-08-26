const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');

const {
  executeCrawlRun,
  serializeCrawlRun,
  _private,
} = require('../src/services/crawl/crawlRunService');
const CrawlRun = require('../src/models/CrawlRun');
const CrawlRunLock = require('../src/models/CrawlRunLock');
const Offer = require('../src/models/Offer');

test('determineMode marks full and scoped CrawlRuns correctly', () => {
  assert.equal(_private.determineMode({}), 'full');
  assert.equal(_private.determineMode({ retailerKeys: ['spar'] }), 'scoped');
  assert.equal(_private.determineMode({ sourceKeys: ['spar-official-flyer-pdf'] }), 'scoped');
  assert.equal(_private.determineMode({ sourceSelectionRequested: true }), 'scoped');
});

test('startup crawl guard blocks productive production crawls during deploy grace period', () => {
  const processStartedAt = new Date('2026-06-14T17:28:46.814Z');
  const guard = _private.getStartupCrawlStartGuard({
    trigger: 'manual',
    options: { sourceKeys: ['penny-official-site'], dryRun: false },
    envConfig: {
      NODE_ENV: 'production',
      CRAWL_RUN_STARTUP_GRACE_SECONDS: 180,
    },
    processStartedAt,
    now: new Date('2026-06-14T17:30:25.706Z'),
  });

  assert.equal(guard.blocked, true);
  assert.equal(guard.reason, 'process-startup-grace');
  assert.equal(guard.processAgeMs, 98892);
  assert.equal(guard.retryAfterSeconds, 82);

  const error = _private.buildStartupCrawlStartError(guard);
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, 'CRAWL_STARTUP_GRACE');
  assert.match(error.message, /Retry after 82s/);
});

test('startup crawl guard allows safe cases outside production startup risk', () => {
  const processStartedAt = new Date('2026-06-14T17:28:46.814Z');
  const base = {
    trigger: 'manual',
    processStartedAt,
    now: new Date('2026-06-14T17:30:25.706Z'),
  };

  assert.equal(_private.getStartupCrawlStartGuard({
    ...base,
    options: { dryRun: true },
    envConfig: {
      NODE_ENV: 'production',
      CRAWL_RUN_STARTUP_GRACE_SECONDS: 180,
    },
  }).blocked, false);

  assert.equal(_private.getStartupCrawlStartGuard({
    ...base,
    options: { dryRun: false },
    envConfig: {
      NODE_ENV: 'development',
      CRAWL_RUN_STARTUP_GRACE_SECONDS: 180,
    },
  }).blocked, false);

  assert.equal(_private.getStartupCrawlStartGuard({
    ...base,
    options: { dryRun: false },
    envConfig: {
      NODE_ENV: 'production',
      CRAWL_RUN_STARTUP_GRACE_SECONDS: 180,
    },
    now: new Date('2026-06-14T17:33:00.000Z'),
  }).blocked, false);
});

test('startup crawl guard can block production crawls for fifteen minutes', () => {
  const processStartedAt = new Date('2026-06-14T18:04:18.368Z');
  const guard = _private.getStartupCrawlStartGuard({
    trigger: 'manual',
    options: { sourceKeys: ['penny-official-site'], dryRun: false },
    envConfig: {
      NODE_ENV: 'production',
      CRAWL_RUN_STARTUP_GRACE_SECONDS: 900,
    },
    processStartedAt,
    now: new Date('2026-06-14T18:10:00.000Z'),
  });

  assert.equal(guard.blocked, true);
  assert.equal(guard.graceMs, 900000);
});

test('startup crawl guard allows only the explicit SPAR rescue source scope during grace', () => {
  const processStartedAt = new Date('2026-06-25T18:00:00.000Z');
  const base = {
    trigger: 'manual',
    envConfig: {
      NODE_ENV: 'production',
      CRAWL_RUN_STARTUP_GRACE_SECONDS: 900,
    },
    processStartedAt,
    now: new Date('2026-06-25T18:02:00.000Z'),
  };
  const allowedSourceKeys = [
    'spar-official-flyer-current',
    'interspar-official-flyer-current',
  ];

  const allowed = _private.getStartupCrawlStartGuard({
    ...base,
    options: {
      sourceKeys: allowedSourceKeys,
      dryRun: false,
      allowStartupGraceBypass: true,
    },
  });

  assert.equal(allowed.blocked, false);
  assert.equal(allowed.reason, 'startup-grace-bypassed');
  assert.equal(allowed.startupGraceBypassed, true);
  assert.equal(allowed.startupGraceBypassReason, _private.STARTUP_GRACE_BYPASS_REASON);
  assert.deepEqual(allowed.allowedSourceKeys, _private.STARTUP_GRACE_BYPASS_ALLOWED_SOURCE_KEYS);

  const blockedCases = [
    { dryRun: false, allowStartupGraceBypass: true },
    { retailerKeys: ['spar'], dryRun: false, allowStartupGraceBypass: true },
    { sourceKeys: allowedSourceKeys, sourceIds: ['665000000000000000000010'], dryRun: false, allowStartupGraceBypass: true },
    { sourceKeys: ['spar-official-flyer-current'], dryRun: false, allowStartupGraceBypass: true },
    { sourceKeys: [...allowedSourceKeys, 'spar-family-official-productworld'], dryRun: false, allowStartupGraceBypass: true },
  ];

  for (const options of blockedCases) {
    const guard = _private.getStartupCrawlStartGuard({
      ...base,
      options,
    });

    assert.equal(guard.blocked, true);
    assert.equal(guard.reason, 'process-startup-grace');
  }

  assert.equal(_private.buildStartupGraceBypassDecision({
    sourceKeys: allowedSourceKeys,
    dryRun: true,
    allowStartupGraceBypass: true,
  }).allowed, false);
});

test('buildRunDocument records startup grace bypass metadata only for the allowed scope', () => {
  const runId = new mongoose.Types.ObjectId('665000000000000000000011');
  const run = _private.buildRunDocument({
    runId,
    trigger: 'manual',
    region: 'Steiermark',
    options: {
      sourceKeys: [
        'spar-official-flyer-current',
        'interspar-official-flyer-current',
      ],
      dryRun: false,
      allowStartupGraceBypass: true,
    },
  });

  assert.equal(run.metadata.startupGraceBypassed, true);
  assert.equal(run.metadata.startupGraceBypassReason, _private.STARTUP_GRACE_BYPASS_REASON);
  assert.deepEqual(run.metadata.allowedSourceKeys, _private.STARTUP_GRACE_BYPASS_ALLOWED_SOURCE_KEYS);

  const blocked = _private.buildRunDocument({
    runId: new mongoose.Types.ObjectId('665000000000000000000012'),
    trigger: 'manual',
    region: 'Steiermark',
    options: {
      sourceKeys: ['spar-official-flyer-current'],
      dryRun: false,
      allowStartupGraceBypass: true,
    },
  });

  assert.equal(blocked.metadata.startupGraceBypassed, undefined);
});

test('buildRunSummary aggregates source, retailer, type, dedupe and filter metadata inputs compactly', () => {
  const result = {
    sourceCoverage: {
      totalRegisteredSources: 5,
      activeEligibleSources: 3,
      disabledSourcesCount: 2,
    },
    matchedSources: [
      { sourceId: 's1', sourceKey: 'aktionsfinder-spar', retailerKey: 'spar', channel: 'aggregator', sourceType: 'aggregator' },
      { sourceId: 's2', sourceKey: 'lidl-official-flyer', retailerKey: 'lidl', channel: 'official-flyer', sourceType: 'flyer' },
    ],
    disabledSources: [{ sourceKey: 'marktguru-spar' }],
    sources: [
      {
        sourceId: 's1',
        sourceKey: 'aktionsfinder-spar',
        retailerKey: 'spar',
        channel: 'aggregator',
        sourceType: 'aggregator',
        status: 'success',
        foundRawItems: 12,
        parsedOffers: 10,
        offersStored: 10,
        rejectedOffers: 2,
      },
      {
        sourceId: 's2',
        sourceKey: 'lidl-official-flyer',
        retailerKey: 'lidl',
        channel: 'official-flyer',
        sourceType: 'flyer',
        status: 'failed',
        error: 'upstream timeout',
        failureStage: 'fetch',
        httpStatus: 403,
        contentType: 'text/html; charset=UTF-8',
        finalUrl: 'https://www.lidl.at/c/flugblatt/s10012330',
        diagnostic: {
          failureStage: 'fetch',
          httpStatus: 403,
          htmlTitle: 'Just a moment...',
          bodyPreview: 'challenge page',
          requestHeaders: {
            Authorization: 'Bearer secret',
            Cookie: 'session=secret',
            Accept: 'text/html',
          },
        },
      },
    ],
    filterMetadata: { ok: true, processedOffers: 120 },
  };

  const summary = _private.buildRunSummary(result);

  assert.equal(summary.summary.totalRegisteredSources, 5);
  assert.equal(summary.summary.activeEligibleSources, 3);
  assert.equal(summary.summary.matchedSourcesCount, 2);
  assert.equal(summary.summary.disabledSourcesCount, 1);
  assert.equal(summary.summary.failedSourcesCount, 1);
  assert.equal(summary.summary.successfulSourcesCount, 1);
  assert.equal(summary.summary.foundRawItemsTotal, 12);
  assert.equal(summary.summary.parsedOffersTotal, 10);
  assert.equal(summary.summary.offersStoredTotal, 10);
  assert.equal(summary.summary.rejectedOffersTotal, 2);
  assert.equal(summary.summary.processedOffers, 120);
  assert.equal(summary.perRetailer.find((item) => item.retailerKey === 'spar').offersStored, 10);
  assert.equal(summary.sourceTypes.find((item) => item.channel === 'aggregator').offersStored, 10);
  assert.equal(summary.sources[1].error, 'upstream timeout');
  assert.equal(summary.sources[1].failureStage, 'fetch');
  assert.equal(summary.sources[1].httpStatus, 403);
  assert.equal(summary.sources[1].diagnostic.htmlTitle, 'Just a moment...');
  assert.equal(summary.sources[1].diagnostic.requestHeaders.Authorization, '[redacted]');
  assert.equal(summary.sources[1].diagnostic.requestHeaders.Cookie, '[redacted]');
  assert.equal(summary.sources[1].diagnostic.requestHeaders.Accept, 'text/html');
});

test('buildRunSummary separates policy-bounded skipped sources from real source failures', () => {
  const result = {
    sourceCoverage: {
      totalRegisteredSources: 3,
      activeEligibleSources: 3,
    },
    matchedSources: [
      { sourceId: 's1', sourceKey: 'spar-official-flyer-pdf', retailerKey: 'spar', channel: 'official-flyer', sourceType: 'pdf' },
      { sourceId: 's2', sourceKey: 'aktionsfinder-spar', retailerKey: 'spar', channel: 'aggregator', sourceType: 'aggregator' },
      { sourceId: 's3', sourceKey: 'billa-official-site', retailerKey: 'billa', channel: 'official-site', sourceType: 'offers-page' },
    ],
    sources: [
      {
        sourceId: 's1',
        sourceKey: 'spar-official-flyer-pdf',
        retailerKey: 'spar',
        channel: 'official-flyer',
        sourceType: 'pdf',
        status: 'skipped',
        skipped: true,
        skippedReason: 'full-crawl-scoped-only-source',
        failureStage: 'source-bounded-before-execution',
        diagnostic: {
          boundedReason: 'full-crawl-scoped-only-source',
          notExecutedByPolicy: true,
        },
      },
      {
        sourceId: 's2',
        sourceKey: 'aktionsfinder-spar',
        retailerKey: 'spar',
        channel: 'aggregator',
        sourceType: 'aggregator',
        status: 'failed',
        error: 'Request failed with status code 404',
      },
      {
        sourceId: 's3',
        sourceKey: 'billa-official-site',
        retailerKey: 'billa',
        channel: 'official-site',
        sourceType: 'offers-page',
        status: 'success',
        offersStored: 3,
      },
    ],
  };

  const summary = _private.buildRunSummary(result);

  assert.equal(summary.summary.failedSourcesCount, 1);
  assert.equal(summary.summary.successfulSourcesCount, 1);
  assert.equal(summary.summary.skippedSourcesCount, 1);
  assert.equal(summary.summary.policyBoundedSourcesCount, 1);
  assert.equal(summary.summary.notExecutedByPolicySourcesCount, 1);
  assert.equal(summary.perRetailer.find((item) => item.retailerKey === 'spar').failedSources, 1);
  assert.equal(summary.perRetailer.find((item) => item.retailerKey === 'spar').skippedSources, 1);
  assert.equal(summary.perRetailer.find((item) => item.retailerKey === 'spar').policyBoundedSources, 1);
  assert.equal(summary.sourceTypes.find((item) => item.channel === 'official-flyer').skippedSources, 1);
  assert.equal(
    _private.determineFinalStatus({ crawlResult: result, summary: summary.summary, mode: 'full' }),
    'partial'
  );
});

test('determineFinalStatus does not turn a full crawl partial only because policy-bounded sources were skipped', () => {
  const result = {
    sourceCoverage: {
      totalRegisteredSources: 2,
      activeEligibleSources: 2,
    },
    matchedSources: [
      { sourceId: 's1', sourceKey: 'spar-official-flyer-pdf', retailerKey: 'spar', channel: 'official-flyer', sourceType: 'pdf' },
      { sourceId: 's2', sourceKey: 'billa-official-site', retailerKey: 'billa', channel: 'official-site', sourceType: 'offers-page' },
    ],
    sources: [
      {
        sourceId: 's1',
        sourceKey: 'spar-official-flyer-pdf',
        retailerKey: 'spar',
        channel: 'official-flyer',
        sourceType: 'pdf',
        status: 'skipped',
        skippedReason: 'full-crawl-scoped-only-source',
        diagnostic: { notExecutedByPolicy: true },
      },
      {
        sourceId: 's2',
        sourceKey: 'billa-official-site',
        retailerKey: 'billa',
        channel: 'official-site',
        sourceType: 'offers-page',
        status: 'success',
      },
    ],
  };

  const summary = _private.buildRunSummary(result);

  assert.equal(summary.summary.failedSourcesCount, 0);
  assert.equal(summary.summary.policyBoundedSourcesCount, 1);
  assert.equal(
    _private.determineFinalStatus({ crawlResult: result, summary: summary.summary, mode: 'full' }),
    'success'
  );
});

test('determineFinalStatus treats retired BILLA Publitas skipped sources as non-fatal', () => {
  const result = {
    sourceCoverage: {
      totalRegisteredSources: 3,
      activeEligibleSources: 3,
    },
    matchedSources: [
      { sourceId: 's1', sourceKey: 'billa-official-flyer-steiermark', retailerKey: 'billa', channel: 'official-flyer', sourceType: 'flyer' },
      { sourceId: 's2', sourceKey: 'billa-plus-official-flyer-steiermark', retailerKey: 'billa-plus', channel: 'official-flyer', sourceType: 'flyer' },
      { sourceId: 's3', sourceKey: 'billa-official-site', retailerKey: 'billa', channel: 'official-site', sourceType: 'offers-page' },
    ],
    sources: [
      {
        sourceId: 's1',
        sourceKey: 'billa-official-flyer-steiermark',
        retailerKey: 'billa',
        channel: 'official-flyer',
        sourceType: 'flyer',
        status: 'skipped',
        skipped: true,
        skippedReason: 'retired-publitas-issue',
        diagnostic: {
          retiredSource: true,
          retainedPreviousData: true,
          publicFreshnessRequired: true,
        },
      },
      {
        sourceId: 's2',
        sourceKey: 'billa-plus-official-flyer-steiermark',
        retailerKey: 'billa-plus',
        channel: 'official-flyer',
        sourceType: 'flyer',
        status: 'skipped',
        skipped: true,
        skippedReason: 'retired-publitas-issue',
        diagnostic: {
          retiredSource: true,
          retainedPreviousData: true,
          publicFreshnessRequired: true,
        },
      },
      {
        sourceId: 's3',
        sourceKey: 'billa-official-site',
        retailerKey: 'billa',
        channel: 'official-site',
        sourceType: 'offers-page',
        status: 'success',
        offersStored: 4,
      },
    ],
  };

  const summary = _private.buildRunSummary(result);

  assert.equal(summary.summary.failedSourcesCount, 0);
  assert.equal(summary.summary.partialSourcesCount, 0);
  assert.equal(summary.summary.skippedSourcesCount, 2);
  assert.equal(summary.summary.policyBoundedSourcesCount, 0);
  assert.equal(summary.summary.matchedSourcesCount, 3);
  assert.equal(
    _private.determineFinalStatus({ crawlResult: result, summary: summary.summary, mode: 'full' }),
    'success'
  );
});

test('optional source transport-blocked does not degrade scheduled health', () => {
  const result = {
    sourceCoverage: { activeEligibleSources: 2, requiredForScheduledHealthSources: 1 },
    matchedSources: [
      { sourceKey: 'billa-official-site', sourceId: 'billa', scheduledHealthPolicy: { requiredForScheduledHealth: true, healthCriticality: 'required' } },
      { sourceKey: 'spar-official-flyer-current', sourceId: 'spar', scheduledHealthPolicy: { requiredForScheduledHealth: false, healthCriticality: 'optional' } },
    ],
    sources: [
      { sourceKey: 'billa-official-site', sourceId: 'billa', status: 'success', scheduledHealthPolicy: { requiredForScheduledHealth: true, healthCriticality: 'required' } },
      { sourceKey: 'spar-official-flyer-current', sourceId: 'spar', status: 'partial', failureStage: 'transport-blocked', scheduledHealthPolicy: { requiredForScheduledHealth: false, healthCriticality: 'optional' } },
    ],
    filterMetadata: { ok: true },
  };
  const summary = _private.buildRunSummary(result);
  assert.equal(summary.summary.requiredPartialSourcesCount, 0);
  assert.equal(summary.summary.optionalProblemSourcesCount, 1);
  assert.equal(_private.determineFinalStatus({ crawlResult: result, summary: summary.summary, mode: 'full' }), 'success');
});

test('required public zero-raw/partial source degrades scheduled health', () => {
  const result = {
    sourceCoverage: { activeEligibleSources: 1, requiredForScheduledHealthSources: 1 },
    matchedSources: [{ sourceKey: 'billa-official-site', sourceId: 'billa', scheduledHealthPolicy: { requiredForScheduledHealth: true, healthCriticality: 'required' } }],
    sources: [{ sourceKey: 'billa-official-site', sourceId: 'billa', status: 'partial', foundRawItems: 0, offersStored: 0, failureStage: 'zero-raw', scheduledHealthPolicy: { requiredForScheduledHealth: true, healthCriticality: 'required' } }],
    filterMetadata: { ok: true },
  };
  const summary = _private.buildRunSummary(result);
  assert.equal(summary.summary.requiredPartialSourcesCount, 1);
  assert.equal(_private.determineFinalStatus({ crawlResult: result, summary: summary.summary, mode: 'full' }), 'partial');
});

test('buildRunSummary exposes parser coverage rejection taxonomy and alert flags', () => {
  const summary = _private.buildRunSummary({
    matchedSources: [
      { sourceId: 's1', sourceKey: 'billa-official-flyer-flyer', retailerKey: 'billa', channel: 'official-flyer', sourceType: 'flyer' },
      { sourceId: 's2', sourceKey: 'spar-official-flyer-pdf', retailerKey: 'spar', channel: 'official-flyer', sourceType: 'pdf' },
      { sourceId: 's3', sourceKey: 'penny-official-flyer', retailerKey: 'penny', channel: 'official-flyer', sourceType: 'pdf' },
    ],
    sources: [
      {
        sourceId: 's1',
        sourceKey: 'billa-official-flyer-flyer',
        retailerKey: 'billa',
        channel: 'official-flyer',
        sourceType: 'flyer',
        status: 'success',
        foundRawItems: 13,
        parsedOffers: 0,
        offersStored: 0,
        rejectedOffers: 13,
      },
      {
        sourceId: 's2',
        sourceKey: 'spar-official-flyer-pdf',
        retailerKey: 'spar',
        channel: 'official-flyer',
        sourceType: 'pdf',
        status: 'success',
        foundRawItems: 43,
        parsedOffers: 18,
        offersStored: 18,
        rejectedOffers: 25,
        rejectionReasons: [
          { reason: 'generic-missing-quantity', count: 13 },
          { reason: 'generic-unclear-product', count: 8 },
          { reason: 'status-upcoming', count: 2 },
          { reason: 'status-expired', count: 2 },
        ],
        offers: [
          { title: 'Offer A', quantityText: '1 l', imageUrl: 'https://img.example.test/a.jpg' },
          { title: 'Offer B', quantityText: '500 g', imageUrl: '' },
          { title: 'Offer C', quantityText: '', imageUrl: '' },
        ],
      },
      {
        sourceId: 's3',
        sourceKey: 'penny-official-flyer',
        retailerKey: 'penny',
        channel: 'official-flyer',
        sourceType: 'pdf',
        status: 'success',
        foundRawItems: 5,
        parsedOffers: 5,
        offersStored: 5,
        rejectedOffers: 0,
        offers: [
          { title: 'Offer 1', quantityText: '1 kg', imageUrl: '' },
          { title: 'Offer 2', quantityText: '1 kg', imageUrl: '' },
          { title: 'Offer 3', quantityText: '1 kg', imageUrl: '' },
          { title: 'Offer 4', quantityText: '1 kg', imageUrl: '' },
          { title: 'Offer 5', quantityText: '1 kg', imageUrl: '' },
        ],
      },
    ],
  });

  const billa = summary.sources.find((source) => source.sourceKey === 'billa-official-flyer-flyer');
  const spar = summary.sources.find((source) => source.sourceKey === 'spar-official-flyer-pdf');
  const penny = summary.sources.find((source) => source.sourceKey === 'penny-official-flyer');

  assert.equal(billa.rejectedByReason['parser-no-offer-candidate'], 13);
  assert.equal(billa.flags.rawItemsFoundButZeroStored, true);
  assert.equal(billa.flags.highRejectionRate, true);

  assert.equal(spar.rejectedByReason['quantity-missing'], 13);
  assert.equal(spar.rejectedByReason['product-unclear'], 8);
  assert.equal(spar.upcomingCount, 2);
  assert.equal(spar.expiredCount, 2);
  assert.equal(spar.withImageCount, 1);
  assert.equal(spar.missingImageCount, 2);
  assert.equal(spar.imageCoverageRatio, 0.3333);
  assert.equal(spar.flags.highRejectionRate, true);
  assert.equal(spar.flags.highMissingImageRate, false);
  assert.equal(penny.withImageCount, 0);
  assert.equal(penny.missingImageCount, 5);
  assert.equal(penny.flags.highMissingImageRate, true);

  assert.equal(summary.summary.rejectedByReason['parser-no-offer-candidate'], 13);
  assert.equal(summary.summary.rejectedByReason['quantity-missing'], 13);
  assert.equal(summary.summary.rejectedByReason['product-unclear'], 8);
  assert.equal(summary.summary.upcomingCountTotal, 2);
  assert.equal(summary.summary.expiredCountTotal, 2);
  assert.equal(summary.summary.withImageCountTotal, 1);
  assert.equal(summary.summary.missingImageCountTotal, 7);
  assert.equal(summary.summary.sourceFlags.rawItemsFoundButZeroStored, 1);
  assert.equal(summary.summary.sourceFlags.highRejectionRate, 2);
  assert.equal(summary.summary.sourceFlags.highMissingImageRate, 1);
  assert.equal(summary.perRetailer.find((item) => item.retailerKey === 'spar').rejectedByReason['quantity-missing'], 13);
  assert.equal(summary.sourceTypes.find((item) => item.sourceType === 'pdf').rejectedByReason['product-unclear'], 8);
});

test('buildRunSummary aggregates granular aggregator rejection reasons', () => {
  const summary = _private.buildRunSummary({
    matchedSources: [
      { sourceId: 's1', sourceKey: 'aktionsfinder-bipa', retailerKey: 'bipa', channel: 'aggregator', sourceType: 'aggregator' },
    ],
    sources: [
      {
        sourceId: 's1',
        sourceKey: 'aktionsfinder-bipa',
        retailerKey: 'bipa',
        channel: 'aggregator',
        sourceType: 'aggregator',
        status: 'success',
        foundRawItems: 8,
        parsedOffers: 4,
        offersStored: 4,
        rejectedOffers: 4,
        rejectionReasons: [
          { reason: 'price-missing', count: 1 },
          { reason: 'title-missing', count: 1 },
          { reason: 'validity-expired', count: 1 },
          { reason: 'dedupe-dropped', count: 1 },
        ],
      },
    ],
  });

  const source = summary.sources[0];

  assert.equal(source.rejectedByReason['price-missing'], 1);
  assert.equal(source.rejectedByReason['title-missing'], 1);
  assert.equal(source.rejectedByReason['validity-expired'], 1);
  assert.equal(source.rejectedByReason['dedupe-dropped'], 1);
  assert.equal(source.parseFailedCount, 0);
  assert.equal(summary.summary.rejectedByReason['price-missing'], 1);
  assert.equal(summary.summary.rejectedByReason['dedupe-dropped'], 1);
  assert.equal(summary.perRetailer[0].rejectedByReason['validity-expired'], 1);
  assert.equal(summary.sourceTypes[0].rejectedByReason['title-missing'], 1);
});

test('determineFinalStatus is success only for complete successful crawl results', () => {
  assert.equal(_private.determineFinalStatus({
    mode: 'full',
    crawlResult: { filterMetadata: { ok: true } },
    summary: { matchedSourcesCount: 3, activeEligibleSources: 3, failedSourcesCount: 0, partialSourcesCount: 0 },
  }), 'success');

  assert.equal(_private.determineFinalStatus({
    mode: 'full',
    crawlResult: { filterMetadata: { ok: true } },
    summary: { matchedSourcesCount: 3, activeEligibleSources: 3, failedSourcesCount: 1, partialSourcesCount: 0 },
  }), 'partial');

  assert.equal(_private.determineFinalStatus({
    mode: 'full',
    crawlResult: { filterMetadata: { ok: false } },
    summary: { matchedSourcesCount: 3, activeEligibleSources: 3, failedSourcesCount: 0, partialSourcesCount: 0 },
  }), 'failed');

  assert.equal(_private.determineFinalStatus({
    mode: 'full',
    crawlResult: { filterMetadata: { ok: true } },
    summary: { matchedSourcesCount: 0, activeEligibleSources: 0, failedSourcesCount: 0, partialSourcesCount: 0 },
  }), 'skipped');

  assert.equal(_private.determineFinalStatus({
    mode: 'full',
    crawlResult: { filterMetadata: { ok: true } },
    summary: { matchedSourcesCount: 2, activeEligibleSources: 3, failedSourcesCount: 0, partialSourcesCount: 0 },
  }), 'partial');
});

test('serializeCrawlRun returns status payload without raw offers or raw documents', () => {
  const serialized = serializeCrawlRun({
    _id: { toString: () => '665000000000000000000010' },
    status: 'success',
    trigger: 'manual',
    mode: 'full',
    dryRun: false,
    region: 'Steiermark',
    startedAt: new Date('2026-05-10T00:00:00.000Z'),
    finishedAt: new Date('2026-05-10T00:01:00.000Z'),
    durationMs: 60000,
    summary: { matchedSourcesCount: 1 },
    metadata: {
      progress: {
        stage: 'filter-metadata-started',
        apiKey: 'nope',
        updatedAt: new Date('2026-05-10T00:00:30.000Z'),
      },
    },
    result: {
      sources: [{
        sourceKey: 'spar',
        status: 'success',
        offersStored: 1,
        rawDocuments: [{ secret: 'nope' }],
        diagnostic: { bodyPreview: 'ok', apiKey: 'nope' },
      }],
      offers: [{ title: 'nope' }],
      dedupe: { duplicateGroups: 0 },
      filterMetadata: { ok: true },
      effectiveRetailerKeys: ['spar'],
      requestedSourceKeys: [],
      requestedSourceIds: [],
    },
  });

  assert.equal(serialized.id, '665000000000000000000010');
  assert.equal(serialized.startedAt, '2026-05-10T00:00:00.000Z');
  assert.equal(serialized.result.offers, undefined);
  assert.equal(serialized.result.sources[0].rawDocuments, undefined);
  assert.equal(serialized.result.sources[0].diagnostic.apiKey, '[redacted]');
  assert.equal(serialized.metadata.progress.stage, 'filter-metadata-started');
  assert.equal(serialized.metadata.progress.apiKey, '[redacted]');
});

test('serializeCrawlRun tolerates malformed compact source entries', () => {
  const serialized = serializeCrawlRun({
    _id: { toString: () => '665000000000000000000011' },
    status: 'failed',
    trigger: 'manual',
    mode: 'full',
    result: {
      sources: [null],
    },
  });

  assert.equal(serialized.result.sources.length, 1);
  assert.equal(serialized.result.sources[0].sourceKey, '');
  assert.equal(serialized.result.sources[0].status, 'success');
});

test('serializeCrawlRun sanitizes mixed result payloads for JSON responses', () => {
  const runId = new mongoose.Types.ObjectId();
  const sourceId = new mongoose.Types.ObjectId();
  const serialized = serializeCrawlRun({
    _id: runId,
    status: 'success',
    trigger: 'manual',
    mode: 'full',
    summary: { processedOffers: 12n },
    result: {
      sources: [{ sourceId, sourceKey: 'spar', status: 'success' }],
      dedupe: { duplicateGroups: 1n },
      filterMetadata: { ok: true, processedOffers: 12n },
    },
  });

  assert.equal(serialized.id, String(runId));
  assert.equal(serialized.result.sources[0].sourceId, String(sourceId));
  assert.equal(serialized.summary.processedOffers, 12);
  assert.equal(serialized.result.dedupe.duplicateGroups, 1);
  assert.equal(serialized.result.filterMetadata.processedOffers, 12);
  assert.doesNotThrow(() => JSON.stringify(serialized));
});

test('stale lock detection only recovers long-running stuck CrawlRuns', () => {
  const now = new Date('2026-05-10T20:00:00.000Z');

  assert.equal(_private.isRunStale({
    status: 'running',
    startedAt: new Date('2026-05-10T03:00:00.000Z'),
  }, now), false);

  assert.equal(_private.isRunStale({
    status: 'running',
    startedAt: new Date('2026-05-10T01:00:00.000Z'),
  }, now), true);
});

test('explicit stale recovery classifies active orphan runs conservatively', () => {
  const now = new Date(_private.PROCESS_STARTED_AT.getTime() + 60 * 60 * 1000);
  const staleRun = {
    _id: new mongoose.Types.ObjectId(),
    status: 'running',
    startedAt: new Date(now.getTime() - 60 * 60 * 1000),
  };
  const freshRun = {
    _id: new mongoose.Types.ObjectId(),
    status: 'running',
    startedAt: new Date(now.getTime() - 15 * 60 * 1000),
  };
  const otherRunLock = {
    runId: new mongoose.Types.ObjectId(),
    status: 'running',
    heartbeatAt: new Date(now.getTime() - 60 * 1000),
  };

  assert.deepEqual(_private.isRecoverableStaleRun({
    run: staleRun,
    lock: { runId: staleRun._id, status: 'running' },
    now,
    staleAfterMs: 30 * 60 * 1000,
  }).recoverable, true);

  assert.equal(_private.isRecoverableStaleRun({
    run: freshRun,
    lock: { runId: freshRun._id, status: 'running' },
    now,
    staleAfterMs: 30 * 60 * 1000,
  }).reason, 'not-stale-enough');

  assert.equal(_private.isRecoverableStaleRun({
    run: staleRun,
    lock: otherRunLock,
    now,
    staleAfterMs: 30 * 60 * 1000,
  }).reason, 'lock-owned-by-different-run');
});

test('restart recovery classifies only old interrupted active CrawlRuns as recoverable', () => {
  const now = new Date(_private.PROCESS_STARTED_AT.getTime() + 2 * 60 * 60 * 1000);
  const oldInterruptedRun = {
    _id: new mongoose.Types.ObjectId(),
    status: 'running',
    startedAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 2 * 60 * 1000),
  };
  const freshInterruptedRun = {
    _id: new mongoose.Types.ObjectId(),
    status: 'running',
    startedAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 2 * 60 * 1000),
  };
  const currentProcessRun = {
    _id: new mongoose.Types.ObjectId(),
    status: 'running',
    startedAt: new Date(_private.PROCESS_STARTED_AT.getTime() + 60 * 1000),
  };

  assert.equal(_private.isRecoverableInterruptedRunAfterRestart({
    run: oldInterruptedRun,
    lock: {
      runId: oldInterruptedRun._id,
      status: 'running',
      heartbeatAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 60 * 1000),
    },
    now,
    staleAfterMs: 60 * 60 * 1000,
  }).reason, 'process-restart-stale-heartbeat');

  assert.equal(_private.isRecoverableInterruptedRunAfterRestart({
    run: freshInterruptedRun,
    lock: {
      runId: freshInterruptedRun._id,
      status: 'running',
      heartbeatAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 60 * 1000),
    },
    now,
    staleAfterMs: 4 * 60 * 60 * 1000,
  }).reason, 'not-stale-enough');

  assert.equal(_private.isRecoverableInterruptedRunAfterRestart({
    run: currentProcessRun,
    lock: {
      runId: currentProcessRun._id,
      status: 'running',
      heartbeatAt: new Date(_private.PROCESS_STARTED_AT.getTime() + 2 * 60 * 1000),
    },
    now,
    staleAfterMs: 60 * 60 * 1000,
  }).reason, 'started-in-current-process');

  assert.equal(_private.isRecoverableInterruptedRunAfterRestart({
    run: oldInterruptedRun,
    lock: {
      runId: oldInterruptedRun._id,
      status: 'running',
      heartbeatAt: new Date(_private.PROCESS_STARTED_AT.getTime() + 60 * 1000),
      owner: _private.buildLockOwner('scheduled'),
    },
    now,
    staleAfterMs: 60 * 60 * 1000,
  }).reason, 'lock-owned-by-current-process');

  assert.equal(_private.isRecoverableInterruptedRunAfterRestart({
    run: oldInterruptedRun,
    lock: {
      runId: oldInterruptedRun._id,
      status: 'running',
      heartbeatAt: new Date(_private.PROCESS_STARTED_AT.getTime() + 60 * 1000),
      owner: 'previous-host:1234:manual',
    },
    now,
    staleAfterMs: 60 * 60 * 1000,
  }).reason, 'process-restart-stale-heartbeat');

  assert.equal(_private.isRecoverableInterruptedRunAfterRestart({
    run: oldInterruptedRun,
    lock: {
      runId: oldInterruptedRun._id,
      status: 'running',
      heartbeatAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 60 * 1000),
      owner: _private.buildLockOwner('scheduled'),
    },
    now,
    staleAfterMs: 60 * 60 * 1000,
  }).reason, 'process-restart-stale-heartbeat');
});

test('recoverInterruptedCrawlRunsAfterRestart marks old interrupted runs failed and releases matching lock idempotently', async () => {
  const { recoverInterruptedCrawlRunsAfterRestart } = require('../src/services/crawl/crawlRunService');
  const runId = new mongoose.Types.ObjectId();
  const now = new Date(_private.PROCESS_STARTED_AT.getTime() + 2 * 60 * 60 * 1000);
  const run = {
    _id: runId,
    status: 'running',
    startedAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 2 * 60 * 1000),
    warnings: [],
    errorMessages: [],
  };
  const lock = {
    runId,
    status: 'running',
    heartbeatAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 60 * 1000),
  };
  const originals = {
    crawlRunFind: CrawlRun.find,
    crawlRunFindOneAndUpdate: CrawlRun.findOneAndUpdate,
    crawlRunCountDocuments: CrawlRun.countDocuments,
    crawlRunLockFindById: CrawlRunLock.findById,
    crawlRunLockUpdateOne: CrawlRunLock.updateOne,
    offerUpdateMany: Offer.updateMany,
  };
  const runUpdates = [];
  const lockUpdates = [];
  const offerUpdates = [];
  let activeRuns = [run];

  CrawlRun.find = () => ({
    sort() {
      return activeRuns;
    },
  });
  CrawlRun.findOneAndUpdate = async (filter, update, options) => {
    runUpdates.push({ filter, update, options });
    if (!activeRuns.some((item) => String(item._id) === String(filter._id) && item.status === 'running')) {
      return null;
    }
    activeRuns = [];
    return { ...run, status: 'failed' };
  };
  CrawlRunLock.findById = () => ({
    lean: async () => lock,
  });
  CrawlRunLock.updateOne = async (filter, update) => {
    lockUpdates.push({ filter, update });
    return { modifiedCount: 1 };
  };
  Offer.updateMany = async (filter, update) => {
    offerUpdates.push({ filter, update });
    return { matchedCount: 2, modifiedCount: 2 };
  };

  try {
    const first = await recoverInterruptedCrawlRunsAfterRestart({
      now,
      staleAfterMs: 60 * 60 * 1000,
      reason: 'test restart recovery',
    });
    const second = await recoverInterruptedCrawlRunsAfterRestart({
      now,
      staleAfterMs: 60 * 60 * 1000,
      reason: 'test restart recovery',
    });

    assert.equal(first.recovered.length, 1);
    assert.equal(first.recovered[0].runId, String(runId));
    assert.equal(second.recovered.length, 0);
  } finally {
    CrawlRun.find = originals.crawlRunFind;
    CrawlRun.findOneAndUpdate = originals.crawlRunFindOneAndUpdate;
    CrawlRunLock.findById = originals.crawlRunLockFindById;
    CrawlRunLock.updateOne = originals.crawlRunLockUpdateOne;
    Offer.updateMany = originals.offerUpdateMany;
  }

  assert.equal(runUpdates.length, 1);
  assert.equal(runUpdates[0].update.$set.status, 'failed');
  assert.equal(runUpdates[0].update.$set.finishedAt, now);
  assert.equal(runUpdates[0].update.$set['metadata.staleRecovery'].recoveredBy, 'startup-recovery');
  assert.equal(runUpdates[0].update.$set['metadata.staleRecovery'].heartbeatAt, lock.heartbeatAt);
  assert.equal(runUpdates[0].update.$set['metadata.staleRecovery'].heartbeatAgeMs, now.getTime() - lock.heartbeatAt.getTime());
  assert.equal(runUpdates[0].update.$set['metadata.staleRecovery'].thresholdMs, 60 * 60 * 1000);
  assert.equal(runUpdates[0].update.$set['metadata.staleRecovery'].lockOwner, '');
  assert.equal(runUpdates[0].update.$set['metadata.shutdown'].signal, 'process-restart-recovery');
  assert.equal(runUpdates[0].update.$set['metadata.shutdown'].interruptedBy, 'startup-recovery');
  assert.equal(runUpdates[0].update.$set['metadata.progress'].stage, 'process-restart-recovery');
  assert.equal(runUpdates[0].update.$set['metadata.progress'].runStatus, 'failed');
  assert.match(runUpdates[0].update.$push.warnings, /after restart/i);
  assert.match(runUpdates[0].update.$push.errorMessages, /marked failed after process restart/i);
  assert.equal(offerUpdates.length, 1);
  assert.deepEqual(offerUpdates[0].filter, { crawlRunId: runId });
  assert.equal(offerUpdates[0].update.$set.publishStatus, 'crawl-run-failed');
  assert.ok(lockUpdates.some((call) => call.update?.$set?.status === 'released'));
});

test('source-started without finished source result remains scheduled replacement eligible after restart recovery', async () => {
  const { recoverInterruptedCrawlRunsAfterRestart } = require('../src/services/crawl/crawlRunService');
  const runId = new mongoose.Types.ObjectId();
  const now = new Date(_private.PROCESS_STARTED_AT.getTime() + 2 * 60 * 60 * 1000);
  const run = {
    _id: runId,
    status: 'running',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 2 * 60 * 1000),
    summary: { successfulSourcesCount: 0, failedSourcesCount: 0 },
    result: { sources: [] },
    metadata: {
      progress: {
        stage: 'source-started',
        sourceIndex: 1,
        sourceCount: 12,
        currentSourceKey: 'penny-official-site',
      },
    },
    warnings: [],
    errorMessages: [],
  };
  const lock = {
    runId,
    status: 'running',
    heartbeatAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 60 * 1000),
  };
  const originals = {
    crawlRunFind: CrawlRun.find,
    crawlRunFindOneAndUpdate: CrawlRun.findOneAndUpdate,
    crawlRunLockFindById: CrawlRunLock.findById,
    crawlRunLockUpdateOne: CrawlRunLock.updateOne,
    offerUpdateMany: Offer.updateMany,
  };
  const runUpdates = [];
  let activeRuns = [run];

  CrawlRun.find = () => ({
    sort() {
      return activeRuns;
    },
  });
  CrawlRun.findOneAndUpdate = async (filter, update) => {
    runUpdates.push({ filter, update });
    activeRuns = [];
    return { ...run, status: 'failed' };
  };
  CrawlRun.countDocuments = async () => 0;
  CrawlRunLock.findById = () => ({
    lean: async () => lock,
  });
  CrawlRunLock.updateOne = async () => ({ modifiedCount: 1 });
  Offer.updateMany = async () => ({ matchedCount: 0, modifiedCount: 0 });

  try {
    const result = await recoverInterruptedCrawlRunsAfterRestart({
      now,
      staleAfterMs: 60 * 60 * 1000,
      reason: 'live restart recovery',
    });

    assert.equal(result.recovered.length, 1);
    assert.equal(result.recovered[0].replacementCandidate, true);
    assert.equal(result.recovered[0].replacementAttemptsExhausted, false);
    assert.equal(result.recovered[0].operatorActionRequired, false);
  } finally {
    CrawlRun.find = originals.crawlRunFind;
    CrawlRun.findOneAndUpdate = originals.crawlRunFindOneAndUpdate;
    CrawlRun.countDocuments = originals.crawlRunCountDocuments;
    CrawlRunLock.findById = originals.crawlRunLockFindById;
    CrawlRunLock.updateOne = originals.crawlRunLockUpdateOne;
    Offer.updateMany = originals.offerUpdateMany;
  }

  assert.equal(runUpdates[0].update.$set['metadata.scheduledReplacement'].status, 'required');
  assert.equal(
    runUpdates[0].update.$push.errorMessages,
    'CrawlRun was marked failed after process restart; a safe scheduled replacement crawl is required.'
  );
});

test('scheduled replacement readiness stops after the automatic attempt limit', async () => {
  const originalRunId = new mongoose.Types.ObjectId();
  const replacementRunId = new mongoose.Types.ObjectId();
  const originalRun = {
    _id: originalRunId,
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date('2026-06-18T04:37:00.000Z'),
    summary: {},
    result: { sources: [] },
    metadata: { progress: { stage: 'process-restart-recovery' } },
  };
  const replacementRun = {
    _id: replacementRunId,
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date('2026-06-18T04:53:00.000Z'),
    summary: {},
    result: { sources: [] },
    metadata: {
      scheduledReplacement: {
        originalRunId: String(originalRunId),
        reason: 'eligible-source-less-scheduled-restart',
      },
      progress: { stage: 'process-restart-recovery' },
    },
  };
  const originals = {
    crawlRunFind: CrawlRun.find,
    crawlRunFindById: CrawlRun.findById,
    crawlRunCountDocuments: CrawlRun.countDocuments,
  };

  CrawlRun.findById = async () => originalRun;
  CrawlRun.find = () => ({
    sort() {
      return {
        limit() {
          return [replacementRun];
        },
      };
    },
  });
  CrawlRun.countDocuments = async () => {
    throw new Error('replacement attempts must be counted from the persistent chain');
  };

  try {
    const readiness = await _private.assessScheduledReplacementReadiness({
      originalRunId,
    });

    assert.equal(readiness.eligible, false);
    assert.equal(readiness.reason, 'replacement-attempt-limit-exhausted');
    assert.equal(readiness.operatorActionRequired, true);
    assert.equal(readiness.replacementAttemptCount, _private.MAX_SCHEDULED_REPLACEMENT_ATTEMPTS);
  } finally {
    CrawlRun.find = originals.crawlRunFind;
    CrawlRun.findById = originals.crawlRunFindById;
    CrawlRun.countDocuments = originals.crawlRunCountDocuments;
  }
});

test('scheduled replacement readiness blocks exhausted descendants in the root chain', async () => {
  const originalRunId = new mongoose.Types.ObjectId();
  const firstReplacementId = new mongoose.Types.ObjectId();
  const exhaustedReplacementId = new mongoose.Types.ObjectId();
  const originalRun = {
    _id: originalRunId,
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date('2026-06-18T04:37:00.000Z'),
    summary: {},
    result: { sources: [] },
    metadata: {
      scheduledReplacement: {
        status: 'required',
        originalRunId: String(originalRunId),
      },
      progress: { stage: 'process-restart-recovery' },
    },
  };
  const firstReplacement = {
    _id: firstReplacementId,
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date('2026-06-18T09:04:00.000Z'),
    summary: {},
    result: { sources: [] },
    metadata: {
      scheduledReplacement: {
        originalRunId: String(originalRunId),
        reason: 'eligible-source-less-scheduled-restart',
      },
      progress: { stage: 'process-restart-recovery' },
    },
  };
  const exhaustedReplacement = {
    _id: exhaustedReplacementId,
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date('2026-06-18T09:21:00.000Z'),
    summary: {},
    result: { sources: [] },
    metadata: {
      scheduledReplacement: {
        status: _private.SCHEDULED_REPLACEMENT_EXHAUSTED_STATUS,
        originalRunId: String(firstReplacementId),
        reason: 'replacement-attempt-limit-exhausted',
        operatorActionRequired: true,
      },
      progress: { stage: 'process-restart-recovery' },
    },
  };
  const originals = {
    crawlRunFind: CrawlRun.find,
    crawlRunFindById: CrawlRun.findById,
    crawlRunCountDocuments: CrawlRun.countDocuments,
  };
  const findQueries = [];

  CrawlRun.findById = async (id) => {
    const idString = String(id);
    if (idString === String(originalRunId)) return originalRun;
    if (idString === String(firstReplacementId)) return firstReplacement;
    if (idString === String(exhaustedReplacementId)) return exhaustedReplacement;
    return null;
  };
  CrawlRun.find = (query = {}) => ({
    sort() {
      return {
        limit() {
          findQueries.push(query);
          const parentIds = query['metadata.scheduledReplacement.originalRunId']?.$in || [];
          return [firstReplacement, exhaustedReplacement].filter((run) => (
            parentIds.includes(String(run.metadata.scheduledReplacement.originalRunId))
          ));
        },
      };
    },
  });
  CrawlRun.countDocuments = async () => {
    throw new Error('exhausted descendants must block before legacy attempt counting');
  };

  try {
    const readiness = await _private.assessScheduledReplacementReadiness({
      originalRunId,
    });

    assert.equal(readiness.eligible, false);
    assert.equal(readiness.reason, 'replacement-attempt-limit-exhausted');
    assert.equal(readiness.operatorActionRequired, true);
    assert.equal(String(readiness.exhaustedRun._id), String(exhaustedReplacementId));
  } finally {
    CrawlRun.find = originals.crawlRunFind;
    CrawlRun.findById = originals.crawlRunFindById;
    CrawlRun.countDocuments = originals.crawlRunCountDocuments;
  }

  assert.equal(findQueries.length >= 2, true);
  assert.deepEqual(findQueries[0]['metadata.scheduledReplacement.originalRunId'].$in, [String(originalRunId)]);
  assert.deepEqual(
    findQueries[1]['metadata.scheduledReplacement.originalRunId'].$in.sort(),
    [String(originalRunId), String(firstReplacementId)].sort()
  );
});

test('startScheduledReplacementCrawlRun does not reset attempts for replacement descendants', async () => {
  const { startScheduledReplacementCrawlRun } = require('../src/services/crawl/crawlRunService');
  const originalRunId = new mongoose.Types.ObjectId();
  const replacementRunId = new mongoose.Types.ObjectId();
  const originalRun = {
    _id: originalRunId,
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date('2026-06-18T04:37:00.000Z'),
    summary: {},
    result: { sources: [] },
    metadata: { progress: { stage: 'process-restart-recovery' } },
  };
  const replacementRun = {
    _id: replacementRunId,
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date('2026-06-18T09:04:00.000Z'),
    summary: {},
    result: { sources: [] },
    metadata: {
      scheduledReplacement: {
        originalRunId: String(originalRunId),
        reason: 'eligible-source-less-scheduled-restart',
      },
      progress: { stage: 'process-restart-recovery' },
    },
  };
  const originals = {
    crawlRunFind: CrawlRun.find,
    crawlRunFindById: CrawlRun.findById,
    crawlRunCountDocuments: CrawlRun.countDocuments,
  };

  CrawlRun.findById = async (id) => {
    const idString = String(id);
    if (idString === String(originalRunId)) return originalRun;
    if (idString === String(replacementRunId)) return replacementRun;
    return null;
  };
  CrawlRun.find = (query = {}) => ({
    sort() {
      return {
        limit() {
          const parentIds = query['metadata.scheduledReplacement.originalRunId']?.$in || [];
          return parentIds.includes(String(originalRunId)) ? [replacementRun] : [];
        },
      };
    },
  });
  CrawlRun.countDocuments = async () => 0;

  try {
    const result = await startScheduledReplacementCrawlRun({
      originalRunId: replacementRunId,
      region: 'AT',
      defer: true,
      crawlAllSourcesImpl: async () => {
        throw new Error('must not start replacement descendant');
      },
    });

    assert.equal(result.accepted, false);
    assert.equal(result.replacementSkipped, true);
    assert.equal(result.reason, 'replacement-attempt-limit-exhausted');
    assert.equal(result.operatorActionRequired, true);
    assert.equal(result.replacementAttemptCount, _private.MAX_SCHEDULED_REPLACEMENT_ATTEMPTS);
    assert.equal(String(result.originalRun._id), String(originalRunId));
  } finally {
    CrawlRun.find = originals.crawlRunFind;
    CrawlRun.findById = originals.crawlRunFindById;
    CrawlRun.countDocuments = originals.crawlRunCountDocuments;
  }
});

test('startScheduledReplacementCrawlRun reports operator action when replacement attempts are exhausted', async () => {
  const { startScheduledReplacementCrawlRun } = require('../src/services/crawl/crawlRunService');
  const originalRunId = new mongoose.Types.ObjectId();
  const replacementRunId = new mongoose.Types.ObjectId();
  const originalRun = {
    _id: originalRunId,
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date('2026-06-18T04:37:00.000Z'),
    summary: {},
    result: { sources: [] },
    metadata: { progress: { stage: 'process-restart-recovery' } },
  };
  const replacementRun = {
    _id: replacementRunId,
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    summary: {},
    result: { sources: [] },
    metadata: {
      scheduledReplacement: {
        originalRunId: String(originalRunId),
        reason: 'eligible-source-less-scheduled-restart',
      },
      progress: { stage: 'process-restart-recovery' },
    },
  };
  const originals = {
    crawlRunFind: CrawlRun.find,
    crawlRunFindById: CrawlRun.findById,
    crawlRunCountDocuments: CrawlRun.countDocuments,
  };

  CrawlRun.findById = async () => originalRun;
  CrawlRun.find = (query = {}) => ({
    sort() {
      return {
        limit() {
          const parentIds = query['metadata.scheduledReplacement.originalRunId']?.$in || [];
          return parentIds.includes(String(originalRunId)) ? [replacementRun] : [];
        },
      };
    },
  });
  CrawlRun.countDocuments = async () => _private.MAX_SCHEDULED_REPLACEMENT_ATTEMPTS;

  try {
    const result = await startScheduledReplacementCrawlRun({
      originalRunId,
      region: 'AT',
      defer: false,
      crawlAllSourcesImpl: async () => {
        throw new Error('must not start replacement crawl');
      },
    });

    assert.equal(result.accepted, false);
    assert.equal(result.replacementSkipped, true);
    assert.equal(result.reason, 'replacement-attempt-limit-exhausted');
    assert.equal(result.operatorActionRequired, true);
    assert.equal(result.replacementAttemptCount, _private.MAX_SCHEDULED_REPLACEMENT_ATTEMPTS);
  } finally {
    CrawlRun.find = originals.crawlRunFind;
    CrawlRun.findById = originals.crawlRunFindById;
    CrawlRun.countDocuments = originals.crawlRunCountDocuments;
  }
});

test('recoverInterruptedCrawlRunsAfterRestart exhausts source-less replacement runs instead of requiring another replacement', async () => {
  const { recoverInterruptedCrawlRunsAfterRestart } = require('../src/services/crawl/crawlRunService');
  const originalRunId = new mongoose.Types.ObjectId();
  const runId = new mongoose.Types.ObjectId();
  const now = new Date(_private.PROCESS_STARTED_AT.getTime() + 2 * 60 * 60 * 1000);
  const run = {
    _id: runId,
    status: 'running',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 2 * 60 * 1000),
    summary: { successfulSourcesCount: 0, failedSourcesCount: 0 },
    result: { sources: [] },
    metadata: {
      scheduledReplacement: {
        originalRunId: String(originalRunId),
        reason: 'eligible-source-less-scheduled-restart',
      },
      progress: { stage: 'source-started' },
    },
    warnings: [],
    errorMessages: [],
  };
  const lock = {
    runId,
    status: 'running',
    heartbeatAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 60 * 1000),
  };
  const originals = {
    crawlRunFind: CrawlRun.find,
    crawlRunFindOneAndUpdate: CrawlRun.findOneAndUpdate,
    crawlRunCountDocuments: CrawlRun.countDocuments,
    crawlRunLockFindById: CrawlRunLock.findById,
    crawlRunLockUpdateOne: CrawlRunLock.updateOne,
    offerUpdateMany: Offer.updateMany,
  };
  const runUpdates = [];

  CrawlRun.find = () => ({
    sort() {
      return [run];
    },
  });
  CrawlRun.findOneAndUpdate = async (filter, update) => {
    runUpdates.push({ filter, update });
    return { ...run, status: 'failed' };
  };
  CrawlRun.countDocuments = async () => _private.MAX_SCHEDULED_REPLACEMENT_ATTEMPTS;
  CrawlRunLock.findById = () => ({
    lean: async () => lock,
  });
  CrawlRunLock.updateOne = async () => ({ modifiedCount: 1 });
  Offer.updateMany = async () => ({ matchedCount: 0, modifiedCount: 0 });

  try {
    const result = await recoverInterruptedCrawlRunsAfterRestart({
      now,
      staleAfterMs: 60 * 60 * 1000,
      reason: 'replacement restart recovery',
    });

    assert.equal(result.recovered.length, 1);
    assert.equal(result.recovered[0].replacementCandidate, false);
    assert.equal(result.recovered[0].replacementAttemptsExhausted, true);
    assert.equal(result.recovered[0].operatorActionRequired, true);
  } finally {
    CrawlRun.find = originals.crawlRunFind;
    CrawlRun.findOneAndUpdate = originals.crawlRunFindOneAndUpdate;
    CrawlRun.countDocuments = originals.crawlRunCountDocuments;
    CrawlRunLock.findById = originals.crawlRunLockFindById;
    CrawlRunLock.updateOne = originals.crawlRunLockUpdateOne;
    Offer.updateMany = originals.offerUpdateMany;
  }

  const marker = runUpdates[0].update.$set['metadata.scheduledReplacement'];
  assert.equal(marker.status, _private.SCHEDULED_REPLACEMENT_EXHAUSTED_STATUS);
  assert.equal(marker.reason, 'replacement-attempt-limit-exhausted');
  assert.equal(marker.originalRunId, String(originalRunId));
  assert.equal(marker.exhaustedRunId, String(runId));
  assert.equal(marker.operatorActionRequired, true);
  assert.equal(
    runUpdates[0].update.$push.errorMessages,
    'CrawlRun was marked failed after process restart; scheduled replacement attempts are exhausted and operator action is required.'
  );
});

test('source execution evidence starts only after a source finished or produced results', () => {
  assert.equal(_private.hasSourceExecutionEvidence({
    result: { sources: [] },
    summary: { successfulSourcesCount: 0, failedSourcesCount: 0 },
    metadata: { progress: { stage: 'source-started' } },
  }), false);

  assert.equal(_private.hasSourceExecutionEvidence({
    result: { sources: [] },
    summary: { successfulSourcesCount: 0, failedSourcesCount: 0 },
    metadata: { progress: { stage: 'source-finished', finishedSourceCount: 1 } },
  }), true);

  assert.equal(_private.hasSourceExecutionEvidence({
    result: { sources: [{ sourceKey: 'spar-official-flyer-current', status: 'success' }] },
    summary: {},
    metadata: { progress: { stage: 'process-restart-recovery' } },
  }), true);
});

test('findPendingScheduledReplacementCandidates includes latest untagged source-less restart failure', async () => {
  const originalRunId = new mongoose.Types.ObjectId();
  const untaggedRun = {
    _id: originalRunId,
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date('2026-06-18T04:37:00.096Z'),
    finishedAt: new Date('2026-06-18T04:52:47.750Z'),
    summary: {},
    result: { sources: [] },
    metadata: {
      scheduledReplacement: null,
      progress: { stage: 'process-restart-recovery' },
    },
    warnings: [
      'Interrupted CrawlRun recovery after restart: Scheduler periodic recovery found an active CrawlRun from a previous process with a stale lock heartbeat.',
    ],
    errorMessages: [
      'CrawlRun was marked failed after process restart; no automatic replacement crawl was started.',
    ],
  };
  const originals = {
    crawlRunFind: CrawlRun.find,
    crawlRunFindOne: CrawlRun.findOne,
    crawlRunFindById: CrawlRun.findById,
    crawlRunUpdateOne: CrawlRun.updateOne,
    crawlRunCountDocuments: CrawlRun.countDocuments,
    crawlRunCollectionFind: CrawlRun.collection.find,
    crawlRunLockFindById: CrawlRunLock.findById,
    offerCountDocuments: Offer.countDocuments,
  };
  const markerUpdates = [];
  let rawCollectionQuery = null;

  CrawlRun.find = (query = {}) => ({
    sort() {
      return {
        limit() {
          if (query['metadata.scheduledReplacement.status'] === 'required') {
            return [];
          }
          return [];
        },
      };
    },
  });
  CrawlRun.findOne = (query = {}) => ({
    sort() {
      if (query['metadata.scheduledReplacement.originalRunId']) {
        return null;
      }
      if (query.status?.$in) {
        return null;
      }
      return null;
    },
  });
  CrawlRun.collection.find = (query = {}) => {
    rawCollectionQuery = query;
    return {
      sort() {
        return {
          limit() {
            return {
              toArray: async () => [untaggedRun],
            };
          },
        };
      },
    };
  };
  CrawlRun.findById = async () => untaggedRun;
  CrawlRun.countDocuments = async () => 0;
  CrawlRun.updateOne = async (filter, update) => {
    markerUpdates.push({ filter, update });
    return { modifiedCount: 1 };
  };
  CrawlRunLock.findById = () => ({
    lean: async () => ({ status: 'released', runId: null }),
  });
  Offer.countDocuments = async () => 0;

  try {
    const pending = await _private.findPendingScheduledReplacementCandidates();

    assert.equal(pending.length, 1);
    assert.equal(pending[0].runId, String(originalRunId));
    assert.equal(pending[0].replacementCandidate, true);
    assert.equal(pending[0].marker.marked, true);
  } finally {
    CrawlRun.find = originals.crawlRunFind;
    CrawlRun.findOne = originals.crawlRunFindOne;
    CrawlRun.findById = originals.crawlRunFindById;
    CrawlRun.updateOne = originals.crawlRunUpdateOne;
    CrawlRun.countDocuments = originals.crawlRunCountDocuments;
    CrawlRun.collection.find = originals.crawlRunCollectionFind;
    CrawlRunLock.findById = originals.crawlRunLockFindById;
    Offer.countDocuments = originals.offerCountDocuments;
  }

  assert.equal(markerUpdates.length, 1);
  assert.equal(markerUpdates[0].filter._id, originalRunId);
  assert.equal(markerUpdates[0].update.$set['metadata.scheduledReplacement'].status, 'required');
  assert.equal(markerUpdates[0].update.$set['metadata.scheduledReplacement'].originalRunId, String(originalRunId));
  assert.deepEqual(rawCollectionQuery, {
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    status: 'failed',
  });
});

test('findPendingScheduledReplacementCandidates does not re-plan exhausted replacement chains', async () => {
  const originalRunId = new mongoose.Types.ObjectId();
  const replacementRunId = new mongoose.Types.ObjectId();
  const exhaustedRunId = new mongoose.Types.ObjectId();
  const originalRun = {
    _id: originalRunId,
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date('2026-06-18T04:37:00.096Z'),
    finishedAt: new Date('2026-06-18T04:52:47.750Z'),
    summary: {},
    result: { sources: [] },
    metadata: {
      scheduledReplacement: {
        status: 'required',
        originalRunId: String(originalRunId),
      },
      progress: { stage: 'process-restart-recovery' },
    },
  };
  const replacementRun = {
    _id: replacementRunId,
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date('2026-06-18T09:04:00.000Z'),
    summary: {},
    result: { sources: [] },
    metadata: {
      scheduledReplacement: {
        originalRunId: String(originalRunId),
        reason: 'eligible-source-less-scheduled-restart',
      },
      progress: { stage: 'process-restart-recovery' },
    },
  };
  const exhaustedRun = {
    _id: exhaustedRunId,
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: new Date('2026-06-18T09:21:00.000Z'),
    summary: {},
    result: { sources: [] },
    metadata: {
      scheduledReplacement: {
        status: _private.SCHEDULED_REPLACEMENT_EXHAUSTED_STATUS,
        originalRunId: String(replacementRunId),
        reason: 'replacement-attempt-limit-exhausted',
        operatorActionRequired: true,
      },
      progress: { stage: 'process-restart-recovery' },
    },
  };
  const originals = {
    crawlRunFind: CrawlRun.find,
    crawlRunFindById: CrawlRun.findById,
    crawlRunUpdateOne: CrawlRun.updateOne,
    crawlRunCollectionFind: CrawlRun.collection.find,
  };
  const markerUpdates = [];

  CrawlRun.find = (query = {}) => ({
    sort() {
      return {
        limit() {
          if (query['metadata.scheduledReplacement.status'] === 'required') {
            return [originalRun];
          }
          const parentIds = query['metadata.scheduledReplacement.originalRunId']?.$in || [];
          return [replacementRun, exhaustedRun].filter((run) => (
            parentIds.includes(String(run.metadata.scheduledReplacement.originalRunId))
          ));
        },
      };
    },
  });
  CrawlRun.findById = async (id) => {
    const idString = String(id);
    if (idString === String(originalRunId)) return originalRun;
    if (idString === String(replacementRunId)) return replacementRun;
    if (idString === String(exhaustedRunId)) return exhaustedRun;
    return null;
  };
  CrawlRun.updateOne = async (filter, update) => {
    markerUpdates.push({ filter, update });
    return { modifiedCount: 1 };
  };
  CrawlRun.collection.find = () => ({
    sort() {
      return {
        limit() {
          return {
            toArray: async () => [],
          };
        },
      };
    },
  });

  try {
    const pending = await _private.findPendingScheduledReplacementCandidates();

    assert.deepEqual(pending, []);
  } finally {
    CrawlRun.find = originals.crawlRunFind;
    CrawlRun.findById = originals.crawlRunFindById;
    CrawlRun.updateOne = originals.crawlRunUpdateOne;
    CrawlRun.collection.find = originals.crawlRunCollectionFind;
  }

  assert.equal(markerUpdates.length, 1);
  assert.equal(markerUpdates[0].filter._id, originalRunId);
  assert.equal(
    markerUpdates[0].update.$set['metadata.scheduledReplacement'].status,
    _private.SCHEDULED_REPLACEMENT_EXHAUSTED_STATUS
  );
  assert.equal(markerUpdates[0].update.$set['metadata.scheduledReplacement'].operatorActionRequired, true);
});

test('open publish status guard matches dashboard intermediate-only semantics', async () => {
  const original = Offer.countDocuments;
  let query = null;

  Offer.countDocuments = async (input) => {
    query = input;
    return 0;
  };

  try {
    const hasOpen = await _private.hasOpenOfferPublishStatus();

    assert.equal(hasOpen, false);
  } finally {
    Offer.countDocuments = original;
  }

  assert.deepEqual(query, {
    status: 'active',
    isActiveNow: true,
    publishStatus: { $in: ['', 'source-written', 'queued', 'running'] },
  });
});

test('existing scheduled replacement guard ignores source-less failed replacement retries', async () => {
  const original = CrawlRun.find;
  const originalRunId = new mongoose.Types.ObjectId();
  const replacementId = new mongoose.Types.ObjectId();
  let replacementRuns = [];

  CrawlRun.find = () => ({
    sort() {
      return {
        limit() {
          return replacementRuns;
        },
      };
    },
  });

  try {
    replacementRuns = [
      {
        _id: replacementId,
        status: 'failed',
        trigger: 'scheduled',
        mode: 'full',
        dryRun: false,
        summary: {},
        result: { sources: [] },
        metadata: {
          scheduledReplacement: { originalRunId: String(originalRunId) },
          progress: { stage: 'process-restart-recovery' },
        },
      },
    ];
    assert.equal(await _private.findExistingScheduledReplacementRun(originalRunId), null);

    replacementRuns = [{ ...replacementRuns[0], status: 'running' }];
    assert.equal(await _private.findExistingScheduledReplacementRun(originalRunId), replacementRuns[0]);

    replacementRuns = [
      {
        ...replacementRuns[0],
        status: 'failed',
        result: { sources: [{ sourceKey: 'hofer-official', status: 'failed' }] },
      },
    ];
    assert.equal(await _private.findExistingScheduledReplacementRun(originalRunId), replacementRuns[0]);
  } finally {
    CrawlRun.find = original;
  }
});

test('recoverStaleCrawlRun releases matching lock even when publish status marking fails', async () => {
  const { recoverStaleCrawlRun } = require('../src/services/crawl/crawlRunService');
  const runId = new mongoose.Types.ObjectId();
  const now = new Date(_private.PROCESS_STARTED_AT.getTime() + 60 * 60 * 1000);
  const run = {
    _id: runId,
    status: 'running',
    startedAt: new Date(now.getTime() - 60 * 60 * 1000),
    warnings: [],
    errorMessages: [],
  };
  const lock = {
    runId,
    status: 'running',
    heartbeatAt: new Date(now.getTime() - 60 * 60 * 1000),
  };
  const originals = {
    crawlRunFindById: CrawlRun.findById,
    crawlRunFindByIdAndUpdate: CrawlRun.findByIdAndUpdate,
    crawlRunLockFindById: CrawlRunLock.findById,
    crawlRunLockUpdateOne: CrawlRunLock.updateOne,
    offerUpdateMany: Offer.updateMany,
  };
  const runUpdates = [];
  const lockUpdates = [];
  let findByIdCalls = 0;

  CrawlRun.findById = async () => {
    findByIdCalls += 1;
    return findByIdCalls === 1 ? run : { ...run, status: 'stale', finishedAt: now };
  };
  CrawlRun.findByIdAndUpdate = async (id, update) => {
    runUpdates.push({ id, update });
    return { modifiedCount: 1 };
  };
  CrawlRunLock.findById = () => ({
    lean: async () => lock,
  });
  CrawlRunLock.updateOne = async (filter, update) => {
    lockUpdates.push({ filter, update });
    return { matchedCount: 1, modifiedCount: 1 };
  };
  Offer.updateMany = async () => {
    throw new Error('publish status already final query failed');
  };

  try {
    const result = await recoverStaleCrawlRun({
      runId,
      reason: 'test publish failure',
      now,
    });

    assert.equal(result.recovered, true);
    assert.equal(result.publishStatusError, 'publish status already final query failed');
  } finally {
    CrawlRun.findById = originals.crawlRunFindById;
    CrawlRun.findByIdAndUpdate = originals.crawlRunFindByIdAndUpdate;
    CrawlRunLock.findById = originals.crawlRunLockFindById;
    CrawlRunLock.updateOne = originals.crawlRunLockUpdateOne;
    Offer.updateMany = originals.offerUpdateMany;
  }

  assert.equal(runUpdates[0].update.$set.status, 'stale');
  assert.ok(lockUpdates.some((call) => call.update?.$set?.status === 'released'));
});

test('shutdown interruption finalizes current-process CrawlRuns and releases the lock', async () => {
  const { interruptCurrentProcessCrawlRuns } = require('../src/services/crawl/crawlRunService');
  const runId = new mongoose.Types.ObjectId();
  const now = new Date('2026-06-13T01:03:00.000Z');
  const startedAt = new Date('2026-06-13T01:00:00.000Z');
  const run = {
    _id: runId,
    status: 'running',
    trigger: 'scheduled',
    startedAt,
  };
  const lock = {
    runId,
    status: 'running',
    heartbeatAt: new Date('2026-06-13T01:02:30.000Z'),
  };
  const originals = {
    crawlRunFindById: CrawlRun.findById,
    crawlRunFindOneAndUpdate: CrawlRun.findOneAndUpdate,
    crawlRunLockFindById: CrawlRunLock.findById,
    crawlRunLockUpdateOne: CrawlRunLock.updateOne,
    offerUpdateMany: Offer.updateMany,
  };
  const runUpdates = [];
  const lockUpdates = [];
  const offerUpdates = [];

  _private.activeExecutionRunIds.set(String(runId), {
    runId,
    trigger: 'scheduled',
    startedAt,
  });
  CrawlRun.findById = async () => run;
  CrawlRun.findOneAndUpdate = async (filter, update, options) => {
    runUpdates.push({ filter, update, options });
    return { ...run, status: 'failed' };
  };
  CrawlRunLock.findById = () => ({
    lean: async () => lock,
  });
  CrawlRunLock.updateOne = async (filter, update) => {
    lockUpdates.push({ filter, update });
    return { matchedCount: 1, modifiedCount: 1 };
  };
  Offer.updateMany = async (filter, update) => {
    offerUpdates.push({ filter, update });
    return { matchedCount: 0, modifiedCount: 0 };
  };

  try {
    const result = await interruptCurrentProcessCrawlRuns({
      reason: 'test shutdown',
      signal: 'SIGTERM',
      now,
    });

    assert.equal(result.interrupted.length, 1);
    assert.equal(result.interrupted[0].runId, String(runId));
  } finally {
    CrawlRun.findById = originals.crawlRunFindById;
    CrawlRun.findOneAndUpdate = originals.crawlRunFindOneAndUpdate;
    CrawlRunLock.findById = originals.crawlRunLockFindById;
    CrawlRunLock.updateOne = originals.crawlRunLockUpdateOne;
    Offer.updateMany = originals.offerUpdateMany;
    _private.activeExecutionRunIds.clear();
  }

  assert.equal(runUpdates.length, 1);
  assert.deepEqual(runUpdates[0].filter, {
    _id: runId,
    status: { $in: ['queued', 'running'] },
  });
  assert.equal(runUpdates[0].update.$set.status, 'failed');
  assert.equal(runUpdates[0].update.$set.finishedAt, now);
  assert.equal(runUpdates[0].update.$set.durationMs, 180000);
  assert.equal(runUpdates[0].update.$set['metadata.shutdown'].signal, 'SIGTERM');
  assert.equal(runUpdates[0].update.$set['metadata.progress'].stage, 'process-shutdown');
  assert.equal(runUpdates[0].update.$set['metadata.progress'].runStatus, 'failed');
  assert.match(runUpdates[0].update.$push.warnings, /process shutdown/i);
  assert.equal(offerUpdates.length, 1);
  assert.equal(offerUpdates[0].update.$set.publishStatus, 'crawl-run-failed');
  assert.ok(lockUpdates.some((call) => call.update?.$set?.status === 'released'));
  assert.equal(_private.activeExecutionRunIds.size, 0);
});

test('releaseRecoverableCrawlRunLock can release orphaned active global lock without runId', async () => {
  const runId = new mongoose.Types.ObjectId();
  const originals = {
    crawlRunLockUpdateOne: CrawlRunLock.updateOne,
  };
  const lockUpdates = [];

  CrawlRunLock.updateOne = async (filter, update) => {
    lockUpdates.push({ filter, update });
    return { matchedCount: 1, modifiedCount: 1 };
  };

  try {
    const result = await _private.releaseRecoverableCrawlRunLock(runId, {
      runId: null,
      status: 'running',
      heartbeatAt: new Date('2026-05-10T12:00:00.000Z'),
    });

    assert.equal(result.modifiedCount, 1);
  } finally {
    CrawlRunLock.updateOne = originals.crawlRunLockUpdateOne;
  }

  assert.deepEqual(lockUpdates[0].filter.$or, [
    { runId: null },
    { runId: { $exists: false } },
  ]);
  assert.equal(lockUpdates[0].update.$set.status, 'released');
  assert.equal(lockUpdates[0].update.$set.runId, null);
});

test('recoverInterruptedCrawlRunsAfterRestart leaves fresh active runs and current heartbeats untouched', async () => {
  const { recoverInterruptedCrawlRunsAfterRestart } = require('../src/services/crawl/crawlRunService');
  const runId = new mongoose.Types.ObjectId();
  const now = new Date(_private.PROCESS_STARTED_AT.getTime() + 30 * 60 * 1000);
  const originals = {
    crawlRunFind: CrawlRun.find,
    crawlRunFindOneAndUpdate: CrawlRun.findOneAndUpdate,
    crawlRunLockFindById: CrawlRunLock.findById,
    crawlRunLockUpdateOne: CrawlRunLock.updateOne,
    offerUpdateMany: Offer.updateMany,
  };
  let updateCalled = false;

  CrawlRun.find = () => ({
    sort() {
      return [{
        _id: runId,
        status: 'running',
        startedAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 60 * 1000),
      }];
    },
  });
  CrawlRun.findOneAndUpdate = async () => {
    updateCalled = true;
    return null;
  };
  CrawlRunLock.findById = () => ({
    lean: async () => ({
      runId,
      status: 'running',
      heartbeatAt: new Date(_private.PROCESS_STARTED_AT.getTime() + 60 * 1000),
    }),
  });
  CrawlRunLock.updateOne = async () => {
    updateCalled = true;
    return { modifiedCount: 0 };
  };
  Offer.updateMany = async () => {
    updateCalled = true;
    return { matchedCount: 0, modifiedCount: 0 };
  };

  try {
    const result = await recoverInterruptedCrawlRunsAfterRestart({
      now,
      staleAfterMs: 60 * 60 * 1000,
    });

    assert.equal(result.recovered.length, 0);
    assert.equal(result.skipped[0].reason, 'lock-heartbeat-in-current-process');
    assert.equal(updateCalled, false);
  } finally {
    CrawlRun.find = originals.crawlRunFind;
    CrawlRun.findOneAndUpdate = originals.crawlRunFindOneAndUpdate;
    CrawlRunLock.findById = originals.crawlRunLockFindById;
    CrawlRunLock.updateOne = originals.crawlRunLockUpdateOne;
    Offer.updateMany = originals.offerUpdateMany;
  }
});

test('recoverInterruptedCrawlRunsAfterRestart does not alter terminal runs returned by a stale read', async () => {
  const { recoverInterruptedCrawlRunsAfterRestart } = require('../src/services/crawl/crawlRunService');
  const runId = new mongoose.Types.ObjectId();
  const now = new Date(_private.PROCESS_STARTED_AT.getTime() + 2 * 60 * 60 * 1000);
  const originals = {
    crawlRunFind: CrawlRun.find,
    crawlRunFindOneAndUpdate: CrawlRun.findOneAndUpdate,
    crawlRunLockFindById: CrawlRunLock.findById,
    crawlRunLockUpdateOne: CrawlRunLock.updateOne,
    offerUpdateMany: Offer.updateMany,
  };
  let updateCalled = false;

  CrawlRun.find = () => ({
    sort() {
      return [{
        _id: runId,
        status: 'success',
        startedAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 2 * 60 * 1000),
      }];
    },
  });
  CrawlRun.findOneAndUpdate = async () => {
    updateCalled = true;
    return null;
  };
  CrawlRunLock.findById = () => ({
    lean: async () => ({
      runId,
      status: 'running',
      heartbeatAt: new Date(_private.PROCESS_STARTED_AT.getTime() - 60 * 1000),
    }),
  });
  CrawlRunLock.updateOne = async () => {
    updateCalled = true;
    return { modifiedCount: 0 };
  };
  Offer.updateMany = async () => {
    updateCalled = true;
    return { matchedCount: 0, modifiedCount: 0 };
  };

  try {
    const result = await recoverInterruptedCrawlRunsAfterRestart({
      now,
      staleAfterMs: 15 * 60 * 1000,
    });

    assert.equal(result.recovered.length, 0);
    assert.equal(result.skipped[0].reason, 'not-active');
    assert.equal(updateCalled, false);
  } finally {
    CrawlRun.find = originals.crawlRunFind;
    CrawlRun.findOneAndUpdate = originals.crawlRunFindOneAndUpdate;
    CrawlRunLock.findById = originals.crawlRunLockFindById;
    CrawlRunLock.updateOne = originals.crawlRunLockUpdateOne;
    Offer.updateMany = originals.offerUpdateMany;
  }
});

test('markOfferPublishStatusForRun marks stale and failed run lineage without changing visibility fields', async () => {
  const calls = [];
  const invalidations = [];
  const runId = new mongoose.Types.ObjectId();
  const now = new Date('2026-05-21T12:00:00.000Z');
  const OfferModel = {
    async updateMany(filter, update) {
      calls.push({ filter, update });
      return { matchedCount: 3, modifiedCount: 3 };
    },
  };

  const result = await _private.markOfferPublishStatusForRun({
    runId,
    runStatus: 'stale',
    OfferModel,
    now,
    invalidatePublicReadCachesImpl: (metadata) => invalidations.push(metadata),
  });

  assert.equal(result.modifiedCount, 3);
  assert.deepEqual(calls[0].filter, { crawlRunId: runId });
  assert.equal(calls[0].update.$set.publishStatus, 'crawl-run-stale');
  assert.equal(calls[0].update.$set.publishStatusUpdatedAt, now);
  assert.equal(calls[0].update.$set.status, undefined);
  assert.equal(calls[0].update.$set.isActiveNow, undefined);
  assert.equal(calls[0].update.$set.isActiveToday, undefined);
  assert.deepEqual(invalidations, [{
    runId,
    runStatus: 'stale',
    publishStatus: 'crawl-run-stale',
  }]);
});

test('executeCrawlRun starts periodic lock heartbeat and stops it after completion', async () => {
  const runId = new mongoose.Types.ObjectId();
  const originals = {
    crawlRunFindByIdAndUpdate: CrawlRun.findByIdAndUpdate,
    crawlRunFindById: CrawlRun.findById,
    crawlRunLockUpdateOne: CrawlRunLock.updateOne,
    offerUpdateMany: Offer.updateMany,
  };
  const lockUpdates = [];

  CrawlRunLock.updateOne = async (filter, update) => {
    lockUpdates.push({ filter, update, at: Date.now() });
    return { matchedCount: 1, modifiedCount: 1 };
  };
  CrawlRun.findByIdAndUpdate = async () => ({ modifiedCount: 1 });
  CrawlRun.findById = async () => ({ _id: runId, mode: 'scoped' });
  Offer.updateMany = async () => ({ matchedCount: 1, modifiedCount: 1 });

  try {
    await executeCrawlRun({
      runId,
      trigger: 'scheduled',
      region: 'Steiermark',
      heartbeatIntervalMs: 10,
      crawlAllSourcesImpl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 35));
        return {
          sources: [
            {
              sourceId: 'source-1',
              sourceKey: 'bipa-official',
              retailerKey: 'bipa',
              channel: 'official-site',
              sourceType: 'offers-page',
              status: 'success',
              foundRawItems: 1,
              parsedOffers: 1,
              offersStored: 1,
            },
          ],
          matchedSources: [
            { sourceId: 'source-1', sourceKey: 'bipa-official', retailerKey: 'bipa', channel: 'official-site', sourceType: 'offers-page' },
          ],
          sourceCoverage: { activeEligibleSources: 1 },
          filterMetadata: { ok: true },
        };
      },
    });

    const heartbeatUpdatesAtCompletion = lockUpdates.filter((call) => call.update?.$set?.heartbeatAt && !call.update.$set.status).length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const heartbeatUpdatesAfterStop = lockUpdates.filter((call) => call.update?.$set?.heartbeatAt && !call.update.$set.status).length;

    assert.ok(heartbeatUpdatesAtCompletion >= 1);
    assert.equal(heartbeatUpdatesAfterStop, heartbeatUpdatesAtCompletion);
    assert.ok(lockUpdates.some((call) => call.update?.$set?.owner === _private.buildLockOwner('scheduled')));
    assert.ok(lockUpdates.some((call) => call.update?.$set?.status === 'released'));
  } finally {
    CrawlRun.findByIdAndUpdate = originals.crawlRunFindByIdAndUpdate;
    CrawlRun.findById = originals.crawlRunFindById;
    CrawlRunLock.updateOne = originals.crawlRunLockUpdateOne;
    Offer.updateMany = originals.offerUpdateMany;
  }
});

test('executeCrawlRun passes the top-level crawlRunId into source crawling and marks successful publish lineage', async () => {
  const runId = new mongoose.Types.ObjectId();
  const originals = {
    crawlRunFindByIdAndUpdate: CrawlRun.findByIdAndUpdate,
    crawlRunFindById: CrawlRun.findById,
    crawlRunLockUpdateOne: CrawlRunLock.updateOne,
    offerUpdateMany: Offer.updateMany,
  };
  const offerUpdates = [];
  const runUpdates = [];
  let receivedCrawlArgs = null;

  CrawlRunLock.updateOne = async () => ({ modifiedCount: 1 });
  CrawlRun.findByIdAndUpdate = async (id, update) => {
    runUpdates.push({ id, update });
    return { modifiedCount: 1 };
  };
  CrawlRun.findById = async () => ({ _id: runId, mode: 'scoped' });
  Offer.updateMany = async (filter, update) => {
    offerUpdates.push({ filter, update });
    return { matchedCount: 2, modifiedCount: 2 };
  };

  try {
    await executeCrawlRun({
      runId,
      trigger: 'manual',
      region: 'Steiermark',
      options: { sourceKeys: ['bipa-official'] },
      crawlAllSourcesImpl: async (args) => {
        receivedCrawlArgs = args;
        await args.onProgress({ stage: 'dedupe-started', apiKey: 'nope' });
        return {
          sources: [
            {
              sourceId: 'source-1',
              sourceKey: 'bipa-official',
              retailerKey: 'bipa',
              channel: 'official-site',
              sourceType: 'offers-page',
              status: 'success',
              foundRawItems: 2,
              parsedOffers: 2,
              offersStored: 2,
            },
          ],
          matchedSources: [
            { sourceId: 'source-1', sourceKey: 'bipa-official', retailerKey: 'bipa', channel: 'official-site', sourceType: 'offers-page' },
          ],
          sourceCoverage: { activeEligibleSources: 1 },
          filterMetadata: { ok: true },
        };
      },
    });
  } finally {
    CrawlRun.findByIdAndUpdate = originals.crawlRunFindByIdAndUpdate;
    CrawlRun.findById = originals.crawlRunFindById;
    CrawlRunLock.updateOne = originals.crawlRunLockUpdateOne;
    Offer.updateMany = originals.offerUpdateMany;
  }

  assert.equal(receivedCrawlArgs.crawlRunId, runId);
  assert.equal(receivedCrawlArgs.region, 'Steiermark');
  assert.equal(receivedCrawlArgs.trigger, 'manual');
  assert.deepEqual(receivedCrawlArgs.sourceKeys, ['bipa-official']);
  const progressUpdate = runUpdates.find((call) => call.update?.$set?.['metadata.progress']);
  assert.equal(progressUpdate.update.$set['metadata.progress'].stage, 'dedupe-started');
  assert.equal(progressUpdate.update.$set['metadata.progress'].apiKey, '[redacted]');
  assert.match(progressUpdate.update.$set['metadata.progress'].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  const publishStartedUpdate = runUpdates.find((call) =>
    call.update?.$set?.['metadata.progress']?.stage === 'publish-status-started'
  );
  const publishFinishedUpdate = runUpdates.find((call) =>
    call.update?.$set?.['metadata.progress']?.stage === 'publish-status-finished'
  );
  assert.equal(publishStartedUpdate.update.$set['metadata.progress'].runStatus, 'success');
  assert.equal(publishFinishedUpdate.update.$set['metadata.progress'].runStatus, 'success');
  assert.equal(publishFinishedUpdate.update.$set['metadata.progress'].matchedCount, 2);
  assert.equal(publishFinishedUpdate.update.$set['metadata.progress'].modifiedCount, 2);
  assert.equal(offerUpdates.length, 1);
  assert.deepEqual(offerUpdates[0].filter, { crawlRunId: runId });
  assert.equal(offerUpdates[0].update.$set.publishStatus, 'crawl-run-success');
  assert.ok(offerUpdates[0].update.$set.publishStatusUpdatedAt instanceof Date);
});

test('executeCrawlRun marks timed-out runs failed and releases the global lock', async () => {
  const runId = new mongoose.Types.ObjectId();
  const originals = {
    crawlRunFindByIdAndUpdate: CrawlRun.findByIdAndUpdate,
    crawlRunFindById: CrawlRun.findById,
    crawlRunLockUpdateOne: CrawlRunLock.updateOne,
    offerUpdateMany: Offer.updateMany,
  };
  const runUpdates = [];
  const lockUpdates = [];
  const offerUpdates = [];

  CrawlRunLock.updateOne = async (filter, update) => {
    lockUpdates.push({ filter, update });
    return { modifiedCount: 1 };
  };
  CrawlRun.findByIdAndUpdate = async (id, update) => {
    runUpdates.push({ id, update });
    return { modifiedCount: 1 };
  };
  CrawlRun.findById = async () => ({ _id: runId, mode: 'full' });
  Offer.updateMany = async (filter, update) => {
    offerUpdates.push({ filter, update });
    return { matchedCount: 0, modifiedCount: 0 };
  };

  try {
    await executeCrawlRun({
      runId,
      trigger: 'scheduled',
      region: 'AT',
      maxRuntimeMs: 20,
      crawlAllSourcesImpl: async () => new Promise(() => {}),
    });
  } finally {
    CrawlRun.findByIdAndUpdate = originals.crawlRunFindByIdAndUpdate;
    CrawlRun.findById = originals.crawlRunFindById;
    CrawlRunLock.updateOne = originals.crawlRunLockUpdateOne;
    Offer.updateMany = originals.offerUpdateMany;
  }

  const failedUpdate = runUpdates.find((call) => call.update?.$set?.status === 'failed');

  assert.ok(failedUpdate);
  assert.match(failedUpdate.update.$set.errorMessages[0], /maximum runtime/i);
  assert.equal(failedUpdate.update.$set['metadata.timeout'].timeoutMs, 20);
  assert.ok(runUpdates.some((call) =>
    call.update?.$set?.['metadata.progress']?.stage === 'publish-status-started'
    && call.update.$set['metadata.progress'].runStatus === 'failed'
  ));
  assert.ok(runUpdates.some((call) =>
    call.update?.$set?.['metadata.progress']?.stage === 'publish-status-finished'
    && call.update.$set['metadata.progress'].runStatus === 'failed'
  ));
  assert.equal(offerUpdates.length, 1);
  assert.equal(offerUpdates[0].update.$set.publishStatus, 'crawl-run-failed');
  assert.ok(lockUpdates.some((call) => call.update?.$set?.status === 'released'));
});

test('executeCrawlRun finalizes partial publish when one source timed out but crawl continues', async () => {
  const runId = new mongoose.Types.ObjectId();
  const originals = {
    crawlRunFindByIdAndUpdate: CrawlRun.findByIdAndUpdate,
    crawlRunFindById: CrawlRun.findById,
    crawlRunLockUpdateOne: CrawlRunLock.updateOne,
    offerUpdateMany: Offer.updateMany,
  };
  const runUpdates = [];
  const lockUpdates = [];
  const offerUpdates = [];

  CrawlRunLock.updateOne = async (filter, update) => {
    lockUpdates.push({ filter, update });
    return { modifiedCount: 1 };
  };
  CrawlRun.findByIdAndUpdate = async (id, update) => {
    runUpdates.push({ id, update });
    return { modifiedCount: 1 };
  };
  CrawlRun.findById = async () => ({ _id: runId, mode: 'full' });
  Offer.updateMany = async (filter, update) => {
    offerUpdates.push({ filter, update });
    return { matchedCount: 4, modifiedCount: 4 };
  };

  try {
    await executeCrawlRun({
      runId,
      trigger: 'scheduled',
      region: 'AT',
      crawlAllSourcesImpl: async () => ({
        sources: [
          {
            sourceId: 'source-timeout',
            sourceKey: 'billa-plus-official-site',
            retailerKey: 'billa-plus',
            channel: 'official-site',
            sourceType: 'offers-page',
            status: 'failed',
            error: 'Crawl source timed out after 600000ms: billa-plus-official-site',
            failureStage: 'source-timeout',
          },
          {
            sourceId: 'source-ok',
            sourceKey: 'billa-official-site',
            retailerKey: 'billa',
            channel: 'official-site',
            sourceType: 'offers-page',
            status: 'success',
            foundRawItems: 1,
            parsedOffers: 1,
            offersStored: 1,
          },
        ],
        matchedSources: [
          { sourceId: 'source-timeout', sourceKey: 'billa-plus-official-site', retailerKey: 'billa-plus', channel: 'official-site', sourceType: 'offers-page' },
          { sourceId: 'source-ok', sourceKey: 'billa-official-site', retailerKey: 'billa', channel: 'official-site', sourceType: 'offers-page' },
        ],
        sourceCoverage: { activeEligibleSources: 2 },
        filterMetadata: { ok: true },
      }),
    });
  } finally {
    CrawlRun.findByIdAndUpdate = originals.crawlRunFindByIdAndUpdate;
    CrawlRun.findById = originals.crawlRunFindById;
    CrawlRunLock.updateOne = originals.crawlRunLockUpdateOne;
    Offer.updateMany = originals.offerUpdateMany;
  }

  const partialUpdate = runUpdates.find((call) => call.update?.$set?.status === 'partial');

  assert.ok(partialUpdate);
  assert.equal(partialUpdate.update.$set.summary.failedSourcesCount, 1);
  assert.equal(partialUpdate.update.$set.result.sources[0].failureStage, 'source-timeout');
  assert.ok(runUpdates.some((call) =>
    call.update?.$set?.['metadata.progress']?.stage === 'publish-status-finished'
    && call.update.$set['metadata.progress'].runStatus === 'partial'
  ));
  assert.equal(offerUpdates.length, 1);
  assert.equal(offerUpdates[0].update.$set.publishStatus, 'crawl-run-partial');
  assert.ok(lockUpdates.some((call) => call.update?.$set?.status === 'released'));
});
