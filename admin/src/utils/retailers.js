import { normalizeRetailerKey } from './offers'

const RETAILER_LABELS = {
  adeg: 'ADEG',
  billa: 'BILLA',
  'billa-plus': 'BILLA Plus',
  billaplus: 'BILLA Plus',
  bipa: 'BIPA',
  dm: 'dm',
  eurospar: 'EUROSPAR',
  hofer: 'HOFER',
  interspar: 'INTERSPAR',
  lidl: 'Lidl',
  penny: 'PENNY',
  spar: 'SPAR',
}

export function normalizeRetailerFormatKey(value) {
  const key = normalizeRetailerKey(value).replace(/_/g, '-')

  if (key === 'billaplus' || key === 'billa-plus-markt') return 'billa-plus'

  return key
}

export function formatRetailerName(value, fallback = 'Markt') {
  const name = String(value || '').trim()

  if (!name) {
    return fallback
  }

  return RETAILER_LABELS[normalizeRetailerFormatKey(name)] || name
}
