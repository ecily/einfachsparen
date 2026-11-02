import { useEffect, useMemo, useRef, useState } from 'react'
import { createSharedShoppingList } from '../../api'
import { fetchOfferRankingDirect } from '../../utils/apiBase'
import { flattenRankingOffers } from '../../utils/offers'
import { buildShareSnapshot, getShoppingListItemQuantity, loadCheckedShoppingListItems, storeCheckedShoppingListItems } from '../../utils/shoppingList'
import { buildPartialPlan, createWish, nextQuoteExpiry, REFRESH_LIMIT, sameOffer } from '../../utils/shoppingAssistant'
import { OfferCardConsumer } from '../search/OfferCardConsumer'

const QUANTITIES = 'kaufklug.shoppingList.quantities.v1'
const money = cents => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(cents / 100)
function loadQuantities() {
  try { const value = JSON.parse(localStorage.getItem(QUANTITIES) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} }
}
export function ShoppingAssistant({ shoppingListItems: items, onAddWish, onEditWish, onRemoveItem, onClearList, onGoToOffers }) {
  const [wish, setWish] = useState('')
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
  const display = items.filter(i => !hide || !checked.has(String(i.id)))
  if (grouped) display.sort((a, b) => String(a.retailerName).localeCompare(String(b.retailerName), 'de-AT'))

  function add(event) {
    event.preventDefault()
    const item = createWish(wish, crypto.randomUUID())
    if (item && items.length < 100) { onAddWish(item); setWish(''); setNotice('Einkaufswunsch hinzugefügt. Ein passendes Angebot wählst du selbst aus.') }
  }
  function toggle(id) { setChecked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) }
  function reuse() { setChecked(new Set()); setQuotes({}); setNotice('Liste wieder geöffnet. Prüfe die Angebote für deinen nächsten Einkauf neu.') }
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
      setNotice(`${requested} gemerkte Angebote angefragt. ${errors || abort.signal.aborted ? 'Nicht alle Abrufe waren möglich. ' : ''}Nur eindeutig bestätigte Positionen zählen; weitere oder offene Produkte bitte selbst suchen.`)
    } finally { if (controller.current === abort) { controller.current = null; setBusy(false) } }
  }
  async function share() {
    setBusy(true)
    try {
      const snapshot = buildShareSnapshot(items, quantities)
      // Shared lists carry wishes, never a promise that stored prices are still current.
      snapshot.items = snapshot.items.map(i => ({ ...i, priceCurrent: null }))
      const result = await createSharedShoppingList(snapshot)
      if (typeof result.url !== 'string' || !result.url.trim()) throw new Error('Missing share URL')
      const url = new URL(result.url, window.location.origin)
      if (![window.location.origin, 'https://www.kaufklug.at'].includes(url.origin)) throw new Error('Untrusted share origin')
      setShareLink(url.href)
      try { await navigator.clipboard.writeText(url.href); setNotice('Listenlink kopiert. Empfänger müssen aktuelle Angebote erneut prüfen.') }
      catch { setNotice('Listenlink erstellt. Du kannst ihn im Feld kopieren. Empfänger müssen Angebote erneut prüfen.') }
    } catch { setNotice('Teilen nicht abgeschlossen. Deine Liste bleibt auf diesem Gerät gespeichert.') }
    finally { setBusy(false) }
  }
  async function systemShare() {
    try { await navigator.share({ title: 'Meine Kaufklug-Einkaufsliste', url: shareLink }) }
    catch { setNotice('Systemteilen nicht abgeschlossen. Dein Listenlink bleibt verfügbar.') }
  }
  return <div className="assistant-page">
    <header className="assistant-heading"><div><p className="design-eyebrow">DEIN EINKAUFSASSISTENT</p><h1>Dein Einkauf. Gut geplant.</h1><p>Erst notieren, dann passende Angebote prüfen. Deine Liste bleibt auf diesem Gerät erhalten.</p></div><button className="primary-action-button" onClick={onGoToOffers}>Angebote suchen</button></header>
    <form className="assistant-add panel" onSubmit={add}><label htmlFor="wish">Was brauchst du?</label><div><input id="wish" value={wish} onChange={e => setWish(e.target.value)} maxLength={160} required placeholder="z. B. Milch für das Frühstück" /><button className="primary-action-button" disabled={items.length >= 100}>Auf die Liste</button></div>{items.length >= 100 ? <p>Für weitere Wünsche zuerst Positionen entfernen.</p> : null}</form>
    <nav className="assistant-tabs" aria-label="Deinen Einkauf planen"><a href="#deine-liste">1 · Einkaufsliste ({items.length})</a><a href="#sparplan">2 · Sparplan prüfen</a></nav>
    <section id="deine-liste" className="assistant-list" aria-labelledby="list-title"><div className="assistant-section-head"><h2 id="list-title">Deine Einkaufsliste</h2><span>{checked.size ? items.filter(i => checked.has(String(i.id))).length : 0} erledigt</span></div>
      <div className="assistant-toolbar"><button onClick={() => setGrouped(!grouped)} aria-pressed={grouped}>Nach {grouped ? 'Produkten' : 'Händlern'} ansehen</button><button onClick={() => setHide(!hide)} aria-pressed={hide}>{hide ? 'Erledigte anzeigen' : 'Erledigte ausblenden'}</button><button onClick={reuse}>Liste wiederverwenden</button><button disabled={!items.length || busy} onClick={share}>Liste teilen</button><button disabled={!items.length} onClick={() => { if (clearConfirm) { onClearList(); setQuotes({}); setChecked(new Set()); setClearConfirm(false) } else setClearConfirm(true) }}>{clearConfirm ? 'Leeren bestätigen' : 'Liste leeren'}</button>{clearConfirm ? <button onClick={() => setClearConfirm(false)}>Abbrechen</button> : null}</div>
      {shareLink ? <div className="assistant-add panel"><label htmlFor="list-share-link">Listenlink</label><input id="list-share-link" readOnly value={shareLink} /><p>Dieser Link enthält die Liste zum Zeitpunkt des Teilens. Aktuelle Preise müssen Empfänger neu prüfen.</p>{typeof navigator.share === 'function' ? <button onClick={systemShare}>Über das Gerät teilen</button> : null}</div> : null}
      {!items.length ? <p className="assistant-empty">Dein nächster Einkauf beginnt hier. Notiere einen Wunsch oder merke ein Angebot aus der Suche.</p> : null}
      {items.length && !display.length ? <p>Alles abgehakt. Mit „Liste wiederverwenden“ startest du deinen nächsten Einkauf.</p> : null}
      <div className="assistant-items">{display.map(item => {
        const row = plan.rows.find(r => r.item.id === item.id)
        const quantity = getShoppingListItemQuantity(item, quantities)
        return <article key={item.id} className={`assistant-item${checked.has(String(item.id)) ? ' assistant-item--done' : ''}`}>
          <label className="assistant-check"><input type="checkbox" checked={checked.has(String(item.id))} onChange={() => toggle(String(item.id))} aria-label={`${item.title} abhaken`} /><span>{item.title}</span></label>
          <p className="assistant-item-meta">{item.manual ? 'Einkaufswunsch · noch ohne Angebot' : `${item.retailerName} · gespeichertes Angebot`}</p>
          {item.manual ? <label className="assistant-edit">Wunsch bearbeiten<input defaultValue={item.title} key={`${item.id}:${item.title}`} maxLength={160} onBlur={e => { const value = e.target.value.trim(); if (value) onEditWish(item.id, value); else e.target.value = item.title }} /></label> : <details><summary>Produkt und Bedingungen ansehen</summary>{row?.offer ? <OfferCardConsumer offer={{ ...row.offer, referencePrice: null, priceReference: null, savings: null, savingsAmount: null, savingsPercent: null, hasKnownSavings: false, discountPercent: null, discountUpToPercent: null, comparisonAlternative: null }} showShoppingListAction={false} /> : <p>{item.quantityText || 'Packungsgröße nicht hinterlegt'} · {item.conditionsText || 'Bedingungen vor dem Einkauf erneut prüfen'}. Gespeicherte Preise werden ohne aktuelle Bestätigung nicht angezeigt.</p>}</details>}
          <div className="assistant-item-actions"><label>Packungen <input type="number" min="1" max="99" value={quantity} onChange={e => setQuantities(q => ({ ...q, [item.id]: Math.max(1, Math.min(99, Math.floor(Number(e.target.value)) || 1)) }))} aria-label={`Packungen für ${item.title}`} /></label><a href={`/suche?q=${encodeURIComponent(item.title)}`}>Passende Angebote suchen</a><button onClick={() => onRemoveItem(item.id)} aria-label={`${item.title} entfernen`}>Entfernen</button></div>
          {!checked.has(String(item.id)) ? <p className="assistant-item-state">{row?.issue || `Bestätigter Packungspreis: ${money(Math.round(row.offer.priceCurrent.amount * 100))}`}</p> : null}
        </article>
      })}</div>
    </section>
    <section id="sparplan" className="assistant-plan panel" aria-labelledby="plan-title"><p className="design-eyebrow">KLARE ENTSCHEIDUNGEN STATT VERSPRECHEN</p><h2 id="plan-title">Dein Kaufklug-Sparplan</h2><p>Wir kennen nicht alle Normalpreise oder das vollständige Sortiment jedes Marktes. Deshalb zeigen wir nur belegbare Teilvergleiche, keinen vollständigen Warenkorbpreis.</p><button className="primary-action-button" disabled={busy || !items.some(i => !i.manual && !checked.has(String(i.id)))} onClick={refresh}>{busy ? 'Angebote werden geprüft …' : 'Gemerkte Angebote jetzt prüfen'}</button><p className="assistant-help">Bis zu acht gemerkte Angebote pro Prüfung. Nur dieselbe Angebots-ID, derselbe Händler und Produkttitel werden zugeordnet. Andere Treffer bleiben eine manuelle Auswahl.</p>
      <div className="assistant-options"><article><span>A · Einfach einkaufen</span><h3>Nach Händlern sortieren</h3><p>Die bestätigten Positionen verteilen sich auf {plan.markets.length} Händler. Nutze die Händleransicht, um deinen Einkauf zu strukturieren.</p><button onClick={() => { setGrouped(true); document.getElementById('deine-liste')?.scrollIntoView({ behavior: 'smooth' }) }}>Händleransicht öffnen</button><small>Keine Zusage der kleinstmöglichen Händlerzahl.</small></article><article><span>B · Bester Kompromiss</span><h3>Abwägung noch offen</h3><p>Für eine belastbare Empfehlung fehlen vollständige gleichwertige Alternativen und der zusätzliche Einkaufsaufwand.</p><button disabled>Optimierung nicht verfügbar</button></article><article><span>C · Maximal sparen</span><h3>Kein Bestpreisversprechen</h3><p>Ohne vollständige Produktidentität, Mengen und aktuelle Preise aller passenden Angebote lässt sich kein günstigster Gesamteinkauf belegen.</p><button disabled>Optimierung nicht verfügbar</button></article></div>
      {plan.confirmed.length ? <p className="assistant-partial"><strong>{money(plan.partialCents)}</strong> für {plan.confirmed.length} bestätigte, offene Listenpositionen in deinen gewählten Packungsmengen. <strong>Nur Teilsumme, keine Ersparnis und kein Gesamtwarenkorb.</strong></p> : <p>Aktuell keine belastbare Preis-Teilsumme. Prüfe gemerkte Angebote oder suche passende Angebote zu deinen Wünschen.</p>}
      <p>{plan.open.length} offene Positionen ohne sicher summierbaren Preis. Karten-/Mengenbedingungen, unklare Fristen oder fehlende Bestätigung werden nicht geschätzt. Preise und Verfügbarkeit im Markt prüfen.</p><p>Benachrichtigungen sind nicht aktiviert. Beim nächsten Besuch kannst du deine Liste wiederverwenden und Angebote erneut prüfen.</p>
    </section>
    {notice ? <p className="assistant-notice" role="status">{notice}</p> : null}
  </div>
}
