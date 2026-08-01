# Quellenoffenheits-Audit oesterreichischer Haendler – 2026-08-01

## A. Ampel

**GELB.** Die offizielle Browser-Recherche hat mehrere sehr gute, maschinenlesbar wirkende Quellen ergeben. Es wurde aber kein Kandidat aus der produktionsnahen DO/Linux-Umgebung abgerufen. Daher gibt es heute bewusst keine gruene Integrationsfreigabe, keine Fixture und keine Parserarbeit.

- Gruen: 0 produktionsnah bestaetigte neue Quellen
- Gelb: 18 offizielle Angebotsseiten mit im Browser konkret sichtbaren Angebotsdaten; davon 8 vertieft bewertet
- Rot: Action und MediaMarkt als bekannte direkte Transport-No-Gos
- Ausser Scope: NORMA aufgrund Produktentscheidung, ohne neue technische Pruefung

## B. Strategie

Die naechste Haendlererweiterung soll nicht mehr mit einem Parserversuch beginnen, sondern mit einer Quellenoffenheits-Pipeline:

1. Offizielle oesterreichische Angebotsliste oder offizielles PDF finden.
2. Browser-Evidence nur als Discovery werten.
3. Robots und dieselbe URL unverdeckt aus DO/Linux abrufen.
4. Nur bei HTTP 200 plus echtem Raw-Angebotsinhalt einen tiefen Source-Audit beginnen.
5. Erst danach Fixture, Parser, SourceDefinition und Taxonomie planen.

HTML-Listen mit Produktname, Preis, Referenzpreis, Menge/Modell, Gültigkeit und Bedingungen haben Vorrang. Text-PDFs sind zweite Wahl. Reine Kampagnen-, Gutschein-, Login-, App- oder Flipbook-Quellen bleiben Reserve oder No-Go.

## C. Rechercheumfang

- 34 Haendler aus Lebensmittel, Grosshandel, Non-Food-Discount, Elektronik, Baumarkt/Garten, Moebel, Tierbedarf, Sport, Beauty, Buch/Spielwaren, Schuhe und Autozubehoer in die Longlist aufgenommen.
- 18 offizielle oesterreichische Angebotsseiten lieferten im Browser konkrete Produkte, Preise oder Aktionsbedingungen.
- 8 Quellen wurden anhand aktueller Beispiele, Feldern, Risiken und Modellkompatibilitaet vertieft.
- 0 neue URLs wurden aus DO/Linux getestet; 0 neue produktionsnahe HTTP-200-Befunde.
- Lokaler Windows-HTTP-Versuch blieb wegen `CRYPT_E_NO_REVOCATION_CHECK` unverwertbar. Es wurden keine TLS-, Cookie- oder Challenge-Umgehungen eingesetzt.
- Action, MediaMarkt und NORMA wurden nicht erneut aufgerufen.

## D. Longlist

`Browser-offen` bezeichnet nur Discovery-Evidence, nicht Produktionsfreigabe. `DO offen` bedeutet: noch nicht aus der bestaetigten Produktionsumgebung getestet.

| Haendler | Segment | Oesterreich-Relevanz | offizielle Source | Source-Typ | Preis | Gueltigkeit | Menge/Modell | Transportstatus | Trust | Aufwand | Urteil |
|---|---|---:|---|---|---|---|---|---|---|---|---|
| MPREIS | Lebensmittel | hoch regional | [Aktionsliste](https://www.mpreis.at/aktionen/aktuell/alle-produkte-in-aktion) | HTML-Liste | ja | indirekt/Flugblatt | ja | Browser-offen, DO offen | hoch | mittel | Preflight Top 1 |
| Sutterluety | Lebensmittel | regional Vorarlberg | [Sortiment/Flugblatt](https://www.sutterluety.at/sortiment/) | HTML plus Flugblatt | im Flugblatt | im Flugblatt | wahrscheinlich | Browser-Source sichtbar, DO offen | hoch | mittel-hoch | PDF-Reserve |
| Nah&Frisch | Lebensmittel | hoch/regional | [offizielles Beispiel-PDF](https://webbuero.nahundfrisch.at/storage/2126/NuF_KW_21_26_Flugblatt_Nord-web.pdf) | Text-PDF, Regionalvarianten | ja | ja | ja | offizielles PDF sichtbar, Aktualitaetsfinder offen | hoch | hoch | PDF-Reserve |
| denn's Biomarkt | Bio-Lebensmittel | mittel | offizielle AT-Angebotssuche ohne belastbaren Treffer | unklar | offen | offen | offen | nicht vertieft | mittel | hoch | spaeter pruefen |
| METRO | B2B Lebensmittel/Non-Food | mittel | [Angebote](https://www.metro.at/) | HTML plus Flipbook/PDF | ja | ja | ja | Browser-offen, DO offen | hoch | hoch | B2B-Reserve |
| TEDi | Non-Food-Discount | hoch | [Startseite/Prospektprodukte](https://www.tedi.com/at/) | HTML-Produkte plus Prospekt | ja | teilweise | ja | Browser-offen, DO offen | hoch | mittel | Queue 2 |
| Pepco | Non-Food-Discount | hoch | offizielle AT-Angebotssuche ohne belastbaren Treffer | unklar/Prospekt | offen | offen | offen | nicht vertieft | mittel | hoch | spaeter pruefen |
| NKD | Textil/Haushalt | hoch | [Blaetterkatalog](https://www.nkd.com/de_at/blaetterkatalog-at) | HTML-Katalog plus Produktlisten | ja | teils | ja | Browser-offen, DO offen | hoch | mittel | Queue 2 |
| KiK | Textil/Non-Food | hoch | offizielle AT-Angebotssuche ohne belastbaren Treffer | unklar/Prospekt | offen | offen | offen | nicht vertieft | mittel | hoch | spaeter pruefen |
| Tchibo/Eduscho | Haushalt/Kaffee | hoch | offizielle AT-Angebote nicht vertieft | HTML-Shop | wahrscheinlich | teils | ja | nicht vertieft | mittel | mittel-hoch | spaeter pruefen |
| Hartlauer | Elektronik/Optik | hoch | [aktuelle Angebote](https://www.hartlauer.at/aktuelle-angebote.html) | HTML-Kampagnen plus Flugblatt | teils | ja | Modell ja | Browser-offen, DO offen | hoch | mittel-hoch | Queue 2 |
| electronic4you | Elektronik | hoch | [Sonderangebote](https://www.electronic4you.at/home) | HTML-Produkte | ja | selten | Modell/Art.-Nr. ja | Browser-offen, DO offen | hoch | mittel | Snapshot-Reserve |
| BAUHAUS | Baumarkt | hoch | [Werbebeilagen](https://www.bauhaus.at/angebote/werbebeilagen) | offizielles Flugblatt | im Prospekt | im Prospekt | ja | Browser-Source sichtbar, DO offen | hoch | hoch | PDF-Reserve |
| Hornbach | Baumarkt | hoch | offizielle AT-Angebote nicht vertieft | HTML-Shop/Kampagne | wahrscheinlich | teils | ja | nicht vertieft | mittel | hoch | spaeter pruefen |
| ZGONC | Werkzeug/Garten | hoch | [Aktionsseite](https://www.zgonc.at/at) | HTML-Produkte plus Text-PDF | ja | ja | Modell/Art.-Nr. ja | Browser-offen, DO offen | hoch | mittel | Preflight Top 3 |
| OBI | Baumarkt/Garten | hoch | [Angebote](https://www.obi.at/angebote) | HTML-Produkte plus Prospekt | ja | Kampagne/Monat | Modell/Menge ja | Browser-offen, DO offen | hoch | mittel-hoch | Queue 2 |
| Moebelix | Moebel/Haushalt | hoch | [Prospektangebote](https://www.moebelix.at/c/prospekte) | HTML-Produkte plus Prospekt | ja | Prospekt ja | Modell/Masse ja | Browser-offen, DO offen | hoch | mittel | Queue 2 |
| JYSK | Moebel/Haushalt | hoch | [Angebote](https://jysk.at/angebote) | HTML-Produkte | ja | oft kein validTo | Modell/Masse ja | fruehere Browser-Evidence, DO offen | hoch | mittel | Snapshot-Reserve |
| IKEA | Moebel/Haushalt | hoch | [befristete Angebote](https://www.ikea.com/at/de/offers/limited-time-offers/) | HTML-Produkte | ja | ja/solange Vorrat | Modell/Masse ja | Browser-offen, DO offen | hoch | mittel | Queue 2 |
| Moemax | Moebel/Haushalt | hoch | offizielle AT-Aktionen nicht vertieft | HTML/Prospekt | wahrscheinlich | wahrscheinlich | ja | nicht vertieft | mittel | mittel-hoch | spaeter pruefen |
| XXXLutz | Moebel/Haushalt | hoch | offizielle AT-Aktionen nicht vertieft | HTML/Prospekt | wahrscheinlich | wahrscheinlich | ja | nicht vertieft | mittel | mittel-hoch | spaeter pruefen |
| Fressnapf | Tierbedarf | hoch | [Aktionen](https://www.fressnapf.at/aktionen-angebote/) | Kampagnen-HTML | teilweise | teilweise | teilweise | Browser-offen, DO offen | hoch | hoch | Kampagnen-Reserve |
| Megazoo | Tierbedarf | mittel | offizielle AT-Angebote ohne belastbaren Treffer | unklar | offen | offen | offen | nicht vertieft | mittel | hoch | spaeter pruefen |
| Hervis | Sport | hoch | [Sale-Liste](https://www.hervis.at/shop/Sale/Sale/c/1_outlet_abverkauf?currentPage=0) | HTML-Produkte | ja | ja | Modell ja | Browser-offen, DO offen | hoch | mittel | Queue 2 |
| Intersport | Sport | hoch | offizielle AT-Angebote nicht vertieft | regionaler HTML-Shop | wahrscheinlich | teils | ja | nicht vertieft | mittel | hoch | spaeter pruefen |
| Douglas | Beauty | hoch | [Beauty Sale](https://www.douglas.at/de/c/sale/05) | HTML-Produkte | ja | selten | Menge ja | Browser-offen, DO offen | hoch | mittel | Snapshot-Reserve |
| Marionnaud | Beauty | hoch | offizielle AT-Angebote ohne belastbaren Treffer | unklar | offen | offen | offen | nicht vertieft | mittel | hoch | spaeter pruefen |
| Thalia | Buch/Spielwaren | hoch | [Sale](https://www.thalia.at/themenwelten/schnaeppchen) | HTML-Produkte | ja | Kampagnenebene | Modell teils | Browser-offen, DO offen | hoch | mittel | Non-Book-Reserve |
| LIBRO | Schule/Buero/Spielwaren | hoch | offizielle Angebote ohne belastbaren Treffer | unklar | offen | offen | offen | nicht vertieft | mittel | hoch | spaeter pruefen |
| Forstinger | Autozubehoer/Werkstatt | hoch | [aktuelle Aktionen](https://www.forstinger.com/Angebote/Aktuelle-Aktionen/) | HTML-Produkte und Services | ja | ja | Menge/Modell ja | Browser-offen, DO offen | hoch | mittel | Preflight Top 2 |
| ATU | Autozubehoer/Werkstatt | hoch | offizielle AT-Angebote ohne belastbaren Treffer | unklar | offen | offen | offen | nicht vertieft | mittel | hoch | spaeter pruefen |
| Deichmann | Schuhe | hoch | [Sale](https://www.deichmann.com/de-at/c/sale--477) | HTML-Produkte | ja plus 30-Tage-Preis | Kampagne teils | Modell ja | Browser-offen, DO offen | hoch | mittel | Queue 2 |
| Humanic | Schuhe | hoch | [Sale](https://www.humanic.net/at/sale) | HTML-Produkte | ja | selten | Modell ja | Browser-offen, DO offen | hoch | mittel | Snapshot-Reserve |
| Smyths Toys | Spielwaren | hoch | [Angebote](https://www.smythstoys.com/at/de-at/angebote/c/angebote-bei-smythstoys) | HTML-Produkte | ja | selten | Modell ja | Browser-offen, DO offen | hoch | mittel | Snapshot-Reserve |

## E. Quellenoffene Kandidaten

### 1. MPREIS

- URL: [Alle Produkte in Aktion](https://www.mpreis.at/aktionen/aktuell/alle-produkte-in-aktion)
- Source-Typ: paginierte/filterbare offizielle HTML-Angebotsliste.
- DO/Linux: nicht getestet.
- Browser-extrahierter Inhalt: aktuell viele konkrete Angebotsprodukte statt einer reinen Kampagnenhuelle.
- Beispiele am 2026-08-01: Coca-Cola Dose 0,33 l bei 24 Stueck je 0,69 Euro, 12+12 gratis; Schärdinger Gouda 150 g bei 4 Stueck je 1,39 Euro, 2+2 gratis; Galbani Mozzarella 200 g bei 2 Stueck je 1,74 Euro, 1+1 gratis.
- Felder: Produkt/Marke, Inhalt, Preis, Stattpreis, Mindestmenge, Vergleichspreis, Rabattmechanik, Pfand, App-Bedingung, Verfuegbarkeitskontext.
- Risiken: praktisch alle sichtbaren Produkte tragen `NUR MIT APP`; Markt- und Aktionsgueltigkeit muessen separat und fail-closed belegt werden; Tirol-/West-Oesterreich-Fokus statt Graz.
- Kompatibilitaet: sehr hoch fuer bestehende Preis-, Mengen-, Rabatt-, Kundenprogramm- und Normalisierungsfelder.

### 2. Forstinger

- URL: [Aktuelle Aktionen](https://www.forstinger.com/Angebote/Aktuelle-Aktionen/)
- Source-Typ: offizielle HTML-Aktionsliste mit Produktkarten und Serviceangeboten.
- DO/Linux: nicht getestet.
- Browser-extrahierter Inhalt: Produkte, Tagesangebote, Monatsangebote und Werkstattservices in einer Seite.
- Beispiele am 2026-08-01: Armor All Insektenentferner 0,5 l um 10,00 statt 15,49 Euro; Econelo Yogi-IQ um 1.999 statt 2.599 Euro; 2+2 gratis auf Brunox epoxy 400 ml fuer 3./4. August.
- Felder: Produkt, Inhalt, Einheitenpreis, Aktions-/Stattpreis, Modell, `validFrom`, `validTo`, Bundlemechanik, Kombinierbarkeit.
- Risiken: Produktkarten, Tagesaktionen und Werkstattservices muessen strikt getrennt werden; manche Angebote sind nur Filiale, Vorteilskarte oder Service; künftiger Scope muss Autozubehoer erlauben.
- Kompatibilitaet: hoch; bestehendes Modell traegt Preise, Menge, Bedingungen und Gueltigkeit, Taxonomie waere zu erweitern.

### 3. ZGONC

- URL: [Start-/Aktionsseite](https://www.zgonc.at/at), offizielles [Beispiel-PDF](https://www.zgonc.at/Publications/Flugbl%C3%A4tter/4482293/13_FB_Juli_I_2026_Web.pdf)
- Source-Typ: HTML-Produktkarten plus gut text-extrahierbares offizielles PDF.
- DO/Linux: nicht getestet.
- Browser-extrahierter Inhalt: aktuelle August-Aktionen mit Enddatum und Produktkarten; PDF mit Artikelnummern, Preisen, technischen Daten und Aktionsende.
- Beispiele: Zauberschlauch 30 m um 19,99 Euro; Benzin-Rasenmaeher MD532 um 249 Euro; Abwasser-Tauchpumpe GC-DP 7835 um 39,99 Euro.
- Felder: Marke, Produkt, Modell, Artikelnummer, Preis/Stattpreis, technische Menge/Masse, `validTo`, Set-/Gratislogik, Kundenprogramm.
- Risiken: Startseite und PDF koennen unterschiedliche Perioden zeigen; jö-/Businesskarten-Zusatzrabatt nicht in allgemeinen Preis einrechnen; PDF-Layout braucht Seiten-/Box-Evidence.
- Kompatibilitaet: hoch fuer Non-Food; HTML zuerst, PDF als Beleg/Ergaenzung.

### 4. OBI

- URL: [Angebote](https://www.obi.at/angebote)
- Source-Typ: offizielle HTML-Angebotsliste plus digitales Flugblatt.
- DO/Linux: nicht getestet.
- Browser-extrahierter Inhalt: Monatsdeals und Summer-Sale-Produkte mit Preisen, UVP, Mengen und Online-/Marktverfuegbarkeit.
- Beispiele: Gardena Wand-Schlauchbox 35 m um 169,99 statt UVP 227,99 Euro; Bestway Whirlpool um 289,99 statt UVP 449,95 Euro; Terrassenplatte mit Preis pro m2 und Paket.
- Felder: Produkt, Modell, Preis, UVP, Rabatt, Menge/Mass, Vergleichseinheit, Online-/Marktverfuegbarkeit, Kampagnenkontext.
- Risiken: Markt muss gewaehlt werden; UVP ist nicht immer eigener vorheriger Preis; heyOBI-, Projektbonus- und Markenaktionen strikt abgrenzen; regionale Verfuegbarkeit.
- Kompatibilitaet: hoch, aber Scope- und Referenzpreis-Guards sind zwingend.

### 5. IKEA

- URL: [Befristete Angebote](https://www.ikea.com/at/de/offers/limited-time-offers/)
- Source-Typ: offizielle HTML-Produktliste.
- DO/Linux: nicht getestet.
- Browser-extrahierter Inhalt: 12 konkrete Abverkaufsprodukte mit altem/neuem Preis, Ersparnis, Startdatum und Vorratsklausel.
- Beispiele: PLATSA Korpus 80x55x180 cm von 83 auf 49,80 Euro; SANNIDAL Tuer 40x120 cm von 22 auf 13,20 Euro; GROeNAMARANT Kissen von 19,99 auf 14,99 Euro.
- Felder: Produktfamilie, Variante/Masse, alter Preis, Angebotspreis, Rabattbetrag/-prozent, `validFrom`, Vorratsbedingung, Mitgliedschaft bei separaten Family-Angeboten.
- Risiken: `solange Vorrat reicht` ohne festes Enddatum; Family-, Business-, App- und lokale Angebote nicht vermischen; Variantenpreise.
- Kompatibilitaet: hoch als kurzer Snapshot mit konservativem Freshness-TTL.

### 6. Moebelix

- URL: [Prospektangebote](https://www.moebelix.at/c/prospekte)
- Source-Typ: offizielle HTML-Produktliste unter Prospektperioden.
- DO/Linux: nicht getestet.
- Browser-extrahierter Inhalt: Produkte samt Prospekt-Enddatum, UVP/Aktionspreis, Marke und Massen.
- Beispiele: Polsterbett Noe 180x200 cm um 777 statt UVP 1.126 Euro; Schreibtisch Kubek 110x75x50 cm um 55 statt UVP 135 Euro; Tafelservice Malina um 49,99 Euro.
- Felder: Produkt, Marke, Masse/Variante, Preis, UVP, Aktionslabel, Prospekt-`validTo`.
- Risiken: ein Seitenbereich kann mehrere Prospekte mit verschiedenen Enddaten enthalten; Gueltigkeit muss jedem Produkt beweisbar zugeordnet sein; UVP-Kennzeichnung erhalten.
- Kompatibilitaet: hoch, wenn die Prospekt-Produkt-Zuordnung eindeutig bleibt.

### 7. Hervis

- URL: [Sale-Liste](https://www.hervis.at/shop/Sale/Sale/c/1_outlet_abverkauf?currentPage=0)
- Source-Typ: paginierte offizielle HTML-Produktliste.
- DO/Linux: nicht getestet.
- Browser-extrahierter Inhalt: rund 2.457 Sale-Produkte mit aktuellem Preis, UVP, Rabatt und kampagnenweitem Enddatum 15.08.2026.
- Beispiele: Head Tennisball 2,99 statt UVP 5,99 Euro; Asics GEL-PULSE 17 um 64,99 statt 109,99 Euro; Garmin Forerunner 265 um 334,99 statt 419,99 Euro.
- Felder: Produkt/Modell, Kategorie, aktueller Preis, UVP, Rabattprozent, Gueltigkeit, Filial-/Online-Scope.
- Risiken: Varianten und Groessen; UVP statt vorheriger Verkaufspreis; Kampagnen-`validTo` muss sicher allen gelisteten Produkten gelten.
- Kompatibilitaet: gut fuer Non-Food, Taxonomieerweiterung erforderlich.

### 8. NKD

- URL: [Blaetterkatalog AT](https://www.nkd.com/de_at/blaetterkatalog-at)
- Source-Typ: Prospektnavigation plus crawlbare HTML-Produktlisten.
- DO/Linux: nicht getestet.
- Browser-extrahierter Inhalt: aktueller und kommender Prospekt, Produktkarten, Preise und Sale-Aktionsbedingungen.
- Beispiele: Damenkleid 29,99 Euro; Herren-T-Shirt 17,99 Euro; Sale-Produktkarten mit altem und reduziertem Preis.
- Felder: Produkt, Groesse, Preis/Referenzpreis, Rabatt, Prospektstart, Online-/Filialkontext.
- Risiken: Prospektseite mischt redaktionelle Kacheln, Online-Sale und Filialangebote; personalisierte App-Aktionen ausschliessen.
- Kompatibilitaet: mittel bis hoch, wenn Prospektzuordnung und Gueltigkeit belastbar sind.

## F. Gute PDF-Kandidaten

1. **ZGONC:** offizielles textreiches PDF mit Artikelnummer, Modell, Preis, Stattpreis, technischen Angaben und Enddatum. Staerkster PDF-Kandidat, aber HTML hat Vorrang.
2. **Nah&Frisch:** offizielle regionale PDFs mit Produktpreisen und exaktem Wochenzeitraum. Risiko sind Betreiber-/Regionalvarianten und die robuste Erkennung des jeweils aktuellen Dokuments.
3. **BAUHAUS:** offizielle monatliche Werbebeilagen. Vor Vertiefung muessen direkte PDF-URL, Textlayer und aktuelle Oesterreich-Gueltigkeit aus DO bestaetigt werden.
4. **Hartlauer:** offizielle Flugblattsektion plus kampagnenspezifische Datumsangaben. Produktzuordnung und direkter PDF-Transport sind offen.
5. **Sutterluety:** offizieller Flugblatteinstieg; regionale Relevanz ausserhalb Steiermark und aktueller direkter Dokumentpfad sind noch offen.

PDFs ohne brauchbaren Textlayer werden nicht per OCR-Schnellloesung aufgenommen.

## G. No-Go-Kandidaten

- **Action:** bereits produktionsnah auf DO/Linux belegt: `robots.txt` HTTP 200, Angebotsseite HTTP 403 mit `cf-mitigated: challenge`. Direkte Integration ausgeschlossen; keine Wiederholungspruefung.
- **MediaMarkt:** laut bestaetigtem Vorbefund auf DO/Linux Cloudflare-`Just a moment`-Challenge. Direkte Integration ausgeschlossen; keine Wiederholungspruefung.
- **NORMA:** kein technisches Urteil, sondern verbindliche Produktentscheidung. Vollstaendig aus Checks, Transport, Parser, Source, Fixture und Reserve entfernt.
- **Reine Login-/App-/personalisierte Quellen, private APIs, private GraphQL-Endpunkte und Aggregatoren:** grundsaetzlich keine produktive Source.

## H. Dauerhafte Integrationsqueue

### Kategorie 1 – sofort vertiefbar

Leer. Ohne DO/Linux-HTTP-200 samt echtem Raw-Angebotsinhalt wird kein Kandidat freigegeben.

### Kategorie 2 – Browser-source-offen, DO-Preflight ausstehend

1. MPREIS
2. Forstinger
3. ZGONC
4. OBI
5. Moebelix
6. IKEA
7. Hervis
8. NKD
9. Deichmann
10. TEDi

### Kategorie 3 – PDF-, Snapshot- oder Scope-Reserve

- Nah&Frisch, BAUHAUS, Hartlauer, Sutterluety
- JYSK, electronic4you, Douglas, Humanic, Smyths Toys
- METRO nur als B2B-Sonderfall
- Fressnapf und Thalia nur nach Trennung allgemeiner Produktangebote von Gutscheinen, Buchpreisbindung bzw. Kampagnen

### Kategorie 4 – nicht weiter verfolgen

- Action und MediaMarkt: direkte technische No-Gos
- NORMA: Produktentscheidung
- Quellen, die nur Login, App, Personalisierung, private Endpunkte oder Aggregatorinhalt bieten

## I. Top 3

1. **MPREIS:** hoechster fachlicher Fit zum Kernprodukt; sehr reiches Angebots-HTML mit Mengen, Vergleichspreisen und komplexen Rabattmechaniken.
2. **Forstinger:** ausserordentlich klare HTML-Evidence fuer Preis, Menge, Gueltigkeit und Rabattmechanik; gute Probe fuer eine kontrollierte Non-Food-Erweiterung.
3. **ZGONC:** redundante offizielle Evidence aus HTML und Text-PDF, klare Modelle/Artikelnummern und Enddaten.

Diese Reihenfolge ist eine Preflight-Reihenfolge, keine Integrationsfreigabe.

## J. Naechster technischer Auftrag

Nur die Top 3 aus der bestaetigten DO/Linux-Konsole unverdeckt und read-only pruefen. Kein Browser-User-Agent, kein Cookie, kein Retry-Trick, kein TLS-Override.

```bash
for u in \
  https://www.mpreis.at/robots.txt \
  https://www.forstinger.com/robots.txt \
  https://www.zgonc.at/robots.txt
do
  curl -sS -L --max-time 30 -o /dev/null \
    -w "$u HTTP=%{http_code} TYPE=%{content_type} BYTES=%{size_download}\n" "$u"
done
```

```bash
urls=(
  'https://www.mpreis.at/aktionen/aktuell/alle-produkte-in-aktion'
  'https://www.forstinger.com/Angebote/Aktuelle-Aktionen/'
  'https://www.zgonc.at/at'
)
patterns=(
  'Aktueller Preis|gratis|[0-9]+,[0-9]{2}.*€/kg'
  'AKTUELLE AKTIONEN|Gültig von|statt|Inhalt:'
  'TOP AKTIONEN|Angebote gültig bis|Aktion'
)
for i in 0 1 2; do
  body="$(curl -sS -L --max-time 45 "${urls[$i]}")" || continue
  printf '%s BYTES=%s\n' "${urls[$i]}" "${#body}"
  printf '%s' "$body" | grep -Eio "${patterns[$i]}" | head -n 12
done
```

Entscheidung danach:

- HTTP 200 + echte Produkt-/Preis-Matches + Robots ohne relevanten Ausschluss: genau einen Kandidaten tief auditieren.
- Challenge/403/Blockseite: Kandidat in Kategorie 4, ohne Umgehungsversuch.
- HTTP 200, aber nur App-Shell/Consent/leer: Kategorie 3 und keine Parserarbeit.

## K. Geaenderte Dateien

- `docs/source-open-retailer-audit-2026-08-01.md` – dieser vollstaendige Audit.
- `docs/KAUFKLUG_CONTEXT.md` – dauerhafte Strategie, Queue und Ausschluesse aktualisiert.

Keine SourceDefinition, Fixture, Parser, Crawl-, DB-, Deploy-, API-, Admin- oder Top-Deals-Datei wurde geaendert.

## L. Tests und Checks

- Offizielle Websuche ueber 34 Haendler/Segmente.
- Aktuelle Browser-Evidence auf 18 offiziellen Angebotsseiten.
- Direkte Detailbewertung von 8 Kandidaten.
- Lokaler HTTP-Check ohne Umgehung versucht; wegen Windows-Zertifikats-Sperrpruefung als nicht belastbar verworfen.
- Git-Diff und Scope werden vor Abschluss erneut geprueft.
- Nicht ausgefuehrt: produktionsnaher DO/Linux-Preflight, Parser-/Fixture-/Crawl-/DB-Tests, da nicht autorisiert bzw. nicht Teil dieses Auftrags.

## M. Dokumentation

Dieser Audit ist die Detailquelle. `docs/KAUFKLUG_CONTEXT.md` enthaelt nur den belastbaren Langzeitstand und verweist auf diesen Bericht.

## N. Git

Ein eigener Dokumentations-Commit ist vorgesehen. Push bleibt ausgeschlossen. Der bestehende lokale, noch nicht gepushte Commit `ca1aad34` wird nicht veraendert.

## O. Risiken

- **P0:** Browser-Offenheit wird faelschlich als DO/Linux-Freigabe interpretiert. Gegenmassnahme: Kategorie 1 bleibt leer bis zum dokumentierten Preflight.
- **P0:** App-/Kundenkartenpreise werden als allgemein gueltig publiziert. Besonders MPREIS erfordert einen expliziten Kundenprogramm-Guard.
- **P1:** Kampagnen- oder Prospektgueltigkeit wird Produkten falsch zugeordnet. Produktbezogene Evidence oder fail-closed ist Pflicht.
- **P1:** UVP, 30-Tage-Bestpreis und eigener vorheriger Verkaufspreis werden vermischt. Referenzpreistyp muss erhalten bleiben.
- **P1:** Regionale Marktpreise/Verfuegbarkeit werden auf ganz Oesterreich ausgedehnt. Markt-/Regionsscope muss explizit sein.
- **P1:** Non-Food-Taxonomie wird zu breit und verschlechtert den Phase-1-Fokus. Je Kandidat nur kontrollierte Kategorien freigeben.
- **P2:** `solange Vorrat reicht` ohne Enddatum erzeugt stale Offers. Kurzer Snapshot-TTL und taegliche Revalidierung.
- **P2:** PDF-Layoutaenderungen brechen Extraktion. HTML bevorzugen; PDF nur mit Textlayer, Positions-Evidence und Fixture-Regression.
