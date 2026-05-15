import { useEffect, useMemo, useRef, useState } from 'react'
import { areAllCategoryGroupsSelected, filterVisibleOffers } from '../../utils/categories'
import { flattenRankingOffers, getRankingPagination, splitRankingOffers } from '../../utils/offers'
import { SectionCard } from '../layout/SectionCard'
import { HeroLoaderModal } from '../layout/HeroLoaderModal'
import { RetailerSelectorBlock } from './RetailerSelectorBlock'
import { CategorySelectorBlock } from './CategorySelectorBlock'
import { ActionBlock } from './ActionBlock'
import { ResultsBlockConsumer } from './ResultsBlockConsumer'

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
  const isInitialBusy = filtersLoading
  const hasAppliedRetailerScope = appliedRetailers.length > 0
  const hasDraftSelection = draftRetailers.length > 0 || draftCategoryLabels.length > 0
  const shouldShowBrowseResults = hasAppliedRetailerScope
  const allDraftCategoriesSelected = areAllCategoryGroupsSelected(draftCategoryLabels, categories)
  const [activeBrowseScrollKey, setActiveBrowseScrollKey] = useState(0)
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
    if (!activeBrowseScrollKey || rankingLoading || !hasAppliedRetailerScope) return

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
          />
        </div>
      ) : null}
    </>
  )
}
