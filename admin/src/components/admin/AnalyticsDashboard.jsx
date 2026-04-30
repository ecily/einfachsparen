import { formatInteger, formatPercent } from '../../utils/formatting'
import { getAnalyticsCount, getAnalyticsTotal, getConversionRate } from '../../utils/analytics'
import { SectionCard } from '../layout/SectionCard'

export function AnalyticsMetricCard({ label, value, note, accent = false }) {
  return (
    <article className={`metric-card ${accent ? 'metric-card--accent' : ''}`}>
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
      {note ? <p className="offer-card__meta">{note}</p> : null}
    </article>
  )
}

export function AnalyticsDashboard({ analyticsSummary, analyticsLoading, onReloadAnalytics }) {
  const rangeKey = 'last30Days'
  const totalEvents = getAnalyticsTotal(analyticsSummary, rangeKey)
  const pageViews = getAnalyticsCount(analyticsSummary, 'landing_page_view', rangeKey)
  const searchesStarted = getAnalyticsCount(analyticsSummary, 'offer_search_started', rangeKey)
  const searchResults = getAnalyticsCount(analyticsSummary, 'offer_search_result', rangeKey)
  const addedToList = getAnalyticsCount(analyticsSummary, 'offer_added_to_list', rangeKey)
  const shoppingListOpened = getAnalyticsCount(analyticsSummary, 'shopping_list_opened', rangeKey)
  const apkDownloads = getAnalyticsCount(analyticsSummary, 'apk_download_click', rangeKey)
  const appOpens = getAnalyticsCount(analyticsSummary, 'app_open', rangeKey)
  const legalViews = getAnalyticsCount(analyticsSummary, 'legal_page_opened', rangeKey)

  const searchToResultRate = getConversionRate(searchResults, searchesStarted)
  const searchToListRate = getConversionRate(addedToList, searchesStarted)
  const pageToDownloadRate = getConversionRate(apkDownloads, pageViews)
  const downloadToAppOpenRate = getConversionRate(appOpens, apkDownloads)

  return (
    <SectionCard style={{ marginBottom: '1rem' }}>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">Pitch-KPI</p>
          <h2>Nutzung der letzten 30 Tage</h2>
          <p>
            Pseudonyme Produktkennzahlen ohne Login: Seitenaufrufe, Suche, Einkaufsliste, APK-Downloads,
            App-Starts, Funnel und Geräteverteilung.
          </p>
        </div>

        <div className="quick-action-row">
          <button type="button" className="ghost-button" onClick={onReloadAnalytics} disabled={analyticsLoading}>
            {analyticsLoading ? 'Aktualisiert …' : 'KPI aktualisieren'}
          </button>
          <a
            href="/api/analytics/summary"
            target="_blank"
            rel="noreferrer"
            className="ghost-button"
            style={{ textDecoration: 'none' }}
          >
            JSON öffnen
          </a>
        </div>

        <section className="metrics" style={{ marginTop: '1rem' }}>
          <AnalyticsMetricCard
            label="Gesamte Events"
            value={formatInteger(totalEvents)}
            note="Alle gemessenen Nutzungsereignisse"
          />
          <AnalyticsMetricCard
            label="Landingpage-Aufrufe"
            value={formatInteger(pageViews)}
            note="landing_page_view"
            accent
          />
          <AnalyticsMetricCard
            label="Angebotssuchen"
            value={formatInteger(searchesStarted)}
            note="offer_search_started"
          />
          <AnalyticsMetricCard
            label="Suchergebnisse"
            value={formatInteger(searchResults)}
            note={`${formatPercent(searchToResultRate)} der gestarteten Suchen`}
          />
          <AnalyticsMetricCard
            label="Zur Liste hinzugefügt"
            value={formatInteger(addedToList)}
            note={`${formatPercent(searchToListRate)} der gestarteten Suchen`}
          />
          <AnalyticsMetricCard
            label="Einkaufsliste geöffnet"
            value={formatInteger(shoppingListOpened)}
            note="shopping_list_opened"
          />
          <AnalyticsMetricCard
            label="APK-Downloads"
            value={formatInteger(apkDownloads)}
            note={`${formatPercent(pageToDownloadRate)} von Landingpage-Aufrufen`}
            accent
          />
          <AnalyticsMetricCard
            label="App-Starts"
            value={formatInteger(appOpens)}
            note={`${formatPercent(downloadToAppOpenRate)} von APK-Downloads`}
          />
          <AnalyticsMetricCard
            label="Legal-Seiten"
            value={formatInteger(legalViews)}
            note="Datenschutz, Impressum, Haftung, Cookies"
          />
        </section>

        <div className="selection-summary-grid" style={{ marginTop: '1rem' }}>
          <article className="selection-summary-card">
            <strong>Funnel</strong>
            <span>
              {formatInteger(pageViews)} Aufrufe → {formatInteger(searchesStarted)} Suchen →{' '}
              {formatInteger(addedToList)} gespeicherte Angebote → {formatInteger(apkDownloads)} Downloads →{' '}
              {formatInteger(appOpens)} App-Starts
            </span>
          </article>

          <article className="selection-summary-card">
            <strong>Pitch-lesbare Aussage</strong>
            <span>
              kaufklug misst aktuell anonymisierte Nutzungssignale über die gesamte Kernstrecke:
              Besuch, Suche, Ergebnis, Merkliste, Download und App-Start.
            </span>
          </article>
        </div>

        <div className="selection-summary-grid" style={{ marginTop: '1rem' }}>
          <article className="selection-summary-card">
            <strong>Top-Referrer</strong>
            <span>
              {(analyticsSummary?.topReferrerHosts || []).length
                ? analyticsSummary.topReferrerHosts
                    .slice(0, 5)
                    .map((item) => `${item.referrerHost || 'direkt'}: ${item.count}`)
                    .join(' · ')
                : 'Noch keine Referrer-Daten'}
            </span>
          </article>

          <article className="selection-summary-card">
            <strong>Geräte</strong>
            <span>
              {(analyticsSummary?.deviceTypes || []).length
                ? analyticsSummary.deviceTypes
                    .slice(0, 5)
                    .map((item) => `${item.deviceType || 'unknown'}: ${item.count}`)
                    .join(' · ')
                : 'Noch keine Geräte-Daten'}
            </span>
          </article>
        </div>

        <p className="savings-notice" style={{ marginTop: '1rem' }}>
          <strong>Hinweis:</strong> Diese Zahlen sind interne Produkt-KPI für Pitching und Entwicklung. Sie sind keine
          personenbezogene Nutzeranalyse und ersetzen keine spätere professionelle Analytics-/Datenschutzprüfung.
        </p>
      </div>
    </SectionCard>
  )
}
