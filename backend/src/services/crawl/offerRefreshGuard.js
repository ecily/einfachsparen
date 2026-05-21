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

async function replaceOffersForSource({
  sourceId,
  offerDocuments = [],
  crawlJobId: explicitCrawlJobId = null,
  allowEmptyReplacement = false,
  emptyReplacementVerified = false,
  sourceRunStatus = 'success',
  replacementQuality = 'complete',
  deactivationReason = 'source-replacement-not-seen',
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
        sourceId,
        crawlJobId: { $ne: crawlJobId },
        $or: [
          { status: 'active' },
          { isActiveNow: true },
          { isActiveToday: true },
        ],
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
    isTransactionUnsupportedError,
    runWithOptionalTransaction,
  },
};
