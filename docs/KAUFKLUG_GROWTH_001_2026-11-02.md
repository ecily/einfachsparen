# GROWTH-001 – Nutzerwert und belegte Wachstumschancen

02.11.2026. Basis **f46dddaf3318b352b81de5eb0a26209862c35057**, produktiv **c20973a6-c4b4-491f-ac07-7cc853eaf6f7**. Eigener Worktree `C:\coding\einfachsparen-growth-001`, Branch `growth/001`. PRODUCT-002-Live-Nachträge und alle fremden Änderungen geschützt. **Vor Release: lokale Gates bestanden, Veröffentlichung noch ausstehend.** Evidence im eigenen `evidence/growth-001/`, nicht in der Hauptrepo-Berichtskopie voraussetzen.

## A. Produktwirkung

Genau **ein P1-Nutzungsproblem** reproduziert und behoben: Kaffee suchen, Angebot merken, drei Packungen wählen, Reload, Teilen. Live-Ausgangsversion erhält die drei Packungen lokal, lässt die Zahl aber aus dem tatsächlich erzeugten Share-Payload weg. Der Test hat diesen POST vor Übertragung abgefangen, keine Produktivliste angelegt (`journey-before.json`).

Korrektur: bestehendes Snapshot-Element um begrenztes `requestedQuantity` ergänzen; Zahl über Sender, Sanitizer, vorhandenes Mongoose-Modell, Empfängeranzeige, Übernahme, Reload und sichere Teilsumme erhalten. Nur ganze Zahlen 1–99, sichere Legacy-Fallbacks, keine Datenmigration/neue Collection/Indizes/Jobs. Historische empfangene Snapshots ohne Zahl zeigen „Packungsanzahl nicht hinterlegt“. Preise werden weiterhin nicht als aktuelle Freigabe geteilt. Mengenbedingungen, Fristen, Trust-Gates und nicht belegbare Sparplanoptimierung bleiben unverändert geschlossen.

Die unabhängige Browseraufgabe funktioniert auf 320/375/390/768/1024/1440 ohne horizontalen Overflow: Marke/Produktsuche, konkrete Suche, Angebotsbedingungen, Merken, freier Wunsch/Bearbeiten, Menge, Abhaken, Wiederverwenden, Entfernen, Reload/History, Teilen und frischer Empfänger. Drei Packungen kommen nachweislich an und ergeben nur nach gültiger erneuter Bestätigung eine passende **Teilsumme**. Keine weiteren P0/P1-Probleme belegt; keine Neugestaltung. Verständlichkeit ist eine fachliche Inspektion, kein gemessener Fünf-Sekunden-Test mit neuen Teilnehmern. Kontraststichproben mindestens 6,07:1; keine vollständige WCAG-Zertifizierung.

## B. Google-Baseline und drei Chancen

Property **https://www.kaufklug.at/**; GSC Settings am 02.11. lesend: **You are a verified owner**. Vorhandener Originalexport 02.11., **21:22:39 UTC / 22:22:39 Europe/Berlin**, unverändert kopiert; SHA256 `e90ff40c2998aa96b3b2ca9eedeebcb18caf7af9bbd53ea8ac95a277dea25fbb`. **Österreich, Web, 04.–31.10.2026:** 15 Klicks, 2861 Impressionen, CTR 0,52%, Position 26,79. Reportingverzug; keine November-/Nach-Release-Wirkung daraus ableiten.

Mobile 13 Klicks/1562 Impressionen, Desktop 2/1267, Tablet 0/32. 481 ausgewiesene Queryzeilen ergeben nur 5 Klicks/2426 Impressionen; Seiten-, Query- und Ländersummen nicht gleichsetzen. Keine Query×Page-Zuordnung im Export. Kaufklug-Markenfilter `kaufklug|einfachsparen` findet keine ausgewiesene Query; das beweist keinen Null-Markenverkehr. Händlernamen sind bezüglich Kaufklug nicht markenbezogen, aber reine „hofer“-Navigation ist nicht automatisch qualifizierte Angebotsintention. Audit 12.10. bleibt historische Referenz, keine aktuelle Vergleichsperiode.

| Priorität | Beleg, getrennte Dimensionen | Wirtschaftlich sinnvoller Umgang |
|---|---|---|
| 1 Softdrinks | Seite 184 Impressionen/0 Klicks, Position 8,97. Separat Queries „softgetränke im angebot“ 88, „softdrinks aktion“ 44, „softdrinks angebot“ 35 Impressionen, jeweils 0 Klicks | Bestehende indexierte Seite gezielt nützlicher und intenttreuer machen; keine neue URL. CTR-/Klickverbesserung ist Hypothese, kein Versprechen |
| 2 Supermarkt | Slashvarianten 265+293=558 ausgewiesene Seitenimpressionen, 1 Klick. Separat „supermarkt angebote“ 39, „aktionen supermarkt“ 38, „angebote supermarkt österreich“ 24 Impressionen | PRODUCT-002 hat die SEO-015-Hilfe bereits veröffentlicht. Zunächst volle 28-Tage-Wirkung prüfen, keine weitere sofortige Umschreibung oder Redirects |
| 3 HOFER / Händlerintention | HOFER-Seite 543 Impressionen/1 Klick, Position 26,11. Separat „hofer angebote“ 41, „hofer aktion heute“ 24 Impressionen | Bestehende begrenzte Abdeckung/Guide transparent erhalten. Kein vollständiges Flugblatt versprechen; kein weiterer Titeltest ohne Abdeckung und Wirkungskontrolle |

Home: 86 Seitenimpressionen/1 Klick, Position 47,72; neuer Produktnutzen gerade veröffentlicht, noch kein isolierter Effekt. Waschmittel 58/0 bleibt kleinerer belegter Ansatz als Softdrinks, daher keine zweite SEO-Änderung nur zum Ausschöpfen des Limits.

GSC-Indexprüfung **ohne Live-Test oder Indexierungsantrag**: Softdrinks und Supermarkt „URL is on Google / Page is indexed“, User-Canonical jeweils Slash-URL, Google-Canonical jeweils „Inspected URL“. Letzter angezeigter Smartphone-Crawl Softdrinks 26.10.,19:27:19; Supermarkt 02.11.,10:11:02. Supermarkt-Sitemapzuordnung zeigt zusätzlich „Temporary processing error“; keine bewiesene Produktregression, aktuelle Sitemap HTTP/XML und Zielaufnahme separat prüfen. GSC mobile/desktop CWV **No data**, kein bestandener Feld-CWV-Nachweis. Eine einzelne HTTPS-Startseitenprobe hatte DOMContentLoaded ca.1,29s, kein LCP-/INP-/Lastnachweis.

## C. Genau eine SEO-Verbesserung

Nur vorhandene **/angebote/softdrinks/**: Title „Softdrinks Angebote & Aktionen in Österreich | kaufklug.at“, passende Description/H1, eigene gemeinsame Initial-HTML-/React-Hilfe zu Literpreis, Kaufmenge, Bedingungen, Pfand und Einkaufsliste. Keine unbelegten Bestpreise oder Frische-/Sortimentsversprechen. Bestehende thematische Links erhalten; keine neue URL, Canonical-/Robots-/Routing-/Policylogik, keine Sitemap-Erweiterung, kein dynamischer SEO-Pilot.

Erfolgskontrolle: nach technischem Releasecheck vollständige 28 Tage AT/Web der Seite und getrennt der genannten Queries vergleichen, Geräte/kleine Zahlen/Saisonalität beachten; keine kausale Attribution allein aus verändertem Title. GSC-Nachcrawl und Canonical prüfen, ohne Garantie für Google-Anzeige oder Ranking. SEO-014 bleibt NO-GO, SEO-004/005 bleiben unfreigegeben.

## D. Nutzeraktivierung und Messkonzept

Vorhandene eigene Messung, keine neue Plattform. Lesender Summary-Abruf 02.11.,22:07:09 UTC: rollierend letzte30Tage **335 Landing-Events, 67 Suchstarts, 242 Result-Events, 15 Hinzufüge-Events, 67 Listenöffnungen**. Letzte24h Trafficdefinition: 23 als extern, 49 als intern markierte Ereignisse. **Das sind keine Besucher, erfolgreichen Suchen, Conversionraten oder nachgewiesenen neuen Produktnutzer.** Unmarkierte Tests/Bots sind nicht ausgeschlossen; 30-Tage-Summary ist keine kohortenbezogene Google-Journey und keine Nach-Release-Messung.

| Stufe | Vorhanden / Grenze |
|---|---|
| Google → Besuch | GSC Klicks und Event-Referrer getrennt, keine bewiesene Verknüpfung |
| Suche | Start-/Result-Events vorhanden; Result-Event allein beweist nicht resultCount>0 oder Nutzen |
| Angebot / Liste | Hinzufügen und Öffnen messbar; Angebotsinteraktion und individuelle Listeninhalte nicht als neuer Event erfasst |
| Sparplan | Kein dedizierter Nutzungs-/Prüferfolgsevent |
| Händlerweiterleitung | Kein dedizierter belastbarer Outbound-Funnel |
| Wiederkehr | Kein explizites Wiederverwendungsereignis; rotierende Session-HMAC ist keine fertige Retentionskennzahl |

**Neue Messimplementierung in diesem Auftrag NO-GO, nur Konzept:** Rechtsgrundlage/Einwilligung und Datenschutzprüfung nicht nachgewiesen. Bestehender Code hat LocalStorage-Sessionkennung, rotierende HMAC, fallbackseitig maskierte IP/UA/Sprache und 180-Tage-Event-TTL; nicht automatisch „rechtlich anonym“. Metadata-Allowlist nimmt keine Such-/Listeninhalte an, die allgemeine Pfadsanitisierung garantiert aber nicht für jede beliebige API-Eingabe das Entfernen von Querystrings/Share-IDs. Keine zusätzlichen Events, Profile, Fingerprints, Cookies oder externen Tracker eingeführt. Maßstab: [österreichische DSB zu Cookies und Tracking](https://dsb.gv.at/faqs/datenschutz-cookies); daraus keine projektspezifische Rechtsfreigabe ableiten.

Minimaler später freizugebender Vertrag: tägliche aggregierte Zähler für erfolgreiche Suche (resultCount>0), Listenhinzufügen/-öffnen, ausdrückliche Wiederverwendung, bestätigte Teilplanprüfung und freiwillige Händlerweiterleitung. Nur Eventname, Datum, grober Seitentyp und nötigenfalls Händlerkey; keine Freitextsuche, Produkte/Listeninhalte, Share-IDs, Nutzer-/Sessionkennung oder IP/UA zur Wiedererkennung speichern. Keine neue Fingerprinting-Fallbacklogik. Rohereignisse vermeiden, Aufbewahrung/Zweck/Einwilligung vor Implementierung festlegen. Wiederverwendungszähler ist ein Nutzenproxy, kein Beweis personenspezifischer D7-Retention oder wirtschaftlicher Ersparnis. Keine neue Messung ohne Rechtsprüfung aktivieren.

## E. Monetarisierung

**BIPA zuerst als realen Prüfkandidaten empfehlen, nicht als bestätigten Partner.** Aktuelle limit1-Public-Stichprobe liefert eine offizielle erfolgreiche Angebotszeile; keine vollständige Qualitäts-/Coveragefreigabe. BIPAs [offizielle Datenschutzseite](https://team.bipa.at/datenschutz) nennt Impact Radius für Affiliate-Partnerdiagnostik. Das ist ein technischer Hinweis, **kein Beleg eines offenen aktuellen AT-Programms, der Zulassung von Angebots-/Preisvergleichern, Vergütung, Deeplink-/Darstellungsrechten oder Kaufklug-Vertrag**. Diese Punkte vor jeder Integration verbindlich klären. Keine Provision/Umsatzprognose.

dm: eine aktuelle öffentliche Angebotszeile vorhanden, dokumentierte Teilabdeckung bleibt. Öffentlich geprüfte [AT-Kontaktseite](https://www.dm.at/dm/kontakt) und [Partnerportal](https://dm-partnerportal.com/at/org/user_management/register/) belegen kein zugelassenes Affiliateprogramm; Portal ist lieferantenbezogen, nicht als Publisherfreigabe ausgeben. Rang2 für spätere Eignungsprüfung. Der gefundene [Lidl-AT-PDF-Vertrag](https://ad.media01.eu/AD3/Campaign/581/NEUE_Teilnahmebedingungen_des_Lidl_Partnerprogramms_AT.pdf) betrifft Lidl-Reisen.at/2020 und ist kein Lebensmittelpartnernachweis. Müller bleibt unsupported. Keine Händler kontaktiert, Konten/Verträge angelegt oder Affiliateintegration entwickelt. 250 EUR/Monat bleibt Umsatzziel, Ist-Umsatz unbekannt.

## F. Qualitäts- und Releasegates

Backend **1342 Tests:1341 bestanden/0 Fehler/1 bestehender optionaler Skip**; Frontend **140/140**, Lint grün. Deterministische Mengen-/Legacy-/Fehlergrenzen, tatsächlicher Sanitizer plus Mongoose-Roundtrip ohne DB-Verbindung und vollständige Browser-Kernreise bestanden. Baseline/Kandidat mit denselben synthetischen localhost-Daten gebaut:41 HTML-Routen, alle Canonicals/Robots unverändert, nur Softdrinks-Title/Description geändert, alle anderen Metadaten unverändert, Sitemap/Robots bytegleich zwischen diesen beiden lokalen Builds. Keine produktiven Writes/Crawls durch Tests.

Echtes Releasebuild explizit mit Public-Produktions-API und bestehendem `VITE_API_BASE_URL=/api`; keine Fixturemarker, Policy identisch zur aktuellen Produktion,25 Sitemap-Ziele. Windows-Artefakte haben teilweise CRLF statt HTTP-LF: Inhalt nach Zeilenendennormalisierung gleich; **nicht als rohe Byteidentität ausgeben**. Wirebytes vor/nach Release gesondert sichern. Neue Zahl kostet nur ein begrenztes Feld je Listeneintrag; vorhandene120-Positionen-/Payload-/14-Tage-TTL-Grenzen unverändert, keine neuen Query-/Worker-/Crawl-/RAM-Architekturen. Ressourcenvergleich lokal JS gzip ca.+0,4KiB; keine kontrollierte Produktionslast-/Langzeit-CWV-Behauptung.

Nur wenn finale aktuelle DO-/Health-/Lock-/Publish-/Rollback-/Diff-/Secret-Gates grün bleiben: exakt geprüften Scope committen, Fast-forward nach main, nur Auto-Deploy, reale Live-/SEO-Abnahme. Kein zweiter Dokumentationsdeploy. Kritische Regression: gesundes PRODUCT-002-Deployment wiederherstellen, keine DB-Rücksetzung.

## G. Dokumentation und Git

Dieser Bericht plus betroffene zentrale MDs im Hauptrepo lokal synchronisieren. Historische PRODUCT-002-Live-Nachträge nicht umschreiben/stagen; keine fremden Worktrees ändern. Release enthält nur elf geprüfte Code-/Testdateien und diesen Bericht; vorbestehende DOC-002-Konsolidierung bleibt uncommittet. Tatsächliche Releaseidentität/Live-Abnahme lokal nachtragen, kein zweiter Push nur dafür. Belege/Status siehe eigenes Evidenceverzeichnis.

## H. Genau nächste Entscheidung

**Das dokumentierte minimale Messkonzept projektspezifisch rechtlich prüfen und freigeben lassen**, bevor weitere Ereignisse implementiert werden. Erst damit kann die Kernreise über bloße Funktionsabnahme und unverbundene Ereigniszahlen hinaus wirtschaftlich bewertet werden. Kein neues Infrastrukturprojekt und keine behauptete Einnahmenwirkung aus diesem Release.
