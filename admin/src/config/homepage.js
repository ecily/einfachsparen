import { CONTACT_EMAIL } from './constants.js'
import { QUICK_SEARCH_TERMS } from './searchDiscovery.js'

export const HOME_TITLE = 'Aktuelle Angebote in Österreich vergleichen.'
export const HOME_DESCRIPTION = 'Suche Produkte oder Marken und prüfe Preise, Gültigkeit und Bedingungen aus Supermärkten und Drogerien.'
export const HOME_QUICK_SEARCHES = QUICK_SEARCH_TERMS.slice(0, 3)
export const SPONSOR_OFFER = 'Sponsorangebot: 100 EUR pro Monat oder zwei Beiträge zu je 50 EUR für eine gekennzeichnete Sponsorennennung außerhalb der Angebotslisten. Das Angebotsranking bleibt unabhängig.'
export const SPONSOR_CONTACT = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Sponsorangebot kaufklug.at')}`
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
