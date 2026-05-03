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
    return `Gültig ${dayjs(offer.validFrom).format('D.M.YYYY')} bis ${dayjs(offer.validTo).format('D.M.YYYY')}`
  }

  if (hasValidFrom) {
    return `Gültig ab ${dayjs(offer.validFrom).format('D.M.YYYY')}`
  }

  if (hasValidTo) {
    return `Gültig bis ${dayjs(offer.validTo).format('D.M.YYYY')}`
  }

  return 'Aktuell verfügbar'
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
