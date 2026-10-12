import { CONTACT_EMAIL } from '../../config/constants'
import { HOME_DESCRIPTION, HOME_LEGAL_LINKS, HOME_OFFER_LINKS, HOME_QUICK_SEARCHES, HOME_TITLE, SPONSOR_CONTACT, SPONSOR_OFFER } from '../../config/homepage'

export function HomeLanding() {
  return (
    <div className="home-compact">
      <section className="panel home-compact__hero" aria-labelledby="home-title">
        <h1 id="home-title">{HOME_TITLE}</h1>
        <p>{HOME_DESCRIPTION}</p>
        <form className="home-compact__search" action="/suche" method="get" role="search">
          <label htmlFor="home-search">Produkt oder Marke suchen</label>
          <div>
            <input id="home-search" type="search" name="q" placeholder="z. B. Kaffee" required />
            <button type="submit">Suchen</button>
          </div>
        </form>
        <nav className="home-compact__links" aria-label="Schnellsuchen">
          {HOME_QUICK_SEARCHES.map((term) => <a key={term} href={`/suche?q=${encodeURIComponent(term)}`}>{term}</a>)}
        </nav>
        <nav className="home-compact__links home-compact__secondary" aria-label="Weitere Einstiege">
          <a href="/top-deals/">Top Deals</a><a href="/stoebern">Stöbern</a>
        </nav>
        <p className="home-compact__note">Kostenlos und ohne Konto. Angebote auf deiner <a href="/einkaufsliste">Einkaufsliste</a> merken.</p>
        <p className="home-compact__note">Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen. <a href="/so-funktioniert-kaufklug/">Methodik und Grenzen</a></p>
      </section>
      <aside className="home-compact__sponsor" aria-label="kaufklug unterstützen">
        <details>
          <summary>kaufklug unterstützen / Sponsor werden</summary>
          <p>{SPONSOR_OFFER}</p>
          <p>Ziel: 100 EUR monatlich zur Kostendeckung. <a href={SPONSOR_CONTACT}>Anfragen an {CONTACT_EMAIL}</a></p>
        </details>
      </aside>
      <footer className="home-compact__footer">
        <nav aria-label="Angebotsseiten"><strong>Angebotsseiten</strong><div className="home-compact__links">{HOME_OFFER_LINKS.map((link) => <a key={link.path} href={link.path}>{link.label}</a>)}</div></nav>
        <nav className="home-compact__links" aria-label="Rechtliches">{HOME_LEGAL_LINKS.map((link) => <a key={link.path} href={link.path}>{link.label}</a>)}</nav>
        <small>© 2026 kaufklug.at</small>
      </footer>
    </div>
  )
}
