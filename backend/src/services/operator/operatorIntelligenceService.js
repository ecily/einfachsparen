const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const OPEN_FEEDBACK_STATUSES = new Set(['new', 'reviewing']);
const TRUST_FEEDBACK_REASONS = new Set([
  'price_wrong',
  'condition_wrong',
  'image_wrong',
  'category_wrong',
  'expired_or_not_found',
  'offer_nonsense',
  'search_result_wrong',
]);

function stringValue(value) {
  return String(value || '').trim();
}

function numberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function hasEvidence(evidence) {
  return Array.isArray(evidence) && evidence.some((item) => stringValue(item?.source) && stringValue(item?.detail));
}

function buildEvidence(items = []) {
  return items.filter((item) => stringValue(item?.source) && stringValue(item?.detail));
}

function buildGlobalLearningContract(feedback = {}) {
  const primaryReason = stringValue(feedback.primaryReason || feedback.reasons?.[0]) || 'unknown';
  const caseId = stringValue(feedback.id);

  return {
    case: {
      feedbackId: caseId || null,
      reason: primaryReason,
      offerId: stringValue(feedback.offerId) || null,
      retailer: stringValue(feedback.retailerKey || feedback.retailerLabel) || null,
      query: stringValue(feedback.query) || null,
    },
    rootCause: {
      status: 'not_established',
      value: null,
      required: true,
    },
    patternScope: {
      status: 'requires_global_check',
      scope: primaryReason,
    },
    similarCases: {
      status: 'not_computed',
      count: null,
    },
    globalFixCandidate: {
      status: 'pending_root_cause',
      value: null,
    },
    regressionCoverage: {
      status: 'pending',
      value: null,
    },
    verification: {
      status: 'pending',
      value: null,
    },
    status: 'open',
  };
}

function buildAction({
  priority,
  title,
  reason,
  recommendedAction,
  expectedImpact,
  impactArea,
  confidence,
  evidence,
  references = {},
  globalLearning = null,
} = {}) {
  const action = {
    priority,
    title,
    reason,
    recommendedAction,
    expectedImpact,
    impactArea,
    confidence,
    evidence,
    references,
    humanRequired: true,
  };

  if (globalLearning) action.globalLearning = globalLearning;
  return hasEvidence(evidence) && priority in PRIORITY_ORDER && title && reason && recommendedAction && expectedImpact && impactArea && confidence
    ? action
    : null;
}

function buildOperatorActions({
  latestScheduledFullCrawl = null,
  lockStatus = null,
  publishStatusSummary = null,
  feedbackSummary = {},
} = {}) {
  const actions = [];
  const latestRun = latestScheduledFullCrawl;

  if (lockStatus?.isBlocked === true) {
    actions.push(buildAction({
      priority: 'high',
      title: 'Globalen Crawl-Lock read-only prüfen',
      reason: lockStatus.reason || 'Der globale Crawl-Lock ist als blockiert markiert.',
      recommendedAction: 'Lock-Lineage und den zugehörigen CrawlRun prüfen; keine manuelle Entsperrung ohne belegte Ursache.',
      expectedImpact: 'Betrieb stabilisieren und unbeabsichtigte parallele Crawls vermeiden.',
      impactArea: 'Betrieb',
      confidence: 'high',
      evidence: buildEvidence([
        { source: 'dashboard.lockStatus', detail: `state=${lockStatus.state || 'unknown'}; blocked=true` },
        { source: 'dashboard.lockStatus', detail: lockStatus.reason || 'blocked lock' },
      ]),
      references: { crawlRunId: stringValue(lockStatus.lock?.runId) || null },
    }));
  }

  if (latestRun && ['failed', 'stale'].includes(latestRun.status)) {
    actions.push(buildAction({
      priority: 'high',
      title: 'Fehlgeschlagenen Daily-Crawl verifizieren',
      reason: `Der letzte scheduled Full-Crawl steht auf ${latestRun.status}; die Datenbasis ist deshalb operativ nicht vollständig bestätigt.`,
      recommendedAction: 'Fehler-/Replacement-Lineage read-only prüfen und erst danach über eine freigegebene Betriebsmaßnahme entscheiden.',
      expectedImpact: 'Trust und Aktualität der öffentlichen Angebote schützen.',
      impactArea: 'Trust',
      confidence: 'high',
      evidence: buildEvidence([
        { source: 'dashboard.latestScheduledFullCrawl', detail: `run=${latestRun.id || 'unknown'}; status=${latestRun.status}` },
        { source: 'dashboard.latestScheduledFullCrawl', detail: latestRun.errorMessages?.[0] || latestRun.lastStage || 'terminal status requires verification' },
      ]),
      references: { crawlRunId: stringValue(latestRun.id) || null },
    }));
  }

  if (publishStatusSummary?.status === 'open' || Number(publishStatusSummary?.openCount || 0) > 0) {
    actions.push(buildAction({
      priority: 'high',
      title: 'Offene Publish-Status-Lineage prüfen',
      reason: `${numberValue(publishStatusSummary.openCount) ?? 0} aktive Angebote sind nicht final publiziert.`,
      recommendedAction: 'Betroffene PublishStatus-Lineage read-only nachvollziehen und keine Reparatur ohne konkrete Evidence freigeben.',
      expectedImpact: 'Verhindern, dass unvollständig bestätigte Angebote öffentlich erscheinen.',
      impactArea: 'Trust',
      confidence: 'high',
      evidence: buildEvidence([
        { source: 'dashboard.publishStatusSummary', detail: `status=${publishStatusSummary.status || 'unknown'}` },
        { source: 'dashboard.publishStatusSummary', detail: `openCount=${publishStatusSummary.openCount}` },
      ]),
      references: { openPublishCount: numberValue(publishStatusSummary.openCount) },
    }));
  }

  const openFeedback = numberValue(feedbackSummary.openFeedback) || 0;
  const latestFeedback = (feedbackSummary.latestFeedback || [])
    .filter((item) => OPEN_FEEDBACK_STATUSES.has(item.status))
    .filter((item) => TRUST_FEEDBACK_REASONS.has(item.primaryReason || item.reasons?.[0]) || item.id)
    .slice(0, 1)[0];

  if (openFeedback > 0 && latestFeedback) {
    const reason = latestFeedback.primaryReason || latestFeedback.reasons?.[0] || 'unknown';
    actions.push(buildAction({
      priority: TRUST_FEEDBACK_REASONS.has(reason) ? 'high' : 'medium',
      title: 'Offenes Feedback global analysieren',
      reason: `${openFeedback} offene Feedback-Fälle benötigen Triage; der konkrete Fall darf nicht isoliert als Offer-Fix behandelt werden.`,
      recommendedAction: 'Fall prüfen, Root Cause bestimmen, ähnliche Fälle untersuchen, globalen Fix-Kandidaten und Regressionstest dokumentieren.',
      expectedImpact: 'Datenqualität systematisch verbessern und Wiederholungsfehler vermeiden.',
      impactArea: 'Datenqualität',
      confidence: latestFeedback.id && reason !== 'unknown' ? 'medium' : 'low',
      evidence: buildEvidence([
        { source: 'dashboard.feedbackSummary', detail: `openFeedback=${openFeedback}` },
        { source: 'dashboard.feedbackSummary.latestFeedback', detail: `feedback=${latestFeedback.id || 'unknown'}; reason=${reason}; status=${latestFeedback.status}` },
      ]),
      references: {
        feedbackId: stringValue(latestFeedback.id) || null,
        offerId: stringValue(latestFeedback.offerId) || null,
        retailer: stringValue(latestFeedback.retailerKey || latestFeedback.retailerLabel) || null,
        query: stringValue(latestFeedback.query) || null,
      },
      globalLearning: buildGlobalLearningContract(latestFeedback),
    }));
  }

  return actions
    .filter(Boolean)
    .sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] || left.title.localeCompare(right.title, 'de'))
    .slice(0, 5);
}

function buildOperatorIntelligence(input = {}) {
  const actions = buildOperatorActions(input);
  return {
    version: 'operator-intelligence-v1',
    generatedAt: input.generatedAt || new Date().toISOString(),
    readOnly: true,
    humanActionCount: actions.length,
    actions,
    emptyState: actions.length === 0 ? 'Aktuell ist kein menschlicher Eingriff erforderlich.' : null,
    policy: {
      automateByDefault: true,
      humanOnlyWhenNeeded: true,
      maxActions: 5,
      evidenceRequired: true,
      statusMutation: false,
      globalFeedbackLearningRequired: true,
    },
  };
}

module.exports = {
  buildOperatorIntelligence,
  _private: {
    buildOperatorActions,
    buildGlobalLearningContract,
    buildAction,
  },
};
