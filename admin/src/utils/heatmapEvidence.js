import { quoteIssue, QUOTE_TTL } from './shoppingAssistant.js'
const categories = { lebensmittel: 'lebensmittel', 'getränke': 'getraenke', getraenke: 'getraenke',
  'drogerie / hygiene': 'drogerie-hygiene', haushalt: 'haushalt', 'baby & kinder': 'baby-kinder' }
// A small verified sample is never a category-wide quality score or total offer count.
export function sampleSignals(deals = [], checkedAt, now = Date.now()) {
  const counts = {}, seen = new Set()
  if (!Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt >= QUOTE_TTL) return counts
  for (const deal of deals.slice(0, 20)) {
    const key = categories[String(deal.categoryPrimary || '').toLowerCase()]
    const id = String(deal.id || deal._id || '')
    const ref = deal.referencePrice
    if (!key || !id || seen.has(id) || quoteIssue({ ...deal, id }, { offer: { ...deal, id }, checkedAt }, now)
      || ref?.allowsSavings !== true || ref.isApproximate || deal.savings?.isApproximate || ref.type === 'external_comparison'
      || typeof ref.amount !== 'number' || !Number.isFinite(ref.amount) || ref.amount <= deal.priceCurrent.amount) continue
    seen.add(id); counts[key] = (counts[key] || 0) + 1
  }
  return counts
}
