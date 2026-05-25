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
import { formatRetailerName } from '../../utils/retailers'
import { OfferFeedbackPanel } from './OfferFeedbackPanel'

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
  return formatRetailerName(value)
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

function getPromotionPercentLabel(offer) {
  const upToPercent = Number(offer?.discountUpToPercent)
  const discountPercent = Number(offer?.discountPercent)

  if (Number.isFinite(upToPercent) && upToPercent > 0) {
    return `bis zu -${Math.round(upToPercent)} %`
  }

  if (Number.isFinite(discountPercent) && discountPercent > 0) {
    return `-${Math.round(discountPercent)} %`
  }

  return ''
}

function isPriceOptionalPromotion(offer, currentPriceAmount) {
  const offerType = String(offer?.offerType || '')
  return (
    ['category-promotion', 'percent-promotion'].includes(offerType) ||
    (getPromotionPercentLabel(offer) && !Number.isFinite(currentPriceAmount))
  )
}

function getPromotionScopeLabel(offer) {
  return String(offer?.promotionScope || offer?.appliesToCategory || '').replace(/-/g, ' ').trim()
}

const SHORT_CONDITION_MAX_LENGTH = 68

function getConditionDisplayText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text
}

function getVisibleConditionInfo(rawConditions) {
  const shortConditions = []
  const detailedConditions = []
  const seenConditions = new Set()

  const conditions = rawConditions
    .map((condition) => getConditionDisplayText(condition))
    .filter((condition) => {
      const key = condition.toLowerCase()
      if (!condition || seenConditions.has(key)) return false
      seenConditions.add(key)
      return true
    })

  for (const condition of conditions) {
    if (condition.length <= SHORT_CONDITION_MAX_LENGTH) {
      shortConditions.push(condition)
    } else {
      detailedConditions.push(condition)
    }
  }

  return {
    shortConditions,
    detailedConditions,
    fullText: conditions.join(' / '),
  }
}

export function OfferCardConsumer({
  offer,
  onAddToShoppingList,
  isInShoppingList = false,
  showShoppingListAction = true,
  actionSlot = null,
  className = '',
  feedbackCategories = [],
  feedbackPageContext = {},
  enableOfferFeedback = true,
}) {
  const showUnitPrice = shouldDisplayUnitPrice(offer)
  const category = getShortCategory(offer)
  const validity = formatValidityLabel(offer)
  const conditions = getDisplayConditionLabels(offer)
  const { shortConditions, detailedConditions, fullText: fullConditionText } = getVisibleConditionInfo(conditions)
  const quantityText = getReadableQuantityText(offer)
  const savingsAmount = getSavingsValue(offer)
  const referenceInfo = getReferenceInfo(offer)
  const savingsPercent = getSavingsPercent(offer)
  const snapshotSavingsAmount = Number(offer?.savingsAmount)
  const snapshotHasSavings = offer?.hasKnownSavings === true && Number.isFinite(snapshotSavingsAmount) && snapshotSavingsAmount > 0
  const displaySavingsAmount = savingsAmount > 0 ? savingsAmount : snapshotHasSavings ? snapshotSavingsAmount : 0
  const displaySavingsIsApproximate = savingsAmount > 0 ? referenceInfo.isApproximate : Boolean(offer?.savingsIsApproximate)
  const hasSavings = displaySavingsAmount > 0 && (referenceInfo.amount > 0 || snapshotHasSavings)
  const currentPriceAmount = getNumericAmount(offer?.priceCurrent ?? offer?.price)
  const currentPriceCurrency = getPriceCurrency(offer?.priceCurrent) || getPriceCurrency(offer?.price) || 'EUR'
  const promotionPercentLabel = getPromotionPercentLabel(offer)
  const priceOptionalPromotion = isPriceOptionalPromotion(offer, currentPriceAmount)
  const promotionScopeLabel = getPromotionScopeLabel(offer)
  const unitPriceText = showUnitPrice ? formatUnitPrice(offer?.normalizedUnitPrice) : ''
  const retailerTheme = getRetailerTheme(getRetailerColorKey(offer))
  const cardClassName = [
    'user-card',
    hasSavings ? 'user-card--known-savings' : 'user-card--action-price',
    className,
  ].filter(Boolean).join(' ')
  const hasActions = enableOfferFeedback || actionSlot || (showShoppingListAction && onAddToShoppingList)

  return (
    <article
      className={cardClassName}
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
            {quantityText ? <p className="user-card__title-quantity">{quantityText}</p> : null}

          </div>
        </div>

        <div className="user-card__decision">
          {priceOptionalPromotion ? (
            <div className="user-card__price user-card__price--promotion">
              <div className="user-card__price-row">
                <strong>{promotionPercentLabel || 'Prozentaktion'}</strong>
                <span className="user-card__action-price-badge">Kategorieaktion</span>
              </div>
              {promotionScopeLabel ? <span className="user-card__reference-price">{promotionScopeLabel}</span> : null}
            </div>
          ) : (
            <div className="user-card__price">
              <div className="user-card__price-row">
                <strong>{formatPrice(currentPriceAmount, currentPriceCurrency)}</strong>
                {hasSavings && savingsPercent > 0 ? <span className="user-card__discount-badge">-{savingsPercent} %</span> : null}
                {hasSavings ? (
                  <span className="user-card__savings-chip">
                    Spart {displaySavingsIsApproximate ? 'ca. ' : ''}{formatPrice(displaySavingsAmount, currentPriceCurrency)}
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
          )}

          {shortConditions.length > 0 || detailedConditions.length > 0 ? (
            <div className="user-card__conditions" aria-label={`Wichtige Angebotsbedingungen: ${fullConditionText}`}>
              {shortConditions.map((condition) => (
                <span className="user-card__condition-chip" key={condition} title={condition} aria-label={`Bedingung: ${condition}`}>
                  {condition}
                </span>
              ))}
              {detailedConditions.map((condition) => (
                <p className="user-card__condition-text" key={condition} title={condition}>
                  {condition}
                </p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="user-card__facts" aria-label="Angebotsdetails">
          {validity ? <span className="user-card__meta-pill user-card__meta-pill--validity">{validity}</span> : null}
          {category ? <span className="user-card__meta-pill user-card__meta-pill--category">{category}</span> : null}
        </div>

        {hasActions ? (
          <div className="user-card__actions">
            {enableOfferFeedback ? (
              <OfferFeedbackPanel
                offer={offer}
                categories={feedbackCategories}
                pageContext={feedbackPageContext}
              />
            ) : null}
            {showShoppingListAction && onAddToShoppingList ? (
              <button
                type="button"
                className={`shopping-list-button ${isInShoppingList ? 'shopping-list-button--added' : ''}`}
                onClick={() => onAddToShoppingList?.(offer)}
                disabled={isInShoppingList}
              >
                {isInShoppingList ? 'Auf der Einkaufsliste' : 'Auf die Einkaufsliste'}
              </button>
            ) : null}
            {actionSlot}
          </div>
        ) : null}
      </div>
    </article>
  )
}
