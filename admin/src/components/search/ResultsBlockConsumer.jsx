import { SectionCard } from '../layout/SectionCard'
import { ResultsSection } from './ResultsSection'

export function ResultsBlockConsumer({
  rankingLoading,
  rankingLoadingMore,
  pagination,
  hasAppliedRetailerScope,
  safeOffers,
  actionOffers,
  onAddToShoppingList,
  onLoadMoreOffers,
  shoppingListIds,
  categories = [],
  feedbackPageContext = {},
}) {
  const visibleOfferCount = safeOffers.length + actionOffers.length
  const totalCount = pagination?.totalCount || 0

  return (
    <SectionCard>
      <div className="results-block" aria-busy={rankingLoading || rankingLoadingMore ? 'true' : 'false'}>
        <div className="panel__header">
          <p className="eyebrow">Ergebnisse</p>
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
            <div className="browse-loading-status" role="status" aria-live="polite">
              <span className="browse-loading-status__spinner" aria-hidden="true" />
              <span>Aktuelle Angebote werden geladen &hellip;</span>
            </div>
            <div className="skeleton-grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="skeleton-card" />
              ))}
            </div>
          </div>
        ) : visibleOfferCount === 0 ? (
          <div className="empty-state">
            <h3>Aktuell keine passenden Angebote gefunden.</h3>
            <p>Bitte pr&uuml;fe sp&auml;ter erneut oder w&auml;hle allgemeinere M&auml;rkte und Kategorien.</p>
          </div>
        ) : (
          <>
            <div className="results-count-box">
              <strong>
                {totalCount > visibleOfferCount
                  ? `${visibleOfferCount} von ${totalCount} aktuellen Angeboten angezeigt.`
                  : `${visibleOfferCount} aktuelle Angebote gefunden.`}
              </strong>
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
              feedbackCategories={categories}
              feedbackPageContext={{
                ...feedbackPageContext,
                activeFilters: {
                  ...(feedbackPageContext.activeFilters || {}),
                  resultGroup: 'known_savings',
                },
              }}
              resultPositionOffset={0}
            />

            <ResultsSection
              title="Weitere aktuelle Aktionen"
              subtitle="Diese Produkte sind aktuelle Aktionen. Der Normalpreis ist nicht angegeben."
              offers={actionOffers}
              highlightPrefix="Aktion"
              onAddToShoppingList={onAddToShoppingList}
              shoppingListIds={shoppingListIds}
              feedbackCategories={categories}
              feedbackPageContext={{
                ...feedbackPageContext,
                activeFilters: {
                  ...(feedbackPageContext.activeFilters || {}),
                  resultGroup: 'action_price',
                },
              }}
              resultPositionOffset={safeOffers.length}
            />

            {pagination?.hasMore ? (
              <div className="load-more-results" role="status" aria-live="polite">
                <button
                  type="button"
                  className="load-more-results__button"
                  onClick={onLoadMoreOffers}
                  disabled={rankingLoadingMore}
                  aria-busy={rankingLoadingMore ? 'true' : 'false'}
                >
                  {rankingLoadingMore ? (
                    <>
                      <span className="browse-loading-status__spinner" aria-hidden="true" />
                      <span>Weitere Angebote werden geladen &hellip;</span>
                    </>
                  ) : (
                    'Weitere Angebote laden'
                  )}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </SectionCard>
  )
}
