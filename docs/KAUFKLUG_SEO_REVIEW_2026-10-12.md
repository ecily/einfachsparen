# SEO-Prüfung kaufklug.at – 12.10.2026

**Ampel: GELB für organische Entwicklung; GRÜN für den geprüften lokalen Änderungsumfang.** Kein Push, kein Deployment. Rankingverlust und Schokolade-noindex vom 09.10. sind nicht kausal erklärt. Keine Rankinggarantie.

## Evidenz und Ausgangswerte

Aktueller lokaler Export: `https___www.kaufklug.at_-Performance-on-Search-2026-10-12.xlsx`, Österreich, Web, letzte 28 gegen vorherige 28 Tage. Export enthält keine expliziten Start-/Enddaten und keine tägliche Zeitreihe. Länder-/Gerätetabellen: Klicks **37 → 8**, Impressionen **5.188 → 1.896**, Position **22,57 → 31,50**. Seiten ergeben dagegen 10 → 2 Klicks und 4.154 → 1.595 Impressionen; Queries 10 → 2 und 4.136 → 1.590. Diese Aggregationen werden nicht vollständig abgestimmt oder gleichgesetzt. Separate Seiten-/Querytabellen belegen keine einzelne Query-Seiten-Zuordnung.

Seitenwerte, Slash-/Nicht-Slash-Varianten zusammengezählt; jeweils vorher → aktuell:

| Seite | Klicks | Impressionen |
|---|---:|---:|
| Homepage | 0 → 1 | 108 → 64 |
| BILLA | 3 → 0 | 729 → 141 |
| Lidl | 1 → 0 | 628 → 113 |
| HOFER | 3 → 0 | 695 → 230 |
| BIPA | 1 → 0 | 363 → 79 |
| PENNY | 0 → 0 | 304 → 160 |
| Supermarkt | 1 → 1 | 602 → 503 |
| Bier | 0 → 0 | 0 → 31 |
| Kaffee | 1 → 0 | 143 → 33 |
| Schokolade | 0 → 0 | 169 → 98 |

Wichtige Query-Baselines: `billa angebote` 177 → 26 Impressionen, 2 → 0 Klicks, Position 13,63 → 59,65; `lidl angebote` 182 → 48, Position 14,75 → 29,23; `penny angebote` 191 → 60, Position 10,91 → 26,57; `hofer aktionen aktuell` 61 → 2, Position 10,74 → 49; `bipa` 64 → 11, Position 15,66 → 16,09. `lidl prospekt aktuell` 180 → 0 Impressionen ist ein Intent-Hinweis, kein Anlass für ein unbelegtes vollständiges Prospektversprechen.

Nutzer-GSC-Evidenz: BILLA indexiert, erfolgreicher Abruf 07.10., Google-Slash-Canonical; Schokolade am 09.10. noindex, Live-Test am 12.10. indexierbar, Indexierung bereits beantragt. Kein zusätzlicher aktueller URL-Inspection-Export vorhanden. Bei den anderen Seiten wird **indexierbar**, nicht „Google-indexiert“, berichtet. GSC-Sitemap Success mit 25 entdeckten Seiten; Live-Sitemap heute 26 URLs. Unterschiedliche Abrufzeitpunkte sind möglich; Sitemap ist kein Indexierungsnachweis.

## Priorisierte Befunde und Umsetzung

| Priorität | Beleg / Bedeutung / Unsicherheit | Vorher → nachher | Aufwand / Risiko |
|---|---|---|---|
| 1 | Gemeinsame Robots-Entscheidung widersprüchlich: live Butter initial `noindex,follow`, React `index,follow`, nur 2 Treffer. Utility-Suche hatte ebenfalls Index-Fallback. Das beweist einen Systemfehler, nicht die Ursache der Händlerverluste. | Finaler Build-Status wird als JSON im Head an React übergeben; Robots und interne SEO-Links verwenden dieselbe Entscheidung, auch nach SPA-Navigation. Butter bleibt noindex. | Klein / gering; Schwellen unverändert |
| 1 | SEO-Autopilot behandelte fehlende API-Evidenz wie schwache Angebotsdaten. Eine vorübergehende Qualitäts-API-Störung konnte neue noindex-Signale erzeugen. Keine historische Ausfallkorrelation für 09.10. vorhanden. | Begrenzte Wiederholung; fehlende/ungültige Evidenz beendet den Build mit Fehler vor SEO-Dateischreiben. Gültige leere oder dünne Daten bleiben noindex. Keine alten Angebote als aktuelle Ersatzdaten. | Klein / bewusster Tradeoff: API-Ausfall verhindert Veröffentlichung |
| 2 | Initiales HTML enthält keine eigentlichen Angebotskarten: Händlerseiten und Schokolade primär Intro/Links/Ladezustand; Bier/Kaffee zusätzlich datierte Aggregationen. Google kann JS rendern, aber der Hauptnutzen hängt weiterhin davon ab. | Neun Angebotsseiten erhalten sichtbare, spezifische Vergleichshilfe in initialem HTML und React: BILLA/Plus-Scope, Mengenaktionen, sichere Einheiten, Kartenbedingungen, Produktformen, Pfand/Verfügbarkeit. Methodik-Link direkt dabei. | Klein / gering; keine erfundenen Angebote |
| 2 | Interner Link „Alle Angebote“ wurde als `/angebote/angebote/` zusammengesetzt; React-Verwandtschaft/Footer verlinkten auch vom Build ausgeschlossene Seiten. | Ziel `/angebote/`; Links nach tatsächlicher Build-Indexierbarkeit gefiltert. Keine neuen Landingpages. | Klein / gering |
| 2 | Build-Zahlen waren als „aktuelle Angebote“/„Aktueller Vergleich“ bezeichnet, obwohl sich statisches HTML nur beim nächsten Build ändert. | „ausgewertete Angebote“, „Vergleich zum Datenstand“, „Auswertung vom … Die aktuellen Treffer werden separat geladen.“ | Klein / gering |

Google kann bei initialem noindex die JS-Ausführung überspringen; ein späteres React-index ist keine verlässliche Korrektur. Die Umsetzung folgt [Googles JavaScript-SEO-Dokumentation](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics). Sichtbare Vergleichshinweise unterstützen [hilfreiche Inhalte](https://developers.google.com/search/docs/fundamentals/creating-helpful-content); kein Wirkungsnachweis für Rankings. Interne Links sind beschriftete `<a href>` nach [Google-Linkregeln](https://developers.google.com/search/docs/crawling-indexing/links-crawlable).

## Weitere Prüfung und Grenzen

- Zehn repräsentative Live-Seiten: HTTP 200, `index,follow`, keine X-Robots-Sperre, selbstreferenzierende Slash-Canonicals, in Sitemap vorhanden. Robots.txt erlaubt öffentlichen Crawl, sperrt administrative Bereiche. Title/Description/H1 passen zum Angebot-/Vergleichsintent; keine kosmetischen Meta-Änderungen. Google darf Snippets und Titel selbst wählen ([Titles](https://developers.google.com/search/docs/appearance/title-link), [Snippets](https://developers.google.com/search/docs/appearance/snippet)). Canonicals/Hosting/Redirects unverändert; Varianten in GSC sind kein alleiniger Beleg für einen Canonical-Fehler.
- Schokolade aktuell 13 öffentliche Angebote aus 3 unabhängigen Händlergruppen; unveränderte Mindestqualität erfüllt. Butter mit 2 Angeboten bleibt ausgeschlossen. Kategorien brauchen weiterhin mindestens 10 Angebote und 2 Gruppen; Händler mindestens 10 und 50 % Bildabdeckung. Kein blindes Senken von noindex-Schwellen.
- Lesende API-Stichprobe: BILLA/Lidl/HOFER/BIPA/PENNY je bis 60, Bier 28, Kaffee 59, Schokolade 13. Keine explizit abgelaufenen oder `isActiveNow=false` Treffer. Viele Treffer ohne vollständiges Datumspaar (BILLA 56/60, HOFER 60/60, Kaffee 52/59, Schokolade 11/13). Bestehendes PublicValidity akzeptiert bei passenden Quellen bestätigte Snapshots mit TTL; keine Behauptung, alle Angebote hätten explizite Aktionszeiträume. Fehlende Datumsangaben und Verfügbarkeit bleiben Informationsgrenzen. Normalisierte Preise vorhanden, aber keine fachliche Vollprüfung aller Vergleiche. Keine Daten-/Backend-Änderung.
- JSON-LD gelesen: initial WebSite, WebApplication, BreadcrumbList; React ergänzt eigene Einträge/Impressums-Person. Keine neuen Produkt-, Bewertungs- oder Organisationsbehauptungen, keine Rich-Result-Zusage. Doppelte allgemeine Einträge sind kein belegter Rankingblocker. Maßstab: [Google Structured Data Policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies).
- Mobile Nutzung: kein Overflow, lesbare Überschriften, klickbare Links. JS nach Änderung 458 kB / 138 kB gzip, vorher rund 452 / 136 kB. Keine auffällige Größenexplosion; einzelne HTTP-Abrufe ca. 0,22–0,34 s. Das ist kein Core-Web-Vitals-Nachweis; Felddaten fehlen.
- Gezielte Historie: `346249ca` SEO-Autopilot, `89eaeffd` Snapshot-Aktualisierung. Build-Zeitpunkt bestimmt statische Evidenz. Eine historische Schokolade-Datenmenge/API-Störung am 09.10. lässt sich daraus nicht rekonstruieren.
- Größere Architektur zurückgestellt: vollständige fachlich valide Angebotskarten serverseitig/prerendern und deren Aktualisierung verbindlich regeln. Ohne Freshness-Konzept würde das veraltete Angebote riskieren. Keine entsprechende Nebenimplementation.

## Geänderte Dateien dieses Auftrags

- `admin/scripts/generateSeoHtml.mjs`: Build-Evidenz, Wiederholung/Abbruch, Policy-Manifest, sichtbarer Vergleichstext, datierte Zahlen, vorhandene Registry-Hinweise initial sichtbar.
- Neu `admin/src/utils/seoBuildPolicy.js`, `admin/src/config/seoComparisonGuides.js`.
- `admin/src/utils/seo.js`, `admin/src/components/search/SeoOfferLandingPage.jsx`, `admin/src/components/layout/SeoFooterLinks.jsx`, `admin/src/config/seoLandingPages.js`, `admin/src/utils/seoComparisonSummary.js`.
- `admin/src/index.css`: ausschließlich `.seo-comparison-guide p` für lesbare Zeilenlänge/Zeilenhöhe.
- Tests: neu `seoBuildPolicy.test.mjs`; erweitert `seoAutopilot.test.mjs`, `seoComparisonSummary.test.mjs`, `seoStaticHtml.test.mjs`.
- Dieser Bericht und knapper Nachtrag `docs/KAUFKLUG_CONTEXT.md`; Belege unter `evidence/seo-2026-10-12/`.

Ältere Homepage-/Sponsoränderungen im lokalen Diff sind bereits veröffentlicht und gehören nicht zum neuen SEO-Umfang. Fremde Backend-/Dokumentationsänderungen erhalten. Keine neue Dependency, kein Crawl/DB-Write/Reindex/Repair, keine Änderung an Ranking/Scheduler oder Angebotsgewinnung.

## Abnahme

- Production-Build mit Public API: bestanden. ESLint: bestanden. Utility-Suite **93/93** bestanden; zusätzliche gezielte Wiederholung **11/11** bestanden.
- Bestehender Discovery-Test **3/5**: zwei bereits im unveränderten Ausgangsstand nachgewiesene Fehler (Kategorie-Reihenfolge/Müller-Erwartung), keine neue Regression. Analytics-500 aus vorherigem Homepage-Auftrag separat bekannt; kein Analytics-Fix und kein neuer Kausalitätsbefund.
- Lokales 503-Fixture: Generator Exit 1, bestehendes HTML/Sitemap per SHA-256 unverändert; dieser vollständige API-Ausfall stoppt bereits beim bestehenden Preischeck. Neue Tests prüfen speziell Qualitäts-Evidenz, Wiederholung und gültige leere/dünne Daten.
- Gebautes Initial-HTML der zehn Seiten: Title, Description, Canonical, Robots und H1 exakt gegen Live-Baseline erhalten; neun Vergleichstexte ohne JS lesbar. React enthält exakt dieselben Guide-Absätze.
- Browser 375 px: alle zehn plus Butter. 768/1440 px: Homepage, BILLA, Schokolade. Kein horizontaler Overflow. Homepage-DOM exakt gegen Sponsor-entfernte Baseline identisch; Außenkanten konsistent; 19 eindeutige Vorschläge. Enter-/Button-Kaffeesuche jeweils 59 Karten, Suche weiterhin noindex. Alle 19 Ziele bereits in Ausgangsabnahme geprüft und unverändert.
- Screenshots: `billa-guide-375.png`, `billa-guide-1440.png`, `schokolade-guide-375.png`, `schokolade-guide-1440.png` im Belegordner. Kein neuer technischer Abnahmeblocker; Veröffentlichung noch nicht freigegeben.

## Höchstens drei kostenlose Maßnahmen außerhalb des Codes

1. Neun normale Seiten aus der GSC-Sitemap-Einreichungsliste entfernen, `/sitemap.xml` behalten. Ca. 10 Minuten; sauberere Diagnose, kein belegter Rankinggewinn. Hier nicht ausgeführt.
2. Nach genehmigter Veröffentlichung URL-Prüfung für BILLA, Lidl, HOFER, BIPA und Schokolade einschließlich gerendertem Inhalt/Robots/Canonical. Ca. 20 Minuten; bestätigt Aufnahme der technischen Signale. Bereits beantragte Schokolade-Indexierung nicht blind erneut einreichen. Hier keine Einreichung.
3. Wöchentlich identischen AT/Web-Export archivieren, Seitenvarianten nachvollziehbar gruppieren und mobile/desktop getrennt betrachten. Ca. 15–20 Minuten/Woche; bessere Unterscheidung von Sichtbarkeit, CTR, Nachfrage und Indexierungsproblemen.

## Messplan nach Veröffentlichung

Nach 7 Tagen technische URL-Prüfung und Indexierungsstatus; nach vollständigen 28 Tagen gleicher AT/Web-Filter gegen vorherige 28 Tage. Baseline oben und `gsc-root.json` unverändert aufbewahren. Zehn Seiten und genannte Queries beobachten; BILLA/Lidl/HOFER/BIPA priorisieren, Schokolade gesondert Indexierungsverlauf prüfen. Klicks, Impressionen, CTR und Position gemeinsam bewerten, Seiten-/Query-Aggregationen getrennt halten. Keine feste Rang-/Traffic-Zielzusage bei nur acht aktuellen Klicks. Veröffentlichungstag/Build notieren; Änderungen von Nachfrage oder Angebotsbestand nicht dem Code allein zurechnen.
