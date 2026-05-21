const Source = require('../../models/Source');
const { RETAILER_DEFINITIONS } = require('./sourceDefinitions');

function inferSourceType(definition) {
  if (definition.sourceType) {
    return definition.sourceType;
  }

  if (definition.channel === 'official-flyer') {
    return 'flyer';
  }

  if (definition.channel === 'official-site') {
    return 'offers-page';
  }

  if (definition.channel === 'aggregator') {
    return 'aggregator';
  }

  return 'other';
}

function sourceIdentity({ retailerKey, sourceUrl } = {}) {
  return `${String(retailerKey || '').trim().toLowerCase()}::${String(sourceUrl || '').trim()}`;
}

function buildSourceUrlDefinitionCounts(definitions = []) {
  const counts = new Map();

  for (const definition of definitions) {
    const sourceUrl = String(definition.sourceUrl || '').trim();
    counts.set(sourceUrl, (counts.get(sourceUrl) || 0) + 1);
  }

  return counts;
}

async function preserveUniqueSourceIdsForRetailerSplit(definitions = []) {
  const sourceUrlCounts = buildSourceUrlDefinitionCounts(definitions);

  for (const definition of definitions) {
    const sourceUrl = String(definition.sourceUrl || '').trim();

    if (!sourceUrl || sourceUrlCounts.get(sourceUrl) !== 1) {
      continue;
    }

    const existingSources = await Source.find({ sourceUrl }).select('_id retailerKey sourceUrl').lean();

    if (existingSources.length !== 1) {
      continue;
    }

    const existing = existingSources[0];

    if (existing.retailerKey === definition.retailerKey) {
      continue;
    }

    await Source.updateOne(
      { _id: existing._id },
      { $set: { retailerKey: definition.retailerKey } }
    );
  }
}

async function ensureSourceRegistry() {
  const validSourceUrls = RETAILER_DEFINITIONS.map((definition) => definition.sourceUrl);
  const validSourceIdentities = new Set(RETAILER_DEFINITIONS.map(sourceIdentity));

  await preserveUniqueSourceIdsForRetailerSplit(RETAILER_DEFINITIONS);

  await Source.updateMany(
    {
      sourceUrl: { $nin: validSourceUrls },
    },
    {
      $set: {
        active: false,
        latestStatus: 'inactive',
      },
    }
  );

  const operations = RETAILER_DEFINITIONS.map((definition) => ({
    updateOne: {
      filter: {
        retailerKey: definition.retailerKey,
        sourceUrl: definition.sourceUrl,
      },
      update: {
        $set: {
          ...definition,
          sourceType: inferSourceType(definition),
          enabled: definition.enabled !== false,
          priority: Number(definition.priority ?? 50),
          crawlPolicy: {
            maxConcurrencyPerDomain: 1,
            delayMs: 1200,
            timeoutMs: 30000,
            respectRobotsTxt: true,
            ...(definition.crawlPolicy || {}),
          },
          parserHint: definition.parserHint || inferSourceType(definition),
          parserVersion: definition.parserVersion || '',
          normalizationVersion: definition.normalizationVersion || 'v3-audit',
          regionScope: definition.regionScope || 'Grossraum Graz',
          active: true,
        },
      },
      upsert: true,
    },
  }));

  if (operations.length > 0) {
    await Source.bulkWrite(operations, { ordered: false });
  }

  const allSources = await Source.find().select('_id retailerKey sourceUrl').lean();
  const invalidIdentityIds = allSources
    .filter((source) => !validSourceIdentities.has(sourceIdentity(source)))
    .map((source) => source._id);

  if (invalidIdentityIds.length > 0) {
    await Source.updateMany(
      { _id: { $in: invalidIdentityIds } },
      {
        $set: {
          active: false,
          latestStatus: 'inactive',
        },
      }
    );
  }

  return Source.find().sort({ retailerName: 1 }).lean();
}

module.exports = {
  ensureSourceRegistry,
  __private: {
    sourceIdentity,
    buildSourceUrlDefinitionCounts,
  },
};
