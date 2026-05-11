const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseBackfillArgs,
  runOfferSearchTokenBackfill,
} = require('../src/services/offers/offerSearchTokenBackfill');

function buildFakeOfferModel(offers, calls) {
  return {
    find(filter) {
      calls.find.push(filter);
      return {
        select(fields) {
          calls.select.push(fields);
          return this;
        },
        sort(sort) {
          calls.sort.push(sort);
          return this;
        },
        limit(limit) {
          calls.limit.push(limit);
          return this;
        },
        async lean() {
          return offers;
        },
      };
    },
    async updateOne(filter, update) {
      calls.updateOne.push({ filter, update });
      return { modifiedCount: 1 };
    },
  };
}

test('backfill args default to dry-run and parse apply with limit', () => {
  assert.deepEqual(parseBackfillArgs([]), { apply: false, limit: 100 });
  assert.deepEqual(parseBackfillArgs(['--limit=5', '--apply']), { apply: true, limit: 5 });
  assert.deepEqual(parseBackfillArgs(['--limit', '7']), { apply: false, limit: 7 });
});

test('offer search token backfill dry-run does not write', async () => {
  const calls = { find: [], select: [], sort: [], limit: [], updateOne: [] };
  const report = await runOfferSearchTokenBackfill({
    apply: false,
    limit: 5,
    OfferModel: buildFakeOfferModel([
      { _id: 'offer-1', title: 'Lavazza Kaffee Crema' },
    ], calls),
  });

  assert.equal(report.dryRun, true);
  assert.equal(report.scanned, 1);
  assert.equal(report.modified, 1);
  assert.equal(calls.updateOne.length, 0);
  assert.deepEqual(report.writeFields, ['searchTokens', 'searchTokenVersion']);
});

test('offer search token backfill apply writes only token fields', async () => {
  const calls = { find: [], select: [], sort: [], limit: [], updateOne: [] };
  const report = await runOfferSearchTokenBackfill({
    apply: true,
    limit: 5,
    OfferModel: buildFakeOfferModel([
      { _id: 'offer-1', title: 'Lavazza Kaffee Crema' },
    ], calls),
  });

  assert.equal(report.dryRun, false);
  assert.equal(report.modified, 1);
  assert.equal(calls.updateOne.length, 1);
  assert.deepEqual(Object.keys(calls.updateOne[0].update), ['$set']);
  assert.deepEqual(Object.keys(calls.updateOne[0].update.$set).sort(), ['searchTokenVersion', 'searchTokens']);
  assert.ok(calls.updateOne[0].update.$set.searchTokens.includes('kaffee'));
});
