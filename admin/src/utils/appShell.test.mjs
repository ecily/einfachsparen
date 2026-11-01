import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fileURLToPath } from 'node:url'

test('shell renders one main landmark, a skip target and a separate header/footer', async () => {
  const server = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)),
    configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false },
  })
  try {
    const { AppShell } = await server.ssrLoadModule('/src/components/layout/AppShell.jsx')
    const html = renderToStaticMarkup(createElement(AppShell, {
      header: createElement('nav', { 'aria-label': 'Seiten' }, createElement('a', { href: '/suche?q=bier' }, 'Suche')),
      footer: createElement('a', { href: '/impressum/' }, 'Impressum'),
      onNavigateUrl: () => {},
    }, createElement('h1', {}, 'Angebote suchen')))
    assert.equal((html.match(/<main\b/g) || []).length, 1)
    assert.match(html, /href="#main-content"/)
    assert.match(html, /<main id="main-content"[^>]*tabindex="-1"/)
    assert.match(html, /<header[\s\S]*<\/header><main[\s\S]*<\/main><footer/)
    assert.match(html, /href="\/suche\?q=bier"/)
    assert.match(html, /href="\/impressum\/"/)
  } finally { await server.close() }
})

test('all core views, legacy links and SEO entries retain the shared navigation and content', async () => {
  const server = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)),
    configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false },
  })
  const previousWindow = globalThis.window
  try {
    const { default: App } = await server.ssrLoadModule('/src/App.jsx')
    for (const path of ['/', '/suche?q=kaffee&markets=dm&sort=retailer', '/stoebern?retailers=dm',
      '/top-deals/?category=bier', '/einkaufsliste', '/liste/', '/liste/test-fixture',
      '/angebote/billa/', '/angebote/bier/', '/so-funktioniert-kaufklug/', '/impressum/', '/feedback/']) {
      globalThis.window = { location: new URL(path, 'http://localhost'), history: {}, localStorage: { getItem: () => null } }
      const html = renderToStaticMarkup(createElement(App))
      assert.equal((html.match(/<main\b/g) || []).length, 1, path)
      for (const label of ['Suche', 'Stöbern', 'Einkaufsliste', 'Top Deals heute']) assert.ok(html.includes(label), `${path}: ${label}`)
      assert.match(html, /href="#main-content"/)
      assert.ok(!html.includes('undefined'), path)
      if (path.startsWith('/suche')) {
        assert.equal((html.match(/type="search"/g) || []).length, 1)
        assert.match(html, /value="kaffee"/)
        assert.match(html, /value="retailer" selected/)
      }
      if (path === '/angebote/bier/') assert.match(html, /Bier Angebote aktuell vergleichen/)
    }
  } finally {
    globalThis.window = previousWindow
    await server.close()
  }
})

test('an unapplied browse draft cannot reclassify or hide the applied result scope', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)),
    configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false } })
  try {
    const { SearchPage } = await server.ssrLoadModule('/src/components/search/SearchPage.jsx')
    const group = sub => [{ mainCategoryKey: 'drogerie', mainCategoryLabel: 'Drogerie', offerCount: 1,
      subcategories: [{ subcategoryKey: sub.toLowerCase(), subcategoryLabel: sub, offerCount: 1 }] }]
    const html = renderToStaticMarkup(createElement(SearchPage, {
      retailers: [{ retailerKey: 'dm', retailerName: 'dm', offerCount: 1 }],
      categories: group('Haarpflege'), appliedCategories: group('Waschmittel'),
      filtersLoading: false, rankingLoading: false, rankingLoadingMore: false,
      ranking: { rankedOffers: [{ id: 'fixture-1', title: 'Applied fixture product', retailerKey: 'dm', retailerName: 'dm',
        categoryPrimary: 'Drogerie', categorySecondary: 'Waschmittel', priceCurrent: { amount: 3 } }],
      summary: { totalCount: 1, hasMore: false } },
      draftRetailers: ['bipa'], draftCategoryLabels: [], appliedRetailers: ['dm'],
      appliedCategoryLabels: ['sub:drogerie:waschmittel'], shoppingListIds: new Set(), hasPendingChanges: true,
    }))
    assert.match(html, /Applied fixture product/)
    assert.match(html, /Waschmittel/)
  } finally { await server.close() }
})
