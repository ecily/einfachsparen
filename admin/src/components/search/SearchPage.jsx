import { useEffect, useMemo, useRef, useState } from 'react'
import { areAllCategoryGroupsSelected, buildSelectedCategoryQueryLabels, filterVisibleOffers } from '../../utils/categories'
import { flattenRankingOffers, getRankingPagination, splitRankingOffers } from '../../utils/offers'
import { SectionCard } from '../layout/SectionCard'
import { HeroLoaderModal } from '../layout/HeroLoaderModal'
import { RetailerSelectorBlock } from './RetailerSelectorBlock'
import { CategorySelectorBlock } from './CategorySelectorBlock'
import { ActionBlock } from './ActionBlock'
import { ResultsBlockConsumer } from './ResultsBlockConsumer'
import { SparTrustNotice } from './SparTrustNotice'

const INITIAL_FILTER_OVERLAY_MAX_MS = 1500

export function SearchPage({
  retailers,
  categories,
  filtersLoading,
  ranking,
  rankingLoading,
  rankingLoadingMore,
  draftRetailers,
  draftCategoryLabels,
  appliedRetailers,
  appliedCategoryLabels,
  error,
  hasPendingChanges,
  shoppingListIds,
  onToggleDraftRetailer,
  onSelectAllRetailers,
  onClearRetailers,
  onToggleDraftMainCategory,
  onToggleDraftSubcategory,
  onSelectAllDraftCategories,
  onClearDraftCategories,
  onApplySearch,
  onLoadMoreOffers,
  onResetAll,
  onAddToShoppingList,
}) {
  const [initialOverlayPhase, setInitialOverlayPhase] = useState(() => (filtersLoading ? 'loading' : 'ready'))
  useEffect(() => {
    if (initialOverlayPhase !== 'loading') {
      return undefined
    }

    const delay = filtersLoading ? INITIAL_FILTER_OVERLAY_MAX_MS : 0
    const timeoutId = window.setTimeout(() => {
      setInitialOverlayPhase('ready')
    }, delay)

    return () => window.clearTimeout(timeoutId)
  }, [filtersLoading, initialOverlayPhase])

  const isInitialBusy = filtersLoading && initialOverlayPhase === 'loading'
  const hasAppliedRetailerScope = appliedRetailers.length > 0
  const hasDraftSelection = draftRetailers.length > 0 || draftCategoryLabels.length > 0
  const shouldShowBrowseResults = hasAppliedRetailerScope
  const allDraftCategoriesSelected = areAllCategoryGroupsSelected(draftCategoryLabels, categories)
  const appliedCategoryQueryLabels = useMemo(
    () => buildSelectedCategoryQueryLabels(appliedCategoryLabels, categories),
    [appliedCategoryLabels, categories]
  )
  const [activeBrowseScrollKey, setActiveBrowseScrollKey] = useState(0)
  const handledBrowseScrollKeyRef = useRef(0)
  const resultsRef = useRef(null)

  const allOffers = useMemo(() => flattenRankingOffers(ranking), [ranking])
  const visibleOffers = useMemo(() => {
    return filterVisibleOffers(
      allOffers,
      {
        selectedRetailers: appliedRetailers,
        selectedCategoryTokens: appliedCategoryLabels,
      },
      retailers || [],
      categories || []
    )
  }, [allOffers, appliedRetailers, appliedCategoryLabels, retailers, categories])
  const { bestComparableOffers, actionOffers } = useMemo(() => splitRankingOffers(visibleOffers), [visibleOffers])
  const pagination = useMemo(() => getRankingPagination(ranking), [ranking])

  useEffect(() => {
    if (
      !activeBrowseScrollKey ||
      activeBrowseScrollKey <= handledBrowseScrollKeyRef.current ||
      rankingLoading ||
      !hasAppliedRetailerScope
    ) {
      return
    }

    handledBrowseScrollKeyRef.current = activeBrowseScrollKey

    resultsRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }, [activeBrowseScrollKey, rankingLoading, hasAppliedRetailerScope])

  function handleApplyBrowseSelection() {
    setActiveBrowseScrollKey((current) => current + 1)
    onApplySearch()
  }

  return (
    <>
      <HeroLoaderModal
        open={isInitialBusy}
        label="kaufklug lädt Geschäfte, Kategorien und aktuelle Angebote."
      />

      {error ? (
        <SectionCard style={{ marginBottom: '1rem' }}>
          <div className="error-box">
            <p className="status status--error">{error}</p>
          </div>
        </SectionCard>
      ) : null}

      <section className="panel browse-intro" aria-labelledby="browse-intro-title">
        <div className="browse-intro__copy">
          <p className="eyebrow">Stöbern</p>
          <h1 id="browse-intro-title">Angebote nach Markt und Kategorie entdecken</h1>
          <p className="subtitle">
            Wähle zuerst deine Märkte. Kategorien kannst du danach optional eingrenzen.
          </p>
          <p className="market-check-note">Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.</p>
        </div>
      </section>

      <SparTrustNotice retailers={retailers} />

      <RetailerSelectorBlock
        retailers={retailers}
        selectedRetailers={draftRetailers}
        onToggleRetailer={onToggleDraftRetailer}
        onSelectAllRetailers={onSelectAllRetailers}
        onClearRetailers={onClearRetailers}
        loading={filtersLoading}
      />

      <CategorySelectorBlock
        categories={categories}
        selectedCategoryTokens={draftCategoryLabels}
        onToggleMainCategory={onToggleDraftMainCategory}
        onToggleSubcategory={onToggleDraftSubcategory}
        onSelectAllCategories={onSelectAllDraftCategories}
        onClearCategories={onClearDraftCategories}
        loading={filtersLoading}
        disabled={!draftRetailers.length}
      />

      {hasDraftSelection ? (
        <ActionBlock
          canSearch={draftRetailers.length > 0}
          selectedRetailerCount={draftRetailers.length}
          selectedCategoryCount={allDraftCategoriesSelected ? 0 : draftCategoryLabels.length}
          onApplySearch={handleApplyBrowseSelection}
          onReset={onResetAll}
          hasPendingChanges={hasPendingChanges}
          searching={rankingLoading}
        />
      ) : null}

      {shouldShowBrowseResults ? (
        <div ref={resultsRef} className="browse-results-anchor">
          <ResultsBlockConsumer
            rankingLoading={rankingLoading}
            rankingLoadingMore={rankingLoadingMore}
            pagination={pagination}
            hasAppliedRetailerScope={hasAppliedRetailerScope}
            safeOffers={bestComparableOffers}
            actionOffers={actionOffers}
            onAddToShoppingList={onAddToShoppingList}
            onLoadMoreOffers={onLoadMoreOffers}
            shoppingListIds={shoppingListIds}
            categories={categories}
            retailers={retailers}
            feedbackPageContext={{
              routeName: 'browse-offers',
              activeRetailers: appliedRetailers,
              activeCategories: appliedCategoryQueryLabels,
              programRetailers: appliedRetailers,
              onlyWithoutProgram: false,
              sortMode: 'browse',
              activeFilters: {
                selectedRetailers: appliedRetailers,
                selectedCategoryTokens: appliedCategoryLabels,
              },
            }}
          />
        </div>
      ) : null}
    </>
  )
}
