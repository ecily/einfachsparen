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

## Position-11-20-Chancenprüfung 2026-08-26

Eine aktuelle datenbasierte Kandidatenliste ist noch nicht möglich. Im Repository und in der Git-Historie ist der frühere Drei-Monats-Export nur als verdichtete Seitenauswahl dokumentiert; die benötigten Query×Landingpage-Zeilen und Kennzahlen fehlen. Es war weder ein Search-Console-Connector noch eine verbundene, bereits angemeldete Browser-Sitzung verfügbar. Deshalb wurden weder Rankings/Suchvolumina geschätzt noch Landingpages auf Verdacht geändert.

Der technische Read-only-Stand ist grün: 27 eindeutige Sitemap-URLs, Deo enthalten, indexierbare Kernseiten mit Self-Canonical, individueller Suchintention in Title/Description/H1, internen Links und validem WebSite-/WebApplication-/BreadcrumbList-JSON-LD. Queryparameter kanonisieren auf die jeweilige Basis-Landingpage; die Such- und Browse-Seiten bleiben noindex. Der HTTP-200-Catch-all bleibt für unbekannte Pfade `noindex,nofollow`, ohne Canonical und mit sichtbarer 404-Copy. Die früher bekannten Deo-/404-/27-URL-Testfehler sind nicht mehr reproduzierbar: `node --test admin/src/utils/*.test.mjs` aus dem Repository-Root ist 74/74 grün.

Die aktuelle Angebotsabdeckung ist für bestehende Seiten belastbar (Snapshot ca. 2026-08-26T12:01Z): Kaffee 107, Bier 33, Waschmittel 225 und Deo 43 öffentliche Treffer; BILLA 939, HOFER 38, Lidl 75 und BIPA 890. Parfum liefert zwar 52 Treffer aus vier Händlern, besitzt aber bewusst keine indexierbare Landingpage; ohne reale GSC-Nachfrage und Query-Zuordnung ist das kein Freibrief für eine neue Seite. Als Kannibalisierungsrisiken sind vor einer Änderung besonders `/angebote/` versus `/angebote/supermarkt/` sowie breite Hygiene-Intention versus `/angebote/drogerie/` zu prüfen; die Bier-Landingpage und der Literpreis-Preischeck haben dagegen klar unterscheidbare Intentionen.

Benötigter Export: Property `sc-domain:kaufklug.at` beziehungsweise die tatsächlich verwendete kaufklug-Property, Search type `web`, Country `AUT`, `dataState=final`, Dimensionen `query,page`, Metriken `clicks,impressions,ctr,position`; zwei CSVs für die letzten 90 und 28 vollständigen verfügbaren Tage mit identischem Enddatum. API-seitig `rowLimit=25000` und bei Bedarf `startRow` paginieren. Erst mit diesen Rohzeilen werden `position > 10 && position <= 20`, Trend, CTR, Impressionen und Landingpage-Kannibalisierung bewertet und maximal fünf Seite-1-Kandidaten festgelegt.

## Echte österreichische GSC-Exporte 2026-08-26

Die bereitgestellten Google-Web-Exporte lösen den Query-Datenblocker teilweise. Der Hauptzeitraum ist tatsächlich `Last 3 months` vom 25.05. bis 24.08.2026, das Trendfenster 28.07. bis 24.08.2026. Die Queries- und Pages-Tabellen sind getrennt; deshalb sind die folgenden Zielseiten fachlich aus der bestehenden Seitenarchitektur zugeordnet, aber nicht als GSC-Query×Page-Verbindung behauptet.

Gefilterte Basis (`position > 10 && position <= 20`): 408 von 1.000 exportierten Queries, 6.583 Impressionen, 15 Klicks. Die fünf stärksten noch offenen Chancen sind:

1. `hofer aktion heute` -> fachlich `/angebote/hofer/`: 436 Impressionen, CTR 0,23 %, Position 10,36; zuletzt 255 / 0,39 % / 10,62. Sehr nah an Seite 1 und hohe aktuelle Nachfrage.
2. `lidl prospekt aktuell` -> fachlich `/angebote/lidl/`: 305 / 0 % / 10,43; zuletzt 192 / 0 % / 10,57. Hohe aktuelle Impressionen, aber vollständiger CTR-Ausfall und leichter Grenzverlust.
3. `penny angebote` -> fachlich `/angebote/penny/`: 177 / 0 % / 10,45; alle 177 Impressionen liegen auch im 28-Tage-Export. Klare Angebotsintention, unmittelbare Seite-1-Distanz.
4. Supermarkt-Cluster -> fachlich `/angebote/supermarkt/`: `supermarkt prospekte` 225 / 0 % / 17,88, zuletzt 47 / 0 % / 10,89; `angebote supermarkt österreich` 102 / 0 % / 10,65, zuletzt 44 / 0 % / 11,73. Gute Trend- beziehungsweise Österreich-Intention, aber die Seite selbst liegt in der Page-Tabelle deutlich schwächer und die Prospekt-Intention muss ehrlich erfüllt werden.
5. `bipa angebote` -> fachlich `/angebote/bipa/`: 62 / 1,61 % / 11,02; zuletzt 30 / 3,33 % / 10,03. Kleinere Nachfrage, aber die kürzeste verbleibende Distanz und bereits funktionierende CTR.

`billa angebote` ist mit 1.532 Impressionen und Position 10,23 der größte Hauptzeitraum-Treffer, liegt im Trendfenster aber bereits auf Position 9,90. Diese Query ist daher zu sichern und auf CTR zu beobachten, nicht als noch offener Seite-1-Sprung zu zählen. Kaffee (31 gefilterte Impressionen), Waschmittel (80) sowie Parfum/Hygiene/Deo (keine Position-11-20-Query) sind gegenüber den Händler- und Supermarktchancen derzeit nachrangig.

Die Page-Exporte zeigen eine reale URL-Aufspaltung: mehrere Landingpages werden mit und ohne abschließenden Slash separat geführt, besonders BILLA (4.010 plus 560 Impressionen) und HOFER (2.597 plus 385). Live liefern beide Varianten HTTP 200 und kanonisieren auf die Slash-URL. Ein hosting-sicherer 301-Redirect zur Canonical-Variante ist damit der kleinste technische Prüfpunkt vor Copy-Ausbau; sein Rankingeffekt ist noch nicht bewiesen. Keine SEO- oder Deployment-Änderung wurde vorgenommen.

## Hosting-Diagnose zur Slash-Konsolidierung 2026-08-26

Die vollständige Live-Matrix bestätigt für alle 26 Nicht-Root-URLs der 27-URL-Sitemap denselben Doppelzustand: Slash und Non-Slash liefern 200, ohne HTTP-Redirect; Canonical, Open Graph und Sitemap bevorzugen bereits konsistent die Slash-URL. Non-Slash plus Query bleibt ebenfalls 200. Catch-all, API, Assets und noindex-Utilities sind getrennte Verträge und dürfen nicht von einer Prefix-Regel erfasst werden. Die bestehende Hostname-Konsolidierung wurde nur read-only erfasst und nicht mit diesem Pfadthema vermischt.

Der belegte Hosting-Eingriffspunkt ist DigitalOcean App Platform Networking beziehungsweise die vollständige App-Ingress-Spec. Das Repository enthält weder aktuell noch in der Git-Historie eine verifizierbare App-Spec oder ein von DigitalOcean dokumentiertes repo-seitiges Redirect-Manifest. Ohne DO-Zugang und ohne die bestehende Spec wäre jede partielle Konfiguration potenziell destruktiv; ein HTML-/JavaScript-Redirect erfüllt den geforderten 301/308-Vertrag nicht. Daher kein Code-Fix, Commit, Push oder Deploy. Der unveränderte Stand ist lokal mit 74/74 Admin-Utility-Tests, ESLint und Production-Build grün; Deo, 404-Markup und 27 Sitemap-URLs sind keine Live-Regressionen.

Fortsetzung erst mit exportierter aktiver DO-App-Spec oder autorisiertem App-Zugriff: 26 exakte Non-Slash-Matches vor der Catch-all-Route, permanente Ziele auf die jeweiligen Slash-URLs, Query-Erhaltung zunächst explizit nachweisen, dann Slash-200/keine Kette/keine Schleife/API/Assets/Utility/Catch-all live prüfen. Die Query-zu-Seite-Phase bleibt bis zu den queryselektierten GSC-`Seiten`-Exporten für 90 und 28 Tage datenbedingt offen.

### Prüfung der aktiven DigitalOcean-App-Spec

Die nachgereichte aktive Spec bestätigt, dass `match.path.exact` verfügbar ist und exakte Non-Slash-Regeln vor der vorhandenen Static-Site-Prefixroute technisch isolierbar wären. Damit ist Prefix-Matching nicht der Blocker. Der erforderliche Zielpfad benötigt jedoch `redirect.uri`; laut offizieller DigitalOcean-Referenz überschreibt dieses Feld die gesamte ursprüngliche URI. Da weder die Spec-Referenz noch die Redirect-Anleitung eine Querystring-Erhaltung oder eine Queryvariable zusichert, erfüllt die Konfiguration den geforderten sicheren Queryvertrag nicht belegbar. Keine Spec wurde verändert, erzeugt, angewendet oder committed; Secrets und vorhandene Komponenten-/Domain-/Ressourcenwerte blieben unangetastet. Das Redirect-Thema wird deshalb nicht weiter als Voraussetzung für die Seite-1-Arbeit behandelt.

Die sieben angekündigten queryselektierten 90-Tage-`Seiten`-Exporte waren zum Prüfzeitpunkt noch nicht vorhanden. Sobald sie vorliegen, wird die tatsächliche Landingpage pro Query ausgewertet. Ein entsprechender 28-Tage-Export ist nur bei mehreren Seiten oder anderweitig unklarer aktueller Zuordnung erforderlich; bis dahin keine Title-, Snippet- oder Contentänderung.

### Queryparameter-Audit und Redirect-Entscheidung

Die 26 indexierbaren Nicht-Root-Seiten sind nicht durchgehend queryfunktionslos. `/top-deals` liest die Facetten `category` und `retailer` clientseitig aus der URL, verlinkt sie intern als teilbare Deep Links und übergibt sie an den serverseitig filternden Top-Deals-Endpunkt. Der Live-Beweis ist funktional: `retailer=billa` änderte Modus und Ergebnis-IDs gegenüber ungefiltert, `category=bier` reduzierte auf 13 andere Deals. Da die aktiven internen URLs ohne Slash erzeugt werden, würde ein Non-Slash-Redirect ohne Query-Erhalt diese Nutzerfunktion entfernen.

`q`, `page`, `sort`, `retailer` und UTM werden auf den gewöhnlichen SEO-Angebotsseiten dagegen nicht zur Seitensteuerung genutzt: Landingpage-Scope ist fest konfiguriert, Pagination bleibt In-Page/API-basiert, UTM wird nicht im eigenen Analytics-Payload erfasst. Die indexierbaren HTML-Dokumente aller 26 Nicht-Root-Sitemap-URLs waren live mit und ohne UTM byte-identisch. Canonical und Open Graph entfernen Queries bewusst und zeigen ebenso wie die Sitemap auf die Slash-Basis-URL; das ist für die Top-Deals-Facetten weiterhin der richtige SEO-Vertrag.

Entscheidung gemäß Sicherheitsregel: keine Redirect-Spec erstellen, keine DigitalOcean-Konfiguration verändern oder hochladen. Canonicals, Sitemap und vorhandene Deep Links bleiben bestehen; das Redirect-Thema ist bewusst zurückgestellt und kein Blocker für Query→Page und Seite 1. Der gezielte Testlauf für Top Deals, statische SEO-Seiten und Catch-all ist 23/23 grün.

## Belegte Query→Page-Auswertung und erster Quick Win 2026-08-26

Die sieben eindeutigen queryselektierten 90-Tage-Exporte wurden über `Queries` und `Filters` validiert; zwei der acht Dateien sind identische HOFER-Duplikate. Sämtliche Queries sind direkt derselben erwarteten Landingpage zugeordnet und nur auf Slash/Non-Slash aufgeteilt, nicht auf mehrere Inhalte:

| Query | belegte Landingpage | Klicks | Impressionen | CTR | Position | Impressionen je URL-Variante |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `billa angebote` | `/angebote/billa/` | 4 | 1.532 | 0,26 % | 10,23 | 83,2 % Non-Slash / 16,8 % Slash |
| `hofer aktion heute` | `/angebote/hofer/` | 1 | 436 | 0,23 % | 10,36 | 92,0 % Non-Slash / 8,0 % Slash |
| `lidl prospekt aktuell` | `/angebote/lidl/` | 0 | 305 | 0 % | 10,43 | 92,8 % Non-Slash / 7,2 % Slash |
| `penny angebote` | `/angebote/penny/` | 0 | 177 | 0 % | 10,45 | 36,7 % Non-Slash / 63,3 % Slash |
| `angebote supermarkt österreich` | `/angebote/supermarkt/` | 0 | 102 | 0 % | 10,65 | 88,2 % Non-Slash / 11,8 % Slash |
| `billa aktionen` | `/angebote/billa/` | 0 | 72 | 0 % | 14,10 | 93,1 % Non-Slash / 6,9 % Slash |
| `bipa angebote` | `/angebote/bipa/` | 1 | 62 | 1,61 % | 11,02 | 95,2 % Non-Slash / 4,8 % Slash |

Bei `billa angebote` summieren sich die beiden Page-Zeilen durch die GSC-Aggregation auf eine Impression mehr als die Query-Zeile; die Anteile sind deshalb gerundet. Keine inhaltliche Kannibalisierung und kein Bedarf für zusätzliche 28-Tage-Seitenexporte. BILLA bleibt wegen der jüngsten Position 9,90 und bereits passendem Snippet unverändert. Lidl wird nicht auf „Prospekt“ optimiert, da kaufklug strukturierte Einzelangebote und kein vollständiges Flugblatt bereitstellt.

Gewählt wurde `/angebote/hofer/`: höchstes verbleibendes Volumen bei unmittelbarer Seite-1-Distanz, eindeutige Zuordnung und ehrliche Aktionsintention. Live lagen 38 öffentliche HOFER-Angebote mit 38 Bildern vor. Nur der Title wurde zu `HOFER Aktionen heute: aktuelle Angebote | kaufklug.at` geändert; Description, H1, sichtbarer Einstiegstext, Angebotsfunktion, Public Validity, Canonical, strukturierte Daten und interne Links bleiben unverändert. Der Title behauptet weder Prospekt noch vollständiges Flugblatt.

Baseline `hofer aktion heute`: 90 Tage 1 Klick, 436 Impressionen, CTR 0,23 %, Position 10,36; letzte 28 Tage 1/255/0,39 %/10,62. Erfolgskriterium nach Neucrawl und einem vollständigen 28-Tage-Kontrollfenster: Position höchstens 10,0; sekundär CTR mindestens 0,8 % bei mindestens 100 Impressionen. Admin-Utility-/Config-Tests 80/80, ESLint und Production-Build grün; HOFER bleibt `index,follow`, self-canonical und Teil der 27-URL-Sitemap.

Commit `b3811c5dd88120a1f34a79df1190b816f0bd37ff` ist auf `origin/main` und regulär über DigitalOcean live. Der neue HOFER-Title, unveränderte Description/H1/Einstiegscopy, Self-Canonical, OG-URL, Breadcrumb-Daten, `index,follow` und die 27-URL-Sitemap wurden live bestätigt. Health antwortet 200 mit Prozessstart `2026-08-26T13:34:43.869Z`; HOFER liefert 38 öffentliche Treffer, Bier-Suche 33 und Top Deals 20. Keine sofortige Google-Wirkung wird aus dem Deployment abgeleitet.
