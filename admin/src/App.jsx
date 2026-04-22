import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import './index.css'
import {
  fetchCurrentUserPreferences,
  fetchDashboardSnapshot,
  fetchEssence,
  fetchHealth,
  getOfferImageUrl,
  saveCurrentUserPreferences,
  saveFeedback,
} from './api'

function getApiBase() {
  const envBase =
    (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_API_BASE || import.meta.env?.VITE_API_BASE_URL)) ||
    ''

  const windowBase =
    typeof window !== 'undefined' && typeof window.__SM_API__ === 'string'
      ? window.__SM_API__
      : ''

  const base = envBase || windowBase || '/api'
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
      isActive: item.isActive !== false,
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
    }))
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
      if (left.isActive !== right.isActive) return Number(right.isActive) - Number(left.isActive)
      return right.activeOfferCount - left.activeOfferCount || left.retailerName.localeCompare(right.retailerName, 'de')
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

function buildRetailerSelectionKey(retailerKeys = []) {
  return [...new Set((retailerKeys || []).filter(Boolean))].sort().join('|')
}

function getOfferCategoryLabel(offer) {
  return offer?.displayCategory || offer?.categorySecondary || offer?.categoryPrimary || 'ohne Kategorie'
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
  const selectedSubcategoryKeys = (group.subcategories || [])
    .filter((subcategory) => selectionTokens.includes(buildSubSelectionToken(group.mainCategoryKey, subcategory.subcategoryKey)))
    .map((subcategory) => subcategory.subcategoryKey)

  return {
    mainSelected: selectionTokens.includes(mainToken),
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

    if (selectionState.mainSelected) {
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

function filterAndSortOffers(offers, filters, retailers, categories) {
  if (!filters.selectedRetailers.length) return []

  const selectedRetailers = new Set(filters.selectedRetailers)
  const categoryGroups = categories || []
  const hasCategorySelection = filters.selectedCategoryTokens.length > 0

  const result = (offers || []).filter((offer) => {
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

  return [...result].sort((left, right) => {
    const savingsDiff = getSavingsValue(right) - getSavingsValue(left)
    if (savingsDiff !== 0) return savingsDiff

    const leftPrice = Number(left?.priceCurrent?.amount ?? Number.MAX_SAFE_INTEGER)
    const rightPrice = Number(right?.priceCurrent?.amount ?? Number.MAX_SAFE_INTEGER)
    if (leftPrice !== rightPrice) return leftPrice - rightPrice

    const leftUnit = Number(left?.normalizedUnitPrice?.amount ?? Number.MAX_SAFE_INTEGER)
    const rightUnit = Number(right?.normalizedUnitPrice?.amount ?? Number.MAX_SAFE_INTEGER)
    return leftUnit - rightUnit
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
          <p>{label || 'kaufklug.at laedt Supermaerkte, Kategorien und deine gespeicherten Einstellungen.'}</p>
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

function AppPromoModal({ open, onClose }) {
  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-promo-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3200,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(8, 12, 20, 0.76)',
        backdropFilter: 'blur(10px)',
        padding: '1rem',
      }}
    >
      <div
        className="panel"
        style={{
          width: 'min(96vw, 560px)',
          boxShadow: '0 28px 80px rgba(0,0,0,0.35)',
          borderRadius: '24px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: '1rem',
            padding: '1.25rem 1.25rem 1.35rem',
          }}
        >
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <p className="eyebrow" style={{ margin: 0 }}>kaufklug.at APP</p>
            <h2 id="app-promo-title" style={{ margin: 0 }}>kaufklug.at ist besser als APP.</h2>
            <p style={{ margin: 0, opacity: 0.88 }}>
              hol dir die APP aufs Handy und spare von ueberall.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 220px',
              gap: '1rem',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'grid', gap: '0.45rem' }}>
              <p style={{ margin: 0, opacity: 0.84 }}>
                Bald kannst du hier den QR Code scannen und die App direkt herunterladen.
              </p>
              <p style={{ margin: 0, opacity: 0.74 }}>
                Mit der App wird kaufklug.at noch schneller, direkter und alltagstauglicher.
              </p>
            </div>

            <div
              aria-label="QR Code Platzhalter"
              style={{
                width: '100%',
                aspectRatio: '1 / 1',
                borderRadius: '20px',
                border: '1px dashed rgba(255,255,255,0.24)',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.025))',
                display: 'grid',
                placeItems: 'center',
                textAlign: 'center',
                padding: '1rem',
              }}
            >
              <div style={{ display: 'grid', gap: '0.35rem' }}>
                <strong>QR Code</strong>
                <span style={{ opacity: 0.72 }}>Platzhalter fuer spaeteren Download</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="ghost-button" onClick={onClose}>
              Vielleicht spaeter
            </button>
          </div>
        </div>
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
  const [currentSrc, setCurrentSrc] = useState(primarySrc || src || '')
  const [fallbackTried, setFallbackTried] = useState(false)

  useEffect(() => {
    setCurrentSrc(primarySrc || src || '')
    setFallbackTried(false)
  }, [primarySrc, src])

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
          if (!fallbackTried && src && currentSrc !== src) {
            setFallbackTried(true)
            setCurrentSrc(src)
            return
          }

          setCurrentSrc('')
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
          <h2 style={{ margin: 0 }}>Welche Supermaerkte interessieren dich?</h2>
          <p style={{ margin: 0, opacity: 0.82 }}>
            Du kannst einen oder mehrere Supermaerkte auswaehlen und spaeter jederzeit wieder aendern.
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
                {retailer.retailerName} {retailer.activeOfferCount ? `(${retailer.activeOfferCount})` : ''}
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
          <h2 style={{ margin: 0 }}>Welche Kategorien interessieren dich?</h2>
          <p style={{ margin: 0, opacity: 0.82 }}>
            Waehle Hauptkategorien. Wenn du genauer filtern willst, klappe sie auf und markiere passende Unterkategorien.
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
                      className={`chip ${isMainSelected ? 'chip--active' : ''}`}
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
          <h2 style={{ margin: 0 }}>Jetzt passende Angebote laden</h2>
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
            {searching ? 'Wir suchen gerade ...' : 'Los'}
          </button>

          <button type="button" className="ghost-button" onClick={onReset}>
            Reset
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

function SearchPage({
  retailers,
  categories,
  filtersLoading,
  ranking,
  rankingLoading,
  preferencesLoading,
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
  const isInitialBusy = preferencesLoading || filtersLoading
  const hasAppliedRetailerScope = appliedRetailers.length > 0

  const allOffers = useMemo(() => flattenRankingOffers(ranking), [ranking])

  const resultOffers = useMemo(() => {
    return filterAndSortOffers(
      allOffers,
      {
        selectedRetailers: appliedRetailers,
        selectedCategoryTokens: appliedCategoryLabels,
      },
      retailers || [],
      categories || []
    )
  }, [allOffers, appliedRetailers, appliedCategoryLabels, retailers, categories])

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
        label="kaufklug.at laedt Supermaerkte, Kategorien und deine gespeicherten Einstellungen."
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

      <ResultsBlock
        rankingLoading={rankingLoading}
        hasAppliedRetailerScope={hasAppliedRetailerScope}
        visibleOfferCount={resultOffers.length}
        offers={resultOffers}
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

function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : ''
  const initialPage = pathname.includes('diagnose') || pathname.includes('diagnostic') ? 'diagnostics' : 'search'

  const [activePage] = useState(initialPage)
  const [snapshot, setSnapshot] = useState(null)
  const [health, setHealth] = useState(null)
  const [essence, setEssence] = useState('')
  const [ranking, setRanking] = useState(null)
  const [retailers, setRetailers] = useState([])
  const [categories, setCategories] = useState([])
  const [error, setError] = useState('')
  const [feedbackState, setFeedbackState] = useState('idle')
  const [feedbackNote, setFeedbackNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [filtersLoading, setFiltersLoading] = useState(true)
  const [rankingLoading, setRankingLoading] = useState(false)
  const [draftSelectedRetailers, setDraftSelectedRetailers] = useState([])
  const [draftSelectedCategoryLabels, setDraftSelectedCategoryLabels] = useState([])
  const [appliedSelectedRetailers, setAppliedSelectedRetailers] = useState([])
  const [appliedSelectedCategoryLabels, setAppliedSelectedCategoryLabels] = useState([])
  const [preferencesLoading, setPreferencesLoading] = useState(true)
  const [showAppPromoModal, setShowAppPromoModal] = useState(true)
  const categoryCacheRef = useRef(new Map())
  const rankingCacheRef = useRef(new Map())

  useEffect(() => {
    let active = true

    async function loadPreferences() {
      try {
        setPreferencesLoading(true)
        const preferenceResult = await fetchCurrentUserPreferences()

        if (!active) return

        const prefRetailers = preferenceResult.selectedRetailers || []

        setDraftSelectedRetailers(prefRetailers)
        setAppliedSelectedRetailers(prefRetailers)
      } catch (preferenceError) {
        if (!active) return
        setError(preferenceError.message || 'Nutzerpraeferenzen konnten nicht geladen werden.')
      } finally {
        if (active) setPreferencesLoading(false)
      }
    }

    async function loadFilterMetadata() {
      try {
        setFiltersLoading(true)
        const retailerResult = await fetchFilterRetailers()

        if (!active) return

        setRetailers(retailerResult)
        setError('')
      } catch (filterError) {
        if (!active) return
        setRetailers([])
        setError(filterError.message || 'Filterdaten konnten nicht geladen werden.')
      } finally {
        if (active) setFiltersLoading(false)
      }
    }

    loadPreferences()
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
    let active = true

    async function loadScopedCategories() {
      try {
        const cacheKey = buildRetailerSelectionKey(draftSelectedRetailers)
        const cachedCategories = categoryCacheRef.current.get(cacheKey)

        if (cachedCategories) {
          if (!active) return
          setCategories(cachedCategories)
          setDraftSelectedCategoryLabels((current) => pruneSelectionTokens(current, cachedCategories))
          setAppliedSelectedCategoryLabels((current) => pruneSelectionTokens(current, cachedCategories))
          setError('')
          return
        }

        setFiltersLoading(true)
        const categoryResult = await fetchFilterCategories(draftSelectedRetailers)

        if (!active) return

        const nextCategories = normalizeCategoryDocuments(categoryResult)
        categoryCacheRef.current.set(cacheKey, nextCategories)
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
        const cacheKey = buildRetailerSelectionKey(appliedSelectedRetailers)
        const cachedRanking = rankingCacheRef.current.get(cacheKey)

        if (cachedRanking) {
          if (!active) return
          setRanking(cachedRanking)
          setRankingLoading(false)
          setError('')
          return
        }

        setRankingLoading(true)

        const rankingResult = await fetchOfferRankingDirect({
          categories: '',
          retailers: appliedSelectedRetailers.join(','),
          programRetailers: '',
          unit: 'all',
          q: '',
          limit: 'all',
        })

        if (!active) return

        rankingCacheRef.current.set(cacheKey, rankingResult)
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
  }, [appliedSelectedRetailers])

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

  async function persistUserPreferences(nextRetailers) {
    try {
      await saveCurrentUserPreferences({
        selectedRetailers: nextRetailers,
      })
      setError('')
    } catch (preferenceError) {
      setError(preferenceError.message || 'Nutzerpraeferenzen konnten nicht gespeichert werden.')
    }
  }

  function handleToggleDraftRetailer(retailerKey) {
    setDraftSelectedRetailers((current) => {
      const nextRetailers = current.includes(retailerKey)
        ? current.filter((item) => item !== retailerKey)
        : [...current, retailerKey]

      persistUserPreferences(nextRetailers)
      return nextRetailers
    })
  }

  function handleToggleDraftMainCategory(group) {
    const mainToken = buildMainSelectionToken(group.mainCategoryKey)
    const subcategoryTokens = (group.subcategories || []).map((item) => buildSubSelectionToken(group.mainCategoryKey, item.subcategoryKey))

    setDraftSelectedCategoryLabels((current) => {
      const next = current.filter((token) => token !== mainToken && !subcategoryTokens.includes(token))
      const selectionState = getGroupSelectionState(group, current)

      if (selectionState.mainSelected) {
        return next
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
    persistUserPreferences([])
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

  const hasPendingChanges =
    !areStringSetsEqual(draftSelectedRetailers, appliedSelectedRetailers) ||
    !areStringSetsEqual(draftSelectedCategoryLabels, appliedSelectedCategoryLabels)

  return (
    <main className="shell">
      <AppPromoModal open={showAppPromoModal} onClose={() => setShowAppPromoModal(false)} />

      {activePage === 'search' ? (
        <SearchPage
          retailers={retailers}
          categories={categories}
          filtersLoading={filtersLoading}
          ranking={ranking}
          rankingLoading={rankingLoading}
          preferencesLoading={preferencesLoading}
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
