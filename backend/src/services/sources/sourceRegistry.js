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

async function ensureSourceRegistry() {
  const validSourceUrls = RETAILER_DEFINITIONS.map((definition) => definition.sourceUrl);

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
          regionScope: 'Grossraum Graz',
          active: true,
        },
      },
      upsert: true,
    },
  }));

  if (operations.length > 0) {
    await Source.bulkWrite(operations, { ordered: false });
  }

  return Source.find().sort({ retailerName: 1 }).lean();
}

module.exports = {
  ensureSourceRegistry,
};
