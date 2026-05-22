const mongoose = require('mongoose');
const Offer = require('../../models/Offer');
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

async function replaceOffersForSource({
  sourceId,
  offerDocuments = [],
  crawlJobId: explicitCrawlJobId = null,
  allowEmptyReplacement = false,
  emptyReplacementVerified = false,
  sourceRunStatus = 'success',
  replacementQuality = 'complete',
  deactivationReason = 'source-replacement-not-seen',
  coverageGuard = {},
  OfferModel = Offer,
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
    const inserted = documents.length > 0
      ? await OfferModel.insertMany(
        documents.map((document) => ({
          ...(hasCurrentSearchTokens(document) ? document : withOfferSearchTokens(document)),
          sourceId: document.sourceId || sourceId,
          lastSeenRunId: document.lastSeenRunId || crawlJobIdString,
          lastSeenSourceRunId: document.lastSeenSourceRunId || crawlJobIdString,
        })),
        options
      )
      : [];
    const deactivateResult = await OfferModel.updateMany(
      {
        ...buildActiveSourceOfferFilter(sourceId),
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
    runWithOptionalTransaction,
  },
};
