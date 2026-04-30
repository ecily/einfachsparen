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
      <div className="panel" style={{ padding: '1rem' }}>
        <div className="panel__header" style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1rem', margin: 0 }}>Cookie- und Speicherhinweis</h2>
          <p style={{ margin: 0 }}>
            kaufklug.at verwendet derzeit keine Marketing-Cookies. Für die Einkaufsliste, diesen Hinweis und eine
            pseudonyme Nutzungsmessung speichern wir technische Daten lokal auf deinem Gerät. So können wir zählen, wie
            oft die Seite genutzt, gesucht oder die Test-App heruntergeladen wird, ohne Namen, E-Mail-Adressen oder
            genaue Standortdaten zu speichern.
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
