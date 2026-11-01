import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fileURLToPath } from 'node:url'
import { getInitialPageFromPathname, getSharedListIdFromPathname, updateSeoMetadata } from './seo.js'
import { buildCatchallDocument, getStaticSeoPages } from '../../scripts/generateSeoHtml.mjs'
import { buildSeoPolicy } from './seoBuildPolicy.js'

// Small head-only DOM double: execute the real metadata functions without a new DOM dependency.
function withHead(run) {
  const previous = { window: globalThis.window, document: globalThis.document }
  const nodes = []
  function element(tag) {
    return { tag, attributes: {}, textContent: '',
      setAttribute(key, value) { this.attributes[key] = String(value) },
      remove() { nodes.splice(nodes.indexOf(this), 1) },
    }
  }
  const query = selector => {
    const [, tag, key, value] = selector.match(/^(\w+)\[([^=]+)="([^"]+)"\]$/) || []
    return nodes.find(node => node.tag === tag && node.attributes[key] === value) || null
  }
  globalThis.document = { title: '', createElement: element,
    getElementById: id => nodes.find(node => node.id === id || node.attributes.id === id) || null,
    head: { querySelector: query, appendChild: node => nodes.push(node) },
  }
  const visit = path => {
    globalThis.window = { location: new URL(path, 'https://www.kaufklug.at') }
    const before = window.location.href
    updateSeoMetadata(getInitialPageFromPathname(window.location.pathname.toLowerCase()))
    assert.equal(window.location.href, before, 'metadata must never rewrite a URL')
  }
  try { run({ visit, canonical: () => query('link[rel="canonical"]')?.attributes.href,
    robots: () => query('meta[name="robots"]')?.attributes.content }) }
  finally {
    if (previous.window === undefined) delete globalThis.window
    else globalThis.window = previous.window
    if (previous.document === undefined) delete globalThis.document
    else globalThis.document = previous.document
  }
}

test('reserved segments and similar names never turn unknown URLs into known routes', () => {
  const paths = ['/angebote/ux-audit-unbekannt/top-deals/?category=bier',
    '/angebote/ux-audit-unbekannt/suche/', '/angebote/billa/top-deals/',
    '/angebote/top-deals-extra/', '/foo/impressum', '/privacy-extra',
    '/top-deals/extra', '/top-deals-extra', '/angebote/bier//',
    '/suche//', '/foo/liste/abc', '/liste/abc/extra', '/liste/%ZZ',
    '/angebote/ux-audit-unbekannt/einkaufsliste/', '/foo/diagnose']
  withHead(({ visit, canonical, robots }) => {
    for (const path of paths) {
      const pathname = new URL(path, 'https://www.kaufklug.at').pathname
      assert.equal(getInitialPageFromPathname(pathname), 'search', path)
      assert.equal(getSharedListIdFromPathname(pathname), '', path)
      visit(path)
      assert.equal(canonical(), undefined, path)
      assert.match(robots(), /^noindex(?:,|$)/, path)
    }
  })
})

test('every generated route and explicit utility aliases retain their metadata', () => {
  withHead(({ visit, canonical, robots }) => {
    const policy = document.createElement('script')
    policy.id = 'kaufklug-seo-policy'
    policy.textContent = JSON.stringify(buildSeoPolicy(getStaticSeoPages()))
    document.head.appendChild(policy)
    for (const page of getStaticSeoPages()) {
      visit(`${page.path.replace(/\/$/, '') || ''}/?ux=route-check`)
      const expected = page.path === '/liste' ? '/einkaufsliste/' : `${page.path.replace(/\/$/, '') || ''}/`
      assert.equal(canonical(), `https://www.kaufklug.at${expected}`, page.path)
      // /liste is the pre-existing local-list alias after mounting React.
      assert.equal(robots(), page.path === '/liste' ? 'noindex,follow' : page.robots, page.path)
    }
    for (const [path, page] of [['/privacy/', 'privacy'], ['/legal', 'liability'],
      ['/cookie', 'cookies'], ['/shopping', 'shopping-list'], ['/quality/', 'diagnostics'],
      ['/TOP-DEALS/', 'top-deals'], ['/liste/AbC-123/', 'shared-shopping-list']]) {
      assert.equal(getInitialPageFromPathname(path), page, path)
      visit(path)
      assert.ok(canonical(), path)
    }
    assert.equal(getSharedListIdFromPathname('/liste/AbC-123/'), 'AbC-123')
  })
})

test('static catchall and React fallback both exclude unknown paths from navigation canonicals', () => {
  const html = buildCatchallDocument('<script type="module" src="/assets/app.js"></script>')
  assert.match(html, /noindex,nofollow/)
  assert.doesNotMatch(html, /rel="canonical"|location\.replace|http-equiv/i)
  withHead(({ visit, canonical, robots }) => {
    for (const path of ['/angebote/ux-audit-unbekannt/', '/angebote/ux-audit-unbekannt/detail/',
      '/ux-audit-unbekannt/?retailers=dm', '/foo/stoebern', '/stoebern//']) {
      visit(path)
      assert.equal(canonical(), undefined, path)
      assert.match(robots(), /^noindex(?:,|$)/, path)
    }
  })
})

test('catchall carries the exact build generation policy for subsequent navigation without indexing itself', () => {
  const pages = getStaticSeoPages().map(page => page.path === '/angebote/schokolade'
    ? { ...page, robots: 'noindex,follow' } : page)
  const html = buildCatchallDocument('', pages)
  const match = html.match(/id="kaufklug-seo-policy">([\s\S]*?)<\/script>/)
  assert.ok(match, 'catchall must not lose the generation policy when React navigates to a known route')
  assert.deepEqual(JSON.parse(match[1]), buildSeoPolicy(pages))
  assert.equal(JSON.parse(match[1])['/angebote/schokolade/'], 'noindex,follow')
  assert.match(html, /<meta name="robots" content="noindex,nofollow"/)
  assert.doesNotMatch(html, /rel="canonical"/)
  withHead(({ visit, canonical, robots }) => {
    const policy = document.createElement('script')
    policy.id = 'kaufklug-seo-policy'
    policy.textContent = match[1]
    document.head.appendChild(policy)
    visit('/angebote/ux-audit-unbekannt/')
    assert.equal(canonical(), undefined)
    visit('/angebote/schokolade/')
    assert.equal(canonical(), 'https://www.kaufklug.at/angebote/schokolade/')
    assert.equal(robots(), 'noindex,follow', 'known landing must retain this build generation’s noindex')
    visit('/angebote/ux-audit-unbekannt/')
    assert.equal(canonical(), undefined)
    assert.match(robots(), /^noindex(?:,|$)/)
  })
})

test('canonical transitions between unknown fallback and existing routes do not leave stale metadata', () => {
  const cases = [
    ['/', '/'], ['/stoebern?retailers=dm', '/stoebern/'], ['/stobern/', '/stoebern/'],
    ['/suche?q=kaffee&markets=dm&sort=retailer', '/suche/'], ['/top-deals/?category=bier', '/top-deals/'],
    ['/einkaufsliste', '/einkaufsliste/'], ['/liste/', '/einkaufsliste/'],
    ['/angebote/billa/', '/angebote/billa/'], ['/angebote/bier/', '/angebote/bier/'],
    ['/so-funktioniert-kaufklug/', '/so-funktioniert-kaufklug/'],
  ]
  withHead(({ visit, canonical, robots }) => {
    for (const [path, canonicalPath] of cases) {
      visit(path)
      assert.equal(canonical(), `https://www.kaufklug.at${canonicalPath}`, path)
      const knownRobots = robots()
      visit('/angebote/ux-audit-unbekannt/')
      assert.equal(canonical(), undefined)
      assert.match(robots(), /^noindex(?:,|$)/)
      visit(path)
      assert.equal(canonical(), `https://www.kaufklug.at${canonicalPath}`, path)
      assert.equal(robots(), knownRobots, path)
    }
  })
})

test('unknown fallback links to real Stöbern instead of treating the unknown URL as its own route', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)),
    configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false } })
  const previousWindow = globalThis.window
  try {
    const { default: App } = await server.ssrLoadModule('/src/App.jsx')
    for (const path of ['/angebote/ux-audit-unbekannt/', '/ux-audit-unbekannt/']) {
      globalThis.window = { location: new URL(path, 'http://localhost'), history: {}, localStorage: { getItem: () => null } }
      const html = renderToStaticMarkup(createElement(App))
      assert.match(html, /href="\/stoebern"[^>]*>Stöbern<\/a>/, path)
      assert.doesNotMatch(html, /href="[^\"]*ux-audit-unbekannt[^\"]*"/, path)
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    await server.close()
  }
})
