# DESIGN-005 – Listenaktion und Abschluss des Release-Smokes

01.11.2026. **Lokale GO-Empfehlung nach Teststabilisierung. Kein Commit, Push, Deployment oder automatische Produktionsfreigabe.** Kein Produktcode geändert.

## A. Ursache: Befund und Grenze

DESIGN-004 adressierte nach60→120 Treffern weiterhin `.shopping-list-button.first()`, also den ersten statt einen aktuell sichtbaren Artikel. Gezielte Reproduktion auf dem unveränderten Release-Kandidaten mit demselben Standardbuild und lokalen Fixtures:

- Der erste Button lag bei1440px **9.472px oberhalb des Viewports**. DOM vorhanden/verbunden,358,56×48px, disabled=false, display:block, visibility:visible, opacity1, pointer-events:auto. Über fünf Messpunkte zunächst unveränderte Geometrie, keine eigene laufende Animation, Fonts geladen.
- Die schon in **ef85d6da** vorhandene `.user-card`-Regel `content-visibility:auto` mit intrinsischer Platzhaltergröße280px (mobil230px) überspringt entfernte Karteninhalte. Der DOM-Bestand ist deshalb kein Beleg, dass ein weit entfernter Kartenbutton schon als gerenderte Pointerfläche oder Accessibility-Ziel verfügbar ist. Die Regel wurde in diesem Auftrag nicht verändert.
- Der native Auto-Scroll zur ersten Karte und deren erneutes Rendern führten im instrumentierten Klickprotokoll zu einer vorübergehenden Pointer-Interception durch eine Angebotskarte. In der diagnostischen5s-Klickprobe wurde Timeout gemeldet, **obwohl danach tatsächlich „Auf der Einkaufsliste“ und disabled=true beobachtet wurden**. Das belegt eine False-negative-Situation dieser Probe und einen ausgeführten Handler; es beweist nicht rückwirkend, dass auch der ursprüngliche DESIGN-004-Timeout bereits hinzugefügt hatte.
- Nach sichtbarer Positionierung zeigte die Hit-Prüfung den Button selbst; keine dauerhaft sperrende Überlagerung oder dauerhaft deaktivierte Listenaktion nachgewiesen. Keine JS-Seitenfehler im abgeschlossenen Smoke.

[Instrumentierter Ausgangsbefund](../evidence/design-005-2026-11-01/diagnostic.json), [Screenshot der Diagnose](../evidence/design-005-2026-11-01/diagnostic.png).

**Einordnung:** Belegt ist ein ungeeigneter Testablauf gegen weit entfernte, renderoptimierte Karten mit Scroll-/Actionability-Timing. Kein neuer Listen-Handler-/Persistenzdefekt nachgewiesen. Die genaue Ursache der teilweise hohen Render-/Protokolllatenz in dieser lokalen Chromium-/Hostumgebung ist nicht vollständig profiliert; keine allgemeine Performancefreigabe oder Behauptung, jeder alte Offscreen-Autoklick müsse nun funktionieren.

## B. Ausschließlich Teststabilisierung

`admin/scripts/design005Pointer.cjs` verwendet echte Wheel-/Mouse-Eingaben. Für entfernte Ziele zuerst die gerenderte **Kartenbox** in den Viewport bringen, erst anschließend deren Buttongeometrie prüfen. Vor dem normalen Playwright-Klick: sichtbare Abmessungen, nicht disabled, mehrere stabile Messpunkte und freier Mittelpunkt per elementFromPoint. Verdeckte/instabile/deaktivierte Ziele führen weiterhin zum Fehler. Keine CSS-Abschaltung, kein force:true, keine direkte Event-Auslösung, kein element.click und keine localStorage-Vorbelegung.

Der Release-Smoke wählt nach dem Nachladen eine tatsächlich sichtbare Angebotskarte; Titel und Position werden im gezielten Listentest festgehalten. Das entspricht der Nutzeraktion beim Weiterstöbern und verhindert den künstlichen Sprung zum etwa10–16tausend Pixel entfernten Erstbutton. Der normale Klick und die konkreten Zustandsänderungen bleiben Prüfbedingungen. **Die Zielauswahl des Tests wurde bewusst geändert**, nicht eine Produktfehlfunktion kaschiert.

`admin/scripts/design004Smoke.cjs` nutzt diesen Helper und prüft nach dem Klick den tatsächlich deaktivierten Listenbutton. Neue lokale Werkzeuge: `design005ListDiagnostic.cjs`, `design005ListAcceptance.cjs`, `design005Pointer.cjs`.

Während der Testentwicklung wurden falsche neue Testerwartungen korrigiert: Leerzustand heißt „Noch keine Angebote gemerkt.“; der Karten-H3 enthält einen Titel-Span plus teilweise ausgeblendete Mengenangabe. Wiederherstellung prüft den exakten Titel-Span und das zurückgesetzte disabled-Attribut im DOM. Eine Offscreen-AX-Abfrage allein wäre wegen content-visibility kein zuverlässiger Identitätsnachweis. Diese DOM-Abfragen sind Zustandsprüfungen, keine Interaktionsumgehung. Getrennte `*-before-*.json`/`*-partial.json` erhalten die fehlgeschlagenen Versuche; ausschließlich die folgenden finalen Läufe gelten als bestanden.

## C. Abnahme

### Vollständiger Listenlauf, Mobile390 und Desktop1440

[Finaler Listentest](../evidence/design-005-2026-11-01/list-acceptance.json), Exit0, beide Breiten vollständig:

1. Suche60→120 über normalen Nachladebutton.
2. Sichtbaren Artikel mit normalem Pointer hinzufügen, danach „Auf der Einkaufsliste“ und disabled bestätigen. Geometrie stabil und Mittelpunkt tatsächlich auf dem Button.
3. Genau ausgewählter Artikel in der Liste, nach Reload wiederhergestellt.
4. Back/Forward erhält Suchroute und Liste mit demselben Artikel.
5. Genau diesen Artikel per normalem Pointer entfernen; korrekter Leerzustand, nach Reload weiterhin entfernt.
6. In der Suche exakt derselbe Artikel im DOM identifiziert; Listenaktion wieder freigegeben, keine versehentliche Wiederaufnahme.

Ausgewählte synthetische Artikel: mobil „UX Test Waschmittel58“, Desktop55. Keine realen Angebote verändert. [Mobile Liste](../evidence/design-005-2026-11-01/list-390.png), [Desktop Liste](../evidence/design-005-2026-11-01/list-1440.png). Zusätzlich wurde der weit entfernte erste Artikel mobil per explizitem Wheel-Scroll erfolgreich hinzugefügt; dies war Diagnose, nicht Ersatz für die finalen beiden Listentests.

### DESIGN-004-Smoke erneut abgeschlossen

[Finaler Release-Smoke](../evidence/design-005-2026-11-01/release-smoke/results.json), Exit0, allein ohne parallelen Chromiumlauf:

- Zehn Ansichten: Start, Suche, Top Deals, Liste, verschachteltes Unknown jeweils390/1440px; drei Hauptlinks, kein horizontaler Overflow.
- Suche60→120; Listenaktion mit Reload und Back/Forward vollständig bestanden.
- Top Deals20; Kategorie-Evidence ausschließlich unknown, keine Scores/Zähler erfunden.
- Keine erfassten JS-Seitenfehler oder API5xx. Schreibmethoden lokal beantwortet/blockiert;15 solcher Requests protokolliert, keine Produktionswrites. Browser-API-GETs ausschließlich lokale Fixture4239, Standardbuild auf4238. Keine realen Share-/Feedbackaktionen.

Dies schließt das konkrete DESIGN-004-Gate lokal. Die ältere42er-Matrix und Kontrast-/Tastaturabnahme aus DESIGN-003 werden nicht als erneut komplett ausgeführt ausgegeben; Produktdateien sind seitdem unverändert.

### Tests, Build und SEO

- **117/117** bestehende Frontend-/Routing-/SEO-Tests bestanden. [Tests](../evidence/design-005-2026-11-01/tests.log).
- Lint und vollständiger Standardbuild erneut bestanden; keine Projektabhängigkeiten geändert. Zusätzliche Testwerkzeuge syntaktisch geprüft. [Lint](../evidence/design-005-2026-11-01/lint.log), [Build](../evidence/design-005-2026-11-01/build.log).
- [SEO-Abgleich](../evidence/design-005-2026-11-01/seo.json):38 Policy-Einträge identisch zur Produktion,24 gleiche Sitemapziele, Robots inhaltlich gleich; statischer Unknown-Catchall ohne Canonical. Frischer Smoke bestätigt Unknown noindex ohne Canonical sowie korrekte bekannte Canonicals. Keine Indexierungs-/Preis-/Rankinglogik geändert, keine Google-Rankingwirkung behauptet.

Reproduktion: lokale Preview des unveränderten Standardbuilds4238; bestehende Fixture aus `design001Fixtures.mjs` nur mit lokalem Port4239 starten. Dann `node admin/scripts/design005ListAcceptance.cjs <lokaler-playwright-core-pfad>` und `node admin/scripts/design004Smoke.cjs <lokaler-playwright-core-pfad> http://127.0.0.1:4238 <neues-nachweislabel> http://127.0.0.1:4239`. Testwerkzeuge enthalten den vorhandenen lokalen Chromium-Pfad; keine neue Softwareabhängigkeit im Produkt.

## D. Release-Diff und Produktion

Alle16 im DESIGN-004-Transfermanifest geprüften Admin-Kandidatendateien sind weiterhin SHA256-identisch; **keine Änderung des Produktkandidaten in DESIGN-005**. Backend, Routing-/SEO-Policy, Preise, Ranking, Crawl, Dependencies und Lockfile ohne zusätzlichen Diff. Geändert wurden ausschließlich Smoke-/Diagnosewerkzeuge und Dokumentation/Evidence. Der neue Helper muss bei einem späteren Release zusammen mit dem davon abhängigen Smoke-Werkzeug ausdrücklich reviewt werden; altes Dateimanifest nicht blind wiederverwenden.

origin/main und beide aktiven DO-Komponenten am01.11.2026 **16:15:50UTC** weiterhin **ef85d6da7ec5289104a4a940999ae54ca37b4c8d**. Deployment **96f7f522-1724-41b5-82e5-be4935b331d5 ACTIVE**, kein laufender Deploy/Crawl, Lock frei, Publish final/open0; Health/Mongo ok. [Read-only-Produktionsabgleich](../evidence/design-005-2026-11-01/production-readonly.json). Keine neue produktive Abnahme des Designs.

Designworktree design/001-mobile-first und vorbereiteter Releaseworktree release/design-004 bleiben lokal/uncommitted auf ef85. Keine Dateien gestagt, kein Commit, Push oder Deployment. Originaler Dirty-Worktree und dessen Kontext unverändert. SEO-004/005 und Security-Rotation ausgeschlossen; täglicher SEO-Refresh weiterhin separate P0-Arbeit.

## E. GO-/NO-GO und Grenzen

**GO-Empfehlung für einen späteren kontrollierten Produktionsrollout nach ausdrücklicher Freigabe und frischem Preflight.** Der konkrete lokale Listen-/Smokeblocker ist mit nutzernaher Teststabilisierung und tatsächlichen Zustandsnachweisen geschlossen. Keine automatische Produktionsfreigabe aus DESIGN-005.

Offen bleiben bekannte Plattform-/Daten-/Safari-/physische Touch-/vollständige Screenreader-/Feld-CWV-Grenzen. Kein vollständiges Host-/Renderingprofiling und keine Aussage über jede beliebige Offscreen-Automation. Vor Release Remote/DO/Lock/Publish, gesamten aktuellen Diff samt Testhelper, Secretprüfung und zulässiges Rollbackziel erneut bestätigen. Keine DB-Rücksetzung oder ungeprüfter Dokumentationsdeploy.

## F. Dokumentation

Dieser Bericht und schlanker Kontextnachtrag ergänzt; historische DESIGN-003/004-Nachweise nicht überschrieben. Finale und fehlgeschlagene Testläufe klar getrennt. Keine Secrets dokumentiert. Nach Abschluss stoppen und neue Produktionsfreigabe abwarten.
