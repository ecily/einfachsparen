import test from 'node:test'
import assert from 'node:assert/strict'
import { collectKeywordSearchResults, sortKeywordSearchItems } from './keywordSearchSort.js'
import { flattenRankingOffers, getSavingsValue } from './offers.js'

const offer = (id, savings = null, allowed = true) => ({ id, referencePrice: { allowsSavings: allowed }, savings: { amount: savings } })
const item = (id, index, retailerLabel, savings, price = null, unit = 'l') => ({
  offer: offer(id, savings), index, retailerLabel,
  comparableUnitPrice: price === null ? null : { amount: price, unit: { key: unit, label: unit } },
})
const rank = (unit) => ['kg', 'l', 'stk'].indexOf(unit)

test('failed completion resumes cached pages at the failed offset', async () => {
  const rows = Array.from({ length: 125 }, (_, i) => offer(String(i)))
  const page = offset => ({ rankedOffers: rows.slice(offset, offset + 60), summary: {
    totalCount: 125, resultSetToken: 'snapshot', hasMore: offset + 60 < 125, nextOffset: offset + 60,
  } })
  let cached = page(0)
  await assert.rejects(collectKeywordSearchResults(async offset => {
    if (offset === 120) throw new Error('Page unavailable')
    return page(offset)
  }, () => true, cached, partial => { cached = partial }))
  assert.equal(flattenRankingOffers(cached).length, 120)
  const calls = []
  const complete = await collectKeywordSearchResults(async offset => { calls.push(offset); return page(offset) }, () => true, cached)
  assert.deepEqual(calls, [120])
  assert.equal(flattenRankingOffers(complete).length, 125)
})

test('whole tokenized result set is collected before market sorting/display pagination', async () => {
  const rows = Array.from({ length: 125 }, (_, i) => offer(String(i)))
  const calls = []
  const result = await collectKeywordSearchResults(async (offset, token) => {
    calls.push([offset, token])
    return { rankedOffers: rows.slice(offset, offset + 60), summary: {
      totalCount: 125, resultSetToken: 'snapshot', hasMore: offset + 60 < 125, nextOffset: offset + 60,
    } }
  })
  assert.deepEqual(calls, [[0, ''], [60, 'snapshot'], [120, 'snapshot']])
  const items = flattenRankingOffers(result).map((row, index) => ({ offer: row, index, retailerLabel: index === 124 ? 'ADEG' : 'PENNY' }))
  const sorted = sortKeywordSearchItems(items, 'retailer', rank)
  assert.equal(sorted[0].offer.id, '124') // Winner from the third API page, already on the first display page.
  assert.deepEqual(sorted.slice(0, 60).map(e => e.offer.id), ['124', ...rows.slice(0, 59).map(e => e.id)])
  assert.deepEqual(sorted.slice(60, 120).map(e => e.offer.id), rows.slice(59, 119).map(e => e.id))
  assert.equal(new Set(sorted.map(e => e.offer.id)).size, 125)
  assert.deepEqual(sortKeywordSearchItems(items, 'best', rank).map(e => e.offer.id), rows.map(e => e.id))
})

test('savings order uses reliable own-offer euros, not the cheapest unit price', () => {
  const rows = [item('cheap', 0, 'BILLA', 1, 1), item('saves-more', 1, 'dm', 9, 15), item('tie', 2, 'PENNY', 9, 2)]
  assert.deepEqual(sortKeywordSearchItems(rows, 'savings', rank).map(e => e.offer.id), ['saves-more', 'tie', 'cheap'])
  assert.deepEqual(sortKeywordSearchItems(rows, 'retailer', rank).map(e => e.offer.id), ['cheap', 'saves-more', 'tie'])
})

test('units and unknown comparison prices stay separate; missing savings are never zero', () => {
  const rows = [item('unknown-price', 0, 'BILLA', 20), item('litre', 1, 'dm', 8, 2, 'l'), item('kilo', 2, 'PENNY', 3, 5, 'kg')]
  assert.deepEqual(sortKeywordSearchItems(rows, 'savings', rank).map(e => e.offer.id), ['kilo', 'litre', 'unknown-price'])
  for (const value of [null, undefined, '', NaN]) assert.equal(getSavingsValue(offer('missing', value)), -1)
  assert.equal(getSavingsValue(offer('untrusted', 25, false)), -1)
})

test('incomplete, changing or stuck result sets fail instead of showing a misleading sort', async () => {
  await assert.rejects(collectKeywordSearchResults(async () => ({ rankedOffers: [offer('one')], summary: { totalCount: 2, hasMore: false } })), /Incomplete/)
  await assert.rejects(collectKeywordSearchResults(async () => ({ rankedOffers: [offer('one')], summary: { totalCount: 2, hasMore: true, resultSetToken: 'a', nextOffset: 0 } })), /did not advance/)
  await assert.rejects(collectKeywordSearchResults(async (offset) => ({ rankedOffers: [offer(String(offset))], summary: { totalCount: 2, hasMore: !offset, resultSetToken: offset ? 'changed' : 'a', nextOffset: 1 } })), /Incomplete/)
})

test('superseded searches stop between pages', async () => {
  let current = true
  let calls = 0
  await assert.rejects(collectKeywordSearchResults(async () => {
    calls += 1; current = false
    return { rankedOffers: [offer('one')], summary: { totalCount: 2, hasMore: true, nextOffset: 1, resultSetToken: 'a' } }
  }, () => current), /superseded/)
  assert.equal(calls, 1)
})
