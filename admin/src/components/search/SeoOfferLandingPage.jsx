import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchOfferRankingDirect } from '../../utils/apiBase'
import { flattenRankingOffers, getOfferStableId, getRankingPagination, mergePaginatedRankingResults } from '../../utils/offers'
import { SEO_TRUST_COPY } from '../../config/seoLandingPages'
import { buildSeoComparisonSummary } from '../../utils/seoComparisonSummary.js'
import { OfferCardConsumer } from './OfferCardConsumer'

const MIN_USEFUL_OFFER_COUNT = 1

function combineInitialRankingResults(results = []) {
  return results.filter(Boolean).reduce((mergedRanking, ranking) => {
    if (!mergedRanking) return ranking

    return {
      ...mergePaginatedRankingResults(mergedRanking, ranking),
      summary: {
        ...(mergedRanking.summary || {}),
        ...(ranking.summary || {}),
        resultCount: Number(mergedRanking.summary?.resultCount || 0) + Number(ranking.summary?.resultCount || 0),
        displayedCount: flattenRankingOffers(mergedRanking).length + flattenRankingOffers(ranking).length,
        hasMore: false,
        nextOffset: null,
      },
    }
  }, null)
}

async function fetchSeoLandingRanking(page) {
  const queries = Array.isArray(page?.queries) ? page.queries.filter(Boolean) : []

  if (!queries.length) {
    return fetchOfferRankingDirect(page.query || {})
  }

  const results = await Promise.all(queries.map((query) => fetchOfferRankingDirect(query)))
  return combineInitialRankingResults(results)
}

function getFallbackText(page) {
  if (page.robots === 'index,follow') {
    return 'Aktuell wurden nicht gen\u00fcgend passende Angebote erkannt. Bitte Suche und Marktbedingungen pr\u00fcfen.'
  }

  return 'Diese Seite ist \u00f6ffentlich erreichbar, wird aber erst nach weiterer Datenqualit\u00e4tspr\u00fcfung indexiert. Aktuell wurden nicht gen\u00fcgend passende Angebote erkannt.'
}

export function SeoOfferLandingPage({ page, categories = [], shoppingListIds, onAddToShoppingList }) {
  const requestIdRef = useRef(0)
  const [ranking, setRanking] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const offers = useMemo(() => flattenRankingOffers(ranking), [ranking])
  const comparisonSummary = useMemo(() => page.comparisonKey
    ? buildSeoComparisonSummary({
      pageKey: page.comparisonKey,
      offers,
      totalCount: Number(ranking?.summary?.totalCount || offers.length),
      generatedAt: ranking?.generatedAt || new Date().toISOString(),
    })
    : null, [offers, page.comparisonKey, ranking?.generatedAt, ranking?.summary?.totalCount])
  const pagination = useMemo(() => getRankingPagination(ranking), [ranking])
  const showFallback = !loading && (!offers.length || offers.length < MIN_USEFUL_OFFER_COUNT || error)

  useEffect(() => {
    if (!page) return undefined

    let active = true
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    async function loadOffers() {
      try {
        setLoading(true)
        setLoadingMore(false)
        setError('')
        const rankingResult = await fetchSeoLandingRanking(page)

        if (!active || requestId !== requestIdRef.current) return

        setRanking(rankingResult)
      } catch {
        if (!active || requestId !== requestIdRef.current) return
        setRanking(null)
        setError('Die Angebote konnten gerade nicht geladen werden.')
      } finally {
        if (active && requestId === requestIdRef.current) setLoading(false)
      }
    }

    loadOffers()

    return () => {
      active = false
    }
  }, [page])

  async function handleLoadMoreOffers() {
    if (loading || loadingMore || !pagination.hasMore || pagination.nextOffset === null) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    try {
      setLoadingMore(true)
      setError('')
      const nextRanking = await fetchOfferRankingDirect({
        ...(page.query || {}),
        offset: pagination.nextOffset,
        resultSetToken: ranking?.summary?.resultSetToken || '',
      })

      if (requestId !== requestIdRef.current) return

      setRanking((currentRanking) => mergePaginatedRankingResults(currentRanking, nextRanking))
    } catch {
      if (requestId !== requestIdRef.current) return
      setError('Weitere Angebote konnten gerade nicht geladen werden.')
    } finally {
      if (requestId === requestIdRef.current) setLoadingMore(false)
    }
  }

  if (!page) {
    return (
      <section className="panel seo-offer-page">
        <h1>Angebote nicht gefunden</h1>
        <p className="subtitle">Diese Angebotsseite ist nicht verf\u00fcgbar.</p>
      </section>
    )
  }

  return (
    <div className="seo-offer-page">
      <section className="panel seo-offer-hero">
        <p className="eyebrow">Aktuelle Angebote</p>
        <h1>{page.h1}</h1>
        <p className="subtitle">{page.intro}</p>
        {page.note ? <p className="seo-offer-page__note">{page.note}</p> : null}
        <p className="market-check-note">{SEO_TRUST_COPY}</p>
      </section>

      {comparisonSummary?.facts?.length ? (
        <section className="panel seo-comparison-card" aria-labelledby="seo-comparison-card-title">
          <div className="seo-comparison-card__heading">
            <div>
              <p className="eyebrow">Vergleichs-Fakten</p>
              <h2 id="seo-comparison-card-title">Preise sinnvoll vergleichen</h2>
            </div>
            <p>{comparisonSummary.note}</p>
          </div>
          <div className="seo-comparison-card__facts">
            {comparisonSummary.facts.map((fact) => {
              const [value, ...labelParts] = fact.split(' ')
              return <div className="seo-comparison-card__fact" key={fact}><strong>{value}</strong><span>{labelParts.join(' ') || fact}</span></div>
            })}
          </div>
          <p className="seo-comparison-card__stand">Stand: {new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeZone: 'Europe/Vienna' }).format(new Date(comparisonSummary.dataStand))}</p>
        </section>
      ) : null}

      <section className="panel seo-offer-results" aria-busy={loading || loadingMore ? 'true' : 'false'}>
        <div className="panel__header">
          <h2>Aktuelle Treffer</h2>
          <p>
            {offers.length > 0
              ? `${offers.length} passende Angebote angezeigt.`
              : 'Angebote werden aus den aktuell erkannten Daten geladen.'}
          </p>
        </div>

        {loading ? (
          <div className="browse-loading-status" role="status" aria-live="polite">
            <span className="browse-loading-status__spinner" aria-hidden="true" />
            <span>Angebote werden geladen &hellip;</span>
          </div>
        ) : null}

        {showFallback ? (
          <div className="empty-state">
            <h3>{error || 'Aktuell nicht gen\u00fcgend passende Angebote erkannt.'}</h3>
            <p>{getFallbackText(page)}</p>
          </div>
        ) : null}

        {offers.length > 0 ? (
          <>
            <div className="user-results seo-offer-results__grid">
              {offers.map((offer, index) => (
                <OfferCardConsumer
                  key={offer.id}
                  offer={offer}
                  onAddToShoppingList={onAddToShoppingList}
                  isInShoppingList={shoppingListIds.has(getOfferStableId(offer))}
                  feedbackCategories={categories}
                  enableOfferFeedback={false}
                  feedbackPageContext={{
                    routeName: 'seo-offer-landing',
                    query: page.query?.q || '',
                    activeRetailers: String(page.query?.retailers || '').split(',').filter(Boolean),
                    activeCategories: String(page.query?.categories || '').split(',').filter(Boolean),
                    resultPosition: index + 1,
                    activeFilters: page.query || {},
                  }}
                />
              ))}
            </div>

            {pagination.hasMore ? (
              <div className="load-more-results" role="status" aria-live="polite">
                <button
                  type="button"
                  className="load-more-results__button"
                  onClick={handleLoadMoreOffers}
                  disabled={loadingMore}
                  aria-busy={loadingMore ? 'true' : 'false'}
                >
                  {loadingMore ? (
                    <>
                      <span className="browse-loading-status__spinner" aria-hidden="true" />
                      <span>Weitere Angebote werden geladen &hellip;</span>
                    </>
                  ) : (
                    'Weitere Angebote laden'
                  )}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {page.relatedLinks?.length ? (
        <nav className="panel seo-offer-related" aria-label="Verwandte Angebotsseiten">
          <div className="panel__header">
            <h2>Verwandte Angebote</h2>
            <p>Weitere stabile Angebotsseiten auf kaufklug.at.</p>
          </div>
          <div className="seo-offer-related__links">
            {page.relatedLinks.map((link) => (
              <a key={link.path} href={link.path}>
                {link.label}
              </a>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  )
}
