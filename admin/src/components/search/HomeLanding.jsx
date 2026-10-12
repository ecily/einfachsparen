import { HOME_DESCRIPTION, HOME_LEGAL_LINKS, HOME_OFFER_LINKS, getRenderedHomeSuggestions, HOME_TITLE } from '../../config/homepage'

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
        <nav className="home-compact__links home-compact__suggestions" aria-label="Schnellsuchen">
          {getRenderedHomeSuggestions().map((link) => <a key={link.path} href={link.path}>{link.label}</a>)}
        </nav>
        <nav className="home-compact__links home-compact__secondary" aria-label="Weitere Einstiege">
          <a href="/top-deals/">Top Deals</a><a href="/stoebern">Stöbern</a>
        </nav>
        <p className="home-compact__note">Kostenlos und ohne Konto. Angebote auf deiner <a href="/einkaufsliste">Einkaufsliste</a> merken.</p>
        <p className="home-compact__note">Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen. <a href="/so-funktioniert-kaufklug/">Methodik und Grenzen</a></p>
      </section>
      <footer className="home-compact__footer">
        <nav aria-label="Angebotsseiten"><strong>Angebotsseiten</strong><div className="home-compact__links">{HOME_OFFER_LINKS.map((link) => <a key={link.path} href={link.path}>{link.label}</a>)}</div></nav>
        <nav className="home-compact__links" aria-label="Rechtliches">{HOME_LEGAL_LINKS.map((link) => <a key={link.path} href={link.path}>{link.label}</a>)}</nav>
        <small>© 2026 kaufklug.at</small>
      </footer>
    </div>
  )
}
