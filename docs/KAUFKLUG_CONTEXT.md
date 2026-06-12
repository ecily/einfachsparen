# kaufklug.at Kontext

## Dauerhaft relevante Befunde

- PENNY official-site Fix ist live und im scheduled Full Crawl `6a2b3df06d4045acec01934f` bestaetigt: `penny-official-site` lieferte raw/API 301, parsed 243, stored 243.
- PENNY KW24 PDF liegt lokal unter `C:\Users\Nutzer\Downloads\Digitales_Flugblatt_PP_KW24.pdf` und ist als harte Prospekt-Evidence nutzbar.
- PENNY Seiten 6/7: `Schopf od. Karree` ist ein bestaetigter PDF-vs-Web-Konflikt. PDF zeigt `6,99` pro kg, PENNY-Web/kaufklug zeigen `3,49` fuer `500 g Packung` mit `6,98/kg`.
- PENNY Seite 7: `Frische Forelle` ist im PDF vorhanden, aber ueber kaufklug Live-Suche aktuell nicht sicher auffindbar; Query `frische forelle` matcht faelschlich `Frische Goldbrasse`.
- PENNY Seite 19 enthaelt Tages-/Fensterpreise innerhalb eines Prospektzeitraums. Diese sind Trust-relevant und sollten bei weiteren PENNY-Checks separat gegen Web/kaufklug geprueft werden.
- Ein enger PDF-vs-Web-Conflict-Guard ist vorbereitet: Er markiert nur bei expliziter PDF-`pro kg`-Evidence plus passendem Web-Fixgewicht, aendert keine Preise und setzt Review-/Evidence-Flags.
- Die PENNY Evidence-Bruecke ist im Code vorbereitet: Der PENNY-Web/API-Pfad laedt offizielle Flyer-Evidence fail-open, verdichtet nur enge Guard-relevante PDF-Kandidaten zu `pdfEvidenceByProduct` und uebergibt sie an den Web-Normalizer. Live-Wirkung braucht nach Deploy einen freigegebenen regulaeren oder scoped PENNY-Crawl.
- Abschlussversuch am 2026-06-12: scoped PENNY-Crawl `6a2bc46b76e25482815c147d` fuer `penny-official-site` wurde `stale` nach Prozess-Restart und schrieb keine Summary/Offers. Konfliktfaelle waren danach live weiter unmarkiert; Punkt bleibt offen.
- Zweiter freigegebener Abschlussversuch am 2026-06-12: scoped PENNY-Crawl `6a2bcfe26c296f8770d66f25` fuer `penny-official-site` wurde erneut `stale`, blieb durchgehend in `source-started`, schrieb keine Summary/Source-Results/Publish und wurde durch stale-heartbeat recovery beendet. Vor einem weiteren Crawl ist eine enge Diagnose des PENNY official-site Source-Schritts bzw. Runtime-Restarts noetig.
- BILLA/BILLA Plus KW24 Fix am 2026-06-12: Action-HTML-Preisfenster werden fuer Europe/Vienna ausgewertet (`Dallmayr Prodomo`: Fr/Sa `8,99`, Mo-Mi `11,99`). Der BILLA-PDF-Parser hat einen engen Textlayer-Recovery-Pfad fuer dichte/verschobene Preis-Titel-Muster aus Hauptflugblatt und Grill-Beileger; lokaler PDF-Smoke findet u. a. `SanLucar Wassermelone`, `clever Hendl-Filet`, `Puntigamer Bier`, `clever Ofen-/Grill-Lachs` und `Bio-Hendl-Grillteller`.
- BILLA/BILLA Plus Deploy am 2026-06-12: Commits `7095be68` und `6a0f1e37` wurden nach `origin/main` gepusht und live deployed; `/api/health` BuildTime `2026-06-12T10:43:25.118Z`. Scoped Crawl `6a2be5888b3dee5208f5cc9f` fuer `billa-official-site-offers-page`, `billa-plus-official-site-offers-page`, `billa-official-flyer-flyer`, `billa-plus-official-flyer-flyer` endete `success` mit 2084 raw, 1976 parsed/stored, 108 rejected und Publish success.
- BILLA Live-Referenz nach scoped Crawl ist noch nicht abgeschlossen: `Dallmayr Prodomo` wird live weiter aus `billa-official-algolia` mit `11,99` angezeigt, obwohl die offizielle BILLA Action-HTML am Freitag/Samstag `8,99` enthaelt. `clever Hendl-Filet` ist korrekt aus `billa-official-flyer-pdf` sichtbar; `SanLucar Wassermelone`, `Puntigamer`, `clever Ofen-/Grill-Lachs` und `Bio-Hendl-Grillteller` waren ueber Live-Suche/API nicht als erwartete konkrete Referenzen sichtbar.
- BILLA/BILLA Plus Folgefix am 2026-06-12: Commits `d1afda96`, `569582ff` und `20542283` wurden nach `origin/main` gepusht und live deployed; `/api/health` BuildTime `2026-06-12T11:56:54.287Z`. Finaler scoped Crawl `6a2bf41d8d79e0447867a162` fuer die vier BILLA/BILLA-Plus Sources endete `success` mit 2139 raw, 1994 parsed/stored, 145 rejected, failed/partial 0.
- BILLA Root Causes: official flyer discovery erfasste nur Hauptflugblatt-PDFs; Grill-Beileger ist auf der aktuellen BILLA-Flugblattseite nicht als PDF-Link sichtbar. Action-HTML-Preisfenster wurden geparst, aber die berechnete Fr/Sa-Validity wurde durch leere Section-Validity ueberschrieben, wodurch `Dallmayr Prodomo` 8,99 vor dem Fix nicht active war. Catalog-/Response-Dedupe priorisiert nun BILLA Action-HTML/PDF vor Algolia, ohne Preise zu ueberschreiben.
- BILLA Live-Stand nach Finalcrawl: `SanLucar Wassermelone` 1,29/kg und `clever Hendl-Filet` 5,99/700 g sind sichtbar aus `billa-official-flyer-pdf`. `Dallmayr Prodomo` 8,99/500 g ist active aus `billa-official-action-html` mit `Preisfenster Freitag und Samstag`, steht aber in der API-Sortierung noch unter den Algolia-Varianten 11,99. `Puntigamer Bier` 0,69, `clever Ofen-/Grill-Lachs` 6,99 und `Bio-Hendl-Grillteller` fehlen live weiter, weil der Grill-Beileger nicht produktiv als offizieller PDF-Link entdeckt wird.

## Offene Risiken

- P1: PDF-vs-official-site Konflikte bei variabler Gewichtsware duerfen nicht ungeprueft als normale 500-g-Fixpreise wirken.
- P1: Such-/Matchqualitaet bei sehr aehnlichen Fisch-/Fleischprodukten pruefen, besonders Forelle vs. Goldbrasse.
- P2: Kategoriequalitaet bei PENNY-Lebensmitteln bleibt ein Feedback-Thema, z. B. Kinder Cards und Milch-/Topfenfaelle.
- P1: BILLA/BILLA Plus Fix braucht nach Deploy einen explizit freigegebenen scoped Crawl und Live-Referenzpruefung; kein Crawl direkt nach Deploy ohne stabile BuildTime.
- P1: BILLA Action-HTML Preisfenster-Evidence wird gespeichert/geparst, aber response-seitig kann `billa-official-algolia` weiterhin gegen aktuellere Action-HTML/PDF-Evidence gewinnen; enger Folgefix im BILLA-Source-Dedupe/Response-Prioritaet ist wahrscheinlich noetig, ohne globale Ranking-Aenderung.
- P1: BILLA Dallmayr 8,99 ist live vorhanden, aber nicht Top-Suchergebnis; ein enger BILLA-spezifischer Sortier-/Dedupe-Folgefix ist noetig, wenn die Nutzeransicht immer den aktiven Preisfensterpreis zuerst zeigen soll.
- P1: BILLA Grill-Beileger-Angebote fehlen live, solange kein offizieller produktiver URL/Discoverypfad fuer den Beileger eingebunden ist. Keine lokale PDF-Quelle als Live-Datenquelle verwenden.

## Naechste klare Aufgaben

- Read-only Matrix fuer PENNY Seite 19 Tages-/Fensterpreise gegen PENNY-Web/kaufklug vervollstaendigen.
- Naechste Restaufgabe: Ursache fuer wiederholt stale scoped PENNY-Crawls im Schritt `penny-official-site`/`source-started` eingrenzen, bevor erneut ein scoped PENNY-Crawl freigegeben wird.
- Nach BILLA/BILLA Plus Deploy: scoped Crawl nur fuer BILLA/BILLA-Plus Action-HTML/official-flyer Sources freigeben und danach Dallmayr, SanLucar, Hendl-Filet, Puntigamer sowie zwei Kontrollangebote live pruefen.
- Naechste BILLA-Restaufgabe: BILLA-spezifisch klaeren, ob active Action-HTML-Preisfensterangebote in Suchergebnissen vor Algolia-Varianten sortiert werden sollen; ausserdem official Grill-Beileger URL/Discovery read-only belegen, bevor er produktiv gecrawlt wird.
