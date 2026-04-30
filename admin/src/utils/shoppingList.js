import { SHOPPING_LIST_STORAGE_KEY } from '../config/constants'
import { getOfferCategoryLabel, getOfferStableId, getSavingsValue, hasKnownSavings, normalizeRetailerKey } from './offers'

export function loadStoredShoppingList() {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(SHOPPING_LIST_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id) : []
  } catch {
    return []
  }
}

export function buildShoppingListItem(offer) {
  const id = getOfferStableId(offer)

  return {
    id,
    offerId: id,
    title: offer?.title || 'Unbekanntes Angebot',
    retailerKey: offer?.retailerKey || normalizeRetailerKey(offer?.retailerName),
    retailerName: offer?.retailerName || 'Unbekannter Markt',
    categoryLabel: getOfferCategoryLabel(offer),
    priceCurrent: offer?.priceCurrent || null,
    normalizedUnitPrice: offer?.normalizedUnitPrice || null,
    imageUrl: offer?.imageUrl || '',
    quantityText: offer?.quantityText || '',
    conditionsText: offer?.conditionsText || '',
    customerProgramRequired: Boolean(offer?.customerProgramRequired),
    isMultiBuy: Boolean(offer?.isMultiBuy),
    minimumPurchaseQty: offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || 1,
    hasConditions: Boolean(offer?.hasConditions),
    validFrom: offer?.validFrom || '',
    validTo: offer?.validTo || '',
    savingsAmount: getSavingsValue(offer) > 0 ? getSavingsValue(offer) : null,
    hasKnownSavings: hasKnownSavings(offer),
    addedAt: new Date().toISOString(),
  }
}

export function groupShoppingListByRetailer(items = []) {
  const groups = new Map()

  for (const item of items || []) {
    const key = item.retailerKey || normalizeRetailerKey(item.retailerName)

    if (!groups.has(key)) {
      groups.set(key, {
        retailerKey: key,
        retailerName: item.retailerName || 'Unbekannter Markt',
        items: [],
      })
    }

    groups.get(key).items.push(item)
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) => String(left.title).localeCompare(String(right.title), 'de')),
    }))
    .sort((left, right) => left.retailerName.localeCompare(right.retailerName, 'de'))
}

export function getShoppingListSummary(items = []) {
  return (items || []).reduce(
    (summary, item) => {
      const currentPrice = Number(item?.priceCurrent?.amount)
      const savingsValue = Number(item?.savingsAmount)

      if (Number.isFinite(currentPrice)) {
        summary.offerTotal += currentPrice
      }

      if (Number.isFinite(savingsValue) && savingsValue > 0) {
        summary.knownSavings += savingsValue
        summary.knownSavingsCount += 1
      } else {
        summary.actionWithoutNormalPriceCount += 1
      }

      summary.itemCount += 1
      return summary
    },
    {
      itemCount: 0,
      offerTotal: 0,
      knownSavings: 0,
      knownSavingsCount: 0,
      actionWithoutNormalPriceCount: 0,
    }
  )
}
