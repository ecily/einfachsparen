import { SectionCard } from '../layout/SectionCard'

export function ActionBlock({
  canSearch,
  selectedRetailerCount,
  selectedCategoryCount,
  onApplySearch,
  onReset,
  searching,
}) {
  return (
    <SectionCard style={{ marginBottom: '1rem' }}>
      <div className="selection-block selection-block--action">
        <div className="selection-block__header">
          <p className="eyebrow">Angebote</p>
          <h2>Auswahl anzeigen</h2>
          <p>M&auml;rkte reichen aus. Kategorien sind optional und grenzen die Treffer ein.</p>
        </div>

        <div className="selection-summary-grid selection-summary-grid--compact">
          <div className="selection-summary-card">
            <strong>M&auml;rkte</strong>
            <span>{selectedRetailerCount > 0 ? `${selectedRetailerCount} ausgewählt` : 'Keine Auswahl'}</span>
          </div>

          <div className="selection-summary-card">
            <strong>Kategorien</strong>
            <span>{selectedCategoryCount > 0 ? `${selectedCategoryCount} ausgewählt` : 'Alle Kategorien'}</span>
          </div>
        </div>

        <div className="action-button-row">
          <button
            type="button"
            className="primary-action-button"
            onClick={onApplySearch}
            disabled={!canSearch || searching}
          >
            {searching ? 'Angebote werden geladen ...' : 'Angebote anzeigen'}
          </button>

          <button type="button" className="ghost-button" onClick={onReset}>
            Auswahl zur&uuml;cksetzen
          </button>
        </div>
      </div>
    </SectionCard>
  )
}
