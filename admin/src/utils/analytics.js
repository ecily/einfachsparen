import {
  ANALYTICS_SESSION_STORAGE_KEY,
  INTERNAL_TESTER_STORAGE_KEY,
  INTERNAL_TESTER_TOKEN_STORAGE_KEY,
} from '../config/constants'
import { buildApiUrl } from './apiBase'

const TRACKABLE_EVENTS = new Set([
  'landing_page_view',
  'shopping_list_opened',
  'offer_search_started',
  'offer_search_result',
  'offer_added_to_list',
  'apk_download_click',
  'legal_page_opened',
  'app_open',
])

export function createClientSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `kk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function getClientSessionId() {
  if (typeof window === 'undefined') return ''

  try {
    const existing = window.localStorage.getItem(ANALYTICS_SESSION_STORAGE_KEY)

    if (existing) {
      return existing
    }

    const nextSessionId = createClientSessionId()
    window.localStorage.setItem(ANALYTICS_SESSION_STORAGE_KEY, nextSessionId)
    return nextSessionId
  } catch {
    return createClientSessionId()
  }
}

function getUrlParam(name) {
  if (typeof window === 'undefined') return ''

  try {
    return new URLSearchParams(window.location.search).get(name) || ''
  } catch {
    return ''
  }
}

function removeInternalTesterParamsFromUrl() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return

  try {
    const url = new URL(window.location.href)
    const changed = url.searchParams.has('internalTester') || url.searchParams.has('clearInternalTester')
    url.searchParams.delete('internalTester')
    url.searchParams.delete('clearInternalTester')

    if (changed) {
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
    }
  } catch {
    // Interner Testmodus darf die App nie stoeren.
  }
}

export function getInternalTesterToken() {
  if (typeof window === 'undefined') return ''

  try {
    if (window.localStorage.getItem(INTERNAL_TESTER_STORAGE_KEY) !== 'true') return ''
    return window.localStorage.getItem(INTERNAL_TESTER_TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function isInternalTesterEnabled() {
  return Boolean(getInternalTesterToken())
}

export function configureInternalTesterModeFromUrl() {
  if (typeof window === 'undefined') return

  const setSecret = getUrlParam('internalTester')
  const clearSecret = getUrlParam('clearInternalTester')

  if (!setSecret && !clearSecret) return

  const action = clearSecret ? 'clear' : 'set'
  const secret = clearSecret || setSecret

  try {
    fetch(buildApiUrl('/analytics/internal-tester'), {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ action, secret }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload?.accepted) return

        try {
          if (action === 'clear') {
            window.localStorage.removeItem(INTERNAL_TESTER_STORAGE_KEY)
            window.localStorage.removeItem(INTERNAL_TESTER_TOKEN_STORAGE_KEY)
            console.info('kaufklug internal tester mode disabled')
          } else if (payload.internalTesterToken) {
            window.localStorage.setItem(INTERNAL_TESTER_STORAGE_KEY, 'true')
            window.localStorage.setItem(INTERNAL_TESTER_TOKEN_STORAGE_KEY, payload.internalTesterToken)
            console.info('kaufklug internal tester mode enabled')
          }
        } catch {
          // localStorage kann blockiert sein.
        }
      })
      .catch(() => {
        // Interner Testmodus darf die App nie stoeren.
      })
      .finally(removeInternalTesterParamsFromUrl)
  } catch {
    removeInternalTesterParamsFromUrl()
  }
}

export function trackAnalyticsEvent(eventName, metadata = {}) {
  if (typeof window === 'undefined') return
  if (!TRACKABLE_EVENTS.has(eventName)) return
  const clearSecret = getUrlParam('clearInternalTester')
  const internalTesterToken = clearSecret ? '' : getInternalTesterToken()
  const internalTesterSecret = clearSecret ? '' : getUrlParam('internalTester')

  const payload = {
    eventName,
    path: window.location?.pathname || '/',
    sessionId: getClientSessionId(),
    internalTesterToken,
    internalTesterSecret,
    metadata: {
      ...metadata,
      pageUrl: window.location?.pathname || '/',
    },
  }

  try {
    fetch(buildApiUrl('/analytics/event'), {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Analytics darf die App nie stören.
    })
  } catch {
    // Analytics darf die App nie stören.
  }
}

export function getAnalyticsCounts(analyticsSummary, rangeKey = 'last30Days') {
  return analyticsSummary?.totals?.[rangeKey]?.byEventName || {}
}

export function getAnalyticsTotal(analyticsSummary, rangeKey = 'last30Days') {
  return Number(analyticsSummary?.totals?.[rangeKey]?.total || 0)
}

export function getAnalyticsCount(analyticsSummary, eventName, rangeKey = 'last30Days') {
  return Number(getAnalyticsCounts(analyticsSummary, rangeKey)?.[eventName] || 0)
}

export function getConversionRate(numerator, denominator) {
  const top = Number(numerator)
  const bottom = Number(denominator)

  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) {
    return 0
  }

  return top / bottom
}
