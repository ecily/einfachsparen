# PRODUCT-002 – kontrollierte Releaseprüfung

02.11.2026. Betreiberfreigabe bestätigt. Isolierter Worktree `C:\coding\einfachsparen-product-002`, Basis Remote-main `f9e383f02f7baae1bde975e118c0e838a82c6479`. PRODUCT-001 bleibt im eigenen Worktree bytegleich erhalten. Keine neue Produktfunktion oder UX/UI-Neugestaltung.

## Backend-Gate: GREEN

Saubere Baseline erneut ausgeführt: 1339 Tests, 1318 bestanden, dieselben 20 Fehler, ein bestehender optionaler Skip. Ursachen einzeln in `evidence/product-002/backend-causes.json`:

| Gruppe | Anzahl | Ursache / gezielte Korrektur | Relevanz |
|---|---:|---|---|
| PENNY HTML/API | 12 | Juni-Fixtures ohne feste Beobachtungszeit wurden im November korrekt als abgelaufen verworfen. Je betroffenen Test Date auf 13.06. fixiert; sämtliche fachlichen Assertions erhalten | Fristen, Bedingungen, Kategorien und Pagination sind releaserelevant; kein Laufzeitdefekt |
| BILLA | 2 | Hirter erwartet Samstags-Preisfenster, Egger Juni-Aktion. Feste Beobachtung 11.07. Samstag bzw. 13.06. statt realer Montag im November | Preis-/Grundpreis-/Bedingungskorrektheit releaserelevant; kein Laufzeitdefekt |
| PENNY PDF | 1 | Parser-Frist gültig, aber bestehende Public-Policy sperrt PENNY-PDF generell. Expliziten Ausschluss einschließlich reasonCode prüfen | Schutzregel bleibt geschlossen |
| Policy-Persistenz | 1 | Generischer optionaler Roundtrip verwendete eine inzwischen ausgeschlossene reale PDF-Quelle. Synthetischen optionalen Vertrag explizit setzen; zusätzlicher Roundtrip testet echte PDF-Exclusion | Keine Änderung der produktiven Health-/Quellenregeln |
| SPAR historische PDFs | 4 | Tests forderten Aktivierung historischer PDFs entgegen bestehender Produktpolicy. Stattdessen alle 15 historischen Definitionen samt deaktiviertem Zustand, Fristen, Format-/Größen-/Zeitbudgets und Health-Exclusion prüfen | Keine Reaktivierung alter Angebote; Discovery bleibt separat geprüft |

Nachher vollständige Suite: **1340 Tests, 1339 bestanden, 0 Fehler, 1 bestehender Skip**. Skip: optionale lokale SPAR-KW24-PDF-Dateien nicht vorhanden; keine neue Deaktivierung, die entsprechenden historischen PDF-Quellen bleiben produktiv gesperrt. Backend-Laufzeitcode, Qualitätsgrenzen, Crawl-, Quellen- und Publish-Konfiguration unverändert. Keine Tests unterdrückt oder durch abgeschwächte fachliche Assertions grün gemacht.

## DigitalOcean-Gate: GREEN vor Release

Authentifizierte Weboberfläche lesend: Live-Deployment **065acd74-9194-4344-8448-94b75faa885f**, **Success / Live Deployment / Healthy**. Beide Komponenten-Buildlogs zeigen Checkout **f9e383f02f7baae1bde975e118c0e838a82c6479**, Verzeichnisse backend/admin getrennt geprüft. Alle Activity-Filter leer, keine ausstehenden/laufenden Deployments sichtbar. Source main, AutoDeploy On.

Gesundes aktuelles f9e383f0-Deployment als Release-Rollbackziel erhalten. Zusätzlich Vorgänger **96f7f522-1724-41b5-82e5-be4935b331d5** / **ef85d6da7ec5289104a4a940999ae54ca37b4c8d** mit Success und verfügbarer Rollback-Schaltfläche verifiziert, nicht ausgelöst. API-401 bleibt bestehen, wird durch überprüfbare UI-Nachweise für diesen Preflight ersetzt. Keine Konfiguration/Credentials geändert.

Health/Mongo gesund; lesender Dashboard-Preflight: globaler Lock frei, activeCrawlRun null, Publish openCount 0. Zeitpunktbefund erneut unmittelbar vor Push prüfen. Keine Crawls oder Mongo-Schreibzugriffe.

## Produkt-/SEO-Abnahme: GREEN lokal

- PRODUCT-001-Funktionen unverändert; allein ursprüngliches Logo plus direkt benachbarte Wortmarke ergänzt, im React-Header und initialem HTML. Original-PNG bytegleich zur Basis. 320-px-Umbruch des Suchen-Buttons mit Mindestbreite/nowrap behoben, keine neue Gestaltung oder Funktion.
- Frontend **138/138**, Lint grün. Vollständige lokale E2E-Kernreise erneut grün mit sechs Viewports 320/375/390/768/1024/1440, Filter/Sortierung/60→120→135-Pagination, History, Liste/Reload/Teilen/Empfänger, Preisablauf/API-Fehler und acht begrenzten Prüfabrufen.
- Finaler Build explizit mit **https://www.kaufklug.at/api**, ohne Fixture-API oder VITE-API-Override, erfolgreich. 41 initiale HTML-Routen. Build-/React-Policy identisch zur aktuellen Produktion, Robots bytegleich, dieselben 25 Sitemap-Ziele. Keine synthetischen Angebotsmarker im Releaseartefakt. Manifest in `release-artifact.json`.
- Zusätzlicher Browser-Smoke dieses echten Artefakts: Logo/Wortmarke und nicht umgebrochene dominante Suche auf allen sechs Breiten; tatsächliche Public-Kaffeesuche, persistente freie Liste ohne erfundene Teilsumme, B/C deaktiviert und Supermarkt-Canonical nach Hydration. Ausschließlich begrenzte öffentliche GETs, kein produktiver Share-Write. Lokaler Node-TLS-Vertrauensfehler wurde mit unveränderter Zertifikatsprüfung über curl isoliert; kein Produktfehler oder TLS-Bypass.
- Sparplan bleibt sichere Teilfunktion; keine vollständigen Warenkorbpreise, garantierten Bestpreise oder fiktiven Ersparnisse. Keine Affiliate-/Tracking-/Händlererweiterung. SEO-014 und SEO-004/005-Grenzen unverändert. GSC-Baseline aus PRODUCT-001 bleibt Referenz, kein aktueller Rankingeffekt behauptet.

## Releaseverfahren und Dokumentationsgrenze

Bei unverändert grünen unmittelbaren Gates: nur explizit geprüfte Frontenddateien, fünf Backend-Testdateien und diesen Releasebericht stagen; Staged-Diff/Secretprüfung, ein Releasecommit auf f9e383f0, Fast-forward-Push nach main, ausschließlich Auto-Deploy überwachen. Keine bestehenden uncommitteten DOC-002-Sammeländerungen ungeprüft mitveröffentlichen. Die vier zentralen MDs im Hauptrepo lokal synchronisieren; ihr Dirty-Zustand bleibt geschützt. Nach Live-Abnahme tatsächliche SHA/Deployment-ID lokal ergänzen, **kein zweiter Auto-Deploy nur für Dokumentation**.

Nachweise im isolierten Worktree: `evidence/product-002/` (Backend-Logs/Ursachen, DO, Produktionspreflight, echtes Artefakt, Browser und Schutzinventar); vollständige Fixture-Regressionen in dortiger Kopie `evidence/product-001-doc-002/`. Diese lokalen Belege sind keine Behauptung bereits produktiv erfolgter Änderungen.

**Stand vor Commit:** Gates lokal und Betriebsidentität grün; Commit/Push/Deploy und Live-Abnahme noch ausstehend. Sobald sich ein Gate verschlechtert, stoppen. Kritische Live-Regression: gesundes Vorgängerdeployment wiederherstellen, keine DB-Rücksetzung.
