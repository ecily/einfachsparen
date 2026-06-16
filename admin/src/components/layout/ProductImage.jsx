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
  if (hasOfficialSourceSignal(offer)) {
    return {
      badge: 'Offiziell',
      label: 'Bild derzeit nicht verf\u00fcgbar',
    }
  }

  return {
    badge: 'Ohne Bild',
    label: 'Bild derzeit nicht verf\u00fcgbar',
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
        aria-label={placeholderCopy.label}
        role="img"
      >
        <span className="product-image__placeholder-mark" aria-hidden="true">
          <span className="product-image__placeholder-symbol" />
        </span>
        <span className="product-image__placeholder-copy">
          <small className="product-image__placeholder-badge">{placeholderCopy.badge}</small>
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
