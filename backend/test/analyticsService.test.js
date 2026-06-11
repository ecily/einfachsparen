const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TRAFFIC_EVENT_NAMES,
  buildInternalTesterActivation,
  buildDailyTrafficHistory,
  buildRollingTrafficLast24h,
  isValidInternalTesterToken,
} = require('../src/services/analytics/analyticsService');

test('rolling traffic counts only selected user activity events in the last 24 hours', async () => {
  const now = new Date('2026-06-11T12:00:00.000Z');
  let matchStage = null;
  const AnalyticsEventModel = {
    async aggregate(pipeline) {
      matchStage = pipeline[0].$match;
      return [
        { eventName: 'landing_page_view', internal: false, count: 3 },
        { eventName: 'offer_search_started', internal: false, count: 2 },
        { eventName: 'shopping_list_opened', internal: false, count: 1 },
        { eventName: 'landing_page_view', internal: true, count: 4 },
      ];
    },
  };

  const result = await buildRollingTrafficLast24h({ now, AnalyticsEventModel });

  assert.equal(result.external.total, 6);
  assert.equal(result.internal.total, 4);
  assert.equal(result.total, 10);
  assert.equal(result.external.byEventName.landing_page_view, 3);
  assert.equal(result.external.byEventName.offer_search_started, 2);
  assert.equal(result.external.byEventName.shopping_list_opened, 1);
  assert.equal(result.internal.byEventName.landing_page_view, 4);
  assert.equal(result.byEventName.offer_search_result, undefined);
  assert.deepEqual(matchStage.eventName.$in, TRAFFIC_EVENT_NAMES);
  assert.equal(matchStage.eventName.$in.includes('offer_search_result'), false);
  assert.equal(matchStage.createdAt.$gte.toISOString(), '2026-06-10T12:00:00.000Z');
  assert.equal(matchStage.createdAt.$lte.toISOString(), '2026-06-11T12:00:00.000Z');
});

test('daily traffic history uses existing daily aggregates and returns zero rows for empty days', async () => {
  const now = new Date('2026-06-11T12:00:00.000Z');
  const AnalyticsDailyAggregateModel = {
    find(query) {
      assert.equal(query.day.$gte, '2026-06-09');
      assert.deepEqual(query.eventName.$in, TRAFFIC_EVENT_NAMES);
      return {
        async lean() {
          return [
            { day: '2026-06-09', eventName: 'landing_page_view', count: 4 },
            { day: '2026-06-11', eventName: 'offer_search_started', count: 5 },
          ];
        },
      };
    },
  };

  const result = await buildDailyTrafficHistory({
    now,
    days: 3,
    AnalyticsEventModel: null,
    AnalyticsDailyAggregateModel,
  });

  assert.deepEqual(result.map((row) => row.date), ['2026-06-09', '2026-06-10', '2026-06-11']);
  assert.equal(result[0].total, 4);
  assert.equal(result[1].total, 0);
  assert.equal(result[2].total, 5);
});

test('daily traffic history can split external and internal events from raw analytics events', async () => {
  const now = new Date('2026-06-11T12:00:00.000Z');
  const AnalyticsEventModel = {
    async aggregate(pipeline) {
      assert.equal(pipeline[0].$match.createdAt.$gte.toISOString(), '2026-06-10T00:00:00.000Z');
      assert.deepEqual(pipeline[0].$match.eventName.$in, TRAFFIC_EVENT_NAMES);
      return [
        { day: '2026-06-10', eventName: 'landing_page_view', internal: false, count: 2 },
        { day: '2026-06-10', eventName: 'landing_page_view', internal: true, count: 3 },
        { day: '2026-06-11', eventName: 'offer_search_started', internal: false, count: 4 },
      ];
    },
  };

  const result = await buildDailyTrafficHistory({ now, days: 2, AnalyticsEventModel });

  assert.equal(result[0].total, 2);
  assert.equal(result[0].internalTotal, 3);
  assert.equal(result[0].combinedTotal, 5);
  assert.equal(result[1].total, 4);
  assert.equal(result[1].internalTotal, 0);
});

test('internal tester activation returns a signed marker only for the configured secret', () => {
  const envConfig = {
    INTERNAL_TESTER_SECRET: 'test-secret-with-safe-length',
  };

  const accepted = buildInternalTesterActivation({
    action: 'set',
    secret: 'test-secret-with-safe-length',
    envConfig,
  });

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.configured, true);
  assert.equal(accepted.internalTesterToken.startsWith('v1.'), true);
  assert.equal(isValidInternalTesterToken(accepted.internalTesterToken, envConfig), true);

  const rejected = buildInternalTesterActivation({
    action: 'set',
    secret: 'wrong-secret',
    envConfig,
  });

  assert.equal(rejected.accepted, false);
  assert.equal(rejected.internalTesterToken, '');
});
