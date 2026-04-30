import { useMemo } from 'react'
import { filterVisibleOffers } from '../../utils/categories'
import { flattenRankingOffers, splitRankingOffers } from '../../utils/offers'
import { SectionCard } from '../layout/SectionCard'
import { HeroLoaderModal } from '../layout/HeroLoaderModal'
import { HeroBlock } from './HeroBlock'
import { SeoIntroSections } from './SeoIntroSections'
import { FaqSection } from './FaqSection'
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
  onClearDraftCategories,
  onApplySearch,
  onResetAll,
  onAddToShoppingList,
  onNavigate,
}) {
  const isInitialBusy = filtersLoading
  const hasAppliedRetailerScope = appliedRetailers.length > 0

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

  return (
    <>
      <HeroLoaderModal
        open={isInitialBusy}
        label="kaufklug lädt Geschäfte, Kategorien und aktuelle Angebote."
      />

      <HeroBlock />
      <SeoIntroSections />

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
        onClearCategories={onClearDraftCategories}
        loading={filtersLoading}
        disabled={!draftRetailers.length}
      />

      <ActionBlock
        canSearch={draftRetailers.length > 0}
        selectedRetailerCount={draftRetailers.length}
        selectedCategoryCount={draftCategoryLabels.length}
        onApplySearch={onApplySearch}
        onReset={onResetAll}
        hasPendingChanges={hasPendingChanges}
        searching={rankingLoading}
      />

      <ResultsBlockConsumer
        rankingLoading={rankingLoading}
        hasAppliedRetailerScope={hasAppliedRetailerScope}
        safeOffers={bestComparableOffers}
        actionOffers={actionOffers}
        onAddToShoppingList={onAddToShoppingList}
        shoppingListIds={shoppingListIds}
        onNavigate={onNavigate}
      />

      <FaqSection />
    </>
  )
}