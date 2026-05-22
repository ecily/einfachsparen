# SPAR Official Source Discovery 2026-05-22

Scope: SPAR, EUROSPAR and INTERSPAR official-first offer discovery for Steiermark / Graz beta readiness.

Constraints:
- No production mutation was performed.
- No production crawl was started.
- No Cloudflare, 403 or challenge bypass was attempted.
- Normal assortment or private-label product pages are not valid offers without explicit offer evidence.

## Git and Deploy Read-Only Check

- Local branch: `main...origin/main`, clean at the time of the check.
- Local HEAD: `daa5f8ac Protect SPAR flyer refresh coverage`.
- Remote contains `daa5f8ac` on `origin/main`.
- Live `/api/health`: HTTP 200.
- Live build time: `2026-05-22T07:03:38.794Z`.
- Live commit fields remain `unknown`, so the deploy is visible as a new process start but not provable by commit SHA.

## Current Productive SPAR Source Shape

Active / eligible source definitions for SPAR formats are still:
- `spar-official-flyer-pdf`
- `eurospar-official-flyer-pdf`
- `interspar-official-flyer-pdf`
- `aktionsfinder-spar`
- `aktionsfinder-eurospar`
- `aktionsfinder-interspar`

The official action and product-world pages exist as disabled/planned source definitions or matrix resources, but are not productive crawl sources.

## URL Discovery Results

| URL | Direct Node/Crawler Result | curl Result | Structured Data | Images | Offer Evidence | Region / Format Signal | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `https://www.spar.at/produktwelt/bier?inAngebot=true&page=1` | TLS failure: `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | HTTP 403 Cloudflare challenge | none observed | none observed | query has `inAngebot=true`, but body is challenge HTML | category only | not crawlable |
| `https://www.spar.at/produktwelt/kaffee?inAngebot=true&page=1` | TLS failure | HTTP 403 Cloudflare challenge | none observed | none observed | query has `inAngebot=true`, but body is challenge HTML | category only | not crawlable |
| `https://www.spar.at/produktwelt/waschmittel?inAngebot=true&page=1` | TLS failure | HTTP 403 Cloudflare challenge | none observed | none observed | query has `inAngebot=true`, but body is challenge HTML | category only | not crawlable |
| `https://www.spar.at/eigenmarken/lebensmittel/s-budget` | TLS failure | HTTP 403 Cloudflare challenge | none observed | none observed | none | private-label assortment page | not an offer source |
| `https://www.spar.at/produktwelt/s-budget-semmel-p2020000576228` | TLS failure | HTTP 403 Cloudflare challenge | none observed | none observed | none | product detail | not an offer source |
| `https://www.spar.at/aktionen/steiermark/spar` | TLS failure | HTTP 403 Cloudflare challenge | none observed | none observed | none from body | Steiermark/SPAR in URL | not crawlable |
| `https://www.spar.at/aktionen/steiermark/eurospar` | TLS failure | HTTP 403 Cloudflare challenge | none observed | none observed | none from body | Steiermark/EUROSPAR in URL | not crawlable |
| `https://www.spar.at/aktionen/steiermark/interspar` | TLS failure | HTTP 403 Cloudflare challenge | none observed | none observed | none from body | Steiermark/INTERSPAR in URL | not crawlable |
| `https://www.interspar.at/aktionen/steiermark` | TLS failure | HTTP 403 Cloudflare challenge | none observed | none observed | none from body | Steiermark/INTERSPAR in URL | not crawlable |
| `https://www.interspar.at/shop/lebensmittel/` | TLS failure | HTTP 403 Cloudflare challenge | none observed | none observed | none from body | INTERSPAR shop | not crawlable as offer source |
| `https://www.interspar.at/shop/haushalt/` | TLS failure | HTTP 403 Cloudflare challenge | none observed | none observed | none from body | INTERSPAR shop | not crawlable as offer source |
| `https://www.interspar.at/shop/weinwelt/` | TLS failure | HTTP 403 Cloudflare challenge | none observed | none observed | none from body | INTERSPAR Weinwelt | not crawlable as offer source |

## Sitemaps and Assets

SPAR:
- `https://www.spar.at/robots.txt` is publicly reachable and allows crawling generally, with sitemap `https://www.spar.at/index.sitemap-index.xml`.
- `https://www.spar.at/index.sitemap.produktwelt-sitemap.xml` is publicly reachable and lists product detail URLs, including S-BUDGET, beer, coffee and detergent-like products.
- The product-world sitemap does not include prices, discount markers, validity, offer flags, or images in the sampled output.
- `https://www.spar.at/index.sitemap.xml` lists action pages and private-label pages, including Steiermark format pages and S-BUDGET pages, but no item-level offer payload.

INTERSPAR:
- `https://www.interspar.at/robots.txt` is publicly reachable and lists shop sitemaps:
  - `https://www.interspar.at/shop/lebensmittel/sitemap.xml`
  - `https://www.interspar.at/shop/haushalt/sitemap.xml`
  - `https://www.interspar.at/shop/weinwelt/sitemap.xml`
- Shop product sitemaps are publicly reachable and include product URLs plus CDN image URLs like `https://cdn1.interspar.at/cachableservlets/articleImage.dam/at/<productId>/dt_sub.jpg`.
- These sitemaps do not include current price, reference price, promotion flags, validity, multibuy conditions, or customer-card evidence.
- Therefore they are useful as a future image/catalog enrichment input, but not as an offer source.

## API Probe Results

The Azure host exposed by a product-world 404 was checked:
- `https://app-ecom-prd-weu1-pw-fe.azurewebsites.net/produktwelt/...`
- Result: HTTP 403 `Ip Forbidden`, `Web App - Unavailable`.
- No JSON, no offer payload, no stable crawl path.

Limited INTERSPAR shop API pattern probes were checked:
- `/shop/lebensmittel/rest/v2/interspar/products/1000542`
- `/shop/lebensmittel/rest/v2/interspar/products/1000542?fields=FULL`
- `/shop/lebensmittel/occ/v2/interspar/products/1000542?fields=FULL`
- `/shop/lebensmittel/api/products/1000542`
- `/shop/lebensmittel/search?text=bier`
- `/shop/lebensmittel/angebote/c/ISAT-ANGEBOTE?page=1`

Result: HTTP 403 Cloudflare challenge HTML for all sampled endpoints.

## Release Conclusion

No stable, legal, directly crawlable official structured offer source was found in this pass.

Do not implement:
- A parser for Cloudflare challenge HTML.
- An offer source from normal product or private-label sitemaps.
- S-BUDGET offer ingestion without explicit offer evidence.
- Any ppcv reactivation.

Acceptable transition state:
- Official PDF sources with the existing broader parser and coverage guard.
- Aktionsfinder only as supplementary source.
- Clear release risk: SPAR official-first architecture is still not sufficient for beta quality if limited to PDF + aggregator.

Next information gap:
- A directly reachable official SPAR/Productworld offer JSON endpoint, asset manifest, or server-rendered HTML snapshot that includes item-level price/promotion evidence.
- A browser Network inspection of the official pages by a human, without automating challenge solving, to identify whether public JSON endpoints exist after normal page load.
- Official confirmation or documentation of SPAR/INTERSPAR product/offers APIs, if available.
