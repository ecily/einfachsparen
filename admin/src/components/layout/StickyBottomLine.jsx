export function StickyBottomLine({ onNavigate }) {
  const footerButtonStyle = {
    display: 'inline',
    margin: '0 0 0 0.45rem',
    padding: 0,
    border: 0,
    color: 'var(--kk-primary)',
    font: 'inherit',
    fontWeight: 850,
    textDecoration: 'none',
    background: 'transparent',
    cursor: 'pointer',
  }

  return (
    <div
      aria-label="Copyright, Projektlink und Rechtliches"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '2.55rem',
        padding: '0.48rem 1rem calc(0.48rem + env(safe-area-inset-bottom))',
        color: 'var(--kk-text-muted)',
        fontSize: '0.84rem',
        fontWeight: 650,
        lineHeight: 1.35,
        textAlign: 'center',
        background: 'rgba(255, 255, 255, 0.92)',
        borderTop: '1px solid var(--kk-border)',
        boxShadow: '0 -10px 26px rgba(36, 52, 71, 0.08)',
        backdropFilter: 'blur(14px)',
      }}
    >
      <span>
        © 2026 - Ein Projekt von{' '}
        <a
          href="https://www.ecily.com"
          target="_blank"
          rel="noreferrer"
          style={{
            color: 'var(--kk-primary)',
            fontWeight: 850,
            textDecoration: 'none',
          }}
        >
          ecily/webentwicklung
        </a>
        .
        <button type="button" style={footerButtonStyle} onClick={() => onNavigate('impressum')}>
          Impressum
        </button>
        <button type="button" style={footerButtonStyle} onClick={() => onNavigate('privacy')}>
          Datenschutz
        </button>
        <button type="button" style={footerButtonStyle} onClick={() => onNavigate('liability')}>
          Haftung
        </button>
        <button type="button" style={footerButtonStyle} onClick={() => onNavigate('cookies')}>
          Cookies
        </button>
        <button type="button" style={footerButtonStyle} onClick={() => onNavigate('liability')}>
          Fehler melden
        </button>
      </span>
    </div>
  )
}
