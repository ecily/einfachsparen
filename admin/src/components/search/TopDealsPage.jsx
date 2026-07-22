import { useEffect, useState } from 'react'

import { fetchTopDeals } from '../../utils/apiBase'
import { getOfferStableId } from '../../utils/offers'
import { OfferCardConsumer } from './OfferCardConsumer'

const EMPTY_STATE = 'Heute sind noch nicht genug verifizierte Vergleichswerte verfügbar. Suche direkt nach deinem Produkt.'
const CATEGORY_FILTERS = [
  ['getraenke', 'Getränke'],
  ['drogerie', 'Drogerie'],
  ['haushalt', 'Haushalt'],
  ['kaffee', 'Kaffee'],
  ['bier', 'Bier'],
  ['waschmittel', 'Waschmittel'],
  ['zahnpasta', 'Zahnpasta'],
  ['sonnencreme', 'Sonnencreme'],
  ['toilettenpapier', 'Toilettenpapier'],
]
const RETAILER_FILTERS = [
  ['billa', 'BILLA'],
  ['billa-plus', 'BILLA Plus'],
  ['lidl', 'Lidl'],
  ['penny', 'PENNY'],
  ['dm', 'dm'],
  ['bipa', 'BIPA'],
  ['mueller', 'Müller'],
]

function readActiveFilters() {
  const searchParams = new URLSearchParams(window.location.search)
  const category = searchParams.get('category') || ''
  const retailer = searchParams.get('retailer') || ''

  return {
    category: CATEGORY_FILTERS.some(([key]) => key === category) ? category : '',
    retailer: RETAILER_FILTERS.some(([key]) => key === retailer) ? retailer : '',
  }
}

export function TopDealsPage({ shoppingListIds, onAddToShoppingList, onNavigate }) {
  const { category: activeCategory, retailer: activeRetailer } = readActiveFilters()
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function loadTopDeals() {
      try {
        setLoading(true)
        setError('')
        const result = await fetchTopDeals(20, { category: activeCategory, retailer: activeRetailer })
        if (active) setPayload(result)
      } catch {
        if (active) {
          setPayload(null)
          setError('Die Top Deals konnten gerade nicht geladen werden. Bitte versuche es später erneut.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    loadTopDeals()
    return () => {
      active = false
    }
  }, [activeCategory, activeRetailer])

  const deals = Array.isArray(payload?.deals) ? payload.deals : []
  const activeFilterLabel = CATEGORY_FILTERS.concat(RETAILER_FILTERS)
    .find(([key]) => key === (activeCategory || activeRetailer))?.[1]

  return (
    <section className="top-deals-page" aria-labelledby="top-deals-title">
      <header className="panel top-deals-hero">
        <p className="eyebrow">Heute verifiziert</p>
        <h1 id="top-deals-title">Top Deals heute</h1>
        <p className="subtitle">Die stärksten verifizierten Ersparnisse nach Preis pro Einheit – Bedingungen inklusive.</p>
        <p className="top-deals-hero__trust">Nur mit belastbarem Einheitspreis und direktem Referenzpreis derselben Packung.</p>
        {activeFilterLabel ? (
          <p className="top-deals-hero__filter">
            Gefiltert nach <strong>{activeFilterLabel}</strong> · <a href="/top-deals">Alle Top Deals</a>
          </p>
        ) : null}
      </header>

      {loading ? <div className="panel status">Top Deals werden geprüft …</div> : null}
      {error ? <div className="panel status status--error" role="alert">{error}</div> : null}

      {!loading && !error && deals.length === 0 ? (
        <div className="panel empty-state top-deals-empty">
          <h2>Noch keine sicheren Top Deals</h2>
          <p>{EMPTY_STATE}</p>
          <button type="button" className="primary-action-button" onClick={() => onNavigate('product-search')}>
            Produkt suchen
          </button>
        </div>
      ) : null}

      {deals.length > 0 ? (
        <div className="top-deals-results" aria-label={`${deals.length} verifizierte Top Deals`}>
          {deals.map((deal) => (
            <OfferCardConsumer
              key={deal.id}
              offer={deal}
              topDeal={deal.topDeal}
              isInShoppingList={shoppingListIds.has(getOfferStableId(deal))}
              onAddToShoppingList={onAddToShoppingList}
              feedbackPageContext={{ page: 'top-deals' }}
            />
          ))}
        </div>
      ) : null}

      <section className="panel top-deals-discovery" aria-labelledby="top-deals-discovery-title">
        <div>
          <h2 id="top-deals-discovery-title">Top Deals nach Kategorie und Markt</h2>
          <p>Finde die stärksten verifizierten Ersparnisse gezielt nach Bereich oder Händler.</p>
        </div>
        <nav aria-label="Top Deals nach Kategorie" className="top-deals-discovery__group">
          <strong>Kategorien</strong>
          <div className="top-deals-discovery__links">
            {CATEGORY_FILTERS.map(([key, label]) => (
              <a key={key} href={`/top-deals?category=${key}`} aria-current={activeCategory === key ? 'page' : undefined}>{label}</a>
            ))}
          </div>
        </nav>
        <nav aria-label="Top Deals nach Markt" className="top-deals-discovery__group">
          <strong>Märkte</strong>
          <div className="top-deals-discovery__links">
            {RETAILER_FILTERS.map(([key, label]) => (
              <a key={key} href={`/top-deals?retailer=${key}`} aria-current={activeRetailer === key ? 'page' : undefined}>{label}</a>
            ))}
          </div>
        </nav>
      </section>
    </section>
  )
}

export { EMPTY_STATE as TOP_DEALS_EMPTY_STATE }
