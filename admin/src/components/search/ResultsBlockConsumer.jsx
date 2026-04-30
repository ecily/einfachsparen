import { SectionCard } from '../layout/SectionCard'
import { LegalInlineNotice } from '../layout/LegalInlineNotice'
import { SavingsNotice } from '../layout/SavingsNotice'
import { ResultsSection } from './ResultsSection'

export function ResultsBlockConsumer({
  rankingLoading,
  hasAppliedRetailerScope,
  safeOffers,
  actionOffers,
  onAddToShoppingList,
  shoppingListIds,
  onNavigate,
}) {
  const visibleOfferCount = safeOffers.length + actionOffers.length

  return (
    <SectionCard>
      <div className="results-block">
        <div className="panel__header">
          <h2>Deine Angebote</h2>
          <p>
            Alle Treffer sind aktuelle Angebote. Eine konkrete Ersparnis zeigen wir nur dort, wo ein Normalpreis
            angegeben ist.
          </p>
        </div>

        {!hasAppliedRetailerScope ? (
          <p className="status">
            Noch keine Suche gestartet. Wähle zuerst deine Geschäfte und tippe dann auf „Angebote anzeigen“.
          </p>
        ) : rankingLoading ? (
          <div className="results-loading">
            <p className="status">
              kaufklug prüft gerade Preise, Gültigkeit und Bedingungen …
            </p>
            <div className="skeleton-grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="skeleton-card" />
              ))}
            </div>
          </div>
        ) : visibleOfferCount === 0 ? (
          <div className="empty-state">
            <h3>Keine passenden Angebote gefunden.</h3>
            <p>Versuche mehr Geschäfte auszuwählen oder alle Produkte anzuzeigen.</p>
          </div>
        ) : (
          <>
            <div className="results-count-box">
              <strong>{visibleOfferCount} aktuelle Angebote gefunden.</strong>
              <span>
                {safeOffers.length} mit bekannter Ersparnis, {actionOffers.length} weitere aktuelle Aktionen.
              </span>
            </div>

            <SavingsNotice onNavigate={onNavigate} />
            <LegalInlineNotice onNavigate={onNavigate} compact />

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
