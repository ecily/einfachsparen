import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSeoStaticDocument } from '../../scripts/generateSeoHtml.mjs'
import { readFileSync } from 'node:fs'

test('initial homepage navigation keeps the same three-primary order as the React shell', () => {
  const template = '<html><head><title>test</title></head><body><div id="root"></div></body></html>'
  const html = buildSeoStaticDocument(template, { path: '/', title: 'test', h1: 'test', description: 'test', robots: 'index,follow' }, [])
  const nav = html.match(/<div class="page-nav__main">(.*?)<\/div>/s)?.[1]
  assert.ok(nav)
  assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(match => match[1]), ['/suche', '/top-deals/', '/einkaufsliste'])
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const primary = app.slice(app.indexOf('<div className="page-nav__main">'), app.indexOf("{activePage !== 'home'"))
  assert.ok(primary.indexOf("hrefFor('product-search')") < primary.indexOf("hrefFor('top-deals')"))
  assert.ok(primary.indexOf("hrefFor('top-deals')") < primary.indexOf("hrefFor('shopping-list')"))
})
