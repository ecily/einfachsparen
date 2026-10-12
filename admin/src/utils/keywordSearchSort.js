import { flattenRankingOffers, getSavingsValue, mergePaginatedRankingResults } from './offers.js'

// Keep the public pagination/result token contract; never sort an incomplete prefix.
export async function collectKeywordSearchResults(fetchPage, isCurrent = () => true, initial = null, onPage = () => {}) {
  let result = initial
  let offset = initial?.summary?.nextOffset || 0
  let token = initial?.summary?.resultSetToken || ''
  let total = initial?.summary?.totalCount ?? null
  if (initial && initial.summary.hasMore !== true) return initial
  do {
    if (!isCurrent()) throw new Error('Search superseded')
    const page = await fetchPage(offset, token)
    if (!isCurrent()) throw new Error('Search superseded')
    const summary = page?.summary
    if (!Number.isInteger(summary?.totalCount) || summary.totalCount < 0
      || (total !== null && summary.totalCount !== total)
      || (token && summary.resultSetToken !== token)) throw new Error('Incomplete search result set')
    total = summary.totalCount
    result = result ? mergePaginatedRankingResults(result, page) : page
    if (summary.hasMore !== true && flattenRankingOffers(result).length !== total) throw new Error('Incomplete search result set')
    onPage(result)
    if (summary.hasMore !== true) break
    if (!summary.resultSetToken || !Number.isInteger(summary.nextOffset) || summary.nextOffset <= offset) {
      throw new Error('Search pagination did not advance')
    }
    token = summary.resultSetToken
    offset = summary.nextOffset
  } while (result?.summary?.hasMore === true)
  if (flattenRankingOffers(result).length !== total) throw new Error('Incomplete search result set')
  return result
}

export function sortKeywordSearchItems(items, mode, unitRank) {
  return [...items].sort((left, right) => {
    if (mode === 'retailer') {
      const market = left.retailerLabel.localeCompare(right.retailerLabel, 'de-AT')
      if (market) return market
    }
    if (mode === 'savings') {
      const leftPrice = left.comparableUnitPrice
      const rightPrice = right.comparableUnitPrice
      if (leftPrice && !rightPrice) return -1
      if (!leftPrice && rightPrice) return 1
      if (leftPrice && rightPrice) {
        const rank = unitRank(leftPrice.unit.key) - unitRank(rightPrice.unit.key)
        if (rank) return rank
        const unit = leftPrice.unit.label.localeCompare(rightPrice.unit.label, 'de-AT')
        if (unit) return unit
      }
      // Own-offer savings, never a price comparison between different units.
      const savings = getSavingsValue(right.offer) - getSavingsValue(left.offer)
      if (savings) return savings
    }
    return left.index - right.index
  })
}
