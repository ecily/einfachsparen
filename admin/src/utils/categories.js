import { getOfferCategoryLabel, getOfferRetailerKey, normalizeRetailerKey } from './offers'

export function normalizeCategoryDocuments(categories = []) {
  return (categories || [])
    .filter((item) => item && typeof item === 'object')
    .map((category, index) => ({
      mainCategoryKey: category?.mainCategoryKey || normalizeRetailerKey(category?.mainCategoryLabel || `category-${index}`),
      mainCategoryLabel: category?.mainCategoryLabel || 'Weitere Kategorien',
      offerCount: Number(category?.offerCount || 0),
      isActive: category?.isActive !== false,
      subcategories: (category?.subcategories || [])
        .filter((item) => item && typeof item === 'object')
        .map((subcategory, subIndex) => ({
          subcategoryKey: subcategory?.subcategoryKey || normalizeRetailerKey(subcategory?.subcategoryLabel || `subcategory-${subIndex}`),
          subcategoryLabel: subcategory?.subcategoryLabel || category?.mainCategoryLabel || 'Weitere Kategorien',
          offerCount: Number(subcategory?.offerCount || 0),
        }))
        .filter((subcategory) => {
          const mainLabel = String(category?.mainCategoryLabel || '').trim().toLowerCase()
          const subLabel = String(subcategory?.subcategoryLabel || '').trim().toLowerCase()
          return Boolean(subLabel) && subLabel !== mainLabel
        })
        .filter((subcategory, subIndex, items) =>
          items.findIndex((item) => item.subcategoryKey === subcategory.subcategoryKey || item.subcategoryLabel === subcategory.subcategoryLabel) === subIndex
        )
        .sort((left, right) => right.offerCount - left.offerCount || left.subcategoryLabel.localeCompare(right.subcategoryLabel, 'de')),
    }))
    .filter((item) => item.isActive)
    .sort((left, right) => right.offerCount - left.offerCount || left.mainCategoryLabel.localeCompare(right.mainCategoryLabel, 'de'))
}

export function buildMainSelectionToken(mainCategoryKey) {
  return `main:${mainCategoryKey}`
}

export function buildSubSelectionToken(mainCategoryKey, subcategoryKey) {
  return `sub:${mainCategoryKey}:${subcategoryKey}`
}

export function getGroupSelectionState(group, selectionTokens = []) {
  const mainToken = buildMainSelectionToken(group.mainCategoryKey)
  const allSubcategoryKeys = (group.subcategories || []).map((subcategory) => subcategory.subcategoryKey)
  const selectedSubcategoryKeys = (group.subcategories || [])
    .filter((subcategory) => selectionTokens.includes(buildSubSelectionToken(group.mainCategoryKey, subcategory.subcategoryKey)))
    .map((subcategory) => subcategory.subcategoryKey)
  const allSubcategoriesSelected = allSubcategoryKeys.length > 0 && selectedSubcategoryKeys.length === allSubcategoryKeys.length
  const partialSelected = selectedSubcategoryKeys.length > 0 && !allSubcategoriesSelected

  return {
    mainSelected: selectionTokens.includes(mainToken) || allSubcategoriesSelected,
    partialSelected,
    selectedSubcategoryKeys,
  }
}

export function pruneSelectionTokens(selectionTokens = [], categories = []) {
  const validTokens = new Set()

  for (const group of categories || []) {
    validTokens.add(buildMainSelectionToken(group.mainCategoryKey))

    for (const subcategory of group.subcategories || []) {
      validTokens.add(buildSubSelectionToken(group.mainCategoryKey, subcategory.subcategoryKey))
    }
  }

  return (selectionTokens || []).filter((token) => validTokens.has(token))
}

export function buildSelectedCategoryQueryLabels(selectionTokens = [], categories = []) {
  const labels = []

  for (const group of categories || []) {
    const selectionState = getGroupSelectionState(group, selectionTokens)

    if (selectionState.selectedSubcategoryKeys.length > 0) {
      for (const subcategory of group.subcategories || []) {
        if (selectionState.selectedSubcategoryKeys.includes(subcategory.subcategoryKey)) {
          labels.push(subcategory.subcategoryLabel)
        }
      }

      continue
    }

    if (selectionState.mainSelected && !(group.subcategories || []).length) {
      labels.push(group.mainCategoryLabel)
    }
  }

  return [...new Set(labels.filter(Boolean))]
}

export function filterVisibleOffers(offers, filters, retailers, categories) {
  if (!filters.selectedRetailers.length) return []

  const selectedRetailers = new Set(filters.selectedRetailers)
  const categoryGroups = categories || []
  const hasCategorySelection = filters.selectedCategoryTokens.length > 0

  return (offers || []).filter((offer) => {
    const retailerKey = getOfferRetailerKey(offer, retailers)
    const mainCategoryKey = normalizeRetailerKey(offer?.categoryPrimary || '')
    const subCategoryKey = normalizeRetailerKey(getOfferCategoryLabel(offer))

    if (!selectedRetailers.has(retailerKey)) return false

    if (!hasCategorySelection) {
      return true
    }

    const matchingGroup = categoryGroups.find((group) => group.mainCategoryKey === mainCategoryKey)

    if (!matchingGroup) {
      return false
    }

    const selectionState = getGroupSelectionState(matchingGroup, filters.selectedCategoryTokens)

    if (selectionState.selectedSubcategoryKeys.length > 0) {
      return selectionState.selectedSubcategoryKeys.some((subcategoryKey) => subcategoryKey === subCategoryKey)
    }

    return selectionState.mainSelected
  })
}
