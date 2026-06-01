import axios from 'axios'

const localDevApiBaseUrl = 'http://localhost:4000/api'
const hostedApiBaseUrl = '/api'
const defaultApiBaseUrl = import.meta.env.DEV ? localDevApiBaseUrl : hostedApiBaseUrl

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  defaultApiBaseUrl

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
})

function getApiRoot() {
  const baseUrl = String(api.defaults.baseURL || '').replace(/\/+$/, '')

  if (!baseUrl || baseUrl === '/api') {
    return ''
  }

  return baseUrl.replace(/\/api$/, '')
}

const apiRoot = getApiRoot()

export async function fetchDashboardSnapshot() {
  const response = await api.get('/dashboard/snapshot')
  return response.data
}

export async function fetchHealth() {
  const response = await api.get('/health')
  return response.data
}

export async function fetchSources() {
  const response = await api.get('/sources')
  return response.data.items
}

export async function fetchEssence() {
  const response = await api.get('/essence')
  return response.data.digest
}

export async function runCrawl() {
  const response = await api.post(
    '/crawl/run',
    {},
    {
      timeout: 180000,
    }
  )
  return response.data
}

export async function saveFeedback(payload) {
  const response = await api.post('/feedback', payload)
  return response.data
}

export async function fetchOfferRanking(params = {}) {
  const response = await api.get('/offers/ranking', {
    params,
  })
  return response.data
}

export async function fetchBasketSuggestions(params = {}) {
  const response = await api.get('/offers/basket', {
    params,
  })
  return response.data
}

export async function fetchAnalyticsSummary() {
  const response = await api.get('/analytics/summary')
  return response.data
}

export async function createSharedShoppingList(payload) {
  const response = await api.post('/shopping-lists/share', payload)
  return response.data
}

export async function fetchSharedShoppingList(shareId) {
  const response = await api.get(`/shopping-lists/share/${encodeURIComponent(shareId)}`)
  return response.data
}

export function getOfferImageUrl(offerId) {
  return `${apiRoot}/api/offers/${offerId}/image`
}

export default api
