import { useEffect, useState } from 'react'
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

function normalizeCategoryLabel(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
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

  if (/(weisswein|weiss|rotwein|rose|ros[eé]|schaumwein|perlwein|prosecco|sekt|aperitif|digestif)/.test(normalized)) {
    return 'Wein'
  }

  if (/(flaschenbier|dosenbier|helles|bier|radler|weizenbier)/.test(normalized)) {
    return 'Bier'
  }

  if (/(gemahlen|ganze bohne|eiskaffee|kaffee|capsules|kapseln|espresso)/.test(normalized)) {
    return 'Kaffee'
  }

  if (/(limonaden|mineralwasser|wasser|frucht gemusesafte|frucht gemuesesafte|sirupe|energydrinks|eistee|smoothies|milch joghurtgetranke|milch joghurtgetranke)/.test(normalized)) {
    return 'Alkoholfreie Getraenke'
  }

  if (/(hartkase|frischkase|huttenkase|huettenkase|feta|mozarella|kase)/.test(normalized)) {
    return 'Kaese'
  }

  if (/(pizza|pommes|eiscreme|eis am stiel|stanizl|tiefkuhl|tiefkuehl)/.test(normalized)) {
    return 'Tiefkuehlkost'
  }

  if (/(reis|pasta|beilagen|sugo|wurzsauce|wurzsauce|pesto|kochzutaten|dressings|basis fixprodukte|mais champions|bohnen|frische pasta)/.test(normalized)) {
    return 'Kochen & Vorrat'
  }

  if (/(tafelschokolade|fruchtgummi|schnitten|kekse|chips|knabberein|snacks|susswaren|suesswaren|schokoriegel|zuckerl|bonbons|nachos dips)/.test(normalized)) {
    return 'Suesses & Snacks'
  }

  if (/(duschgele|shampoo|spulung|spuelung|deoderants|windeln|einlagen binden|gesichtspflege und reinigung|zahnbursten aufsteckbursten|zahnbuersten aufsteckbuersten)/.test(normalized)) {
    return 'Drogerie & Hygiene'
  }

  if (/(tabs pads|reinigungsgerate tucher|reinigungsgeraete tuecher)/.test(normalized)) {
    return 'Haushalt'
  }

  return category
}

function resolveMainCategoryLabel(category) {
  const normalized = normalizeCategoryLabel(category)

  for (const group of CATEGORY_GROUP_RULES) {
    if (group.patterns.some((pattern) => normalized.includes(pattern))) {
      return group.mainCategory
    }
  }

  if (normalized === 'lebensmittel') {
    return 'Weitere Lebensmittel'
  }

  if (normalized === 'getraenke' || normalized === 'getranke') {
    return 'Weitere Getraenke'
  }

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

function getSupportingSourceBadges(offer) {
  const sources = Array.isArray(offer?.supportingSources) ? offer.supportingSources : []
  const seen = new Set()

  return sources
    .map((source) => source.label || source.channel || 'Quelle')
    .filter(Boolean)
    .filter((label) => {
      if (seen.has(label)) {
        return false
      }

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

function AppNavigation({ activePage, onChange }) {
  return (
    <nav className="page-nav" aria-label="Seitenwahl">
      {[
        { id: 'search', label: 'Suche' },
        { id: 'diagnostics', label: 'Diagnose' },
      ].map((item) => (
        <button
          key={item.id}
          type="button"
          className={`page-nav__button ${activePage === item.id ? 'page-nav__button--active' : ''}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
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
                    {group.retailerCount} Haendler | {group.offerCount} Angebote | bester Wert {group.bestUnitPrice}/
                    {group.unit}
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

function CategoryPicker({ categories, selectedCategories, onToggle, onToggleMainCategory, onClear }) {
  const [expandedGroups, setExpandedGroups] = useState({})
  const groups = buildCategoryGroups(categories)

  return (
    <div className="category-picker">
      <div className="category-picker__header">
        <div>
          <h3>Kategorien</h3>
          <p>Waehle Hauptkategorien direkt oder klappe sie auf, um einzelne Unterkategorien gezielt an- oder abzuwaehlen.</p>
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
                  {group.subcategories.map((category) => {
                    const active = selectedCategories.includes(category)

                    return (
                      <button
                        key={category}
                        type="button"
                        className={`chip chip--subtle ${active ? 'chip--active' : ''}`}
                        onClick={() => onToggle(category)}
                      >
                        {category}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RetailerPicker({ retailers, selectedRetailers, onToggle, onClear }) {
  return (
    <div className="category-picker">
      <div className="category-picker__header">
        <div>
          <h3>Anbieter</h3>
          <p>Mehrfachauswahl aktiv. So kannst du nur deine bevorzugten Haendler vergleichen.</p>
        </div>
        <button type="button" className="ghost-button" onClick={onClear}>
          Zuruecksetzen
        </button>
      </div>
      <div className="chip-grid">
        {(retailers || []).map((retailer) => {
          const active = selectedRetailers.includes(retailer.retailerKey)

          return (
            <button
              key={retailer.retailerKey}
              type="button"
              className={`chip ${active ? 'chip--active' : ''}`}
              onClick={() => onToggle(retailer.retailerKey)}
            >
              {retailer.retailerName}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RetailerProgramSettings({ retailers, selectedRetailers, retailerPrograms, onToggleProgram }) {
  const visibleRetailers = (retailers || []).filter((retailer) => selectedRetailers.includes(retailer.retailerKey))

  if (visibleRetailers.length === 0) {
    return null
  }

  return (
    <div className="category-picker">
      <div className="category-picker__header">
        <div>
          <h3>Kundenkarte / App pro Anbieter</h3>
          <p>Hier legst du pro ausgewaehltem Anbieter fest, ob du Karten- oder App-Angebote nutzen kannst.</p>
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
              <p>
                Wenn aktiv, zeigen wir fuer {retailer.retailerName} auch Angebote, die nur mit Kundenkarte oder App gelten.
              </p>
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
                  </div>

                  <div className="user-card__highlights">
                    <div className="highlight-pill highlight-pill--price">
                      <span>Vergleichspreis</span>
                      <strong>{offer.normalizedUnitPrice.amount}/{offer.normalizedUnitPrice.unit}</strong>
                    </div>
                    <div className="highlight-pill">
                      <span>Ersparnis zum alten Preis</span>
                      <strong>
                        {offer.savingsAmount !== null ? `${offer.savingsAmount} EUR` : 'nicht ableitbar'}
                      </strong>
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
  selectedCategories,
  selectedRetailers,
  unitFilter,
  queryInput,
  retailerPrograms,
  onToggleCategory,
  onToggleMainCategory,
  onToggleRetailer,
  onClearCategories,
  onClearRetailers,
  onUnitChange,
  onQueryChange,
  onToggleRetailerProgram,
}) {
  const rankingSummary = ranking?.summary || {}
  const mixedUnits = unitFilter === 'all'
  const activeFilterSummary = [
    selectedCategories.length > 0 ? `${selectedCategories.length} Kategorien aktiv` : 'alle Kategorien',
    selectedRetailers.length > 0 ? `${selectedRetailers.length} Anbieter aktiv` : 'alle Anbieter',
    queryInput.trim() ? `Suche: "${queryInput.trim()}"` : 'ohne Suchbegriff',
    unitFilter === 'all' ? 'alle Einheiten' : `Einheit: ${unitFilter}`,
    Object.values(retailerPrograms || {}).filter(Boolean).length > 0
      ? `${Object.values(retailerPrograms || {}).filter(Boolean).length} Anbieter mit gespeicherter Kundenkarte/App`
      : 'keine gespeicherte Kundenkarte/App',
  ]

  return (
    <>
      <header className="hero hero--search">
        <div>
          <p className="eyebrow">einfachsparen suche</p>
          <h1>Finde schnell die besten aktuellen Angebote, um maximal Geld zu sparen</h1>
          <p className="subtitle">
            Suche wie ein Mensch einkauft: nach Produkten, nach mehreren Kategorien gleichzeitig und mit klarer,
            transparenter Reihung der besten Treffer.
          </p>
        </div>
        <div className="hero__status hero__status--search">
          <div>
            <span>Aktuell passende Treffer</span>
            <strong>{rankingSummary.resultCount || 0}</strong>
          </div>
          <div>
            <span>Angezeigt</span>
            <strong>{rankingSummary.displayedCount || 0}</strong>
          </div>
          <div>
            <span>{mixedUnits ? 'Einheiten' : 'Bester Vergleichswert'}</span>
            <strong>{mixedUnits ? 'gemischt' : rankingSummary.bestUnitPrice ?? '-'}</strong>
          </div>
          <div>
            <span>{mixedUnits ? 'Direkter Vergleich' : 'Spannweite'}</span>
            <strong>{mixedUnits ? 'pro Einheit' : `${rankingSummary.spreadPercent ?? 0}%`}</strong>
          </div>
        </div>
      </header>

      <section className="search-shell search-shell--top">
        <section className="search-controls">
          <div className="search-controls__grid search-controls__grid--hero">
            <label className="field field--hero-search">
              <span>Suchbegriff</span>
              <input
                type="text"
                value={queryInput}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="z. B. Kaese, Wein, Mineralwasser, Baguette"
              />
            </label>
            <label className="field">
              <span>Einheit</span>
              <select value={unitFilter} onChange={(event) => onUnitChange(event.target.value)}>
                <option value="all">Alle Einheiten</option>
                {(ranking?.units || []).map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="search-explainer">
            <p><strong>So liest du die Treffer:</strong> Wir zeigen zuerst das aktuell guenstigste Angebot pro fair vergleichbarer Einheit.</p>
            <p><strong>Bedingungen stehen direkt unter dem Produktnamen.</strong> Vor allem "ab x Stk." oder Kundenkartenpflicht springt damit sofort ins Auge.</p>
            <p><strong>Crawling vs. Anzeige:</strong> Oben siehst du alle aktuell passenden Treffer fuer deinen Filter. Gleichzeitig zeigen wir bewusst nur die besten {rankingSummary.displayedCount || 0} Angebote direkt in der Liste.</p>
            <p><strong>Aktiver Filter:</strong> {activeFilterSummary.join(' | ')}</p>
          </div>

          <RetailerPicker
            retailers={ranking?.retailers}
            selectedRetailers={selectedRetailers}
            onToggle={onToggleRetailer}
            onClear={onClearRetailers}
          />

          <RetailerProgramSettings
            retailers={ranking?.retailers}
            selectedRetailers={selectedRetailers}
            retailerPrograms={retailerPrograms}
            onToggleProgram={onToggleRetailerProgram}
          />

          <CategoryPicker
            categories={ranking?.categories}
            selectedCategories={selectedCategories}
            onToggle={onToggleCategory}
            onToggleMainCategory={onToggleMainCategory}
            onClear={onClearCategories}
          />
        </section>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Ergebnisse fuer echte Kaufentscheidungen</h2>
          <p>Weniger Technik, mehr Klarheit: Preis, Vergleichswert, Ersparnis und Bedingungen.</p>
        </div>
        {rankingLoading ? <p className="status">Ranking wird geladen...</p> : <SearchResultGroups ranking={ranking} />}
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
          <p className="eyebrow">einfachsparen admin diagnostik</p>
          <h1>Aktuelle Crawl-Qualitaet fuer Graz-Umgebung</h1>
          <p className="subtitle">
            Fruehe Qualitaetsansicht fuer Quellen, Jobs, Rohdaten, Normalisierung und Vergleichsgruppen.
          </p>
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
            <strong>{dayjs(snapshot?.generatedAt).format('DD.MM.YYYY HH:mm:ss')}</strong>
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
                <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                  oeffnen
                </a>
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
                <p className="offer-card__meta">
                  {offer.categoryPrimary} | {getOfferCategoryLabel(offer)}
                </p>
                <p>
                  {offer.priceCurrent?.amount || '-'} {offer.priceCurrent?.currency || 'EUR'} |{' '}
                  {offer.normalizedUnitPrice?.amount || '-'} {offer.normalizedUnitPrice?.unit || ''}
                </p>
                <p>{formatValidityLabel(offer)}</p>
                {offer.conditionsText ? <p>{offer.conditionsText}</p> : null}
                {Array.isArray(offer.supportingSources) && offer.supportingSources.length > 0 ? (
                  <div className="source-chip-list">
                    {getSupportingSourceBadges(offer).map((label) => (
                      <span className="source-chip" key={`${offer._id}-${label}`}>
                        {label}
                      </span>
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
  const [activePage, setActivePage] = useState('search')
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
  const [unitFilter, setUnitFilter] = useState('all')
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

        if (!active) {
          return
        }

        setRetailerPrograms(preferenceResult.retailerPrograms || {})
      } catch (preferenceError) {
        if (!active) {
          return
        }

        setError(preferenceError.message || 'Nutzerpraeferenzen konnten nicht geladen werden.')
      } finally {
        if (active) {
          setPreferencesLoading(false)
        }
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

        if (!active) {
          return
        }

        setHealth(healthResult)
        setSnapshot(snapshotResult)
        setEssence(essenceResult)
        setError('')
      } catch (loadError) {
        if (!active) {
          return
        }

        setError(loadError.message || 'Dashboard data could not be loaded.')
      } finally {
        if (active) {
          setLoading(false)
        }
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
          categories: selectedCategories.join(','),
          retailers: selectedRetailers.join(','),
          programRetailers: Object.entries(retailerPrograms)
            .filter(([, hasProgram]) => hasProgram)
            .map(([retailerKey]) => retailerKey)
            .join(','),
          unit: unitFilter,
          q: searchTerm,
          limit: 120,
        })

        if (!active) {
          return
        }

        setRanking(rankingResult)
      } catch (rankingError) {
        if (!active) {
          return
        }

        setError(rankingError.message || 'Ranking data could not be loaded.')
      } finally {
        if (active) {
          setRankingLoading(false)
        }
      }
    }

    loadRanking()

    return () => {
      active = false
    }
  }, [selectedCategories, selectedRetailers, unitFilter, searchTerm, retailerPrograms])

  async function reloadAll() {
    const [healthResult, snapshotResult, essenceResult, rankingResult] = await Promise.all([
      fetchHealth(),
      fetchDashboardSnapshot(),
      fetchEssence(),
      fetchOfferRanking({
        categories: selectedCategories.join(','),
        retailers: selectedRetailers.join(','),
        programRetailers: Object.entries(retailerPrograms)
          .filter(([, hasProgram]) => hasProgram)
          .map(([retailerKey]) => retailerKey)
          .join(','),
        unit: unitFilter,
        q: searchTerm,
        limit: 120,
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

      if (allSelected) {
        return current.filter((category) => !subcategories.includes(category))
      }

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

  if (loading && !snapshot) {
    return <main className="shell"><p className="status">Lade Ansicht...</p></main>
  }

  if (error && !snapshot) {
    return <main className="shell"><p className="status status--error">{error}</p></main>
  }

  return (
    <main className="shell">
      <AppNavigation activePage={activePage} onChange={setActivePage} />

      {activePage === 'search' ? (
        <SearchPage
          ranking={ranking}
          rankingLoading={rankingLoading || preferencesLoading}
          selectedCategories={selectedCategories}
          selectedRetailers={selectedRetailers}
          unitFilter={unitFilter}
          queryInput={queryInput}
          retailerPrograms={retailerPrograms}
          onToggleCategory={handleToggleCategory}
          onToggleMainCategory={handleToggleMainCategory}
          onToggleRetailer={handleToggleRetailer}
          onClearCategories={() => setSelectedCategories([])}
          onClearRetailers={() => setSelectedRetailers([])}
          onUnitChange={setUnitFilter}
          onQueryChange={setQueryInput}
          onToggleRetailerProgram={handleToggleRetailerProgram}
        />
      ) : (
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
      )}
    </main>
  )
}

export default App
