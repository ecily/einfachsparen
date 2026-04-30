import dayjs from 'dayjs'

export function formatCurrencyAmount(amount, currency = 'EUR') {
  const numericAmount = Number(amount)

  if (!Number.isFinite(numericAmount)) {
    return 'Preis nicht erkannt'
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
    return 'Einheitspreis nicht erkannt'
  }

  return `${formatCurrencyAmount(amount)} / ${unit}`
}

export function formatValidityLabel(offer) {
  const hasValidFrom = Boolean(offer?.validFrom)
  const hasValidTo = Boolean(offer?.validTo)

  if (hasValidFrom && hasValidTo) {
    return `gültig von ${dayjs(offer.validFrom).format('DD.MM.YYYY')} bis ${dayjs(offer.validTo).format('DD.MM.YYYY')}`
  }

  if (hasValidFrom) {
    return `gültig ab ${dayjs(offer.validFrom).format('DD.MM.YYYY')}`
  }

  if (hasValidTo) {
    return `gültig bis ${dayjs(offer.validTo).format('DD.MM.YYYY')}`
  }

  return 'aktuell verfügbar'
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
