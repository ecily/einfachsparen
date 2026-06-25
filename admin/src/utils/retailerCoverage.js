const LIMITED_COVERAGE_RETAILER_KEYS = new Set(['spar', 'interspar'])

export function isLimitedCoverageRetailer(retailerKey) {
  return LIMITED_COVERAGE_RETAILER_KEYS.has(String(retailerKey || '').trim().toLowerCase())
}

export function hasLimitedCoverageRetailers(retailerKeys = []) {
  return (retailerKeys || []).some((retailerKey) => isLimitedCoverageRetailer(retailerKey))
}
