import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCategoryHeatmap } from './categoryHeatmap.js'
import { readBrowseState } from './navigationState.js'

test('category links preserve the complete all-market browse contract without result limits', () => {
  const categories = [{ mainCategoryKey: 'getraenke', offerCount: 900, discountPercent: 99 }]
  const tiles = buildCategoryHeatmap(categories, ['billa', 'lidl', 'billa'])
  const tile = tiles.find(item => item.key === 'getraenke')
  const url = new URL(tile.href, 'https://www.kaufklug.at')
  assert.equal(url.pathname, '/stoebern')
  const state = readBrowseState(url.search)
  assert.deepEqual(state.appliedRetailers, ['billa', 'lidl'])
  assert.deepEqual(state.appliedCategories, ['main:getraenke'])
  assert.deepEqual(state.draftCategories, state.appliedCategories)
  assert.equal(url.searchParams.has('limit'), false)
  assert.ok(tiles.every(item => item.evidence === 'unknown'))
  assert.equal('offerCount' in tile, false)
  assert.equal('discountPercent' in tile, false)
})

test('unknown, inactive or unavailable categories/markets never invent a working selection or quality', () => {
  for (const tiles of [buildCategoryHeatmap(), buildCategoryHeatmap([{ mainCategoryKey: 'getraenke', isActive: false }], ['dm']), buildCategoryHeatmap([{ mainCategoryKey: 'getraenke' }], [])]) {
    assert.equal(tiles.length, 5)
    assert.ok(tiles.every(item => item.href === null && item.evidence === 'unknown'))
  }
})
