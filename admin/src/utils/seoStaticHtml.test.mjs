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

test('unknown routes are not emitted as SEO pages', () => {
  assert.equal(getStaticSeoPages().some((page) => page.path === '/angebote/does-not-exist'), false)
})
