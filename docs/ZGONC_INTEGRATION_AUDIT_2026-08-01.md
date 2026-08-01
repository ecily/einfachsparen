# ZGONC Österreich – Integrationsaudit 2026-08-01

## A. Ampel

**Gelb-Grün.** ZGONC ist fachlich und strategisch der stärkste bisher geprüfte Non-Food-Kandidat. Offizielle Browser-Evidence zeigt aktuelle Aktionskarten, Kampagnengültigkeit, Preise, Marken, Modelle, ZGONC-Artikelnummern, EANs, technische Daten, Setbestandteile, Lieferumfang, Bilder sowie österreichweite Online-/Filialhinweise. Es fehlt aber der verbindliche DO/Linux-Nachweis für Robots, HTTP 200, echten Raw-Content und das aktuelle PDF. Zusätzlich widersprechen sich beim Zauberschlauch 30 m die aktuelle Startseite (19,99 Euro) und die am selben Audit-Tag gelesene Produktseite (24,99 Euro). Vor Stufe 1 ist daher ein enger Transport- und Source-Truth-Preflight zwingend.

## B. Kurzfazit

1. ZGONC kann der erste glaubwürdige Schritt von kaufklug zu einer segmentübergreifenden österreichischen Angebotsplattform sein.
2. Die offizielle Startseite liefert serverseitig lesbare aktuelle Aktionskarten und eine Kampagnengültigkeit bis 29.08.2026.
3. Offizielle Produktseiten liefern starke Identitätsdaten: Artikelnummer, Modell, EAN, technische Spezifikationen, Setinhalt und Lieferumfang.
4. Produktdetailseiten sind für belastbare Identität und technische Daten derzeit nötig; die Listenansicht allein genügt nicht.
5. Ein historisches offizielles Juli-2026-PDF besitzt einen Textlayer; das aktuelle August-PDF wurde nicht als direkte URL bewiesen.
6. Robots, Sitemap, strukturierte Rohdaten und DO/Linux-Transport sind unbekannt, nicht positiv freigegeben.
7. Der Preiswiderspruch beim Zauberschlauch verlangt eine fail-closed HTML-/PDF-Widerspruchsregel.
8. Das Offer-Modell deckt Angebots-, Preis-, Validity-, Source- und Review-Daten gut ab, nicht aber technische Produktidentität und Sets als erstklassige Felder.
9. Empfohlen wird eine minimale globale Product-Identity-Erweiterung plus optionales Non-Food-Subschema, noch keine separate Product-Collection.
10. Bestehende Lebensmittel-Taxonomie, Suche und Vergleichslogik dürfen nicht global gelockert werden.
11. Public Search, Händlerfilter, Vergleiche, Top Deals, SEO-Seiten und Marketing bleiben bis zu separaten Gates aus.
12. Der exakt nächste Schritt ist Stufe 0: wenige unverdeckte Requests aus der bestätigten DO-Konsole und Sicherung erlaubter Raw-Artefakte.

## C. Offizielle Quellen

| Quelle | Typ / Aktualität | Inhalt und Scope | Bewertung / Risiko |
|---|---|---|---|
| `https://www.zgonc.at/at` | Offizielles HTML; am 01.08.2026 aktuell | Kategorien, August-Top-Aktionen, Preise, Produktlinks, Bilder; Aktionen laut Seite in allen Filialen und online bis 29.08.2026 | Beste Discovery- und Campaign-Quelle; Browser-SSR sichtbar, Raw-HTML/Struktur noch nicht aus DO bewiesen |
| `https://www.zgonc.at/at/aktuelle_aktionen` | Offizielles HTML | Aktions-/Flugblatt-Einstieg und redaktioneller Kampagnenkontext | Nicht als alleinige Produktquelle geeignet; Produktcoverage scheint auf der Startseite stärker |
| Produktseiten unter `/at/pd/...` | Offizielles HTML; Snapshot aktuell | Artikelnummer, Titel, Marke, Modell, Preis, Online-/Filialverfügbarkeit, technische Tabelle, EAN, Lieferumfang, Sets, Dokumentlinks | Für Identität nötig; nur abrufen, wenn Robots es erlaubt; Varianten-/Set-Join strikt halten |
| Kategorie- und Suchseiten unter `/at/..._sc_...` und `/at/suche` | Offizielles HTML | Händlerhierarchie, Produktlisten und Preise | Discovery-/Taxonomie-Evidence; keine Vollständigkeit, Pagination oder stabile Sortierung bewiesen |
| Aktueller Flugblatt-Einstieg auf der Startseite | Offizielles HTML; bis 29.08.2026 | „Online ansehen“, nationaler Filial-/Online-Scope | Direkte aktuelle PDF-URL im Audit nicht aufgelöst; DO muss Redirect/Viewer prüfen |
| `.../4482293/13_FB_Juli_I_2026_Web.pdf` | Offizielles PDF; abgelaufen 31.07.2026 | Textlayer mit Produktname, Art.Nr., Spezifikation, Preis, Referenzpreis, Bedingungen und Enddatum | Beweist PDF-Format und historischen Lifecycle, nicht aktuelle August-Angebote |
| `https://www.zgonc.at/at/filialen` | Offizielles HTML | Österreichweites Filialnetz inklusive steirischer Standorte | Scope-Evidence; individuelle Filialbestände bleiben dynamisch und dürfen nicht verallgemeinert werden |
| Kampagnenseiten, z. B. Bosch Professional/Makita XGT | Offizielles HTML | Herstellerspezifische Prämien-/Gratisaktionen mit eigenen Zeiträumen | Nicht mit allgemeinem Artikelpreis verschmelzen; Teilnahme- und Produktlistenbedingungen separat |
| `robots.txt` | Offiziell, Status unbekannt | Browserwerkzeug konnte die Route nicht belastbar lesen | Muss vor Detailseiten-/PDF-Abruf aus DO geprüft werden; Ausschluss ist Hard-Stop |
| `sitemap.xml` | Offiziell, Status unbekannt | Kein belastbarer Abruf | Nur bei Robots-Freigabe prüfen; nicht erraten |

Strukturierte Daten, JSON-LD, Hydration-/Embedded-JSON, öffentliche Feeds und Asset-Domains sind im Browsertext nicht belastbar nachgewiesen. Es wurde keine private oder versteckte API gesucht oder verwendet. Browserkarten belegen eine sichtbare Bild-Produkt-Zuordnung, aber erst Raw-HTML kann URL, Host, `srcset`, Platzhalter und stabile Kartenbindung beweisen.

Defensiver Source-Plan:

- HTML-Startseite als Campaign-/Discovery-Primary.
- Erlaubte Produktdetailseiten als Product-Identity-Primary, nur für auf der aktuellen Aktionsliste verlinkte Artikel.
- Aktuelles offizielles PDF als Campaign-/Validity-Evidence und unabhängige Produktsicht, nicht automatisch als Gewinner bei Widersprüchen.
- Historische PDFs nur für Lifecycle- und Parsertests, niemals für aktive Angebote.
- Kein Feed, Aggregator, App-Endpunkt, Login oder Produkt-URL-Bruteforce.

## D. Produktionsnaher Transport

Es existiert lokal kein autorisierter DO-/SSH-Diagnoseweg. Der lokale Windows-TLS-Abruf war wegen `CRYPT_E_NO_REVOCATION_CHECK` nicht belastbar und wurde ohne Bypass beendet. Deshalb lauten die Fakten: DO/Linux unbekannt, TLS unbekannt, HTTP unbekannt, Challenge unbekannt, Reproduzierbarkeit unbekannt und Raw Content nicht gesichert. Browser-Erreichbarkeit ersetzt diese Prüfung nicht.

Kurze Befehle für die bestätigte DigitalOcean-Konsole, jeweils einzeln und ohne Cookies oder Spezial-User-Agent:

```bash
getent ahosts www.zgonc.at | head
```

```bash
printf '' | openssl s_client -connect www.zgonc.at:443 -servername www.zgonc.at -verify_return_error 2>&1 | tail -n 8
```

```bash
curl --silent --show-error --location --max-redirs 3 --connect-timeout 10 --max-time 30 --output /tmp/zgonc-robots.txt --dump-header /tmp/zgonc-robots.headers --write-out 'status=%{http_code}\nhttp=%{http_version}\nurl=%{url_effective}\ntype=%{content_type}\nbytes=%{size_download}\nredirects=%{num_redirects}\n' https://www.zgonc.at/robots.txt
```

```bash
curl --silent --show-error --location --max-redirs 3 --connect-timeout 10 --max-time 30 --output /tmp/zgonc-home.html --dump-header /tmp/zgonc-home.headers --write-out 'status=%{http_code}\nhttp=%{http_version}\nurl=%{url_effective}\ntype=%{content_type}\nbytes=%{size_download}\nredirects=%{num_redirects}\n' https://www.zgonc.at/at
```

```bash
curl --silent --show-error --location --max-redirs 3 --connect-timeout 10 --max-time 30 --output /tmp/zgonc-actions.html --dump-header /tmp/zgonc-actions.headers --write-out 'status=%{http_code}\nhttp=%{http_version}\nurl=%{url_effective}\ntype=%{content_type}\nbytes=%{size_download}\nredirects=%{num_redirects}\n' https://www.zgonc.at/at/aktuelle_aktionen
```

Danach read-only auswerten:

```bash
grep -Eai '^(HTTP/|content-type:|content-encoding:|server:|via:|cf-|x-cache|cache-control:|location:|set-cookie:)' /tmp/zgonc-*.headers
```

```bash
grep -Eaio 'captcha|challenge|access denied|just a moment|login|Angebote im August|29\.08\.2026|TOP AKTIONEN|application/ld\+json' /tmp/zgonc-home.html | sort | uniq -c
```

Nur wenn Robots die nötigen Pfade erlaubt, alle drei HTML-Abrufe HTTP 200 mit echtem Inhalt liefern und keine Challenge-/Consent-/Login-Signale vorkommen: die direkte aktuelle PDF-URL aus dem gesicherten HTML lesen und genau einmal abrufen. Erwartet werden HTTP 200, `application/pdf`, `%PDF-`-Magic, plausible Größe und extrahierbarer Text. Ein zweiter Abruf dient ausschließlich der Reproduzierbarkeit. Bei 403, 429, Challenge, Captcha, Access Denied, Login, notwendiger Session-Imitation, irrelevantem Body oder Robots-Ausschluss sofort stoppen und keine Integration beginnen.

## E. Verlässlichkeit

### Transport

Noch nicht bewertbar. Browser-Evidence ist positiv, aber keine Produktionsfreigabe.

### Inhalt

Sehr stark: Startseite und Detailseiten verbinden Titel, Marke, Modell, Artikelnummer, Preis, technische Werte, EAN und Lieferumfang. Bei Sets sind Komponenten explizit getrennt. Sichtbare Onlineverfügbarkeit und Filialreservierung sind jedoch zeitpunktbezogene Availability-Signale, keine Bestandszusage.

### Gültigkeit

Die Kampagne „Angebote im August“ ist bis 29.08.2026 ausgewiesen und soll in allen Filialen sowie online gelten. Auf den Detailseiten ist dieses `validTo` nicht sichtbar an jede Aktionskarte gebunden. Herstellercampaigns haben andere Zeiträume. Deshalb darf eine Detailseite allein kein Enddatum erben; erforderlich ist ein belegter Join zur Campaign-Discovery und `validitySource=campaign`.

### Lifecycle

Historische PDF-URLs enthalten Publication-ID und Kampagnenname, also vermutlich neue URLs je Ausgabe. Das ist gut für Immutable Evidence, erfordert aber Current-Discovery und Expiry. Alte Produktseiten bleiben erreichbar; „Aktion“, „Neu“, normale Preise, Varianten und Related Products stehen nebeneinander. Replacement darf nur den erfolgreich vollständig beobachteten Source-Scope betreffen. Partial Runs behalten bestehende Daten höchstens nach den vorhandenen Freshness-Regeln und dürfen nichts neu aktivieren.

### Trust

Source Quality vor Transport: **medium / unverified**. Nach grünem DO-Preflight, sauberem Raw-Join und konfliktfreier Stichprobe wäre **high / official** realistisch. Der konkrete Zauberschlauch-Konflikt zeigt, dass sichtbare offizielle Seiten nicht blind fusioniert werden dürfen. Bei Preis-, Modell-, Varianten-, Set- oder Bildkonflikt: `needsReview=true`, `comparisonSafe=false`, nicht public, kein Top Deal.

## F. Aktuelle Angebotsbeispiele

Alle Beispiele wurden am 01.08.2026 auf offiziellen, öffentlich sichtbaren ZGONC-Seiten beobachtet. Die Kampagne nennt 29.08.2026; dieser Wert ist noch nicht auf Raw-Ebene pro Produkt gejoint. „PDF: –“ bedeutet: keine aktuelle PDF-Evidence bewiesen. „Bild: B“ bedeutet browserseitig eindeutig sichtbare Karte/Detailansicht, aber noch kein verifizierter Raw-Asset-Join. Daher ist der aktuelle Auditwert von `comparisonSafe` für alle Beispiele **nein**.

| # | Produkt / Identität | Preis / technische Evidence | Evidence / Kategorie / Suche | Safety und Review |
|---|---|---|---|---|
| 1 | EINHELL Setaktion 79235 + Starter Set 83932; ZGONC Art.Nr. 291000; Komponenten GE-CF 18/320 P Li-Solo + PXC 18V 2,5Ah; EANs 4006825679298/4006825646962 | 79,99 Euro; 18 V, 2,5 Ah; Setumfang explizit | HTML+B, PDF –; Garten > Akku-Gartenlüfter; Suche `Einhell 79235 83932 GE-CF 18/320` | Nein; Bundle, Component-Identity und Campaign-Join prüfen; Reject bei fehlendem Bestandteil |
| 2 | ZGONC Wandschlauchbox-Set 25 + 2 m; Art.Nr. 10146; EAN 2010146004709 | 59,99 Euro; 25 m + 2 m, 1/2 Zoll, max. 8 bar | HTML+B, PDF –; Gartenbewässerung > Schlauchbox; `Wandschlauchbox 25+2m 10146` | Nein; später nur exakter Produktvergleich; Länge ist Lieferumfang, nicht automatisch €/m |
| 3 | AL-KO Setaktion 23721 + 24721 gratis; Art.Nr. 285300; Robolinho 500 Vision + Garage; EANs 4003718067385/4003718067675 | 399 Euro; 18 V, 2,5 Ah, 500 m², 20 cm | HTML+B, PDF –; Garten > Mähroboter-Set; `Robolinho 500 Vision Garage` | Nein; Gratis-/Bundle-Mechanik, Komponenten und Referenzwert nicht ableiten |
| 4 | ZGONC Zauberschlauch 30 m; Art.Nr. 17935; EAN 2017935003578 | Startseite 19,99 Euro, Detailseite 24,99 Euro; 30 m max./15 m Basis, 1/2 Zoll, 4 bar | HTML+B mit Konflikt, PDF –; Gartenbewässerung; `Zauberschlauch 30m 17935` | **Nein/P0**; Preiswiderspruch, Längendefinition und Zeitpunkt; zwingend Review/Reject |
| 5 | ZGONC/EINHELL Setaktion 63335 + 20136; Art.Nr. 290700; Z-CD 18 + PXC Starterset; EANs 4006825671599/4006825690163 | 39,99 Euro; 18 V, 44 Nm, 2,5 Ah | HTML+B, PDF –; Elektrowerkzeug > Akku-Bohrschrauber-Set; `Z-CD 18 63335 20136` | Nein; Setidentität und Lieferumfang, keine Einzelpreisaddition |
| 6 | ZGONC Benzin-Rasenmäher MD532; Art.Nr. 97833; EAN 4046664178798 | 249 Euro; 53 cm, 4,4 kW/6 PS, 224 cm³, 65 l Fangkorb, bis 1.800 m² | HTML+B, PDF –; Garten > Benzin-Rasenmäher; `MD532 97833 53 cm` | Nein; 65 l ist Spezifikation, niemals €/l; exakt erst mit Modell/Variante/Lieferumfang |
| 7 | EINHELL Abwasser-Tauchpumpe GC-DP 7835; Art.Nr. 77331; EAN 4006825587210 | 39,99 Euro; 780 W, 15.700 l/h, 8 m Förderhöhe, 10-m-Kabel | HTML+B, PDF –; Pumpen > Schmutzwasserpumpen; `GC-DP 7835 77331` | Nein; l/h und Kabellänge sind Specs; Modell-/Lieferumfangmatch nötig |
| 8 | YPL Bohr- und Stemmhammer 1250; Art.Nr. 57733; EAN 4046664067504 | 66 Euro; 1.250 W, 5 J, SDS Plus, 30 mm; 3 Bohrer + 2 Meißel | HTML+B, PDF –; Elektrowerkzeug > Bohrhammer; `Bohrhammer 1250 5J 57733` | Nein; generischer Titel, Hersteller/Scheppach-Bezug und Lieferumfang prüfen |
| 9 | ZGONC Benzin-Aufsitzrasenmäher MD 610E; Art.Nr. 84234; EANs 4046664252818/4046664292623 | 799 Euro; 61 cm, 224 cm³, 4,4 kW/6 PS, 2.600 m², 150-l-Korb | HTML+B, PDF –; Garten > Aufsitzmäher; `MD610E 84234 61cm` | Nein; zwei EANs/Variante und bedingter Akku-Lieferumfang; nicht €/l oder €/m² |
| 10 | EINHELL Sonderaktion 91732 + Starterset 83932; Art.Nr. 286100; Grasschere GE-AGS 18/1 + Starterkit; Komponenten-EANs | 39,99 Euro; 18 V, 10 cm Schnittbreite/-länge, 2,5 Ah | HTML+B, PDF –; Garten > Akku-Grasscheren-Set; `GE-AGS 18/1 91732 83932` | Nein; Set, zwei mögliche Grasscheren-EANs und Lieferumfang prüfen |
| 11 | EINHELL Bohrhammer TC-RH 620 4F Kit; Art.Nr. 99432; EAN 4006825661736 | 59,99 Euro; 620 W, 2,2 J, SDS Plus, 20 mm; 3 Bohrer + Meißel | HTML+B, PDF –; Elektrowerkzeug > Bohrhammer; `TC-RH 620 4F 99432` | Nein; später exakter Match möglich; ähnliche Vergleiche nur mit Leistung/Lieferumfang |
| 12 | EINHELL Bohrhammer TC-RH 800 4F; Art.Nr. 56135 | 99,99 Euro; 800 W, 2,6 J, 930 U/min., 4.500 Schläge/min. | HTML+B, PDF –; Elektrowerkzeug > Bohrhammer; `TC-RH 800 4F 56135` | Nein; Varianten-/Lieferumfang-/Action-Status noch raw belegen |
| 13 | EINHELL PROFESSIONAL Abbruchhammer TP-DH 50 | 349 Euro laut aktueller Action-Related-Liste | HTML+B, PDF –; Maschinen > Abbruchhammer; `TP-DH 50 Einhell Professional` | Nein; Artikelnummer, Spezifikation und Detailpreis im Audit nicht vollständig gelesen; Review `identity-incomplete` |
| 14 | KRAFTBOX PROFESSIONAL KFZ-Stoßdämpfer-Werkzeug-Satz, 28-teilig | 129 Euro; Aktion/Neu auf Startseite | HTML+B, PDF –; Werkstatt > KFZ-Werkzeugsätze; `Stoßdämpfer Werkzeug Satz 28 teilig` | Nein; Art.Nr., exakter Satzinhalt und Validity-Join fehlen; Stückzahl ist Setumfang |
| 15 | KRAFTBOX PROFESSIONAL Kunststoff-Fliesen-Satz 400×400×18 mm, 10-teilig | 39,99 Euro; Aktion/Neu auf Startseite | HTML+B, PDF –; Baustelle/Garage > Bodenplatten; `Kunststoff Fliesen 400 400 18 10 teilig` | Nein; Maße dürfen nicht als Menge/UnitPrice fehlinterpretiert werden; Packfläche erst aus sicherem Set ableiten |

Referenzpreise und Rabattprozente fehlen bei diesen aktuellen HTML-Beispielen überwiegend. Sie dürfen nicht aus dem historischen PDF, aus „gratis“, aus UVP oder aus Komponentenpreisen konstruiert werden. Die Fußnote definiert einen sichtbaren `statt`-Preis als niedrigsten eigenen Preis der 30 Tage vor Aktionsbeginn; UVP ist getrennt als Herstellerempfehlung zu speichern.

## G. Datenbank- und Datenmodell-Auswirkung

### Vorhandene Felder

Das committed `Offer`-Modell kann direkt wiederverwenden: Source-/Crawl-IDs, Händler, Offer-/Dedupe-Key, Titel/Marke, URLs und Evidence, Preis/Referenzpreis samt Typ und Confidence, Rabatt-/Bundle-/Kundenprogramm-Bedingungen, Validity/Status/Freshness, Region-/Availability-Scope, Mengen- und UnitPrice-Normalisierung, Kategorien, Suchtext/-tokens, Comparison-Gruppen, Qualitäts-/Reviewstatus sowie `rawFacts`. `Source`, `RawDocument`, Source Evidence, Freshness, Public Guards, Diagnostics und `source_extraction_summary` bilden eine gute Basis.

### Fehlende erstklassige Felder

- Händler-Artikelnummer, Hersteller-Modellnummer, Hersteller-Code und GTIN/EAN.
- Varianten-/Familienidentität und kompatible Plattform, z. B. Power X-Change.
- Typisierte technische Spezifikationen mit Trennung zwischen Vergleichsmerkmal und bloßer Beschreibung.
- Setkomponenten, Mengen je Komponente und optional eigene IDs.
- Lieferumfang und ausdrücklich nicht enthaltene Teile.
- Strukturierte Channel-Availability mit Beobachtungszeitpunkt; keine Bestandszusage.
- Belastbare Trennung von Produktmenge, Verpackungsmenge und technischen Maßen/Volumina.

Diese Werte könnten vorübergehend in `rawFacts` liegen, wären dort aber nicht zuverlässig indexierbar, suchbar, deduplizierbar oder für exakte Matches nutzbar. Die lokal uncommitted `imageEvidence`-Arbeit ist nicht Teil des committed Baselineschemas und wurde nicht verändert.

### Empfohlene Architektur

**Minimale globale Product-Identity-Erweiterung plus separates optionales Non-Food-Subschema.** Noch keine eigene Product-Collection für den ersten Pilot.

```text
productIdentity
  retailerArticleNumber
  manufacturerModelNumber
  manufacturerCode
  gtins[]
  productFamilyKey
  variantKey
  identityConfidence

nonFoodDetails
  specifications[] { key, label, valueNumber, valueText, unit, role, confidence }
  compatibleSystems[]
  setComponents[] { title, quantity, articleNumber, modelNumber, gtins[], included }
  deliveryScope[]
  excludedItems[]
  availability { channels[], scope, observedAt }
```

`role` trennt `identity`, `comparison`, `search` und `display`. Dadurch wird etwa `224 cm³` suchbar, aber nie als Produktmenge behandelt. Source-Rohtext bleibt im RawDocument/`rawFacts`; das Offer speichert nur normalisierte, begrenzte Kerndaten. Felder sind optional, Arrays begrenzt, Keys kontrolliert und Indizes sparsam/sparse. ZGONC-spezifisch bleiben Parser-Mappings und Source-Category-Codes; Identität, Specs, Sets und Availability sind global für Forstinger, OBI, BAUHAUS und Lagerhaus sinnvoll.

### Migrationen und Risiken

Die optionale Erweiterung benötigt keine destructive Migration und keinen Backfill bestehender Offers. Neue sparse Indizes erst nach Cardinality-/Query-Plan-Prüfung. Bestehende Lebensmittelangebote dürfen keine Default-Specs oder synthetischen Identity-Werte erhalten. Gefahren sind Dokumentaufblähung, unkontrollierte Spec-Keys, EAN-Join über Setkomponenten, falscher Varianten-Dedupe und technische Zahlen in `quantityText`. Langfristig kann eine eigene Product-Identity-Schicht folgen, sobald mehrere Händler echte identische Modelle liefern; davor wäre sie Overengineering.

## H. Taxonomie

Die aktuelle Taxonomie ist für Lebensmittel/Drogerie stark und besitzt nur grobe Anker wie `Garten / Pflanzen`, `Technik / Elektronik > Werkzeug & Akkus`, `Freizeit > Autozubehör` und `Non-Food`. ZGONC würde darin zu viele fachlich verschiedene Produkte zusammenwerfen.

Zielstruktur mit maximal drei öffentlichen Ebenen:

```text
Werkzeug & Technik
├─ Elektrowerkzeug
│  ├─ Bohren & Stemmen
│  ├─ Sägen
│  ├─ Schleifen & Trennen
│  └─ Akkus & Ladegeräte
├─ Handwerkzeug
├─ Maschinen
│  ├─ Kompressoren & Druckluft
│  ├─ Schweißen
│  └─ Stromerzeuger
├─ Werkstatt & Auto
├─ Garten & Forst
│  ├─ Rasenpflege
│  ├─ Bewässerung
│  ├─ Pumpen
│  └─ Forstgeräte
├─ Bau & Messtechnik
├─ Reinigung & Haus
├─ Arbeitsschutz
└─ Zubehör & Verbrauchsmaterial
```

Öffentlich genügen zunächst `Werkzeug & Technik`, `Garten & Forst`, `Werkstatt & Auto`, `Bau & Maschinen`; feinere Typen eignen sich besser als Facetten. Händlerkategorie und Breadcrumb werden unverändert als Source Evidence gespeichert. Mapping erfolgt über explizite ZGONC-Source-Category-Map plus konservative Titel-/Spec-Regeln. Review bei unbekannter Source-Kategorie, Hauptprodukt/Zubehör-Unklarheit, mehreren gleich starken Kategorien oder Setkomponenten aus verschiedenen Bereichen. Wahrscheinliche False Positives: Akku als Batterieprodukt, Pumpe als Haushaltsgerät, 50-l-Kessel als Produktmenge, Öl als Lebensmittel, Schlauch als Gartenzubehör versus Druckluftzubehör und „Hammer“ als Hand- versus Elektrowerkzeug. Keine globale Classifier-Lockerung.

## I. Suchlogik

Die allgemeine Suche soll segmentübergreifend bleiben, aber mit einem optionalen Segmentchip `Werkzeug & Technik`; keine getrennte Suchmaschine. Leere/breite Anfragen zeigen segmentierte Discovery-Gruppen statt einen gemischten Preisstrom. Nutzer können zusätzlich Händler und Fachbereich filtern.

Identity-Suche braucht eigene, höher gewichtete normalisierte Felder. Exakte Artikelnummer/GTIN erhält höchste Priorität, exaktes Modell danach, Marke+Modell danach, Titel und Synonyme danach. Das heutige Tokenizing verwirft rein numerische Tokens; deshalb wären `57733`, `18`, `1250` oder GTINs nicht zuverlässig suchbar. Sie dürfen nicht einfach global freigegeben werden: nötig sind feldtypisierte Exact-/Prefix-Indizes und Query-Intent-Erkennung.

Technische Ausdrücke werden als atomare Spec-Paare normalisiert: `18 V`, `1200 W`, `50 l`, `10 mm`. Sie gehen in Search/Facets, nicht in `quantityText` und nicht in UnitPrice. Behälter-/Fangkorb-/Tankvolumen, Fördermenge, Hubraum, Schnittbreite und Kabellänge erhalten Spec-Keys. Nur als `saleQuantity` belegte Mengen dürfen Preis-pro-Einheit erzeugen. Hauptprodukt/Zubehör wird über `productRole` und Kompatibilität getrennt.

Sinnvolle Facetten: Marke, Produkttyp, Akkuplattform, Spannung, Leistung, Durchmesser/Größe, Antrieb, Set/Einzelgerät, online/Filiale. Belastbare Beispiele: `Einhell 18 V`, `GC-DP 7835`, `Art.Nr. 57733`, `Bohrhammer SDS Plus 5 J`, `Rasenmäher 53 cm`, `Power X-Change Starterset`, `Schlauchbox 25 m`. Tippfehler/Synonyme werden erst domänenspezifisch getestet; österreichische Begriffe wie Winkelschleifer/Flex, Motorsense/Freischneider und Aufsitzmäher/Rasentraktor brauchen kontrollierte Familien.

## J. Vergleichslogik

`comparisonSafe` bleibt false, bis Source, Validity, Identität, Variante, Lieferumfang und Preis konfliktfrei sind.

Exakter Vergleich nur bei:

- identischer GTIN oder belastbarer Hersteller-Modellnummer,
- gleicher Variante/Akkuplattform,
- gleichem Set-/Lieferumfang,
- gleicher Neuware-/Availability-Klasse,
- aktuellem offiziellen Preis und transparenten Bedingungen.

Eine ZGONC-Artikelnummer ist händlerlokal und allein nicht cross-retailer-fähig. Bei zwei EANs, mehreren Komponenten oder abweichendem Zubehör ist Hard-Stop. Ähnliche Vergleiche sind ein späteres eigenes Feature, kein `cheaper exact alternative`: gleicher Produkttyp, Einsatzgebiet und definierte Kernspecs, aber sichtbar als „ähnliche Alternative“ ohne pauschale Gleichwertigkeit. Ein erklärender Warum-Text nennt die verglichenen und abweichenden Merkmale.

Preis-pro-Einheit ist nur für klar verkaufte Verbrauchsmengen sinnvoll: Stückzahl von Schrauben/Nägeln/Schleifmitteln, Liter Reinigungsmittel/Kettenöl, Meter Kabel/Schlauch oder Fläche einer belegten Plattenpackung. Maschinen, Pumpen, Werkbänke, Geräte und Sets erhalten keinen Grundpreis. Technische Liter, Meter, Millimeter, Watt, Volt, Ah, cm³, l/h und m² sind Hard-Stops für UnitPrice. Fehlt ein sicherer Vergleich, zeigt die UI schlicht keinen Vergleich und keine Ersparnisbehauptung.

## K. Ranking und Top Deals

Normales Ranking: Query-Relevanz und exakte Identität vor Rabatt, danach Source Quality, aktuelle Gültigkeit, Identity-Completeness, klare Bedingungen, Bild-Evidence und stabile Verfügbarkeit. Technische „Attraktivität“ wie mehr Watt ist keine universelle Qualität und darf nicht als Deal-Score dienen. Sets werden nicht durch Addition unbekannter Einzelpreise aufgewertet.

Referenzpreistypen bleiben getrennt: eigener 30-Tage-Preis, UVP, expliziter Aktionsreferenzpreis und kein Referenzpreis. Nur der direkte eigene 30-Tage-Preis derselben Variante/Packung könnte später den strengen Rabattguard erfüllen. UVP ist keine automatische Ersparnis. Herstellerprämien, jö-/Business-Rabatte und Gratis-Komponenten brauchen eigene Bedingungen.

ZGONC bleibt aus Top Deals. Später ist eine getrennte Sektion `Werkzeug-Top-Deals` besser als ein globales Ranking gegen Lebensmittel. Freigabe erst nach stabiler Source-Historie, belastbaren Referenzpreisen, Bundle-Guard und eigener manueller Stichprobe. Die bestehende Top-Deals-Engine fordert sichere UnitPrices und ist für Maschinen systematisch ungeeignet; sie darf nicht gelockert werden.

## L. Öffentlicher Auftritt und UX

Erste Public-Stufe: Händlerlogo nach Rechte-/Asset-Prüfung, Händlerfilter, Marktseite und normale Suche; noch keine Vergleiche oder Top Deals. Die Händlerseite erklärt österreichweiten Online-/Filial-Scope, Beobachtungszeit, Aktionsgültigkeit, Bedingungen und offizielle Quellen. Filialbestand wird als „bei ZGONC prüfen“ formuliert.

Ideale Karte:

- Marke + klarer Produkttitel, Modell sichtbar;
- Preis und nur belegter Referenzpreistyp;
- zwei bis drei entscheidende Specs;
- Set-/Lieferumfang kompakt;
- Gültigkeit und Online-/Filialhinweis;
- verifiziertes Produktbild;
- Artikelnummer kopierbar im Detailbereich;
- Vergleich nur mit serverseitiger Freigabe und Erklärung.

Mobil bleibt die Karte kurz; technische Tabelle, Lieferumfang und IDs liegen in einem Accordion/Detailbereich. Startseite nicht mit Fachfacetten überladen. Zunächst kein neuer Hauptmenüpunkt; ein Segmentchip und eine ZGONC-Marktseite reichen. Erst bei mehreren Non-Food-Händlern ist `Werkzeug & Technik` als Navigationseintrag gerechtfertigt.

## M. SEO und Landingpages

Potenzial besteht für `ZGONC Angebote`, `ZGONC Flugblatt`, `Werkzeug Angebote Österreich` und später datenstarke Typseiten wie Akkuschrauber, Rasenmäher oder Kompressoren. Freigabe nur mit grünem Source-Health, aktuellem `generatedAt`, explizitem Validity-/Scope-Hinweis, genügend eindeutigen aktiven Angeboten und automatischer Noindex-/Deaktivierungsregel bei Stale/Zero Coverage.

Thin Content wären Seiten für jede Marke, jedes Modell oder jede schwach belegte Kategorie. Händler- und Typseiten brauchen eigenständigen Nutzwert: filterbare aktuelle Angebote, technische Eckdaten, transparente Preisart und keine kopierten Händlerbeschreibungen. Canonicals und stabile Taxonomie verhindern Duplicate Content. Händlername/Marken werden rein beschreibend verwendet; keine Partnerschaft, Vollständigkeit, Verfügbarkeit oder Bestpreisgarantie behaupten.

## N. Marketing und ecily-Showcase

Glaubwürdige Positionierung: **„Mehr Kategorien, dieselbe Verlässlichkeit – von Lebensmitteln bis Werkzeug.“** ZGONC ist kein Anlass für „alles vergleichen“, sondern für kontrollierte Erweiterung offizieller Angebotsdaten.

Mögliche Meilensteinbotschaften, erst nach Public-Gate:

- „kaufklug erweitert erstmals über Lebensmittel und Drogerie hinaus.“
- „Werkzeugangebote mit Modell, Artikelnummer, technischen Daten und verständlicher Gültigkeit.“
- „Offizielle Quellen, nachvollziehbare Bedingungen, konservative Vergleiche.“

Kurze Website-Copy: „Aktuelle Angebote für den Alltag – jetzt auch Werkzeug und Gartengeräte. Klar bei Preis, Modell und Gültigkeit.“

ecily-Case-Study-Struktur: Problem heterogener Prospekte → offizielle HTML-/PDF-Evidence → Product Identity und Specs → sichere Such-/Vergleichsregeln → staged Rollout und Observability → messbare Qualität. Eine Meilensteingrafik kann `Food/Drogerie → Product Identity → Werkzeug & Technik → weitere Non-Food-Händler` zeigen.

Später veröffentlichbare Kennzahlen: offizielle Source-Coverage, Anteil eindeutiger Artikelnummern/GTINs, konfliktfreie HTML-/PDF-Joins, Validity-Coverage, Bild-Precision aus Stichproben, Parser-Accept/Reject-Verteilung, Freshness-Latenz, Search-Success und Nulltrefferquote. Nicht behaupten: Partnerschaft mit ZGONC, vollständiges Sortiment, garantierte Verfügbarkeit, Bestpreis, flächendeckender Vergleich oder automatisierte „KI-Genauigkeit“ ohne Messbasis.

## O. Strategischer und potenzieller Exit-Wert

ZGONC erhöht den potenziellen Wert, wenn die Integration messbar zeigt, dass kaufklug nicht nur Prospekttexte sammelt, sondern heterogene Produktdomänen modelliert. Sichtbar werden Source-Orchestrierung, Product Identity, technische Suche, domänenspezifische Vergleichssicherheit, Evidence-Lineage und kontrollierter Betrieb.

Neue Datenassets: historisierte Preis-/Campaign-Evidence, Artikelnummer-/GTIN-/Modellgraph, technische Spec-Normalisierung, Set-/Variantendaten, Taxonomie-Mappings und Source-Quality-Zeitreihen. Architekturassets: generisches Non-Food-Schema, typed search, exact-versus-similar comparison, conflict resolution und staged source onboarding. Das ist für Preisportale, Händlerplattformen, Prospektanbieter und vertikale Vergleichsprodukte interessanter als ein weiterer nahezu gleichartiger Lebensmittelparser.

Ab Integration messen: aktive/entdeckte Angebote, Identity-/GTIN-/Validity-/Image-Coverage, Conflict-Rate, Review-/Reject-Rate, Freshness, Source-Laufqualität, Suchanfragen/CTR/Nulltreffer, Händlerclickouts, Vergleichsquote, Nutzerwiederkehr und Betriebskosten je 1.000 Angebote. Risiken für den Wert: abhängige oder blockierte Quelle, unklare Nutzungsrechte, schlechte Bildpräzision, technische Spec-Sprawl, falsche Vergleichsversprechen und manuell nicht skalierbare Reviews.

Folgehändler: Forstinger profitiert unmittelbar von Artikel-/Modell-/Werkstattlogik; OBI, BAUHAUS und Lagerhaus von Taxonomie, Specs und Markt-/Filialscope. ZGONC ist als Showcase stärker als ein weiterer Lebensmittelhändler, weil es echte Plattformgeneralität beweist.

## P. Integrationsarchitektur

### Stufe 0 – Transport und Evidence

- Scope: Robots, DNS/TLS, Start-/Aktionsseite, aktueller PDF-Einstieg, genau ein erlaubtes PDF, maximal ein Reproduzierungsabruf.
- Gate: HTTP 200, echter Inhalt, keine Challenge, erlaubte Pfade, Text-PDF, nationaler Scope nachvollziehbar.
- Tests: Header-/Body-Signale, Hash/Größe, PDF-Textprobe, Preis-/Validity-Marker.
- Abbruch: jeder definierte Hard-Stop oder nicht auflösbarer Preiswiderspruch.
- Rollback: `/tmp`-Artefakte löschen; keine Repo-/DB-Wirkung.
- Observability: vollständige kompakte Transportmatrix ohne Secrets.
- Manuell: Robots-Interpretation und Zauberschlauch-Source-Truth.

### Stufe 1 – Offline-Parser

- Scope: versionierte erlaubte Raw-HTML-/PDF-Fixtures; Discovery, Produktidentität, Bilder, Validity und 15 Regressionen.
- Gate: keine Netzwerkabhängigkeit in Tests; 100 % Identity-/Price-Precision in kuratierter Stichprobe; Konflikte rejected/reviewed.
- Abbruch: Product Cards nur via dynamischer Session/private API oder Bildjoin nicht beweisbar.
- Rollback: isolierte Parser-/Fixture-Dateien entfernen.
- Observability: Candidate-/Reject-Gründe, Feldcoverage, HTML/PDF-Konflikte.
- Manuell: Karten-, Set-, Varianten- und Bildprüfung.

### Stufe 2 – interner Source-Dry-run

- Scope: keine produktive DB; read-only/isolierte Ausgabe für eine aktuelle Kampagne.
- Gate: stabile Wiederholung, deduplizierte IDs, plausible Kategorie- und Validity-Coverage, keine Stale-Aktivierung.
- Abbruch: große Coverage-Schwankung, unklare Replacement-Grenze, >0 ungeklärte P0-Konflikte.
- Rollback: Source nicht registrieren; Artefakte verwerfen.
- Observability: Source summary, raw/parsed/rejected, category/conflict/image metrics.
- Manuell: repräsentative 30–50 Kandidaten.

### Stufe 3 – Review-only DB-Pilot

- Scope: explizit interne, nicht public-fähige Offers; kein Replacement anderer Händler.
- Gate: optionale Schemaerweiterung getestet, Freshness/Expiry korrekt, Review-Queue beherrschbar.
- Abbruch: bestehende Angebote/Indizes beeinträchtigt, falsche Bilder oder Variantenfusion.
- Rollback: ZGONC-Source/Offers nach exakt scoped IDs deaktivieren/entfernen; Baseline vorher sichern.
- Observability: Dashboard, source_extraction_summary, P0/P1 reasons, crawl health.
- Manuell: Preis, Gültigkeit, Identität, Bild und Setumfang.

### Stufe 4 – begrenzte Public-Freigabe

- Scope: normale Suche, Händlerfilter, Marktseite; keine Vergleiche/Top Deals/SEO-Massenpages.
- Gate: mehrere stabile Kampagnen, hohe aktuelle Coverage, null P0, public guards fail-closed, UX-Smokes.
- Abbruch: Source stale/partial, Conflict-Spike, falsche Bilder/Preise oder Scope-Unklarheit.
- Rollback: Händler public-disabled; Offers intern erhalten.
- Observability: Public counts, freshness banner, query/zero-result/clickout, errors.
- Manuell: tägliche Startphase, danach risikobasiert.

### Stufe 5 – Vergleich und Top Deals

- Scope: zuerst exakte Identity-Vergleiche; später getrennte Werkzeug-Top-Deals.
- Gate: Cross-Retailer-Identity, Lieferumfang, Referenzpreistypen und Historie bewiesen; separate Produktfreigabe.
- Abbruch: UVP-/Bundle-Verzerrung, Similar-as-exact oder UnitPrice aus technischen Specs.
- Rollback: Feature-/Retailer-Guard deaktivieren, normale Public Offers erhalten.
- Observability: accepted/rejected comparisons, Gründe, Nutzerinteraktion, Fehlermeldungen.
- Manuell: jede neue Vergleichsfamilie und Top-Deals-Regel.

## Q. Entscheidung

- Pilotbereit: **nein**, noch nicht für Offline-Fixtures; Stufe 0 fehlt.
- Produktiv: **nein**.
- Public: **nein**.
- Top Deals: **nein**.
- Exakt nächster Schritt: den dokumentierten Stufe-0-Preflight in der bestätigten DO/Linux-Konsole ausführen, Robots und drei HTML-Routen prüfen, bei Grün die direkt verlinkte aktuelle PDF einmal plus Reproduzierungsabruf sichern und den Zauberschlauch-Preiswiderspruch zeitgestempelt auflösen. Erst danach separaten Offline-Parser-/Fixture-Pilot beauftragen.

## R. Geänderte Dateien

- `docs/ZGONC_INTEGRATION_AUDIT_2026-08-01.md`
- `docs/KAUFKLUG_CONTEXT.md`

Keine Source-, Parser-, Fixture-, Modell-, DB-, Public-, Top-Deals-, UX- oder Marketinglogik geändert.

## S. Tests und Checks

- Read-only Architekturinspektion der relevanten Modelle und Services.
- Offizielle Browser-Evidence für Startseite, Aktionen, Filialen, Produktseiten und historisches Text-PDF.
- Keine DB-Verbindung, kein Crawl und kein Netzwerktest aus ungeeigneter lokaler TLS-Umgebung.
- Abschlusschecks: `git diff --check`, Scope-Diff und Git-Status.

## T. Dokumentation

Der Detailaudit ist diese Datei. `docs/KAUFKLUG_CONTEXT.md` erhält nur den dauerhaften Entscheidungsstand, die Gates und den nächsten technischen Schritt.

## U. Git

Git-Werte werden nach den Dokumentationschecks final ergänzt beziehungsweise im Abschlussbericht ausgegeben. Geplant ist ein Commit ausschließlich der beiden Dokumentationsdateien mit `docs: assess zgonc integration strategy`; kein Push. Alle vorgefundenen fremden dirty/untracked Dateien bleiben unangetastet.

## V. Offene Risiken

### P0

- DO/Linux-Transport, TLS/HTTP, Raw Content und Reproduzierbarkeit unbewiesen.
- Robots und damit Zulässigkeit der benötigten Detail-/PDF-Pfade unbekannt.
- Aktuelle direkte August-PDF-URL, Content-Type, Größe, Seitenzahl, Metadaten und Textlayer unbewiesen.
- Startseite 19,99 Euro versus Produktseite 24,99 Euro beim Zauberschlauch.
- Kampagnen-`validTo` noch nicht raw und produktspezifisch gejoint.
- Bild-URLs und Kartenbindung noch nicht aus Raw-HTML verifiziert.
- Nationaler Aktionsscope ist textlich stark, aber regionale/filiale Bestands- und Preisabweichungen noch nicht technisch ausgeschlossen.

### P1

- Modell-/EAN-Varianten und mehrere EANs bei Einzel- oder Setprodukten.
- Bundle-/Gratislogik, Lieferumfang und ausdrücklich nicht enthaltene Teile.
- Technische Zahlen könnten als Menge/UnitPrice fehlinterpretiert werden.
- Bestehende Taxonomie und numerikverwerfende Suche passen nicht ausreichend.
- UVP und eigener 30-Tage-Preis könnten verwechselt werden.
- „Aktion“, „Neu“, Related Products und normale Preise sind auf Seiten gemischt.
- Unterwöchige Preis-/Bestandsänderungen sowie HTML-/PDF-Lag.
- Neue optionale Specs können Schema und Indexe aufblähen.

### P2

- Händlerlogo-/Markenasset-Prüfung und endgültige Kartengestaltung.
- Segmentchips, Fachfacetten und Schnellzugriffe.
- SEO-/Landingpage-Ausbau.
- Meilenstein- und ecily-Kommunikation.
- Getrennte Werkzeug-Top-Deals und spätere Similar-Product-Vergleiche.

## Quellenstand

Auditdatum 01.08.2026. Verwendet wurden ausschließlich offizielle öffentlich sichtbare ZGONC-Seiten und Repository-Evidence. Der Browserbefund ist Discovery-/Inhaltsevidence, keine Transportfreigabe. Aggregatoren, private APIs, Apps, Login, OCR und Schutzumgehungen wurden nicht verwendet.
