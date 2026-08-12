const ALLOWED_RETAILERS = new Set(['billa', 'penny', 'lidl', 'bipa', 'dm', 'mueller'])

function finitePositive(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function parseHalfLiterQuantity(value) {
  const text = String(value || '').toLowerCase().replace(',', '.')
  return /(?:^|\s)0\.5\s*(?:l|liter)(?:\s|$)/i.test(text)
}

function hasPublicValidity(offer, now = new Date()) {
  if (offer?.status !== 'active' || offer?.isActiveNow !== true) return false
  const validFrom = offer.validFrom ? new Date(offer.validFrom) : null
  const validTo = offer.validTo ? new Date(offer.validTo) : null
  if (!validFrom || Number.isNaN(validFrom.getTime()) || validFrom > now) return false
  if (validTo && (Number.isNaN(validTo.getTime()) || validTo < now)) return false
  return true
}

function hasOfficialEvidence(offer) {
  const sourceTypes = Array.isArray(offer?.sourceTypes) ? offer.sourceTypes : []
  return Boolean(
    String(offer?.sourceType || '').toLowerCase().includes('official')
    || sourceTypes.some((source) => String(source).toLowerCase().includes('official')),
  ) && offer?.sourceRunStatus === 'success' && offer?.publishStatus === 'crawl-run-success'
}

function hasExplicitCondition(offer) {
  const condition = String(offer?.conditionsText || '').trim()
  return Boolean(condition) && !/pruefen|unbekannt|unknown|unklar/i.test(condition)
}

function buildEvidence(offer) {
  return {
    sourceType: offer.sourceType,
    sourceUrl: offer.sourceUrl || null,
    crawlRunId: offer.crawlRunId || null,
    crawlJobId: offer.crawlJobId || null,
    sourceRunStatus: offer.sourceRunStatus,
    publishStatus: offer.publishStatus,
  }
}

function toCandidateOffer(offer) {
  return {
    id: offer.id,
    retailerKey: offer.retailerKey,
    retailerName: offer.retailerName || offer.retailerKey,
    title: offer.title,
    brand: offer.brand || '',
    quantityText: offer.quantityText,
    price: offer.priceCurrent?.amount,
    unitPrice: offer.normalizedUnitPrice.amount,
    unitType: offer.normalizedUnitPrice.unit,
    conditions: offer.conditionsText,
    validFrom: offer.validFrom,
    validTo: offer.validTo,
    evidence: buildEvidence(offer),
  }
}

export function deriveBeerPriceCheckCandidate(offers = [], { now = new Date() } = {}) {
  const eligible = offers
    .filter((offer) => ALLOWED_RETAILERS.has(String(offer?.retailerKey || '').toLowerCase()))
    .filter((offer) => offer?.categoryKey === 'bier' || offer?.subcategoryKey === 'bier')
    .filter((offer) => parseHalfLiterQuantity(offer.quantityText))
    .filter((offer) => offer?.normalizedUnitPrice?.comparable === true)
    .filter((offer) => String(offer.normalizedUnitPrice.unit).toLowerCase() === 'l')
    .filter((offer) => finitePositive(offer.normalizedUnitPrice.amount) !== null)
    .filter((offer) => finitePositive(offer.priceCurrent?.amount) !== null)
    .filter((offer) => offer.quality?.comparisonSafe === true)
    .filter((offer) => hasPublicValidity(offer, now))
    .filter((offer) => hasOfficialEvidence(offer))
    .filter((offer) => hasExplicitCondition(offer))
    .filter((offer) => Number(offer.totalComparableAmount) === 0.5 && String(offer.comparableUnit || '').toLowerCase() === 'l')
    .sort((left, right) => Number(left.normalizedUnitPrice.amount) - Number(right.normalizedUnitPrice.amount) || String(left.id).localeCompare(String(right.id)))

  const byRetailer = new Map()
  for (const offer of eligible) {
    const retailer = String(offer.retailerKey).toLowerCase()
    if (!byRetailer.has(retailer)) byRetailer.set(retailer, offer)
  }

  const selected = [...byRetailer.values()]
  if (selected.length < 2) return null

  const spread = Math.max(...selected.map((offer) => offer.normalizedUnitPrice.amount)) - Math.min(...selected.map((offer) => offer.normalizedUnitPrice.amount))
  const minimum = Math.min(...selected.map((offer) => offer.normalizedUnitPrice.amount))
  if (minimum <= 0 || spread / minimum > 0.35) return null

  const retailers = [...new Set(selected.map((offer) => offer.retailerKey))]
  return {
    topic: 'bier',
    slug: 'bier-literpreis-vergleich',
    title: 'Bier Literpreis vergleichen: 0,5-l-Dosen bei BILLA und PENNY',
    description: 'Aktuelle 0,5-l-Dosenbier-Angebote bei BILLA und PENNY nach Literpreis vergleichen. Bedingungen und Public-Gültigkeit transparent auf kaufklug.at.',
    h1: 'Bier Literpreis vergleichen: 0,5-l-Dosen bei BILLA und PENNY',
    comparisonBasis: '0,5-l-Dosenbier innerhalb der Public-Biergruppe; Literpreis, Menge und sichtbare Bedingungen werden getrennt ausgewiesen.',
    involvedOffers: selected.map(toCandidateOffer),
    involvedRetailers: retailers,
    unitType: 'l',
    normalizedValues: selected.map((offer) => offer.normalizedUnitPrice.amount),
    conditions: selected.map((offer) => offer.conditionsText),
    confidence: 'high',
    evidence: selected.map(buildEvidence),
    publishable: true,
    explanation: 'Der Vergleich nutzt nur aktive, offiziell belegte Public Offers mit 0,5-l-Menge, kompatiblem Literpreis und expliziter Bedingung. Die Aussage bleibt auf diese konkrete Produktgruppe und die genannten Händler begrenzt.',
    dataStand: now.toISOString(),
  }
}

export function isPublishablePriceCheckCandidate(candidate) {
  return Boolean(candidate?.publishable === true && candidate?.confidence === 'high' && candidate?.involvedOffers?.length >= 2 && candidate?.involvedRetailers?.length >= 2 && candidate?.evidence?.every((item) => item?.sourceRunStatus === 'success' && item?.publishStatus === 'crawl-run-success'))
}
