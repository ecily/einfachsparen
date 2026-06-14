import { API_BASE_URL } from '../api'
import { SITE_URL } from '../config/constants'
import { normalizeRetailerKey } from './offers'
import { formatRetailerName } from './retailers'

export const ADMIN_API_KEY_STORAGE_KEY = 'kaufklug.adminApiKey.v1'

export function getApiBase() {
  const envBase =
    (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_API_BASE || import.meta.env?.VITE_API_BASE_URL)) ||
    ''

  const windowBase =
    typeof window !== 'undefined' && typeof window.__SM_API__ === 'string'
      ? window.__SM_API__
      : ''

  const base = envBase || windowBase || API_BASE_URL
  return String(base).replace(/\/+$/, '')
}

export function buildApiUrl(path) {
  const normalizedPath = `/${String(path || '').replace(/^\/+/, '')}`
  return `${getApiBase()}${normalizedPath}`
}

export function buildAbsoluteUrl(pathOrUrl) {
  const value = String(pathOrUrl || '')

  if (/^https?:\/\//i.test(value)) {
    return value
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return new URL(value, window.location.origin).href
  }

  return new URL(value, SITE_URL).href
}

export function buildTrackedApkDownloadUrl(source = 'hero') {
  const safeSource = String(source || 'hero')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'hero'

  return buildAbsoluteUrl(buildApiUrl(`/download/kaufklug-alpha?source=${encodeURIComponent(safeSource)}`))
}

export function getStoredAdminApiKey() {
  if (typeof window === 'undefined') return ''

  try {
    return String(window.localStorage.getItem(ADMIN_API_KEY_STORAGE_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function setStoredAdminApiKey(value) {
  if (typeof window === 'undefined') return ''

  const safeValue = String(value || '').trim()

  try {
    if (safeValue) {
      window.localStorage.setItem(ADMIN_API_KEY_STORAGE_KEY, safeValue)
    } else {
      window.localStorage.removeItem(ADMIN_API_KEY_STORAGE_KEY)
    }
  } catch {
    // localStorage kann in privaten Browsermodi blockiert sein.
  }

  return safeValue
}

export function clearStoredAdminApiKey() {
  return setStoredAdminApiKey('')
}

export function hasStoredAdminApiKey() {
  return getStoredAdminApiKey().length > 0
}

export function extractArrayPayload(payload, preferredKeys = []) {
  if (Array.isArray(payload)) return payload

  for (const key of preferredKeys) {
    if (Array.isArray(payload?.[key])) {
      return payload[key]
    }
  }

  const fallbackKeys = ['items', 'results', 'data', 'docs']
  for (const key of fallbackKeys) {
    if (Array.isArray(payload?.[key])) {
      return payload[key]
    }
  }

  return []
}

function createHeaders(headers = {}, adminApiKey = '') {
  const nextHeaders = {
    Accept: 'application/json',
    ...headers,
  }

  const safeAdminApiKey = String(adminApiKey || '').trim()
  if (safeAdminApiKey) {
    nextHeaders['x-admin-api-key'] = safeAdminApiKey
  }

  return nextHeaders
}

function createRequestError(response, payload) {
  const message =
    payload?.message ||
    payload?.error ||
    (response.status === 401
      ? 'Admin-Zugriff erforderlich. Bitte Admin-Key prüfen.'
      : `Request failed: ${response.status}`)

  const error = new Error(message)
  error.status = response.status
  error.payload = payload
  return error
}

export async function fetchJson(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    adminApiKey = '',
    credentials = 'omit',
    mode = 'cors',
  } = options || {}

  const requestOptions = {
    method,
    mode,
    credentials,
    headers: createHeaders(headers, adminApiKey),
  }

  if (body !== undefined) {
    requestOptions.body = typeof body === 'string' ? body : JSON.stringify(body)

    if (!requestOptions.headers['Content-Type']) {
      requestOptions.headers['Content-Type'] = 'application/json'
    }
  }

  const response = await fetch(buildApiUrl(path), requestOptions)

  let payload = null

  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw createRequestError(response, payload)
  }

  return payload
}

export async function fetchAdminJson(path, options = {}) {
  const adminApiKey = String(options?.adminApiKey || getStoredAdminApiKey()).trim()

  if (!adminApiKey) {
    const error = new Error('Admin-Zugriff erforderlich. Bitte Admin-Key eingeben.')
    error.status = 401
    throw error
  }

  return fetchJson(path, {
    ...options,
    adminApiKey,
  })
}

export async function fetchFilterRetailers() {
  const payload = await fetchJson('/filters/retailers')
  const retailers = extractArrayPayload(payload, ['retailers'])

  return retailers
    .filter((item) => item && typeof item === 'object')
    .filter((item) => normalizeRetailerKey(item.retailerKey || item.retailerName) !== 'eurospar')
    .map((item, index) => ({
      retailerKey: item.retailerKey || normalizeRetailerKey(item.retailerName || `retailer-${index}`),
      retailerName: formatRetailerName(
        item.retailerName || item.name || item.retailerKey,
        `Supermarkt ${index + 1}`
      ),
      offerCount: Number(item.offerCount || 0),
      activeOfferCount: Number(item.activeOfferCount || item.offerCount || 0),
      totalOffers: Number(item.totalOffers || item.offerCount || 0),
      activeOffers: Number(item.activeOffers || item.activeOfferCount || item.offerCount || 0),
      isActive: item.isActive !== false,
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
    }))
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
      return left.retailerName.localeCompare(right.retailerName, 'de')
    })
}

export async function fetchFilterCategories(retailerKeys = []) {
  const params = new URLSearchParams()

  if (Array.isArray(retailerKeys) && retailerKeys.length > 0) {
    params.set('retailers', retailerKeys.join(','))
  }

  const suffix = params.toString() ? `?${params.toString()}` : ''
  const payload = await fetchJson(`/filters/categories${suffix}`)
  return extractArrayPayload(payload, ['categories'])
}

export async function fetchOfferRankingDirect(params = {}) {
  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue
    searchParams.set(key, String(value))
  }

  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return fetchJson(`/offers/ranking${suffix}`)
}

export async function fetchKeywordOfferSearch(query, limit = 60, offset = 0, resultSetToken = '', options = {}) {
  const searchParams = new URLSearchParams()
  searchParams.set('q', String(query || '').trim())
  searchParams.set('limit', String(limit))
  searchParams.set('offset', String(offset))
  if (resultSetToken) searchParams.set('resultSetToken', String(resultSetToken))

  const retailerKeys = Array.isArray(options?.retailers)
    ? options.retailers
    : String(options?.retailers || '').split(',')

  const scopedRetailers = retailerKeys
    .map((retailerKey) => String(retailerKey || '').trim())
    .filter(Boolean)

  if (scopedRetailers.length > 0) {
    searchParams.set('retailers', scopedRetailers.join(','))
  }

  return fetchJson(`/offers/ranking?${searchParams.toString()}`)
}
