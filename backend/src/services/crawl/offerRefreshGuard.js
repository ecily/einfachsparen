const mongoose = require('mongoose');
const Offer = require('../../models/Offer');
const CrawlJob = require('../../models/CrawlJob');
const { hasCurrentSearchTokens, withOfferSearchTokens } = require('../offers/searchTokens');

function isTransactionUnsupportedError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('transaction numbers are only allowed')
    || message.includes('transactions are not supported')
    || message.includes('transaction not supported')
  );
}

async function runWithOptionalTransaction(work) {
  const connection = mongoose.connection;

  if (
    connection.readyState !== 1
    || !connection.client
    || typeof connection.transaction !== 'function'
  ) {
    return work(null);
  }

  try {
    return await connection.transaction((session) => work(session));
  } catch (error) {
    if (!isTransactionUnsupportedError(error)) {
      throw error;
    }

    return work(null);
  }
}

function buildActiveSourceOfferFilter(sourceId) {
  return {
    sourceId,
    $or: [
      { status: 'active' },
      { isActiveNow: true },
      { isActiveToday: true },
    ],
  };
}

function buildActiveSourceReplacementFilter({ sourceId, fallbackRetirement = {} } = {}) {
  const fallbackSourceTypes = Array.isArray(fallbackRetirement.sourceTypes)
    ? fallbackRetirement.sourceTypes.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const fallbackSourceKeys = Array.isArray(fallbackRetirement.sourceKeys)
    ? fallbackRetirement.sourceKeys.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const retailerKey = String(fallbackRetirement.retailerKey || '').trim();
  const sourceIds = [sourceId, ...(Array.isArray(fallbackRetirement.sourceIds) ? fallbackRetirement.sourceIds : [])]
    .map((value) => value || null)
    .filter(Boolean);
  const sourceScope = sourceIds.length === 1
    ? { sourceId: sourceIds[0] }
    : { sourceId: { $in: sourceIds } };

  if (!retailerKey || (fallbackSourceTypes.length === 0 && fallbackSourceKeys.length === 0)) {
    return buildActiveSourceOfferFilter(sourceId);
  }

  const fallbackBranches = [];
  if (fallbackSourceTypes.length > 0) {
    fallbackBranches.push({ sourceType: { $in: fallbackSourceTypes } });
    fallbackBranches.push({ 'rawFacts.sourceType': { $in: fallbackSourceTypes } });
  }
  if (fallbackSourceKeys.length > 0) {
    fallbackBranches.push({ 'rawFacts.sourceKey': { $in: fallbackSourceKeys } });
  }

  return {
    $or: [
      sourceScope,
      {
        retailerKey,
        $or: fallbackBranches,
      },
    ],
    $and: [
      {
        $or: [
          { status: 'active' },
          { isActiveNow: true },
          { isActiveToday: true },
        ],
      },
    ],
  };
}

function evaluateReplacementCoverageRisk({
  previousActiveCount = 0,
  nextCount = 0,
  minBaseline = 50,
  minReplacementRatio = 0.35,
  minAbsoluteDrop = 25,
} = {}) {
  const baseline = Number(previousActiveCount || 0);
  const incoming = Number(nextCount || 0);

  if (baseline < minBaseline) {
    return {
      risk: false,
      reason: '',
      previousActiveCount: baseline,
      nextCount: incoming,
      minBaseline,
      minReplacementRatio,
      minAbsoluteDrop,
    };
  }

  const replacementRatio = baseline > 0 ? incoming / baseline : 1;
  const absoluteDrop = baseline - incoming;
  const risk = incoming < Math.ceil(baseline * minReplacementRatio) && absoluteDrop >= minAbsoluteDrop;

  return {
    risk,
    reason: risk ? 'coverage-drop-quality-risk' : '',
    previousActiveCount: baseline,
    nextCount: incoming,
    replacementRatio,
    absoluteDrop,
    minBaseline,
    minReplacementRatio,
    minAbsoluteDrop,
  };
}

async function assessReplacementCoverage({
  sourceId,
  documents = [],
  OfferModel = Offer,
  coverageGuard = {},
} = {}) {
  if (coverageGuard.enabled === false || typeof OfferModel.countDocuments !== 'function') {
    return evaluateReplacementCoverageRisk({
      previousActiveCount: 0,
      nextCount: documents.length,
      minBaseline: coverageGuard.minBaseline,
      minReplacementRatio: coverageGuard.minReplacementRatio,
      minAbsoluteDrop: coverageGuard.minAbsoluteDrop,
    });
  }

  const previousActiveCount = await OfferModel.countDocuments(buildActiveSourceOfferFilter(sourceId));

  return evaluateReplacementCoverageRisk({
    previousActiveCount,
    nextCount: documents.length,
    minBaseline: coverageGuard.minBaseline,
    minReplacementRatio: coverageGuard.minReplacementRatio,
    minAbsoluteDrop: coverageGuard.minAbsoluteDrop,
  });
}

async function resolveCrawlRunId({
  documents = [],
  explicitCrawlRunId = null,
  crawlJobId = null,
  CrawlJobModel = CrawlJob,
} = {}) {
  const documentCrawlRunId = documents.find((document) => document?.crawlRunId)?.crawlRunId;

  if (documentCrawlRunId) return documentCrawlRunId;
  if (explicitCrawlRunId) return explicitCrawlRunId;
  if (!crawlJobId || !mongoose.Types.ObjectId.isValid(String(crawlJobId))) return null;
  if (!CrawlJobModel || typeof CrawlJobModel.findById !== 'function') return null;

  const query = CrawlJobModel.findById(crawlJobId);
  const selected = query && typeof query.select === 'function'
    ? query.select('crawlRunId')
    : query;
  const job = selected && typeof selected.lean === 'function'
    ? await selected.lean()
    : await selected;

  return job?.crawlRunId || null;
}

async function replaceOffersForSource({
  sourceId,
  offerDocuments = [],
  crawlJobId: explicitCrawlJobId = null,
  crawlRunId: explicitCrawlRunId = null,
  allowEmptyReplacement = false,
  emptyReplacementVerified = false,
  sourceRunStatus = 'success',
  publishStatus = 'source-written',
  replacementQuality = 'complete',
  deactivationReason = 'source-replacement-not-seen',
  coverageGuard = {},
  fallbackRetirement = {},
  OfferModel = Offer,
  CrawlJobModel = CrawlJob,
} = {}) {
  const documents = Array.isArray(offerDocuments) ? offerDocuments.filter(Boolean) : [];
  const crawlJobId = documents.find((document) => document?.crawlJobId)?.crawlJobId || explicitCrawlJobId || null;

  if (!sourceId) {
    throw new Error('replaceOffersForSource requires sourceId.');
  }

  if (sourceRunStatus !== 'success') {
    return {
      insertedOffers: 0,
      removedPreviousOffers: 0,
      deactivatedPreviousOffers: 0,
      skippedPreviousOfferRemoval: true,
      skippedPreviousOfferDeactivation: true,
      reason: `source-run-${sourceRunStatus || 'not-success'}`,
      transactional: false,
    };
  }

  if (replacementQuality !== 'complete') {
    return {
      insertedOffers: 0,
      removedPreviousOffers: 0,
      deactivatedPreviousOffers: 0,
      skippedPreviousOfferRemoval: true,
      skippedPreviousOfferDeactivation: true,
      reason: `replacement-${replacementQuality || 'not-complete'}`,
      transactional: false,
    };
  }

  if (documents.length === 0 && allowEmptyReplacement && !emptyReplacementVerified) {
    return {
      insertedOffers: 0,
      removedPreviousOffers: 0,
      deactivatedPreviousOffers: 0,
      skippedPreviousOfferRemoval: true,
      skippedPreviousOfferDeactivation: true,
      reason: 'empty-replacement-not-verified',
      transactional: false,
    };
  }

  if ((documents.length === 0 && !allowEmptyReplacement) || !crawlJobId) {
    return {
      insertedOffers: 0,
      removedPreviousOffers: 0,
      deactivatedPreviousOffers: 0,
      skippedPreviousOfferRemoval: true,
      skippedPreviousOfferDeactivation: true,
      reason: documents.length === 0 ? 'no-new-offers' : 'missing-crawl-job-id',
      transactional: false,
    };
  }

  const crawlRunId = await resolveCrawlRunId({
    documents,
    explicitCrawlRunId,
    crawlJobId,
    CrawlJobModel,
  });

  const coverageRisk = await assessReplacementCoverage({
    sourceId,
    documents,
    OfferModel,
    coverageGuard,
  });

  if (coverageRisk.risk) {
    return {
      insertedOffers: 0,
      removedPreviousOffers: 0,
      deactivatedPreviousOffers: 0,
      skippedPreviousOfferRemoval: true,
      skippedPreviousOfferDeactivation: true,
      reason: coverageRisk.reason,
      replacementQuality: 'quality-risk',
      coverageRisk,
      transactional: false,
    };
  }

  return runWithOptionalTransaction(async (session) => {
    const options = session ? { ordered: false, session } : { ordered: false };
    const updateOptions = session ? { session } : {};
    const now = new Date();
    const crawlJobIdString = String(crawlJobId || '');
    const crawlRunIdString = crawlRunId ? String(crawlRunId) : '';
    const inserted = documents.length > 0
      ? await OfferModel.insertMany(
        documents.map((document) => {
          const enriched = hasCurrentSearchTokens(document) ? document : withOfferSearchTokens(document);

          return {
            ...enriched,
            ...(crawlRunId ? { crawlRunId: enriched.crawlRunId || crawlRunId } : {}),
            sourceId: enriched.sourceId || sourceId,
            sourceRunStatus: enriched.sourceRunStatus || sourceRunStatus || 'success',
            publishStatus: enriched.publishStatus || publishStatus || 'source-written',
            lastSeenRunId: enriched.lastSeenRunId || crawlRunIdString || crawlJobIdString,
            lastSeenSourceRunId: enriched.lastSeenSourceRunId || crawlJobIdString,
          };
        }),
        options
      )
      : [];
    const deactivateResult = await OfferModel.updateMany(
      {
        ...buildActiveSourceReplacementFilter({ sourceId, fallbackRetirement }),
        crawlJobId: { $ne: crawlJobId },
      },
      {
        $set: {
          status: 'inactive',
          isActiveNow: false,
          isActiveToday: false,
          deactivatedAt: now,
          deactivationReason,
          'rawFacts.deactivationMetadata': {
            reason: deactivationReason,
            replacementCrawlJobId: crawlJobIdString,
            replacementCrawlRunId: crawlRunIdString,
            sourceId: String(sourceId || ''),
            deactivatedAt: now.toISOString(),
          },
        },
      },
      updateOptions
    );

    return {
      insertedOffers: Array.isArray(inserted) ? inserted.length : documents.length,
      removedPreviousOffers: 0,
      deactivatedPreviousOffers: Number(deactivateResult?.modifiedCount ?? deactivateResult?.matchedCount ?? 0),
      skippedPreviousOfferRemoval: false,
      skippedPreviousOfferDeactivation: false,
      reason: '',
      transactional: Boolean(session),
    };
  });
}

module.exports = {
  replaceOffersForSource,
  _private: {
    assessReplacementCoverage,
    buildActiveSourceOfferFilter,
    evaluateReplacementCoverageRisk,
    isTransactionUnsupportedError,
    resolveCrawlRunId,
    buildActiveSourceReplacementFilter,
    runWithOptionalTransaction,
  },
};
