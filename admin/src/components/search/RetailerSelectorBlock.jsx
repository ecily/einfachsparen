import { getRetailerTheme } from '../../utils/retailerColors'
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
          <p className="eyebrow">1. Gesch&auml;fte w&auml;hlen</p>
          <h2>M&auml;rkte ausw&auml;hlen</h2>
          <p>Tippe einen oder mehrere M&auml;rkte an und zeige aktuelle Angebote an.</p>
        </div>

        {loading ? (
          <p className="status">Superm&auml;rkte werden geladen ...</p>
        ) : (
          <>
            <div className="quick-action-row">
              <button type="button" className="ghost-button" onClick={onSelectAllRetailers}>
                Alle ausw&auml;hlen
              </button>
              <button type="button" className="ghost-button" onClick={onClearRetailers}>
                Gesch&auml;fte zur&uuml;cksetzen
              </button>
            </div>

            <div className="chip-grid">
              {(retailers || []).map((retailer) => {
                const selected = selectedRetailers.includes(retailer.retailerKey)
                const retailerTheme = getRetailerTheme(retailer.retailerKey || retailer.retailerName)

                return (
                  <button
                    key={retailer.retailerKey}
                    type="button"
                    className={`chip retailer-chip ${selected ? 'chip--active retailer-chip--active' : ''}`}
                    style={{
                      '--retailer-color': retailerTheme.color,
                      '--retailer-text-color': retailerTheme.textColor,
                      '--retailer-border-color': retailerTheme.borderColor,
                      '--retailer-soft-color': retailerTheme.softColor,
                    }}
                    aria-pressed={selected}
                    onClick={() => onToggleRetailer(retailer.retailerKey)}
                  >
                    <span>{retailer.retailerName}</span>{' '}
                    <span className="chip__meta">
                      {retailer.activeOffers > 0 ? `(${retailer.activeOffers} Aktionen)` : '(derzeit keine Aktionen)'}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}
