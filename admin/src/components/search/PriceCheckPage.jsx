import { useState } from 'react'

function readEmbeddedCandidate() {
  if (typeof document === 'undefined') return null
  const element = document.getElementById('kaufklug-price-check-data')
  if (!element) return null

  try {
    return JSON.parse(element.textContent || 'null')
  } catch {
    return null
  }
}

function formatPrice(value) {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
    : '—'
}

function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeZone: 'Europe/Vienna' }).format(date)
}

export function PriceCheckPage() {
  const [candidate] = useState(readEmbeddedCandidate)

  if (!candidate?.involvedOffers?.length) {
    return (
      <section className="panel price-check-page price-check-page--fallback">
        <p className="eyebrow">Preischeck</p>
        <h1>Bier Literpreis vergleichen</h1>
        <p>Dieser Vergleich ist aktuell nicht belastbar verfügbar. Bitte prüfe die aktuellen Bier-Angebote direkt.</p>
        <a className="ghost-button" href="/angebote/bier/">Zu den Bier-Angeboten</a>
      </section>
    )
  }

  const [first, second] = candidate.involvedOffers
  const comparisonText = first && second
    ? `Im direkten Vergleich liegt der Literpreis bei ${first.retailerName} bei ${formatPrice(first.unitPrice)} €/l und bei ${second.retailerName} bei ${formatPrice(second.unitPrice)} €/l.`
    : ''

  return (
    <div className="price-check-page">
      <section className="panel price-check-page__hero">
        <p className="eyebrow">Datenbasierter Preischeck</p>
        <h1>{candidate.h1}</h1>
        <p className="subtitle">{candidate.comparisonBasis}</p>
      </section>

      <section className="panel price-check-page__comparison" aria-labelledby="price-check-comparison-title">
        <div className="price-check-page__heading">
          <div>
            <p className="eyebrow">Direkter Vergleich</p>
            <h2 id="price-check-comparison-title">Literpreis auf einen Blick</h2>
          </div>
          <p>{comparisonText}</p>
        </div>
        <div className="price-check-page__offers">
          {candidate.involvedOffers.map((offer) => (
            <article className="price-check-page__offer" key={offer.id}>
              <div className="price-check-page__offer-top">
                <span className="user-card__retailer-badge">{offer.retailerName}</span>
                <strong>{offer.title}</strong>
              </div>
              <div className="price-check-page__metrics">
                <span><small>Packungspreis</small><strong>{formatPrice(offer.price)} €</strong></span>
                <span><small>Menge</small><strong>{offer.quantityText}</strong></span>
                <span className="price-check-page__unit"><small>Preis pro Liter</small><strong>{formatPrice(offer.unitPrice)} €/l</strong></span>
              </div>
              <p className="price-check-page__condition"><b>Kaufbedingung:</b> {offer.conditions}</p>
            </article>
          ))}
        </div>
        <p className="price-check-page__note">Die Aussage bleibt auf diese konkrete Produktgruppe und die genannten Händler begrenzt. Es wird kein allgemeiner Bestpreis behauptet.</p>
        <p className="price-check-page__stand">Stand: {formatDate(candidate.dataStand)}</p>
      </section>

      <nav className="panel price-check-page__links" aria-label="Weitere Angebote">
        <a href="/angebote/bier/">Bier-Angebote</a>
        <a href="/angebote/billa/">BILLA-Angebote</a>
        <a href="/angebote/penny/">PENNY-Angebote</a>
        <a href="/angebote/">Alle Angebote</a>
      </nav>
    </div>
  )
}
