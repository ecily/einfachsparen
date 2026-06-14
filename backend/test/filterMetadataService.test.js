const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const Category = require('../src/models/Category');
const Retailer = require('../src/models/Retailer');
const RetailerCategoryStat = require('../src/models/RetailerCategoryStat');
const {
  getCategoryFilters,
  getRetailerFilters,
  _private: {
    FILTER_METADATA_OFFER_SELECT_FIELDS,
    buildFilterMetadataOfferMatch,
    buildRetailerDocuments,
    isPublicRetailerEnabled,
    syncFilterMetadataCollection,
  },
} = require('../src/services/filters/filterMetadataService');

function stableValue(value) {
  return JSON.stringify(value, (_, nestedValue) => {
    if (nestedValue instanceof Date) {
      return nestedValue.toISOString();
    }

    return nestedValue;
  });
}

function createMemoryModel(initialDocuments = []) {
  const documents = new Map(initialDocuments.map((document) => [document.id, { ...document }]));
  const calls = {
    bulkWrite: [],
  };

  function findDocument(filter) {
    return [...documents.values()].find((document) => Object.entries(filter).every(([key, value]) => document[key] === value));
  }

  return {
    calls,
    documents,
    find() {
      const lean = async () => [...documents.values()].map((document) => ({ ...document }));

      return {
        lean,
        select() {
          return {
            lean,
          };
        },
      };
    },
    async bulkWrite(operations) {
      calls.bulkWrite.push(operations);

      let matchedCount = 0;
      let modifiedCount = 0;
      let upsertedCount = 0;

      for (const operation of operations) {
        const updateOne = operation.updateOne;
        const existing = findDocument(updateOne.filter);

        if (existing) {
          matchedCount += 1;
          const before = stableValue(existing);
          Object.assign(existing, updateOne.update.$set || {});

          if (stableValue(existing) !== before) {
            modifiedCount += 1;
          }

          continue;
        }

        if (updateOne.upsert) {
          upsertedCount += 1;
          const inserted = {
            ...updateOne.filter,
            ...(updateOne.update.$setOnInsert || {}),
            ...(updateOne.update.$set || {}),
          };
          documents.set(inserted.id || Object.values(updateOne.filter).join('::'), inserted);
        }
      }

      return { matchedCount, modifiedCount, upsertedCount };
    },
  };
}

test('syncFilterMetadataCollection upserts documents and deactivates stale entries with counts', async () => {
  const Model = createMemoryModel([
    { id: 'hofer', retailerKey: 'hofer', retailerName: 'Hofer', activeOfferCount: 5, isActive: true },
    { id: 'old', retailerKey: 'old', retailerName: 'Old', activeOfferCount: 3, isActive: true },
  ]);

  const result = await syncFilterMetadataCollection({
    name: 'retailers',
    Model,
    keyFields: ['retailerKey'],
    documents: [
      { id: 'hofer', retailerKey: 'hofer', retailerName: 'Hofer', activeOfferCount: 8, isActive: true },
      { id: 'penny', retailerKey: 'penny', retailerName: 'PENNY', activeOfferCount: 4, isActive: true },
    ],
    deactivateUpdate: { isActive: false, activeOfferCount: 0 },
  });

  assert.equal(result.collection, 'retailers');
  assert.equal(result.desired, 2);
  assert.equal(result.upserted, 1);
  assert.equal(result.modified, 1);
  assert.equal(result.deactivated, 1);
  assert.equal(Model.documents.get('old').isActive, false);
  assert.equal(Model.documents.get('old').activeOfferCount, 0);
  assert.equal(Model.documents.get('penny').retailerName, 'PENNY');
});

test('syncFilterMetadataCollection keeps existing filter data when a collection write fails before applying changes', async () => {
  const existing = { id: 'hofer', retailerKey: 'hofer', retailerName: 'Hofer', activeOfferCount: 5, isActive: true };
  const Model = createMemoryModel([existing]);
  const originalBulkWrite = Model.bulkWrite;

  Model.bulkWrite = async () => {
    throw new Error('simulated write failure');
  };

  await assert.rejects(
    syncFilterMetadataCollection({
      name: 'retailers',
      Model,
      keyFields: ['retailerKey'],
      documents: [{ id: 'hofer', retailerKey: 'hofer', retailerName: 'Hofer neu', activeOfferCount: 10, isActive: true }],
      deactivateUpdate: { isActive: false },
    }),
    /simulated write failure/
  );

  assert.deepEqual(Model.documents.get('hofer'), existing);
  Model.bulkWrite = originalBulkWrite;
});

test('category filter response shape stays compatible', async () => {
  const originalFind = Category.find;

  Category.find = () => ({
    sort() {
      return {
        async lean() {
          return [
            {
              mainCategoryKey: 'kaese',
              mainCategoryLabel: 'Kaese',
              offerCount: 2,
              subcategories: [{ subcategoryKey: 'schnittkaese', subcategoryLabel: 'Schnittkaese', offerCount: 2 }],
              lastSeenAt: new Date('2026-05-09T10:00:00.000Z'),
              isActive: true,
              internalOnly: 'ignored by response mapper',
            },
          ];
        },
      };
    },
  });

  try {
    const categories = await getCategoryFilters();

    assert.deepEqual(Object.keys(categories[0]), [
      'mainCategoryKey',
      'mainCategoryLabel',
      'offerCount',
      'subcategories',
      'lastSeenAt',
      'isActive',
    ]);
    assert.deepEqual(Object.keys(categories[0].subcategories[0]), [
      'subcategoryKey',
      'subcategoryLabel',
      'offerCount',
    ]);
  } finally {
    Category.find = originalFind;
  }
});

test('public retailer facets hide temporarily disabled retailers', async () => {
  const originalFind = Retailer.find;
  const documents = [
    { retailerKey: 'spar', retailerName: 'SPAR', activeOfferCount: 12, isActive: true },
    { retailerKey: 'eurospar', retailerName: 'EUROSPAR', activeOfferCount: 8, isActive: true },
    { retailerKey: 'interspar', retailerName: 'INTERSPAR', activeOfferCount: 6, isActive: true },
  ];

  Retailer.find = (filter) => {
    assert.deepEqual(filter.retailerKey?.$nin, ['eurospar']);

    return {
      sort() {
        return {
          async lean() {
            return documents.filter((document) => !filter.retailerKey.$nin.includes(document.retailerKey));
          },
        };
      },
    };
  };

  try {
    const retailers = await getRetailerFilters();
    assert.deepEqual(retailers.map((retailer) => retailer.retailerKey), ['spar', 'interspar']);
    assert.equal(isPublicRetailerEnabled('eurospar'), false);
    assert.equal(isPublicRetailerEnabled('spar'), true);
  } finally {
    Retailer.find = originalFind;
  }
});

test('category facets ignore public-disabled retailer scopes', async () => {
  const originalFind = RetailerCategoryStat.find;
  const stats = [
    {
      retailerKey: 'spar',
      mainCategoryKey: 'getraenke',
      mainCategoryLabel: 'Getraenke',
      subcategoryKey: 'bier',
      subcategoryLabel: 'Bier',
      activeOfferCount: 3,
      lastSeenAt: new Date('2026-06-14T10:00:00.000Z'),
    },
    {
      retailerKey: 'eurospar',
      mainCategoryKey: 'drogerie',
      mainCategoryLabel: 'Drogerie',
      subcategoryKey: 'waschmittel',
      subcategoryLabel: 'Waschmittel',
      activeOfferCount: 4,
      lastSeenAt: new Date('2026-06-14T10:00:00.000Z'),
    },
  ];

  let findCalls = 0;
  RetailerCategoryStat.find = (filter) => {
    findCalls += 1;
    assert.deepEqual(filter.retailerKey?.$in, ['spar']);

    return {
      sort() {
        return {
          async lean() {
            return stats.filter((stat) => filter.retailerKey.$in.includes(stat.retailerKey));
          },
        };
      },
    };
  };

  try {
    const categories = await getCategoryFilters({ retailerKeys: ['spar', 'eurospar'] });
    assert.deepEqual(categories.map((category) => category.mainCategoryKey), ['getraenke']);

    const hiddenOnly = await getCategoryFilters({ retailerKeys: ['eurospar'] });
    assert.deepEqual(hiddenOnly, []);
    assert.equal(findCalls, 1);
  } finally {
    RetailerCategoryStat.find = originalFind;
  }
});

test('retailer filter counts include fresh plausible Aktionsfinder offers without validTo', () => {
  const now = new Date('2026-05-22T12:00:00.000Z');
  const freshAktionsfinderOffer = {
    retailerKey: 'spar',
    retailerName: 'SPAR',
    title: 'SPAR Bio Kornspitz Aktion',
    sourceType: 'aktionsfinder-json',
    sourceUrl: 'https://www.aktionsfinder.at/ppcv/spar/bio-kornspitz',
    status: 'active',
    isActiveNow: true,
    publishStatus: 'crawl-run-success',
    validTo: null,
    lastSeenAt: new Date('2026-05-22T08:00:00.000Z'),
    lastSeenRunId: 'crawl-spar-fresh',
    crawlJobId: 'crawl-spar-fresh',
    quantityText: '1 Stk',
    unitValue: 1,
    comparableUnit: 'Stk',
    priceCurrent: { amount: 0.49, currency: 'EUR' },
    quality: { parsingConfidence: 0.9, comparisonSafe: true },
  };
  const staleAktionsfinderOffer = {
    ...freshAktionsfinderOffer,
    title: 'SPAR Alte Aktion',
    lastSeenAt: new Date('2026-04-20T08:00:00.000Z'),
    lastSeenRunId: 'crawl-spar-old',
    crawlJobId: 'crawl-spar-old',
  };
  const expiredOffer = {
    ...freshAktionsfinderOffer,
    retailerKey: 'eurospar',
    retailerName: 'EUROSPAR',
    title: 'EUROSPAR Abgelaufene Aktion',
    validTo: new Date('2026-05-20T23:59:59.999Z'),
    lastSeenAt: new Date('2026-05-20T08:00:00.000Z'),
  };

  const retailers = buildRetailerDocuments(
    [],
    [freshAktionsfinderOffer, staleAktionsfinderOffer, expiredOffer],
    now,
    [],
    []
  );

  const spar = retailers.find((retailer) => retailer.retailerKey === 'spar');
  const eurospar = retailers.find((retailer) => retailer.retailerKey === 'eurospar');

  assert.equal(spar.totalOffers, 2);
  assert.equal(spar.activeOfferCount, 1);
  assert.equal(spar.activeOffers, 1);
  assert.equal(eurospar.totalOffers, 1);
  assert.equal(eurospar.activeOfferCount, 0);
  assert.equal(eurospar.activeOffers, 0);
});

test('filter metadata offer select keeps crawl freshness fields aligned with ranking visibility', () => {
  for (const field of [
    'crawlJobId',
    'lastSeenAt',
    'lastSeenRunId',
    'lastSeenSourceRunId',
    'publishStatus',
    'sourceRunStatus',
  ]) {
    assert.equal(FILTER_METADATA_OFFER_SELECT_FIELDS.includes(field), true);
  }
});

test('filter metadata rebuild scopes offer input to current active offers', () => {
  assert.deepEqual(buildFilterMetadataOfferMatch(), {
    status: 'active',
    isActiveNow: true,
  });
});

test('filter metadata rebuild does not use a full transaction or mutate offers', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'filters', 'filterMetadataService.js'),
    'utf8'
  );

  assert.equal(source.includes('withTransaction'), false);
  assert.equal(source.includes('startSession'), false);
  assert.equal(/Offer\.(deleteMany|insertMany|bulkWrite|updateOne|updateMany|findOneAndUpdate)/.test(source), false);
});
