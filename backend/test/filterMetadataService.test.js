const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const Category = require('../src/models/Category');
const {
  getCategoryFilters,
  _private: { syncFilterMetadataCollection },
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

test('filter metadata rebuild does not use a full transaction or mutate offers', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'filters', 'filterMetadataService.js'),
    'utf8'
  );

  assert.equal(source.includes('withTransaction'), false);
  assert.equal(source.includes('startSession'), false);
  assert.equal(/Offer\.(deleteMany|insertMany|bulkWrite|updateOne|updateMany|findOneAndUpdate)/.test(source), false);
});
