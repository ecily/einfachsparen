import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCatchallDocument } from '../../scripts/generateSeoHtml.mjs'

test('catchall is fail-closed and does not emit a homepage canonical', () => {
  const html = buildCatchallDocument('<script type="module" crossorigin src="/assets/app.js"></script><link rel="stylesheet" crossorigin href="/assets/app.css">')

  assert.match(html, /noindex,nofollow/)
  assert.doesNotMatch(html, /rel="canonical"/)
  assert.match(html, /src="\/assets\/app\.js"/)
})
