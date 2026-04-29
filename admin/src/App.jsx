import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import './index.css'
import {
  API_BASE_URL,
  fetchDashboardSnapshot,
  fetchEssence,
  fetchHealth,
  fetchQualitySnapshot,
  getOfferImageUrl,
  ignoreArticleQualityItem,
  saveArticleSubcategoryOverride,
  saveFeedback,
  saveSubcategoryCategoryOverride,
} from './api'

const KAUFKLUG_APK_DOWNLOAD_URL = 'https://stepsmatch.fra1.digitaloceanspaces.com/kaufklug/kaufklug_alpha.apk'
const SHOPPING_LIST_STORAGE_KEY = 'kaufklug.shoppingList.v1'
const COOKIE_NOTICE_STORAGE_KEY = 'kaufklug.storageNotice.accepted.v1'
const SITE_URL = 'https://kaufklug.at'
const CONTACT_EMAIL = 'andreas.franz@ecily.com'

function getApiBase() {
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

function buildApiUrl(path) {
  const normalizedPath = `/${String(path || '').replace(/^\/+/, '')}`
  return `${getApiBase()}${normalizedPath}`
}

function extractArrayPayload(payload, preferredKeys = []) {
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

async function fetchJson(path) {
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

async function fetchFilterRetailers() {
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

async function fetchFilterCategories(retailerKeys = []) {
  const params = new URLSearchParams()

  if (Array.isArray(retailerKeys) && retailerKeys.length > 0) {
    params.set('retailers', retailerKeys.join(','))
  }

  const suffix = params.toString() ? `?${params.toString()}` : ''
  const payload = await fetchJson(`/filters/categories${suffix}`)
  return extractArrayPayload(payload, ['categories'])
}

async function fetchOfferRankingDirect(params = {}) {
  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue
    searchParams.set(key, String(value))
  }

  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return fetchJson(`/offers/ranking${suffix}`)
}

function normalizeRetailerKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function getOfferStableId(offer) {
  return String(
    offer?.id ||
    offer?._id ||
    offer?.offerKey ||
    offer?.dedupeKey ||
    `${offer?.title || 'angebot'}-${offer?.retailerName || 'markt'}-${offer?.priceCurrent?.amount || 'preis'}-${offer?.validTo || ''}`
  )
}

function getOfferCategoryLabel(offer) {
  return offer?.displayCategory || offer?.categorySecondary || offer?.categoryPrimary || 'ohne Kategorie'
}

function isOfferDirectlyComparable(offer) {
  return Boolean(offer?.quality?.comparisonSafe && offer?.comparisonGroup && offer?.normalizedUnitPrice?.amount)
}

function getOfferKindLabel(offer) {
  return isOfferDirectlyComparable(offer) ? 'Mit Vergleichspreis' : 'Aktionspreis'
}

function getOfferStatusLabel(offer) {
  if (offer?.status === 'active' && offer?.isActiveNow) return 'Aktuell gültig'
  if (offer?.status === 'upcoming') return 'Bald gültig'
  if (offer?.status === 'expired') return 'Nicht mehr gültig'
  if (offer?.isActiveToday) return 'Heute relevant'
  return 'Aktuelle Aktion'
}

function formatCurrencyAmount(amount, currency = 'EUR') {
  const numericAmount = Number(amount)

  if (!Number.isFinite(numericAmount)) {
    return 'Preis nicht erkannt'
  }

  return new Intl.NumberFormat('de-AT', {
    style: 'currency',
    currency: currency || 'EUR',
  }).format(numericAmount)
}

function formatUnitPrice(normalizedUnitPrice) {
  const amount = Number(normalizedUnitPrice?.amount)
  const unit = normalizedUnitPrice?.unit

  if (!Number.isFinite(amount) || !unit) {
    return 'Einheitspreis nicht erkannt'
  }

  return `${formatCurrencyAmount(amount)} / ${unit}`
}

function shouldDisplayUnitPrice(offer) {
  const amount = Number(offer?.normalizedUnitPrice?.amount)
  const unit = String(offer?.normalizedUnitPrice?.unit || offer?.comparableUnit || '')
  const packageType = String(offer?.packageType || '').toLowerCase()
  const packCount = Number(offer?.packCount || 0)
  const unitType = String(offer?.unitType || '')

  if (!Number.isFinite(amount) || !unit) {
    return false
  }

  if (unit === 'Stk' && packCount > 1 && (packageType === 'pack' || packageType === 'box' || packageType === 'blister' || unitType === 'Stk')) {
    return false
  }

  return true
}

function getConditionsSummary(offer) {
  if (offer?.conditionsText) {
    return offer.conditionsText
  }

  if (offer?.customerProgramRequired) {
    return 'Mit Kundenkarte/App'
  }

  if (offer?.isMultiBuy) {
    return 'Mehrkauf-Angebot'
  }

  const minimumPurchaseQty = Number(offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || 1)
  if (minimumPurchaseQty > 1) {
    return `Mindestens ${minimumPurchaseQty} Stück`
  }

  if (offer?.hasConditions) {
    return 'Bedingung beachten'
  }

  return 'Keine besonderen Bedingungen'
}

function buildOfferBadges(offer) {
  const badges = [getOfferKindLabel(offer), getOfferStatusLabel(offer)]

  if (offer?.customerProgramRequired) badges.push('Kundenkarte/App')
  if (offer?.isMultiBuy) badges.push('Mehrkauf')
  if (Number(offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || 1) > 1) badges.push('Mindestmenge')

  return badges
}

function formatValidityLabel(offer) {
  const hasValidFrom = Boolean(offer?.validFrom)
  const hasValidTo = Boolean(offer?.validTo)

  if (hasValidFrom && hasValidTo) {
    return `gültig von ${dayjs(offer.validFrom).format('DD.MM.YYYY')} bis ${dayjs(offer.validTo).format('DD.MM.YYYY')}`
  }

  if (hasValidFrom) {
    return `gültig ab ${dayjs(offer.validFrom).format('DD.MM.YYYY')}`
  }

  if (hasValidTo) {
    return `gültig bis ${dayjs(offer.validTo).format('DD.MM.YYYY')}`
  }

  return 'aktuell verfügbar'
}

function getOfferRetailerKey(offer, retailers = []) {
  if (offer?.retailerKey) return offer.retailerKey

  const fromLookup = (retailers || []).find((item) => item.retailerName === offer?.retailerName)
  if (fromLookup?.retailerKey) return fromLookup.retailerKey

  return normalizeRetailerKey(offer?.retailerName)
}

function flattenRankingOffers(ranking) {
  if (Array.isArray(ranking?.rankedOffers)) {
    return ranking.rankedOffers
      .filter((offer) => offer && typeof offer === 'object')
      .map((offer) => ({
        ...offer,
        id: getOfferStableId(offer),
      }))
  }

  const seen = new Set()
  const offers = []

  for (const group of ranking?.rankedGroups || []) {
    for (const offer of group.offers || []) {
      const offerId = getOfferStableId(offer)

      if (seen.has(offerId)) continue

      seen.add(offerId)
      offers.push({
        ...offer,
        id: offerId,
      })
    }
  }

  return offers
}

function splitRankingOffers(offers = []) {
  const bestComparableOffers = []
  const actionOffers = []

  for (const offer of offers || []) {
    if (isOfferDirectlyComparable(offer)) {
      bestComparableOffers.push(offer)
      continue
    }

    actionOffers.push(offer)
  }

  return {
    bestComparableOffers,
    actionOffers,
  }
}

function normalizeCategoryDocuments(categories = []) {
  return (categories || [])
    .filter((item) => item && typeof item === 'object')
    .map((category, index) => ({
      mainCategoryKey: category?.mainCategoryKey || normalizeRetailerKey(category?.mainCategoryLabel || `category-${index}`),
      mainCategoryLabel: category?.mainCategoryLabel || 'Weitere Kategorien',
      offerCount: Number(category?.offerCount || 0),
      isActive: category?.isActive !== false,
      subcategories: (category?.subcategories || [])
        .filter((item) => item && typeof item === 'object')
        .map((subcategory, subIndex) => ({
          subcategoryKey: subcategory?.subcategoryKey || normalizeRetailerKey(subcategory?.subcategoryLabel || `subcategory-${subIndex}`),
          subcategoryLabel: subcategory?.subcategoryLabel || category?.mainCategoryLabel || 'Weitere Kategorien',
          offerCount: Number(subcategory?.offerCount || 0),
        }))
        .filter((subcategory) => {
          const mainLabel = String(category?.mainCategoryLabel || '').trim().toLowerCase()
          const subLabel = String(subcategory?.subcategoryLabel || '').trim().toLowerCase()
          return Boolean(subLabel) && subLabel !== mainLabel
        })
        .filter((subcategory, subIndex, items) =>
          items.findIndex((item) => item.subcategoryKey === subcategory.subcategoryKey || item.subcategoryLabel === subcategory.subcategoryLabel) === subIndex
        )
        .sort((left, right) => right.offerCount - left.offerCount || left.subcategoryLabel.localeCompare(right.subcategoryLabel, 'de')),
    }))
    .filter((item) => item.isActive)
    .sort((left, right) => right.offerCount - left.offerCount || left.mainCategoryLabel.localeCompare(right.mainCategoryLabel, 'de'))
}

function buildMainSelectionToken(mainCategoryKey) {
  return `main:${mainCategoryKey}`
}

function buildSubSelectionToken(mainCategoryKey, subcategoryKey) {
  return `sub:${mainCategoryKey}:${subcategoryKey}`
}

function getGroupSelectionState(group, selectionTokens = []) {
  const mainToken = buildMainSelectionToken(group.mainCategoryKey)
  const allSubcategoryKeys = (group.subcategories || []).map((subcategory) => subcategory.subcategoryKey)
  const selectedSubcategoryKeys = (group.subcategories || [])
    .filter((subcategory) => selectionTokens.includes(buildSubSelectionToken(group.mainCategoryKey, subcategory.subcategoryKey)))
    .map((subcategory) => subcategory.subcategoryKey)
  const allSubcategoriesSelected = allSubcategoryKeys.length > 0 && selectedSubcategoryKeys.length === allSubcategoryKeys.length
  const partialSelected = selectedSubcategoryKeys.length > 0 && !allSubcategoriesSelected

  return {
    mainSelected: selectionTokens.includes(mainToken) || allSubcategoriesSelected,
    partialSelected,
    selectedSubcategoryKeys,
  }
}

function pruneSelectionTokens(selectionTokens = [], categories = []) {
  const validTokens = new Set()

  for (const group of categories || []) {
    validTokens.add(buildMainSelectionToken(group.mainCategoryKey))

    for (const subcategory of group.subcategories || []) {
      validTokens.add(buildSubSelectionToken(group.mainCategoryKey, subcategory.subcategoryKey))
    }
  }

  return (selectionTokens || []).filter((token) => validTokens.has(token))
}

function buildSelectedCategoryQueryLabels(selectionTokens = [], categories = []) {
  const labels = []

  for (const group of categories || []) {
    const selectionState = getGroupSelectionState(group, selectionTokens)

    if (selectionState.selectedSubcategoryKeys.length > 0) {
      for (const subcategory of group.subcategories || []) {
        if (selectionState.selectedSubcategoryKeys.includes(subcategory.subcategoryKey)) {
          labels.push(subcategory.subcategoryLabel)
        }
      }

      continue
    }

    if (selectionState.mainSelected && !(group.subcategories || []).length) {
      labels.push(group.mainCategoryLabel)
    }
  }

  return [...new Set(labels.filter(Boolean))]
}

function areStringSetsEqual(left = [], right = []) {
  if (left.length !== right.length) return false

  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  return leftSorted.every((value, index) => value === rightSorted[index])
}

function getSavingsValue(offer) {
  const candidates = [
    offer?.savingsAmount,
    offer?.savings?.amount,
    offer?.priceSavings?.amount,
    offer?.discountAmount,
  ]

  for (const candidate of candidates) {
    const numeric = Number(candidate)
    if (Number.isFinite(numeric) && numeric > 0) return numeric
  }

  const oldPrice = Number(offer?.priceBefore?.amount || offer?.priceOriginal?.amount || offer?.priceRegular?.amount)
  const currentPrice = Number(offer?.priceCurrent?.amount)

  if (Number.isFinite(oldPrice) && Number.isFinite(currentPrice) && oldPrice > currentPrice) {
    return oldPrice - currentPrice
  }

  return -1
}

function hasKnownSavings(offer) {
  return getSavingsValue(offer) > 0
}

function getOfferSavingsInfo(offer) {
  const savingsValue = getSavingsValue(offer)

  if (savingsValue > 0) {
    return {
      type: 'known',
      label: `Spart ca. ${formatCurrencyAmount(savingsValue)}`,
      shortLabel: `ca. ${formatCurrencyAmount(savingsValue)}`,
      description: 'Ersparnis mit angegebenem Normalpreis.',
    }
  }

  return {
    type: 'action',
    label: 'Aktionspreis!',
    shortLabel: 'Aktionspreis',
    description: 'Im Prospekt ist kein Normalpreis angegeben. Das ist oft bei kurzen oder saisonalen Aktionen der Fall.',
  }
}

function filterVisibleOffers(offers, filters, retailers, categories) {
  if (!filters.selectedRetailers.length) return []

  const selectedRetailers = new Set(filters.selectedRetailers)
  const categoryGroups = categories || []
  const hasCategorySelection = filters.selectedCategoryTokens.length > 0

  return (offers || []).filter((offer) => {
    const retailerKey = getOfferRetailerKey(offer, retailers)
    const mainCategoryKey = normalizeRetailerKey(offer?.categoryPrimary || '')
    const subCategoryKey = normalizeRetailerKey(getOfferCategoryLabel(offer))

    if (!selectedRetailers.has(retailerKey)) return false

    if (!hasCategorySelection) {
      return true
    }

    const matchingGroup = categoryGroups.find((group) => group.mainCategoryKey === mainCategoryKey)

    if (!matchingGroup) {
      return false
    }

    const selectionState = getGroupSelectionState(matchingGroup, filters.selectedCategoryTokens)

    if (selectionState.selectedSubcategoryKeys.length > 0) {
      return selectionState.selectedSubcategoryKeys.some((subcategoryKey) => subcategoryKey === subCategoryKey)
    }

    return selectionState.mainSelected
  })
}

function loadStoredShoppingList() {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(SHOPPING_LIST_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id) : []
  } catch {
    return []
  }
}

function buildShoppingListItem(offer) {
  const id = getOfferStableId(offer)

  return {
    id,
    offerId: id,
    title: offer?.title || 'Unbekanntes Angebot',
    retailerKey: offer?.retailerKey || normalizeRetailerKey(offer?.retailerName),
    retailerName: offer?.retailerName || 'Unbekannter Markt',
    categoryLabel: getOfferCategoryLabel(offer),
    priceCurrent: offer?.priceCurrent || null,
    normalizedUnitPrice: offer?.normalizedUnitPrice || null,
    imageUrl: offer?.imageUrl || '',
    quantityText: offer?.quantityText || '',
    conditionsText: offer?.conditionsText || '',
    customerProgramRequired: Boolean(offer?.customerProgramRequired),
    isMultiBuy: Boolean(offer?.isMultiBuy),
    minimumPurchaseQty: offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || 1,
    hasConditions: Boolean(offer?.hasConditions),
    validFrom: offer?.validFrom || '',
    validTo: offer?.validTo || '',
    savingsAmount: getSavingsValue(offer) > 0 ? getSavingsValue(offer) : null,
    hasKnownSavings: hasKnownSavings(offer),
    addedAt: new Date().toISOString(),
  }
}

function groupShoppingListByRetailer(items = []) {
  const groups = new Map()

  for (const item of items || []) {
    const key = item.retailerKey || normalizeRetailerKey(item.retailerName)

    if (!groups.has(key)) {
      groups.set(key, {
        retailerKey: key,
        retailerName: item.retailerName || 'Unbekannter Markt',
        items: [],
      })
    }

    groups.get(key).items.push(item)
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) => String(left.title).localeCompare(String(right.title), 'de')),
    }))
    .sort((left, right) => left.retailerName.localeCompare(right.retailerName, 'de'))
}

function getShoppingListSummary(items = []) {
  return (items || []).reduce(
    (summary, item) => {
      const currentPrice = Number(item?.priceCurrent?.amount)
      const savingsValue = Number(item?.savingsAmount)

      if (Number.isFinite(currentPrice)) {
        summary.offerTotal += currentPrice
      }

      if (Number.isFinite(savingsValue) && savingsValue > 0) {
        summary.knownSavings += savingsValue
        summary.knownSavingsCount += 1
      } else {
        summary.actionWithoutNormalPriceCount += 1
      }

      summary.itemCount += 1
      return summary
    },
    {
      itemCount: 0,
      offerTotal: 0,
      knownSavings: 0,
      knownSavingsCount: 0,
      actionWithoutNormalPriceCount: 0,
    }
  )
}

function getPageMeta(activePage) {
  const baseTitle = 'kaufklug.at – Supermarkt-Angebote & Prospekte in Österreich einfacher finden'
  const baseDescription =
    'kaufklug.at hilft dir kostenlos, aktuelle Supermarkt-Angebote, Prospekte und Aktionen in Österreich leichter zu finden, nach Geschäften und Kategorien zu filtern und als Einkaufsliste zu speichern.'

  const pages = {
    search: {
      title: baseTitle,
      description: baseDescription,
      path: '/',
    },
    'shopping-list': {
      title: 'Einkaufsliste – kaufklug.at',
      description: 'Speichere interessante Angebote lokal auf deiner Einkaufsliste und sortiere deinen Einkauf nach Geschäft.',
      path: '/einkaufsliste',
    },
    impressum: {
      title: 'Impressum – kaufklug.at',
      description: 'Impressum und Betreiberinformationen zu kaufklug.at.',
      path: '/impressum',
    },
    privacy: {
      title: 'Datenschutz – kaufklug.at',
      description: 'Datenschutzhinweise zu kaufklug.at, lokaler Speicherung, Serverkommunikation und externem QR-Code-Dienst.',
      path: '/datenschutz',
    },
    liability: {
      title: 'Nutzungs- und Haftungshinweise – kaufklug.at',
      description: 'Hinweise zur unverbindlichen Nutzung von kaufklug.at, Angebotsinformationen, Marken, Händlern und Korrekturmeldungen.',
      path: '/nutzungshinweise',
    },
    cookies: {
      title: 'Cookie- und Speicherhinweis – kaufklug.at',
      description: 'Informationen zu Cookies, lokaler Speicherung und technischen Verbindungen bei kaufklug.at.',
      path: '/cookies',
    },
    quality: {
      title: 'Datenqualität – kaufklug.at',
      description: 'Interne Qualitätsansicht für kaufklug.at.',
      path: '/quality',
    },
    diagnostics: {
      title: 'Admin – kaufklug.at',
      description: 'Interner Administrationsbereich für kaufklug.at.',
      path: '/admin',
    },
  }

  return pages[activePage] || pages.search
}

function setOrCreateMeta(attribute, key, content) {
  if (typeof document === 'undefined') return

  let element = document.head.querySelector(`meta[${attribute}="${key}"]`)

  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }

  element.setAttribute('content', content)
}

function setOrCreateLink(rel, href) {
  if (typeof document === 'undefined') return

  let element = document.head.querySelector(`link[rel="${rel}"]`)

  if (!element) {
    element = document.createElement('link')
    element.setAttribute('rel', rel)
    document.head.appendChild(element)
  }

  element.setAttribute('href', href)
}

function setOrCreateJsonLd(id, data) {
  if (typeof document === 'undefined') return

  let element = document.getElementById(id)

  if (!element) {
    element = document.createElement('script')
    element.id = id
    element.type = 'application/ld+json'
    document.head.appendChild(element)
  }

  element.textContent = JSON.stringify(data)
}

function removeJsonLd(id) {
  if (typeof document === 'undefined') return

  const element = document.getElementById(id)

  if (element) {
    element.remove()
  }
}

function updateSeoMetadata(activePage) {
  if (typeof document === 'undefined') return

  const meta = getPageMeta(activePage)
  const canonicalUrl = `${SITE_URL}${meta.path}`

  document.title = meta.title

  setOrCreateMeta('name', 'description', meta.description)
  setOrCreateMeta('name', 'robots', activePage === 'quality' || activePage === 'diagnostics' ? 'noindex,nofollow' : 'index,follow')
  setOrCreateMeta('name', 'theme-color', '#f7f1e6')

  setOrCreateMeta('property', 'og:type', 'website')
  setOrCreateMeta('property', 'og:site_name', 'kaufklug.at')
  setOrCreateMeta('property', 'og:title', meta.title)
  setOrCreateMeta('property', 'og:description', meta.description)
  setOrCreateMeta('property', 'og:url', canonicalUrl)
  setOrCreateMeta('property', 'og:locale', 'de_AT')

  setOrCreateMeta('name', 'twitter:card', 'summary')
  setOrCreateMeta('name', 'twitter:title', meta.title)
  setOrCreateMeta('name', 'twitter:description', meta.description)

  setOrCreateLink('canonical', canonicalUrl)

  setOrCreateJsonLd('kaufklug-jsonld-website', {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'kaufklug.at',
    url: SITE_URL,
    inLanguage: 'de-AT',
    description:
      'Kostenlose Orientierungshilfe für Supermarkt-Angebote, Prospekte und Aktionen in Österreich.',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  })

  setOrCreateJsonLd('kaufklug-jsonld-webapp', {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'kaufklug.at',
    url: SITE_URL,
    applicationCategory: 'LifestyleApplication',
    operatingSystem: 'Web, Android',
    inLanguage: 'de-AT',
    isAccessibleForFree: true,
    description:
      'kaufklug.at hilft kostenlos dabei, öffentlich verfügbare Angebotsinformationen in Österreich übersichtlich darzustellen, nach Geschäften und Kategorien zu filtern und auf einer Einkaufsliste zu merken.',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
    },
    creator: {
      '@type': 'Person',
      name: 'Mag. Andreas Franz MA',
      email: CONTACT_EMAIL,
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Brunnenweg 16',
        postalCode: '8111',
        addressLocality: 'Gratwein-Straßengel',
        addressCountry: 'AT',
      },
    },
  })

  setOrCreateJsonLd('kaufklug-jsonld-person', {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Mag. Andreas Franz MA',
    email: CONTACT_EMAIL,
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Brunnenweg 16',
      postalCode: '8111',
      addressLocality: 'Gratwein-Straßengel',
      addressCountry: 'AT',
    },
  })

  if (activePage === 'search') {
    setOrCreateJsonLd('kaufklug-jsonld-faq', {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Was ist kaufklug.at?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'kaufklug.at ist eine kostenlose Orientierungshilfe für aktuelle Supermarkt-Angebote, Prospekte und Aktionen in Österreich. Die Seite hilft dabei, Angebote einfacher zu finden, nach Geschäften und Kategorien zu filtern und interessante Aktionen auf eine Einkaufsliste zu setzen.',
          },
        },
        {
          '@type': 'Question',
          name: 'Ist kaufklug.at kostenlos?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'Ja. kaufklug.at ist derzeit kostenlos nutzbar, weil das Projekt unabhängig aufgebaut wird.',
          },
        },
        {
          '@type': 'Question',
          name: 'Für wen ist kaufklug.at gedacht?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'kaufklug.at ist für alle gedacht, die beim täglichen Einkauf sparen möchten oder sparen müssen: Familien, Pensionisten, Studenten, Alleinerziehende und alle preisbewussten Haushalte in Österreich.',
          },
        },
        {
          '@type': 'Question',
          name: 'Sind die angezeigten Angebote garantiert richtig?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'Nein. kaufklug.at zeigt Angebotsinformationen als unverbindliche Orientierungshilfe. Preise, Verfügbarkeit, Bedingungen und regionale Gültigkeit können abweichen. Vor dem Kauf sollten immer die aktuellen Angaben des jeweiligen Händlers geprüft werden.',
          },
        },
        {
          '@type': 'Question',
          name: 'Warum sehe ich manchmal keine genaue Ersparnis?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'Manche Prospekte nennen nur den Aktionspreis, aber keinen Normalpreis. In solchen Fällen zeigt kaufklug.at den Aktionspreis, aber keine konkrete Euro-Ersparnis.',
          },
        },
        {
          '@type': 'Question',
          name: 'Funktioniert kaufklug.at besser am Smartphone?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'Ja. Die Website bleibt nutzbar, aber kaufklug.at ist vor allem für das Smartphone gedacht. So können Angebote direkt beim Einkaufen genutzt und interessante Aktionen auf der Einkaufsliste gespeichert werden.',
          },
        },
      ],
    })
  } else {
    removeJsonLd('kaufklug-jsonld-faq')
  }
}

function HeroLoaderModal({ open, label }) {
  if (!open) return null

  return (
    <div aria-live="polite" aria-busy="true" className="loader-overlay">
      <div className="panel loader-panel">
        <div className="panel__header loader-panel__header">
          <h2>kaufklug prüft aktuelle Angebote …</h2>
          <p>{label || 'Preise, Gültigkeit und Bedingungen werden geladen.'}</p>
        </div>

        <div className="loader-spinner" />
      </div>
    </div>
  )
}

function SectionCard({ children, style = {} }) {
  return (
    <section
      className="panel"
      style={{
        borderRadius: '24px',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </section>
  )
}

function ProductImage({ offerId, src, alt, compact = false }) {
  const primarySrc = offerId ? getOfferImageUrl(offerId) : src
  const [failedSources, setFailedSources] = useState(() => new Set())
  const imageSources = [primarySrc, src].filter((item, index, items) => item && items.indexOf(item) === index)
  const currentSrc = imageSources.find((item) => !failedSources.has(item)) || ''

  if (!currentSrc) {
    return (
      <div className={`product-image product-image--placeholder ${compact ? 'product-image--compact' : ''}`}>
        <span>Kein Bild</span>
      </div>
    )
  }

  return (
    <div className={`product-image ${compact ? 'product-image--compact' : ''}`}>
      <img
        src={currentSrc}
        alt={alt}
        loading="lazy"
        onError={() => {
          setFailedSources((current) => new Set(current).add(currentSrc))
        }}
      />
    </div>
  )
}

function LegalInlineNotice({ onNavigate, compact = false }) {
  return (
    <div className="savings-notice" style={compact ? { marginTop: '0.75rem' } : {}}>
      <strong>Unverbindlicher Hinweis:</strong>{' '}
      Preise, Verfügbarkeit, Bedingungen und regionale Gültigkeit können abweichen. Maßgeblich sind die aktuellen Angaben
      des jeweiligen Händlers im Geschäft, Online-Shop oder offiziellen Prospekt.{' '}
      {onNavigate ? (
        <button
          type="button"
          className="ghost-button"
          onClick={() => onNavigate('liability')}
          style={{
            display: 'inline',
            padding: 0,
            border: 0,
            background: 'transparent',
            boxShadow: 'none',
            font: 'inherit',
            fontWeight: 800,
            textDecoration: 'underline',
          }}
        >
          Nutzungs- und Haftungshinweise
        </button>
      ) : null}
    </div>
  )
}

function SavingsNotice({ onNavigate }) {
  return (
    <div className="savings-notice">
      <strong>Hinweis:</strong>{' '}
      kaufklug zeigt aktuelle Angebote aus Prospekten, Aktionen und Angebotsinformationen als unverbindliche
      Orientierungshilfe. Manche Prospekte nennen nur den Aktionspreis, aber keinen Normalpreis. In diesem Fall zeigen
      wir den Aktionspreis, aber keine Euro-Ersparnis.{' '}
      {onNavigate ? (
        <button
          type="button"
          className="ghost-button"
          onClick={() => onNavigate('liability')}
          style={{
            display: 'inline',
            padding: 0,
            border: 0,
            background: 'transparent',
            boxShadow: 'none',
            font: 'inherit',
            fontWeight: 800,
            textDecoration: 'underline',
          }}
        >
          Mehr dazu
        </button>
      ) : null}
    </div>
  )
}

function CookieStorageNotice({ onNavigate }) {
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return false

    try {
      return window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY) !== 'true'
    } catch {
      return true
    }
  })

  function handleAccept() {
    try {
      window.localStorage.setItem(COOKIE_NOTICE_STORAGE_KEY, 'true')
    } catch {
      // Speicherung kann im Browser blockiert sein. Der Hinweis wird dann nur für diese Sitzung geschlossen.
    }

    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="region"
      aria-label="Cookie- und Speicherhinweis"
      style={{
        position: 'fixed',
        left: '1rem',
        right: '1rem',
        bottom: '4.25rem',
        zIndex: 70,
        maxWidth: '980px',
        margin: '0 auto',
      }}
    >
      <div className="panel" style={{ padding: '1rem' }}>
        <div className="panel__header" style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1rem', margin: 0 }}>Cookie- und Speicherhinweis</h2>
          <p style={{ margin: 0 }}>
            kaufklug.at verwendet derzeit keine Marketing- oder Analyse-Cookies. Für die Einkaufsliste und diesen
            Hinweis speichern wir Daten lokal auf deinem Gerät. Beim Anzeigen des QR-Codes kann eine technische
            Verbindung zu einem externen QR-Code-Dienst entstehen.
          </p>
        </div>

        <div className="quick-action-row">
          <button type="button" className="primary-action-button" onClick={handleAccept}>
            Verstanden
          </button>
          <button type="button" className="ghost-button" onClick={() => onNavigate?.('cookies')}>
            Details
          </button>
        </div>
      </div>
    </div>
  )
}

function StickyBottomLine({ onNavigate }) {
  const footerButtonStyle = {
    display: 'inline',
    margin: '0 0 0 0.45rem',
    padding: 0,
    border: 0,
    color: '#315e2a',
    font: 'inherit',
    fontWeight: 850,
    textDecoration: 'none',
    background: 'transparent',
    cursor: 'pointer',
  }

  return (
    <div
      aria-label="Copyright, Projektlink und Rechtliches"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '2.55rem',
        padding: '0.48rem 1rem calc(0.48rem + env(safe-area-inset-bottom))',
        color: '#485344',
        fontSize: '0.84rem',
        fontWeight: 650,
        lineHeight: 1.35,
        textAlign: 'center',
        background: 'rgba(255, 252, 247, 0.94)',
        borderTop: '1px solid rgba(22, 33, 24, 0.1)',
        boxShadow: '0 -10px 26px rgba(83, 63, 34, 0.09)',
        backdropFilter: 'blur(14px)',
      }}
    >
      <span>
        © 2026 - Ein Projekt von{' '}
        <a
          href="https://www.ecily.com"
          target="_blank"
          rel="noreferrer"
          style={{
            color: '#315e2a',
            fontWeight: 850,
            textDecoration: 'none',
          }}
        >
          ecily/webentwicklung
        </a>
        .
        <button type="button" style={footerButtonStyle} onClick={() => onNavigate('impressum')}>
          Impressum
        </button>
        <button type="button" style={footerButtonStyle} onClick={() => onNavigate('privacy')}>
          Datenschutz
        </button>
        <button type="button" style={footerButtonStyle} onClick={() => onNavigate('liability')}>
          Haftung
        </button>
        <button type="button" style={footerButtonStyle} onClick={() => onNavigate('cookies')}>
          Cookies
        </button>
        <button type="button" style={footerButtonStyle} onClick={() => onNavigate('liability')}>
          Fehler melden
        </button>
      </span>
    </div>
  )
}

function HeroBlock() {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=14&data=${encodeURIComponent(KAUFKLUG_APK_DOWNLOAD_URL)}`

  return (
    <SectionCard
      style={{
        marginBottom: '1rem',
        background: 'linear-gradient(180deg, rgba(255,252,247,0.98), rgba(250,246,238,0.94))',
        border: '1px solid rgba(22,33,24,0.08)',
      }}
    >
      <div
        className="hero-consumer"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          alignItems: 'center',
          gap: 'clamp(1rem, 4vw, 2rem)',
        }}
      >
        <div
          className="hero-consumer__copy"
          style={{
            minWidth: 0,
            overflowWrap: 'normal',
            wordBreak: 'normal',
            hyphens: 'none',
          }}
        >
          <p className="eyebrow hero-consumer__eyebrow">kaufklug.at</p>

          <h1
            style={{
              maxWidth: '820px',
              overflowWrap: 'normal',
              wordBreak: 'normal',
              hyphens: 'none',
              fontSize: 'clamp(2.05rem, 8vw, 4.15rem)',
            }}
          >
            Supermarkt-Angebote finden. Einkaufsliste am Handy nutzen.
          </h1>

          <p
            className="subtitle"
            style={{
              maxWidth: '720px',
              overflowWrap: 'normal',
              wordBreak: 'normal',
              hyphens: 'none',
            }}
          >
            Wähle deine Geschäfte und Kategorien. kaufklug zeigt dir aktuelle Aktionen und merkt interessante Angebote
            auf deiner Einkaufsliste.
          </p>

          <div className="hero-benefit-grid">
            {[
              ['Kostenlos', 'Derzeit kostenlos nutzbar.'],
              ['Einfach', 'Geschäfte und Produkte auswählen.'],
              ['Praktisch', 'Angebote direkt am Smartphone mitnehmen.'],
            ].map(([title, text]) => (
              <div key={title} className="hero-benefit-card">
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '0.75rem',
            justifyItems: 'center',
            textAlign: 'center',
            minWidth: 0,
            width: '100%',
          }}
        >
          <p className="eyebrow hero-consumer__eyebrow" style={{ margin: 0 }}>
            Als App gedacht
          </p>

          <h2
            style={{
              margin: 0,
              maxWidth: '20rem',
              fontSize: 'clamp(1.35rem, 6vw, 2rem)',
              lineHeight: 1.05,
              letterSpacing: '-0.04em',
            }}
          >
            Am Smartphone ausprobieren.
          </h2>

          <div
            className="app-download-modal__qr"
            style={{
              width: 'min(100%, 280px)',
              margin: '0 auto',
            }}
          >
            <img
              src={qrUrl}
              alt="QR-Code zum Download der kaufklug.at Android-Testversion"
              width="280"
              height="280"
              loading="eager"
            />
          </div>

          <a
            href={KAUFKLUG_APK_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            className="primary-action-button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              maxWidth: '280px',
              textDecoration: 'none',
            }}
          >
            Android-Testversion laden
          </a>

          <p style={{ maxWidth: '280px', margin: 0, color: '#5c6658', fontSize: '0.92rem', lineHeight: 1.4 }}>
            QR-Code scannen und beim Einkaufen direkt am Handy nutzen.
          </p>
        </div>
      </div>
    </SectionCard>
  )
}

function SeoIntroSections() {
  return (
    <SectionCard style={{ marginBottom: '1rem' }}>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">So funktioniert kaufklug.at</p>
          <h2>In drei Schritten zu passenden Angeboten.</h2>
        </div>

        <div className="selection-summary-grid">
          <div className="selection-summary-card">
            <strong>1. Geschäfte auswählen</strong>
            <span>Wähle die Supermärkte, die für dich erreichbar sind.</span>
          </div>

          <div className="selection-summary-card">
            <strong>2. Produkte wählen</strong>
            <span>Filtere nach Kategorien oder Unterkategorien, die du heute brauchst.</span>
          </div>

          <div className="selection-summary-card">
            <strong>3. Einkaufsliste nutzen</strong>
            <span>Merke interessante Aktionen und nimm sie am Smartphone mit.</span>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

function FaqSection() {
  const faqs = [
    {
      question: 'Was ist kaufklug.at?',
      answer:
        'kaufklug.at ist eine kostenlose Orientierungshilfe für aktuelle Supermarkt-Angebote, Prospekte und Aktionen in Österreich. Die Seite hilft dir, Angebote einfacher zu finden, nach Geschäften und Kategorien zu filtern und interessante Aktionen auf deine Einkaufsliste zu setzen.',
    },
    {
      question: 'Ist kaufklug.at kostenlos?',
      answer:
        'Ja. kaufklug.at ist derzeit kostenlos nutzbar, weil das Projekt unabhängig aufgebaut wird.',
    },
    {
      question: 'Für wen ist kaufklug.at gedacht?',
      answer:
        'Für alle, die beim täglichen Einkauf sparen möchten oder sparen müssen: Familien, Pensionisten, Studenten, Alleinerziehende und alle preisbewussten Haushalte in Österreich.',
    },
    {
      question: 'Sind die angezeigten Angebote garantiert richtig?',
      answer:
        'Nein. kaufklug.at zeigt Angebotsinformationen als unverbindliche Orientierungshilfe. Preise, Verfügbarkeit, Bedingungen und regionale Gültigkeit können abweichen. Bitte prüfe vor dem Kauf immer die aktuellen Angaben des jeweiligen Händlers.',
    },
    {
      question: 'Warum sehe ich manchmal keine genaue Ersparnis?',
      answer:
        'Manche Prospekte nennen nur den Aktionspreis, aber keinen Normalpreis. In solchen Fällen zeigt kaufklug.at den Aktionspreis, aber keine konkrete Euro-Ersparnis.',
    },
    {
      question: 'Funktioniert kaufklug.at besser am Smartphone?',
      answer:
        'Ja. Die Website bleibt nutzbar, aber kaufklug.at ist vor allem für das Smartphone gedacht. So kannst du Angebote direkt beim Einkaufen nutzen und interessante Aktionen auf deiner Einkaufsliste speichern.',
    },
  ]

  return (
    <SectionCard style={{ marginTop: '1rem' }}>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">Häufige Fragen</p>
          <h2>Kurz erklärt.</h2>
          <p>Die wichtigsten Antworten zu kaufklug.at, Angeboten, Kosten und Nutzung.</p>
        </div>

        <div style={{ display: 'grid', gap: '0.85rem' }}>
          {faqs.map((item) => (
            <article key={item.question} className="selection-summary-card">
              <strong>{item.question}</strong>
              <span>{item.answer}</span>
            </article>
          ))}
        </div>
      </div>
    </SectionCard>
  )
}

function RetailerSelectorBlock({
  retailers,
  selectedRetailers,
  onToggleRetailer,
  onSelectAllRetailers,
  onClearRetailers,
  loading,
}) {
  return (
    <SectionCard style={{ marginBottom: '1rem' }}>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">1. Geschäfte wählen</p>
          <h2>Wo kaufst du ein?</h2>
          <p>Wähle die Geschäfte aus, die für dich erreichbar sind.</p>
        </div>

        {loading ? (
          <p className="status">Supermärkte werden geladen …</p>
        ) : (
          <>
            <div className="quick-action-row">
              <button type="button" className="ghost-button" onClick={onSelectAllRetailers}>
                Alle auswählen
              </button>
              <button type="button" className="ghost-button" onClick={onClearRetailers}>
                Geschäfte zurücksetzen
              </button>
            </div>

            <div className="chip-grid">
              {(retailers || []).map((retailer) => (
                <button
                  key={retailer.retailerKey}
                  type="button"
                  className={`chip ${selectedRetailers.includes(retailer.retailerKey) ? 'chip--active' : ''}`}
                  onClick={() => onToggleRetailer(retailer.retailerKey)}
                >
                  <span>{retailer.retailerName}</span>{' '}
                  <span className="chip__meta">
                    {retailer.activeOffers > 0 ? `(${retailer.activeOffers} Aktionen)` : '(derzeit keine Aktionen)'}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}

function CategorySelectorBlock({
  categories,
  selectedCategoryTokens,
  onToggleMainCategory,
  onToggleSubcategory,
  onClearCategories,
  loading,
  disabled,
}) {
  return (
    <SectionCard style={{ marginBottom: '1rem' }}>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">2. Produkte wählen</p>
          <h2>Was brauchst du heute?</h2>
          <p>Wähle eine Kategorie oder genauer eine Unterkategorie. Du kannst diesen Schritt auch überspringen.</p>
        </div>

        {disabled ? (
          <p className="status">Wähle zuerst mindestens ein Geschäft aus.</p>
        ) : loading ? (
          <p className="status">Kategorien werden geladen …</p>
        ) : (
          <div className="category-list">
            <div className="quick-action-row">
              <button type="button" className="ghost-button" onClick={onClearCategories}>
                Alle Kategorien anzeigen
              </button>
            </div>

            {(categories || []).map((group) => {
              const selectionState = getGroupSelectionState(group, selectedCategoryTokens)
              const isMainSelected = selectionState.mainSelected
              const isPartiallySelected = selectionState.partialSelected
              const hasSubcategories = group.subcategories.length > 0

              return (
                <div key={group.mainCategoryKey} className="category-card">
                  <button
                    type="button"
                    className={`chip category-main-chip ${isMainSelected ? 'chip--active' : isPartiallySelected ? 'chip--partial' : ''}`}
                    onClick={() => onToggleMainCategory(group)}
                  >
                    {group.mainCategoryLabel} ({group.offerCount})
                  </button>

                  {hasSubcategories ? (
                    <div className="category-card__subheader">Genauer auswählen</div>
                  ) : null}

                  {hasSubcategories ? (
                    <div className="chip-grid chip-grid--subcategories">
                      {group.subcategories.map((subcategory) => (
                        <button
                          key={subcategory.subcategoryKey}
                          type="button"
                          className={`chip chip--subtle ${selectionState.selectedSubcategoryKeys.includes(subcategory.subcategoryKey) ? 'chip--active' : ''}`}
                          onClick={() => onToggleSubcategory(group, subcategory)}
                        >
                          {subcategory.subcategoryLabel} {subcategory.offerCount ? `(${subcategory.offerCount})` : ''}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function ActionBlock({
  canSearch,
  selectedRetailerCount,
  selectedCategoryCount,
  onApplySearch,
  onReset,
  hasPendingChanges,
  searching,
}) {
  return (
    <SectionCard style={{ marginBottom: '1rem' }}>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">3. Angebote ansehen</p>
          <h2>Deine Auswahl ist bereit.</h2>
          <p>Tippe auf „Angebote anzeigen“. Danach kannst du passende Produkte auf deine Einkaufsliste setzen.</p>
        </div>

        <div className="selection-summary-grid">
          <div className="selection-summary-card">
            <strong>Geschäfte</strong>
            <span>{selectedRetailerCount > 0 ? `${selectedRetailerCount} ausgewählt` : 'Keine Auswahl'}</span>
          </div>

          <div className="selection-summary-card">
            <strong>Kategorien</strong>
            <span>{selectedCategoryCount > 0 ? `${selectedCategoryCount} ausgewählt` : 'Alle anzeigen'}</span>
          </div>

          <div className={`selection-summary-card ${hasPendingChanges ? 'selection-summary-card--ready' : ''}`}>
            <strong>Status</strong>
            <span>{hasPendingChanges ? 'Neue Auswahl bereit' : 'Aktuelle Auswahl geladen'}</span>
          </div>
        </div>

        <div className="action-button-row">
          <button
            type="button"
            className="primary-action-button"
            onClick={onApplySearch}
            disabled={!canSearch || searching}
          >
            {searching ? 'Angebote werden geladen …' : 'Angebote anzeigen'}
          </button>

          <button type="button" className="ghost-button" onClick={onReset}>
            Auswahl zurücksetzen
          </button>
        </div>
      </div>
    </SectionCard>
  )
}

function OfferCardConsumer({ offer, highlightLabel = '', onAddToShoppingList, isInShoppingList = false }) {
  const badges = buildOfferBadges(offer)
  const directlyComparable = isOfferDirectlyComparable(offer)
  const savingsInfo = getOfferSavingsInfo(offer)
  const conditionsSummary = getConditionsSummary(offer)
  const showUnitPrice = shouldDisplayUnitPrice(offer)

  return (
    <article className={`user-card ${directlyComparable ? 'user-card--known-savings' : 'user-card--action-price'}`}>
      <ProductImage offerId={offer.id} src={offer.imageUrl} alt={offer.title} />

      <div className="user-card__content">
        <div className="user-card__top">
          <div>
            <div className="user-card__eyebrow">
              {highlightLabel ? <span>{highlightLabel}</span> : null}
              <span>{offer.retailerName}</span>
              <span>{getOfferCategoryLabel(offer)}</span>
            </div>

            <h3>{offer.title}</h3>
          </div>

          <div className="user-card__price">
            <strong>{formatCurrencyAmount(offer?.priceCurrent?.amount, offer?.priceCurrent?.currency)}</strong>
            {showUnitPrice ? <span>{formatUnitPrice(offer?.normalizedUnitPrice)}</span> : null}
          </div>
        </div>

        <div className="chip-grid">
          {badges.map((badge) => (
            <span key={`${offer.id}-${badge}`} className="chip chip--static chip--subtle">
              {badge}
            </span>
          ))}
        </div>

        <div className={`offer-savings-box offer-savings-box--${savingsInfo.type}`}>
          <strong>{savingsInfo.label}</strong>
          <span>{savingsInfo.description}</span>
        </div>

        <div className="user-card__facts">
          <span>{formatValidityLabel(offer)}</span>
          <span>{offer.quantityText || 'Menge im Angebot beachten'}</span>
        </div>

        <div className="user-card__highlights">
          <div className={`highlight-pill ${directlyComparable ? 'highlight-pill--price' : ''}`}>
            <span>{savingsInfo.type === 'known' ? 'Euro-Ersparnis' : 'Preisart'}</span>
            <strong>{savingsInfo.shortLabel}</strong>
          </div>

          <div className="highlight-pill">
            <span>Bedingungen</span>
            <strong>{conditionsSummary}</strong>
          </div>

          <div className="highlight-pill">
            <span>{showUnitPrice ? 'Einheitspreis' : 'Hinweis'}</span>
            <strong>{showUnitPrice ? formatUnitPrice(offer?.normalizedUnitPrice) : 'Normalpreis nicht angegeben'}</strong>
          </div>
        </div>

        {offer?.conditionsText ? <p className="user-card__condition">{offer.conditionsText}</p> : null}

        <button
          type="button"
          className={`shopping-list-button ${isInShoppingList ? 'shopping-list-button--added' : ''}`}
          onClick={() => onAddToShoppingList?.(offer)}
          disabled={isInShoppingList}
        >
          {isInShoppingList ? 'Bereits auf Liste' : 'Auf die Einkaufsliste'}
        </button>
      </div>
    </article>
  )
}

function ResultsSection({ title, subtitle, offers, highlightPrefix, onAddToShoppingList, shoppingListIds }) {
  if (!offers.length) return null

  return (
    <div className="results-section">
      <div className="panel__header">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>

      <div className="user-results">
        {offers.map((offer, index) => (
          <OfferCardConsumer
            key={offer.id}
            offer={offer}
            highlightLabel={`${highlightPrefix} ${index + 1}`}
            onAddToShoppingList={onAddToShoppingList}
            isInShoppingList={shoppingListIds.has(getOfferStableId(offer))}
          />
        ))}
      </div>
    </div>
  )
}

function ResultsBlockConsumer({
  rankingLoading,
  hasAppliedRetailerScope,
  safeOffers,
  actionOffers,
  onAddToShoppingList,
  shoppingListIds,
  onNavigate,
}) {
  const visibleOfferCount = safeOffers.length + actionOffers.length

  return (
    <SectionCard>
      <div className="results-block">
        <div className="panel__header">
          <h2>Deine Angebote</h2>
          <p>
            Alle Treffer sind aktuelle Angebote. Euro-Ersparnis zeigen wir nur dort, wo im Prospekt ein Normalpreis
            angegeben ist.
          </p>
        </div>

        {!hasAppliedRetailerScope ? (
          <p className="status">
            Noch keine Suche gestartet. Wähle zuerst deine Geschäfte und tippe dann auf „Angebote anzeigen“.
          </p>
        ) : rankingLoading ? (
          <div className="results-loading">
            <p className="status">
              kaufklug prüft gerade Preise, Gültigkeit und Bedingungen …
            </p>
            <div className="skeleton-grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="skeleton-card" />
              ))}
            </div>
          </div>
        ) : visibleOfferCount === 0 ? (
          <div className="empty-state">
            <h3>Keine passenden Angebote gefunden.</h3>
            <p>Versuche mehr Geschäfte auszuwählen oder alle Kategorien anzuzeigen.</p>
          </div>
        ) : (
          <>
            <div className="results-count-box">
              <strong>{visibleOfferCount} aktuelle Angebote gefunden.</strong>
              <span>
                {safeOffers.length} mit angegebener Euro-Ersparnis, {actionOffers.length} weitere Aktionspreise.
              </span>
            </div>

            <SavingsNotice onNavigate={onNavigate} />
            <LegalInlineNotice onNavigate={onNavigate} compact />

            <ResultsSection
              title="Angebote mit Euro-Ersparnis"
              subtitle="Bei diesen Angeboten ist im Prospekt ein Normalpreis angegeben."
              offers={safeOffers}
              highlightPrefix="Angebot"
              onAddToShoppingList={onAddToShoppingList}
              shoppingListIds={shoppingListIds}
            />

            <ResultsSection
              title="Weitere aktuelle Aktionen"
              subtitle="Diese Produkte sind aktuelle Aktionen. Der Normalpreis ist im Prospekt nicht angegeben."
              offers={actionOffers}
              highlightPrefix="Aktion"
              onAddToShoppingList={onAddToShoppingList}
              shoppingListIds={shoppingListIds}
            />
          </>
        )}
      </div>
    </SectionCard>
  )
}

function SearchPage({
  retailers,
  categories,
  filtersLoading,
  ranking,
  rankingLoading,
  draftRetailers,
  draftCategoryLabels,
  appliedRetailers,
  appliedCategoryLabels,
  error,
  hasPendingChanges,
  shoppingListIds,
  onToggleDraftRetailer,
  onSelectAllRetailers,
  onClearRetailers,
  onToggleDraftMainCategory,
  onToggleDraftSubcategory,
  onClearDraftCategories,
  onApplySearch,
  onResetAll,
  onAddToShoppingList,
  onNavigate,
}) {
  const isInitialBusy = filtersLoading
  const hasAppliedRetailerScope = appliedRetailers.length > 0

  const allOffers = useMemo(() => flattenRankingOffers(ranking), [ranking])
  const visibleOffers = useMemo(() => {
    return filterVisibleOffers(
      allOffers,
      {
        selectedRetailers: appliedRetailers,
        selectedCategoryTokens: appliedCategoryLabels,
      },
      retailers || [],
      categories || []
    )
  }, [allOffers, appliedRetailers, appliedCategoryLabels, retailers, categories])
  const { bestComparableOffers, actionOffers } = useMemo(() => splitRankingOffers(visibleOffers), [visibleOffers])

  return (
    <>
      <HeroLoaderModal
        open={isInitialBusy}
        label="kaufklug lädt Geschäfte, Kategorien und aktuelle Angebote."
      />

      <HeroBlock />
      <SeoIntroSections />

      {error ? (
        <SectionCard style={{ marginBottom: '1rem' }}>
          <div className="error-box">
            <p className="status status--error">{error}</p>
          </div>
        </SectionCard>
      ) : null}

      <RetailerSelectorBlock
        retailers={retailers}
        selectedRetailers={draftRetailers}
        onToggleRetailer={onToggleDraftRetailer}
        onSelectAllRetailers={onSelectAllRetailers}
        onClearRetailers={onClearRetailers}
        loading={filtersLoading}
      />

      <CategorySelectorBlock
        categories={categories}
        selectedCategoryTokens={draftCategoryLabels}
        onToggleMainCategory={onToggleDraftMainCategory}
        onToggleSubcategory={onToggleDraftSubcategory}
        onClearCategories={onClearDraftCategories}
        loading={filtersLoading}
        disabled={!draftRetailers.length}
      />

      <ActionBlock
        canSearch={draftRetailers.length > 0}
        selectedRetailerCount={draftRetailers.length}
        selectedCategoryCount={draftCategoryLabels.length}
        onApplySearch={onApplySearch}
        onReset={onResetAll}
        hasPendingChanges={hasPendingChanges}
        searching={rankingLoading}
      />

      <ResultsBlockConsumer
        rankingLoading={rankingLoading}
        hasAppliedRetailerScope={hasAppliedRetailerScope}
        safeOffers={bestComparableOffers}
        actionOffers={actionOffers}
        onAddToShoppingList={onAddToShoppingList}
        shoppingListIds={shoppingListIds}
        onNavigate={onNavigate}
      />

      <FaqSection />
    </>
  )
}

function ShoppingListPage({ shoppingListItems, onRemoveItem, onClearList, onGoToOffers, onNavigate }) {
  const groupedItems = useMemo(() => groupShoppingListByRetailer(shoppingListItems), [shoppingListItems])
  const summary = useMemo(() => getShoppingListSummary(shoppingListItems), [shoppingListItems])

  if (!shoppingListItems.length) {
    return (
      <>
        <SectionCard style={{ marginBottom: '1rem' }}>
          <div className="shopping-list-hero">
            <p className="eyebrow">Einkaufsliste</p>
            <h1>Deine Einkaufsliste ist noch leer.</h1>
            <p>Füge Angebote hinzu, die du beim Einkauf nutzen möchtest. Sie werden lokal auf diesem Gerät gespeichert.</p>
            <button type="button" className="primary-action-button" onClick={onGoToOffers}>
              Angebote ansehen
            </button>
          </div>
        </SectionCard>

        <SavingsNotice onNavigate={onNavigate} />
        <LegalInlineNotice onNavigate={onNavigate} compact />
      </>
    )
  }

  return (
    <>
      <SectionCard style={{ marginBottom: '1rem' }}>
        <div className="shopping-list-hero">
          <p className="eyebrow">Einkaufsliste</p>
          <h1>Deine Einkaufsliste</h1>
          <p>Deine gespeicherten Angebote sind nach Geschäft sortiert. So kannst du deinen Einkauf einfacher planen.</p>
        </div>
      </SectionCard>

      <section className="shopping-summary">
        <article className="shopping-summary__card">
          <span>Du bezahlst laut Angebot</span>
          <strong>{formatCurrencyAmount(summary.offerTotal)}</strong>
        </article>

        <article className="shopping-summary__card shopping-summary__card--saving">
          <span>Ersparnis mit angegebenem Normalpreis</span>
          <strong>{formatCurrencyAmount(summary.knownSavings)}</strong>
        </article>

        <article className="shopping-summary__card">
          <span>Aktionspreise ohne Normalpreis</span>
          <strong>{summary.actionWithoutNormalPriceCount}</strong>
        </article>
      </section>

      {summary.actionWithoutNormalPriceCount > 0 ? (
        <div className="shopping-list-note">
          {summary.actionWithoutNormalPriceCount} weitere Angebote sind aktuelle Aktionen ohne angegebenen Normalpreis.
        </div>
      ) : null}

      <SavingsNotice onNavigate={onNavigate} />
      <LegalInlineNotice onNavigate={onNavigate} compact />

      <div className="shopping-list-actions">
        <button type="button" className="ghost-button" onClick={onGoToOffers}>
          Weitere Angebote suchen
        </button>
        <button type="button" className="ghost-button ghost-button--danger" onClick={onClearList}>
          Liste leeren
        </button>
      </div>

      <div className="shopping-market-groups">
        {groupedItems.map((group) => (
          <section key={group.retailerKey} className="shopping-market-group">
            <div className="shopping-market-group__header">
              <h2>{group.retailerName}</h2>
              <span>{group.items.length} Angebot{group.items.length === 1 ? '' : 'e'}</span>
            </div>

            <div className="shopping-list-items">
              {group.items.map((item) => {
                const savingsInfo = getOfferSavingsInfo(item)
                const showUnitPrice = shouldDisplayUnitPrice(item)

                return (
                  <article key={item.id} className="shopping-list-item">
                    <ProductImage offerId={item.offerId} src={item.imageUrl} alt={item.title} compact />

                    <div className="shopping-list-item__content">
                      <div className="shopping-list-item__main">
                        <div>
                          <p className="shopping-list-item__category">{item.categoryLabel}</p>
                          <h3>{item.title}</h3>
                        </div>

                        <strong className="shopping-list-item__price">
                          {formatCurrencyAmount(item?.priceCurrent?.amount, item?.priceCurrent?.currency)}
                        </strong>
                      </div>

                      <div className={`offer-savings-box offer-savings-box--${savingsInfo.type}`}>
                        <strong>{savingsInfo.label}</strong>
                        <span>{savingsInfo.description}</span>
                      </div>

                      <div className="shopping-list-item__facts">
                        <span>{formatValidityLabel(item)}</span>
                        <span>{item.quantityText || 'Menge im Geschäft beachten'}</span>
                        <span>{getConditionsSummary(item)}</span>
                        {showUnitPrice ? <span>{formatUnitPrice(item.normalizedUnitPrice)}</span> : null}
                      </div>

                      <button type="button" className="ghost-button shopping-list-item__remove" onClick={() => onRemoveItem(item.id)}>
                        Entfernen
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}

function LegalPageShell({ eyebrow, title, subtitle, children }) {
  return (
    <SectionCard>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          {children}
        </div>
      </div>
    </SectionCard>
  )
}

function LegalSection({ title, children }) {
  return (
    <section>
      <h2>{title}</h2>
      <div style={{ display: 'grid', gap: '0.6rem' }}>
        {children}
      </div>
    </section>
  )
}

function ImpressumPage() {
  return (
    <LegalPageShell
      eyebrow="Rechtliches"
      title="Impressum"
      subtitle="Betreiber- und Medieninhaberangaben zu kaufklug.at."
    >
      <LegalSection title="Medieninhaber und Betreiber">
        <p>
          <strong>Mag. Andreas Franz MA</strong>
          <br />
          Brunnenweg 16
          <br />
          8111 Gratwein-Straßengel
          <br />
          Österreich
        </p>
      </LegalSection>

      <LegalSection title="Kontakt">
        <p>
          E-Mail:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          <br />
          Telefon:{' '}
          <a href="tel:+436642437638">
            +43 664 2437638
          </a>
        </p>
      </LegalSection>

      <LegalSection title="Projektstatus">
        <p>
          kaufklug.at ist derzeit ein privates, kostenlos nutzbares Projekt. Über diese Website werden derzeit keine
          Waren oder Dienstleistungen verkauft. Die Website dient der unverbindlichen Orientierung über öffentlich
          verfügbare Angebotsinformationen.
        </p>
      </LegalSection>

      <LegalSection title="Gewerbe-, Firmenbuch- und UID-Angaben">
        <p>
          Es wird derzeit kein über diese Website aktiv ausgeübtes Gewerbe angegeben. Eine Firmenbuchnummer besteht
          nicht. Eine UID-Nummer wird derzeit nicht verwendet.
        </p>
      </LegalSection>

      <LegalSection title="Grundlegende Richtung">
        <p>
          kaufklug.at stellt Informationen rund um Supermarkt-Angebote, Prospekte, Aktionen, Einkauf und Sparen in
          Österreich bereit. Ziel ist eine einfache, kostenlose Orientierungshilfe für den Alltag.
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}

function PrivacyPage() {
  return (
    <LegalPageShell
      eyebrow="Rechtliches"
      title="Datenschutz"
      subtitle="Hinweise zur Verarbeitung personenbezogener Daten bei der Nutzung von kaufklug.at."
    >
      <LegalSection title="Verantwortlicher">
        <p>
          Mag. Andreas Franz MA
          <br />
          Brunnenweg 16
          <br />
          8111 Gratwein-Straßengel
          <br />
          Österreich
          <br />
          E-Mail:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </p>
      </LegalSection>

      <LegalSection title="Zweck der Website">
        <p>
          kaufklug.at hilft dabei, öffentlich verfügbare Angebotsinformationen übersichtlich darzustellen. Die Nutzung
          ist derzeit kostenlos und ohne Nutzerkonto möglich.
        </p>
      </LegalSection>

      <LegalSection title="Technische Zugriffsdaten">
        <p>
          Beim Aufruf der Website können technisch notwendige Zugriffsdaten verarbeitet werden, etwa IP-Adresse,
          Zeitpunkt des Zugriffs, abgerufene Inhalte, Browserinformationen und technische Statusmeldungen. Diese Daten
          sind für Bereitstellung, Sicherheit, Fehleranalyse und stabilen Betrieb der Website erforderlich.
        </p>
      </LegalSection>

      <LegalSection title="API-Kommunikation">
        <p>
          Die Webanwendung ruft Angebots-, Filter-, Qualitäts- und Statusdaten von einem Backend ab. Dabei können
          technische Zugriffsdaten an den Server übertragen werden. Es werden derzeit keine Nutzerkonten über diese
          Frontend-Ansicht geführt.
        </p>
      </LegalSection>

      <LegalSection title="Lokale Speicherung">
        <p>
          Die Einkaufsliste wird lokal im Browser des jeweiligen Geräts gespeichert. Diese Daten werden nicht benötigt,
          um die Website grundsätzlich aufzurufen, erleichtern aber die Nutzung der Einkaufsliste. Nutzerinnen und Nutzer
          können die Einkaufsliste jederzeit in der Anwendung löschen oder lokale Browserdaten entfernen.
        </p>
      </LegalSection>

      <LegalSection title="Externer QR-Code-Dienst">
        <p>
          Für den Download-Hinweis zur Android-Testversion wird ein QR-Code über einen externen QR-Code-Dienst geladen.
          Beim Anzeigen dieses QR-Codes kann eine technische Verbindung zu diesem Anbieter entstehen. Dabei können
          technische Zugriffsdaten wie IP-Adresse und Browserinformationen übertragen werden.
        </p>
      </LegalSection>

      <LegalSection title="Kontaktaufnahme">
        <p>
          Wenn du per E-Mail Kontakt aufnimmst, werden die von dir übermittelten Daten zur Bearbeitung der Anfrage
          verarbeitet. Eine Weitergabe erfolgt nicht ohne Anlass, außer sie ist zur Bearbeitung, Rechtsverfolgung oder
          Erfüllung gesetzlicher Pflichten erforderlich.
        </p>
      </LegalSection>

      <LegalSection title="Rechte betroffener Personen">
        <p>
          Betroffene Personen können nach Maßgabe der DSGVO insbesondere Auskunft, Berichtigung, Löschung,
          Einschränkung, Datenübertragbarkeit und Widerspruch geltend machen. Zudem besteht das Recht auf Beschwerde bei
          der österreichischen Datenschutzbehörde.
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}

function LiabilityPage() {
  return (
    <LegalPageShell
      eyebrow="Rechtliches"
      title="Nutzungs- und Haftungshinweise"
      subtitle="Wichtige Hinweise zur unverbindlichen Nutzung von kaufklug.at und zu Angebotsinformationen."
    >
      <LegalSection title="Unverbindliche Orientierungshilfe">
        <p>
          kaufklug.at stellt Angebots-, Preis-, Rabatt-, Produkt-, Verfügbarkeits- und Gültigkeitsinformationen
          ausschließlich als unverbindliche Orientierungshilfe bereit. Die dargestellten Informationen können aus
          öffentlich zugänglichen Quellen, Prospekten, Online-Angeboten oder automatisierten Auswertungen abgeleitet sein
          und können unvollständig, veraltet, fehlerhaft oder regional unterschiedlich sein.
        </p>
      </LegalSection>

      <LegalSection title="Keine Händlerstellung und keine verbindliche Preiszusage">
        <p>
          kaufklug.at ist kein Händler, verkauft keine Waren und gibt keine verbindlichen Preis-, Rabatt-,
          Verfügbarkeits- oder Produkteigenschaftszusagen ab. Maßgeblich sind ausschließlich die jeweils aktuellen
          Angaben, Preise, Bedingungen und Verfügbarkeiten des jeweiligen Händlers am Verkaufsort, im Online-Shop oder im
          offiziellen Prospekt des Händlers.
        </p>
      </LegalSection>

      <LegalSection title="Keine Gewähr für Angebotsinformationen">
        <p>
          Eine Gewähr für Richtigkeit, Vollständigkeit, Aktualität, Vergleichbarkeit, Verfügbarkeit oder regionale
          Gültigkeit der dargestellten Angebote wird nicht übernommen. Nutzerinnen und Nutzer sind verpflichtet, Preise,
          Bedingungen, Gültigkeit, Mengenbeschränkungen, Kundenkarten-/App-Erfordernisse und Verfügbarkeit vor dem Kauf
          selbst beim jeweiligen Händler zu prüfen.
        </p>
      </LegalSection>

      <LegalSection title="Haftungsbeschränkung">
        <p>
          Soweit gesetzlich zulässig, ist eine Haftung von kaufklug.at für Schäden, Nachteile, Mehrkosten, entgangene
          Ersparnisse oder Kaufentscheidungen, die aufgrund angezeigter Angebotsinformationen entstehen, ausgeschlossen.
          Die Haftung für vorsätzlich oder grob fahrlässig verursachte Schäden bleibt unberührt.
        </p>
      </LegalSection>

      <LegalSection title="Marken, Händler und Rechteinhaber">
        <p>
          Alle genannten Marken, Produktnamen, Händlerbezeichnungen und sonstigen Kennzeichen sind Eigentum der
          jeweiligen Rechteinhaber. Die Nennung dient ausschließlich der sachlichen Zuordnung öffentlich zugänglicher
          Angebotsinformationen. kaufklug.at ist ein unabhängiges Projekt und steht in keiner offiziellen Verbindung zu
          den angezeigten Händlern, Marken oder Rechteinhabern, sofern nicht ausdrücklich anders angegeben.
        </p>
      </LegalSection>

      <LegalSection title="Fehler melden und Korrekturen">
        <p>
          Sollten Rechteinhaber, Händler, Nutzerinnen oder Nutzer der Ansicht sein, dass Inhalte fehlerhaft,
          unzutreffend, veraltet oder rechtsverletzend sind, wird um Mitteilung an{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>{' '}
          ersucht. Beanstandete Inhalte werden nach nachvollziehbarer Prüfung korrigiert, ergänzt oder entfernt.
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}

function CookiesPage() {
  return (
    <LegalPageShell
      eyebrow="Rechtliches"
      title="Cookie- und Speicherhinweis"
      subtitle="Informationen zu Cookies, lokaler Speicherung und technischen Verbindungen."
    >
      <LegalSection title="Keine Marketing- oder Analyse-Cookies">
        <p>
          kaufklug.at verwendet derzeit keine Marketing- oder Analyse-Cookies in der sichtbaren Webanwendung. Es werden
          derzeit keine Werbeprofile erstellt und keine sichtbaren Tracking-Pixel wie Google Analytics, Meta Pixel oder
          vergleichbare Dienste eingesetzt.
        </p>
      </LegalSection>

      <LegalSection title="Lokale Speicherung im Browser">
        <p>
          Für die Einkaufsliste und den Speicherhinweis verwendet kaufklug.at lokale Speicherung im Browser
          beziehungsweise auf dem Gerät. Diese Speicherung dient dazu, die Einkaufsliste lokal zu erhalten und den
          Cookie-/Speicherhinweis nicht bei jedem Besuch erneut anzuzeigen.
        </p>
      </LegalSection>

      <LegalSection title="Externer QR-Code">
        <p>
          Beim Anzeigen des QR-Codes zum Download der Android-Testversion kann eine technische Verbindung zu einem
          externen QR-Code-Dienst entstehen. Wer dies vermeiden möchte, kann den direkten Download-Link verwenden, ohne
          den QR-Code zu scannen.
        </p>
      </LegalSection>

      <LegalSection title="Browserdaten löschen">
        <p>
          Lokale Daten können über die Funktionen des Browsers gelöscht werden. Zusätzlich kann die Einkaufsliste direkt
          in der Anwendung geleert werden.
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}

function DiagnosticsPage({
  health,
  snapshot,
  essence,
  error,
  feedbackState,
  feedbackNote,
  setFeedbackNote,
  handleSaveFeedback,
}) {
  const summary = snapshot?.qualitySummary || {}
  const comparisons = snapshot?.comparisonSnapshot || {}

  return (
    <>
      <header className="hero">
        <div>
          <p className="eyebrow">kaufklug.at Admin</p>
          <h1>Interner Systemstatus</h1>
          <p className="subtitle">Interne Ansicht für Quellen, Jobs, Rohdaten, Normalisierung und Vergleichsgruppen.</p>
        </div>
        <div className="hero__status">
          <div>
            <span>Crawling</span>
            <strong>serverseitig geplant</strong>
          </div>
          <div>
            <span>Backend</span>
            <strong>{health?.ok ? 'online' : 'offline'}</strong>
          </div>
          <div>
            <span>Mongo</span>
            <strong>{health?.database?.connected ? 'verbunden' : 'getrennt'}</strong>
          </div>
          <div>
            <span>Snapshot</span>
            <strong>{snapshot?.generatedAt ? dayjs(snapshot.generatedAt).format('DD.MM.YYYY HH:mm:ss') : '-'}</strong>
          </div>
        </div>
      </header>

      <SectionCard style={{ marginBottom: '1rem' }}>
        <div className="selection-block">
          <div className="selection-block__header">
            <p className="eyebrow">Admin-Navigation</p>
            <h2>Interne Werkzeuge</h2>
          </div>
          <div className="quick-action-row">
            <button type="button" className="ghost-button" onClick={() => window.history.replaceState({}, '', '/admin')}>
              Status
            </button>
            <button type="button" className="ghost-button" onClick={() => window.location.assign('/quality')}>
              Qualität öffnen
            </button>
          </div>
        </div>
      </SectionCard>

      {error ? <p className="status status--error">{error}</p> : null}

      <section className="metrics">
        <article className="metric-card"><span className="metric-card__label">Quellen aktiv</span><strong className="metric-card__value">{summary.sourceCount || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Rohdokumente</span><strong className="metric-card__value">{summary.rawDocumentCount || 0}</strong></article>
        <article className="metric-card metric-card--accent"><span className="metric-card__label">Gespeichert gesamt</span><strong className="metric-card__value">{summary.storedOfferCount || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Aktuell gültig</span><strong className="metric-card__value">{summary.activeOfferCount || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Prüfung offen</span><strong className="metric-card__value">{summary.offersPendingReview || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Vergleichsbasis</span><strong className="metric-card__value">{comparisons.comparableOfferCount || 0}</strong></article>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Crawl-Essenz</h2>
          <p>Kompakte Zusammenfassung für Rückmeldung und spätere Analyse.</p>
        </div>
        <pre className="essence-box">{essence || 'Noch keine Essenz vorhanden.'}</pre>
        <div className="feedback-box">
          <textarea
            value={feedbackNote}
            onChange={(event) => setFeedbackNote(event.target.value)}
            placeholder="Rückmeldung zur Crawl-Qualität, zu Lücken oder Auffälligkeiten …"
          />
          <div className="feedback-box__actions">
            <button
              className="crawl-button"
              onClick={handleSaveFeedback}
              disabled={feedbackState === 'saving' || !feedbackNote.trim()}
            >
              {feedbackState === 'saving' ? 'Feedback wird gespeichert …' : 'Feedback in Mongo speichern'}
            </button>
          </div>
        </div>
      </section>
    </>
  )
}

function buildQualityCategoryOptions(snapshot) {
  const options = new Set()

  for (const categoryPrimary of Object.keys(snapshot?.subcategoryOptionsByCategory || {})) {
    if (categoryPrimary) {
      options.add(categoryPrimary)
    }
  }

  for (const item of snapshot?.categories || []) {
    if (item?.categoryPrimary) {
      options.add(item.categoryPrimary)
    }
  }

  for (const item of snapshot?.subcategoryMappings || []) {
    if (item?.categoryPrimary) {
      options.add(item.categoryPrimary)
    }
  }

  for (const item of snapshot?.articleMappings || []) {
    if (item?.categoryPrimary) {
      options.add(item.categoryPrimary)
    }
  }

  return [...options].sort((left, right) => left.localeCompare(right, 'de'))
}

function buildQualitySubcategoryOptions(snapshot, selectedPrimary = '') {
  const options = new Set()

  for (const option of snapshot?.subcategoryOptionsByCategory?.[selectedPrimary] || []) {
    if (option) {
      options.add(option)
    }
  }

  for (const item of snapshot?.subcategoryMappings || []) {
    if (!item?.subcategoryLabel) continue
    if (!selectedPrimary || item.categoryPrimary === selectedPrimary) {
      options.add(item.subcategoryLabel)
    }
  }

  for (const item of snapshot?.manualOverrides?.articleSubcategory || []) {
    if (!item?.targetCategorySecondary) continue
    if (!selectedPrimary || item.targetCategoryPrimary === selectedPrimary) {
      options.add(item.targetCategorySecondary)
    }
  }

  return [...options].sort((left, right) => left.localeCompare(right, 'de'))
}

function SubcategoryOverrideRow({ item, categoryOptions, onSave, savingKey }) {
  const [targetCategoryPrimary, setTargetCategoryPrimary] = useState(item.categoryPrimary || '')
  const [note, setNote] = useState('')
  const rowKey = `subcategory:${item.subcategoryKey}`

  return (
    <div className="quality-row">
      <div>
        <strong>{item.subcategoryLabel}</strong>
        <p className="offer-card__meta">Aktuell in {item.categoryPrimary || 'Unkategorisiert'}</p>
      </div>
      <div>
        <span className="quality-row__label">Offers</span>
        <strong>{item.offerCount || 0}</strong>
        <p className="offer-card__meta">Aktiv: {item.activeOfferCount || 0}</p>
      </div>
      <div>
        <span className="quality-row__label">Retailer</span>
        <strong>{item.retailerCount || 0}</strong>
        <p className="offer-card__meta">{(item.sampleTitles || []).join(' • ') || 'Keine Beispiele'}</p>
      </div>
      <div className="quality-row__editor">
        <label className="quality-form__field">
          <span>Ziel-Kategorie</span>
          <select value={targetCategoryPrimary} onChange={(event) => setTargetCategoryPrimary(event.target.value)}>
            <option value="">Kategorie wählen</option>
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="quality-form__field">
          <span>Notiz</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="optional" />
        </label>
        <button
          className="crawl-button quality-row__action"
          disabled={!targetCategoryPrimary || savingKey === rowKey}
          onClick={() => onSave({ item, targetCategoryPrimary, note, rowKey })}
        >
          {savingKey === rowKey ? 'Speichert …' : 'Bestätigen'}
        </button>
      </div>
    </div>
  )
}

function ArticleOverrideRow({ item, categoryOptions, snapshot, onSave, onDelete, savingKey }) {
  const [targetCategoryPrimary, setTargetCategoryPrimary] = useState(item.categoryPrimary || '')
  const [targetCategorySecondary, setTargetCategorySecondary] = useState(item.categorySecondary || '')
  const [note, setNote] = useState('')
  const rowKey = `article:${item.retailerKey}:${item.titleNormalized}`
  const subcategoryOptions = useMemo(
    () => buildQualitySubcategoryOptions(snapshot, targetCategoryPrimary),
    [snapshot, targetCategoryPrimary]
  )
  const selectedTargetCategorySecondary =
    targetCategoryPrimary && subcategoryOptions.length > 0 && !subcategoryOptions.includes(targetCategorySecondary)
      ? subcategoryOptions[0]
      : targetCategorySecondary

  return (
    <div className="quality-row quality-row--article">
      <div>
        <strong>{item.titleDisplay || item.titleNormalized}</strong>
        <p className="offer-card__meta">{item.retailerName || item.retailerKey || 'Retailer unbekannt'}</p>
      </div>
      <div>
        <span className="quality-row__label">Aktuell</span>
        <strong>{item.categorySecondary || 'ohne Subkategorie'}</strong>
        <p className="offer-card__meta">{item.categoryPrimary || 'Unkategorisiert'}</p>
      </div>
      <div>
        <span className="quality-row__label">Offers</span>
        <strong>{item.offerCount || 0}</strong>
        <p className="offer-card__meta">Aktiv: {item.activeOfferCount || 0}</p>
      </div>
      <div className="quality-row__editor">
        <label className="quality-form__field">
          <span>Ziel-Kategorie</span>
          <select value={targetCategoryPrimary} onChange={(event) => setTargetCategoryPrimary(event.target.value)}>
            <option value="">Kategorie wählen</option>
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="quality-form__field">
          <span>Ziel-Subkategorie</span>
          <input
            list={`subcategory-options-${rowKey}`}
            value={selectedTargetCategorySecondary}
            onChange={(event) => setTargetCategorySecondary(event.target.value)}
            placeholder="Subkategorie setzen"
          />
          <datalist id={`subcategory-options-${rowKey}`}>
            {subcategoryOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>
        <label className="quality-form__field">
          <span>Notiz</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="optional" />
        </label>
        <button
          className="crawl-button quality-row__action"
          disabled={!targetCategoryPrimary || !selectedTargetCategorySecondary || savingKey === rowKey}
          onClick={() => onSave({ item, targetCategoryPrimary, targetCategorySecondary: selectedTargetCategorySecondary, note, rowKey })}
        >
          {savingKey === rowKey ? 'Speichert …' : 'Bestätigen'}
        </button>
        <button
          className="ghost-button"
          disabled={savingKey === `${rowKey}:delete`}
          onClick={() => onDelete({ item, note, rowKey: `${rowKey}:delete` })}
        >
          {savingKey === `${rowKey}:delete` ? 'Löscht …' : 'Löschen'}
        </button>
      </div>
    </div>
  )
}

function QualityPage({
  snapshot,
  loading,
  error,
  filters,
  onFilterChange,
  onReload,
  onSaveSubcategoryOverride,
  onSaveArticleOverride,
  onDeleteArticle,
  savingKey,
}) {
  const categoryOptions = useMemo(() => buildQualityCategoryOptions(snapshot), [snapshot])
  const subcategoryMappings = snapshot?.subcategoryMappings || []
  const articleMappings = snapshot?.articleMappings || []
  const manualSubcategoryOverrides = snapshot?.manualOverrides?.subcategoryCategory || []
  const manualArticleOverrides = snapshot?.manualOverrides?.articleSubcategory || []

  return (
    <>
      <header className="hero">
        <div>
          <p className="eyebrow">kaufklug.at Datenqualität</p>
          <h1>Zuordnungen prüfen und sofort korrigieren</h1>
          <p className="subtitle">
            Interne Qualitätsansicht für Kategorien, Subkategorien und manuelle Korrekturen. Manuelle Zuordnungen
            greifen sofort und haben Vorrang vor der Automatik.
          </p>
        </div>
        <div className="hero__status">
          <div>
            <span>Snapshot</span>
            <strong>{snapshot?.generatedAt ? dayjs(snapshot.generatedAt).format('DD.MM.YYYY HH:mm:ss') : '-'}</strong>
          </div>
          <div>
            <span>Subkategorien</span>
            <strong>{subcategoryMappings.length}</strong>
          </div>
          <div>
            <span>Artikel</span>
            <strong>{articleMappings.length}</strong>
          </div>
          <div>
            <span>Overrides</span>
            <strong>{manualSubcategoryOverrides.length + manualArticleOverrides.length}</strong>
          </div>
        </div>
      </header>

      {error ? <p className="status status--error">{error}</p> : null}

      <section className="panel">
        <div className="panel__header">
          <h2>Suche und Filter</h2>
          <p>Für Massenprüfung nach Retailer, Kategorie oder Freitext eingrenzen.</p>
        </div>
        <div className="quality-filters">
          <label className="quality-form__field">
            <span>Suche</span>
            <input
              value={filters.query}
              onChange={(event) => onFilterChange('query', event.target.value)}
              placeholder="Artikel, Subkategorie oder Kategorie suchen"
            />
          </label>
          <label className="quality-form__field">
            <span>Retailer</span>
            <select value={filters.retailerKey} onChange={(event) => onFilterChange('retailerKey', event.target.value)}>
              <option value="">Alle Retailer</option>
              {(snapshot?.retailers || []).map((item) => (
                <option key={item.retailerKey} value={item.retailerKey}>
                  {item.retailerName}
                </option>
              ))}
            </select>
          </label>
          <label className="quality-form__field">
            <span>Kategorie</span>
            <select value={filters.categoryPrimary} onChange={(event) => onFilterChange('categoryPrimary', event.target.value)}>
              <option value="">Alle Kategorien</option>
              {categoryOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="quality-form__field">
            <span>Limit</span>
            <select value={String(filters.limit)} onChange={(event) => onFilterChange('limit', Number(event.target.value))}>
              {[50, 100, 200, 300].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button className="crawl-button quality-filters__action" onClick={onReload} disabled={loading}>
            {loading ? 'Lädt …' : 'Ansicht aktualisieren'}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Subkategorie zu Kategorie</h2>
          <p>Primäre Qualitätssicht für die grobe Fachlogik.</p>
        </div>
        {loading && !snapshot ? <p className="status">Lade Quality-Snapshot …</p> : null}
        {!loading && subcategoryMappings.length === 0 ? (
          <p className="status">Keine passenden Subkategorie-Zuordnungen gefunden.</p>
        ) : null}
        <div className="quality-list">
          {subcategoryMappings.map((item) => (
            <SubcategoryOverrideRow
              key={`${item.subcategoryKey}-${item.categoryPrimary}`}
              item={item}
              categoryOptions={categoryOptions}
              onSave={onSaveSubcategoryOverride}
              savingKey={savingKey}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Artikel zu Subkategorie</h2>
          <p>Gezielte Einzelkorrekturen bei falsch zugeordneten Artikeln.</p>
        </div>
        {!loading && articleMappings.length === 0 ? (
          <p className="status">Keine passenden Artikel-Zuordnungen gefunden.</p>
        ) : null}
        <div className="quality-list">
          {articleMappings.map((item) => (
            <ArticleOverrideRow
              key={`${item.retailerKey}-${item.titleNormalized}-${item.categoryPrimary}-${item.categorySecondary}`}
              item={item}
              categoryOptions={categoryOptions}
              snapshot={snapshot}
              onSave={onSaveArticleOverride}
              onDelete={onDeleteArticle}
              savingKey={savingKey}
            />
          ))}
        </div>
      </section>
    </>
  )
}

function getInitialPageFromPathname(pathname) {
  if (pathname.includes('admin')) return 'diagnostics'
  if (pathname.includes('impressum')) return 'impressum'
  if (pathname.includes('datenschutz') || pathname.includes('privacy')) return 'privacy'
  if (pathname.includes('nutzung') || pathname.includes('haftung') || pathname.includes('legal')) return 'liability'
  if (pathname.includes('cookies') || pathname.includes('cookie')) return 'cookies'
  if (pathname.includes('quality')) return 'quality'
  if (pathname.includes('diagnose') || pathname.includes('diagnostic')) return 'diagnostics'
  if (pathname.includes('einkaufsliste') || pathname.includes('shopping')) return 'shopping-list'

  return 'search'
}

function getPathForPage(nextPage) {
  if (nextPage === 'quality') return '/quality'
  if (nextPage === 'diagnostics') return '/admin'
  if (nextPage === 'shopping-list') return '/einkaufsliste'
  if (nextPage === 'impressum') return '/impressum'
  if (nextPage === 'privacy') return '/datenschutz'
  if (nextPage === 'liability') return '/nutzungshinweise'
  if (nextPage === 'cookies') return '/cookies'

  return '/'
}

function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : ''
  const initialPage = getInitialPageFromPathname(pathname)

  const [activePage, setActivePage] = useState(initialPage)
  const [shoppingListItems, setShoppingListItems] = useState(() => loadStoredShoppingList())
  const [snapshot, setSnapshot] = useState(null)
  const [health, setHealth] = useState(null)
  const [essence, setEssence] = useState('')
  const [qualitySnapshot, setQualitySnapshot] = useState(null)
  const [ranking, setRanking] = useState(null)
  const [retailers, setRetailers] = useState([])
  const [categories, setCategories] = useState([])
  const [error, setError] = useState('')
  const [feedbackState, setFeedbackState] = useState('idle')
  const [feedbackNote, setFeedbackNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [filtersLoading, setFiltersLoading] = useState(true)
  const [rankingLoading, setRankingLoading] = useState(false)
  const [qualityLoading, setQualityLoading] = useState(false)
  const [qualitySavingKey, setQualitySavingKey] = useState('')
  const [qualityFilters, setQualityFilters] = useState({
    query: '',
    retailerKey: '',
    categoryPrimary: '',
    limit: 100,
  })
  const [draftSelectedRetailers, setDraftSelectedRetailers] = useState([])
  const [draftSelectedCategoryLabels, setDraftSelectedCategoryLabels] = useState([])
  const [appliedSelectedRetailers, setAppliedSelectedRetailers] = useState([])
  const [appliedSelectedCategoryLabels, setAppliedSelectedCategoryLabels] = useState([])

  const shoppingListIds = useMemo(
    () => new Set(shoppingListItems.map((item) => item.id)),
    [shoppingListItems]
  )

  const appliedCategoryQueryLabels = useMemo(
    () => buildSelectedCategoryQueryLabels(appliedSelectedCategoryLabels, categories),
    [appliedSelectedCategoryLabels, categories]
  )

  useEffect(() => {
    updateSeoMetadata(activePage)
  }, [activePage])

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      window.localStorage.setItem(SHOPPING_LIST_STORAGE_KEY, JSON.stringify(shoppingListItems))
    } catch {
      // localStorage kann im Browser blockiert sein. Die App bleibt trotzdem nutzbar.
    }
  }, [shoppingListItems])

  useEffect(() => {
    let active = true

    async function loadFilterMetadata() {
      try {
        setFiltersLoading(true)
        const retailerResult = await fetchFilterRetailers()

        if (!active) return

        setRetailers(retailerResult)
        setDraftSelectedRetailers([])
        setAppliedSelectedRetailers([])
        setError('')
      } catch (filterError) {
        if (!active) return
        setRetailers([])
        setDraftSelectedRetailers([])
        setAppliedSelectedRetailers([])
        setError(filterError.message || 'Filterdaten konnten nicht geladen werden.')
      } finally {
        if (active) setFiltersLoading(false)
      }
    }

    loadFilterMetadata()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (activePage !== 'diagnostics') {
      return undefined
    }

    let active = true

    async function loadDiagnostics() {
      try {
        setLoading(true)
        const [healthResult, snapshotResult, essenceResult] = await Promise.all([
          fetchHealth(),
          fetchDashboardSnapshot(),
          fetchEssence(),
        ])

        if (!active) return

        setHealth(healthResult)
        setSnapshot(snapshotResult)
        setEssence(essenceResult)
        setError('')
      } catch (loadError) {
        if (!active) return
        setError(loadError.message || 'Dashboard-Daten konnten nicht geladen werden.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadDiagnostics()
    const interval = setInterval(loadDiagnostics, 20000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [activePage])

  useEffect(() => {
    if (activePage !== 'quality') {
      return undefined
    }

    let active = true

    async function loadQualitySnapshot() {
      try {
        setQualityLoading(true)
        const nextSnapshot = await fetchQualitySnapshot({
          q: qualityFilters.query,
          retailerKey: qualityFilters.retailerKey,
          categoryPrimary: qualityFilters.categoryPrimary,
          limit: qualityFilters.limit,
        })

        if (!active) return

        setQualitySnapshot(nextSnapshot)
        setError('')
      } catch (loadError) {
        if (!active) return
        setError(loadError.message || 'Quality-Snapshot konnte nicht geladen werden.')
      } finally {
        if (active) setQualityLoading(false)
      }
    }

    loadQualitySnapshot()

    return () => {
      active = false
    }
  }, [activePage, qualityFilters])

  useEffect(() => {
    let active = true

    async function loadScopedCategories() {
      try {
        setFiltersLoading(true)
        const categoryResult = await fetchFilterCategories(draftSelectedRetailers)

        if (!active) return

        const nextCategories = normalizeCategoryDocuments(categoryResult)
        setCategories(nextCategories)
        setDraftSelectedCategoryLabels((current) => pruneSelectionTokens(current, nextCategories))
        setAppliedSelectedCategoryLabels((current) => pruneSelectionTokens(current, nextCategories))
        setError('')
      } catch (filterError) {
        if (!active) return
        setCategories([])
        setError(filterError.message || 'Filterdaten konnten nicht geladen werden.')
      } finally {
        if (active) setFiltersLoading(false)
      }
    }

    loadScopedCategories()

    return () => {
      active = false
    }
  }, [draftSelectedRetailers])

  useEffect(() => {
    let active = true

    async function loadRanking() {
      if (!appliedSelectedRetailers.length) {
        setRanking(null)
        setRankingLoading(false)
        return
      }

      try {
        setRankingLoading(true)

        const rankingResult = await fetchOfferRankingDirect({
          categories: appliedCategoryQueryLabels.join(','),
          retailers: appliedSelectedRetailers.join(','),
          programRetailers: appliedSelectedRetailers.join(','),
          unit: 'all',
          q: '',
          limit: 'all',
        })

        if (!active) return

        setRanking(rankingResult)
        setError('')
      } catch (rankingError) {
        if (!active) return
        setRanking(null)
        setError(rankingError.message || 'Ranking-Daten konnten nicht geladen werden.')
      } finally {
        if (active) setRankingLoading(false)
      }
    }

    loadRanking()

    return () => {
      active = false
    }
  }, [appliedSelectedRetailers, appliedCategoryQueryLabels])

  async function reloadAll() {
    const [healthResult, snapshotResult, essenceResult] = await Promise.all([
      fetchHealth(),
      fetchDashboardSnapshot(),
      fetchEssence(),
    ])

    setHealth(healthResult)
    setSnapshot(snapshotResult)
    setEssence(essenceResult)
  }

  function handleNavigate(nextPage) {
    setActivePage(nextPage)

    if (typeof window === 'undefined') {
      return
    }

    window.history.replaceState({}, '', getPathForPage(nextPage))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleQualityFilterChange(key, value) {
    setQualityFilters((current) => ({
      ...current,
      [key]: value,
    }))
  }

  async function refreshQualitySnapshot() {
    setQualityFilters((current) => ({ ...current }))
  }

  function handleToggleDraftRetailer(retailerKey) {
    setDraftSelectedRetailers((current) => {
      const nextRetailers = current.includes(retailerKey)
        ? current.filter((item) => item !== retailerKey)
        : [...current, retailerKey]

      return nextRetailers
    })
  }

  function handleSelectAllRetailers() {
    setDraftSelectedRetailers((retailers || []).map((retailer) => retailer.retailerKey).filter(Boolean))
  }

  function handleClearRetailers() {
    setDraftSelectedRetailers([])
    setDraftSelectedCategoryLabels([])
  }

  function handleClearDraftCategories() {
    setDraftSelectedCategoryLabels([])
  }

  function handleToggleDraftMainCategory(group) {
    const mainToken = buildMainSelectionToken(group.mainCategoryKey)
    const subcategoryTokens = (group.subcategories || []).map((item) => buildSubSelectionToken(group.mainCategoryKey, item.subcategoryKey))

    setDraftSelectedCategoryLabels((current) => {
      const selectionState = getGroupSelectionState(group, current)
      const next = current.filter((token) => token !== mainToken && !subcategoryTokens.includes(token))

      if (selectionState.mainSelected) {
        return next
      }

      if (subcategoryTokens.length > 0) {
        return [...next, ...subcategoryTokens]
      }

      return [...next, mainToken]
    })
  }

  function handleToggleDraftSubcategory(group, subcategory) {
    const mainToken = buildMainSelectionToken(group.mainCategoryKey)
    const subToken = buildSubSelectionToken(group.mainCategoryKey, subcategory.subcategoryKey)

    setDraftSelectedCategoryLabels((current) => {
      const withoutMain = current.filter((token) => token !== mainToken)

      if (withoutMain.includes(subToken)) {
        return withoutMain.filter((token) => token !== subToken)
      }

      return [...withoutMain, subToken]
    })
  }

  function handleApplySearch() {
    setAppliedSelectedRetailers([...draftSelectedRetailers])
    setAppliedSelectedCategoryLabels([...draftSelectedCategoryLabels])
  }

  function handleResetAll() {
    setDraftSelectedRetailers([])
    setDraftSelectedCategoryLabels([])
    setAppliedSelectedRetailers([])
    setAppliedSelectedCategoryLabels([])
    setRanking(null)
  }

  function handleAddToShoppingList(offer) {
    const item = buildShoppingListItem(offer)

    setShoppingListItems((current) => {
      if (current.some((existingItem) => existingItem.id === item.id)) return current
      return [item, ...current]
    })
  }

  function handleRemoveShoppingListItem(itemId) {
    setShoppingListItems((current) => current.filter((item) => item.id !== itemId))
  }

  function handleClearShoppingList() {
    setShoppingListItems([])
  }

  async function handleSaveFeedback() {
    try {
      setFeedbackState('saving')
      await saveFeedback({
        note: feedbackNote,
        digest: essence,
        scope: 'crawl-review',
      })
      await reloadAll()
      setFeedbackNote('')
      setFeedbackState('done')
      setError('')
    } catch (feedbackError) {
      setFeedbackState('failed')
      setError(feedbackError.message || 'Feedback konnte nicht gespeichert werden.')
    }
  }

  async function handleSaveSubcategoryOverride({ item, targetCategoryPrimary, note, rowKey }) {
    try {
      setQualitySavingKey(rowKey)
      await saveSubcategoryCategoryOverride({
        matchSubcategoryLabel: item.subcategoryLabel,
        targetCategoryPrimary,
        note,
      })
      const nextSnapshot = await fetchQualitySnapshot({
        q: qualityFilters.query,
        retailerKey: qualityFilters.retailerKey,
        categoryPrimary: qualityFilters.categoryPrimary,
        limit: qualityFilters.limit,
      })
      setQualitySnapshot(nextSnapshot)
      setError('')
    } catch (saveError) {
      setError(saveError.message || 'Subkategorie-Korrektur konnte nicht gespeichert werden.')
    } finally {
      setQualitySavingKey('')
    }
  }

  async function handleSaveArticleOverride({ item, targetCategoryPrimary, targetCategorySecondary, note, rowKey }) {
    try {
      setQualitySavingKey(rowKey)
      await saveArticleSubcategoryOverride({
        retailerKey: item.retailerKey,
        titleNormalized: item.titleNormalized,
        titleDisplay: item.titleDisplay,
        targetCategoryPrimary,
        targetCategorySecondary,
        note,
      })
      const nextSnapshot = await fetchQualitySnapshot({
        q: qualityFilters.query,
        retailerKey: qualityFilters.retailerKey,
        categoryPrimary: qualityFilters.categoryPrimary,
        limit: qualityFilters.limit,
      })
      setQualitySnapshot(nextSnapshot)
      setError('')
    } catch (saveError) {
      setError(saveError.message || 'Artikel-Korrektur konnte nicht gespeichert werden.')
    } finally {
      setQualitySavingKey('')
    }
  }

  async function handleDeleteArticle({ item, note, rowKey }) {
    try {
      setQualitySavingKey(rowKey)
      await ignoreArticleQualityItem({
        retailerKey: item.retailerKey,
        titleNormalized: item.titleNormalized,
        titleDisplay: item.titleDisplay,
        note,
      })
      const nextSnapshot = await fetchQualitySnapshot({
        q: qualityFilters.query,
        retailerKey: qualityFilters.retailerKey,
        categoryPrimary: qualityFilters.categoryPrimary,
        limit: qualityFilters.limit,
      })
      setQualitySnapshot(nextSnapshot)
      setError('')
    } catch (saveError) {
      setError(saveError.message || 'Artikel konnte nicht gelöscht werden.')
    } finally {
      setQualitySavingKey('')
    }
  }

  const hasPendingChanges =
    !areStringSetsEqual(draftSelectedRetailers, appliedSelectedRetailers) ||
    !areStringSetsEqual(draftSelectedCategoryLabels, appliedSelectedCategoryLabels)

  return (
    <main className="shell" style={{ paddingBottom: '5.5rem' }}>
      <nav className="page-nav" aria-label="Seiten">
        <div className="page-nav__main">
          <button
            className={`page-nav__button${activePage === 'search' ? ' page-nav__button--active' : ''}`}
            onClick={() => handleNavigate('search')}
          >
            Angebote
          </button>

          <button
            className={`page-nav__button${activePage === 'shopping-list' ? ' page-nav__button--active' : ''}`}
            onClick={() => handleNavigate('shopping-list')}
          >
            Einkaufsliste
            {shoppingListItems.length > 0 ? <span className="page-nav__count">{shoppingListItems.length}</span> : null}
          </button>
        </div>
      </nav>

      {activePage === 'search' ? (
        <SearchPage
          retailers={retailers}
          categories={categories}
          filtersLoading={filtersLoading}
          ranking={ranking}
          rankingLoading={rankingLoading}
          draftRetailers={draftSelectedRetailers}
          draftCategoryLabels={draftSelectedCategoryLabels}
          appliedRetailers={appliedSelectedRetailers}
          appliedCategoryLabels={appliedSelectedCategoryLabels}
          error={error}
          hasPendingChanges={hasPendingChanges}
          shoppingListIds={shoppingListIds}
          onToggleDraftRetailer={handleToggleDraftRetailer}
          onSelectAllRetailers={handleSelectAllRetailers}
          onClearRetailers={handleClearRetailers}
          onToggleDraftMainCategory={handleToggleDraftMainCategory}
          onToggleDraftSubcategory={handleToggleDraftSubcategory}
          onClearDraftCategories={handleClearDraftCategories}
          onApplySearch={handleApplySearch}
          onResetAll={handleResetAll}
          onAddToShoppingList={handleAddToShoppingList}
          onNavigate={handleNavigate}
        />
      ) : activePage === 'shopping-list' ? (
        <ShoppingListPage
          shoppingListItems={shoppingListItems}
          onRemoveItem={handleRemoveShoppingListItem}
          onClearList={handleClearShoppingList}
          onGoToOffers={() => handleNavigate('search')}
          onNavigate={handleNavigate}
        />
      ) : activePage === 'impressum' ? (
        <ImpressumPage />
      ) : activePage === 'privacy' ? (
        <PrivacyPage />
      ) : activePage === 'liability' ? (
        <LiabilityPage />
      ) : activePage === 'cookies' ? (
        <CookiesPage />
      ) : activePage === 'quality' ? (
        <QualityPage
          snapshot={qualitySnapshot}
          loading={qualityLoading}
          error={error}
          filters={qualityFilters}
          onFilterChange={handleQualityFilterChange}
          onReload={refreshQualitySnapshot}
          onSaveSubcategoryOverride={handleSaveSubcategoryOverride}
          onSaveArticleOverride={handleSaveArticleOverride}
          onDeleteArticle={handleDeleteArticle}
          savingKey={qualitySavingKey}
        />
      ) : (
        <>
          {loading && !snapshot ? <p className="status">Lade Ansicht …</p> : null}
          {error && !snapshot ? <p className="status status--error">{error}</p> : null}
          {snapshot ? (
            <DiagnosticsPage
              health={health}
              snapshot={snapshot}
              essence={essence}
              error={error}
              feedbackState={feedbackState}
              feedbackNote={feedbackNote}
              setFeedbackNote={setFeedbackNote}
              handleSaveFeedback={handleSaveFeedback}
            />
          ) : null}
        </>
      )}

      <CookieStorageNotice onNavigate={handleNavigate} />
      <StickyBottomLine onNavigate={handleNavigate} />
    </main>
  )
}

export default App