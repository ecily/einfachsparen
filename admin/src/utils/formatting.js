export function formatCurrencyAmount(amount, currency = 'EUR') {
  const numericAmount = Number(amount)

  if (!Number.isFinite(numericAmount)) {
    return 'Preis nicht verfügbar'
  }

  return new Intl.NumberFormat('de-AT', {
    style: 'currency',
    currency: currency || 'EUR',
  }).format(numericAmount)
}

export function formatUnitPrice(normalizedUnitPrice) {
  const amount = Number(normalizedUnitPrice?.amount)
  const unit = normalizedUnitPrice?.unit

  if (!Number.isFinite(amount) || !unit) {
    return 'Einheitspreis nicht angegeben'
  }

  return `${formatCurrencyAmount(amount)} / ${unit}`
}

function parseDisplayDate(value) {
  if (!value) return null

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date
}

function formatDayMonth(value) {
  return new Intl.DateTimeFormat('de-AT', {
    day: '2-digit',
    month: '2-digit',
  }).format(value)
}

export function formatValidityLabel(offer) {
  const validFrom = parseDisplayDate(offer?.validFrom)
  const validTo = parseDisplayDate(offer?.validTo)

  if (validFrom && validTo) {
    return `Gültig von ${formatDayMonth(validFrom)} bis ${formatDayMonth(validTo)}`
  }

  if (validTo) {
    return `Gültig bis ${formatDayMonth(validTo)}`
  }

  if (validFrom) {
    return `Gültig ab ${formatDayMonth(validFrom)}`
  }

  return 'Aktuell gefunden – bitte im Markt prüfen.'
}

export function formatInteger(value) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return '0'
  }

  return new Intl.NumberFormat('de-AT').format(numericValue)
}

export function formatPercent(value) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return '0 %'
  }

  return new Intl.NumberFormat('de-AT', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(numericValue)
}
