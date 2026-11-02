import { useEffect, useState } from 'react'
import { fetchFilterCategories } from '../../utils/apiBase'
import { buildCategoryHeatmap } from '../../utils/categoryHeatmap'

export function CategoryHeatmap({ retailers = [] }) {
  const [state, setState] = useState({ status: 'loading', categories: [] })
  useEffect(() => {
    let active = true
    fetchFilterCategories().then(categories => {
      if (active) setState({ status: 'ready', categories })
    }).catch(() => {
      if (active) setState({ status: 'error', categories: [] })
    })
    return () => { active = false }
  }, [])
  const tiles = buildCategoryHeatmap(state.categories, retailers.map(item => item.retailerKey || item.key).filter(Boolean))
  return <section className="category-map" aria-labelledby="category-map-title" aria-busy={state.status === 'loading'}>
    <div className="design-section-heading"><div><p className="design-eyebrow">DEIN NÄCHSTER EINKAUF</p><h2 id="category-map-title">Wo möchtest du sparen?</h2></div><a href="/stoebern">Alle Märkte & Kategorien →</a></div>
    <p className="category-map__explanation">Die Kategorienübersicht bleibt neutral, solange belastbare Daten zur Angebotsattraktivität fehlen.</p>
    {state.status !== 'ready' ? <p role="status">{state.status === 'loading' ? 'Kategorien werden geladen …' : 'Kategorien gerade nicht verfügbar. Nutze die Produktsuche oder wähle deine Märkte.'}</p> : null}
    <div className="category-map__grid">{tiles.map(tile => {
      const content = <><span className="category-map__number" aria-hidden="true">{tile.number}</span><strong>{tile.label}</strong><span className="category-map__state">Qualitätsbewertung offen</span><span className="category-map__arrow" aria-hidden="true">↗</span></>
      return tile.href ? <a className="category-map__tile" data-evidence={tile.evidence} key={tile.key} href={tile.href}>{content}</a> : <div className="category-map__tile category-map__tile--unavailable" data-evidence="unknown" key={tile.key}>{content}<span className="category-map__unavailable">{state.status === 'loading' ? 'Lädt …' : 'Kein Kategorie-Einstieg verfügbar'}</span></div>
    })}</div>
    <details className="category-map__method"><summary>Was bedeutet die neutrale Darstellung?</summary><p>Erfasste Angebote allein belegen keinen Preisvorteil. Für eine Bewertung müssen gültige Angebote, passende Referenzpreise, Vergleichbarkeit, Frische und Quellenvertrauen gemeinsam belegt sein. Fehlende Evidenz ist keine schlechte Bewertung.</p></details>
  </section>
}
