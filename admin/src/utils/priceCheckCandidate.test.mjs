import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveBeerPriceCheckCandidate, isPublishablePriceCheckCandidate } from './priceCheckCandidate.js'

const now = new Date('2026-08-12T10:00:00.000Z')

function offer(overrides = {}) {
  return {
    id: overrides.id || 'offer-a',
    categoryKey: 'bier',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    title: '0,5-l-Dose Bier',
    quantityText: '0,5 l',
    priceCurrent: { amount: 0.72 },
    normalizedUnitPrice: { amount: 1.44, unit: 'l', comparable: true },
    totalComparableAmount: 0.5,
    comparableUnit: 'l',
    conditionsText: 'bei 12 Dosen',
    quality: { comparisonSafe: true },
    status: 'active',
    isActiveNow: true,
    validFrom: '2026-08-05T00:00:00.000Z',
    validTo: '2026-08-12T21:59:59.999Z',
    sourceType: 'billa-official-html',
    sourceRunStatus: 'success',
    publishStatus: 'crawl-run-success',
    ...overrides,
  }
}

test('only offers bound to the eligible retailer evidence become confirmed candidates', () => {
  const candidate = deriveBeerPriceCheckCandidate([
    offer({ id: 'a' }),
    offer({ id: 'b', retailerKey: 'penny', retailerName: 'PENNY', priceCurrent: { amount: 0.79 }, normalizedUnitPrice: { amount: 1.58, unit: 'l', comparable: true }, sourceType: 'penny-official-html' }),
  ], { now })
  assert.equal(candidate.involvedOffers.length, 2)
  assert.equal(isPublishablePriceCheckCandidate(candidate), true)
})

test('fail-closed filters reject missing, stale, future, unknown, partial, zero and incomplete evidence', () => {
  const reject = (changes) => assert.equal(deriveBeerPriceCheckCandidate([offer(changes), offer({ id: 'b', retailerKey: 'penny', retailerName: 'PENNY', normalizedUnitPrice: { amount: 1.58, unit: 'l', comparable: true }, sourceType: 'penny-official-html' })], { now }), null)
  reject({ quantityText: null })
  reject({ validFrom: '2026-08-13T00:00:00.000Z' })
  reject({ validTo: '2026-08-11T00:00:00.000Z' })
  reject({ conditionsText: 'unbekannt' })
  reject({ sourceRunStatus: 'partial' })
  reject({ publishStatus: 'zero-raw' })
  reject({ publishStatus: 'zero-stored' })
  reject({ sourceType: 'aggregator' })
})

test('compatible units, two retailers and bounded spread are required', () => {
  assert.equal(deriveBeerPriceCheckCandidate([offer()], { now }), null)
  assert.equal(deriveBeerPriceCheckCandidate([offer(), offer({ id: 'b', retailerKey: 'penny', retailerName: 'PENNY', normalizedUnitPrice: { amount: 2.00, unit: 'l', comparable: true }, sourceType: 'penny-official-html' })], { now }), null)
  assert.equal(deriveBeerPriceCheckCandidate([offer(), offer({ id: 'b', retailerKey: 'penny', retailerName: 'PENNY', normalizedUnitPrice: { amount: 1.58, unit: 'kg', comparable: true }, sourceType: 'penny-official-html' })], { now }), null)
})
