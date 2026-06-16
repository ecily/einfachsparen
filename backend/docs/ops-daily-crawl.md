# Daily Crawl Operations

## Runtime contract

The production crawl is asynchronous. `POST /api/crawl/run` accepts a CrawlRun and returns a `runId`; it does not keep the HTTP request open until the crawl is finished.

Daily scheduling is controlled by ENV:

- `CRAWL_RUN_ON_START=false`
- `CRAWL_SCHEDULE_ENABLED=true`
- `CRAWL_SCHEDULE_CRON=0 6 * * *`
- `CRAWL_SCHEDULE_TIMEZONE=Europe/Vienna`

The scheduler is disabled unless `CRAWL_SCHEDULE_ENABLED` is explicitly `true`. Deploys and restarts must not trigger a crawl. The daily run is a full crawl over all active, enabled, crawlable sources. Disabled sources are not activated automatically.

`0 6 * * *` in `Europe/Vienna` intentionally keeps the scheduled full crawl away from the observed DigitalOcean deploy/restart window. The previous `0 4 * * *` setting mapped to `02:00Z` during summer time and collided with a DigitalOcean restart on 2026-06-16. Production crawls are also blocked during the backend startup grace window.

## Lock and failure behavior

A DB-backed global CrawlRun lock prevents parallel full crawls across app instances. If a manual or scheduled crawl is already `queued` or `running`, a second start returns the existing `runId` instead of starting another run. Stale lock recovery is conservative: a stuck run is considered stale after 18 hours and is marked failed before a new run can acquire the lock.

Source failures are reported as `partial` or `failed`; they are not silently converted to success. Existing live offers for a failed or empty-yield source are retained. Source-level offer refresh is guarded so a source is not cleared before its new offers have been built. On MongoDB deployments that support transactions, source offer replacement is transactional; otherwise the fallback inserts the new source snapshot before deleting previous offers for that source.

This is sourcewise atomic protection, not a full global generation swap. During a successful source refresh, that source can become visible before the entire full crawl has finished. Dedupe and filter metadata rebuild still run only after all source crawls complete.

## Morning check

Fetch the latest CrawlRun:

```bash
curl --ssl-no-revoke -sS "https://www.kaufklug.at/api/crawl/runs/latest" \
  -H "x-admin-api-key: $ADMIN_API_KEY"
```

Check health and performance:

```bash
for url in \
"https://www.kaufklug.at/api/health" \
"https://www.kaufklug.at/api/filters/retailers" \
"https://www.kaufklug.at/api/filters/categories" \
"https://www.kaufklug.at/api/offers/ranking?limit=1" \
"https://www.kaufklug.at/api/offers/ranking?q=kaffee&limit=20" \
"https://www.kaufklug.at/api/offers/ranking?q=butter&limit=20" \
"https://www.kaufklug.at/api/offers/ranking?q=reis&limit=20" \
"https://www.kaufklug.at/api/offers/ranking?q=waschmittel&limit=20"
do
  echo "=== $url ==="
  curl --ssl-no-revoke --max-time 8 -o /dev/null -w "HTTP %{http_code} time %{time_total}s\n" -s "$url"
done
```

Check query quality after the crawl:

- `q=kaffee`
- `q=kaffee&retailers=spar`
- `q=butter`
- `q=reis`
- `q=waschmittel`
- `q=milch`
- `q=joghurt`
- `q=nudeln`
- `q=bier`

Evaluate result count, displayed offers, category/subcategory quality, obvious side hits, duplicate regressions, `dedupe`, `filterMetadata.ok`, `processedOffers`, `activeEligibleSources`, `matchedSourcesCount`, `perRetailer`, and `sourceTypes`.

## Manual async full crawl

Start only when no run is already `queued` or `running`:

```bash
curl --ssl-no-revoke -sS -X POST "https://www.kaufklug.at/api/crawl/run" \
  -H "content-type: application/json" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  --data '{"dryRun":false}'
```

Poll the returned `runId` or the latest run every 30-60 seconds:

```bash
curl --ssl-no-revoke -sS "https://www.kaufklug.at/api/crawl/runs/latest" \
  -H "x-admin-api-key: $ADMIN_API_KEY"
```

Missing `validTo` is allowed for current-source offers. Safe `validFrom` and `validTo` values are stored when available. No artificial validity dates should be generated. The public product language must stay honest: prices, availability, and conditions should be checked in the market.
