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

## Zweiter unabhängiger SEO-Hebel: BILLA-CTR 2026-08-26

HOFER bleibt ab Produktcommit `b3811c5d` für mindestens 28 Tage unverändert. Der nächste Test wurde deshalb ausschließlich zwischen BILLA und dem Supermarkt-Cluster entschieden. BILLA hat den höheren erwartbaren absoluten Klickgewinn und die sicherere Zielseite: `billa angebote` plus `billa aktionen` liefern über 90 Tage 4 Klicks aus 1.604 Impressionen, beide durch queryselektierte Seitenexporte eindeutig auf `/angebote/billa/`; im 28-Tage-Fenster 3 Klicks aus 768 Impressionen bei Position 9,90 beziehungsweise 12,47. Das Supermarkt-Cluster hat 627 Impressionen und 0 Klicks, aber außer für `angebote supermarkt österreich` keinen exportbelegten Query-zu-Page-Vertrag; die `Prospekt`-Intention darf zudem nicht als vollständiges Flugblatt dargestellt werden.

Der bestehende BILLA-Vertrag bleibt bis auf die Description intakt: `BILLA Angebote aktuell vergleichen | kaufklug.at`, H1 `BILLA Angebote aktuell vergleichen`, sichtbare BILLA-/BILLA-Plus-Vergleichscopy, `index,follow`, Self-Canonical, Sitemap und relevante interne Links. Nur die Meta-Description nennt nun wahrheitsgemäß BILLA und BILLA Plus, Angebote und Aktionen in Österreich sowie Preise, Packungsgrößen, Gültigkeit und Bedingungen. Keine Title-, H1-, Content-, Routing-, Daten-, Pagination-, Public-Validity- oder HOFER-Änderung und keine Prospektbehauptung.

Der read-only Public-Bestand vor Deployment bestätigt die Nutzerfunktion: BILLA liefert 998 Ergebniszeilen/939 deduplizierte Angebote und initial 24 Treffer von BILLA/BILLA Plus. Die Supermarkt-Landingpage zeigt initial 12 BILLA-/BILLA-Plus-, 8 Lidl- und 8 PENNY-Treffer; alle 28 sichtbaren Angebote haben Gültigkeitsdaten und eindeutige IDs, Pagination bleibt vorhanden. Admin-Utility-/Config-Tests 80/80, ESLint, Production-Build mit System-CA und `git diff --check` sind grün; der Build enthält 27 Sitemap-URLs und den unveränderten HOFER-Vertrag.

Messbaseline des BILLA-Clusters: 90 Tage 4/1.604/0,25 % kombinierte CTR; letzte 28 Tage 3/768/0,39 %. Nach Neucrawl und einem vollständigen 28-Tage-Fenster gilt primär mindestens 6 Klicks bei mindestens 500 Impressionen als Erfolg (+3 gegen die Baseline), sekundär mindestens 0,8 % kombinierte CTR ohne Rückfall von `billa angebote` hinter Position 10,5. Die Maßnahme ist ein CTR-Test; Google kann die Description abweichend umschreiben.

## Vollständiges Opportunity-Modell und autonomer Folgelauf 2026-08-26

Verbindliche Produktregel: Jede zukünftige Produktentscheidung wird auch danach bewertet, ob sie organische Reichweite, Verlässlichkeit, wiederkehrende Nutzung oder den strategischen Unternehmenswert von Kaufklug erhöht.

Die 408 Queries auf Position größer 10 bis einschließlich 20 wurden vollständig geclustert. Händlerbegriffe haben Vorrang vor Produktbegriffen, weil die vorhandene Seitenarchitektur Händlerkombinationen primär auf Händlerseiten bedient. `Potenzial +` ist eine einheitliche Vergleichsgröße: zusätzliche 90-Tage-Klicks bei 0,8 % Cluster-CTR gegenüber dem Ist, keine Rankingprognose.

| Priorität | Cluster / sicherste Zielseite | Queries | 90 Tage Klicks / Impr. / CTR / Pos. | 28 Tage Klicks / Impr. / CTR / Pos. | Potenzial + | Entscheidung |
| ---: | --- | ---: | --- | --- | ---: | --- |
| Sperre | BILLA `/angebote/billa/` | 77 | 6 / 2.374 / 0,25 % / 10,85 | 4 / 1.199 / 0,33 % / 10,54 | 13 | 28-Tage-Experiment schützen |
| Sperre | HOFER `/angebote/hofer/` | 63 | 4 / 1.532 / 0,26 % / 12,86 | 2 / 412 / 0,49 % / 14,30 | 8 | 28-Tage-Experiment schützen |
| 1 | Lidl `/angebote/lidl/` | 79 | 1 / 718 / 0,14 % / 11,09 | 0 / 306 / 0 % / 11,09 | 5 | Description-Test umgesetzt |
| 2 | PENNY `/angebote/penny/` | 23 | 0 / 220 / 0 % / 11,05 | 0 / 219 / 0 % / 11,04 | 2 | Description-Test umgesetzt |
| 3 | BIPA `/angebote/bipa/` | 73 | 1 / 316 / 0,32 % / 12,49 | 1 / 192 / 0,52 % / 12,57 | 2 | Hauptquery verbessert sich; beobachten |
| 4 | Supermarkt/Lebensmittel, teilweise `/angebote/supermarkt/` | 19 | 3 / 881 / 0,34 % / 16,38 | 3 / 315 / 0,95 % / 16,77 | 4 | Breite Zuordnung/Intention nicht sicher; unverändert |
| 5 | Generische Angebote, mögliche Konkurrenz `/` und `/angebote/` | 26 | 0 / 399 / 0 % / 13,06 | 0 / 96 / 0 % / 14,32 | 3 | Kein Query-zu-Page-Beleg; unverändert |
| 6 | Waschmittel `/angebote/waschmittel/` | 19 | 0 / 53 / 0 % / 16,17 | 0 / 7 / 0 % / 17,14 | 0,4 | Zu wenig absolutes Potenzial |
| 7 | Schokolade `/angebote/schokolade/` | 5 | 0 / 40 / 0 % / 13,05 | 0 / 40 / 0 % / 13,05 | 0,3 | Zu wenig absolutes Potenzial |
| 8 | dm `/angebote/dm/` | 5 | 0 / 19 / 0 % / 12,42 | 0 / 6 / 0 % / 17,16 | 0,2 | Rückläufig, zu wenig Potenzial |
| 9 | Kaffee `/angebote/kaffee/` | 4 | 0 / 13 / 0 % / 12,15 | 0 / 13 / 0 % / 12,15 | 0,1 | Zu wenig Potenzial |
| 10 | Sonstige Produkte | 7 | 0 / 9 / 0 % / 12,89 | 0 / 4 / 0 % / 15,25 | 0,1 | Kein stabiler Seitencase |
| 11 | Nudeln `/angebote/nudeln/` | 4 | 0 / 4 / 0 % / 13,00 | 0 / 4 / 0 % / 13,00 | 0,0 | Kein messbarer Hebel |
| 12 | Duschgel `/angebote/duschgel/` | 2 | 0 / 2 / 0 % / 17,00 | 0 / 2 / 0 % / 17,00 | 0,0 | Kein messbarer Hebel |
| 13 | Chips `/angebote/chips/` | 1 | 0 / 2 / 0 % / 10,50 | 0 / 2 / 0 % / 10,50 | 0,0 | Kein messbarer Hebel |
| 14 | Butter `/angebote/butter/` | 1 | 0 / 1 / 0 % / 17,00 | 0 / 0 / 0 % / – | 0,0 | Kein messbarer Hebel |

Die beiden Änderungen stützen sich nicht nur auf Clusterannahmen, sondern auf echte Query→Page-Exporte: `lidl prospekt aktuell` → `/angebote/lidl/` mit 0 Klicks/305 Impressionen/Position 10,43 und zuletzt 0/192/10,57; `penny angebote` → `/angebote/penny/` mit 0/177/10,45, identisch im 28-Tage-Fenster. Nur die Descriptions wurden auf aktuelle Angebote/Aktionen in Österreich sowie Preise, Packungsgrößen, Gültigkeit und Bedingungen präzisiert. Die irreführende Behauptung eines vollständigen Prospekts bleibt ausgeschlossen. Live-Abdeckung vor dem Eingriff: Lidl 75 deduplizierte Angebote, PENNY 289; beide initial 24/24 datiert, 24/24 mit Bild und paginiert.

BIPA wurde trotz Clusterpotenzial bewusst nicht verändert: Die exportbelegte Hauptquery `bipa angebote` verbesserte sich zuletzt auf 1 Klick/30 Impressionen/3,33 % CTR/Position 10,03, und Title/Description/H1 erfüllen die Intention bereits. Supermarkt, generische Angebote und neue Landingpages bleiben ohne zusätzlichen Page-Beleg beziehungsweise belastbare Nachfrage unverändert. Der technische Vertrag ist bis auf Non-Slash-Breadcrumb-Items konsistent; deren globale Korrektur ist wegen der BILLA-/HOFER-Sperre vertagt. Öffentliche Trust-Angaben zu Betreiber, kostenloser Nutzung, Quellen-/Prüfgrenzen und Fehlerkorrektur sind vorhanden. Eine Aussage zu Werbeplatzierungen oder Affiliate-Provisionen wurde mangels eigenständigem Geschäftsbeleg nicht ergänzt.

Erfolg nach Neucrawl und vollständigem 28-Tage-Fenster: Lidl mindestens 3 Klicks bei mindestens 100 Impressionen, CTR mindestens 1,0 % und Position höchstens 10,5; PENNY dieselben Schwellen. Primär zählen zusätzliche Klicks, sekundär CTR und Position. Google kann beide Descriptions umschreiben; unmittelbare Wirkung wird nicht behauptet.

Absicherung vor Push: 81/81 Admin-Utility-/Config-Tests, ESLint, Production-Build mit System-CA und `git diff --check` grün. Der generierte Vertrag enthält die beiden neuen Meta-/OG-Descriptions, unveränderte Titles/H1/Self-Canonicals, 27 Sitemap-URLs und unveränderte BILLA-/HOFER-Metadaten. Der repository-eigene 390-px-Live-Smoke passiert sämtliche funktionalen Stationen bis zum globalen Schlusscheck: Homepage, Suche, Händlerabdeckung, mobiles Vergleichsmodul, Browse, Top Deals und Einkaufsliste. Der Schlusscheck bleibt wegen 19 anonymen 404-Ressourcenmeldungen rot; der isolierte mobile Homepage-/Reduced-Motion-Lauf ist grün. Da der Änderungssatz keine Assets, Bild-URLs oder Requests berührt, ist dies kein Description-Regressionssignal, sondern ein unabhängiger Ressourcen-Diagnosehebel.

Produktcommit `d899f90a` wurde regulär automatisch deployed. Der erste stabile Prozess startete `2026-08-26T14:29:59.739Z`; Health 200, Mongo verbunden. Lidl und PENNY liefern die neuen Meta- und OG-Descriptions exakt, ihre Titles/H1/Self-Canonicals und internen Links bleiben unverändert. BIPA, Supermarkt sowie die gesperrten BILLA-/HOFER-Verträge sind unverändert; Sitemap 27 URLs. Live-Pagination: Lidl, PENNY und BIPA jeweils 24+24 ohne Überschneidung; Kaffee-Suche 109 Ergebnisse/60 erste Seite, Top Deals 20. Keine sofortige Google-Wirkung wird behauptet.

## Mobile 390-px-Ressourcen-404s 2026-08-27

Zwei Clean-Profile-Läufe reproduzierten dieselben 20 aktuellen URLs. Die frühere Zahl 19 war kein anderer Fehlertyp, sondern ein leicht anderer dynamischer Angebotsbestand. Gemeinsame Klassifikation aller Zeilen: HTTP 404, Ressourcentyp `Image`, MIME `application/json`, CDP-Initiator `other`, First Party, nicht Cache/Service Worker, in beiden Läufen reproduzierbar, echte Kaufklug-Regression im Bildproxy.

| Seite | exakte 404-URL |
| --- | --- |
| `/suche?q=kaffee` | `https://www.kaufklug.at/api/offers/6a8fbfce4a1da42517e5f986/image` |
| `/suche?q=kaffee` | `https://www.kaufklug.at/api/offers/6a8fbfcf4a1da42517e5fa62/image` |
| `/suche?q=kaffee` | `https://www.kaufklug.at/api/offers/6a8fbff0fb17158856f22652/image` |
| `/suche?q=kaffee` | `https://www.kaufklug.at/api/offers/6a8fbfcf4a1da42517e5fa7c/image` |
| `/suche?q=kaffee` | `https://www.kaufklug.at/api/offers/6a8fbfcd4a1da42517e5f8aa/image` |
| `/suche?q=kaffee` | `https://www.kaufklug.at/api/offers/6a8fbfeffb17158856f22576/image` |
| `/suche?q=waschmittel` | `https://www.kaufklug.at/api/offers/6a8e6e616bbb7e9608a1a19e/image` |
| `/suche?q=waschmittel` | `https://www.kaufklug.at/api/offers/6a8e6e616bbb7e9608a1a1bd/image` |
| `/suche?q=waschmittel` | `https://www.kaufklug.at/api/offers/6a8e6e616bbb7e9608a1a16a/image` |
| `/suche?q=waschmittel` | `https://www.kaufklug.at/api/offers/6a8e6e616bbb7e9608a1a15a/image` |
| `/suche?q=waschmittel` | `https://www.kaufklug.at/api/offers/6a8e6e616bbb7e9608a1a178/image` |
| `/suche?q=waschmittel` | `https://www.kaufklug.at/api/offers/6a8e6e616bbb7e9608a1a1a2/image` |
| `/suche?q=waschmittel` | `https://www.kaufklug.at/api/offers/6a8e6e616bbb7e9608a1a1b9/image` |
| `/suche?q=waschmittel` | `https://www.kaufklug.at/api/offers/6a8e6e616bbb7e9608a1a1a9/image` |
| `/suche?q=bier` | `https://www.kaufklug.at/api/offers/6a8fbfce4a1da42517e5f96a/image` |
| `/suche?q=bier` | `https://www.kaufklug.at/api/offers/6a8fbfcd4a1da42517e5f8ab/image` |
| `/suche?q=bier` | `https://www.kaufklug.at/api/offers/6a8fbff0fb17158856f22636/image` |
| `/suche?q=bier` | `https://www.kaufklug.at/api/offers/6a8fbfeffb17158856f22577/image` |
| `/top-deals` | `https://www.kaufklug.at/api/offers/6a8fbf54a4a868060179ed1e/image` |
| `/top-deals` | `https://www.kaufklug.at/api/offers/6a8fbfeffb17158856f22574/image` |

Der direkte Einzelabruf aller 20 Endpunkte bestätigte jeweils exakt `{"ok":false,"message":"Offer not found"}`. Ranking-Antworten führten dieselben Offers gleichzeitig als aktiv mit nichtleerer externer `imageUrl`; beispielsweise BILLA/BILLA Plus und Müller. Der Aufruf entsteht in `ProductImage`: bei `offerId` plus `imageUrl` wird zuerst `getOfferImageUrl(offerId)` gesetzt. Der Browser-CDP meldet Bilder deshalb technisch als `other`; der aufrufende React-Code ist dennoch eindeutig.

Ursache ist keine fehlende Händlerdatei: `isOfferFreshForActiveUse()` benötigt für undatierte offizielle Snapshots unter anderem Offer-Lineage und Händler-TTL. Die Route projizierte `crawlRunId` und `retailerKey` nicht und erzeugte deshalb vor jedem Upstream-Abruf den falschen 404. Die Korrektur ergänzt die vollständigen, bereits vom bestehenden Validitätsvertrag gelesenen Felder in der isolierten Bildroute; der Vertrag selbst bleibt unverändert. Ein Regressionstest beweist, dass ein frischer BILLA-Snapshot mit der Route-Projektion zulässig ist und beim Entfernen von `crawlRunId` oder `retailerKey` fail-closed bleibt.

Negativ-Evidence: Die Netzwerkaufzeichnung enthielt keine weiteren 404-Typen. Live-HTML verweist auf den vorhandenen lokalen CSS-/JS-Chunk und `/brand/kaufklug-logo-transparent.png`; alle antworten 200. Das Logo dient auch als Favicon und OG-Bild. Es gibt keinen Manifest-Link, keine `@font-face`-Regel und keine `sourceMappingURL`-Referenz im Production-JS/CSS; Analytics-/Extension-Requests und fehlerhafte relative Ressourcenpfade waren nicht vorhanden. Es wurden keine Meldungen unterdrückt und keine Ersatzbilder oder globalen Fallbacks ergänzt.

Lokal: 330 relevante Backend-Tests und 81 Admin-/SEO-/UX-Tests grün, ESLint grün, Production-Build grün, Syntax und `git diff --check` grün. Der vollständige Backend-Lauf endet mit 1.302 bestanden, 18 fehlgeschlagen und 1 übersprungen; sämtliche 18 Fehler sind scope-fremd (3 Dashboard, 12 PENNY, 2 BILLA, 1 SPAR) und keine der betroffenen Dateien wird für diesen Fix committed.

Produktcommit `bf844e03250968bb1570da65bd40fb90c35d2eae` ist auf `origin/main` und über den regulären DigitalOcean-Auto-Deploy live; der neue Backend-Prozess startete `2026-08-27T07:02:02.262Z`, Health war in drei sequenziellen Reads HTTP 200 mit verbundener MongoDB. Jede der oben gelisteten 20 URLs antwortet nun 200 mit echtem `image/jpeg`, `image/png` oder `image/webp`. Der vollständige Clean-Profile-Smoke durchlief Homepage, Reduced Motion, Kaffee, Waschmittel samt Händlerfilter, Biervergleich, Browse, Top Deals und Einkaufsliste grün mit `resource404s: []`; der separate Homepage-/Reduced-Motion-Smoke ebenfalls.

Homepage, Kaffee-/Bier-Suche, Top Deals und Sitemap antworten 200; Kaffee liefert 83 Resultate/60 erste Seite, Bier 31 Resultate/27 sichtbare, Top Deals 20 strict Deals. BILLA-, HOFER-, Lidl- und PENNY-Title/Description/H1/`index,follow`/Self-Canonical sind exakt unverändert. Der neue fail-closed Static-Build filtert die Sitemap aktuell auf 25 URLs: `/preischeck/bier-literpreis-vergleich/` bleibt ohne aktuelle Candidate-Evidence `noindex,follow`, `/angebote/butter/` bei nur 4 Public-Angeboten unter der bestehenden Mindestschwelle von 10 ebenfalls. Das ist der vorhandene SEO-Autopilot-Vertrag, keine Bildfix-Regression; ein Rollback würde dieselbe aktuelle Datenentscheidung erneut erzeugen.

## Mobile Angebotsbild-Initiallast 2026-08-28

Der read-only 390-px-Audit belegte einen reinen Auslieferungshebel ohne SEO-Vertragsänderung: Chrome lud mit dem bisherigen nativen Lazy Loading mehrere 74×74-px-Card-Bilder bereits 1.000 bis 2.100 px unterhalb des Viewports. Waschmittel startete mit 2,04 MB, PENNY mit 1,33 MB, BIPA mit 1,73 MB und Müller mit 7,45 MB Bildtransfer; der LCP war in jeder Stichprobe ein Textknoten. Die Bild-Originale und der Proxyvertrag bleiben unverändert.

`ProductImage` begrenzt den Requeststart nun zusätzlich per `IntersectionObserver` auf 200 px vor dem Viewport. Der bestehende Bildrahmen reserviert weiterhin dieselbe Fläche; Bildquelle, Fallback, Lesbarkeit, volle Originalqualität, Angebotsbestand, IDs, Sortierung, Pagination, Public Validity sowie alle Meta-/Canonical-/Structured-Data-Verträge bleiben unberührt. Produktcommit `9c95512a` ist mit Static-Hash `index-CaUJnhyy.js` und finalem Prozessstart `2026-08-28T07:07:41.852Z` regulär live. Verbindlich sanken die initialen Transfers auf 0,664 MB für Waschmittel (-67,4 %), 0,558 MB für PENNY (-58,2 %) und 2,670 MB für Müller (-64,2 %); Kaffee, BILLA und Top Deals starten nun ohne Angebotsbildtransfer. Scrollchecks aktivierten die zurückgestellten Bilder reproduzierbar in unveränderter Originalqualität.

84/84 Frontend-/SEO-/UX-Tests, ESLint, Production-Build und `git diff --check` sind grün. Vollständiger 390-px-/Reduced-Motion-Live-Smoke: keine Ressourcen-404 oder 5xx, LCP weiterhin immer Text. Die bekannten HOFER-Upstream-403 bleiben transparent und unverändert außerhalb dieses Hebels. BILLA-, HOFER-, Lidl- und PENNY-Title, Description, H1, Canonical, Robots und strukturierte Daten wurden weder im Diff noch live verändert; eine unmittelbare Rankingwirkung wird nicht behauptet.
