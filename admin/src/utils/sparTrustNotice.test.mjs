import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  SPAR_TRUST_CONCLUSION,
  SPAR_TRUST_INTRO,
  SPAR_TRUST_TITLE,
  shouldShowSparTrustNotice,
} from './sparTrustNotice.js'

const publicCopy = [SPAR_TRUST_TITLE, SPAR_TRUST_INTRO, SPAR_TRUST_CONCLUSION].join(' ')

test('SPAR trust copy is critical, factual and legally defensive', () => {
  assert.equal(SPAR_TRUST_TITLE, 'Warum SPAR derzeit fehlt')
  assert.match(publicCopy, /offiziellen, legal erreichbaren Quellen/)
  assert.match(publicCopy, /SPAR/)
  assert.match(publicCopy, /nicht zuverlässig möglich/)
  assert.match(publicCopy, /lieber weniger Angebote als falsche oder alte Preise/)
  assert.doesNotMatch(publicCopy, /verweigert|blockiert|absichtlich|illegal|boykottiert|403|TLS|Transport|blocked/i)
})

test('SPAR trust notice is shown only while SPAR is absent from public retailers', () => {
  assert.equal(shouldShowSparTrustNotice([]), true)
  assert.equal(shouldShowSparTrustNotice([{ retailerKey: 'interspar' }]), true)
  assert.equal(shouldShowSparTrustNotice([{ retailerKey: 'billa' }, { retailerKey: 'mueller' }]), true)
  assert.equal(shouldShowSparTrustNotice([{ retailerKey: 'spar' }]), false)
  assert.equal(shouldShowSparTrustNotice([{ retailerName: 'SPAR' }]), false)
})

test('all public product-search placeholders use the new copy', () => {
  const appSource = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const keywordSearchSource = fs.readFileSync(new URL('../components/search/KeywordSearchPage.jsx', import.meta.url), 'utf8')
  const combinedSource = `${appSource}\n${keywordSearchSource}`

  assert.equal((combinedSource.match(/Was m&ouml;chtest du heute billiger kaufen/g) || []).length, 2)
  assert.doesNotMatch(combinedSource, /Produkt oder Marke finden\./)
})

test('search and browse entries render the shared SPAR trust notice', () => {
  const searchPageSource = fs.readFileSync(new URL('../components/search/SearchPage.jsx', import.meta.url), 'utf8')
  const keywordSearchSource = fs.readFileSync(new URL('../components/search/KeywordSearchPage.jsx', import.meta.url), 'utf8')

  assert.match(searchPageSource, /<SparTrustNotice retailers=\{retailers\} \/>/)
  assert.match(keywordSearchSource, /<SparTrustNotice retailers=\{availableRetailers\} \/>/)
})
