const { deriveSourceKey } = require('../crawl/crawlSourceSelection');

const DEFAULT_MAX_AGE_DAYS = 14;
const DEFAULT_EXAMPLE_LIMIT = 20;
const REPAIR_REASON = 'freshness-repair-stale-aktionsfinder';

function compactStrings(values = []) {
  const list = Array.isArray(values) ? values : String(values || '').split(',');
  return [...new Set(list.map((value) => String(value || '').trim()).filter(Boolean))];
}

function sourceIdString(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value._id && value._id !== value) return sourceIdString(value._id);
  return String(value);
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAktionsfinderEvidenceMatch() {
  return {
    $or: [
      { sourceType: /aktionsfinder/i },
      { sourceTypes: /aktionsfinder/i },
      { sourceUrl: /aktionsfinder\.at/i },
      { sourceUrls: /aktionsfinder\.at/i },
      { evidenceUrls: /aktionsfinder\.at/i },
      { 'rawFacts.sourceType': /aktionsfinder/i },
      { 'rawFacts.clickoutUrl': /aktionsfinder\.at/i },
      { 'rawFacts.leafletHref': /aktionsfinder\.at/i },
    ],
  };
}

function buildStaleDateMatch(cutoff) {
  return {
    $or: [
      { lastSeenAt: { $lte: cutoff } },
      { lastSeenAt: null, updatedAt: { $lte: cutoff } },
      { lastSeenAt: { $exists: false }, updatedAt: { $lte: cutoff } },
      { lastSeenAt: null, updatedAt: null, createdAt: { $lte: cutoff } },
      { lastSeenAt: { $exists: false }, updatedAt: { $exists: false }, createdAt: { $lte: cutoff } },
    ],
  };
}

function buildTitleMatch(titleIncludes = '') {
  const clean = String(titleIncludes || '').trim();
  if (!clean) return null;

  const regex = new RegExp(escapeRegexLiteral(clean), 'i');
  return {
    $or: [
      { title: regex },
      { titleNormalized: regex },
      { searchText: regex },
    ],
  };
}

function buildRepairMatch({
  now = new Date(),
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
  retailerKeys = [],
  sourceIds = [],
  titleIncludes = '',
} = {}) {
  const cutoff = new Date(now.getTime() - Number(maxAgeDays || DEFAULT_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000);
  const and = [
    buildAktionsfinderEvidenceMatch(),
    buildStaleDateMatch(cutoff),
  ];
  const titleMatch = buildTitleMatch(titleIncludes);
  const retailerList = compactStrings(retailerKeys);
  const sourceIdList = compactStrings(sourceIds);
  const match = {
    status: 'active',
    isActiveNow: true,
    validTo: null,
    $and: and,
  };

  if (titleMatch) {
    and.push(titleMatch);
  }

  if (retailerList.length > 0) {
    match.retailerKey = { $in: retailerList };
  }

  if (sourceIdList.length > 0) {
    match.sourceId = { $in: sourceIdList };
  }

  return {
    match,
    cutoff,
  };
}

function sourceMatchesKey(source, requestedSourceKeys = []) {
  const keys = compactStrings(requestedSourceKeys);
  if (keys.length === 0) return true;
  return keys.includes(deriveSourceKey(source));
}

async function resolveSources({ SourceModel, sourceKeys = [], retailerKeys = [] } = {}) {
  if (!SourceModel || (compactStrings(sourceKeys).length === 0 && compactStrings(retailerKeys).length === 0)) {
    return [];
  }

  const filter = {};
  const retailerList = compactStrings(retailerKeys);
  if (retailerList.length > 0) {
    filter.retailerKey = { $in: retailerList };
  }

  const query = SourceModel.find(filter).select('retailerKey retailerName channel label sourceUrl sourceType sourceRetailerFormat latestRunAt latestStatus');
  const sources = typeof query.lean === 'function' ? await query.lean() : await query;

  return sources.filter((source) => sourceMatchesKey(source, sourceKeys));
}

function summarizeOffer(offer = {}, sourceById = new Map()) {
  const source = sourceById.get(sourceIdString(offer.sourceId)) || null;

  return {
    id: sourceIdString(offer._id || offer.id),
    title: offer.title || '',
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
    sourceKey: source ? deriveSourceKey(source) : '',
    sourceType: offer.sourceType || offer.rawFacts?.sourceType || '',
    sourceUrl: offer.sourceUrl || '',
    rawFactsClickoutUrl: offer.rawFacts?.clickoutUrl || '',
    rawFactsLeafletHref: offer.rawFacts?.leafletHref || '',
    validFrom: iso(offer.validFrom),
    validTo: iso(offer.validTo),
    isActiveNow: Boolean(offer.isActiveNow),
    createdAt: iso(offer.createdAt),
    updatedAt: iso(offer.updatedAt),
    lastSeenAt: iso(offer.lastSeenAt),
    crawlJobId: sourceIdString(offer.crawlJobId),
    lastSeenRunId: sourceIdString(offer.lastSeenRunId || offer.lastSeenSourceRunId),
    priceCurrent: offer.priceCurrent?.amount ?? null,
  };
}

function groupKeyForOffer(offer = {}, sourceById = new Map()) {
  const source = sourceById.get(sourceIdString(offer.sourceId)) || null;
  return JSON.stringify({
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
    sourceKey: source ? deriveSourceKey(source) : '',
    sourceType: offer.sourceType || offer.rawFacts?.sourceType || '',
  });
}

function parseGroupKey(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return {
      retailerKey: '',
      retailerName: '',
      sourceKey: '',
      sourceType: '',
    };
  }
}

function groupOffers(offers = [], sourceById = new Map()) {
  const groups = new Map();

  for (const offer of offers) {
    const key = groupKeyForOffer(offer, sourceById);
    groups.set(key, (groups.get(key) || 0) + 1);
  }

  return [...groups.entries()]
    .map(([key, count]) => ({
      ...parseGroupKey(key),
      count,
    }))
    .sort((left, right) => right.count - left.count || left.retailerKey.localeCompare(right.retailerKey));
}

function buildSoftDeactivationUpdate({ now = new Date(), reason = REPAIR_REASON } = {}) {
  return {
    $set: {
      status: 'expired',
      isActiveNow: false,
      isActiveToday: false,
      deactivatedAt: now,
      deactivationReason: reason,
      'rawFacts.freshnessRepair': {
        reason,
        repairedAt: now,
        mode: 'soft-deactivation',
      },
    },
  };
}

function isAktionsfinderOffer(offer = {}) {
  const haystack = [
    offer.sourceType,
    ...(Array.isArray(offer.sourceTypes) ? offer.sourceTypes : []),
    offer.sourceUrl,
    ...(Array.isArray(offer.sourceUrls) ? offer.sourceUrls : []),
    ...(Array.isArray(offer.evidenceUrls) ? offer.evidenceUrls : []),
    offer.rawFacts?.sourceType,
    offer.rawFacts?.clickoutUrl,
    offer.rawFacts?.leafletHref,
  ].join(' ');

  return /aktionsfinder/i.test(haystack);
}

function isRepairEligibleOffer(offer = {}, { now = new Date(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  if (offer.status !== 'active' || offer.isActiveNow !== true || offer.validTo) return false;
  if (!isAktionsfinderOffer(offer)) return false;

  const reference = dateOrNull(offer.lastSeenAt) || dateOrNull(offer.updatedAt) || dateOrNull(offer.createdAt);
  if (!reference) return false;

  return now.getTime() - reference.getTime() > Number(maxAgeDays || DEFAULT_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;
}

async function runStaleAktionsfinderRepair({
  OfferModel,
  SourceModel = null,
  apply = false,
  now = new Date(),
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
  retailerKeys = [],
  sourceKeys = [],
  titleIncludes = '',
  exampleLimit = DEFAULT_EXAMPLE_LIMIT,
} = {}) {
  if (!OfferModel) {
    throw new Error('OfferModel is required.');
  }

  const sources = await resolveSources({ SourceModel, sourceKeys, retailerKeys });
  const sourceIds = compactStrings(sourceKeys).length > 0 ? sources.map((source) => sourceIdString(source._id)) : [];
  const sourceById = new Map(sources.map((source) => [sourceIdString(source._id), source]));
  const { match, cutoff } = buildRepairMatch({
    now,
    maxAgeDays,
    retailerKeys,
    sourceIds,
    titleIncludes,
  });

  if (compactStrings(sourceKeys).length > 0 && sourceIds.length === 0) {
    return {
      ok: true,
      dryRun: !apply,
      applied: false,
      reason: 'no-matching-source-keys',
      matchedCount: 0,
      wouldDeactivateCount: 0,
      deactivatedCount: 0,
      cutoff: cutoff.toISOString(),
      groups: [],
      examples: [],
    };
  }

  const matchedCount = await OfferModel.countDocuments(match);
  const query = OfferModel.find(match)
    .select('title retailerKey retailerName sourceId sourceType sourceUrl rawFacts validFrom validTo isActiveNow createdAt updatedAt lastSeenAt crawlJobId priceCurrent')
    .sort({ lastSeenAt: 1, updatedAt: 1, createdAt: 1 })
    .limit(exampleLimit);
  const examplesRaw = typeof query.lean === 'function' ? await query.lean() : await query;
  const groups = groupOffers(examplesRaw, sourceById);
  const examples = examplesRaw.map((offer) => summarizeOffer(offer, sourceById));
  let deactivatedCount = 0;

  if (apply && matchedCount > 0) {
    const updateResult = await OfferModel.updateMany(match, buildSoftDeactivationUpdate({ now }));
    deactivatedCount = Number(updateResult?.modifiedCount ?? updateResult?.nModified ?? 0);
  }

  return {
    ok: true,
    dryRun: !apply,
    applied: Boolean(apply),
    matchedCount,
    wouldDeactivateCount: matchedCount,
    deactivatedCount,
    cutoff: cutoff.toISOString(),
    maxAgeDays,
    groups,
    examples,
  };
}

module.exports = {
  DEFAULT_EXAMPLE_LIMIT,
  DEFAULT_MAX_AGE_DAYS,
  REPAIR_REASON,
  buildRepairMatch,
  buildSoftDeactivationUpdate,
  compactStrings,
  isRepairEligibleOffer,
  runStaleAktionsfinderRepair,
  summarizeOffer,
};
