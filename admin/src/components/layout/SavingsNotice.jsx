export function SavingsNotice({ onNavigate }) {
  return (
    <div className="savings-notice">
      <strong>Hinweis:</strong>{' '}
      kaufklug zeigt aktuelle Angebote aus Prospekten, Aktionen und Angebotsinformationen als unverbindliche
      Orientierungshilfe. Manche Prospekte nennen nur den Aktionspreis, aber keinen Normalpreis. In diesem Fall zeigen
      wir den Aktionspreis, aber keine Euro-Ersparnis.{' '}
      {onNavigate ? (
        <button
          type="button"
          className="ghost-button"
          onClick={() => onNavigate('liability')}
          style={{
            display: 'inline',
            padding: 0,
            border: 0,
            background: 'transparent',
            boxShadow: 'none',
            font: 'inherit',
            fontWeight: 800,
            textDecoration: 'underline',
          }}
        >
          Mehr dazu
        </button>
      ) : null}
    </div>
  )
}
