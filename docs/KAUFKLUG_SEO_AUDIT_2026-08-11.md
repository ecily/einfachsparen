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
- `404.html` is provided with `noindex,follow` for hosts that honor a static error document.
- Unknown `/angebote/<slug>` remains client-side `noindex,follow`; a final HTTP-404 verification is still required after deployment because the current DO static catchall is provider-controlled.

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

After the normal deployment, verify with raw HTTP (without JavaScript): homepage, `/top-deals/`, all sitemap URLs, robots, sitemap and an unknown `/angebote/<slug>`. Confirm that the DO static catchall no longer serves root HTML for known routes and that unknown routes are HTTP 404 or otherwise explicitly noindex. Then inspect five to ten canonical URLs in Search Console and validate only the corrected problem classes.
