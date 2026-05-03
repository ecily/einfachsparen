import dayjs from 'dayjs'
import { useMemo, useState } from 'react'

function buildQualityCategoryOptions(snapshot) {
  const options = new Set()

  for (const categoryPrimary of Object.keys(snapshot?.subcategoryOptionsByCategory || {})) {
    if (categoryPrimary) {
      options.add(categoryPrimary)
    }
  }

  for (const item of snapshot?.categories || []) {
    if (item?.categoryPrimary) {
      options.add(item.categoryPrimary)
    }
  }

  for (const item of snapshot?.subcategoryMappings || []) {
    if (item?.categoryPrimary) {
      options.add(item.categoryPrimary)
    }
  }

  for (const item of snapshot?.articleMappings || []) {
    if (item?.categoryPrimary) {
      options.add(item.categoryPrimary)
    }
  }

  return [...options].sort((left, right) => left.localeCompare(right, 'de'))
}

function buildQualitySubcategoryOptions(snapshot, selectedPrimary = '') {
  const options = new Set()

  for (const option of snapshot?.subcategoryOptionsByCategory?.[selectedPrimary] || []) {
    if (option) {
      options.add(option)
    }
  }

  for (const item of snapshot?.subcategoryMappings || []) {
    if (!item?.subcategoryLabel) continue
    if (!selectedPrimary || item.categoryPrimary === selectedPrimary) {
      options.add(item.subcategoryLabel)
    }
  }

  for (const item of snapshot?.manualOverrides?.articleSubcategory || []) {
    if (!item?.targetCategorySecondary) continue
    if (!selectedPrimary || item.targetCategoryPrimary === selectedPrimary) {
      options.add(item.targetCategorySecondary)
    }
  }

  return [...options].sort((left, right) => left.localeCompare(right, 'de'))
}

function SubcategoryOverrideRow({ item, categoryOptions, onSave, savingKey }) {
  const [targetCategoryPrimary, setTargetCategoryPrimary] = useState(item.categoryPrimary || '')
  const [note, setNote] = useState('')
  const rowKey = `subcategory:${item.subcategoryKey}`

  return (
    <div className="quality-row">
      <div>
        <strong>{item.subcategoryLabel}</strong>
        <p className="offer-card__meta">Aktuell in {item.categoryPrimary || 'Unkategorisiert'}</p>
      </div>
      <div>
        <span className="quality-row__label">Offers</span>
        <strong>{item.offerCount || 0}</strong>
        <p className="offer-card__meta">Aktiv: {item.activeOfferCount || 0}</p>
      </div>
      <div>
        <span className="quality-row__label">Retailer</span>
        <strong>{item.retailerCount || 0}</strong>
        <p className="offer-card__meta">{(item.sampleTitles || []).join(' • ') || 'Keine Beispiele'}</p>
      </div>
      <div className="quality-row__editor">
        <label className="quality-form__field">
          <span>Ziel-Kategorie</span>
          <select value={targetCategoryPrimary} onChange={(event) => setTargetCategoryPrimary(event.target.value)}>
            <option value="">Kategorie wählen</option>
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="quality-form__field">
          <span>Notiz</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="optional" />
        </label>
        <button
          className="crawl-button quality-row__action"
          disabled={!targetCategoryPrimary || savingKey === rowKey}
          onClick={() => onSave({ item, targetCategoryPrimary, note, rowKey })}
        >
          {savingKey === rowKey ? 'Speichert …' : 'Bestätigen'}
        </button>
      </div>
    </div>
  )
}

function ArticleOverrideRow({ item, categoryOptions, snapshot, onSave, onDelete, savingKey }) {
  const [targetCategoryPrimary, setTargetCategoryPrimary] = useState(item.categoryPrimary || '')
  const [targetCategorySecondary, setTargetCategorySecondary] = useState(item.categorySecondary || '')
  const [note, setNote] = useState('')
  const rowKey = `article:${item.retailerKey}:${item.titleNormalized}`
  const subcategoryOptions = useMemo(
    () => buildQualitySubcategoryOptions(snapshot, targetCategoryPrimary),
    [snapshot, targetCategoryPrimary]
  )
  const selectedTargetCategorySecondary =
    targetCategoryPrimary && subcategoryOptions.length > 0 && !subcategoryOptions.includes(targetCategorySecondary)
      ? subcategoryOptions[0]
      : targetCategorySecondary

  return (
    <div className="quality-row quality-row--article">
      <div>
        <strong>{item.titleDisplay || item.titleNormalized}</strong>
        <p className="offer-card__meta">{item.retailerName || item.retailerKey || 'Retailer unbekannt'}</p>
      </div>
      <div>
        <span className="quality-row__label">Aktuell</span>
        <strong>{item.categorySecondary || 'ohne Subkategorie'}</strong>
        <p className="offer-card__meta">{item.categoryPrimary || 'Unkategorisiert'}</p>
      </div>
      <div>
        <span className="quality-row__label">Offers</span>
        <strong>{item.offerCount || 0}</strong>
        <p className="offer-card__meta">Aktiv: {item.activeOfferCount || 0}</p>
      </div>
      <div className="quality-row__editor">
        <label className="quality-form__field">
          <span>Ziel-Kategorie</span>
          <select value={targetCategoryPrimary} onChange={(event) => setTargetCategoryPrimary(event.target.value)}>
            <option value="">Kategorie wählen</option>
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="quality-form__field">
          <span>Ziel-Subkategorie</span>
          <input
            list={`subcategory-options-${rowKey}`}
            value={selectedTargetCategorySecondary}
            onChange={(event) => setTargetCategorySecondary(event.target.value)}
            placeholder="Subkategorie setzen"
          />
          <datalist id={`subcategory-options-${rowKey}`}>
            {subcategoryOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>
        <label className="quality-form__field">
          <span>Notiz</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="optional" />
        </label>
        <button
          className="crawl-button quality-row__action"
          disabled={!targetCategoryPrimary || !selectedTargetCategorySecondary || savingKey === rowKey}
          onClick={() => onSave({ item, targetCategoryPrimary, targetCategorySecondary: selectedTargetCategorySecondary, note, rowKey })}
        >
          {savingKey === rowKey ? 'Speichert …' : 'Bestätigen'}
        </button>
        <button
          className="ghost-button"
          disabled={savingKey === `${rowKey}:delete`}
          onClick={() => onDelete({ item, note, rowKey: `${rowKey}:delete` })}
        >
          {savingKey === `${rowKey}:delete` ? 'Löscht …' : 'Löschen'}
        </button>
      </div>
    </div>
  )
}

export function QualityPage({
  snapshot,
  loading,
  error,
  filters,
  onFilterChange,
  onReload,
  onSaveSubcategoryOverride,
  onSaveArticleOverride,
  onDeleteArticle,
  savingKey,
}) {
  const categoryOptions = useMemo(() => buildQualityCategoryOptions(snapshot), [snapshot])
  const subcategoryMappings = snapshot?.subcategoryMappings || []
  const articleMappings = snapshot?.articleMappings || []
  const manualSubcategoryOverrides = snapshot?.manualOverrides?.subcategoryCategory || []
  const manualArticleOverrides = snapshot?.manualOverrides?.articleSubcategory || []

  return (
    <>
      <header className="hero">
        <div>
          <p className="eyebrow">kaufklug.at Datenqualität</p>
          <h1>Zuordnungen prüfen und sofort korrigieren</h1>
          <p className="subtitle">
            Interne Qualitätsansicht für Kategorien, Subkategorien und manuelle Korrekturen. Manuelle Zuordnungen
            greifen sofort und haben Vorrang vor der Automatik.
          </p>
        </div>
        <div className="hero__status">
          <div>
            <span>Snapshot</span>
            <strong>{snapshot?.generatedAt ? dayjs(snapshot.generatedAt).format('DD.MM.YYYY HH:mm:ss') : '-'}</strong>
          </div>
          <div>
            <span>Subkategorien</span>
            <strong>{subcategoryMappings.length}</strong>
          </div>
          <div>
            <span>Artikel</span>
            <strong>{articleMappings.length}</strong>
          </div>
          <div>
            <span>Overrides</span>
            <strong>{manualSubcategoryOverrides.length + manualArticleOverrides.length}</strong>
          </div>
        </div>
      </header>

      {error ? <p className="status status--error">{error}</p> : null}

      <section className="panel">
        <div className="panel__header">
          <h2>Suche und Filter</h2>
          <p>Für Massenprüfung nach Retailer, Kategorie oder Freitext eingrenzen.</p>
        </div>
        <div className="quality-filters">
          <label className="quality-form__field">
            <span>Suche</span>
            <input
              value={filters.query}
              onChange={(event) => onFilterChange('query', event.target.value)}
              placeholder="Artikel, Subkategorie oder Kategorie suchen"
            />
          </label>
          <label className="quality-form__field">
            <span>Retailer</span>
            <select value={filters.retailerKey} onChange={(event) => onFilterChange('retailerKey', event.target.value)}>
              <option value="">Alle Retailer</option>
              {(snapshot?.retailers || []).map((item) => (
                <option key={item.retailerKey} value={item.retailerKey}>
                  {item.retailerName}
                </option>
              ))}
            </select>
          </label>
          <label className="quality-form__field">
            <span>Kategorie</span>
            <select value={filters.categoryPrimary} onChange={(event) => onFilterChange('categoryPrimary', event.target.value)}>
              <option value="">Alle Kategorien</option>
              {categoryOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="quality-form__field">
            <span>Limit</span>
            <select value={String(filters.limit)} onChange={(event) => onFilterChange('limit', Number(event.target.value))}>
              {[50, 100, 200, 300].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button className="crawl-button quality-filters__action" onClick={onReload} disabled={loading}>
            {loading ? 'Lädt …' : 'Ansicht aktualisieren'}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Subkategorie zu Kategorie</h2>
          <p>Primäre Qualitätssicht für die grobe Fachlogik.</p>
        </div>
        {loading && !snapshot ? <p className="status">Lade Quality-Snapshot …</p> : null}
        {!loading && subcategoryMappings.length === 0 ? (
          <p className="status">Keine passenden Subkategorie-Zuordnungen gefunden.</p>
        ) : null}
        <div className="quality-list">
          {subcategoryMappings.map((item) => (
            <SubcategoryOverrideRow
              key={`${item.subcategoryKey}-${item.categoryPrimary}`}
              item={item}
              categoryOptions={categoryOptions}
              onSave={onSaveSubcategoryOverride}
              savingKey={savingKey}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Artikel zu Subkategorie</h2>
          <p>Gezielte Einzelkorrekturen bei falsch zugeordneten Artikeln.</p>
        </div>
        {!loading && articleMappings.length === 0 ? (
          <p className="status">Keine passenden Artikel-Zuordnungen gefunden.</p>
        ) : null}
        <div className="quality-list">
          {articleMappings.map((item) => (
            <ArticleOverrideRow
              key={`${item.retailerKey}-${item.titleNormalized}-${item.categoryPrimary}-${item.categorySecondary}`}
              item={item}
              categoryOptions={categoryOptions}
              snapshot={snapshot}
              onSave={onSaveArticleOverride}
              onDelete={onDeleteArticle}
              savingKey={savingKey}
            />
          ))}
        </div>
      </section>
    </>
  )
}
