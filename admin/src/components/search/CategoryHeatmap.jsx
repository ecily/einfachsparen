import { useEffect, useState } from 'react'
import { fetchFilterCategories, fetchTopDeals } from '../../utils/apiBase'
import { buildCategoryHeatmap } from '../../utils/categoryHeatmap'
import { sampleSignals } from '../../utils/heatmapEvidence'
import { nextQuoteExpiry } from '../../utils/shoppingAssistant'

export function CategoryHeatmap({ retailers = [] }) {
  const [state, setState] = useState({ status: 'loading', categories: [] })
  const [sample, setSample] = useState({ deals: [], checkedAt: 0 })
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    let active = true
    fetchFilterCategories().then(categories => {
      if (active) setState({ status: 'ready', categories })
    }).catch(() => {
      if (active) setState({ status: 'error', categories: [] })
    })
    fetchTopDeals(20).then(payload => { if (active) { const checkedAt = Date.now(); setSample({ deals: Array.isArray(payload?.deals) ? payload.deals : [], checkedAt }); setNow(checkedAt) } }).catch(() => { /* unknown stays neutral */ })
    return () => { active = false }
  }, [])
  useEffect(() => {
    const expiry = nextQuoteExpiry(Object.fromEntries(sample.deals.map((offer, i) => [i, { offer, checkedAt: sample.checkedAt }])))
    const timer = expiry ? setTimeout(() => setNow(Date.now()), Math.max(1, expiry - Date.now() + 1)) : null
    return () => clearTimeout(timer)
  }, [sample, now])
  const signals = sampleSignals(sample.deals, sample.checkedAt, now)
  const tiles = buildCategoryHeatmap(state.categories, retailers.map(item => item.retailerKey || item.key).filter(Boolean))
  return <section className="category-map" aria-labelledby="category-map-title" aria-busy={state.status === 'loading'}>
    <div className="design-section-heading"><div><p className="design-eyebrow">DEIN NÄCHSTER EINKAUF</p><h2 id="category-map-title">Wo möchtest du sparen?</h2></div><a href="/stoebern">Alle Märkte & Kategorien →</a></div>
    <p className="category-map__explanation">Preisvorteile in der aktuellen Top-Deals-Auswahl. Nur bestätigte, gültige Vergleiche werden hervorgehoben – keine Bewertung des gesamten Sortiments.</p>
    {state.status !== 'ready' ? <p role="status">{state.status === 'loading' ? 'Kategorien werden geladen …' : 'Kategorien gerade nicht verfügbar. Nutze die Produktsuche oder wähle deine Märkte.'}</p> : null}
    <div className="category-map__grid">{tiles.map(tile => {
      const count = signals[tile.key]
      const content = <><span className="category-map__number" aria-hidden="true">{tile.number}</span><strong>{tile.label}</strong><span className="category-map__state">{count ? `${count} belegte Preisvorteile in der Auswahl` : 'Kein belastbares Signal in der Auswahl'}</span><span className="category-map__arrow" aria-hidden="true">↗</span></>
      return tile.href ? <a className="category-map__tile" data-evidence={count ? 'sample' : tile.evidence} key={tile.key} href={count ? '/top-deals/' : tile.href}>{content}</a> : <div className="category-map__tile category-map__tile--unavailable" data-evidence="unknown" key={tile.key}>{content}<span className="category-map__unavailable">{state.status === 'loading' ? 'Lädt …' : 'Kein Kategorie-Einstieg verfügbar'}</span></div>
    })}</div>
    <details className="category-map__method"><summary>Was bedeutet die neutrale Darstellung?</summary><p>Erfasste Angebote allein belegen keinen Preisvorteil. Für eine Bewertung müssen gültige Angebote, passende Referenzpreise, Vergleichbarkeit, Frische und Quellenvertrauen gemeinsam belegt sein. Fehlende Evidenz ist keine schlechte Bewertung.</p></details>
  </section>
}
