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
