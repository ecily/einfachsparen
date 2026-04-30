import { SectionCard } from '../layout/SectionCard'

export function ActionBlock({
  canSearch,
  selectedRetailerCount,
  selectedCategoryCount,
  onApplySearch,
  onReset,
  hasPendingChanges,
  searching,
}) {
  return (
    <SectionCard style={{ marginBottom: '1rem' }}>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">2. Angebote anzeigen</p>
          <h2>Deine Auswahl ist bereit.</h2>
          <p>Geschäfte reichen aus. Produktfilter sind optional und können die Ergebnisse danach weiter eingrenzen.</p>
        </div>

        <div className="selection-summary-grid">
          <div className="selection-summary-card">
            <strong>Geschäfte</strong>
            <span>{selectedRetailerCount > 0 ? `${selectedRetailerCount} ausgewählt` : 'Keine Auswahl'}</span>
          </div>

          <div className="selection-summary-card">
            <strong>Produktfilter</strong>
            <span>{selectedCategoryCount > 0 ? `${selectedCategoryCount} ausgewählt` : 'Optional: alle anzeigen'}</span>
          </div>

          <div className={`selection-summary-card ${hasPendingChanges ? 'selection-summary-card--ready' : ''}`}>
            <strong>Status</strong>
            <span>{hasPendingChanges ? 'Neue Auswahl bereit' : 'Aktuelle Auswahl geladen'}</span>
          </div>
        </div>

        <div className="action-button-row">
          <button
            type="button"
            className="primary-action-button"
            onClick={onApplySearch}
            disabled={!canSearch || searching}
          >
            {searching ? 'Angebote werden geladen …' : 'Angebote anzeigen'}
          </button>

          <button type="button" className="ghost-button" onClick={onReset}>
            Auswahl zurücksetzen
          </button>
        </div>
      </div>
    </SectionCard>
  )
}
