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
  OfferModel = Offer,
} = {}) {
  const documents = Array.isArray(offerDocuments) ? offerDocuments.filter(Boolean) : [];
  const crawlJobId = documents.find((document) => document?.crawlJobId)?.crawlJobId || explicitCrawlJobId || null;

  if (!sourceId) {
    throw new Error('replaceOffersForSource requires sourceId.');
  }

  if ((documents.length === 0 && !allowEmptyReplacement) || !crawlJobId) {
    return {
      insertedOffers: 0,
      removedPreviousOffers: 0,
      skippedPreviousOfferRemoval: true,
      reason: documents.length === 0 ? 'no-new-offers' : 'missing-crawl-job-id',
      transactional: false,
    };
  }

  return runWithOptionalTransaction(async (session) => {
    const options = session ? { ordered: false, session } : { ordered: false };
    const deleteOptions = session ? { session } : {};
    const inserted = documents.length > 0
      ? await OfferModel.insertMany(
        documents.map((document) => ({
          ...(hasCurrentSearchTokens(document) ? document : withOfferSearchTokens(document)),
          sourceId: document.sourceId || sourceId,
        })),
        options
      )
      : [];
    const deleteResult = await OfferModel.deleteMany(
      {
        sourceId,
        crawlJobId: { $ne: crawlJobId },
      },
      deleteOptions
    );

    return {
      insertedOffers: Array.isArray(inserted) ? inserted.length : documents.length,
      removedPreviousOffers: Number(deleteResult?.deletedCount || 0),
      skippedPreviousOfferRemoval: false,
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
