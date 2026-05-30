import { useState } from 'react'
import { getOfferImageUrl } from '../../api'

const failedImageSourceCache = new Set()

export function ProductImage({ offerId, src, alt, compact = false }) {
  const directSrc = String(src || '').trim()
  const primarySrc = offerId && directSrc ? getOfferImageUrl(offerId) : directSrc
  const [failedSources, setFailedSources] = useState(() => new Set(failedImageSourceCache))
  const imageSources = [primarySrc, directSrc].filter((item, index, items) => item && items.indexOf(item) === index)
  const currentSrc = imageSources.find((item) => !failedSources.has(item)) || ''

  if (!currentSrc) {
    return (
      <div
        className={`product-image product-image--placeholder ${compact ? 'product-image--compact' : ''}`}
        aria-label="Kein Produktbild verfuegbar"
      >
        <span className="product-image__placeholder-icon" aria-hidden="true" />
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
          failedImageSourceCache.add(currentSrc)
          setFailedSources((current) => new Set(current).add(currentSrc))
        }}
      />
    </div>
  )
}
