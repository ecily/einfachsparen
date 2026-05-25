import { useMemo, useState } from 'react'
import { fetchJson } from '../../utils/apiBase'
import { formatRetailerName } from '../../utils/retailers'
import {
  getDisplayConditionLabels,
  getOfferStableId,
  getReadableQuantityText,
  normalizeRetailerKey,
  shouldDisplayUnitPrice,
} from '../../utils/offers'
import { formatUnitPrice, formatValidityLabel } from '../../utils/formatting'

const SCHEMA_VERSION = 'offer-feedback-v1'
const UNKNOWN_CATEGORY_VALUE = '__unknown__'

const REASON_OPTIONS = [
  ['price_wrong', 'Preis stimmt nicht'],
  ['condition_wrong', 'Bedingung fehlt oder ist falsch'],
  ['category_wrong', 'Kategorie falsch'],
  ['image_wrong', 'Bild fehlt oder ist falsch'],
  ['expired_or_not_found', 'Angebot nicht mehr gültig / nicht gefunden'],
  ['duplicate', 'Duplikat'],
  ['offer_nonsense', 'Ganzes Angebot wirkt falsch'],
  ['search_result_wrong', 'Passt nicht zur Suche'],
  ['other', 'Sonstiges'],
]

const CONDITION_ISSUE_OPTIONS = [
  ['missing_condition', 'Bedingung fehlt'],
  ['wrong_condition', 'Bedingung ist falsch'],
  ['duplicate_or_conflicting', 'Bedingung ist doppelt/unklar'],
  ['customer_program_missing', 'Preis gilt nur mit Kundenprogramm'],
  ['unclear', 'Unklar'],
  ['other', 'Sonstiges'],
]

const IMAGE_ISSUE_OPTIONS = [
  ['missing_image', 'Bild fehlt'],
  ['wrong_product_image', 'Bild zeigt falsches Produkt'],
  ['broken_image', 'Bild lädt nicht / ist kaputt'],
  ['unclear', 'Unklar'],
  ['other', 'Sonstiges'],
]

const EXPIRED_ISSUE_OPTIONS = [
  ['not_found_in_store', 'Im Markt nicht gefunden'],
  ['expired', 'Aktion abgelaufen'],
  ['not_found_online', 'Online nicht gefunden'],
  ['unclear', 'Unklar'],
  ['other', 'Sonstiges'],
]

const OFFER_NONSENSE_ISSUE_OPTIONS = [
  ['broken_title', 'Titel kaputt'],
  ['incomplete_product_text', 'Produkttext unvollständig'],
  ['nonsensical_product', 'Produkt ergibt keinen Sinn'],
  ['broken_price_or_quantity', 'Preis oder Menge wirkt kaputt'],
  ['wrong_source_merge', 'Vermutlich falsch zusammengeführt'],
  ['unclear', 'Unklar'],
  ['other', 'Sonstiges'],
]

const SEARCH_RESULT_ISSUE_OPTIONS = [
  ['irrelevant_for_query', 'Passt nicht zur Suche'],
  ['substring_false_positive', 'Treffer nur wegen Wortbestandteil'],
  ['brand_name_false_positive', 'Treffer nur wegen Markenname'],
  ['wrong_intent', 'Andere Suchabsicht'],
  ['unclear', 'Unklar'],
  ['other', 'Sonstiges'],
]

function asText(value) {
  return String(value ?? '').trim()
}

function asNullableText(value) {
  const text = asText(value)
  return text || null
}

function asNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function parseDecimal(value) {
  const normalized = asText(value).replace(',', '.').replace(/[^0-9.-]/g, '')
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function priceAmount(value) {
  if (value && typeof value === 'object') {
    return asNumber(value.amount ?? value.value ?? value.price)
  }

  return asNumber(value)
}

function priceCurrency(value) {
  return (value && typeof value === 'object' && value.currency) || 'EUR'
}

function buildPriceSnapshot(value) {
  return {
    amount: priceAmount(value),
    currency: priceCurrency(value),
  }
}

function formatPriceText(value) {
  const amount = priceAmount(value)
  const currency = priceCurrency(value)

  if (!Number.isFinite(amount)) return ''

  return new Intl.NumberFormat('de-AT', {
    style: 'currency',
    currency,
  }).format(amount)
}

function getRetailerLabel(offer) {
  return formatRetailerName(
    offer?.retailerLabel ||
      offer?.retailerName ||
      offer?.providerLabel ||
      offer?.marketLabel ||
      offer?.shopLabel ||
      offer?.retailerKey ||
      ''
  )
}

function getRetailerKey(offer) {
  return asText(offer?.retailerKey || offer?.providerKey || offer?.marketKey || offer?.shopKey) ||
    normalizeRetailerKey(getRetailerLabel(offer))
}

function getPrimaryCategory(offer) {
  return asNullableText(offer?.categoryPrimary || offer?.mainCategoryLabel)
}

function getSecondaryCategory(offer) {
  return asNullableText(offer?.categorySecondary || offer?.displayCategory || offer?.subcategoryLabel)
}

function getSourceTypes(offer) {
  if (Array.isArray(offer?.sourceTypes)) return offer.sourceTypes.map(asText).filter(Boolean)
  if (offer?.sourceType) return [asText(offer.sourceType)].filter(Boolean)
  return []
}

function getVisibleBadges(offer, conditionBadges) {
  const badges = []
  if (offer?.hasKnownSavings) badges.push('Ersparnis bekannt')
  if (offer?.customerProgramRequired) badges.push('Kundenkarte/App')
  if (offer?.isMultiBuy) badges.push('Mehrkauf')
  if (!offer?.imageUrl) badges.push('Bild folgt')
  badges.push(...conditionBadges)
  return [...new Set(badges.map(asText).filter(Boolean))]
}

function getViewportLabel() {
  if (typeof window === 'undefined') return null
  const width = window.innerWidth || 0
  if (width <= 640) return 'mobile'
  if (width <= 1024) return 'tablet'
  return 'desktop'
}

function getCurrentUrl() {
  if (typeof window === 'undefined') return { path: null, url: null }
  return {
    path: window.location.pathname || null,
    url: window.location.href || null,
  }
}

function getAppVersion() {
  return asNullableText(import.meta.env?.VITE_APP_VERSION || import.meta.env?.VITE_BUILD_VERSION)
}

function buildCategoryOptions(categories = [], offer) {
  const options = []
  const seen = new Set()

  function addOption(primary, secondary = '') {
    const safePrimary = asText(primary)
    const safeSecondary = asText(secondary)
    if (!safePrimary && !safeSecondary) return

    const key = `${safePrimary}::${safeSecondary}`
    if (seen.has(key)) return
    seen.add(key)
    options.push({
      value: key,
      label: safeSecondary ? `${safePrimary} / ${safeSecondary}` : safePrimary,
      primary: safePrimary,
      secondary: safeSecondary,
    })
  }

  for (const group of categories || []) {
    addOption(group?.mainCategoryLabel, '')
    for (const subcategory of group?.subcategories || []) {
      addOption(group?.mainCategoryLabel, subcategory?.subcategoryLabel)
    }
  }

  addOption(getPrimaryCategory(offer), getSecondaryCategory(offer))

  if (!options.length) {
    addOption('Lebensmittel', '')
    addOption('Getränke', '')
    addOption('Drogerie / Hygiene', '')
    addOption('Haushalt', '')
  }

  return options
}

function findCategoryOption(options, value) {
  return options.find((option) => option.value === value) || null
}

function buildOfferSnapshot(offer, visibleConditions) {
  const currentPrice = offer?.priceCurrent ?? offer?.price
  const originalPrice = offer?.priceOriginal ?? offer?.priceReference ?? offer?.referencePrice?.amount
  const normalizedUnitPrice = offer?.normalizedUnitPrice || {}
  const quantity = getReadableQuantityText(offer) || offer?.quantityText || offer?.quantity || ''
  const conditionBadges = visibleConditions
  const sourceTypes = getSourceTypes(offer)

  return {
    title: asText(offer?.title || offer?.displayTitle || offer?.rawTitle),
    brand: asNullableText(offer?.brand || offer?.brandName),
    rawTitle: asNullableText(offer?.rawTitle),
    displayTitle: asNullableText(offer?.displayTitle || offer?.title),
    retailerKey: getRetailerKey(offer),
    retailerLabel: getRetailerLabel(offer),
    retailerStoreType: asNullableText(offer?.retailerStoreType || offer?.storeType),
    priceCurrent: buildPriceSnapshot(currentPrice),
    priceOriginal: buildPriceSnapshot(originalPrice),
    savingsPercent: asNumber(offer?.savings?.percent ?? offer?.savingsPercent),
    savingsAmount: asNumber(offer?.savings?.amount ?? offer?.savingsAmount ?? offer?.priceSavings?.amount),
    quantity: asNullableText(quantity),
    normalizedUnitPrice: {
      amount: asNumber(normalizedUnitPrice?.amount),
      unit: asNullableText(normalizedUnitPrice?.unit || offer?.comparableUnit),
      comparable: shouldDisplayUnitPrice(offer) ? true : null,
    },
    categoryPrimary: getPrimaryCategory(offer),
    categorySecondary: getSecondaryCategory(offer),
    conditionsText: asNullableText(conditionBadges.join(' / ') || offer?.conditionsText),
    conditionBadges,
    customerProgramRequired: typeof offer?.customerProgramRequired === 'boolean' ? offer.customerProgramRequired : null,
    validityText: asNullableText(formatValidityLabel(offer) || offer?.validityText),
    validFrom: asNullableText(offer?.validFrom),
    validTo: asNullableText(offer?.validTo),
    imagePresent: Boolean(offer?.imageUrl),
    imageUrlPresent: Boolean(offer?.imageUrl),
    sourceType: asNullableText(offer?.sourceType),
    sourceTypes,
    sourceName: asNullableText(offer?.sourceName || offer?.providerName),
    sourceUrl: asNullableText(offer?.sourceUrl || offer?.url),
    visibleBadges: getVisibleBadges(offer, conditionBadges),
  }
}

function buildOfferRef(offer) {
  return {
    offerId: asText(offer?.id || offer?._id || ''),
    stableId: asNullableText(offer?.stableId || offer?.offerKey || getOfferStableId(offer)),
    sourceId: asNullableText(offer?.sourceId),
    dedupeKey: asNullableText(offer?.dedupeKey),
  }
}

function buildPageContext(baseContext = {}) {
  const urlContext = getCurrentUrl()

  return {
    path: urlContext.path,
    url: urlContext.url,
    routeName: asNullableText(baseContext.routeName || 'offers-ranking'),
    query: asNullableText(baseContext.query),
    activeRetailers: Array.isArray(baseContext.activeRetailers) ? baseContext.activeRetailers : [],
    activeCategories: Array.isArray(baseContext.activeCategories) ? baseContext.activeCategories : [],
    activeFilters: baseContext.activeFilters || {},
    programRetailers: Array.isArray(baseContext.programRetailers) ? baseContext.programRetailers : [],
    onlyWithoutProgram: typeof baseContext.onlyWithoutProgram === 'boolean' ? baseContext.onlyWithoutProgram : false,
    sortMode: asNullableText(baseContext.sortMode),
    resultPosition: Number.isInteger(baseContext.resultPosition) ? baseContext.resultPosition : null,
    viewport: getViewportLabel(),
  }
}

function buildClientContext() {
  return {
    feedbackSource: 'web_offer_card',
    uiComponent: 'OfferCardConsumer',
    schemaVersion: SCHEMA_VERSION,
    submittedAtClient: new Date().toISOString(),
    appVersion: getAppVersion(),
  }
}

function toggleValue(values, value) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function DetailCheckboxGroup({ label, options, values, onChange }) {
  return (
    <fieldset className="offer-feedback__fieldset">
      <legend>{label}</legend>
      <div className="offer-feedback__option-grid">
        {options.map(([value, optionLabel]) => (
          <label className="offer-feedback__check" key={value}>
            <input
              type="checkbox"
              checked={values.includes(value)}
              onChange={() => onChange(toggleValue(values, value))}
            />
            <span>{optionLabel}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function CategorySelect({ label, value, options, onChange }) {
  return (
    <label className="offer-feedback__field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={UNKNOWN_CATEGORY_VALUE}>Weiß nicht</option>
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function TextField({ label, value, onChange, placeholder = '' }) {
  return (
    <label className="offer-feedback__field">
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function TextArea({ label, value, onChange, placeholder = '' }) {
  return (
    <label className="offer-feedback__field offer-feedback__field--wide">
      <span>{label}</span>
      <textarea
        value={value}
        rows={3}
        maxLength={700}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function createInitialDetails() {
  return {
    category_wrong: {
      suggestedCategoryValue: UNKNOWN_CATEGORY_VALUE,
      userNote: '',
    },
    price_wrong: {
      seenPriceText: '',
      seenWhere: '',
      userNote: '',
    },
    condition_wrong: {
      issueTypes: [],
      conditionText: '',
      userNote: '',
    },
    image_wrong: {
      issueTypes: [],
      userNote: '',
    },
    expired_or_not_found: {
      issueTypes: [],
      checkedWhere: '',
      userNote: '',
    },
    duplicate: {
      duplicateOfferId: '',
      duplicateVisibleTitle: '',
      duplicateReason: '',
      userNote: '',
    },
    offer_nonsense: {
      issueTypes: [],
      userNote: '',
    },
    search_result_wrong: {
      issueTypes: [],
      expectedProductType: '',
      expectedCategoryValue: UNKNOWN_CATEGORY_VALUE,
      userNote: '',
    },
    other: {
      userNote: '',
    },
  }
}

function buildOfferFeedbackPayload({ offer, reasons, details, categoryOptions, pageContext, generalNote }) {
  const visibleConditions = getDisplayConditionLabels(offer)
  const snapshot = buildOfferSnapshot(offer, visibleConditions)
  const structuredDetails = {}

  if (reasons.includes('category_wrong')) {
    const categoryDetails = details.category_wrong || {}
    const selectedCategory = findCategoryOption(categoryOptions, categoryDetails.suggestedCategoryValue)
    structuredDetails.category_wrong = {
      currentCategoryPrimary: getPrimaryCategory(offer),
      currentCategorySecondary: getSecondaryCategory(offer),
      suggestedCategoryPrimary: selectedCategory?.primary || null,
      suggestedCategorySecondary: selectedCategory?.secondary || null,
      suggestedCategoryUnknown: !selectedCategory,
      userNote: asNullableText(categoryDetails.userNote),
    }
  }

  if (reasons.includes('price_wrong')) {
    const priceDetails = details.price_wrong || {}
    const priceNote = [priceDetails.seenWhere ? `Gesehen bei: ${priceDetails.seenWhere}` : '', priceDetails.userNote]
      .map(asText)
      .filter(Boolean)
      .join(' / ')

    structuredDetails.price_wrong = {
      visiblePrice: formatPriceText(offer?.priceCurrent ?? offer?.price),
      seenPrice: parseDecimal(priceDetails.seenPriceText),
      seenPriceText: asNullableText(priceDetails.seenPriceText),
      userNote: asNullableText(priceNote),
    }
  }

  if (reasons.includes('condition_wrong')) {
    const conditionDetails = details.condition_wrong || {}
    structuredDetails.condition_wrong = {
      visibleConditions,
      issueTypes: conditionDetails.issueTypes || [],
      userExpectedConditionText: asNullableText(conditionDetails.conditionText),
      userSawDifferentCondition: asNullableText(conditionDetails.conditionText),
      userNote: asNullableText(conditionDetails.userNote),
    }
  }

  if (reasons.includes('image_wrong')) {
    const imageDetails = details.image_wrong || {}
    structuredDetails.image_wrong = {
      issueTypes: imageDetails.issueTypes || [],
      userNote: asNullableText(imageDetails.userNote),
    }
  }

  if (reasons.includes('expired_or_not_found')) {
    const expiredDetails = details.expired_or_not_found || {}
    structuredDetails.expired_or_not_found = {
      issueTypes: expiredDetails.issueTypes || [],
      checkedWhere: asNullableText(expiredDetails.checkedWhere),
      userNote: asNullableText(expiredDetails.userNote),
    }
  }

  if (reasons.includes('duplicate')) {
    const duplicateDetails = details.duplicate || {}
    structuredDetails.duplicate = {
      duplicateOfferId: asNullableText(duplicateDetails.duplicateOfferId),
      duplicateVisibleTitle: asNullableText(duplicateDetails.duplicateVisibleTitle),
      duplicateReason: asNullableText(duplicateDetails.duplicateReason),
      userNote: asNullableText(duplicateDetails.userNote),
    }
  }

  if (reasons.includes('offer_nonsense')) {
    const nonsenseDetails = details.offer_nonsense || {}
    structuredDetails.offer_nonsense = {
      issueTypes: nonsenseDetails.issueTypes || [],
      userNote: asNullableText(nonsenseDetails.userNote),
    }
  }

  if (reasons.includes('search_result_wrong')) {
    const searchDetails = details.search_result_wrong || {}
    const expectedCategory = findCategoryOption(categoryOptions, searchDetails.expectedCategoryValue)
    structuredDetails.search_result_wrong = {
      query: asNullableText(pageContext?.query),
      visibleTitle: asNullableText(offer?.title || offer?.displayTitle),
      currentCategoryPrimary: getPrimaryCategory(offer),
      currentCategorySecondary: getSecondaryCategory(offer),
      expectedProductType: asNullableText(searchDetails.expectedProductType),
      expectedCategoryPrimary: expectedCategory?.primary || null,
      expectedCategorySecondary: expectedCategory?.secondary || null,
      issueTypes: searchDetails.issueTypes || [],
      userNote: asNullableText(searchDetails.userNote),
    }
  }

  if (reasons.includes('other')) {
    structuredDetails.other = {
      userNote: asNullableText(details.other?.userNote || generalNote),
    }
  }

  return {
    reasons,
    offerRef: buildOfferRef(offer),
    offerSnapshot: snapshot,
    pageContext: buildPageContext(pageContext),
    structuredDetails,
    freeText: asNullableText(generalNote),
    clientContext: buildClientContext(),
  }
}

export function OfferFeedbackPanel({ offer, categories = [], pageContext = {} }) {
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [reasons, setReasons] = useState([])
  const [details, setDetails] = useState(() => createInitialDetails())
  const [generalNote, setGeneralNote] = useState('')
  const visibleConditions = useMemo(() => getDisplayConditionLabels(offer), [offer])
  const categoryOptions = useMemo(() => buildCategoryOptions(categories, offer), [categories, offer])
  const visiblePrice = formatPriceText(offer?.priceCurrent ?? offer?.price)
  const unitPrice = shouldDisplayUnitPrice(offer) ? formatUnitPrice(offer?.normalizedUnitPrice) : ''

  function updateDetails(reason, patch) {
    setDetails((current) => ({
      ...current,
      [reason]: {
        ...current[reason],
        ...patch,
      },
    }))
  }

  function handleToggleReason(reason) {
    const addingReason = !reasons.includes(reason)
    if (addingReason && reason === 'image_wrong' && !offer?.imageUrl && details.image_wrong.issueTypes.length === 0) {
      updateDetails('image_wrong', { issueTypes: ['missing_image'] })
    }

    setReasons((current) => toggleValue(current, reason))
    setError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!reasons.length || saving) return

    try {
      setSaving(true)
      setError('')
      const payload = buildOfferFeedbackPayload({
        offer,
        reasons,
        details,
        categoryOptions,
        pageContext,
        generalNote,
      })

      await fetchJson('/offer-feedback', {
        method: 'POST',
        body: payload,
      })

      setSubmitted(true)
      setOpen(false)
    } catch (submitError) {
      const status = Number(submitError?.status || 0)
      if (status === 429) {
        setError('Danke für deine Hinweise. Bitte warte kurz, bevor du noch eine Meldung sendest.')
      } else if (status >= 500) {
        setError('Dein Hinweis konnte gerade nicht gespeichert werden. Bitte versuche es später erneut.')
      } else {
        setError('Dein Hinweis konnte nicht gespeichert werden. Bitte prüfe die Auswahl und versuche es erneut.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="offer-feedback">
      <button
        type="button"
        className={`offer-feedback__cta${submitted ? ' offer-feedback__cta--submitted' : ''}`}
        onClick={() => {
          if (!submitted) setOpen((current) => !current)
        }}
        aria-expanded={open}
        disabled={submitted}
      >
        {submitted ? (
          <>
            <span>Gemeldet</span>
            <small>Danke!</small>
          </>
        ) : (
          <span>Fehler melden</span>
        )}
      </button>

      {open ? (
        <form className="offer-feedback__panel" onSubmit={handleSubmit}>
          <div className="offer-feedback__header">
            <div>
              <h4>Was stimmt bei diesem Angebot nicht?</h4>
              <p>Dein Hinweis hilft uns, kaufklug in der Beta zu verbessern.</p>
            </div>
            <button type="button" className="offer-feedback__close" onClick={() => setOpen(false)} aria-label="Schließen">
              x
            </button>
          </div>

          <fieldset className="offer-feedback__fieldset">
            <legend>Fehlerarten</legend>
            <div className="offer-feedback__reason-grid">
              {REASON_OPTIONS.map(([reason, label]) => (
                <label className="offer-feedback__check offer-feedback__check--reason" key={reason}>
                  <input
                    type="checkbox"
                    checked={reasons.includes(reason)}
                    onChange={() => handleToggleReason(reason)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {reasons.includes('category_wrong') ? (
            <div className="offer-feedback__detail-block">
              <p className="offer-feedback__current">
                Aktuell: {[getPrimaryCategory(offer), getSecondaryCategory(offer)].filter(Boolean).join(' / ') || 'nicht erkannt'}
              </p>
              <CategorySelect
                label="Welche Kategorie wäre richtig?"
                value={details.category_wrong.suggestedCategoryValue}
                options={categoryOptions}
                onChange={(value) => updateDetails('category_wrong', { suggestedCategoryValue: value })}
              />
              <TextArea
                label="Hinweis zur Kategorie"
                value={details.category_wrong.userNote}
                onChange={(value) => updateDetails('category_wrong', { userNote: value })}
              />
            </div>
          ) : null}

          {reasons.includes('price_wrong') ? (
            <div className="offer-feedback__detail-block">
              {visiblePrice ? <p className="offer-feedback__current">Sichtbarer Preis: {visiblePrice}</p> : null}
              {unitPrice ? <p className="offer-feedback__current">Vergleichspreis: {unitPrice}</p> : null}
              <TextField
                label="Welchen Preis hast du gesehen?"
                value={details.price_wrong.seenPriceText}
                onChange={(value) => updateDetails('price_wrong', { seenPriceText: value })}
                placeholder="z. B. 3,99"
              />
              <TextField
                label="Wo hast du den Preis gesehen?"
                value={details.price_wrong.seenWhere}
                onChange={(value) => updateDetails('price_wrong', { seenWhere: value })}
                placeholder="z. B. im Markt, Prospekt, online"
              />
              <TextArea
                label="Hinweis zum Preis"
                value={details.price_wrong.userNote}
                onChange={(value) => updateDetails('price_wrong', { userNote: value })}
              />
            </div>
          ) : null}

          {reasons.includes('condition_wrong') ? (
            <div className="offer-feedback__detail-block">
              {visibleConditions.length ? (
                <p className="offer-feedback__current">Sichtbar: {visibleConditions.join(' / ')}</p>
              ) : (
                <p className="offer-feedback__current">Sichtbar: keine Bedingung erkannt</p>
              )}
              <DetailCheckboxGroup
                label="Was ist mit der Bedingung?"
                options={CONDITION_ISSUE_OPTIONS}
                values={details.condition_wrong.issueTypes}
                onChange={(issueTypes) => updateDetails('condition_wrong', { issueTypes })}
              />
              <TextArea
                label="Welche Kondition hast du gesehen oder erwartet?"
                value={details.condition_wrong.conditionText}
                onChange={(value) => updateDetails('condition_wrong', { conditionText: value })}
              />
            </div>
          ) : null}

          {reasons.includes('image_wrong') ? (
            <div className="offer-feedback__detail-block">
              <DetailCheckboxGroup
                label="Was stimmt mit dem Bild nicht?"
                options={IMAGE_ISSUE_OPTIONS}
                values={details.image_wrong.issueTypes}
                onChange={(issueTypes) => updateDetails('image_wrong', { issueTypes })}
              />
              <TextArea
                label="Hinweis zum Bild"
                value={details.image_wrong.userNote}
                onChange={(value) => updateDetails('image_wrong', { userNote: value })}
              />
            </div>
          ) : null}

          {reasons.includes('expired_or_not_found') ? (
            <div className="offer-feedback__detail-block">
              <DetailCheckboxGroup
                label="Was hast du geprüft?"
                options={EXPIRED_ISSUE_OPTIONS}
                values={details.expired_or_not_found.issueTypes}
                onChange={(issueTypes) => updateDetails('expired_or_not_found', { issueTypes })}
              />
              <TextField
                label="Wo hast du geprüft?"
                value={details.expired_or_not_found.checkedWhere}
                onChange={(value) => updateDetails('expired_or_not_found', { checkedWhere: value })}
              />
              <TextArea
                label="Hinweis zur Gültigkeit"
                value={details.expired_or_not_found.userNote}
                onChange={(value) => updateDetails('expired_or_not_found', { userNote: value })}
              />
            </div>
          ) : null}

          {reasons.includes('duplicate') ? (
            <div className="offer-feedback__detail-block">
              <TextField
                label="Welches Angebot ist das Duplikat?"
                value={details.duplicate.duplicateVisibleTitle}
                onChange={(value) => updateDetails('duplicate', { duplicateVisibleTitle: value })}
                placeholder="Titel oder sichtbare Beschreibung"
              />
              <TextField
                label="Offer-ID, falls sichtbar"
                value={details.duplicate.duplicateOfferId}
                onChange={(value) => updateDetails('duplicate', { duplicateOfferId: value })}
              />
              <TextArea
                label="Warum ist es ein Duplikat?"
                value={details.duplicate.duplicateReason}
                onChange={(value) => updateDetails('duplicate', { duplicateReason: value })}
              />
            </div>
          ) : null}

          {reasons.includes('offer_nonsense') ? (
            <div className="offer-feedback__detail-block">
              <DetailCheckboxGroup
                label="Was wirkt falsch?"
                options={OFFER_NONSENSE_ISSUE_OPTIONS}
                values={details.offer_nonsense.issueTypes}
                onChange={(issueTypes) => updateDetails('offer_nonsense', { issueTypes })}
              />
              <TextArea
                label="Was wirkt falsch?"
                value={details.offer_nonsense.userNote}
                onChange={(value) => updateDetails('offer_nonsense', { userNote: value })}
              />
            </div>
          ) : null}

          {reasons.includes('search_result_wrong') ? (
            <div className="offer-feedback__detail-block">
              {pageContext?.query ? <p className="offer-feedback__current">Suche: {pageContext.query}</p> : null}
              <DetailCheckboxGroup
                label="Warum passt der Treffer nicht?"
                options={SEARCH_RESULT_ISSUE_OPTIONS}
                values={details.search_result_wrong.issueTypes}
                onChange={(issueTypes) => updateDetails('search_result_wrong', { issueTypes })}
              />
              <TextField
                label="Was hättest du gesucht/erwartet?"
                value={details.search_result_wrong.expectedProductType}
                onChange={(value) => updateDetails('search_result_wrong', { expectedProductType: value })}
              />
              <CategorySelect
                label="Welche Kategorie hätte besser gepasst?"
                value={details.search_result_wrong.expectedCategoryValue}
                options={categoryOptions}
                onChange={(value) => updateDetails('search_result_wrong', { expectedCategoryValue: value })}
              />
              <TextArea
                label="Hinweis zur Suche"
                value={details.search_result_wrong.userNote}
                onChange={(value) => updateDetails('search_result_wrong', { userNote: value })}
              />
            </div>
          ) : null}

          {reasons.includes('other') ? (
            <div className="offer-feedback__detail-block">
              <TextArea
                label="Was möchtest du uns sagen?"
                value={details.other.userNote}
                onChange={(value) => updateDetails('other', { userNote: value })}
              />
            </div>
          ) : null}

          <TextArea
            label="Optionaler allgemeiner Hinweis"
            value={generalNote}
            onChange={setGeneralNote}
            placeholder="Zusätzliche Beobachtung, falls hilfreich"
          />

          {error ? <p className="offer-feedback__error" role="alert">{error}</p> : null}

          <div className="offer-feedback__actions">
            <button type="button" className="offer-feedback__secondary" onClick={() => setOpen(false)}>
              Abbrechen
            </button>
            <button type="submit" className="offer-feedback__submit" disabled={!reasons.length || saving}>
              {saving ? 'Wird gesendet ...' : 'Absenden'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
