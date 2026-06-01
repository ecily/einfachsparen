import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { SectionCard } from '../layout/SectionCard'
import {
  clearStoredAdminApiKey,
  getStoredAdminApiKey,
  setStoredAdminApiKey,
} from '../../utils/apiBase'

const STATUS_LABELS = {
  green: 'Gruen',
  yellow: 'Gelb',
  red: 'Rot',
  success: 'success',
  partial: 'partial',
  failed: 'failed',
  stale: 'stale',
  skipped: 'skipped',
  running: 'running',
  queued: 'queued',
}

function formatInteger(value) {
  return new Intl.NumberFormat('de-AT').format(Number(value || 0))
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`
}

function formatDateTime(value) {
  return value ? dayjs(value).format('DD.MM.YYYY HH:mm:ss') : '-'
}

function formatDuration(ms) {
  const value = Number(ms)
  if (!Number.isFinite(value) || value <= 0) return '-'
  const seconds = Math.round(value / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const restSeconds = seconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${restSeconds}s`
  return `${restSeconds}s`
}

function statusClass(status) {
  if (['green', 'success', 'final', 'free'].includes(status)) return 'op-status--green'
  if (['yellow', 'partial', 'skipped', 'unknown'].includes(status)) return 'op-status--yellow'
  if (['red', 'failed', 'stale', 'blocked', 'blocked-stale-heartbeat', 'open'].includes(status)) return 'op-status--red'
  return 'op-status--muted'
}

function StatusPill({ value, children }) {
  return <span className={`op-status ${statusClass(value)}`}>{children || STATUS_LABELS[value] || value || 'unbekannt'}</span>
}

function MetricCard({ label, value, note, status }) {
  return (
    <article className={`metric-card ${status ? statusClass(status) : ''}`}>
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
      {note ? <p className="offer-card__meta">{note}</p> : null}
    </article>
  )
}

function ProgressBar({ value, inverse = false }) {
  const numeric = Math.max(0, Math.min(1, Number(value || 0)))
  const bad = inverse ? numeric >= 0.3 : numeric < 0.5
  const warn = inverse ? numeric >= 0.15 : numeric < 0.75
  const color = bad ? 'var(--kk-danger)' : warn ? 'var(--kk-warning)' : 'var(--kk-success)'

  return (
    <span className="op-bar" aria-hidden="true">
      <span style={{ width: `${Math.round(numeric * 100)}%`, background: color }} />
    </span>
  )
}

function MiniTrend({ rows, valueKey, label, percent = false }) {
  const values = rows.map((row) => Number(row[valueKey] || 0))
  const max = Math.max(...values, 1)

  return (
    <article className="op-trend">
      <strong>{label}</strong>
      <div className="op-trend__bars">
        {rows.map((row) => {
          const value = Number(row[valueKey] || 0)
          const height = Math.max(8, Math.round((value / max) * 54))
          return (
            <span key={`${row.date}-${valueKey}`} title={`${row.date}: ${percent ? formatPercent(value) : formatInteger(value)}`}>
              <i style={{ height }} />
            </span>
          )
        })}
      </div>
    </article>
  )
}

function CrawlTable({ runs }) {
  if (!runs.length) {
    return <p className="status">Keine CrawlRun-Historie vorhanden.</p>
  }

  return (
    <div className="op-table-wrap">
      <table className="op-table">
        <thead>
          <tr>
            <th>Run</th>
            <th>Status</th>
            <th>Trigger</th>
            <th>Mode</th>
            <th>Start</th>
            <th>Ende</th>
            <th>Dauer</th>
            <th>Quellen</th>
            <th>Fehler/Warnungen</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td><code>{run.id}</code></td>
              <td><StatusPill value={run.status} /></td>
              <td>{run.trigger || '-'}</td>
              <td>{run.mode || '-'}</td>
              <td>{formatDateTime(run.startedAt)}</td>
              <td>{formatDateTime(run.finishedAt)}</td>
              <td>{formatDuration(run.durationMs)}</td>
              <td>
                {formatInteger(run.summary?.successfulSourcesCount)} ok / {formatInteger(run.summary?.failedSourcesCount)} fail
              </td>
              <td>{[...(run.errorMessages || []), ...(run.warnings || [])].slice(0, 2).join(' | ') || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RetailerMatrix({ rows }) {
  if (!rows.length) {
    return <p className="status">Keine aktiven Angebote fuer eine Haendler-Matrix vorhanden.</p>
  }

  return (
    <div className="op-table-wrap">
      <table className="op-table">
        <thead>
          <tr>
            <th>Haendler</th>
            <th>Aktiv</th>
            <th>Offiziell</th>
            <th>Aggregator</th>
            <th>Sichere Gueltigkeit</th>
            <th>Bedingungen</th>
            <th>Bilder</th>
            <th>Warnstatus</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.retailerKey}>
              <td><strong>{row.retailerName || row.retailerKey}</strong></td>
              <td>{formatInteger(row.activeOffers)}</td>
              <td>{formatInteger(row.officialOffers)} <small>({formatPercent(row.officialCoverageRate)})</small></td>
              <td>{formatInteger(row.aggregatorOffers)}</td>
              <td>{formatInteger(row.safeValidityOffers)} <small>({formatPercent(row.validityConfidenceRate)})</small></td>
              <td>{formatInteger(row.conditionOffers)} <small>({formatPercent(row.conditionDetectionRate)})</small></td>
              <td>{formatInteger(row.imageOffers)} <small>({formatPercent(row.imageCoverageRate)})</small></td>
              <td><StatusPill value={row.warningStatus} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function KpiPanel({ kpis }) {
  return (
    <section className="op-kpi-grid">
      {kpis.map((kpi) => (
        <article key={kpi.key} className="op-kpi">
          <div className="op-kpi__head">
            <strong>{kpi.label}</strong>
            <span>{formatPercent(kpi.value)}</span>
          </div>
          <ProgressBar value={kpi.value} inverse={kpi.inverse} />
          <p>{kpi.meaning}</p>
          <p><strong>Relevanz:</strong> {kpi.relevance}</p>
          <p><strong>Einordnung:</strong> {kpi.interpretation}</p>
          <small>{formatInteger(kpi.numerator)} / {formatInteger(kpi.denominator)}</small>
        </article>
      ))}
    </section>
  )
}

function FeedbackBreakdownTable({ title, rows, columns, emptyMessage, renderRow }) {
  return (
    <article className="op-kpi">
      <div className="op-kpi__head">
        <strong>{title}</strong>
      </div>
      {rows.length ? (
        <div className="op-table-wrap">
          <table className="op-table op-table--compact">
            <thead>
              <tr>
                {columns.map((column) => <th key={column}>{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(renderRow)}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{emptyMessage}</p>
      )}
    </article>
  )
}

function FeedbackPanel({ feedback }) {
  const totalFeedback = Number(feedback?.totalFeedback || 0)
  const statusRows = feedback?.feedbackByStatus || []
  const typeRows = feedback?.feedbackByType || []
  const retailerRows = feedback?.feedbackByRetailer || []
  const offerRows = feedback?.feedbackByOffer || []
  const trendRows = feedback?.dailyFeedbackTrend || []
  const latestRows = feedback?.latestFeedback || []
  const warnings = feedback?.feedbackDataWarnings || []
  const openFeedback = Number(feedback?.openFeedback || 0)

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Feedback / Beta-Test</h2>
        <p>Diese Kennzahlen messen, ob Beta-Tester ueber "Fehler melden" aktiv Rueckmeldungen geben. Sie messen nicht den gesamten Traffic.</p>
      </div>

      <section className="metrics">
        <MetricCard label="Heute" value={formatInteger(feedback?.newToday)} note="Neue Fehler-melden-Eintraege" status={feedback?.newToday > 0 ? 'yellow' : 'green'} />
        <MetricCard label="Letzte 7 Tage" value={formatInteger(feedback?.newLast7Days)} note="Beta-Feedbacks" />
        <MetricCard label="Letzte 30 Tage" value={formatInteger(feedback?.newLast30Days)} note="Beta-Feedbacks" />
        <MetricCard label="Offen" value={formatInteger(openFeedback)} note="Status new/reviewing" status={openFeedback >= 25 ? 'red' : openFeedback >= 10 ? 'yellow' : 'green'} />
        <MetricCard label="Gesamt" value={formatInteger(totalFeedback)} note={feedback?.source || 'OfferFeedback'} />
      </section>

      {totalFeedback === 0 ? <p className="status">Noch keine Feedback-Eintraege vorhanden.</p> : null}

      <div className="op-split">
        <MiniTrend rows={trendRows} valueKey="count" label="Feedback pro Tag" />
        <article className="op-trend">
          <strong>Einordnung</strong>
          <p className="offer-card__meta">
            Offene Feedbacks werden nur aus vorhandenen Statuswerten abgeleitet. Es werden keine IPs, User-Agents,
            Session-Hashes oder langen Freitexte im Dashboard angezeigt.
          </p>
          {warnings.length ? (
            <div className="op-warning-list">
              {warnings.map((warning) => <p key={warning} className="status">{warning}</p>)}
            </div>
          ) : null}
        </article>
      </div>

      <div className="op-split op-split--three">
        <FeedbackBreakdownTable
          title="Nach Status"
          rows={statusRows}
          columns={['Status', 'Feedbacks']}
          emptyMessage="Status wird aktuell nicht strukturiert erfasst."
          renderRow={(row) => (
            <tr key={row.status}>
              <td><StatusPill value={row.status}>{row.status}</StatusPill></td>
              <td>{formatInteger(row.count)}</td>
            </tr>
          )}
        />
        <FeedbackBreakdownTable
          title="Nach Typ/Kategorie"
          rows={typeRows}
          columns={['Typ', 'Feedbacks']}
          emptyMessage="Status/Kategorie werden aktuell nicht strukturiert erfasst."
          renderRow={(row) => (
            <tr key={row.type}>
              <td>{row.type || 'unknown'}</td>
              <td>{formatInteger(row.count)}</td>
            </tr>
          )}
        />
        <FeedbackBreakdownTable
          title="Betroffene Haendler"
          rows={retailerRows}
          columns={['Haendler', 'Feedbacks']}
          emptyMessage="Kein Haendlerbezug vorhanden."
          renderRow={(row) => (
            <tr key={row.retailerKey}>
              <td>{row.retailerLabel || row.retailerKey}</td>
              <td>{formatInteger(row.count)}</td>
            </tr>
          )}
        />
      </div>

      {offerRows.length ? (
        <div className="op-table-wrap">
          <table className="op-table">
            <thead>
              <tr>
                <th>Top Angebot</th>
                <th>Haendler</th>
                <th>Feedbacks</th>
                <th>Gruende</th>
              </tr>
            </thead>
            <tbody>
              {offerRows.map((row) => (
                <tr key={row.offerId}>
                  <td>{row.title || row.offerId}</td>
                  <td>{row.retailerLabel || row.retailerKey || '-'}</td>
                  <td>{formatInteger(row.count)}</td>
                  <td>{(row.reasons || []).join(', ') || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {latestRows.length ? (
        <div className="op-table-wrap">
          <table className="op-table">
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Status</th>
                <th>Grund</th>
                <th>Bezug</th>
                <th>Kurznotiz</th>
              </tr>
            </thead>
            <tbody>
              {latestRows.map((row) => (
                <tr key={row.id || `${row.createdAt}-${row.offerId}`}>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td><StatusPill value={row.status}>{row.status || 'unknown'}</StatusPill></td>
                  <td>{row.primaryReason || 'unknown'}</td>
                  <td>
                    {row.retailerLabel || row.retailerKey || '-'}<br />
                    <small>{row.offerTitle || row.query || row.path || '-'}</small>
                  </td>
                  <td>{row.snippet || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

export function DiagnosticsPage({
  health,
  snapshot,
  essence,
  error,
  feedbackState,
  feedbackNote,
  setFeedbackNote,
  handleSaveFeedback,
  onReload,
  loading,
}) {
  const initialAdminApiKey = useMemo(() => getStoredAdminApiKey(), [])
  const [adminApiKeyInput, setAdminApiKeyInput] = useState(initialAdminApiKey)
  const [adminKeyMessage, setAdminKeyMessage] = useState('')

  const executive = snapshot?.executiveStatus || { level: 'yellow', reason: 'Dashboard-Daten werden geladen.' }
  const latest = snapshot?.latestScheduledFullCrawl || snapshot?.latestCrawl || null
  const offerSummary = snapshot?.offerSummary || {}
  const publish = snapshot?.publishStatusSummary || {}
  const lock = snapshot?.lockStatus || {}
  const kpis = snapshot?.qualityKpis || []
  const trendRows = snapshot?.trendSeries || []
  const feedback = snapshot?.feedbackSummary || {}
  const issues = snapshot?.actionableIssues || []
  const dataWarnings = snapshot?.dataCompletenessWarnings || []
  const hasAdminApiKey = adminApiKeyInput.trim().length > 0

  function handleSaveAdminApiKey() {
    const savedKey = setStoredAdminApiKey(adminApiKeyInput)
    setAdminKeyMessage(savedKey ? 'Admin-Key wurde lokal in diesem Browser gespeichert.' : 'Admin-Key wurde entfernt.')
    if (savedKey && typeof onReload === 'function') onReload()
  }

  function handleClearAdminApiKey() {
    clearStoredAdminApiKey()
    setAdminApiKeyInput('')
    setAdminKeyMessage('Admin-Key wurde entfernt.')
  }

  return (
    <>
      <header className={`hero op-hero ${statusClass(executive.level)}`}>
        <div>
          <p className="eyebrow">kaufklug.at intern</p>
          <h1>Operations- und Qualitaets-Cockpit</h1>
          <p className="subtitle">{executive.label || STATUS_LABELS[executive.level]} - {executive.reason}</p>
        </div>
        <div className="hero__status">
          <div><span>Backend</span><strong>{health?.ok ? 'online' : 'offline'}</strong></div>
          <div><span>Mongo</span><strong>{health?.database?.connected ? 'verbunden' : 'getrennt'}</strong></div>
          <div><span>Build</span><strong>{health?.build?.buildTime ? dayjs(health.build.buildTime).format('DD.MM. HH:mm') : '-'}</strong></div>
          <div><span>Snapshot</span><strong>{formatDateTime(snapshot?.generatedAt)}</strong></div>
        </div>
      </header>

      <SectionCard style={{ marginBottom: '1rem' }}>
        <div className="selection-block">
          <div className="selection-block__header">
            <p className="eyebrow">Admin-Zugriff</p>
            <h2>Read-only Dashboarddaten</h2>
            <p>Der Admin-Key wird nur lokal im Browser gespeichert. Dieses Cockpit startet keinen Crawl und fuehrt keine Repairs aus.</p>
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
            />
            <div className="feedback-box__actions">
              <button type="button" className="crawl-button" onClick={handleSaveAdminApiKey} disabled={!hasAdminApiKey}>
                Admin-Key speichern
              </button>
              <button type="button" className="ghost-button" onClick={handleClearAdminApiKey}>Entfernen</button>
              <button type="button" className="ghost-button" onClick={onReload} disabled={loading || !hasAdminApiKey}>
                {loading ? 'Laedt ...' : 'Aktualisieren'}
              </button>
            </div>
            {adminKeyMessage ? <p className="status">{adminKeyMessage}</p> : null}
          </div>
        </div>
      </SectionCard>

      {error ? <p className="status status--error">{error}</p> : null}

      <section className="metrics">
        <MetricCard label="Ampel" value={executive.label || STATUS_LABELS[executive.level]} note={executive.reason} status={executive.level} />
        <MetricCard label="Letzter Daily Crawl" value={latest?.status || 'unbekannt'} note={latest?.id || 'keine Lineage'} status={latest?.status} />
        <MetricCard label="Globaler Lock" value={lock.state === 'free' ? 'frei' : lock.state || 'unbekannt'} note={lock.reason || '-'} status={lock.state} />
        <MetricCard label="PublishStatus" value={publish.status || 'unbekannt'} note={`${formatInteger(publish.finalCount)} final / ${formatInteger(publish.openCount)} offen`} status={publish.status} />
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Executive Status</h2>
          <p>Direkte Antwort auf Crawl-Gesundheit, Lock und Publikationszustand.</p>
        </div>
        <div className="selection-summary-grid">
          <article className="selection-summary-card">
            <strong>CrawlRun</strong>
            <span>
              ID <code>{latest?.id || '-'}</code><br />
              {latest?.trigger || '-'} / {latest?.mode || '-'} / dryRun {latest?.dryRun ? 'ja' : 'nein'}<br />
              Start {formatDateTime(latest?.startedAt)} - Ende {formatDateTime(latest?.finishedAt)} - Dauer {formatDuration(latest?.durationMs)}
            </span>
          </article>
          <article className="selection-summary-card">
            <strong>Warnungen und Fehler</strong>
            <span>{[...(latest?.errorMessages || []), ...(latest?.warnings || [])].slice(0, 4).join(' | ') || 'Keine im letzten Run gemeldet.'}</span>
          </article>
          <article className="selection-summary-card">
            <strong>Lock</strong>
            <span>{lock.reason || 'Unbekannt'} {lock.lock?.runId ? `Run ${lock.lock.runId}` : ''}</span>
          </article>
          <article className="selection-summary-card">
            <strong>Health</strong>
            <span>HTTP {health?.ok ? 'ok' : 'unbekannt'}, DB {health?.database?.connected ? 'connected' : 'unknown'}, Build {health?.build?.buildTime || '-'}</span>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Crawl & Pipeline</h2>
          <p>Letzte CrawlRuns, Laufzeiten, Quellenstatus und Publish-Lineage.</p>
        </div>
        <CrawlTable runs={snapshot?.crawlHistory || []} />
        <div className="op-split">
          <MiniTrend rows={trendRows} valueKey="crawlDurationMs" label="Crawl-Dauer pro Tag" />
          <MiniTrend rows={trendRows} valueKey="offersStored" label="Gespeicherte Angebote pro Crawl-Tag" />
        </div>
        <div className="op-chip-row">
          {(publish.statuses || []).map((item) => (
            <span key={item.status} className={`op-chip ${item.intermediate ? 'op-chip--warn' : ''}`}>
              {item.status}: {formatInteger(item.count)}
            </span>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Angebotsbestand & Coverage</h2>
          <p>Aktive Angebote, Quellenmix, Gueltigkeit, Bedingungen, Vergleichssicherheit und Bilder.</p>
        </div>
        <section className="metrics">
          <MetricCard label="Aktive Angebote" value={formatInteger(offerSummary.activeOffers)} />
          <MetricCard label="Offiziell" value={formatPercent(offerSummary.officialCoverageRate)} note={formatInteger(offerSummary.officialOffers)} />
          <MetricCard label="Sichere Gueltigkeit" value={formatPercent(offerSummary.validityConfidenceRate)} note={`${formatInteger(offerSummary.missingValidToOffers)} ohne validTo`} />
          <MetricCard label="comparisonSafe" value={formatPercent(offerSummary.comparisonSafetyRate)} note={formatInteger(offerSummary.comparisonSafeOffers)} />
          <MetricCard label="Bilder" value={formatPercent(offerSummary.imageCoverageRate)} note={formatInteger(offerSummary.imageOffers)} />
          <MetricCard label="Aggregator Risk" value={formatPercent(offerSummary.aggregatorRiskRate)} note={formatInteger(offerSummary.aggregatorRiskOffers)} status={offerSummary.aggregatorRiskRate >= 0.3 ? 'yellow' : 'green'} />
        </section>
        <RetailerMatrix rows={snapshot?.retailerMatrix || []} />
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Qualitaets-KPI</h2>
          <p>Interne Produktqualitaet ohne neue Tracking-Events.</p>
        </div>
        <KpiPanel kpis={kpis} />
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Tagesveraenderung</h2>
          <p>Nutzen vorhandener CrawlRun- und Offer-Beobachtungsdaten; echte historische Offer-Snapshots fehlen noch.</p>
        </div>
        {dataWarnings.length ? (
          <div className="op-warning-list">
            {dataWarnings.map((warning) => <p key={warning} className="status">{warning}</p>)}
          </div>
        ) : null}
        <div className="op-split op-split--three">
          <MiniTrend rows={trendRows} valueKey="activeOffersObserved" label="Aktive Angebote beobachtet" />
          <MiniTrend rows={trendRows} valueKey="officialOffersObserved" label="Offizielle Angebote beobachtet" />
          <MiniTrend rows={trendRows} valueKey="safeValidityObserved" label="Sichere Gueltigkeit beobachtet" />
          <MiniTrend rows={trendRows} valueKey="conditionsObserved" label="Bedingungen erkannt" />
          <MiniTrend rows={trendRows} valueKey="comparisonSafeRateObserved" label="comparisonSafe Rate" percent />
        </div>
        <div className="op-chip-row">
          {trendRows.map((row) => (
            <span key={row.date} className={`op-chip ${statusClass(row.crawlStatus)}`}>
              {dayjs(row.date).format('DD.MM.')}: {row.crawlStatus}
            </span>
          ))}
        </div>
      </section>

      <FeedbackPanel feedback={feedback} />

      <section className="panel">
        <div className="panel__header">
          <h2>Actionable Issues</h2>
          <p>Nur aus vorhandenen Daten abgeleitete Probleme. Unbekanntes wird als unbekannt markiert.</p>
        </div>
        <div className="op-issue-list">
          {issues.map((issue) => (
            <article key={`${issue.title}-${issue.detail}`} className={`op-issue ${statusClass(issue.severity)}`}>
              <StatusPill value={issue.severity} />
              <div>
                <strong>{issue.title}</strong>
                <p>{issue.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Crawl-Essenz</h2>
          <p>Kompakte Zusammenfassung fuer manuelle Analyse und Admin-Feedback.</p>
        </div>
        <pre className="essence-box">{essence || 'Noch keine Essenz vorhanden.'}</pre>
        <div className="feedback-box">
          <textarea
            value={feedbackNote}
            onChange={(event) => setFeedbackNote(event.target.value)}
            placeholder="Rueckmeldung zur Crawl-Qualitaet, zu Luecken oder Auffaelligkeiten ..."
          />
          <div className="feedback-box__actions">
            <button
              className="crawl-button"
              onClick={handleSaveFeedback}
              disabled={feedbackState === 'saving' || !feedbackNote.trim()}
            >
              {feedbackState === 'saving' ? 'Feedback wird gespeichert ...' : 'Feedback in Mongo speichern'}
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
