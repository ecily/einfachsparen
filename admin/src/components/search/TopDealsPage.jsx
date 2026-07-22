import { useEffect, useState } from 'react'

import { fetchTopDeals } from '../../utils/apiBase'
import { getOfferStableId } from '../../utils/offers'
import { OfferCardConsumer } from './OfferCardConsumer'

const EMPTY_STATE = 'Heute sind noch nicht genug verifizierte Vergleichswerte verfügbar. Suche direkt nach deinem Produkt.'

export function TopDealsPage({ shoppingListIds, onAddToShoppingList, onNavigate }) {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function loadTopDeals() {
      try {
        setLoading(true)
        setError('')
        const result = await fetchTopDeals(10)
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
  }, [])

  const deals = Array.isArray(payload?.deals) ? payload.deals : []

  return (
    <section className="top-deals-page" aria-labelledby="top-deals-title">
      <header className="panel top-deals-hero">
        <p className="eyebrow">Heute verifiziert</p>
        <h1 id="top-deals-title">Top Deals heute</h1>
        <p className="subtitle">Die stärksten verifizierten Ersparnisse nach Preis pro Einheit – Bedingungen inklusive.</p>
        <p className="top-deals-hero__trust">Nur mit belastbarem Einheitspreis und direktem Referenzpreis derselben Packung.</p>
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
    </section>
  )
}

export { EMPTY_STATE as TOP_DEALS_EMPTY_STATE }
