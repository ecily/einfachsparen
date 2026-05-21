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
      return { deletedCount: 99 };
    },
    async updateMany(filter, update, options) {
      calls.updateMany.push({ filter, update, options });
      return { matchedCount: 2, modifiedCount: 2 };
    },
  };
}

function buildCalls() {
  return { insertMany: [], deleteMany: [], updateMany: [] };
}

test('replaceOffersForSource keeps existing live offers when a source produced no new offers', async () => {
  const calls = buildCalls();

  const result = await replaceOffersForSource({
    sourceId: 'source-1',
    offerDocuments: [],
    OfferModel: buildOfferModel(calls),
  });

  assert.equal(result.insertedOffers, 0);
  assert.equal(result.removedPreviousOffers, 0);
  assert.equal(result.deactivatedPreviousOffers, 0);
  assert.equal(result.skippedPreviousOfferRemoval, true);
  assert.equal(result.skippedPreviousOfferDeactivation, true);
  assert.equal(result.reason, 'no-new-offers');
  assert.equal(calls.insertMany.length, 0);
  assert.equal(calls.deleteMany.length, 0);
  assert.equal(calls.updateMany.length, 0);
});

test('replaceOffersForSource refuses empty replacement until the source guard verified it', async () => {
  const calls = buildCalls();

  const result = await replaceOffersForSource({
    sourceId: 'source-1',
    crawlJobId: 'job-3',
    offerDocuments: [],
    allowEmptyReplacement: true,
    OfferModel: buildOfferModel(calls),
  });

  assert.equal(result.insertedOffers, 0);
  assert.equal(result.removedPreviousOffers, 0);
  assert.equal(result.deactivatedPreviousOffers, 0);
  assert.equal(result.skippedPreviousOfferDeactivation, true);
  assert.equal(result.reason, 'empty-replacement-not-verified');
  assert.equal(calls.insertMany.length, 0);
  assert.equal(calls.deleteMany.length, 0);
  assert.equal(calls.updateMany.length, 0);
});

test('replaceOffersForSource can soft-deactivate a verified successful empty source snapshot', async () => {
  const calls = buildCalls();

  const result = await replaceOffersForSource({
    sourceId: 'source-1',
    crawlJobId: 'job-3',
    offerDocuments: [],
    allowEmptyReplacement: true,
    emptyReplacementVerified: true,
    OfferModel: buildOfferModel(calls),
  });

  assert.equal(result.insertedOffers, 0);
  assert.equal(result.removedPreviousOffers, 0);
  assert.equal(result.deactivatedPreviousOffers, 2);
  assert.equal(result.skippedPreviousOfferRemoval, false);
  assert.equal(result.skippedPreviousOfferDeactivation, false);
  assert.equal(calls.insertMany.length, 0);
  assert.equal(calls.deleteMany.length, 0);
  assert.equal(calls.updateMany.length, 1);
  assert.deepEqual(calls.updateMany[0].filter, {
    sourceId: 'source-1',
    crawlJobId: { $ne: 'job-3' },
    $or: [
      { status: 'active' },
      { isActiveNow: true },
      { isActiveToday: true },
    ],
  });
  assert.equal(calls.updateMany[0].update.$set.status, 'inactive');
  assert.equal(calls.updateMany[0].update.$set.isActiveNow, false);
  assert.equal(calls.updateMany[0].update.$set.isActiveToday, false);
  assert.equal(calls.updateMany[0].update.$set.deactivationReason, 'source-replacement-not-seen');
  assert.ok(calls.updateMany[0].update.$set.deactivatedAt instanceof Date);
  assert.equal(calls.updateMany[0].update.$set['rawFacts.deactivationMetadata'].replacementCrawlJobId, 'job-3');
});

test('replaceOffersForSource inserts the new source snapshot before soft-deactivating previous source offers', async () => {
  const calls = buildCalls();
  const result = await replaceOffersForSource({
    sourceId: 'source-1',
    offerDocuments: [
      { sourceId: 'source-1', crawlJobId: 'job-2', title: 'Kaffee' },
      { sourceId: 'source-1', crawlJobId: 'job-2', title: 'Reis' },
    ],
    OfferModel: buildOfferModel(calls),
  });

  assert.equal(result.insertedOffers, 2);
  assert.equal(result.removedPreviousOffers, 0);
  assert.equal(result.deactivatedPreviousOffers, 2);
  assert.equal(calls.insertMany.length, 1);
  assert.equal(calls.deleteMany.length, 0);
  assert.equal(calls.updateMany.length, 1);
  assert.ok(calls.insertMany[0].documents[0].searchTokens.includes('kaffee'));
  assert.equal(calls.insertMany[0].documents[0].searchTokenVersion, SEARCH_TOKEN_VERSION);
  assert.equal(calls.insertMany[0].documents[0].lastSeenRunId, 'job-2');
  assert.equal(calls.insertMany[0].documents[0].lastSeenSourceRunId, 'job-2');
  assert.deepEqual(calls.updateMany[0].filter, {
    sourceId: 'source-1',
    crawlJobId: { $ne: 'job-2' },
    $or: [
      { status: 'active' },
      { isActiveNow: true },
      { isActiveToday: true },
    ],
  });
});

test('replaceOffersForSource never hard-deletes previous source offers', async () => {
  const calls = buildCalls();

  await replaceOffersForSource({
    sourceId: 'source-1',
    offerDocuments: [
      { sourceId: 'source-1', crawlJobId: 'job-2', title: 'Kaffee' },
    ],
    OfferModel: buildOfferModel(calls),
  });

  assert.equal(calls.deleteMany.length, 0);
});

test('replaceOffersForSource deactivates old active offers even when their validTo is still in the future', async () => {
  const calls = buildCalls();

  const result = await replaceOffersForSource({
    sourceId: 'source-1',
    offerDocuments: [
      {
        sourceId: 'source-1',
        crawlJobId: 'job-4',
        title: 'Neues Bier',
        validTo: new Date('2099-12-31T23:59:59.000Z'),
      },
    ],
    OfferModel: buildOfferModel(calls),
  });

  assert.equal(result.deactivatedPreviousOffers, 2);
  assert.deepEqual(calls.updateMany[0].filter, {
    sourceId: 'source-1',
    crawlJobId: { $ne: 'job-4' },
    $or: [
      { status: 'active' },
      { isActiveNow: true },
      { isActiveToday: true },
    ],
  });
  assert.equal(calls.updateMany[0].update.$set.status, 'inactive');
  assert.equal(calls.updateMany[0].update.$set.deactivationReason, 'source-replacement-not-seen');
});

test('replaceOffersForSource skips deactivation for failed or partial source runs', async () => {
  for (const sourceRunStatus of ['failed', 'partial']) {
    const calls = buildCalls();
    const result = await replaceOffersForSource({
      sourceId: 'source-1',
      offerDocuments: [
        { sourceId: 'source-1', crawlJobId: 'job-2', title: 'Kaffee' },
      ],
      sourceRunStatus,
      OfferModel: buildOfferModel(calls),
    });

    assert.equal(result.reason, `source-run-${sourceRunStatus}`);
    assert.equal(result.insertedOffers, 0);
    assert.equal(result.deactivatedPreviousOffers, 0);
    assert.equal(calls.insertMany.length, 0);
    assert.equal(calls.deleteMany.length, 0);
    assert.equal(calls.updateMany.length, 0);
  }
});

test('replaceOffersForSource skips deactivation for quality-risk replacement snapshots', async () => {
  const calls = buildCalls();

  const result = await replaceOffersForSource({
    sourceId: 'source-1',
    offerDocuments: [
      { sourceId: 'source-1', crawlJobId: 'job-2', title: 'Kaffee' },
    ],
    replacementQuality: 'quality-risk',
    OfferModel: buildOfferModel(calls),
  });

  assert.equal(result.reason, 'replacement-quality-risk');
  assert.equal(result.insertedOffers, 0);
  assert.equal(result.deactivatedPreviousOffers, 0);
  assert.equal(calls.insertMany.length, 0);
  assert.equal(calls.deleteMany.length, 0);
  assert.equal(calls.updateMany.length, 0);
});
