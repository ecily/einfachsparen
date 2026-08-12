import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSeoComparisonSummary } from './seoComparisonSummary.js'

function offer(id, overrides = {}) {
  return {
    id,
    retailerKey: 'billa',
    hasConditions: false,
    quantityText: '',
    normalizedUnitPrice: { amount: 1, unit: 'l', comparable: true },
    ...overrides,
  }
}

const generatedAt = '2026-08-12T09:44:22.113Z'

test('beer summary exposes only liter-comparable facts and recognized package forms', () => {
  const summary = buildSeoComparisonSummary({
    pageKey: 'bier',
    totalCount: 3,
    generatedAt,
    offers: [
      offer('a', { retailerKey: 'billa', hasConditions: true, quantityText: '0,5 l Dose', normalizedUnitPrice: { amount: 1.2, unit: 'l', comparable: true } }),
      offer('b', { retailerKey: 'penny', quantityText: '6 x 0,5 l', normalizedUnitPrice: { amount: 1.8, unit: 'l', comparable: true } }),
      offer('c', { retailerKey: 'lidl', quantityText: '0,5 l Flasche', normalizedUnitPrice: { amount: 1.5, unit: 'l', comparable: true } }),
    ],
  })

  assert.ok(summary)
  assert.ok(summary.facts.some((fact) => fact.includes('3 aktuelle Angebote')))
  assert.ok(summary.facts.some((fact) => fact.includes('3 Händler')))
  assert.ok(summary.facts.some((fact) => fact.includes('Literpreis-Abdeckung ist ausgewiesen')))
  assert.ok(summary.facts.some((fact) => fact.includes('Dosen, Flaschen, Multipacks')))
})

test('coffee keeps incompatible unit ranges separate', () => {
  const summary = buildSeoComparisonSummary({
    pageKey: 'kaffee',
    totalCount: 3,
    generatedAt,
    offers: [
      offer('a', { normalizedUnitPrice: { amount: 12, unit: 'kg', comparable: true } }),
      offer('b', { normalizedUnitPrice: { amount: 18, unit: 'kg', comparable: true } }),
      offer('c', { normalizedUnitPrice: { amount: 0.4, unit: 'Stk', comparable: true } }),
    ],
  })

  assert.ok(summary)
  assert.ok(summary.facts.some((fact) => fact.includes('Einheiten: 2 mit €/kg, 1 mit €/Stück')))
  assert.ok(!summary.facts.some((fact) => fact.includes('Preisbereiche:')))
  assert.ok(!summary.facts.some((fact) => fact.includes('0,4–18')))
})

test('washmittel does not invent a price per washing load', () => {
  const summary = buildSeoComparisonSummary({
    pageKey: 'waschmittel',
    totalCount: 2,
    generatedAt,
    offers: [
      offer('a', { normalizedUnitPrice: { amount: null, unit: '', comparable: false } }),
      offer('b', { retailerKey: 'dm', normalizedUnitPrice: { amount: null, unit: '', comparable: false } }),
    ],
  })

  assert.ok(summary)
  assert.ok(summary.facts.some((fact) => fact.includes('2 aktuelle Angebote')))
  assert.ok(!summary.facts.some((fact) => fact.includes('vergleichbarer Einheit')))
  assert.match(summary.note, /nicht aus Dosierungsannahmen berechnet/)
  assert.doesNotMatch(summary.note, /Waschladung:|€/)
})

test('comparison summary fails closed for incomplete or undated data', () => {
  const base = [offer('a')]
  assert.equal(buildSeoComparisonSummary({ pageKey: 'bier', offers: base, totalCount: 2, generatedAt }), null)
  assert.equal(buildSeoComparisonSummary({ pageKey: 'bier', offers: base, totalCount: 1, generatedAt: '' }), null)
  const noUnitSummary = buildSeoComparisonSummary({
    pageKey: 'bier',
    offers: [offer('a', { normalizedUnitPrice: { amount: null, unit: '', comparable: false } })],
    totalCount: 1,
    generatedAt,
  })
  assert.ok(noUnitSummary)
  assert.ok(!noUnitSummary.facts.some((fact) => fact.includes('Literpreis-Abdeckung')))
})
