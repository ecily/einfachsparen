import { useEffect, useMemo, useState } from 'react'
import { fetchSharedShoppingList } from '../../api'
import { SITE_URL } from '../../config/constants'
import { ProductImage } from '../layout/ProductImage'
import { SectionCard } from '../layout/SectionCard'
import {
  buildShoppingListItemFromSnapshot,
  getShoppingListItemId,
  groupShoppingListByRetailer,
  loadCheckedShoppingListItems,
  storeCheckedShoppingListItems,
} from '../../utils/shoppingList'

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

function getOfferCountText(count) {
  return `${count} ${count === 1 ? 'Angebot' : 'Angebote'}`
}

function getItemsTotal(items = []) {
  return items.reduce((sum, item) => {
    const price = Number(item?.priceCurrent?.amount)
    return Number.isFinite(price) ? sum + price : sum
  }, 0)
}

function getQuantityText(item) {
  const rawValue = String(item?.quantityText || item?.unit || '').trim()
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

  if (item?.isMultiBuy) {
    return 'Mehrkauf-Angebot'
  }

  return ''
}

export function SharedShoppingListPage({ shareId, onNavigate, onAdoptItems }) {
  const [list, setList] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [checkedItemIds, setCheckedItemIds] = useState(() => loadCheckedShoppingListItems(`shared.${shareId}`))
  const [shareMessage, setShareMessage] = useState('')
  const items = useMemo(() => list?.items || [], [list])
  const groupedItems = useMemo(() => groupShoppingListByRetailer(items), [items])
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
      } catch {
        if (!active) return
        setList(null)
        setError('Diese Einkaufsliste ist nicht mehr verfügbar.')
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
      const shareText = `Geteilte kaufklug Einkaufsliste:\n${shareUrl}`

      try {
        await navigator.clipboard.writeText(shareUrl)
      } catch {
        // Teilen funktioniert auch ohne Kopieren.
      }

      if (navigator.share) {
        await navigator.share({
          title: 'Geteilte Einkaufsliste',
          text: shareText,
          url: shareUrl,
        })
        setShareMessage('Link wurde erstellt.')
        return
      }

      setShareMessage('Link wurde kopiert.')
    } catch {
      setShareMessage('Die Liste konnte gerade nicht geteilt werden.')
    }
  }

  function handleAdoptItems() {
    const localItems = items.map(buildShoppingListItemFromSnapshot)
    onAdoptItems(localItems)
  }

  if (loading) {
    return <p className="status">Einkaufsliste wird geladen …</p>
  }

  if (error || !list) {
    return (
      <SectionCard>
        <div className="shopping-list-hero">
          <p className="eyebrow">Geteilte Einkaufsliste</p>
          <h1>Diese Einkaufsliste ist nicht mehr verfügbar.</h1>
          <p>Du kannst direkt nach aktuellen Angeboten suchen.</p>
          <button type="button" className="primary-action-button" onClick={() => onNavigate('product-search')}>
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
          <p className="eyebrow">{getOfferCountText(items.length)}</p>
          <h1>Geteilte Einkaufsliste</h1>
          <p>Diese Liste wurde mit kaufklug geteilt.</p>
        </div>
      </SectionCard>

      <div className="shopping-list-actions">
        <button type="button" className="ghost-button" onClick={handleAdoptItems}>
          Liste übernehmen
        </button>
        <button type="button" className="ghost-button" onClick={() => onNavigate('product-search')}>
          Eigene Angebote suchen
        </button>
        <button type="button" className="ghost-button" onClick={handleShareAgain}>
          Liste teilen
        </button>
      </div>

      {shareMessage ? <p className="shopping-list-feedback shopping-list-feedback--done">{shareMessage}</p> : null}

      <div className="shopping-market-groups">
        {groupedItems.map((group) => {
          const groupTotal = getItemsTotal(group.items)

          return (
            <section key={group.retailerKey} className="shopping-market-group">
              <div className="shopping-market-group__header">
                <h2>{normalizeRetailerName(group.retailerName)}</h2>
                <span>
                  {getOfferCountText(group.items.length)}
                  {groupTotal > 0 ? ` · Aktionspreise ca. ${formatPrice(groupTotal)}` : ''}
                </span>
              </div>

              <div className="shopping-list-items">
                {group.items.map((item) => {
                  const itemId = getShoppingListItemId(item)
                  const isChecked = checkedItemIds.has(itemId)
                  const validityText = getValidityText(item)
                  const quantityText = getQuantityText(item)
                  const conditionText = getConditionText(item)

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

      <div className="shopping-list-note shopping-list-note--after-items">
        Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.
      </div>
    </>
  )
}
