# KAUFKLUG-STRATEGY-001 / UX-005 ? abschlie?ender Release-Preflight

Stand: 01.11.2026. Ausschlie?lich isolierter Worktree `C:\coding\einfachsparen-top-deals-002`. **ROT / NO-GO. Kein Release erfolgt.**

## A. Strategiekonsolidierung

Die zehn Betreiberentscheidungen und ihre Leitplanken sind im [aktuellen Kontext](KAUFKLUG_CONTEXT.md) konsolidiert. SEO/qualifizierte Sichtbarkeit P0, ?sterreich, unabh?ngige Marke, organisches Wachstum, 250-EUR-Etappenziel, Design B und Freigabegrenzen bleiben verbindlich. Historische Chronik unver?ndert erhalten; ?ltere Zielbilder werden durch die aktuelle Entscheidung eingeordnet, nicht gel?scht.

Produktiv: a60b385c/TOP-DEALS-Fixes und bisherige Oberfl?che. Lokal: UX-002-Shell und UX-004-Catchall-Korrektur. Vision: qualit?tsbasierte Heatmap, automatische Angebotszuordnung, Optimierung des gesamten Einkaufs und Gesch?ftsziele. Keine dieser Visionen hier implementiert. Die alten Feature-Roadmap-Nummern aus UX-001 belegen keine Umsetzung durch sp?tere gleichnamige Preflight-Auftr?ge.

## B. Test- und SEO-Nachweise

### Wiederholte Pr?fungen

| Pr?fung | Ergebnis / Grenze |
|---|---|
| `node --test --test-reporter=spec admin/src/utils/*.test.mjs` | **112/112 bestanden**, einschlie?lich bisheriger 107 und UX-004-Regressionen. [Log](../evidence/ux-005-2026-11-01/tests.log) |
| `npm run lint` im admin-Verzeichnis | bestanden. [Log](../evidence/ux-005-2026-11-01/lint.log) |
| `npm run build` im admin-Verzeichnis | vollst?ndig bestanden, einschlie?lich SEO-Generator, ohne Fixture-API-Override. Kein Upload. [Log](../evidence/ux-005-2026-11-01/build.log) |
| Statische SEO-Generation | 38 Policy-Seiten, Robots und Canonicals passend; Sitemap exakt 24 indexierbare Policy-Ziele. Catchall initial noindex,nofollow, ohne Canonical, mit gemeinsamer Policy. [Artefaktpr?fung](../evidence/ux-005-2026-11-01/seo-artifacts.json) |
| `git diff --check` | bestanden; Git meldet bestehende LF/CRLF-Konvertierungshinweise, keinen Inhaltsfehler. |
| TOP-DEALS-/Backend-Tests | keine neue Backend?nderung; historische 433 Backend-/39 SEO-Tests und 14 Parser-Altfehler aus TOP-DEALS-006 sind **keine frisch wiederholte Backendtestsuite** dieses Auftrags. |

UX-003s konkrete ungefragte Umschreibung von `/angebote/ux-audit-unbekannt/` ist im lokalen Test gr?n: URL erhalten, noindex, kein Canonical. Statische Artefakte allein sichern jedoch nicht den nachfolgenden Clientzustand ab.

### Neu entdeckter Abnahmeblocker ? bestehende Routing-L?cke

| Unbekannter Pfad | Lokale echte Metadatenfunktionen nach Routenaufl?sung |
|---|---|
| `/angebote/ux-audit-unbekannt/` | `search`, noindex, kein Canonical ? korrekt |
| `/angebote/ux-audit-unbekannt/top-deals/` | `top-deals`, **index,follow**, **Canonical /top-deals/** ? falsch |
| `/angebote/ux-audit-unbekannt/suche/` | `product-search`, noindex, **Canonical /suche/** ? falsch |

[Lokale reproduzierbare Ergebnisse](../evidence/ux-005-2026-11-01/catchall-probe.json). F?r den zweiten Fall zus?tzlich **reale produktive Browserbeobachtung**: urspr?ngliche URL bleibt erhalten; H1 ?Seite nicht gefunden? und ?Top Deals heute?, Robots `index,follow`, Canonical `https://www.kaufklug.at/top-deals/`. [DOM-Befund](../evidence/ux-005-2026-11-01/production-catchall.json), [Screenshot](../evidence/ux-005-2026-11-01/production-catchall.png). Keine Nutzerinhalte ge?ndert.

Ursache in `admin/src/utils/seo.js`, Funktionen `getInitialPageFromPathname` und `updateSeoMetadata`: Der Resolver verwendet `pathname.includes('top-deals')` bzw. `includes('suche')`. Die Unknown-Angebotspr?fung erfasst nur genau ein Segment nach `/angebote/`; der zus?tzliche Browse-Fallback-Schutz greift nur beim Seitentyp `search`. Verschachtelte unbekannte Pfade mit reservierten W?rtern umgehen damit den Schutz. Resolver ab seiner Funktionsdefinition byteinhaltlich identisch mit a60b385c; der produktive Browser best?tigt das bestehende Verhalten. **Keine neue UX-002-Verursachung belegt.**

Die f?nf neuen UX-004-Tests decken diese reservierten Segmente nicht ab. 112 gr?ne Tests widerlegen den Befund nicht. Das allgemeine Abnahmekriterium ?unbekannte URLs behalten noindex und keinen Canonical? ist nicht erf?llt. Technischen Preflight an dieser Stelle gestoppt; keine eigenm?chtige Reparatur und kein Freigabeversuch.

### Umfang und nicht abgeschlossene Abnahme

Der Kandidat umfasst Shell/Navigation, URL-Zustand, Such-/Browse-Kontext, Fokus/Kontrast, Listentitel und Catchall-Policy. Runtime-/Testdateien sind mit SHA-256 im [Kandidatenmanifest](../evidence/ux-005-2026-11-01/candidate-manifest.json) erfasst. Der Manifestinhalt ist ein Bestandsnachweis, **keine Freigabe aller Dateien**.

Preis-, Ranking-, Backend-, API-, H?ndler- und Angebotskarten?nderungen sind nicht Teil des sichtbaren Diffs. Keine zus?tzliche Begrenzung normaler Suche; bestehende Search-/Top-Deals-Guards sind gr?n. TOP-DEALS-Fixes sind Teil der gemeinsamen Basis a60b385c und werden nicht zur?ckgenommen. Vollst?ndige abschlie?ende Einzeldatei-/Geheimnisfreigabe und ein neuer Staged-Diff wurden nach dem Blocker nicht erteilt; es existiert kein Staging.

Die fr?heren lokalen Browsernachweise f?r Suche/Filter/Sortierung, Liste, Kontextwiederkehr, Back/Forward/Reload und 375/768/1440 px sind in [UX-002](KAUFKLUG_UX_002_2026-11-01.md) und [UX-004](KAUFKLUG_UX_004_2026-11-01.md) dokumentiert. Die entsprechenden automatischen Tests wurden jetzt wiederholt; eine vollst?ndige neue Browsermatrix wurde nach dem Stop **nicht** ausgef?hrt. Sie ist vor einem sp?teren GO erneut erforderlich. Gleiches gilt f?r interne SEO-Links nach Clientwechsel und eine vollst?ndige Angebotsdaten-/Live-Abnahme. Keine WCAG-2.2-AA-Vollkonformit?t, Screenreaderabnahme oder Feld-CWV-Messung behauptet.

## C. Release-Freigabeampel

**ROT / NO-GO f?r den UX-Release.** Der konkrete fr?here UX-003-Blocker ist lokal geschlossen, die ?bergeordnete Catchall-Anforderung jedoch nicht vollst?ndig erf?llt. Eine bestehende Produktionsl?cke ist kein Grund, sie als bestandene neue Release-Abnahme auszugeben. Separater eng begrenzter Korrekturauftrag und anschlie?ender neuer Preflight erforderlich.

Read-only Produktions-/Git-Abgleich vom 01.11.2026, Dashboard-Snapshot `2026-11-01T13:58:40.533Z`:

- HEAD und per `git ls-remote` tats?chlich abgefragtes origin/main: `a60b385ce64b14ca3e5bffdb96e874c23b540af0`.
- DigitalOcean-App `5c7b87c9-b22c-4d08-9a70-9e81c1b2590f`, aktives Deployment **`430fd209-d7a6-4a85-a84e-c7925edaadbe` ACTIVE**; Backend und Static Site tats?chlich auf a60b385c, kein laufendes Deployment.
- Health ok, Mongo verbunden; Prozessstart `2026-11-01T12:25:19.575Z`. Kein aktiver Crawl, Lock frei; Public-Publish final, openCount=0.
- Letzter regul?rer Run `6ae6cffcfb8541a106574e3c`, success/publish-status-finished, Ende `2026-11-01T05:40:07.284Z`. Keine neue Erfassung ausgel?st.

Das ist ein datierter Zustand, keine Reservierung eines k?nftigen sicheren Releasefensters. Nach technischem Stop keine mutationsf?hige Rollbackvalidierung und kein finaler unmittelbarer Push-Check ausgef?hrt.

## D. Restrisiken

1. **Blocker:** unbekannte verschachtelte Pfade k?nnen g?ltige Seitenmetadaten einschlie?lich index,follow erben; bestehender Clientresolver ben?tigt separat freigegebene Korrektur und zus?tzliche Tests. Nicht in diesem Auftrag repariert.
2. Main-Push l?st bestehendes App-Auto-Deployment aus; kein garantiert frontendexklusiver Rollout. Backend-Neustart trotz Frontend?nderung ber?cksichtigen. Aktiver Crawl/offener Publish oder abweichender Remote-/Produktionsstand sperrt Release.
3. Frontend-Build liest aktuelle Public-Daten und erzeugt neue SEO-Entscheidungen. 38/24 beschreibt diesen Build, keine Zusicherung f?r sp?tere Generationen. Qualit?tsgrenzen bleiben unver?ndert; erwartbare Daten?nderungen von Regressionen trennen.
4. Vollst?ndige responsive Browsermatrix, Tastatur-/Fokusabnahme und finale Release-Dateipr?fung sind nach Korrektur erneut offen. Bereits im Audit benannte weitergehende Accessibility-/Performance-Risiken bleiben au?erhalb dieses Auftrags.
5. Lokaler Kontext enth?lt ?ltere uncommittete DOC-001-/TOP-DEALS-006-Anteile. Kein pauschales ?bernehmen mit `git add .`; vollst?ndigen Dokumentdiff ausdr?cklich pr?fen. Bestandsdatenpr?fung nach regul?rer BIPA-/dm-Erfassung bleibt separat offen; keine Source-Recovery hier.

## E. Exakter Rollout-/Rollbackplan ? gesperrt bis neuem GO

### Rollout

1. Erst separaten Korrekturauftrag abschlie?en; Tests m?ssen auch unbekannte Pfade mit reservierten Segmenten, initiales Catchall und Client-Mount abdecken. F?r alle unbekannten F?lle: keine ungefragte URL-?nderung, noindex, kein Canonical. Bekannte Routen/SEO-Policy bleiben korrekt. Danach vollst?ndigen Preflight einschlie?lich Browsermatrix wiederholen und ausdr?ckliche Produktionsfreigabe einholen.
2. Unmittelbar vor Release Remote-main, beide echten Produktions-Source-Commits, App-Spec, aktive Deployment-ID, Health/Mongo, Crawl-Lock/activeRun, letzten finalen Public-Publish und laufende Deployments erneut lesen. Jede ungekl?rte Abweichung oder aktiver Crawl ? STOP. Ausgangsdeployment und App-Spec ohne Geheimnisse sichern; Rollbackziel muss noch zul?ssig sein.
3. Einen **neuen isolierten Release-Worktree/Branch auf dem dann verifizierten origin/main** erstellen; Original und vorbereiteten Dirty-Worktree nicht umschalten/?berschreiben. Bei unver?ndertem a60-Stand etwa `git worktree add -b release/ux-shell <neuer-freier-releasepfad> <voller-verifizierter-main-sha>`. Bei fortgeschrittenem main kein blindes Patchen/Mergen, sondern Integrationspr?fung und neues GO.
4. Nur einzeln gepr?fte Kandidatendateien ?bertragen. Explizite Dateiliste unten plus zugeh?rige genehmigte Dokumenthunks; alte Kontextanteile separat pr?fen. Keine fremden Dateien, .env, dist, node_modules oder ungepr?ften Evidence-B?ume. Manifest nach sp?terem Fix neu bilden. `git add -- <einzeln-aufgez?hlte-freigegebene-Dateien>`; niemals `git add .`. Vollst?ndigen Staged-Diff, Scope, Geheimnisse und TOP-DEALS-Erhalt pr?fen.
5. Im Release-Worktree relevante Tests, Lint, vollst?ndigen Build und SEO-/Browserabnahme wiederholen. Genau einen Release-Commit erzeugen. Direkt vor Push main erneut lesen und Fast-forward-M?glichkeit verifizieren. Ausschlie?lich `git push origin HEAD:main`; kein Force-Push und kein zus?tzlicher manueller DO-Deploy. Dieser Plan ist derzeit nicht ausgef?hrt/freigegeben.
6. Auto-Deploy ?berwachen: beide Komponenten ACTIVE und exakt Release-Commit, Health/Mongo/Logs ohne neue Fehler. `runOnStart=false` und 900-Sekunden-Startup-Grace erhalten und nach Ablauf erneut pr?fen. Keine Crawls ausl?sen. Auch w?hrend/nach Rollout Crawl-/Publishzustand pr?fen.
7. Frische Browserabnahme Homepage, Suche, St?bern, Top Deals und Liste: Filter/Sortierung, URLs, Back/Forward/Reload, Kontext, Tastatur/Fokus und 375/768/1440 px. Normale Suche >20 und weitere Pagination; Top Deals h?chstens20. Kartenpreise/Grundpreise/Filter gegen API pr?fen, keine Produktionsliste ver?ndern. Alle bekannten und unbekannten SEO-Einstiege initial und nach React-Mount pr?fen; aktuelle Policy, Robots, Canonicals, Sitemap und interne Links gemeinsam vergleichen. Datenbedingte Indexierungs?nderungen protokollieren. Nachweise lokal nachtragen, kein zweiter ungepr?fter Dokumentationsdeploy.

### Rollback bei eindeutig neuer produktiver Regression

- Referenz jetzt: App `5c7b87c9-b22c-4d08-9a70-9e81c1b2590f`, Zieldeployment `430fd209-d7a6-4a85-a84e-c7925edaadbe`/a60b385c. Das Ziel vor dem tats?chlichen Rollout erneut best?tigen; zul?ssige letzte zehn erfolgreiche Deployments, gleiche Region und Datenbankkonfiguration pr?fen. Bekannte Altfehler allein l?sen keinen Rollback aus.
- Mit vorhandener autorisierter DO-Verbindung zun?chst `POST /v2/apps/{app_id}/rollback/validate`, Body `{"deployment_id":"430fd209-d7a6-4a85-a84e-c7925edaadbe","skip_pin":false}`. Warnungen/Validierungsfehler bewerten; kein blindes Fortsetzen. **Hier nicht aufgerufen.**
- Bei zul?ssigem Ziel und tats?chlicher neuer Regression `POST /v2/apps/{app_id}/rollback` mit demselben Body. Das erzeugt ein Rollbackdeployment und pinnt die App; neue Auto-/manuelle Deployments sind bis Commit/Revert des Rollbacks gesperrt. Alternativ DO Activity ? Zieldeployment ? Rollback und Einstellungen/Pin kontrollieren. Keine Datenbankr?cksetzung, kein Git-Force-Push.
- Rollbackdeployment ACTIVE, beide Komponenten auf a60b385c, Health/Mongo, Logs, Crawl-/Publishzustand und zentrale UX-/SEO-Baseline pr?fen. Pin zun?chst erhalten; Git-main enth?lt weiterhin den fehlerhaften Release. Git-Korrektur und Aufhebung/Commit des Pins nur kontrolliert nach separatem Entscheid; **Rollback-Revert w?rde die vorherige neuere App-Spec erneut deployen**, deshalb nicht reflexartig ausf?hren.

Plattformgrundlage, am 01.11.2026 gepr?ft: [DO Deployment-/Rollbackvertrag](https://docs.digitalocean.com/products/app-platform/how-to/manage-deployments/) und [API: Validate/Rollback/Pin](https://docs.digitalocean.com/products/app-platform/reference/api/). Die Dokumentation belegt Plattformm?glichkeiten; eine heutige erfolgreiche Rollbackvalidierung wird nicht behauptet.

## F. Ge?nderte Dateien und Git-Status

In diesem Auftrag ge?ndert: `docs/KAUFKLUG_CONTEXT.md`; neu: dieser Bericht und `evidence/ux-005-2026-11-01/` mit lokalen Logs/Pr?fbefunden. Keine Code?nderung. Generierte ignorierte Buildausgabe wurde lokal erneuert, nicht versioniert oder ausgeliefert.

Vorhandener uncommitteter admin-Kandidat (nach sp?terer Korrektur neu zu pr?fen, aktuell **nicht freigegeben**):

- `admin/scripts/generateSeoHtml.mjs`
- `admin/scripts/uxNavigationFixtures.mjs`
- `admin/src/App.jsx`
- `admin/src/components/layout/AppShell.jsx`
- `admin/src/components/layout/appShell.css`
- `admin/src/components/search/KeywordSearchPage.jsx`
- `admin/src/components/search/SearchPage.jsx`
- `admin/src/components/shopping/ShoppingListPage.jsx`
- `admin/src/index.css`
- `admin/src/utils/appShell.test.mjs`
- `admin/src/utils/catchallRouting.test.mjs`
- `admin/src/utils/navigationState.js`
- `admin/src/utils/navigationState.test.mjs`
- `admin/src/utils/publicUx.test.mjs`
- `admin/src/utils/seo.js`
- `admin/src/utils/topDealsUx.test.mjs`
- `admin/src/utils/useAppNavigation.js`

Zugeh?rige lokale Dokumente: Kontext, UX-Audit, UX-002, UX-003-Preflight, UX-004 und dieser UX-005-Bericht. Fr?here Evidence-Verzeichnisse bleiben unangetastet. Testfixture-Script ist nur lokales Hilfsmittel und muss als solches explizit behandelt werden, kein Produktions-API-Vertrag.

Isoliert weiterhin Branch `release/top-deals-002`, HEAD a60b385c, Index leer. Vorbestehende zehn tracked ?nderungen und untracked UX-Dateien bleiben erhalten; zus?tzlich nur oben genannte Dokumentation/Evidence. Original-Worktree weiterhin lokales main/HEAD `14bce273` mit fremden Dirty-/Untracked-Dateien; weder synchronisiert noch ge?ndert. Kontextfingerabdruck im Original unver?ndert: `8D1030340DBA0399105A0A9C8087D46A16FAEE600605D26F4A93C0FACA6C66E4`.

**Endempfehlung: NO-GO.** Kein Commit, Push, Deployment, Crawl oder Datenpatch. Zuerst gesonderte Freigabe f?r den engen verbleibenden Catchall-Fix; danach erneuter Preflight. Keine automatische Produktionsfreigabe aus fr?heren Auftr?gen ableiten.
