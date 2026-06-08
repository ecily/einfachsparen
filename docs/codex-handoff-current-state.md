# kaufklug.at / einfachsparen – Codex Handoff Current State

Stand: 2026-06-08
Status: Live-Beta
Zweck: Pflichtlektüre für neue Codex-Chats, damit kaufklug.at nicht als Greenfield-Projekt behandelt wird.

---

## 1. Grundverständnis

kaufklug.at / einfachsparen ist ein live betriebenes Beta-Produkt für österreichische Supermarkt- und Drogerie-Angebote.

Es gibt bereits:
- Frontend
- Backend
- Crawling
- Offer Ranking
- SourceDefinitions
- Admin-Dashboard
- Feedback-System
- SEO-Seiten
- Legal-Seiten
- Branding
- Live-Deployments

Nicht als Greenfield-Projekt behandeln.

Rolle von Codex:
- Co-CEO-Unterstützung
- Produktverantwortung
- Source-/Data-Quality-Verantwortung
- UI-/UX-Verantwortung je nach Task
- ehrlich, kritisch, entscheidungsstark
- keine Schönfärberei
- Live-Beta-Wirkung vor theoretischer Perfektion

---

## 2. Produkt-USP

USP:
Nicht blättern. Finden.

Aktueller Claim/Slogan:
Angebote aus Flugblättern. Endlich einfach durchsuchbar.

Kernversprechen:
- Angebote schnell finden
- Preis, Gültigkeit und Bedingungen sichtbar machen
- keine Fake-Daten
- keine erfundenen Preise
- keine erfundenen Bedingungen
- keine erfundenen Bilder
- Vertrauen vor Menge
- offizielle Quellen bevorzugen
- Aggregatoren nur ergänzend

Wichtige Produktregel:
Bedingungen sind Preiswahrheit. Wenn ein Angebot nur ab bestimmter Menge, mit 1+1, mit App/Club oder unter anderer Bedingung gilt, muss das sichtbar sein, sofern belegbar.

---

## 3. Globale Arbeitsprinzipien

Feedback ist kein isolierter Einzelfix, sondern ein Lernsignal für das Gesamtsystem.

Jedes Nutzerfeedback, Crawl-Feedback, Source-Failure und jede Nachprüfung muss darauf geprüft werden:
- welches wiederkehrende Muster dahinterliegt
- ob ein global relevanter Fix möglich ist
- ob Parser, Normalizer, Classifier, Ranking, Darstellung, Source-Gates oder Triage verbessert werden können

Feedback darf nicht blind als Wahrheit übernommen werden.

Pflichtlogik:
1. Feedback lesen
2. Evidence prüfen
3. Muster erkennen
4. globalen Hebel suchen
5. nur bei belastbarer Evidence implementieren
6. nachher testen und live verifizieren

Keine Fake-Daten:
- keine Fake-Angebote
- keine Fake-Preise
- keine Fake-Bilder
- keine erfundene Gültigkeit
- keine erfundenen Bedingungen
- keine falsche regionale Gültigkeit
- keine Übernahme aus Screenshot/Userfeedback allein ohne offizielle oder technisch belastbare Evidence

---

## 4. Harte Verbote ohne explizite Freigabe

Nicht tun ohne ausdrückliche Freigabe:
- Full Crawl
- Repair
- Reindex
- raw Mongo-Mutation
- neue Märkte
- große Ranking-Umbauten
- SourceDefinitions breit ändern
- Cloudflare-/Captcha-/Bot-Umgehung
- Cookies/Tokens/Sessions/DevTools-Secrets nutzen
- Proxy-/IP-Rotation
- Fake-Daten erzeugen
- alte Feedbacks direkt in Produktdaten schreiben
- mehrere Händler parallel anfassen

Bei jedem Task Scope eng halten.

---

## 5. Regionalitäts-Policy

Regionalität ist ein globales Thema für alle Märkte.

Bis zur späteren Regionalitätslogik gilt:
- keine österreichweite Gültigkeit behaupten, wenn nicht belegt
- keine Filialgültigkeit behaupten, wenn nicht belegt
- Markt-/Region-/Filialdaten als Evidence speichern, sofern vorhanden
- nicht überdehnen
- sichtbarer Hinweis ist erlaubt/sinnvoll:
  - Aktuell gefunden – bitte im Markt prüfen

Später eigener globaler Regionalitätsblock.

---

## 6. Source-Gates

Es gibt eine Doku:
`docs/source-quality-gates.md`

Diese ist Pflichtkontext.

Keine Quelle künftig ohne Prüfung:
- Product Evidence Gate
- Transport Gate
- Data Quality Gate
- Trust/Regionality Gate
- Operational Gate

PAGRO und SPAR Productworld zeigen, warum Gates nötig sind:
- fachlich gute Quelle reicht nicht
- Transport muss legal/stabil sein
- keine Challenge-/Cloudflare-Bypässe

---

## 7. Aktueller Systemstatus

Stand 2026-06-08:

System operativ stabil:
- Backend ok
- Mongo verbunden
- GlobalLock frei
- activeCrawlRun null
- Publish final
- Publish open 0
- active offers ca. 7786
- kein aktueller P0

Letzter scheduled Full Crawl:
- RunId: `6a25f7f09cc217ed145f67d2`
- Status: partial, aber terminal
- sourceOk: 15
- sourceFail: 1
- einziger SourceFail: `billa-official-site-offers-page`
- Fehler: HTTP 500 bei `https://www.billa.at/unsere-aktionen/aktionen`
- aktueller GET später wieder 200
- kein Block/Challenge
- Entscheidung: beobachten, kein Fix
- alte Daten retained
- 13 scoped-only Sources korrekt als policy-bounded/skipped klassifiziert
- keine alten Aktionsfinder `/pv/...` 404-Failures mehr als aktueller Failure

Current Crawl System:
- grün
- Lock frei
- Publish final
- kein Blocker

Executive kann gelb bleiben, solange letzter scheduled Full Crawl historisch partial war.

---

## 8. Heute abgeschlossene Data-/Trust-Blöcke

### 8.1 HOFER/Lidl Category Fix

Problem:
Offene Feedbacks zeigten harte Kategoriefehler:
- HOFER Lebensmittel als Haushalt/Technik
- Lidl einzelne Lebensmittel unkategorisiert/falsch

Fix:
- Commit: `c7a2e1209dc528e2fb6914e547ec02b324c219c8`
- Message: `Fix food category anchors for Hofer and Lidl`
- Dateien:
  - `backend/src/services/crawl/categoryClassifier.js`
  - `backend/test/categoryClassifier.test.js`

Abgedeckte Fälle:
- `PIZZ'AH Picco Belli, Flammkuchen`
- `Potato Wedges, Mediterran`
- `Potato Wedges, Classic`
- `BACKBOX Laugenwuchtel`
- `BACKBOX Chili Cheese Hot Dog`
- `DR. OETKER Ristorante 2er`
- `Marillen`
- `Butterkaese in Scheiben`
- `Grilltaler`

Scoped Recrawl:
- RunId: `6a269abd30abbd864e9d83bf`
- Mode: scoped
- Sources:
  - `hofer-official-flyer`
  - `lidl-official-flyer`
- Status: success
- sourceOk: 2
- sourceFail: 0
- Publish final
- Lock free

Live sichtbar behoben:
- Potato Wedges -> Lebensmittel / Tiefkuehl- & Fertigprodukte
- Picco Belli Flammkuchen -> Lebensmittel / Tiefkuehl- & Fertigprodukte
- Marillen -> Lebensmittel / Obst & Gemuese
- Butterkäse -> Lebensmittel / Kaese

Nicht public auffindbare Feedbacks:
- BACKBOX Laugenwuchtel
- BACKBOX Chili Cheese Hot Dog
- Ristorante 2er
- Grilltaler

Diese nicht technisch erzwingen; manuell stale/nicht public prüfen.

---

### 8.2 PENNY Conditions

PENNY wurde mehrfach evidence-first geprüft.

Ergebnis:
PENNY Product-Discovery-API verarbeitet strukturierte Bedingungen bereits korrekt.

Funktionierender Pfad:
- `promotionType=FROM`
- `promotionQuantity`

Live-Beispiele:
- Nöm Vollmilch -> `ab 2 Flaschen`
- Gösser Märzen/Naturradler -> `ab 24 Flaschen`
- Schärdinger Sirius Camembert -> `ab 2 Stueck`
- Vöslauer Mineralwasser -> `ab 6 Flaschen`
- Finis Feinstes Mehl -> `ab 2 Packungen`

Alte Feedbacks ohne aktuelle Evidence:
- Grüner Veltliner -> Nutzer erwartete `ab 2 Flaschen`, aktuelle Raw-Evidence nicht belastbar
- Puntigamer Bier -> Nutzer erwartete `ab 24 Dosen`, Artikel nicht aktuell in offizieller Gruppe gefunden
- Formil haltbare Vollmilch -> Nutzer erwartete `ab 12 Packungen`, Artikel nicht aktuell in offizieller Gruppe gefunden

Entscheidung:
- kein Code-Fix
- nicht als technisch behoben markieren
- manuell stale/nicht belegbar prüfen

PENNY 1+1 gratis:
Beispiele:
- Soletti Salzstangerl*
- Iglo Fischstäbchen*

Befund:
- `1+1 gratis` sichtbar im Angebotsbild
- aber nicht in offizieller Product-Discovery-API
- nicht in Detail-HTML
- keine Tags/Badges/Text-Evidence außer `regularTags=["SO"]`

Entscheidung:
- kein Fake-Fix
- kein OCR-Block jetzt
- konservativer Hinweis bleibt:
  - `Bedingung im Angebotsbild prüfen`

Globales Learning:
PENNY hat zwei Bedingungsklassen:
1. strukturierte Bedingungen -> automatisch anzeigen
2. nur bildnahe Bedingungen -> konservativer Hinweis, bis OCR-/Evidence-Pipeline existiert

---

### 8.3 BILLA HTTP 500

BILLA SourceFail aus scheduled Crawl:
- `billa-official-site-offers-page`
- URL: `https://www.billa.at/unsere-aktionen/aktionen`
- Stage: fetch
- HTTP 500
- Body: normale HTML-Struktur, keine Challenge
- später einfacher GET wieder 200
- BILLA Plus auf gleicher URL lief im Run erfolgreich

BILLA Zustand:
- active: 1163
- official: 977
- aggregator: 186
- officialRate: ca. 84%
- imageCoverage ca. 99.8%
- warningStatus green

Entscheidung:
- temporärer Upstream-Fehler
- beobachten
- kein Fix
- nächsten scheduled Crawl beobachten

---

## 9. Frontend-Stand

Heute mehrere Frontend-Blöcke abgeschlossen.

### 9.1 Header / Hero / Händlerchips

Commit:
- `bf66ecfc Adjust home hero retailer grouping`

Änderungen:
- Slogan: `ANGEBOTE AUS FLUGBLÄTTERN. ENDLICH EINFACH DURCHSUCHBAR.`
- Reihenfolge im Hero:
  - Slogan
  - Händler-Chips
  - Headline
  - Trust-Chips
  - Beta-Hinweis
- Händlergruppen:
  - BILLA / BILLA Plus
  - SPAR / EUROSPAR / INTERSPAR
  - HOFER / Lidl / PENNY
  - dm / BIPA
  - PAGRO
- Trenner vor PAGRO

Später wurde Beta-Hinweis aus Hero gezogen.

### 9.2 Beta-Hinweis und Suchblock

Commits:
- `1c6bc52b` Frontpage Beta/Search Layout
- `b9b65989` Mobile Wrapping
- final live: `dda36d4b268c541d0e36a56f29a2c31e0a340a82`

Änderungen:
- Beta-Hinweis ist eigener schlanker Block oberhalb des Hero
- Hero enthält keine Beta-Leiste mehr
- redundanter unterer Block `kaufklug ist in Beta... Feedback senden` entfernt
- Suchblock `Wonach suchst du heute?` ruhiger/heller als primärer Einstiegspunkt hervorgehoben
- mobile Beispielchips umbrechen sauberer

### 9.3 Offer Conditions sichtbar

Commit:
- `f1dd731d1d54c0b7f3a96ae714797b50ad953c75`
- Message: `Improve offer condition visibility`

Änderungen:
- Bedingungen stehen näher am Preis
- Mengenbedingungen wie `Gilt ab 12 Dosen` stärker hervorgehoben
- keine Datenlogik geändert

### 9.4 Empty State, Pfeilschnell, Placeholder

Commit:
- `d3e534e4f3de49fdf3a833f1a98403fe92c38acd`

Änderungen:
- Hero-Benefit-Chip `Pfeilschnell` ergänzt
- 0-Treffer-State freundlicher
- Beispiel `/suche?q=reininghaus` zeigt Vorschlagschips:
  - bier
  - märzen
  - radler
  - gösser
  - puntigamer
- Offer-Card-Placeholder für fehlende Bilder neu gestaltet:
  - `Offizielle Quelle`
  - `Angebot ohne Bild`
  - `Preis und Details stammen aus der Quelle.`
- keine externen Assets

### 9.5 Mobile Navigation

Commit:
- `7c71feab Refine mobile header navigation`

Änderungen:
- nur `admin/src/index.css`
- unter 520px läuft Topnav zweizeilig:
  - oben Logo/Beta
  - darunter `Suche`, `Stöbern`, `Liste`
- 390px/430px ohne horizontalen Overflow
- Desktop unverändert

---

## 10. Feedback-Mailpfad

Problem:
`/feedback` speicherte Feedback, aber Mail kam nicht an bzw. SMTP blockierte/hängte.

Fixes:
- `f8094900` Ensure beta feedback email diagnostics
- `199ee793` Always notify Andreas for beta feedback
- `f8855d7d` Expose feedback email delivery diagnostic
- `e231c7df` Bound beta feedback email delivery time

Aktueller App-Zustand:
- Feedback wird gespeichert
- `andreas.franz@ecily.com` ist Pflichtempfänger im Mailpfad
- API hängt nicht mehr wegen SMTP
- Mailversand ist hart zeitbegrenzt
- Fehler diagnostizierbar

SMTP/Provider:
- EDIS SMTP bleibt extern offen
- letzter relevanter Fehler:
  - `SMTP DATA body failed with 521`
- keine weitere Codearbeit jetzt
- ggf. später Provider/SMTP klären

---

## 11. SEO-Stand

Google Search Console:
- URL: `https://search.google.com/search-console?resource_id=https://www.kaufklug.at/`
- Property: `https://www.kaufklug.at/`

Aus Screenshot:
- 25 total web search clicks
- 7 indexed pages
- 5 not indexed pages

SEO Read-only Befund:
- kein P0-Indexierungsblocker
- aber zwei P1 technische Themen:
  1. `/` canonicalisierte falsch auf `/suche`
  2. unbekannte `/angebote/<slug>` Fallbacks waren indexierbar als Stöbern-Fallback

Fix:
- Commit: `4721ec8b Fix SEO canonical and offer fallback indexing`
- Dateien:
  - `admin/src/utils/seo.js`
  - `admin/public/sitemap.xml`

Ergebnis:
- `/` canonical: `https://www.kaufklug.at/`
- nicht konfigurierte `/angebote/<slug>`:
  - `noindex,follow`
  - canonical `/stoebern`
- `/angebote/spar` bleibt bewusst `noindex,follow`
- Sitemap: 16 URLs
- `/einkaufsliste` aus Sitemap entfernt
- robots.txt ok
- keine neuen SEO-Seiten
- keine Copy-Optimierung

Wichtige URL-Prüfung in GSC:
- `https://www.kaufklug.at/`
- `https://www.kaufklug.at/angebote/billa`
- `https://www.kaufklug.at/angebote/hofer`
- `https://www.kaufklug.at/angebote/lidl`
- `https://www.kaufklug.at/angebote/dm`
- `https://www.kaufklug.at/angebote/bipa`
- `https://www.kaufklug.at/angebote/penny`
- `https://www.kaufklug.at/angebote/spar`
- `https://www.kaufklug.at/angebote/billa-plus`

Sitemap in GSC:
- `https://www.kaufklug.at/sitemap.xml`

Nächster SEO-Schritt:
- keine Änderung ohne GSC-Daten
- Performance > Queries
- Performance > Pages
- Indexing > Pages
- Sitemaps

---

## 12. Aktuelle offene Punkte

### P0
Keiner bekannt.

### P1
Kein harter offener P1 bekannt nach heutigem Stand.

### P2
- offene/reviewing Feedbacks manuell triagieren:
  - sichtbar behobene HOFER-Fälle resolved prüfen
  - nicht public Fälle stale/ignored prüfen
  - PENNY alte Conditions stale/nicht belegbar prüfen
- EDIS SMTP 521 extern klären
- nächster scheduled Crawl beobachten
- BILLA historical partial sollte bei nächstem scheduled Crawl idealerweise nicht wiederkommen
- Search Console Daten auswerten

### P3
- Structured Data Dedupe später
- SEO-Copy-/Landingpage-Schärfung nur nach GSC-Evidence
- mögliche OCR-/Image-Text-Evidence-Pipeline später, nicht jetzt
- SPAR-Family strategisch offen, aber kein Productworld-Bypass
- PAGRO pausiert wegen Cloudflare/Challenge

---

## 13. Händler-/Source-Status

### BILLA / BILLA Plus
- BILLA stark
- BILLA HTTP 500 war temporär
- BILLA Plus stark
- kein aktueller Fix

### BIPA
- aktuell Qualitätsanker
- stark official
- kein aktueller Fix

### dm
- solide
- kein aktueller Fix

### HOFER
- Category-Fix gemacht
- scoped Recrawl gemacht
- aktuelle sichtbare Kategoriefehler behoben

### Lidl
- Monday-Angebote sichtbar
- Category-Fix gemacht
- quantity/basePrice nur wenn sicher; nicht raten
- kein weiterer Lidl-Block jetzt

### PENNY
- structured FROM/promotionQuantity funktioniert
- alte Feedbacks teilweise stale/nicht belegbar
- 1+1 nur im Bild nicht automatisch extrahieren
- kein weiterer PENNY-Fix ohne neue Evidence

### SPAR / EUROSPAR / INTERSPAR
- strategisch wichtig
- Productworld fachlich gut, aber Backend-Transport rot wegen Cloudflare/403
- kein Bypass
- FactFinder nicht als Angebot reaktivieren
- PDF bleibt Fallback
- nächster SPAR-Block nur read-only/konkret, wenn bewusst priorisiert

### PAGRO
- fachlich gute Struktur, aber Transport rot wegen Cloudflare/Challenge
- kein Crawler
- kein Bypass
- pausieren

---

## 14. Standard-Checks für Änderungen

Bei Codeänderungen:
- passende `node --check`
- passende Tests
- `npm run lint`
- `npm run build`
- `git diff --check`

Nach Deploy:
- Live-Smokes je nach Scope
- mindestens:
  - `/`
  - `/suche?q=bier`
  - `/suche?q=milch`
  - `/feedback`
- mobile 390px prüfen, falls Frontend
- Publish/Lock prüfen, falls Crawl/Source

---

## 15. Startanweisung für neue Codex-Chats

Jeder neue Codex-Chat muss zuerst diese Datei lesen:

`docs/codex-handoff-current-state.md`

Zusätzlich lesen:
`docs/source-quality-gates.md`

Danach kurz zusammenfassen:
- aktueller Systemstand
- offene P0/P1/P2
- welcher Scope für den aktuellen Auftrag gilt
- welche Bereiche ausdrücklich nicht berührt werden

Nicht ohne diese Einordnung starten.
