import { ProductImage } from '../layout/ProductImage'
import { getOfferCategoryLabel, getReadableQuantityText, getSavingsValue, normalizeRetailerKey, shouldDisplayUnitPrice } from '../../utils/offers'
import { formatUnitPrice, formatValidityLabel } from '../../utils/formatting'
import { getRetailerTheme } from '../../utils/retailerColors'

function formatPrice(amount, currency = 'EUR') {
  if (amount === null || amount === undefined || amount === '') {
    return 'Preis nicht verfügbar'
  }

  const numericAmount = Number(amount)

  if (!Number.isFinite(numericAmount)) {
    return 'Preis nicht verfügbar'
  }

  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency || 'EUR',
  }).format(numericAmount)
}

function getNumericAmount(value) {
  if (value && typeof value === 'object') {
    return getNumericAmount(value.amount ?? value.value ?? value.price)
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function getPriceCurrency(value) {
  return value && typeof value === 'object' ? value.currency : ''
}

function getRetailerColorKey(offer) {
  return offer?.retailerKey || normalizeRetailerKey(offer?.retailerName)
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

function getReferenceInfo(offer) {
  if (offer?.referencePrice?.allowsSavings !== true) {
    return {
      amount: 0,
      type: 'none',
      isApproximate: false,
      labelPrefix: '',
    }
  }

  const referencePrice = getNumericAmount(offer?.referencePrice?.amount || offer?.priceReference?.amount)
  const currentPrice = getNumericAmount(offer?.priceCurrent ?? offer?.price)

  if (Number.isFinite(referencePrice) && Number.isFinite(currentPrice) && referencePrice > currentPrice) {
    const type = String(offer?.referencePrice?.type || '')
    const isApproximate = Boolean(offer?.referencePrice?.isApproximate || offer?.savings?.isApproximate)

    return {
      amount: referencePrice,
      type,
      isApproximate,
      labelPrefix: type === 'external_comparison' ? 'woanders ca.'
        : isApproximate ? 'Normalpreis ca.'
          : 'statt',
    }
  }

  return {
    amount: 0,
    type: 'none',
    isApproximate: false,
    labelPrefix: '',
  }
}

function getSavingsPercent(offer) {
  const percent = Number(offer?.savings?.percent ?? offer?.savingsPercent)
  return Number.isFinite(percent) && percent > 0 ? Math.round(percent) : 0
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

function normalizeConditionKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:bedingung|aktion|angebot|nur|mit|bei)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function conditionIncludesText(text, candidate) {
  const normalizedText = normalizeConditionKey(text)
  const normalizedCandidate = normalizeConditionKey(candidate)

  return Boolean(normalizedText && normalizedCandidate && normalizedText.includes(normalizedCandidate))
}

function isRedundantCondition(candidate, existingConditions) {
  const candidateKey = normalizeConditionKey(candidate)

  if (!candidateKey) return true

  return existingConditions.some((existingCondition) => {
    const existingKey = normalizeConditionKey(existingCondition)

    return (
      existingKey === candidateKey ||
      existingKey.includes(candidateKey) ||
      candidateKey.includes(existingKey)
    )
  })
}

function getConditionTexts(offer) {
  const rawCondition = String(offer?.conditionsText || '').replace(/\s+/g, ' ').trim()
  const rawLabel = String(offer?.conditionLabel || '').replace(/\s+/g, ' ').trim()
  const derivedConditions = [
    getProgramText(offer),
    getMultiBuyText(offer),
    getMinimumQuantityText(offer),
  ].filter(Boolean)
  const conditions = []

  for (const condition of derivedConditions) {
    if (rawCondition && conditionIncludesText(rawCondition, condition)) continue
    if (rawLabel && conditionIncludesText(rawLabel, condition)) continue
    if (!isRedundantCondition(condition, conditions)) conditions.push(condition)
  }

  for (const condition of [rawCondition, rawLabel]) {
    if (condition && !isRedundantCondition(condition, conditions)) conditions.push(condition)
  }

  return conditions
}

function getCompactConditionText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()

  if (text.length <= 68) {
    return text
  }

  return `${text.slice(0, 65).trim()}...`
}

function getVisibleConditionInfo(conditions) {
  const visibleConditions = conditions.slice(0, 2)
  const hiddenConditions = conditions.slice(2)

  return {
    visibleConditions,
    hiddenConditions,
    fullText: conditions.join(' / '),
  }
}

export function OfferCardConsumer({ offer, onAddToShoppingList, isInShoppingList = false }) {
  const showUnitPrice = shouldDisplayUnitPrice(offer)
  const category = getShortCategory(offer)
  const validity = formatValidityLabel(offer)
  const conditions = getConditionTexts(offer)
  const { visibleConditions, hiddenConditions, fullText: fullConditionText } = getVisibleConditionInfo(conditions)
  const quantityText = getReadableQuantityText(offer)
  const savingsAmount = getSavingsValue(offer)
  const referenceInfo = getReferenceInfo(offer)
  const savingsPercent = getSavingsPercent(offer)
  const hasSavings = savingsAmount > 0 && referenceInfo.amount > 0
  const currentPriceAmount = getNumericAmount(offer?.priceCurrent ?? offer?.price)
  const currentPriceCurrency = getPriceCurrency(offer?.priceCurrent) || getPriceCurrency(offer?.price) || 'EUR'
  const unitPriceText = showUnitPrice ? formatUnitPrice(offer?.normalizedUnitPrice) : ''
  const quantityUnitText = [quantityText, unitPriceText].filter(Boolean).join(' · ')
  const retailerTheme = getRetailerTheme(getRetailerColorKey(offer))

  return (
    <article
      className={`user-card ${hasSavings ? 'user-card--known-savings' : 'user-card--action-price'}`}
      style={{
        '--retailer-color': retailerTheme.color,
        '--retailer-text-color': retailerTheme.textColor,
        '--retailer-border-color': retailerTheme.borderColor,
        '--retailer-soft-color': retailerTheme.softColor,
        '--retailer-glow-color': retailerTheme.glowColor,
      }}
    >
      <ProductImage offerId={offer.id} src={offer.imageUrl} alt={offer.title} />

      <div className="user-card__content">
        <div className="user-card__top">
          <div>
            <div className="user-card__eyebrow">
              <span className="user-card__retailer-badge">{normalizeRetailerName(offer.retailerName)}</span>
            </div>

            <div className="user-card__facts" aria-label="Angebotsdetails">
              {category ? <span>{category}</span> : null}
              {validity ? <span>{validity}</span> : null}
            </div>

            <h3>{offer.title}</h3>
          </div>
        </div>

        <div className="user-card__decision">
          {visibleConditions.length > 0 ? (
            <div className="user-card__conditions" aria-label={`Wichtige Angebotsbedingungen: ${fullConditionText}`}>
              {visibleConditions.map((condition) => (
                <span className="user-card__condition-chip" key={condition} title={condition} aria-label={`Bedingung: ${condition}`}>
                  {getCompactConditionText(condition)}
                </span>
              ))}
              {hiddenConditions.length > 0 ? (
                <span
                  className="user-card__condition-chip user-card__condition-chip--more"
                  title={hiddenConditions.join(' / ')}
                  aria-label={`Weitere Bedingungen: ${hiddenConditions.join(' / ')}`}
                >
                  +{hiddenConditions.length} weitere
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="user-card__price">
            <div className="user-card__price-row">
              <strong>{formatPrice(currentPriceAmount, currentPriceCurrency)}</strong>
              {hasSavings && savingsPercent > 0 ? <span className="user-card__discount-badge">-{savingsPercent} %</span> : null}
              {hasSavings ? (
                <span className="user-card__savings-chip">
                  Spart {referenceInfo.isApproximate ? 'ca. ' : ''}{formatPrice(savingsAmount, currentPriceCurrency)}
                </span>
              ) : (
                <span className="user-card__action-price-badge">Aktionspreis</span>
              )}
            </div>
            {referenceInfo.amount ? (
              <span className="user-card__reference-price">
                {referenceInfo.labelPrefix} {formatPrice(referenceInfo.amount, currentPriceCurrency)}
              </span>
            ) : null}
            {quantityUnitText ? <span className="user-card__quantity-unit">{quantityUnitText}</span> : null}
          </div>
        </div>

        <div className="user-card__actions">
          <button
            type="button"
            className={`shopping-list-button ${isInShoppingList ? 'shopping-list-button--added' : ''}`}
            onClick={() => onAddToShoppingList?.(offer)}
            disabled={isInShoppingList}
          >
            {isInShoppingList ? 'Auf der Einkaufsliste' : 'Auf die Einkaufsliste'}
          </button>
        </div>
      </div>
    </article>
  )
}
