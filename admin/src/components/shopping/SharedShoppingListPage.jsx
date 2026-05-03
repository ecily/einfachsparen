import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { fetchSharedShoppingList } from '../../api'
import { SITE_URL } from '../../config/constants'
import { ProductImage } from '../layout/ProductImage'
import { SectionCard } from '../layout/SectionCard'
import { formatCurrencyAmount } from '../../utils/formatting'
import {
  buildShoppingListItemFromSnapshot,
  getOfferExpiryHint,
  getShoppingListItemId,
  groupShoppingListByRetailer,
  loadCheckedShoppingListItems,
  storeCheckedShoppingListItems,
} from '../../utils/shoppingList'

export function SharedShoppingListPage({ shareId, onNavigate, onAdoptItems }) {
  const [list, setList] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [checkedItemIds, setCheckedItemIds] = useState(() => loadCheckedShoppingListItems(`shared.${shareId}`))
  const [shareMessage, setShareMessage] = useState('')
  const items = useMemo(() => list?.items || [], [list])
  const groupedItems = useMemo(() => groupShoppingListByRetailer(items), [items])
  const completedCount = useMemo(
    () => items.filter((item) => checkedItemIds.has(getShoppingListItemId(item))).length,
    [checkedItemIds, items]
  )
  const shareUrl = `${SITE_URL}/liste/${shareId}`

  useEffect(() => {
    let active = true

    async function loadList() {
      try {
        setLoading(true)
        const result = await fetchSharedShoppingList(shareId)

        if (!active) return

        setList(result)
        setError('')
      } catch (loadError) {
        if (!active) return
        setList(null)
        setError(loadError?.response?.data?.message || 'Diese Einkaufsliste wurde nicht gefunden oder ist abgelaufen.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadList()

    return () => {
      active = false
    }
  }, [shareId])

  useEffect(() => {
    storeCheckedShoppingListItems(checkedItemIds, `shared.${shareId}`)
  }, [checkedItemIds, shareId])

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

  async function handleShareAgain() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Geteilte kaufklug Einkaufsliste',
          text: 'Geteilte kaufklug Einkaufsliste',
          url: shareUrl,
        })
        setShareMessage('Link zur Einkaufsliste bereitgestellt.')
        return
      }

      await navigator.clipboard.writeText(shareUrl)
      setShareMessage('Link zur Einkaufsliste kopiert.')
    } catch {
      setShareMessage('Der Link konnte gerade nicht geteilt werden.')
    }
  }

  function handleAdoptItems() {
    const localItems = items.map(buildShoppingListItemFromSnapshot)
    onAdoptItems(localItems)
  }

  if (loading) {
    return <p className="status">Geteilte Einkaufsliste wird geladen ...</p>
  }

  if (error || !list) {
    return (
      <SectionCard>
        <div className="shopping-list-hero">
          <p className="eyebrow">Geteilte Einkaufsliste</p>
          <h1>Diese Liste ist nicht verfügbar.</h1>
          <p>{error || 'Der Link ist abgelaufen oder nicht mehr vorhanden.'}</p>
          <button type="button" className="primary-action-button" onClick={() => onNavigate('search')}>
            Zur Startseite
          </button>
        </div>
      </SectionCard>
    )
  }

  return (
    <>
      <SectionCard style={{ marginBottom: '1rem' }}>
        <div className="shopping-list-hero">
          <p className="eyebrow">Geteilte Einkaufsliste</p>
          <h1>Geteilte kaufklug Einkaufsliste</h1>
          <p>
            Erstellt am {dayjs(list.createdAt).format('DD.MM.YYYY')}. Läuft ab am {dayjs(list.expiresAt).format('DD.MM.YYYY')}.
            Angebote bitte im Markt prüfen.
          </p>
        </div>
      </SectionCard>

      <section className="shopping-summary shopping-summary--shared">
        <article className="shopping-summary__card">
          <span>Artikel</span>
          <strong>{items.length}</strong>
        </article>

        <article className="shopping-summary__card">
          <span>Erledigt</span>
          <strong>{completedCount} von {items.length}</strong>
        </article>
      </section>

      <div className="shopping-list-actions">
        <button type="button" className="ghost-button" onClick={handleShareAgain}>
          Liste teilen
        </button>
        <button type="button" className="ghost-button" onClick={handleAdoptItems}>
          Liste übernehmen
        </button>
        <button type="button" className="ghost-button" onClick={() => onNavigate('search')}>
          Zur Startseite
        </button>
      </div>

      {shareMessage ? <p className="shopping-list-feedback shopping-list-feedback--done">{shareMessage}</p> : null}

      <div className="shopping-market-groups">
        {groupedItems.map((group) => (
          <section key={group.retailerKey} className="shopping-market-group">
            <div className="shopping-market-group__header">
              <h2>{group.retailerName}</h2>
              <span>{group.items.length} Artikel</span>
            </div>

            <div className="shopping-list-items">
              {group.items.map((item) => {
                const itemId = getShoppingListItemId(item)
                const isChecked = checkedItemIds.has(itemId)
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

                    <ProductImage src={item.imageUrl} alt={item.title} compact />

                    <div className="shopping-list-item__content">
                      <div className="shopping-list-item__main">
                        <div>
                          <p className="shopping-list-item__category">{item.categoryLabel || 'ohne Kategorie'}</p>
                          <h3>{item.title}</h3>
                        </div>

                        <strong className="shopping-list-item__price">
                          {formatCurrencyAmount(item?.priceCurrent?.amount, item?.priceCurrent?.currency)}
                        </strong>
                      </div>

                      <div className="shopping-list-item__facts">
                        {expiryHint.label ? <span className={`shopping-list-item__expiry shopping-list-item__expiry--${expiryHint.tone}`}>{expiryHint.label}</span> : null}
                        <span>{item.quantityText || item.unit || 'Menge im Geschäft beachten'}</span>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
