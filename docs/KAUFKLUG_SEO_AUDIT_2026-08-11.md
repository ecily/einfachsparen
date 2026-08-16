# kaufklug.at SEO-P0-Audit – 2026-08-11

## Executive summary

The live site currently serves the same Vite SPA shell for `/`, `/top-deals`, known SEO landing pages, query URLs and unknown `/angebote/<slug>` paths. Before JavaScript, non-root routes therefore expose the root title and root canonical. Unknown offer slugs return HTTP 200 and are a soft-404 risk.

Observed live behavior before this change:

| URL class | Status | Initial canonical | Initial robots | Initial content |
|---|---:|---|---|---|
| `/` | 200 | `/` | index,follow | generic shell |
| `/top-deals` | 200 | `/` | index,follow | generic shell |
| `/angebote/billa` | 200 | `/` | index,follow | generic shell |
| `/angebote/unknown` | 200 | `/` | index,follow | generic shell |
| `/suche?q=bier` | 200 | `/` | index,follow | generic shell |

HTTP/HTTPS and robots were otherwise reachable. `robots.txt` references the sitemap and does not block valuable assets. The existing sitemap contained canonical-looking public landing pages but omitted `/top-deals`.

## Implemented safe fixes

- Vite production build now emits route-specific static HTML for the homepage, `/top-deals/`, legal pages and every configured SEO landing page.
- Initial HTML contains route-specific title, description, robots, canonical, Open Graph URL and visible H1/intro content.
- BreadcrumbList JSON-LD is emitted per generated route; existing WebSite/WebApplication JSON-LD remains in the template.
- Public SEO links and canonical policy use one trailing-slash convention for indexable landing pages.
- `/top-deals/` was added to the sitemap.
- `404.html` is provided with `noindex,nofollow` for hosts that honor a static error document.
- `catchall.html` is generated as a noindex/nofollow, no-canonical fallback that can still boot the SPA for dynamic shared-list URLs.
- Known utility SPA routes (`/stoebern`, `/suche`, `/einkaufsliste`, `/liste`, `/feedback`, `/ecily_web`) receive initial noindex HTML and are not sitemap candidates.
- Unknown `/angebote/<slug>` is fail-closed by `catchall.html`; DO Static Site configuration must set `catchall_document` to `catchall.html`. A true HTTP 404 remains preferable, but would require a separate dynamic-route hosting decision.

## Indexability policy

Only configured landing pages with `robots: index,follow`, the homepage, Top Deals and legal information pages belong in the sitemap. Search, shopping-list, shared-list, diagnostics, parameter and unknown offer URLs are not sitemap candidates. Thin or currently noindex landing pages remain noindex until coverage and unique user value justify promotion.

The current configured indexable landing set is:

`/angebote/`, `/angebote/supermarkt/`, `/angebote/drogerie/`, `/angebote/billa/`, `/angebote/hofer/`, `/angebote/lidl/`, `/angebote/dm/`, `/angebote/bipa/`, `/angebote/penny/`, `/angebote/waschmittel/`, `/angebote/butter/`.

SPAR, Müller and thin product/category pages remain governed by their existing noindex policy. PAGRO and ZGONC were not included in this work.

## Tests

- `npm run lint --prefix admin`: passed
- all frontend Node tests: 36/36 passed
- `npm run build --prefix admin`: passed
- 17 sitemap URLs validated against generated files, self-canonical and `index,follow`
- local Vite preview verified route-specific HTML for `/`, `/top-deals/`, `/angebote/billa/` and `/angebote/spar/`
- `git diff --check`: passed

## Remaining live verification

## Follow-up live audit 2026-08-13

The pushed landing-page retailer communication is present in `main`, but the read-only live root HTML still serves the previous static footer/hero build. It does not yet expose the intended BILLA Plus/MÃ¼ller entries or the explicit `HOFER eingeschrÃ¤nkt` / `INTERSPAR eingeschrÃ¤nkt` wording. This is a deployment/build-trigger issue, not an SEO copy or Public-Validity issue. No parser, crawler, database, or public-visibility relaxation was made.

The follow-up static-shell fix `b3520de0` is now live: initial homepage HTML exposes the current hero, comparison-unit message, complete retailer communication and trust note before JavaScript. Runtime mobile/desktop smoke is green for the homepage. The remaining SEO/data risk is not the shell: the live `waschmittel` query currently has no dm result despite dm having active public offers overall, and the Top Deals API is materially slower than normal ranking queries. No speculative SEO pages or claims were added.

The repository now generates `catchall.html`, and the live DigitalOcean Static Site uses `catchall_document=catchall.html`. Unknown URLs therefore return the catchall document with HTTP 200, `noindex,nofollow`, no Canonical and a clear 404 UI. A true HTTP 404 would require switching the catchall to `404.html`, which would break dynamic shared-list SPA routes; therefore `catchall.html` is the safe current contract.

The final live smoke verified homepage, Top Deals, BILLA, Lidl, all utility routes, three unknown paths, robots and sitemap. Unknown paths have no redirect, no Root-Canonical and no indexable SEO metadata. A true HTTP 404 remains a future hosting decision; the current public contract is fail-closed Variant B.
-
## SEO-Autopilot und Search-Console-Daten 2026-08-16

The operator supplied a three-month Search Console export. The clearest existing-page opportunities are Lidl, BILLA, HOFER, the supermarket overview, BIPA and Waschmittel: these pages already receive impressions around or below page two but have low CTR. Mobile is the larger impression segment. The export is treated as prioritization evidence only; no Search Console API, submission or guessed query data was added.

The static generator now performs a read-only build-time quality check against public ranking and Top Deals responses. Indexable category pages require at least 10 public offers and two retailers. Retailer pages additionally require at least 50% image coverage. Pages with unavailable or weak evidence are fail-closed to `noindex,follow` and removed from the generated sitemap; configured noindex pages are never auto-promoted. This does not alter Public Validity or ranking.

The data-backed `/angebote/deo/` landing page was added. Static and runtime metadata now use the existing trailing-slash canonical convention, route-specific OG/Twitter image metadata, clearer title/description/H1 copy and related internal links. The generated sitemap currently contains 27 URLs; Mueller remains governed by its existing noindex policy. Search Console requests remain an operational next step after the daily limit/window permits them.
-
## SEO-Autopilot Live-Status 2026-08-16

Commit `346249ca` is pushed to `origin/main` and the local static build is green. The public Static Site has not consumed it yet: live `Last-Modified` remains 2026-08-15, the new `/angebote/deo/` route is still the noindex catchall and the live sitemap still has 26 URLs. The repository contains no verifiable DigitalOcean app spec, `doctl` access or deploy workflow. The remaining blocker is therefore an operator-side DO Static Site rebuild/trigger for the existing repository/branch/root/output contract; no SEO, database or Public Validity change is required.
-
## SEO-Autopilot Live-Verifikation 2026-08-16

The DigitalOcean Static Site now serves the pushed SEO build. `/angebote/deo/`, `/angebote/lidl/` and `/angebote/billa/` return HTTP 200 with `index,follow`, route-specific copy, self-canonicals and Open Graph metadata. The sitemap returns 27 URLs and includes Deo, Lidl and BILLA; Mueller remains excluded by its existing noindex policy. No product, crawler, database or Public Validity logic was changed.
