import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { QUICK_SEARCH_TERMS } from './searchDiscovery.js'
import { getSeoLandingPageByKey, seoFooterLinkGroups } from './seoLandingPages.js'

const seoFooterSource = fs.readFileSync(new URL('../components/layout/SeoFooterLinks.jsx', import.meta.url), 'utf8')

test('quick searches contain only the validated public terms', () => {
  assert.deepEqual(QUICK_SEARCH_TERMS, [
    'Bier',
    'Kaffee',
    'Waschmittel',
    'Zahnpasta',
    'Sonnencreme',
    'Toilettenpapier',
  ])
  assert.equal(QUICK_SEARCH_TERMS.includes('Milch'), false)
})

test('faster-offer links omit weak categories and unavailable retailers', () => {
  const categoryLabels = seoFooterLinkGroups.find((group) => group.title === 'Kategorien').links.map((link) => link.label)
  const retailerLabels = seoFooterLinkGroups.find((group) => group.title === 'Märkte').links.map((link) => link.label)

  assert.deepEqual(categoryLabels, [
    'Alle Angebote',
    'Supermarkt Angebote',
    'Drogerie Angebote',
    'Kaffee Angebote',
    'Bier Angebote',
    'Softdrinks Angebote',
    'Waschmittel Angebote',
    'Schokolade Angebote',
    'Windeln Angebote',
    'Duschgel Angebote',
    'Nudeln Angebote',
    'Chips Angebote',
  ])
  assert.equal(retailerLabels.includes('SPAR Angebote'), false)
  assert.equal(retailerLabels.includes('EUROSPAR Angebote'), false)
  assert.equal(retailerLabels.includes('PAGRO Angebote'), false)
  assert.equal(retailerLabels.includes('HOFER Angebote'), false)
  assert.equal(retailerLabels.includes('Müller Angebote'), true)
})

test('popular-offer navigation uses the final user-facing heading', () => {
  assert.match(seoFooterSource, /<h2>Direkt zu beliebten Angeboten<\/h2>/)
  assert.doesNotMatch(seoFooterSource, /Angebote schneller finden/)
})

test('Müller button has a dedicated official-online landing target', () => {
  const muellerPage = getSeoLandingPageByKey('mueller')

  assert.equal(muellerPage.path, '/angebote/mueller')
  assert.equal(muellerPage.query.retailers, 'mueller')
  assert.match(muellerPage.note, /Online-Angebot/)
  assert.match(muellerPage.note, /Verfügbarkeit bei Müller prüfen/)
})

test('general supermarket landing excludes unavailable or restricted retailer scopes', () => {
  const supermarketPage = getSeoLandingPageByKey('supermarkt')
  const retailerScopes = supermarketPage.queries.map((query) => query.retailers)

  assert.deepEqual(retailerScopes, ['billa,billa-plus', 'lidl', 'penny'])
  assert.equal(retailerScopes.some((scope) => /spar|interspar|eurospar|hofer/.test(scope)), false)
})
