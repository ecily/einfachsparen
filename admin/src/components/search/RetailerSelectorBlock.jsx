import { SectionCard } from '../layout/SectionCard'

export function RetailerSelectorBlock({
  retailers,
  selectedRetailers,
  onToggleRetailer,
  onSelectAllRetailers,
  onClearRetailers,
  loading,
}) {
  return (
    <SectionCard style={{ marginBottom: '1rem' }}>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">1. Geschäfte wählen</p>
          <h2>Wo kaufst du ein?</h2>
          <p>Wähle die Geschäfte aus, die für dich erreichbar sind. Danach kannst du sofort Angebote anzeigen.</p>
        </div>

        {loading ? (
          <p className="status">Supermärkte werden geladen …</p>
        ) : (
          <>
            <div className="quick-action-row">
              <button type="button" className="ghost-button" onClick={onSelectAllRetailers}>
                Alle auswählen
              </button>
              <button type="button" className="ghost-button" onClick={onClearRetailers}>
                Geschäfte zurücksetzen
              </button>
            </div>

            <div className="chip-grid">
              {(retailers || []).map((retailer) => (
                <button
                  key={retailer.retailerKey}
                  type="button"
                  className={`chip ${selectedRetailers.includes(retailer.retailerKey) ? 'chip--active' : ''}`}
                  onClick={() => onToggleRetailer(retailer.retailerKey)}
                >
                  <span>{retailer.retailerName}</span>{' '}
                  <span className="chip__meta">
                    {retailer.activeOffers > 0 ? `(${retailer.activeOffers} Aktionen)` : '(derzeit keine Aktionen)'}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}
