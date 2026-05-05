import { ANALYTICS_SESSION_STORAGE_KEY } from '../config/constants'
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

export function trackAnalyticsEvent(eventName, metadata = {}) {
  if (typeof window === 'undefined') return
  if (!TRACKABLE_EVENTS.has(eventName)) return

  const payload = {
    eventName,
    path: window.location?.pathname || '/',
    sessionId: getClientSessionId(),
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
