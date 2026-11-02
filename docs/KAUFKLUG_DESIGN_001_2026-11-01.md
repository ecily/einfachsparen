# DESIGN-001 – Mobile-First-Spezifikation und Abnahme

## Gestaltung und unveränderliche Verträge

Arbeitsbasis ef85d6da, eigener Worktree/Branch design/001-mobile-first. Keine SEO-004/005-Codeübernahme, keine Credential-Rotation. Marke Kaufklug mit bestehendem Logo erhalten. Ruhiges warmes Weiß, dunkles Petrol, klare Linien statt Rabattoptik. Systemschrift ohne zusätzliche Font-Abhängigkeit; Verkaufspreis vor Grundpreis, Bedingungen sichtbar, neutrale Bildfallbacks unverändert. Semantische Tokens für Text, Fläche, Grenze, Fokus, Radius und Abstände; Mindestziel48px für Hauptaktionen. Fokus sichtbar, Reduced Motion respektieren.

Drei Hauptbereiche Suche, Top Deals, Liste. Suche umfasst Startseite, Produktsuche und bestehenden Markt-/Kategorie-Einstieg. `/stoebern` bleibt eigenständiger kompatibler Deep Link innerhalb des Suchbereichs; vollständige Filter und bisherige URL-/History-Verträge bleiben erhalten. Startseite: große Suche, direkt darunter wenige Hauptkategorien, dann weitere Produkt-/Händlereinstiege. Keine ersatzlose Löschung von Händler-/SEO-Links.

Heatmapvertrag: bestehende globale Kategorien-API lesen, keine Auswertung einer ersten Rankingseite oder Top20. Heute fehlt ein gemeinsamer freigegebener Attraktivitäts-/Referenzpreis-/Frische-/Quellenvertrauensentscheid; deshalb **alle Kacheln neutral**, keine erfundene Farbskala/Note. Anzahl nicht als qualitätsgeprüfte aktuelle Angebotsmenge ausgeben. Ladefehler, Laden und vorhandene Kategorie unterscheidbar; ohne passenden API-Eintrag kein erfundener Bestand. Kategorie öffnet vollständigen bestehenden Browse-Vertrag über alle aktuell verfügbaren Händler, keine Ergebnisbegrenzung. Qualitätsfarben bleiben gesperrt, solange Evidenz fehlt.

Responsive-Abnahme320/375/390/768/1024/1440: kein horizontaler Overflow, umbruchfähige Texte, zugängliche Navigation/Listenaktion, Verkaufspreis/Grundpreis/Bedingungen erhalten. Tests: Komponenten, Kategorie-Deep-Links/fehlende Evidenz, API-Fehler, bestehende114 UX-/SEO-Tests, Lint/Build, Browserflows und Screenshots. Initial-HTML und React gemeinsam prüfen. Release erst nach vollständigem Diff-/Secret-/SEO-/Datenqualitätsgate, frischem Remote-/DO-/Lock-/Publishcheck und belegter Rollbackfähigkeit. Bei Blocker kein Commit/Push/Deploy.

## Implementierung und Ergebnisse

In Bearbeitung; keine lokale oder produktive Freigabe aus dieser Spezifikation ableiten. Ausgangsdeployment96f7f522-1724-41b5-82e5-be4935b331d5, beide Komponenten ef85d6da, am01.11.15:29UTC ACTIVE. Security-Rotation bleibt separat blockiert, SEO-Tagesrefresh weiterhin offen.

## DESIGN-002 – tatsächliche Nachabnahme

[Abschlussbericht](KAUFKLUG_DESIGN_002_2026-11-01.md):116/116 Tests, Lint und vollständiger Build bestanden. Unabhängiges lokales Chromium mit gesperrten externen Requests statt der zuvor unterbrochenen Browsersteuerung verwendet. Screenshots und maschinenlesbare Teilmatrix in `evidence/design-002-2026-11-01/`.

**ROT / NO-GO:** Startseiten-CTA „Top Deals heute“ gemessen nur1,28:1 Kontrast; sichtbare Hauptnavigation Suche/Liste/Top Deals weicht von DOM-/Tastaturfolge Suche/Top Deals/Liste ab. Matrix nur teilweise abgeschlossen, vollständige Pagination-/Listen-/History-/Tastaturabnahme offen. Keine zusätzliche Designkorrektur in DESIGN-002 vorgenommen und kein Release. Frühere390-px-Miniatur aus DESIGN-001 ist kein belastbarer Responsivnachweis; neue unabhängige Screenshots sind maßgeblich. Fehlende Attraktivitätsevidenz weiterhin neutral, kein belegter farbiger Qualitätsscore.
