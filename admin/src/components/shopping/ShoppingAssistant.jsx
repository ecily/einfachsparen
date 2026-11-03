import { useEffect, useMemo, useRef, useState } from 'react'
import { createSharedShoppingList } from '../../api'
import { fetchOfferRankingDirect } from '../../utils/apiBase'
import { flattenRankingOffers } from '../../utils/offers'
import { buildShareSnapshot, getShoppingListItemQuantity, loadCheckedShoppingListItems, storeCheckedShoppingListItems } from '../../utils/shoppingList'
import { buildPartialPlan, createWish, nextQuoteExpiry, REFRESH_LIMIT, sameOffer } from '../../utils/shoppingAssistant'
import { OfferCardConsumer } from '../search/OfferCardConsumer'
import './shoppingAssistant.css'

const QUANTITIES = 'kaufklug.shoppingList.quantities.v1'
const money = cents => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(cents / 100)
const withoutSavings = offer => ({ ...offer, referencePrice: null, priceReference: null, savings: null, savingsAmount: null, savingsPercent: null, hasKnownSavings: false, discountPercent: null, discountUpToPercent: null, comparisonAlternative: null })
function loadQuantities() {
  try { const value = JSON.parse(localStorage.getItem(QUANTITIES) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} }
}

function WishOffers({ item, existingIds, onSelect, onClose }) {
  const [result, setResult] = useState({ loading: true, offers: [], error: false })
  useEffect(() => {
    const abort = new AbortController()
    let active = true
    const timer = setTimeout(() => abort.abort(), 8000)
    fetchOfferRankingDirect({ q: item.title, limit: 60 }, { signal: abort.signal })
      .then(data => { if (active) setResult({ loading: false, offers: flattenRankingOffers(data).slice(0, 5), error: false }) })
      .catch(() => { if (active) setResult({ loading: false, offers: [], error: true }) })
      .finally(() => clearTimeout(timer))
    return () => { active = false; clearTimeout(timer); abort.abort() }
  }, [item.title])
  return <section className="purchase-matches" aria-label={`Angebote für ${item.title}`} aria-busy={result.loading}>
    <div className="assistant-section-head"><h4>Angebote für {item.title}</h4><button onClick={onClose}>Schließen</button></div>
    <p>Wähle selbst, welches Produkt und welche Packungsgröße passen. Dein Wunsch wird erst nach deiner Auswahl ersetzt.</p>
    {result.loading ? <p role="status">Angebote werden gesucht …</p> : result.error ? <p role="status">Die Angebote konnten gerade nicht geladen werden. Dein Produkt bleibt auf der Liste.</p> : !result.offers.length ? <p role="status">Keine passenden Angebote gefunden. Dein Produkt bleibt ohne Preis auf der Liste.</p> : null}
    {result.offers.map(offer => <div key={offer.id || offer.offerId} className="purchase-match">
      <OfferCardConsumer offer={withoutSavings(offer)} showShoppingListAction={false} />
      <button className="primary-action-button" disabled={existingIds.has(String(offer.id || offer.offerId))} onClick={() => onSelect(offer)}>
        {existingIds.has(String(offer.id || offer.offerId)) ? 'Bereits auf deiner Liste' : 'Für dieses Produkt wählen'}
      </button>
    </div>)}
    <a href={`/suche?q=${encodeURIComponent(item.title)}`}>In der Produktsuche vergleichen</a>
    <p className="assistant-help">Bis zu fünf Treffer aus der aktuellen Suche. Keine vollständige Auswahl oder Bestpreisgarantie.</p>
  </section>
}

export function ShoppingAssistant({ shoppingListItems: items, onAddWish, onEditWish, onAssignWish, onRemoveItem, onClearList }) {
  const [wish, setWish] = useState('')
  const [addQuantity, setAddQuantity] = useState('1')
  const [editing, setEditing] = useState('')
  const [matchesFor, setMatchesFor] = useState('')
  const [checked, setChecked] = useState(() => loadCheckedShoppingListItems())
  const [quantities, setQuantities] = useState(loadQuantities)
  const [quotes, setQuotes] = useState({})
  const [notice, setNotice] = useState('')
  const [shareLink, setShareLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now)
  const [hide, setHide] = useState(false)
  const [grouped, setGrouped] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const wishInput = useRef(null)
  const controller = useRef(null)
  const currentItems = useRef(items)
  useEffect(() => { currentItems.current = items }, [items])
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    const refreshTime = () => setNow(Date.now())
    window.addEventListener('focus', refreshTime)
    document.addEventListener('visibilitychange', refreshTime)
    return () => { window.removeEventListener('focus', refreshTime); document.removeEventListener('visibilitychange', refreshTime) }
  }, [])
  useEffect(() => { storeCheckedShoppingListItems(checked) }, [checked])
  useEffect(() => { try { localStorage.setItem(QUANTITIES, JSON.stringify(quantities)) } catch { /* session remains usable */ } }, [quantities])
  useEffect(() => {
    const expiry = nextQuoteExpiry(quotes)
    const timer = expiry ? setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(1, expiry - Date.now() + 1))) : null
    return () => clearTimeout(timer)
  }, [quotes, now])
  const plan = useMemo(() => buildPartialPlan(items, quotes, quantities, checked, now), [items, quotes, quantities, checked, now])
  const done = items.filter(i => checked.has(String(i.id))).length
  const existingIds = new Set(items.map(i => String(i.id)))
  const display = items.filter(i => !hide || !checked.has(String(i.id)))
  const groups = grouped ? [...new Set(display.map(i => i.manual ? 'Noch ohne Angebot' : i.retailerName))]
    .map(name => ({ name, items: display.filter(i => (i.manual ? 'Noch ohne Angebot' : i.retailerName) === name) })) : [{ name: '', items: display }]

  function add(event) {
    event.preventDefault()
    const item = createWish(wish, crypto.randomUUID(), addQuantity)
    if (item && items.length < 100) {
      onAddWish(item); setWish(''); setAddQuantity('1'); setNotice(`${item.title} hinzugefügt. Deine Liste wird auf diesem Gerät gespeichert.`)
      wishInput.current?.focus()
    }
  }
  function toggle(id) { setChecked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) }
  function reuse() { setChecked(new Set()); setQuotes({}); setHide(false); setNotice('Bereit für den nächsten Einkauf. Prüfe deine gemerkten Angebote erneut.') }
  function remove(id) {
    setChecked(s => { const n = new Set(s); n.delete(String(id)); return n })
    setQuantities(q => { const n = { ...q }; delete n[id]; return n })
    setQuotes(q => { const n = { ...q }; delete n[id]; return n })
    onRemoveItem(id); setNotice('Produkt entfernt.')
  }
  function selectOffer(item, offer, quantity) {
    if (existingIds.has(String(offer.id || offer.offerId))) return
    onAssignWish(item.id, offer, quantity)
    setQuantities(q => { const n = { ...q }; delete n[item.id]; return n })
    const checkedAt = Date.now()
    setQuotes(q => ({ ...q, [offer.id || offer.offerId]: { offer, checkedAt } }))
    setNow(checkedAt); setMatchesFor(''); setNotice('Angebot gewählt. Prüfe die Packungszahl und die geltenden Mengenbedingungen.')
  }
  async function refresh() {
    if (busy) return
    const abort = new AbortController(); controller.current = abort
    setBusy(true); setNotice('Gemerkte Angebote werden geprüft …'); setQuotes({})
    const next = {}; let errors = 0, requested = 0
    const selected = items.filter(i => !i.manual && !checked.has(String(i.id))).slice(0, REFRESH_LIMIT)
    try {
      for (const item of selected) {
        if (abort.signal.aborted) break
        const timer = setTimeout(() => abort.abort(), 8000)
        requested += 1
        try {
          const result = await fetchOfferRankingDirect({ q: item.title, retailers: item.retailerKey, limit: 60 }, { signal: abort.signal })
          if (abort.signal.aborted) break
          const match = flattenRankingOffers(result).find(o => sameOffer(item, o))
          if (match && currentItems.current.some(i => i.id === item.id && sameOffer(i, match))) next[item.id] = { offer: match, checkedAt: Date.now() }
        } catch { errors += 1 } finally { clearTimeout(timer) }
      }
      if (controller.current !== abort) return
      setQuotes(next); setNow(Date.now())
      setNotice(`${requested} gemerkte Angebote geprüft. ${errors || abort.signal.aborted ? 'Nicht alle Abrufe waren möglich. ' : ''}Unbestätigte Produkte bleiben ohne Preis.`)
    } finally { if (controller.current === abort) { controller.current = null; setBusy(false) } }
  }
  async function share() {
    setBusy(true)
    try {
      const snapshot = buildShareSnapshot(items, quantities)
      snapshot.items = snapshot.items.map(i => ({ ...i, priceCurrent: null }))
      const result = await createSharedShoppingList(snapshot)
      if (typeof result.url !== 'string' || !result.url.trim()) throw new Error('Missing share URL')
      const url = new URL(result.url, window.location.origin)
      if (![window.location.origin, 'https://www.kaufklug.at'].includes(url.origin)) throw new Error('Untrusted share origin')
      setShareLink(url.href)
      try { await navigator.clipboard.writeText(url.href); setNotice('Listenlink kopiert. Preise müssen Empfänger neu prüfen.') }
      catch { setNotice('Listenlink erstellt. Du kannst ihn unten kopieren.') }
    } catch { setNotice('Teilen gerade nicht möglich. Deine Liste bleibt auf diesem Gerät gespeichert.') }
    finally { setBusy(false) }
  }
  async function systemShare() {
    try { await navigator.share({ title: 'Mein Einkauf bei Kaufklug', url: shareLink }) }
    catch { setNotice('Teilen abgebrochen. Dein Listenlink bleibt verfügbar.') }
  }
  return <div className="assistant-page purchase-page">
    <header className="purchase-heading"><h1>Mein Einkauf</h1><p>Schreib auf, was du brauchst. Finde passende Angebote und plane deinen Einkauf mit Kaufklug.</p></header>
    <form className="purchase-add" onSubmit={add}>
      <label className="purchase-product-input" htmlFor="wish">Was brauchst du?<input ref={wishInput} id="wish" value={wish} onChange={e => setWish(e.target.value)} maxLength={160} required placeholder="z. B. Milch, 1 Liter" autoComplete="off" enterKeyHint="done" /></label>
      <label className="purchase-count-input" htmlFor="wish-count">Anzahl<input id="wish-count" type="number" min="1" max="99" step="1" required value={addQuantity} onChange={e => setAddQuantity(e.target.value)} inputMode="numeric" /></label>
      <button className="primary-action-button" disabled={items.length >= 100}>Hinzufügen</button>
    </form>
    <p className="purchase-storage">Ohne Konto · Auf diesem Gerät gespeichert. {items.length >= 100 ? 'Liste voll: Entferne zuerst ein Produkt.' : 'Menge oder Größe kannst du beim Produktnamen ergänzen.'}</p>
    {notice ? <p className="purchase-notice" role="status">{notice}</p> : null}
    <div className="purchase-layout">
    <section id="deine-liste" className="assistant-list" aria-labelledby="list-title">
      <div className="assistant-section-head"><h2 id="list-title">Meine Produkte <span className="purchase-count">{items.length}</span></h2><span>{items.length - done} offen · {done} erledigt</span></div>
      {items.length > 0 ? <div className="purchase-list-tools"><button onClick={() => setGrouped(!grouped)} aria-pressed={grouped}>{grouped ? 'Alle Produkte' : 'Nach Händlern'}</button><a href="#sparplan">Zum Sparplan ↓</a></div> : null}
      {!items.length ? <div className="purchase-empty"><h3>Was steht bei dir auf dem Einkaufszettel?</h3><p>Trage oben dein erstes Produkt ein. Oder übernimm ein Angebot aus der Suche.</p><a href="/suche">Aktuelle Angebote entdecken →</a></div> : null}
      {items.length > 0 && !display.length ? <p className="purchase-empty">Alles erledigt! Blende deine Produkte wieder ein oder verwende die Liste für deinen nächsten Einkauf.</p> : null}
      <div className="purchase-groups">{groups.map(group => <div key={group.name}>
        {group.name ? <h3 className="purchase-market-name">{group.name}</h3> : null}
        <div className="assistant-items">{group.items.map(item => {
          const row = plan.rows.find(r => r.item.id === item.id)
          const quantity = getShoppingListItemQuantity(item, quantities)
          const isDone = checked.has(String(item.id))
          return <article key={item.id} className={`assistant-item${isDone ? ' assistant-item--done' : ''}`}>
            <div className="purchase-item-top"><label className="assistant-check"><input type="checkbox" checked={isDone} onChange={() => toggle(String(item.id))} aria-label={`${item.title} abhaken`} /><span>{item.title}</span></label><button className="purchase-remove" onClick={() => remove(item.id)} aria-label={`${item.title} entfernen`}>×</button></div>
            <div className="purchase-item-content">
            <p className="assistant-item-meta">{isDone ? 'Erledigt' : item.manual ? 'Noch ohne passendes Angebot' : `Gemerkt bei ${item.retailerName}`}{item.quantityText ? ` · ${item.quantityText}` : ''}</p>
            {editing === item.id && item.manual ? <form className="purchase-edit" onSubmit={e => { e.preventDefault(); const title = new FormData(e.currentTarget).get('title').trim(); if (title) { onEditWish(item.id, title); setEditing(''); setMatchesFor(''); setNotice('Produkt geändert.') } }}><label htmlFor={`edit-${item.id}`}>Produktname</label><input id={`edit-${item.id}`} name="title" defaultValue={item.title} maxLength={160} required autoFocus /><button type="submit">Speichern</button><button type="button" onClick={() => setEditing('')}>Abbrechen</button></form> : null}
            <div className="purchase-item-controls"><label className="purchase-quantity">{item.manual ? 'Anzahl' : 'Packungen'}<input type="number" min="1" max="99" inputMode="numeric" value={quantity} onChange={e => setQuantities(q => ({ ...q, [item.id]: Math.max(1, Math.min(99, Math.floor(Number(e.target.value)) || 1)) }))} aria-label={`${item.manual ? 'Anzahl' : 'Packungen'} für ${item.title}`} /></label>
              {item.manual ? <button onClick={() => { setEditing(editing === item.id ? '' : item.id); setMatchesFor('') }} aria-expanded={editing === item.id}>Bearbeiten</button> : null}
              {!isDone ? item.manual ? <button className="purchase-find" onClick={() => { setMatchesFor(matchesFor === item.id ? '' : item.id); setEditing('') }} aria-expanded={matchesFor === item.id}>Angebote finden</button> : <a href={`/suche?q=${encodeURIComponent(item.title)}`}>Angebote vergleichen →</a> : null}
            </div>
            {!isDone && !item.manual ? <div className="purchase-offer-state">{row?.offer ? <><strong>{money(Math.round(row.offer.priceCurrent.amount * 100))}</strong><span> je Packung · aktuell bestätigt</span><p>{money(row.cents)} für {row.quantity} {row.quantity === 1 ? 'Packung' : 'Packungen'}</p></> : <p>{row?.issue === 'Aktuelles Angebot nicht bestätigt' ? 'Preis noch nicht aktuell geprüft.' : row?.issue} Keine Preisannahme in deiner Teilsumme.</p>}</div> : null}
            {!item.manual ? <details className="purchase-details"><summary>Produkt und Bedingungen</summary>{row?.offer ? <OfferCardConsumer offer={{ ...row.offer, referencePrice: null, priceReference: null, savings: null, savingsAmount: null, savingsPercent: null, hasKnownSavings: false, discountPercent: null, discountUpToPercent: null, comparisonAlternative: null }} showShoppingListAction={false} /> : <p>{item.quantityText || 'Packungsgröße nicht hinterlegt'} · {item.conditionsText || 'Bedingungen vor dem Einkauf erneut prüfen'}. Gespeicherte Preise werden ohne aktuelle Bestätigung nicht angezeigt.</p>}</details> : null}
            {item.manual && matchesFor === item.id && !isDone ? <WishOffers key={`${item.id}:${item.title}`} item={item} existingIds={existingIds} onSelect={offer => selectOffer(item, offer, quantity)} onClose={() => setMatchesFor('')} /> : null}
            </div>
          </article>
        })}</div>
      </div>)}</div>
      {items.length > 0 ? <div className="purchase-list-footer"><button onClick={share} disabled={busy}>{busy ? 'Bitte warten …' : 'Liste teilen'}</button><button onClick={reuse}>Liste wiederverwenden</button><details><summary>Weitere Aktionen</summary><button onClick={() => setHide(!hide)} aria-pressed={hide}>{hide ? 'Erledigte anzeigen' : 'Erledigte ausblenden'}</button><button onClick={() => { if (clearConfirm) { onClearList(); setQuotes({}); setChecked(new Set()); setQuantities({}); setClearConfirm(false); setNotice('Liste geleert.') } else setClearConfirm(true) }}>{clearConfirm ? 'Leeren bestätigen' : 'Liste leeren'}</button>{clearConfirm ? <button onClick={() => setClearConfirm(false)}>Abbrechen</button> : null}</details></div> : null}
      {shareLink ? <div className="purchase-share"><label htmlFor="list-share-link">Dein Listenlink</label><input id="list-share-link" readOnly value={shareLink} onFocus={e => e.target.select()} /><p>Wer den Link hat, kann diesen Stand deiner Liste 14 Tage lang ansehen. Spätere Änderungen werden nicht übertragen. Preise müssen Empfänger neu prüfen.</p>{typeof navigator.share === 'function' ? <button onClick={systemShare}>Über das Gerät teilen</button> : null}</div> : null}
    </section>
    <section id="sparplan" className="assistant-plan panel" aria-labelledby="plan-title">
      <span className="purchase-plan-label">DEIN NÄCHSTER SCHRITT</span><h2 id="plan-title">Dein Sparplan</h2><p>Kaufklug prüft passende aktuelle Angebote und zeigt dir, wo sich ein Vergleich lohnt.</p>
      {!items.length ? <p>Füge dein erstes Produkt hinzu. Danach findest du direkt daneben Angebote und kannst deinen Einkauf nach Händlern ordnen.</p> : <>
      <div className="purchase-plan-progress"><strong>{plan.confirmed.length} von {items.length - done}</strong><span>offenen Produkten mit sicher bestätigtem Preis</span></div>
      {plan.confirmed.length ? <div className="assistant-partial"><span>Bestätigte Teilsumme</span><strong>{money(plan.partialCents)}</strong><p>Für {plan.confirmed.length} offene {plan.confirmed.length === 1 ? 'Position' : 'Positionen'} in deinen gewählten Packungsmengen. Keine Ersparnis und kein Gesamtpreis.</p></div> : <p>Dein Einkauf hat noch keine bestätigte Teilsumme. Produkte ohne sicheren Preis bleiben auf deiner Liste.</p>}
      <button className="primary-action-button" disabled={busy || !items.some(i => !i.manual && !checked.has(String(i.id)))} onClick={refresh}>{busy ? 'Angebote werden geprüft …' : 'Gemerkte Angebote prüfen'}</button>
      <p className="assistant-help">Bis zu acht gemerkte Angebote pro Prüfung. Für Produkte ohne Angebot: „Angebote finden“ in deiner Liste wählen.</p>
      {plan.open.length ? <div className="purchase-open"><h3>Noch ohne sicheren Preis</h3><ul>{plan.open.map(r => <li key={r.item.id}>{r.item.title}</li>)}</ul><p>Karten- und Mengenbedingungen oder unklare Angebote werden nicht geschätzt.</p></div> : null}
      {plan.markets.length ? <div className="purchase-market-totals"><h3>Dein Einkauf nach Händlern</h3>{plan.markets.map(key => { const rows = plan.confirmed.filter(r => r.offer.retailerKey === key); return <div key={key}><span>{rows[0].item.retailerName} · {rows.length} {rows.length === 1 ? 'Produkt' : 'Produkte'}</span><strong>{money(rows.reduce((sum, r) => sum + r.cents, 0))}</strong></div> })}<p>Teilsummen ausschließlich für die oben bestätigten Positionen.</p></div> : null}
      <button onClick={() => { setGrouped(true); document.getElementById('deine-liste')?.scrollIntoView({ behavior: 'smooth' }) }}>Liste nach Händlern ansehen ↑</button>
      </>}
      <details className="purchase-plan-limits"><summary>Was kann der Sparplan?</summary><p>Wir kennen nicht das vollständige Sortiment und nicht alle Normalpreise. Ein günstigster Gesamteinkauf, die beste Händlerkombination oder eine gesicherte Gesamtersparnis lassen sich deshalb nicht berechnen. Bestätigte Preise gelten nur kurzzeitig und werden nach dem Neuladen erneut geprüft.</p></details>
      <a className="purchase-browse" href="/stoebern">Stöbern: Angebote nach Händlern</a>
      <p className="assistant-help">Im Geschäft abhaken. Beim nächsten Besuch wiederverwenden. Preise, Bedingungen und Verfügbarkeit bitte im Markt prüfen.</p>
    </section>
    </div>
  </div>
}
