const Source = require('../../models/Source');
const { RETAILER_DEFINITIONS } = require('./sourceDefinitions');

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
