const crypto = require('node:crypto');

const NORMALIZATION_VERSION = 'v3-audit';

function hashContent(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function compactRejectionReasons(reasons = []) {
  const counts = new Map();

  for (const reason of reasons) {
    const key = String(reason?.reason || reason || '').trim();
    const count = Number(reason?.count || 1);

    if (!key || !(count > 0)) {
      continue;
    }

    counts.set(key, (counts.get(key) || 0) + count);
  }

  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.reason.localeCompare(right.reason, 'de');
    });
}

function buildOfferAuditSummary({ rawCandidateCount = 0, offers = [], extraRejectionReasons = [] } = {}) {
  const productiveOffers = Array.isArray(offers) ? offers.length : 0;
  const inferredRejected = Math.max(0, Number(rawCandidateCount || 0) - productiveOffers);
  const reasons = [...extraRejectionReasons];

  if (inferredRejected > 0) {
    reasons.push({ reason: 'parse-failed', count: inferredRejected });
  }

  const warningReasons = [];

  for (const offer of offers || []) {
    for (const reason of offer?.reviewReasons || []) {
      warningReasons.push({ reason, count: 1 });
    }

    if (Number(offer?.quality?.parsingConfidence || 0) < 0.75) {
      warningReasons.push({ reason: 'parser-low-confidence', count: 1 });
    }

    if (Number(offer?.categoryConfidence || 0) > 0 && Number(offer.categoryConfidence) < 0.5) {
      warningReasons.push({ reason: 'category-low-confidence', count: 1 });
    }
  }

  return {
    foundRawItems: Number(rawCandidateCount || 0),
    parsedOffers: productiveOffers,
    productiveOffers,
    rejectedOffers: inferredRejected,
    rejectionReasons: compactRejectionReasons(reasons),
    warningReasons: compactRejectionReasons(warningReasons),
  };
}

function buildCrawlJobUpdate({
  status,
  discoveredPages = 1,
  rawDocuments = 0,
  rawCandidateCount = 0,
  offers = [],
  warningMessages = [],
  errorMessages = [],
  source,
  sourceType = '',
  parserVersion = '',
  normalizationVersion = NORMALIZATION_VERSION,
  httpLog = {},
  metadata = {},
  extraRejectionReasons = [],
}) {
  const audit = buildOfferAuditSummary({
    rawCandidateCount,
    offers,
    extraRejectionReasons,
  });
  const warnings = audit.warningReasons.reduce((sum, item) => sum + item.count, 0);
  const errors = Array.isArray(errorMessages) ? errorMessages.length : 0;

  return {
    status,
    finishedAt: new Date(),
    sourceType: sourceType || source?.sourceType || source?.channel || '',
    sourceUrl: source?.sourceUrl || '',
    parserVersion,
    normalizationVersion,
    stats: {
      foundRawItems: audit.foundRawItems,
      parsedOffers: audit.parsedOffers,
      productiveOffers: audit.productiveOffers,
      rejectedOffers: audit.rejectedOffers,
      discoveredPages,
      rawDocuments,
      offersExtracted: audit.parsedOffers,
      offersStored: audit.productiveOffers,
      warnings,
      errors,
    },
    rejectionReasons: audit.rejectionReasons,
    httpLog: {
      status: httpLog.status ?? null,
      contentType: httpLog.contentType || '',
      finalUrl: httpLog.finalUrl || '',
      downloadBytes: Number(httpLog.downloadBytes || 0),
      contentHash: httpLog.contentHash || '',
    },
    warningMessages,
    errorMessages,
    metadata: {
      ...metadata,
      warningReasons: audit.warningReasons,
      rejectionReasons: audit.rejectionReasons,
      parserVersion,
      normalizationVersion,
    },
  };
}

function buildHttpLogFromResponse(response, body = '') {
  return {
    status: response?.status ?? null,
    contentType: response?.headers?.['content-type'] || '',
    finalUrl: response?.request?.res?.responseUrl || response?.config?.url || '',
    downloadBytes: Buffer.byteLength(String(body || ''), 'utf8'),
    contentHash: hashContent(body),
  };
}

module.exports = {
  NORMALIZATION_VERSION,
  buildCrawlJobUpdate,
  buildHttpLogFromResponse,
  buildOfferAuditSummary,
  compactRejectionReasons,
  hashContent,
};
