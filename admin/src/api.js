import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api',
  timeout: 15000,
})

const apiRoot = api.defaults.baseURL.replace(/\/api$/, '')

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
  const response = await api.post('/crawl/run', {}, {
    timeout: 180000,
  })
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

export async function fetchCurrentUserPreferences() {
  const response = await api.get('/user-preferences/current')
  return response.data
}

export async function saveCurrentUserPreferences(payload) {
  const response = await api.put('/user-preferences/current', payload)
  return response.data
}

export function getOfferImageUrl(offerId) {
  return `${apiRoot}/api/offers/${offerId}/image`
}

export default api
