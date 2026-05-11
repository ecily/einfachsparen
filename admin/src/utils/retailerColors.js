import { normalizeRetailerKey } from './offers'

const RETAILER_COLORS = {
  bipa: '#ec4f86',
  billa: '#d63b2e',
  'billa-plus': '#a51417',
  dm: '#005b8f',
  hofer: '#184a96',
  lidl: '#f2bf00',
  pagro: '#7a177e',
  penny: '#d81920',
  spar: '#19944a',
}

const RETAILER_TEXT_COLORS = {
  lidl: '#173118',
}

function normalizeColorKey(value) {
  const key = normalizeRetailerKey(value).replace(/_/g, '-')

  if (key === 'billaplus' || key === 'billa-plus-markt') return 'billa-plus'

  return key
}

function hexToRgb(hexColor) {
  const hex = String(hexColor || '').replace('#', '')

  if (!/^[0-9a-f]{6}$/i.test(hex)) return null

  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  }
}

function withAlpha(hexColor, alpha) {
  const rgb = hexToRgb(hexColor)

  if (!rgb) return `rgba(49, 88, 44, ${alpha})`

  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

export function getRetailerColor(retailerKeyOrName) {
  const key = normalizeColorKey(retailerKeyOrName)

  return RETAILER_COLORS[key] || '#31582c'
}

export function getRetailerTextColor(retailerKeyOrName) {
  const key = normalizeColorKey(retailerKeyOrName)

  return RETAILER_TEXT_COLORS[key] || '#ffffff'
}

export function getRetailerTheme(retailerKeyOrName) {
  const color = getRetailerColor(retailerKeyOrName)

  return {
    color,
    textColor: getRetailerTextColor(retailerKeyOrName),
    borderColor: withAlpha(color, 0.32),
    softColor: withAlpha(color, 0.12),
    glowColor: withAlpha(color, 0.08),
  }
}
