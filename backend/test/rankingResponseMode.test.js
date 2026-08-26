const assert = require('node:assert/strict');
const test = require('node:test');

const offerRouter = require('../src/routes/offer.routes');

test('flat ranking response removes only the redundant grouped offer copy', () => {
  const ranking = {
    generatedAt: '2026-08-26T00:00:00.000Z',
    summary: { resultCount: 1, displayedCount: 1 },
    rankedOffers: [{ id: 'offer-1', conditionsText: 'ab 2 Stueck' }],
    rankedGroups: [{ unit: 'kg', offers: [{ id: 'offer-1', conditionsText: 'ab 2 Stueck' }] }],
  };

  const flat = offerRouter.__private.buildPublicRankingResponse(ranking, { flat: true });

  assert.deepEqual(flat, {
    generatedAt: ranking.generatedAt,
    summary: ranking.summary,
    rankedOffers: ranking.rankedOffers,
  });
  assert.equal(Object.hasOwn(flat, 'rankedGroups'), false);
  assert.equal(Object.hasOwn(ranking, 'rankedGroups'), true);
});

test('legacy ranking response remains unchanged unless flat mode is requested', () => {
  const ranking = {
    rankedOffers: [{ id: 'offer-1' }],
    rankedGroups: [{ unit: 'kg', offers: [{ id: 'offer-1' }] }],
  };

  assert.equal(offerRouter.__private.buildPublicRankingResponse(ranking), ranking);
  assert.equal(
    offerRouter.__private.buildPublicRankingResponse(ranking, { flat: false }),
    ranking,
  );
});
