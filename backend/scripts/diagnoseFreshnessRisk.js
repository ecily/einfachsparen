const mongoose = require('mongoose');
const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const { deriveSourceKey } = require('../src/services/crawl/crawlSourceSelection');
const {
  hasExpiredUrlRange,
  isSnapshotTooOld,
  parseAktionsfinderDateRange,
} = require('../src/services/offers/offerFreshness');

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sourceIdString(value) {
  return String(value || '');
}

function groupKeyFor({ offer, source }) {
  return JSON.stringify({
    retailerKey: offer.retailerKey || '',
    sourceKey: source ? deriveSourceKey(source) : '',
    sourceType: offer.sourceType || '',
  });
}

function parseGroupKey(key) {
  try {
    return JSON.parse(key);
  } catch (error) {
    return { retailerKey: '', sourceKey: '', sourceType: '' };
  }
}

function summarizeOffer(offer, source) {
  const urls = [
    offer.sourceUrl,
    offer.rawFacts?.clickoutUrl,
    offer.rawFacts?.leafletHref,
  ].filter(Boolean);
  const urlRange = urls.map(parseAktionsfinderDateRange).find((range) => range.validTo) || {};

  return {
    title: offer.title || '',
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
    sourceKey: source ? deriveSourceKey(source) : '',
    sourceType: offer.sourceType || '',
    sourceUrl: offer.sourceUrl || '',
    validFrom: iso(offer.validFrom || urlRange.validFrom),
    validTo: iso(offer.validTo || urlRange.validTo),
    isActiveNow: Boolean(offer.isActiveNow),
    lastSeenAt: iso(offer.lastSeenAt),
    crawlJobId: sourceIdString(offer.crawlJobId),
    syncedAt: iso(offer.updatedAt),
    priceCurrent: offer.priceCurrent?.amount ?? null,
  };
}

async function main() {
  await connectToDatabase();

  const now = new Date();
  const activeAktionsfinderMatch = {
    status: 'active',
    isActiveNow: true,
    $or: [
      { sourceType: /aktionsfinder/i },
      { sourceUrl: /aktionsfinder\.at/i },
      { 'rawFacts.sourceType': /aktionsfinder/i },
      { 'rawFacts.clickoutUrl': /aktionsfinder\.at/i },
      { 'rawFacts.leafletHref': /aktionsfinder\.at/i },
    ],
  };

  const activeAktionsfinderCount = await Offer.countDocuments(activeAktionsfinderMatch);
  const sourceIds = await Offer.distinct('sourceId', activeAktionsfinderMatch);
  const sources = await Source.find({ _id: { $in: sourceIds } })
    .select('retailerKey retailerName channel label sourceUrl sourceType sourceRetailerFormat latestRunAt latestStatus')
    .lean();
  const sourceById = new Map(sources.map((source) => [sourceIdString(source._id), source]));
  const cursor = Offer.find(activeAktionsfinderMatch)
    .select('title retailerKey retailerName sourceId sourceType sourceUrl rawFacts validFrom validTo isActiveNow lastSeenAt crawlJobId updatedAt priceCurrent')
    .lean()
    .cursor();
  const expiredUrlGroups = new Map();
  const staleNoValidToGroups = new Map();
  const expiredExamples = [];
  const staleExamples = [];

  for await (const offer of cursor) {
    const source = sourceById.get(sourceIdString(offer.sourceId)) || null;
    const groupKey = groupKeyFor({ offer, source });

    if (hasExpiredUrlRange(offer, now)) {
      expiredUrlGroups.set(groupKey, (expiredUrlGroups.get(groupKey) || 0) + 1);
      if (expiredExamples.length < 10) {
        expiredExamples.push(summarizeOffer(offer, source));
      }
    }

    if (isSnapshotTooOld(offer, now)) {
      staleNoValidToGroups.set(groupKey, (staleNoValidToGroups.get(groupKey) || 0) + 1);
      if (staleExamples.length < 10) {
        staleExamples.push(summarizeOffer(offer, source));
      }
    }
  }

  const formatGroups = (map) => [...map.entries()]
    .map(([key, count]) => ({
      ...parseGroupKey(key),
      count,
    }))
    .sort((left, right) => right.count - left.count || left.retailerKey.localeCompare(right.retailerKey));

  console.log(JSON.stringify({
    generatedAt: now.toISOString(),
    readOnly: true,
    activeAktionsfinderCount,
    expiredAktionsfinderUrlRange: {
      count: [...expiredUrlGroups.values()].reduce((sum, count) => sum + count, 0),
      groups: formatGroups(expiredUrlGroups),
      examples: expiredExamples,
    },
    staleMissingValidTo: {
      maxAgeDays: 14,
      count: [...staleNoValidToGroups.values()].reduce((sum, count) => sum + count, 0),
      groups: formatGroups(staleNoValidToGroups),
      examples: staleExamples,
    },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      readOnly: true,
      error: error?.name || 'Error',
      message: error?.message || 'Freshness diagnosis failed.',
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
