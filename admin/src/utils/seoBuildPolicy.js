import { getSeoLandingPageByPath } from '../config/seoLandingPages.js'

export function seoCanonicalPath(path = '/') {
  const clean = String(path).split(/[?#]/)[0].replace(/\/+$/, '')
  return clean ? `${clean}/` : '/'
}

export function buildSeoPolicy(pages) {
  return Object.fromEntries(pages.map((page) => [seoCanonicalPath(page.path), page.robots]))
}

export function readSeoBuildPolicy() {
  const data = typeof document !== 'undefined' && document.getElementById('kaufklug-seo-policy')
  if (!data) return null
  try { return JSON.parse(data.textContent) } catch { return null }
}

export function getRenderedSeoRobots(path, fallback, policy = readSeoBuildPolicy()) {
  return policy?.[seoCanonicalPath(path)] || fallback
}

export function filterIndexableSeoLinks(links, policy = readSeoBuildPolicy()) {
  return links.filter((link) => getRenderedSeoRobots(
    link.path, getSeoLandingPageByPath(link.path)?.robots || 'noindex,follow', policy,
  ) === 'index,follow')
}
