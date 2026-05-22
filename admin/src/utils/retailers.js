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

const RETAILER_GROUPS = {
  billa: 'billa',
  'billa-plus': 'billa',
  billaplus: 'billa',
  bipa: 'drugstore',
  dm: 'drugstore',
  eurospar: 'spar',
  hofer: 'discount',
  interspar: 'spar',
  lidl: 'discount',
  spar: 'spar',
}

const RETAILER_GROUP_ORDER = {
  billa: 0,
  spar: 1,
  discount: 2,
  drugstore: 3,
}

const RETAILER_ORDER = {
  billa: 0,
  'billa-plus': 1,
  spar: 0,
  eurospar: 1,
  interspar: 2,
  hofer: 0,
  lidl: 1,
  dm: 0,
  bipa: 1,
}

export function normalizeRetailerFormatKey(value) {
  const key = normalizeRetailerKey(value).replace(/_/g, '-')

  if (key === 'billaplus' || key === 'billa-plus-markt') return 'billa-plus'

  return key
}

export function getRetailerGroupKey(value) {
  return RETAILER_GROUPS[normalizeRetailerFormatKey(value)] || ''
}

export function shouldSeparateRetailerGroups(currentRetailer, nextRetailer) {
  const currentGroup = getRetailerGroupKey(currentRetailer)
  const nextGroup = getRetailerGroupKey(nextRetailer)

  return Boolean(currentGroup && nextGroup && currentGroup !== nextGroup)
}

export function sortRetailersByDisplayGroup(retailers = []) {
  return [...retailers].sort((left, right) => {
    const leftKey = normalizeRetailerFormatKey(left?.retailerKey || left?.retailerName)
    const rightKey = normalizeRetailerFormatKey(right?.retailerKey || right?.retailerName)
    const leftGroup = getRetailerGroupKey(leftKey)
    const rightGroup = getRetailerGroupKey(rightKey)
    const leftIndex = retailers.indexOf(left)
    const rightIndex = retailers.indexOf(right)

    if (!leftGroup && !rightGroup) return leftIndex - rightIndex
    if (!leftGroup) return 1
    if (!rightGroup) return -1

    const groupOrder = RETAILER_GROUP_ORDER[leftGroup] - RETAILER_GROUP_ORDER[rightGroup]
    if (groupOrder !== 0) return groupOrder

    return (RETAILER_ORDER[leftKey] ?? leftIndex) - (RETAILER_ORDER[rightKey] ?? rightIndex)
  })
}

export function formatRetailerName(value, fallback = 'Markt') {
  const name = String(value || '').trim()

  if (!name) {
    return fallback
  }

  return RETAILER_LABELS[normalizeRetailerFormatKey(name)] || name
}
