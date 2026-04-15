const Offer = require('../../models/Offer');
const Source = require('../../models/Source');
const { dedupeSourceEvidence } = require('./sourceEvidence');

const CHANNEL_PRIORITY = {
  'official-flyer': 0,
  'official-site': 1,
  aggregator: 2,
  other: 3,
};

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDedupeKey(offer) {
  return [
    offer.retailerKey,
    normalizeTitle(offer.title),
    String(offer.priceCurrent?.amount ?? ''),
    String(offer.normalizedUnitPrice?.amount ?? ''),
    String(offer.normalizedUnitPrice?.unit ?? ''),
    String(offer.quantityText || ''),
    offer.validFrom ? new Date(offer.validFrom).toISOString().slice(0, 10) : '',
    offer.validTo ? new Date(offer.validTo).toISOString().slice(0, 10) : '',
  ].join('::');
}

function getPriority(source) {
  return CHANNEL_PRIORITY[source?.channel] ?? 99;
}

async function dedupeOffersAcrossSources({ retailerKeys = [] } = {}) {
  const filters = retailerKeys.length > 0 ? { retailerKey: { $in: retailerKeys } } : {};
  const [offers, sources] = await Promise.all([
    Offer.find(filters)
      .select('_id retailerKey sourceId title priceCurrent normalizedUnitPrice quantityText validFrom validTo createdAt supportingSources')
      .lean(),
    Source.find().select('_id channel retailerKey sourceUrl').lean(),
  ]);

  const sourceMap = new Map(sources.map((source) => [String(source._id), source]));
  const groups = new Map();

  for (const offer of offers) {
    const key = buildDedupeKey(offer);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(offer);
  }

  const duplicateIdsToDelete = [];
  const updates = [];
  let duplicateGroups = 0;

  for (const groupOffers of groups.values()) {
    if (groupOffers.length <= 1) {
      continue;
    }

    duplicateGroups += 1;

    const sorted = [...groupOffers].sort((left, right) => {
      const leftPriority = getPriority(sourceMap.get(String(left.sourceId)));
      const rightPriority = getPriority(sourceMap.get(String(right.sourceId)));

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });

    const canonical = sorted[0];
    const mergedSupportingSources = dedupeSourceEvidence(
      sorted.flatMap((offer) => offer.supportingSources || [])
    );

    updates.push({
      updateOne: {
        filter: { _id: canonical._id },
        update: {
          $set: {
            supportingSources: mergedSupportingSources,
          },
        },
      },
    });

    duplicateIdsToDelete.push(...sorted.slice(1).map((offer) => offer._id));
  }

  if (updates.length > 0) {
    await Offer.bulkWrite(updates, { ordered: false });
  }

  if (duplicateIdsToDelete.length > 0) {
    await Offer.deleteMany({ _id: { $in: duplicateIdsToDelete } });
  }

  return {
    duplicateGroups,
    removedOffers: duplicateIdsToDelete.length,
  };
}

module.exports = {
  dedupeOffersAcrossSources,
};
