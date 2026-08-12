import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seoLandingPages } from '../src/config/seoLandingPages.js'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const adminDir = dirname(scriptDir)
const distDir = join(adminDir, 'dist')
const siteUrl = 'https://www.kaufklug.at'

const staticPages = [
  {
    path: '/',
    title: 'Aktuelle Angebote finden und beim Einkauf sparen | kaufklug.at',
    description: 'kaufklug.at zeigt aktuelle Angebote aus österreichischen Märkten. Preise, Aktionen, Bedingungen und Einkaufsliste übersichtlich vergleichen.',
    robots: 'index,follow',
    h1: 'Aktuelle Angebote finden und beim Einkauf sparen',
    relatedLinks: [
      { label: 'Top Deals heute', path: '/top-deals/' },
      { label: 'Alle Angebote', path: '/angebote/' },
      { label: 'Supermarkt Angebote', path: '/angebote/supermarkt/' },
      { label: 'Drogerie Angebote', path: '/angebote/drogerie/' },
      { label: 'Kaffee Angebote', path: '/angebote/kaffee/' },
      { label: 'Bier Angebote', path: '/angebote/bier/' },
      { label: 'BILLA Angebote', path: '/angebote/billa/' },
      { label: 'Lidl Angebote', path: '/angebote/lidl/' },
      { label: 'BIPA Angebote', path: '/angebote/bipa/' },
      { label: 'dm Angebote', path: '/angebote/dm/' },
      { label: 'PENNY Angebote', path: '/angebote/penny/' },
      { label: 'Waschmittel Angebote', path: '/angebote/waschmittel/' },
      { label: 'Butter Angebote', path: '/angebote/butter/' },
      { label: 'HOFER Angebote', path: '/angebote/hofer/' },
    ],
    intro: 'Vergleiche aktuelle Angebote von Supermärkten und Drogerien in Österreich und prüfe Preis, Bedingungen und Gültigkeit vor dem Einkauf.',
  },
  {
    path: '/top-deals',
    title: 'Top Deals heute | kaufklug.at',
    description: 'Aktuelle Top Deals mit Preis pro Einheit und Bedingungen. kaufklug zeigt belastbare Angebotsinformationen als Orientierungshilfe.',
    robots: 'index,follow',
    h1: 'Top Deals heute',
    intro: 'Entdecke aktuell besonders interessante Angebote und vergleiche Preis pro Einheit, Bedingungen und Gültigkeit.',
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
  if (path !== '/') items.push({ name: page.h1, item: `${siteUrl}${path}` })

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

function getIndexablePaths() {
  return new Set(
    getStaticSeoPages()
      .filter((page) => page.robots === 'index,follow')
      .map((page) => canonicalPath(page.path)),
  )
}

function buildRelatedLinks(page) {
  const indexablePaths = getIndexablePaths()
  const links = (page.relatedLinks || []).filter((link) => indexablePaths.has(canonicalPath(link.path)))
  if (!links.length) return ''

  return `<nav class="seo-static-links" aria-label="Weitere Angebote"><h2>Weitere Angebote</h2><ul>${links
    .map((link) => `<li><a href="${escapeHtml(canonicalPath(link.path))}">${escapeHtml(link.label)}</a></li>`)
    .join('')}</ul></nav>`
}

export function buildSeoStaticDocument(template, page) {
  const path = normalizePath(page.path)
  const canonical = `${siteUrl}${canonicalPath(path)}`
  const staticContent = `<main class="seo-static-shell"><p class="eyebrow">kaufklug.at</p><h1>${escapeHtml(page.h1)}</h1><p>${escapeHtml(page.intro)}</p><p>Aktuelle Angebote werden laufend aus öffentlichen Händlerquellen zusammengeführt. Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.</p>${buildRelatedLinks(page)}</main>`
  const updated = template
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(page.title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta name="description" content="${escapeHtml(page.description)}" />\n`)
    .replace(/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta name="robots" content="${escapeHtml(page.robots)}" />\n`)
    .replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>(\r?\n)?/i, `<link rel="canonical" href="${canonical}" />\n`)
    .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta property="og:title" content="${escapeHtml(page.title)}" />\n`)
    .replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta property="og:description" content="${escapeHtml(page.description)}" />\n`)
    .replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta property="og:url" content="${canonical}" />\n`)
    .replace(/<div id="root"><\/div>/i, `<div id="root">${staticContent}</div>`)
    .replace(/<\/head>/i, `<script type="application/ld+json" id="kaufklug-static-breadcrumb">${buildBreadcrumbJsonLd(page)}</script>\n  </head>`)

  return updated
}

export function getStaticSeoPages() {
  return [
    ...staticPages,
    ...seoLandingPages.map((page) => ({
      path: page.path,
      title: page.title,
      description: page.description,
      robots: page.robots || 'index,follow',
      h1: page.h1,
      intro: page.intro,
      relatedLinks: page.relatedLinks || [],
    })),
  ].filter((page, index, pages) => pages.findIndex((candidate) => candidate.path === page.path) === index)
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
  const template = await readFile(join(distDir, 'index.html'), 'utf8')

  for (const page of getStaticSeoPages()) {
    const routePath = normalizePath(page.path)
    const outputPath = routePath === '/' ? join(distDir, 'index.html') : join(distDir, ...routePath.slice(1).split('/'), 'index.html')
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, buildSeoStaticDocument(template, page), 'utf8')
  }

  await writeFile(join(distDir, 'catchall.html'), buildCatchallDocument(template), 'utf8')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
