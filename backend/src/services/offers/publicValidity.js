const DAY_MS = 24 * 60 * 60 * 1000;
const VIENNA_TIME_ZONE = 'Europe/Vienna';
const PUBLIC_VALIDITY_VERSION = 'public-validity-v1';

const SOURCE_TTL_HOURS = Object.freeze({
  mueller: 48,
  bipa: 96,
  billa: 72,
  'billa-plus': 72,
  dm: 72,
});

function toDateOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function viennaOffsetMs(utcGuess) {
  const offsetGuess = new Date(Math.floor(utcGuess.getTime() / 1000) * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIENNA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(offsetGuess);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return localAsUtc - offsetGuess.getTime();
}

function viennaLocalDateToUtc(value, endOfDay = false) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const utcGuess = new Date(Date.UTC(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  ));
  return new Date(utcGuess.getTime() - viennaOffsetMs(utcGuess));
}

function buildPublicValidityMongoMatch(now = new Date()) {
  const referenceNow = toDateOrNull(now) || new Date();
  const explicit = {
    validTo: { $gte: referenceNow },
    $or: [{ validFrom: null }, { validFrom: { $lte: referenceNow } }],
  };
  const snapshotBase = {
    validTo: null,
    'rawFacts.snapshotCurrent': true,
    sourceRunStatus: 'success',
    crawlJobId: { $exists: true, $ne: null },
    sourceId: { $exists: true, $ne: null },
    lastSeenAt: { $exists: true, $ne: null },
    $and: [{
      $or: [
        { sourceType: /official|algolia|mueller|müller|billa|bipa|dm|hofer|lidl|penny|spar|interspar|flyer/i },
        { sourceTypes: /official|algolia|mueller|müller|billa|bipa|dm|hofer|lidl|penny|spar|interspar|flyer/i },
      ],
    }],
  };
  const ttlClauses = Object.entries(SOURCE_TTL_HOURS).map(([retailerKey, hours]) => ({
    retailerKey,
    lastSeenAt: { $gte: new Date(referenceNow.getTime() - hours * 3600000) },
  }));
  const retained = {
    ...snapshotBase,
    $and: [
      ...snapshotBase.$and,
      { $or: [{ 'rawFacts.retainedPreviousData': true }, { 'rawFacts.retained': true }] },
      {
        $expr: {
          $and: [
            { $gte: [{ $ifNull: ['$rawFacts.retainedGraceHours', -1] }, 0] },
            {
              $gte: [
                '$lastSeenAt',
                {
                  $subtract: [
                    referenceNow,
                    { $multiply: [{ $ifNull: ['$rawFacts.retainedGraceHours', -1] }, 3600000] },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  };

  return {
    $or: [
      explicit,
      {
        ...snapshotBase,
        $or: [
          ...ttlClauses,
          {
            $expr: {
              $and: [
                { $gt: [{ $ifNull: ['$rawFacts.freshnessTtlHours', 0] }, 0] },
                {
                  $gte: [
                    '$lastSeenAt',
                    {
                      $subtract: [
                        referenceNow,
                        { $multiply: [{ $ifNull: ['$rawFacts.freshnessTtlHours', 0] }, 3600000] },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
      retained,
    ],
  };
}

function parseValidityDate(value, { endOfDay = false } = {}) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return viennaLocalDateToUtc(value.trim(), endOfDay);
  }
  return toDateOrNull(value);
}

function normalizeSourceText(offer = {}) {
  return [
    offer.sourceType,
    ...(Array.isArray(offer.sourceTypes) ? offer.sourceTypes : []),
    offer.rawFacts?.sourceType,
    offer.rawFacts?.sourceKey,
    offer.sourceUrl,
  ].filter(Boolean).join(' ').toLowerCase();
}

function isOfficialSnapshotSource(offer = {}) {
  if (offer.rawFacts?.snapshotCurrent !== true) return false;
  const sourceText = normalizeSourceText(offer);
  if (/aktionsfinder|marketguru|wogibtswas|aggregator|ppcv/.test(sourceText)) return false;
  return /official|algolia|mueller|müller|billa|bipa|dm|hofer|lidl|penny|spar|interspar|flyer|offers-page/.test(sourceText);
}

function getSourceTtlHours(offer = {}) {
  const configured = Number(
    offer.rawFacts?.freshnessTtlHours
      ?? offer.freshnessTtlHours
  );
  if (Number.isFinite(configured) && configured > 0) return configured;

  const retailerKey = String(offer.retailerKey || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(SOURCE_TTL_HOURS, retailerKey)) {
    return SOURCE_TTL_HOURS[retailerKey];
  }

  return null;
}

function hasOfferSpecificConfirmation(offer = {}) {
  const exactJobId = offer.crawlJobId || offer.rawFacts?.crawlJobId;
  const exactRunId = offer.crawlRunId || offer.rawFacts?.crawlRunId;
  const sourceRunId = offer.lastSeenSourceRunId || offer.rawFacts?.lastSeenSourceRunId;
  const sourceId = offer.sourceId || offer.rawFacts?.sourceId;
  const sourceRunStatus = String(offer.sourceRunStatus || offer.rawFacts?.sourceRunStatus || '').toLowerCase();
  const publishStatus = String(offer.publishStatus || '').toLowerCase();
  const dryRun = offer.rawFacts?.dryRun === true || offer.dryRun === true;

  return Boolean(
    sourceId
    && exactRunId
    && (exactJobId || sourceRunId)
    && sourceRunStatus === 'success'
    && !dryRun
    && !/partial|failed|blocked|zero|retained|stale|unknown/.test(publishStatus)
  );
}

function hasContradictoryValidity(validFrom, validTo) {
  return Boolean(validFrom && validTo && validFrom > validTo);
}

function buildDecision({
  eligible = false,
  validityClass,
  reasonCode,
  lastConfirmedAt = null,
  publicUntil = null,
  sourceTtlHours = null,
  gracePeriodHours = 0,
  evidenceType = 'none',
} = {}) {
  return {
    eligible,
    validityClass,
    reasonCode,
    lastConfirmedAt: lastConfirmedAt ? lastConfirmedAt.toISOString() : null,
    publicUntil: publicUntil ? publicUntil.toISOString() : null,
    sourceTtlHours,
    gracePeriodHours,
    evidenceType,
  };
}

function isPublicValidityEligible(offer = {}, now = new Date()) {
  const referenceNow = toDateOrNull(now) || new Date();
  const validFrom = parseValidityDate(offer.validFrom ?? offer.rawFacts?.validFrom);
  const validTo = parseValidityDate(offer.validTo ?? offer.rawFacts?.validTo, { endOfDay: true });

  if (hasContradictoryValidity(validFrom, validTo)) {
    return buildDecision({ validityClass: 'contradictory-validity', reasonCode: 'contradictory-validity' });
  }
  if (validFrom && validFrom > referenceNow) {
    return buildDecision({ validityClass: 'future', reasonCode: 'future-validFrom' });
  }
  if (validTo && validTo < referenceNow) {
    return buildDecision({ validityClass: 'expired', reasonCode: 'expired-validTo' });
  }
  if (validTo && (!validFrom || validFrom <= referenceNow)) {
    return buildDecision({
      eligible: true,
      validityClass: 'explicit-validity',
      reasonCode: 'explicit-validity-current',
      lastConfirmedAt: validFrom || null,
      publicUntil: validTo,
      evidenceType: 'explicit-validity',
    });
  }

  if (!isOfficialSnapshotSource(offer)) {
    return buildDecision({ validityClass: 'unknown', reasonCode: 'source-not-approved-snapshot' });
  }
  if (!hasOfferSpecificConfirmation(offer)) {
    return buildDecision({ validityClass: 'unknown', reasonCode: 'no-offer-specific-confirmation' });
  }

  const lastConfirmedAt = toDateOrNull(offer.lastSeenAt);
  const sourceTtlHours = getSourceTtlHours(offer);
  if (!lastConfirmedAt) {
    return buildDecision({ validityClass: 'unknown', reasonCode: 'missing-lastConfirmedAt', sourceTtlHours });
  }
  if (!sourceTtlHours) {
    return buildDecision({ validityClass: 'unknown', reasonCode: 'missing-source-ttl', lastConfirmedAt, sourceTtlHours });
  }

  const retained = offer.rawFacts?.retainedPreviousData === true
    || offer.rawFacts?.retained === true
    || /retained|previous-data/i.test(String(offer.deactivationReason || ''));
  const gracePeriodHours = Number(offer.rawFacts?.retainedGraceHours);
  if (retained) {
    if (!Number.isFinite(gracePeriodHours) || gracePeriodHours < 0) {
      return buildDecision({ validityClass: 'retained', reasonCode: 'retained-grace-not-configured', lastConfirmedAt, sourceTtlHours });
    }
    const publicUntil = new Date(lastConfirmedAt.getTime() + gracePeriodHours * 3600000);
    return buildDecision({
      eligible: publicUntil >= referenceNow,
      validityClass: 'retained',
      reasonCode: publicUntil >= referenceNow ? 'retained-within-grace' : 'retained-grace-expired',
      lastConfirmedAt,
      publicUntil,
      sourceTtlHours,
      gracePeriodHours,
      evidenceType: 'retained-confirmation',
    });
  }

  const publicUntil = new Date(lastConfirmedAt.getTime() + sourceTtlHours * 3600000);
  return buildDecision({
    eligible: publicUntil >= referenceNow,
    validityClass: 'snapshot-confirmed',
    reasonCode: publicUntil >= referenceNow ? 'snapshot-within-ttl' : 'snapshot-ttl-expired',
    lastConfirmedAt,
    publicUntil,
    sourceTtlHours,
    evidenceType: 'official-snapshot-lineage',
  });
}

module.exports = {
  PUBLIC_VALIDITY_VERSION,
  SOURCE_TTL_HOURS,
  DAY_MS,
  getSourceTtlHours,
  buildPublicValidityMongoMatch,
  isOfficialSnapshotSource,
  isPublicValidityEligible,
  parseValidityDate,
  viennaLocalDateToUtc,
};
