import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const searchPageSource = fs.readFileSync(new URL('../components/search/SearchPage.jsx', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')

test('initial browse overlay has a bounded maximum and does not follow later filter refreshes', () => {
  assert.match(searchPageSource, /const INITIAL_FILTER_OVERLAY_MAX_MS = 1500/)
  assert.match(searchPageSource, /const \[initialOverlayPhase, setInitialOverlayPhase\] = useState\(\(\) => \(filtersLoading \? 'loading' : 'ready'\)\)/)
  assert.match(searchPageSource, /filtersLoading && initialOverlayPhase === 'loading'/)
  assert.match(searchPageSource, /setInitialOverlayPhase\('ready'\)/)
  assert.match(searchPageSource, /const delay = filtersLoading \? INITIAL_FILTER_OVERLAY_MAX_MS : 0/)
  assert.match(searchPageSource, /window\.clearTimeout\(timeoutId\)/)
})

test('Top Deals remains idle-prefetched instead of being part of initial browse blocking', () => {
  assert.match(appSource, /requestIdleCallback\(runPrefetch, \{ timeout: 2500 \}\)/)
  assert.match(appSource, /prefetchTopDeals\(\)/)
  assert.match(searchPageSource, /<HeroLoaderModal[\s\S]*?open=\{isInitialBusy\}/)
})
