export function StickyBottomLine({ onNavigate }) {
  const footerButtonStyle = {
    display: 'inline',
    margin: '0 0 0 0.45rem',
    padding: 0,
    border: 0,
    color: '#315e2a',
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
        color: '#485344',
        fontSize: '0.84rem',
        fontWeight: 650,
        lineHeight: 1.35,
        textAlign: 'center',
        background: 'rgba(255, 252, 247, 0.94)',
        borderTop: '1px solid rgba(22, 33, 24, 0.1)',
        boxShadow: '0 -10px 26px rgba(83, 63, 34, 0.09)',
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
            color: '#315e2a',
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
