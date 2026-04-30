import { useMemo } from 'react'
import { LegalInlineNotice } from '../layout/LegalInlineNotice'
import { ProductImage } from '../layout/ProductImage'
import { SavingsNotice } from '../layout/SavingsNotice'
import { SectionCard } from '../layout/SectionCard'
import { formatCurrencyAmount, formatUnitPrice, formatValidityLabel } from '../../utils/formatting'
import { getConditionsSummary, getOfferSavingsInfo, shouldDisplayUnitPrice } from '../../utils/offers'
import { getShoppingListSummary, groupShoppingListByRetailer } from '../../utils/shoppingList'

export function ShoppingListPage({ shoppingListItems, onRemoveItem, onClearList, onGoToOffers, onNavigate }) {
  const groupedItems = useMemo(() => groupShoppingListByRetailer(shoppingListItems), [shoppingListItems])
  const summary = useMemo(() => getShoppingListSummary(shoppingListItems), [shoppingListItems])

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

      <section className="shopping-summary">
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
      </section>

      {summary.actionWithoutNormalPriceCount > 0 ? (
        <div className="shopping-list-note">
          {summary.actionWithoutNormalPriceCount} weitere Angebote sind aktuelle Aktionen ohne angegebenen Normalpreis.
        </div>
      ) : null}

      <SavingsNotice onNavigate={onNavigate} />
      <LegalInlineNotice onNavigate={onNavigate} compact />

      <div className="shopping-list-actions">
        <button type="button" className="ghost-button" onClick={onGoToOffers}>
          Weitere Angebote suchen
        </button>
        <button type="button" className="ghost-button ghost-button--danger" onClick={onClearList}>
          Liste leeren
        </button>
      </div>

      <div className="shopping-market-groups">
        {groupedItems.map((group) => (
          <section key={group.retailerKey} className="shopping-market-group">
            <div className="shopping-market-group__header">
              <h2>{group.retailerName}</h2>
              <span>{group.items.length} Angebot{group.items.length === 1 ? '' : 'e'}</span>
            </div>

            <div className="shopping-list-items">
              {group.items.map((item) => {
                const savingsInfo = getOfferSavingsInfo(item)
                const showUnitPrice = shouldDisplayUnitPrice(item)

                return (
                  <article key={item.id} className="shopping-list-item">
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
                        <span>{item.quantityText || 'Menge im Geschäft beachten'}</span>
                        <span>{getConditionsSummary(item)}</span>
                        {showUnitPrice ? <span>{formatUnitPrice(item.normalizedUnitPrice)}</span> : null}
                      </div>

                      <button type="button" className="ghost-button shopping-list-item__remove" onClick={() => onRemoveItem(item.id)}>
                        Entfernen
                      </button>
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
