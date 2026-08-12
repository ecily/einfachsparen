import { useState } from 'react'
import { COOKIE_NOTICE_STORAGE_KEY } from '../../config/constants'

export function CookieStorageNotice({ onNavigate }) {
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return false

    try {
      return window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY) !== 'true'
    } catch {
      return true
    }
  })

  function handleAccept() {
    try {
      window.localStorage.setItem(COOKIE_NOTICE_STORAGE_KEY, 'true')
    } catch {
      // Speicherung kann im Browser blockiert sein. Der Hinweis wird dann nur für diese Sitzung geschlossen.
    }

    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="region"
      className="cookie-storage-notice"
      aria-label="Cookie- und Speicherhinweis"
      style={{
        position: 'fixed',
        left: '1rem',
        right: '1rem',
        bottom: '4.25rem',
        zIndex: 70,
        maxWidth: '980px',
        margin: '0 auto',
      }}
    >
      <div className="panel cookie-storage-notice__panel" style={{ padding: '1rem' }}>
        <div className="panel__header" style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1rem', margin: 0 }}>Cookie- und Speicherhinweis</h2>
          <p style={{ margin: 0 }}>
            Keine Marketing-Cookies. Technische Daten bleiben lokal auf deinem Gerät; keine Namen, E-Mail-Adressen oder genauen Standortdaten.
          </p>
        </div>

        <div className="quick-action-row">
          <button type="button" className="primary-action-button" onClick={handleAccept}>
            Verstanden
          </button>
          <button type="button" className="ghost-button" onClick={() => onNavigate?.('cookies')}>
            Details
          </button>
        </div>
      </div>
    </div>
  )
}
