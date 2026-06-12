# kaufklug.at Kontext

## Dauerhaft relevante Befunde

- PENNY official-site Fix ist live und im scheduled Full Crawl `6a2b3df06d4045acec01934f` bestaetigt: `penny-official-site` lieferte raw/API 301, parsed 243, stored 243.
- PENNY KW24 PDF liegt lokal unter `C:\Users\Nutzer\Downloads\Digitales_Flugblatt_PP_KW24.pdf` und ist als harte Prospekt-Evidence nutzbar.
- PENNY Seiten 6/7: `Schopf od. Karree` ist ein bestaetigter PDF-vs-Web-Konflikt. PDF zeigt `6,99` pro kg, PENNY-Web/kaufklug zeigen `3,49` fuer `500 g Packung` mit `6,98/kg`.
- PENNY Seite 7: `Frische Forelle` ist im PDF vorhanden, aber ueber kaufklug Live-Suche aktuell nicht sicher auffindbar; Query `frische forelle` matcht faelschlich `Frische Goldbrasse`.
- PENNY Seite 19 enthaelt Tages-/Fensterpreise innerhalb eines Prospektzeitraums. Diese sind Trust-relevant und sollten bei weiteren PENNY-Checks separat gegen Web/kaufklug geprueft werden.
- Ein enger PDF-vs-Web-Conflict-Guard ist vorbereitet: Er markiert nur bei expliziter PDF-`pro kg`-Evidence plus passendem Web-Fixgewicht, aendert keine Preise und setzt Review-/Evidence-Flags. Live-Wirkung setzt voraus, dass PDF-Evidence dem PENNY-Web-Normalizer belastbar zugefuehrt wird.

## Offene Risiken

- P1: PDF-vs-official-site Konflikte bei variabler Gewichtsware duerfen nicht ungeprueft als normale 500-g-Fixpreise wirken.
- P1: Such-/Matchqualitaet bei sehr aehnlichen Fisch-/Fleischprodukten pruefen, besonders Forelle vs. Goldbrasse.
- P2: Kategoriequalitaet bei PENNY-Lebensmitteln bleibt ein Feedback-Thema, z. B. Kinder Cards und Milch-/Topfenfaelle.

## Naechste klare Aufgaben

- Read-only Matrix fuer PENNY Seite 19 Tages-/Fensterpreise gegen PENNY-Web/kaufklug vervollstaendigen.
- Falls ein Live-Effekt fuer PDF-vs-Web-Konflikte gewuenscht ist: PDF-Seiten-Evidence eng an PENNY-Webprodukte matchen und als `pdfEvidenceByProduct` in die Normalisierung geben.
