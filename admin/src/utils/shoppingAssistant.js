// Prices are deliberately session-only. A persisted list is a wish list, not a current quote.
export const QUOTE_TTL = 15 * 60 * 1000
export const REFRESH_LIMIT = 8
const hosts = { billa: 'billa.at', 'billa-plus': 'billa.at', lidl: 'lidl.at', penny: 'penny.at',
  hofer: 'hofer.at', dm: 'dm.at', bipa: 'bipa.at', spar: 'spar.at', eurospar: 'spar.at', interspar: 'interspar.at' }
export const itemId = item => String(item?.offerId || item?.id || '')
export function createWish(title, id) {
  const text = String(title || '').trim().slice(0, 160)
  return text ? { id: `wish:${id}`, title: text, manual: true, retailerName: 'Noch ohne Angebot',
    priceCurrent: null, addedAt: new Date().toISOString() } : null
}
export function sameOffer(item, offer) {
  return !item.manual && Boolean(itemId(item)) && itemId(item) === itemId(offer) && item.retailerKey === offer.retailerKey
    && String(item.title).trim().toLocaleLowerCase('de-AT') === String(offer.title).trim().toLocaleLowerCase('de-AT')
}
export function quoteIssue(item, quote, now = Date.now()) {
  if (item.manual) return 'Noch keinem Angebot zugeordnet'
  if (!quote || !sameOffer(item, quote.offer)) return 'Aktuelles Angebot nicht bestätigt'
  if (!Number.isFinite(quote.checkedAt) || quote.checkedAt > now || now - quote.checkedAt >= QUOTE_TTL) return 'Angebot erneut prüfen'
  const o = quote.offer
  const from = Date.parse(o.validFrom), until = Date.parse(o.validTo)
  if (!Number.isFinite(from) || !Number.isFinite(until) || from > now || until <= now) return 'Aktionszeitraum nicht aktuell belegt'
  if (o.isActiveNow !== true || o.needsReview !== false || o.sourceRunStatus !== 'success'
    || o.publishStatus !== 'crawl-run-success' || o.quality?.comparisonSafe !== true) return 'Datenqualität nicht ausreichend bestätigt'
  try {
    const u = new URL(o.sourceUrl), host = hosts[o.retailerKey]
    if (!host || u.protocol !== 'https:' || u.username || u.password || !(u.hostname === host || u.hostname.endsWith(`.${host}`))) return 'Händlerquelle nicht bestätigt'
  } catch { return 'Händlerquelle nicht bestätigt' }
  if (o.customerProgramRequired !== false || o.isMultiBuy || Number(o.minimumPurchaseQty || o.minimumPurchaseQuantity || 1) !== 1
    || o.hasConditions || String(o.conditionsText || '').trim()) return 'Karten- oder Mengenbedingungen separat prüfen'
  if (typeof o.priceCurrent?.amount !== 'number' || !Number.isFinite(o.priceCurrent.amount) || o.priceCurrent.amount <= 0 || o.priceCurrent.amount >= 10000
    || o.priceCurrent.currency !== 'EUR' || Math.abs(o.priceCurrent.amount * 100 - Math.round(o.priceCurrent.amount * 100)) > 1e-7) return 'Packungspreis nicht sicher belegt'
  return ''
}
export function buildPartialPlan(items, quotes = {}, quantities = {}, checked = new Set(), now = Date.now()) {
  const rows = items.filter(i => !checked.has(String(i.id))).map(item => {
    const issue = quoteIssue(item, quotes[item.id], now)
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(quantities[item.id] ?? item.requestedQuantity) || 1)))
    return { item, issue, quantity, offer: issue ? null : quotes[item.id].offer,
      cents: issue ? null : Math.round(quotes[item.id].offer.priceCurrent.amount * 100) * quantity }
  })
  const confirmed = rows.filter(r => !r.issue)
  const markets = [...new Set(confirmed.map(r => r.offer.retailerKey))]
  return { rows, confirmed, open: rows.filter(r => r.issue), markets,
    partialCents: confirmed.reduce((sum, r) => sum + r.cents, 0), optimized: false }
}
export function nextQuoteExpiry(quotes, now = Date.now()) {
  const future = Object.values(quotes).flatMap(q => [q.checkedAt + QUOTE_TTL, Date.parse(q.offer?.validTo)]).filter(t => t > now && Number.isFinite(t))
  return future.length ? Math.min(...future) : null
}
