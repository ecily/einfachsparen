import { useState } from 'react'
import { getOfferImageUrl } from '../../api'

const failedImageSourceCache = new Set()

function asSourceText(value) {
  if (Array.isArray(value)) return value.map(asSourceText).join(' ')
  if (value && typeof value === 'object') return Object.values(value).map(asSourceText).join(' ')
  return String(value || '')
}

function hasOfficialSourceSignal(offer) {
  const sourceText = [
    offer?.sourceType,
    offer?.sourceTypes,
    offer?.source,
    offer?.sources,
    offer?.sourceName,
    offer?.sourceKey,
    offer?.sourceUrl,
    offer?.sourceUrls,
    offer?.evidenceUrls,
  ]
    .map(asSourceText)
    .join(' ')
    .toLowerCase()

  return /\bofficial\b|flyer|flugblatt|prospekt|leaflet|pdf/.test(sourceText)
}

function getPlaceholderCategory(offer) {
  const categoryText = [
    offer?.displayCategory,
    offer?.categoryPrimary,
    offer?.categorySecondary,
    offer?.subcategoryLabel,
    offer?.title,
  ]
    .map(asSourceText)
    .join(' ')
    .toLowerCase()

  if (/getr[aä]nk|bier|wein|saft|wasser|limonade|cola|kaffee/.test(categoryText)) return 'drinks'
  if (/obst|gem[uü]se|frucht|salat|apfel|paradeiser|tomate|erdbeer|kirsche|banane/.test(categoryText)) return 'produce'
  if (/drogerie|k[oö]rper|pflege|hygiene|shampoo|dusche|deo|creme|zahnpasta/.test(categoryText)) return 'care'
  if (/haushalt|wasch|reiniger|papier|k[uü]che|toilettenpapier|sp[uü]l|putz/.test(categoryText)) return 'household'
  if (/tier|katze|hund|futter|snack|dreamies|sheba/.test(categoryText)) return 'pet'
  return 'generic'
}

function getPlaceholderCopy(offer) {
  if (hasOfficialSourceSignal(offer)) {
    return {
      badge: 'Offizielles Angebot',
      label: 'Bild derzeit nicht verfügbar',
      detail: 'Preis und Details stammen aus offizieller Quelle.',
      note: 'Bitte im Markt prüfen.',
    }
  }

  return {
    badge: 'Transparent',
    label: 'Bild derzeit nicht verfügbar',
    detail: 'Wir zeigen lieber kein Bild als ein unsicheres.',
    note: 'Bitte im Markt prüfen.',
  }
}

export function ProductImage({ offerId, src, alt, compact = false, offer = null }) {
  const directSrc = String(src || '').trim()
  const primarySrc = offerId && directSrc ? getOfferImageUrl(offerId) : directSrc
  const [failedSources, setFailedSources] = useState(() => new Set(failedImageSourceCache))
  const imageSources = [primarySrc, directSrc].filter((item, index, items) => item && items.indexOf(item) === index)
  const currentSrc = imageSources.find((item) => !failedSources.has(item)) || ''
  const isOfficialPlaceholder = hasOfficialSourceSignal(offer)
  const placeholderCopy = getPlaceholderCopy(offer)
  const placeholderCategory = getPlaceholderCategory(offer)

  if (!currentSrc) {
    return (
      <div
        className={`product-image product-image--placeholder ${
          isOfficialPlaceholder ? 'product-image--official-placeholder' : 'product-image--generic-placeholder'
        } product-image--placeholder-${placeholderCategory} ${compact ? 'product-image--compact' : ''}`}
        data-placeholder-category={placeholderCategory}
        aria-label={`${placeholderCopy.label}: ${placeholderCopy.detail}`}
        role="img"
      >
        <span className="product-image__placeholder-mark" aria-hidden="true">
          <span className="product-image__placeholder-symbol" />
        </span>
        <span className="product-image__placeholder-copy">
          <small className="product-image__placeholder-badge">{placeholderCopy.badge}</small>
          <strong>{placeholderCopy.label}</strong>
          <small>{placeholderCopy.detail}</small>
          <small className="product-image__placeholder-note">{placeholderCopy.note}</small>
        </span>
      </div>
    )
  }

  return (
    <div className={`product-image ${compact ? 'product-image--compact' : ''}`}>
      <img
        src={currentSrc}
        alt={alt || ''}
        loading="lazy"
        onError={() => {
          failedImageSourceCache.add(currentSrc)
          setFailedSources((current) => new Set(current).add(currentSrc))
        }}
      />
    </div>
  )
}
