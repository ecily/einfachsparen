import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import './index.css'
import {
  fetchCurrentUserPreferences,
  fetchDashboardSnapshot,
  fetchEssence,
  fetchHealth,
  fetchOfferRanking,
  getOfferImageUrl,
  saveCurrentUserPreferences,
  saveFeedback,
} from './api'

function getOfferCategoryLabel(offer) {
  return offer?.displayCategory || offer?.categorySecondary || offer?.categoryPrimary || 'ohne Kategorie'
}

function formatValidityLabel(offer) {
  const hasValidFrom = Boolean(offer?.validFrom)
  const hasValidTo = Boolean(offer?.validTo)

  if (hasValidFrom && hasValidTo) {
    return `gueltig von ${dayjs(offer.validFrom).format('DD.MM.YYYY')} bis ${dayjs(offer.validTo).format('DD.MM.YYYY')}`
  }

  if (hasValidFrom) {
    return `gueltig ab ${dayjs(offer.validFrom).format('DD.MM.YYYY')}`
  }

  if (hasValidTo) {
    return `gueltig bis ${dayjs(offer.validTo).format('DD.MM.YYYY')}`
  }

  return 'aktuell verfuegbar, Enddatum nicht erkannt'
}

function normalizeCategoryLabel(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeRetailerKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const CATEGORY_GROUP_RULES = [
  { mainCategory: 'Wein', patterns: ['weisswein', 'weißwein', 'rotwein', 'rose', 'rosé', 'wein', 'schaumwein', 'perlwein', 'sekt', 'dessertwein', 'portwein'] },
  { mainCategory: 'Bier', patterns: ['bier', 'flaschenbier', 'dosenbier', 'radler', 'weizenbier', 'helles'] },
  { mainCategory: 'Spirituosen', patterns: ['aperitif', 'digestif', 'schnaps', 'vodka', 'gin', 'likor', 'likör', 'cognac', 'whiskey', 'alkohol'] },
  { mainCategory: 'Kaffee', patterns: ['kaffee', 'ganze bohne', 'gemahlen', 'eiskaffee', 'loslich', 'löslich', 'kapseln', 'pads', 'espresso'] },
  { mainCategory: 'Mehl', patterns: ['weizenmehl', 'dinkelmehl', 'mehl'] },
  { mainCategory: 'Oel', patterns: ['raps', 'olive', 'olivenol', 'olivenöl', 'oel', 'öl'] },
  { mainCategory: 'Konserven', patterns: ['konserven', 'eingelegtes', 'in sose', 'in soße', 'in ol', 'in öl', 'im eigenen saft', 'geschalte tomaten', 'geschälte tomaten', 'gestuckelte tomaten', 'gestückelte tomaten'] },
  {
    mainCategory: 'Wasser, Saefte & Softdrinks',
    patterns: ['limonaden', 'mineralwasser', 'wasser', 'sirupe', 'energydrinks', 'eistee', 'smoothies', 'fresh juice', 'safte', 'saefte', 'getranke', 'getraenke', 'milch joghurtgetranke', 'milch joghurtgetraenke', 'kindergetranke', 'kindergetraenke', 'alkoholfreie alternativen', 'still', 'prickelnd'],
  },
  {
    mainCategory: 'Kaese & Feinkost',
    patterns: ['kase', 'käse', 'hartkase', 'hartkäse', 'frischkase', 'frischkäse', 'huttenkase', 'hüttenkäse', 'feta', 'mozarella', 'mozzarella', 'weichkase', 'weichkäse', 'schmelzkase', 'schmelzkäse', 'grill brat', 'ofenkase', 'ofenkäse', 'feinkost'],
  },
  {
    mainCategory: 'Milchprodukte & Fruehstueck',
    patterns: ['fruchtjoghurt', 'milchalternativen', 'milchprodukte', 'cornflakes', 'cerealien', 'hafer', 'musli', 'müsli', 'aufstriche', 'susse aufstriche', 'süße aufstriche', 'schoko nussaufstriche', 'marmeladen', 'nussmuse', 'kakao'],
  },
  {
    mainCategory: 'Brot, Gebaeck & Suesses Gebaeck',
    patterns: ['brot', 'geback', 'gebäck', 'aufbackbrotchen', 'aufbackbrötchen', 'baguette', 'weissbrote', 'weißbrote', 'brioche', 'striezel', 'plunder', 'kuchen', 'muffins', 'konditorei', 'desserts', 'waffeln'],
  },
  {
    mainCategory: 'Suesses & Snacks',
    patterns: ['tafelschokolade', 'schokolade', 'fruchtgummi', 'schnitten', 'schokoriegel', 'kekse', 'chips', 'knabberein', 'snacks', 'susswaren', 'suesswaren', 'sussigkeiten', 'süßigkeiten', 'susses', 'süßes', 'zuckerl', 'bonbons', 'traubenzucker', 'nachos', 'dips', 'kaugummi', 'proteinriegel', 'kleine snacks'],
  },
  {
    mainCategory: 'Tiefkuehlkost & Eis',
    patterns: ['tiefkuhl', 'tiefkühl', 'pizza', 'pommes', 'eis', 'eiscreme', 'eis am stiel', 'stanizl', 'eis snacks', 'menuschalen', 'menüschalen', 'fertiggerichte'],
  },
  {
    mainCategory: 'Kochen & Vorrat',
    patterns: ['asien', 'sugo', 'reis', 'pasta', 'beilagen', 'kochzutaten', 'dressings', 'wurzsauce', 'würzsauce', 'pasten', 'basis', 'fixprodukte', 'gewurz', 'gewürz', 'bohnen', 'mais', 'champions', 'pesto', 'ketchup', 'mayonaise', 'senf', 'kren', 'suppen', 'kapern', 'linsen', 'erbsen', 'hulsenfruchte', 'hülsenfrüchte', 'essig', 'tomatenprodukte', 'spaghetti', 'penne', 'fussili', 'fusilli'],
  },
  {
    mainCategory: 'Obst & Gemuese',
    patterns: ['gemuse', 'gemüse', 'obst', 'gurken', 'kartoffeln', 'salate', 'apfel', 'birnen', 'trauben', 'zitrusfruchte', 'zitrusfrüchte', 'steinobst', 'beeren', 'tomaten'],
  },
  {
    mainCategory: 'Fleisch, Wurst & Fisch',
    patterns: ['fisch', 'fleisch', 'wurst', 'schinken', 'salami', 'geflugel', 'geflügel', 'speck', 'rindfleisch', 'schweinefleisch', 'huhn', 'tofu', 'seitan'],
  },
  {
    mainCategory: 'Drogerie & Hygiene',
    patterns: ['duschgele', 'shampoo', 'spulung', 'spülung', 'einlagen', 'binden', 'deoderants', 'deodorants', 'gesichtspflege', 'reinigung', 'zahnbursten', 'zahnbürsten', 'zahnpasta', 'pflege', 'drogerie', 'hygiene', 'hand', 'ganzkorper', 'ganzkörper'],
  },
  { mainCategory: 'Baby & Kind', patterns: ['windeln', 'babynahrung', 'glaschen', 'gläschen', 'baby'] },
  {
    mainCategory: 'Haushalt & Reinigung',
    patterns: ['haushalt', 'tabs', 'reinigungsgerate', 'reinigungsgeräte', 'tucher', 'tücher', 'kuchenreiniger', 'küchenreiniger', 'spulmittel', 'spülmittel', 'badreiniger', 'weichspuler', 'weichspüler', 'beutel', 'folien'],
  },
  { mainCategory: 'Tierbedarf', patterns: ['katze', 'katzepflege', 'hund', 'tier'] },
]

function getMainCategoryLabel(category) {
  const normalized = normalizeCategoryLabel(category)

  if (/(weisswein|weiss|rotwein|rose|ros[eé]|schaumwein|perlwein|prosecco|sekt|aperitif|digestif)/.test(normalized)) return 'Wein'
  if (/(flaschenbier|dosenbier|helles|bier|radler|weizenbier)/.test(normalized)) return 'Bier'
  if (/(gemahlen|ganze bohne|eiskaffee|kaffee|capsules|kapseln|espresso)/.test(normalized)) return 'Kaffee'
  if (/(limonaden|mineralwasser|wasser|frucht gemusesafte|frucht gemuesesafte|sirupe|energydrinks|eistee|smoothies|milch joghurtgetranke|milch joghurtgetranke)/.test(normalized)) return 'Alkoholfreie Getraenke'
  if (/(hartkase|frischkase|huttenkase|huettenkase|feta|mozarella|kase)/.test(normalized)) return 'Kaese'
  if (/(pizza|pommes|eiscreme|eis am stiel|stanizl|tiefkuhl|tiefkuehl)/.test(normalized)) return 'Tiefkuehlkost'
  if (/(reis|pasta|beilagen|sugo|wurzsauce|wurzsauce|pesto|kochzutaten|dressings|basis fixprodukte|mais champions|bohnen|frische pasta)/.test(normalized)) return 'Kochen & Vorrat'
  if (/(tafelschokolade|fruchtgummi|schnitten|kekse|chips|knabberein|snacks|susswaren|suesswaren|schokoriegel|zuckerl|bonbons|nachos dips)/.test(normalized)) return 'Suesses & Snacks'
  if (/(duschgele|shampoo|spulung|spuelung|deoderants|windeln|einlagen binden|gesichtspflege und reinigung|zahnbursten aufsteckbursten|zahnbuersten aufsteckbuersten)/.test(normalized)) return 'Drogerie & Hygiene'
  if (/(tabs pads|reinigungsgerate tucher|reinigungsgeraete tuecher)/.test(normalized)) return 'Haushalt'

  return category
}

function resolveMainCategoryLabel(category) {
  const normalized = normalizeCategoryLabel(category)

  for (const group of CATEGORY_GROUP_RULES) {
    if (group.patterns.some((pattern) => normalized.includes(pattern))) {
      return group.mainCategory
    }
  }

  if (normalized === 'lebensmittel') return 'Weitere Lebensmittel'
  if (normalized === 'getraenke' || normalized === 'getranke') return 'Weitere Getraenke'

  return getMainCategoryLabel(category) || category || 'Weitere Kategorien'
}

function buildCategoryGroups(categories = []) {
  const grouped = new Map()

  for (const category of categories) {
    const mainCategory = resolveMainCategoryLabel(category)

    if (!grouped.has(mainCategory)) {
      grouped.set(mainCategory, [])
    }

    grouped.get(mainCategory).push(category)
  }

  return [...grouped.entries()]
    .map(([mainCategory, subcategories]) => ({
      mainCategory,
      subcategories: [...new Set(subcategories)].sort((left, right) => left.localeCompare(right, 'de')),
    }))
    .sort((left, right) => left.mainCategory.localeCompare(right.mainCategory, 'de'))
}

function flattenRankingOffers(ranking) {
  const seen = new Set()
  const offers = []

  for (const group of ranking?.rankedGroups || []) {
    for (const offer of group.offers || []) {
      const offerId = offer?.id || offer?._id || `${offer?.title}-${offer?.retailerName}-${offer?.priceCurrent?.amount}`

      if (seen.has(offerId)) continue

      seen.add(offerId)
      offers.push({
        ...offer,
        id: offerId,
      })
    }
  }

  return offers
}

function getOfferRetailerKey(offer, retailers = []) {
  if (offer?.retailerKey) return offer.retailerKey

  const fromLookup = (retailers || []).find((item) => item.retailerName === offer?.retailerName)
  if (fromLookup?.retailerKey) return fromLookup.retailerKey

  return normalizeRetailerKey(offer?.retailerName)
}

function filterOffers(offers, filters, retailers) {
  const searchNeedle = String(filters.queryInput || '').trim().toLowerCase()

  if (!filters.selectedRetailers.length) {
    return []
  }

  return (offers || []).filter((offer) => {
    const offerRetailerKey = getOfferRetailerKey(offer, retailers)
    const offerCategory = getOfferCategoryLabel(offer)

    if (!filters.selectedRetailers.includes(offerRetailerKey)) {
      return false
    }

    if (filters.selectedCategories.length > 0 && !filters.selectedCategories.includes(offerCategory)) {
      return false
    }

    if (offer.customerProgramRequired && !filters.retailerPrograms?.[offerRetailerKey]) {
      return false
    }

    if (searchNeedle) {
      const haystack = [
        offer.title,
        offer.retailerName,
        offerCategory,
        offer.categoryPrimary,
        offer.categorySecondary,
        offer.quantityText,
        offer.conditionsText,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      if (!haystack.includes(searchNeedle)) {
        return false
      }
    }

    return true
  })
}

function buildClientRanking(baseRanking, filteredOffers) {
  const grouped = new Map()

  for (const offer of filteredOffers) {
    const unit = offer?.normalizedUnitPrice?.unit || 'ohne Einheit'

    if (!grouped.has(unit)) {
      grouped.set(unit, [])
    }

    grouped.get(unit).push(offer)
  }

  const rankedGroups = [...grouped.entries()]
    .map(([unit, offers]) => {
      const sortedOffers = [...offers].sort((left, right) => {
        const leftUnit = Number(left?.normalizedUnitPrice?.amount ?? Number.MAX_SAFE_INTEGER)
        const rightUnit = Number(right?.normalizedUnitPrice?.amount ?? Number.MAX_SAFE_INTEGER)

        if (leftUnit !== rightUnit) return leftUnit - rightUnit

        const leftPrice = Number(left?.priceCurrent?.amount ?? Number.MAX_SAFE_INTEGER)
        const rightPrice = Number(right?.priceCurrent?.amount ?? Number.MAX_SAFE_INTEGER)

        return leftPrice - rightPrice
      })

      return { unit, offers: sortedOffers }
    })
    .sort((left, right) => {
      const leftBest = Number(left.offers?.[0]?.normalizedUnitPrice?.amount ?? Number.MAX_SAFE_INTEGER)
      const rightBest = Number(right.offers?.[0]?.normalizedUnitPrice?.amount ?? Number.MAX_SAFE_INTEGER)
      return leftBest - rightBest
    })

  const firstBestOffer = rankedGroups[0]?.offers?.[0]
  const resultCount = filteredOffers.length

  return {
    ...baseRanking,
    rankedGroups,
    summary: {
      ...(baseRanking?.summary || {}),
      resultCount,
      displayedCount: resultCount,
      completeResultSetVisible: true,
      bestUnitPrice: firstBestOffer?.normalizedUnitPrice
        ? `${firstBestOffer.normalizedUnitPrice.amount}/${firstBestOffer.normalizedUnitPrice.unit}`
        : '-',
    },
  }
}

function HeroLoaderModal({ open }) {
  if (!open) return null

  return (
    <div
      aria-live="polite"
      aria-busy="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(12, 16, 26, 0.68)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <style>{`
        @keyframes kkSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      <div
        className="panel"
        style={{
          width: 'min(92vw, 520px)',
          textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div className="panel__header" style={{ alignItems: 'center' }}>
          <h2>Einen Moment, wir suchen gerade ...</h2>
          <p>kaufklug.at laedt passende Angebote und deine gespeicherten Einstellungen.</p>
        </div>

        <div
          style={{
            width: '48px',
            height: '48px',
            margin: '8px auto 0',
            borderRadius: '999px',
            border: '4px solid rgba(255,255,255,0.18)',
            borderTopColor: 'currentColor',
            animation: 'kkSpin 0.9s linear infinite',
          }}
        />
      </div>
    </div>
  )
}

function ProductImage({ offerId, src, alt, compact = false }) {
  const primarySrc = offerId ? getOfferImageUrl(offerId) : src
  const [currentSrc, setCurrentSrc] = useState(primarySrc || src || '')
  const [fallbackTried, setFallbackTried] = useState(false)

  useEffect(() => {
    setCurrentSrc(primarySrc || src || '')
    setFallbackTried(false)
  }, [primarySrc, src])

  if (!currentSrc) {
    return (
      <div className={`product-image product-image--placeholder ${compact ? 'product-image--compact' : ''}`}>
        <span>Kein Bild</span>
      </div>
    )
  }

  return (
    <div className={`product-image ${compact ? 'product-image--compact' : ''}`}>
      <img
        src={currentSrc}
        alt={alt}
        loading="lazy"
        onError={() => {
          if (!fallbackTried && src && currentSrc !== src) {
            setFallbackTried(true)
            setCurrentSrc(src)
            return
          }

          setCurrentSrc('')
        }}
      />
    </div>
  )
}

function CategoryMenu({ categories, selectedCategories, onToggle, onToggleMainCategory, onClear, onDone, disabled }) {
  const [expandedGroups, setExpandedGroups] = useState({})
  const groups = buildCategoryGroups(categories)

  if (disabled) {
    return (
      <div className="category-picker__header">
        <div>
          <h3>Kategorien</h3>
          <p>Waehle zuerst mindestens einen Supermarkt aus. Danach kannst du die Treffer per Kategorie eingrenzen.</p>
        </div>
        <button type="button" className="ghost-button" onClick={onDone}>
          Fertig
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="category-picker__header" style={{ marginBottom: '0.75rem' }}>
        <div>
          <h3>Kategorien</h3>
          <p>Wandle deine Supermarkt-Auswahl jetzt in passende Produktbereiche um.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="ghost-button" onClick={onDone}>
            Fertig
          </button>
          <button type="button" className="ghost-button" onClick={onClear}>
            Zuruecksetzen
          </button>
        </div>
      </div>

      <div className="category-group-list">
        {groups.map((group) => {
          const selectedCount = group.subcategories.filter((category) => selectedCategories.includes(category)).length
          const allSelected = selectedCount === group.subcategories.length && group.subcategories.length > 0
          const partiallySelected = selectedCount > 0 && !allSelected
          const expanded = Boolean(expandedGroups[group.mainCategory]) || selectedCount > 0

          return (
            <div className="category-group" key={group.mainCategory}>
              <div className="category-group__top">
                <button
                  type="button"
                  className={`chip ${allSelected ? 'chip--active' : partiallySelected ? 'chip--partial' : ''}`}
                  onClick={() => onToggleMainCategory(group.mainCategory, group.subcategories)}
                >
                  {group.mainCategory} ({group.subcategories.length})
                </button>

                <button
                  type="button"
                  className="ghost-button ghost-button--small"
                  onClick={() =>
                    setExpandedGroups((current) => ({
                      ...current,
                      [group.mainCategory]: !current[group.mainCategory],
                    }))
                  }
                >
                  {expanded ? 'Unterkategorien verbergen' : 'Unterkategorien zeigen'}
                </button>
              </div>

              {expanded ? (
                <div className="chip-grid chip-grid--subcategories">
                  {group.subcategories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={`chip chip--subtle ${selectedCategories.includes(category) ? 'chip--active' : ''}`}
                      onClick={() => onToggle(category)}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RetailerMenu({ retailers, selectedRetailers, onToggle, onClear, onDone }) {
  return (
    <div>
      <div className="category-picker__header" style={{ marginBottom: '0.75rem' }}>
        <div>
          <h3>Supermaerkte</h3>
          <p>Diese Auswahl bestimmt, in welchen Maerkten wir fuer dich ueberhaupt suchen.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="ghost-button" onClick={onDone}>
            Fertig
          </button>
          <button type="button" className="ghost-button" onClick={onClear}>
            Zuruecksetzen
          </button>
        </div>
      </div>

      <div className="chip-grid">
        {(retailers || []).map((retailer) => (
          <button
            key={retailer.retailerKey}
            type="button"
            className={`chip ${selectedRetailers.includes(retailer.retailerKey) ? 'chip--active' : ''}`}
            onClick={() => onToggle(retailer.retailerKey)}
          >
            {retailer.retailerName}
          </button>
        ))}
      </div>
    </div>
  )
}

function ProgramMenu({ retailers, selectedRetailers, retailerPrograms, onToggleProgram, onDone }) {
  const visibleRetailers = (retailers || []).filter((retailer) => selectedRetailers.includes(retailer.retailerKey))

  if (visibleRetailers.length === 0) {
    return (
      <div className="category-picker__header">
        <div>
          <h3>Kundenkarte / App</h3>
          <p>Waehle zuerst mindestens einen Supermarkt aus. Danach kannst du Angebote mit App- oder Kartenpflicht einbeziehen.</p>
        </div>
        <button type="button" className="ghost-button" onClick={onDone}>
          Fertig
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="category-picker__header" style={{ marginBottom: '0.75rem' }}>
        <div>
          <h3>Kundenkarte / App</h3>
          <p>Aktiviere dies nur fuer Maerkte, bei denen du Karte oder App wirklich nutzt.</p>
        </div>
        <button type="button" className="ghost-button" onClick={onDone}>
          Fertig
        </button>
      </div>

      <div className="program-settings">
        {visibleRetailers.map((retailer) => (
          <label className="program-filter" key={retailer.retailerKey}>
            <input
              type="checkbox"
              checked={Boolean(retailerPrograms?.[retailer.retailerKey])}
              onChange={(event) => onToggleProgram(retailer.retailerKey, event.target.checked)}
            />
            <div>
              <strong>{retailer.retailerName}: Kundenkarte/App vorhanden</strong>
              <p>Wenn aktiv, zeigen wir auch Angebote, die nur mit Kundenkarte oder App gelten.</p>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}

function SearchResultGroups({ ranking }) {
  const groups = ranking?.rankedGroups || []

  if (groups.length === 0) {
    return <p className="status">Keine passenden Angebote fuer den aktuellen Filter gefunden.</p>
  }

  return (
    <div className="user-group-list">
      {groups.map((group) => (
        <section className="user-group" key={group.unit}>
          <div className="user-group__header">
            <div>
              <h3>{group.unit} direkt vergleichbar</h3>
              <p>Bestes Angebot zuerst, danach die weiteren Treffer derselben Einheit.</p>
            </div>
            <span className="pill pill--reviewed">{group.offers.length} Treffer</span>
          </div>

          <div className="user-results">
            {group.offers.map((offer, index) => (
              <article className={`user-card ${index === 0 ? 'user-card--best' : ''}`} key={offer.id}>
                <ProductImage offerId={offer.id} src={offer.imageUrl} alt={offer.title} />

                <div className="user-card__content">
                  <div className="user-card__top">
                    <div>
                      <div className="user-card__eyebrow">
                        <span>Rang {index + 1}</span>
                        <span>{offer.retailerName}</span>
                        <span>{getOfferCategoryLabel(offer)}</span>
                        {offer.customerProgramRequired ? <span>nur mit Kundenkarte/App</span> : <span>ohne Kundenkarte/App</span>}
                      </div>
                      <h3>{offer.title}</h3>
                    </div>

                    <div className="user-card__price">
                      {offer.conditionsText ? <span className="user-card__price-condition">{offer.conditionsText}</span> : null}
                      <strong>{offer.priceCurrent?.amount} {offer.priceCurrent?.currency}</strong>
                      <span>{offer.normalizedUnitPrice?.amount}/{offer.normalizedUnitPrice?.unit}</span>
                    </div>
                  </div>

                  <div className="user-card__facts">
                    <span>Menge: {offer.quantityText || 'nicht erkannt'}</span>
                    <span>Gueltigkeit: {formatValidityLabel(offer)}</span>
                  </div>

                  <div className="user-card__highlights">
                    <div className="highlight-pill highlight-pill--price">
                      <span>Vergleichspreis</span>
                      <strong>{offer.normalizedUnitPrice?.amount}/{offer.normalizedUnitPrice?.unit}</strong>
                    </div>

                    <div className="highlight-pill">
                      <span>Ersparnis zum alten Preis</span>
                      <strong>{offer.savingsAmount !== null ? `${offer.savingsAmount} EUR` : 'nicht ableitbar'}</strong>
                    </div>

                    <div className="highlight-pill">
                      <span>Nur mit App/Kundenkarte?</span>
                      <strong>{offer.customerProgramRequired ? 'Ja' : 'Nein'}</strong>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ActiveFilterChips({
  selectedRetailers,
  selectedCategories,
  retailerPrograms,
  retailers,
  queryInput,
  onRemoveRetailer,
  onRemoveCategory,
  onClearQuery,
  onRemoveProgram,
  onOpenRetailers,
}) {
  const retailerLookup = useMemo(() => {
    return new Map((retailers || []).map((retailer) => [retailer.retailerKey, retailer.retailerName]))
  }, [retailers])

  const activeProgramKeys = Object.entries(retailerPrograms || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([retailerKey]) => retailerKey)

  const hasAnyFilters = selectedRetailers.length > 0 || selectedCategories.length > 0 || activeProgramKeys.length > 0 || Boolean(queryInput.trim())

  if (!hasAnyFilters) {
    return (
      <div
        style={{
          marginTop: '0.85rem',
          paddingTop: '0.85rem',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'grid',
          gap: '0.35rem',
        }}
      >
        <p style={{ margin: 0, opacity: 0.82 }}>Starte mit deinen Supermaerkten. Suche und Kategorien wirken nur innerhalb dieser Auswahl.</p>
        <div>
          <button type="button" className="chip chip--active" onClick={onOpenRetailers}>
            Supermaerkte auswaehlen
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        marginTop: '0.85rem',
        paddingTop: '0.85rem',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'grid',
        gap: '0.55rem',
      }}
    >
      <div className="chip-grid">
        {selectedRetailers.map((retailerKey) => (
          <button key={`retailer-${retailerKey}`} type="button" className="chip chip--active" onClick={() => onRemoveRetailer(retailerKey)}>
            {retailerLookup.get(retailerKey) || retailerKey} ×
          </button>
        ))}

        {queryInput.trim() ? (
          <button type="button" className="chip chip--active" onClick={onClearQuery}>
            Suchbegriff: {queryInput.trim()} ×
          </button>
        ) : null}

        {selectedCategories.map((category) => (
          <button key={`category-${category}`} type="button" className="chip chip--subtle chip--active" onClick={() => onRemoveCategory(category)}>
            {category} ×
          </button>
        ))}

        {activeProgramKeys.map((retailerKey) => (
          <button key={`program-${retailerKey}`} type="button" className="chip chip--subtle chip--active" onClick={() => onRemoveProgram(retailerKey)}>
            Kundenkarte/App: {retailerLookup.get(retailerKey) || retailerKey} ×
          </button>
        ))}
      </div>
    </div>
  )
}

function SearchPage({
  ranking,
  rankingLoading,
  preferencesLoading,
  selectedCategories,
  selectedRetailers,
  queryInput,
  retailerPrograms,
  onToggleCategory,
  onToggleMainCategory,
  onToggleRetailer,
  onClearCategories,
  onClearRetailers,
  onQueryChange,
  onToggleRetailerProgram,
}) {
  const [openMenu, setOpenMenu] = useState(null)
  const stickyRef = useRef(null)
  const isPageBusy = rankingLoading || preferencesLoading
  const hasRetailerScope = selectedRetailers.length > 0
  const trimmedQuery = queryInput.trim()

  const allOffers = useMemo(() => flattenRankingOffers(ranking), [ranking])

  const scopedOffersForRetailers = useMemo(() => {
    if (!hasRetailerScope) return []

    return allOffers.filter((offer) => {
      const offerRetailerKey = getOfferRetailerKey(offer, ranking?.retailers || [])
      return selectedRetailers.includes(offerRetailerKey)
    })
  }, [allOffers, hasRetailerScope, ranking?.retailers, selectedRetailers])

  const availableCategories = useMemo(() => {
    const categorySet = new Set()

    for (const offer of scopedOffersForRetailers) {
      const categoryLabel = getOfferCategoryLabel(offer)
      if (categoryLabel) categorySet.add(categoryLabel)
    }

    return [...categorySet].sort((left, right) => left.localeCompare(right, 'de'))
  }, [scopedOffersForRetailers])

  const filteredOffers = useMemo(() => {
    return filterOffers(
      allOffers,
      {
        queryInput,
        selectedCategories,
        selectedRetailers,
        retailerPrograms,
      },
      ranking?.retailers || []
    )
  }, [allOffers, queryInput, selectedCategories, selectedRetailers, retailerPrograms, ranking?.retailers])

  const clientRanking = useMemo(() => buildClientRanking(ranking, filteredOffers), [ranking, filteredOffers])

  const totalOfferCount = allOffers.length
  const visibleOfferCount = filteredOffers.length
  const retailerCount = ranking?.retailers?.length || 0
  const categoryCount = availableCategories.length
  const selectedRetailerCount = selectedRetailers.length
  const selectedCategoryCount = selectedCategories.length
  const savedProgramCount = Object.values(retailerPrograms || {}).filter(Boolean).length
  const hasRefinements = Boolean(trimmedQuery) || selectedCategoryCount > 0 || savedProgramCount > 0

  function toggleMenu(menuName) {
    setOpenMenu((current) => (current === menuName ? null : menuName))
  }

  function collapseMenuToStickyBar() {
    setOpenMenu(null)

    if (stickyRef.current) {
      const top = stickyRef.current.getBoundingClientRect().top + window.scrollY - 12
      window.scrollTo({
        top: Math.max(0, top),
        behavior: 'smooth',
      })
    }
  }

  let resultsTitle = 'Waehle zuerst deine Supermaerkte'
  let resultsSubtitle = 'Danach kannst du nach Produkten suchen, Kategorien eingrenzen und optional Angebote mit Kundenkarte oder App einbeziehen.'

  if (hasRetailerScope && !hasRefinements) {
    resultsTitle = 'Alle relevanten Angebote aus deinen Supermaerkten'
    resultsSubtitle = `${selectedRetailerCount} gewaehlte Supermaerkte · ${visibleOfferCount} Angebote sichtbar`
  }

  if (hasRetailerScope && hasRefinements && !trimmedQuery && selectedCategoryCount > 0) {
    resultsTitle = 'Angebote in deinen gewaehlten Kategorien'
    resultsSubtitle = `${selectedRetailerCount} Supermaerkte · ${selectedCategoryCount} Kategorien · ${visibleOfferCount} Angebote sichtbar`
  }

  if (hasRetailerScope && trimmedQuery && selectedCategoryCount === 0) {
    resultsTitle = `Ergebnisse fuer "${trimmedQuery}" in deinen Supermaerkten`
    resultsSubtitle = `${selectedRetailerCount} Supermaerkte · ${visibleOfferCount} Angebote sichtbar`
  }

  if (hasRetailerScope && trimmedQuery && selectedCategoryCount > 0) {
    resultsTitle = `${visibleOfferCount} passende Angebote fuer "${trimmedQuery}"`
    resultsSubtitle = `${selectedRetailerCount} Supermaerkte · ${selectedCategoryCount} Kategorien aktiv`
  }

  return (
    <>
      <HeroLoaderModal open={isPageBusy} />

      <section
        ref={stickyRef}
        className="panel"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1200,
          marginBottom: '1rem',
          opacity: isPageBusy ? 0 : 1,
          pointerEvents: isPageBusy ? 'none' : 'auto',
          transition: 'opacity 240ms ease',
          padding: '0.9rem 1rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.6rem',
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            className={`ghost-button ${openMenu === 'retailers' ? 'chip--active' : ''}`}
            onClick={() => toggleMenu('retailers')}
          >
            Supermaerkte {selectedRetailerCount > 0 ? `(${selectedRetailerCount})` : ''}
          </button>

          <label className="field field--hero-search" style={{ flex: '1 1 320px', minWidth: '240px', marginBottom: 0, opacity: hasRetailerScope ? 1 : 0.72 }}>
            <span>Was suchst du?</span>
            <input
              type="text"
              value={queryInput}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={hasRetailerScope ? 'z. B. Milch, Kaffee, Butter' : 'Waehle zuerst Supermaerkte'}
              disabled={!hasRetailerScope}
            />
          </label>

          <button
            type="button"
            className={`ghost-button ${openMenu === 'categories' ? 'chip--active' : ''}`}
            onClick={() => toggleMenu('categories')}
            disabled={!hasRetailerScope}
            style={!hasRetailerScope ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
          >
            Kategorien {selectedCategoryCount > 0 ? `(${selectedCategoryCount})` : ''}
          </button>

          <button
            type="button"
            className={`ghost-button ${openMenu === 'programs' ? 'chip--active' : ''}`}
            onClick={() => toggleMenu('programs')}
            disabled={!hasRetailerScope}
            style={!hasRetailerScope ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
          >
            Kundenkarte / App {savedProgramCount > 0 ? `(${savedProgramCount})` : ''}
          </button>
        </div>

        <p style={{ margin: '0.75rem 0 0', opacity: 0.82 }}>
          Schritt 1: Supermaerkte waehlen. Schritt 2: Produkt suchen. Schritt 3: Kategorien eingrenzen. Kundenkarte / App ist optional.
        </p>

        <ActiveFilterChips
          selectedRetailers={selectedRetailers}
          selectedCategories={selectedCategories}
          retailerPrograms={retailerPrograms}
          retailers={ranking?.retailers}
          queryInput={queryInput}
          onRemoveRetailer={onToggleRetailer}
          onRemoveCategory={onToggleCategory}
          onClearQuery={() => onQueryChange('')}
          onRemoveProgram={(retailerKey) => onToggleRetailerProgram(retailerKey, false)}
          onOpenRetailers={() => setOpenMenu('retailers')}
        />

        {openMenu ? (
          <div
            style={{
              marginTop: '0.85rem',
              paddingTop: '0.85rem',
              borderTop: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {openMenu === 'retailers' ? (
              <RetailerMenu
                retailers={ranking?.retailers}
                selectedRetailers={selectedRetailers}
                onToggle={onToggleRetailer}
                onClear={onClearRetailers}
                onDone={collapseMenuToStickyBar}
              />
            ) : null}

            {openMenu === 'categories' ? (
              <CategoryMenu
                categories={availableCategories}
                selectedCategories={selectedCategories}
                onToggle={onToggleCategory}
                onToggleMainCategory={onToggleMainCategory}
                onClear={onClearCategories}
                onDone={collapseMenuToStickyBar}
                disabled={!hasRetailerScope}
              />
            ) : null}

            {openMenu === 'programs' ? (
              <ProgramMenu
                retailers={ranking?.retailers}
                selectedRetailers={selectedRetailers}
                retailerPrograms={retailerPrograms}
                onToggleProgram={onToggleRetailerProgram}
                onDone={collapseMenuToStickyBar}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      <section
        className="panel"
        style={{
          marginBottom: '1rem',
          opacity: isPageBusy ? 0 : 1,
          pointerEvents: isPageBusy ? 'none' : 'auto',
          transition: 'opacity 240ms ease',
        }}
      >
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <p className="eyebrow">kaufklug.at</p>
            <h1 style={{ marginBottom: '0.8rem' }}>Die smarte Art, Zeit, Geld und Wege beim Einkauf zu sparen.</h1>
            <p className="subtitle" style={{ marginBottom: '0.45rem' }}>
              Der Postkasten ist voll mit Prospekten. Aber niemand hat Zeit, alles zu vergleichen.
            </p>
            <p className="subtitle" style={{ marginBottom: '0.45rem' }}>
              kaufklug.at zeigt dir, wo du deine Produkte gerade wirklich am guenstigsten bekommst.
            </p>
            <p className="subtitle">
              Damit du beim Einkaufen Geld, Zeit und unnoetige Wege sparst – kostenlos, ohne Datenmissbrauch und von Menschen fuer Menschen.
            </p>
          </div>

          <div
            style={{
              padding: '1rem 1.1rem',
              borderRadius: '18px',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <h2 style={{ marginBottom: '0.65rem' }}>Warum hilft kaufklug.at wirklich beim Sparen?</h2>
            <p style={{ marginBottom: '0.45rem', opacity: 0.88 }}>
              Weil das Backend laufend aktuelle Angebote sammelt und das Frontend sie fuer dich einfach filterbar und verstaendlich macht.
            </p>
            <p style={{ marginBottom: '0.45rem', opacity: 0.88 }}>
              Zuerst waehlst du deine Supermaerkte. Danach verfeinerst du die Treffer mit Suche, Kategorien und optional mit Kundenkarte / App.
            </p>
            <p style={{ opacity: 0.88 }}>
              So siehst du die wirklich relevanten Angebote schneller und in einer Reihenfolge, die beim Sparen hilft.
            </p>
          </div>
        </div>
      </section>

      <section
        className="panel"
        style={{
          opacity: isPageBusy ? 0 : 1,
          pointerEvents: isPageBusy ? 'none' : 'auto',
          transition: 'opacity 240ms ease',
        }}
      >
        <div className="panel__header">
          <h2>{resultsTitle}</h2>
          <p>{resultsSubtitle}</p>
        </div>

        {rankingLoading ? (
          <p className="status">Angebote werden geladen...</p>
        ) : !hasRetailerScope ? (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <p className="status" style={{ marginBottom: 0 }}>
              Noch keine Supermaerkte ausgewaehlt.
            </p>
            <p style={{ margin: 0, opacity: 0.84 }}>
              Waehlst du zuerst deine Maerkte, werden Suche und Kategorien sofort sinnvoll und transparent.
            </p>
            <div>
              <button type="button" className="ghost-button chip--active" onClick={() => toggleMenu('retailers')}>
                Supermaerkte auswaehlen
              </button>
            </div>
            <p style={{ margin: 0, opacity: 0.72 }}>
              Aktuell insgesamt verfuegbar: {totalOfferCount} Angebote aus {retailerCount} Supermaerkten.
            </p>
          </div>
        ) : visibleOfferCount === 0 ? (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <p className="status" style={{ marginBottom: 0 }}>
              Keine passenden Angebote fuer die aktuelle Kombination gefunden.
            </p>
            <p style={{ margin: 0, opacity: 0.84 }}>
              Versuche einen anderen Suchbegriff oder entferne einzelne Filter.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {trimmedQuery ? (
                <button type="button" className="ghost-button" onClick={() => onQueryChange('')}>
                  Suchbegriff loeschen
                </button>
              ) : null}
              {selectedCategoryCount > 0 ? (
                <button type="button" className="ghost-button" onClick={onClearCategories}>
                  Kategorien loeschen
                </button>
              ) : null}
              {savedProgramCount > 0 ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    for (const retailerKey of Object.keys(retailerPrograms || {})) {
                      if (retailerPrograms[retailerKey]) {
                        onToggleRetailerProgram(retailerKey, false)
                      }
                    }
                  }}
                >
                  Kundenkarte / App loeschen
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <p style={{ margin: '0 0 1rem', opacity: 0.8 }}>
              Aktuell {visibleOfferCount} sichtbare Angebote in {selectedRetailerCount} gewaehlten Supermaerkten · {categoryCount} verfuegbare Kategorien innerhalb deiner Auswahl
            </p>
            <SearchResultGroups ranking={clientRanking} />
          </>
        )}
      </section>
    </>
  )
}

function DiagnosticsPage({
  health,
  snapshot,
  essence,
  error,
  feedbackState,
  feedbackNote,
  setFeedbackNote,
  handleSaveFeedback,
}) {
  const summary = snapshot?.qualitySummary || {}
  const comparisons = snapshot?.comparisonSnapshot || {}

  return (
    <>
      <header className="hero">
        <div>
          <p className="eyebrow">kaufklug.at admin diagnostik</p>
          <h1>Aktuelle Crawl-Qualitaet fuer Graz-Umgebung</h1>
          <p className="subtitle">Fruehe Qualitaetsansicht fuer Quellen, Jobs, Rohdaten, Normalisierung und Vergleichsgruppen.</p>
        </div>
        <div className="hero__status">
          <div>
            <span>Crawling</span>
            <strong>serverseitig geplant</strong>
          </div>
          <div>
            <span>Backend</span>
            <strong>{health?.ok ? 'online' : 'offline'}</strong>
          </div>
          <div>
            <span>Mongo</span>
            <strong>{health?.database?.connected ? 'verbunden' : 'getrennt'}</strong>
          </div>
          <div>
            <span>Snapshot</span>
            <strong>{snapshot?.generatedAt ? dayjs(snapshot.generatedAt).format('DD.MM.YYYY HH:mm:ss') : '-'}</strong>
          </div>
        </div>
      </header>

      {error ? <p className="status status--error">{error}</p> : null}

      <section className="metrics">
        <article className="metric-card"><span className="metric-card__label">Quellen aktiv</span><strong className="metric-card__value">{summary.sourceCount || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Rohdokumente</span><strong className="metric-card__value">{summary.rawDocumentCount || 0}</strong></article>
        <article className="metric-card metric-card--accent"><span className="metric-card__label">Gespeichert gesamt</span><strong className="metric-card__value">{summary.storedOfferCount || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Aktuell gueltig</span><strong className="metric-card__value">{summary.activeOfferCount || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Pruefung offen</span><strong className="metric-card__value">{summary.offersPendingReview || 0}</strong></article>
        <article className="metric-card"><span className="metric-card__label">Vergleichsbasis</span><strong className="metric-card__value">{comparisons.comparableOfferCount || 0}</strong></article>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Crawl-Essenz</h2>
          <p>Kompakte Zusammenfassung fuer deine Rueckmeldung und spaetere Analyse.</p>
        </div>
        <pre className="essence-box">{essence || 'Noch keine Essenz vorhanden.'}</pre>
        <div className="feedback-box">
          <textarea
            value={feedbackNote}
            onChange={(event) => setFeedbackNote(event.target.value)}
            placeholder="Deine Rueckmeldung zur Crawl-Qualitaet, Luecken oder Auffaelligkeiten..."
          />
          <div className="feedback-box__actions">
            <button
              className="crawl-button"
              onClick={handleSaveFeedback}
              disabled={feedbackState === 'saving' || !feedbackNote.trim()}
            >
              {feedbackState === 'saving' ? 'Feedback wird gespeichert...' : 'Feedback in Mongo speichern'}
            </button>
          </div>
        </div>
      </section>
    </>
  )
}

function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : ''
  const initialPage = pathname.includes('diagnose') || pathname.includes('diagnostic') ? 'diagnostics' : 'search'

  const [activePage] = useState(initialPage)
  const [snapshot, setSnapshot] = useState(null)
  const [health, setHealth] = useState(null)
  const [essence, setEssence] = useState('')
  const [ranking, setRanking] = useState(null)
  const [error, setError] = useState('')
  const [feedbackState, setFeedbackState] = useState('idle')
  const [feedbackNote, setFeedbackNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [rankingLoading, setRankingLoading] = useState(true)
  const [selectedCategories, setSelectedCategories] = useState([])
  const [selectedRetailers, setSelectedRetailers] = useState([])
  const [retailerPrograms, setRetailerPrograms] = useState({})
  const [queryInput, setQueryInput] = useState('')
  const [preferencesLoading, setPreferencesLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function loadPreferences() {
      try {
        setPreferencesLoading(true)
        const preferenceResult = await fetchCurrentUserPreferences()

        if (!active) return

        setRetailerPrograms(preferenceResult.retailerPrograms || {})
        setSelectedRetailers(preferenceResult.selectedRetailers || [])
      } catch (preferenceError) {
        if (!active) return
        setError(preferenceError.message || 'Nutzerpraeferenzen konnten nicht geladen werden.')
      } finally {
        if (active) setPreferencesLoading(false)
      }
    }

    async function loadDiagnostics() {
      try {
        setLoading(true)
        const [healthResult, snapshotResult, essenceResult] = await Promise.all([
          fetchHealth(),
          fetchDashboardSnapshot(),
          fetchEssence(),
        ])

        if (!active) return

        setHealth(healthResult)
        setSnapshot(snapshotResult)
        setEssence(essenceResult)
        setError('')
      } catch (loadError) {
        if (!active) return
        setError(loadError.message || 'Dashboard data could not be loaded.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadPreferences()
    loadDiagnostics()
    const interval = setInterval(loadDiagnostics, 20000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadRanking() {
      try {
        setRankingLoading(true)
        const rankingResult = await fetchOfferRanking({
          categories: '',
          retailers: '',
          programRetailers: '',
          unit: 'all',
          q: '',
          limit: 'all',
        })

        if (!active) return

        setRanking(rankingResult)
        setError('')
      } catch (rankingError) {
        if (!active) return
        setError(rankingError.message || 'Ranking data could not be loaded.')
      } finally {
        if (active) setRankingLoading(false)
      }
    }

    loadRanking()

    return () => {
      active = false
    }
  }, [])

  async function reloadAll() {
    const [healthResult, snapshotResult, essenceResult, rankingResult] = await Promise.all([
      fetchHealth(),
      fetchDashboardSnapshot(),
      fetchEssence(),
      fetchOfferRanking({
        categories: '',
        retailers: '',
        programRetailers: '',
        unit: 'all',
        q: '',
        limit: 'all',
      }),
    ])

    setHealth(healthResult)
    setSnapshot(snapshotResult)
    setEssence(essenceResult)
    setRanking(rankingResult)
  }

  async function persistUserPreferences(nextRetailers, nextPrograms) {
    try {
      await saveCurrentUserPreferences({
        selectedRetailers: nextRetailers,
        retailerPrograms: nextPrograms,
      })
      setError('')
    } catch (preferenceError) {
      setError(preferenceError.message || 'Nutzerpraeferenzen konnten nicht gespeichert werden.')
    }
  }

  function handleToggleCategory(category) {
    setSelectedCategories((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category]
    )
  }

  function handleToggleMainCategory(_mainCategory, subcategories) {
    setSelectedCategories((current) => {
      const allSelected = subcategories.every((subcategory) => current.includes(subcategory))
      if (allSelected) return current.filter((category) => !subcategories.includes(category))
      return [...new Set([...current, ...subcategories])]
    })
  }

  function handleToggleRetailer(retailerKey) {
    setSelectedRetailers((current) => {
      const nextRetailers = current.includes(retailerKey)
        ? current.filter((item) => item !== retailerKey)
        : [...current, retailerKey]

      persistUserPreferences(nextRetailers, retailerPrograms)
      return nextRetailers
    })
  }

  function handleClearRetailers() {
    setSelectedRetailers([])
    persistUserPreferences([], retailerPrograms)
  }

  async function handleToggleRetailerProgram(retailerKey, hasProgram) {
    const nextPrograms = {
      ...retailerPrograms,
      [retailerKey]: hasProgram,
    }

    setRetailerPrograms(nextPrograms)
    await persistUserPreferences(selectedRetailers, nextPrograms)
  }

  async function handleSaveFeedback() {
    try {
      setFeedbackState('saving')
      await saveFeedback({
        note: feedbackNote,
        digest: essence,
        scope: 'crawl-review',
      })
      await reloadAll()
      setFeedbackNote('')
      setFeedbackState('done')
      setError('')
    } catch (feedbackError) {
      setFeedbackState('failed')
      setError(feedbackError.message || 'Feedback konnte nicht gespeichert werden.')
    }
  }

  return (
    <main className="shell">
      {activePage === 'search' ? (
        <SearchPage
          ranking={ranking}
          rankingLoading={rankingLoading}
          preferencesLoading={preferencesLoading}
          selectedCategories={selectedCategories}
          selectedRetailers={selectedRetailers}
          queryInput={queryInput}
          retailerPrograms={retailerPrograms}
          onToggleCategory={handleToggleCategory}
          onToggleMainCategory={handleToggleMainCategory}
          onToggleRetailer={handleToggleRetailer}
          onClearCategories={() => setSelectedCategories([])}
          onClearRetailers={handleClearRetailers}
          onQueryChange={setQueryInput}
          onToggleRetailerProgram={handleToggleRetailerProgram}
        />
      ) : (
        <>
          {loading && !snapshot ? <p className="status">Lade Ansicht...</p> : null}
          {error && !snapshot ? <p className="status status--error">{error}</p> : null}
          {snapshot ? (
            <DiagnosticsPage
              health={health}
              snapshot={snapshot}
              essence={essence}
              error={error}
              feedbackState={feedbackState}
              feedbackNote={feedbackNote}
              setFeedbackNote={setFeedbackNote}
              handleSaveFeedback={handleSaveFeedback}
            />
          ) : null}
        </>
      )}
    </main>
  )
}

export default App