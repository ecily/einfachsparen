import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { seoLandingPages } from '../src/config/seoLandingPages.js'
import { buildSeoComparisonSummary } from '../src/utils/seoComparisonSummary.js'
import { deriveBeerPriceCheckCandidate, isPublishablePriceCheckCandidate } from '../src/utils/priceCheckCandidate.js'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const adminDir = dirname(scriptDir)
const distDir = join(adminDir, 'dist')
const siteUrl = 'https://www.kaufklug.at'
const comparisonApiBaseUrl = String(process.env.SEO_PUBLIC_API_BASE_URL || 'https://www.kaufklug.at/api').replace(/\/+$/, '')
const comparisonQueries = new Map([
  ['bier', 'bier'],
  ['kaffee', 'kaffee'],
  ['waschmittel', 'waschmittel'],
])
const execFileAsync = promisify(execFile)

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
      { label: 'Bier Literpreis-Preischeck', path: '/preischeck/bier-literpreis-vergleich' },
      { label: 'Softdrinks Angebote', path: '/angebote/softdrinks/' },
      { label: 'Schokolade Angebote', path: '/angebote/schokolade/' },
      { label: 'Windeln Angebote', path: '/angebote/windeln/' },
      { label: 'Duschgel Angebote', path: '/angebote/duschgel/' },
      { label: 'Nudeln Angebote', path: '/angebote/nudeln/' },
      { label: 'Chips Angebote', path: '/angebote/chips/' },
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
  const staticContent = `<main class="seo-static-shell"><p class="eyebrow">kaufklug.at</p><h1>${escapeHtml(page.h1)}</h1><p>${escapeHtml(page.intro)}</p><p>Aktuelle Angebote werden laufend aus öffentlichen Händlerquellen zusammengeführt. Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.</p>${buildRelatedLinks(page)}</main>`
  const staticContentWithPriceCheck = staticContent.replace('</main>', `${buildPriceCheckHtml(page.priceCheckCandidate)}${buildPriceCheckDataScript(page.priceCheckCandidate)}</main>`)
  const staticContentWithComparison = staticContentWithPriceCheck.replace('</main>', `${buildComparisonSummaryHtml(page.comparisonSummary)}</main>`)
  const updated = template
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(page.title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta name="description" content="${escapeHtml(page.description)}" />\n`)
    .replace(/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta name="robots" content="${escapeHtml(page.robots)}" />\n`)
    .replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>(\r?\n)?/i, `<link rel="canonical" href="${canonical}" />\n`)
    .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta property="og:title" content="${escapeHtml(page.title)}" />\n`)
    .replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta property="og:description" content="${escapeHtml(page.description)}" />\n`)
    .replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>(\r?\n)?/i, `<meta property="og:url" content="${canonical}" />\n`)
    .replace(/<div id="root"><\/div>/i, `<div id="root">${staticContentWithComparison}</div>`)
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
      comparisonKey: page.comparisonKey || '',
      comparisonSummary: page.comparisonSummary || null,
      priceCheckKey: page.priceCheckKey || '',
      priceCheckCandidate: page.priceCheckCandidate || null,
      relatedLinks: page.relatedLinks || [],
    })),
  ].filter((page, index, pages) => pages.findIndex((candidate) => candidate.path === page.path) === index)
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
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const payload = await fetchComparisonRanking(query, offset, resultSetToken)
    const pageOffers = Array.isArray(payload?.rankedOffers) ? payload.rankedOffers : []
    const summary = payload?.summary || {}
    const count = Number(summary.totalCount)
    if (!Number.isInteger(count) || count <= 0 || !pageOffers.every((offer) => offer?.id)) return null
    if (totalCount === null) totalCount = count
    if (totalCount !== count) return null
    for (const offer of pageOffers) if (!seenIds.has(offer.id)) { seenIds.add(offer.id); offers.push(offer) }
    if (!summary.hasMore) return offers
    const nextOffset = Number(summary.nextOffset)
    const nextToken = String(summary.resultSetToken || resultSetToken || '')
    if (!Number.isInteger(nextOffset) || nextOffset <= offset || !nextToken) return null
    offset = nextOffset
    resultSetToken = nextToken
  }
  return null
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
  try {
    const offers = await fetchComparisonOffers('bier')
    return deriveBeerPriceCheckCandidate(offers || [])
  } catch {
    console.warn('[seo] pricecheck candidate unavailable')
    return null
  }
}

async function syncRenderedSitemap(candidate) {
  const source = await readFile(join(adminDir, 'public', 'sitemap.xml'), 'utf8')
  const block = /\s*<url>\s*<loc>https:\/\/www\.kaufklug\.at\/preischeck\/bier-literpreis-vergleich\/<\/loc>[\s\S]*?<\/url>/i
  await writeFile(join(distDir, 'sitemap.xml'), candidate ? source : source.replace(block, ''), 'utf8')
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
  const comparisonSummaries = await buildComparisonSummaries()
  const priceCheckCandidate = await buildPriceCheckCandidate()
  renderPages = getStaticSeoPages().map((page) => page.priceCheckKey === 'bier'
    ? { ...page, robots: priceCheckCandidate ? 'index,follow' : 'noindex,follow', priceCheckCandidate }
    : page)

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
  await syncRenderedSitemap(priceCheckCandidate)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
