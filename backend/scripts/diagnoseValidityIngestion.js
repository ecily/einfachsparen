const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const RawDocument = require('../src/models/RawDocument');
const {
  TARGET_SOURCE_GROUPS,
  buildValidityIngestionDiagnostic,
} = require('../src/services/diagnostics/validityIngestionDiagnostic');

const DEFAULT_LIMIT = 8000;

function parseArgs(argv = []) {
  const options = {
    limit: DEFAULT_LIMIT,
    rawDocumentLimit: 1200,
  };

  for (const arg of argv) {
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));

      if (Number.isInteger(value) && value >= 100 && value <= 50000) {
        options.limit = value;
      }
    }

    if (arg.startsWith('--raw-document-limit=')) {
      const value = Number(arg.slice('--raw-document-limit='.length));

      if (Number.isInteger(value) && value >= 0 && value <= 5000) {
        options.rawDocumentLimit = value;
      }
    }
  }

  return options;
}

async function fetchReadOnlyContext({ limit = DEFAULT_LIMIT, rawDocumentLimit = 1200 } = {}) {
  const retailerKeys = [...new Set(TARGET_SOURCE_GROUPS.map((group) => group.retailerKey))];
  const sourceTypes = [...new Set(TARGET_SOURCE_GROUPS.map((group) => group.sourceType))];
  const offers = await Offer.find({
    retailerKey: { $in: retailerKeys },
    sourceType: { $in: sourceTypes },
  })
    .sort({ retailerKey: 1, sourceType: 1, titleNormalized: 1, updatedAt: -1 })
    .limit(limit)
    .select([
      '_id',
      'sourceId',
      'retailerKey',
      'retailerName',
      'sourceType',
      'sourceUrl',
      'title',
      'titleNormalized',
      'validFrom',
      'validTo',
      'rawFacts',
      'supportingSources',
      'parserVersion',
      'createdAt',
      'updatedAt',
      'firstSeenAt',
      'lastSeenAt',
    ].join(' '))
    .lean();

  const sourceIds = [...new Set(offers.map((offer) => String(offer.sourceId || '')).filter(Boolean))];
  const [sources, rawDocuments] = await Promise.all([
    Source.find({
      $or: [
        { _id: { $in: sourceIds } },
        { retailerKey: { $in: retailerKeys } },
      ],
    })
      .select('retailerKey retailerName channel label sourceUrl sourceType parserHint parserVersion latestRunAt latestStatus createdAt updatedAt')
      .lean(),
    rawDocumentLimit > 0
      ? RawDocument.find({
        retailerKey: { $in: retailerKeys },
      })
        .sort({ fetchedAt: -1 })
        .limit(rawDocumentLimit)
        .select('sourceId retailerKey sourceType documentType url canonicalUrl finalUrl title fetchedAt contentSnippet extractedPreview parserVersion payload createdAt updatedAt')
        .lean()
      : [],
  ]);

  return { offers, sources, rawDocuments };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();

  const context = await fetchReadOnlyContext(options);
  const report = buildValidityIngestionDiagnostic({
    ...context,
    generatedAt: new Date(),
  });

  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        readOnly: true,
        mutatedCollections: [],
        message: error.message,
        stack: error.stack,
      }, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  parseArgs,
  fetchReadOnlyContext,
};
