import { ProductImage } from '../layout/ProductImage'
import { buildOfferBadges, getConditionsSummary, getOfferCategoryLabel, getOfferSavingsInfo, isOfferDirectlyComparable, shouldDisplayUnitPrice } from '../../utils/offers'
import { formatCurrencyAmount, formatUnitPrice, formatValidityLabel } from '../../utils/formatting'

export function OfferCardConsumer({ offer, highlightLabel = '', onAddToShoppingList, isInShoppingList = false }) {
  const badges = buildOfferBadges(offer)
  const directlyComparable = isOfferDirectlyComparable(offer)
  const savingsInfo = getOfferSavingsInfo(offer)
  const conditionsSummary = getConditionsSummary(offer)
  const showUnitPrice = shouldDisplayUnitPrice(offer)

  return (
    <article className={`user-card ${directlyComparable ? 'user-card--known-savings' : 'user-card--action-price'}`}>
      <ProductImage offerId={offer.id} src={offer.imageUrl} alt={offer.title} />

      <div className="user-card__content">
        <div className="user-card__top">
          <div>
            <div className="user-card__eyebrow">
              {highlightLabel ? <span>{highlightLabel}</span> : null}
              <span>{offer.retailerName}</span>
              <span>{getOfferCategoryLabel(offer)}</span>
            </div>

            <h3>{offer.title}</h3>
          </div>

          <div className="user-card__price">
            <strong>{formatCurrencyAmount(offer?.priceCurrent?.amount, offer?.priceCurrent?.currency)}</strong>
            {showUnitPrice ? <span>{formatUnitPrice(offer?.normalizedUnitPrice)}</span> : null}
          </div>
        </div>

        <div className="chip-grid">
          {badges.map((badge) => (
            <span key={`${offer.id}-${badge}`} className="chip chip--static chip--subtle">
              {badge}
            </span>
          ))}
        </div>

        <div className={`offer-savings-box offer-savings-box--${savingsInfo.type}`}>
          <strong>{savingsInfo.label}</strong>
          <span>{savingsInfo.description}</span>
        </div>

        <div className="user-card__facts">
          <span>{formatValidityLabel(offer)}</span>
          <span>{offer.quantityText || 'Menge im Angebot beachten'}</span>
        </div>

        <div className="user-card__highlights">
          <div className={`highlight-pill ${directlyComparable ? 'highlight-pill--price' : ''}`}>
            <span>{savingsInfo.type === 'known' ? 'Bekannte Ersparnis' : 'Preisart'}</span>
            <strong>{savingsInfo.shortLabel}</strong>
          </div>

          <div className="highlight-pill">
            <span>Bedingungen</span>
            <strong>{conditionsSummary}</strong>
          </div>

          <div className="highlight-pill">
            <span>{showUnitPrice ? 'Einheitspreis' : 'Hinweis'}</span>
            <strong>{showUnitPrice ? formatUnitPrice(offer?.normalizedUnitPrice) : 'Normalpreis nicht angegeben'}</strong>
          </div>
        </div>

        {offer?.conditionsText ? <p className="user-card__condition">{offer.conditionsText}</p> : null}

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
