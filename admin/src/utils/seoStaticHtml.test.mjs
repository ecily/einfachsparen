import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildSeoStaticDocument, getStaticSeoPages } from '../../scripts/generateSeoHtml.mjs'
import { seoFooterLinkGroups } from '../config/seoLandingPages.js'

const template = `<!doctype html><html><head><title>Default</title><meta name="description" content="Default" /><meta name="robots" content="index,follow" /><link rel="canonical" href="https://www.kaufklug.at/" /><meta property="og:title" content="Default" /><meta property="og:description" content="Default" /><meta property="og:url" content="https://www.kaufklug.at/" /></head><body><div id="root"></div></body></html>`

test('static SEO documents expose route-specific metadata and visible content', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/angebote/billa')
  const html = buildSeoStaticDocument(template, page)

  assert.match(html, /<title>BILLA Angebote aktuell vergleichen \| kaufklug\.at<\/title>/)
  assert.match(html, /<meta name="description" content="Aktuelle BILLA- und BILLA Plus-Angebote und Aktionen in \u00d6sterreich vergleichen \u2013 mit Preisen, Packungsgr\u00f6\u00dfen, G\u00fcltigkeit und Bedingungen\." \/>/)
  assert.match(html, /<meta property="og:description" content="Aktuelle BILLA- und BILLA Plus-Angebote und Aktionen in \u00d6sterreich vergleichen \u2013 mit Preisen, Packungsgr\u00f6\u00dfen, G\u00fcltigkeit und Bedingungen\." \/>/)
  assert.match(html, /canonical" href="https:\/\/www\.kaufklug\.at\/angebote\/billa/)
  assert.match(html, /<h1>BILLA Angebote aktuell vergleichen<\/h1>/)
  assert.match(html, /property="og:image" content="https:\/\/www\.kaufklug\.at\/brand\/kaufklug-logo-transparent\.png"/)
  assert.match(html, /application\/ld\+json/)
  assert.match(html, /"item":"https:\/\/www\.kaufklug\.at\/angebote\/billa\/"/)
  assert.doesNotMatch(html, /"item":"https:\/\/www\.kaufklug\.at\/angebote\/billa"}/)
  assert.doesNotMatch(page.description, /Prospekt|Flugblatt/i)
})

test('runtime SEO footer links use canonical trailing-slash paths', () => {
  const links = seoFooterLinkGroups.flatMap((group) => group.links)

  for (const link of links) {
    assert.match(link.path, /\/$/, `non-canonical footer path for ${link.key}`)
  }
  assert.equal(links.find((link) => link.key === 'bier')?.path, '/angebote/bier/')
  assert.equal(links.find((link) => link.key === 'lidl')?.path, '/angebote/lidl/')
})

test('homepage exposes crawlable internal SEO links in initial HTML', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/')
  const html = buildSeoStaticDocument(template, page)

  assert.match(html, /<h1>Flugbl\u00e4tter raus\. Die besten Angebote rein\.<\/h1>/)
  assert.match(html, /Preise wirklich vergleichbar \u2013 pro kg, Liter oder St\u00fcck\./)
  assert.match(html, /BILLA \u00b7 BILLA Plus \u00b7 Lidl \u00b7 PENNY \u00b7 dm \u00b7 BIPA \u00b7 M\u00fcller \u00b7 HOFER eingeschr\u00e4nkt \u00b7 INTERSPAR eingeschr\u00e4nkt/)
  assert.match(html, /Packungsgr\u00f6\u00dfen und Bedingungen inklusive\./)
  assert.match(html, /<meta name="robots" content="index,follow" \/>/)
  assert.match(html, /canonical" href="https:\/\/www\.kaufklug\.at\/"/)
  for (const path of ['/top-deals/', '/angebote/billa/', '/angebote/lidl/', '/angebote/waschmittel/', '/so-funktioniert-kaufklug/']) {
    assert.ok(html.includes(`<a href="${path}">`), `missing crawlable link ${path}`)
  }
  assert.ok(html.indexOf('/angebote/bier/') < html.indexOf('/angebote/kaffee/'))
  assert.ok(html.indexOf('/angebote/lidl/') < html.indexOf('/angebote/billa/'))
})

test('Top Deals gives crawlable priority links to beer and the recovering retailers', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/top-deals')
  const html = buildSeoStaticDocument(template, page)

  for (const path of ['/angebote/bier/', '/angebote/lidl/', '/angebote/billa/', '/angebote/penny/']) {
    assert.ok(html.includes(`<a href="${path}">`), `missing Top Deals priority link ${path}`)
  }
})

test('trust page is indexable, substantive and machine-readable without invented organization claims', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/so-funktioniert-kaufklug')
  const html = buildSeoStaticDocument(template, page, getStaticSeoPages())

  assert.equal(page.robots, 'index,follow')
  assert.match(html, /<title>So funktioniert kaufklug\.at: Methodik und Betreiber<\/title>/)
  assert.match(html, /canonical" href="https:\/\/www\.kaufklug\.at\/so-funktioniert-kaufklug\//)
  assert.match(html, /<h1>So funktioniert kaufklug\.at<\/h1>/)
  for (const heading of ['Wer hinter kaufklug.at steht', 'Woher die Angebotsinformationen kommen', 'Wie Angebote aufbereitet werden', 'Abdeckung und Grenzen', 'Fehler melden und Korrekturen']) {
    assert.ok(html.includes(`<h2>${heading}</h2>`), `missing trust section ${heading}`)
  }
  for (const path of ['/feedback/', '/impressum/', '/nutzungshinweise/', '/datenschutz/']) {
    assert.ok(html.includes(`<a href="${path}">`), `missing trust link ${path}`)
  }
  assert.match(html, /"@type":"AboutPage"/)
  assert.doesNotMatch(html, /"@type":"Organization"/)
  assert.doesNotMatch(html, /vollständig(?:e|en)? Angebote|Bestpreis|Echtzeit|Affiliate|bezahlte Platzierung/i)
  assert.doesNotMatch(html, /Angebote werden geladen/)
})

test('offer landing pages do not receive trust-page structured data', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/angebote/billa')
  const html = buildSeoStaticDocument(template, page, getStaticSeoPages())

  assert.doesNotMatch(html, /kaufklug-static-about-page|"@type":"AboutPage"/)
})

test('indexable landing pages render related links without utility or noindex targets', () => {
  const retailer = getStaticSeoPages().find((page) => page.path === '/angebote/billa')
  const category = getStaticSeoPages().find((page) => page.path === '/angebote/waschmittel')
  const retailerHtml = buildSeoStaticDocument(template, retailer)
  const categoryHtml = buildSeoStaticDocument(template, category)

  assert.ok(retailerHtml.includes('<a href="/angebote/supermarkt/">'))
  assert.ok(categoryHtml.includes('<a href="/angebote/drogerie/">'))
  assert.ok(categoryHtml.includes('<a href="/angebote/dm/">'))
  for (const html of [retailerHtml, categoryHtml]) {
    assert.doesNotMatch(html, /href="\/(?:suche|stoebern|einkaufsliste)\//)
    assert.doesNotMatch(html, /href="\/angebote\/(?:spar|kaese|mueller)\//)
  }
})

test('high-impression landing pages expose comparison metadata and relevant links', () => {
  const expected = {
    lidl: {
      title: 'Lidl Angebote aktuell vergleichen | kaufklug.at',
      h1: 'Lidl Angebote aktuell vergleichen',
      signal: 'Preis pro Einheit',
      links: ['/angebote/bier/', '/angebote/kaffee/', '/angebote/schokolade/', '/angebote/nudeln/', '/angebote/chips/'],
    },
    billa: {
      title: 'BILLA Angebote aktuell vergleichen | kaufklug.at',
      h1: 'BILLA Angebote aktuell vergleichen',
      signal: 'Preis pro Einheit',
      links: ['/angebote/bier/', '/angebote/kaffee/', '/angebote/schokolade/', '/angebote/nudeln/', '/angebote/chips/'],
    },
    supermarkt: {
      title: 'Supermarkt Angebote in Österreich vergleichen | kaufklug.at',
      h1: 'Supermarkt Angebote vergleichen',
      signal: 'Preis pro kg, Liter oder Stück',
      links: ['/angebote/bier/', '/angebote/kaffee/', '/angebote/schokolade/', '/angebote/nudeln/', '/angebote/chips/'],
    },
    waschmittel: {
      title: 'Waschmittel Angebote vergleichen: Preise & Packungsgrößen | kaufklug.at',
      h1: 'Waschmittel Angebote vergleichen: Preise & Packungsgrößen',
      signal: 'Preis pro sicher vorhandener Einheit',
      links: ['/angebote/drogerie/', '/angebote/bipa/', '/angebote/dm/', '/angebote/windeln/', '/angebote/duschgel/'],
    },
    bipa: {
      title: 'BIPA Angebote aktuell vergleichen | kaufklug.at',
      h1: 'BIPA Angebote aktuell vergleichen',
      signal: 'Liter- oder Stückpreis',
      links: ['/angebote/waschmittel/', '/angebote/windeln/', '/angebote/duschgel/'],
    },
    drogerie: {
      title: 'Drogerie Angebote aktuell vergleichen | kaufklug.at',
      h1: 'Drogerie Angebote aktuell vergleichen',
      signal: 'Literpreise, Stückpreise',
      links: ['/angebote/waschmittel/', '/angebote/windeln/', '/angebote/duschgel/'],
    },
  }

  for (const [key, contract] of Object.entries(expected)) {
    const page = getStaticSeoPages().find((candidate) => candidate.path === `/angebote/${key}`)
    const html = buildSeoStaticDocument(template, page)

    assert.equal(page.robots, 'index,follow')
    assert.equal(page.title, contract.title)
    const escapedTitle = contract.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('&', '&amp;')
    assert.match(html, new RegExp(`<title>${escapedTitle}</title>`))
    assert.match(html, /<meta name="description" content="[^"]+" \/>/)
    const escapedH1 = contract.h1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('&', '&amp;')
    assert.match(html, new RegExp(`<h1>${escapedH1}</h1>`))
    assert.ok(html.includes(contract.signal), `missing comparison USP for ${key}`)
    for (const path of contract.links) {
      assert.ok(html.includes(`<a href="${path}">`), `missing related link ${path} for ${key}`)
    }
  }
})

test('Lidl and PENNY descriptions target evidenced offer intent without claiming full prospects', () => {
  const contracts = [
    {
      key: 'lidl',
      title: 'Lidl Angebote aktuell vergleichen | kaufklug.at',
      h1: 'Lidl Angebote aktuell vergleichen',
      description: 'Aktuelle Lidl Angebote und Aktionen in Österreich vergleichen – mit Preisen, Packungsgrößen, Gültigkeit und Bedingungen.',
    },
    {
      key: 'penny',
      title: 'PENNY Angebote & Aktionen aktuell vergleichen | kaufklug.at',
      h1: 'PENNY Angebote aktuell finden',
      description: 'Aktuelle PENNY Angebote und Aktionen in Österreich vergleichen – mit Preisen, Packungsgrößen, Gültigkeit und Bedingungen.',
      introSignal: 'Preis pro Einheit',
    },
  ]

  for (const contract of contracts) {
    const page = getStaticSeoPages().find((candidate) => candidate.path === `/angebote/${contract.key}`)
    const html = buildSeoStaticDocument(template, page)
    const escapedDescription = contract.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    assert.equal(page.title, contract.title)
    assert.equal(page.h1, contract.h1)
    assert.equal(page.description, contract.description)
    if (contract.introSignal) assert.match(page.intro, new RegExp(contract.introSignal))
    assert.match(html, new RegExp(`<meta name="description" content="${escapedDescription}" \\/>`))
    assert.match(html, new RegExp(`<meta property="og:description" content="${escapedDescription}" \\/>`))
    assert.match(html, new RegExp(`canonical" href="https:\\/\\/www\\.kaufklug\\.at\\/angebote\\/${contract.key}\\/`))
    assert.doesNotMatch(`${page.title} ${page.description} ${page.h1} ${page.intro}`, /Prospekt|Flugblatt/i)
  }
})

test('HOFER title matches the evidenced action intent without claiming a full prospect', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/angebote/hofer')
  const html = buildSeoStaticDocument(template, page)

  assert.equal(page.title, 'HOFER Aktionen heute: aktuelle Angebote | kaufklug.at')
  assert.match(html, /<title>HOFER Aktionen heute: aktuelle Angebote \| kaufklug\.at<\/title>/)
  assert.match(html, /<h1>HOFER Angebote aktuell vergleichen<\/h1>/)
  assert.match(html, /Aktionen und Gültigkeit an einem Ort/)
  assert.match(html, /canonical" href="https:\/\/www\.kaufklug\.at\/angebote\/hofer\//)
  assert.doesNotMatch(`${page.title} ${page.description} ${page.h1} ${page.intro}`, /Prospekt|Flugblatt/i)
})

test('coffee landing page is indexable and complete in initial HTML', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/angebote/kaffee')
  const html = buildSeoStaticDocument(template, page)

  assert.equal(page.robots, 'index,follow')
  assert.match(html, /<title>Kaffee Angebote aktuell vergleichen \| kaufklug\.at<\/title>/)
  assert.match(html, /<meta name="description" content="Aktuelle Kaffee-Angebote von mehreren H\u00e4ndlern vergleichen\./)
  assert.match(html, /<meta name="robots" content="index,follow" \/>/)
  assert.match(html, /canonical" href="https:\/\/www\.kaufklug\.at\/angebote\/kaffee\/"/)
  assert.match(html, /<h1>Kaffee Angebote aktuell vergleichen<\/h1>/)
  assert.match(html, /Packungsgr\u00f6\u00dfen und Mengenbedingungen/)
  for (const path of ['/angebote/', '/angebote/supermarkt/', '/angebote/billa/', '/angebote/penny/', '/angebote/bipa/']) {
    assert.ok(html.includes(`<a href="${path}">`), `missing coffee landing link ${path}`)
  }
})

test('coffee is linked from relevant indexable static pages and sitemap has 28 safe URLs', async () => {
  for (const path of ['/', '/angebote', '/angebote/supermarkt', '/angebote/billa', '/angebote/penny']) {
    const page = getStaticSeoPages().find((candidate) => candidate.path === path)
    const html = buildSeoStaticDocument(template, page)
    assert.ok(html.includes('<a href="/angebote/kaffee/">'), `missing coffee link from ${path}`)
  }

  const sitemap = await readFile(resolve('admin/public/sitemap.xml'), 'utf8')
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
  assert.equal(urls.length, 28)
  assert.ok(urls.includes('https://www.kaufklug.at/so-funktioniert-kaufklug/'))
  assert.ok(urls.includes('https://www.kaufklug.at/preischeck/bier-literpreis-vergleich/'))
  assert.ok(urls.includes('https://www.kaufklug.at/angebote/kaffee/'))
  assert.ok(urls.includes('https://www.kaufklug.at/angebote/bier/'))
  assert.ok(urls.includes('https://www.kaufklug.at/angebote/softdrinks/'))
  for (const slug of ['schokolade', 'windeln', 'duschgel', 'nudeln', 'chips']) {
    assert.ok(urls.includes(`https://www.kaufklug.at/angebote/${slug}/`))
  }
  assert.equal(urls.some((url) => /\/angebote\/(?:cola|energy-drinks)\//i.test(url)), false)
  assert.equal(urls.some((url) => /(?:suche|stoebern|einkaufsliste|pagro)/i.test(url)), false)
  assert.equal(sitemap.includes('noindex'), false)
})

test('published pricecheck renders evidence and exact values in initial HTML', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/preischeck/bier-literpreis-vergleich')
  const candidate = {
    publishable: true,
    confidence: 'high',
    dataStand: '2026-08-12T10:00:00.000Z',
    explanation: 'Nur aktive, offiziell belegte Angebote.',
    involvedRetailers: ['billa', 'penny'],
    involvedOffers: [
      { retailerName: 'BILLA', title: 'Helles Lager', price: 0.72, quantityText: '0,5 l', unitPrice: 1.44, conditions: 'bei 12 Dosen' },
      { retailerName: 'PENNY', title: 'Märzen', price: 0.79, quantityText: '0,5 l', unitPrice: 1.58, conditions: 'ab 24 Dosen' },
    ],
    evidence: [{ sourceRunStatus: 'success', publishStatus: 'crawl-run-success' }, { sourceRunStatus: 'success', publishStatus: 'crawl-run-success' }],
  }
  const html = buildSeoStaticDocument(template, { ...page, robots: 'index,follow', priceCheckCandidate: candidate }, [page, { ...page, robots: 'index,follow', priceCheckCandidate: candidate }])
  assert.match(html, /seo-static-price-check/)
  assert.match(html, /kaufklug-price-check-data/)
  assert.match(html, /BILLA: 1,44 €\/l/)
  assert.match(html, /PENNY: 1,58 €\/l/)
  assert.match(html, /bei 12 Dosen/)
  assert.match(html, /ab 24 Dosen/)
  assert.match(html, /meta name="robots" content="index,follow"/)
  assert.doesNotMatch(html, /Bestpreis|billigstes|garantiert|undefined|NaN/)
})

test('wave-one category landing pages are indexable and complete in initial HTML', () => {
  const expected = {
    schokolade: ['Schokolade Angebote aktuell vergleichen', 'Preis pro kg'],
    windeln: ['Windeln Angebote aktuell vergleichen', 'Preis pro Stück'],
    duschgel: ['Duschgel Angebote aktuell vergleichen', 'Literpreise'],
    nudeln: ['Nudeln Angebote aktuell vergleichen', 'Preis pro kg'],
    chips: ['Chips Angebote aktuell vergleichen', 'Preis pro kg'],
  }

  for (const [slug, [h1, introSignal]] of Object.entries(expected)) {
    const page = getStaticSeoPages().find((candidate) => candidate.path === `/angebote/${slug}`)
    const html = buildSeoStaticDocument(template, page)

    assert.equal(page.robots, 'index,follow')
    assert.match(html, new RegExp(`<title>${h1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| kaufklug\\.at</title>`))
    assert.match(html, /<meta name="robots" content="index,follow" \/>/)
    assert.match(html, new RegExp(`canonical" href="https://www\\.kaufklug\\.at/angebote/${slug}/"`))
    assert.match(html, new RegExp(`<h1>${h1}</h1>`))
    assert.ok(html.includes(introSignal), `missing intro signal for ${slug}`)
    assert.ok(html.includes('<a href="/angebote/">'))
  }
})

test('beer landing page is indexable and complete in initial HTML', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/angebote/bier')
  const html = buildSeoStaticDocument(template, page)

  assert.equal(page.robots, 'index,follow')
  assert.match(html, /<title>Bier Angebote vergleichen: Literpreise &amp; Aktionen \| kaufklug\.at<\/title>/)
  assert.match(html, /<meta name="description" content="Aktuelle Bier-Angebote mehrerer H\u00e4ndler nach Literpreis vergleichen\./)
  assert.match(html, /<meta name="robots" content="index,follow" \/>/)
  assert.match(html, /canonical" href="https:\/\/www\.kaufklug\.at\/angebote\/bier\/"/)
  assert.match(html, /<h1>Bier Angebote aktuell vergleichen<\/h1>/)
  assert.match(html, /Dosen, Flaschen, Multipacks, Kisten und Mengenbedingungen/)
  for (const path of ['/angebote/', '/angebote/supermarkt/', '/angebote/billa/', '/angebote/penny/', '/angebote/kaffee/']) {
    assert.ok(html.includes(`<a href="${path}">`), `missing beer landing link ${path}`)
  }
})

test('beer is linked from relevant indexable static pages without noindex targets', () => {
  for (const path of ['/', '/angebote', '/angebote/supermarkt', '/angebote/billa', '/angebote/penny']) {
    const page = getStaticSeoPages().find((candidate) => candidate.path === path)
    const html = buildSeoStaticDocument(template, page)
    assert.ok(html.includes('<a href="/angebote/bier/">'), `missing beer link from ${path}`)
    assert.doesNotMatch(html, /href="\/(?:suche|stoebern|einkaufsliste)\//)
    assert.doesNotMatch(html, /href="\/angebote\/(?:spar|mueller|kaese)\//)
  }
})

test('softdrinks landing page is indexable and complete in initial HTML', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/angebote/softdrinks')
  const html = buildSeoStaticDocument(template, page)

  assert.equal(page.robots, 'index,follow')
  assert.match(html, /<title>Softdrinks Angebote aktuell vergleichen \| kaufklug\.at<\/title>/)
  assert.match(html, /<meta name="description" content="Aktuelle Softdrink-Angebote mehrerer H\u00e4ndler vergleichen\./)
  assert.match(html, /<meta name="robots" content="index,follow" \/>/)
  assert.match(html, /canonical" href="https:\/\/www\.kaufklug\.at\/angebote\/softdrinks\/"/)
  assert.match(html, /<h1>Softdrinks Angebote aktuell vergleichen<\/h1>/)
  assert.match(html, /Cola und andere Limonaden/)
  for (const path of ['/angebote/', '/angebote/supermarkt/', '/angebote/billa/', '/angebote/penny/', '/angebote/lidl/', '/angebote/bier/']) {
    assert.ok(html.includes(`<a href="${path}">`), `missing softdrinks landing link ${path}`)
  }
})

test('softdrinks is linked from relevant indexable static pages without cola or utility targets', () => {
  for (const path of ['/', '/angebote', '/angebote/supermarkt', '/angebote/billa', '/angebote/penny', '/angebote/lidl']) {
    const page = getStaticSeoPages().find((candidate) => candidate.path === path)
    const html = buildSeoStaticDocument(template, page)
    assert.ok(html.includes('<a href="/angebote/softdrinks/">'), `missing softdrinks link from ${path}`)
    assert.doesNotMatch(html, /href="\/angebote\/cola\//)
    assert.doesNotMatch(html, /href="\/angebote\/(?:suche|stoebern|einkaufsliste)\//)
  }
})

test('comparison summary is visible in initial HTML only when supplied', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/angebote/bier')
  const html = buildSeoStaticDocument(template, {
    ...page,
    comparisonSummary: {
      facts: ['23 aktuelle Angebote', '3 HÃ¤ndler', '23 mit Literpreis vergleichbar'],
      note: 'Literpreise werden nur innerhalb kompatibler Einheiten verglichen.',
      dataStand: '2026-08-12T09:44:22.113Z',
    },
  })

  assert.match(html, /<section class="seo-static-comparison"/)
  assert.match(html, /Aktueller Vergleich/)
  assert.match(html, /<strong>23<\/strong><span>aktuelle Angebote<\/span>/)
  assert.match(html, /Stand:/)
  assert.doesNotMatch(html, /undefined|NaN/)
})

test('unknown routes are not emitted as SEO pages', () => {
  assert.equal(getStaticSeoPages().some((page) => page.path === '/angebote/does-not-exist'), false)
})
