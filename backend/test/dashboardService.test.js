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

test('dashboard diagnostics still count stale retained Aggregator offers for investigation', () => {
  const result = _private.buildOfferDiagnostics([
    {
      retailerKey: 'billa',
      retailerName: 'BILLA',
      sourceType: 'aktionsfinder-json',
      sourceTypes: ['aktionsfinder-json', 'aggregator'],
      sourceUrl: 'https://www.aktionsfinder.at/ppcv/pizza/billa/',
      status: 'active',
      isActiveNow: true,
      publishStatus: 'crawl-run-stale',
      validTo: null,
      priceCurrent: { amount: 2.99 },
      quantityText: '1 Stk',
    },
  ]);

  assert.equal(result.offerSummary.activeOffers, 1);
  assert.equal(result.offerSummary.aggregatorOffers, 1);
  assert.equal(result.offerSummary.aggregatorRiskOffers, 1);
  assert.equal(result.publishStatusSummary.statuses[0].status, 'crawl-run-stale');
});

test('dashboard publish status summary classifies final and open aggregate rows', () => {
  const summary = _private.buildPublishStatusSummaryFromRows([
    { status: 'crawl-run-success', count: 8 },
    { status: 'source-written', count: 2 },
    { status: null, count: 1 },
  ]);

  assert.equal(summary.totalActiveOffers, 11);
  assert.equal(summary.finalCount, 9);
  assert.equal(summary.openCount, 2);
  assert.equal(summary.status, 'open');
  assert.equal(summary.statuses.find((row) => row.status === 'crawl-run-success').final, true);
  assert.equal(summary.statuses.find((row) => row.status === 'source-written').intermediate, true);
  assert.equal(summary.statuses.find((row) => row.status === 'unknown').final, false);
  assert.equal(summary.statuses.find((row) => row.status === 'unknown').intermediate, false);
});

test('dashboard aggregate diagnostics build offer KPIs without loading offer documents', () => {
  const result = _private.buildOfferDiagnosticsFromAggregateResult({
    summary: [{
      activeOffers: 10,
      officialOffers: 4,
      aggregatorOffers: 6,
      safeValidityOffers: 7,
      missingValidToOffers: 3,
      conditionOffers: 5,
      comparisonSafeOffers: 8,
      imageOffers: 9,
      aggregatorRiskOffers: 2,
    }],
    retailerMatrix: [
      {
        retailerKey: 'spar',
        retailerName: 'SPAR',
        activeOffers: 6,
        officialOffers: 3,
        aggregatorOffers: 3,
        safeValidityOffers: 4,
        missingValidToOffers: 2,
        conditionOffers: 4,
        comparisonSafeOffers: 5,
        imageOffers: 5,
        aggregatorRiskOffers: 1,
      },
    ],
    sourceTypeSummary: [{ sourceType: 'spar-official-pdf', count: 4 }],
    publishStatusSummary: [
      { status: 'crawl-run-partial', count: 8 },
      { status: 'source-written', count: 2 },
    ],
  });

  assert.equal(result.offerSummary.activeOffers, 10);
  assert.equal(result.offerSummary.officialCoverageRate, 0.4);
  assert.equal(result.offerSummary.validityConfidenceRate, 0.7);
  assert.equal(result.offerSummary.conditionDetectionRate, 0.5);
  assert.equal(result.offerSummary.comparisonSafetyRate, 0.8);
  assert.equal(result.offerSummary.imageCoverageRate, 0.9);
  assert.equal(result.offerSummary.aggregatorRiskRate, 0.2);
  assert.equal(result.publishStatusSummary.status, 'open');
  assert.equal(result.publishStatusSummary.finalCount, 8);
  assert.equal(result.publishStatusSummary.openCount, 2);
  assert.equal(result.retailerMatrix[0].retailerKey, 'spar');
  assert.equal(result.sourceTypeSummary[0].sourceType, 'spar-official-pdf');
});

test('dashboard unavailable offer diagnostics preserve unknown values instead of false zeroes', () => {
  const diagnostics = _private.buildUnavailableOfferDiagnostics('query timed out');
  const kpis = _private.buildQualityKpis(diagnostics.offerSummary);

  assert.equal(diagnostics.offerSummary.activeOffers, null);
  assert.equal(diagnostics.offerSummary.officialCoverageRate, null);
  assert.equal(diagnostics.publishStatusSummary.status, 'unknown');
  assert.equal(diagnostics.publishStatusSummary.totalActiveOffers, null);
  assert.equal(kpis[0].value, null);
  assert.equal(kpis[0].denominator, null);
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

test('dashboard crawl reliability separates scheduled stale from current free terminal manual crawl', () => {
  const latestManualFull = {
    id: 'manual-full-1',
    status: 'partial',
    trigger: 'manual',
    mode: 'full',
    dryRun: false,
    startedAt: '2026-06-02T07:46:53.003Z',
    finishedAt: '2026-06-02T08:05:35.848Z',
    durationMs: 1122845,
    lastStage: 'publish-status-finished',
    publishStatusFinished: true,
    publishMatchedCount: 2904,
    publishModifiedCount: 2904,
    summary: {
      successfulSourcesCount: 14,
      failedSourcesCount: 11,
    },
    sources: [
      {
        sourceKey: 'aktionsfinder-spar',
        sourceType: 'aggregator',
        channel: 'aggregator',
        status: 'failed',
        failureStage: 'fetch',
        error: 'Request failed with status code 404',
      },
      {
        sourceKey: 'spar-official-flyer-pdf',
        sourceType: 'pdf',
        channel: 'official-flyer',
        status: 'skipped',
        skippedReason: 'full-crawl-scoped-only-source',
        failureStage: 'source-bounded-before-execution',
        diagnostic: {
          boundedReason: 'full-crawl-scoped-only-source',
          notExecutedByPolicy: true,
        },
      },
    ],
  };

  const reliability = _private.buildCrawlReliabilityStatus({
    latestScheduledFullCrawl: {
      id: 'scheduled-full-1',
      status: 'stale',
      trigger: 'scheduled',
      mode: 'full',
      dryRun: false,
      startedAt: '2026-06-01T23:00:00.077Z',
      finishedAt: '2026-06-02T02:03:24.358Z',
    },
    latestCrawl: latestManualFull,
    crawlHistory: [latestManualFull],
    activeCrawlRun: null,
    lockStatus: {
      state: 'free',
      isBlocked: false,
      reason: 'Globaler Crawl-Lock ist frei.',
    },
  });

  assert.equal(reliability.scheduledDaily.level, 'red');
  assert.equal(reliability.scheduledDaily.status, 'stale');
  assert.equal(reliability.currentCrawlSystem.level, 'green');
  assert.equal(reliability.currentCrawlSystem.lockFree, true);
  assert.equal(reliability.currentCrawlSystem.activeRunBlocked, false);
  assert.equal(reliability.currentCrawlSystem.latestManualFullCrawl.status, 'partial');
  assert.equal(reliability.currentCrawlSystem.latestManualFullCrawl.terminal, true);
  assert.equal(reliability.currentCrawlSystem.latestManualFullCrawl.publishStatusFinished, true);
  assert.equal(reliability.currentCrawlSystem.finalizationLockBlocker, 'green');
  assert.equal(reliability.currentCrawlSystem.awaitingNextScheduledDailyConfirmation, true);
  assert.equal(reliability.sourceFailures.level, 'yellow');
  assert.equal(reliability.sourceFailures.p0ReliabilityCount, 0);
  assert.equal(reliability.sourceFailures.p1SourceCoverageCount, 1);
  assert.equal(reliability.sourceFailures.failedSourcesCount, 1);
  assert.equal(reliability.sourceFailures.policyBoundedSourcesCount, 1);
  assert.equal(reliability.sourceFailures.notExecutedByPolicySourcesCount, 1);
  assert.equal(reliability.sourceFailures.groups[0].errorType, 'http-404');
  assert.equal(reliability.sourceFailures.groups[0].classification, 'P1 Source/Coverage');
  assert.equal(reliability.sourceFailures.policyBoundedGroups[0].classification, 'notExecutedByPolicy');
});

test('dashboard crawl reliability treats final publish status as current system proof', () => {
  const latestScopedCrawl = {
    id: 'scoped-1',
    status: 'success',
    trigger: 'manual',
    mode: 'scoped',
    dryRun: false,
    startedAt: '2026-06-06T13:03:24.629Z',
    finishedAt: '2026-06-06T13:03:55.072Z',
    lastStage: 'publish-status-finished',
    publishStatusFinished: true,
    summary: {
      successfulSourcesCount: 1,
      failedSourcesCount: 0,
    },
    sources: [
      {
        sourceKey: 'penny-official-site',
        sourceType: 'offers-page',
        channel: 'official-site',
        status: 'success',
      },
    ],
  };

  const reliability = _private.buildCrawlReliabilityStatus({
    latestScheduledFullCrawl: {
      id: 'scheduled-full-1',
      status: 'partial',
      trigger: 'scheduled',
      mode: 'full',
      dryRun: false,
      startedAt: '2026-06-05T23:00:00.112Z',
      finishedAt: '2026-06-05T23:06:24.422Z',
    },
    latestCrawl: latestScopedCrawl,
    crawlHistory: [latestScopedCrawl],
    activeCrawlRun: null,
    lockStatus: {
      state: 'free',
      isBlocked: false,
      reason: 'Globaler Crawl-Lock ist frei.',
    },
    publishStatusSummary: {
      status: 'final',
      openCount: 0,
    },
  });

  assert.equal(reliability.currentCrawlSystem.level, 'green');
  assert.equal(reliability.currentCrawlSystem.lockFree, true);
  assert.equal(reliability.currentCrawlSystem.activeRunBlocked, false);
  assert.equal(reliability.currentCrawlSystem.latestManualFullCrawl, null);
  assert.equal(reliability.currentCrawlSystem.finalizationLockBlocker, 'green');
  assert.match(reliability.currentCrawlSystem.reason, /publish status is final/i);
  assert.equal(reliability.sourceFailures.level, 'green');
});

test('dashboard classifies source-less process restart recovery as P0 runtime reliability', () => {
  const latestScheduledFullCrawl = {
    id: 'scheduled-restart-1',
    status: 'failed',
    trigger: 'scheduled',
    mode: 'full',
    dryRun: false,
    startedAt: '2026-06-14T23:00:00.064Z',
    finishedAt: '2026-06-14T23:15:44.000Z',
    lastStage: 'process-restart-recovery',
    warnings: [
      'Stale CrawlRun recovery after restart: Scheduler periodic recovery found an active CrawlRun from a previous process with a stale lock heartbeat.',
    ],
    summary: {
      successfulSourcesCount: 0,
      failedSourcesCount: 0,
    },
    sources: [],
  };

  const reliability = _private.buildCrawlReliabilityStatus({
    latestScheduledFullCrawl,
    latestCrawl: {
      id: 'scoped-success-1',
      status: 'success',
      trigger: 'manual',
      mode: 'scoped',
      dryRun: false,
      finishedAt: '2026-06-14T10:03:55.072Z',
    },
    crawlHistory: [],
    activeCrawlRun: null,
    lockStatus: {
      state: 'free',
      isBlocked: false,
    },
    publishStatusSummary: {
      status: 'final',
      openCount: 0,
    },
  });

  assert.equal(reliability.scheduledDaily.level, 'red');
  assert.equal(reliability.currentCrawlSystem.level, 'green');
  assert.equal(reliability.sourceFailures.level, 'red');
  assert.equal(reliability.sourceFailures.failedSourcesCount, 0);
  assert.equal(reliability.sourceFailures.p0ReliabilityCount, 1);
  assert.equal(reliability.sourceFailures.p1SourceCoverageCount, 0);
  assert.equal(reliability.sourceFailures.groups[0].classification, 'P0 Crawl Runtime');
});

test('dashboard crawl reliability stays red when publish status is open without final crawl proof', () => {
  const reliability = _private.buildCrawlReliabilityStatus({
    latestScheduledFullCrawl: null,
    latestCrawl: {
      id: 'scoped-open-1',
      status: 'success',
      trigger: 'manual',
      mode: 'scoped',
      dryRun: false,
      finishedAt: '2026-06-06T13:03:55.072Z',
    },
    crawlHistory: [],
    activeCrawlRun: null,
    lockStatus: {
      state: 'free',
      isBlocked: false,
    },
    publishStatusSummary: {
      status: 'open',
      openCount: 12,
    },
  });

  assert.equal(reliability.currentCrawlSystem.level, 'red');
  assert.equal(reliability.currentCrawlSystem.finalizationLockBlocker, 'needs-attention');
  assert.match(reliability.currentCrawlSystem.reason, /lacks final publish-state evidence/i);
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

test('dashboard feedback summary handles empty feedback data', () => {
  const summary = _private.buildFeedbackSummaryFromDocuments([], {
    now: new Date('2026-06-01T12:00:00.000Z'),
    totalFeedback: 0,
  });

  assert.equal(summary.totalFeedback, 0);
  assert.equal(summary.newToday, 0);
  assert.equal(summary.newLast24h, 0);
  assert.equal(summary.newLast7Days, 0);
  assert.equal(summary.newLast30Days, 0);
  assert.deepEqual(summary.feedbackByStatus, []);
  assert.deepEqual(summary.latestFeedback, []);
  assert.ok(summary.feedbackDataWarnings.some((warning) => /historische Feedback-Tage/i.test(warning)));
});

test('dashboard feedback summary counts today, rolling windows, status and categories', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');
  const docs = [
    {
      _id: 'feedback-1',
      createdAt: new Date('2026-06-01T10:00:00.000Z'),
      updatedAt: new Date('2026-06-01T10:01:00.000Z'),
      type: 'offer_feedback',
      status: 'new',
      reasons: ['price_wrong', 'image_wrong'],
      offerRef: { offerId: 'offer-1' },
      offerSnapshot: {
        title: 'Spar Kaffee',
        retailerKey: 'spar',
        retailerLabel: 'SPAR',
      },
      pageContext: {
        query: 'kaffee',
        path: '/suche',
        url: 'https://www.kaufklug.at/suche?q=kaffee&secret=not-returned',
      },
      freeText: 'x'.repeat(500),
      clientContext: {
        userAgent: 'not-returned',
        sessionIdHash: 'not-returned',
      },
    },
    {
      _id: 'feedback-2',
      createdAt: new Date('2026-05-29T10:00:00.000Z'),
      status: 'resolved',
      reasons: ['category_wrong'],
      offerRef: { offerId: 'offer-1' },
      offerSnapshot: {
        title: 'Spar Kaffee',
        retailerKey: 'spar',
        retailerLabel: 'SPAR',
      },
      structuredDetails: {
        category_wrong: {
          userNote: 'Ist Kaffee.',
        },
      },
    },
    {
      _id: 'feedback-3',
      createdAt: new Date('2026-05-10T10:00:00.000Z'),
      status: 'ignored',
      reasons: ['other'],
      offerRef: { offerId: 'offer-2' },
      offerSnapshot: {
        title: 'Billa Milch',
        retailerKey: 'billa',
        retailerLabel: 'BILLA',
      },
    },
    {
      _id: 'feedback-4',
      createdAt: new Date('2026-04-01T10:00:00.000Z'),
      status: 'reviewing',
      reasons: ['condition_wrong'],
      offerSnapshot: {},
    },
  ];

  const summary = _private.buildFeedbackSummaryFromDocuments(docs, { now });

  assert.equal(summary.totalFeedback, 4);
  assert.equal(summary.newToday, 1);
  assert.equal(summary.newLast24h, 1);
  assert.equal(summary.newLast7Days, 2);
  assert.equal(summary.newLast30Days, 3);
  assert.equal(summary.openFeedback, 2);
  assert.equal(summary.resolvedFeedback, 2);
  assert.deepEqual(summary.feedbackByStatus.find((row) => row.status === 'new'), { status: 'new', count: 1 });
  assert.deepEqual(summary.feedbackByType.find((row) => row.type === 'price_wrong'), { type: 'price_wrong', count: 1 });
  assert.equal(summary.feedbackByRetailer[0].retailerKey, 'spar');
  assert.equal(summary.feedbackByOffer[0].offerId, 'offer-1');
  assert.equal(summary.feedbackByOffer[0].count, 2);
  assert.equal(summary.dailyFeedbackTrend.length, 30);
  assert.equal(summary.dailyFeedbackTrend.find((row) => row.date === '2026-06-01').count, 1);
  assert.equal(summary.latestFeedback.length, 4);
  assert.equal(summary.latestFeedback[0].snippet.length <= 180, true);
  assert.equal(JSON.stringify(summary).includes('not-returned'), false);
  assert.equal(JSON.stringify(summary).includes('secret=not-returned'), false);
});

test('dashboard feedback summary handles missing optional fields as unknown or empty', () => {
  const summary = _private.buildFeedbackSummaryFromDocuments([
    {
      _id: 'feedback-unknown',
      createdAt: new Date('2026-06-01T10:00:00.000Z'),
      offerSnapshot: {},
      pageContext: {},
    },
  ], {
    now: new Date('2026-06-01T12:00:00.000Z'),
  });

  assert.equal(summary.feedbackByStatus[0].status, 'unknown');
  assert.equal(summary.feedbackByType[0].type, 'unknown');
  assert.deepEqual(summary.feedbackByRetailer, []);
  assert.equal(summary.latestFeedback[0].status, 'unknown');
  assert.equal(summary.latestFeedback[0].primaryReason, 'unknown');
});

test('dashboard actionable issues include beta feedback signals only when data supports them', () => {
  const issues = _private.buildActionableIssues({
    latestCrawl: { status: 'success' },
    lockStatus: { isBlocked: false },
    publishStatusSummary: { openCount: 0 },
    retailerMatrix: [],
    offerSummary: {},
    feedbackSummary: {
      newLast24h: 2,
      openFeedback: 11,
      feedbackByRetailer: [{ retailerKey: 'spar', retailerLabel: 'SPAR', count: 4 }],
    },
  });

  assert.ok(issues.some((issue) => /Neue Beta-Feedbacks/i.test(issue.title)));
  assert.ok(issues.some((issue) => /Viele offene Feedbacks/i.test(issue.title)));
  assert.ok(issues.some((issue) => /SPAR/i.test(issue.title)));
});

test('dashboard analysis essence text contains required sections and feedback instruction', () => {
  const { analysisEssence, analysisEssenceText } = _private.buildAnalysisEssencePayload({
    generatedAt: '2026-06-01T12:00:00.000Z',
    buildInfo: { buildTime: '2026-06-01T11:59:00.000Z' },
    executiveStatus: { level: 'red', reason: 'Last scheduled full crawl is stale.' },
    crawlReliability: {
      scheduledDaily: {
        level: 'red',
        status: 'stale',
        runId: 'run-1',
        reason: 'Latest scheduled full crawl is stale.',
      },
      currentCrawlSystem: {
        level: 'green',
        lockState: 'free',
        lockFree: true,
        activeRunBlocked: false,
        finalizationLockBlocker: 'green',
        awaitingNextScheduledDailyConfirmation: true,
        reason: 'Current crawl system is not blocked.',
        latestManualFullCrawl: {
          id: 'run-2',
          status: 'partial',
          terminal: true,
          lastStage: 'publish-status-finished',
          publishStatusFinished: true,
          successfulSourcesCount: 14,
          failedSourcesCount: 11,
        },
      },
      sourceFailures: {
        level: 'yellow',
        failedSourcesCount: 11,
        p0ReliabilityCount: 0,
        p1SourceCoverageCount: 11,
        reason: 'Aggregator 404s are P1 Source/Coverage.',
      },
    },
    latestScheduledFullCrawl: {
      id: 'run-1',
      status: 'stale',
      trigger: 'scheduled',
      mode: 'full',
      dryRun: false,
      startedAt: '2026-06-01T00:00:00.000Z',
      finishedAt: '2026-06-01T13:47:00.000Z',
      durationMs: 49620000,
      summary: {
        successfulSourcesCount: 4,
        failedSourcesCount: 2,
        staleReason: 'heartbeat stale',
      },
      warnings: ['one warning'],
      errorMessages: ['one error'],
    },
    crawlHistory: [
      {
        id: 'run-1',
        status: 'stale',
        trigger: 'scheduled',
        mode: 'full',
        dryRun: false,
        startedAt: '2026-06-01T00:00:00.000Z',
        durationMs: 49620000,
      },
      {
        id: 'run-2',
        status: 'success',
        trigger: 'manual',
        mode: 'scoped',
        dryRun: false,
        startedAt: '2026-05-31T00:00:00.000Z',
        durationMs: 2000,
      },
    ],
    lockStatus: { state: 'free', isBlocked: false },
    publishStatusSummary: { status: 'open', finalCount: 10, openCount: 5 },
    offerSummary: {
      activeOffers: 15,
      officialOffers: 5,
      officialCoverageRate: 0.333,
      validityConfidenceRate: 0.2,
      missingValidToOffers: 12,
      conditionDetectionRate: 0.4,
      comparisonSafetyRate: 0.5,
      imageCoverageRate: 0.8,
      aggregatorRiskRate: 0.31,
    },
    qualityKpis: [{ key: 'officialCoverageRate' }],
    retailerMatrix: [
      {
        retailerKey: 'spar',
        retailerName: 'SPAR',
        activeOffers: 12,
        officialCoverageRate: 0.2,
        validityConfidenceRate: 0.3,
        conditionDetectionRate: 0.4,
        imageCoverageRate: 0.9,
        aggregatorOffers: 8,
        aggregatorRiskRate: 0.5,
        warningStatus: 'red',
      },
    ],
    trendSeries: [{ date: '2026-06-01', crawlStatus: 'stale' }],
    actionableIssues: [
      {
        severity: 'red',
        title: 'Letzter Crawl stale',
        detail: 'Daily Crawl Reliability pruefen.',
      },
    ],
    dataCompletenessWarnings: ['Trend data limited.'],
    feedbackSummary: {
      totalFeedback: 106,
      newToday: 1,
      newLast24h: 2,
      newLast7Days: 106,
      newLast30Days: 106,
      openFeedback: 106,
      resolvedFeedback: 0,
      feedbackByStatus: [{ status: 'new', count: 106 }],
      feedbackByType: [{ type: 'price_wrong', count: 12 }],
      feedbackByRetailer: [{ retailerKey: 'spar', retailerLabel: 'SPAR', count: 8 }],
      feedbackByOffer: [{ offerId: 'offer-1', retailerKey: 'spar', retailerLabel: 'SPAR', count: 3, reasons: ['price_wrong'] }],
      latestFeedback: [
        {
          createdAt: '2026-06-01T10:00:00.000Z',
          status: 'new',
          reasons: ['price_wrong'],
          retailerLabel: 'SPAR',
          offerId: 'offer-1',
          offerTitle: 'Kaffee',
          query: 'kaffee',
          snippet: 'Preis stimmt nicht.',
        },
      ],
    },
    latestEssence: [{ retailerKey: 'spar', essence: 'SPAR source summary.' }],
  });

  assert.equal(Boolean(analysisEssence), true);
  assert.match(analysisEssenceText, /executive_health:/);
  assert.match(analysisEssenceText, /crawl_reliability:/);
  assert.match(analysisEssenceText, /finalizationLockBlocker: green/);
  assert.match(analysisEssenceText, /p1SourceCoverageCount: 11/);
  assert.match(analysisEssenceText, /latest_scheduled_full_crawl:/);
  assert.match(analysisEssenceText, /offer_quality_kpi:/);
  assert.match(analysisEssenceText, /feedback_beta_test:/);
  assert.match(analysisEssenceText, /feedback_processing_instruction:/);
  assert.match(analysisEssenceText, /# Aufgabe an ChatGPT/);
  assert.match(analysisEssenceText, /requiredForNextCodexPrompt: true/);
  assert.match(analysisEssenceText, /unprocessedFeedbackAvailable: true/);
});

test('dashboard analysis essence uses unknown fallbacks and excludes sensitive tokens', () => {
  const { analysisEssenceText } = _private.buildAnalysisEssencePayload({
    generatedAt: '2026-06-01T12:00:00.000Z',
    buildInfo: {},
    executiveStatus: {},
    latestScheduledFullCrawl: null,
    crawlHistory: [],
    lockStatus: {},
    publishStatusSummary: {},
    offerSummary: {},
    qualityKpis: [],
    retailerMatrix: [],
    trendSeries: [],
    actionableIssues: [],
    dataCompletenessWarnings: [],
    feedbackSummary: {
      totalFeedback: 1,
      openFeedback: 0,
      latestFeedback: [
        {
          status: 'new',
          reasons: ['other'],
          snippet: 'Contains userAgent, sessionIdHash, ipAddress, adminKey, ADMIN_API_KEY and https://example.test/path?secret=1',
        },
      ],
    },
    latestEssence: [
      {
        retailerKey: 'billa',
        essence: 'Source at https://example.test/private?token=1',
      },
    ],
  });
  const forbiddenTokens = [
    'ipAddress',
    'remoteAddress',
    'userAgent',
    'sessionId',
    'sessionIdHash',
    'clientContext',
    'adminKey',
    'ADMIN_API_KEY',
    'https://example.test',
  ];

  assert.match(analysisEssenceText, /runId: "not_available"/);
  assert.match(analysisEssenceText, /buildTime: unknown/);
  assert.match(analysisEssenceText, /unprocessedFeedbackAvailable: false/);
  assert.match(analysisEssenceText, /instructionStillApplies: true/);

  for (const token of forbiddenTokens) {
    assert.equal(analysisEssenceText.includes(token), false, `contains forbidden token ${token}`);
  }
});
