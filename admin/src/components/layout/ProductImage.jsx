import { useState } from 'react'
import { getOfferImageUrl } from '../../api'

export function ProductImage({ offerId, src, alt, compact = false }) {
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
