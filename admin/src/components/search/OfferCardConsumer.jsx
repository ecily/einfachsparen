import { ProductImage } from '../layout/ProductImage'
import { getOfferCategoryLabel, shouldDisplayUnitPrice } from '../../utils/offers'
import { formatUnitPrice } from '../../utils/formatting'

function formatPrice(amount, currency = 'EUR') {
  const numericAmount = Number(amount)

  if (!Number.isFinite(numericAmount)) {
    return 'Preis nicht verfügbar'
  }

  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency || 'EUR',
  }).format(numericAmount)
}

function formatShortDate(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('de-AT', {
    day: '2-digit',
    month: '2-digit',
  }).format(date)
}

function isSameDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function getValidityText(offer) {
  const validTo = offer?.validTo ? new Date(offer.validTo) : null

  if (validTo && !Number.isNaN(validTo.getTime())) {
    if (isSameDay(validTo, new Date())) {
      return 'Heute gültig'
    }

    return `Gültig bis ${formatShortDate(validTo)}`
  }

  if (offer?.isActiveNow || offer?.isActiveToday || offer?.status === 'active') {
    return 'Aktuell gültig'
  }

  return ''
}

function normalizeRetailerName(value) {
  const name = String(value || '').trim()

  if (!name) {
    return 'Markt'
  }

  const knownNames = {
    adeg: 'ADEG',
    billa: 'BILLA',
    'billa plus': 'BILLA PLUS',
    billaplus: 'BILLA PLUS',
    eurospar: 'EUROSPAR',
    hofer: 'HOFER',
    interspar: 'INTERSPAR',
    lidl: 'LIDL',
    spar: 'SPAR',
  }
  const normalized = name.toLowerCase().replace(/[^a-zäöüß]+/g, ' ').trim()

  return knownNames[normalized] || name
}

function getShortCategory(offer) {
  const label = String(getOfferCategoryLabel(offer) || '').trim()

  if (!label || label.toLowerCase() === 'ohne kategorie') {
    return ''
  }

  return label
    .split(/[>/|]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(-1)[0]
}

function getPositiveSavingsAmount(offer) {
  const candidates = [
    offer?.savingsAmount,
    offer?.savings?.amount,
    offer?.priceSavings?.amount,
    offer?.discountAmount,
  ]

  for (const candidate of candidates) {
    const numeric = Number(candidate)
    if (Number.isFinite(numeric) && numeric > 0) return numeric
  }

  const oldPrice = Number(offer?.priceBefore?.amount || offer?.priceOriginal?.amount || offer?.priceRegular?.amount)
  const currentPrice = Number(offer?.priceCurrent?.amount)

  if (Number.isFinite(oldPrice) && Number.isFinite(currentPrice) && oldPrice > currentPrice) {
    return oldPrice - currentPrice
  }

  return 0
}

function getReferencePrice(offer) {
  const referencePrice = Number(offer?.priceBefore?.amount || offer?.priceOriginal?.amount || offer?.priceRegular?.amount)
  const currentPrice = Number(offer?.priceCurrent?.amount)

  if (Number.isFinite(referencePrice) && Number.isFinite(currentPrice) && referencePrice > currentPrice) {
    return referencePrice
  }

  return 0
}

function getSavingsPercent(offer, savingsAmount) {
  const referencePrice = getReferencePrice(offer)

  if (!referencePrice || !Number.isFinite(savingsAmount) || savingsAmount <= 0) {
    return 0
  }

  return Math.round((savingsAmount / referencePrice) * 100)
}

function getMinimumQuantityText(offer) {
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

  if (Number.isFinite(quantity) && quantity > 1) {
    return `Ab ${Math.round(quantity)} Stück`
  }

  return ''
}

function getMultiBuyText(offer) {
  const parts = [
    offer?.conditionsText,
    offer?.conditionLabel,
    offer?.effectiveDiscountType,
    offer?.discountMechanic,
    offer?.discountType,
  ]
    .filter(Boolean)
    .join(' ')

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

function getProgramText(offer) {
  const text = String([offer?.conditionsText, offer?.conditionLabel].filter(Boolean).join(' ')).toLowerCase()

  if (text.includes('app')) {
    return 'Nur mit App'
  }

  if (offer?.customerProgramRequired || text.includes('kundenkarte') || text.includes('jö') || text.includes('j ö')) {
    return 'Nur mit Kundenkarte'
  }

  return ''
}

function getConditionTexts(offer) {
  return [...new Set([getMultiBuyText(offer), getMinimumQuantityText(offer), getProgramText(offer)].filter(Boolean))]
}

export function OfferCardConsumer({ offer, onAddToShoppingList, isInShoppingList = false }) {
  const showUnitPrice = shouldDisplayUnitPrice(offer)
  const category = getShortCategory(offer)
  const validity = getValidityText(offer)
  const conditions = getConditionTexts(offer)
  const savingsAmount = getPositiveSavingsAmount(offer)
  const savingsPercent = getSavingsPercent(offer, savingsAmount)
  const referencePrice = getReferencePrice(offer)
  const hasSavings = savingsAmount > 0

  return (
    <article className={`user-card ${hasSavings ? 'user-card--known-savings' : 'user-card--action-price'}`}>
      <ProductImage offerId={offer.id} src={offer.imageUrl} alt={offer.title} />

      <div className="user-card__content">
        <div className="user-card__top">
          <div>
            <div className="user-card__eyebrow">
              <span>{normalizeRetailerName(offer.retailerName)}</span>
            </div>

            <div className="user-card__facts" aria-label="Angebotsdetails">
              {category ? <span>{category}</span> : null}
              {validity ? <span>{validity}</span> : null}
            </div>

            <h3>{offer.title}</h3>
          </div>
        </div>

        {conditions.length > 0 ? (
          <div className="user-card__facts" aria-label="Wichtige Bedingungen">
            {conditions.map((condition) => (
              <span key={condition}>{condition}</span>
            ))}
          </div>
        ) : null}

        <div className="user-card__decision">
          <div className="user-card__price">
            <strong>{formatPrice(offer?.priceCurrent?.amount, offer?.priceCurrent?.currency)}</strong>
            {referencePrice ? <span>statt {formatPrice(referencePrice, offer?.priceCurrent?.currency)}</span> : null}
            {showUnitPrice ? <span>{formatUnitPrice(offer?.normalizedUnitPrice)}</span> : null}
          </div>
        </div>

        {hasSavings ? (
          <div className="offer-savings-box offer-savings-box--known">
            <strong>Du sparst {formatPrice(savingsAmount, offer?.priceCurrent?.currency)}</strong>
            {savingsPercent > 0 ? <span>-{savingsPercent} %</span> : null}
          </div>
        ) : null}

        <button
          type="button"
          className={`shopping-list-button ${isInShoppingList ? 'shopping-list-button--added' : ''}`}
          onClick={() => onAddToShoppingList?.(offer)}
          disabled={isInShoppingList}
        >
          {isInShoppingList ? 'Gemerkt' : 'Merken'}
        </button>
      </div>
    </article>
  )
}
