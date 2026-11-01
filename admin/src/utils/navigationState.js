// Public view state only: never put shopping-list contents or API snapshots in URLs.
const list = (value) => [...new Set(String(value || '').split(',').filter(Boolean))]
const withParams = (path, params) => `${path}${params.size ? `?${params}` : ''}`

// The router also uses the page id "search" for unknown paths. Only these actual
// browse routes may hydrate/synchronize public browse state or own its canonical.
export function isBrowseRoutePathname(pathname) {
  return /^\/(?:stoebern|stobern)\/?$/i.test(String(pathname || ''))
}

export function readSearchState(search = '') {
  const params = new URLSearchParams(search)
  return {
    query: params.get('q') || '',
    marketFilterEnabled: params.has('markets'),
    selectedRetailerKeys: list(params.get('markets')),
    sortMode: ['retailer', 'savings'].includes(params.get('sort')) ? params.get('sort') : 'best',
  }
}

export function searchStateUrl(state) {
  const params = new URLSearchParams()
  if (state.query.trim()) params.set('q', state.query.trim())
  if (state.marketFilterEnabled) params.set('markets', state.selectedRetailerKeys.join(','))
  if (state.sortMode !== 'best') params.set('sort', state.sortMode)
  return withParams('/suche', params)
}

export function readBrowseState(search = '') {
  const params = new URLSearchParams(search)
  const appliedRetailers = list(params.get('retailers'))
  const appliedCategories = list(params.get('categories'))
  return {
    appliedRetailers,
    appliedCategories,
    draftRetailers: params.has('draftRetailers') ? list(params.get('draftRetailers')) : appliedRetailers,
    draftCategories: params.has('draftCategories') ? list(params.get('draftCategories')) : appliedCategories,
  }
}

export function browseStateUrl(state) {
  const params = new URLSearchParams()
  if (state.appliedRetailers.length) params.set('retailers', state.appliedRetailers.join(','))
  if (state.appliedCategories.length) params.set('categories', state.appliedCategories.join(','))
  if (JSON.stringify(state.draftRetailers) !== JSON.stringify(state.appliedRetailers)) params.set('draftRetailers', state.draftRetailers.join(','))
  if (JSON.stringify(state.draftCategories) !== JSON.stringify(state.appliedCategories)) params.set('draftCategories', state.draftCategories.join(','))
  return withParams('/stoebern', params)
}

export function shouldHandleLink(event, anchor, origin) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return false
  const href = anchor.getAttribute('href') || ''
  if (!href || href.startsWith('#')) return false
  const url = new URL(anchor.href, origin)
  return url.origin === origin && !url.pathname.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(url.pathname)
}

export function createNavigationController(browser, onChange) {
  const remembered = new Map()
  const paths = { 'product-search': '/suche', search: '/stoebern', 'top-deals': '/top-deals', 'shopping-list': '/einkaufsliste' }
  const storageKey = 'kaufklug.navigation.v1'
  function safeViewUrl(page, value) {
    if (!paths[page] || typeof value !== 'string' || value.length > 8000) return null
    try {
      const url = new URL(value, browser.location.origin)
      const path = url.pathname.replace(/\/+$/, '')
      const matches = page === 'search' ? isBrowseRoutePathname(url.pathname)
        : path === paths[page] || (page === 'shopping-list' && path === '/liste')
      return url.origin === browser.location.origin && matches ? `${url.pathname}${url.search}` : null
    } catch { return null }
  }
  try {
    const stored = JSON.parse(browser.sessionStorage?.getItem(storageKey) || '{}')
    for (const [page, value] of Object.entries(stored || {})) {
      const safe = safeViewUrl(page, value)
      if (safe) remembered.set(page, safe)
    }
  } catch { /* Blocked/corrupt session storage must never prevent navigation. */ }
  const currentUrl = () => `${browser.location.pathname}${browser.location.search}${browser.location.hash}`
  function navigate(href, { replace = false, focus = true, restore = true } = {}) {
    const target = new URL(href, browser.location.origin)
    if (target.origin !== browser.location.origin) return false
    const next = `${target.pathname}${target.search}${target.hash}`
    if (next === currentUrl()) return false
    browser.history[replace ? 'replaceState' : 'pushState']({}, '', next)
    onChange(next, focus, restore)
    return true
  }
  function remember(page, url) {
    const safe = safeViewUrl(page, url)
    if (!safe) return
    remembered.set(page, safe)
    try { browser.sessionStorage?.setItem(storageKey, JSON.stringify(Object.fromEntries(remembered))) } catch { /* memory fallback */ }
  }
  return { navigate, currentUrl, remember, recalled: (page, fallback) => remembered.get(page) || fallback }
}
