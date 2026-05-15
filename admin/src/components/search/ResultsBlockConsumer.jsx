import { SectionCard } from '../layout/SectionCard'
import { ResultsSection } from './ResultsSection'

export function ResultsBlockConsumer({
  rankingLoading,
  hasAppliedRetailerScope,
  safeOffers,
  actionOffers,
  onAddToShoppingList,
  shoppingListIds,
}) {
  const visibleOfferCount = safeOffers.length + actionOffers.length

  return (
    <SectionCard>
      <div className="results-block">
        <div className="panel__header">
          <h2>Angebote aus deiner Auswahl</h2>
          <p>Aktuelle Treffer aus den gew&auml;hlten M&auml;rkten und Kategorien.</p>
        </div>

        {!hasAppliedRetailerScope ? (
          <div className="empty-state">
            <h3>W&auml;hle einen Markt oder eine Kategorie, um passende Angebote zu sehen.</h3>
            <p>Zum Start reicht ein Markt. Kategorien kannst du danach optional eingrenzen.</p>
          </div>
        ) : rankingLoading ? (
          <div className="results-loading">
            <p className="status">kaufklug pr&uuml;ft gerade Preise, G&uuml;ltigkeit und Bedingungen ...</p>
            <div className="skeleton-grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="skeleton-card" />
              ))}
            </div>
          </div>
        ) : visibleOfferCount === 0 ? (
          <div className="empty-state">
            <h3>Aktuell keine passenden Angebote gefunden.</h3>
            <p>Bitte pr&uuml;fe sp&auml;ter erneut oder &auml;ndere die Auswahl.</p>
          </div>
        ) : (
          <>
            <div className="results-count-box">
              <strong>{visibleOfferCount} aktuelle Angebote gefunden.</strong>
              <span>
                {safeOffers.length} mit bekannter Ersparnis, {actionOffers.length} weitere aktuelle Aktionen.
              </span>
            </div>

            <ResultsSection
              title="Angebote mit bekannter Ersparnis"
              subtitle="Bei diesen Angeboten ist ein Normalpreis angegeben."
              offers={safeOffers}
              highlightPrefix="Angebot"
              onAddToShoppingList={onAddToShoppingList}
              shoppingListIds={shoppingListIds}
            />

            <ResultsSection
              title="Weitere aktuelle Aktionen"
              subtitle="Diese Produkte sind aktuelle Aktionen. Der Normalpreis ist nicht angegeben."
              offers={actionOffers}
              highlightPrefix="Aktion"
              onAddToShoppingList={onAddToShoppingList}
              shoppingListIds={shoppingListIds}
            />
          </>
        )}
      </div>
    </SectionCard>
  )
}
