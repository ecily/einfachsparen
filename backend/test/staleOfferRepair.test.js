const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REPAIR_REASON,
  buildSoftDeactivationUpdate,
  isRepairEligibleOffer,
  runStaleAktionsfinderRepair,
} = require('../src/services/repairs/staleOfferRepair');

function offer(overrides = {}) {
  return {
    _id: overrides._id || 'offer-1',
    title: 'Goesser Maerzen SPAR 0.50 Liter 20 Stueck',
    retailerKey: 'spar',
    retailerName: 'Spar',
    sourceId: 'source-1',
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/pv/spar/',
    status: 'active',
    isActiveNow: true,
    validTo: null,
    createdAt: new Date('2026-05-01T08:00:00.000Z'),
    updatedAt: new Date('2026-05-01T08:00:00.000Z'),
    lastSeenAt: new Date('2026-05-01T08:00:00.000Z'),
    rawFacts: { sourceType: 'aktionsfinder-json' },
    priceCurrent: { amount: 14.9 },
    ...overrides,
  };
}

class FakeQuery {
  constructor(rows) {
    this.rows = rows;
    this._limit = rows.length;
  }

  select() {
    return this;
  }

  sort() {
    return this;
  }

  limit(value) {
    this._limit = value;
    return this;
  }

  async lean() {
    return this.rows.slice(0, this._limit);
  }
}

function fakeOfferModel(rows, calls) {
  return {
    async countDocuments(match) {
      calls.countDocuments.push(match);
      return rows.length;
    },
    find(match) {
      calls.find.push(match);
      return new FakeQuery(rows);
    },
    async updateMany(match, update) {
      calls.updateMany.push({ match, update });
      return { modifiedCount: rows.length };
    },
  };
}

function fakeSourceModel(rows) {
  return {
    find() {
      return {
        select() {
          return {
            async lean() {
              return rows;
            },
          };
        },
      };
    },
  };
}

test('repair eligibility only accepts stale active Aktionsfinder offers without validTo', () => {
  const now = new Date('2026-05-21T12:00:00.000Z');

  assert.equal(isRepairEligibleOffer(offer(), { now, maxAgeDays: 14 }), true);
  assert.equal(
    isRepairEligibleOffer(
      offer({
        sourceType: 'billa-official-algolia',
        sourceUrl: 'https://shop.billa.at/p/test',
        sourceUrls: [],
        evidenceUrls: [],
        rawFacts: { sourceType: 'billa-official-algolia' },
      }),
      { now, maxAgeDays: 14 },
    ),
    false,
  );
  assert.equal(isRepairEligibleOffer(offer({ validTo: new Date('2026-05-22T23:59:59.999Z') }), { now, maxAgeDays: 14 }), false);
  assert.equal(isRepairEligibleOffer(offer({ lastSeenAt: new Date('2026-05-21T08:00:00.000Z') }), { now, maxAgeDays: 14 }), false);
  assert.equal(isRepairEligibleOffer(offer({ status: 'expired', isActiveNow: false }), { now, maxAgeDays: 14 }), false);
});

test('dry-run reports matches and examples without mutating', async () => {
  const calls = { countDocuments: [], find: [], updateMany: [] };

  const result = await runStaleAktionsfinderRepair({
    OfferModel: fakeOfferModel([offer()], calls),
    SourceModel: fakeSourceModel([
      {
        _id: 'source-1',
        retailerKey: 'spar',
        retailerName: 'Spar',
        channel: 'aggregator',
        sourceUrl: 'https://www.aktionsfinder.at/pv/spar/',
        sourceRetailerFormat: 'spar',
      },
    ]),
    apply: false,
    now: new Date('2026-05-21T12:00:00.000Z'),
    maxAgeDays: 14,
    sourceKeys: ['aktionsfinder-spar'],
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.wouldDeactivateCount, 1);
  assert.equal(result.deactivatedCount, 0);
  assert.equal(result.examples[0].sourceKey, 'aktionsfinder-spar');
  assert.equal(calls.updateMany.length, 0);
  assert.equal(calls.countDocuments[0].status, 'active');
  assert.equal(calls.countDocuments[0].isActiveNow, true);
  assert.equal(calls.countDocuments[0].validTo, null);
});

test('apply performs only soft deactivation update', async () => {
  const calls = { countDocuments: [], find: [], updateMany: [] };
  const now = new Date('2026-05-21T12:00:00.000Z');

  const result = await runStaleAktionsfinderRepair({
    OfferModel: fakeOfferModel([offer()], calls),
    apply: true,
    now,
    maxAgeDays: 14,
  });

  assert.equal(result.applied, true);
  assert.equal(result.deactivatedCount, 1);
  assert.equal(calls.updateMany.length, 1);
  assert.deepEqual(calls.updateMany[0].update, buildSoftDeactivationUpdate({ now }));
  assert.equal(calls.updateMany[0].update.$set.status, 'expired');
  assert.equal(calls.updateMany[0].update.$set.isActiveNow, false);
  assert.equal(calls.updateMany[0].update.$set.deactivationReason, REPAIR_REASON);
});
