# DESIGN-003 – gezielte Blockerkorrektur und lokale Release-Abnahme

Stand01.11.2026. **GRÜN im dokumentierten lokalen Prüfumfang; GO als Empfehlung für einen gesondert freizugebenden kontrollierten Rollout. Kein Commit/Push/Deployment und keine Produktionsabnahme des Designs.**

## A. Behobene Fehler

- `admin/src/design001.css`: CTA „Top Deals heute“ definiert Vorder- **und** Hintergrund gemeinsam, statt neue dunkle Textfarbe mit altem dunklem Hintergrund zu kombinieren. Normal weißwarm auf Petrol, Hover/Fokus weißwarm auf dunklerem Petrol. Tatsächlich im Chromium gemessen: **8,6856:1 normal,11,7942:1 hover**, bei allen sechs Breiten; zuvor1,2839:1. Normaler Text damit über4,5:1. [Farb-/Reihenfolgemessung](../evidence/design-003-2026-11-01/accessibility.json).
- Angrenzende Suchaktion, aktiver Navigationseintrag und CTA verwenden dieselben gemessenen kontrastreichen Vorder-/Hintergrundpaare ohne Gradient; neutraler Kacheltext rgb(82,101,105) auf rgb(240,241,235). Kein gleichartiger Dunkel-auf-Dunkel-Befund an diesen angrenzenden Rollen. Keine globale WCAG-Zertifizierung daraus ableiten. [Angrenzende Farben](../evidence/design-003-2026-11-01/adjacent-colors.json).
- Alle drei primären Anker erhalten dieselbe CSS-order0; alte Sonderorder für Top Deals kann die DOM-Reihenfolge nicht mehr verändern. Sichtbare und echte Tabfolge jetzt **Suche → Top Deals → Liste** bei320/375/390/768/1024/1440.
- Statische Homepage-Navigation in `generateSeoHtml.mjs` erhält dieselbe Reihenfolge. Neuer Regressionstest `designNavigation.test.mjs` prüft Reihenfolge der initialen und React-Navigation gemeinsam. Keine Änderung an Indexierungsentscheidungen oder Routenerkennung.

Keine weiteren Designfeatures. Backend-/Preis-/Ranking-/Crawl-/Datenmodell unverändert. SEO-004/005 und Credential-Rotation nicht übernommen. Vorhandene DESIGN-001/002-Arbeit geschützt.

## B. Tests und vollständige Browsermatrix

**117/117 Tests bestanden**, inklusive früher offenem Button-Test, kompletter Utility-/Routing-/SEO-Suite und neuem Reihenfolgetest. Lint und vollständiger Build nach abschließender statischer Navkorrektur bestanden. [Tests](../evidence/design-003-2026-11-01/frontend-tests.log), [Lint](../evidence/design-003-2026-11-01/lint.log), [Build](../evidence/design-003-2026-11-01/build.log).

Unabhängiger Headless-Chromium1217 mit vorhandenem lokalem playwright-core. Eigene kontrollierte Ports4228/4229 statt des früheren Dev-/HMR-Zustands. Keine Browsersteuerung mit unsicherer URL verwendet. Jede Browseranfrage außerhalb lokaler Hosts gesperrt; Fixture lehnt Writes ab. Keine produktiven Listen-/Share-/Feedbackaktionen. Screenshot-/Interaktionsstand zunächst aus lokalem Fixture-Build; **anschließend Standardbuild ohne Fixture-URL** wiederhergestellt und verifiziert. Finaler Screenshotlauf des Standardbuilds leitete nur GET-API-Anfragen explizit an lokale Fixture um, alle Schreibmethoden wurden blockiert.

| Breite | Start | Suche | Top Deals | Liste | Stöbern-Deep-Link | BILLA-Landing | Unknown |
|---|---|---|---|---|---|---|---|
|320|✓|✓|✓|✓|✓|✓|✓|
|375|✓|✓|✓|✓|✓|✓|✓|
|390|✓|✓|✓|✓|✓|✓|✓|
|768|✓|✓|✓|✓|✓|✓|✓|
|1024|✓|✓|✓|✓|✓|✓|✓|
|1440|✓|✓|✓|✓|✓|✓|✓|

**42/42 aufgezeichnet**, kein horizontaler Dokumentoverflow, jeweils ein main/eine H1/drei primäre Navigationslinks; keine erfassten JavaScript-Seitenfehler. [Matrix](../evidence/design-003-2026-11-01/browser-results.json), reproduzierbares Werkzeug `admin/scripts/design003Audit.cjs`. Die Ergebnisdatei enthält auch einen ersten fehlgeschlagenen Listentest per Rollenlocator; dessen Ergebnis ist **nicht** als bestandener Interaktionstest gezählt. Der separate nachfolgende Flowtest schließt ihn mit tatsächlichem Klick und Zustandserwartung ab. Keine Testergebnisse rückwirkend gelöscht.

**Acht funktionale Flows bestanden:**

1. Erster Tastaturfokus auf sichtbarem Skip-Link; Enter fokussiert main.
2. Neutraler Drogerie-Kachellink öffnet alle verfügbaren Fixturemärkte dm/bipa und richtige Hauptkategorie im bestehenden Browse-URL-Vertrag.
3. Normale Produktsuche tatsächlich **60 →120 →135** Karten; kein Top20-Cap.
4. Angebot per Listenaktion hinzufügen; nach Navigation und Reload befindet sich derselbe Fixtureartikel in lokaler Liste.
5. Back/Forward erhält Such-URL und Listenroute.
6. Globale Händlersortierung setzt sort=retailer, erhält60er-Anfang und Nachladen auf120; bestehender vollständiger Sammelvertrag unverändert.
7. Marktfilter-Deep-Link markets=dm zeigt60 →68 Treffer ohne BIPA; Reload erhält Filter und60er-Anfang.
8. Top Deals bleibt bei20 Karten.

[Flowresultate samt Karten-Accessibility-Snapshot](../evidence/design-003-2026-11-01/flows.json), Werkzeug `admin/scripts/design003Interactions.cjs`. Die alten Rollenlocator-Timeouts sind durch diese ausgeführten CSS-Locator-Klicks und Zustandsprüfungen eingegrenzt; keine Pagination-/Listen-Produktlogik geändert. Accessibility-Snapshot enthält Artikel, Produkt-H3, Preis, Grundpreis/Gültigkeitshinweis und benannte Listen-/Feedbackbuttons. Kein physischer Screenreader verwendet.

Tatsächliche Tastaturfolge und sichtbarer solid-Fokus aller drei Hauptlinks in allen Breiten bestätigt. Erste Messung per rein programmatischem focus ohne vorausgehende Tastatur ergab für den ersten Link erwartungsgemäß keinen focus-visible-Rahmen; maßgeblich ist die danach separat geprüfte echte Tabfolge. [Fokus-/Layoutdaten](../evidence/design-003-2026-11-01/focus-layout.json).

Startseiten-Layoutshift-Summe ohne recentInput nach Mount/Fixtureladen ca.0–0,01291, sechs Einzelmessungen mit Reduced Motion und blockierten externen Fonts. Das ist **kein Feld-CWV-Wert, kein Performancebudget-Nachweis und keine Langzeitmessung**. Keine großen Verschiebungen in dieser lokalen Startsequenz festgestellt.

## C. SEO-Abnahme

Finale Standardbuild-Artefakte lesend gegen Produktion verglichen: **38 vollständige Policy-Einträge identisch**,24 Sitemap-URLs als Menge identisch, Robots zeilenendennormalisiert identisch. Catchall initial ohne Canonical; bestehende SEO-Tests prüfen noindex und bekannte Routen. Keine lokale Fixture-API im finalen JS. [SEO-Ergebnis](../evidence/design-003-2026-11-01/seo.json).

Alle sechs Unknown-Browserfälle behalten `/angebote/unknown/top-deals/`, noindex,follow, keinen Canonical; initialer statischer Catchall weiterhin noindex,nofollow. Bekannte BILLA-/Top-Deals-/Utility-Canonicals korrekt in Matrix. Aktuelle qualifizierte Landings und interne Linkverträge durch unveränderte Policy plus vollständige SEO-Test-Suite geschützt. Nicht jede Landing in jedem Viewport erneut visuell geprüft; keine neue Google-Indexierungs-/Rankingbehauptung.

Heatmap bleibt ausschließlich neutrale Kategorienübersicht bei fehlendem gemeinsamen Attraktivitätsnachweis: kein Rabattfarbscore, keine erfundenen Zähler, fehlende Kategorie unverlinkt, passender Link führt zur vollständigen Filteransicht. Fünf vollständig qualitätsbewertete Kategorien sind damit weiterhin **kein** belegtes Produktfeature. Keine Absenkung von Trust-/SEO-Gates.

## D. Screenshots

- [Mobile390 – finaler Standardbuild, ganze Startseite](../evidence/design-003-2026-11-01/home-390-final.png)
- [Desktop1440 – finaler Standardbuild](../evidence/design-003-2026-11-01/home-1440-final.png)
- Alle42 Matrixansichten: `evidence/design-003-2026-11-01/*-viewport.png`.
- Zusätzliche kontextfreie Hauptseitenbilder aller sechs Breiten: `home-*-accepted.png`, mit sichtbarem Tastaturfokus und geschlossenem Cookiehinweis.

Sämtliche Angebotsinhalte darin synthetisch, keine reale Preisdaten-Abnahme. Fallbackfonts unter blockierten externen Requests zeigen bewusst einen Offlinezustand. Der Betreiber kann Gestaltung und Fokus anhand der Bilder prüfen; keine Bildgenerierung oder falschen Produktbilder hinzugefügt.

## E. Restrisiken und späteres Releasegate

- Chrome-Desktop-Engine mit Viewportemulation, keine iOS-/Safari-/Android-/physische Touch- oder vollständige Screenreader/WCAG-Zertifizierung; kein systematischer400%-Zoom-Test. Diese Grenzen ersetzen die bestandene lokale Matrix nicht und werden nicht als bestanden ausgegeben.
- Read-only-Datenqualität der Produktion wurde hier nicht voll erneut auditiert. Neutralität der Heatmap schützt vor unbelegten Attraktivitätsbehauptungen; bekannte Daten-/Security-/SEO-Tagesrefresh-Aufgaben bleiben separat.
- Ein späterer Frontend-Build kann datenabhängige SEO-Entscheidungen ändern. Vor Release tatsächliche Public-Qualitätsdaten und Generation gemeinsam abnehmen;38/24 ist heutiger Stand, kein manueller Override.
- Vor Produktionsfreigabe neuen sauberen Release-Stand auf frisch geprüftem Remote-main, vollständigen Kandidatendiff/Secrets/Dateiscope, beide DO-Komponenten, keine laufenden Deploys/Crawls und finalen Publish sowie zulässiges letztes erfolgreiches Rollbackdeployment bestätigen. Keine Übernahme von Testdist, node_modules, alten ungeprüften Evidencebäumen, Redirects oder Securityänderungen. Appweiter Auto-Deploy kann Backendneustart verursachen; kein Frontend-only-Versprechen.

## F. Git und Freigabe

Branch design/001-mobile-first, HEAD und zuletzt erneut abgefragtes origin/main **ef85d6da**. Produktion bleibt bis zu separat genehmigtem Release auf dem bestehenden ACTIVE-Deployment96f7f522-1724-41b5-82e5-be4935b331d5. Kein Commit, Push, Deployment, Crawl oder DB-Write.

In DESIGN-003 geändert: vorhandene neue `design001.css` (Kontrast/Order), `generateSeoHtml.mjs` (nur statische Navigationsfolge), Kontext. Ergänzt: `designNavigation.test.mjs`, zwei lokale Browserwerkzeuge, neue Evidence und dieser Bericht. Die vorhandenen DESIGN-001/002-Dateien bleiben uncommitted; Index leer. Originaler Dirty-Worktree unverändert. Dokumentation ist lokal und keine Produktivabnahme.

**GO-Empfehlung für kontrollierten Rollout nach ausdrücklicher neuer Produktionsfreigabe und frischen operativen Gates.** Die beiden konkreten DESIGN-002-Blocker sind behoben; vollständige lokale Matrix und benannte funktionale Flows bestanden. Hier stoppen; keine automatische Veröffentlichung.
