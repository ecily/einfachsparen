import dayjs from 'dayjs'
import { SHOPPING_LIST_CHECKED_STORAGE_KEY, SHOPPING_LIST_STORAGE_KEY } from '../config/constants'
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

export function buildShoppingListItemFromSnapshot(item) {
  const id = item?.offerId || `${item?.retailerKey || item?.retailerName || 'markt'}-${item?.title || 'angebot'}-${item?.validUntil || ''}`

  return {
    id,
    offerId: item?.offerId || id,
    title: item?.title || 'Unbekanntes Angebot',
    retailerKey: item?.retailerKey || normalizeRetailerKey(item?.retailerName),
    retailerName: item?.retailerName || 'Unbekannter Markt',
    categoryLabel: item?.categoryLabel || 'ohne Kategorie',
    priceCurrent: item?.priceCurrent || null,
    normalizedUnitPrice: item?.unit ? { amount: null, unit: item.unit, comparable: false, confidence: 0 } : null,
    imageUrl: item?.imageUrl || '',
    quantityText: item?.quantityText || item?.unit || '',
    conditionsText: '',
    customerProgramRequired: false,
    isMultiBuy: false,
    minimumPurchaseQty: 1,
    hasConditions: false,
    validFrom: '',
    validTo: item?.validUntil || '',
    savingsAmount: null,
    hasKnownSavings: false,
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

export function getRetailerGroupSummary(items = []) {
  const knownSavings = (items || []).reduce((sum, item) => {
    const savingsValue = Number(item?.savingsAmount)
    return Number.isFinite(savingsValue) && savingsValue > 0 ? sum + savingsValue : sum
  }, 0)

  return {
    itemCount: (items || []).length,
    knownSavings: knownSavings > 0 ? knownSavings : null,
  }
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

export function loadCheckedShoppingListItems(scope = 'default') {
  if (typeof window === 'undefined') return new Set()

  try {
    const raw = window.localStorage.getItem(`${SHOPPING_LIST_CHECKED_STORAGE_KEY}.${scope}`)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [])
  } catch {
    return new Set()
  }
}

export function storeCheckedShoppingListItems(checkedIds, scope = 'default') {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(`${SHOPPING_LIST_CHECKED_STORAGE_KEY}.${scope}`, JSON.stringify([...checkedIds]))
  } catch {
    // localStorage kann im Browser blockiert sein. Die Liste bleibt trotzdem nutzbar.
  }
}

export function buildShareSnapshot(items = []) {
  return {
    items: (items || []).map((item) => ({
      offerId: item?.offerId || item?.id || '',
      retailerKey: item?.retailerKey || '',
      retailerName: item?.retailerName || '',
      title: item?.title || '',
      categoryLabel: item?.categoryLabel || '',
      priceCurrent: item?.priceCurrent || null,
      unit: item?.normalizedUnitPrice?.unit || '',
      quantityText: item?.quantityText || '',
      validUntil: item?.validTo || '',
      imageUrl: item?.imageUrl || '',
    })),
  }
}

export function getShoppingListItemId(item) {
  return String(item?.id || item?.offerId || `${item?.retailerKey || item?.retailerName || 'markt'}-${item?.title || 'angebot'}-${item?.validTo || item?.validUntil || ''}`)
}

export function getOfferExpiryHint(item) {
  const rawDate = item?.validTo || item?.validUntil

  if (!rawDate) {
    return {
      label: '',
      tone: 'neutral',
    }
  }

  const expiry = dayjs(rawDate)

  if (!expiry.isValid()) {
    return {
      label: '',
      tone: 'neutral',
    }
  }

  const today = dayjs().startOf('day')
  const expiryDay = expiry.startOf('day')
  const daysLeft = expiryDay.diff(today, 'day')

  if (daysLeft < 0) {
    return {
      label: `Abgelaufen seit ${expiry.format('DD.MM.YYYY')}`,
      tone: 'expired',
    }
  }

  if (daysLeft === 0) {
    return {
      label: 'Nur noch heute gültig',
      tone: 'urgent',
    }
  }

  if (daysLeft === 1) {
    return {
      label: 'Läuft morgen ab',
      tone: 'warning',
    }
  }

  return {
    label: `Gültig bis ${expiry.format('DD.MM.YYYY')}`,
    tone: 'neutral',
  }
}
