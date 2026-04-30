import { useMemo, useState } from 'react'
import { getGroupSelectionState } from '../../utils/categories'
import { SectionCard } from '../layout/SectionCard'

export function CategorySelectorBlock({
  categories,
  selectedCategoryTokens,
  onToggleMainCategory,
  onToggleSubcategory,
  onClearCategories,
  loading,
  disabled,
}) {
  const [openCategoryKeys, setOpenCategoryKeys] = useState([])

  const openCategoryKeySet = useMemo(() => new Set(openCategoryKeys), [openCategoryKeys])

  function handleToggleOpenCategory(mainCategoryKey) {
    setOpenCategoryKeys((current) => {
      if (current.includes(mainCategoryKey)) {
        return current.filter((item) => item !== mainCategoryKey)
      }

      return [...current, mainCategoryKey]
    })
  }

  return (
    <SectionCard style={{ marginBottom: '1rem' }}>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">Optional: Produkte eingrenzen</p>
          <h2>Produkte eingrenzen</h2>
          <p>
            Dieser Schritt ist freiwillig. Ohne Auswahl zeigt kaufklug alle aktuellen Angebote deiner gewählten
            Geschäfte.
          </p>
        </div>

        {disabled ? (
          <p className="status">Wähle zuerst mindestens ein Geschäft aus.</p>
        ) : loading ? (
          <p className="status">Kategorien werden geladen …</p>
        ) : (
          <div className="category-list">
            <div className="quick-action-row">
              <button type="button" className="ghost-button" onClick={onClearCategories}>
                Alle Produkte anzeigen
              </button>
            </div>

            {(categories || []).map((group) => {
              const selectionState = getGroupSelectionState(group, selectedCategoryTokens)
              const isMainSelected = selectionState.mainSelected
              const isPartiallySelected = selectionState.partialSelected
              const hasSubcategories = group.subcategories.length > 0
              const isOpen = openCategoryKeySet.has(group.mainCategoryKey)
              const categoryStateClass = isMainSelected
                ? 'category-card--selected'
                : isPartiallySelected
                  ? 'category-card--partial'
                  : 'category-card--empty'
              const allButtonLabel = isMainSelected ? 'Keine' : 'Alle'

              return (
                <div key={group.mainCategoryKey} className={`category-card ${categoryStateClass}`}>
                  <div className="category-card__main-row">
                    <button
                      type="button"
                      className={`category-main-button ${
                        isMainSelected ? 'category-main-button--active' : isPartiallySelected ? 'category-main-button--partial' : ''
                      }`}
                      onClick={() => handleToggleOpenCategory(group.mainCategoryKey)}
                      aria-expanded={hasSubcategories ? isOpen : undefined}
                    >
                      <span className="category-main-button__label">{group.mainCategoryLabel}</span>
                      <span className="category-main-button__meta">
                        {group.offerCount} {group.offerCount === 1 ? 'Angebot' : 'Angebote'}
                      </span>
                      {hasSubcategories ? (
                        <span className="category-main-button__chevron" aria-hidden="true">
                          {isOpen ? '−' : '+'}
                        </span>
                      ) : null}
                    </button>

                    <button
                      type="button"
                      className="ghost-button ghost-button--small category-card__toggle-all"
                      onClick={() => onToggleMainCategory(group)}
                      aria-label={`${allButtonLabel} Produkte in ${group.mainCategoryLabel}`}
                    >
                      {allButtonLabel}
                    </button>
                  </div>

                  {hasSubcategories && isOpen ? (
                    <div className="category-card__subcategories">
                      <div className="category-card__subheader">Genauer auswählen</div>

                      <div className="chip-grid chip-grid--subcategories">
                        {group.subcategories.map((subcategory) => {
                          const isSelected = selectionState.selectedSubcategoryKeys.includes(subcategory.subcategoryKey)

                          return (
                            <button
                              key={subcategory.subcategoryKey}
                              type="button"
                              className={`chip chip--subtle ${isSelected ? 'chip--active' : ''}`}
                              onClick={() => onToggleSubcategory(group, subcategory)}
                            >
                              {subcategory.subcategoryLabel} {subcategory.offerCount ? `(${subcategory.offerCount})` : ''}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </SectionCard>
  )
}