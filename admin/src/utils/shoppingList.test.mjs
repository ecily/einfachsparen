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
  savings: { amount: 1 },
}

const puntigamerOffer = {
  id: 'puntigamer-1plus1',
  title: 'Puntigamer das bierige Bier',
  retailerName: 'INTERSPAR',
  priceCurrent: { amount: 14.9, currency: 'EUR' },
  quantityText: '20 x 0,5 l',
  conditionsText: '1+1 gratis / 1 Kiste 29,80 / ab 2 Kisten je 14,90 / Keine weiteren Rabatte / Joker moeglich',
  minimumPurchaseQty: 2,
  referencePrice: { amount: 29.8, allowsSavings: true },
  savings: { amount: 29.8 },
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
  assert.equal(pricingAtThree.referenceTotal, 7.47)
  assert.equal(pricingAtThree.knownSavings, 1)
  assert.equal(pricingAtThree.remainderQuantity, 1)
  assert.equal(
    getShoppingListRemainderHint(item, 3),
    'Nimm noch 1 Packung dazu, damit der nächste Angebotsblock vollständig ist. Die übrige Menge rechnen wir vorsichtig zum Vergleichspreis.'
  )

  const pricingAtFour = getShoppingListItemPricing(item, 4)
  assert.equal(pricingAtFour.estimatedTotal, 7.96)
  assert.equal(pricingAtFour.knownSavings, 2)
  assert.equal(getShoppingListRemainderHint(item, 4), '')
})

test('shopping list pricing derives bundle savings from current and reference price', () => {
  const item = buildShoppingListItem(puntigamerOffer)

  assert.equal(item.minimumPurchaseQty, 2)
  assert.equal(item.minimumPurchaseUnit, 'crate')
  assert.equal(getShoppingListItemPricing(item, 2).estimatedTotal, 29.8)
  assert.equal(getShoppingListItemPricing(item, 2).referenceTotal, 59.6)
  assert.equal(getShoppingListItemPricing(item, 2).knownSavings, 29.8)
  assert.equal(getShoppingListRemainderHint(item, 2), '')

  const pricingAtThree = getShoppingListItemPricing(item, 3)
  assert.equal(pricingAtThree.estimatedTotal, 59.6)
  assert.equal(pricingAtThree.referenceTotal, 89.4)
  assert.equal(pricingAtThree.knownSavings, 29.8)
  assert.equal(
    getShoppingListRemainderHint(item, 3),
    'Nimm noch 1 Kiste dazu, damit der nächste Angebotsblock vollständig ist. Die übrige Menge rechnen wir vorsichtig zum Vergleichspreis.'
  )

  const pricingAtFour = getShoppingListItemPricing(item, 4)
  assert.equal(pricingAtFour.estimatedTotal, 59.6)
  assert.equal(pricingAtFour.referenceTotal, 119.2)
  assert.equal(pricingAtFour.knownSavings, 59.6)
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
  assert.equal(
    getShoppingListRemainderHint(item, 3),
    'Nimm noch 1 Stück dazu, damit der nächste Angebotsblock vollständig ist. Bitte prüfe im Markt, ob die übrige Menge den Angebotspreis bekommt.'
  )
})
