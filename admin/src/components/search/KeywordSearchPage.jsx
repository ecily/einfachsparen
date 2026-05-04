import { useEffect, useMemo, useState } from 'react'
import { fetchKeywordOfferSearch } from '../../utils/apiBase'
import { trackAnalyticsEvent } from '../../utils/analytics'
import { flattenRankingOffers, getOfferStableId, normalizeRetailerKey } from '../../utils/offers'
import { OfferCardConsumer } from './OfferCardConsumer'

const KEYWORD_SEARCH_LIMIT = 250

const SORT_OPTIONS = {
  best: 'best',
  retailer: 'retailer',
  savings: 'savings',
}

function getInitialKeywordQuery() {
  if (typeof window === 'undefined') return ''

  return new URLSearchParams(window.location.search).get('q') || ''
}

function normalizeKey(value) {
  return normalizeRetailerKey(value)
}

function getRetailerLabel(retailer) {
  return String(
    retailer?.label ||
      retailer?.name ||
      retailer?.retailerLabel ||
      retailer?.retailerName ||
      retailer?.retailerKey ||
      retailer?.key ||
      ''
  ).trim()
}

function getRetailerKey(retailer) {
  const directKey = retailer?.retailerKey || retailer?.key
  if (directKey) return normalizeKey(directKey)

  return normalizeKey(getRetailerLabel(retailer))
}

function getOfferRetailerLabel(offer) {
  const retailerObject = typeof offer?.retailer === 'object' ? offer.retailer : null
  const providerObject = typeof offer?.provider === 'object' ? offer.provider : null
  const marketObject = typeof offer?.market === 'object' ? offer.market : null
  const shopObject = typeof offer?.shop === 'object' ? offer.shop : null

  return String(
    offer?.retailerLabel ||
      offer?.retailerName ||
      offer?.providerLabel ||
      offer?.marketLabel ||
      offer?.shopLabel ||
      retailerObject?.label ||
      retailerObject?.name ||
      providerObject?.label ||
      providerObject?.name ||
      marketObject?.label ||
      marketObject?.name ||
      shopObject?.label ||
      shopObject?.name ||
      (typeof offer?.retailer === 'string' ? offer.retailer : '') ||
      (typeof offer?.provider === 'string' ? offer.provider : '') ||
      (typeof offer?.market === 'string' ? offer.market : '') ||
      (typeof offer?.shop === 'string' ? offer.shop : '') ||
      ''
  ).trim()
}

function getOfferRetailerKey(offer) {
  const retailerObject = typeof offer?.retailer === 'object' ? offer.retailer : null
  const providerObject = typeof offer?.provider === 'object' ? offer.provider : null
  const marketObject = typeof offer?.market === 'object' ? offer.market : null
  const shopObject = typeof offer?.shop === 'object' ? offer.shop : null
  const directKey =
    offer?.retailerKey ||
    offer?.providerKey ||
    offer?.marketKey ||
    offer?.shopKey ||
    retailerObject?.retailerKey ||
    retailerObject?.key ||
    providerObject?.retailerKey ||
    providerObject?.key ||
    marketObject?.retailerKey ||
    marketObject?.key ||
    shopObject?.retailerKey ||
    shopObject?.key

  if (directKey) return normalizeKey(directKey)

  return normalizeKey(getOfferRetailerLabel(offer))
}

function getNumericCandidate(value) {
  if (value && typeof value === 'object') {
    return getNumericCandidate(value.amount ?? value.value ?? value.eur ?? value.price)
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') return null

  const normalized = value
    .replace(/\s/g, '')
    .replace(/%/g, '')
    .replace(/€/g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '')
  const numeric = Number(normalized)

  return Number.isFinite(numeric) ? numeric : null
}

function firstPositiveNumber(candidates) {
  for (const candidate of candidates) {
    const numeric = getNumericCandidate(candidate)
    if (numeric !== null && numeric > 0) return numeric
  }

  return 0
}

function getOfferSavingsScore(offer) {
  const directSavings = firstPositiveNumber([
    offer?.savingsAmount,
    offer?.savingAmount,
    offer?.savingsAbsolute,
    offer?.discountAmount,
    offer?.savings?.amount,
    offer?.discount?.amount,
    offer?.priceSavings?.amount,
  ])

  if (directSavings > 0) return directSavings

  const currentPrice = firstPositiveNumber([
    offer?.price,
    offer?.priceCurrent,
    offer?.currentPrice,
    offer?.offerPrice,
  ])
  const oldPrice = firstPositiveNumber([
    offer?.oldPrice,
    offer?.regularPrice,
    offer?.previousPrice,
    offer?.priceBefore,
    offer?.priceOriginal,
    offer?.priceRegular,
  ])

  if (oldPrice > currentPrice && currentPrice > 0) {
    return oldPrice - currentPrice
  }

  return firstPositiveNumber([offer?.savingsPercent, offer?.discountPercent, offer?.discount?.percent])
}

function buildAvailableRetailers(retailers) {
  const seen = new Set()

  return (retailers || [])
    .map((retailer) => {
      const key = getRetailerKey(retailer)
      const label = getRetailerLabel(retailer)

      return { key, label: label || key }
    })
    .filter((retailer) => {
      if (!retailer.key || seen.has(retailer.key)) return false
      seen.add(retailer.key)
      return true
    })
    .sort((left, right) => left.label.localeCompare(right.label, 'de-AT'))
}

export function KeywordSearchPage({ searchRequest, retailers = [], shoppingListIds, onAddToShoppingList }) {
  const [queryInput, setQueryInput] = useState(() => getInitialKeywordQuery())
  const [submittedQuery, setSubmittedQuery] = useState(() => {
    const initialQuery = getInitialKeywordQuery().trim()
    return initialQuery.length >= 2 ? initialQuery : ''
  })
  const [ranking, setRanking] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [marketFilterEnabled, setMarketFilterEnabled] = useState(false)
  const [selectedRetailerKeys, setSelectedRetailerKeys] = useState([])
  const [sortMode, setSortMode] = useState(SORT_OPTIONS.best)
  const [hint, setHint] = useState(() => {
    const initialQuery = getInitialKeywordQuery().trim()
    return initialQuery.length === 1 ? 'Bitte mindestens 2 Zeichen eingeben.' : ''
  })
  const offers = useMemo(() => flattenRankingOffers(ranking), [ranking])
  const availableRetailers = useMemo(() => buildAvailableRetailers(retailers), [retailers])
  const visibleOffers = useMemo(() => {
    if (marketFilterEnabled && selectedRetailerKeys.length === 0) return []

    const selectedRetailers = new Set(selectedRetailerKeys)

    return offers
      .map((offer, index) => ({
        offer,
        index,
        retailerKey: getOfferRetailerKey(offer),
        retailerLabel: getOfferRetailerLabel(offer),
        savingsScore: getOfferSavingsScore(offer),
      }))
      .filter((item) => {
        if (!marketFilterEnabled) return true
        return selectedRetailers.has(item.retailerKey)
      })
      .sort((left, right) => {
        if (sortMode === SORT_OPTIONS.retailer) {
          const retailerSort = left.retailerLabel.localeCompare(right.retailerLabel, 'de-AT')
          if (retailerSort !== 0) return retailerSort
        }

        if (sortMode === SORT_OPTIONS.savings) {
          const savingsSort = right.savingsScore - left.savingsScore
          if (savingsSort !== 0) return savingsSort
        }

        return left.index - right.index
      })
      .map((item) => item.offer)
  }, [marketFilterEnabled, offers, selectedRetailerKeys, sortMode])
  const needsMarketSelection = marketFilterEnabled && selectedRetailerKeys.length === 0

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

        const rankingResult = await fetchKeywordOfferSearch(submittedQuery, KEYWORD_SEARCH_LIMIT)

        if (!active) return

        const resultCount = flattenRankingOffers(rankingResult).length
        setRanking(rankingResult)

        trackAnalyticsEvent('keyword_search_result', {
          queryLength: submittedQuery.length,
          resultCount,
          resultCountRaw: resultCount,
          limit: KEYWORD_SEARCH_LIMIT,
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

  function handleClearSearch() {
    setQueryInput('')
  }

  function handleRetrySearch() {
    if (!submittedQuery) return
    setSubmittedQuery('')
    window.setTimeout(() => setSubmittedQuery(submittedQuery), 0)
  }

  function handleResetMarkets() {
    setSelectedRetailerKeys([])
    setMarketFilterEnabled(false)
  }

  function handleToggleRetailer(retailerKey) {
    setSelectedRetailerKeys((current) =>
      current.includes(retailerKey)
        ? current.filter((key) => key !== retailerKey)
        : [...current, retailerKey]
    )
  }

  return (
    <div className="keyword-search-page">
      <section className="panel keyword-search-hero">
        <div className="keyword-search-hero__copy">
          <p className="eyebrow">Produktsuche</p>
          <h1>Was möchtest du günstiger kaufen?</h1>
          <p className="subtitle">Suche aktuelle Angebote und merke sie dir für deinen Einkauf.</p>
        </div>

        <form className="keyword-search-form" onSubmit={handleSubmit}>
          <label className="keyword-search-form__label" htmlFor="keyword-search-input">
            Suchbegriff
          </label>
          <div className="keyword-search-form__row">
            <div
              className="keyword-search-form__input-wrap"
              style={{ position: 'relative', flex: '1 1 18rem', minWidth: 0 }}
            >
              <input
                id="keyword-search-input"
                type="search"
                value={queryInput}
                placeholder="z. B. Milch, Kaffee, Butter ..."
                onChange={(event) => setQueryInput(event.target.value)}
                style={{ width: '100%', paddingRight: queryInput ? '2.75rem' : undefined }}
              />
              {queryInput ? (
                <button
                  type="button"
                  className="keyword-search-form__clear"
                  aria-label="Suchbegriff löschen"
                  onClick={handleClearSearch}
                  style={{
                    alignItems: 'center',
                    background: 'transparent',
                    border: 0,
                    color: 'currentColor',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    fontSize: '1.4rem',
                    height: '2.5rem',
                    justifyContent: 'center',
                    lineHeight: 1,
                    opacity: 0.72,
                    padding: 0,
                    position: 'absolute',
                    right: '0.2rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '2.5rem',
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
            <button type="submit" className="primary-action-button">
              Angebote suchen
            </button>
          </div>
        </form>

        <div className="keyword-search-controls">
          <div className="keyword-search-filter-intro">
            <p className="eyebrow">Optional eingrenzen</p>
            <p>Du kannst direkt suchen oder vorher bestimmte Märkte auswählen.</p>
            <label className="keyword-search-toggle">
              <input
                type="checkbox"
                checked={marketFilterEnabled}
                onChange={(event) => setMarketFilterEnabled(event.target.checked)}
              />
              <span>Märkte wählen</span>
            </label>
          </div>

          <label className="keyword-search-sort">
            <span>Sortieren</span>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
              <option value={SORT_OPTIONS.best}>Empfohlen</option>
              <option value={SORT_OPTIONS.retailer}>Märkte</option>
              <option value={SORT_OPTIONS.savings}>Ersparnis</option>
            </select>
          </label>
        </div>

        {marketFilterEnabled ? (
          <div className="keyword-search-market-filter" aria-label="Märkte auswählen">
            {availableRetailers.map((retailer) => {
              const selected = selectedRetailerKeys.includes(retailer.key)

              return (
                <button
                  key={retailer.key}
                  type="button"
                  className={`chip keyword-search-market-chip${selected ? ' chip--active' : ''}`}
                  aria-pressed={selected}
                  onClick={() => handleToggleRetailer(retailer.key)}
                >
                  {retailer.label}
                </button>
              )
            })}
            {selectedRetailerKeys.length > 0 ? (
              <button type="button" className="chip" onClick={handleResetMarkets}>
                Märkte zurücksetzen
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="panel keyword-search-results">
        {!submittedQuery && !hint ? <p className="status">Gib ein Produkt, eine Marke oder Kategorie ein.</p> : null}
        {hint ? <p className="status">{hint}</p> : null}
        {loading ? <p className="status">Angebote werden gesucht ...</p> : null}
        {error ? (
          <div className="empty-state">
            <h3>Die Angebote konnten gerade nicht geladen werden.</h3>
            <p>Bitte prüfe deine Verbindung und versuche es erneut.</p>
            <button type="button" className="primary-action-button" onClick={handleRetrySearch}>
              Erneut versuchen
            </button>
          </div>
        ) : null}
        {submittedQuery && needsMarketSelection ? (
          <p className="status">Wähle mindestens einen Markt aus oder suche ohne Marktfilter.</p>
        ) : null}

        {!loading && !error && submittedQuery ? (
          <div className="results-section">
            <div className="panel__header">
              <h2>Angebote für „{submittedQuery}“</h2>
              <p>{visibleOffers.length} Angebote gefunden</p>
            </div>

            {visibleOffers.length > 0 ? (
              <div className="user-results">
                {visibleOffers.map((offer, index) => (
                  <OfferCardConsumer
                    key={offer.id}
                    offer={offer}
                    highlightLabel={`Treffer ${index + 1}`}
                    onAddToShoppingList={onAddToShoppingList}
                    isInShoppingList={shoppingListIds.has(getOfferStableId(offer))}
                  />
                ))}
              </div>
            ) : needsMarketSelection ? null : (
              <div className="empty-state">
                <h3>Für deine Suche haben wir gerade kein passendes Angebot gefunden.</h3>
                <p>Versuche einen allgemeineren Begriff.</p>
                <p>Prüfe die Schreibweise.</p>
                <p>Entferne ausgewählte Märkte.</p>
                <button type="button" className="primary-action-button" onClick={() => setQueryInput(submittedQuery)}>
                  Suche ändern
                </button>
                {marketFilterEnabled && selectedRetailerKeys.length > 0 ? (
                  <button type="button" className="secondary-action-button" onClick={handleResetMarkets}>
                    Märkte zurücksetzen
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
}
