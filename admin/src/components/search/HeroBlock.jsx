import { buildTrackedApkDownloadUrl } from '../../utils/apiBase'
import { SectionCard } from '../layout/SectionCard'

const SHOW_ANDROID_TEST_DOWNLOAD = import.meta.env.VITE_SHOW_ANDROID_TEST_DOWNLOAD === 'true'
const MOBILE_BROWSER_NOTICE =
  'Wir arbeiten gerade an den optimalen Suchergebnissen. Sobald die Datenqualität stabil genug ist, kommt wieder eine neue App-Version. Bis dahin funktioniert kaufklug.at am Handy genauso gut direkt im Browser.'

export function HeroBlock() {
  const appDownload = SHOW_ANDROID_TEST_DOWNLOAD
    ? {
        trackedDownloadUrl: buildTrackedApkDownloadUrl('hero_button'),
        qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=14&data=${encodeURIComponent(
          buildTrackedApkDownloadUrl('hero_qr')
        )}`,
      }
    : null

  return (
    <SectionCard
      style={{
        marginBottom: '1rem',
        background: 'linear-gradient(180deg, rgba(255,252,247,0.98), rgba(250,246,238,0.94))',
        border: '1px solid rgba(22,33,24,0.08)',
      }}
    >
      <div
        className="hero-consumer"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          alignItems: 'center',
          gap: 'clamp(1rem, 4vw, 2rem)',
        }}
      >
        <div
          className="hero-consumer__copy"
          style={{
            minWidth: 0,
            overflowWrap: 'normal',
            wordBreak: 'normal',
            hyphens: 'none',
          }}
        >
          <p className="eyebrow hero-consumer__eyebrow">kaufklug.at</p>

          <h1
            style={{
              maxWidth: '820px',
              overflowWrap: 'normal',
              wordBreak: 'normal',
              hyphens: 'none',
              fontSize: 'clamp(2.05rem, 8vw, 4.15rem)',
            }}
          >
            Supermarkt-Angebote finden. Einkaufsliste am Handy nutzen.
          </h1>

          <p
            className="subtitle"
            style={{
              maxWidth: '720px',
              overflowWrap: 'normal',
              wordBreak: 'normal',
              hyphens: 'none',
            }}
          >
            Wähle deine Geschäfte, zeige aktuelle Angebote an und merke interessante Aktionen direkt auf deiner
            Einkaufsliste fürs Smartphone.
          </p>

          <div className="hero-benefit-grid">
            {[
              ['Kostenlos', 'Derzeit kostenlos nutzbar.'],
              ['Einfach', 'Geschäfte wählen, Angebote anzeigen.'],
              ['Mobil', 'Einkaufsliste direkt am Smartphone nutzen.'],
            ].map(([title, text]) => (
              <div key={title} className="hero-benefit-card">
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '0.75rem',
            justifyItems: 'center',
            textAlign: 'center',
            minWidth: 0,
            width: '100%',
          }}
        >
          <p className="eyebrow hero-consumer__eyebrow" style={{ margin: 0 }}>
            Smartphone zuerst
          </p>

          <h2
            style={{
              margin: 0,
              maxWidth: '20rem',
              fontSize: 'clamp(1.35rem, 6vw, 2rem)',
              lineHeight: 1.05,
              letterSpacing: '-0.04em',
            }}
          >
            Am Handy ist kaufklug am stärksten.
          </h2>

          <p style={{ maxWidth: '280px', margin: 0, color: '#5c6658', fontSize: '0.92rem', lineHeight: 1.4 }}>
            {MOBILE_BROWSER_NOTICE}
          </p>
          {appDownload ? (
            <>
              <div
                className="app-download-modal__qr"
                style={{
                  width: 'min(100%, 280px)',
                  margin: '0 auto',
                }}
              >
                <img
                  src={appDownload.qrUrl}
                  alt="QR-Code zum Download der kaufklug.at Android-Testversion"
                  width="280"
                  height="280"
                  loading="eager"
                />
              </div>

              <a
                href={appDownload.trackedDownloadUrl}
                target="_blank"
                rel="noreferrer"
                className="primary-action-button"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  maxWidth: '280px',
                  textDecoration: 'none',
                }}
              >
                Android-Testversion laden
              </a>
            </>
          ) : null}
        </div>
      </div>
    </SectionCard>
  )
}
