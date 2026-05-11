import { useEffect, useMemo, useState } from 'react'
import { createSharedShoppingList } from '../../api'
import { ProductImage } from '../layout/ProductImage'
import { SectionCard } from '../layout/SectionCard'
import { formatUnitPrice } from '../../utils/formatting'
import { shouldDisplayUnitPrice } from '../../utils/offers'
import { getRetailerTheme } from '../../utils/retailerColors'
import {
  buildShareSnapshot,
  getRetailerGroupSummary,
  getShoppingListItemId,
  getShoppingListItemSavingsInfo,
  getShoppingListSummary,
  groupShoppingListByRetailer,
  loadCheckedShoppingListItems,
  storeCheckedShoppingListItems,
} from '../../utils/shoppingList'

const SHOPPING_LIST_QUANTITY_STORAGE_KEY = 'kaufklug.shoppingList.quantities.v1'

function formatPrice(amount, currency = 'EUR') {
  const numericAmount = Number(amount)

  if (!Number.isFinite(numericAmount)) {
    return 'Preis offen'
  }

  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency || 'EUR',
  }).format(numericAmount)
}

function formatShortDate(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('de-AT', {
    day: '2-digit',
    month: '2-digit',
  }).format(date)
}

function isSameDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function getValidityText(item) {
  const validTo = item?.validTo || item?.validUntil
  const date = validTo ? new Date(validTo) : null

  if (date && !Number.isNaN(date.getTime())) {
    if (isSameDay(date, new Date())) {
      return 'Heute gültig'
    }

    return `Gültig bis ${formatShortDate(date)}`
  }

  return ''
}

function normalizeRetailerName(value) {
  const name = String(value || '').trim()

  if (!name) {
    return 'Markt'
  }

  const knownNames = {
    adeg: 'ADEG',
    billa: 'BILLA',
    'billa plus': 'BILLA PLUS',
    billaplus: 'BILLA PLUS',
    eurospar: 'EUROSPAR',
    hofer: 'HOFER',
    interspar: 'INTERSPAR',
    lidl: 'LIDL',
    spar: 'SPAR',
  }
  const normalized = name.toLowerCase().replace(/[^a-zäöüß]+/g, ' ').trim()

  return knownNames[normalized] || name
}

function getItemCountText(count) {
  return `${count} ${count === 1 ? 'Angebot' : 'Angebote'}`
}

function getArticleCountText(count) {
  return `${count} ${count === 1 ? 'Artikel' : 'Artikel'}`
}

function getQuantityText(item) {
  const rawValue = String(item?.quantityText || '').trim()
  const unknownPattern = new RegExp(['nicht', 'erkannt'].join(' '), 'i')
  const brokenChocolatePattern = new RegExp(`^\\s*${['men', 'ge'].join('')}:\\s*1\\s*ta\\.?\\s*$`, 'i')

  if (!rawValue || unknownPattern.test(rawValue) || brokenChocolatePattern.test(rawValue)) {
    return ''
  }

  const value = rawValue.replace(/^menge:\s*/i, '').replace(/\s+/g, ' ').trim()

  if (!value || unknownPattern.test(value) || /\bta\./i.test(value)) {
    return ''
  }

  return value.replace(/\bst\.?$/i, 'Stück')
}

function getMinimumQuantityText(item) {
  const quantity = Number(
    item?.minimumPurchaseQty ||
      item?.minimumPurchaseQuantity ||
      item?.minQuantity ||
      item?.minimumQuantity ||
      item?.minimumOrderQuantity ||
      0
  )

  if (Number.isFinite(quantity) && quantity > 1) {
    return `Ab ${Math.round(quantity)} Stück`
  }

  return ''
}

function getConditionText(item) {
  const rawText = String(item?.conditionsText || '').trim()
  const lowerText = rawText.toLowerCase()

  if (lowerText.includes('app')) {
    return 'Nur mit App'
  }

  if (item?.customerProgramRequired || lowerText.includes('kundenkarte') || lowerText.includes('jö')) {
    return 'Nur mit Kundenkarte'
  }

  const plusMatch = rawText.match(/\b(\d+)\s*\+\s*(\d+)\b/)
  if (plusMatch) {
    return `${plusMatch[1]}+${plusMatch[2]} gratis`
  }

  const minimumQuantity = getMinimumQuantityText(item)
  if (minimumQuantity) {
    return minimumQuantity
  }

  if (item?.isMultiBuy) {
    return 'Mehrkauf-Angebot'
  }

  return ''
}

function normalizeFactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function buildItemFacts({ conditionText, quantityText, rawConditionText, showUnitPrice, item, validityText }) {
  const facts = []
  const rawCondition = normalizeFactText(rawConditionText)
  const displayCondition = rawCondition || conditionText

  if (quantityText) facts.push({ key: 'quantity', label: quantityText, tone: 'neutral' })
  if (showUnitPrice) facts.push({ key: 'unit-price', label: formatUnitPrice(item.normalizedUnitPrice), tone: 'neutral' })
  if (validityText) facts.push({ key: 'validity', label: validityText, tone: 'date' })
  if (displayCondition) facts.push({ key: 'condition', label: displayCondition, tone: 'condition' })
  const seen = new Set()
  return facts.filter((fact) => {
    const normalized = normalizeFactText(fact.label).toLowerCase()
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function loadStoredQuantities() {
  if (typeof window === 'undefined') return {}

  try {
    const rawValue = window.localStorage.getItem(SHOPPING_LIST_QUANTITY_STORAGE_KEY)
    const parsed = rawValue ? JSON.parse(rawValue) : {}

    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function storeQuantities(quantities) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(SHOPPING_LIST_QUANTITY_STORAGE_KEY, JSON.stringify(quantities))
  } catch {
    // Die Liste bleibt auch ohne lokale Mengenspeicherung nutzbar.
  }
}

function getItemQuantity(quantities, itemId) {
  const quantity = Number(quantities[itemId])

  return Number.isFinite(quantity) && quantity > 0 ? Math.min(Math.round(quantity), 99) : 1
}

function getItemsTotal(items, quantities) {
  return (items || []).reduce((sum, item) => {
    const price = Number(item?.priceCurrent?.amount)

    if (!Number.isFinite(price)) {
      return sum
    }

    return sum + price * getItemQuantity(quantities, getShoppingListItemId(item))
  }, 0)
}

function getKnownSavingsTotal(items, quantities) {
  return (items || []).reduce((sum, item) => {
    const savings = getShoppingListItemSavingsInfo(item)

    return savings.type === 'known' ? sum + savings.amount * getItemQuantity(quantities, getShoppingListItemId(item)) : sum
  }, 0)
}

function getApproximateSavingsCount(items = []) {
  return (items || []).filter((item) => {
    const savings = getShoppingListItemSavingsInfo(item)
    return savings.type === 'known' && savings.isApproximate
  }).length
}

function getRetailerDistribution(groups = []) {
  return groups.map((group) => ({
    label: normalizeRetailerName(group.retailerName),
    count: group.items.length,
    theme: getRetailerTheme(group.retailerKey || group.retailerName),
  }))
}

function getSavingsDisplayLabel({ approximateCount, knownSavingsTotal }) {
  if (knownSavingsTotal <= 0) {
    return 'Noch keine bekannte Ersparnis'
  }

  return approximateCount > 0 ? 'Bekannte Ersparnis ca.' : 'Bekannte Ersparnis'
}

function getMarketSummaryText({ groupSummary, knownSavingsTotal, approximateCount }) {
  const articleText = getArticleCountText(groupSummary.itemCount)

  if (knownSavingsTotal > 0) {
    const savingsLabel = approximateCount > 0 ? 'bekannte Ersparnis ca.' : 'bekannte Ersparnis'
    return `${articleText} · ${savingsLabel} ${formatPrice(knownSavingsTotal)}`
  }

  return `${articleText} · Aktionspreise`
}

function hasKnownCurrentPrice(items = []) {
  return (items || []).some((item) => Number.isFinite(Number(item?.priceCurrent?.amount)))
}

export function ShoppingListPage({ shoppingListItems, onRemoveItem, onClearList, onGoToOffers, onNavigate }) {
  const [checkedItemIds, setCheckedItemIds] = useState(() => loadCheckedShoppingListItems())
  const [hideCompleted, setHideCompleted] = useState(false)
  const [shareState, setShareState] = useState({ status: 'idle', message: '' })
  const [quantities, setQuantities] = useState(() => loadStoredQuantities())
  const [clearConfirmVisible, setClearConfirmVisible] = useState(false)
  const visibleItems = useMemo(
    () => (hideCompleted ? shoppingListItems.filter((item) => !checkedItemIds.has(getShoppingListItemId(item))) : shoppingListItems),
    [checkedItemIds, hideCompleted, shoppingListItems]
  )
  const groupedItems = useMemo(() => groupShoppingListByRetailer(visibleItems), [visibleItems])
  const allGroups = useMemo(() => groupShoppingListByRetailer(shoppingListItems), [shoppingListItems])
  const allRetailerCount = allGroups.length
  const retailerDistribution = useMemo(() => getRetailerDistribution(allGroups), [allGroups])
  const summary = useMemo(() => getShoppingListSummary(shoppingListItems), [shoppingListItems])
  const offerTotal = useMemo(() => getItemsTotal(shoppingListItems, quantities), [quantities, shoppingListItems])
  const knownSavingsTotal = useMemo(() => getKnownSavingsTotal(shoppingListItems, quantities), [quantities, shoppingListItems])
  const canShowOfferTotal = useMemo(() => hasKnownCurrentPrice(shoppingListItems), [shoppingListItems])
  const canShowKnownSavings = summary.knownSavingsCount > 0 && knownSavingsTotal > 0
  const knownSavingsLabel = getSavingsDisplayLabel({
    approximateCount: summary.approximateSavingsCount,
    knownSavingsTotal,
  })
  const hasMissingSavings = summary.knownSavingsCount < shoppingListItems.length

  useEffect(() => {
    storeCheckedShoppingListItems(checkedItemIds)
  }, [checkedItemIds])

  useEffect(() => {
    storeQuantities(quantities)
  }, [quantities])

  function handleToggleItem(itemId) {
    setCheckedItemIds((current) => {
      const next = new Set(current)

      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }

      return next
    })
  }

  function handleQuantityChange(itemId, direction) {
    setQuantities((current) => {
      const currentQuantity = getItemQuantity(current, itemId)
      const nextQuantity = direction === 'increase' ? currentQuantity + 1 : currentQuantity - 1

      return {
        ...current,
        [itemId]: Math.max(1, Math.min(nextQuantity, 99)),
      }
    })
  }

  function handleClearClick() {
    if (!clearConfirmVisible) {
      setClearConfirmVisible(true)
      return
    }

    setClearConfirmVisible(false)
    onClearList()
  }

  async function handleShareList() {
    try {
      setShareState({ status: 'loading', message: '' })
      const result = await createSharedShoppingList(buildShareSnapshot(shoppingListItems))
      const shareUrl = result.url
      const shareText = `Meine kaufklug Einkaufsliste:\n${shareUrl}`

      try {
        await navigator.clipboard.writeText(shareUrl)
      } catch {
        // Teilen funktioniert auch ohne Kopieren.
      }

      if (navigator.share) {
        await navigator.share({
          title: 'kaufklug Einkaufsliste',
          text: shareText,
          url: shareUrl,
        })
        setShareState({ status: 'done', message: 'Link wurde erstellt.' })
        return
      }

      setShareState({ status: 'done', message: 'Link wurde kopiert.' })
    } catch {
      setShareState({
        status: 'error',
        message: 'Die Liste konnte gerade nicht geteilt werden. Bitte prüfe deine Verbindung und versuche es erneut.',
      })
    }
  }

  if (!shoppingListItems.length) {
    return (
      <SectionCard style={{ marginBottom: '1rem' }}>
        <div className="shopping-list-hero shopping-list-hero--empty">
          <p className="eyebrow">Einkaufsliste</p>
          <h1>Noch keine Angebote gemerkt.</h1>
          <p>Suche nach Produkten oder stöbere nach Märkten und füge Angebote deiner Einkaufsliste hinzu.</p>
          <div className="shopping-list-empty-actions">
            <button type="button" className="primary-action-button" onClick={onGoToOffers}>
              Angebote suchen
            </button>
            <button type="button" className="ghost-button" onClick={() => onNavigate?.('search')}>
              Märkte stöbern
            </button>
          </div>
        </div>
      </SectionCard>
    )
  }

  return (
    <>
      <SectionCard style={{ marginBottom: '1rem' }}>
        <div className="shopping-list-hero">
          <div className="shopping-list-hero__topline">
            <p className="eyebrow">Einkaufsliste</p>
            <span>{getItemCountText(shoppingListItems.length)} gemerkt</span>
          </div>
          <h1>Einkaufsliste</h1>
          <p>Deine gemerkten Angebote für den nächsten Einkauf.</p>
        </div>
      </SectionCard>

      <section className="shopping-check" aria-labelledby="shopping-check-title">
        <div className="shopping-check__saving">
          <span id="shopping-check-title">{knownSavingsLabel}</span>
          <strong>{canShowKnownSavings ? formatPrice(knownSavingsTotal) : 'Aktionspreise'}</strong>
          <p>
            {canShowKnownSavings
              ? 'Wir zählen nur Ersparnisse, bei denen ein Vergleichspreis vorliegt.'
              : 'Angebote ohne Vergleichspreis zählen wir nicht zur Ersparnis.'}
          </p>
        </div>

        <div className="shopping-check__facts">
          <span>{getArticleCountText(shoppingListItems.length)}</span>
          <span>
            {allRetailerCount} {allRetailerCount === 1 ? 'Markt' : 'Märkte'}
          </span>
          {summary.knownSavingsCount > 0 ? <span>{summary.knownSavingsCount} mit bekannter Ersparnis</span> : null}
          {canShowOfferTotal ? <span>Aktionspreise ca. {formatPrice(offerTotal)}</span> : null}
        </div>

        {retailerDistribution.length > 0 ? (
          <div className="shopping-check__markets" aria-label="Märkte auf deiner Liste">
            {retailerDistribution.map((retailer) => (
              <span
                key={retailer.label}
                style={{
                  '--retailer-color': retailer.theme.color,
                  '--retailer-border-color': retailer.theme.borderColor,
                  '--retailer-soft-color': retailer.theme.softColor,
                }}
              >
                {retailer.label} · {retailer.count}
              </span>
            ))}
          </div>
        ) : null}

        {canShowKnownSavings || hasMissingSavings ? (
          <p className="shopping-check__soft-note">Angebote ohne Vergleichspreis zählen wir nicht zur Ersparnis.</p>
        ) : null}
        <p className="shopping-check__note">Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen. Keine Preisgarantie.</p>
      </section>

      <div className="shopping-list-actions">
        <button type="button" className="primary-action-button" onClick={onGoToOffers}>
          Weitere Angebote suchen
        </button>
        <button type="button" className="ghost-button" onClick={handleShareList} disabled={shareState.status === 'loading'}>
          {shareState.status === 'loading' ? 'Liste wird geteilt ...' : 'Liste teilen'}
        </button>
        <button type="button" className="ghost-button" onClick={() => setHideCompleted((current) => !current)}>
          {hideCompleted ? 'Erledigte anzeigen' : 'Erledigte ausblenden'}
        </button>
        <button type="button" className="ghost-button ghost-button--danger shopping-list-actions__danger" onClick={handleClearClick}>
          {clearConfirmVisible ? 'Wirklich leeren?' : 'Liste leeren'}
        </button>
      </div>

      {shareState.message ? (
        <p className={`shopping-list-feedback shopping-list-feedback--${shareState.status}`}>{shareState.message}</p>
      ) : null}

      {hideCompleted && visibleItems.length === 0 ? (
        <div className="shopping-list-note">Erledigte Angebote sind ausgeblendet. Du kannst sie jederzeit wieder anzeigen.</div>
      ) : null}

      <div className="shopping-market-groups">
        {groupedItems.map((group) => {
          const groupSummary = getRetailerGroupSummary(group.items)
          const groupKnownSavingsTotal = getKnownSavingsTotal(group.items, quantities)
          const groupApproximateSavingsCount = getApproximateSavingsCount(group.items)
          const retailerTheme = getRetailerTheme(group.retailerKey || group.retailerName)

          return (
            <section
              key={group.retailerKey}
              className="shopping-market-group"
              style={{
                '--retailer-color': retailerTheme.color,
                '--retailer-border-color': retailerTheme.borderColor,
                '--retailer-soft-color': retailerTheme.softColor,
                '--retailer-glow-color': retailerTheme.glowColor,
              }}
            >
              <div className="shopping-market-group__header">
                <div>
                  <h2>{normalizeRetailerName(group.retailerName)}</h2>
                  <span>Einkaufsabschnitt</span>
                </div>
                <strong>
                  {getMarketSummaryText({
                    groupSummary,
                    knownSavingsTotal: groupKnownSavingsTotal,
                    approximateCount: groupApproximateSavingsCount,
                  })}
                </strong>
              </div>

              <div className="shopping-list-items">
                {group.items.map((item) => {
                  const itemId = getShoppingListItemId(item)
                  const isChecked = checkedItemIds.has(itemId)
                  const showUnitPrice = shouldDisplayUnitPrice(item)
                  const quantity = getItemQuantity(quantities, itemId)
                  const validityText = getValidityText(item)
                  const conditionText = getConditionText(item)
                  const quantityText = getQuantityText(item)
                  const savingsInfo = getShoppingListItemSavingsInfo(item)
                  const facts = buildItemFacts({
                    conditionText,
                    item,
                    quantityText,
                    rawConditionText: item.conditionsText,
                    showUnitPrice,
                    validityText,
                  })

                  return (
                    <article key={itemId} className={`shopping-list-item${isChecked ? ' shopping-list-item--checked' : ''}`}>
                      <label className="shopping-list-item__check">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          aria-label={`${item.title} als erledigt markieren`}
                          onChange={() => handleToggleItem(itemId)}
                        />
                        <span aria-hidden="true" />
                      </label>

                      <ProductImage offerId={item.offerId} src={item.imageUrl} alt={item.title} compact />

                      <div className="shopping-list-item__content">
                        <div className="shopping-list-item__main">
                          <div>
                            <p className="shopping-list-item__category">
                              {normalizeRetailerName(item.retailerName)} · {item.categoryLabel || 'Angebot'}
                            </p>
                            <h3>{item.title}</h3>
                          </div>

                          <div className="shopping-list-item__price-block">
                            <strong className="shopping-list-item__price">
                              {formatPrice(item?.priceCurrent?.amount, item?.priceCurrent?.currency)}
                            </strong>
                            <span>
                              {savingsInfo.type === 'known'
                                ? `${savingsInfo.isApproximate ? 'Spart ca.' : 'Spart'} ${formatPrice(savingsInfo.amount)}`
                                : 'Aktionspreis'}
                            </span>
                          </div>
                        </div>

                        <div className="shopping-list-item__facts">
                          {facts.map((fact) => (
                            <span key={fact.key} className={`shopping-list-item__fact shopping-list-item__fact--${fact.tone}`}>
                              {fact.label}
                            </span>
                          ))}
                        </div>

                        <div className="shopping-list-item__controls">
                          <div className="shopping-list-item__quantity" aria-label={`Menge für ${item.title}`}>
                            <button
                              type="button"
                              className="shopping-list-item__quantity-button"
                              aria-label="Menge verringern"
                              onClick={() => handleQuantityChange(itemId, 'decrease')}
                            >
                              -
                            </button>
                            <strong>{quantity}</strong>
                            <button
                              type="button"
                              className="shopping-list-item__quantity-button"
                              aria-label="Menge erhöhen"
                              onClick={() => handleQuantityChange(itemId, 'increase')}
                            >
                              +
                            </button>
                          </div>

                          <button type="button" className="ghost-button shopping-list-item__remove" onClick={() => onRemoveItem(itemId)}>
                            Entfernen
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}
