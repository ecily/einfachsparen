import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  getAvailableComparison,
  getUnitPriceLabel,
  shouldDisplayUnitPrice,
} from './offers.js'

const appSource = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
const offerCardSource = fs.readFileSync(new URL('../components/search/OfferCardConsumer.jsx', import.meta.url), 'utf8')
const offerUtilsSource = fs.readFileSync(new URL('./offers.js', import.meta.url), 'utf8')

test('public hero uses the final positioning and market line', () => {
  assert.match(appSource, /Flugblätter raus\. Die besten Angebote rein\./)
  assert.match(appSource, /Supermarkt- und Drogerie-Angebote in Österreich/)
  assert.match(appSource, /Preis pro Einheit/)
  assert.match(appSource, /ehrlich/)
  assert.match(appSource, /kostenlos/)
  assert.match(appSource, /ohne Anmeldung/)
  assert.match(appSource, /von Menschen für Menschen/)
  assert.match(appSource, /BILLA · BILLA Plus · Lidl · PENNY · dm · BIPA · Müller/)
  assert.doesNotMatch(appSource, /Aktuelle Angebote finden\./)
})

test('unit-price labels describe the actual unit', () => {
  assert.equal(getUnitPriceLabel({ normalizedUnitPrice: { unit: 'l' } }), 'PREIS PRO LITER')
  assert.equal(getUnitPriceLabel({ normalizedUnitPrice: { unit: 'kg' } }), 'PREIS PRO KG')
  assert.equal(getUnitPriceLabel({ normalizedUnitPrice: { unit: 'Stk' } }), 'PREIS PRO STÜCK')
  assert.equal(getUnitPriceLabel({ normalizedUnitPrice: { unit: 'm' } }), 'PREIS PRO EINHEIT')
  const publicSource = fs.readFileSync(new URL('../components/search/KeywordSearchPage.jsx', import.meta.url), 'utf8')
    + fs.readFileSync(new URL('../components/search/OfferFeedbackPanel.jsx', import.meta.url), 'utf8')
    + fs.readFileSync(new URL('../components/shopping/ShoppingListPage.jsx', import.meta.url), 'utf8')
    + fs.readFileSync(new URL('./shoppingList.js', import.meta.url), 'utf8')

  assert.doesNotMatch(`${offerCardSource}\n${offerUtilsSource}\n${publicSource}`, /vergleichspreis/i)
})

test('unit-price information remains hidden when the safe display guard rejects it', () => {
  assert.equal(shouldDisplayUnitPrice({ normalizedUnitPrice: null }), false)
  assert.equal(shouldDisplayUnitPrice({ normalizedUnitPrice: { amount: null, unit: 'l' } }), false)
  assert.equal(shouldDisplayUnitPrice({
    normalizedUnitPrice: { amount: 1.25, unit: 'Stk' },
    packCount: 4,
    packageType: 'pack',
  }), false)
  assert.match(offerCardSource, /\{unitPriceText \? \([\s\S]*?<div className="user-card__unit-price-callout"/)
  assert.doesNotMatch(offerCardSource, /<(button|details)[^>]*className="user-card__unit-price-callout"/)
})

test('comparison interaction stays strictly guarded by available true', () => {
  const alternative = { available: true, offer: { id: 'safe-alternative' } }

  assert.equal(getAvailableComparison({ comparisonAlternative: alternative }), alternative)
  assert.equal(getAvailableComparison({ comparisonAlternative: { available: false, offer: {} } }), null)
  assert.equal(getAvailableComparison({ comparisonAlternative: { offer: {} } }), null)
  assert.equal(getAvailableComparison({}), null)
  assert.match(offerCardSource, /const comparison = getAvailableComparison\(offer\)/)
  assert.match(offerCardSource, /\{comparisonAlternative \? \([\s\S]*?<summary>Vergleichen<\/summary>/)
})

test('comparison accordion distinguishes cheaper and similar alternatives without false savings copy', () => {
  assert.match(offerCardSource, /data-comparison-type=\{comparison\.type\}/)
  assert.match(offerCardSource, /comparison\?\.type === 'cheaper_alternative'/)
  assert.match(offerCardSource, /comparison\.unitPriceDeltaLabel/)
  assert.match(offerCardSource, /user-card__comparison-condition/)
  assert.match(offerCardSource, /Ähnliche Alternative, nicht günstiger pro Einheit\./)
  assert.match(offerCardSource, /comparisonAlternative\.quantityText/)
  assert.match(offerCardSource, /formatValidityLabel\(comparisonAlternative\)/)
  assert.match(offerCardSource, /comparisonAlternative\.displayCategory \|\| comparisonAlternative\.categorySecondary/)
  assert.match(offerCardSource, /Auf die Einkaufsliste/)
})
