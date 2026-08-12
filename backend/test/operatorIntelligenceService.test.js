const assert = require('node:assert/strict');
const test = require('node:test');
const { buildOperatorIntelligence, _private } = require('../src/services/operator/operatorIntelligenceService');

function evidenceState() {
  return {
    latestScheduledFullCrawl: { id: 'run-1', status: 'success', finishedAt: '2026-08-12T04:00:00.000Z' },
    lockStatus: { isBlocked: false, state: 'free' },
    publishStatusSummary: { status: 'final', openCount: 0 },
    feedbackSummary: { openFeedback: 0, latestFeedback: [] },
  };
}

test('empty operator state produces no human action', () => {
  const result = buildOperatorIntelligence(evidenceState());
  assert.equal(result.humanActionCount, 0);
  assert.equal(result.emptyState, 'Aktuell ist kein menschlicher Eingriff erforderlich.');
  assert.deepEqual(result.actions, []);
});

test('actions require evidence and are capped and priority sorted', () => {
  const result = buildOperatorIntelligence({
    latestScheduledFullCrawl: { id: 'run-failed', status: 'failed', errorMessages: ['process restart'] },
    lockStatus: { isBlocked: true, state: 'blocked', reason: 'heartbeat stale', lock: { runId: 'run-lock' } },
    publishStatusSummary: { status: 'open', openCount: 4 },
    feedbackSummary: {
      openFeedback: 2,
      latestFeedback: [{ id: 'feedback-1', status: 'reviewing', primaryReason: 'price_wrong', offerId: 'offer-1' }],
    },
  });

  assert.ok(result.actions.length <= 5);
  assert.equal(result.actions[0].priority, 'high');
  assert.ok(result.actions.every((action) => action.evidence.length > 0));
  assert.ok(result.actions.every((action) => action.humanRequired === true));
});

test('feedback action carries the global learning contract without inventing similar cases', () => {
  const feedback = {
    id: 'feedback-1',
    status: 'new',
    primaryReason: 'image_wrong',
    offerId: 'offer-1',
    retailerKey: 'billa',
    query: 'bier',
  };
  const before = structuredClone(feedback);
  const result = buildOperatorIntelligence({
    ...evidenceState(),
    feedbackSummary: { openFeedback: 1, latestFeedback: [feedback] },
  });
  const action = result.actions[0];

  assert.equal(action.priority, 'high');
  assert.equal(action.globalLearning.case.feedbackId, 'feedback-1');
  assert.equal(action.globalLearning.rootCause.status, 'not_established');
  assert.equal(action.globalLearning.patternScope.status, 'requires_global_check');
  assert.equal(action.globalLearning.similarCases.count, null);
  assert.equal(action.globalLearning.globalFixCandidate.status, 'pending_root_cause');
  assert.equal(action.globalLearning.regressionCoverage.status, 'pending');
  assert.deepEqual(feedback, before);
});

test('automatable or unsupported signals do not become human actions', () => {
  const result = buildOperatorIntelligence({
    latestScheduledFullCrawl: { id: 'run-1', status: 'success' },
    offerSummary: { imageCoverageRate: 0.2, comparisonSafetyRate: 0.3 },
    dataCompletenessWarnings: ['limited history'],
    feedbackSummary: { openFeedback: 0, latestFeedback: [] },
  });
  assert.deepEqual(result.actions, []);
});

test('global learning helper preserves the eight required stages', () => {
  const contract = _private.buildGlobalLearningContract({ id: 'f-1', primaryReason: 'condition_wrong' });
  for (const key of ['case', 'rootCause', 'patternScope', 'similarCases', 'globalFixCandidate', 'regressionCoverage', 'verification', 'status']) {
    assert.ok(Object.prototype.hasOwnProperty.call(contract, key), `missing ${key}`);
  }
});
