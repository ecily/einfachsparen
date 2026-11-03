import { useEffect, useMemo, useRef, useState } from 'react'
import './index.css'
import { AppShell } from './components/layout/AppShell'
import { useAppNavigation } from './utils/useAppNavigation'
import { isBrowseRoutePathname, readBrowseState, browseStateUrl, searchStateUrl } from './utils/navigationState'
import {
  fetchHealth,
  saveFeedback,
} from './api'
import { SHOPPING_LIST_STORAGE_KEY } from './config/constants'
import { CookieStorageNotice } from './components/layout/CookieStorageNotice'
import { PriceCheckPage } from './components/search/PriceCheckPage'
import { SeoFooterLinks } from './components/layout/SeoFooterLinks'
import { StickyBottomLine } from './components/layout/StickyBottomLine'
import { SearchPage } from './components/search/SearchPage'
import { KeywordSearchPage } from './components/search/KeywordSearchPage'
import { TopDealsPage } from './components/search/TopDealsPage'
import { SeoOfferLandingPage } from './components/search/SeoOfferLandingPage'
import { ShoppingAssistant } from './components/shopping/ShoppingAssistant'
import { assignWishOffer } from './utils/shoppingAssistant'
import { SharedShoppingListPage } from './components/shopping/SharedShoppingListPage'
import { FeedbackPage } from './components/feedback/FeedbackPage'
import { CookiesPage, ImpressumPage, LiabilityPage, PrivacyPage } from './components/legal/LegalPages'
import { TrustPage } from './components/trust/TrustPage'
import { DiagnosticsPage } from './components/admin/DiagnosticsPage'
import {
  fetchAdminJson,
  fetchFilterCategories,
  fetchFilterRetailers,
  fetchOfferRankingDirect,
  prefetchTopDeals,
} from './utils/apiBase'
import { configureInternalTesterModeFromUrl, trackAnalyticsEvent } from './utils/analytics'
import {
  buildAllCategorySelectionTokens,
  buildMainSelectionToken,
  buildSelectedCategoryQueryLabels,
  buildSubSelectionToken,
  getGroupSelectionState,
  normalizeCategoryDocuments,
  pruneSelectionTokens,
} from './utils/categories'
import { areStringSetsEqual, flattenRankingOffers, getRankingPagination, mergePaginatedRankingResults } from './utils/offers'
import { buildShoppingListItem, getShoppingListItemId, loadStoredShoppingList } from './utils/shoppingList'
import { getSharedListIdFromPathname, updateSeoMetadata } from './utils/seo'
import { getSeoLandingPageByRouteId, SEO_LANDING_PAGE_PREFIX } from './config/seoLandingPages'
import { HomeLanding } from './components/search/HomeLanding'

const BETA_INFO_TITLE = 'Warum Beta-Test?'
const BETA_INFO_TEXT =
  'kaufklug lernt gerade, Angebote noch zuverlässiger zu zeigen. Wenn dir ein falscher Preis, eine fehlende Bedingung, ein falsches Bild oder eine falsche Kategorie auffällt, melde es direkt beim Angebot. So können wir die Datenqualität gezielt verbessern.'
const BETA_INFO_CLOSING = 'Danke für deine Hilfe.'

function getFriendlyErrorMessage(error, fallback) {
  const status = Number(error?.status || 0)
  const message = String(error?.message || '')

  if (status === 401 || /admin-zugriff|admin-key|nicht autorisiert|unauthorized/i.test(message)) {
    return message || 'Admin-Zugriff erforderlich. Bitte Admin-Key prüfen.'
  }

  if (/failed to fetch|network|request|response|api|backend|status code|timeout|load failed/i.test(message)) {
    return 'Die Angebote konnten gerade nicht geladen werden. Bitte versuche es später erneut.'
  }

  return message || fallback
}

async function fetchAdminDashboardSnapshot() {
  return fetchAdminJson('/dashboard/snapshot')
}

async function fetchAdminEssence() {
  const payload = await fetchAdminJson('/essence')

  if (typeof payload === 'string') {
    return payload
  }

  return payload?.essence || payload?.digest || payload?.text || payload?.summary || ''
}

function BetaInfoPanel({ id, onClose, className = '' }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div id={id} className={`beta-info-panel ${className}`.trim()} role="region" aria-labelledby={`${id}-title`}>
      <div>
        <strong id={`${id}-title`}>{BETA_INFO_TITLE}</strong>
        <p>{BETA_INFO_TEXT}</p>
        <p>{BETA_INFO_CLOSING}</p>
      </div>
      <button type="button" className="beta-info-panel__close" onClick={onClose} aria-label="Beta-Erklärung schließen">
        Schließen
      </button>
    </div>
  )
}

function App() {
  const { route, page: activePage, navigateUrl, hrefFor } = useAppNavigation()
  const rawPathname = new URL(route.url, window.location.origin).pathname
  const isBrowseRoute = isBrowseRoutePathname(rawPathname)
  const initialBrowse = readBrowseState(isBrowseRoute ? window.location.search : '')
  const pathname = rawPathname.toLowerCase()
  const isLegacyQualityPath = pathname === '/quality'
  const sharedListId = getSharedListIdFromPathname(rawPathname)
  const rankingRequestIdRef = useRef(0)
  const keywordDrafts = useRef(new Map())
  const headerBetaRef = useRef(null)

  const [shoppingListItems, setShoppingListItems] = useState(() => loadStoredShoppingList())
  const [snapshot, setSnapshot] = useState(null)
  const [health, setHealth] = useState(null)
  const [essence, setEssence] = useState('')
  const [ranking, setRanking] = useState(null)
  const [navSearchQuery, setNavSearchQuery] = useState('')
  const [retailers, setRetailers] = useState([])
  const [categories, setCategories] = useState([])
  const [error, setError] = useState('')
  const [feedbackState, setFeedbackState] = useState('idle')
  const [feedbackNote, setFeedbackNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [filtersLoading, setFiltersLoading] = useState(true)
  const [rankingLoading, setRankingLoading] = useState(false)
  const [rankingLoadingMore, setRankingLoadingMore] = useState(false)
  const [browseAutoRefreshEnabled, setBrowseAutoRefreshEnabled] = useState(false)
  const [isHeaderBetaInfoOpen, setIsHeaderBetaInfoOpen] = useState(false)
  const [draftSelectedRetailers, setDraftSelectedRetailers] = useState(initialBrowse.draftRetailers)
  const [draftSelectedCategoryLabels, setDraftSelectedCategoryLabels] = useState(initialBrowse.draftCategories)
  const [appliedSelectedRetailers, setAppliedSelectedRetailers] = useState(initialBrowse.appliedRetailers)
  const [appliedSelectedCategoryLabels, setAppliedSelectedCategoryLabels] = useState(initialBrowse.appliedCategories)

  const browseRestoreRef = useRef(route.restoreKey)
  const [appliedCategories, setAppliedCategories] = useState({ scope: '', items: [], status: 'loading' })
  const appliedRetailerScope = appliedSelectedRetailers.join(',')
  const appliedCategoryMetadataReady = !appliedSelectedCategoryLabels.length ||
    (appliedCategories.scope === appliedRetailerScope && appliedCategories.status === 'ready')
  const appliedCategoryMetadataFailed = appliedSelectedCategoryLabels.length > 0 &&
    appliedCategories.scope === appliedRetailerScope && appliedCategories.status === 'error'

  useEffect(() => {
    setIsHeaderBetaInfoOpen(false)
    if (activePage !== 'search' || !isBrowseRoute) return
    const state = readBrowseState(new URL(route.url, window.location.origin).search)
    setDraftSelectedRetailers(state.draftRetailers)
    setDraftSelectedCategoryLabels(state.draftCategories)
    setAppliedSelectedRetailers(state.appliedRetailers)
    setAppliedSelectedCategoryLabels(state.appliedCategories)
    setBrowseAutoRefreshEnabled(false)
    // Restore only on navigation/Back/Forward, not on our own URL writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, isBrowseRoute, route.restoreKey])

  useEffect(() => {
    if (browseRestoreRef.current !== route.restoreKey) {
      browseRestoreRef.current = route.restoreKey
      return
    }
    if (activePage !== 'search' || !isBrowseRoute) return
    navigateUrl(browseStateUrl({
      draftRetailers: draftSelectedRetailers,
      draftCategories: draftSelectedCategoryLabels,
      appliedRetailers: appliedSelectedRetailers,
      appliedCategories: appliedSelectedCategoryLabels,
    }), { replace: true, focus: false, restore: false })
  }, [activePage, isBrowseRoute, route.restoreKey, draftSelectedRetailers, draftSelectedCategoryLabels,
    appliedSelectedRetailers, appliedSelectedCategoryLabels, navigateUrl])

  useEffect(() => {
    if (!appliedSelectedRetailers.length) return undefined
    let active = true
    fetchFilterCategories(appliedSelectedRetailers).then(result => {
      if (active) setAppliedCategories({ scope: appliedRetailerScope, items: normalizeCategoryDocuments(result), status: 'ready' })
    }).catch(() => {
      if (!active) return
      setAppliedCategories({ scope: appliedRetailerScope, items: [], status: 'error' })
    })
    return () => { active = false }
  }, [appliedSelectedRetailers, appliedRetailerScope])

  const shoppingListIds = useMemo(
    () => new Set(shoppingListItems.map((item) => item.id)),
    [shoppingListItems]
  )

  const appliedCategoryQuery = useMemo(
    () => buildSelectedCategoryQueryLabels(appliedSelectedCategoryLabels, appliedCategories.items).join(','),
    [appliedSelectedCategoryLabels, appliedCategories.items]
  )

  useEffect(() => {
    updateSeoMetadata(activePage)
  }, [activePage, pathname])

  useEffect(() => {
    configureInternalTesterModeFromUrl()
  }, [])

  useEffect(() => {
    if (activePage !== 'product-search' || typeof window === 'undefined') return undefined

    const runPrefetch = () => {
      prefetchTopDeals()
    }
    const idleHandle = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(runPrefetch, { timeout: 2500 })
      : window.setTimeout(runPrefetch, 1200)

    return () => {
      if (typeof window.cancelIdleCallback === 'function' && typeof idleHandle === 'number') {
        window.cancelIdleCallback(idleHandle)
      } else {
        window.clearTimeout(idleHandle)
      }
    }
  }, [activePage])

  useEffect(() => {
    if (activePage === 'diagnostics') return

    if (activePage === 'search') {
      trackAnalyticsEvent('landing_page_view', {
        page: 'search',
      })
      return
    }

    if (activePage === 'product-search') {
      return
    }

    if (activePage.startsWith(SEO_LANDING_PAGE_PREFIX)) {
      trackAnalyticsEvent('landing_page_view', {
        page: activePage,
      })
      return
    }

    if (activePage === 'shopping-list') {
      trackAnalyticsEvent('shopping_list_opened', {
        itemCount: shoppingListItems.length,
      })
      return
    }

    trackAnalyticsEvent('legal_page_opened', {
      page: activePage,
    })
  }, [activePage, shoppingListItems.length])

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      window.localStorage.setItem(SHOPPING_LIST_STORAGE_KEY, JSON.stringify(shoppingListItems))
    } catch {
      // localStorage kann im Browser blockiert sein. Die App bleibt trotzdem nutzbar.
    }
  }, [shoppingListItems])

  useEffect(() => {
    let active = true

    async function loadFilterMetadata() {
      try {
        setFiltersLoading(true)
        const retailerResult = await fetchFilterRetailers()

        if (!active) return

        setRetailers(retailerResult)
        setError('')
      } catch (filterError) {
        if (!active) return
        setRetailers([])
        setError(getFriendlyErrorMessage(filterError, 'Filterdaten konnten nicht geladen werden.'))
      } finally {
        if (active) setFiltersLoading(false)
      }
    }

    loadFilterMetadata()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (activePage !== 'diagnostics') {
      return undefined
    }

    let active = true

    async function loadDiagnostics() {
      try {
        setLoading(true)

        const [healthResult, snapshotResult, essenceResult] = await Promise.all([
          fetchHealth(),
          fetchAdminDashboardSnapshot(),
          fetchAdminEssence(),
        ])

        if (!active) return

        setHealth(healthResult)
        setSnapshot(snapshotResult)
        setEssence(essenceResult)
        setError('')
      } catch (loadError) {
        if (!active) return

        try {
          const healthResult = await fetchHealth()
          if (active) setHealth(healthResult)
        } catch {
          if (active) setHealth(null)
        }

        setError(getFriendlyErrorMessage(loadError, 'Dashboard-Daten konnten nicht geladen werden.'))
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadDiagnostics()
    const interval = setInterval(loadDiagnostics, 20000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [activePage])

  useEffect(() => {
    let active = true

    async function loadScopedCategories() {
      try {
        setFiltersLoading(true)
        const categoryResult = await fetchFilterCategories(draftSelectedRetailers)

        if (!active) return

        const nextCategories = normalizeCategoryDocuments(categoryResult)
        setCategories(nextCategories)
        setDraftSelectedCategoryLabels((current) => pruneSelectionTokens(current, nextCategories))
        setError('')
      } catch (filterError) {
        if (!active) return
        setCategories([])
        setError(getFriendlyErrorMessage(filterError, 'Filterdaten konnten nicht geladen werden.'))
      } finally {
        if (active) setFiltersLoading(false)
      }
    }

    loadScopedCategories()

    return () => {
      active = false
    }
  }, [draftSelectedRetailers])

  useEffect(() => {
    let active = true
    const requestId = rankingRequestIdRef.current + 1
    rankingRequestIdRef.current = requestId

    async function loadRanking() {
      if (!appliedSelectedRetailers.length) {
        setRanking(null)
        setRankingLoading(false)
        setRankingLoadingMore(false)
        return
      }
      if (!appliedCategoryMetadataReady) {
        setRankingLoading(!appliedCategoryMetadataFailed)
        return
      }

      try {
        setRankingLoading(true)
        setRankingLoadingMore(false)

        const rankingResult = await fetchOfferRankingDirect({
          categories: appliedCategoryQuery,
          retailers: appliedSelectedRetailers.join(','),
          programRetailers: appliedSelectedRetailers.join(','),
          unit: 'all',
          q: '',
          limit: 60,
          offset: 0,
        })

        if (!active || requestId !== rankingRequestIdRef.current) return

        const resultCount = flattenRankingOffers(rankingResult).length

        setRanking(rankingResult)
        setError('')

        trackAnalyticsEvent('offer_search_result', {
          selectedRetailerCount: appliedSelectedRetailers.length,
          selectedCategoryCount: appliedSelectedCategoryLabels.length,
          resultCount,
        })
      } catch (rankingError) {
        if (!active || requestId !== rankingRequestIdRef.current) return
        setRanking(null)
        setError(
          getFriendlyErrorMessage(
            rankingError,
            'Die Angebote konnten gerade nicht geladen werden. Bitte versuche es später erneut.'
          )
        )
      } finally {
        if (active && requestId === rankingRequestIdRef.current) setRankingLoading(false)
      }
    }

    loadRanking()

    return () => {
      active = false
    }
  }, [appliedSelectedRetailers, appliedCategoryQuery, appliedSelectedCategoryLabels.length, appliedCategoryMetadataReady, appliedCategoryMetadataFailed])

  async function reloadAll() {
    const [healthResult, snapshotResult, essenceResult] = await Promise.all([
      fetchHealth(),
      fetchAdminDashboardSnapshot(),
      fetchAdminEssence(),
    ])

    setHealth(healthResult)
    setSnapshot(snapshotResult)
    setEssence(essenceResult)
    setError('')
  }

  function handleNavigate(nextPage) {
    setIsHeaderBetaInfoOpen(false)
    navigateUrl(hrefFor(nextPage))
  }

  function handleLinkNavigate(url) {
    setIsHeaderBetaInfoOpen(false)
    navigateUrl(url)
  }

  function handleCloseBeta() {
    setIsHeaderBetaInfoOpen(false)
    headerBetaRef.current?.focus()
  }

  function handleNavSearchSubmit(event) {
    event.preventDefault()
    setIsHeaderBetaInfoOpen(false)
    navigateUrl(searchStateUrl({ query: navSearchQuery, marketFilterEnabled: false, selectedRetailerKeys: [], sortMode: 'best' }))
  }

  function handleToggleDraftRetailer(retailerKey) {
    setDraftSelectedRetailers((current) => {
      const nextRetailers = current.includes(retailerKey)
        ? current.filter((item) => item !== retailerKey)
        : [...current, retailerKey]

      return nextRetailers
    })
  }

  function handleSelectAllRetailers() {
    setDraftSelectedRetailers((retailers || []).map((retailer) => retailer.retailerKey).filter(Boolean))
  }

  function handleClearRetailers() {
    setDraftSelectedRetailers([])
    setDraftSelectedCategoryLabels([])
  }

  function handleSelectAllDraftCategories() {
    setDraftSelectedCategoryLabels(buildAllCategorySelectionTokens(categories))
  }

  function handleClearDraftCategories() {
    setDraftSelectedCategoryLabels([])
  }

  function handleToggleDraftMainCategory(group) {
    const mainToken = buildMainSelectionToken(group.mainCategoryKey)
    const subcategoryTokens = (group.subcategories || []).map((item) => buildSubSelectionToken(group.mainCategoryKey, item.subcategoryKey))

    setDraftSelectedCategoryLabels((current) => {
      const selectionState = getGroupSelectionState(group, current)
      const next = current.filter((token) => token !== mainToken && !subcategoryTokens.includes(token))

      if (selectionState.mainSelected) {
        return next
      }

      if (subcategoryTokens.length > 0) {
        return [...next, ...subcategoryTokens]
      }

      return [...next, mainToken]
    })
  }

  function handleToggleDraftSubcategory(group, subcategory) {
    const mainToken = buildMainSelectionToken(group.mainCategoryKey)
    const subToken = buildSubSelectionToken(group.mainCategoryKey, subcategory.subcategoryKey)

    setDraftSelectedCategoryLabels((current) => {
      const withoutMain = current.filter((token) => token !== mainToken)

      if (withoutMain.includes(subToken)) {
        return withoutMain.filter((token) => token !== subToken)
      }

      return [...withoutMain, subToken]
    })
  }

  function handleApplySearch() {
    setBrowseAutoRefreshEnabled(true)
    navigateUrl(browseStateUrl({ draftRetailers: draftSelectedRetailers, draftCategories: draftSelectedCategoryLabels,
      appliedRetailers: draftSelectedRetailers, appliedCategories: draftSelectedCategoryLabels }), { focus: false, restore: false })
    trackAnalyticsEvent('offer_search_started', {
      selectedRetailerCount: draftSelectedRetailers.length,
      selectedCategoryCount: draftSelectedCategoryLabels.length,
    })

    setAppliedSelectedRetailers([...draftSelectedRetailers])
    setAppliedSelectedCategoryLabels([...draftSelectedCategoryLabels])
  }

  async function handleLoadMoreBrowseOffers() {
    const pagination = getRankingPagination(ranking)

    if (
      rankingLoading ||
      rankingLoadingMore ||
      !pagination.hasMore ||
      pagination.nextOffset === null ||
      !appliedSelectedRetailers.length
    ) {
      return
    }

    const requestId = rankingRequestIdRef.current + 1
    rankingRequestIdRef.current = requestId

    try {
      setRankingLoadingMore(true)
      setError('')

      const nextRanking = await fetchOfferRankingDirect({
        categories: appliedCategoryQuery,
        retailers: appliedSelectedRetailers.join(','),
        programRetailers: appliedSelectedRetailers.join(','),
        unit: 'all',
        q: '',
        limit: 60,
        offset: pagination.nextOffset,
        resultSetToken: ranking?.summary?.resultSetToken || '',
      })

      if (requestId !== rankingRequestIdRef.current) return

      setRanking((currentRanking) => mergePaginatedRankingResults(currentRanking, nextRanking))
    } catch (rankingError) {
      if (requestId !== rankingRequestIdRef.current) return
      setError(
        getFriendlyErrorMessage(
          rankingError,
          'Weitere Angebote konnten gerade nicht geladen werden. Bitte versuche es erneut.'
        )
      )
    } finally {
      if (requestId === rankingRequestIdRef.current) setRankingLoadingMore(false)
    }
  }

  function handleResetAll() {
    navigateUrl('/stoebern', { focus: false, restore: false })
    rankingRequestIdRef.current += 1
    setBrowseAutoRefreshEnabled(false)
    setDraftSelectedRetailers([])
    setDraftSelectedCategoryLabels([])
    setAppliedSelectedRetailers([])
    setAppliedSelectedCategoryLabels([])
    setRanking(null)
    setRankingLoadingMore(false)
  }

  function handleAddToShoppingList(offer) {
    const item = buildShoppingListItem(offer)

    setShoppingListItems((current) => {
      if (current.some((existingItem) => existingItem.id === item.id)) return current
      return [item, ...current]
    })

    trackAnalyticsEvent('offer_added_to_list', {
      retailerKey: item.retailerKey,
      hasKnownSavings: item.hasKnownSavings,
      hasConditions: item.hasConditions,
      customerProgramRequired: item.customerProgramRequired,
      isMultiBuy: item.isMultiBuy,
    })
  }

  function handleRemoveShoppingListItem(itemId) {
    setShoppingListItems((current) => current.filter((item) => item.id !== itemId))
  }

  function handleClearShoppingList() {
    setShoppingListItems([])
  }

  function handleAdoptSharedShoppingList(items) {
    setShoppingListItems((current) => {
      const existingIds = new Set(current.map(getShoppingListItemId))
      const nextItems = [...current]

      for (const item of items || []) {
        const itemId = getShoppingListItemId(item)

        if (!existingIds.has(itemId)) {
          existingIds.add(itemId)
          nextItems.unshift(item)
        }
      }

      return nextItems
    })

    handleNavigate('shopping-list')
  }

  async function handleSaveFeedback() {
    try {
      setFeedbackState('saving')
      await saveFeedback({
        note: feedbackNote,
        digest: essence,
        scope: 'crawl-review',
      })
      await reloadAll()
      setFeedbackNote('')
      setFeedbackState('done')
      setError('')
    } catch (feedbackError) {
      setFeedbackState('failed')
      setError(getFriendlyErrorMessage(feedbackError, 'Feedback konnte nicht gespeichert werden.'))
    }
  }

  const hasPendingChanges =
    !areStringSetsEqual(draftSelectedRetailers, appliedSelectedRetailers) ||
    !areStringSetsEqual(draftSelectedCategoryLabels, appliedSelectedCategoryLabels)
  const activeSeoLandingPage = getSeoLandingPageByRouteId(activePage)

  useEffect(() => {
    if (!isLegacyQualityPath || typeof window === 'undefined') return
    window.history.replaceState({}, '', '/ecily_web')
  }, [isLegacyQualityPath])

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      activePage !== 'search' ||
      !browseAutoRefreshEnabled ||
      filtersLoading ||
      !hasPendingChanges
    ) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      trackAnalyticsEvent('offer_search_started', {
        selectedRetailerCount: draftSelectedRetailers.length,
        selectedCategoryCount: draftSelectedCategoryLabels.length,
        source: 'browse_auto_refresh',
      })

      setAppliedSelectedRetailers([...draftSelectedRetailers])
      setAppliedSelectedCategoryLabels([...draftSelectedCategoryLabels])
    }, 250)

    return () => window.clearTimeout(timer)
  }, [
    activePage,
    browseAutoRefreshEnabled,
    draftSelectedCategoryLabels,
    draftSelectedRetailers,
    filtersLoading,
    hasPendingChanges,
  ])

  return (
    <AppShell onNavigateUrl={handleLinkNavigate} header={<>
      <nav className="page-nav" aria-label="Seiten">
        <a className="page-nav__logo" href="/" aria-label="Zur Startseite">
          <img src="/brand/kaufklug-logo-transparent.png" alt="" width="78" height="78" />
          <span className="page-nav__wordmark">kaufklug.at</span>
        </a>
        <button
          ref={headerBetaRef}
          className="page-nav__beta"
          type="button"
          aria-expanded={isHeaderBetaInfoOpen}
          aria-controls="beta-info-header"
          onClick={() => setIsHeaderBetaInfoOpen((current) => !current)}
        >
          Beta
        </button>
        <div className="page-nav__main">
          <a
            className={`page-nav__button${['home', 'product-search', 'search'].includes(activePage) ? ' page-nav__button--active' : ''}`}
            href={hrefFor('product-search')}
            aria-current={['home', 'product-search', 'search'].includes(activePage) ? 'page' : undefined}
          >
            Suche
          </a>

          <a
            className={`page-nav__button page-nav__top-deals${activePage === 'top-deals' ? ' page-nav__button--active' : ''}`}
            href={hrefFor('top-deals')}
            aria-current={activePage === 'top-deals' ? 'page' : undefined}
            aria-label="Top Deals heute"
          >
            <span className="page-nav__top-deals-long">Top Deals heute</span>
            <span className="page-nav__top-deals-short">Top Deals</span>
          </a>

          <a
            className={`page-nav__button${activePage === 'shopping-list' ? ' page-nav__button--active' : ''}`}
            href={hrefFor('shopping-list')}
            aria-label="Einkaufsliste"
            aria-current={activePage === 'shopping-list' ? 'page' : undefined}
          >
            Liste
            {shoppingListItems.length > 0 ? <span className="page-nav__count">{shoppingListItems.length}</span> : null}
          </a>

        </div>

        {!['home', 'product-search', 'shopping-list'].includes(activePage) ? <form className="page-nav__search" onSubmit={handleNavSearchSubmit}>
          <input
            type="search"
            value={navSearchQuery}
            placeholder="Womit willst du heute sparen?"
            aria-label="Produkt oder Marke suchen"
            onChange={(event) => setNavSearchQuery(event.target.value)}
          />
          <button type="submit" className="page-nav__search-button">
            Suchen
          </button>
        </form> : null}
      </nav>
      {isHeaderBetaInfoOpen ? (
        <BetaInfoPanel id="beta-info-header" className="beta-info-panel--header" onClose={handleCloseBeta} />
      ) : null}

      </>} footer={<>
        {activePage !== 'home' ? <SeoFooterLinks /> : null}
        <CookieStorageNotice onNavigate={handleNavigate} />
        {activePage !== 'home' ? <StickyBottomLine onNavigate={handleNavigate} /> : null}
      </>}>
      {!['home', 'shopping-list'].includes(activePage) ? <nav className="design-context-nav" aria-label="Suche und Auswahl"><a href={hrefFor('product-search')}>Produktsuche</a><a href={hrefFor('search')}>Stöbern</a><span>Ohne Konto. Deine Liste bleibt bei dir.</span></nav> : null}
      {activePage === 'home' ? (
        <HomeLanding retailers={retailers} />
      ) : activePage === 'shared-shopping-list' ? (
        <SharedShoppingListPage
          shareId={sharedListId}
          onNavigate={handleNavigate}
          onAdoptItems={handleAdoptSharedShoppingList}
        />
      ) : activePage === 'top-deals' ? (
        <TopDealsPage key={route.restoreKey}
          shoppingListIds={shoppingListIds}
          onAddToShoppingList={handleAddToShoppingList}
          onNavigate={handleNavigate}
        />
      ) : activePage === 'search' ? (
        <div className="browse-page">
          <SearchPage
            retailers={retailers}
            categories={categories}
            appliedCategories={appliedCategories.items}
            filtersLoading={filtersLoading}
            ranking={ranking}
            rankingLoading={rankingLoading}
            rankingLoadingMore={rankingLoadingMore}
            draftRetailers={draftSelectedRetailers}
            draftCategoryLabels={draftSelectedCategoryLabels}
            appliedRetailers={appliedSelectedRetailers}
            appliedCategoryLabels={appliedSelectedCategoryLabels}
            error={error || (appliedCategoryMetadataFailed ? 'Die Kategorien konnten gerade nicht geladen werden. Bitte lade die Seite erneut.' : '')}
            hasPendingChanges={hasPendingChanges}
            shoppingListIds={shoppingListIds}
            onToggleDraftRetailer={handleToggleDraftRetailer}
            onSelectAllRetailers={handleSelectAllRetailers}
            onClearRetailers={handleClearRetailers}
            onToggleDraftMainCategory={handleToggleDraftMainCategory}
            onToggleDraftSubcategory={handleToggleDraftSubcategory}
            onSelectAllDraftCategories={handleSelectAllDraftCategories}
            onClearDraftCategories={handleClearDraftCategories}
            onApplySearch={handleApplySearch}
            onLoadMoreOffers={handleLoadMoreBrowseOffers}
            onResetAll={handleResetAll}
            onAddToShoppingList={handleAddToShoppingList}
          />
        </div>
      ) : activePage === 'product-search' ? (
        <div className="search-first-page">
          <KeywordSearchPage
            key={route.restoreKey}
            onNavigateUrl={navigateUrl}
            queryDraft={route.fromHistory ? undefined : keywordDrafts.current.get(route.url)}
            onQueryDraftChange={value => keywordDrafts.current.set(route.url, value)}
            retailers={retailers}
            categories={categories}
            shoppingListIds={shoppingListIds}
            onAddToShoppingList={handleAddToShoppingList}
          />
        </div>
      ) : activePage === 'pricecheck:bier-literpreis-vergleich' ? (
        <PriceCheckPage />
      ) : activeSeoLandingPage ? (
        <SeoOfferLandingPage
          page={activeSeoLandingPage}
          categories={categories}
          shoppingListIds={shoppingListIds}
          onAddToShoppingList={handleAddToShoppingList}
        />
      ) : activePage === 'shopping-list' ? (
        <ShoppingAssistant
          shoppingListItems={shoppingListItems}
          onAddWish={(item) => setShoppingListItems(current => [item, ...current])}
          onEditWish={(id, title) => setShoppingListItems(current => current.map(item => item.id === id && item.manual ? { ...item, title } : item))}
          onAssignWish={(id, offer, quantity) => setShoppingListItems(current => assignWishOffer(current, id, offer, quantity))}
          onRemoveItem={handleRemoveShoppingListItem}
          onClearList={handleClearShoppingList}
          onGoToOffers={() => handleNavigate('product-search')}
          onNavigate={handleNavigate}
        />
      ) : activePage === 'feedback' ? (
        <FeedbackPage />
      ) : activePage === 'about' ? (
        <TrustPage />
      ) : activePage === 'impressum' ? (
        <ImpressumPage />
      ) : activePage === 'privacy' ? (
        <PrivacyPage />
      ) : activePage === 'liability' ? (
        <LiabilityPage />
      ) : activePage === 'cookies' ? (
        <CookiesPage />
      ) : (
        <>
          {loading && !snapshot ? <p className="status">Lade Ansicht …</p> : null}
          <DiagnosticsPage
            health={health}
            snapshot={snapshot}
            essence={essence}
            error={error}
            feedbackState={feedbackState}
            feedbackNote={feedbackNote}
            setFeedbackNote={setFeedbackNote}
            handleSaveFeedback={handleSaveFeedback}
            onReload={reloadAll}
            loading={loading}
          />
        </>
      )}

    </AppShell>
  )
}

export default App
