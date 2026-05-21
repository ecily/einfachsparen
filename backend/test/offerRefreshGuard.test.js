const assert = require('node:assert/strict');
const test = require('node:test');

const { replaceOffersForSource } = require('../src/services/crawl/offerRefreshGuard');
const { SEARCH_TOKEN_VERSION } = require('../src/services/offers/searchTokens');

function buildOfferModel(calls) {
  return {
    async insertMany(documents, options) {
      calls.insertMany.push({ documents, options });
      return documents;
    },
    async deleteMany(filter, options) {
      calls.deleteMany.push({ filter, options });
      return { deletedCount: 2 };
    },
  };
}

test('replaceOffersForSource keeps existing live offers when a source produced no new offers', async () => {
  const calls = { insertMany: [], deleteMany: [] };

  const result = await replaceOffersForSource({
    sourceId: 'source-1',
    offerDocuments: [],
    OfferModel: buildOfferModel(calls),
  });

  assert.equal(result.insertedOffers, 0);
  assert.equal(result.removedPreviousOffers, 0);
  assert.equal(result.skippedPreviousOfferRemoval, true);
  assert.equal(result.reason, 'no-new-offers');
  assert.equal(calls.insertMany.length, 0);
  assert.equal(calls.deleteMany.length, 0);
});

test('replaceOffersForSource can clear a successful empty source snapshot when explicitly allowed', async () => {
  const calls = { insertMany: [], deleteMany: [] };

  const result = await replaceOffersForSource({
    sourceId: 'source-1',
    crawlJobId: 'job-3',
    offerDocuments: [],
    allowEmptyReplacement: true,
    OfferModel: buildOfferModel(calls),
  });

  assert.equal(result.insertedOffers, 0);
  assert.equal(result.removedPreviousOffers, 2);
  assert.equal(result.skippedPreviousOfferRemoval, false);
  assert.equal(calls.insertMany.length, 0);
  assert.equal(calls.deleteMany.length, 1);
  assert.deepEqual(calls.deleteMany[0].filter, {
    sourceId: 'source-1',
    crawlJobId: { $ne: 'job-3' },
  });
});

test('replaceOffersForSource inserts the new source snapshot before removing previous source offers', async () => {
  const calls = { insertMany: [], deleteMany: [] };
  const result = await replaceOffersForSource({
    sourceId: 'source-1',
    offerDocuments: [
      { sourceId: 'source-1', crawlJobId: 'job-2', title: 'Kaffee' },
      { sourceId: 'source-1', crawlJobId: 'job-2', title: 'Reis' },
    ],
    OfferModel: buildOfferModel(calls),
  });

  assert.equal(result.insertedOffers, 2);
  assert.equal(result.removedPreviousOffers, 2);
  assert.equal(calls.insertMany.length, 1);
  assert.equal(calls.deleteMany.length, 1);
  assert.ok(calls.insertMany[0].documents[0].searchTokens.includes('kaffee'));
  assert.equal(calls.insertMany[0].documents[0].searchTokenVersion, SEARCH_TOKEN_VERSION);
  assert.deepEqual(calls.deleteMany[0].filter, {
    sourceId: 'source-1',
    crawlJobId: { $ne: 'job-2' },
  });
});
