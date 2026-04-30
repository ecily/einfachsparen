import { API_BASE_URL } from '../api'
import { SITE_URL } from '../config/constants'
import { normalizeRetailerKey } from './offers'

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

export async function fetchJson(path) {
  const response = await fetch(buildApiUrl(path), {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
    },
  })

  let payload = null

  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(payload?.message || `Request failed: ${response.status}`)
  }

  return payload
}

export async function fetchFilterRetailers() {
  const payload = await fetchJson('/filters/retailers')
  const retailers = extractArrayPayload(payload, ['retailers'])

  return retailers
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      retailerKey: item.retailerKey || normalizeRetailerKey(item.retailerName || `retailer-${index}`),
      retailerName: item.retailerName || item.name || item.retailerKey || `Supermarkt ${index + 1}`,
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
