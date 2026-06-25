import { Fragment, useMemo } from 'react'
import { getRetailerTheme } from '../../utils/retailerColors'
import { isLimitedCoverageRetailer } from '../../utils/retailerCoverage'
import { shouldSeparateRetailerGroups, sortRetailersByDisplayGroup } from '../../utils/retailers'
import { SectionCard } from '../layout/SectionCard'

export function RetailerSelectorBlock({
  retailers,
  selectedRetailers,
  onToggleRetailer,
  onSelectAllRetailers,
  onClearRetailers,
  loading,
}) {
  const groupedRetailers = useMemo(() => sortRetailersByDisplayGroup(retailers || []), [retailers])

  return (
    <SectionCard style={{ marginBottom: '1rem' }}>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">Schritt 1</p>
          <h2>M&auml;rkte ausw&auml;hlen</h2>
          <p>Tippe einen oder mehrere M&auml;rkte an. Die Händlerfarben bleiben zur Orientierung sichtbar.</p>
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
              {groupedRetailers.map((retailer, index, retailerList) => {
                const selected = selectedRetailers.includes(retailer.retailerKey)
                const retailerTheme = getRetailerTheme(retailer.retailerKey || retailer.retailerName)
                const limitedCoverage = isLimitedCoverageRetailer(retailer.retailerKey)
                const separatorKey = retailer.retailerKey || retailer.retailerName
                const nextRetailer = retailerList[index + 1]
                const showGroupSeparator = shouldSeparateRetailerGroups(
                  retailer.retailerKey || retailer.retailerName,
                  nextRetailer?.retailerKey || nextRetailer?.retailerName
                )

                return (
                  <Fragment key={separatorKey}>
                    <button
                      type="button"
                      className={`chip retailer-chip ${selected ? 'chip--active retailer-chip--active' : ''}`}
                      style={{
                        '--retailer-color': retailerTheme.color,
                        '--retailer-text-color': retailerTheme.textColor,
                        '--retailer-border-color': retailerTheme.borderColor,
                        '--retailer-soft-color': retailerTheme.softColor,
                      }}
                      aria-pressed={selected}
                      aria-label={`${retailer.retailerName} ${selected ? 'ausgewählt' : 'auswählen'}`}
                      onClick={() => onToggleRetailer(retailer.retailerKey)}
                    >
                      <span className="retailer-chip__dot" aria-hidden="true" />
                      <span className="retailer-chip__label">{retailer.retailerName}</span>
                      <span className="retailer-chip__meta chip__meta">
                        {retailer.activeOffers > 0 ? `${retailer.activeOffers} Aktionen` : 'derzeit keine Aktionen'}
                      </span>
                      {limitedCoverage ? (
                        <span className="retailer-chip__coverage">Beta</span>
                      ) : null}
                    </button>
                    {showGroupSeparator ? <span className="retailer-chip-group-separator" aria-hidden="true" /> : null}
                  </Fragment>
                )
              })}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}
