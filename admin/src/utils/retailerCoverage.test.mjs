import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getPublicTrustWarningNotices,
  hasLimitedCoverageRetailers,
  isLimitedCoverageRetailer,
} from './retailerCoverage.js'

const interspar = {
  retailerKey: 'interspar',
  retailerName: 'INTERSPAR',
  limitedCoverage: true,
  publicTrustWarning: {
    active: true,
    message: 'INTERSPAR derzeit eingeschränkt: Aktuelle Spezialangebote können sichtbar sein; das aktuelle Hauptflugblatt ist derzeit nicht zuverlässig automatisiert verfügbar.',
  },
}

test('limited coverage is metadata-driven and not inferred from retailer name', () => {
  assert.equal(isLimitedCoverageRetailer(interspar), true)
  assert.equal(isLimitedCoverageRetailer({ retailerKey: 'spar' }), false)
  assert.equal(isLimitedCoverageRetailer({ retailerKey: 'interspar' }), false)
  assert.equal(hasLimitedCoverageRetailers(['interspar'], [interspar]), true)
  assert.equal(hasLimitedCoverageRetailers(['billa'], [interspar]), false)
})

test('public trust notices are scoped to selected retailers and retain defensive copy', () => {
  const notices = getPublicTrustWarningNotices(['interspar'], [interspar, interspar])

  assert.equal(notices.length, 1)
  assert.equal(notices[0].retailerKey, 'interspar')
  assert.equal(notices[0].message, interspar.publicTrustWarning.message)
  assert.doesNotMatch(notices[0].message, /403|TLS|blocked|verweigert|absichtlich|illegal/i)
  assert.deepEqual(getPublicTrustWarningNotices(['spar'], [interspar]), [])
})
