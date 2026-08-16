import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applySeoAutopilot,
  buildSeoPageQuality,
  filterSitemapXml,
  getStaticSeoPages,
} from '../../scripts/generateSeoHtml.mjs'

const page = { key: 'deo', path: '/angebote/deo', robots: 'index,follow', query: { q: 'deo' } }

function payload({ count = 12, retailers = ['dm', 'bipa'], images = count } = {}) {
  return {
    summary: { totalCount: count },
    rankedOffers: Array.from({ length: Math.min(count, 60) }, (_, index) => ({
      id: `offer-${index}`,
      retailerKey: retailers[index % retailers.length],
      imageUrl: index < images ? `https://cdn.example/${index}.jpg` : '',
    })),
  }
}

test('SEO quality keeps a useful public category indexable', () => {
  const quality = buildSeoPageQuality(page, payload())

  assert.equal(quality.indexable, true)
  assert.equal(quality.totalCount, 12)
  assert.equal(quality.retailerCount, 2)
})

test('SEO autopilot demotes weak pages without promoting configured noindex pages', () => {
  const weak = buildSeoPageQuality(page, payload({ count: 4 }))
  const pages = [page, { ...page, key: 'mueller', path: '/angebote/mueller', robots: 'noindex,follow' }]
  const result = applySeoAutopilot(pages, new Map([
    [page.path, weak],
  ]))

  assert.equal(result[0].robots, 'noindex,follow')
  assert.equal(result[1].robots, 'noindex,follow')
})

test('sitemap filter keeps only currently indexable canonical URLs', () => {
  const xml = '<urlset><url><loc>https://www.kaufklug.at/angebote/deo/</loc></url><url><loc>https://www.kaufklug.at/angebote/mueller/</loc></url></urlset>'
  const filtered = filterSitemapXml(xml, new Set(['https://www.kaufklug.at/angebote/deo/']))

  assert.match(filtered, /angebote\/deo\//)
  assert.doesNotMatch(filtered, /angebote\/mueller\//)
})

test('Deo landing page is configured for the autopilot', () => {
  const deo = getStaticSeoPages().find((candidate) => candidate.path === '/angebote/deo')

  assert.equal(deo?.robots, 'index,follow')
  assert.equal(deo?.query?.q, 'deo')
})
