import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  getAvailableComparison,
  getUnitPriceLabel,
  shouldDisplayUnitPrice,
} from './offers.js'
import { getInitialPageFromPathname, getPageMeta, getPathForPage } from './seo.js'
import {
  buildSeoStaticDocument,
  prioritizeStylesheetBeforeModuleScript,
  retryBuildOperation,
  validatePriceCheckPagePayload,
} from '../../scripts/generateSeoHtml.mjs'

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
  const marketLine = appSource.match(/<p className="search-landing-hero__markets">([^<]+)<\/p>/)?.[1]

  assert.equal(marketLine, 'BILLA · BILLA Plus · Lidl · PENNY · dm · BIPA · Müller · INTERSPAR eingeschränkt')
  assert.match(marketLine, /INTERSPAR eingeschränkt/)
  assert.doesNotMatch(marketLine, /(?:^| · )(?:SPAR|EUROSPAR|PAGRO|HOFER)(?: · |$)/)
  assert.doesNotMatch(appSource, /Aktuelle Angebote finden\./)
})

test('pricecheck route stays on the pricecheck page after direct navigation and metadata updates', () => {
  assert.equal(getInitialPageFromPathname('/preischeck/bier-literpreis-vergleich/'), 'pricecheck:bier-literpreis-vergleich')
  assert.equal(getPathForPage('pricecheck:bier-literpreis-vergleich'), '/preischeck/bier-literpreis-vergleich/')
  assert.equal(getPageMeta('pricecheck:bier-literpreis-vergleich').robots, 'index,follow')
  assert.match(fs.readFileSync(new URL('../components/search/PriceCheckPage.jsx', import.meta.url), 'utf8'), /kaufklug-price-check-data/)
})

test('comparison USP facts and card labels stay visible and semantically distinct', () => {
  assert.match(appSource, /hero-compare-facts/)
  assert.match(offerCardSource, /user-card__reference-label.*Referenzpreis/)
  assert.match(offerCardSource, />Kaufbedingung<\/span>/)
  assert.match(fs.readFileSync(new URL('../components/search/SeoOfferLandingPage.jsx', import.meta.url), 'utf8'), /seo-comparison-card/)
})

test('static HTML prioritizes the local stylesheet before module hydration', () => {
  const template = '<head><script type="module" crossorigin src="/assets/app.js"></script>\n    <link rel="stylesheet" crossorigin href="/assets/app.css"></head>'
  const prioritized = prioritizeStylesheetBeforeModuleScript(template)

  assert.ok(prioritized.indexOf('app.css') < prioritized.indexOf('app.js'))

  const rendered = buildSeoStaticDocument(`${prioritized}<body><div id="root"></div></body>`, {
    path: '/',
    title: 'Startseite',
    description: 'Startseite',
    robots: 'index,follow',
    h1: 'Aktuelle Angebote',
    intro: 'Angebote vergleichen.',
    relatedLinks: [],
  }, [])
  assert.match(rendered, /id="kaufklug-critical-css"/)
  assert.match(rendered, /min-width:320px/)
  assert.match(rendered, /@media \(max-width:600px\)/)
  assert.match(rendered, /seo-static-shell/)
  assert.ok(rendered.indexOf('kaufklug-critical-css') < rendered.indexOf('app.css'))
  assert.ok(rendered.indexOf('kaufklug-critical-css') < rendered.indexOf('app.js'))
  assert.match(rendered, /<div id="root"><main class="seo-static-shell">/)
})

test('pricecheck transport retries and fails after the bounded budget', async () => {
  let attempts = 0
  await assert.rejects(
    retryBuildOperation(async () => {
      attempts += 1
      throw new Error('temporary transport failure')
    }, { attempts: 3, delayMs: 0 }),
    /temporary transport failure/,
  )
  assert.equal(attempts, 3)
})

test('pricecheck page validation fails closed for missing generatedAt and incomplete pagination', () => {
  const base = { rankedOffers: [{ id: 'offer-1' }], summary: { totalCount: 1, hasMore: false, completeResultSetVisible: true } }

  assert.throws(() => validatePriceCheckPagePayload(base), /generatedAt/)
  assert.throws(() => validatePriceCheckPagePayload({
    ...base,
    generatedAt: '2026-08-13T06:32:33.034Z',
    summary: { totalCount: 2, hasMore: true, nextOffset: null, resultSetToken: '' },
  }), /incomplete pagination/)
})

test('mobile offer cards keep content fluid and do not clamp product names', () => {
  const cssSource = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8')

  assert.match(cssSource, /\.user-card__content\s*\{[\s\S]*?width:\s*auto\s*!important;/)
  assert.match(cssSource, /\.user-card h3\s*\{[\s\S]*?-webkit-line-clamp:\s*unset\s*!important;/)
  assert.match(cssSource, /\.product-image\s*\{[\s\S]*?aspect-ratio:\s*4 \/ 3;/)
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
