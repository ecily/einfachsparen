const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SNAPSHOT_MAX_AGE_DAYS = 14;
const PUBLIC_CURRENT_PUBLISH_STATUSES = new Set(['crawl-run-success', 'crawl-run-partial']);
const PUBLIC_STALE_OR_RETAINED_PUBLISH_STATUSES = new Set([
  '',
  'unknown',
  'crawl-run-stale',
  'crawl-run-failed',
  'crawl-run-skipped',
  'source-written',
  'queued',
  'running',
  'retained',
  'legacy',
]);
const PUBLIC_CURRENT_SOURCE_RUN_STATUSES = new Set(['success', 'partial', 'current', 'verified']);

function isValidDate(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function toDateOrNull(value) {
  return isValidDate(value) ? new Date(value) : null;
}

function endOfUtcDay(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
}

function parseAktionsfinderDateRange(value) {
  const text = String(value || '');
  const match = text.match(/-(\d{2})-(\d{2})-(\d{4})-(\d{2})-(\d{2})-(\d{4})(?:\/|$|[?#])/);

  if (!match) {
    return {
      validFrom: null,
      validTo: null,
    };
  }

  const [, fromDay, fromMonth, fromYear, toDay, toMonth, toYear] = match.map(Number);

  return {
    validFrom: new Date(Date.UTC(fromYear, fromMonth - 1, fromDay, 12, 0, 0)),
    validTo: endOfUtcDay(toYear, toMonth, toDay),
  };
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\u00e4/g, 'ae')
    .replace(/\u00f6/g, 'oe')
    .replace(/\u00fc/g, 'ue')
    .replace(/\u00df/g, 'ss');
}

function collectStrings(value, result = [], seen = new WeakSet()) {
  if (value == null) return result;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    result.push(String(value));
    return result;
  }

  if (typeof value !== 'object') return result;
  if (seen.has(value)) return result;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, result, seen);
    }
    return result;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (/html|image|src|url|href/i.test(key)) {
      continue;
    }

    collectStrings(entry, result, seen);
  }

  return result;
}

function hasExplicitExpiredEvidence(value) {
  if (!value) return false;

  if (value.expired === true || value.isExpired === true || value.explicitExpired === true) {
    return true;
  }

  return collectStrings(value).some((entry) => {
    const text = normalizeText(entry);
    return (
      /\babgelaufen\b/.test(text)
      || /\bbeendet\b/.test(text)
      || /\bexpired\b/.test(text)
      || /nicht\s+mehr\s+gueltig/.test(text)
      || /nicht\s+mehr\s+gultig/.test(text)
    );
  });
}

function buildOfferStatus(validFrom, validTo, snapshotCurrent = false, explicitExpired = false, now = new Date()) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const from = toDateOrNull(validFrom);
  const to = toDateOrNull(validTo);
  const hasStarted = from ? from <= now : false;
  const hasNotEnded = to ? to >= now : false;
  const overlapsToday =
    (!from || from <= endOfToday) &&
    (!to || to >= startOfToday);

  let status = 'unknown';

  if (explicitExpired) {
    status = 'expired';
  } else if (to && to < now) {
    status = 'expired';
  } else if (from && from > now) {
    status = 'upcoming';
  } else if (snapshotCurrent) {
    status = 'active';
  } else if ((from || to) && (hasStarted || !from) && (hasNotEnded || !to)) {
    status = 'active';
  }

  return {
    status,
    isActiveNow: status === 'active',
    isActiveToday: status === 'active' && overlapsToday,
  };
}

function getOfferFreshnessUrls(offer = {}) {
  return [
    offer.sourceUrl,
    ...(Array.isArray(offer.sourceUrls) ? offer.sourceUrls : []),
    ...(Array.isArray(offer.evidenceUrls) ? offer.evidenceUrls : []),
    offer.rawFacts?.clickoutUrl,
    offer.rawFacts?.leafletHref,
  ].filter(Boolean);
}

function hasExpiredUrlRange(offer, now = new Date()) {
  return getOfferFreshnessUrls(offer).some((url) => {
    const range = parseAktionsfinderDateRange(url);
    return Boolean(range.validTo && range.validTo < now);
  });
}

function referenceDateForFreshness(offer = {}) {
  return toDateOrNull(offer.lastSeenAt) || toDateOrNull(offer.updatedAt) || toDateOrNull(offer.createdAt);
}

function hasVisibleCustomerProgramCondition(offer = {}) {
  if (!offer.customerProgramRequired) {
    return true;
  }

  return Boolean(
    String(offer.conditionsText || '').trim()
    || String(offer.conditionLabel || '').trim()
    || String(offer.rawFacts?.conditionsText || '').trim()
    || String(offer.rawFacts?.infoText || '').trim()
    || (Array.isArray(offer.rawFacts?.loyaltyTags) && offer.rawFacts.loyaltyTags.length > 0)
  );
}

function hasPlausiblePublicOfferShape(offer = {}) {
  const title = String(offer.title || '').trim();
  const price = Number(offer.priceCurrent?.amount);
  const hasPlausibleTitle = (
    title.length >= 5
    && /[A-Za-z\u00c0-\u017f]/.test(title)
    && !/^[\d\s.,%-]+$/.test(title)
    && title.split(/\s+/).length >= 2
  );
  const hasPlausiblePrice = Number.isFinite(price) && price > 0 && price < 500;
  const hasPlausibleQuantity = Boolean(
    String(offer.quantityText || '').trim()
    || Number(offer.unitValue) > 0
    || Number(offer.totalComparableAmount) > 0
    || String(offer.comparableUnit || '').trim()
  );

  return hasPlausibleTitle && hasPlausiblePrice && hasPlausibleQuantity;
}

function isSnapshotTooOld(offer = {}, now = new Date(), maxAgeDays = DEFAULT_SNAPSHOT_MAX_AGE_DAYS) {
  if (offer.validTo) return false;

  const reference = referenceDateForFreshness(offer);
  if (!reference) return false;

  return now.getTime() - reference.getTime() > maxAgeDays * DAY_MS;
}

function isExpiredValidToCompensatedByFreshCrawl(offer = {}, now = new Date()) {
  const validTo = toDateOrNull(offer.validTo);
  const reference = referenceDateForFreshness(offer);

  if (!validTo || validTo >= now || !reference || reference <= validTo) {
    return false;
  }

  // Local require avoids a module cycle: sourceQuality uses the date-range parser from this file.
  const { hasFreshCrawlEvidence } = require('./sourceQuality');

  return hasFreshCrawlEvidence(offer, now);
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function hasCurrentPublishStatus(offer = {}) {
  return PUBLIC_CURRENT_PUBLISH_STATUSES.has(normalizeStatus(offer.publishStatus));
}

function hasStaleOrRetainedPublishStatus(offer = {}) {
  return PUBLIC_STALE_OR_RETAINED_PUBLISH_STATUSES.has(normalizeStatus(offer.publishStatus));
}

function hasCurrentSourceRunStatus(offer = {}) {
  return PUBLIC_CURRENT_SOURCE_RUN_STATUSES.has(normalizeStatus(offer.sourceRunStatus || offer.rawFacts?.sourceRunStatus));
}

function hasCurrentRunFreshnessEvidence(offer = {}, now = new Date()) {
  const { hasFreshCrawlEvidence } = require('./sourceQuality');

  return hasFreshCrawlEvidence(offer, now) && (hasCurrentPublishStatus(offer) || hasCurrentSourceRunStatus(offer));
}

function isAggregatorSourceClass(sourceQuality = {}) {
  return sourceQuality.sourceClass === 'aggregator' || sourceQuality.sourceClass === 'aggregator-ppcv';
}

function isStaleRetainedAggregatorWithoutPublicFreshness(offer = {}, sourceQuality = {}, now = new Date()) {
  if (!isAggregatorSourceClass(sourceQuality) || toDateOrNull(offer.validTo)) {
    return false;
  }

  if (hasStaleOrRetainedPublishStatus(offer)) {
    return true;
  }

  return !hasCurrentRunFreshnessEvidence(offer, now);
}

function isOfferFreshForActiveUse(offer = {}, now = new Date()) {
  // Local require avoids a module cycle: sourceQuality uses the date-range parser from this file.
  const { classifyOfferSourceQuality } = require('./sourceQuality');

  if (offer.status && offer.status !== 'active') return false;
  if (offer.isActiveNow === false) return false;

  const validTo = toDateOrNull(offer.validTo);
  if (validTo && validTo < now) return false;
  if (hasExplicitExpiredEvidence(offer.rawFacts) || hasExplicitExpiredEvidence(offer)) return false;
  if (hasExpiredUrlRange(offer, now)) return false;
  if (isSnapshotTooOld(offer, now)) return false;
  if (!hasVisibleCustomerProgramCondition(offer)) return false;

  const sourceQuality = classifyOfferSourceQuality(offer, now);
  if (isStaleRetainedAggregatorWithoutPublicFreshness(offer, sourceQuality, now)) return false;
  if (sourceQuality.isLowConfidenceAggregator) return false;
  if (
    sourceQuality.sourceClass === 'aggregator-ppcv'
    && !sourceQuality.hasValidityEvidence
    && !sourceQuality.hasDetailEvidence
    && (
      !hasCurrentRunFreshnessEvidence(offer, now)
      || !hasPlausiblePublicOfferShape(offer)
      || !hasVisibleCustomerProgramCondition(offer)
    )
  ) {
    return false;
  }

  return true;
}

module.exports = {
  DEFAULT_SNAPSHOT_MAX_AGE_DAYS,
  buildOfferStatus,
  hasExplicitExpiredEvidence,
  hasExpiredUrlRange,
  hasPlausiblePublicOfferShape,
  hasCurrentRunFreshnessEvidence,
  hasVisibleCustomerProgramCondition,
  isExpiredValidToCompensatedByFreshCrawl,
  isOfferFreshForActiveUse,
  isStaleRetainedAggregatorWithoutPublicFreshness,
  isSnapshotTooOld,
  parseAktionsfinderDateRange,
};
