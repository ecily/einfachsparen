import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSeoPolicy, filterIndexableSeoLinks, getRenderedSeoRobots } from './seoBuildPolicy.js'
import { getPageMeta } from './seo.js'
import { getStaticSeoPages, buildSeoStaticDocument } from '../../scripts/generateSeoHtml.mjs'
import { getSeoComparisonGuide } from '../config/seoComparisonGuides.js'

test('rendered robots and discovery links follow the final build decision', () => {
  const pages = getStaticSeoPages().map((page) => page.key === 'schokolade' ? { ...page, robots: 'noindex,follow' } : page)
  const policy = buildSeoPolicy(pages)
  assert.equal(getRenderedSeoRobots('/angebote/schokolade/', 'index,follow', policy), 'noindex,follow')
  assert.equal(getRenderedSeoRobots('/suche?q=Kaffee', 'index,follow', policy), 'noindex,follow')
  assert.deepEqual(filterIndexableSeoLinks([
    { path: '/angebote/schokolade/' }, { path: '/angebote/billa/' }, { path: '/angebote/mueller/' },
  ], policy), [{ path: '/angebote/billa/' }])
  globalThis.document = { getElementById: () => ({ textContent: JSON.stringify(policy) }) }
  try {
    assert.equal(getPageMeta('seo-offers:schokolade').robots, 'noindex,follow')
    assert.equal(getPageMeta('product-search').robots, 'noindex,follow')
    assert.equal(getPageMeta('home').robots, 'index,follow')
  } finally { delete globalThis.document }
})

test('comparison guidance is readable in initial HTML, without changing titles or H1s', () => {
  const pages = getStaticSeoPages()
  const template = '<html><head><title>Default</title></head><body><div id="root"></div></body></html>'
  for (const key of ['billa', 'lidl', 'hofer', 'bipa', 'penny', 'supermarkt', 'bier', 'kaffee', 'schokolade']) {
    const page = pages.find((item) => item.key === key)
    const guide = getSeoComparisonGuide(page)
    const html = buildSeoStaticDocument(template, page, pages)
    assert.ok(html.includes('<section class="panel seo-comparison-guide"'))
    assert.ok(html.includes(guide.title))
    assert.ok(html.includes(guide.paragraphs[0]))
    assert.ok(html.includes(`<h1>${page.h1}</h1>`))
    assert.ok(html.includes('id="kaufklug-seo-policy"'))
  }
  const home = buildSeoStaticDocument(template, pages.find((page) => page.path === '/'), pages)
  assert.ok(!home.includes('seo-comparison-guide-title'))
  assert.ok(!home.includes('home-compact__sponsor'))
})
