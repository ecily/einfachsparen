import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const appSource = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
const pageSource = fs.readFileSync(new URL('../components/search/TopDealsPage.jsx', import.meta.url), 'utf8')
const cardSource = fs.readFileSync(new URL('../components/search/OfferCardConsumer.jsx', import.meta.url), 'utf8')
const apiSource = fs.readFileSync(new URL('./apiBase.js', import.meta.url), 'utf8')
const seoSource = fs.readFileSync(new URL('./seo.js', import.meta.url), 'utf8')

test('sticky header exposes the Top Deals route with compact mobile copy', () => {
  assert.match(appSource, /aria-label="Top Deals heute"/)
  assert.match(appSource, /page-nav__top-deals-long">Top Deals heute/)
  assert.match(appSource, /page-nav__top-deals-short">Top Deals/)
  assert.match(appSource, /handleNavigate\('top-deals'\)/)
  assert.match(seoSource, /pathname\.includes\('top-deals'\)/)
  assert.match(seoSource, /nextPage === 'top-deals'\) return '\/top-deals'/)
})

test('Top Deals page uses the guarded backend endpoint and exact trust copy', () => {
  assert.match(apiSource, /fetchJson\(`\/offers\/top-deals\?limit=\$\{safeLimit\}`\)/)
  assert.match(pageSource, /<h1 id="top-deals-title">Top Deals heute<\/h1>/)
  assert.match(pageSource, /Die stärksten verifizierten Ersparnisse nach Preis pro Einheit – Bedingungen inklusive\./)
  assert.match(pageSource, /Heute sind noch nicht genug verifizierte Vergleichswerte verfügbar\. Suche direkt nach deinem Produkt\./)
  assert.match(pageSource, /topDeal=\{deal\.topDeal\}/)
})

test('Top Deal cards retain price, unit price, reference unit price, savings, conditions and validity', () => {
  assert.match(cardSource, /topDeal\.currentUnitPrice/)
  assert.match(cardSource, /topDeal\.referenceUnitPrice/)
  assert.match(cardSource, /-\{topDeal\.discountPercent\} %/)
  assert.match(cardSource, /statt \{topDealReferenceUnitPriceText\}/)
  assert.match(cardSource, /shortConditions\.length > 0 \|\| detailedConditions\.length > 0/)
  assert.match(cardSource, /user-card__meta-pill--validity/)
  assert.match(cardSource, /<ProductImage/)
  assert.match(cardSource, /user-card__retailer-badge/)
})
