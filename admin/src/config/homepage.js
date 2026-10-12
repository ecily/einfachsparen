import { QUICK_SEARCH_TERMS } from './searchDiscovery.js'
import { seoLandingPages } from './seoLandingPages.js'

export const HOME_SEO_TITLE = 'Aktuelle Angebote in \u00d6sterreich vergleichen. | kaufklug.at'
export const HOME_TITLE = 'Womit willst du heute sparen?'
export const HOME_DESCRIPTION = 'Suche Produkte oder Marken und prüfe Preise, Gültigkeit und Bedingungen aus Supermärkten und Drogerien.'
export const HOME_QUICK_SEARCHES = QUICK_SEARCH_TERMS.slice(0, 3)
export const HOME_OFFER_LINKS = [
  ['Bier', '/angebote/bier/'], ['Kaffee', '/angebote/kaffee/'], ['Waschmittel', '/angebote/waschmittel/'],
  ['Lidl', '/angebote/lidl/'], ['BILLA', '/angebote/billa/'], ['PENNY', '/angebote/penny/'],
  ['HOFER', '/angebote/hofer/'], ['dm', '/angebote/dm/'], ['BIPA', '/angebote/bipa/'],
  ['Alle Angebote', '/angebote/'], ['Supermarkt', '/angebote/supermarkt/'], ['Drogerie', '/angebote/drogerie/'],
  ['Softdrinks', '/angebote/softdrinks/'],
].map(([label, path]) => ({ label, path }))
export const HOME_LEGAL_LINKS = [
  ['Impressum', '/impressum/'], ['Datenschutz', '/datenschutz/'],
  ['Nutzungshinweise', '/nutzungshinweise/'], ['Cookies', '/cookies/'], ['Feedback', '/feedback/'],
].map(([label, path]) => ({ label, path }))

// Use the same final robots decisions as the static SEO build, never the sitemap.
export function getHomeSuggestions(pages = seoLandingPages) {
  const labels = new Map(HOME_OFFER_LINKS.map((link) => [link.path, link.label]))
  const eligible = pages.filter((page) => page.key && page.path.startsWith('/angebote') && page.robots === 'index,follow')
  const group = (page) => page.query?.q ? 0 : page.query?.retailers && !page.queries && !['supermarkt', 'drogerie'].includes(page.key) ? 1 : 2
  const links = eligible.map((page) => {
    const path = `${page.path.replace(/\/+$/, '')}/`
    return { label: labels.get(path) || page.h1.split(' Angebote')[0], path, group: group(page) }
  })
  for (const term of HOME_QUICK_SEARCHES) {
    if (!links.some((link) => link.label.toLocaleLowerCase('de') === term.toLocaleLowerCase('de'))) {
      links.push({ label: term, path: `/suche?q=${encodeURIComponent(term)}`, group: 0 })
    }
  }
  const seen = new Set()
  return links.sort((a, b) => a.group - b.group).filter((link) => {
    if (seen.has(link.path)) return false
    seen.add(link.path)
    return true
  }).map(({ label, path }) => ({ label, path }))
}

export function getRenderedHomeSuggestions() {
  const data = typeof document !== 'undefined' && document.getElementById('kaufklug-home-suggestions')
  return data ? JSON.parse(data.textContent) : getHomeSuggestions()
}
