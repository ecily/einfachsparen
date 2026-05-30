import { useEffect, useMemo, useState } from 'react'
import { createSharedShoppingList } from '../../api'
import { SectionCard } from '../layout/SectionCard'
import { OfferCardConsumer } from '../search/OfferCardConsumer'
import { getRetailerTheme } from '../../utils/retailerColors'
import { formatRetailerName } from '../../utils/retailers'
import {
  buildShareSnapshot,
  getRetailerGroupSummary,
  getShoppingListDisplaySavingsOverride,
  getShoppingListItemQuantity,
  getShoppingListItemId,
  getShoppingListMinimumQuantity,
  getShoppingListRemainderHint,
  getShoppingListSummaryForQuantities,
  groupShoppingListByRetailer,
  loadCheckedShoppingListItems,
  storeCheckedShoppingListItems,
} from '../../utils/shoppingList'

const SHOPPING_LIST_QUANTITY_STORAGE_KEY = 'kaufklug.shoppingList.quantities.v1'

function SearchIcon() {
  return (
    <svg className="button-icon" aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.2 16.2 4.3 4.3" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg className="button-icon" aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.6 6.8-4.2" />
      <path d="m8.6 13.4 6.8 4.2" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="button-icon" aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

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

function normalizeRetailerName(value) {
  return formatRetailerName(value)
}

function getArticleCountText(count) {
  return `${count} ${count === 1 ? 'Artikel' : 'Artikel'}`
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

function getItemsTotal(items, quantities) {
  return getShoppingListSummaryForQuantities(items, quantities).offerTotal
}

function getKnownSavingsTotal(items, quantities) {
  return getShoppingListSummaryForQuantities(items, quantities).knownSavings
}

function getSavingsPercent(offerTotal, savingsTotal) {
  const paid = Number(offerTotal)
  const saved = Number(savingsTotal)
  const comparisonTotal = paid + saved

  if (!Number.isFinite(paid) || !Number.isFinite(saved) || paid <= 0 || saved <= 0 || comparisonTotal <= 0) {
    return 0
  }

  return Math.round((saved / comparisonTotal) * 100)
}

function getApproximateSavingsCount(items = [], quantities = {}) {
  return getShoppingListSummaryForQuantities(items, quantities).approximateSavingsCount
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

function buildShoppingListOffer(item, quantity) {
  const itemId = getShoppingListItemId(item)
  const displaySavingsOverride = getShoppingListDisplaySavingsOverride(item, quantity)

  return {
    ...item,
    id: itemId,
    offerId: item?.offerId || itemId,
    displayCategory: item?.categoryLabel || item?.displayCategory || item?.categoryPrimary,
    referencePrice: item?.referencePrice || null,
    savings: item?.savings || {
      amount: item?.savingsAmount,
      isApproximate: Boolean(item?.savingsIsApproximate),
    },
    ...(displaySavingsOverride || {}),
  }
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
  const summary = useMemo(() => getShoppingListSummaryForQuantities(shoppingListItems, quantities), [quantities, shoppingListItems])
  const offerTotal = useMemo(() => getItemsTotal(shoppingListItems, quantities), [quantities, shoppingListItems])
  const knownSavingsTotal = useMemo(() => getKnownSavingsTotal(shoppingListItems, quantities), [quantities, shoppingListItems])
  const canShowOfferTotal = useMemo(() => hasKnownCurrentPrice(shoppingListItems), [shoppingListItems])
  const canShowKnownSavings = summary.knownSavingsCount > 0 && knownSavingsTotal > 0
  const savingsPercent = getSavingsPercent(offerTotal, knownSavingsTotal)
  const canShowSavingsPercent = canShowOfferTotal && canShowKnownSavings && savingsPercent > 0

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
      const item = shoppingListItems.find((candidate) => getShoppingListItemId(candidate) === itemId)
      const minimumQuantity = getShoppingListMinimumQuantity(item)
      const currentQuantity = getShoppingListItemQuantity(item, current)
      const nextQuantity = direction === 'increase' ? currentQuantity + 1 : currentQuantity - 1

      return {
        ...current,
        [itemId]: Math.max(minimumQuantity, Math.min(nextQuantity, 99)),
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
      <section className="shopping-check" aria-label="Einkaufslisten-Zusammenfassung">
        <div className="shopping-check__metrics">
          {canShowOfferTotal ? (
            <div className="shopping-check__metric shopping-check__metric--price">
              <span>Du zahlst ca.</span>
              <strong>{formatPrice(offerTotal)}</strong>
            </div>
          ) : null}

          <div className="shopping-check__metric shopping-check__metric--saving">
            <span>Du sparst ca.</span>
            <strong>{canShowKnownSavings ? formatPrice(knownSavingsTotal) : formatPrice(0)}</strong>
          </div>

          {canShowSavingsPercent ? (
            <div className="shopping-check__percent-note">Das entspricht ca. {savingsPercent} % Ersparnis.</div>
          ) : null}
        </div>

        <p className="shopping-check__note">
          Ersparnisse zählen wir nur mit Vergleichspreis. Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen. Keine
          Preisgarantie.
        </p>
      </section>

      <div className="shopping-list-actions">
        <button type="button" className="primary-action-button" onClick={onGoToOffers}>
          <SearchIcon />
          Weitere Angebote suchen
        </button>
        <button type="button" className="ghost-button" onClick={handleShareList} disabled={shareState.status === 'loading'}>
          <ShareIcon />
          {shareState.status === 'loading' ? 'Liste wird geteilt ...' : 'Liste teilen'}
        </button>
        <button type="button" className="ghost-button" onClick={() => setHideCompleted((current) => !current)}>
          <CheckIcon />
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
          const groupApproximateSavingsCount = getApproximateSavingsCount(group.items, quantities)
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
                  const quantity = getShoppingListItemQuantity(item, quantities)
                  const minimumQuantity = getShoppingListMinimumQuantity(item)
                  const remainderHint = getShoppingListRemainderHint(item, quantity)
                  const offer = buildShoppingListOffer(item, quantity)

                  return (
                    <OfferCardConsumer
                      key={itemId}
                      offer={offer}
                      showShoppingListAction={false}
                      enableOfferFeedback={false}
                      className={`user-card--shopping-list${isChecked ? ' user-card--checked' : ''}`}
                      actionSlot={
                        <div className="shopping-list-card-actions">
                          <label className="shopping-list-card-check">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              aria-label={`${item.title} als erledigt markieren`}
                              onChange={() => handleToggleItem(itemId)}
                            />
                            <span aria-hidden="true" />
                            <strong>{isChecked ? 'Erledigt' : 'Offen'}</strong>
                          </label>

                          <div className="shopping-list-item__quantity" aria-label={`Menge für ${item.title}`}>
                            <button
                              type="button"
                              className="shopping-list-item__quantity-button"
                              aria-label="Menge verringern"
                              onClick={() => handleQuantityChange(itemId, 'decrease')}
                              disabled={quantity <= minimumQuantity}
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

                          {remainderHint ? <p className="shopping-list-item__quantity-note">{remainderHint}</p> : null}

                          <button type="button" className="ghost-button shopping-list-item__remove" onClick={() => onRemoveItem(itemId)}>
                            Entfernen
                          </button>
                        </div>
                      }
                    />
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
