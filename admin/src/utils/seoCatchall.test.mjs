import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildCatchallDocument } from '../../scripts/generateSeoHtml.mjs'

test('catchall is fail-closed and does not emit a homepage canonical', () => {
  const html = buildCatchallDocument('<script type="module" crossorigin src="/assets/app.js"></script><link rel="stylesheet" crossorigin href="/assets/app.css">')

  assert.match(html, /noindex,nofollow/)
  assert.doesNotMatch(html, /rel="canonical"/)
  assert.match(html, /src="\/assets\/app\.js"/)
})

test('static 404 document is noindex/nofollow without canonical or redirect markup', async () => {
  const html = await readFile(resolve('admin/public/404.html'), 'utf8')

  assert.match(html, /noindex,nofollow/)
  assert.doesNotMatch(html, /rel="canonical"/)
  assert.doesNotMatch(html, /meta\s+http-equiv/i)
  assert.doesNotMatch(html, /window\.location|location\.replace|location\.href/i)
})
