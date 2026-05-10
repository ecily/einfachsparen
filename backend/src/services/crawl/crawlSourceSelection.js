const mongoose = require('mongoose');

const QUERY_MAX_TIME_MS = 1500;

function compactStrings(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeSourceKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deriveSourceKey(source = {}) {
  const url = String(source.sourceUrl || '').toLowerCase();
  const format = normalizeSourceKey(source.sourceRetailerFormat || source.retailerKey || 'unknown');

  if (url.includes('aktionsfinder.at')) return `aktionsfinder-${format}`;
  if (url.includes('marktguru.at')) return `marktguru-${format}`;
  if (url.includes('wogibtswas.at')) return `wogibtswas-${format}`;
  if (url.includes('spar.at')) return 'spar-official-flyer';
  if (url.includes('billa.at')) return `${format || 'billa'}-${source.channel || 'official'}-${source.sourceType || 'source'}`;
  if (url.includes('hofer.at')) return 'hofer-official-flyer';
  if (url.includes('lidl.at')) return 'lidl-official-flyer';
  if (url.includes('penny.at')) return `penny-${source.channel || 'official'}-${source.sourceType || 'source'}`;
  if (url.includes('dm.at')) return 'dm-official-site';
  if (url.includes('bipa.at')) return 'bipa-official-site';

  return normalizeSourceKey([
    source.retailerKey,
    source.channel,
    source.sourceType,
    source.label,
  ].filter(Boolean).join('-')) || 'unknown-source';
}

function sourceIdString(source = {}) {
  return String(source._id || source.id || '');
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ''));
}

function sourceIsRunnable(source = {}, { allowDisabled = false } = {}) {
  if (source.active === false) return false;
  if (!allowDisabled && source.enabled === false) return false;
  return true;
}

function summarizeSource(source = {}) {
  return {
    sourceId: sourceIdString(source),
    sourceKey: deriveSourceKey(source),
    retailerKey: source.retailerKey || '',
    retailerName: source.retailerName || '',
    channel: source.channel || '',
    label: source.label || '',
    sourceUrl: source.sourceUrl || '',
    sourceType: source.sourceType || '',
    sourceRetailerFormat: source.sourceRetailerFormat || '',
    enabled: source.enabled !== false,
    active: source.active !== false,
    latestRunAt: source.latestRunAt || null,
    latestStatus: source.latestStatus || '',
    disabledReason: source.disabledReason || '',
    notes: source.notes || '',
  };
}

function sortSourcesForCrawl(sources = [], activeOfferCountMap = new Map()) {
  const channelPriority = {
    'official-site': 0,
    'official-flyer': 1,
    aggregator: 2,
    other: 3,
  };
  const retailerPriority = {
    spar: 0,
    lidl: 1,
    penny: 2,
    dm: 3,
    pagro: 4,
    bipa: 5,
    adeg: 6,
    hofer: 7,
    billa: 8,
    'billa-plus': 9,
  };

  return [...sources].sort((left, right) => {
    const leftRetailerPriority = retailerPriority[left.retailerKey] ?? 50;
    const rightRetailerPriority = retailerPriority[right.retailerKey] ?? 50;

    if (leftRetailerPriority !== rightRetailerPriority) {
      return leftRetailerPriority - rightRetailerPriority;
    }

    const leftCoverage = activeOfferCountMap.get(left.retailerKey) ?? 0;
    const rightCoverage = activeOfferCountMap.get(right.retailerKey) ?? 0;

    if (leftCoverage !== rightCoverage) {
      return leftCoverage - rightCoverage;
    }

    const leftChannelPriority = channelPriority[left.channel] ?? 99;
    const rightChannelPriority = channelPriority[right.channel] ?? 99;

    if (leftChannelPriority !== rightChannelPriority) {
      return leftChannelPriority - rightChannelPriority;
    }

    const leftSourcePriority = Number(left.priority ?? 50);
    const rightSourcePriority = Number(right.priority ?? 50);

    if (leftSourcePriority !== rightSourcePriority) {
      return leftSourcePriority - rightSourcePriority;
    }

    return `${left.retailerName} ${left.label}`.localeCompare(`${right.retailerName} ${right.label}`, 'de');
  });
}

function buildSourceSelectionError(message, details = {}) {
  const error = new Error(message);
  error.statusCode = 400;
  error.details = details;
  return error;
}

function validateSelectionRequest({
  retailerKeys = [],
  sourceKeys = [],
  sourceIds = [],
  sourceSelectionRequested = false,
  dryRun = false,
} = {}) {
  if (sourceSelectionRequested && sourceKeys.length === 0 && sourceIds.length === 0) {
    throw buildSourceSelectionError('sourceKeys/sourceIds selection was requested but no valid source key or id was provided.');
  }

  if (dryRun && retailerKeys.length === 0 && sourceKeys.length === 0 && sourceIds.length === 0) {
    throw buildSourceSelectionError('dryRun requires at least one retailerKey, sourceKey or sourceId.');
  }
}

function buildSourceMongoFilter({ retailerKeys = [], sourceIds = [], allowDisabled = false, sourceSelectionRequested = false } = {}) {
  const filter = {
    active: true,
  };

  if (!allowDisabled) {
    filter.enabled = { $ne: false };
  }

  if (retailerKeys.length > 0 && !sourceSelectionRequested) {
    filter.retailerKey = { $in: retailerKeys };
  }

  if (sourceIds.length > 0) {
    const objectIds = sourceIds.filter(isValidObjectId);
    filter._id = objectIds.length > 0 ? { $in: objectIds } : { $in: [] };
  }

  if (sourceSelectionRequested) {
    delete filter.enabled;
  }

  return filter;
}

function applySourceSelection({ sources = [], retailerKeys = [], sourceKeys = [], sourceIds = [], allowDisabled = false } = {}) {
  const retailerSet = new Set(retailerKeys);
  const requestedKeySet = new Set(sourceKeys.map(normalizeSourceKey));
  const requestedIdSet = new Set(sourceIds.map(String));
  const matchedKeySet = new Set();
  const matchedIdSet = new Set();
  const selectedSources = [];
  const disabledSources = [];
  const skippedSources = [];

  for (const source of sources) {
    const sourceKey = deriveSourceKey(source);
    const sourceId = sourceIdString(source);
    const keyMatches = requestedKeySet.size === 0 || requestedKeySet.has(sourceKey);
    const idMatches = requestedIdSet.size === 0 || requestedIdSet.has(sourceId);
    const retailerMatches = retailerSet.size === 0 || retailerSet.has(source.retailerKey);

    if (!keyMatches || !idMatches) {
      continue;
    }

    if (requestedKeySet.has(sourceKey)) matchedKeySet.add(sourceKey);
    if (requestedIdSet.has(sourceId)) matchedIdSet.add(sourceId);

    if (!retailerMatches) {
      skippedSources.push({
        ...summarizeSource(source),
        skippedReason: 'retailer-filter',
      });
      continue;
    }

    if (!sourceIsRunnable(source, { allowDisabled })) {
      disabledSources.push({
        ...summarizeSource(source),
        skippedReason: source.active === false ? 'inactive-source' : 'disabled-source',
      });
      continue;
    }

    selectedSources.push(source);
  }

  const unknownSourceKeys = [...requestedKeySet].filter((key) => !matchedKeySet.has(key));
  const unknownSourceIds = [...requestedIdSet].filter((id) => !matchedIdSet.has(id));

  return {
    selectedSources,
    skippedSources,
    disabledSources,
    unknownSourceKeys,
    unknownSourceIds,
  };
}

async function fetchActiveOfferCountMap({ Offer, retailerKeys = [] } = {}) {
  const rows = await Offer.aggregate([
    {
      $match: retailerKeys.length > 0
        ? { retailerKey: { $in: retailerKeys }, status: 'active', isActiveNow: true }
        : { status: 'active', isActiveNow: true },
    },
    {
      $group: {
        _id: '$retailerKey',
        activeOfferCount: { $sum: 1 },
      },
    },
  ]);

  return new Map(rows.map((item) => [String(item._id || ''), Number(item.activeOfferCount || 0)]));
}

async function resolveCrawlSourceSelection({
  Source,
  Offer,
  retailerKeys = [],
  sourceKeys = [],
  sourceIds = [],
  allowDisabled = false,
  dryRun = false,
  sourceSelectionRequested = false,
} = {}) {
  const normalizedRetailerKeys = compactStrings(retailerKeys).map(normalizeSourceKey);
  const normalizedSourceKeys = compactStrings(sourceKeys).map(normalizeSourceKey);
  const normalizedSourceIds = compactStrings(sourceIds);

  validateSelectionRequest({
    retailerKeys: normalizedRetailerKeys,
    sourceKeys: normalizedSourceKeys,
    sourceIds: normalizedSourceIds,
    sourceSelectionRequested,
    dryRun,
  });

  const filter = buildSourceMongoFilter({
    retailerKeys: normalizedRetailerKeys,
    sourceIds: normalizedSourceIds,
    allowDisabled,
    sourceSelectionRequested: sourceSelectionRequested || normalizedSourceKeys.length > 0,
  });
  const sourceQuery = Source.find(filter);
  if (typeof sourceQuery.maxTimeMS === 'function') {
    sourceQuery.maxTimeMS(QUERY_MAX_TIME_MS);
  }
  let sourcesPromise = sourceQuery;

  if (typeof sourceQuery.lean === 'function') {
    sourcesPromise = sourceQuery.lean();
  }

  const sources = await sourcesPromise;
  const selection = applySourceSelection({
    sources,
    retailerKeys: normalizedRetailerKeys,
    sourceKeys: normalizedSourceKeys,
    sourceIds: normalizedSourceIds,
    allowDisabled,
  });

  if (selection.unknownSourceKeys.length > 0 || selection.unknownSourceIds.length > 0) {
    throw buildSourceSelectionError('Unknown sourceKeys/sourceIds requested.', {
      unknownSourceKeys: selection.unknownSourceKeys,
      unknownSourceIds: selection.unknownSourceIds,
    });
  }

  if ((sourceSelectionRequested || dryRun) && selection.selectedSources.length === 0) {
    throw buildSourceSelectionError('No runnable sources matched the requested selection.', {
      disabledSources: selection.disabledSources,
      skippedSources: selection.skippedSources,
    });
  }

  const activeOfferCountMap = await fetchActiveOfferCountMap({
    Offer,
    retailerKeys: normalizedRetailerKeys,
  });
  const sortedSources = sortSourcesForCrawl(selection.selectedSources, activeOfferCountMap);

  return {
    sourceSelectionRequested,
    dryRun,
    allowDisabled,
    filter,
    sources: sortedSources,
    matchedSources: sortedSources.map(summarizeSource),
    skippedSources: selection.skippedSources,
    disabledSources: selection.disabledSources,
    unknownSourceKeys: [],
    unknownSourceIds: [],
    effectiveRetailerKeys: [...new Set(sortedSources.map((source) => source.retailerKey).filter(Boolean))],
    requestedRetailerKeys: normalizedRetailerKeys,
    requestedSourceKeys: normalizedSourceKeys,
    requestedSourceIds: normalizedSourceIds,
    wouldRunCount: sortedSources.length,
  };
}

module.exports = {
  applySourceSelection,
  buildSourceMongoFilter,
  compactStrings,
  deriveSourceKey,
  normalizeSourceKey,
  resolveCrawlSourceSelection,
  sortSourcesForCrawl,
  summarizeSource,
  validateSelectionRequest,
};
