import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import './index.css'
import {
  fetchHealth,
  saveFeedback,
} from './api'
import { SHOPPING_LIST_STORAGE_KEY } from './config/constants'
import { CookieStorageNotice } from './components/layout/CookieStorageNotice'
import { SeoFooterLinks } from './components/layout/SeoFooterLinks'
import { StickyBottomLine } from './components/layout/StickyBottomLine'
import { SearchPage } from './components/search/SearchPage'
import { KeywordSearchPage } from './components/search/KeywordSearchPage'
import { SeoOfferLandingPage } from './components/search/SeoOfferLandingPage'
import { ShoppingListPage } from './components/shopping/ShoppingListPage'
import { SharedShoppingListPage } from './components/shopping/SharedShoppingListPage'
import { FeedbackPage } from './components/feedback/FeedbackPage'
import { CookiesPage, ImpressumPage, LiabilityPage, PrivacyPage } from './components/legal/LegalPages'
import { DiagnosticsPage } from './components/admin/DiagnosticsPage'
import {
  fetchAdminJson,
  fetchFilterCategories,
  fetchFilterRetailers,
  fetchOfferRankingDirect,
} from './utils/apiBase'
import { trackAnalyticsEvent } from './utils/analytics'
import {
  buildAllCategorySelectionTokens,
  buildMainSelectionToken,
  buildSelectedCategoryQueryLabels,
  buildSubSelectionToken,
  getGroupSelectionState,
  normalizeCategoryDocuments,
  pruneSelectionTokens,
} from './utils/categories'
import { areStringSetsEqual, flattenRankingOffers, getRankingPagination, mergePaginatedRankingResults } from './utils/offers'
import { buildShoppingListItem, getShoppingListItemId, loadStoredShoppingList } from './utils/shoppingList'
import { getInitialPageFromPathname, getPathForPage, getSharedListIdFromPathname, updateSeoMetadata } from './utils/seo'
import { getSeoLandingPageByRouteId, SEO_LANDING_PAGE_PREFIX } from './config/seoLandingPages'
import { getRetailerTheme } from './utils/retailerColors'

const BETA_TEST_NOTICE =
  'Beta: Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen. Fehler kannst du direkt beim Angebot melden.'
const BETA_INFO_TITLE = 'Warum Beta-Test?'
const BETA_INFO_TEXT =
  'kaufklug lernt gerade, Angebote noch zuverlässiger zu zeigen. Wenn dir ein falscher Preis, eine fehlende Bedingung, ein falsches Bild oder eine falsche Kategorie auffällt, melde es direkt beim Angebot. So können wir die Datenqualität gezielt verbessern.'
const BETA_INFO_CLOSING = 'Danke für deine Hilfe.'

function getFriendlyErrorMessage(error, fallback) {
  const status = Number(error?.status || 0)
  const message = String(error?.message || '')

  if (status === 401 || /admin-zugriff|admin-key|nicht autorisiert|unauthorized/i.test(message)) {
    return message || 'Admin-Zugriff erforderlich. Bitte Admin-Key prüfen.'
  }

  if (/failed to fetch|network|request|response|api|backend|status code|timeout|load failed/i.test(message)) {
    return 'Die Angebote konnten gerade nicht geladen werden. Bitte versuche es später erneut.'
  }

  return message || fallback
}

async function fetchAdminDashboardSnapshot() {
  return fetchAdminJson('/dashboard/snapshot')
}

async function fetchAdminEssence() {
  const payload = await fetchAdminJson('/essence')

  if (typeof payload === 'string') {
    return payload
  }

  return payload?.essence || payload?.digest || payload?.text || payload?.summary || ''
}

function BetaInfoPanel({ id, onClose, className = '' }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div id={id} className={`beta-info-panel ${className}`.trim()} role="region" aria-labelledby={`${id}-title`}>
      <div>
        <strong id={`${id}-title`}>{BETA_INFO_TITLE}</strong>
        <p>{BETA_INFO_TEXT}</p>
        <p>{BETA_INFO_CLOSING}</p>
      </div>
      <button type="button" className="beta-info-panel__close" onClick={onClose} aria-label="Beta-Erklärung schließen">
        Schließen
      </button>
    </div>
  )
}

function BetaNoticeDisclosure({ onNavigate }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <section className={`home-beta-notice${isOpen ? ' home-beta-notice--open' : ''}`} aria-label="Beta-Hinweis">
      <button
        type="button"
        className="beta-notice-trigger beta-notice-trigger--hero"
        aria-expanded={isOpen}
        aria-controls="beta-info-hero"
        onClick={() => setIsOpen((current) => !current)}
      >
        <strong>Beta</strong>
        <p>{BETA_TEST_NOTICE}</p>
      </button>
      <button type="button" className="beta-notice-feedback" onClick={() => onNavigate?.('feedback')}>
        Feedback senden
      </button>
      {isOpen ? <BetaInfoPanel id="beta-info-hero" className="beta-info-panel--hero" onClose={() => setIsOpen(false)} /> : null}
    </section>
  )
}

function SearchLandingHero() {
  const heroRetailerGroups = [
    [
      ['billa', 'BILLA'],
      ['billa-plus', 'BILLA Plus'],
    ],
    [
      ['spar', 'SPAR'],
      ['eurospar', 'EUROSPAR'],
      ['interspar', 'INTERSPAR'],
    ],
    [
      ['hofer', 'HOFER'],
      ['lidl', 'Lidl'],
      ['penny', 'PENNY'],
    ],
    [
      ['dm', 'dm'],
      ['bipa', 'BIPA'],
    ],
    [
      ['pagro', 'PAGRO'],
    ],
  ]
  const trustItems = ['Kostenlos', 'Direkt im Browser', 'Ohne Anmeldung', 'Pfeilschnell']

  return (
    <>
      <section
        className="panel search-landing-hero"
        style={{
          display: 'grid',
          gap: 'clamp(0.42rem, 1.2vw, 0.72rem)',
          marginBottom: '0.25rem',
          minWidth: 0,
          padding: 'clamp(0.68rem, 1.8vw, 1rem)',
          width: '100%',
        }}
      >
        <div className="search-landing-hero__usp">
          <p className="eyebrow hero-consumer__eyebrow">
            <span className="hero__country-badge" aria-hidden="true" />
            <span>Angebote aus Flugblättern. Endlich einfach durchsuchbar.</span>
          </p>
          <div className="hero-market-strip" aria-label="Marktbeispiele">
            {heroRetailerGroups.map((group, groupIndex) => (
              <Fragment key={group.map(([key]) => key).join('-')}>
                {groupIndex > 0 ? <span className="hero-market-separator" aria-hidden="true" /> : null}
                {group.map(([key, label]) => {
                  const theme = getRetailerTheme(key)

                  return (
                    <span
                      key={key}
                      className="hero-market-badge"
                      style={{
                        '--retailer-color': theme.color,
                        '--retailer-text-color': theme.textColor,
                        '--retailer-border-color': theme.borderColor,
                        '--retailer-soft-color': theme.softColor,
                      }}
                    >
                      {label}
                    </span>
                  )
                })}
              </Fragment>
            ))}
          </div>
          <h1
            style={{
              fontSize: 'clamp(2.25rem, 6.2vw, 4.25rem)',
              lineHeight: 1.05,
              margin: 0,
              maxWidth: '100%',
            }}
          >
            Finde Supermarkt-Angebote in Österreich.
          </h1>
          <div className="hero-trust-row" aria-label="Nutzungshinweise">
            {trustItems.map((item) => (
              <span className={item === 'Pfeilschnell' ? 'hero-trust-row__item--speed' : ''} key={item}>
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}

function HowItWorksSection() {
  const steps = [
    ['Suchen', 'Produkt oder Marke eingeben.'],
    ['Vergleichen', 'Preis, Gültigkeit und Bedingungen prüfen.'],
    ['Merken', 'Angebote auf die Einkaufsliste setzen.'],
    ['Einkaufen', 'Im Markt prüfen und clever einkaufen.'],
  ]

  return (
    <section className="panel home-info-section home-steps-section" aria-labelledby="home-steps-title">
      <div className="home-section-heading">
        <h2 id="home-steps-title">So funktioniert kaufklug</h2>
      </div>
      <div className="home-steps-grid">
        {steps.map(([title, text], index) => (
          <article className="home-step-card" key={title}>
            <span className="home-step-card__index" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function DiscoverOffersSection() {
  const terms = ['Milch', 'Bier', 'Waschmittel', 'Zahnpasta', 'Sonnencreme', 'Kaffee']

  return (
    <section className="panel home-info-section home-discovery-section" aria-labelledby="home-discovery-title">
      <div className="home-section-heading">
        <h2 id="home-discovery-title">Aktuelle Angebote entdecken</h2>
        <p>Starte mit einer Suche und prüfe Preise, Gültigkeit und Bedingungen.</p>
      </div>
      <div className="home-discovery-chips" aria-label="Beliebte Angebotssuchen">
        {terms.map((term) => (
          <a href={`/suche?q=${encodeURIComponent(term)}`} key={term}>
            {term}
          </a>
        ))}
      </div>
    </section>
  )
}

function TrustAndFaqSection() {
  const faqItems = [
    {
      question: 'Was ist kaufklug.at?',
      answer: 'kaufklug.at hilft dir, aktuelle Angebote zu suchen, zu merken und für deinen Einkauf zu organisieren.',
    },
    {
      question: 'Brauche ich ein Konto?',
      answer: 'Nein. Du kannst Angebote finden, merken und deine Einkaufsliste teilen, ohne dich anzumelden.',
    },
    {
      question: 'Sind die Preise verbindlich?',
      answer: 'Nein. kaufklug ist eine Orientierungshilfe. Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.',
    },
    {
      question: 'Funktioniert kaufklug auch ohne App?',
      answer:
        'Ja. Die Browser-Version am Handy ist aktuell praktisch gleichwertig nutzbar. Eine neue App-Version kommt wieder, sobald die Datenqualität stabil genug ist.',
    },
    {
      question: 'Kann ich meine Einkaufsliste teilen?',
      answer: 'Ja. Du kannst einen Link zu deiner Liste erstellen und ihn zum Beispiel per WhatsApp oder SMS teilen.',
    },
    {
      question: 'Warum sehe ich manchmal Bedingungen?',
      answer:
        'Manche Angebote gelten nur mit Kundenkarte, App oder ab einer bestimmten Menge. kaufklug zeigt solche Hinweise möglichst verständlich an.',
    },
  ]

  return (
    <section className="panel faq-section" style={{ display: 'grid', gap: '1rem', marginTop: '1rem', padding: '1rem' }}>
      <div style={{ display: 'grid', gap: '0.45rem' }}>
        <h2 style={{ margin: 0 }}>Kurz erklärt</h2>
        <p style={{ color: 'var(--kk-text-muted)', margin: 0, maxWidth: '48rem' }}>
          kaufklug ist eine Orientierungshilfe. Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.
        </p>
      </div>

      <div style={{ display: 'grid', gap: '0.65rem' }}>
        {faqItems.map((item) => (
          <details key={item.question} style={{ borderTop: '1px solid var(--kk-border)', paddingTop: '0.65rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 800 }}>{item.question}</summary>
            <p style={{ color: 'var(--kk-text-muted)', lineHeight: 1.5, margin: '0.45rem 0 0' }}>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

function ScopedPageTuning() {
  return (
    <style>
      {`
        .search-first-page .keyword-search-hero {
          margin-top: -0.72rem;
        }

        @media (max-width: 720px) {
          .search-first-page .keyword-search-hero {
            margin-top: -0.5rem;
          }

          .search-first-page .search-landing-hero__qr {
            width: min(40vw, 132px) !important;
          }
        }
      `}
    </style>
  )
}

function App() {
  const rawPathname = typeof window !== 'undefined' ? window.location.pathname : ''
  const pathname = rawPathname.toLowerCase()
  const routedInitialPage = getInitialPageFromPathname(pathname)
  const isLegacyQualityPath = pathname === '/quality'
  const isDiagnosticsPath = pathname === '/ecily_web' || isLegacyQualityPath
  const initialPage =
    isDiagnosticsPath ? 'diagnostics' : routedInitialPage === 'search' && pathname === '/' ? 'product-search' : routedInitialPage
  const initialSharedListId = getSharedListIdFromPathname(rawPathname)
  const rankingRequestIdRef = useRef(0)

  const [activePage, setActivePage] = useState(initialPage)
  const [sharedListId, setSharedListId] = useState(initialSharedListId)
  const [shoppingListItems, setShoppingListItems] = useState(() => loadStoredShoppingList())
  const [snapshot, setSnapshot] = useState(null)
  const [health, setHealth] = useState(null)
  const [essence, setEssence] = useState('')
  const [ranking, setRanking] = useState(null)
  const [navSearchQuery, setNavSearchQuery] = useState('')
  const [keywordSearchRequest, setKeywordSearchRequest] = useState({ query: '', nonce: 0 })
  const [retailers, setRetailers] = useState([])
  const [categories, setCategories] = useState([])
  const [error, setError] = useState('')
  const [feedbackState, setFeedbackState] = useState('idle')
  const [feedbackNote, setFeedbackNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [filtersLoading, setFiltersLoading] = useState(true)
  const [rankingLoading, setRankingLoading] = useState(false)
  const [rankingLoadingMore, setRankingLoadingMore] = useState(false)
  const [browseAutoRefreshEnabled, setBrowseAutoRefreshEnabled] = useState(false)
  const [isHeaderBetaInfoOpen, setIsHeaderBetaInfoOpen] = useState(false)
  const [draftSelectedRetailers, setDraftSelectedRetailers] = useState([])
  const [draftSelectedCategoryLabels, setDraftSelectedCategoryLabels] = useState([])
  const [appliedSelectedRetailers, setAppliedSelectedRetailers] = useState([])
  const [appliedSelectedCategoryLabels, setAppliedSelectedCategoryLabels] = useState([])

  const shoppingListIds = useMemo(
    () => new Set(shoppingListItems.map((item) => item.id)),
    [shoppingListItems]
  )

  const appliedCategoryQueryLabels = useMemo(
    () => buildSelectedCategoryQueryLabels(appliedSelectedCategoryLabels, categories),
    [appliedSelectedCategoryLabels, categories]
  )

  useEffect(() => {
    updateSeoMetadata(activePage)
  }, [activePage])

  useEffect(() => {
    if (activePage === 'diagnostics') return

    if (activePage === 'search') {
      trackAnalyticsEvent('landing_page_view', {
        page: 'search',
      })
      return
    }

    if (activePage === 'product-search') {
      return
    }

    if (activePage.startsWith(SEO_LANDING_PAGE_PREFIX)) {
      trackAnalyticsEvent('landing_page_view', {
        page: activePage,
      })
      return
    }

    if (activePage === 'shopping-list') {
      trackAnalyticsEvent('shopping_list_opened', {
        itemCount: shoppingListItems.length,
      })
      return
    }

    trackAnalyticsEvent('legal_page_opened', {
      page: activePage,
    })
  }, [activePage, shoppingListItems.length])

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      window.localStorage.setItem(SHOPPING_LIST_STORAGE_KEY, JSON.stringify(shoppingListItems))
    } catch {
      // localStorage kann im Browser blockiert sein. Die App bleibt trotzdem nutzbar.
    }
  }, [shoppingListItems])

  useEffect(() => {
    let active = true

    async function loadFilterMetadata() {
      try {
        setFiltersLoading(true)
        const retailerResult = await fetchFilterRetailers()

        if (!active) return

        setRetailers(retailerResult)
        setDraftSelectedRetailers([])
        setAppliedSelectedRetailers([])
        setError('')
      } catch (filterError) {
        if (!active) return
        setRetailers([])
        setDraftSelectedRetailers([])
        setAppliedSelectedRetailers([])
        setError(getFriendlyErrorMessage(filterError, 'Filterdaten konnten nicht geladen werden.'))
      } finally {
        if (active) setFiltersLoading(false)
      }
    }

    loadFilterMetadata()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (activePage !== 'diagnostics') {
      return undefined
    }

    let active = true

    async function loadDiagnostics() {
      try {
        setLoading(true)

        const [healthResult, snapshotResult, essenceResult] = await Promise.all([
          fetchHealth(),
          fetchAdminDashboardSnapshot(),
          fetchAdminEssence(),
        ])

        if (!active) return

        setHealth(healthResult)
        setSnapshot(snapshotResult)
        setEssence(essenceResult)
        setError('')
      } catch (loadError) {
        if (!active) return

        try {
          const healthResult = await fetchHealth()
          if (active) setHealth(healthResult)
        } catch {
          if (active) setHealth(null)
        }

        setError(getFriendlyErrorMessage(loadError, 'Dashboard-Daten konnten nicht geladen werden.'))
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadDiagnostics()
    const interval = setInterval(loadDiagnostics, 20000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [activePage])

  useEffect(() => {
    let active = true

    async function loadScopedCategories() {
      try {
        setFiltersLoading(true)
        const categoryResult = await fetchFilterCategories(draftSelectedRetailers)

        if (!active) return

        const nextCategories = normalizeCategoryDocuments(categoryResult)
        setCategories(nextCategories)
        setDraftSelectedCategoryLabels((current) => pruneSelectionTokens(current, nextCategories))
        setAppliedSelectedCategoryLabels((current) => pruneSelectionTokens(current, nextCategories))
        setError('')
      } catch (filterError) {
        if (!active) return
        setCategories([])
        setError(getFriendlyErrorMessage(filterError, 'Filterdaten konnten nicht geladen werden.'))
      } finally {
        if (active) setFiltersLoading(false)
      }
    }

    loadScopedCategories()

    return () => {
      active = false
    }
  }, [draftSelectedRetailers])

  useEffect(() => {
    let active = true
    const requestId = rankingRequestIdRef.current + 1
    rankingRequestIdRef.current = requestId

    async function loadRanking() {
      if (!appliedSelectedRetailers.length) {
        setRanking(null)
        setRankingLoading(false)
        setRankingLoadingMore(false)
        return
      }

      try {
        setRankingLoading(true)
        setRankingLoadingMore(false)

        const rankingResult = await fetchOfferRankingDirect({
          categories: appliedCategoryQueryLabels.join(','),
          retailers: appliedSelectedRetailers.join(','),
          programRetailers: appliedSelectedRetailers.join(','),
          unit: 'all',
          q: '',
          limit: 60,
          offset: 0,
        })

        if (!active || requestId !== rankingRequestIdRef.current) return

        const resultCount = flattenRankingOffers(rankingResult).length

        setRanking(rankingResult)
        setError('')

        trackAnalyticsEvent('offer_search_result', {
          selectedRetailerCount: appliedSelectedRetailers.length,
          selectedCategoryCount: appliedSelectedCategoryLabels.length,
          resultCount,
        })
      } catch (rankingError) {
        if (!active || requestId !== rankingRequestIdRef.current) return
        setRanking(null)
        setError(
          getFriendlyErrorMessage(
            rankingError,
            'Die Angebote konnten gerade nicht geladen werden. Bitte versuche es später erneut.'
          )
        )
      } finally {
        if (active && requestId === rankingRequestIdRef.current) setRankingLoading(false)
      }
    }

    loadRanking()

    return () => {
      active = false
    }
  }, [appliedSelectedRetailers, appliedCategoryQueryLabels, appliedSelectedCategoryLabels.length])

  useEffect(() => {
    if (activePage !== 'search' || rankingLoading || !ranking || !appliedSelectedRetailers.length) return

    setBrowseAutoRefreshEnabled(true)
  }, [activePage, appliedSelectedRetailers.length, ranking, rankingLoading])

  async function reloadAll() {
    const [healthResult, snapshotResult, essenceResult] = await Promise.all([
      fetchHealth(),
      fetchAdminDashboardSnapshot(),
      fetchAdminEssence(),
    ])

    setHealth(healthResult)
    setSnapshot(snapshotResult)
    setEssence(essenceResult)
    setError('')
  }

  function handleNavigate(nextPage) {
    setIsHeaderBetaInfoOpen(false)
    setActivePage(nextPage)
    setSharedListId('')

    if (typeof window === 'undefined') {
      return
    }

    window.history.replaceState({}, '', getPathForPage(nextPage))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleLogoClick() {
    setIsHeaderBetaInfoOpen(false)
    setActivePage('product-search')
    setSharedListId('')

    if (typeof window === 'undefined') {
      return
    }

    window.history.replaceState({}, '', '/')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleNavSearchSubmit(event) {
    event.preventDefault()

    const nextQuery = navSearchQuery.trim()
    setIsHeaderBetaInfoOpen(false)
    setActivePage('product-search')
    setKeywordSearchRequest((current) => ({ query: nextQuery, nonce: current.nonce + 1 }))

    if (typeof window === 'undefined') {
      return
    }

    const nextPath = nextQuery ? `/suche?q=${encodeURIComponent(nextQuery)}` : '/suche'
    window.history.replaceState({}, '', nextPath)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleToggleDraftRetailer(retailerKey) {
    setDraftSelectedRetailers((current) => {
      const nextRetailers = current.includes(retailerKey)
        ? current.filter((item) => item !== retailerKey)
        : [...current, retailerKey]

      return nextRetailers
    })
  }

  function handleSelectAllRetailers() {
    setDraftSelectedRetailers((retailers || []).map((retailer) => retailer.retailerKey).filter(Boolean))
  }

  function handleClearRetailers() {
    setDraftSelectedRetailers([])
    setDraftSelectedCategoryLabels([])
  }

  function handleSelectAllDraftCategories() {
    setDraftSelectedCategoryLabels(buildAllCategorySelectionTokens(categories))
  }

  function handleClearDraftCategories() {
    setDraftSelectedCategoryLabels([])
  }

  function handleToggleDraftMainCategory(group) {
    const mainToken = buildMainSelectionToken(group.mainCategoryKey)
    const subcategoryTokens = (group.subcategories || []).map((item) => buildSubSelectionToken(group.mainCategoryKey, item.subcategoryKey))

    setDraftSelectedCategoryLabels((current) => {
      const selectionState = getGroupSelectionState(group, current)
      const next = current.filter((token) => token !== mainToken && !subcategoryTokens.includes(token))

      if (selectionState.mainSelected) {
        return next
      }

      if (subcategoryTokens.length > 0) {
        return [...next, ...subcategoryTokens]
      }

      return [...next, mainToken]
    })
  }

  function handleToggleDraftSubcategory(group, subcategory) {
    const mainToken = buildMainSelectionToken(group.mainCategoryKey)
    const subToken = buildSubSelectionToken(group.mainCategoryKey, subcategory.subcategoryKey)

    setDraftSelectedCategoryLabels((current) => {
      const withoutMain = current.filter((token) => token !== mainToken)

      if (withoutMain.includes(subToken)) {
        return withoutMain.filter((token) => token !== subToken)
      }

      return [...withoutMain, subToken]
    })
  }

  function handleApplySearch() {
    trackAnalyticsEvent('offer_search_started', {
      selectedRetailerCount: draftSelectedRetailers.length,
      selectedCategoryCount: draftSelectedCategoryLabels.length,
    })

    setAppliedSelectedRetailers([...draftSelectedRetailers])
    setAppliedSelectedCategoryLabels([...draftSelectedCategoryLabels])
  }

  async function handleLoadMoreBrowseOffers() {
    const pagination = getRankingPagination(ranking)

    if (
      rankingLoading ||
      rankingLoadingMore ||
      !pagination.hasMore ||
      pagination.nextOffset === null ||
      !appliedSelectedRetailers.length
    ) {
      return
    }

    const requestId = rankingRequestIdRef.current + 1
    rankingRequestIdRef.current = requestId

    try {
      setRankingLoadingMore(true)
      setError('')

      const nextRanking = await fetchOfferRankingDirect({
        categories: appliedCategoryQueryLabels.join(','),
        retailers: appliedSelectedRetailers.join(','),
        programRetailers: appliedSelectedRetailers.join(','),
        unit: 'all',
        q: '',
        limit: 60,
        offset: pagination.nextOffset,
        resultSetToken: ranking?.summary?.resultSetToken || '',
      })

      if (requestId !== rankingRequestIdRef.current) return

      setRanking((currentRanking) => mergePaginatedRankingResults(currentRanking, nextRanking))
    } catch (rankingError) {
      if (requestId !== rankingRequestIdRef.current) return
      setError(
        getFriendlyErrorMessage(
          rankingError,
          'Weitere Angebote konnten gerade nicht geladen werden. Bitte versuche es erneut.'
        )
      )
    } finally {
      if (requestId === rankingRequestIdRef.current) setRankingLoadingMore(false)
    }
  }

  function handleResetAll() {
    rankingRequestIdRef.current += 1
    setBrowseAutoRefreshEnabled(false)
    setDraftSelectedRetailers([])
    setDraftSelectedCategoryLabels([])
    setAppliedSelectedRetailers([])
    setAppliedSelectedCategoryLabels([])
    setRanking(null)
    setRankingLoadingMore(false)
  }

  function handleAddToShoppingList(offer) {
    const item = buildShoppingListItem(offer)

    setShoppingListItems((current) => {
      if (current.some((existingItem) => existingItem.id === item.id)) return current
      return [item, ...current]
    })

    trackAnalyticsEvent('offer_added_to_list', {
      retailerKey: item.retailerKey,
      hasKnownSavings: item.hasKnownSavings,
      hasConditions: item.hasConditions,
      customerProgramRequired: item.customerProgramRequired,
      isMultiBuy: item.isMultiBuy,
    })
  }

  function handleRemoveShoppingListItem(itemId) {
    setShoppingListItems((current) => current.filter((item) => item.id !== itemId))
  }

  function handleClearShoppingList() {
    setShoppingListItems([])
  }

  function handleAdoptSharedShoppingList(items) {
    setShoppingListItems((current) => {
      const existingIds = new Set(current.map(getShoppingListItemId))
      const nextItems = [...current]

      for (const item of items || []) {
        const itemId = getShoppingListItemId(item)

        if (!existingIds.has(itemId)) {
          existingIds.add(itemId)
          nextItems.unshift(item)
        }
      }

      return nextItems
    })

    handleNavigate('shopping-list')
  }

  async function handleSaveFeedback() {
    try {
      setFeedbackState('saving')
      await saveFeedback({
        note: feedbackNote,
        digest: essence,
        scope: 'crawl-review',
      })
      await reloadAll()
      setFeedbackNote('')
      setFeedbackState('done')
      setError('')
    } catch (feedbackError) {
      setFeedbackState('failed')
      setError(getFriendlyErrorMessage(feedbackError, 'Feedback konnte nicht gespeichert werden.'))
    }
  }

  const hasPendingChanges =
    !areStringSetsEqual(draftSelectedRetailers, appliedSelectedRetailers) ||
    !areStringSetsEqual(draftSelectedCategoryLabels, appliedSelectedCategoryLabels)
  const activeSeoLandingPage = getSeoLandingPageByRouteId(activePage)

  useEffect(() => {
    if (!isLegacyQualityPath || typeof window === 'undefined') return
    window.history.replaceState({}, '', '/ecily_web')
  }, [isLegacyQualityPath])

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      activePage !== 'search' ||
      !browseAutoRefreshEnabled ||
      filtersLoading ||
      !hasPendingChanges
    ) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      trackAnalyticsEvent('offer_search_started', {
        selectedRetailerCount: draftSelectedRetailers.length,
        selectedCategoryCount: draftSelectedCategoryLabels.length,
        source: 'browse_auto_refresh',
      })

      setAppliedSelectedRetailers([...draftSelectedRetailers])
      setAppliedSelectedCategoryLabels([...draftSelectedCategoryLabels])
    }, 250)

    return () => window.clearTimeout(timer)
  }, [
    activePage,
    browseAutoRefreshEnabled,
    draftSelectedCategoryLabels,
    draftSelectedRetailers,
    filtersLoading,
    hasPendingChanges,
  ])

  return (
    <main className="shell" style={{ paddingBottom: '5.5rem' }}>
      <ScopedPageTuning />
      <nav className="page-nav" aria-label="Seiten">
        <button className="page-nav__logo" type="button" onClick={handleLogoClick} aria-label="Zur Startseite">
          <img src="/brand/kaufklug-logo-transparent.png" alt="" width="78" height="78" />
        </button>
        <button
          className="page-nav__beta"
          type="button"
          aria-expanded={isHeaderBetaInfoOpen}
          aria-controls="beta-info-header"
          onClick={() => setIsHeaderBetaInfoOpen((current) => !current)}
        >
          Beta
        </button>
        <div className="page-nav__main">
          <button
            className={`page-nav__button${activePage === 'product-search' ? ' page-nav__button--active' : ''}`}
            onClick={() => handleNavigate('product-search')}
            aria-current={activePage === 'product-search' ? 'page' : undefined}
          >
            Suche
          </button>

          <button
            className={`page-nav__button${activePage === 'search' ? ' page-nav__button--active' : ''}`}
            onClick={() => handleNavigate('search')}
            aria-current={activePage === 'search' ? 'page' : undefined}
          >
            Stöbern
          </button>

          <button
            className={`page-nav__button${activePage === 'shopping-list' ? ' page-nav__button--active' : ''}`}
            onClick={() => handleNavigate('shopping-list')}
            aria-label="Einkaufsliste"
            aria-current={activePage === 'shopping-list' ? 'page' : undefined}
          >
            Liste
            {shoppingListItems.length > 0 ? <span className="page-nav__count">{shoppingListItems.length}</span> : null}
          </button>
        </div>

        <form className="page-nav__search" onSubmit={handleNavSearchSubmit}>
          <input
            type="search"
            value={navSearchQuery}
            placeholder="Produkt oder Marke suchen"
            aria-label="Produkt oder Marke suchen"
            onChange={(event) => setNavSearchQuery(event.target.value)}
          />
          <button type="submit" className="page-nav__search-button">
            Suchen
          </button>
        </form>
      </nav>
      {isHeaderBetaInfoOpen ? (
        <BetaInfoPanel id="beta-info-header" className="beta-info-panel--header" onClose={() => setIsHeaderBetaInfoOpen(false)} />
      ) : null}

      {activePage === 'shared-shopping-list' ? (
        <SharedShoppingListPage
          shareId={sharedListId}
          onNavigate={handleNavigate}
          onAdoptItems={handleAdoptSharedShoppingList}
        />
      ) : activePage === 'search' ? (
        <div className="browse-page">
          <SearchPage
            retailers={retailers}
            categories={categories}
            filtersLoading={filtersLoading}
            ranking={ranking}
            rankingLoading={rankingLoading}
            rankingLoadingMore={rankingLoadingMore}
            draftRetailers={draftSelectedRetailers}
            draftCategoryLabels={draftSelectedCategoryLabels}
            appliedRetailers={appliedSelectedRetailers}
            appliedCategoryLabels={appliedSelectedCategoryLabels}
            error={error}
            hasPendingChanges={hasPendingChanges}
            shoppingListIds={shoppingListIds}
            onToggleDraftRetailer={handleToggleDraftRetailer}
            onSelectAllRetailers={handleSelectAllRetailers}
            onClearRetailers={handleClearRetailers}
            onToggleDraftMainCategory={handleToggleDraftMainCategory}
            onToggleDraftSubcategory={handleToggleDraftSubcategory}
            onSelectAllDraftCategories={handleSelectAllDraftCategories}
            onClearDraftCategories={handleClearDraftCategories}
            onApplySearch={handleApplySearch}
            onLoadMoreOffers={handleLoadMoreBrowseOffers}
            onResetAll={handleResetAll}
            onAddToShoppingList={handleAddToShoppingList}
          />
        </div>
      ) : activePage === 'product-search' ? (
        <div className="search-first-page">
          <BetaNoticeDisclosure onNavigate={handleNavigate} />
          <SearchLandingHero />
          <KeywordSearchPage
            searchRequest={keywordSearchRequest}
            retailers={retailers}
            categories={categories}
            shoppingListIds={shoppingListIds}
            onAddToShoppingList={handleAddToShoppingList}
          />
          <HowItWorksSection />
          <DiscoverOffersSection />
          <TrustAndFaqSection />
        </div>
      ) : activeSeoLandingPage ? (
        <SeoOfferLandingPage
          page={activeSeoLandingPage}
          categories={categories}
          shoppingListIds={shoppingListIds}
          onAddToShoppingList={handleAddToShoppingList}
        />
      ) : activePage === 'shopping-list' ? (
        <ShoppingListPage
          shoppingListItems={shoppingListItems}
          onRemoveItem={handleRemoveShoppingListItem}
          onClearList={handleClearShoppingList}
          onGoToOffers={() => handleNavigate('product-search')}
          onNavigate={handleNavigate}
        />
      ) : activePage === 'feedback' ? (
        <FeedbackPage />
      ) : activePage === 'impressum' ? (
        <ImpressumPage />
      ) : activePage === 'privacy' ? (
        <PrivacyPage />
      ) : activePage === 'liability' ? (
        <LiabilityPage />
      ) : activePage === 'cookies' ? (
        <CookiesPage />
      ) : (
        <>
          {loading && !snapshot ? <p className="status">Lade Ansicht …</p> : null}
          <DiagnosticsPage
            health={health}
            snapshot={snapshot}
            essence={essence}
            error={error}
            feedbackState={feedbackState}
            feedbackNote={feedbackNote}
            setFeedbackNote={setFeedbackNote}
            handleSaveFeedback={handleSaveFeedback}
            onReload={reloadAll}
            loading={loading}
          />
        </>
      )}

      <SeoFooterLinks />
      <CookieStorageNotice onNavigate={handleNavigate} />
      <StickyBottomLine onNavigate={handleNavigate} />
    </main>
  )
}

export default App
