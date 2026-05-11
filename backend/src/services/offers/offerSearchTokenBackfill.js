const Offer = require('../../models/Offer');
const {
  SEARCH_TOKEN_VERSION,
  buildOfferSearchTokens,
} = require('./searchTokens');

function sameStringArray(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item === right[index]);
}

function parseBackfillArgs(argv = []) {
  const options = {
    apply: false,
    limit: 100,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    if (arg === '--limit') {
      const value = Number(argv[index + 1]);

      if (Number.isInteger(value) && value > 0 && value <= 10000) {
        options.limit = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));

      if (Number.isInteger(value) && value > 0 && value <= 10000) {
        options.limit = value;
      }
    }
  }

  return options;
}

function buildBackfillQuery() {
  return {
    $or: [
      { searchTokenVersion: { $lt: SEARCH_TOKEN_VERSION } },
      { searchTokenVersion: { $exists: false } },
      { searchTokens: { $exists: false } },
      { searchTokens: { $size: 0 } },
    ],
  };
}

function selectBackfillFields() {
  return [
    '_id',
    'title',
    'titleNormalized',
    'brand',
    'manufacturer',
    'productName',
    'normalizedName',
    'retailerKey',
    'retailerName',
    'categoryPrimary',
    'categorySecondary',
    'categoryKey',
    'subcategoryKey',
    'comparisonSignature',
    'comparisonGroup',
    'searchTokens',
    'searchTokenVersion',
  ].join(' ');
}

async function runOfferSearchTokenBackfill({
  apply = false,
  limit = 100,
  OfferModel = Offer,
} = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 10000));
  const offers = await OfferModel.find(buildBackfillQuery())
    .select(selectBackfillFields())
    .sort({ updatedAt: -1, _id: 1 })
    .limit(safeLimit)
    .lean();
  const report = {
    checkedAt: new Date().toISOString(),
    dryRun: !apply,
    apply: Boolean(apply),
    limit: safeLimit,
    scanned: offers.length,
    modified: 0,
    unmodified: 0,
    errors: 0,
    writeFields: ['searchTokens', 'searchTokenVersion'],
  };

  for (const offer of offers) {
    try {
      const searchTokens = buildOfferSearchTokens(offer);
      const unchanged = sameStringArray(offer.searchTokens || [], searchTokens) &&
        Number(offer.searchTokenVersion || 0) === SEARCH_TOKEN_VERSION;

      if (unchanged) {
        report.unmodified += 1;
        continue;
      }

      if (apply) {
        await OfferModel.updateOne(
          { _id: offer._id },
          {
            $set: {
              searchTokens,
              searchTokenVersion: SEARCH_TOKEN_VERSION,
            },
          }
        );
      }

      report.modified += 1;
    } catch (error) {
      report.errors += 1;
    }
  }

  return report;
}

module.exports = {
  buildBackfillQuery,
  parseBackfillArgs,
  runOfferSearchTokenBackfill,
  sameStringArray,
  selectBackfillFields,
};
