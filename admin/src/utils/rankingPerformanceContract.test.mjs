import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const apiSource = fs.readFileSync(new URL('./apiBase.js', import.meta.url), 'utf8')

test('public ranking callers request the flat non-duplicated response mode', () => {
  assert.match(
    apiSource,
    /fetchOfferRankingDirect[\s\S]*?new URLSearchParams\(\{ flat: 'true' \}\)/,
  )
  assert.match(
    apiSource,
    /fetchKeywordOfferSearch[\s\S]*?searchParams\.set\('flat', 'true'\)/,
  )
})
