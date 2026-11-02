// Local-only browser fixture server. No proxy, no database, all writes rejected.
import http from 'node:http'

const retailers = [
  { retailerKey: 'dm', name: 'dm', label: 'dm', offerCount: 135 },
  { retailerKey: 'bipa', name: 'BIPA', label: 'BIPA', offerCount: 135 },
]
const categories = [{ mainCategoryKey: 'drogerie-hygiene', mainCategoryLabel: 'Drogerie', offerCount: 135,
  subcategories: [{ subcategoryKey: 'waschmittel', subcategoryLabel: 'Waschmittel', offerCount: 135 }] }]
const offers = Array.from({ length: 135 }, (_, index) => ({
  id: `ux-fixture-${index}`, productName: `UX Test Waschmittel ${index + 1}`, title: `UX Test Waschmittel ${index + 1}`,
  retailerKey: index % 2 ? 'bipa' : 'dm', retailer: index % 2 ? 'BIPA' : 'dm',
  categoryPrimary: 'Drogerie', categorySecondary: 'Waschmittel', displayCategory: 'Waschmittel',
  retailerName: index % 2 ? 'BIPA' : 'dm',
  priceCurrent: { amount: 3, currency: 'EUR' }, price: { amount: 3, currency: 'EUR' },
  quality: { comparisonSafe: true }, comparisonGroup: 'waschmittel-l', quantityText: '1 l',
  quantity: { value: 1, unit: 'l' }, normalizedUnitPrice: { amount: 3, unit: 'l', comparable: true },
  validTo: null, sourceType: 'official',
}))
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')
  if (req.method !== 'GET') { res.writeHead(405); res.end('{"error":"read-only fixture"}'); return }
  const url = new URL(req.url, 'http://localhost')
  let payload
  if (url.pathname.includes('/filters/retailers')) payload = { retailers }
  else if (url.pathname.includes('/filters/categories')) payload = { categories }
  else if (url.pathname.includes('/top-deals')) payload = { deals: offers.slice(0, 20), availableFilters: { categories: [{ key: 'waschmittel', count: 20 }], retailers: [{ key: 'dm', count: 20 }] } }
  else if (url.pathname.includes('/ranking')) {
    const offset = Number(url.searchParams.get('offset') || 0)
    const limit = Number(url.searchParams.get('limit') || 60)
    const selected = url.searchParams.get('retailers')?.split(',') || []
    const rows = offers.filter(offer => !selected.length || selected.includes(offer.retailerKey))
    payload = { rankedOffers: rows.slice(offset, offset + limit), summary: { totalCount: rows.length, hasMore: offset + limit < rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null, resultSetToken: 'ux-fixture-v1' } }
  } else { res.writeHead(404); payload = { error: 'No fixture for this endpoint' } }
  res.end(JSON.stringify(payload))
}).listen(4219, '127.0.0.1', () => process.stdout.write('Read-only UX fixtures on 127.0.0.1:4219\n'))
