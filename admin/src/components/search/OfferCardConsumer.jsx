import { ProductImage } from '../layout/ProductImage'
import {
  getDisplayConditionLabels,
  getAvailableComparison,
  getOfferCategoryLabel,
  getReadableQuantityText,
  getSavingsValue,
  getUnitPriceLabel,
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

function normalizeBrandMatchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' und ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
}

function getOfferBrandLabel(offer) {
  return String(
    offer?.brand ||
      offer?.brandName ||
      offer?.normalizedBrand ||
      offer?.productBrand ||
      offer?.manufacturer ||
      ''
  ).replace(/\s+/g, ' ').trim()
}

function removeLeadingBrandToken(title, brandLabel) {
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim()
  const cleanBrand = String(brandLabel || '').replace(/\s+/g, ' ').trim()
  if (!cleanTitle || !cleanBrand) return cleanTitle

  const titleParts = cleanTitle.split(' ')
  const brandPartCount = cleanBrand.split(' ').length
  const normalizedBrand = normalizeBrandMatchText(cleanBrand)
  let removeCount = 0

  while (titleParts.length - removeCount >= brandPartCount) {
    const candidate = titleParts.slice(removeCount, removeCount + brandPartCount).join(' ')
    if (normalizeBrandMatchText(candidate) !== normalizedBrand) break
    removeCount += brandPartCount
  }

  if (removeCount === 0) return cleanTitle

  const remaining = titleParts.slice(removeCount).join(' ').trim()
  return remaining || cleanTitle
}

function getConditionDisplayText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text
}

function isQuantityCondition(value) {
  return /^(ab|bei kauf von|im|in der|in den)\s+\d+|\d+\s*(st[üu]ck|packungen|flaschen|dosen|gl[aä]ser|kg|g|l|ml)/i.test(
    String(value || '')
  )
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
  topDeal = null,
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
  const unitPriceLabel = unitPriceText ? getUnitPriceLabel(offer) : ''
  const comparison = getAvailableComparison(offer)
  const comparisonAlternative = comparison?.offer || null
  const comparisonUnitPriceText = comparisonAlternative
    ? formatUnitPrice(comparisonAlternative.normalizedUnitPrice)
    : ''
  const comparisonUnitPriceLabel = comparisonUnitPriceText
    ? getUnitPriceLabel(comparisonAlternative)
    : ''
  const topDealCurrentUnitPriceText = topDeal?.currentUnitPrice
    ? formatUnitPrice(topDeal.currentUnitPrice)
    : ''
  const topDealReferenceUnitPriceText = topDeal?.referenceUnitPrice
    ? formatUnitPrice(topDeal.referenceUnitPrice)
    : ''
  const comparisonPriceAmount = getNumericAmount(comparisonAlternative?.priceCurrent)
  const comparisonPriceCurrency = getPriceCurrency(comparisonAlternative?.priceCurrent) || 'EUR'
  const comparisonIsCheaper = comparison?.type === 'cheaper_alternative'
  const comparisonLabel = comparison?.label || comparison?.primaryMetricLabel || ''
  const comparisonConditionNote = comparison?.conditionNote
    || (comparisonAlternative?.conditionsText
      ? `Bedingung: ${comparisonAlternative.conditionsText}`
      : 'Bedingung: keine Mindestmenge')
  const retailerTheme = getRetailerTheme(getRetailerColorKey(offer))
  const brandLabel = getOfferBrandLabel(offer)
  const displayTitle = removeLeadingBrandToken(offer?.title, brandLabel)
  const cardClassName = [
    'user-card',
    hasSavings ? 'user-card--known-savings' : 'user-card--action-price',
    className,
  ].filter(Boolean).join(' ')
  const hasActions = enableOfferFeedback || actionSlot || (showShoppingListAction && onAddToShoppingList)

  return (
    <article
      className={cardClassName}
      data-retailer-key={offer.retailerKey || ''}
      style={{
        '--retailer-color': retailerTheme.color,
        '--retailer-text-color': retailerTheme.textColor,
        '--retailer-border-color': retailerTheme.borderColor,
        '--retailer-soft-color': retailerTheme.softColor,
        '--retailer-glow-color': retailerTheme.glowColor,
      }}
    >
      <ProductImage offerId={offer.id} src={offer.imageUrl} alt={offer.title} offer={offer} />

      <div className="user-card__content">
        {topDeal ? (
          <div
            className="user-card__top-deal"
            aria-label={`Top Deal: ${topDeal.discountPercent} Prozent Ersparnis`}
            data-top-deal-mode={topDeal.mode || 'strict'}
          >
            <strong>-{topDeal.discountPercent} %</strong>
            {topDealCurrentUnitPriceText && topDealReferenceUnitPriceText ? (
              <span>{topDealCurrentUnitPriceText} statt {topDealReferenceUnitPriceText}</span>
            ) : null}
            <small>{topDeal.reason}</small>
          </div>
        ) : null}
        <div className="user-card__top">
          <div>
            <div className="user-card__eyebrow">
              <span className="user-card__retailer-badge">{normalizeRetailerName(offer.retailerName)}</span>
            </div>

            {brandLabel ? <p className="user-card__brand">{brandLabel}</p> : null}
            <h3>
              <span>{displayTitle}</span>
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
                  <span className="user-card__reference-label">Referenzpreis:</span> {referenceInfo.labelPrefix} {formatPrice(referenceInfo.amount, currentPriceCurrency)}
                </span>
              ) : null}
              {unitPriceText ? (
                <div className="user-card__unit-price-callout" aria-label={`${unitPriceLabel}: ${unitPriceText}`}>
                  <span className="user-card__unit-price-label">{unitPriceLabel}</span>
                  <span className="user-card__unit-price-value">{unitPriceText}</span>
                </div>
              ) : null}
            </div>
          )}

          {shortConditions.length > 0 || detailedConditions.length > 0 ? (
            <div className="user-card__conditions" aria-label={`Wichtige Angebotsbedingungen: ${fullConditionText}`}>
              <span className="user-card__conditions-label" aria-hidden="true">Kaufbedingung</span>
              {shortConditions.map((condition) => (
                <span
                  className={`user-card__condition-chip ${isQuantityCondition(condition) ? 'user-card__condition-chip--quantity' : ''}`}
                  key={condition}
                  title={condition}
                  aria-label={`Bedingung: ${condition}`}
                >
                  {condition}
                </span>
              ))}
              {detailedConditions.map((condition) => (
                <p
                  className={`user-card__condition-text ${isQuantityCondition(condition) ? 'user-card__condition-text--quantity' : ''}`}
                  key={condition}
                  title={condition}
                >
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

        {comparisonAlternative ? (
          <details className="user-card__comparison" data-comparison-type={comparison.type}>
            <summary>Vergleichen</summary>
            <div className="user-card__comparison-content">
              <strong className={`user-card__comparison-label${comparisonIsCheaper ? ' user-card__comparison-label--cheaper' : ''}`}>
                {comparisonLabel}
              </strong>
              <p className="user-card__comparison-reason">{comparison.reason}</p>
              <p>{comparison.similarityLabel}</p>
              <div className="user-card__comparison-heading">
                <span className="user-card__retailer-badge">
                  {normalizeRetailerName(comparisonAlternative.retailerName)}
                </span>
                <strong>{comparisonAlternative.title}</strong>
              </div>
              <div className="user-card__comparison-price">
                <strong>{formatPrice(comparisonPriceAmount, comparisonPriceCurrency)}</strong>
                <span>{comparisonUnitPriceLabel} {comparisonUnitPriceText}</span>
              </div>
              {comparisonIsCheaper && comparison.unitPriceDeltaLabel ? (
                <p className="user-card__comparison-delta">{comparison.unitPriceDeltaLabel}</p>
              ) : (
                <p className="user-card__comparison-neutral">Ähnliche Alternative, nicht günstiger pro Einheit.</p>
              )}
              <p className="user-card__comparison-condition">{comparisonConditionNote}</p>
              <p className="user-card__comparison-facts">
                {[
                  comparisonAlternative.quantityText,
                  formatValidityLabel(comparisonAlternative),
                  comparisonAlternative.displayCategory || comparisonAlternative.categorySecondary,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </details>
        ) : null}

        {hasActions ? (
          <div className="user-card__actions">
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
            {enableOfferFeedback ? (
              <OfferFeedbackPanel
                offer={offer}
                categories={feedbackCategories}
                pageContext={feedbackPageContext}
              />
            ) : null}
            {actionSlot}
          </div>
        ) : null}
      </div>
    </article>
  )
}
