import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { fetchKeywordOfferSearch } from '../../utils/apiBase'
import { trackAnalyticsEvent } from '../../utils/analytics'
import { collectKeywordSearchResults, sortKeywordSearchItems } from '../../utils/keywordSearchSort'
import {
  flattenRankingOffers,
  mergePaginatedRankingResults,
  getOfferStableId,
  hasKnownSavings,
  normalizeRetailerKey,
  shouldDisplayUnitPrice,
} from '../../utils/offers'
import { OfferCardConsumer } from './OfferCardConsumer'
import { SparTrustNotice } from './SparTrustNotice'
import { formatRetailerName, shouldSeparateRetailerGroups, sortRetailersByDisplayGroup } from '../../utils/retailers'
import { getRetailerTheme } from '../../utils/retailerColors'
import {
  getFreshnessWarningNotices,
  getPublicTrustWarningNotices,
  hasFreshnessWarning,
  isLimitedCoverageRetailer,
} from '../../utils/retailerCoverage'
import { QUICK_SEARCH_TERMS } from '../../config/searchDiscovery'

const KEYWORD_SEARCH_LIMIT = 60
const EXAMPLE_SEARCH_TERMS = QUICK_SEARCH_TERMS
const EMPTY_SEARCH_FALLBACK_TERMS = QUICK_SEARCH_TERMS
const EMPTY_SEARCH_SUGGESTION_MAP = [
  {
    pattern: /reininghaus|bier|märzen|maerzen|radler|gösser|goesser|puntigamer|stiegl|ottakringer/i,
    terms: ['bier', 'märzen', 'radler', 'gösser', 'puntigamer'],
  },
  {
    pattern: /milch|joghurt|butter|käse|kaese|schärdinger|schaerdinger/i,
    terms: ['Milch', 'Butter', 'Käse', 'Joghurt', 'Schärdinger'],
  },
  {
    pattern: /kaffee|espresso|cappuccino|eduscho|jacobs|lavazza/i,
    terms: ['Kaffee', 'Espresso', 'Eduscho', 'Jacobs', 'Lavazza'],
  },
  {
    pattern: /wasch|reiniger|spül|spuel|putz|finish|persil|ariel/i,
    terms: ['Waschmittel', 'Reiniger', 'Geschirrspültabs', 'Persil', 'Ariel'],
  },
  {
    pattern: /zahn|zahnpasta|oral|elmex|meridol/i,
    terms: ['Zahnpasta', 'Elmex', 'Meridol', 'Mundspülung', 'Zahnbürste'],
  },
]

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

function getEmptySearchSuggestions(query) {
  const normalizedQuery = String(query || '').trim()
  const matchedGroup = EMPTY_SEARCH_SUGGESTION_MAP.find((group) => group.pattern.test(normalizedQuery))
  const terms = matchedGroup?.terms || EMPTY_SEARCH_FALLBACK_TERMS
  const seen = new Set()

  return terms.filter((term) => {
    const key = term.toLocaleLowerCase('de-AT')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
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
      unitKey === UNKNOWN_SAVINGS_UNIT_KEY ? 'Weitere belastbare Angebote' : `Preis pro ${unit.label}`

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
        ...retailer,
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

export function KeywordSearchPage({
  searchRequest,
  retailers = [],
  categories = [],
  shoppingListIds,
  onAddToShoppingList,
  onNavigate,
}) {
  const resultsHeadingRef = useRef(null)
  const searchInputRef = useRef(null)
  const requestIdRef = useRef(0)
  const cacheRef = useRef(new Map())
  const displayedScopeRef = useRef(null)
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
  const [appliedSortMode, setAppliedSortMode] = useState(SORT_OPTIONS.best)
  const [sortPending, setSortPending] = useState(false)
  const [sortProgress, setSortProgress] = useState(0)
  const [retryNonce, setRetryNonce] = useState(0)
  const [visibleLimit, setVisibleLimit] = useState(KEYWORD_SEARCH_LIMIT)
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
  const scopeKey = JSON.stringify([submittedQuery, marketFilterEnabled, [...activeRetailerKeys].sort()])
  const sortedOfferItems = useMemo(() => {
    if (marketFilterEnabled && activeRetailerKeys.length === 0) return []

    const selectedRetailers = new Set(activeRetailerKeys)

    const items = offers
      .map((offer, index) => ({
        offer,
        index,
        retailerKey: getOfferRetailerKey(offer),
        retailerLabel: getOfferRetailerLabel(offer),
        comparableUnitPrice: getOfferComparableUnitPrice(offer),
        hasSavings: hasKnownSavings(offer),
      }))
      .filter((item) => {
        if (appliedSortMode === SORT_OPTIONS.savings && !item.hasSavings) return false
        if (!marketFilterEnabled) return true
        return selectedRetailers.has(item.retailerKey)
      })
    return sortKeywordSearchItems(items, appliedSortMode, getSavingsUnitSortRank)
  }, [activeRetailerKeys, marketFilterEnabled, offers, appliedSortMode])
  const visibleOfferItems = useMemo(() => sortedOfferItems.slice(0, visibleLimit), [sortedOfferItems, visibleLimit])
  const visibleOffers = useMemo(() => visibleOfferItems.map((item) => item.offer), [visibleOfferItems])
  const visibleOfferGroups = useMemo(() => buildSavingsOfferGroups(visibleOfferItems), [visibleOfferItems])
  const showSavingsGroups = appliedSortMode === SORT_OPTIONS.savings && visibleOfferGroups.length > 0
  const needsMarketSelection = marketFilterEnabled && selectedRetailerKeys.length === 0
  const showResultsPanel = Boolean(submittedQuery || hint || loading || error)
  const pagination = { totalCount: appliedSortMode === SORT_OPTIONS.best ? ranking?.summary?.totalCount : sortedOfferItems.length, hasMore: visibleLimit < sortedOfferItems.length || ranking?.summary?.hasMore === true, nextOffset: ranking?.summary?.nextOffset }
  const emptySearchSuggestions = useMemo(() => getEmptySearchSuggestions(submittedQuery), [submittedQuery])
  const visibleRetailerKeys = useMemo(
    () => [...new Set(visibleOfferItems.map((item) => item.retailerKey).filter(Boolean))],
    [visibleOfferItems]
  )
  const freshnessNotices = useMemo(
    () => getFreshnessWarningNotices(marketFilterEnabled ? selectedRetailerKeys : visibleRetailerKeys, availableRetailers),
    [availableRetailers, marketFilterEnabled, selectedRetailerKeys, visibleRetailerKeys]
  )
  const publicTrustNotices = useMemo(
    () => getPublicTrustWarningNotices(marketFilterEnabled ? selectedRetailerKeys : visibleRetailerKeys, availableRetailers),
    [availableRetailers, marketFilterEnabled, selectedRetailerKeys, visibleRetailerKeys]
  )

  useEffect(() => {
    setVisibleLimit(KEYWORD_SEARCH_LIMIT)
  }, [activeRetailerKeys, marketFilterEnabled, submittedQuery])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return

    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true })
    })
  }, [])

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
    const requestId = ++requestIdRef.current
    let active = true
    const current = () => active && requestId === requestIdRef.current
    setLoadingMore(false)
    setLoadMoreError('')
    setSortPending(false)
    if (!submittedQuery || (marketFilterEnabled && activeRetailerKeys.length === 0)) {
      setLoading(false)
      return () => { active = false }
    }
    async function load() {
      let data = cacheRef.current.get(scopeKey)
      const sameScope = displayedScopeRef.current === scopeKey
      setError('')
      setHint('')
      if (!sameScope) {
        setRanking(data || null)
        setAppliedSortMode(SORT_OPTIONS.best)
        displayedScopeRef.current = scopeKey
      }
      setLoading(!data)
      const fetchPage = (offset, token) => fetchKeywordOfferSearch(submittedQuery, KEYWORD_SEARCH_LIMIT, offset, token, { retailers: activeRetailerKeys })
      try {
        if (!data) {
          data = await fetchPage(0, '')
          if (!current()) return
          cacheRef.current.set(scopeKey, data)
          setRanking(data)
          setAppliedSortMode(SORT_OPTIONS.best)
          setLoading(false)
          trackAnalyticsEvent('offer_search_result', {
            resultCount: flattenRankingOffers(data).length,
            safeOfferCount: 0, actionOfferCount: flattenRankingOffers(data).length,
            selectedRetailerCount: activeRetailerKeys.length, selectedCategoryCount: 0,
          })
        }
        if (sortMode !== SORT_OPTIONS.best && data.summary.hasMore === true) {
          setSortPending(true)
          setSortProgress(flattenRankingOffers(data).length)
          data = await collectKeywordSearchResults(fetchPage, current, data, (partial) => {
            if (!current()) return
            cacheRef.current.set(scopeKey, partial)
            setSortProgress(flattenRankingOffers(partial).length)
          })
        }
        if (!current()) return
        setRanking(data)
        setAppliedSortMode(sortMode)
        setVisibleLimit(KEYWORD_SEARCH_LIMIT)
        setSortPending(false)
      } catch {
        if (!current()) return
        if (data) {
          setLoadMoreError('Die globale Sortierung ist noch nicht vollst?ndig. Bisherige Treffer bleiben in ihrer bisherigen Reihenfolge sichtbar.')
          setSortPending(true)
        } else setError('Die Suche konnte nicht geladen werden.')
      } finally {
        if (current()) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [activeRetailerKeys, marketFilterEnabled, submittedQuery, scopeKey, sortMode, retryNonce])

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

  function handleEditSearch() {
    setQueryInput(submittedQuery)

    window.requestAnimationFrame(() => {
      const input = searchInputRef.current
      if (!input) return

      input.scrollIntoView({ behavior: 'smooth', block: 'center' })
      input.focus({ preventScroll: true })
    })
  }

  function handleRetrySearch() {
    if (!submittedQuery) return
    setSubmittedQuery('')
    window.setTimeout(() => setSubmittedQuery(submittedQuery), 0)
  }

  function handleExampleSearch(term) {
    const nextQuery = String(term || '').trim()
    if (!nextQuery) return

    setQueryInput(nextQuery)
    setSubmittedQuery(nextQuery)
    setActiveSearchScrollKey((current) => current + 1)

    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', `/suche?q=${encodeURIComponent(nextQuery)}`)
    }
  }

  async function handleLoadMoreOffers() {
    if (!submittedQuery || loading || loadingMore || sortPending || !pagination.hasMore) return
    const cached = cacheRef.current.get(scopeKey)
    if (visibleLimit < flattenRankingOffers(cached).length || cached?.summary?.hasMore !== true) {
      setRanking(cached)
      setVisibleLimit((current) => current + KEYWORD_SEARCH_LIMIT)
      return
    }
    const requestId = requestIdRef.current
    setLoadingMore(true)
    setLoadMoreError('')
    try {
      const page = await fetchKeywordOfferSearch(submittedQuery, KEYWORD_SEARCH_LIMIT, cached.summary.nextOffset, cached.summary.resultSetToken, { retailers: activeRetailerKeys })
      if (requestId !== requestIdRef.current) return
      if (page.summary.resultSetToken !== cached.summary.resultSetToken || page.summary.totalCount !== cached.summary.totalCount) throw new Error('Result set changed')
      const merged = mergePaginatedRankingResults(cached, page)
      cacheRef.current.set(scopeKey, merged)
      setRanking(merged)
      setVisibleLimit((current) => current + KEYWORD_SEARCH_LIMIT)
    } catch {
      if (requestId === requestIdRef.current) setLoadMoreError('Weitere Angebote konnten nicht geladen werden. Die bisherigen Treffer bleiben erhalten.')
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
        <form className="keyword-search-form" onSubmit={handleSubmit}>
          <div className="search-entry-guidance">
            <span>Suche ein Produkt – oder starte mit den Top Deals.</span>
            {' '}
            <a
              href="/top-deals"
              onClick={(event) => {
                event.preventDefault()
                onNavigate?.('top-deals')
              }}
            >
              Top Deals heute ansehen
            </a>
          </div>
          <div className="keyword-search-form__row">
            <div
              className="keyword-search-form__input-wrap"
              style={{ position: 'relative', flex: '1 1 18rem', minWidth: 0 }}
            >
              <input
                id="keyword-search-input"
                ref={searchInputRef}
                type="search"
                value={queryInput}
                placeholder="Womit willst du heute sparen?"
                aria-label="Suchbegriff für Angebote"
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
              Los
            </button>
          </div>
          <div className="keyword-search-examples" aria-label="Beispiel-Suchen">
            <span>Beispiele:</span>
            {EXAMPLE_SEARCH_TERMS.map((term) => (
              <button type="button" key={term} onClick={() => handleExampleSearch(term)}>
                {term}
              </button>
            ))}
          </div>
        </form>

        <SparTrustNotice retailers={availableRetailers} />

        <div className="keyword-search-controls">
          <div className="keyword-search-filter-intro">
            <p className="eyebrow">Filter und Sortierung</p>
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
              const limitedCoverage = isLimitedCoverageRetailer(retailer)
              const freshnessWarning = hasFreshnessWarning(retailer)
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
                    aria-label={`${retailer.label} ${selected ? 'ausgewählt' : 'auswählen'}`}
                    onClick={() => handleToggleRetailer(retailer.key)}
                  >
                    <span className="retailer-chip__dot" aria-hidden="true" />
                    <span className="retailer-chip__label">{retailer.label}</span>
                    {limitedCoverage ? (
                      <span className="retailer-chip__coverage">Eingeschr&auml;nkt</span>
                    ) : null}
                    {freshnessWarning ? (
                      <span className="retailer-chip__coverage">Aktualit&auml;t</span>
                    ) : null}
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
        {publicTrustNotices.map((notice) => (
          <div className="limited-coverage-notice" role="note" key={notice.retailerKey}>
            <strong>Abdeckung eingeschr&auml;nkt</strong>
            <span>{notice.message}</span>
          </div>
        ))}
        {freshnessNotices.map((notice) => (
          <div className="limited-coverage-notice limited-coverage-notice--freshness" role="note" key={notice.retailerKey}>
            <strong>Aktualit&auml;t eingeschr&auml;nkt &middot; letzter best&auml;tigter Stand {notice.lastConfirmedDate}</strong>
            <span>HOFER-Angebote bleiben sichtbar, bitte Preise und Verf&uuml;gbarkeit im Markt pr&uuml;fen.</span>
          </div>
        ))}
      </section>

      {showResultsPanel ? (
        <section className="panel keyword-search-results" aria-busy={loading || loadingMore || sortPending ? 'true' : 'false'}>
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
        {sortPending && !loadMoreError ? <p className="keyword-search-sort-progress" role="status" aria-live="polite">Globale Sortierung wird vorbereitet: {sortProgress} von {ranking?.summary?.totalCount} Treffern geladen. Bisherige Reihenfolge bleibt bis zum Abschluss sichtbar.</p> : null}
        {loadMoreError ? <div className="status status--error" role="alert"><p>{loadMoreError}</p><button type="button" className="secondary-action-button" onClick={sortPending ? () => setRetryNonce((n) => n + 1) : handleLoadMoreOffers}>Fehlgeschlagene Seite erneut laden</button></div> : null}
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
                {appliedSortMode === SORT_OPTIONS.savings
                  ? `${visibleOffers.length} Angebote mit belastbarer Ersparnis angezeigt`
                  : pagination.totalCount && pagination.totalCount > visibleOffers.length
                  ? `${visibleOffers.length} von ${pagination.totalCount} Angeboten angezeigt`
                  : `${visibleOffers.length} Angebote gefunden`}
              </p>
            </div>
            <p className="market-check-note">Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.</p>
            {appliedSortMode === SORT_OPTIONS.savings ? <p className="market-check-note">Ersparnis pro Angebot absteigend, getrennt nach Vergleichseinheit.</p> : null}

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
                      disabled={loadingMore || sortPending}
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
                <h3>Dazu finden wir gerade kein sicheres Angebot.</h3>
                <p>
                  Versuche es mit einem allgemeineren Begriff, einer Marke oder einer Produktgruppe. Wir zeigen lieber weniger
                  Treffer als unsichere Angebote.
                </p>
                <div className="empty-state__suggestions" aria-label="Alternative Suchvorschläge">
                  {emptySearchSuggestions.map((term) => (
                    <button type="button" key={term} onClick={() => handleExampleSearch(term)}>
                      {term}
                    </button>
                  ))}
                </div>
                <button type="button" className="primary-action-button" onClick={handleEditSearch}>
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
