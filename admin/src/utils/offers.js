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

function normalizeConditionWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeConditionParseText(value) {
  return normalizeConditionWhitespace(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
}

function normalizeDisplayConditionKey(value) {
  return normalizeConditionParseText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:bedingung|aktion|angebot|nur|mit|bei)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function flattenConditionValue(value) {
  if (Array.isArray(value)) {
    return value.map(flattenConditionValue).filter(Boolean).join(' ')
  }

  if (value && typeof value === 'object') {
    return Object.values(value).map(flattenConditionValue).filter(Boolean).join(' ')
  }

  return String(value || '')
}

function getConditionSourceTexts(offer) {
  return [
    offer?.conditionsText,
    offer?.conditionLabel,
    offer?.effectiveDiscountType,
    offer?.discountMechanic,
    offer?.discountType,
    offer?.rawFacts,
  ]
    .map(flattenConditionValue)
    .map(normalizeConditionWhitespace)
    .filter(Boolean)
}

function getExplicitMinimumQuantity(offer) {
  const quantity = Number(
    offer?.minimumPurchaseQty ||
      offer?.minimumPurchaseQuantity ||
      offer?.minQuantity ||
      offer?.minimumQuantity ||
      offer?.minimumOrderQuantity ||
      offer?.minimumPurchase?.quantity ||
      offer?.discount?.minimumQuantity ||
      0
  )

  return Number.isFinite(quantity) && quantity > 1 ? Math.round(quantity) : 0
}

const minimumUnitPattern = '(stuck|stueck|stk\\.?|st\\.?|packungen?|pkg\\.?|pckg\\.?)'

function isPackUnit(value) {
  return /\b(?:packungen?|pkg\.?|pckg\.?)\b/i.test(normalizeConditionParseText(value))
}

function getMinimumConditionInfoFromText(value) {
  const text = normalizeConditionParseText(value)
  const patterns = [
    new RegExp(`\\b(?:gilt\\s*)?ab\\s*(\\d+)\\s*${minimumUnitPattern}\\b`),
    new RegExp(`\\bmindestens\\s*(\\d+)\\s*${minimumUnitPattern}\\b`),
    new RegExp(`\\bmindest(?:menge|kauf)?\\s*:?\\s*(\\d+)\\s*${minimumUnitPattern}\\b`),
    new RegExp(`\\bbei\\s*(\\d+)\\s*${minimumUnitPattern}\\b`),
    new RegExp(`\\b(\\d+)\\s*${minimumUnitPattern}\\s+je\\b`),
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    const quantity = Number(match?.[1])

    if (Number.isFinite(quantity) && quantity > 1) {
      const unit = match?.[2] || ''

      return {
        quantity: Math.round(quantity),
        unit: isPackUnit(unit) ? 'pack' : 'piece',
      }
    }
  }

  return null
}

function getDisplayMinimumConditionInfo(offer) {
  const sourceTexts = getConditionSourceTexts(offer)
  const explicitQuantity = getExplicitMinimumQuantity(offer)
  const parsedInfos = sourceTexts.map(getMinimumConditionInfoFromText).filter(Boolean)

  if (explicitQuantity) {
    return {
      quantity: explicitQuantity,
      unit: parsedInfos.some((info) => info.quantity === explicitQuantity && info.unit === 'pack') ||
        sourceTexts.some(isPackUnit)
        ? 'pack'
        : 'piece',
    }
  }

  const firstInfo = parsedInfos[0]
  if (!firstInfo) return null

  return {
    quantity: firstInfo.quantity,
    unit: parsedInfos.some((info) => info.quantity === firstInfo.quantity && info.unit === 'pack') ? 'pack' : firstInfo.unit,
  }
}

function formatMinimumDisplayCondition(info) {
  if (!info?.quantity) return ''

  return `Gilt ab ${info.quantity} ${info.unit === 'pack' ? 'Packungen' : 'Stück'}`
}

function hasAdditionalConditionSignal(value) {
  return /\b(?:app|kundenkarte|karte|joe|jo|online|vorrat|sorten?|ausnahmen?|ausgenommen|rabattmark|pickerl|konto|club|nicht\s+kombinierbar|regional)\b/.test(
    normalizeConditionParseText(value)
  )
}

function isStandaloneMinimumCondition(value, minimumInfo) {
  if (!minimumInfo?.quantity) return false

  const parsedInfo = getMinimumConditionInfoFromText(value)
  if (!parsedInfo || parsedInfo.quantity !== minimumInfo.quantity) return false
  if (hasAdditionalConditionSignal(value)) return false

  const text = normalizeConditionParseText(value)
  const quantity = minimumInfo.quantity
  const priceTail = '(?:\\s*(?:je|um|nur|=)?\\s*(?:eur|€)?\\s*\\d+(?:[,.]\\d+)?\\s*(?:eur|€)?)?'
  const patterns = [
    new RegExp(`^(?:gilt\\s*)?ab\\s*${quantity}\\s*${minimumUnitPattern}\\.?$`),
    new RegExp(`^mindestens\\s*${quantity}\\s*${minimumUnitPattern}\\.?$`),
    new RegExp(`^mindest(?:menge|kauf)?\\s*:?\\s*${quantity}\\s*${minimumUnitPattern}\\.?$`),
    new RegExp(`^bei\\s*${quantity}\\s*${minimumUnitPattern}${priceTail}\\.?$`),
    new RegExp(`^bei\\s*${quantity}\\s*${minimumUnitPattern}\\s+je(?:\\s+.*)?$`),
    new RegExp(`^${quantity}\\s*${minimumUnitPattern}\\s+je(?:\\s+.*)?$`),
  ]

  return patterns.some((pattern) => pattern.test(text))
}

function conditionIncludesDisplayText(text, candidate) {
  const normalizedText = normalizeDisplayConditionKey(text)
  const normalizedCandidate = normalizeDisplayConditionKey(candidate)

  return Boolean(normalizedText && normalizedCandidate && normalizedText.includes(normalizedCandidate))
}

function isRedundantDisplayCondition(candidate, existingConditions) {
  const candidateKey = normalizeDisplayConditionKey(candidate)

  if (!candidateKey) return true

  return existingConditions.some((existingCondition) => {
    const existingKey = normalizeDisplayConditionKey(existingCondition)

    return (
      existingKey === candidateKey ||
      existingKey.includes(candidateKey) ||
      candidateKey.includes(existingKey)
    )
  })
}

function getMultiBuyDisplayText(offer) {
  const parts = getConditionSourceTexts(offer).join(' ')

  const plusMatch = parts.match(/\b(\d+)\s*\+\s*(\d+)\b/)
  if (plusMatch) {
    return `${plusMatch[1]}+${plusMatch[2]} gratis`
  }

  const forMatch = parts.match(/\b(\d+)\s*f(?:ü|ue|u)r\s*(\d+)\b/i)
  if (forMatch && Number(forMatch[1]) > Number(forMatch[2])) {
    return `${forMatch[1]} für ${forMatch[2]}`
  }

  return offer?.isMultiBuy ? 'Mehrkauf-Angebot' : ''
}

function getProgramDisplayText(offer) {
  const text = getConditionSourceTexts(offer).join(' ').toLowerCase()

  if (text.includes('app')) {
    return 'Nur mit App'
  }

  if (offer?.customerProgramRequired || text.includes('kundenkarte') || text.includes('jö') || text.includes('j ö')) {
    return 'Nur mit Kundenkarte'
  }

  return ''
}

export function getDisplayConditionLabels(offer) {
  const rawConditions = [
    normalizeConditionWhitespace(offer?.conditionsText),
    normalizeConditionWhitespace(offer?.conditionLabel),
  ].filter(Boolean)
  const minimumInfo = getDisplayMinimumConditionInfo(offer)
  const minimumCondition = formatMinimumDisplayCondition(minimumInfo)
  const multiBuyCondition = getMultiBuyDisplayText(offer)
  const programCondition = getProgramDisplayText(offer)
  const derivedConditions = [
    minimumCondition,
    minimumCondition ? '' : multiBuyCondition,
    programCondition,
  ].filter(Boolean)
  const conditions = []

  for (const condition of derivedConditions) {
    if (!isRedundantDisplayCondition(condition, conditions)) {
      conditions.push(condition)
    }
  }

  for (const condition of rawConditions) {
    if (minimumInfo && isStandaloneMinimumCondition(condition, minimumInfo)) continue
    if (rawConditions.some((rawCondition) => rawCondition !== condition && conditionIncludesDisplayText(rawCondition, condition))) continue
    if (!isRedundantDisplayCondition(condition, conditions)) conditions.push(condition)
  }

  return conditions
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

export function mergePaginatedRankingResults(currentRanking, nextRanking) {
  const mergedOffers = []
  const seen = new Set()

  for (const offer of [...flattenRankingOffers(currentRanking), ...flattenRankingOffers(nextRanking)]) {
    const offerId = getOfferStableId(offer)

    if (!offerId || seen.has(offerId)) continue

    seen.add(offerId)
    mergedOffers.push({
      ...offer,
      id: offerId,
    })
  }

  return {
    ...(currentRanking || {}),
    ...(nextRanking || {}),
    rankedGroups: [],
    rankedOffers: mergedOffers,
    summary: {
      ...(currentRanking?.summary || {}),
      ...(nextRanking?.summary || {}),
      displayedCount: mergedOffers.length,
    },
  }
}

export function getRankingPagination(ranking) {
  const summary = ranking?.summary || {}
  const nextOffset = Number(summary.nextOffset)
  const totalCount = Number(summary.totalCount)

  return {
    hasMore: summary.hasMore === true,
    nextOffset: Number.isFinite(nextOffset) && nextOffset >= 0 ? nextOffset : null,
    totalCount: Number.isFinite(totalCount) && totalCount >= 0 ? totalCount : null,
  }
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
