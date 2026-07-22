function normalizeRetailerKey(value) {
  return String(value || '').trim().toLowerCase()
}

function getRetailerKey(retailer) {
  return normalizeRetailerKey(retailer?.retailerKey || retailer?.key || retailer?.retailerName || retailer?.label)
}

export function isLimitedCoverageRetailer(retailer) {
  return Boolean(retailer?.limitedCoverage || retailer?.publicTrustWarning?.active)
}

export function hasLimitedCoverageRetailers(retailerKeys = [], retailers = []) {
  const selected = new Set((retailerKeys || []).map(normalizeRetailerKey).filter(Boolean))

  return (retailers || []).some((retailer) => selected.has(getRetailerKey(retailer)) && isLimitedCoverageRetailer(retailer))
}

export function getPublicTrustWarningNotices(retailerKeys = [], retailers = []) {
  const selected = new Set((retailerKeys || []).map(normalizeRetailerKey).filter(Boolean))
  const seen = new Set()

  return (retailers || [])
    .filter((retailer) => {
      const key = getRetailerKey(retailer)
      if (!key || !selected.has(key) || seen.has(key) || !retailer?.publicTrustWarning?.active) return false
      seen.add(key)
      return true
    })
    .map((retailer) => ({
      retailerKey: getRetailerKey(retailer),
      retailerName: retailer?.retailerName || retailer?.label || 'Markt',
      message: retailer.publicTrustWarning.message || '',
    }))
}

export function hasFreshnessWarning(retailer) {
  return Boolean(retailer?.freshnessWarning?.active)
}

export function hasFreshnessWarningRetailers(retailerKeys = [], retailers = []) {
  const selected = new Set((retailerKeys || []).map(normalizeRetailerKey).filter(Boolean))

  return (retailers || []).some((retailer) => {
    const key = getRetailerKey(retailer)
    return key && selected.has(key) && hasFreshnessWarning(retailer)
  })
}

export function getFreshnessWarningNotices(retailerKeys = [], retailers = []) {
  const selected = new Set((retailerKeys || []).map(normalizeRetailerKey).filter(Boolean))
  const seen = new Set()

  return (retailers || [])
    .filter((retailer) => {
      const key = getRetailerKey(retailer)
      if (!key || !selected.has(key) || seen.has(key) || !hasFreshnessWarning(retailer)) return false
      seen.add(key)
      return true
    })
    .map((retailer) => ({
      retailerKey: getRetailerKey(retailer),
      retailerName: retailer?.retailerName || retailer?.label || 'Markt',
      message: retailer?.freshnessWarning?.message || '',
      lastConfirmedDate: retailer?.freshnessWarning?.lastConfirmedDate || '',
    }))
}
