import { useEffect, useMemo, useState } from 'react'
import { createSharedShoppingList } from '../../api'
import { LegalInlineNotice } from '../layout/LegalInlineNotice'
import { ProductImage } from '../layout/ProductImage'
import { SavingsNotice } from '../layout/SavingsNotice'
import { SectionCard } from '../layout/SectionCard'
import { formatCurrencyAmount, formatUnitPrice, formatValidityLabel } from '../../utils/formatting'
import { getConditionsSummary, getOfferSavingsInfo, shouldDisplayUnitPrice } from '../../utils/offers'
import {
  buildShareSnapshot,
  getOfferExpiryHint,
  getRetailerGroupSummary,
  getShoppingListItemId,
  getShoppingListSummary,
  groupShoppingListByRetailer,
  loadCheckedShoppingListItems,
  storeCheckedShoppingListItems,
} from '../../utils/shoppingList'

export function ShoppingListPage({ shoppingListItems, onRemoveItem, onClearList, onGoToOffers, onNavigate }) {
  const [checkedItemIds, setCheckedItemIds] = useState(() => loadCheckedShoppingListItems())
  const [hideCompleted, setHideCompleted] = useState(false)
  const [shareState, setShareState] = useState({ status: 'idle', message: '' })
  const completedCount = useMemo(
    () => shoppingListItems.filter((item) => checkedItemIds.has(getShoppingListItemId(item))).length,
    [checkedItemIds, shoppingListItems]
  )
  const visibleItems = useMemo(
    () => (hideCompleted ? shoppingListItems.filter((item) => !checkedItemIds.has(getShoppingListItemId(item))) : shoppingListItems),
    [checkedItemIds, hideCompleted, shoppingListItems]
  )
  const groupedItems = useMemo(() => groupShoppingListByRetailer(visibleItems), [visibleItems])
  const summary = useMemo(() => getShoppingListSummary(shoppingListItems), [shoppingListItems])

  useEffect(() => {
    storeCheckedShoppingListItems(checkedItemIds)
  }, [checkedItemIds])

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

  async function handleShareList() {
    try {
      setShareState({ status: 'loading', message: '' })
      const result = await createSharedShoppingList(buildShareSnapshot(shoppingListItems))
      const shareUrl = result.url
      const shareText = `Hier ist meine geteilte kaufklug Einkaufsliste:\n${shareUrl}`

      try {
        await navigator.clipboard.writeText(shareUrl)
      } catch {
        // Clipboard ist nur Komfort. Der Link steht zusätzlich im Share-Text.
      }

      if (navigator.share) {
        await navigator.share({
          title: 'kaufklug Einkaufsliste',
          text: shareText,
          url: shareUrl,
        })
        setShareState({ status: 'done', message: 'Link zur Einkaufsliste geteilt und kopiert.' })
        return
      }

      setShareState({ status: 'done', message: 'Link zur Einkaufsliste kopiert.' })
    } catch (shareError) {
      setShareState({
        status: 'error',
        message: shareError?.message || 'Die Einkaufsliste konnte gerade nicht geteilt werden.',
      })
    }
  }

  if (!shoppingListItems.length) {
    return (
      <>
        <SectionCard style={{ marginBottom: '1rem' }}>
          <div className="shopping-list-hero">
            <p className="eyebrow">Einkaufsliste</p>
            <h1>Deine Einkaufsliste ist noch leer.</h1>
            <p>Füge Angebote hinzu, die du beim Einkauf nutzen möchtest. Sie werden lokal auf diesem Gerät gespeichert.</p>
            <button type="button" className="primary-action-button" onClick={onGoToOffers}>
              Angebote ansehen
            </button>
          </div>
        </SectionCard>

        <SavingsNotice onNavigate={onNavigate} />
        <LegalInlineNotice onNavigate={onNavigate} compact />
      </>
    )
  }

  return (
    <>
      <SectionCard style={{ marginBottom: '1rem' }}>
        <div className="shopping-list-hero">
          <p className="eyebrow">Einkaufsliste</p>
          <h1>Deine Einkaufsliste</h1>
          <p>Deine gespeicherten Angebote sind nach Geschäft sortiert. So kannst du deinen Einkauf einfacher planen.</p>
        </div>
      </SectionCard>

      <section className="shopping-summary shopping-summary--with-progress">
        <article className="shopping-summary__card">
          <span>Du bezahlst laut Angebot</span>
          <strong>{formatCurrencyAmount(summary.offerTotal)}</strong>
        </article>

        <article className="shopping-summary__card shopping-summary__card--saving">
          <span>Bekannte Ersparnis</span>
          <strong>{formatCurrencyAmount(summary.knownSavings)}</strong>
        </article>

        <article className="shopping-summary__card">
          <span>Aktionspreise ohne Normalpreis</span>
          <strong>{summary.actionWithoutNormalPriceCount}</strong>
        </article>

        <article className="shopping-summary__card">
          <span>Erledigt</span>
          <strong>{completedCount} von {shoppingListItems.length}</strong>
        </article>
      </section>

      <div className="shopping-list-actions">
        <button type="button" className="ghost-button" onClick={onGoToOffers}>
          Weitere Angebote suchen
        </button>
        <button type="button" className="ghost-button" onClick={() => setHideCompleted((current) => !current)}>
          {hideCompleted ? 'Alle anzeigen' : 'Erledigte ausblenden'}
        </button>
        <button type="button" className="ghost-button" onClick={handleShareList} disabled={shareState.status === 'loading'}>
          {shareState.status === 'loading' ? 'Teile Liste...' : 'Liste teilen'}
        </button>
        <button type="button" className="ghost-button ghost-button--danger" onClick={onClearList}>
          Liste leeren
        </button>
      </div>

      {shareState.message ? (
        <p className={`shopping-list-feedback shopping-list-feedback--${shareState.status}`}>{shareState.message}</p>
      ) : null}

      {hideCompleted && visibleItems.length === 0 ? (
        <div className="shopping-list-note">Alle Artikel sind erledigt. Über „Alle anzeigen“ kannst du sie wieder einblenden.</div>
      ) : null}

      <div className="shopping-market-groups">
        {groupedItems.map((group) => {
          const groupSummary = getRetailerGroupSummary(group.items)

          return (
            <section key={group.retailerKey} className="shopping-market-group">
              <div className="shopping-market-group__header">
                <h2>{group.retailerName}</h2>
                <span>
                  {groupSummary.itemCount} Artikel
                  {groupSummary.knownSavings ? ` · bekannte Ersparnis ${formatCurrencyAmount(groupSummary.knownSavings)}` : ''}
                </span>
              </div>

              <div className="shopping-list-items">
                {group.items.map((item) => {
                  const itemId = getShoppingListItemId(item)
                  const isChecked = checkedItemIds.has(itemId)
                  const savingsInfo = getOfferSavingsInfo(item)
                  const showUnitPrice = shouldDisplayUnitPrice(item)
                  const expiryHint = getOfferExpiryHint(item)

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
                            <p className="shopping-list-item__category">{item.categoryLabel}</p>
                            <h3>{item.title}</h3>
                          </div>

                          <strong className="shopping-list-item__price">
                            {formatCurrencyAmount(item?.priceCurrent?.amount, item?.priceCurrent?.currency)}
                          </strong>
                        </div>

                        <div className={`offer-savings-box offer-savings-box--${savingsInfo.type}`}>
                          <strong>{savingsInfo.label}</strong>
                          <span>{savingsInfo.description}</span>
                        </div>

                        <div className="shopping-list-item__facts">
                          <span>{formatValidityLabel(item)}</span>
                          {expiryHint.label ? <span className={`shopping-list-item__expiry shopping-list-item__expiry--${expiryHint.tone}`}>{expiryHint.label}</span> : null}
                          <span>{item.quantityText || 'Menge im Geschäft beachten'}</span>
                          <span>{getConditionsSummary(item)}</span>
                          {showUnitPrice ? <span>{formatUnitPrice(item.normalizedUnitPrice)}</span> : null}
                        </div>

                        <button type="button" className="ghost-button shopping-list-item__remove" onClick={() => onRemoveItem(itemId)}>
                          Entfernen
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {summary.actionWithoutNormalPriceCount > 0 ? (
        <div className="shopping-list-note shopping-list-note--after-items">
          {summary.actionWithoutNormalPriceCount} weitere Angebote sind aktuelle Aktionen ohne angegebenen Normalpreis.
        </div>
      ) : null}

      <SavingsNotice onNavigate={onNavigate} />
      <LegalInlineNotice onNavigate={onNavigate} compact />
    </>
  )
}
