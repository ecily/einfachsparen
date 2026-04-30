export function HeroLoaderModal({ open, label }) {
  if (!open) return null

  return (
    <div aria-live="polite" aria-busy="true" className="loader-overlay">
      <div className="panel loader-panel">
        <div className="panel__header loader-panel__header">
          <h2>kaufklug prüft aktuelle Angebote …</h2>
          <p>{label || 'Preise, Gültigkeit und Bedingungen werden geladen.'}</p>
        </div>

        <div className="loader-spinner" />
      </div>
    </div>
  )
}
