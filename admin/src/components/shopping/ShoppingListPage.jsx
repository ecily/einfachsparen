import { useEffect, useMemo, useState } from 'react'
import { createSharedShoppingList } from '../../api'
import { ProductImage } from '../layout/ProductImage'
import { SectionCard } from '../layout/SectionCard'
import { formatUnitPrice } from '../../utils/formatting'
import { shouldDisplayUnitPrice } from '../../utils/offers'
import {
  buildShareSnapshot,
  getRetailerGroupSummary,
  getShoppingListItemId,
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

function getPositiveSavingsAmount(item) {
  const savingsValue = Number(item?.savingsAmount)

  return Number.isFinite(savingsValue) && savingsValue > 0 ? savingsValue : 0
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
    const savings = getPositiveSavingsAmount(item)

    return savings > 0 ? sum + savings * getItemQuantity(quantities, getShoppingListItemId(item)) : sum
  }, 0)
}

export function ShoppingListPage({ shoppingListItems, onRemoveItem, onClearList, onGoToOffers }) {
  const [checkedItemIds, setCheckedItemIds] = useState(() => loadCheckedShoppingListItems())
  const [hideCompleted, setHideCompleted] = useState(false)
  const [shareState, setShareState] = useState({ status: 'idle', message: '' })
  const [quantities, setQuantities] = useState(() => loadStoredQuantities())
  const visibleItems = useMemo(
    () => (hideCompleted ? shoppingListItems.filter((item) => !checkedItemIds.has(getShoppingListItemId(item))) : shoppingListItems),
    [checkedItemIds, hideCompleted, shoppingListItems]
  )
  const groupedItems = useMemo(() => groupShoppingListByRetailer(visibleItems), [visibleItems])
  const summary = useMemo(() => getShoppingListSummary(shoppingListItems), [shoppingListItems])
  const offerTotal = useMemo(() => getItemsTotal(shoppingListItems, quantities), [quantities, shoppingListItems])
  const knownSavingsTotal = useMemo(() => getKnownSavingsTotal(shoppingListItems, quantities), [quantities, shoppingListItems])

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
        <div className="shopping-list-hero">
          <p className="eyebrow">Einkaufsliste</p>
          <h1>Noch keine Angebote gemerkt.</h1>
          <p>Suche nach Produkten und merke dir passende Angebote für deinen Einkauf.</p>
          <button type="button" className="primary-action-button" onClick={onGoToOffers}>
            Angebote suchen
          </button>
        </div>
      </SectionCard>
    )
  }

  return (
    <>
      <SectionCard style={{ marginBottom: '1rem' }}>
        <div className="shopping-list-hero">
          <p className="eyebrow">{getItemCountText(shoppingListItems.length)} gemerkt</p>
          <h1>Einkaufsliste</h1>
          <p>Deine gemerkten Angebote für den nächsten Einkauf.</p>
        </div>
      </SectionCard>

      <section className="shopping-summary shopping-summary--with-progress">
        <article className="shopping-summary__card">
          <span>Aktionspreise gesamt</span>
          <strong>ca. {formatPrice(offerTotal)}</strong>
        </article>

        {summary.knownSavingsCount > 0 ? (
          <article className="shopping-summary__card shopping-summary__card--saving">
            <span>Bekannte Ersparnis</span>
            <strong>ca. {formatPrice(knownSavingsTotal)}</strong>
          </article>
        ) : null}
      </section>

      <div className="shopping-list-actions">
        <button type="button" className="ghost-button" onClick={onGoToOffers}>
          Angebote suchen
        </button>
        <button type="button" className="ghost-button" onClick={handleShareList} disabled={shareState.status === 'loading'}>
          {shareState.status === 'loading' ? 'Liste wird geteilt ...' : 'Liste teilen'}
        </button>
        <button type="button" className="ghost-button" onClick={() => setHideCompleted((current) => !current)}>
          {hideCompleted ? 'Erledigte anzeigen' : 'Erledigte ausblenden'}
        </button>
        <button type="button" className="ghost-button ghost-button--danger" onClick={onClearList}>
          Liste leeren
        </button>
      </div>

      {shareState.message ? (
        <p className={`shopping-list-feedback shopping-list-feedback--${shareState.status}`}>{shareState.message}</p>
      ) : null}

      {hideCompleted && visibleItems.length === 0 ? (
        <div className="shopping-list-note">Alle Angebote sind erledigt. Du kannst erledigte Angebote wieder anzeigen.</div>
      ) : null}

      <div className="shopping-market-groups">
        {groupedItems.map((group) => {
          const groupSummary = getRetailerGroupSummary(group.items)
          const groupTotal = getItemsTotal(group.items, quantities)

          return (
            <section key={group.retailerKey} className="shopping-market-group">
              <div className="shopping-market-group__header">
                <h2>{normalizeRetailerName(group.retailerName)}</h2>
                <span>
                  {getItemCountText(groupSummary.itemCount)}
                  {groupTotal > 0 ? ` · Aktionspreise ca. ${formatPrice(groupTotal)}` : ''}
                </span>
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
                            <p className="shopping-list-item__category">{item.categoryLabel || 'Angebot'}</p>
                            <h3>{item.title}</h3>
                          </div>

                          <strong className="shopping-list-item__price">
                            {formatPrice(item?.priceCurrent?.amount, item?.priceCurrent?.currency)}
                          </strong>
                        </div>

                        <div className="shopping-list-item__facts">
                          {quantityText ? <span>{quantityText}</span> : null}
                          {validityText ? <span>{validityText}</span> : null}
                          {conditionText ? <span>{conditionText}</span> : null}
                          {showUnitPrice ? <span>{formatUnitPrice(item.normalizedUnitPrice)}</span> : null}
                        </div>

                        <div
                          style={{
                            alignItems: 'center',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.6rem',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div
                            aria-label={`Menge für ${item.title}`}
                            style={{
                              alignItems: 'center',
                              display: 'inline-flex',
                              gap: '0.45rem',
                            }}
                          >
                            <button
                              type="button"
                              className="ghost-button"
                              aria-label="Menge verringern"
                              onClick={() => handleQuantityChange(itemId, 'decrease')}
                              style={{ minHeight: '2.6rem', minWidth: '2.6rem', padding: 0 }}
                            >
                              -
                            </button>
                            <strong style={{ minWidth: '2rem', textAlign: 'center' }}>{quantity}</strong>
                            <button
                              type="button"
                              className="ghost-button"
                              aria-label="Menge erhöhen"
                              onClick={() => handleQuantityChange(itemId, 'increase')}
                              style={{ minHeight: '2.6rem', minWidth: '2.6rem', padding: 0 }}
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
