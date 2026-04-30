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
import { ShoppingListPage } from './components/shopping/ShoppingListPage'
import { CookiesPage, ImpressumPage, LiabilityPage, PrivacyPage } from './components/legal/LegalPages'
import { DiagnosticsPage } from './components/admin/DiagnosticsPage'
import { QualityPage } from './components/admin/QualityPage'
import { fetchFilterCategories, fetchFilterRetailers, fetchOfferRankingDirect } from './utils/apiBase'
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
import { buildShoppingListItem, loadStoredShoppingList } from './utils/shoppingList'
import { getInitialPageFromPathname, getPathForPage, updateSeoMetadata } from './utils/seo'

function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : ''
  const initialPage = getInitialPageFromPathname(pathname)

  const [activePage, setActivePage] = useState(initialPage)
  const [shoppingListItems, setShoppingListItems] = useState(() => loadStoredShoppingList())
  const [snapshot, setSnapshot] = useState(null)
  const [health, setHealth] = useState(null)
  const [essence, setEssence] = useState('')
  const [qualitySnapshot, setQualitySnapshot] = useState(null)
  const [analyticsSummary, setAnalyticsSummary] = useState(null)
  const [ranking, setRanking] = useState(null)
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
        setError(filterError.message || 'Filterdaten konnten nicht geladen werden.')
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
        setError(loadError.message || 'Dashboard-Daten konnten nicht geladen werden.')
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
        setError(loadError.message || 'Quality-Snapshot konnte nicht geladen werden.')
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
        setError(filterError.message || 'Filterdaten konnten nicht geladen werden.')
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
        setError(rankingError.message || 'Ranking-Daten konnten nicht geladen werden.')
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
      setError(analyticsError.message || 'Analytics-KPI konnten nicht geladen werden.')
    } finally {
      setAnalyticsLoading(false)
    }
  }

  function handleNavigate(nextPage) {
    setActivePage(nextPage)

    if (typeof window === 'undefined') {
      return
    }

    window.history.replaceState({}, '', getPathForPage(nextPage))
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
      setError(feedbackError.message || 'Feedback konnte nicht gespeichert werden.')
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
      setError(saveError.message || 'Subkategorie-Korrektur konnte nicht gespeichert werden.')
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
      setError(saveError.message || 'Artikel-Korrektur konnte nicht gespeichert werden.')
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
      setError(saveError.message || 'Artikel konnte nicht gelöscht werden.')
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
            className={`page-nav__button${activePage === 'search' ? ' page-nav__button--active' : ''}`}
            onClick={() => handleNavigate('search')}
          >
            Angebote
          </button>

          <button
            className={`page-nav__button${activePage === 'shopping-list' ? ' page-nav__button--active' : ''}`}
            onClick={() => handleNavigate('shopping-list')}
          >
            Einkaufsliste
            {shoppingListItems.length > 0 ? <span className="page-nav__count">{shoppingListItems.length}</span> : null}
          </button>
        </div>
      </nav>

      {activePage === 'search' ? (
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
      ) : activePage === 'shopping-list' ? (
        <ShoppingListPage
          shoppingListItems={shoppingListItems}
          onRemoveItem={handleRemoveShoppingListItem}
          onClearList={handleClearShoppingList}
          onGoToOffers={() => handleNavigate('search')}
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
