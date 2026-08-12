import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildSeoStaticDocument, getStaticSeoPages } from '../../scripts/generateSeoHtml.mjs'

const template = `<!doctype html><html><head><title>Default</title><meta name="description" content="Default" /><meta name="robots" content="index,follow" /><link rel="canonical" href="https://www.kaufklug.at/" /><meta property="og:title" content="Default" /><meta property="og:description" content="Default" /><meta property="og:url" content="https://www.kaufklug.at/" /></head><body><div id="root"></div></body></html>`

test('static SEO documents expose route-specific metadata and visible content', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/angebote/billa')
  const html = buildSeoStaticDocument(template, page)

  assert.match(html, /<title>BILLA Angebote aktuell finden \| kaufklug<\/title>/)
  assert.match(html, /canonical" href="https:\/\/www\.kaufklug\.at\/angebote\/billa/)
  assert.match(html, /<h1>BILLA Angebote aktuell finden<\/h1>/)
  assert.match(html, /application\/ld\+json/)
})

test('homepage exposes crawlable internal SEO links in initial HTML', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/')
  const html = buildSeoStaticDocument(template, page)

  assert.match(html, /<h1>Aktuelle Angebote finden und beim Einkauf sparen<\/h1>/)
  assert.match(html, /<meta name="robots" content="index,follow" \/>/)
  assert.match(html, /canonical" href="https:\/\/www\.kaufklug\.at\/"/)
  for (const path of ['/top-deals/', '/angebote/billa/', '/angebote/lidl/', '/angebote/waschmittel/']) {
    assert.ok(html.includes(`<a href="${path}">`), `missing crawlable link ${path}`)
  }
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

test('coffee is linked from relevant indexable static pages and sitemap has 19 safe URLs', async () => {
  for (const path of ['/', '/angebote', '/angebote/supermarkt', '/angebote/billa', '/angebote/penny']) {
    const page = getStaticSeoPages().find((candidate) => candidate.path === path)
    const html = buildSeoStaticDocument(template, page)
    assert.ok(html.includes('<a href="/angebote/kaffee/">'), `missing coffee link from ${path}`)
  }

  const sitemap = await readFile(resolve('admin/public/sitemap.xml'), 'utf8')
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
  assert.equal(urls.length, 19)
  assert.ok(urls.includes('https://www.kaufklug.at/angebote/kaffee/'))
  assert.ok(urls.includes('https://www.kaufklug.at/angebote/bier/'))
  assert.equal(urls.some((url) => /(?:suche|stoebern|einkaufsliste|pagro)/i.test(url)), false)
  assert.equal(sitemap.includes('noindex'), false)
})

test('beer landing page is indexable and complete in initial HTML', () => {
  const page = getStaticSeoPages().find((candidate) => candidate.path === '/angebote/bier')
  const html = buildSeoStaticDocument(template, page)

  assert.equal(page.robots, 'index,follow')
  assert.match(html, /<title>Bier Angebote aktuell vergleichen \| kaufklug\.at<\/title>/)
  assert.match(html, /<meta name="description" content="Aktuelle Bier-Angebote von mehreren H\u00e4ndlern vergleichen\./)
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

test('unknown routes are not emitted as SEO pages', () => {
  assert.equal(getStaticSeoPages().some((page) => page.path === '/angebote/does-not-exist'), false)
})
