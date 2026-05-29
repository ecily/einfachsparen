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

function canonicalRejectionReason(reason = '') {
  const key = String(reason || '').trim().toLowerCase();

  if (!key) return '';
  if (['missing-price', 'missing-current-price', 'price-missing'].includes(key)) return 'price-missing';
  if (['missing-title', 'title-missing', 'no-title'].includes(key)) return 'title-missing';
  if (['missing-quantity', 'generic-missing-quantity', 'quantity-missing'].includes(key)) return 'quantity-missing';
  if (['generic-unclear-product', 'unclear-product', 'product-unclear', 'implausible-title', 'bad-title-line', 'non-offer-title'].includes(key)) return 'product-unclear';
  if (['campaign-not-product', 'condition-text-instead-of-title', 'condition-only-fragment'].includes(key)) return 'condition-only-fragment';
  if (['layout-fragment', 'noise-text-instead-of-title', 'unit-text-instead-of-title', 'multiple-nearby-title-boxes'].includes(key)) return 'layout-fragment';
  if (['status-upcoming', 'validity-upcoming'].includes(key)) return 'validity-upcoming';
  if (['status-expired', 'validity-expired'].includes(key)) return 'validity-expired';
  if (['duplicate', 'dedupe-dropped', 'deduped', 'source-dedupe-dropped'].includes(key)) return 'dedupe-dropped';
  if (['category-low-confidence', 'category-missing', 'category-unclear'].includes(key)) return 'category-unclear';
  if (['normalization-rejected', 'audit-filtered'].includes(key)) return 'audit-filtered';
  if (key === 'parse-failed') return 'parse-failed';
  if (key === 'parser-no-offer-candidate') return 'parser-no-offer-candidate';
  if (/^status-upcoming\b/.test(key)) return 'validity-upcoming';
  if (/^status-expired\b/.test(key)) return 'validity-expired';
  if (/quantity/.test(key)) return 'quantity-missing';
  if (/price/.test(key)) return 'price-missing';
  if (/title/.test(key)) return 'title-missing';

  return key;
}

function countReasons(reasons = [], { canonical = false } = {}) {
  const counts = new Map();

  for (const item of reasons || []) {
    const rawReason = String(item?.reason || item || '').trim();
    const reason = canonical ? canonicalRejectionReason(rawReason) : rawReason;
    const count = Number(item?.count || 1);

    if (!reason || !(count > 0)) {
      continue;
    }

    counts.set(reason, (counts.get(reason) || 0) + count);
  }

  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right, 'de')));
}

function hasUsableImage(offer = {}) {
  const value = String(offer?.imageUrl || offer?.images?.medium || offer?.images?.small || '').trim();
  return /^https?:\/\//i.test(value) && !/(?:placeholder|no[-_ ]?image|missing[-_ ]?image|bild[-_ ]?folgt|spacer|transparent|blank)/i.test(value);
}

function offerHasMissingQuantitySignal(offer = {}) {
  return !String(offer?.quantityText || '').trim()
    || (offer?.reviewReasons || []).includes('missing-quantity')
    || offer?.normalizedUnitPrice?.comparable === false;
}

function offerHasUnclearProductSignal(offer = {}) {
  return (offer?.reviewReasons || []).some((reason) => canonicalRejectionReason(reason) === 'product-unclear');
}

function offerHasCategoryUnclearSignal(offer = {}) {
  return (offer?.reviewReasons || []).some((reason) => canonicalRejectionReason(reason) === 'category-unclear')
    || (Number(offer?.categoryConfidence || 1) > 0 && Number(offer.categoryConfidence) < 0.5);
}

function ratio(numerator, denominator) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);
  return bottom > 0 ? Number((top / bottom).toFixed(4)) : null;
}

function inferFreshnessStatus({ validFrom, validTo, now = new Date(), rejectedByReason = {} } = {}) {
  const from = validFrom ? new Date(validFrom) : null;
  const to = validTo ? new Date(validTo) : null;
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();

  if (from && !Number.isNaN(from.getTime()) && from.getTime() > nowTime) return 'upcoming';
  if (to && !Number.isNaN(to.getTime()) && to.getTime() < nowTime) return 'expired';
  if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) return 'current';
  if (Number(rejectedByReason['validity-upcoming'] || 0) > 0 && Number(rejectedByReason['validity-expired'] || 0) === 0) return 'upcoming';
  if (Number(rejectedByReason['validity-expired'] || 0) > 0 && Number(rejectedByReason['validity-upcoming'] || 0) === 0) return 'expired';

  return 'unknown';
}

function buildCoverageMetrics({
  foundRawItems = 0,
  parsedOffers = 0,
  offersStored = 0,
  rejectedOffers,
  offers = [],
  rejectionReasons = [],
  validFrom = null,
  validTo = null,
  now = new Date(),
  fallbackParserNoOfferCandidate = true,
} = {}) {
  const raw = Number(foundRawItems || 0);
  const parsed = Number(parsedOffers || 0);
  const stored = Number(offersStored ?? parsedOffers ?? 0);
  const rejected = Number.isFinite(Number(rejectedOffers)) ? Number(rejectedOffers) : Math.max(0, raw - stored);
  const sourceOffers = Array.isArray(offers) ? offers : [];
  const originalReasons = compactRejectionReasons(rejectionReasons);
  const normalizedReasonItems = [...originalReasons];
  const explicitReasonTotal = originalReasons.reduce((sum, item) => sum + Number(item.count || 0), 0);

  if (raw > 0 && parsed === 0 && rejected > explicitReasonTotal && fallbackParserNoOfferCandidate) {
    normalizedReasonItems.push({ reason: 'parser-no-offer-candidate', count: rejected - explicitReasonTotal });
  } else if (rejected > explicitReasonTotal) {
    normalizedReasonItems.push({ reason: 'parse-failed', count: rejected - explicitReasonTotal });
  }

  const rejectedByReason = countReasons(normalizedReasonItems, { canonical: true });
  const withImageFromOffers = sourceOffers.filter(hasUsableImage).length;
  const missingImageFromOffers = sourceOffers.length > 0 ? Math.max(0, sourceOffers.length - withImageFromOffers) : 0;
  const withImageCount = sourceOffers.length > 0 ? withImageFromOffers : null;
  const missingImageCount = sourceOffers.length > 0 ? missingImageFromOffers : null;
  const missingQuantityCount = sourceOffers.filter(offerHasMissingQuantitySignal).length + Number(rejectedByReason['quantity-missing'] || 0);
  const unclearProductCount = sourceOffers.filter(offerHasUnclearProductSignal).length + Number(rejectedByReason['product-unclear'] || 0);
  const categoryUnclearCount = sourceOffers.filter(offerHasCategoryUnclearSignal).length + Number(rejectedByReason['category-unclear'] || 0);
  const parseFailedCount = Number(rejectedByReason['parse-failed'] || 0) + Number(rejectedByReason['parser-no-offer-candidate'] || 0);
  const upcomingCount = Number(rejectedByReason['validity-upcoming'] || 0);
  const expiredCount = Number(rejectedByReason['validity-expired'] || 0);
  const storedRatio = ratio(stored, raw);
  const rejectionRate = ratio(rejected, raw);
  const imageCoverageRatio = sourceOffers.length > 0 ? ratio(withImageFromOffers, sourceOffers.length) : null;
  const freshnessStatus = inferFreshnessStatus({ validFrom, validTo, now, rejectedByReason });

  const flags = {
    rawItemsFoundButZeroStored: raw > 0 && stored === 0,
    highRejectionRate: raw >= 5 && rejected / Math.max(raw, 1) >= 0.5,
    highMissingImageRate: sourceOffers.length >= 3 && missingImageFromOffers / Math.max(sourceOffers.length, 1) >= 0.8,
    sourcePossiblyStale: freshnessStatus === 'expired' || expiredCount >= Math.max(5, raw * 0.25),
    manyParseFailed: parseFailedCount >= 10 || (raw >= 5 && parseFailedCount / Math.max(raw, 1) >= 0.5),
    manyMissingQuantity: missingQuantityCount >= 10 || (raw >= 5 && missingQuantityCount / Math.max(raw, 1) >= 0.35),
  };

  return {
    foundRawItems: raw,
    parsedOffers: parsed,
    storedOffers: stored,
    rejectedOffers: rejected,
    rejectionReasons: originalReasons,
    rejectedByReason,
    missingImageCount,
    withImageCount,
    missingQuantityCount,
    unclearProductCount,
    upcomingCount,
    expiredCount,
    parseFailedCount,
    categoryUnclearCount,
    storedRatio,
    rejectionRate,
    imageCoverageRatio,
    freshnessStatus,
    flags,
  };
}

function buildOfferAuditSummary({
  rawCandidateCount = 0,
  offers = [],
  extraRejectionReasons = [],
  validFrom = null,
  validTo = null,
} = {}) {
  const productiveOffers = Array.isArray(offers) ? offers.length : 0;
  const inferredRejected = Math.max(0, Number(rawCandidateCount || 0) - productiveOffers);
  const reasons = compactRejectionReasons(extraRejectionReasons);
  const reasonTotal = reasons.reduce((sum, item) => sum + item.count, 0);

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
  const unexplainedRejected = Math.max(0, inferredRejected - reasonTotal);

  if (unexplainedRejected > 0) {
    reasons.push({
      reason: Number(rawCandidateCount || 0) > 0 && productiveOffers === 0 ? 'parser-no-offer-candidate' : 'parse-failed',
      count: unexplainedRejected,
    });
  }

  const coverageMetrics = buildCoverageMetrics({
    foundRawItems: rawCandidateCount,
    parsedOffers: productiveOffers,
    offersStored: productiveOffers,
    rejectedOffers: inferredRejected,
    offers,
    rejectionReasons: reasons,
    validFrom,
    validTo,
  });

  return {
    foundRawItems: Number(rawCandidateCount || 0),
    parsedOffers: productiveOffers,
    productiveOffers,
    rejectedOffers: inferredRejected,
    rejectionReasons: compactRejectionReasons(reasons),
    warningReasons: compactRejectionReasons(warningReasons),
    coverageMetrics,
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
  validFrom = null,
  validTo = null,
}) {
  const audit = buildOfferAuditSummary({
    rawCandidateCount,
    offers,
    extraRejectionReasons,
    validFrom,
    validTo,
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
      missingImageCount: audit.coverageMetrics.missingImageCount,
      withImageCount: audit.coverageMetrics.withImageCount,
      missingQuantityCount: audit.coverageMetrics.missingQuantityCount,
      unclearProductCount: audit.coverageMetrics.unclearProductCount,
      upcomingCount: audit.coverageMetrics.upcomingCount,
      expiredCount: audit.coverageMetrics.expiredCount,
      parseFailedCount: audit.coverageMetrics.parseFailedCount,
      categoryUnclearCount: audit.coverageMetrics.categoryUnclearCount,
      storedRatio: audit.coverageMetrics.storedRatio,
      imageCoverageRatio: audit.coverageMetrics.imageCoverageRatio,
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
      rejectedByReason: audit.coverageMetrics.rejectedByReason,
      coverageMetrics: audit.coverageMetrics,
      qualityFlags: audit.coverageMetrics.flags,
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
  buildCoverageMetrics,
  buildOfferAuditSummary,
  canonicalRejectionReason,
  compactRejectionReasons,
  hashContent,
};
