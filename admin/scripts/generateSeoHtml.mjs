import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { seoLandingPages } from '../src/config/seoLandingPages.js'
import {
  TRUST_PAGE_DESCRIPTION,
  TRUST_PAGE_H1,
  TRUST_PAGE_INTRO,
  TRUST_PAGE_LINKS,
  TRUST_PAGE_PATH,
  TRUST_PAGE_SECTIONS,
  TRUST_PAGE_TITLE,
} from '../src/config/trustPage.js'
import { buildSeoComparisonSummary } from '../src/utils/seoComparisonSummary.js'
import { deriveBeerPriceCheckCandidate, isPublishablePriceCheckCandidate } from '../src/utils/priceCheckCandidate.js'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const adminDir = dirname(scriptDir)
const distDir = join(adminDir, 'dist')
const siteUrl = 'https://www.kaufklug.at'
const socialImageUrl = `${siteUrl}/brand/kaufklug-logo-transparent.png`
const comparisonApiBaseUrl = String(process.env.SEO_PUBLIC_API_BASE_URL || 'https://www.kaufklug.at/api').replace(/\/+$/, '')
const SEO_MIN_PUBLIC_OFFERS = 10
const SEO_MIN_RETAILERS = 2
const SEO_MIN_IMAGE_RATIO = 0.5
const SEO_CATEGORY_KEYS = new Set([
  'angebote',
  'supermarkt',
  'drogerie',
  'kaffee',
  'bier',
  'deo',
  'softdrinks',
  'schokolade',
  'windeln',
  'duschgel',
  'nudeln',
  'chips',
  'waschmittel',
  'butter',
])
const SEO_RETAILER_KEYS = new Set(['billa', 'hofer', 'lidl', 'dm', 'bipa', 'penny'])
const comparisonQueries = new Map([
  ['bier', 'bier'],
  ['kaffee', 'kaffee'],
  ['waschmittel', 'waschmittel'],
])
const execFileAsync = promisify(execFile)
const CRITICAL_CSS = `html,body{margin:0;min-width:320px;min-height:100%;background:#f7f9fb;color:#1e2933;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}*,*:before,*:after{box-sizing:border-box}body{line-height:1.5}#root{width:100%;min-width:0}.shell{width:min(1240px,calc(100vw - 2rem));margin:0 auto;padding:2rem 0 3.5rem}.seo-static-shell{width:min(100%,760px);margin:0 auto;padding:1.25rem}.seo-static-shell h1,.seo-static-shell h2,.seo-static-shell p{max-width:100%;overflow-wrap:anywhere;white-space:normal}.seo-static-shell h1{margin:.35rem 0 .75rem;font-family:Manrope,Inter,ui-sans-serif,system-ui,sans-serif;font-size:clamp(1.8rem,5vw,3.2rem);line-height:1.08}.seo-static-shell p{color:#5f6e7c}.seo-static-links,.seo-static-comparison,.seo-static-price-check{max-width:100%;margin-top:1rem;padding:1rem;border:1px solid #d9e1e8;border-radius:1rem;background:#fff}.seo-static-links ul{display:flex;flex-wrap:wrap;gap:.45rem;margin:0;padding:0;list-style:none}.seo-static-links a{display:inline-flex;max-width:100%;padding:.42rem .68rem;border:1px solid #d9e1e8;border-radius:999px;overflow-wrap:anywhere}@media (max-width:600px){.shell{width:calc(100vw - 1rem);padding-top:.55rem}.seo-static-shell{padding:.78rem}.seo-static-shell h1{font-size:clamp(1.55rem,8vw,2.15rem)}}`

const CRITICAL_STATIC_NAV_CSS = `.page-nav{display:flex;align-items:center;gap:.75rem;width:100%;max-width:100%;margin-bottom:1.35rem;padding:.44rem;border:1px solid #d9e1e8;border-radius:1.25rem;background:#fffefaeb}.page-nav__logo{display:grid;place-items:center;flex:0 0 auto;width:2.76rem;height:2.76rem;padding:.12rem;border:1px solid #d9e1e8;border-radius:.85rem;background:#fff}.page-nav__logo img{display:block;width:100%;height:100%;object-fit:contain}.page-nav__beta{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-height:2.25rem;padding:.45rem .72rem;border:1px solid #d9e1e8;border-radius:999px;background:#fff;color:#243447;font-weight:900}.page-nav__main{display:flex;gap:.35rem;min-width:0}.page-nav__button{display:inline-flex;align-items:center;justify-content:center;min-height:2.25rem;padding:.72rem 1.05rem;border:1px solid transparent;border-radius:999px;background:transparent;color:#5f6e7c;font-weight:750;text-decoration:none}.seo-static-shell{width:100%;min-width:0}.seo-static-main{max-width:100%;padding:1.25rem;border:1px solid #d9e1e8;border-radius:1.45rem;background:#fffefa}@media (max-width:600px){.page-nav{gap:.25rem;margin-bottom:.7rem;padding:.3rem}.page-nav__logo{width:2.28rem;height:2.28rem;padding:.06rem}.page-nav__beta{min-height:2.08rem;padding:.46rem .14rem;font-size:.7rem}.page-nav__main{flex:1;gap:.1rem}.page-nav__button{min-width:0;min-height:2.08rem;padding:.46rem .16rem;font-size:.72rem}.seo-static-main{padding:.78rem}}`

const staticPages = [
  {
    path: '/',
    title: 'Aktuelle Angebote finden und beim Einkauf sparen | kaufklug.at',
    description: 'kaufklug.at zeigt aktuelle Angebote aus österreichischen Märkten. Preise, Aktionen, Bedingungen und Einkaufsliste übersichtlich vergleichen.',
    robots: 'index,follow',
    h1: 'Aktuelle Angebote finden und beim Einkauf sparen',
    relatedLinks: [
      { label: 'Top Deals heute', path: '/top-deals/' },
      { label: 'Bier Angebote', path: '/angebote/bier/' },
      { label: 'Lidl Angebote', path: '/angebote/lidl/' },
      { label: 'BILLA Angebote', path: '/angebote/billa/' },
      { label: 'PENNY Angebote', path: '/angebote/penny/' },
      { label: 'Alle Angebote', path: '/angebote/' },
      { label: 'Supermarkt Angebote', path: '/angebote/supermarkt/' },
      { label: 'Drogerie Angebote', path: '/angebote/drogerie/' },
      { label: 'Kaffee Angebote', path: '/angebote/kaffee/' },
      { label: 'Deo Angebote', path: '/angebote/deo/' },
      { label: 'Bier Literpreis-Preischeck', path: '/preischeck/bier-literpreis-vergleich' },
      { label: 'Softdrinks Angebote', path: '/angebote/softdrinks/' },
      { label: 'Schokolade Angebote', path: '/angebote/schokolade/' },
      { label: 'Windeln Angebote', path: '/angebote/windeln/' },
      { label: 'Duschgel Angebote', path: '/angebote/duschgel/' },
      { label: 'Nudeln Angebote', path: '/angebote/nudeln/' },
      { label: 'Chips Angebote', path: '/angebote/chips/' },
      { label: 'BIPA Angebote', path: '/angebote/bipa/' },
      { label: 'dm Angebote', path: '/angebote/dm/' },
      { label: 'Waschmittel Angebote', path: '/angebote/waschmittel/' },
      { label: 'Butter Angebote', path: '/angebote/butter/' },
      { label: 'HOFER Angebote', path: '/angebote/hofer/' },
      { label: 'So funktioniert kaufklug', path: `${TRUST_PAGE_PATH}/` },
    ],
    intro: 'Vergleiche aktuelle Angebote von Supermärkten und Drogerien in Österreich und prüfe Preis, Bedingungen und Gültigkeit vor dem Einkauf.',
  },
  {
    path: TRUST_PAGE_PATH,
    title: TRUST_PAGE_TITLE,
    description: TRUST_PAGE_DESCRIPTION,
    robots: 'index,follow',
    h1: TRUST_PAGE_H1,
    intro: TRUST_PAGE_INTRO,
    staticSections: TRUST_PAGE_SECTIONS,
    relatedLinks: TRUST_PAGE_LINKS,
  },
  {
    path: '/preischeck/bier-literpreis-vergleich',
    priceCheckKey: 'bier',
    title: 'Bier Literpreis vergleichen: 0,5-l-Dosen bei BILLA und PENNY',
    description: 'Konkreten Literpreis-Vergleich von 0,5-l-Dosenbier bei BILLA und PENNY mit sichtbaren Bedingungen und Public-Gültigkeit prüfen.',
    robots: 'noindex,follow',
    h1: 'Bier Literpreis vergleichen: 0,5-l-Dosen bei BILLA und PENNY',
    intro: 'Ein datenbasierter Preischeck für eine klar abgegrenzte 0,5-l-Dosenbier-Produktgruppe. Packungspreis, Literpreis, Menge und Bedingungen bleiben getrennt sichtbar.',
    relatedLinks: [
      { label: 'Bier Angebote', path: '/angebote/bier/' },
      { label: 'BILLA Angebote', path: '/angebote/billa/' },
      { label: 'PENNY Angebote', path: '/angebote/penny/' },
      { label: 'Alle Angebote', path: '/angebote/' },
    ],
  },
  {
    path: '/top-deals',
    key: 'top-deals',
    seoAutopilot: 'top-deals',
    title: 'Top Deals heute: starke Angebote nach Preis pro Einheit | kaufklug.at',
    description: 'Aktuelle Angebote mit geprüften Preisen, Bedingungen und Einheiten. kaufklug zeigt Top Deals als Orientierungshilfe.',
    robots: 'index,follow',
    h1: 'Top Deals heute',
    intro: 'Entdecke aktuell besonders interessante Angebote und vergleiche Preis pro Einheit, Bedingungen und Gültigkeit.',
    relatedLinks: [
      { label: 'Bier Angebote', path: '/angebote/bier/' },
      { label: 'Lidl Angebote', path: '/angebote/lidl/' },
      { label: 'BILLA Angebote', path: '/angebote/billa/' },
      { label: 'PENNY Angebote', path: '/angebote/penny/' },
      { label: 'Kaffee Angebote', path: '/angebote/kaffee/' },
    ],
  },
  {
    path: '/impressum',
    title: 'Impressum | kaufklug.at',
    description: 'Betreiber- und Medieninhaberangaben zu kaufklug.at.',
    robots: 'index,follow',
    h1: 'Impressum',
    intro: 'Betreiber- und Medieninhaberangaben zu kaufklug.at.',
  },
  {
    path: '/datenschutz',
    title: 'Datenschutz | kaufklug.at',
    description: 'Datenschutzhinweise zu kaufklug.at, lokaler Speicherung und Nutzungsmessung.',
    robots: 'index,follow',
    h1: 'Datenschutz',
    intro: 'Hinweise zur Verarbeitung personenbezogener Daten bei der Nutzung von kaufklug.at.',
  },
  {
    path: '/nutzungshinweise',
    title: 'Nutzungshinweise | kaufklug.at',
    description: 'Hinweise zur Nutzung von kaufklug.at als Orientierungshilfe für Angebotsinformationen.',
    robots: 'index,follow',
    h1: 'Nutzungshinweise',
    intro: 'kaufklug.at ist eine unverbindliche Orientierungshilfe. Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.',
  },
  {
    path: '/cookies',
    title: 'Cookies | kaufklug.at',
    description: 'Informationen zu Cookies, lokaler Speicherung und Nutzungsmessung bei kaufklug.at.',
    robots: 'index,follow',
    h1: 'Cookies',
    intro: 'Informationen zu Cookies, lokaler Speicherung und Nutzungsmessung bei kaufklug.at.',
  },
  {
    path: '/stoebern',
    title: 'Angebote stöbern | kaufklug.at',
    description: 'Durchsuche aktuelle Angebote nach Markt und Kategorie bei kaufklug.at.',
    robots: 'noindex,follow',
    h1: 'Angebote stöbern',
    intro: 'Durchsuche aktuelle Angebote nach Markt und Kategorie. Für gezielte Suchanfragen nutze die Produktsuche.',
  },
  {
    path: '/suche',
    title: 'Produktsuche | kaufklug.at',
    description: 'Suche aktuelle Angebote nach Produkt, Marke, Markt und Kategorie bei kaufklug.at.',
    robots: 'noindex,follow',
    h1: 'Produktsuche',
    intro: 'Suche nach Produkten und Marken und prüfe aktuelle Preise, Bedingungen und Gültigkeit.',
  },
  {
    path: '/einkaufsliste',
    title: 'Einkaufsliste | kaufklug.at',
    description: 'Organisiere gemerkte Angebote in deiner Einkaufsliste bei kaufklug.at.',
    robots: 'noindex,follow',
    h1: 'Einkaufsliste',
    intro: 'Organisiere gemerkte Angebote für deinen Einkauf. Preise und Bedingungen bitte im Markt prüfen.',
  },
  {
    path: '/liste',
    title: 'Geteilte Einkaufsliste | kaufklug.at',
    description: 'Eine geteilte Einkaufsliste von kaufklug.at.',
    robots: 'noindex,noarchive',
    h1: 'Geteilte Einkaufsliste',
    intro: 'Diese Seite zeigt eine geteilte Einkaufsliste. Preise und Bedingungen bitte im Markt prüfen.',
  },
  {
    path: '/feedback',
    title: 'Feedback senden | kaufklug.at',
    description: 'Sende Feedback zur kaufklug-Beta und hilf, den Angebotsfinder zu verbessern.',
    robots: 'noindex,follow',
    h1: 'Feedback senden',
    intro: 'Sende Ideen, Wünsche und Hinweise zur kaufklug-Beta.',
  },
  {
    path: '/ecily_web',
    title: 'Interner Bereich | kaufklug.at',
    description: 'Interner Administrationsbereich von kaufklug.at.',
    robots: 'noindex,nofollow',
    h1: 'Interner Bereich',
    intro: 'Dieser Bereich ist nicht für die öffentliche Indexierung bestimmt.',
  },
]

let renderPages = null

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function normalizePath(pathname = '/') {
  const value = `/${String(pathname).replace(/^\/+|\/+$/g, '')}`
  return value === '//' ? '/' : value
}

function canonicalPath(pathname = '/') {
  const path = normalizePath(pathname)
  return path === '/' ? '/' : `${path}/`
}

function buildBreadcrumbJsonLd(page) {
  const path = normalizePath(page.path)
  const items = [{ name: 'kaufklug.at', item: `${siteUrl}/` }]
  if (path !== '/') items.push({ name: page.h1, item: `${siteUrl}${canonicalPath(path)}` })

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.item,
    })),
  })
}

function getIndexablePaths(pages = renderPages || getStaticSeoPages()) {
  return new Set(
    pages
      .filter((page) => page.robots === 'index,follow')
      .map((page) => canonicalPath(page.path)),
  )
}

function buildRelatedLinks(page, pages) {
  const indexablePaths = getIndexablePaths(pages)
  const links = (page.relatedLinks || []).filter((link) => indexablePaths.has(canonicalPath(link.path)))
  if (!links.length) return ''

  return `<nav class="seo-static-links" aria-label="Weitere Angebote"><h2>Weitere Angebote</h2><ul>${links
    .map((link) => `<li><a href="${escapeHtml(canonicalPath(link.path))}">${escapeHtml(link.label)}</a></li>`)
    .join('')}</ul></nav>`
}

function buildTrustSections(page) {
  if (!page.staticSections?.length) return ''
  return page.staticSections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2>${section.paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('')}</section>`).join('')
}

function buildTrustLinks(page) {
  if (!page.relatedLinks?.length) return ''
  return `<nav class="seo-static-links" aria-label="Mehr über kaufklug"><h2>Weitere Informationen</h2><ul>${page.relatedLinks
    .map((link) => `<li><a href="${escapeHtml(canonicalPath(link.path))}">${escapeHtml(link.label)}</a></li>`)
    .join('')}</ul></nav>`
}

function buildAboutPageJsonLd(page) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: page.title,
    description: page.description,
    url: `${siteUrl}${canonicalPath(page.path)}`,
    inLanguage: 'de-AT',
    isPartOf: {
      '@type': 'WebSite',
      name: 'kaufklug.at',
      url: siteUrl,
    },
  })
}

function buildComparisonSummaryHtml(summary) {
  if (!summary?.facts?.length) return ''

  const dataStand = new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'medium',
    timeZone: 'Europe/Vienna',
  }).format(new Date(summary.dataStand))

  return `<section class="seo-static-comparison" aria-labelledby="seo-static-comparison-title"><div class="seo-static-comparison__heading"><div><p class="eyebrow">Vergleichs-Fakten</p><h2 id="seo-static-comparison-title">Aktueller Vergleich</h2></div><p>${escapeHtml(summary.note)}</p></div><div class="seo-static-comparison__facts">${summary.facts
    .map((fact) => `<div class="comparison-fact-card seo-static-comparison__fact"><strong>${escapeHtml(fact.split(' ')[0] || '')}</strong><span>${escapeHtml(fact.split(' ').slice(1).join(' ') || fact)}</span></div>`)
    .join('')}</div><p>Stand: ${escapeHtml(dataStand)}</p></section>`
}

function formatPrice(value) {
  return new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))
}

function formatDate(value) {
  return new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeZone: 'Europe/Vienna' }).format(new Date(value))
}

function buildPriceCheckHtml(candidate) {
  if (!isPublishablePriceCheckCandidate(candidate)) return ''
  const rows = candidate.involvedOffers.map((offer) => `<tr><th scope="row">${escapeHtml(offer.retailerName)}</th><td>${escapeHtml(offer.title)}</td><td>${escapeHtml(formatPrice(offer.price))} €</td><td>${escapeHtml(offer.quantityText)}</td><td>${escapeHtml(formatPrice(offer.unitPrice))} €/l</td><td>${escapeHtml(offer.conditions)}</td></tr>`).join('')
  const facts = candidate.involvedOffers.map((offer) => `${offer.retailerName}: ${formatPrice(offer.unitPrice)} €/l`).join(' und ')
  return `<section class="seo-static-price-check" aria-labelledby="seo-static-price-check-title"><h2 id="seo-static-price-check-title">Kurzfazit</h2><p>Bei den aktuell geprüften 0,5-l-Dosen liegt der Literpreis bei ${escapeHtml(facts)}.</p><p>${escapeHtml(candidate.explanation)}</p><h2>Vergleich</h2><table><thead><tr><th>Händler</th><th>Produkt</th><th>Packungspreis</th><th>Menge</th><th>Literpreis</th><th>Bedingung</th></tr></thead><tbody>${rows}</tbody></table><h2>Warum der Packungspreis täuschen kann</h2><p>Der Packungspreis von ${escapeHtml(candidate.involvedOffers.map((offer) => `${offer.retailerName} ${formatPrice(offer.price)} €`).join(' und '))} ist wegen unterschiedlicher Angebotspreise nicht direkt aussagekräftig. Der Literpreis macht die Menge vergleichbar; die Bedingungen bleiben dabei ausdrücklich sichtbar.</p><h2>So vergleicht kaufklug</h2><p>Für diesen Preischeck werden nur aktive Public Offers mit offizieller Quelle, erfolgreichem Crawl-Run, kompatibler 0,5-l-Menge, sicherem Literpreis und expliziter Bedingung verwendet.</p><p>Stand: ${escapeHtml(formatDate(candidate.dataStand))}</p></section>`
}

function buildPriceCheckDataScript(candidate) {
  if (!isPublishablePriceCheckCandidate(candidate)) return ''
  const json = JSON.stringify(candidate).replaceAll('<', '\\u003c')
  return `<script type="application/json" id="kaufklug-price-check-data">${json}</script>`
}

export function buildSeoStaticDocument(template, page, pages) {
  const path = normalizePath(page.path)
  const canonical = `${siteUrl}${canonicalPath(path)}`
  const staticHomeContent = `<main class="seo-static-shell"><p class="eyebrow">kaufklug.at</p><h1>Flugbl\u00e4tter raus. Die besten Angebote rein.</h1><p class="subtitle">Preise wirklich vergleichbar \u2013 pro kg, Liter oder St\u00fcck.</p><p class="search-landing-hero__markets">BILLA \u00b7 BILLA Plus \u00b7 Lidl \u00b7 PENNY \u00b7 dm \u00b7 BIPA \u00b7 M\u00fcller \u00b7 HOFER eingeschr\u00e4nkt \u00b7 INTERSPAR eingeschr\u00e4nkt</p><p class="hero-compare-facts">Vergleichbar pro kg, Liter oder St\u00fcck \u2013 Packungsgr\u00f6\u00dfen und Bedingungen inklusive.</p><p class="market-check-note">Preise, Verf\u00fcgbarkeit und Bedingungen bitte im Markt pr\u00fcfen.</p>${buildRelatedLinks(page, pages)}</main>`
  const staticContent = `<main class="seo-static-shell"><p class="eyebrow">kaufklug.at</p><h1>${escapeHtml(page.h1)}</h1><p>${escapeHtml(page.intro)}</p><p>Aktuelle Angebote werden laufend aus öffentlichen Händlerquellen zusammengeführt. Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.</p>${buildRelatedLinks(page, pages)}</main>`
  const staticTrustContent = `<main class="seo-static-shell"><p class="eyebrow">Über kaufklug</p><h1>${escapeHtml(page.h1)}</h1><p>${escapeHtml(page.intro)}</p>${buildTrustSections(page)}${buildTrustLinks(page)}</main>`
  const staticNavigation = '<nav class="page-nav seo-static-nav" aria-label="Seiten"><span class="page-nav__logo" aria-hidden="true"><img src="/brand/kaufklug-logo-transparent.png" alt="" width="78" height="78" /></span><span class="page-nav__beta">Beta</span><div class="page-nav__main"><span class="page-nav__button">Suche</span><span class="page-nav__button">Stöbern</span><span class="page-nav__button">Liste</span></div></nav>'
  const staticContentForRender = path === '/' ? staticHomeContent : page.staticSections ? staticTrustContent : staticContent
  const staticShellContent = page.staticSections
    ? staticContentForRender
      .replace('<main class="seo-static-shell">', `<main class="shell">${staticNavigation}<section class="panel seo-static-main">`)
      .replace('</main>', '</section></main>')
    : staticContentForRender
      .replace('<main class="seo-static-shell">', `<main class="shell">${staticNavigation}<div class="seo-offer-page"><section class="panel seo-offer-hero">`)
      .replace('<p>Aktuelle Angebote werden', '<p class="market-check-note">Aktuelle Angebote werden')
      .replace('</main>', '</section><section class="panel seo-offer-results" aria-busy="true"><div class="panel__header"><h2>Aktuelle Treffer</h2><p>Angebote werden aus den aktuell erkannten Daten geladen.</p></div><div class="browse-loading-status" role="status" aria-live="polite"><span class="browse-loading-status__spinner" aria-hidden="true"></span><span>Angebote werden geladen &hellip;</span></div></section></div></main>')
  const staticContentWithPriceCheck = staticShellContent.replace('</section>', `${buildPriceCheckHtml(page.priceCheckCandidate)}${buildPriceCheckDataScript(page.priceCheckCandidate)}</section>`)
  const staticContentWithComparison = staticContentWithPriceCheck.replace('<section class="panel seo-offer-results"', `${buildComparisonSummaryHtml(page.comparisonSummary)}<section class="panel seo-offer-results"`)
  const updated = template
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(page.title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta name="description" content="${escapeHtml(page.description)}" />\n`)
    .replace(/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta name="robots" content="${escapeHtml(page.robots)}" />\n`)
    .replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>(\r?\n)?/i, `<link rel="canonical" href="${canonical}" />\n`)
    .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta property="og:title" content="${escapeHtml(page.title)}" />\n`)
    .replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta property="og:description" content="${escapeHtml(page.description)}" />\n`)
    .replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta property="og:url" content="${canonical}" />\n`)
    .replace(/<div id="root"><\/div>/i, `<div id="root">${staticContentWithComparison}</div>`)
    .replace(/<link rel="stylesheet" crossorigin href="[^"]+">/i, `<style id="kaufklug-critical-css">${CRITICAL_CSS}${CRITICAL_STATIC_NAV_CSS}</style>\n    $&`)
    .replace(/<\/head>/i, `<meta property="og:image" content="${socialImageUrl}" />\n    <meta name="twitter:image" content="${socialImageUrl}" />\n  </head>`)
    .replace(/<\/head>/i, `<script type="application/ld+json" id="kaufklug-static-breadcrumb">${buildBreadcrumbJsonLd(page)}</script>\n  </head>`)

  if (page.staticSections) {
    return updated.replace(/<\/head>/i, `<script type="application/ld+json" id="kaufklug-static-about-page">${buildAboutPageJsonLd(page)}</script>\n  </head>`)
  }

  return updated
}

export function prioritizeStylesheetBeforeModuleScript(template) {
  const moduleScript = template.match(/<script type="module" crossorigin src="[^"]+"><\/script>/i)?.[0]
  const stylesheet = template.match(/<link rel="stylesheet" crossorigin href="[^"]+">/i)?.[0]

  if (!moduleScript || !stylesheet || template.indexOf(stylesheet) < template.indexOf(moduleScript)) return template

  return template.replace(`${moduleScript}\n    ${stylesheet}`, `${stylesheet}\n    ${moduleScript}`)
}

export async function retryBuildOperation(operation, { attempts = 3, delayMs = 250 } = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      if (attempt < attempts && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

export function validatePriceCheckPagePayload(payload, { expectedTotalCount = null, expectedGeneratedAt = '' } = {}) {
  const pageOffers = Array.isArray(payload?.rankedOffers) ? payload.rankedOffers : []
  const summary = payload?.summary || {}
  const totalCount = Number(summary.totalCount)
  const generatedAt = String(payload?.generatedAt || '')
  const generatedDate = new Date(generatedAt)

  if (!Number.isInteger(totalCount) || totalCount < 0 || !pageOffers.every((offer) => offer?.id)) {
    throw new Error('pricecheck API returned an incomplete result page')
  }
  if (!generatedAt || Number.isNaN(generatedDate.getTime())) throw new Error('pricecheck API returned no valid generatedAt')
  if (expectedTotalCount !== null && totalCount !== expectedTotalCount) throw new Error('pricecheck API totalCount changed during pagination')
  if (expectedGeneratedAt && generatedAt !== expectedGeneratedAt) throw new Error('pricecheck API generatedAt changed during pagination')

  const hasMore = summary.hasMore === true
  const nextOffset = Number(summary.nextOffset)
  const nextToken = String(summary.resultSetToken || '')
  if (!hasMore && summary.completeResultSetVisible !== true) throw new Error('pricecheck API did not confirm a complete result set')
  if (hasMore && (!Number.isInteger(nextOffset) || !nextToken)) throw new Error('pricecheck API returned incomplete pagination')

  return { pageOffers, totalCount, generatedAt, hasMore, nextOffset, nextToken }
}

export function getStaticSeoPages() {
  return [
    ...staticPages,
    ...seoLandingPages.map((page) => ({
      key: page.key,
      path: page.path,
      title: page.title,
      description: page.description,
      robots: page.robots || 'index,follow',
      h1: page.h1,
      intro: page.intro,
      query: page.query || null,
      seoAutopilot: page.seoAutopilot || '',
      comparisonKey: page.comparisonKey || '',
      comparisonSummary: page.comparisonSummary || null,
      priceCheckKey: page.priceCheckKey || '',
      priceCheckCandidate: page.priceCheckCandidate || null,
      relatedLinks: page.relatedLinks || [],
    })),
  ].filter((page, index, pages) => pages.findIndex((candidate) => candidate.path === page.path) === index)
}

function buildSeoRankingUrl(query = {}) {
  const url = new URL(`${comparisonApiBaseUrl}/offers/ranking`)
  if (query.q) url.searchParams.set('q', String(query.q))
  if (query.retailers) url.searchParams.set('retailers', String(query.retailers))
  if (query.categories) url.searchParams.set('categories', String(query.categories))
  url.searchParams.set('limit', '60')
  url.searchParams.set('offset', '0')
  return url
}

export function buildSeoPageQuality(page, payload) {
  const summary = payload?.summary || {}
  const offers = Array.isArray(payload?.rankedOffers) ? payload.rankedOffers : []
  const totalCount = Number(summary.totalCount)
  const retailerKeys = new Set(offers.map((offer) => String(offer?.retailerKey || '').trim()).filter(Boolean))
  const imageCount = offers.filter((offer) => String(offer?.imageUrl || '').trim()).length
  const imageRatio = offers.length > 0 ? imageCount / offers.length : 0
  const isCategory = SEO_CATEGORY_KEYS.has(page.key)
  const isRetailer = SEO_RETAILER_KEYS.has(page.key)
  const hasMinimumOffers = Number.isInteger(totalCount) && totalCount >= SEO_MIN_PUBLIC_OFFERS
  const hasRequiredRetailerBreadth = isRetailer || isCategory && retailerKeys.size >= SEO_MIN_RETAILERS
  const hasSufficientImages = isCategory || imageRatio >= SEO_MIN_IMAGE_RATIO

  return {
    available: Number.isInteger(totalCount) && totalCount >= 0 && offers.every((offer) => offer?.id),
    totalCount: Number.isInteger(totalCount) ? totalCount : 0,
    sampledCount: offers.length,
    retailerCount: retailerKeys.size,
    imageCount,
    imageRatio,
    indexable: hasMinimumOffers && hasRequiredRetailerBreadth && hasSufficientImages,
    reason: !hasMinimumOffers
      ? 'too-few-public-offers'
      : !hasRequiredRetailerBreadth
        ? 'insufficient-retailer-breadth'
        : !hasSufficientImages
          ? 'insufficient-image-coverage'
          : 'quality-thresholds-met',
  }
}

function buildTopDealsQuality(payload) {
  const totalCount = Number(payload?.count)
  return {
    available: Number.isInteger(totalCount) && totalCount >= 0,
    totalCount: Number.isInteger(totalCount) ? totalCount : 0,
    sampledCount: Array.isArray(payload?.deals) ? payload.deals.length : 0,
    retailerCount: new Set((payload?.deals || []).map((deal) => String(deal?.retailerKey || '').trim()).filter(Boolean)).size,
    imageCount: (payload?.deals || []).filter((deal) => String(deal?.imageUrl || '').trim()).length,
    imageRatio: 0,
    indexable: Number.isInteger(totalCount) && totalCount >= SEO_MIN_PUBLIC_OFFERS,
    reason: Number.isInteger(totalCount) && totalCount >= SEO_MIN_PUBLIC_OFFERS ? 'quality-thresholds-met' : 'too-few-public-top-deals',
  }
}

async function fetchJsonWithCurlFallback(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`SEO quality API HTTP ${response.status}`)
    return response.json()
  } catch (fetchError) {
    try {
      const curlArgs = ['--fail', '--silent', '--show-error', '--max-time', '30', url.href]
      if (process.platform === 'win32') curlArgs.splice(5, 0, '--ssl-no-revoke')
      const { stdout } = await execFileAsync(process.platform === 'win32' ? 'curl.exe' : 'curl', curlArgs, {
        maxBuffer: 16 * 1024 * 1024,
      })
      return JSON.parse(stdout)
    } catch {
      throw fetchError
    }
  }
}

export async function fetchSeoPageQuality(page) {
  if (page?.seoAutopilot === 'top-deals') {
    try {
      const url = new URL(`${comparisonApiBaseUrl}/offers/top-deals`)
      url.searchParams.set('limit', '20')
      return buildTopDealsQuality(await fetchJsonWithCurlFallback(url))
    } catch (error) {
      return {
        available: false,
        totalCount: 0,
        sampledCount: 0,
        retailerCount: 0,
        imageCount: 0,
        imageRatio: 0,
        indexable: false,
        reason: 'quality-data-unavailable',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const query = page?.query || {}
  const url = buildSeoRankingUrl(query)

  try {
    return buildSeoPageQuality(page, await fetchJsonWithCurlFallback(url))
  } catch (error) {
    return {
      available: false,
      totalCount: 0,
      sampledCount: 0,
      retailerCount: 0,
      imageCount: 0,
      imageRatio: 0,
      indexable: false,
      reason: 'quality-data-unavailable',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function applySeoAutopilot(pages, qualityByPath = new Map()) {
  return pages.map((page) => {
    if (page.robots !== 'index,follow' || !page.key || (!page.query && !page.seoAutopilot)) return page

    const quality = qualityByPath.get(page.path)
    if (!quality) return { ...page, robots: 'noindex,follow', seoQuality: { reason: 'quality-data-unavailable' } }

    return {
      ...page,
      robots: quality.indexable ? 'index,follow' : 'noindex,follow',
      seoQuality: quality,
    }
  })
}

export function filterSitemapXml(xml, indexablePaths) {
  const allowed = indexablePaths instanceof Set ? indexablePaths : new Set(indexablePaths || [])
  const body = String(xml || '').replace(/\s*<url>[\s\S]*?<\/url>/gi, (block) => {
    const loc = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1] || ''
    return allowed.has(loc) ? `\n${block.trim()}` : ''
  })
  return body.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

async function fetchComparisonRanking(query, offset, resultSetToken = '') {
  const url = new URL(`${comparisonApiBaseUrl}/offers/ranking`)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '60')
  url.searchParams.set('offset', String(offset))
  if (resultSetToken) url.searchParams.set('resultSetToken', resultSetToken)

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`comparison API HTTP ${response.status}`)
    return response.json()
  } catch (fetchError) {
    try {
      const curlArgs = [
        '--fail',
        '--silent',
        '--show-error',
        '--max-time',
        '30',
        url.href,
      ]
      if (process.platform === 'win32') curlArgs.splice(5, 0, '--ssl-no-revoke')
      const { stdout } = await execFileAsync(process.platform === 'win32' ? 'curl.exe' : 'curl', curlArgs, {
        maxBuffer: 16 * 1024 * 1024,
      })
      return JSON.parse(stdout)
    } catch {
      throw fetchError
    }
  }
}

async function fetchComparisonSummary(pageKey) {
  const query = comparisonQueries.get(pageKey)
  if (!query) return null

  const offers = []
  const seenIds = new Set()
  let offset = 0
  let resultSetToken = ''
  let totalCount = null
  let generatedAt = ''

  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const payload = await fetchComparisonRanking(query, offset, resultSetToken)
    const pageOffers = Array.isArray(payload?.rankedOffers) ? payload.rankedOffers : []
    const pageSummary = payload?.summary || {}
    const pageTotalCount = Number(pageSummary.totalCount)

    if (!Number.isInteger(pageTotalCount) || pageTotalCount <= 0 || !pageOffers.every((offer) => offer?.id)) {
      return null
    }

    if (totalCount === null) totalCount = pageTotalCount
    if (totalCount !== pageTotalCount) return null
    if (!generatedAt) generatedAt = payload.generatedAt || ''

    for (const offer of pageOffers) {
      if (!seenIds.has(offer.id)) {
        seenIds.add(offer.id)
        offers.push(offer)
      }
    }

    if (!pageSummary.hasMore) break

    const nextOffset = Number(pageSummary.nextOffset)
    const nextToken = String(pageSummary.resultSetToken || resultSetToken || '')
    if (!Number.isInteger(nextOffset) || nextOffset <= offset || !nextToken) return null
    offset = nextOffset
    resultSetToken = nextToken
  }

  return buildSeoComparisonSummary({ pageKey, offers, totalCount, generatedAt })
}

async function fetchComparisonOffers(pageKey) {
  const query = comparisonQueries.get(pageKey)
  if (!query) return null
  const offers = []
  const seenIds = new Set()
  let offset = 0
  let resultSetToken = ''
  let totalCount = null
  let generatedAt = ''
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const payload = await fetchComparisonRanking(query, offset, resultSetToken)
    const page = validatePriceCheckPagePayload(payload, {
      expectedTotalCount: totalCount,
      expectedGeneratedAt: generatedAt,
    })
    const { pageOffers, totalCount: count } = page
    if (totalCount === null) totalCount = count
    if (!generatedAt) generatedAt = page.generatedAt
    for (const offer of pageOffers) if (!seenIds.has(offer.id)) { seenIds.add(offer.id); offers.push(offer) }
    if (!page.hasMore) return offers
    if (page.nextOffset <= offset) throw new Error('pricecheck API pagination did not advance')
    offset = page.nextOffset
    resultSetToken = page.nextToken
  }
  throw new Error('pricecheck API exceeded the pagination budget')
}

async function buildComparisonSummaries() {
  const summaries = new Map()
  await Promise.all(
    [...comparisonQueries.keys()].map(async (pageKey) => {
      try {
        const summary = await fetchComparisonSummary(pageKey)
        if (summary) summaries.set(pageKey, summary)
        else console.warn(`[seo] comparison summary omitted for ${pageKey}`)
      } catch {
        // Fail closed: volatile comparison content is omitted when the Public API is unavailable.
        console.warn(`[seo] comparison summary unavailable for ${pageKey}`)
      }
    }),
  )
  return summaries
}

async function buildPriceCheckCandidate() {
  return retryBuildOperation(async () => {
    const offers = await fetchComparisonOffers('bier')
    return deriveBeerPriceCheckCandidate(offers || [])
  }, { attempts: 3, delayMs: 250 })
}

async function syncRenderedSitemap(candidate, pages = renderPages || getStaticSeoPages()) {
  const source = await readFile(join(adminDir, 'public', 'sitemap.xml'), 'utf8')
  const block = /\s*<url>\s*<loc>https:\/\/www\.kaufklug\.at\/preischeck\/bier-literpreis-vergleich\/<\/loc>[\s\S]*?<\/url>/i
  const priceCheckSource = candidate ? source : source.replace(block, '')
  const indexablePaths = new Set(pages.filter((page) => page.robots === 'index,follow').map((page) => `${siteUrl}${canonicalPath(page.path)}`))
  await writeFile(join(distDir, 'sitemap.xml'), filterSitemapXml(priceCheckSource, indexablePaths), 'utf8')
}

export function buildCatchallDocument(template) {
  const scriptSrc = (template.match(/<script type="module" crossorigin src="([^"]+)"/i) || [])[1] || ''
  const styleHref = (template.match(/<link rel="stylesheet" crossorigin href="([^"]+)"/i) || [])[1] || ''

  return `<!doctype html>
<html lang="de-AT">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Seite nicht gefunden | kaufklug.at</title>
    <meta name="robots" content="noindex,nofollow" />
    <style id="kaufklug-critical-css">${CRITICAL_CSS}</style>
    ${styleHref ? `<link rel="stylesheet" crossorigin href="${styleHref}" />` : ''}
  </head>
  <body>
    <main>
      <h1>Seite nicht gefunden</h1>
      <p>Diese kaufklug.at-Seite ist nicht verfügbar.</p>
      <p><a href="/">Zur Startseite</a></p>
    </main>
    <div id="root"></div>
    ${scriptSrc ? `<script type="module" crossorigin src="${scriptSrc}"></script>` : ''}
  </body>
</html>
`
}

async function main() {
  const template = prioritizeStylesheetBeforeModuleScript(await readFile(join(distDir, 'index.html'), 'utf8'))
  const comparisonSummaries = await buildComparisonSummaries()
  const priceCheckCandidate = await buildPriceCheckCandidate()
  const staticSeoPages = getStaticSeoPages().map((page) => page.priceCheckKey === 'bier'
    ? { ...page, robots: priceCheckCandidate ? 'index,follow' : 'noindex,follow', priceCheckCandidate }
    : page)
  const qualityByPath = new Map()
  await Promise.all(staticSeoPages
    .filter((page) => page.robots === 'index,follow' && page.key && (page.query || page.seoAutopilot))
    .map(async (page) => qualityByPath.set(page.path, await fetchSeoPageQuality(page))))
  renderPages = applySeoAutopilot(staticSeoPages, qualityByPath)

  for (const page of renderPages) {
    const pageWithSummary = comparisonSummaries.has(page.comparisonKey)
      ? { ...page, comparisonSummary: comparisonSummaries.get(page.comparisonKey) }
      : page
    const routePath = normalizePath(page.path)
    const outputPath = routePath === '/' ? join(distDir, 'index.html') : join(distDir, ...routePath.slice(1).split('/'), 'index.html')
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, buildSeoStaticDocument(template, pageWithSummary, renderPages), 'utf8')
  }

  await writeFile(join(distDir, 'catchall.html'), buildCatchallDocument(template), 'utf8')
  await syncRenderedSitemap(priceCheckCandidate, renderPages)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
