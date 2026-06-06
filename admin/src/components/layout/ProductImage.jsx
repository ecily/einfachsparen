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

function getPlaceholderCopy(offer) {
  if (hasOfficialSourceSignal(offer)) {
    return {
      label: 'Offizielles Angebot',
      detail: 'Bild derzeit nicht verfügbar',
    }
  }

  return {
    label: 'Bild derzeit nicht verfügbar',
    detail: 'Preis und Bedingungen prüfen',
  }
}

export function ProductImage({ offerId, src, alt, compact = false, offer = null }) {
  const directSrc = String(src || '').trim()
  const primarySrc = offerId && directSrc ? getOfferImageUrl(offerId) : directSrc
  const [failedSources, setFailedSources] = useState(() => new Set(failedImageSourceCache))
  const imageSources = [primarySrc, directSrc].filter((item, index, items) => item && items.indexOf(item) === index)
  const currentSrc = imageSources.find((item) => !failedSources.has(item)) || ''
  const placeholderCopy = getPlaceholderCopy(offer)

  if (!currentSrc) {
    return (
      <div
        className={`product-image product-image--placeholder ${compact ? 'product-image--compact' : ''}`}
        aria-label={`${placeholderCopy.label}: ${placeholderCopy.detail}`}
        role="img"
      >
        <span className="product-image__placeholder-icon" aria-hidden="true" />
        <span className="product-image__placeholder-copy">
          <strong>{placeholderCopy.label}</strong>
          <small>{placeholderCopy.detail}</small>
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
