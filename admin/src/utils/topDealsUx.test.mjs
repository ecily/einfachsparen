import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const appSource = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
const pageSource = fs.readFileSync(new URL('../components/search/TopDealsPage.jsx', import.meta.url), 'utf8')
const cardSource = fs.readFileSync(new URL('../components/search/OfferCardConsumer.jsx', import.meta.url), 'utf8')
const keywordSearchSource = fs.readFileSync(new URL('../components/search/KeywordSearchPage.jsx', import.meta.url), 'utf8')
const cssSource = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const apiSource = fs.readFileSync(new URL('./apiBase.js', import.meta.url), 'utf8')
const seoSource = fs.readFileSync(new URL('./seo.js', import.meta.url), 'utf8')

test('sticky header exposes the Top Deals route with compact mobile copy', () => {
  assert.match(appSource, /aria-label="Top Deals heute"/)
  assert.match(appSource, /page-nav__top-deals-long">Top Deals heute/)
  assert.match(appSource, /page-nav__top-deals-short">Top Deals/)
  assert.match(appSource, /handleNavigate\('top-deals'\)/)
  assert.match(appSource, /page-nav__top-deals\$\{activePage === 'top-deals' \? ' page-nav__button--active' : ''\}/)
  assert.match(cssSource, /\.page-nav__button\.page-nav__top-deals \{/)
  assert.match(cssSource, /\.page-nav__button\.page-nav__top-deals\.page-nav__button--active \{/)
  assert.match(seoSource, /pathname\.includes\('top-deals'\)/)
  assert.match(seoSource, /nextPage === 'top-deals'\) return '\/top-deals'/)
})

test('search and Top Deals are presented as distinct guided entries without limiting normal search', () => {
  assert.match(keywordSearchSource, /placeholder="Was m&ouml;chtest du heute billiger kaufen"/)
  assert.match(keywordSearchSource, /Suche ein Produkt – oder starte mit den Top Deals\./)
  assert.match(keywordSearchSource, /href="\/top-deals"/)
  assert.match(keywordSearchSource, /Top Deals heute ansehen/)
  assert.match(keywordSearchSource, /onNavigate\?\.\('top-deals'\)/)
  assert.match(keywordSearchSource, /const KEYWORD_SEARCH_LIMIT = 60/)
  assert.match(keywordSearchSource, /pagination\.hasMore/)
  assert.match(keywordSearchSource, /useState\(false\)/)
  assert.match(keywordSearchSource, /useState\(\[\]\)/)
  assert.match(keywordSearchSource, /\(marketFilterEnabled \? selectedRetailerKeys : \[\]\)/)
  assert.match(keywordSearchSource, /retailers: activeRetailerKeys/)
  assert.match(keywordSearchSource, /setSelectedRetailerKeys\(\[\]\)[\s\S]*?setMarketFilterEnabled\(false\)/)
  assert.match(cssSource, /animation: search-entry-soft-glow 1\.8s ease-out 1 both/)
  assert.match(cssSource, /animation: top-deals-entry-glow 1\.8s ease-out 1 both/)
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.page-nav__button\.page-nav__top-deals,[\s\S]*?animation: none !important/)
  assert.doesNotMatch(cssSource, /(?:search-entry-soft-glow|top-deals-entry-glow)[^;]*infinite/)
})

test('final search guidance and explanation copy stay user-facing and restrained', () => {
  assert.match(appSource, /\['Vergleichen', 'Preis pro Einheit, Bedingungen und passende Alternativen prüfen\.'\]/)
  assert.doesNotMatch(appSource, /immer günstiger/i)
})

test('Top Deals page uses the guarded backend endpoint and exact trust copy', () => {
  assert.match(apiSource, /fetchTopDeals\(limit = 20, filters = \{\}\)/)
  assert.match(apiSource, /Number\(limit\) \|\| 20, 1\), 20/)
  assert.match(apiSource, /searchParams\.set\('category'/)
  assert.match(apiSource, /searchParams\.set\('retailer'/)
  assert.match(pageSource, /fetchTopDeals\(20, \{ category: activeCategory, retailer: activeRetailer \}\)/)
  assert.match(pageSource, /<h1 id="top-deals-title">Top Deals heute<\/h1>/)
  assert.match(pageSource, /Die stärksten verifizierten Ersparnisse nach Preis pro Einheit – Bedingungen inklusive\./)
  assert.match(pageSource, /Heute sind noch nicht genug verifizierte Vergleichswerte verfügbar\. Suche direkt nach deinem Produkt\./)
  assert.match(pageSource, /topDeal=\{deal\.topDeal\}/)
})

test('Top Deals expose only positive-count safety-allowlisted category and retailer filters', () => {
  assert.match(pageSource, /Top Deals nach Kategorie und Markt/)
  assert.match(pageSource, /Finde die stärksten verifizierten Ersparnisse gezielt nach Bereich oder Händler\./)

  for (const slug of ['getraenke', 'drogerie', 'haushalt', 'kaffee', 'bier', 'waschmittel', 'zahnpasta', 'sonnencreme', 'toilettenpapier']) {
    assert.match(pageSource, new RegExp(`\\['${slug}',`))
  }
  for (const retailer of ['billa', 'billa-plus', 'lidl', 'penny', 'dm', 'bipa', 'mueller', 'interspar']) {
    assert.match(pageSource, new RegExp(`\\['${retailer}',`))
  }
  for (const excluded of ["['spar',", "['eurospar',", "['hofer',", "['pagro',"]) {
    assert.equal(pageSource.includes(excluded), false)
  }
  assert.match(pageSource, /payload\?\.availableFilters\?\.categories/)
  assert.match(pageSource, /payload\?\.availableFilters\?\.retailers/)
  assert.match(pageSource, /category: searchParams\.get\('category'\) \|\| ''/)
  assert.match(pageSource, /retailer: searchParams\.get\('retailer'\) \|\| ''/)
  assert.doesNotMatch(pageSource, /CATEGORY_FILTERS\.some\(\(\[key\]\) => key === category\)/)
  assert.doesNotMatch(pageSource, /RETAILER_FILTERS\.some\(\(\[key\]\) => key === retailer\)/)
  assert.match(pageSource, /CATEGORY_FILTERS\.filter\(\(\[key\]\) => availableCategoryCounts\.get\(key\) > 0\)/)
  assert.match(pageSource, /RETAILER_FILTERS\.filter\(\(\[key\]\) => availableRetailerCounts\.get\(key\) > 0\)/)
  assert.match(pageSource, /availableCategoryFilters\.length > 0 \|\| availableRetailerFilters\.length > 0/)
  assert.match(pageSource, /payload\?\.mode === 'retailer_discount_fallback'/)
  assert.match(pageSource, /Top Deals für diesen Markt – gereiht nach verifizierter prozentueller Ersparnis\./)
  assert.match(pageSource, /Wo verfügbar, zeigen wir zusätzlich den Preis pro Einheit\./)
  assert.match(pageSource, /data-available-count=\{availableCategoryCounts\.get\(key\)\}/)
  assert.match(pageSource, /data-available-count=\{availableRetailerCounts\.get\(key\)\}/)
  assert.match(pageSource, /data-filter-mode=\{availableRetailerMetadata\.get\(key\)\?\.mode \|\| 'strict'\}/)
  assert.match(pageSource, /href=\{`\/top-deals\?category=\$\{key\}`\}/)
  assert.match(pageSource, /href=\{`\/top-deals\?retailer=\$\{key\}`\}/)
})

test('Top Deal cards retain price, unit price, reference unit price, savings, conditions and validity', () => {
  assert.match(cardSource, /topDeal\.currentUnitPrice/)
  assert.match(cardSource, /topDeal\.referenceUnitPrice/)
  assert.match(cardSource, /data-top-deal-mode=\{topDeal\.mode \|\| 'strict'\}/)
  assert.match(cardSource, /topDealCurrentUnitPriceText && topDealReferenceUnitPriceText/)
  assert.match(cardSource, /data-retailer-key=\{offer\.retailerKey \|\| ''\}/)
  assert.match(cardSource, /-\{topDeal\.discountPercent\} %/)
  assert.match(cardSource, /statt \{topDealReferenceUnitPriceText\}/)
  assert.match(cardSource, /shortConditions\.length > 0 \|\| detailedConditions\.length > 0/)
  assert.match(cardSource, /user-card__meta-pill--validity/)
  assert.match(cardSource, /<ProductImage/)
  assert.match(cardSource, /user-card__retailer-badge/)
})
