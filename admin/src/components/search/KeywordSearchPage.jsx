import { useEffect, useMemo, useState } from 'react'
import { fetchKeywordOfferSearch } from '../../utils/apiBase'
import { trackAnalyticsEvent } from '../../utils/analytics'
import { flattenRankingOffers, getOfferStableId } from '../../utils/offers'
import { OfferCardConsumer } from './OfferCardConsumer'

function getInitialKeywordQuery() {
  if (typeof window === 'undefined') return ''

  return new URLSearchParams(window.location.search).get('q') || ''
}

export function KeywordSearchPage({ searchRequest, shoppingListIds, onAddToShoppingList }) {
  const [queryInput, setQueryInput] = useState(() => getInitialKeywordQuery())
  const [submittedQuery, setSubmittedQuery] = useState(() => {
    const initialQuery = getInitialKeywordQuery().trim()
    return initialQuery.length >= 2 ? initialQuery : ''
  })
  const [ranking, setRanking] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hint, setHint] = useState(() => {
    const initialQuery = getInitialKeywordQuery().trim()
    return initialQuery.length === 1 ? 'Bitte mindestens 2 Zeichen eingeben.' : ''
  })
  const offers = useMemo(() => flattenRankingOffers(ranking), [ranking])

  useEffect(() => {
    if (!searchRequest?.nonce) return

    const nextQuery = String(searchRequest.query || '').trim()
    setQueryInput(nextQuery)
    setError('')

    if (!nextQuery) {
      setSubmittedQuery('')
      setRanking(null)
      setHint('')
      return
    }

    if (nextQuery.length < 2) {
      setSubmittedQuery('')
      setRanking(null)
      setHint('Bitte mindestens 2 Zeichen eingeben.')
      return
    }

    setHint('')
    setSubmittedQuery(nextQuery)
  }, [searchRequest])

  useEffect(() => {
    if (!submittedQuery) return undefined

    let active = true

    async function loadKeywordResults() {
      try {
        setLoading(true)
        setError('')
        setHint('')

        trackAnalyticsEvent('keyword_search_started', {
          queryLength: submittedQuery.length,
          source: 'keyword_search',
        })

        const rankingResult = await fetchKeywordOfferSearch(submittedQuery, 60)

        if (!active) return

        const resultCount = flattenRankingOffers(rankingResult).length
        setRanking(rankingResult)

        trackAnalyticsEvent('keyword_search_result', {
          queryLength: submittedQuery.length,
          resultCount,
          source: 'keyword_search',
        })
      } catch {
        if (!active) return
        setRanking(null)
        setError('Die Suche konnte nicht geladen werden.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadKeywordResults()

    return () => {
      active = false
    }
  }, [submittedQuery])

  function handleSubmit(event) {
    event.preventDefault()

    const nextQuery = queryInput.trim()

    if (!nextQuery) {
      setSubmittedQuery('')
      setRanking(null)
      setError('')
      setHint('')

      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/suche')
      }

      return
    }

    if (nextQuery.length < 2) {
      setSubmittedQuery('')
      setRanking(null)
      setError('')
      setHint('Bitte mindestens 2 Zeichen eingeben.')
      return
    }

    setSubmittedQuery(nextQuery)

    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', `/suche?q=${encodeURIComponent(nextQuery)}`)
    }
  }

  return (
    <div className="keyword-search-page">
      <section className="panel keyword-search-hero">
        <div className="keyword-search-hero__copy">
          <p className="eyebrow">Produktsuche</p>
          <h1>Produktsuche</h1>
          <p className="subtitle">
            Suche nach Produkten, Marken oder Kategorien – unabhängig von deiner aktuellen Händlerauswahl.
          </p>
        </div>

        <form className="keyword-search-form" onSubmit={handleSubmit}>
          <label className="keyword-search-form__label" htmlFor="keyword-search-input">
            Suchbegriff
          </label>
          <div className="keyword-search-form__row">
            <input
              id="keyword-search-input"
              type="search"
              value={queryInput}
              placeholder="z. B. Butter, Kaffee, Waschmittel"
              onChange={(event) => setQueryInput(event.target.value)}
            />
            <button type="submit" className="primary-action-button">
              Suchen
            </button>
          </div>
        </form>
      </section>

      <section className="panel keyword-search-results">
        {!submittedQuery && !hint ? <p className="status">Gib ein Produkt, eine Marke oder Kategorie ein.</p> : null}
        {hint ? <p className="status">{hint}</p> : null}
        {loading ? <p className="status">Suche aktuelle Angebote …</p> : null}
        {error ? <p className="status status--error">{error}</p> : null}

        {!loading && !error && submittedQuery ? (
          <div className="results-section">
            <div className="panel__header">
              <h2>Suchergebnisse für „{submittedQuery}“</h2>
              <p>{offers.length} aktuelle Angebote gefunden</p>
            </div>

            {offers.length > 0 ? (
              <div className="user-results">
                {offers.map((offer, index) => (
                  <OfferCardConsumer
                    key={offer.id}
                    offer={offer}
                    highlightLabel={`Treffer ${index + 1}`}
                    onAddToShoppingList={onAddToShoppingList}
                    isInShoppingList={shoppingListIds.has(getOfferStableId(offer))}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <h3>Keine aktuellen Angebote gefunden.</h3>
                <p>Tipp: Suche allgemeiner, z. B. „Kaffee“ statt „Jacobs Crema“.</p>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
}
