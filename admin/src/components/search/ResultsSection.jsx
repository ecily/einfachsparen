import { OfferCardConsumer } from './OfferCardConsumer'
import { getOfferStableId } from '../../utils/offers'

export function ResultsSection({ title, subtitle, offers, highlightPrefix, onAddToShoppingList, shoppingListIds }) {
  if (!offers.length) return null

  return (
    <div className="results-section">
      <div className="panel__header">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>

      <div className="user-results">
        {offers.map((offer, index) => (
          <OfferCardConsumer
            key={offer.id}
            offer={offer}
            highlightLabel={`${highlightPrefix} ${index + 1}`}
            onAddToShoppingList={onAddToShoppingList}
            isInShoppingList={shoppingListIds.has(getOfferStableId(offer))}
          />
        ))}
      </div>
    </div>
  )
}
