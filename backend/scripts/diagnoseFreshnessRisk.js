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

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function groupKeyFor({ offer, source }) {
  return JSON.stringify({
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
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
    sourceLatestRunAt: iso(source?.latestRunAt),
    sourceLatestStatus: source?.latestStatus || '',
    sourceType: offer.sourceType || '',
    sourceUrl: offer.sourceUrl || '',
    rawFactsClickoutUrl: offer.rawFacts?.clickoutUrl || '',
    rawFactsLeafletHref: offer.rawFacts?.leafletHref || '',
    validFrom: iso(offer.validFrom || urlRange.validFrom),
    validTo: iso(offer.validTo || urlRange.validTo),
    isActiveNow: Boolean(offer.isActiveNow),
    createdAt: iso(offer.createdAt),
    updatedAt: iso(offer.updatedAt),
    lastSeenAt: iso(offer.lastSeenAt),
    lastSeenRunId: sourceIdString(offer.lastSeenRunId || offer.lastSeenSourceRunId),
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
      { sourceTypes: /aktionsfinder/i },
      { sourceUrl: /aktionsfinder\.at/i },
      { sourceUrls: /aktionsfinder\.at/i },
      { evidenceUrls: /aktionsfinder\.at/i },
      { 'rawFacts.sourceType': /aktionsfinder/i },
      { 'rawFacts.clickoutUrl': /aktionsfinder\.at/i },
      { 'rawFacts.leafletHref': /aktionsfinder\.at/i },
    ],
  };

  const activeAktionsfinderCount = await Offer.countDocuments(activeAktionsfinderMatch);
  const activeAktionsfinderMissingValidToMatch = {
    ...activeAktionsfinderMatch,
    validTo: null,
  };
  const activeAktionsfinderMissingValidToCount = await Offer.countDocuments(activeAktionsfinderMissingValidToMatch);
  const sourceIds = await Offer.distinct('sourceId', activeAktionsfinderMatch);
  const sources = await Source.find({ _id: { $in: sourceIds } })
    .select('retailerKey retailerName channel label sourceUrl sourceType sourceRetailerFormat latestRunAt latestStatus')
    .lean();
  const sourceById = new Map(sources.map((source) => [sourceIdString(source._id), source]));
  const cursor = Offer.find(activeAktionsfinderMatch)
    .select('title titleNormalized categorySecondary categoryKey retailerKey retailerName sourceId sourceType sourceUrl sourceRetailerFormat retailerFormatLabel rawFacts validFrom validTo isActiveNow createdAt updatedAt lastSeenAt lastSeenRunId lastSeenSourceRunId crawlJobId priceCurrent')
    .lean()
    .cursor();
  const expiredUrlGroups = new Map();
  const staleNoValidToGroups = new Map();
  const activeMissingValidToGroups = new Map();
  const expiredExamples = [];
  const staleExamples = [];
  const activeMissingValidToExamples = [];
  const queryExamples = {
    goesserMaerzen: [],
    goesser: [],
    bier: [],
    sparFormats: [],
  };

  for await (const offer of cursor) {
    const source = sourceById.get(sourceIdString(offer.sourceId)) || null;
    const groupKey = groupKeyFor({ offer, source });
    const titleText = normalizeText(`${offer.title || ''} ${offer.titleNormalized || ''} ${offer.categorySecondary || ''} ${offer.categoryKey || ''}`);

    if (!offer.validTo) {
      activeMissingValidToGroups.set(groupKey, (activeMissingValidToGroups.get(groupKey) || 0) + 1);
      if (activeMissingValidToExamples.length < 20) {
        activeMissingValidToExamples.push(summarizeOffer(offer, source));
      }
    }

    if (/gosser|goesser/.test(titleText) && /marzen|maerzen/.test(titleText) && queryExamples.goesserMaerzen.length < 15) {
      queryExamples.goesserMaerzen.push(summarizeOffer(offer, source));
    }

    if (/gosser|goesser/.test(titleText) && queryExamples.goesser.length < 15) {
      queryExamples.goesser.push(summarizeOffer(offer, source));
    }

    if (/bier|marzen|maerzen|radler|lager/.test(titleText) && queryExamples.bier.length < 15) {
      queryExamples.bier.push(summarizeOffer(offer, source));
    }

    if (
      offer.retailerKey === 'spar'
      && /spar|eurospar|interspar/i.test(`${offer.title || ''} ${offer.sourceRetailerFormat || ''} ${offer.retailerFormatLabel || ''}`)
      && queryExamples.sparFormats.length < 15
    ) {
      queryExamples.sparFormats.push(summarizeOffer(offer, source));
    }

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
    activeAktionsfinderMissingValidTo: {
      count: activeAktionsfinderMissingValidToCount,
      groups: formatGroups(activeMissingValidToGroups),
      examples: activeMissingValidToExamples,
    },
    queryExamples,
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
