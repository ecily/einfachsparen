import { ProductImage } from '../layout/ProductImage'
import { getDisplayConditionInfo, getMinimumQuantityLabel, getOfferCategoryLabel, getOfferSavingsInfo, getReadableQuantityText, isOfferDirectlyComparable, shouldDisplayUnitPrice } from '../../utils/offers'
import { formatCurrencyAmount, formatUnitPrice, formatValidityLabel } from '../../utils/formatting'

export function OfferCardConsumer({ offer, highlightLabel = '', onAddToShoppingList, isInShoppingList = false }) {
  const directlyComparable = isOfferDirectlyComparable(offer)
  const savingsInfo = getOfferSavingsInfo(offer)
  const showUnitPrice = shouldDisplayUnitPrice(offer)
  const minimumQuantityLabel = getMinimumQuantityLabel(offer)
  const conditionInfo = getDisplayConditionInfo(offer)
  const readableQuantityText = getReadableQuantityText(offer)

  return (
    <article className={`user-card ${directlyComparable ? 'user-card--known-savings' : 'user-card--action-price'}`}>
      <ProductImage offerId={offer.id} src={offer.imageUrl} alt={offer.title} />

      <div className="user-card__content">
        <div className="user-card__top">
          <div>
            <div className="user-card__eyebrow">
              {highlightLabel ? <span>{highlightLabel}</span> : null}
              <span>{offer.retailerName}</span>
            </div>

            <p className="user-card__category">{getOfferCategoryLabel(offer)}</p>
            <p className="user-card__validity">{formatValidityLabel(offer)}</p>
            <h3>{offer.title}</h3>
          </div>
        </div>

        <div className="user-card__decision">
          {minimumQuantityLabel ? <span className="minimum-quantity-badge">{minimumQuantityLabel}</span> : null}
          <div className="user-card__price">
            <strong>{formatCurrencyAmount(offer?.priceCurrent?.amount, offer?.priceCurrent?.currency)}</strong>
            <span>Aktionspreis</span>
            {showUnitPrice ? <span>{formatUnitPrice(offer?.normalizedUnitPrice)}</span> : null}
          </div>
        </div>

        <div className={`offer-savings-box offer-savings-box--${savingsInfo.type}`}>
          <strong>{savingsInfo.label}</strong>
          <span>{savingsInfo.description}</span>
        </div>

        {readableQuantityText || conditionInfo ? (
          <div className="user-card__facts">
            {readableQuantityText ? <span>{readableQuantityText}</span> : null}
            {conditionInfo ? <span>{conditionInfo}</span> : null}
          </div>
        ) : null}

        <button
          type="button"
          className={`shopping-list-button ${isInShoppingList ? 'shopping-list-button--added' : ''}`}
          onClick={() => onAddToShoppingList?.(offer)}
          disabled={isInShoppingList}
        >
          {isInShoppingList ? 'Bereits gemerkt' : 'Merken'}
        </button>
      </div>
    </article>
  )
}
