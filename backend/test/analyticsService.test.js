const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TRAFFIC_EVENT_NAMES,
  buildDailyTrafficHistory,
  buildRollingTrafficLast24h,
} = require('../src/services/analytics/analyticsService');

test('rolling traffic counts only selected user activity events in the last 24 hours', async () => {
  const now = new Date('2026-06-11T12:00:00.000Z');
  let matchStage = null;
  const AnalyticsEventModel = {
    async aggregate(pipeline) {
      matchStage = pipeline[0].$match;
      return [
        { eventName: 'landing_page_view', count: 3 },
        { eventName: 'offer_search_started', count: 2 },
        { eventName: 'shopping_list_opened', count: 1 },
      ];
    },
  };

  const result = await buildRollingTrafficLast24h({ now, AnalyticsEventModel });

  assert.equal(result.total, 6);
  assert.equal(result.byEventName.landing_page_view, 3);
  assert.equal(result.byEventName.offer_search_started, 2);
  assert.equal(result.byEventName.shopping_list_opened, 1);
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

  const result = await buildDailyTrafficHistory({ now, days: 3, AnalyticsDailyAggregateModel });

  assert.deepEqual(result.map((row) => row.date), ['2026-06-09', '2026-06-10', '2026-06-11']);
  assert.equal(result[0].total, 4);
  assert.equal(result[1].total, 0);
  assert.equal(result[2].total, 5);
});
