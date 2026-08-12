import test from 'node:test'
import assert from 'node:assert/strict'
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
    assert.doesNotMatch(html, /href="\/angebote\/(?:spar|kaffee|bier|kaese|mueller)\//)
  }
})

test('unknown routes are not emitted as SEO pages', () => {
  assert.equal(getStaticSeoPages().some((page) => page.path === '/angebote/does-not-exist'), false)
})
