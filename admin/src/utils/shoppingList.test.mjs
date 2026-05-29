import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildShoppingListItem,
  getShoppingListItemPricing,
  getShoppingListItemQuantity,
  getShoppingListRemainderHint,
  getShoppingListSummaryForQuantities,
} from './shoppingList.js'

const maggiOffer = {
  id: 'maggi-magic-asia',
  title: 'MAGGI Magic Asia Gebratene Nudeln Ente',
  retailerName: 'BILLA',
  priceCurrent: { amount: 1.99, currency: 'EUR' },
  conditionsText: 'Gilt ab 2 Packungen',
  referencePrice: { amount: 2.49, allowsSavings: true },
  savings: { amount: 0.5 },
}

test('shopping list item starts at recognized minimum quantity', () => {
  const item = buildShoppingListItem(maggiOffer)

  assert.equal(item.minimumPurchaseQty, 2)
  assert.equal(item.minimumPurchaseUnit, 'pack')
  assert.equal(getShoppingListItemQuantity(item, {}), 2)
  assert.equal(getShoppingListItemQuantity(item, { [item.id]: 1 }), 2)
})

test('shopping list pricing handles minimum blocks and conservative remainder with reference price', () => {
  const item = buildShoppingListItem(maggiOffer)

  assert.deepEqual(
    {
      total: getShoppingListItemPricing(item, 2).estimatedTotal,
      savings: getShoppingListItemPricing(item, 2).knownSavings,
      hint: getShoppingListRemainderHint(item, 2),
    },
    {
      total: 3.98,
      savings: 1,
      hint: '',
    }
  )

  const pricingAtThree = getShoppingListItemPricing(item, 3)
  assert.equal(pricingAtThree.estimatedTotal, 6.47)
  assert.equal(pricingAtThree.knownSavings, 1)
  assert.equal(pricingAtThree.remainderQuantity, 1)
  assert.match(getShoppingListRemainderHint(item, 3), /nicht sicher/)

  const pricingAtFour = getShoppingListItemPricing(item, 4)
  assert.equal(pricingAtFour.estimatedTotal, 7.96)
  assert.equal(pricingAtFour.knownSavings, 2)
  assert.equal(getShoppingListRemainderHint(item, 4), '')
})

test('shopping list summary matches visible item quantity', () => {
  const item = buildShoppingListItem(maggiOffer)
  const summary = getShoppingListSummaryForQuantities([item], { [item.id]: 3 })

  assert.equal(summary.offerTotal, 6.47)
  assert.equal(summary.knownSavings, 1)
  assert.equal(summary.knownSavingsCount, 1)
})

test('offers without a recognized minimum keep quantity one behavior', () => {
  const item = buildShoppingListItem({
    id: 'normal-offer',
    title: 'Normales Angebot',
    retailerName: 'SPAR',
    priceCurrent: { amount: 1.49, currency: 'EUR' },
    referencePrice: { amount: 1.99, allowsSavings: true },
    savings: { amount: 0.5 },
  })

  assert.equal(getShoppingListItemQuantity(item, {}), 1)
  assert.equal(getShoppingListItemPricing(item, 3).estimatedTotal, 4.47)
  assert.equal(getShoppingListItemPricing(item, 3).knownSavings, 1.5)
  assert.equal(getShoppingListRemainderHint(item, 3), '')
})

test('remainder without reference price is not counted as known savings and gets a trust hint', () => {
  const item = buildShoppingListItem({
    id: 'minimum-no-reference',
    title: 'Mindestmenge ohne Stattpreis',
    retailerName: 'HOFER',
    priceCurrent: { amount: 2, currency: 'EUR' },
    conditionsText: 'Gilt ab 2 Stück',
  })

  const pricing = getShoppingListItemPricing(item, 3)

  assert.equal(pricing.estimatedTotal, 6)
  assert.equal(pricing.knownSavings, 0)
  assert.equal(pricing.hasUnpricedRemainder, true)
  assert.match(getShoppingListRemainderHint(item, 3), /Angebotspreis gedeckt/)
})
