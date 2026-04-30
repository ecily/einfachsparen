export function LegalInlineNotice({ onNavigate, compact = false }) {
  return (
    <div className="savings-notice" style={compact ? { marginTop: '0.75rem' } : {}}>
      <strong>Unverbindlicher Hinweis:</strong>{' '}
      Preise, Verfügbarkeit, Bedingungen und regionale Gültigkeit können abweichen. Maßgeblich sind die aktuellen Angaben
      des jeweiligen Händlers im Geschäft, Online-Shop oder offiziellen Prospekt.{' '}
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
          Nutzungs- und Haftungshinweise
        </button>
      ) : null}
    </div>
  )
}
