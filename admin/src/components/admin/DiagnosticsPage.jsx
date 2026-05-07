import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { SectionCard } from '../layout/SectionCard'
import { AnalyticsDashboard } from './AnalyticsDashboard'
import {
  clearStoredAdminApiKey,
  getStoredAdminApiKey,
  setStoredAdminApiKey,
} from '../../utils/apiBase'

export function DiagnosticsPage({
  health,
  snapshot,
  essence,
  analyticsSummary,
  analyticsLoading,
  error,
  feedbackState,
  feedbackNote,
  setFeedbackNote,
  handleSaveFeedback,
  onReloadAnalytics,
}) {
  const summary = snapshot?.qualitySummary || {}
  const comparisons = snapshot?.comparisonSnapshot || {}

  const initialAdminApiKey = useMemo(() => getStoredAdminApiKey(), [])
  const [adminApiKeyInput, setAdminApiKeyInput] = useState(initialAdminApiKey)
  const [adminKeyMessage, setAdminKeyMessage] = useState('')

  const hasAdminApiKey = adminApiKeyInput.trim().length > 0

  function handleSaveAdminApiKey() {
    const savedKey = setStoredAdminApiKey(adminApiKeyInput)

    if (!savedKey) {
      setAdminKeyMessage('Admin-Key wurde entfernt.')
      return
    }

    setAdminKeyMessage('Admin-Key wurde lokal in diesem Browser gespeichert.')

    if (typeof onReloadAnalytics === 'function') {
      onReloadAnalytics()
    }
  }

  function handleClearAdminApiKey() {
    clearStoredAdminApiKey()
    setAdminApiKeyInput('')
    setAdminKeyMessage('Admin-Key wurde entfernt.')
  }

  return (
    <>
      <header className="hero">
        <div>
          <p className="eyebrow">kaufklug.at intern</p>
          <h1>Interner Systemstatus</h1>
          <p className="subtitle">Interne Ansicht für Quellen, Jobs, Rohdaten, Normalisierung, Vergleichsgruppen und Pitch-KPI.</p>
        </div>
        <div className="hero__status">
          <div>
            <span>Crawling</span>
            <strong>serverseitig geplant</strong>
          </div>
          <div>
            <span>Backend</span>
            <strong>{health?.ok ? 'online' : 'offline'}</strong>
          </div>
          <div>
            <span>Mongo</span>
            <strong>{health?.database?.connected ? 'verbunden' : 'getrennt'}</strong>
          </div>
          <div>
            <span>Snapshot</span>
            <strong>{snapshot?.generatedAt ? dayjs(snapshot.generatedAt).format('DD.MM.YYYY HH:mm:ss') : '-'}</strong>
          </div>
        </div>
      </header>

      <SectionCard style={{ marginBottom: '1rem' }}>
        <div className="selection-block">
          <div className="selection-block__header">
            <p className="eyebrow">Interne Navigation</p>
            <h2>Werkzeuge</h2>
            <p>/ecily_web ist nicht in der öffentlichen Landingpage-Navigation verlinkt und ist auf noindex gesetzt.</p>
          </div>
          <div className="quick-action-row">
            <button type="button" className="ghost-button" onClick={() => window.history.replaceState({}, '', '/ecily_web')}>
              Status
            </button>
            <button type="button" className="ghost-button" onClick={() => window.location.assign('/quality')}>
              Qualität öffnen
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard style={{ marginBottom: '1rem' }}>
        <div className="selection-block">
          <div className="selection-block__header">
            <p className="eyebrow">Admin-Zugriff</p>
            <h2>Admin-Key</h2>
            <p>Geschützte interne Endpunkte benötigen den Admin-Key. Der Key wird nur lokal in diesem Browser gespeichert.</p>
          </div>

          <div className="feedback-box">
            <input
              type="password"
              value={adminApiKeyInput}
              onChange={(event) => {
                setAdminApiKeyInput(event.target.value)
                setAdminKeyMessage('')
              }}
              placeholder="Admin-Key eingeben"
              autoComplete="off"
              spellCheck="false"
              style={{
                width: '100%',
                border: '1px solid rgba(23, 34, 23, 0.16)',
                borderRadius: '1rem',
                padding: '0.85rem 1rem',
                font: 'inherit',
              }}
            />

            <div className="feedback-box__actions">
              <button type="button" className="crawl-button" onClick={handleSaveAdminApiKey} disabled={!hasAdminApiKey}>
                Admin-Key speichern
              </button>
              <button type="button" className="ghost-button" onClick={handleClearAdminApiKey}>
                Entfernen
              </button>
            </div>

            {adminKeyMessage ? <p className="status">{adminKeyMessage}</p> : null}
          </div>
        </div>
      </SectionCard>

      {error ? <p className="status status--error">{error}</p> : null}

      <AnalyticsDashboard
        analyticsSummary={analyticsSummary}
        analyticsLoading={analyticsLoading}
        onReloadAnalytics={onReloadAnalytics}
      />

      <section className="metrics">
        <article className="metric-card"><span className="metric-card__label">Quellen aktiv</span><strong className="metric-card__value">{summary.sourceCount || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Rohdokumente</span><strong className="metric-card__value">{summary.rawDocumentCount || 0}</strong></article>
        <article className="metric-card metric-card--accent"><span className="metric-card__label">Gespeichert gesamt</span><strong className="metric-card__value">{summary.storedOfferCount || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Aktuell gültig</span><strong className="metric-card__value">{summary.activeOfferCount || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Prüfung offen</span><strong className="metric-card__value">{summary.offersPendingReview || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Vergleichsbasis</span><strong className="metric-card__value">{comparisons.comparableOfferCount || 0}</strong></article>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Crawl-Essenz</h2>
          <p>Kompakte Zusammenfassung für Rückmeldung und spätere Analyse.</p>
        </div>
        <pre className="essence-box">{essence || 'Noch keine Essenz vorhanden.'}</pre>
        <div className="feedback-box">
          <textarea
            value={feedbackNote}
            onChange={(event) => setFeedbackNote(event.target.value)}
            placeholder="Rückmeldung zur Crawl-Qualität, zu Lücken oder Auffälligkeiten …"
          />
          <div className="feedback-box__actions">
            <button
              className="crawl-button"
              onClick={handleSaveFeedback}
              disabled={feedbackState === 'saving' || !feedbackNote.trim()}
            >
              {feedbackState === 'saving' ? 'Feedback wird gespeichert …' : 'Feedback in Mongo speichern'}
            </button>
          </div>
        </div>
      </section>
    </>
  )
}