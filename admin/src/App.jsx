import { useEffect, useMemo, useState } from 'react'
import './index.css'
import {
  fetchAnalyticsSummary,
  fetchDashboardSnapshot,
  fetchEssence,
  fetchHealth,
  fetchQualitySnapshot,
  ignoreArticleQualityItem,
  saveArticleSubcategoryOverride,
  saveFeedback,
  saveSubcategoryCategoryOverride,
} from './api'
import { SHOPPING_LIST_STORAGE_KEY } from './config/constants'
import { CookieStorageNotice } from './components/layout/CookieStorageNotice'
import { StickyBottomLine } from './components/layout/StickyBottomLine'
import { SearchPage } from './components/search/SearchPage'
import { KeywordSearchPage } from './components/search/KeywordSearchPage'
import { ShoppingListPage } from './components/shopping/ShoppingListPage'
import { SharedShoppingListPage } from './components/shopping/SharedShoppingListPage'
import { CookiesPage, ImpressumPage, LiabilityPage, PrivacyPage } from './components/legal/LegalPages'
import { DiagnosticsPage } from './components/admin/DiagnosticsPage'
import { QualityPage } from './components/admin/QualityPage'
import { buildTrackedApkDownloadUrl, fetchFilterCategories, fetchFilterRetailers, fetchOfferRankingDirect } from './utils/apiBase'
import { trackAnalyticsEvent } from './utils/analytics'
import {
  buildMainSelectionToken,
  buildSelectedCategoryQueryLabels,
  buildSubSelectionToken,
  getGroupSelectionState,
  normalizeCategoryDocuments,
  pruneSelectionTokens,
} from './utils/categories'
import { areStringSetsEqual, flattenRankingOffers } from './utils/offers'
import { buildShoppingListItem, getShoppingListItemId, loadStoredShoppingList } from './utils/shoppingList'
import { getInitialPageFromPathname, getPathForPage, getSharedListIdFromPathname, updateSeoMetadata } from './utils/seo'

function getFriendlyErrorMessage(error, fallback) {
  const message = String(error?.message || '')

  if (/failed to fetch|network|request|response|api|backend|status code|timeout|load failed/i.test(message)) {
    return 'Die Angebote konnten gerade nicht geladen werden. Bitte versuche es später erneut.'
  }

  return message || fallback
}

function SearchStartExtras({ onNavigate }) {
  const trackedDownloadUrl = buildTrackedApkDownloadUrl('web_start_button')
  const trackedQrDownloadUrl = buildTrackedApkDownloadUrl('web_start_qr')
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodeURIComponent(trackedQrDownloadUrl)}`

  return (
    <>
      <section className="panel" style={{ display: 'grid', gap: '0.9rem', marginTop: '1rem', padding: '1rem' }}>
        <div className="hero-benefit-grid">
          {[
            ['Ohne Konto', 'Direkt suchen und Angebote merken.'],
            ['Angebote merken', 'Interessante Treffer landen auf deiner Einkaufsliste.'],
            ['Liste teilen', 'Teile deine Einkaufsliste mit einem Link.'],
            ['Am Handy praktisch', 'Nutze deine Liste direkt beim Einkaufen.'],
          ].map(([title, text]) => (
            <div key={title} className="hero-benefit-card">
              <strong>{title}</strong>
              <span>{text}</span>
            </div>
          ))}
        </div>
      </section>

      <section
        className="panel"
        style={{
          alignItems: 'center',
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
          marginTop: '1rem',
          padding: '1rem',
        }}
      >
        <div style={{ display: 'grid', gap: '0.55rem' }}>
          <p className="eyebrow" style={{ margin: 0 }}>
            Einkauf am Smartphone
          </p>
          <h2 style={{ margin: 0 }}>Am Handy ist kaufklug am praktischsten.</h2>
          <p className="subtitle" style={{ margin: 0, maxWidth: '42rem' }}>
            Scanne den QR-Code und nutze deine Einkaufsliste direkt beim Einkaufen.
          </p>
          <p style={{ color: '#5c6658', margin: 0 }}>
            Die Websuche funktioniert auch hier. Für den Einkauf im Geschäft ist die App bequemer.
          </p>
          <a
            href={trackedDownloadUrl}
            target="_blank"
            rel="noreferrer"
            className="primary-action-button"
            style={{
              alignItems: 'center',
              display: 'inline-flex',
              justifyContent: 'center',
              maxWidth: '17rem',
              textDecoration: 'none',
            }}
          >
            Android-Testversion laden
          </a>
        </div>

        <div className="app-download-modal__qr" style={{ justifySelf: 'center', margin: 0, width: 'min(42vw, 220px)' }}>
          <img
            src={qrUrl}
            alt="QR-Code zum Laden der kaufklug.at Android-Testversion"
            width="220"
            height="220"
            loading="lazy"
          />
        </div>
      </section>

      <section
        className="panel"
        style={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.85rem',
          justifyContent: 'space-between',
          marginTop: '1rem',
          padding: '1rem',
        }}
      >
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>
            Stöbern
          </p>
          <h2 style={{ margin: '0.15rem 0 0' }}>Du möchtest lieber nach Märkten stöbern?</h2>
        </div>
        <button type="button" className="primary-action-button" onClick={() => onNavigate('search')}>
          Zu Stöbern
        </button>
      </section>
    </>
  )
}

function App() {
  const rawPathname = typeof window !== 'undefined' ? window.location.pathname : ''
  const pathname = rawPathname.toLowerCase()
  const routedInitialPage = getInitialPageFromPathname(pathname)
  const initialPage = routedInitialPage === 'search' ? 'product-search' : routedInitialPage
  const initialSharedListId = getSharedListIdFromPathname(rawPathname)

  const [activePage, setActivePage] = useState(initialPage)
  const [sharedListId, setSharedListId] = useState(initialSharedListId)
  const [shoppingListItems, setShoppingListItems] = useState(() => loadStoredShoppingList())
  const [snapshot, setSnapshot] = useState(null)
  const [health, setHealth] = useState(null)
  const [essence, setEssence] = useState('')
  const [qualitySnapshot, setQualitySnapshot] = useState(null)
  const [analyticsSummary, setAnalyticsSummary] = useState(null)
  const [ranking, setRanking] = useState(null)
  const [navSearchQuery, setNavSearchQuery] = useState('')
  const [keywordSearchRequest, setKeywordSearchRequest] = useState({ query: '', nonce: 0 })
  const [retailers, setRetailers] = useState([])
  const [categories, setCategories] = useState([])
  const [error, setError] = useState('')
  const [feedbackState, setFeedbackState] = useState('idle')
  const [feedbackNote, setFeedbackNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [filtersLoading, setFiltersLoading] = useState(true)
  const [rankingLoading, setRankingLoading] = useState(false)
  const [qualityLoading, setQualityLoading] = useState(false)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [qualitySavingKey, setQualitySavingKey] = useState('')
  const [qualityFilters, setQualityFilters] = useState({
    query: '',
    retailerKey: '',
    categoryPrimary: '',
    limit: 100,
  })
  const [draftSelectedRetailers, setDraftSelectedRetailers] = useState([])
  const [draftSelectedCategoryLabels, setDraftSelectedCategoryLabels] = useState([])
  const [appliedSelectedRetailers, setAppliedSelectedRetailers] = useState([])
  const [appliedSelectedCategoryLabels, setAppliedSelectedCategoryLabels] = useState([])

  const shoppingListIds = useMemo(
    () => new Set(shoppingListItems.map((item) => item.id)),
    [shoppingListItems]
  )

  const appliedCategoryQueryLabels = useMemo(
    () => buildSelectedCategoryQueryLabels(appliedSelectedCategoryLabels, categories),
    [appliedSelectedCategoryLabels, categories]
  )

  useEffect(() => {
    updateSeoMetadata(activePage)
  }, [activePage])

  useEffect(() => {
    if (activePage === 'quality' || activePage === 'diagnostics') return

    if (activePage === 'search') {
      trackAnalyticsEvent('landing_page_view', {
        page: 'search',
      })
      return
    }

    if (activePage === 'product-search') {
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
        setDraftSelectedRetailers([])
        setAppliedSelectedRetailers([])
        setError('')
      } catch (filterError) {
        if (!active) return
        setRetailers([])
        setDraftSelectedRetailers([])
        setAppliedSelectedRetailers([])
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
        setAnalyticsLoading(true)

        const [healthResult, snapshotResult, essenceResult, analyticsResult] = await Promise.all([
          fetchHealth(),
          fetchDashboardSnapshot(),
          fetchEssence(),
          fetchAnalyticsSummary(),
        ])

        if (!active) return

        setHealth(healthResult)
        setSnapshot(snapshotResult)
        setEssence(essenceResult)
        setAnalyticsSummary(analyticsResult)
        setError('')
      } catch (loadError) {
        if (!active) return
        setError(getFriendlyErrorMessage(loadError, 'Dashboard-Daten konnten nicht geladen werden.'))
      } finally {
        if (active) {
          setLoading(false)
          setAnalyticsLoading(false)
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
    if (activePage !== 'quality') {
      return undefined
    }

    let active = true

    async function loadQualitySnapshot() {
      try {
        setQualityLoading(true)
        const nextSnapshot = await fetchQualitySnapshot({
          q: qualityFilters.query,
          retailerKey: qualityFilters.retailerKey,
          categoryPrimary: qualityFilters.categoryPrimary,
          limit: qualityFilters.limit,
        })

        if (!active) return

        setQualitySnapshot(nextSnapshot)
        setError('')
      } catch (loadError) {
        if (!active) return
        setError(getFriendlyErrorMessage(loadError, 'Die Qualitätsansicht konnte nicht geladen werden.'))
      } finally {
        if (active) setQualityLoading(false)
      }
    }

    loadQualitySnapshot()

    return () => {
      active = false
    }
  }, [activePage, qualityFilters])

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
        setAppliedSelectedCategoryLabels((current) => pruneSelectionTokens(current, nextCategories))
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

    async function loadRanking() {
      if (!appliedSelectedRetailers.length) {
        setRanking(null)
        setRankingLoading(false)
        return
      }

      try {
        setRankingLoading(true)

        const rankingResult = await fetchOfferRankingDirect({
          categories: appliedCategoryQueryLabels.join(','),
          retailers: appliedSelectedRetailers.join(','),
          programRetailers: appliedSelectedRetailers.join(','),
          unit: 'all',
          q: '',
          limit: 'all',
        })

        if (!active) return

        const resultCount = flattenRankingOffers(rankingResult).length

        setRanking(rankingResult)
        setError('')

        trackAnalyticsEvent('offer_search_result', {
          selectedRetailerCount: appliedSelectedRetailers.length,
          selectedCategoryCount: appliedSelectedCategoryLabels.length,
          resultCount,
        })
      } catch (rankingError) {
        if (!active) return
        setRanking(null)
        setError(
          getFriendlyErrorMessage(
            rankingError,
            'Die Angebote konnten gerade nicht geladen werden. Bitte versuche es später erneut.'
          )
        )
      } finally {
        if (active) setRankingLoading(false)
      }
    }

    loadRanking()

    return () => {
      active = false
    }
  }, [appliedSelectedRetailers, appliedCategoryQueryLabels, appliedSelectedCategoryLabels.length])

  async function reloadAll() {
    const [healthResult, snapshotResult, essenceResult, analyticsResult] = await Promise.all([
      fetchHealth(),
      fetchDashboardSnapshot(),
      fetchEssence(),
      fetchAnalyticsSummary(),
    ])

    setHealth(healthResult)
    setSnapshot(snapshotResult)
    setEssence(essenceResult)
    setAnalyticsSummary(analyticsResult)
  }

  async function reloadAnalyticsSummary() {
    try {
      setAnalyticsLoading(true)
      const analyticsResult = await fetchAnalyticsSummary()
      setAnalyticsSummary(analyticsResult)
      setError('')
    } catch (analyticsError) {
      setError(getFriendlyErrorMessage(analyticsError, 'Die Kennzahlen konnten nicht geladen werden.'))
    } finally {
      setAnalyticsLoading(false)
    }
  }

  function handleNavigate(nextPage) {
    setActivePage(nextPage)
    setSharedListId('')

    if (typeof window === 'undefined') {
      return
    }

    window.history.replaceState({}, '', getPathForPage(nextPage))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleNavSearchSubmit(event) {
    event.preventDefault()

    const nextQuery = navSearchQuery.trim()
    setActivePage('product-search')
    setKeywordSearchRequest((current) => ({ query: nextQuery, nonce: current.nonce + 1 }))

    if (typeof window === 'undefined') {
      return
    }

    const nextPath = nextQuery ? `/suche?q=${encodeURIComponent(nextQuery)}` : '/suche'
    window.history.replaceState({}, '', nextPath)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleQualityFilterChange(key, value) {
    setQualityFilters((current) => ({
      ...current,
      [key]: value,
    }))
  }

  async function refreshQualitySnapshot() {
    setQualityFilters((current) => ({ ...current }))
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
    trackAnalyticsEvent('offer_search_started', {
      selectedRetailerCount: draftSelectedRetailers.length,
      selectedCategoryCount: draftSelectedCategoryLabels.length,
    })

    setAppliedSelectedRetailers([...draftSelectedRetailers])
    setAppliedSelectedCategoryLabels([...draftSelectedCategoryLabels])
  }

  function handleResetAll() {
    setDraftSelectedRetailers([])
    setDraftSelectedCategoryLabels([])
    setAppliedSelectedRetailers([])
    setAppliedSelectedCategoryLabels([])
    setRanking(null)
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

  async function handleSaveSubcategoryOverride({ item, targetCategoryPrimary, note, rowKey }) {
    try {
      setQualitySavingKey(rowKey)
      await saveSubcategoryCategoryOverride({
        matchSubcategoryLabel: item.subcategoryLabel,
        targetCategoryPrimary,
        note,
      })
      const nextSnapshot = await fetchQualitySnapshot({
        q: qualityFilters.query,
        retailerKey: qualityFilters.retailerKey,
        categoryPrimary: qualityFilters.categoryPrimary,
        limit: qualityFilters.limit,
      })
      setQualitySnapshot(nextSnapshot)
      setError('')
    } catch (saveError) {
      setError(getFriendlyErrorMessage(saveError, 'Subkategorie-Korrektur konnte nicht gespeichert werden.'))
    } finally {
      setQualitySavingKey('')
    }
  }

  async function handleSaveArticleOverride({ item, targetCategoryPrimary, targetCategorySecondary, note, rowKey }) {
    try {
      setQualitySavingKey(rowKey)
      await saveArticleSubcategoryOverride({
        retailerKey: item.retailerKey,
        titleNormalized: item.titleNormalized,
        titleDisplay: item.titleDisplay,
        targetCategoryPrimary,
        targetCategorySecondary,
        note,
      })
      const nextSnapshot = await fetchQualitySnapshot({
        q: qualityFilters.query,
        retailerKey: qualityFilters.retailerKey,
        categoryPrimary: qualityFilters.categoryPrimary,
        limit: qualityFilters.limit,
      })
      setQualitySnapshot(nextSnapshot)
      setError('')
    } catch (saveError) {
      setError(getFriendlyErrorMessage(saveError, 'Artikel-Korrektur konnte nicht gespeichert werden.'))
    } finally {
      setQualitySavingKey('')
    }
  }

  async function handleDeleteArticle({ item, note, rowKey }) {
    try {
      setQualitySavingKey(rowKey)
      await ignoreArticleQualityItem({
        retailerKey: item.retailerKey,
        titleNormalized: item.titleNormalized,
        titleDisplay: item.titleDisplay,
        note,
      })
      const nextSnapshot = await fetchQualitySnapshot({
        q: qualityFilters.query,
        retailerKey: qualityFilters.retailerKey,
        categoryPrimary: qualityFilters.categoryPrimary,
        limit: qualityFilters.limit,
      })
      setQualitySnapshot(nextSnapshot)
      setError('')
    } catch (saveError) {
      setError(getFriendlyErrorMessage(saveError, 'Artikel konnte nicht gelöscht werden.'))
    } finally {
      setQualitySavingKey('')
    }
  }

  const hasPendingChanges =
    !areStringSetsEqual(draftSelectedRetailers, appliedSelectedRetailers) ||
    !areStringSetsEqual(draftSelectedCategoryLabels, appliedSelectedCategoryLabels)

  return (
    <main className="shell" style={{ paddingBottom: '5.5rem' }}>
      <nav className="page-nav" aria-label="Seiten">
        <div className="page-nav__main">
          <button
            className={`page-nav__button${activePage === 'product-search' ? ' page-nav__button--active' : ''}`}
            onClick={() => handleNavigate('product-search')}
          >
            Suche
          </button>

          <button
            className={`page-nav__button${activePage === 'shopping-list' ? ' page-nav__button--active' : ''}`}
            onClick={() => handleNavigate('shopping-list')}
          >
            Einkaufsliste
            {shoppingListItems.length > 0 ? <span className="page-nav__count">{shoppingListItems.length}</span> : null}
          </button>

          <button
            className={`page-nav__button${activePage === 'search' ? ' page-nav__button--active' : ''}`}
            onClick={() => handleNavigate('search')}
          >
            Stöbern
          </button>
        </div>

        <form className="page-nav__search" onSubmit={handleNavSearchSubmit}>
          <input
            type="search"
            value={navSearchQuery}
            placeholder="Produkt suchen..."
            aria-label="Produkt suchen"
            onChange={(event) => setNavSearchQuery(event.target.value)}
          />
          <button type="submit" className="page-nav__search-button">
            Suchen
          </button>
        </form>
      </nav>

      {activePage === 'shared-shopping-list' ? (
        <SharedShoppingListPage
          shareId={sharedListId}
          onNavigate={handleNavigate}
          onAdoptItems={handleAdoptSharedShoppingList}
        />
      ) : activePage === 'search' ? (
        <SearchPage
          retailers={retailers}
          categories={categories}
          filtersLoading={filtersLoading}
          ranking={ranking}
          rankingLoading={rankingLoading}
          draftRetailers={draftSelectedRetailers}
          draftCategoryLabels={draftSelectedCategoryLabels}
          appliedRetailers={appliedSelectedRetailers}
          appliedCategoryLabels={appliedSelectedCategoryLabels}
          error={error}
          hasPendingChanges={hasPendingChanges}
          shoppingListIds={shoppingListIds}
          onToggleDraftRetailer={handleToggleDraftRetailer}
          onSelectAllRetailers={handleSelectAllRetailers}
          onClearRetailers={handleClearRetailers}
          onToggleDraftMainCategory={handleToggleDraftMainCategory}
          onToggleDraftSubcategory={handleToggleDraftSubcategory}
          onClearDraftCategories={handleClearDraftCategories}
          onApplySearch={handleApplySearch}
          onResetAll={handleResetAll}
          onAddToShoppingList={handleAddToShoppingList}
          onNavigate={handleNavigate}
        />
      ) : activePage === 'product-search' ? (
        <>
          <KeywordSearchPage
            searchRequest={keywordSearchRequest}
            retailers={retailers}
            shoppingListIds={shoppingListIds}
            onAddToShoppingList={handleAddToShoppingList}
          />
          <SearchStartExtras onNavigate={handleNavigate} />
        </>
      ) : activePage === 'shopping-list' ? (
        <ShoppingListPage
          shoppingListItems={shoppingListItems}
          onRemoveItem={handleRemoveShoppingListItem}
          onClearList={handleClearShoppingList}
          onGoToOffers={() => handleNavigate('product-search')}
          onNavigate={handleNavigate}
        />
      ) : activePage === 'impressum' ? (
        <ImpressumPage />
      ) : activePage === 'privacy' ? (
        <PrivacyPage />
      ) : activePage === 'liability' ? (
        <LiabilityPage />
      ) : activePage === 'cookies' ? (
        <CookiesPage />
      ) : activePage === 'quality' ? (
        <QualityPage
          snapshot={qualitySnapshot}
          loading={qualityLoading}
          error={error}
          filters={qualityFilters}
          onFilterChange={handleQualityFilterChange}
          onReload={refreshQualitySnapshot}
          onSaveSubcategoryOverride={handleSaveSubcategoryOverride}
          onSaveArticleOverride={handleSaveArticleOverride}
          onDeleteArticle={handleDeleteArticle}
          savingKey={qualitySavingKey}
        />
      ) : (
        <>
          {loading && !snapshot ? <p className="status">Lade Ansicht …</p> : null}
          {error && !snapshot ? <p className="status status--error">{error}</p> : null}
          {snapshot ? (
            <DiagnosticsPage
              health={health}
              snapshot={snapshot}
              essence={essence}
              analyticsSummary={analyticsSummary}
              analyticsLoading={analyticsLoading}
              error={error}
              feedbackState={feedbackState}
              feedbackNote={feedbackNote}
              setFeedbackNote={setFeedbackNote}
              handleSaveFeedback={handleSaveFeedback}
              onReloadAnalytics={reloadAnalyticsSummary}
            />
          ) : null}
        </>
      )}

      <CookieStorageNotice onNavigate={handleNavigate} />
      <StickyBottomLine onNavigate={handleNavigate} />
    </main>
  )
}

export default App
