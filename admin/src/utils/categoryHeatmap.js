import { browseStateUrl } from './navigationState.js'

const groups = [
  ['lebensmittel', 'Lebensmittel', '01'], ['getraenke', 'Getränke', '02'],
  ['drogerie-hygiene', 'Drogerie', '03'], ['haushalt', 'Haushalt', '04'],
  ['baby-kinder', 'Baby & Kinder', '05'],
]

// Filter counts are not an attractiveness, validity or source-trust assessment.
export function buildCategoryHeatmap(categories = [], retailerKeys = []) {
  const markets = [...new Set(retailerKeys.filter(Boolean))]
  return groups.map(([key, label, number]) => {
    const category = categories.find(item => item.mainCategoryKey === key && item.isActive !== false)
    return { key, label, number, evidence: 'unknown',
      href: category && markets.length ? browseStateUrl({
        appliedRetailers: markets, draftRetailers: markets,
        appliedCategories: [`main:${key}`], draftCategories: [`main:${key}`],
      }) : null }
  })
}
