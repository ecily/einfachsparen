import test from 'node:test'
import assert from 'node:assert/strict'
import { assignWishOffer, buildPartialPlan, createWish, quoteIssue, sameOffer, nextQuoteExpiry, QUOTE_TTL } from './shoppingAssistant.js'
import { buildShareSnapshot, buildShoppingListItemFromSnapshot } from './shoppingList.js'
import { sampleSignals } from './heatmapEvidence.js'

const now = Date.parse('2026-11-02T12:00:00Z')
const offer = { id: 'one', title: 'Milch 1 l', retailerKey: 'penny', categoryPrimary: 'Lebensmittel',
  priceCurrent: { amount: 1.09, currency: 'EUR' }, validFrom: '2026-11-01T00:00:00Z', validTo: '2026-11-03T00:00:00Z',
  isActiveNow: true, needsReview: false, sourceRunStatus: 'success', publishStatus: 'crawl-run-success',
  quality: { comparisonSafe: true }, sourceUrl: 'https://www.penny.at/produkte/milch', customerProgramRequired: false,
  conditionsText: '', referencePrice: { amount: 1.29, allowsSavings: true, isApproximate: false } }
const quote = o => ({ offer: o, checkedAt: now })

test('persisted prices alone never produce a current cart or savings', () => {
  const plan = buildPartialPlan([offer], {}, {}, new Set(), now)
  assert.equal(plan.partialCents, 0); assert.equal(plan.confirmed.length, 0); assert.equal(plan.open.length, 1)
  assert.equal(plan.optimized, false); assert.equal('savings' in plan, false)
})
test('explicit current unconditional pack prices produce an exact partial sum only', () => {
  const wish = createWish('Brot', 'id')
  const p = buildPartialPlan([offer, wish], { one: quote(offer) }, { one: 3 }, new Set(), now)
  assert.equal(p.partialCents, 327); assert.equal(p.confirmed.length, 1); assert.equal(p.open.length, 1)
  assert.deepEqual(p.markets, ['penny']); assert.equal(p.optimized, false)
})
for (const [label, changed] of [
  ['expired', { validTo: new Date(now).toISOString() }], ['future', { validFrom: new Date(now + 1).toISOString() }],
  ['unknown deadline', { validTo: '' }], ['unknown start', { validFrom: '' }],
  ['review', { needsReview: true }], ['partial', { sourceRunStatus: 'partial' }], ['stale publish', { publishStatus: 'crawl-run-stale' }],
  ['unknown comparison', { quality: {} }], ['card', { customerProgramRequired: true }],
  ['multibuy', { minimumPurchaseQuantity: 2 }], ['coupon', { conditionsText: 'Coupon erforderlich' }],
  ['unsupported merchant', { retailerKey: 'mueller' }], ['wrong source', { sourceUrl: 'https://penny.at.evil.example/' }],
  ['unsafe price', { priceCurrent: { amount: null, currency: 'EUR' } }], ['foreign currency', { priceCurrent: { amount: 1, currency: 'USD' } }],
]) test(`${label} cannot enter a price sum`, () => {
  const o = { ...offer, ...changed }; assert.ok(quoteIssue(o, quote(o), now))
  assert.equal(buildPartialPlan([o], { one: quote(o) }, {}, new Set(), now).partialCents, 0)
})
test('identity includes offer ID, merchant and exact product title, never a fuzzy search', () => {
  for (const changed of [{ id: 'other' }, { retailerKey: 'billa' }, { title: 'Milch 500 ml' }, { manual: true }]) assert.equal(sameOffer({ ...offer, ...changed }, offer), false)
  assert.equal(sameOffer(offer, offer), true)
})
test('quotes expire at the exact session deadline and completed items are never summed', () => {
  assert.ok(quoteIssue(offer, quote(offer), now + QUOTE_TTL))
  assert.equal(buildPartialPlan([offer], { one: quote(offer) }, {}, new Set(['one']), now).partialCents, 0)
  assert.equal(nextQuoteExpiry({ one: quote(offer) }, now), now + QUOTE_TTL)
})
test('manual wishes reject blank input and preserve a bounded, editable title without price', () => {
  assert.equal(createWish(' ', 'x'), null); const w = createWish(' A '.repeat(200), 'x')
  assert.equal(w.title.length, 160); assert.equal(w.manual, true); assert.equal(w.priceCurrent, null)
})
test('wish quantity survives reload-shaped data, share and adoption without a price promise', () => {
  const wish = createWish('Milch, 1 Liter', 'quantity-test', 3)
  const reloaded = JSON.parse(JSON.stringify(wish))
  const snapshot = buildShareSnapshot([reloaded])
  const adopted = buildShoppingListItemFromSnapshot(snapshot.items[0])
  assert.equal(adopted.requestedQuantity, 3)
  assert.equal(adopted.manual, true)
  assert.equal(adopted.title, wish.title)
  assert.equal(buildPartialPlan([adopted], {}, {}, new Set(), now).confirmed.length, 0)
})
test('explicit selection replaces only its wish, keeps quantity and cannot bypass quote gates', () => {
  const wish = createWish('Milch', 'select', 3)
  const other = createWish('Brot', 'keep')
  const selected = assignWishOffer([wish, other], wish.id, offer, 3)
  assert.equal(selected.length, 2)
  assert.equal(selected[0].id, offer.id)
  assert.equal(selected[0].requestedQuantity, 3)
  assert.equal(selected[1], other)
  assert.equal(buildPartialPlan(selected, {}, {}, new Set(), now).confirmed.length, 0)
  assert.equal(buildPartialPlan(selected, { one: quote(offer) }, {}, new Set(), now).partialCents, 327)
  const conditional = { ...offer, customerProgramRequired: true }
  assert.equal(buildPartialPlan(selected, { one: quote(conditional) }, {}, new Set(), now).partialCents, 0)
  const duplicates = [wish, offer]
  assert.equal(assignWishOffer(duplicates, wish.id, offer, 3), duplicates)
  assert.equal(assignWishOffer(selected, wish.id, offer, 3), selected)
})
test('heatmap counts only unique current verifiable advantages in its explicit sample', () => {
  const result = sampleSignals([offer, offer, { ...offer, id: 'two', customerProgramRequired: true }], now, now)
  assert.deepEqual(result, { lebensmittel: 1 })
  assert.deepEqual(sampleSignals([offer], now, now + QUOTE_TTL), {})
  assert.deepEqual(sampleSignals([{ ...offer, referencePrice: { amount: 2, allowsSavings: true, isApproximate: true } }], now, now), {})
})
