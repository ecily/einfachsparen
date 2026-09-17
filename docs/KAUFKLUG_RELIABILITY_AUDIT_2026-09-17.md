# Reliability-Audit 2026-09-17

## Produktive Umsetzung am 17.09.2026 (Folgeauftrag)

Dieser Abschnitt ersetzt die Aussagen der darunter archivierten Erstdiagnose zu lokalem Patch, fehlendem Deploy und nicht beauftragtem SPAR-Fix. Der historische 6-Run-Befund bleibt erhalten.

**Abschlussstatus: NICHT GRUEN.** Health-Policy und SPAR-Kategoriefix sind committed/gepusht und regulaer deployed; Mueller ist noch nicht wiederhergestellt. Ein abschliessender Full Crawl ist ausdruecklich an Mueller-Public > 0 gebunden und wurde deshalb nicht gestartet.

### Commits / Deploy

- Ausgang: 7fedd9dd. Health-Persistenz/Diagnose: **848b9efb**, drei eng begrenzte Dateien. SPAR-Parser/Regression: **f1234c01**, zwei Dateien; Taxonomie-Ergaenzung **4a3b2c13** (Pepsi / Nocco / S-BUDGET Energy).
- Alle drei Commits nach origin/main gepusht. Regulaerer Auto-Deploy: Prozessstart 08:00:13.683 UTC nach Health-Fix; 08:03:00.191 UTC nach SPAR-Fix. Health HTTP 200, Mongo verbunden. Finaler Produktdeploy nach 4a3b2c13: Prozessstart **08:10:07.601 UTC**, Health 200 / Mongo verbunden; regulaerer Crawl fruehestens 08:25:08 UTC. Runtime commitSha bleibt unknown; Zuordnung durch Deployment-Reihenfolge und spaetere Funktionsnachweise, keine behauptete SHA aus Health.
- Live-Dashboard zeigt jetzt policyEvidence=recorded-run-summary, 1 required / 1 optional bei den historischen fehlenden Einzelpolicies, beide source-spezifisch weiterhin unknown. Gesamtstatus korrekt gelb.
- Keine fremden Aenderungen in env.js, Offer.js, dashboardService.test.js oder untracked ImageEvidence-Arbeiten gestaged.

### Mueller: offizielles Discovery-Inventar

Normale unauthentifizierte HTTPS-GETs mit System-CA, keine Cookies/Tokens, kein Challenge-Solver, keine Proxyrotation. Suchindex dient ausschliesslich zum Auffinden offizieller URLs, nicht als heutiger Angebots-Snapshot. Der alte /c/online-angebote/-Endpoint wurde nicht erneut gecrawlt.

| Source | HTTP direkt | Public | Auth verwendet | Challenge | Preis | Menge | Validity | Bilder | Stabilitaet / Entscheidung |
|---|---|---|---|---|---|---|---|---|---|
| mueller.at/c/online-angebote/ (bestehend) | 403, Produktionshistorie | vorgesehen | nein | Client Challenge | nicht abrufbar | nicht abrufbar | nicht bestaetigbar | nicht abrufbar | persistenter required Ausfall seit 08.09. |
| www.mueller.at/online-angebote/ | 403 | vorgesehen | nein | ja | nur alter Suchindex | nur alter Suchindex | kein aktueller Fetch | nicht abrufbar | kein Ersatz |
| www.mueller.at/prospekte/; mueller.at/prospekte/ | 403, Apex leitet auf www | vorgesehen | nein | ja | Einstieg | Einstieg | Einstieg | Einstieg | automatische aktuelle Discovery blockiert |
| www.mueller.at/c/sale/ | 403 | vorgesehen | nein | ja | nicht abrufbar | nicht abrufbar | nicht abrufbar | nicht abrufbar | kein Ersatz |
| Schreibwaren / Aktionen / Online-Angebote-aus-dem-Prospekt | 403 | vorgesehen | nein | ja | nicht abrufbar | nicht abrufbar | nicht abrufbar | nicht abrufbar | eigene offizielle Kategorie, ebenfalls blockiert |
| Haushalt / Aktionen / Haushalt-Online-Angebote-aus-dem-Prospekt | 403 | vorgesehen | nein | ja | nicht abrufbar | nicht abrufbar | nicht abrufbar | nicht abrufbar | ebenfalls blockiert |
| /aktuelles/aktionen/; /aktuelles/aktionen/app-aktion/; /service/app/ | 403 | Informationsseiten | nein | ja | keine verifizierten Artikeldaten | unbekannt | unbekannt | unbekannt | App-Coupons verlangen Bedingungen/Kundenkonto; kein Tokenzugriff |
| /p/marc-jacobs-just-perfect-eau-de-parfum-PPN3206161/ | 403 | Produktseite | nein | ja | nicht abrufbar | nicht abrufbar | nicht abrufbar | nicht abrufbar | Produktdetails ebenfalls blockiert |
| /robots.txt; /sitemap.xml | 403 | Discovery | nein | ja | n/a | n/a | n/a | n/a | keine verifizierte API/JSON-LD/XHR-Discovery moeglich |
| offizielles CDN: Schulanfang_West_KW36_2026_AT (Link unten) | **200 application/pdf**, 27.853.300 Bytes, 20 Seiten | **ja**, offiziell verlinkt | nein | nein | ja, layoutgebunden | ja, artikelbezogen | **31.08.-23.09.2026**, explizit Steiermark | im PDF, kein verifiziertes Einzelprodukt-Image | konkreter aktueller Schulwaren-Sonderprospekt; keine nachhaltige Drogerie-Recovery belegt |
| Produktbild-CDN static.prod.ecom.mueller.de/products/2200299837280/2200299837280-VS.jpg | **200 image/jpeg**, 257.868 Bytes | ja, bestehende offizielle Evidence | nein | nein | nein | nein | nein | ja, Einzelproduktbild | Asset erreichbar, kein Angebotspreis-/Geltungsnachweis |
| oeffentlich indexierte AT-Drogerie-PDFs Mai/Juni | historische URLs gefunden | offizielle Assets | nein | nicht massgeblich | historisch | historisch | **abgelaufen** | PDF | nicht aktivierbar |
| CDN ListObjects-Prefix prod/public/at/Prospekte/ | 403 AccessDenied | Listing nicht freigegeben | nein | keine HTML-Challenge | n/a | n/a | n/a | n/a | nach einem Versuch beendet |
| zwei aus vorhandenem Dateimuster abgeleitete AT-Sonderflyer 07./14.09. | 403 XML | nicht bestaetigt | nein | keine HTML-Challenge | unbekannt | unbekannt | unbekannt | unbekannt | kein Existenz-/Berechtigungsbeweis; keine Enumeration fortgesetzt |

Offizielle Einstiege: [Prospekte](https://www.mueller.at/prospekte/), [App-Highlights](https://www.mueller.at/aktuelles/aktionen/app-aktion/). Der von der Prospektseite verlinkte [Schulwaren-PDF fuer West-Oesterreich](https://mueller-dam-bucket.s3.eu-central-1.amazonaws.com/prod/public/shop-master/prospekte/schreibware/Schulanfang-2026/Schulanfang_West_KW36_2026_AT) wurde lokal heruntergeladen, vollstaendig textuell geprueft und auf Seite 1 visuell gegengeprueft. Keine pauschale Behauptung, das gesamte Mueller-CDN sei blockiert.

**Entscheidung:** Kein belastbarer automatisierbarer Ersatz im bestehenden Drogerie-/Haushalts-Angebotsumfang gefunden. Ein fest verdrahteter, am 23.09. auslaufender Schulwarenprospekt wuerde eine andere Teilabdeckung liefern und die blockierte laufende Discovery nicht reparieren. Kein Mueller-Adapter oder Source-Wechsel auf dieser Basis, kein stale Snapshot, kein Mueller-Crawl gegen den unveraenderten Block. Die technisch offene CDN-Spur ist als konkrete Fortsetzungsmoeglichkeit dokumentiert, nicht als abgeschlossene Recovery ausgegeben. Raw/Stored des letzten regulaeren Mueller-Runs 0/0; Public/Filter/Search 0.

### SPAR-P1: Root Cause und globaler Fix

Der gemeinsame SPAR-Family-Parser rief fuer Coca-Cola Limonaden die Hilfsfunktion beerCandidate auf. Diese setzte productKind=beer, categoryKey=bier sowie Bier-/Pils-/Radler-Suchwoerter. Die Normalisierung priorisierte diese expliziten Kandidatenfelder vor der bereits korrekten Softdrink-Erkennung des Classifiers.

Parser v8 erzeugt den Cola-Kandidaten korrekt als Softdrinks. Zusaetzlich korrigiert eine allgemeine, ID-unabhaengige Guard-Regel versehentliche Bier-Templates anhand eindeutiger Titel-/Markenidentitaet: Softdrinks und Energy Drinks bleiben getrennt; explizite Bier-/Radler-/Biermischgetraenk-Identitaet bleibt unangetastet. Seitenkontext und Template-Suchwoerter duerfen diese Identitaet nicht bestimmen. Bei Korrektur werden kontaminierte Bier-Suchwoerter verworfen. Keine Ranking-/Search-Algorithmusaenderung.

Regression fuer alle drei Formate: Coca-Cola, Pepsi Cola, Fanta, Red Bull, Cola Energy, Stiegl Goldbraeu, alkoholfreier Naturradler, Cola-Biermischgetraenk. Zusaetzlicher read-only Replay der drei aktuellen KW37-Viewer liefert Coca-Cola jeweils als softdrinks, 16,56 EUR / 24 x 0,33 l, Gueltigkeit bis 23.09., korrekte Formatseparation.

### Verifikation / Crawls

- Parser/Klassifikation/Source-Health-Persistenz: **110/110** gruen.
- SourceHealthPolicy, CrawlRunService, Scheduler, Dispatcher, SourceSelection, Routes, SPAR-Discovery, SourceDefinitions, PublicValidity, ValidityRules, FilterMetadata und AppLoad: **165/165** gruen.
- Die drei vorbestehenden ImageEvidence-Fehler aus der Erstdiagnose bleiben fremder Arbeitsstand; sie wurden nicht in diese Commits aufgenommen.
- Der Browser-Skill konnte nicht initialisieren (Invalid browser service environment). Daher HTTP-/API-Smoke und Mongo-Validity-Abgleich, **kein visueller Interaktions-Smoke behauptet**.
- **Genau ein scoped SPAR-Family-Crawl:** Run **6aaba3efe53f35c446ec0005**, 08:25:19.803-08:25:58.690 UTC, success, drei Sources matched/success, 0 failed/partial, 0 required fail/partial, 0 optional problems. 13 Raw / 9 Stored, vier konservative parse-failed Rejects. SPAR 8/7, EUROSPAR 1/1, INTERSPAR 4/1 Raw/Stored. Startup-Grace eingehalten, startupGraceBypassed=false. Letzte Stage publish-status-finished; 9/9 Offers aktualisiert, alle crawl-run-success. Lock frei, kein aktiver Run.
- **Persistenz produktiv bewiesen:** direkter Mongo-Read des neuen CrawlRun enthaelt scheduledHealthPolicy fuer alle drei Source-Ergebnisse. Public API und direkter Mongo-Read der neun neuen Offers bestaetigen Parser spar-official-flyer-pdf-v8, korrekte Run-Lineage und 0 ungueltige Angebote.
- **Live-Kategorien:** Cola-Suche und Softdrinks-Kategoriefilter liefern fuer jedes Format genau einen Coca-Cola-Treffer. Bier-Suche SPAR=2 (Stiegl/Hirter), EUROSPAR=0, INTERSPAR=0; kein Cola-Treffer als Bier. Public-Zahlen bleiben 7/1/1. Keine manuelle DB-Korrektur.
- Nach dem scoped Erfolg referenziert sourceFailures den neuen Teil-Run und ist fuer diesen gruen; executiveStatus und scheduledDaily bleiben korrekt gelb mit dem Morgenlauf 6aab6e6c19269b36129e61fc. Das ist keine Mueller-/Full-Recovery. Interne Publish-Summary meldet 8.385 final / 0 open; sie enthaelt auch historische unknown-Status-Zeilen und ist kein Public-Count. Fuer die neun neuen Offers ist finaler Publish einzeln belegt.
- Finaler Full Crawl: **0**, Gate Mueller-Recovery nicht erfuellt. Kein Ersatzlauf und keine gruengefaerbte Full-Crawl-Semantik.

### Public-Smoke 08:04-08:05 UTC

Alle unten aufgefuehrten vorhandenen Landing-/Public-Einstiege sowie Search/Browse-Shells HTTP 200. BILLA Plus verwendet den BILLA-Einstieg, EUROSPAR/INTERSPAR den vorhandenen SPAR-Einstieg; keine neuen SEO-Seiten. HTTP 200 allein beweist keine Treffer.

| Haendler | Public-Facet | Browse-Ranking abrufbar | Search-Test | Treffer |
|---|---:|---:|---|---:|
| BILLA | 1029 | 950 | Stickeralbum | 1 |
| BILLA Plus | 1121 | 950 | Formil | 2 |
| Lidl | 142 | 142 | PARKSIDE | 36 |
| PENNY | 249 | 249 | Always | 1 |
| HOFER | 45 | 45 | TOPCRAFT | 5 |
| dm | 421 | 403 | Pampers | 1 |
| BIPA | 974 | 936 | BABYWELL | 47 |
| Mueller | **0** | **0** | mueller | **0** |
| SPAR | 7 | 7 | Zewa | 1 |
| EUROSPAR | 1 | 1 | Coca-Cola | 1 |
| INTERSPAR | 1 | 1 | Coca-Cola | 1 |
| PAGRO | **0** | **0** | unfiltriertes Retailer-Browse | **0** |

Facet-Zahlen sind nicht identisch mit der begrenzten/deduplizierten Ranking-Ergebnismenge (u. a. Candidate-Limit). Alle **3.684 tatsaechlich zurueckgegebenen Datensaetze** ueber komplette API-Pagination direkt per Mongo-Read mit PublicValidity abgeglichen: **0 ungueltig**, 1.513 explicit-validity, 2.171 snapshot-confirmed. Keine Zukunftsangebote in dieser Stichprobe, auch nicht bei HOFER. Keine Public-Validity-Lockerung.

### PENNY / PAGRO / Feedback

PENNY unveraendert: funktionierende Primaerquelle, optionaler Flyer-zero-store sichtbar. Das Live-Dashboard uebernimmt historische 1 required / 1 optional korrekt, ohne PENNY nachtraeglich eine nicht persistierte historische Einzelpolicy anzudichten. Neue Policy-Persistenz ist fuer die drei Source-Ergebnisse des SPAR-Teillaufs direkt in Mongo belegt; ein neuer PENNY-Flyerlauf wurde nicht gestartet. Kein PENNY-Parserumbau.

PAGRO weiterhin Public/Facet/Search 0; keine Source-Aktivierung. Read-only Feedback erneut 200 Eintraege, **21 new / 165 resolved / 14 duplicate**, keine Statusaenderung. BILLA/BILLA Plus Bier 14/10 Treffer, kein aktuelles Griesson-Knusperbrot-Muster (Griesson 0/0). Lidl Somat pulver liefert einen Ariel-Variantenartikel, nicht den historischen Feuerloescher: verbleibende Suchpraezision P2. SPAR-Bilder bleiben ohne geratenes Produktbild.

Zusaetzlicher Smoke-Befund fuer spaetere Triage: zwei BILLA-Plus-Flyertitel enthalten Formil H-Milch; einer vermischt Rindsgulasch mit Milch im Titel. Artikel-/Preiszuordnung nicht in diesem Block korrigiert oder als sicher bestaetigt; separater Parser-Qualitaetsfall. Kein Zusammenhang zum SPAR-Template-Fix.

### Rest / Abschluss

Mueller bleibt required coverage failure; der Produktblock ist **nicht abgeschlossen**. Fuer Fortsetzung benoetigt die Quelle eine nachweisbar oeffentlich erreichbare aktuelle Angebots-/PDF-Discovery im vereinbarten Sortiment, danach Adaptertests, gezielten Mueller-Crawl und erst danach den einen finalen Full Crawl. Kein Schutz-Bypass. SEO-Audit unveraendert, da keine materielle SEO-/Indexierbarkeitsaenderung vorgenommen wurde.

---

## Archiv: vorausgehende lesende Erstdiagnose

## A. Ampel

**Gelb gesamt, Mueller-Coverage rot.** Die wiederholten Partial-Runs sind exakt erklaert. Mueller ist weiterhin upstream blockiert und nicht source-success. Runtime, Lock und Publish sind gesund. Ein belegter interner Diagnose-/Persistenzfehler ist lokal repariert; noch kein Deploy.

## B. Executive Summary

Read-only Evidence: produktive Admin-/Public-APIs sowie MongoDB-Reads am 17.09.2026, ca. 07:20–07:35 UTC. Kein Mongo-Write, kein Indexbau, keine Feedbackmutation. Health: HTTP 200, Mongo verbunden, unveraenderter Prozessstart `2026-09-03T16:57:30.790Z`, Lock frei, kein aktiver Run, Publish 8.385 final / 0 open.

Die 8.385 sind **interne aktive Datensaetze**, keine Zahl oeffentlich gueltiger Angebote. Ebenso sind die 118 Mueller- und 267 PAGRO-Angebote interner Altbestand. Beide Haendler liefern aktuell 0 Public-Ranking-Treffer und fehlen im Public-Haendlerfilter.

Alle sechs untersuchten Runs haben genau einen required failure: Mueller HTTP 403 / Client Challenge. Die Historie zeigt denselben Ausfall bereits seit 08.09.; letzter erfolgreicher Mueller-Bestand stammt vom 07.09. PENNY war bereits seit dem September-Fix optional. SPAR war vom 12.–16.09. zusaetzlich durch einen Coverage-Guard partial, nicht durch kaputte Discovery.

## C. 6-Run Partial Matrix

Alle Starts sind scheduled/full um 04:37 UTC. Raw/Stored sind Source-Ergebnisse, keine Public-Counts.

| Datum | Run-ID | Required failed | Raw / Stored | Zusaetzlich optional partial | Raw / Stored | retained? |
|---|---|---|---|---|---|---|
| 12.09. | `6aa4d6ec19269b36129e6188` | Mueller: 403, fetch, Client Challenge | 0 / 0 | SPAR Current: multi-link-coverage-drop | 5 / 0 | Mueller ja; SPAR ja |
| 13.09. | `6aa6286c19269b36129e619e` | Mueller: 403, fetch, Client Challenge | 0 / 0 | SPAR Current: multi-link-coverage-drop | 5 / 0 | Mueller ja; SPAR ja |
| 14.09. | `6aa779ec19269b36129e61b4` | Mueller: 403, fetch, Client Challenge | 0 / 0 | SPAR Current: multi-link-coverage-drop | 5 / 0 | Mueller ja; SPAR ja |
| 15.09. | `6aa8cb6c19269b36129e61c9` | Mueller: 403, fetch, Client Challenge | 0 / 0 | SPAR Current: multi-link-coverage-drop | 5 / 0 | Mueller ja; SPAR ja |
| 16.09. | `6aaa1cec19269b36129e61e1` | Mueller: 403, fetch, Client Challenge | 0 / 0 | SPAR Current: multi-link-coverage-drop | 5 / 0 | Mueller ja; SPAR ja |
| 17.09. | `6aab6e6c19269b36129e61fc` | Mueller: 403, fetch, Client Challenge | 0 / 0 | PENNY Flyer: official-source-zero-stored | 11 / 0 | Mueller ja; PENNY im kompakten Ergebnis nicht belegt |

Mueller-Retention ist durch unveraenderte 118 Datensaetze mit Run-Lineage `6a9e3f6c19269b36129e610b`, letztem `lastSeenAt` 07.09.2026 04:41:19 UTC und letztem `updatedAt` 07.09.2026 04:41:34 UTC belegt. SPAR-Jobs belegen jeweils `previousDataRetention=keep-existing`, `shouldReplaceOnce=false` und 0 Inserts/Deaktivierungen. Fehlende kompakte Retained-Flags sind kein Beweis fuer geloeschte Daten.

Klassifikation: Mueller = **persistent source failure / genuine critical coverage failure**. SPAR = konservativer Replacement-Coverage-Guard bei geringer Extraktion. PENNY = optionaler parser zero-store. Kein rotierender Runtime-/Lockfehler, kein Beleg fuer einen transienten Netzwerkfehler, kein globaler Partial allein durch policy-skipped Sources.

## D. Mueller Root Cause / Fix

- Source: `mueller-official-online-offers`, URL `https://www.mueller.at/c/online-angebote/`.
- Produktionsdiagnose in allen sechs Runs: HTTP 403 Forbidden, `text/html; charset=utf-8`, Titel `Client Challenge`, `blockedLikely=true`, 3.038 Bytes im neuesten Run, Axios `ERR_BAD_REQUEST`, `tlsLike=false`.
- Requested URL und Final URL sind identisch; keine abweichende Ziel-URL belegt. Die gespeicherte Diagnose enthaelt keine vollstaendige Redirect-Hop-Historie.
- Ein regulaerer lokaler HTTPS-Abruf liefert ebenfalls 403 mit derselben Final URL/Content-Type. Keine Cookies, Challenge-Loesung oder Transportumgehung versucht.
- Kein HTTP-429-/Rate-Limit-Beleg. Eine interne Rate-Limit-Ursache des Schutzsystems ist ohne Upstream-Auskunft nicht unterscheidbar. Der sichtbare Befund ist eine anhaltende Client-Challenge, kein bewiesener Parser-Strukturwechsel oder kompletter Website-Ausfall.
- Parser wird vor Rohdatenextraktion nicht erreicht. Deshalb kein spekulativer Parser-/Retry-/Transportfix und kein produktiver Mueller-Crawl gegen den bestaetigten Block.
- Akzeptanz derzeit **nicht erfuellt**: Raw 0, Stored 0, Public 0, Source failed. Die 48h-Snapshot-Grenze bleibt unveraendert; der Bestand vom 07.09. wird korrekt nicht mehr publiziert.

Erforderlicher externer Schritt ist ein vom Haendler erlaubter stabiler Zugang zur bestehenden oeffentlichen Quelle. Erst nach normalem HTTP 200 mit echtem Angebotsinhalt ist ein scoped Mueller-Crawl fachlich sinnvoll.

## E. SPAR-Family Dauerbetrieb

Alle drei Current-Sources sind produktiv enabled, Parser/Discovery `spar-family-flyer-discovery-v4`, und wurden in allen sechs Scheduled Runs automatisch ausgefuehrt. Die 15 historischen PDF-Sources bleiben policy-bounded skipped.

Produktive Discovery-Evidence vom 17.09.:

| Format | akzeptierte Viewer-Zyklen | Viewer-Seiten | Raw / Stored / Public |
|---|---|---|---|
| SPAR | KW38 + KW37, getrennte `/steiermark/spar/`-Pfade | 16 + 24 | 8 / 7 / 7 |
| EUROSPAR | KW37, `/steiermark/eurospar/` | 16 | 2 / 1 / 1 |
| INTERSPAR | KW38 + KW37, eigener `flugblatt.interspar.at`-Host | 16 + 20 | 4 / 1 / 1 |

Alle akzeptierten Viewer lieferten HTTP 200 und aktuelle Metadaten bis 23.09.2026. EUROSPAR KW38 und alte KW36-URLs antworteten 404 und wurden verworfen. Der bekannte Listing-403 wird weiterhin durch die begrenzte, metadata-validierte Zyklusdiscovery abgefedert. Kein `.ashx`-/historischer PDF-Fallback.

SPAR 12.–16.09.: KW37 wurde gefunden und mit 5 Kandidaten geparst. Der Guard blockierte den Ersatz von 14 bisherigen durch 5 neue Offers: Ratio 0,357, Drop 9, Schwellen Ratio 0,65 und Drop 8. Am 17.09. bringen KW38 plus KW37 nach Dedupe 7 Offers; Drop 7 passiert den unveraenderten Guard. Deshalb kein Discovery-Fix und keine Guard-Lockerung.

Die geringen Zahlen sind **geringe Parser-/Extraktionsabdeckung**, kein Beleg fuer einen nahezu leeren Prospekt: 16–24 Viewer-Seiten werden verarbeitet, aber nur wenige Kandidaten erkannt. Die vollstaendige reale Prospektabdeckung wurde nicht behauptet. Aktuelle Kategorieprobleme siehe I.

## F. PAGRO

267 interne aktive `aktionsfinder-json`-Offers; letzter Bestandsstand 01.06.2026. Registrierte PAGRO-Sources sind deaktiviert/inaktiv; PAGRO kommt im Scheduled Run nicht vor. Public-Ranking `retailers=pagro` liefert 0, Public-Facets enthalten PAGRO nicht. Dashboard `publicValidityEligibleOffers=0`.

Einordnung: **historischer interner Bestand**, keine aktuell reproduzierbare Public-/Search-/Filter-Regression. Das Dashboard zaehlt absichtlich den internen `status=active,isActiveNow=true`-Bestand; diese Zahl darf nicht als Public-Coverage gelesen werden. Keine Source reaktiviert, keine Offers geloescht oder von Hand korrigiert, keine Public-Regel veraendert.

## G. PENNY Flyer

`penny-official-site` ist required und liefert am 17.09. 224 Raw / 161 Stored, success. PENNY hat 249 aktuelle Public-Facet-Angebote ueber seine bestehenden Quellen. Der Supplemental-Flyer ist bereits optional und liefert 11 Raw / 0 Stored, partial / `official-source-zero-stored`.

Er ist kein gegenwaertiger Public-Coverage-Blocker und verursacht den globalen Partial-Status nicht. Optional bedeutet nicht, dass die Website nachweislich jeden Prospektartikel abdeckt. Kein Parserumbau und keine Health-Policy-Abschwaechung.

## H. Source Health Policy

Der globale Terminalstatus war korrekt: alle sechs Summaries enthalten `requiredFailedSourcesCount=1`, `requiredPartialSourcesCount=0`, `optionalProblemSourcesCount=1`.

**Reproduzierbarer interner Fehler:** `compactSourceSummarySchema` in `CrawlRun.js` definierte `scheduledHealthPolicy` nicht. Mongoose entfernte das Feld beim Speichern. Die Summary war vorher richtig berechnet worden; die spaetere Dashboard-Diagnose behandelte fehlende Policies dagegen pauschal als required. Live am 17.09. meldete sie deshalb 2 required / 0 optional statt 1 / 1.

Lokaler Fix:

1. Source-Health-Policy wird im CrawlRun-Schema persistiert.
2. Historische Runs mit fehlenden Einzelpolicies nutzen konsistente gespeicherte Summary-Zahlen. Keine Rekonstruktion historischer Einzelzuordnungen aus heutiger Konfiguration; betroffene Sources bleiben als unknown-policy-Probleme sichtbar. Fehlende/inkonsistente Summaries bleiben konservativ gelb; explizite required failures duerfen nicht durch widersprechende Summaries verschwinden.
3. Extraction-Essence bezeichnet fehlende Policy als `unknown`/`null` und exportiert die Policy-Felder explizit.
4. HTTP-Fehler werden vor `zero-raw` als Transportblock erkannt.

Replay des echten Produktionssnapshots mit dem lokalen Fix: 1 required / 1 optional, Gesamtstatus weiterhin gelb. Source-Status, Counts, historische Runs, Publish und Public Validity bleiben unveraendert. Keine historische DB-Reparatur.

## I. Feedback Triage

Read-only: letzte 200 Feedbacks, 21 new, 165 resolved, 14 duplicate. Keine Statusaenderung.

- BILLA/BILLA Plus Griesson/Weizen-Knusperbrot als Bier: aktuelle `bier`-Abfrage liefert 24 plausible Bierangebote; `Griesson` liefert 0. Das konkrete gemeldete Muster ist aktuell nicht reproduzierbar, daher historisch/P2 in dieser Runde, kein Fix.
- Lidl `Somat pulver`: gemeldet war ein Pulver-Feuerloescher. Dieser ist aktuell nicht reproduzierbar; die Suche liefert heute einen generischen Waschmittel-Varianten-Treffer. Suchpraezision bleibt P2, ohne Zusammenhang zum scheduled Partial oder Mueller-Transport.
- Historische SPAR-Image-/Kategoriehaeufung: aktuelle 9 Public-Offers haben weiterhin keine geratenen Bilder. **Aktueller P1-Kategoriebeleg:** Coca-Cola Limonaden ist bei SPAR, EUROSPAR und INTERSPAR als Bier ausgegeben. Das ist ein aktuelles Trust-Problem, aber keine Ursache des Mueller-Ausfalls oder der erfolgreichen Zyklusdiscovery. Gemaess dem ausdruecklich lesenden Feedback-Scope kein Kategorie-/Search-Fix und kein Feedbackstatuswechsel.
- Kein neuer P0-Runtime-/Preis-/Validity-Fehler aus dieser Feedback-Triage belegt.

## J. Tests

- Source-Health-Persistenz: final 5/5 gruen. Mongoose-Cast/JSON/Hydration/Dashboard-Roundtrip; optionaler PENNY-Flyer bleibt partial, global aber success bei erfolgreicher required Primaerquelle; required Ausfall bleibt partial; historische fehlende/inkonsistente Policies fail-closed.
- Orchestrierung, Scheduler, Dispatcher, Source-Auswahl/Definitionen, SPAR-Zyklusdiscovery und App-Load: fokussierter Lauf 133/133 gruen (einschliesslich der ersten vier neuen Regressionen).
- Mueller-Parser und offizieller Zero-Store-Guard: 10/10 gruen.
- Public Validity, Freshness/TTL, Ranking, Filter und Dashboard: 356/359 gruen; drei bereits vorhandene ImageEvidence-Erwartungen in der fremd geaenderten `dashboardService.test.js` scheitern. Die identischen drei Fehler wurden mit dem unveraenderten HEAD-Dashboardmodul separat reproduziert (20/23); keine neue Fehlergruppe. Finaler Nachlauf nach dem letzten Negativguard: Dashboard plus neue Regressionen 25/28, ausschliesslich dieselben drei Altfehler.
- Public-Live-Smokes: Mueller/PAGRO 0, SPAR-Family 7/1/1, BILLA-Bier 24, Facets konsistent. Homepage, Browse, Suche und Top Deals HTTP 200. Kein visueller Browser-Smoke behauptet.
- `git diff --check` gruen; nur bestehende CRLF-Konvertierungshinweise.

## K. Crawls / Deploy

0 neue Crawls, weder scoped noch full. Mueller ist bestaetigt upstream blockiert; der interne Persistenz-/Diagnosefix benoetigt keinen Angebotscrawl zum Test. Kein Deploy, Push oder Commit vorgenommen. Der lokale Patch ist reviewbar; Live laeuft weiterhin der Prozess vom 03.09.2026. Die neue Policy-Persistenz kann erst nach Deployment in einem nachfolgenden regulaeren Run produktiv bestaetigt werden.

## L. Git / Context

Branch `main`, Ausgangs-HEAD `7fedd9dd`; Status und letzte 20 Commits geprueft. Eigene Aenderungen: `backend/src/models/CrawlRun.js`, `backend/src/services/dashboard/dashboardService.js`, neue `backend/test/sourceHealthPersistence.test.js`, dieser Bericht und `docs/KAUFKLUG_CONTEXT.md`.

Fremde Aenderungen in `env.js`, `Offer.js`, `dashboardService.test.js` sowie bestehende untracked Dateien blieben unberuehrt. Sensible Admin-/DB-Verbindungswerte wurden nur prozessintern genutzt und nicht ausgegeben oder in den Bericht uebernommen. SEO-Audit unveraendert, da keine materielle Indexierbarkeits-/SEO-Aenderung.

## M. Restprobleme

1. Mueller-403/Client-Challenge: extern offen; kein Source-success und keine Public-Coverage.
2. Lokaler Diagnosefix noch nicht deployed; Produktionsabnahme nach naechstem regulaeren Run offen.
3. SPAR-Family: geringe Extraktionsabdeckung und aktueller Coca-Cola/Bier-Kategoriefehler; Discovery funktioniert. Kein breit angelegter Parserumbau in diesem Auftrag.
4. PENNY-Flyer-zero-store bleibt als optionale Source-Stoerung sichtbar.
5. Drei bestaetigte fremde ImageEvidence-Testfehler bleiben offen.

## N. Abschluss

Die sechs Partial-Runs sind fachlich und technisch erklaert. Die globale Crawl-Semantik meldet den echten Mueller-Ausfall korrekt. Der davon getrennte Policy-Verlust in Speicherung/Diagnose ist lokal behoben. **Kein gruener Mueller-/Gesamt-Recovery-Abschluss**, solange der externe Block besteht und der Patch nicht produktiv abgenommen wurde.
