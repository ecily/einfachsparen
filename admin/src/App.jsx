import { useEffect, useMemo, useState } from 'react'
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

function TopDebugBanner() {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5000,
        marginBottom: '0.75rem',
        padding: '0.85rem 1rem',
        borderRadius: '14px',
        background: '#c62828',
        color: '#fff',
        fontWeight: 700,
        textAlign: 'center',
      }}
    >
      Ja, diese App.jsx laeuft
    </div>
  )
}

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

  return (offers || []).filter((offer) => {
    const offerRetailerKey = getOfferRetailerKey(offer, retailers)
    const offerCategory = getOfferCategoryLabel(offer)

    if (filters.selectedRetailers.length > 0 && !filters.selectedRetailers.includes(offerRetailerKey)) return false
    if (filters.selectedCategories.length > 0 && !filters.selectedCategories.includes(offerCategory)) return false
    if (offer.customerProgramRequired && !filters.retailerPrograms?.[offerRetailerKey]) return false

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

      if (!haystack.includes(searchNeedle)) return false
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

function getSupportingSourceBadges(offer) {
  const sources = Array.isArray(offer?.supportingSources) ? offer.supportingSources : []
  const seen = new Set()

  return sources
    .map((source) => source.label || source.channel || 'Quelle')
    .filter(Boolean)
    .filter((label) => {
      if (seen.has(label)) return false
      seen.add(label)
      return true
    })
    .slice(0, 4)
}

function MetricCard({ label, value, tone = 'default' }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
    </article>
  )
}

function LandingInfoCard({ title, children }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </section>
  )
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
          <p>kaufklug.at laedt die aktuellen Angebote fuer dich.</p>
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

function ComparisonGroupList({ title, description, groups }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {(groups || []).length === 0 ? (
        <p className="status">Noch keine belastbaren Vergleichsgruppen vorhanden.</p>
      ) : (
        <div className="comparison-list">
          {groups.map((group) => (
            <article className="comparison-card" key={group.key}>
              <div className="comparison-card__top">
                <div>
                  <h3>{group.label}</h3>
                  <p>
                    {group.retailerCount} Haendler | {group.offerCount} Angebote | bester Wert {group.bestUnitPrice}/{group.unit}
                  </p>
                </div>
              </div>
              <div className="comparison-offers">
                {group.offers.map((offer) => (
                  <div className="comparison-offer" key={offer.id}>
                    <strong>{offer.retailerName}</strong>
                    <span>{offer.normalizedUnitPrice.amount}/{offer.normalizedUnitPrice.unit}</span>
                    <span>{offer.priceCurrent.amount} {offer.priceCurrent.currency}</span>
                    <span>{offer.priceGapPercent > 0 ? `+${offer.priceGapPercent}%` : 'Bestwert'}</span>
                    <p>{offer.title}</p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function CategoryMenu({ categories, selectedCategories, onToggle, onToggleMainCategory, onClear }) {
  const [expandedGroups, setExpandedGroups] = useState({})
  const groups = buildCategoryGroups(categories)

  return (
    <div>
      <div className="category-picker__header" style={{ marginBottom: '0.75rem' }}>
        <div>
          <h3>Kategorien</h3>
          <p>Die Direktsuche und Kategorien ergaenzen sich.</p>
        </div>
        <button type="button" className="ghost-button" onClick={onClear}>
          Zuruecksetzen
        </button>
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

function RetailerMenu({ retailers, selectedRetailers, onToggle, onClear }) {
  return (
    <div>
      <div className="category-picker__header" style={{ marginBottom: '0.75rem' }}>
        <div>
          <h3>Supermaerkte</h3>
          <p>Waehle nur die Maerkte, die fuer dich wirklich passen.</p>
        </div>
        <button type="button" className="ghost-button" onClick={onClear}>
          Zuruecksetzen
        </button>
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

function ProgramMenu({ retailers, selectedRetailers, retailerPrograms, onToggleProgram }) {
  const visibleRetailers = (retailers || []).filter((retailer) => selectedRetailers.includes(retailer.retailerKey))

  if (visibleRetailers.length === 0) {
    return (
      <div className="category-picker__header">
        <div>
          <h3>Kundenkarte / App</h3>
          <p>Waehle zuerst mindestens einen Supermarkt aus.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="category-picker__header" style={{ marginBottom: '0.75rem' }}>
        <div>
          <h3>Kundenkarte / App</h3>
          <p>Hier legst du fest, bei welchen Anbietern du Karten- oder App-Angebote nutzen kannst.</p>
        </div>
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
    return <p className="status">Keine passenden, sicher vergleichbaren Angebote fuer den aktuellen Filter gefunden.</p>
  }

  return (
    <div className="user-group-list">
      {groups.map((group) => (
        <section className="user-group" key={group.unit}>
          <div className="user-group__header">
            <div>
              <h3>{group.unit} direkt vergleichbar</h3>
              <p>Hier stehen nur Angebote mit derselben Einheit, damit der Vergleich fair und leicht lesbar bleibt.</p>
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
                      <strong>{offer.priceCurrent.amount} {offer.priceCurrent.currency}</strong>
                      <span>{offer.normalizedUnitPrice.amount}/{offer.normalizedUnitPrice.unit}</span>
                    </div>
                  </div>

                  <div className="user-card__facts">
                    <span>Menge: {offer.quantityText || 'nicht erkannt'}</span>
                    <span>Gueltigkeit: {formatValidityLabel(offer)}</span>
                  </div>

                  <div className="user-card__highlights">
                    <div className="highlight-pill highlight-pill--price">
                      <span>Vergleichspreis</span>
                      <strong>{offer.normalizedUnitPrice.amount}/{offer.normalizedUnitPrice.unit}</strong>
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
  const isPageBusy = rankingLoading || preferencesLoading
  const allOffers = useMemo(() => flattenRankingOffers(ranking), [ranking])

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
  const categoryCount = ranking?.categories?.length || 0
  const selectedRetailerCount = selectedRetailers.length
  const selectedCategoryCount = selectedCategories.length
  const savedProgramCount = Object.values(retailerPrograms || {}).filter(Boolean).length

  function toggleMenu(menuName) {
    setOpenMenu((current) => (current === menuName ? null : menuName))
  }

  return (
    <>
      <HeroLoaderModal open={isPageBusy} />

      <section
        className="panel"
        style={{
          position: 'sticky',
          top: 48,
          zIndex: 1200,
          marginBottom: '0.75rem',
          opacity: isPageBusy ? 0 : 1,
          pointerEvents: isPageBusy ? 'none' : 'auto',
          transition: 'opacity 240ms ease',
        }}
      >
        <div className="panel__header">
          <p>
            <strong>
              Aktuell {totalOfferCount} Angebote | {retailerCount} Supermaerkte | {categoryCount} Kategorien | {visibleOfferCount} sichtbar
            </strong>
          </p>
        </div>
      </section>

      <section
        className="panel"
        style={{
          position: 'sticky',
          top: 124,
          zIndex: 1190,
          marginBottom: '1rem',
          opacity: isPageBusy ? 0 : 1,
          pointerEvents: isPageBusy ? 'none' : 'auto',
          transition: 'opacity 240ms ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            alignItems: 'center',
          }}
        >
          <label className="field field--hero-search" style={{ flex: '1 1 320px', minWidth: '260px', marginBottom: 0 }}>
            <span>Was suchst du?</span>
            <input
              type="text"
              value={queryInput}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="z. B. Kaese, Wein, Mineralwasser, Baguette"
            />
          </label>

          <button type="button" className={`ghost-button ${openMenu === 'retailers' ? 'chip--active' : ''}`} onClick={() => toggleMenu('retailers')}>
            Supermaerkte {selectedRetailerCount > 0 ? `(${selectedRetailerCount})` : ''}
          </button>

          <button type="button" className={`ghost-button ${openMenu === 'categories' ? 'chip--active' : ''}`} onClick={() => toggleMenu('categories')}>
            Kategorien {selectedCategoryCount > 0 ? `(${selectedCategoryCount})` : ''}
          </button>

          <button type="button" className={`ghost-button ${openMenu === 'programs' ? 'chip--active' : ''}`} onClick={() => toggleMenu('programs')}>
            Kundenkarte / App {savedProgramCount > 0 ? `(${savedProgramCount})` : ''}
          </button>
        </div>

        {openMenu ? (
          <div
            style={{
              marginTop: '1rem',
              paddingTop: '1rem',
              borderTop: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {openMenu === 'retailers' ? (
              <RetailerMenu
                retailers={ranking?.retailers}
                selectedRetailers={selectedRetailers}
                onToggle={onToggleRetailer}
                onClear={onClearRetailers}
              />
            ) : null}

            {openMenu === 'categories' ? (
              <CategoryMenu
                categories={ranking?.categories}
                selectedCategories={selectedCategories}
                onToggle={onToggleCategory}
                onToggleMainCategory={onToggleMainCategory}
                onClear={onClearCategories}
              />
            ) : null}

            {openMenu === 'programs' ? (
              <ProgramMenu
                retailers={ranking?.retailers}
                selectedRetailers={selectedRetailers}
                retailerPrograms={retailerPrograms}
                onToggleProgram={onToggleRetailerProgram}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      <section
        className="hero hero--search"
        style={{
          width: '100%',
          opacity: isPageBusy ? 0 : 1,
          pointerEvents: isPageBusy ? 'none' : 'auto',
          transition: 'opacity 240ms ease',
        }}
      >
        <div style={{ width: '100%' }}>
          <p className="eyebrow">kaufklug.at</p>
          <h1>Die smarte Art, Zeit, Geld und Wege beim Einkauf zu sparen.</h1>
          <p className="subtitle">Der Postkasten ist voll mit Prospekten. Aber niemand hat Zeit, alles zu vergleichen.</p>
          <p className="subtitle">kaufklug.at zeigt dir, wo du deine Produkte gerade wirklich am guenstigsten bekommst.</p>
          <p className="subtitle">Damit du beim Einkaufen Geld, Zeit und unnoetige Wege sparst – kostenlos, ohne Datenmissbrauch und von Menschen fuer Menschen.</p>

          <div className="panel" style={{ marginTop: '1.5rem', width: '100%' }}>
            <div className="panel__header">
              <h2>Wie funktioniert kaufklug.at?</h2>
              <p>kaufklug.at sucht laufend nach aktuellen Angeboten, vergleicht sie und zeigt dir die wirklich guten Deals.</p>
              <p>Du waehlst einfach, was du brauchst, welche Supermaerkte fuer dich passen und ob du eine Kundenkarte hast.</p>
              <p>Dann speicherst du deine Produkte in der Einkaufsliste – und wir zeigen dir, wie du dabei moeglichst viel Geld sparst. Dazu berechnet kaufklug.at auch die optimale Einkaufsroute, je nachdem, wo du gerade bist oder von zuhause losfaehrst.</p>
            </div>
          </div>
        </div>
      </section>

      <section
        className="metrics"
        style={{
          opacity: isPageBusy ? 0 : 1,
          pointerEvents: isPageBusy ? 'none' : 'auto',
          transition: 'opacity 240ms ease',
        }}
      >
        <MetricCard label="Kosten fuer dich" value="0 EUR" tone="accent" />
        <MetricCard label="Datennutzung" value="fair" />
        <MetricCard label="Aktuelle Angebote" value={totalOfferCount} />
        <MetricCard label="Passende Treffer" value={visibleOfferCount} />
      </section>

      <section
        className="panel-grid"
        style={{
          opacity: isPageBusy ? 0 : 1,
          pointerEvents: isPageBusy ? 'none' : 'auto',
          transition: 'opacity 240ms ease',
        }}
      >
        <LandingInfoCard title="1. Angebote verstehen statt Prospekte waelzen">
          Jede Woche landen unzaehlige Prospekte im Postkasten. kaufklug.at nimmt dir das Durchsehen und Vergleichen ab.
        </LandingInfoCard>

        <LandingInfoCard title="2. Nur das sehen, was fuer dich wichtig ist">
          Du filterst nach Produkten, Kategorien, Supermaerkten und Kundenkarte. So bekommst du keine Werbeflut, sondern passende Treffer.
        </LandingInfoCard>

        <LandingInfoCard title="3. Geld sparen und den Weg gleich mitdenken">
          kaufklug.at zeigt dir nicht nur gute Angebote, sondern hilft dir auch dabei, deinen Einkauf sinnvoll und mit moeglichst wenig Umwegen zu planen.
        </LandingInfoCard>
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
          <h2>Warum ist kaufklug.at wirklich nuetzlich?</h2>
          <p>Weil Sparen im Alltag oft nicht am Willen scheitert, sondern an unuebersichtlichen Prospekten, zu vielen Apps und zu wenig Zeit.</p>
        </div>
        <div className="search-explainer">
          <p><strong>Du musst nicht mehr alles selbst vergleichen.</strong> kaufklug.at sammelt und ordnet aktuelle Angebote fuer dich.</p>
          <p><strong>Du entscheidest nur noch, was du brauchst.</strong> Den Rest filtern und sortieren wir so, dass es alltagstauglich bleibt.</p>
          <p><strong>Du sparst nicht nur beim Preis.</strong> Auch Zeit, Suchaufwand und unnoetige Wege werden reduziert.</p>
          <p><strong>Die Nutzung bleibt fair.</strong> Kostenlos fuer dich, ohne Datenmissbrauch und mit klarem Fokus auf echten Nutzen.</p>
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
          <h2>Die besten Treffer fuer deinen Einkauf</h2>
          <p>Klar filterbar, schnell erfassbar und darauf ausgelegt, dir moeglichst viel Ersparnis bei moeglichst wenig Aufwand zu bringen.</p>
        </div>
        {rankingLoading ? <p className="status">Angebote werden geladen...</p> : <SearchResultGroups ranking={clientRanking} />}
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
        <MetricCard label="Quellen aktiv" value={summary.sourceCount || 0} />
        <MetricCard label="Rohdokumente" value={summary.rawDocumentCount || 0} />
        <MetricCard label="Gespeichert gesamt" value={summary.storedOfferCount || 0} tone="accent" />
        <MetricCard label="Aktuell gueltig" value={summary.activeOfferCount || 0} />
        <MetricCard label="Pruefung offen" value={summary.offersPendingReview || 0} />
        <MetricCard label="Sicher vergleichbar" value={summary.comparisonSafeOffers || 0} />
        <MetricCard label="Vergleichsbasis" value={comparisons.comparableOfferCount || 0} />
      </section>

      <section className="panel-grid">
        <section className="panel">
          <div className="panel__header">
            <h2>Quellenstatus</h2>
            <p>Welche Anbieterquellen aktuell registriert und zuletzt gelaufen sind.</p>
          </div>
          <div className="table">
            <div className="table__row table__row--head">
              <span>Anbieter</span>
              <span>Kanal</span>
              <span>Status</span>
              <span>Quelle</span>
            </div>
            {(snapshot?.sources || []).map((source) => (
              <div className="table__row" key={source._id}>
                <span>{source.retailerName}</span>
                <span>{source.channel}</span>
                <span className={`pill pill--${source.latestStatus}`}>{source.latestStatus}</span>
                <a href={source.sourceUrl} target="_blank" rel="noreferrer">oeffnen</a>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Haendlerabdeckung</h2>
            <p>Wie viele aktuell gueltige Angebote je Anbieter schon normalisiert und sicher vergleichbar sind.</p>
          </div>
          <div className="job-list">
            {(snapshot?.retailerSummary || []).map((item) => (
              <article className="job-card" key={item._id}>
                <div className="job-card__top">
                  <strong>{item.retailerName}</strong>
                  <span className={`pill ${item.offerCount > 0 ? 'pill--success' : 'pill--partial'}`}>
                    {item.offerCount > 0 ? 'befuellt' : 'leer'}
                  </span>
                </div>
                <p>Aktuell gueltig {item.offerCount || 0}</p>
                <p>Sicher vergleichbar {item.comparisonSafeCount || 0} | Mit Issues {item.issueCount || 0}</p>
              </article>
            ))}
          </div>
        </section>
      </section>

      <ComparisonGroupList
        title="Vergleichsansicht: naheliegende Produkttreffer"
        description="Moeglichst konkrete Vergleichsgruppen ueber mehrere Haendler hinweg. Nur sichere aktuelle Einheiten."
        groups={comparisons.exactMatches}
      />

      {comparisons.unavailable ? <p className="status">{comparisons.message}</p> : null}

      <ComparisonGroupList
        title="Vergleichsansicht: Kategorie-Benchmarks"
        description="Breitere Vergleichsgruppen nach Kategorie und Einheit. Gut fuer erste Preisniveaus, nicht SKU-exakt."
        groups={comparisons.categoryBenchmarks}
      />

      <section className="panel">
        <div className="panel__header">
          <h2>Letzte Crawl-Jobs</h2>
          <p>Fruehdiagnose fuer Laufstatus, Fehler und Mengen pro Quelle.</p>
        </div>
        <div className="job-list">
          {(snapshot?.latestJobs || []).map((job) => (
            <article className="job-card" key={job._id}>
              <div className="job-card__top">
                <strong>{job.retailerKey}</strong>
                <span className={`pill pill--${job.status}`}>{job.status}</span>
              </div>
              <p>{dayjs(job.startedAt).format('DD.MM.YYYY HH:mm')}</p>
              <p>Dokumente {job.stats?.rawDocuments || 0} | Angebote {job.stats?.offersStored || 0}</p>
              {(job.warningMessages || []).length > 0 ? <p>{job.warningMessages[0]}</p> : null}
              {(job.errorMessages || []).length > 0 ? <p className="job-card__error">{job.errorMessages[0]}</p> : null}
            </article>
          ))}
        </div>
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

      <section className="panel">
        <div className="panel__header">
          <h2>Angebotsstichprobe</h2>
          <p>Konkrete Beispiele fuer erkannte Preise, Geltung, Bilder und Vergleichssicherheit.</p>
        </div>
        <div className="offer-list">
          {(snapshot?.offerSamples || []).map((offer) => (
            <article className="offer-card offer-card--with-image" key={offer._id}>
              <ProductImage offerId={offer._id} src={offer.imageUrl} alt={offer.title} compact />
              <div className="offer-card__body">
                <div className="job-card__top">
                  <strong>{offer.retailerName}</strong>
                  <span className={`pill pill--${offer.adminReview?.status || 'pending'}`}>
                    {offer.adminReview?.status || 'pending'}
                  </span>
                </div>
                <h3>{offer.title}</h3>
                <p className="offer-card__meta">{offer.categoryPrimary} | {getOfferCategoryLabel(offer)}</p>
                <p>
                  {offer.priceCurrent?.amount || '-'} {offer.priceCurrent?.currency || 'EUR'} | {offer.normalizedUnitPrice?.amount || '-'} {offer.normalizedUnitPrice?.unit || ''}
                </p>
                <p>{formatValidityLabel(offer)}</p>
                {offer.conditionsText ? <p>{offer.conditionsText}</p> : null}
                {Array.isArray(offer.supportingSources) && offer.supportingSources.length > 0 ? (
                  <div className="source-chip-list">
                    {getSupportingSourceBadges(offer).map((label) => (
                      <span className="source-chip" key={`${offer._id}-${label}`}>{label}</span>
                    ))}
                  </div>
                ) : null}
                {(offer.quality?.issues || []).length > 0 ? (
                  <p className="job-card__error">{offer.quality.issues.join(' | ')}</p>
                ) : null}
              </div>
            </article>
          ))}
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
  const [searchTerm, setSearchTerm] = useState('')
  const [preferencesLoading, setPreferencesLoading] = useState(true)

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchTerm(queryInput.trim())
    }, 250)

    return () => clearTimeout(timeout)
  }, [queryInput])

  useEffect(() => {
    let active = true

    async function loadPreferences() {
      try {
        setPreferencesLoading(true)
        const preferenceResult = await fetchCurrentUserPreferences()

        if (!active) return

        setRetailerPrograms(preferenceResult.retailerPrograms || {})
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
    setSelectedRetailers((current) =>
      current.includes(retailerKey) ? current.filter((item) => item !== retailerKey) : [...current, retailerKey]
    )
  }

  async function handleToggleRetailerProgram(retailerKey, hasProgram) {
    const nextPrograms = {
      ...retailerPrograms,
      [retailerKey]: hasProgram,
    }

    setRetailerPrograms(nextPrograms)

    try {
      await saveCurrentUserPreferences({
        retailerPrograms: nextPrograms,
      })
      setError('')
    } catch (preferenceError) {
      setError(preferenceError.message || 'Nutzerpraeferenzen konnten nicht gespeichert werden.')
    }
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
      <TopDebugBanner />

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
          onClearRetailers={() => setSelectedRetailers([])}
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