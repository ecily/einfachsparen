const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSnapshotItems } = require('../src/services/shoppingLists/sharedShoppingListService');
const SharedShoppingList = require('../src/models/SharedShoppingList');

test('requested pack count survives actual sanitizer, Mongoose document and serialized recipient', () => {
  const items = sanitizeSnapshotItems({ items: [{ offerId: 'wish:test', title: 'Haferdrink', requestedQuantity: 3, priceCurrent: null }] });
  const list = new SharedShoppingList({ shareId: 'local-only-quantity', expiresAt: new Date('2030-01-01'), items });
  assert.equal(list.validateSync(), undefined);
  const restored = SharedShoppingList.hydrate(JSON.parse(JSON.stringify(list.toObject())));
  assert.equal(restored.toObject().items[0].requestedQuantity, 3);
  assert.equal(restored.toObject().items[0].priceCurrent.amount, null);
});

test('legacy shared items default to one; untrusted quantities cannot expand the budget', () => {
  for (const quantity of [undefined, null, 0, -1, 100, 1.5, Infinity, '3', {}, [3]]) {
    assert.equal(sanitizeSnapshotItems({ items: [{ title: 'Milch', requestedQuantity: quantity }] })[0].requestedQuantity, 1);
  }
  for (const quantity of [1, 3, 99]) {
    assert.equal(sanitizeSnapshotItems({ items: [{ title: 'Milch', requestedQuantity: quantity }] })[0].requestedQuantity, quantity);
  }
});
