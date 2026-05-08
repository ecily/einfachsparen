const mongoose = require('mongoose');
const { connectToDatabase } = require('../src/config/mongodb');
const Source = require('../src/models/Source');
const RawDocument = require('../src/models/RawDocument');
const Offer = require('../src/models/Offer');
const {
  buildSourcesLadderAudit,
  loadCodeHints,
  TARGET_RETAILERS,
} = require('../src/services/diagnostics/sourceLadderAudit');

const TARGET_RETAILER_KEYS = TARGET_RETAILERS.map((retailer) => retailer.retailerKey);

async function fetchReadOnlyDiagnosticsData() {
  const retailerMatch = { retailerKey: { $in: TARGET_RETAILER_KEYS } };

  const [
    sources,
    offerDistribution,
    rawDocumentDistribution,
    duplicateSignals,
  ] = await Promise.all([
    Source.find(retailerMatch)
      .select('retailerKey retailerName channel label sourceUrl sourceType parserHint enabled latestStatus priority notes disabledReason')
      .sort({ retailerKey: 1, priority: 1, label: 1 })
      .lean(),
    Offer.aggregate([
      { $match: retailerMatch },
      {
        $group: {
          _id: {
            retailerKey: '$retailerKey',
            sourceType: '$sourceType',
          },
          retailerKey: { $first: '$retailerKey' },
          sourceType: { $first: '$sourceType' },
          offers: { $sum: 1 },
          activeNow: { $sum: { $cond: ['$isActiveNow', 1, 0] } },
          avgSourceConfidence: { $avg: '$sourceConfidence' },
          avgExtractionConfidence: { $avg: '$extractionConfidence' },
          comparisonSafe: { $sum: { $cond: ['$quality.comparisonSafe', 1, 0] } },
        },
      },
      { $sort: { retailerKey: 1, offers: -1 } },
    ]),
    RawDocument.aggregate([
      { $match: retailerMatch },
      {
        $group: {
          _id: {
            retailerKey: '$retailerKey',
            sourceType: '$sourceType',
            documentType: '$documentType',
          },
          retailerKey: { $first: '$retailerKey' },
          sourceType: { $first: '$sourceType' },
          documentType: { $first: '$documentType' },
          documents: { $sum: 1 },
          parsedOffers: { $sum: '$parsedOffers' },
          foundRawItems: { $sum: '$foundRawItems' },
          avgExtractionConfidence: { $avg: '$extractionConfidence' },
          latestFetchedAt: { $max: '$fetchedAt' },
        },
      },
      { $sort: { retailerKey: 1, documents: -1 } },
    ]),
    Offer.aggregate([
      {
        $match: {
          ...retailerMatch,
          titleNormalized: { $ne: '' },
        },
      },
      {
        $group: {
          _id: {
            retailerKey: '$retailerKey',
            titleNormalized: '$titleNormalized',
            price: '$priceCurrent.amount',
          },
          retailerKey: { $first: '$retailerKey' },
          sourceTypes: { $addToSet: '$sourceType' },
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
          'sourceTypes.1': { $exists: true },
        },
      },
      {
        $group: {
          _id: '$retailerKey',
          retailerKey: { $first: '$retailerKey' },
          duplicateGroups: { $sum: 1 },
        },
      },
      { $sort: { duplicateGroups: -1 } },
    ]),
  ]);

  return {
    sources,
    offerDistribution,
    rawDocumentDistribution,
    duplicateSignals,
  };
}

async function run() {
  await connectToDatabase();

  const data = await fetchReadOnlyDiagnosticsData();
  const report = buildSourcesLadderAudit({
    ...data,
    codeHints: loadCodeHints(process.cwd()),
  });

  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      readOnly: true,
      mutatedCollections: [],
      message: error.message,
      stack: error.stack,
    }, null, 2));
    mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = {
  fetchReadOnlyDiagnosticsData,
};
