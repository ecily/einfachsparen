const mongoose = require('mongoose');
const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const RawDocument = require('../src/models/RawDocument');
const CrawlJob = require('../src/models/CrawlJob');

const PENNY_PDF_SOURCE_TYPE = 'penny-official-pdf';
const PENNY_PDF_SOURCE_KEY = 'penny-official-flyer-pdf';
const PENNY_PDF_PARSER_VERSION = 'penny-pdf-v1';

function mapOfferSourceDistribution(sourceDistribution = []) {
  return sourceDistribution.map((item) => ({
    sourceType: item._id || 'unknown',
    offers: item.offers,
    activeNow: item.activeNow,
  }));
}

function mapRawDocumentSourceDistribution(rawDocumentSourceDistribution = []) {
  return rawDocumentSourceDistribution.map((item) => ({
    sourceType: item._id?.sourceType || 'unknown',
    documentType: item._id?.documentType || 'unknown',
    documents: item.documents,
    parsedOffers: item.parsedOffers,
  }));
}

function mapLatestPdfDocument(doc = {}) {
  return {
    fetchedAt: doc.fetchedAt,
    sourceType: doc.sourceType,
    sourceKind: doc.payload?.sourceKind || '',
    sourceKey: doc.payload?.sourceKey || '',
    parserVersion: doc.parserVersion || doc.payload?.parserVersion || '',
    payloadParserVersion: doc.payload?.parserVersion || '',
    retailerKey: doc.payload?.retailerKey || '',
    retailerName: doc.payload?.retailerName || '',
    foundRawItems: doc.foundRawItems,
    parsedOffers: doc.parsedOffers,
    rejectedOffers: doc.rejectedOffers,
    rejectionReasons: doc.rejectionReasons,
    pages: doc.payload?.detectedPageCount || 0,
  };
}

function mapSamplePdfOffer(offer = {}) {
  return {
    title: offer.title,
    priceCurrent: offer.priceCurrent,
    sourceType: offer.sourceType,
    sourceKind: offer.rawFacts?.sourceKind || '',
    sourceKey: offer.rawFacts?.sourceKey || offer.rawFacts?.sourceMetadata?.sourceKey || '',
    parserVersion: offer.parserVersion || offer.rawFacts?.parserVersion || '',
    rawFactsParserVersion: offer.rawFacts?.parserVersion || '',
    page: offer.rawFacts?.page ?? null,
    pageNumber: offer.rawFacts?.pageNumber ?? null,
    pdfPage: offer.rawFacts?.pdfPage ?? null,
    evidence: offer.rawFacts?.evidenceText || '',
  };
}

function mapMergedOffer(offer = {}) {
  return {
    title: offer.title,
    priceCurrent: offer.priceCurrent,
    sourceType: offer.sourceType,
    sourceTypes: offer.sourceTypes || [],
    sourceMergeSourceTypes: offer.rawFacts?.sourceMergeSourceTypes || [],
    sourceMergeSourceKeys: offer.rawFacts?.sourceMergeSourceKeys || [],
    mergedDuplicateCount: offer.rawFacts?.mergedDuplicateCount || 0,
    pdfContributingSource: Boolean(offer.rawFacts?.pdfContributingSource),
    contributingSources: (offer.rawFacts?.contributingSources || []).map((source) => ({
      sourceType: source.sourceType || '',
      sourceKey: source.sourceKey || '',
      parserVersion: source.parserVersion || '',
      page: source.page ?? null,
      title: source.title || '',
      price: source.price ?? null,
      evidence: source.evidence || '',
    })),
  };
}

function mapMergeConflict(item = {}) {
  return {
    titleNormalized: item._id || '',
    prices: item.prices || [],
    sourceTypes: item.sourceTypes || [],
    count: item.count || 0,
    examples: item.examples || [],
  };
}

function buildPennyDiagnosticsReport({
  sourceDistribution = [],
  rawDocumentSourceDistribution = [],
  latestPdfDocuments = [],
  latestPennyJobs = [],
  pdfOfferMetadataCounts = {},
  samplePdfOffers = [],
  pennyMergeStats = {},
  mergedOffers = [],
  mergeConflicts = [],
  badTitles = [],
} = {}) {
  const mergedDuplicateGroups = Number(pennyMergeStats.mergedDuplicateGroups || 0);
  const removedByMerge = Number(pennyMergeStats.removedByMerge || 0);

  return {
    ok: true,
    expectedPdfMetadata: {
      sourceType: PENNY_PDF_SOURCE_TYPE,
      sourceKind: 'pdf',
      sourceKey: PENNY_PDF_SOURCE_KEY,
      parserVersion: PENNY_PDF_PARSER_VERSION,
    },
    pennySourceDistribution: mapOfferSourceDistribution(sourceDistribution),
    rawDocumentSourceDistribution: mapRawDocumentSourceDistribution(rawDocumentSourceDistribution),
    pdfOfferMetadataCounts: {
      totalPdfOffers: Number(pdfOfferMetadataCounts.totalPdfOffers || 0),
      missingSourceKey: Number(pdfOfferMetadataCounts.missingSourceKey || 0),
      missingParserVersion: Number(pdfOfferMetadataCounts.missingParserVersion || 0),
      unexpectedParserVersion: Number(pdfOfferMetadataCounts.unexpectedParserVersion || 0),
      missingSourceKind: Number(pdfOfferMetadataCounts.missingSourceKind || 0),
    },
    pennyMergeDiagnostics: {
      currentOffersAfterMerge: Number(pennyMergeStats.currentOffersAfterMerge || 0),
      estimatedOffersBeforeMerge: Number(pennyMergeStats.currentOffersAfterMerge || 0) + removedByMerge,
      removedByMerge,
      mergedDuplicateGroups,
      pdfAsContributingSource: Number(pennyMergeStats.pdfAsContributingSource || 0),
      pdfMergedContributingSource: Number(pennyMergeStats.pdfMergedContributingSource || 0),
      pdfOnlyOffers: Number(pennyMergeStats.pdfOnlyOffers || 0),
      multiSourceOffers: Number(pennyMergeStats.multiSourceOffers || 0),
      possibleDuplicateGroups: Number(pennyMergeStats.possibleDuplicateGroups || 0),
      suspiciousMergeConflictGroups: mergeConflicts.length,
    },
    latestPdfDocuments: latestPdfDocuments.map(mapLatestPdfDocument),
    samplePdfOffers: samplePdfOffers.map(mapSamplePdfOffer),
    mergedOfferExamples: mergedOffers.map(mapMergedOffer),
    suspiciousMergeConflicts: mergeConflicts.map(mapMergeConflict),
    latestPennyJobs,
    suspiciousPdfTitles: badTitles.map((offer) => ({
      title: offer.title,
      price: offer.priceCurrent?.amount ?? null,
      sourceType: offer.sourceType,
      sourceKey: offer.rawFacts?.sourceKey || offer.rawFacts?.sourceMetadata?.sourceKey || '',
      parserVersion: offer.parserVersion || offer.rawFacts?.parserVersion || '',
      page: offer.rawFacts?.page ?? null,
      evidence: offer.rawFacts?.evidenceText || '',
    })),
  };
}

async function fetchPennyDiagnosticsData() {
  const [
    sourceDistribution,
    rawDocumentSourceDistribution,
    latestPdfDocuments,
    latestPennyJobs,
    pdfOfferMetadataCounts,
    samplePdfOffers,
    pennyMergeStats,
    mergedOffers,
    mergeConflicts,
    possibleDuplicateGroups,
    badTitles,
  ] = await Promise.all([
    Offer.aggregate([
      { $match: { retailerKey: 'penny' } },
      {
        $group: {
          _id: '$sourceType',
          offers: { $sum: 1 },
          activeNow: { $sum: { $cond: ['$isActiveNow', 1, 0] } },
        },
      },
      { $sort: { offers: -1 } },
    ]),
    RawDocument.aggregate([
      { $match: { retailerKey: 'penny' } },
      {
        $group: {
          _id: {
            sourceType: '$sourceType',
            documentType: '$documentType',
          },
          documents: { $sum: 1 },
          parsedOffers: { $sum: '$parsedOffers' },
        },
      },
      { $sort: { documents: -1 } },
    ]),
    RawDocument.find({ retailerKey: 'penny', documentType: 'pdf' })
      .sort({ fetchedAt: -1 })
      .limit(5)
      .select('title sourceType foundRawItems parsedOffers rejectedOffers rejectionReasons parserVersion fetchedAt payload')
      .lean(),
    CrawlJob.find({ retailerKey: 'penny' })
      .sort({ startedAt: -1 })
      .limit(5)
      .select('status sourceType parserVersion stats metadata warningMessages errorMessages startedAt finishedAt')
      .lean(),
    Offer.aggregate([
      { $match: { retailerKey: 'penny', sourceType: PENNY_PDF_SOURCE_TYPE } },
      {
        $group: {
          _id: null,
          totalPdfOffers: { $sum: 1 },
          missingSourceKey: {
            $sum: {
              $cond: [
                {
                  $in: [
                    { $ifNull: ['$rawFacts.sourceKey', '$rawFacts.sourceMetadata.sourceKey'] },
                    [null, ''],
                  ],
                },
                1,
                0,
              ],
            },
          },
          missingParserVersion: {
            $sum: {
              $cond: [
                {
                  $in: [
                    { $ifNull: ['$parserVersion', '$rawFacts.parserVersion'] },
                    [null, ''],
                  ],
                },
                1,
                0,
              ],
            },
          },
          unexpectedParserVersion: {
            $sum: {
              $cond: [
                {
                  $ne: [
                    { $ifNull: ['$parserVersion', '$rawFacts.parserVersion'] },
                    PENNY_PDF_PARSER_VERSION,
                  ],
                },
                1,
                0,
              ],
            },
          },
          missingSourceKind: {
            $sum: {
              $cond: [{ $ne: ['$rawFacts.sourceKind', 'pdf'] }, 1, 0],
            },
          },
        },
      },
    ]),
    Offer.find({ retailerKey: 'penny', sourceType: PENNY_PDF_SOURCE_TYPE })
      .sort({ updatedAt: -1 })
      .limit(10)
      .select('title priceCurrent sourceType parserVersion rawFacts.sourceKind rawFacts.sourceKey rawFacts.sourceMetadata rawFacts.parserVersion rawFacts.page rawFacts.pageNumber rawFacts.pdfPage rawFacts.evidenceText')
      .lean(),
    Offer.aggregate([
      { $match: { retailerKey: 'penny' } },
      {
        $group: {
          _id: null,
          currentOffersAfterMerge: { $sum: 1 },
          removedByMerge: {
            $sum: {
              $cond: [
                { $gt: [{ $ifNull: ['$rawFacts.mergedDuplicateCount', 1] }, 1] },
                { $subtract: [{ $ifNull: ['$rawFacts.mergedDuplicateCount', 1] }, 1] },
                0,
              ],
            },
          },
          mergedDuplicateGroups: {
            $sum: {
              $cond: [{ $gt: [{ $ifNull: ['$rawFacts.mergedDuplicateCount', 1] }, 1] }, 1, 0],
            },
          },
          pdfAsContributingSource: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$sourceType', PENNY_PDF_SOURCE_TYPE] },
                    { $eq: ['$rawFacts.pdfContributingSource', true] },
                    { $in: [PENNY_PDF_SOURCE_TYPE, { $ifNull: ['$sourceTypes', []] }] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          pdfMergedContributingSource: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$sourceType', PENNY_PDF_SOURCE_TYPE] },
                    { $eq: ['$rawFacts.pdfContributingSource', true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          pdfOnlyOffers: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$sourceType', PENNY_PDF_SOURCE_TYPE] },
                    { $lte: [{ $size: { $ifNull: ['$sourceTypes', []] } }, 2] },
                    { $not: [{ $gt: [{ $ifNull: ['$rawFacts.mergedDuplicateCount', 1] }, 1] }] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          multiSourceOffers: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $gt: [{ $size: { $ifNull: ['$sourceTypes', []] } }, 2] },
                    { $gt: [{ $size: { $ifNull: ['$rawFacts.contributingSources', []] } }, 1] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    Offer.find({
      retailerKey: 'penny',
      'rawFacts.mergedDuplicateCount': { $gt: 1 },
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .select('title priceCurrent sourceType sourceTypes rawFacts.sourceMergeSourceTypes rawFacts.sourceMergeSourceKeys rawFacts.mergedDuplicateCount rawFacts.pdfContributingSource rawFacts.contributingSources')
      .lean(),
    Offer.aggregate([
      {
        $match: {
          retailerKey: 'penny',
          titleNormalized: { $ne: '' },
        },
      },
      {
        $group: {
          _id: '$titleNormalized',
          prices: { $addToSet: '$priceCurrent.amount' },
          sourceTypes: { $addToSet: '$sourceType' },
          count: { $sum: 1 },
          examples: {
            $push: {
              title: '$title',
              price: '$priceCurrent.amount',
              sourceType: '$sourceType',
            },
          },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
          'prices.1': { $exists: true },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Offer.aggregate([
      {
        $match: {
          retailerKey: 'penny',
          titleNormalized: { $ne: '' },
        },
      },
      {
        $group: {
          _id: {
            titleNormalized: '$titleNormalized',
            price: '$priceCurrent.amount',
          },
          count: { $sum: 1 },
          sourceTypes: { $addToSet: '$sourceType' },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
          'sourceTypes.1': { $exists: true },
        },
      },
      { $count: 'count' },
    ]),
    Offer.find({
      retailerKey: 'penny',
      sourceType: PENNY_PDF_SOURCE_TYPE,
      title: {
        $regex: /^(?:\d+(?:[,.]\d+)?|gueltig|gültig|gultig|seite\s+\d+|penny|\d+\s*(?:g|kg|ml|l|stk|stueck|stück))$/i,
      },
    })
      .limit(20)
      .select('title priceCurrent sourceType parserVersion rawFacts.sourceKey rawFacts.sourceMetadata rawFacts.page rawFacts.evidenceText')
      .lean(),
  ]);

  return {
    sourceDistribution,
    rawDocumentSourceDistribution,
    latestPdfDocuments,
    latestPennyJobs,
    pdfOfferMetadataCounts: pdfOfferMetadataCounts[0] || {},
    samplePdfOffers,
    pennyMergeStats: {
      ...(pennyMergeStats[0] || {}),
      possibleDuplicateGroups: possibleDuplicateGroups[0]?.count || 0,
    },
    mergedOffers,
    mergeConflicts,
    badTitles,
  };
}

async function run() {
  await connectToDatabase();
  const data = await fetchPennyDiagnosticsData();

  console.log(JSON.stringify(buildPennyDiagnosticsReport(data), null, 2));

  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      message: error.message,
      stack: error.stack,
    }, null, 2));
    mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = {
  PENNY_PDF_SOURCE_TYPE,
  PENNY_PDF_SOURCE_KEY,
  PENNY_PDF_PARSER_VERSION,
  buildPennyDiagnosticsReport,
  mapLatestPdfDocument,
  mapSamplePdfOffer,
  mapMergedOffer,
};
