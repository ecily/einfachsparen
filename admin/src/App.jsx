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


function getOfferCategoryLabel(offer) {
  return offer?.displayCategory || offer?.categorySecondary || offer?.categoryPrimary || 'ohne Kategorie'
}

function isOfferDirectlyComparable(offer) {
  return Boolean(offer?.quality?.comparisonSafe && offer?.comparisonGroup && offer?.normalizedUnitPrice?.amount)
}

function getOfferKindLabel(offer) {
  return isOfferDirectlyComparable(offer) ? 'Direkt vergleichbar' : 'Aehnliches Angebot'
}

function getOfferStatusLabel(offer) {
  if (offer?.status === 'active' && offer?.isActiveNow) return 'Aktuell gueltig'
  if (offer?.status === 'upcoming') return 'Bald gueltig'
  if (offer?.status === 'expired') return 'Nicht mehr gueltig'
  if (offer?.isActiveToday) return 'Heute relevant'
  return 'Status unklar'
}

function formatCurrencyAmount(amount, currency = 'EUR') {
  const numericAmount = Number(amount)

  if (!Number.isFinite(numericAmount)) {
    return 'Preis nicht erkannt'
  }

  return `${numericAmount.toFixed(2)} ${currency}`
}

function formatUnitPrice(normalizedUnitPrice) {
  const amount = Number(normalizedUnitPrice?.amount)
  const unit = normalizedUnitPrice?.unit

  if (!Number.isFinite(amount) || !unit) {
    return 'Einheitspreis nicht sicher'
  }

  return `${amount.toFixed(2)} / ${unit}`
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
    return `Mindestens ${minimumPurchaseQty} noetig`
  }

  if (offer?.hasConditions) {
    return 'Bedingungen vorhanden'
  }

  return 'Keine besonderen Bedingungen'
}

function buildOfferBadges(offer) {
  const badges = [getOfferKindLabel(offer), getOfferStatusLabel(offer)]

  if (offer?.customerProgramRequired) badges.push('Mit Kundenkarte/App')
  if (offer?.isMultiBuy) badges.push('Mehrkauf-Angebot')
  if (Number(offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || 1) > 1) badges.push('Mindestmenge noetig')

  return badges
}

function formatValidityLabel(offer) {
  const hasValidFrom = Boolean(offer?.validFrom)
  const hasValidTo = Boolean(offer?.validTo)

  if (hasValidFrom && hasValidTo) {
    return `gueltig von ${dayjs(offer.validFrom).format('DD.MM.YYYY')} bis ${dayjs(offer.validTo).format('DD.MM.YYYY')}`
  }

  if (hasValidFrom) {
    return `gueltig ab ${dayjs(offer.validFrom).format('DD.MM.YYYY')}`
  }

  if (hasValidTo) {
    return `gueltig bis ${dayjs(offer.validTo).format('DD.MM.YYYY')}`
  }

  return 'aktuell verfuegbar, Enddatum nicht erkannt'
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
        id: offer?.id || offer?._id || `${offer?.title}-${offer?.retailerName}-${offer?.priceCurrent?.amount}`,
      }))
  }

  const seen = new Set()
  const offers = []

  for (const group of ranking?.rankedGroups || []) {
    for (const offer of group.offers || []) {
      const offerId = offer?.id || offer?._id || `${offer?.title}-${offer?.retailerName}-${offer?.priceCurrent?.amount}`

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
  const similarOffers = []

  for (const offer of offers || []) {
    if (isOfferDirectlyComparable(offer)) {
      bestComparableOffers.push(offer)
      continue
    }

    similarOffers.push(offer)
  }

  return {
    bestComparableOffers,
    similarOffers,
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
  const raw = Number(offer?.savingsAmount)
  return Number.isFinite(raw) ? raw : -1
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

function HeroLoaderModal({ open, label }) {
  if (!open) return null

  return (
    <div
      aria-live="polite"
      aria-busy="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(12, 16, 26, 0.68)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <style>{`
        @keyframes kkSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      <div
        className="panel"
        style={{
          width: 'min(92vw, 520px)',
          textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div className="panel__header" style={{ alignItems: 'center' }}>
          <h2>Einen Moment, wir laden gerade ...</h2>
          <p>{label || 'kaufklug.at laedt Supermaerkte und Kategorien.'}</p>
        </div>

        <div
          style={{
            width: '48px',
            height: '48px',
            margin: '8px auto 0',
            borderRadius: '999px',
            border: '4px solid rgba(255,255,255,0.18)',
            borderTopColor: 'currentColor',
            animation: 'kkSpin 0.9s linear infinite',
          }}
        />
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

function HeroBlock() {
  return (
    <SectionCard
      style={{
        marginBottom: '1rem',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: '0.9rem',
          padding: '1.25rem 1.25rem 1.35rem',
        }}
      >
        <p className="eyebrow" style={{ margin: 0 }}>kaufklug.at</p>
        <h1 style={{ margin: 0 }}>Die kluge Art, Geld bei jedem Einkauf zu sparen.</h1>

        <div style={{ display: 'grid', gap: '0.55rem', maxWidth: '960px' }}>
          <p className="subtitle" style={{ margin: 0 }}>
            kaufklug.at durchsucht fuer dich automatisch die vielen Angebote und Prospekte, die sonst taeglich im Postkasten landen.
          </p>
          <p className="subtitle" style={{ margin: 0 }}>
            Du musst nicht mehr selbst alles vergleichen. Die Seite zeigt dir uebersichtlich, welcher Supermarkt bei deinen gesuchten Produkten gerade am guenstigsten ist.
          </p>
          <p className="subtitle" style={{ margin: 0 }}>
            So siehst du auf einen Blick, was sich wirklich lohnt – nach Supermarkt, Kategorie und Unterkategorie geordnet und leicht verstaendlich dargestellt.
          </p>
        </div>
      </div>
    </SectionCard>
  )
}

function RetailerSelectorBlock({ retailers, selectedRetailers, onToggleRetailer, loading }) {
  return (
    <SectionCard style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'grid', gap: '0.95rem', padding: '1.1rem 1.1rem 1.15rem' }}>
        <div style={{ display: 'grid', gap: '0.2rem' }}>
          <p className="eyebrow" style={{ margin: 0 }}>1. Supermaerkte waehlen</p>
          <h2 style={{ margin: 0 }}>Welche Haendler moechtest du beruecksichtigen?</h2>
          <p style={{ margin: 0, opacity: 0.82 }}>
            Alle gepflegten Haendler bleiben immer sichtbar. Die Zahl daneben ist nur eine kurze Orientierung.
          </p>
        </div>

        {loading ? (
          <p className="status" style={{ marginBottom: 0 }}>Supermaerkte werden geladen...</p>
        ) : (
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
                  {retailer.activeOffers > 0 ? `(${retailer.activeOffers} aktuell)` : '(aktuell keine Treffer)'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function CategorySelectorBlock({
  categories,
  selectedCategoryTokens,
  expandedMainKeys,
  onToggleMainCategory,
  onToggleSubcategory,
  onToggleExpanded,
  loading,
  disabled,
}) {
  return (
    <SectionCard style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'grid', gap: '0.95rem', padding: '1.1rem 1.1rem 1.15rem' }}>
        <div style={{ display: 'grid', gap: '0.2rem' }}>
          <p className="eyebrow" style={{ margin: 0 }}>2. Kategorien waehlen</p>
          <h2 style={{ margin: 0 }}>Was moechtest du heute guenstiger einkaufen?</h2>
          <p style={{ margin: 0, opacity: 0.82 }}>
            Waehle zuerst grobe Bereiche. Wenn du genauer suchen willst, oeffne die Unterkategorien.
          </p>
        </div>

        {disabled ? (
          <p className="status" style={{ marginBottom: 0 }}>Waehle zuerst mindestens einen Supermarkt.</p>
        ) : loading ? (
          <p className="status" style={{ marginBottom: 0 }}>Kategorien werden geladen...</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.8rem' }}>
            {(categories || []).map((group) => {
              const selectionState = getGroupSelectionState(group, selectedCategoryTokens)
              const isMainSelected = selectionState.mainSelected
              const isPartiallySelected = selectionState.partialSelected
              const isExpanded = expandedMainKeys.includes(group.mainCategoryKey) || isMainSelected || selectionState.selectedSubcategoryKeys.length > 0

              return (
                <div
                  key={group.mainCategoryKey}
                  style={{
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '18px',
                    padding: '0.9rem 0.95rem',
                    background: 'rgba(255,255,255,0.025)',
                    display: 'grid',
                    gap: '0.8rem',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      gap: '0.65rem',
                      alignItems: 'center',
                    }}
                  >
                    <button
                      type="button"
                      className={`chip ${isMainSelected ? 'chip--active' : isPartiallySelected ? 'chip--partial' : ''}`}
                      onClick={() => onToggleMainCategory(group)}
                      style={{ justifySelf: 'start' }}
                    >
                      {group.mainCategoryLabel} ({group.offerCount})
                    </button>

                    <button
                      type="button"
                      className="ghost-button ghost-button--small"
                      onClick={() => onToggleExpanded(group.mainCategoryKey)}
                    >
                      {isExpanded ? 'Unterkategorien verbergen' : `Unterkategorien zeigen (${group.subcategories.length})`}
                    </button>
                  </div>

                  {isExpanded ? (
                    <div
                      style={{
                        display: 'grid',
                        gap: '0.65rem',
                      }}
                    >
                      <div
                        className="chip-grid chip-grid--subcategories"
                        style={{
                          maxHeight: '220px',
                          overflowY: 'auto',
                          paddingRight: '0.2rem',
                        }}
                      >
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
      <div style={{ display: 'grid', gap: '0.95rem', padding: '1.1rem 1.1rem 1.15rem' }}>
        <div style={{ display: 'grid', gap: '0.2rem' }}>
          <p className="eyebrow" style={{ margin: 0 }}>3. Suche starten</p>
          <h2 style={{ margin: 0 }}>Jetzt Angebote laden</h2>
          <p style={{ margin: 0, opacity: 0.82 }}>
            Mit Klick auf „Los“ werden die Angebote nach deiner Auswahl geladen. Mit „Reset“ loeschst du alle Filter und startest neu.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.7rem',
          }}
        >
          <div
            style={{
              padding: '0.85rem 0.95rem',
              borderRadius: '16px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <strong style={{ display: 'block', marginBottom: '0.2rem' }}>Supermaerkte</strong>
            <span style={{ opacity: 0.8 }}>{selectedRetailerCount > 0 ? `${selectedRetailerCount} ausgewaehlt` : 'Keine Auswahl'}</span>
          </div>

          <div
            style={{
              padding: '0.85rem 0.95rem',
              borderRadius: '16px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <strong style={{ display: 'block', marginBottom: '0.2rem' }}>Kategorien / Unterkategorien</strong>
            <span style={{ opacity: 0.8 }}>{selectedCategoryCount > 0 ? `${selectedCategoryCount} ausgewaehlt` : 'Keine Auswahl'}</span>
          </div>

          <div
            style={{
              padding: '0.85rem 0.95rem',
              borderRadius: '16px',
              background: hasPendingChanges ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <strong style={{ display: 'block', marginBottom: '0.2rem' }}>Status</strong>
            <span style={{ opacity: 0.8 }}>{hasPendingChanges ? 'Neue Auswahl bereit zum Starten' : 'Aktuelle Auswahl bereits geladen'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ghost-button chip--active"
            onClick={onApplySearch}
            disabled={!canSearch || searching}
            style={!canSearch || searching ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
          >
            {searching ? 'Wir suchen gerade ...' : 'Angebote zeigen'}
          </button>

          <button type="button" className="ghost-button" onClick={onReset}>
            Auswahl zuruecksetzen
          </button>
        </div>
      </div>
    </SectionCard>
  )
}

function ResultsBlock({ rankingLoading, hasAppliedRetailerScope, visibleOfferCount, offers }) {
  return (
    <SectionCard>
      <div style={{ display: 'grid', gap: '1rem', padding: '1.1rem 1.1rem 1.15rem' }}>
        <div className="panel__header" style={{ marginBottom: 0 }}>
          <h2>Ergebnisse</h2>
          <p>Sortiert von der groessten Ersparnis zur kleinsten.</p>
        </div>

        {!hasAppliedRetailerScope ? (
          <p className="status" style={{ marginBottom: 0 }}>
            Noch keine Suche gestartet. Waehle zuerst deine Filter und klicke dann auf „Los“.
          </p>
        ) : rankingLoading ? (
          <div style={{ display: 'grid', gap: '0.8rem' }}>
            <p className="status" style={{ marginBottom: 0 }}>Moment, wir suchen gerade die besten Angebote fuer dich ...</p>
            <div
              style={{
                display: 'grid',
                gap: '0.75rem',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              }}
            >
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  style={{
                    minHeight: '140px',
                    borderRadius: '18px',
                    border: '1px solid rgba(255,255,255,0.06)',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015))',
                  }}
                />
              ))}
            </div>
          </div>
        ) : visibleOfferCount === 0 ? (
          <div style={{ display: 'grid', gap: '0.55rem' }}>
            <p className="status" style={{ marginBottom: 0 }}>
              Keine passenden Angebote gefunden.
            </p>
            <p style={{ margin: 0, opacity: 0.82 }}>
              Aendere deine Supermaerkte oder Kategorien und starte die Suche erneut.
            </p>
          </div>
        ) : (
          <>
            <p style={{ margin: 0, opacity: 0.82 }}>{visibleOfferCount} Angebote gefunden.</p>

            <div className="user-results" style={{ display: 'grid', gap: '0.85rem' }}>
              {offers.map((offer, index) => (
                <article className={`user-card ${index === 0 ? 'user-card--best' : ''}`} key={offer.id}>
                  <ProductImage offerId={offer.id} src={offer.imageUrl} alt={offer.title} />

                  <div className="user-card__content">
                    <div className="user-card__top">
                      <div>
                        <div className="user-card__eyebrow">
                          <span>Rang {index + 1}</span>
                          <span>{offer.retailerName}</span>
                          <span>{getOfferCategoryLabel(offer)}</span>
                          {offer.customerProgramRequired ? <span>nur mit Kundenkarte/App</span> : <span>ohne Kundenkarte/App</span>}
                        </div>
                        <h3>{offer.title}</h3>
                      </div>

                      <div className="user-card__price">
                        {offer.conditionsText ? <span className="user-card__price-condition">{offer.conditionsText}</span> : null}
                        <strong>{offer.priceCurrent?.amount} {offer.priceCurrent?.currency}</strong>
                        <span>{offer.normalizedUnitPrice?.amount}/{offer.normalizedUnitPrice?.unit}</span>
                      </div>
                    </div>

                    <div className="user-card__facts">
                      <span>Menge: {offer.quantityText || 'nicht erkannt'}</span>
                      <span>Gueltigkeit: {formatValidityLabel(offer)}</span>
                    </div>

                    <div className="user-card__highlights">
                      <div className="highlight-pill highlight-pill--price">
                        <span>Ersparnis</span>
                        <strong>{getSavingsValue(offer) >= 0 ? `${getSavingsValue(offer)} EUR` : 'nicht ableitbar'}</strong>
                      </div>

                      <div className="highlight-pill">
                        <span>Vergleichspreis</span>
                        <strong>{offer.normalizedUnitPrice?.amount}/{offer.normalizedUnitPrice?.unit}</strong>
                      </div>

                      <div className="highlight-pill">
                        <span>Kategorie</span>
                        <strong>{getOfferCategoryLabel(offer)}</strong>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}

function OfferCardConsumer({ offer, highlightLabel = '' }) {
  const badges = buildOfferBadges(offer)
  const directlyComparable = isOfferDirectlyComparable(offer)
  const savingsValue = getSavingsValue(offer)
  const conditionsSummary = getConditionsSummary(offer)
  const showUnitPrice = shouldDisplayUnitPrice(offer)

  return (
    <article className={`user-card ${directlyComparable ? 'user-card--best' : ''}`}>
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

        <div className="user-card__facts">
          <span>Gueltigkeit: {formatValidityLabel(offer)}</span>
          <span>Menge: {offer.quantityText || 'nicht sicher erkannt'}</span>
        </div>

        <div className="user-card__highlights">
          <div className={`highlight-pill ${directlyComparable ? 'highlight-pill--price' : ''}`}>
            <span>Ersparnis heute</span>
            <strong>{savingsValue >= 0 ? `${savingsValue.toFixed(2)} EUR` : 'nicht sicher erkannt'}</strong>
          </div>

          <div className="highlight-pill">
            <span>Bedingungen</span>
            <strong>{conditionsSummary}</strong>
          </div>

          <div className="highlight-pill">
            <span>{showUnitPrice ? 'Einheitspreis' : 'Vergleich'}</span>
            <strong>{showUnitPrice ? formatUnitPrice(offer?.normalizedUnitPrice) : getOfferKindLabel(offer)}</strong>
          </div>
        </div>

        {offer?.conditionsText ? <p className="user-card__condition">{offer.conditionsText}</p> : null}
      </div>
    </article>
  )
}

function ResultsSection({ title, subtitle, offers, highlightPrefix }) {
  if (!offers.length) return null

  return (
    <div style={{ display: 'grid', gap: '0.85rem' }}>
      <div className="panel__header" style={{ marginBottom: 0 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <p>{subtitle}</p>
      </div>

      <div className="user-results" style={{ display: 'grid', gap: '0.85rem' }}>
        {offers.map((offer, index) => (
          <OfferCardConsumer
            key={offer.id}
            offer={offer}
            highlightLabel={`${highlightPrefix} ${index + 1}`}
          />
        ))}
      </div>
    </div>
  )
}

function ResultsBlockConsumer({ rankingLoading, hasAppliedRetailerScope, safeOffers, similarOffers }) {
  const visibleOfferCount = safeOffers.length + similarOffers.length

  return (
    <SectionCard>
      <div style={{ display: 'grid', gap: '1rem', padding: '1.1rem 1.1rem 1.15rem' }}>
        <div className="panel__header" style={{ marginBottom: 0 }}>
          <h2>Ergebnisse</h2>
          <p>Direkt vergleichbare Angebote sind klar von aehnlichen Treffern getrennt.</p>
        </div>

        {!hasAppliedRetailerScope ? (
          <p className="status" style={{ marginBottom: 0 }}>
            Noch keine Suche gestartet. Waehle Haendler und Kategorien und lade dann deine Angebote.
          </p>
        ) : rankingLoading ? (
          <div style={{ display: 'grid', gap: '0.8rem' }}>
            <p className="status" style={{ marginBottom: 0 }}>Moment, wir suchen gerade passende Angebote fuer dich ...</p>
            <div
              style={{
                display: 'grid',
                gap: '0.75rem',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              }}
            >
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  style={{
                    minHeight: '140px',
                    borderRadius: '18px',
                    border: '1px solid rgba(255,255,255,0.06)',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015))',
                  }}
                />
              ))}
            </div>
          </div>
        ) : visibleOfferCount === 0 ? (
          <div style={{ display: 'grid', gap: '0.55rem' }}>
            <p className="status" style={{ marginBottom: 0 }}>
              Aktuell wurden keine passenden Angebote gefunden.
            </p>
            <p style={{ margin: 0, opacity: 0.82 }}>
              Probiere andere Haendler, erweitere Kategorien oder nimm Unterkategorien wieder heraus.
            </p>
          </div>
        ) : (
          <>
            <p style={{ margin: 0, opacity: 0.82 }}>
              {visibleOfferCount} Angebote sichtbar. {safeOffers.length} davon sind direkt vergleichbar.
            </p>

            <ResultsSection
              title="Beste sichere Angebote"
              subtitle="Nur hier behandeln wir Preise als echten Vergleich."
              offers={safeOffers}
              highlightPrefix="Sicherer Treffer"
            />

            <ResultsSection
              title="Aehnliche interessante Angebote"
              subtitle="Relevante Treffer fuer deinen Einkauf, aber nicht als exakter Bestpreis."
              offers={similarOffers}
              highlightPrefix="Aehnliches Angebot"
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
  onToggleDraftRetailer,
  onToggleDraftMainCategory,
  onToggleDraftSubcategory,
  onApplySearch,
  onResetAll,
}) {
  const [expandedMainKeys, setExpandedMainKeys] = useState([])
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
  const { bestComparableOffers, similarOffers } = useMemo(() => splitRankingOffers(visibleOffers), [visibleOffers])

  function handleToggleExpanded(mainCategoryKey) {
    setExpandedMainKeys((current) =>
      current.includes(mainCategoryKey)
        ? current.filter((item) => item !== mainCategoryKey)
        : [...current, mainCategoryKey]
    )
  }

  return (
    <>
      <HeroLoaderModal
        open={isInitialBusy}
        label="kaufklug.at laedt Supermaerkte und Kategorien."
      />

      <HeroBlock />

      {error ? (
        <SectionCard style={{ marginBottom: '1rem' }}>
          <div style={{ padding: '1rem 1.1rem' }}>
            <p className="status status--error" style={{ marginBottom: 0 }}>{error}</p>
          </div>
        </SectionCard>
      ) : null}

      <RetailerSelectorBlock
        retailers={retailers}
        selectedRetailers={draftRetailers}
        onToggleRetailer={onToggleDraftRetailer}
        loading={filtersLoading}
      />

      <CategorySelectorBlock
        categories={categories}
        selectedCategoryTokens={draftCategoryLabels}
        expandedMainKeys={expandedMainKeys}
        onToggleMainCategory={onToggleDraftMainCategory}
        onToggleSubcategory={onToggleDraftSubcategory}
        onToggleExpanded={handleToggleExpanded}
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
        similarOffers={similarOffers}
      />
    </>
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
          <p className="eyebrow">kaufklug.at admin diagnostik</p>
          <h1>Aktuelle Crawl-Qualitaet fuer Graz-Umgebung</h1>
          <p className="subtitle">Fruehe Qualitaetsansicht fuer Quellen, Jobs, Rohdaten, Normalisierung und Vergleichsgruppen.</p>
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

      {error ? <p className="status status--error">{error}</p> : null}

      <section className="metrics">
        <article className="metric-card"><span className="metric-card__label">Quellen aktiv</span><strong className="metric-card__value">{summary.sourceCount || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Rohdokumente</span><strong className="metric-card__value">{summary.rawDocumentCount || 0}</strong></article>
        <article className="metric-card metric-card--accent"><span className="metric-card__label">Gespeichert gesamt</span><strong className="metric-card__value">{summary.storedOfferCount || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Aktuell gueltig</span><strong className="metric-card__value">{summary.activeOfferCount || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Pruefung offen</span><strong className="metric-card__value">{summary.offersPendingReview || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Vergleichsbasis</span><strong className="metric-card__value">{comparisons.comparableOfferCount || 0}</strong></article>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Crawl-Essenz</h2>
          <p>Kompakte Zusammenfassung fuer deine Rueckmeldung und spaetere Analyse.</p>
        </div>
        <pre className="essence-box">{essence || 'Noch keine Essenz vorhanden.'}</pre>
        <div className="feedback-box">
          <textarea
            value={feedbackNote}
            onChange={(event) => setFeedbackNote(event.target.value)}
            placeholder="Deine Rueckmeldung zur Crawl-Qualitaet, Luecken oder Auffaelligkeiten..."
          />
          <div className="feedback-box__actions">
            <button
              className="crawl-button"
              onClick={handleSaveFeedback}
              disabled={feedbackState === 'saving' || !feedbackNote.trim()}
            >
              {feedbackState === 'saving' ? 'Feedback wird gespeichert...' : 'Feedback in Mongo speichern'}
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
            <option value="">Kategorie waehlen</option>
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
          {savingKey === rowKey ? 'Speichert...' : 'Bestaetigen'}
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
            <option value="">Kategorie waehlen</option>
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
          {savingKey === rowKey ? 'Speichert...' : 'Bestaetigen'}
        </button>
        <button
          className="ghost-button"
          disabled={savingKey === `${rowKey}:delete`}
          onClick={() => onDelete({ item, note, rowKey: `${rowKey}:delete` })}
        >
          {savingKey === `${rowKey}:delete` ? 'Loescht...' : 'Loeschen'}
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
          <p className="eyebrow">kaufklug.at quality</p>
          <h1>Zuordnungen pruefen und sofort korrigieren</h1>
          <p className="subtitle">
            Primaer pruefst du hier Subkategorie zu Kategorie. Darunter kannst du einzelne Artikel direkt auf die
            richtige Subkategorie setzen. Manuelle Zuordnungen greifen sofort und haben Vorrang vor der Automatik.
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
          <p>Fuer Massenpruefung nach Retailer, Kategorie oder Freitext eingrenzen.</p>
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
            {loading ? 'Laedt...' : 'Ansicht aktualisieren'}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Subkategorie zu Kategorie</h2>
          <p>Das ist die primaere Qualitaetssicht fuer die grobe Fachlogik.</p>
        </div>
        {loading && !snapshot ? <p className="status">Lade Quality-Snapshot...</p> : null}
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
          <p>Nutze diesen Bereich fuer gezielte Einzelkorrekturen bei falsch zugeordneten Artikeln.</p>
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

function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : ''
  const initialPage = pathname.includes('quality')
    ? 'quality'
    : pathname.includes('diagnose') || pathname.includes('diagnostic')
      ? 'diagnostics'
      : 'search'

  const [activePage, setActivePage] = useState(initialPage)
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
  const appliedCategoryQueryLabels = useMemo(
    () => buildSelectedCategoryQueryLabels(appliedSelectedCategoryLabels, categories),
    [appliedSelectedCategoryLabels, categories]
  )

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
        setError(loadError.message || 'Dashboard data could not be loaded.')
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
        setError(rankingError.message || 'Ranking data could not be loaded.')
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

    const nextPath = nextPage === 'quality' ? '/quality' : nextPage === 'diagnostics' ? '/diagnose' : '/'
    window.history.replaceState({}, '', nextPath)
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
      setError(saveError.message || 'Artikel konnte nicht geloescht werden.')
    } finally {
      setQualitySavingKey('')
    }
  }

  const hasPendingChanges =
    !areStringSetsEqual(draftSelectedRetailers, appliedSelectedRetailers) ||
    !areStringSetsEqual(draftSelectedCategoryLabels, appliedSelectedCategoryLabels)

  return (
    <main className="shell">
      <nav className="page-nav" aria-label="Seiten">
        <button
          className={`page-nav__button${activePage === 'search' ? ' page-nav__button--active' : ''}`}
          onClick={() => handleNavigate('search')}
        >
          Suche
        </button>
        <button
          className={`page-nav__button${activePage === 'quality' ? ' page-nav__button--active' : ''}`}
          onClick={() => handleNavigate('quality')}
        >
          Quality
        </button>
        <button
          className={`page-nav__button${activePage === 'diagnostics' ? ' page-nav__button--active' : ''}`}
          onClick={() => handleNavigate('diagnostics')}
        >
          Diagnose
        </button>
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
          onToggleDraftRetailer={handleToggleDraftRetailer}
          onToggleDraftMainCategory={handleToggleDraftMainCategory}
          onToggleDraftSubcategory={handleToggleDraftSubcategory}
          onApplySearch={handleApplySearch}
          onResetAll={handleResetAll}
        />
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
          {loading && !snapshot ? <p className="status">Lade Ansicht...</p> : null}
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
    </main>
  )
}

export default App
