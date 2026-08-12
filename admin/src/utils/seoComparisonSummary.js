const FINITE_NUMBER = (value) => typeof value === 'number' && Number.isFinite(value)

function getComparableUnitPrice(offer) {
  const unitPrice = offer?.normalizedUnitPrice
  if (!unitPrice?.comparable || !FINITE_NUMBER(unitPrice.amount) || unitPrice.amount <= 0 || !unitPrice.unit) return null
  return { amount: unitPrice.amount, unit: String(unitPrice.unit).toLowerCase() }
}

function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('de-AT', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value)
}

function displayUnit(unit) {
  if (unit === 'stk') return 'Stück'
  return unit
}

function buildUnitFacts(offers) {
  const counts = new Map()

  for (const offer of offers) {
    const price = getComparableUnitPrice(offer)
    if (!price) continue
    counts.set(price.unit, (counts.get(price.unit) || 0) + 1)
  }

  const unitOrder = ['kg', 'l', 'stk']
  return [...counts.entries()]
    .sort(([left], [right]) => {
      const leftIndex = unitOrder.indexOf(left)
      const rightIndex = unitOrder.indexOf(right)
      return (leftIndex < 0 ? unitOrder.length : leftIndex) - (rightIndex < 0 ? unitOrder.length : rightIndex)
    })
    .map(([unit, count]) => ({
      unit,
      count,
      label: `${formatNumber(count, 0)} mit €/${displayUnit(unit)}`,
    }))
}

function buildBeerForms(offers) {
  const forms = [
    ['Dosen', /\bdose(?:n)?\b/i],
    ['Flaschen', /\bflasche(?:n)?\b/i],
    ['Multipacks', /\b\d+\s*x\s*[\d,.]+\s*l\b/i],
    ['Kisten', /\bkiste(?:n)?\b/i],
  ]

  return forms
    .filter(([, pattern]) => offers.some((offer) => pattern.test(String(offer?.quantityText || ''))))
    .map(([label]) => label)
}

function buildPublicFacts(pageKey, offers) {
  if (!Array.isArray(offers) || !offers.length) return null

  const retailers = new Set(offers.map((offer) => String(offer?.retailerKey || '').trim()).filter(Boolean))
  if (!retailers.size) return null

  const comparableOffers = offers.filter((offer) => getComparableUnitPrice(offer))
  const conditionsCount = offers.filter((offer) => offer?.hasConditions === true).length
  const unitFacts = buildUnitFacts(offers)
  const facts = [
    `${formatNumber(offers.length, 0)} aktuelle Angebote`,
    `${formatNumber(retailers.size, 0)} Händler`,
  ]

  if (pageKey === 'bier') {
    const literCount = unitFacts.find((item) => item.unit === 'l')?.count || 0
    if (literCount > 0) facts.push(`${formatNumber(literCount, 0)} mit Literpreis vergleichbar`)
    if (conditionsCount > 0) facts.push(`${formatNumber(conditionsCount, 0)} mit Mengen- oder Aktionsbedingungen`)

    const forms = buildBeerForms(offers)
    const beerComparisonParts = []
    if (literCount > 0) beerComparisonParts.push('Literpreis-Abdeckung ist ausgewiesen')
    if (forms.length) beerComparisonParts.push(`Gebinde: ${forms.join(', ')}`)
    if (beerComparisonParts.length) facts.push(beerComparisonParts.join(' · '))

    return {
      facts: facts.slice(0, 5),
      note: 'Bier wird hier über belastbare Literpreise und erkannte Gebindeformen eingeordnet; ein pauschaler Bestpreis wird nicht behauptet.',
    }
  }

  if (pageKey === 'kaffee') {
    if (comparableOffers.length > 0) {
      facts.push(`${formatNumber(comparableOffers.length, 0)} mit vergleichbarer Einheit`)
    }
    if (conditionsCount > 0) facts.push(`${formatNumber(conditionsCount, 0)} mit Mengen- oder Aktionsbedingungen`)
    if (unitFacts.length) {
      const unitFact = `Einheiten: ${unitFacts.map((item) => item.label).join(', ')}`
      facts.push(unitFact)
    }

    return {
      facts: facts.slice(0, 5),
      note: 'Kaffee wird nur innerhalb kompatibler Einheiten verglichen, etwa €/kg getrennt von €/l; inkompatible Produktformen werden nicht zusammengefasst.',
    }
  }

  if (pageKey === 'waschmittel') {
    if (comparableOffers.length > 0) {
      facts.push(`${formatNumber(comparableOffers.length, 0)} mit vergleichbarer Einheit`)
    }
    if (conditionsCount > 0) facts.push(`${formatNumber(conditionsCount, 0)} mit Mengen- oder Kundenkartenbedingungen`)
    if (unitFacts.length) facts.push(`Einheiten: ${unitFacts.map((item) => item.label).join(', ')}`)

    return {
      facts: facts.slice(0, 5),
      note:
        comparableOffers.length < offers.length
          ? 'Nicht jedes Waschmittel ist direkt vergleichbar; Einheitspreise werden nur dort gezeigt, wo Packungsdaten belastbar vorliegen. Ein Preis pro Waschladung wird nicht aus Dosierungsannahmen berechnet.'
          : 'Einheitspreise werden nur aus den vorhandenen normalisierten Packungsdaten gebildet; ein Preis pro Waschladung wird nicht aus Dosierungsannahmen berechnet.',
    }
  }

  return null
}

export function buildSeoComparisonSummary({ pageKey, offers, totalCount, generatedAt } = {}) {
  const safeTotalCount = Number(totalCount)
  if (!Number.isInteger(safeTotalCount) || safeTotalCount <= 0 || !Array.isArray(offers) || offers.length !== safeTotalCount) {
    return null
  }

  const safeGeneratedAt = new Date(generatedAt || '')
  if (Number.isNaN(safeGeneratedAt.getTime())) return null

  const facts = buildPublicFacts(pageKey, offers)
  if (!facts?.facts?.length) return null

  return {
    ...facts,
    dataStand: safeGeneratedAt.toISOString(),
  }
}
