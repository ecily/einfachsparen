import { ProductImage } from '../layout/ProductImage'
import {
  getDisplayConditionLabels,
  getOfferCategoryLabel,
  getReadableQuantityText,
  getSavingsValue,
  normalizeRetailerKey,
  shouldDisplayUnitPrice,
} from '../../utils/offers'
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

function getCompactConditionText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()

  if (text.length <= 68) {
    return text
  }

  return `${text.slice(0, 65).trim()}...`
}

function getVisibleConditionInfo(conditions) {
  const visibleConditions = []
  const hiddenConditions = []

  for (const condition of conditions) {
    const compactCondition = getCompactConditionText(condition)

    if (visibleConditions.length < 2 && compactCondition === condition) {
      visibleConditions.push(condition)
    } else {
      hiddenConditions.push(condition)
    }
  }

  const hiddenConditionsLabel = hiddenConditions.length === 1 ? 'Weitere Bedingung anzeigen' : 'Bedingungen anzeigen'

  return {
    visibleConditions,
    hiddenConditions,
    hiddenConditionsLabel,
    fullText: conditions.join(' / '),
  }
}

export function OfferCardConsumer({ offer, onAddToShoppingList, isInShoppingList = false }) {
  const showUnitPrice = shouldDisplayUnitPrice(offer)
  const category = getShortCategory(offer)
  const validity = formatValidityLabel(offer)
  const conditions = getDisplayConditionLabels(offer)
  const { visibleConditions, hiddenConditions, hiddenConditionsLabel, fullText: fullConditionText } = getVisibleConditionInfo(conditions)
  const quantityText = getReadableQuantityText(offer)
  const savingsAmount = getSavingsValue(offer)
  const referenceInfo = getReferenceInfo(offer)
  const savingsPercent = getSavingsPercent(offer)
  const hasSavings = savingsAmount > 0 && referenceInfo.amount > 0
  const currentPriceAmount = getNumericAmount(offer?.priceCurrent ?? offer?.price)
  const currentPriceCurrency = getPriceCurrency(offer?.priceCurrent) || getPriceCurrency(offer?.price) || 'EUR'
  const unitPriceText = showUnitPrice ? formatUnitPrice(offer?.normalizedUnitPrice) : ''
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

            <h3>
              <span>{offer.title}</span>
              {quantityText ? <span className="user-card__title-quantity"> · {quantityText}</span> : null}
            </h3>

            <div className="user-card__facts" aria-label="Angebotsdetails">
              {category ? <span>{category}</span> : null}
              {validity ? <span>{validity}</span> : null}
            </div>
          </div>
        </div>

        <div className="user-card__decision">
          {visibleConditions.length > 0 || hiddenConditions.length > 0 ? (
            <div className="user-card__conditions" aria-label={`Wichtige Angebotsbedingungen: ${fullConditionText}`}>
              {visibleConditions.map((condition) => (
                <span className="user-card__condition-chip" key={condition} title={condition} aria-label={`Bedingung: ${condition}`}>
                  {getCompactConditionText(condition)}
                </span>
              ))}
              {hiddenConditions.length > 0 ? (
                <details className="user-card__condition-details">
                  <summary>{hiddenConditionsLabel}</summary>
                  <div className="user-card__condition-details-list">
                    {hiddenConditions.map((condition) => (
                      <span className="user-card__condition-chip" key={condition} title={condition}>
                        {condition}
                      </span>
                    ))}
                  </div>
                </details>
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
            {unitPriceText ? <span className="user-card__unit-price-badge">{unitPriceText}</span> : null}
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
