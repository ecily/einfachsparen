export const SPAR_TRUST_TITLE = 'Warum SPAR derzeit fehlt'

export const SPAR_TRUST_INTRO = 'kaufklug zeigt nur verifiziert aktuelle Angebote aus offiziellen, legal erreichbaren Quellen. SPAR bewirbt Angebote öffentlich in Flugblättern. Der automatisierte Zugriff auf die offiziellen digitalen SPAR-Flugblattquellen ist für kaufklug derzeit aber nicht zuverlässig möglich.'

export const SPAR_TRUST_CONCLUSION = 'Deshalb zeigen wir SPAR-Angebote nur, wenn sie verifiziert aktuell sind – lieber weniger Angebote als falsche oder alte Preise.'

function normalizeRetailerKey(value) {
  return String(value || '').trim().toLowerCase()
}

export function shouldShowSparTrustNotice(retailers = []) {
  return !(retailers || []).some((retailer) => {
    const retailerKey = normalizeRetailerKey(retailer?.retailerKey || retailer?.key || retailer?.retailerName || retailer?.label)
    return retailerKey === 'spar'
  })
}
