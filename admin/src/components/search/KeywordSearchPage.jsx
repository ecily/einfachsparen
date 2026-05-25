import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { fetchKeywordOfferSearch } from '../../utils/apiBase'
import { trackAnalyticsEvent } from '../../utils/analytics'
import {
  flattenRankingOffers,
  getOfferStableId,
  getRankingPagination,
  hasKnownSavings,
  mergePaginatedRankingResults,
  normalizeRetailerKey,
  shouldDisplayUnitPrice,
} from '../../utils/offers'
import { OfferCardConsumer } from './OfferCardConsumer'
import { formatRetailerName, shouldSeparateRetailerGroups, sortRetailersByDisplayGroup } from '../../utils/retailers'
import { getRetailerTheme } from '../../utils/retailerColors'

const KEYWORD_SEARCH_LIMIT = 60

const SORT_OPTIONS = {
  best: 'best',
  retailer: 'retailer',
  savings: 'savings',
}

const UNKNOWN_SAVINGS_UNIT_KEY = '__unknown__'

const SAVINGS_UNIT_LABELS = {
  kg: 'kg',
  g: 'g',
  '100 g': '100 g',
  l: 'l',
  ml: 'ml',
  '100 ml': '100 ml',
  stk: 'Stück',
  stück: 'Stück',
  stueck: 'Stück',
  packung: 'Packung',
  portion: 'Portion',
  waschgang: 'Waschgang',
}

const SAVINGS_UNIT_ORDER = ['kg', '100 g', 'g', 'l', '100 ml', 'ml', 'stk', 'stück', 'stueck', 'packung', 'portion', 'waschgang']

function getInitialKeywordQuery() {
  if (typeof window === 'undefined') return ''

  return new URLSearchParams(window.location.search).get('q') || ''
}

function normalizeKey(value) {
  return normalizeRetailerKey(value)
}

function getRetailerLabel(retailer) {
  const label = String(
    retailer?.label ||
      retailer?.name ||
      retailer?.retailerLabel ||
      retailer?.retailerName ||
      retailer?.retailerKey ||
      retailer?.key ||
      ''
  ).trim()

  return formatRetailerName(label, '')
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

  const label = String(
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

  return formatRetailerName(label, '')
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

function normalizeSavingsUnitKey(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('de-AT')
}

function getOfferSavingsUnit(offer) {
  const candidates = [offer?.normalizedUnitPrice?.unit, offer?.comparableUnit]

  for (const candidate of candidates) {
    const key = normalizeSavingsUnitKey(candidate)
    if (!key) continue

    return {
      key,
      label: SAVINGS_UNIT_LABELS[key] || String(candidate).trim(),
    }
  }

  return {
    key: UNKNOWN_SAVINGS_UNIT_KEY,
    label: '',
  }
}

function getOfferComparableUnitPrice(offer) {
  const amount = Number(offer?.normalizedUnitPrice?.amount)

  if (!shouldDisplayUnitPrice(offer) || !Number.isFinite(amount) || amount <= 0) {
    return null
  }

  const unit = getOfferSavingsUnit(offer)
  if (unit.key === UNKNOWN_SAVINGS_UNIT_KEY) return null

  return {
    amount,
    unit,
  }
}

function getSavingsUnitSortRank(unitKey) {
  if (unitKey === UNKNOWN_SAVINGS_UNIT_KEY) return Number.MAX_SAFE_INTEGER

  const rank = SAVINGS_UNIT_ORDER.indexOf(unitKey)
  return rank === -1 ? SAVINGS_UNIT_ORDER.length : rank
}

function buildSavingsOfferGroups(items) {
  const groups = []
  const groupByKey = new Map()

  for (const item of items) {
    const unit = item.comparableUnitPrice?.unit
    const unitKey = unit?.key || UNKNOWN_SAVINGS_UNIT_KEY
    const title =
      unitKey === UNKNOWN_SAVINGS_UNIT_KEY ? 'Weitere belastbare Angebote' : `Vergleichspreis pro ${unit.label}`

    if (!groupByKey.has(unitKey)) {
      const group = {
        key: unitKey,
        title,
        offers: [],
      }
      groupByKey.set(unitKey, group)
      groups.push(group)
    }

    groupByKey.get(unitKey).offers.push(item.offer)
  }

  return groups
}

function buildAvailableRetailers(retailers) {
  const seen = new Set()

  const availableRetailers = (retailers || [])
    .map((retailer) => {
      const key = getRetailerKey(retailer)
      const label = getRetailerLabel(retailer)

      return {
        key,
        label: label || key,
        retailerKey: key,
        retailerName: label || key,
      }
    })
    .filter((retailer) => {
      if (!retailer.key || seen.has(retailer.key)) return false
      seen.add(retailer.key)
      return true
    })

  return sortRetailersByDisplayGroup(availableRetailers)
}

export function KeywordSearchPage({ searchRequest, retailers = [], categories = [], shoppingListIds, onAddToShoppingList }) {
  const resultsHeadingRef = useRef(null)
  const requestIdRef = useRef(0)
  const [queryInput, setQueryInput] = useState(() => getInitialKeywordQuery())
  const [submittedQuery, setSubmittedQuery] = useState(() => {
    const initialQuery = getInitialKeywordQuery().trim()
    return initialQuery.length >= 2 ? initialQuery : ''
  })
  const [ranking, setRanking] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [loadMoreError, setLoadMoreError] = useState('')
  const [marketFilterEnabled, setMarketFilterEnabled] = useState(false)
  const [selectedRetailerKeys, setSelectedRetailerKeys] = useState([])
  const [sortMode, setSortMode] = useState(SORT_OPTIONS.best)
  const [hint, setHint] = useState(() => {
    const initialQuery = getInitialKeywordQuery().trim()
    return initialQuery.length === 1 ? 'Bitte mindestens 2 Zeichen eingeben.' : ''
  })
  const [activeSearchScrollKey, setActiveSearchScrollKey] = useState(0)
  const offers = useMemo(() => flattenRankingOffers(ranking), [ranking])
  const availableRetailers = useMemo(() => buildAvailableRetailers(retailers), [retailers])
  const activeRetailerKeys = useMemo(
    () => (marketFilterEnabled ? selectedRetailerKeys : []),
    [marketFilterEnabled, selectedRetailerKeys]
  )
  const visibleOfferItems = useMemo(() => {
    if (marketFilterEnabled && activeRetailerKeys.length === 0) return []

    const selectedRetailers = new Set(activeRetailerKeys)

    return offers
      .map((offer, index) => ({
        offer,
        index,
        retailerKey: getOfferRetailerKey(offer),
        retailerLabel: getOfferRetailerLabel(offer),
        comparableUnitPrice: getOfferComparableUnitPrice(offer),
        hasSavings: hasKnownSavings(offer),
      }))
      .filter((item) => {
        if (sortMode === SORT_OPTIONS.savings && !item.hasSavings) return false
        if (!marketFilterEnabled) return true
        return selectedRetailers.has(item.retailerKey)
      })
      .sort((left, right) => {
        if (sortMode === SORT_OPTIONS.retailer) {
          const retailerSort = left.retailerLabel.localeCompare(right.retailerLabel, 'de-AT')
          if (retailerSort !== 0) return retailerSort
        }

        if (sortMode === SORT_OPTIONS.savings) {
          const leftPrice = left.comparableUnitPrice
          const rightPrice = right.comparableUnitPrice

          if (leftPrice && !rightPrice) return -1
          if (!leftPrice && rightPrice) return 1
          if (!leftPrice && !rightPrice) return left.index - right.index

          const unitSort = getSavingsUnitSortRank(leftPrice.unit.key) - getSavingsUnitSortRank(rightPrice.unit.key)
          if (unitSort !== 0) return unitSort

          const unitLabelSort = leftPrice.unit.label.localeCompare(rightPrice.unit.label, 'de-AT')
          if (unitLabelSort !== 0) return unitLabelSort

          const unitPriceSort = leftPrice.amount - rightPrice.amount
          if (unitPriceSort !== 0) return unitPriceSort
        }

        return left.index - right.index
      })
  }, [activeRetailerKeys, marketFilterEnabled, offers, sortMode])
  const visibleOffers = useMemo(() => visibleOfferItems.map((item) => item.offer), [visibleOfferItems])
  const visibleOfferGroups = useMemo(() => buildSavingsOfferGroups(visibleOfferItems), [visibleOfferItems])
  const showSavingsGroups = sortMode === SORT_OPTIONS.savings && visibleOfferGroups.length > 0
  const needsMarketSelection = marketFilterEnabled && selectedRetailerKeys.length === 0
  const showResultsPanel = Boolean(submittedQuery || hint || loading || error)
  const pagination = useMemo(() => getRankingPagination(ranking), [ranking])

  useEffect(() => {
    if (!searchRequest?.nonce) return

    const nextQuery = String(searchRequest.query || '').trim()
    setQueryInput(nextQuery)
    setError('')
    setLoadMoreError('')

    if (!nextQuery) {
      requestIdRef.current += 1
      setSubmittedQuery('')
      setRanking(null)
      setLoadingMore(false)
      setLoadMoreError('')
      setHint('')
      return
    }

    if (nextQuery.length < 2) {
      requestIdRef.current += 1
      setSubmittedQuery('')
      setRanking(null)
      setLoadingMore(false)
      setLoadMoreError('')
      setHint('Bitte mindestens 2 Zeichen eingeben.')
      return
    }

    setActiveSearchScrollKey((current) => current + 1)
    setHint('')
    setSubmittedQuery(nextQuery)
  }, [searchRequest])

  useEffect(() => {
    if (!activeSearchScrollKey || !submittedQuery || loading) return

    const resultHeading = resultsHeadingRef.current
    if (!resultHeading) return

    window.requestAnimationFrame(() => {
      resultHeading.focus({ preventScroll: true })
      resultHeading.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [activeSearchScrollKey, loading, submittedQuery])

  useEffect(() => {
    if (!submittedQuery) return undefined

    if (marketFilterEnabled && activeRetailerKeys.length === 0) {
      setLoading(false)
      setLoadingMore(false)
      setLoadMoreError('')
      return undefined
    }

    let active = true
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    async function loadKeywordResults() {
      try {
        setLoading(true)
        setLoadingMore(false)
        setError('')
        setLoadMoreError('')
        setHint('')

        trackAnalyticsEvent('offer_search_started', {
          selectedRetailerCount: activeRetailerKeys.length,
          selectedCategoryCount: 0,
        })

        const rankingResult = await fetchKeywordOfferSearch(submittedQuery, KEYWORD_SEARCH_LIMIT, 0, '', {
          retailers: activeRetailerKeys,
        })

        if (!active || requestId !== requestIdRef.current) return

        const resultCount = flattenRankingOffers(rankingResult).length
        setRanking(rankingResult)

        trackAnalyticsEvent('offer_search_result', {
          resultCount,
          safeOfferCount: 0,
          actionOfferCount: resultCount,
          selectedRetailerCount: activeRetailerKeys.length,
          selectedCategoryCount: 0,
        })
      } catch {
        if (!active || requestId !== requestIdRef.current) return
        setRanking(null)
        setError('Die Suche konnte nicht geladen werden.')
      } finally {
        if (active && requestId === requestIdRef.current) setLoading(false)
      }
    }

    loadKeywordResults()

    return () => {
      active = false
    }
  }, [activeRetailerKeys, marketFilterEnabled, submittedQuery])

  function handleSubmit(event) {
    event.preventDefault()

    const nextQuery = queryInput.trim()

    if (!nextQuery) {
      setSubmittedQuery('')
      setRanking(null)
      setLoadingMore(false)
      setError('')
      setLoadMoreError('')
      setHint('')
      requestIdRef.current += 1

      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/suche')
      }

      return
    }

    if (nextQuery.length < 2) {
      setSubmittedQuery('')
      setRanking(null)
      setLoadingMore(false)
      setError('')
      setLoadMoreError('')
      setHint('Bitte mindestens 2 Zeichen eingeben.')
      requestIdRef.current += 1
      return
    }

    setSubmittedQuery(nextQuery)
    setActiveSearchScrollKey((current) => current + 1)

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

  async function handleLoadMoreOffers() {
    if (!submittedQuery || loading || loadingMore || !pagination.hasMore || pagination.nextOffset === null) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    try {
      setLoadingMore(true)
      setLoadMoreError('')
      const nextRanking = await fetchKeywordOfferSearch(
        submittedQuery,
        KEYWORD_SEARCH_LIMIT,
        pagination.nextOffset,
        ranking?.summary?.resultSetToken || '',
        {
          retailers: activeRetailerKeys,
        }
      )

      if (requestId !== requestIdRef.current) return

      setRanking((currentRanking) => mergePaginatedRankingResults(currentRanking, nextRanking))
    } catch {
      if (requestId !== requestIdRef.current) return
      setLoadMoreError('Weitere Angebote konnten gerade nicht geladen werden.')
    } finally {
      if (requestId === requestIdRef.current) setLoadingMore(false)
    }
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
          <h1>Wonach suchst du heute?</h1>
          <p className="subtitle">Suche nach Produkt, Marke oder Kategorie, zum Beispiel Kaffee, Milka oder Waschmittel.</p>
        </div>

        <form className="keyword-search-form" onSubmit={handleSubmit}>
          <div className="keyword-search-form__row">
            <div
              className="keyword-search-form__input-wrap"
              style={{ position: 'relative', flex: '1 1 18rem', minWidth: 0 }}
            >
              <input
                id="keyword-search-input"
                type="search"
                value={queryInput}
                placeholder="Produkt oder Marke suchen"
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
              <option value={SORT_OPTIONS.savings}>Belastbare Ersparnis</option>
            </select>
          </label>
        </div>

        {marketFilterEnabled ? (
          <div className="keyword-search-market-filter" aria-label="Märkte auswählen">
            {availableRetailers.map((retailer, index, retailerList) => {
              const selected = selectedRetailerKeys.includes(retailer.key)
              const retailerTheme = getRetailerTheme(retailer.key || retailer.label)
              const nextRetailer = retailerList[index + 1]
              const showGroupSeparator = shouldSeparateRetailerGroups(retailer.key, nextRetailer?.key)

              return (
                <Fragment key={retailer.key}>
                  <button
                    type="button"
                    className={`chip retailer-chip keyword-search-market-chip${
                      selected ? ' chip--active retailer-chip--active' : ''
                    }`}
                    style={{
                      '--retailer-color': retailerTheme.color,
                      '--retailer-text-color': retailerTheme.textColor,
                      '--retailer-border-color': retailerTheme.borderColor,
                      '--retailer-soft-color': retailerTheme.softColor,
                    }}
                    aria-pressed={selected}
                    onClick={() => handleToggleRetailer(retailer.key)}
                  >
                    <span className="retailer-chip__dot" aria-hidden="true" />
                    <span className="retailer-chip__label">{retailer.label}</span>
                  </button>
                  {showGroupSeparator ? <span className="retailer-chip-group-separator" aria-hidden="true" /> : null}
                </Fragment>
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

      {showResultsPanel ? (
        <section className="panel keyword-search-results" aria-busy={loading || loadingMore ? 'true' : 'false'}>
        {hint ? <p className="status">{hint}</p> : null}
        {loading ? (
          <div className="browse-loading-status" role="status" aria-live="polite">
            <span className="browse-loading-status__spinner" aria-hidden="true" />
            <span>Angebote werden gesucht &hellip;</span>
          </div>
        ) : null}
        {error ? (
          <div className="empty-state">
            <h3>Die Angebote konnten gerade nicht geladen werden.</h3>
            <p>Bitte prüfe deine Verbindung und versuche es erneut.</p>
            <button type="button" className="primary-action-button" onClick={handleRetrySearch}>
              Erneut versuchen
            </button>
          </div>
        ) : null}
        {loadMoreError ? <p className="status status--error">{loadMoreError}</p> : null}
        {submittedQuery && needsMarketSelection ? (
          <p className="status">Wähle mindestens einen Markt aus oder suche ohne Marktfilter.</p>
        ) : null}

        {!loading && !error && submittedQuery ? (
          <div className="results-section">
            <div className="panel__header">
              <h2 ref={resultsHeadingRef} className="search-results-heading" tabIndex="-1">
                Angebote für „{submittedQuery}“
              </h2>
              <p>
                {sortMode === SORT_OPTIONS.savings
                  ? `${visibleOffers.length} Angebote mit belastbarer Ersparnis angezeigt`
                  : pagination.totalCount && pagination.totalCount > visibleOffers.length
                  ? `${visibleOffers.length} von ${pagination.totalCount} Angeboten angezeigt`
                  : `${visibleOffers.length} Angebote gefunden`}
              </p>
            </div>
            <p className="market-check-note">Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.</p>

            {visibleOffers.length > 0 ? (
              <>
                {showSavingsGroups ? (
                  <div className="keyword-search-savings-groups">
                    {visibleOfferGroups.map((group) => (
                      <section key={group.key} className="keyword-search-savings-group" aria-label={group.title}>
                        <div className="keyword-search-savings-group__header">
                          <h3>{group.title}</h3>
                          <span>{group.offers.length} Angebote</span>
                        </div>
                        <div className="user-results">
                          {group.offers.map((offer) => {
                            const resultPosition = visibleOffers.findIndex((visibleOffer) => visibleOffer.id === offer.id) + 1

                            return (
                            <OfferCardConsumer
                              key={offer.id}
                              offer={offer}
                              onAddToShoppingList={onAddToShoppingList}
                              isInShoppingList={shoppingListIds.has(getOfferStableId(offer))}
                              feedbackCategories={categories}
                              feedbackPageContext={{
                                routeName: 'offers-ranking',
                                query: submittedQuery,
                                activeRetailers: activeRetailerKeys,
                                activeCategories: [],
                                programRetailers: activeRetailerKeys,
                                onlyWithoutProgram: false,
                                sortMode,
                                resultPosition,
                                activeFilters: {
                                  marketFilterEnabled,
                                  selectedRetailers: activeRetailerKeys,
                                  sortMode,
                                  resultGroup: group.key,
                                },
                              }}
                            />
                            )
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="user-results">
                    {visibleOffers.map((offer, index) => (
                      <OfferCardConsumer
                        key={offer.id}
                        offer={offer}
                        onAddToShoppingList={onAddToShoppingList}
                        isInShoppingList={shoppingListIds.has(getOfferStableId(offer))}
                        feedbackCategories={categories}
                        feedbackPageContext={{
                          routeName: 'offers-ranking',
                          query: submittedQuery,
                          activeRetailers: activeRetailerKeys,
                          activeCategories: [],
                          programRetailers: activeRetailerKeys,
                          onlyWithoutProgram: false,
                          sortMode,
                          resultPosition: index + 1,
                          activeFilters: {
                            marketFilterEnabled,
                            selectedRetailers: activeRetailerKeys,
                            sortMode,
                          },
                        }}
                      />
                    ))}
                  </div>
                )}
                {pagination.hasMore ? (
                  <div className="load-more-results" role="status" aria-live="polite">
                    <button
                      type="button"
                      className="load-more-results__button"
                      onClick={handleLoadMoreOffers}
                      disabled={loadingMore}
                      aria-busy={loadingMore ? 'true' : 'false'}
                    >
                      {loadingMore ? (
                        <>
                          <span className="browse-loading-status__spinner" aria-hidden="true" />
                          <span>Weitere Angebote werden geladen &hellip;</span>
                        </>
                      ) : (
                        'Weitere Angebote laden'
                      )}
                    </button>
                  </div>
                ) : null}
              </>
            ) : needsMarketSelection ? null : (
              <div className="empty-state">
                <h3>Aktuell kein passendes Angebot gefunden.</h3>
                <p>Bitte prüfe später erneut oder suche allgemeiner.</p>
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
      ) : null}
    </div>
  )
}
