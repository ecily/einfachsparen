const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applySourceSelection,
  deriveSourceKey,
  resolveCrawlSourceSelection,
} = require('../src/services/crawl/crawlSourceSelection');

const SOURCES = [
  {
    _id: '111111111111111111111111',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    channel: 'aggregator',
    label: 'Aktionsfinder SPAR Aktionen',
    sourceUrl: 'https://www.aktionsfinder.at/pv/spar/',
    sourceType: 'aggregator',
    sourceRetailerFormat: 'spar',
    enabled: true,
    active: true,
  },
  {
    _id: '222222222222222222222222',
    retailerKey: 'interspar',
    retailerName: 'INTERSPAR',
    channel: 'aggregator',
    label: 'Aktionsfinder INTERSPAR Aktionen',
    sourceUrl: 'https://www.aktionsfinder.at/pv/interspar/',
    sourceType: 'aggregator',
    sourceRetailerFormat: 'interspar',
    enabled: true,
    active: true,
  },
  {
    _id: '333333333333333333333333',
    retailerKey: 'eurospar',
    retailerName: 'EUROSPAR',
    channel: 'aggregator',
    label: 'Aktionsfinder EUROSPAR Aktionen',
    sourceUrl: 'https://www.aktionsfinder.at/pv/eurospar/',
    sourceType: 'aggregator',
    sourceRetailerFormat: 'eurospar',
    enabled: true,
    active: true,
  },
  {
    _id: '444444444444444444444444',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    channel: 'official-flyer',
    label: 'SPAR Aktionen',
    sourceUrl: 'https://www.spar.at/aktionen',
    sourceType: 'flyer',
    sourceRetailerFormat: 'spar',
    enabled: false,
    active: true,
    disabledReason: 'disabled-source-blocked',
  },
  {
    _id: '666666666666666666666666',
    retailerKey: 'eurospar',
    retailerName: 'EUROSPAR',
    channel: 'official-flyer',
    label: 'EUROSPAR Steiermark offizielles PDF-Flugblatt',
    sourceUrl: 'https://flugblatt.spar.at/steiermark/eurospar/260507-1-flugblatt-kw-19/getPdf.ashx',
    sourceType: 'pdf',
    sourceRetailerFormat: 'eurospar',
    enabled: true,
    active: true,
  },
  {
    _id: '555555555555555555555555',
    retailerKey: 'billa',
    retailerName: 'Billa',
    channel: 'aggregator',
    label: 'Aktionsfinder BILLA Aktionen',
    sourceUrl: 'https://www.aktionsfinder.at/pv/billa/',
    sourceType: 'aggregator',
    enabled: true,
    active: true,
  },
];

function matchesFilter(source, filter = {}) {
  if (filter.active !== undefined && source.active !== filter.active) return false;
  if (filter.enabled?.$ne === false && source.enabled === false) return false;
  if (filter.retailerKey?.$in && !filter.retailerKey.$in.includes(source.retailerKey)) return false;
  if (filter._id?.$in && !filter._id.$in.map(String).includes(String(source._id))) return false;
  return true;
}

function fakeSourceModel(sources = SOURCES, seenFilters = []) {
  return {
    find(filter) {
      seenFilters.push(filter);
      const rows = sources.filter((source) => matchesFilter(source, filter));
      return {
        maxTimeMS() {
          return this;
        },
        lean() {
          return Promise.resolve(rows);
        },
      };
    },
  };
}

function fakeOfferModel(rows = []) {
  return {
    aggregate() {
      return Promise.resolve(rows);
    },
  };
}

test('source key derivation recognizes the three SPAR Aktionsfinder sources and disabled official source', () => {
  assert.equal(deriveSourceKey(SOURCES[0]), 'aktionsfinder-spar');
  assert.equal(deriveSourceKey(SOURCES[1]), 'aktionsfinder-interspar');
  assert.equal(deriveSourceKey(SOURCES[2]), 'aktionsfinder-eurospar');
  assert.equal(deriveSourceKey(SOURCES[3]), 'spar-official-flyer');
  assert.equal(deriveSourceKey(SOURCES[4]), 'eurospar-official-flyer-pdf');
});

test('sourceKeys select exactly the requested runnable sources without SPAR official', async () => {
  const selection = await resolveCrawlSourceSelection({
    Source: fakeSourceModel(),
    Offer: fakeOfferModel([{ _id: 'spar', activeOfferCount: 10 }]),
    sourceKeys: ['aktionsfinder-spar', 'aktionsfinder-interspar', 'aktionsfinder-eurospar'],
    sourceSelectionRequested: true,
  });

  assert.equal(selection.wouldRunCount, 3);
  assert.deepEqual(selection.matchedSources.map((source) => source.sourceKey).sort(), [
    'aktionsfinder-eurospar',
    'aktionsfinder-interspar',
    'aktionsfinder-spar',
  ]);
  assert.equal(selection.matchedSources.some((source) => source.sourceKey === 'spar-official-flyer'), false);
  assert.deepEqual(selection.effectiveRetailerKeys, ['spar', 'eurospar', 'interspar']);
});

test('sourceKeys can select SPAR official PDF source exactly', async () => {
  const selection = await resolveCrawlSourceSelection({
    Source: fakeSourceModel(),
    Offer: fakeOfferModel([{ _id: 'spar', activeOfferCount: 10 }]),
    sourceKeys: ['eurospar-official-flyer-pdf'],
    sourceSelectionRequested: true,
  });

  assert.equal(selection.wouldRunCount, 1);
  assert.equal(selection.matchedSources[0].sourceKey, 'eurospar-official-flyer-pdf');
  assert.equal(selection.matchedSources[0].sourceRetailerFormat, 'eurospar');
  assert.deepEqual(selection.effectiveRetailerKeys, ['eurospar']);
});

test('retailerKeys and sourceKeys act as an intersection', async () => {
  await assert.rejects(
    resolveCrawlSourceSelection({
      Source: fakeSourceModel(),
      Offer: fakeOfferModel(),
      retailerKeys: ['billa'],
      sourceKeys: ['aktionsfinder-spar'],
      sourceSelectionRequested: true,
    }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /No runnable sources/);
      assert.equal(error.details.skippedSources.some((source) => source.skippedReason === 'retailer-filter'), true);
      return true;
    }
  );
});

test('unknown sourceKeys produce a 400 selection error', async () => {
  await assert.rejects(
    resolveCrawlSourceSelection({
      Source: fakeSourceModel(),
      Offer: fakeOfferModel(),
      sourceKeys: ['aktionsfinder-spar', 'missing-source'],
      sourceSelectionRequested: true,
    }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.deepEqual(error.details.unknownSourceKeys, ['missing-source']);
      return true;
    }
  );
});

test('disabled source is skipped by default and can appear beside runnable sources', () => {
  const selection = applySourceSelection({
    sources: SOURCES,
    sourceKeys: ['aktionsfinder-spar', 'spar-official-flyer'],
    allowDisabled: false,
  });

  assert.deepEqual(selection.selectedSources.map(deriveSourceKey), ['aktionsfinder-spar']);
  assert.deepEqual(selection.disabledSources.map((source) => source.sourceKey), ['spar-official-flyer']);
});

test('retailerKeys-only path remains compatible and excludes disabled sources', async () => {
  const seenFilters = [];
  const selection = await resolveCrawlSourceSelection({
    Source: fakeSourceModel(SOURCES, seenFilters),
    Offer: fakeOfferModel([{ _id: 'spar', activeOfferCount: 10 }]),
    retailerKeys: ['spar'],
  });

  assert.equal(selection.wouldRunCount, 1);
  assert.deepEqual(seenFilters[0].retailerKey, { $in: ['spar'] });
  assert.deepEqual(seenFilters[0].enabled, { $ne: false });
});

test('dryRun with empty selection is rejected to avoid accidental full crawl preview', async () => {
  await assert.rejects(
    resolveCrawlSourceSelection({
      Source: fakeSourceModel(),
      Offer: fakeOfferModel(),
      dryRun: true,
    }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /dryRun requires/);
      return true;
    }
  );
});
