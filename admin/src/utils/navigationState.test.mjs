import test from 'node:test'
import assert from 'node:assert/strict'
import { isBrowseRoutePathname, readSearchState, searchStateUrl, readBrowseState, browseStateUrl, createNavigationController, shouldHandleLink } from './navigationState.js'

test('only actual browse paths own browse URL state; unknown fallback paths never do', () => {
  for (const path of ['/stoebern', '/stoebern/', '/STOEBERN/', '/stobern', '/stobern/']) assert.equal(isBrowseRoutePathname(path), true, path)
  for (const path of ['', '/', '/suche', '/top-deals/', '/einkaufsliste', '/angebote/bier/',
    '/angebote/ux-audit-unbekannt/', '/angebote/ux-audit-unbekannt/detail/', '/ux-audit-unbekannt/',
    '/foo/stoebern', '/stoebern-extra', '/stoebern//']) assert.equal(isBrowseRoutePathname(path), false, path)
})

test('search deep links round-trip query, empty enabled markets and global sort', () => {
  for (const state of [
    { query: 'Käse & Milch', marketFilterEnabled: true, selectedRetailerKeys: ['dm', 'bipa'], sortMode: 'savings' },
    { query: '', marketFilterEnabled: true, selectedRetailerKeys: [], sortMode: 'best' },
    { query: 'Bier', marketFilterEnabled: false, selectedRetailerKeys: [], sortMode: 'retailer' },
  ]) assert.deepEqual(readSearchState(new URL(searchStateUrl(state), 'https://example.test').search), state)
  assert.equal(readSearchState('?q=test&sort=untrusted').sortMode, 'best')
  assert.deepEqual(readSearchState('?markets=dm,dm,bipa').selectedRetailerKeys, ['dm', 'bipa'])
})

test('browse preserves applied scope and a different, unapplied draft including an empty reset', () => {
  for (const state of [
    { appliedRetailers: ['dm'], appliedCategories: ['sub:drogerie:waschmittel'], draftRetailers: ['bipa'], draftCategories: [] },
    { appliedRetailers: ['dm'], appliedCategories: [], draftRetailers: [], draftCategories: [] },
    { appliedRetailers: [], appliedCategories: [], draftRetailers: ['dm'], draftCategories: ['main:drogerie'] },
  ]) assert.deepEqual(readBrowseState(new URL(browseStateUrl(state), 'https://example.test').search), state)
  assert.deepEqual(readBrowseState('?retailers=dm').draftRetailers, ['dm'])
})

test('navigation creates history entries, supports replacement and remembers independent sections', () => {
  const origin = 'https://example.test'
  const entries = ['/suche?q=bier']
  let index = 0
  const browser = { location: new URL(entries[index], origin), history: {} }
  for (const method of ['pushState', 'replaceState']) browser.history[method] = (_, __, url) => {
    if (method === 'pushState') { entries.splice(index + 1); entries.push(url); index++ }
    else entries[index] = url
    browser.location = new URL(entries[index], origin)
  }
  const observed = []
  const controller = createNavigationController(browser, (...args) => observed.push(args))
  controller.remember('product-search', controller.currentUrl())
  assert.equal(controller.navigate('/top-deals/?category=bier'), true)
  controller.remember('top-deals', controller.currentUrl())
  controller.navigate('/einkaufsliste')
  controller.navigate(controller.recalled('product-search', '/suche'))
  assert.equal(controller.currentUrl(), '/suche?q=bier')
  controller.navigate('/suche?q=bier&sort=retailer', { replace: true, focus: false, restore: false })
  assert.equal(entries.length, 4)
  assert.deepEqual(observed.at(-1), ['/suche?q=bier&sort=retailer', false, false])
  browser.location = new URL(entries[--index], origin) // native Back
  assert.equal(controller.currentUrl(), '/einkaufsliste')
  browser.location = new URL(entries[++index], origin) // native Forward
  assert.equal(readSearchState(browser.location.search).sortMode, 'retailer')
  assert.equal(controller.recalled('top-deals', '/top-deals/'), '/top-deals/?category=bier')
  assert.equal(controller.navigate(controller.currentUrl()), false)
  assert.equal(controller.navigate('https://elsewhere.test/'), false)
})

test('reload retains public section URLs but rejects external, private and corrupt stored state', () => {
  let value = JSON.stringify({ 'product-search': '/suche?q=kaffee&sort=savings', search: 'https://evil.test/stoebern', 'shopping-list': '/liste/private-id' })
  const browser = { location: new URL('https://example.test/einkaufsliste'), sessionStorage: {
    getItem: () => value, setItem: (_, next) => { value = next },
  } }
  const first = createNavigationController(browser, () => {})
  assert.equal(first.recalled('product-search', '/suche'), '/suche?q=kaffee&sort=savings')
  assert.equal(first.recalled('search', '/stoebern'), '/stoebern')
  assert.equal(first.recalled('shopping-list', '/einkaufsliste'), '/einkaufsliste')
  first.remember('search', '/stoebern//')
  assert.equal(first.recalled('search', '/stoebern'), '/stoebern')
  first.remember('search', '/stobern?retailers=dm')
  assert.equal(first.recalled('search', '/stoebern'), '/stobern?retailers=dm')
  first.remember('top-deals', '/top-deals/?retailer=dm')
  const reloaded = createNavigationController(browser, () => {})
  assert.equal(reloaded.recalled('top-deals', '/top-deals/'), '/top-deals/?retailer=dm')
  value = 'invalid json'
  assert.equal(createNavigationController(browser, () => {}).recalled('product-search', '/suche'), '/suche')
  const blocked = { location: browser.location, get sessionStorage() { throw new Error('blocked') } }
  const fallback = createNavigationController(blocked, () => {})
  fallback.remember('product-search', '/suche?q=bier')
  assert.equal(fallback.recalled('product-search', '/suche'), '/suche?q=bier')
})

test('link interception preserves new tabs, downloads, external links, anchors and API endpoints', () => {
  const origin = 'https://example.test'
  const event = { button: 0, defaultPrevented: false }
  const anchor = (href, extra = {}) => ({ href: new URL(href, origin).href, target: '', hasAttribute: () => false, getAttribute: () => href, ...extra })
  assert.equal(shouldHandleLink(event, anchor('/angebote/bier/'), origin), true)
  for (const [evt, link] of [
    [{ ...event, ctrlKey: true }, anchor('/suche')],
    [{ ...event, metaKey: true }, anchor('/suche')],
    [{ ...event, button: 1 }, anchor('/suche')],
    [event, anchor('/suche', { target: '_blank' })],
    [event, anchor('/file', { hasAttribute: () => true })],
    [event, anchor('#main-content')], [event, anchor('/api/download')],
    [event, anchor('/file.pdf')], [event, anchor('https://other.test/')],
  ]) assert.equal(shouldHandleLink(evt, link, origin), false)
})
