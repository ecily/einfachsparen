import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { buildShareSnapshot, buildShoppingListItemFromSnapshot, getShoppingListItemQuantity } from './shoppingList.js'
import { buildPartialPlan } from './shoppingAssistant.js'
const require = createRequire(import.meta.url)
const { sanitizeSnapshotItems } = require('../../../backend/src/services/shoppingLists/sharedShoppingListService.js')

test('chosen pack count survives sender snapshot, backend contract and recipient adoption/reload', () => {
  const item = { id: 'wish:quantity', manual: true, title: 'Haferdrink' }
  const payload = buildShareSnapshot([item], { [item.id]: 3 })
  const [received] = sanitizeSnapshotItems(payload)
  const adopted = JSON.parse(JSON.stringify(buildShoppingListItemFromSnapshot(received)))
  assert.equal(adopted.manual, true)
  assert.equal(getShoppingListItemQuantity(adopted), 3)
  assert.equal(buildPartialPlan([adopted]).rows[0].quantity, 3)
  assert.equal(buildPartialPlan([adopted]).partialCents, 0)
  assert.equal(getShoppingListItemQuantity(adopted, { [item.id]: 5 }), 5)
});

test('legacy counts and merchant minimums remain safe without trusting shared prices', () => {
  const adopted = buildShoppingListItemFromSnapshot({ offerId: 'legacy', title: 'Milch' })
  assert.equal(getShoppingListItemQuantity(adopted), 1)
  assert.equal(buildPartialPlan([adopted]).confirmed.length, 0)
  const conditional = { id: 'condition', minimumPurchaseQty: 2, conditionsText: 'Gilt ab 2 Packungen' }
  assert.equal(buildShareSnapshot([conditional]).items[0].requestedQuantity, 2)
});
