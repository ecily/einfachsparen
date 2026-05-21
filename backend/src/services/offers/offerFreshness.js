const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SNAPSHOT_MAX_AGE_DAYS = 14;

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

function isSnapshotTooOld(offer = {}, now = new Date(), maxAgeDays = DEFAULT_SNAPSHOT_MAX_AGE_DAYS) {
  if (offer.validTo) return false;

  const reference = referenceDateForFreshness(offer);
  if (!reference) return false;

  return now.getTime() - reference.getTime() > maxAgeDays * DAY_MS;
}

function isOfferFreshForActiveUse(offer = {}, now = new Date()) {
  // Local require avoids a module cycle: sourceQuality uses the date-range parser from this file.
  const { isLowConfidenceAggregatorOffer } = require('./sourceQuality');

  if (offer.status && offer.status !== 'active') return false;
  if (offer.isActiveNow === false) return false;

  const validTo = toDateOrNull(offer.validTo);
  if (validTo && validTo < now) return false;
  if (hasExplicitExpiredEvidence(offer.rawFacts) || hasExplicitExpiredEvidence(offer)) return false;
  if (hasExpiredUrlRange(offer, now)) return false;
  if (isSnapshotTooOld(offer, now)) return false;
  if (isLowConfidenceAggregatorOffer(offer)) return false;

  return true;
}

module.exports = {
  DEFAULT_SNAPSHOT_MAX_AGE_DAYS,
  buildOfferStatus,
  hasExplicitExpiredEvidence,
  hasExpiredUrlRange,
  isOfferFreshForActiveUse,
  isSnapshotTooOld,
  parseAktionsfinderDateRange,
};
