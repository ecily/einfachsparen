import { formatCurrencyAmount } from './formatting'

export function normalizeRetailerKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function getOfferStableId(offer) {
  return String(
    offer?.id ||
    offer?._id ||
    offer?.offerKey ||
    offer?.dedupeKey ||
    `${offer?.title || 'angebot'}-${offer?.retailerName || 'markt'}-${offer?.priceCurrent?.amount || 'preis'}-${offer?.validTo || ''}`
  )
}

export function getOfferCategoryLabel(offer) {
  return offer?.displayCategory || offer?.categorySecondary || offer?.categoryPrimary || 'ohne Kategorie'
}

export function isOfferDirectlyComparable(offer) {
  return Boolean(offer?.quality?.comparisonSafe && offer?.comparisonGroup && offer?.normalizedUnitPrice?.amount)
}

export function getOfferKindLabel(offer) {
  return isOfferDirectlyComparable(offer) ? 'Mit Vergleichspreis' : 'Aktionspreis'
}

export function getOfferStatusLabel(offer) {
  if (offer?.status === 'active' && offer?.isActiveNow) return 'Aktuell gültig'
  if (offer?.status === 'upcoming') return 'Bald gültig'
  if (offer?.status === 'expired') return 'Nicht mehr gültig'
  if (offer?.isActiveToday) return 'Heute relevant'
  return 'Aktuelle Aktion'
}

export function shouldDisplayUnitPrice(offer) {
  const amount = Number(offer?.normalizedUnitPrice?.amount)
  const unit = String(offer?.normalizedUnitPrice?.unit || offer?.comparableUnit || '')
  const packageType = String(offer?.packageType || '').toLowerCase()
  const packCount = Number(offer?.packCount || 0)
  const unitType = String(offer?.unitType || '')

  if (!Number.isFinite(amount) || !unit) {
    return false
  }

  if (unit === 'Stk' && packCount > 1 && (packageType === 'pack' || packageType === 'box' || packageType === 'blister' || unitType === 'Stk')) {
    return false
  }

  return true
}

export function getConditionsSummary(offer) {
  if (offer?.conditionsText) {
    return offer.conditionsText
  }

  if (offer?.customerProgramRequired) {
    return 'Mit Kundenkarte/App'
  }

  if (offer?.isMultiBuy) {
    return 'Mehrkauf-Angebot'
  }

  const minimumPurchaseQty = Number(offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || 1)
  if (minimumPurchaseQty > 1) {
    return `Mindestens ${minimumPurchaseQty} Stück`
  }

  if (offer?.hasConditions) {
    return 'Bedingung beachten'
  }

  return 'Keine besonderen Bedingungen'
}

export function getMinimumQuantityLabel(offer) {
  const minimumPurchaseQty = Number(
    offer?.minimumPurchaseQty ||
      offer?.minimumPurchaseQuantity ||
      offer?.minQuantity ||
      offer?.minimumQuantity ||
      offer?.minimumOrderQuantity ||
      offer?.minimumPurchase?.quantity ||
      offer?.discount?.minimumQuantity ||
      1
  )

  if (Number.isFinite(minimumPurchaseQty) && minimumPurchaseQty > 1) {
    return `Mindestmenge: ${Math.round(minimumPurchaseQty)} Stück`
  }

  const conditionText = [
    offer?.conditionsText,
    offer?.conditionLabel,
    offer?.effectiveDiscountType,
    offer?.discountMechanic,
    offer?.discountType,
    offer?.rawFacts,
  ]
    .filter(Boolean)
    .map((value) => Array.isArray(value) ? value.join(' ') : String(value))
    .join(' ')
    .toLowerCase()

  const quantityMatch = conditionText.match(/\bab\s*(\d+)\s*(?:st[üu]ck|stk|packungen?|flaschen?|dosen?|artikel|produkte)?\b/)
  if (quantityMatch) {
    return `Mindestmenge: ${quantityMatch[1]} Stück`
  }

  const multiBuyMatch = conditionText.match(/\b(\d+)\s*(?:\+|f[üu]r)\s*(\d+)\b/)
  if (multiBuyMatch && Number(multiBuyMatch[1]) > 1) {
    return `Mindestmenge: ${multiBuyMatch[1]} Stück`
  }

  return ''
}

export function isDuplicateMinimumCondition(value, offer) {
  const text = String(value || '').trim().toLowerCase()
  const minimumQuantity = getMinimumQuantityLabel(offer).match(/\d+/)?.[0]

  if (!text || !minimumQuantity) return false

  const compactText = text.replace(/\s+/g, ' ')
  return (
    new RegExp(`^(?:ab|mindestens|min\\.?|mindestmenge:?|mindestkauf:?)\\s*${minimumQuantity}\\s*(?:st[üu]ck|stk|artikel|produkte|packungen?)\\.?$`).test(compactText) ||
    new RegExp(`^${minimumQuantity}\\s*(?:st[üu]ck|stk|artikel|produkte|packungen?)\\s*(?:n[öo]tig|erforderlich)$`).test(compactText)
  )
}

export function getDisplayConditionInfo(offer) {
  const items = []

  if (offer?.customerProgramRequired) items.push('Mit Kundenkarte/App')
  if (offer?.isMultiBuy) items.push('Mehrkauf-Angebot')
  if (offer?.conditionsText && !isDuplicateMinimumCondition(offer.conditionsText, offer)) items.push(offer.conditionsText)

  return [...new Set(items)].join(' / ')
}

export function getReadableQuantityText(offer) {
  const rawValue = String(offer?.quantityText || '').trim()

  if (!rawValue) {
    const unitValue = Number(offer?.unitValue)
    const unitType = String(offer?.unitType || '').trim()

    if (Number.isFinite(unitValue) && unitValue > 0 && unitType) {
      return `${new Intl.NumberFormat('de-AT').format(unitValue)} ${unitType}`
    }

    return ''
  }

  const value = rawValue.replace(/^menge:\s*/i, '').trim()

  if (!value || /\bta\./i.test(value)) return ''

  const normalizedValue = value
    .replace(/\s+/g, ' ')
    .replace(/\s*x\s*/gi, ' x ')
    .trim()
  const unitPattern = '(?:kg|g|dag|l|ml|cl|stk|st\\.?|stueck|stuecke|stück|stücke|packung|packungen|flasche|flaschen|dose|dosen|tafel|tafeln)'
  const simpleQuantity = new RegExp(`^\\d+(?:[,.]\\d+)?\\s*${unitPattern}$`, 'i')
  const multiPackQuantity = new RegExp(`^\\d+\\s*(?:x|×)\\s*\\d+(?:[,.]\\d+)?\\s*${unitPattern}$`, 'i')

  if (!simpleQuantity.test(normalizedValue) && !multiPackQuantity.test(normalizedValue)) return ''

  return normalizedValue
    .replace(/(\d+)\.(\d+)(?=\s*(?:kg|g|dag|l|ml|cl|stk|st\.?|stück|stücke|packung|packungen|flasche|flaschen|dose|dosen|tafel|tafeln)\b)/gi, '$1,$2')
    .replace(/\bx\b/g, '×')
    .replace(/\bst\.?$/i, 'Stück')
    .replace(/\bstueck(e)?\b/gi, 'Stück')
}

export function buildOfferBadges(offer) {
  const badges = []

  if (offer?.customerProgramRequired) badges.push('Kundenkarte/App')
  if (offer?.isMultiBuy) badges.push('Mehrkauf')

  return badges
}

export function getOfferRetailerKey(offer, retailers = []) {
  if (offer?.retailerKey) return offer.retailerKey

  const fromLookup = (retailers || []).find((item) => item.retailerName === offer?.retailerName)
  if (fromLookup?.retailerKey) return fromLookup.retailerKey

  return normalizeRetailerKey(offer?.retailerName)
}

export function flattenRankingOffers(ranking) {
  if (Array.isArray(ranking?.rankedOffers)) {
    return ranking.rankedOffers
      .filter((offer) => offer && typeof offer === 'object')
      .map((offer) => ({
        ...offer,
        id: getOfferStableId(offer),
      }))
  }

  const seen = new Set()
  const offers = []

  for (const group of ranking?.rankedGroups || []) {
    for (const offer of group.offers || []) {
      const offerId = getOfferStableId(offer)

      if (seen.has(offerId)) continue

      seen.add(offerId)
      offers.push({
        ...offer,
        id: offerId,
      })
    }
  }

  return offers
}

export function splitRankingOffers(offers = []) {
  const bestComparableOffers = []
  const actionOffers = []

  for (const offer of offers || []) {
    if (isOfferDirectlyComparable(offer)) {
      bestComparableOffers.push(offer)
      continue
    }

    actionOffers.push(offer)
  }

  return {
    bestComparableOffers,
    actionOffers,
  }
}

export function areStringSetsEqual(left = [], right = []) {
  if (left.length !== right.length) return false

  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  return leftSorted.every((value, index) => value === rightSorted[index])
}

export function getSavingsValue(offer) {
  if (offer?.referencePrice?.allowsSavings !== true) {
    return -1
  }

  const candidates = [
    offer?.savings?.amount,
    offer?.savingsAmount,
    offer?.priceSavings?.amount,
  ]

  for (const candidate of candidates) {
    const numeric = Number(candidate)
    if (Number.isFinite(numeric) && numeric > 0) return numeric
  }

  return -1
}

export function hasKnownSavings(offer) {
  return getSavingsValue(offer) > 0
}

export function getOfferSavingsInfo(offer) {
  const savingsValue = getSavingsValue(offer)
  const isApproximate = Boolean(offer?.savings?.isApproximate || offer?.referencePrice?.isApproximate)

  if (savingsValue > 0) {
    return {
      type: 'known',
      label: `Spart ${isApproximate ? 'ca. ' : ''}${formatCurrencyAmount(savingsValue)}`,
      shortLabel: `${isApproximate ? 'ca. ' : ''}${formatCurrencyAmount(savingsValue)}`,
      description: isApproximate ? 'Ersparnis aus Quellenangabe abgeleitet.' : 'Ersparnis mit angegebenem Normalpreis.',
    }
  }

  return {
    type: 'action',
    label: 'Aktionspreis',
    shortLabel: 'Aktionspreis',
    description: 'Im Prospekt ist kein Normalpreis angegeben. Das ist oft bei kurzen oder saisonalen Aktionen der Fall.',
  }
}
