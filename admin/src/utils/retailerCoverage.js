const LIMITED_COVERAGE_RETAILER_KEYS = new Set(['spar', 'interspar'])

function normalizeRetailerKey(value) {
  return String(value || '').trim().toLowerCase()
}

export function isLimitedCoverageRetailer(retailerKey) {
  return LIMITED_COVERAGE_RETAILER_KEYS.has(normalizeRetailerKey(retailerKey))
}

export function hasLimitedCoverageRetailers(retailerKeys = []) {
  return (retailerKeys || []).some((retailerKey) => isLimitedCoverageRetailer(retailerKey))
}

export function hasFreshnessWarning(retailer) {
  return Boolean(retailer?.freshnessWarning?.active)
}

export function hasFreshnessWarningRetailers(retailerKeys = [], retailers = []) {
  const selected = new Set((retailerKeys || []).map(normalizeRetailerKey).filter(Boolean))

  return (retailers || []).some((retailer) => {
    const key = normalizeRetailerKey(retailer?.retailerKey || retailer?.key || retailer?.retailerName || retailer?.label)
    return key && selected.has(key) && hasFreshnessWarning(retailer)
  })
}

export function getFreshnessWarningNotices(retailerKeys = [], retailers = []) {
  const selected = new Set((retailerKeys || []).map(normalizeRetailerKey).filter(Boolean))
  const seen = new Set()

  return (retailers || [])
    .filter((retailer) => {
      const key = normalizeRetailerKey(retailer?.retailerKey || retailer?.key || retailer?.retailerName || retailer?.label)
      if (!key || !selected.has(key) || seen.has(key) || !hasFreshnessWarning(retailer)) return false
      seen.add(key)
      return true
    })
    .map((retailer) => ({
      retailerKey: normalizeRetailerKey(retailer?.retailerKey || retailer?.key),
      retailerName: retailer?.retailerName || retailer?.label || 'Markt',
      message: retailer?.freshnessWarning?.message || '',
      lastConfirmedDate: retailer?.freshnessWarning?.lastConfirmedDate || '',
    }))
}
