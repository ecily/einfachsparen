import dayjs from 'dayjs'
import { SHOPPING_LIST_CHECKED_STORAGE_KEY, SHOPPING_LIST_STORAGE_KEY } from '../config/constants.js'
import {
  getOfferCategoryLabel,
  getOfferMinimumPurchaseInfo,
  getOfferStableId,
  getSavingsValue,
  hasKnownSavings,
  normalizeRetailerKey,
} from './offers.js'

const SAVINGS_SOURCE_BACKEND_REFERENCE = 'backend-reference-price'
const MAX_SHOPPING_LIST_QUANTITY = 99

function getOfferSavingsSnapshot(offer) {
  const savingsAmount = getSavingsValue(offer)
  const knownSavings = savingsAmount > 0 && hasKnownSavings(offer)

  return {
    amount: knownSavings ? savingsAmount : null,
    isApproximate: knownSavings ? Boolean(offer?.savings?.isApproximate || offer?.referencePrice?.isApproximate) : false,
    source: knownSavings ? SAVINGS_SOURCE_BACKEND_REFERENCE : '',
  }
}

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
  const savings = getOfferSavingsSnapshot(offer)
  const minimumPurchaseInfo = getOfferMinimumPurchaseInfo(offer)

  return {
    id,
    offerId: id,
    title: offer?.title || 'Unbekanntes Angebot',
    retailerKey: offer?.retailerKey || normalizeRetailerKey(offer?.retailerName),
    retailerName: offer?.retailerName || 'Unbekannter Markt',
    categoryLabel: getOfferCategoryLabel(offer),
    displayCategory: offer?.displayCategory || '',
    categoryPrimary: offer?.categoryPrimary || '',
    categorySecondary: offer?.categorySecondary || '',
    priceCurrent: offer?.priceCurrent || null,
    price: offer?.price || null,
    normalizedUnitPrice: offer?.normalizedUnitPrice || null,
    comparableUnit: offer?.comparableUnit || '',
    imageUrl: offer?.imageUrl || '',
    quantityText: offer?.quantityText || '',
    unitValue: offer?.unitValue || null,
    unitType: offer?.unitType || '',
    packageType: offer?.packageType || '',
    packCount: offer?.packCount || null,
    conditionsText: offer?.conditionsText || '',
    conditionLabel: offer?.conditionLabel || '',
    discountMechanic: offer?.discountMechanic || '',
    discountType: offer?.discountType || '',
    effectiveDiscountType: offer?.effectiveDiscountType || '',
    rawFacts: offer?.rawFacts || '',
    customerProgramRequired: Boolean(offer?.customerProgramRequired),
    isMultiBuy: Boolean(offer?.isMultiBuy),
    minimumPurchaseQty: minimumPurchaseInfo?.quantity || offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || 1,
    minimumPurchaseUnit: minimumPurchaseInfo?.unit || '',
    hasConditions: Boolean(offer?.hasConditions),
    referencePrice: offer?.referencePrice || null,
    savings: offer?.savings || null,
    validFrom: offer?.validFrom || '',
    validTo: offer?.validTo || '',
    validityLabel: offer?.validityLabel || '',
    savingsAmount: savings.amount,
    savingsIsApproximate: savings.isApproximate,
    savingsSource: savings.source,
    hasKnownSavings: savings.amount !== null,
    addedAt: new Date().toISOString(),
  }
}

function toCents(amount) {
  const numericAmount = Number(amount)

  return Number.isFinite(numericAmount) ? Math.round(numericAmount * 100) : 0
}

function fromCents(cents) {
  return cents / 100
}

function getReferencePriceAmount(item) {
  const candidates = [
    item?.referencePrice?.amount,
    item?.priceReference?.amount,
    item?.priceOriginal?.amount,
    item?.rawFacts && typeof item.rawFacts === 'object' ? item.rawFacts.referencePrice : null,
  ]

  for (const candidate of candidates) {
    const amount = Number(candidate)

    if (Number.isFinite(amount) && amount > 0) {
      return amount
    }
  }

  return null
}

export function getShoppingListMinimumQuantity(item) {
  const info = getOfferMinimumPurchaseInfo(item)
  const quantity = Number(info?.quantity)

  if (Number.isFinite(quantity) && quantity > 1) {
    return Math.min(Math.round(quantity), MAX_SHOPPING_LIST_QUANTITY)
  }

  return 1
}

export function getShoppingListItemQuantity(item, quantities = {}) {
  const itemId = getShoppingListItemId(item)
  const minimumQuantity = getShoppingListMinimumQuantity(item)
  const storedQuantity = Number(quantities?.[itemId])
  const quantity = Number.isFinite(storedQuantity) && storedQuantity > 0 ? Math.round(storedQuantity) : minimumQuantity

  return Math.min(Math.max(quantity, minimumQuantity), MAX_SHOPPING_LIST_QUANTITY)
}

export function getShoppingListQuantityBreakdown(item, quantity) {
  const minimumQuantity = getShoppingListMinimumQuantity(item)
  const safeQuantity = Math.min(
    Math.max(Number.isFinite(Number(quantity)) ? Math.round(Number(quantity)) : minimumQuantity, minimumQuantity),
    MAX_SHOPPING_LIST_QUANTITY
  )

  if (minimumQuantity <= 1) {
    return {
      minimumQuantity,
      quantity: safeQuantity,
      offerQuantity: safeQuantity,
      remainderQuantity: 0,
      completeBlocks: safeQuantity,
    }
  }

  const completeBlocks = Math.floor(safeQuantity / minimumQuantity)
  const offerQuantity = completeBlocks * minimumQuantity
  const remainderQuantity = safeQuantity - offerQuantity

  return {
    minimumQuantity,
    quantity: safeQuantity,
    offerQuantity,
    remainderQuantity,
    completeBlocks,
  }
}

export function getShoppingListItemPricing(item, quantity) {
  const breakdown = getShoppingListQuantityBreakdown(item, quantity)
  const currentPrice = Number(item?.priceCurrent?.amount ?? item?.price?.amount ?? item?.price)
  const referencePrice = getReferencePriceAmount(item)
  const savings = getShoppingListItemSavingsInfo(item)
  const hasCurrentPrice = Number.isFinite(currentPrice) && currentPrice > 0
  const hasReferencePrice = Number.isFinite(referencePrice) && referencePrice > currentPrice
  const offerUnitCents = hasCurrentPrice ? toCents(currentPrice) : 0
  const referenceUnitCents = hasReferencePrice ? toCents(referencePrice) : offerUnitCents
  const offerTotalCents = offerUnitCents * breakdown.offerQuantity
  const remainderTotalCents = referenceUnitCents * breakdown.remainderQuantity
  const knownSavingsCents =
    savings.type === 'known' ? toCents(savings.amount) * breakdown.completeBlocks : 0

  return {
    ...breakdown,
    hasCurrentPrice,
    hasReferencePrice,
    offerTotal: fromCents(offerTotalCents),
    remainderTotal: fromCents(remainderTotalCents),
    estimatedTotal: fromCents(offerTotalCents + remainderTotalCents),
    knownSavings: fromCents(knownSavingsCents),
    hasApproximateSavings: savings.type === 'known' && savings.isApproximate,
    hasUncertainRemainder: breakdown.remainderQuantity > 0,
    hasUnpricedRemainder: breakdown.remainderQuantity > 0 && !hasReferencePrice,
  }
}

export function getShoppingListRemainderHint(item, quantity) {
  const pricing = getShoppingListItemPricing(item, quantity)

  if (!pricing.hasUncertainRemainder) return ''

  const unit = item?.minimumPurchaseUnit === 'pack' ? 'Packung' : 'Stück'
  const unitLabel = pricing.remainderQuantity === 1 ? unit : unit === 'Packung' ? 'Packungen' : 'Stück'

  if (pricing.hasReferencePrice) {
    return `Für ${pricing.remainderQuantity} zusätzliche ${unitLabel} ist nicht sicher, ob der Angebotspreis gilt.`
  }

  return `Für ${pricing.remainderQuantity} zusätzliche ${unitLabel} ist nicht sicher, ob sie vollständig vom Angebotspreis gedeckt sind.`
}

export function getShoppingListSummaryForQuantities(items = [], quantities = {}) {
  return (items || []).reduce(
    (summary, item) => {
      const quantity = getShoppingListItemQuantity(item, quantities)
      const pricing = getShoppingListItemPricing(item, quantity)

      if (pricing.hasCurrentPrice) {
        summary.offerTotal += pricing.estimatedTotal
      }

      if (pricing.knownSavings > 0) {
        summary.knownSavings += pricing.knownSavings
        summary.knownSavingsCount += 1
        if (pricing.hasApproximateSavings) summary.approximateSavingsCount += 1
      } else {
        summary.actionWithoutNormalPriceCount += 1
      }

      if (pricing.hasUnpricedRemainder) {
        summary.uncertainRemainderCount += 1
      }

      summary.itemCount += 1
      return summary
    },
    {
      itemCount: 0,
      offerTotal: 0,
      knownSavings: 0,
      knownSavingsCount: 0,
      approximateSavingsCount: 0,
      actionWithoutNormalPriceCount: 0,
      uncertainRemainderCount: 0,
    }
  )
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
    savingsIsApproximate: false,
    savingsSource: '',
    hasKnownSavings: false,
    addedAt: new Date().toISOString(),
  }
}

export function getShoppingListItemSavingsInfo(item) {
  const derivedSavingsValue = getSavingsValue(item)

  if (derivedSavingsValue > 0) {
    return {
      type: 'known',
      amount: derivedSavingsValue,
      isApproximate: Boolean(item?.savings?.isApproximate || item?.referencePrice?.isApproximate),
    }
  }

  const savingsValue = Number(item?.savingsAmount)
  const hasTrustedSavings =
    item?.hasKnownSavings === true &&
    Number.isFinite(savingsValue) &&
    savingsValue > 0

  if (!hasTrustedSavings) {
    return {
      type: 'action',
      amount: 0,
      isApproximate: false,
    }
  }

  return {
    type: 'known',
    amount: savingsValue,
    isApproximate: Boolean(item?.savingsIsApproximate),
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
    const savings = getShoppingListItemSavingsInfo(item)
    return savings.type === 'known' ? sum + savings.amount : sum
  }, 0)
  const hasApproximateSavings = (items || []).some((item) => getShoppingListItemSavingsInfo(item).isApproximate)

  return {
    itemCount: (items || []).length,
    knownSavings: knownSavings > 0 ? knownSavings : null,
    hasApproximateSavings,
  }
}

export function getShoppingListSummary(items = []) {
  return (items || []).reduce(
    (summary, item) => {
      const currentPrice = Number(item?.priceCurrent?.amount)
      const savings = getShoppingListItemSavingsInfo(item)

      if (Number.isFinite(currentPrice)) {
        summary.offerTotal += currentPrice
      }

      if (savings.type === 'known') {
        summary.knownSavings += savings.amount
        summary.knownSavingsCount += 1
        if (savings.isApproximate) summary.approximateSavingsCount += 1
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
      approximateSavingsCount: 0,
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
