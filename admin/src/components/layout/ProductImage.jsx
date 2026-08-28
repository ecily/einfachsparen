import { useEffect, useRef, useState } from 'react'
import { getOfferImageUrl } from '../../api'

const failedImageSourceCache = new Set()
const IMAGE_LOAD_ROOT_MARGIN = '200px 0px'

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

function isHoferOffer(offer) {
  const sourceText = [
    offer?.retailerKey,
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

  return /\bhofer\b/.test(sourceText)
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

  if (/bier|radler|maerzen|märzen|pils|stiegl|puntigamer|ottakringer|goesser|gösser/.test(categoryText)) return 'beer'
  if (/kaffee|tee|espresso|cappuccino|melange|bohne/.test(categoryText)) return 'coffee'
  if (/kaese|käse|molkerei|milch|joghurt|topfen|butter|gouda|emmentaler|mozzarella/.test(categoryText)) return 'dairy'
  if (/brot|gebaeck|gebäck|backware|weckerl|semmel|brioche|toast|baguette/.test(categoryText)) return 'bakery'
  if (/fleisch|wurst|fisch|hendl|schwein|rind|lachs|forelle|leberkaese|leberkäse/.test(categoryText)) return 'fresh'
  if (/getraenk|getränk|wein|saft|wasser|limonade|cola/.test(categoryText)) return 'drinks'
  if (/obst|gemuese|gemüse|frucht|salat|apfel|paradeiser|tomate|erdbeer|kirsche|banane/.test(categoryText)) return 'produce'
  if (/drogerie|koerper|körper|pflege|hygiene|shampoo|dusche|deo|creme|zahnpasta/.test(categoryText)) return 'care'
  if (/haushalt|wasch|reiniger|papier|kueche|küche|toilettenpapier|spuel|spül|putz/.test(categoryText)) return 'household'
  if (/tier|katze|hund|futter|snack|dreamies|sheba/.test(categoryText)) return 'pet'
  return 'generic'
}

function getPlaceholderCopy(offer) {
  if (isHoferOffer(offer)) {
    return {
      badge: 'HOFER Angebot',
      label: 'Bild nicht sicher verf\u00fcgbar',
      showLabel: true,
    }
  }

  if (hasOfficialSourceSignal(offer)) {
    return {
      badge: 'Offiziell',
      label: 'Bild derzeit nicht verf\u00fcgbar',
      showLabel: false,
    }
  }

  return {
    badge: 'Ohne Bild',
    label: 'Bild derzeit nicht verf\u00fcgbar',
    showLabel: false,
  }
}

export function ProductImage({ offerId, src, alt, compact = false, offer = null }) {
  const directSrc = String(src || '').trim()
  const primarySrc = offerId && directSrc ? getOfferImageUrl(offerId) : directSrc
  const [failedSources, setFailedSources] = useState(() => new Set(failedImageSourceCache))
  const imageContainerRef = useRef(null)
  const [shouldLoad, setShouldLoad] = useState(() => typeof IntersectionObserver === 'undefined')
  const imageSources = [primarySrc, directSrc].filter((item, index, items) => item && items.indexOf(item) === index)
  const currentSrc = imageSources.find((item) => !failedSources.has(item)) || ''
  const isHofer = isHoferOffer(offer)
  const isOfficialPlaceholder = hasOfficialSourceSignal(offer)
  const placeholderCopy = getPlaceholderCopy(offer)
  const placeholderCategory = isHofer ? 'hofer' : getPlaceholderCategory(offer)

  useEffect(() => {
    if (!currentSrc || shouldLoad) return undefined

    const imageContainer = imageContainerRef.current
    if (!imageContainer) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setShouldLoad(true)
        observer.disconnect()
      },
      { rootMargin: IMAGE_LOAD_ROOT_MARGIN },
    )

    observer.observe(imageContainer)
    return () => observer.disconnect()
  }, [currentSrc, shouldLoad])

  if (!currentSrc) {
    return (
      <div
        className={`product-image product-image--placeholder ${
          isOfficialPlaceholder ? 'product-image--official-placeholder' : 'product-image--generic-placeholder'
        } product-image--placeholder-${placeholderCategory} ${compact ? 'product-image--compact' : ''}`}
        data-placeholder-category={placeholderCategory}
        aria-label={placeholderCopy.label}
        role="img"
      >
        <span className="product-image__placeholder-mark" aria-hidden="true">
          <span className="product-image__placeholder-symbol" />
        </span>
        <span className="product-image__placeholder-copy">
          <small className="product-image__placeholder-badge">{placeholderCopy.badge}</small>
          {placeholderCopy.showLabel ? (
            <small className="product-image__placeholder-label">{placeholderCopy.label}</small>
          ) : null}
        </span>
      </div>
    )
  }

  return (
    <div
      ref={imageContainerRef}
      className={`product-image ${compact ? 'product-image--compact' : ''}`}
      data-image-deferred={shouldLoad ? undefined : 'true'}
    >
      {shouldLoad ? (
        <img
          src={currentSrc}
          alt={alt || ''}
          loading="lazy"
          decoding="async"
          onError={() => {
            failedImageSourceCache.add(currentSrc)
            setFailedSources((current) => new Set(current).add(currentSrc))
          }}
        />
      ) : null}
    </div>
  )
}
