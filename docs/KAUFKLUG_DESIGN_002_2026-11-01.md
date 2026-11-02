# DESIGN-002 – Abschluss der begrenzten Design-Abnahme

01.11.2026. **ROT / NO-GO für kontrollierten Produktionsrollout.** Technische Unit-/SEO-Prüfungen grün; konkrete Accessibility-/Navigationsbefunde und offene Browsergates verhindern Freigabe. Keine neuen Features oder Designkorrekturen.

## A. Tests und Browsermatrix

- `node --test admin/src/utils/*.test.mjs` vom Repository-Root: **116/116 bestanden**. Früherer Button-Test nach Änderung go→Suchen grün; alle bisherigen Routing-/SEO-/Catchall- und neuen Kategorievertragstests enthalten. [Testlog](../evidence/design-002-2026-11-01/frontend-tests.log).
- `npm run lint --prefix admin` und `npm run build --prefix admin`: **bestanden**, exit0. Build122 Module; JS469,94kB/CSS165,47kB unkomprimiert, keine Feld-CWV-Aussage. Dist ignoriert, kein Releaseartefakt oder Deployment.
- Unabhängiges vorhandenes Chromium1217 plus lokal gecachtes playwright-core, eigener Headless-Prozess/Context. Lokale Origin `http://127.0.0.1:4218`, Fixture-API4219, alle externen Browserrequests blockiert. Kein fremder Browser bedient, keine Produktionsschreibaktionen. Zunächst gestartete temporäre npm-Installation ohne Rückmeldung beendet; vorhandenes Paket verwendet, keine Projektabhängigkeiten geändert.
- Reproduktionswerkzeug `admin/scripts/design002Audit.cjs`; enthält fest benannte lokale Browser-/Paketpfade im Aufruf, keine Secrets. Startserver aus DESIGN-001 weiter vorhanden und über Ports/Origin verifiziert; keine fremden Prozesse beendet. Fixture enthält135 ausdrücklich synthetische Waschmittelangebote,20 Top Deals und nur eine Hauptkategorie. Kein Nachweis realer Angebotsqualität.

| Breite | Dokumentierte Ansichten | Overflow |
|---|---|---|
|320 /375 /390|jeweils Start, Suche, Top Deals, Liste, Stöbern-Deep-Link, BILLA-Landing, verschachtelte Unknown-URL|keiner in diesen21 Ansichten|
|768|5 Ansichten in Ergebnisdatei; zusätzlicher isolierter Startseitenlauf erfolgreich|keiner in aufgezeichneten Ansichten|
|1024 /1440|Startseite separat erfolgreich; vollständige Bereichsmatrix offen|Startseite ohne Overflow|

[Maschinenlesbare Teilmatrix](../evidence/design-002-2026-11-01/browser-results.json). Hauptlauf wegen verzögertem/zeitweise timeoutendem lokalen Navigations-/Screenshotablauf nicht als vollständige42er-Abnahme ausgeben. Ursprung der Verzögerung nicht abschließend isoliert; kein Beweis einer produktiven Browserregression. DOM-Snapshots jeweils ein main/eine H1 und drei primäre Links in den aufgezeichneten Ansichten. Separate browserinterne Top-Deals-/Such-Screens zeigen20 bzw.60 Karten; das ist noch keine Abnahme des vollständigen Suchbestands.

Gezielter zusätzlicher Paginationlauf erreichte60 Karten, konnte aber den erwarteten Nachladebutton über den Testlocator nicht erreichen (Timeout). [Interaktionsnachweis](../evidence/design-002-2026-11-01/interaction-results.json). Keine Behauptung60→120→135, erfolgreicher Listenergänzung/Reload oder Back/Forward aus diesem Auftrag. Locator-/Sichtbarkeits-/Fixtureursache nicht isoliert; vorhandene Unit-Verträge ersetzen diesen Browsernachweis nicht. Ebenso noch keine vollständige Sortier-/Filter-/Tastatur-/Screenreader-Abnahme.

## B. Screenshots und UX-Befunde

- [Mobile390, vollständige Startseite](../evidence/design-002-2026-11-01/home-390.png)
- [Desktop1440, Viewport](../evidence/design-002-2026-11-01/home-1440-independent.png)
- Weitere Breiten/Ansichten im selben Evidence-Verzeichnis; `*-viewport.png` und `*-independent.png` getrennt von ersten Vollseitenversuchen. Alle mit lokalen Fixtures und unbestätigtem Cookiehinweis; keine echten Marktbestände. Externe Webfonts waren absichtlich blockiert, Fallbacktypografie ist sichtbar.

**Blocker1 – Textkontrast:** Der Startseiten-Link „Top Deals heute“ hat tatsächlich berechnete Textfarbe rgb(22,84,72) auf rgb(47,101,72), kein Gradient,16px. Relative WCAG-Luminanz ergibt **1,2839:1** statt4,5:1 für normalen Text. Ursache im Zusammenwirken alter Hintergrundregel und neuer Textfarbe; keine globale Kontrastfreigabe. [Messdaten](../evidence/design-002-2026-11-01/accessibility-findings.json).

**Blocker2 – Reihenfolge:** DOM/Fokusfolge Suche→Top Deals→Liste, mobil berechnete CSS-Order für Top Deals2, übrige0; visuell Suche→Liste→Top Deals (x21/138/256px bei390). Das widerspricht dem vorgesehenen konsistenten Navigationskonzept und ist vor Freigabe zu korrigieren bzw. vollständig mit Tastatur abzugleichen. Nicht pauschal als eigenständig bewiesener WCAG-Verstoß bezeichnet.

Neutraler Kategorien-Einstieg ist visuell vorhanden, nur für die in der Fixture belegte Kategorie verlinkt; andere Kacheln behaupten keinen Bestand. Datenattraktivität ausschließlich unknown, keine Empfehlungen oder Angebotssummen. Der Cookiehinweis überdeckt in Screenshots zeitweise Teile der Kacheln; vollständige Prüfung von Fokusüberdeckung/Erstbesuch/Zoom und Dismiss-Verhalten offen. Kein vollständiger Screenreader- oder WCAG2.2-AA-Nachweis.

## C. SEO und unveränderte Fachlogik

Generiertes Initial-HTML mit aktueller produktiver Generation lesend verglichen:

- Vollständige eingebettete SEO-Policy **gleich** mit Produktion; Sitemap-URL-Mengen gleich,24 URLs. Robots-Inhalt nach Zeilenendennormalisierung gleich (Bytevergleich nur wegen CRLF/LF abweichend).
- Catchall initial noindex,nofollow, kein Canonical. React-Unknown in Matrix noindex,follow ohne Canonical und ohne Pfadumschreibung. Utilities noindex, geprüfte Händler-/Top-Deals-Ziele mit korrekten Slash-Canonicals.
- Bestehende Landing-/interne-Linktests bestanden. Keine Google-URL-Inspection durchgeführt; **Indexierbarkeit** geprüft, tatsächliche Google-Indexierung nicht neu behauptet.
- Heatmaplink erzeugt bestehenden vollständigen Browse-Vertrag über verfügbare Händler ohne Limitparameter. Keine Backend-/Ranking-/Preis-/Crawl-/DB-Änderung. API-Verträge und20er-Top-Deals-Limit im Code unverändert; vollständige Browserpagination bleibt offenes Gate.
- Statischer Homepageinhalt erhält Suche/SEO-Einstiege, die neue Kategorieübersicht entsteht erst mit React/API. Kein statischer Qualitäts-/Zähleranspruch. Visuelle Gleichheit vor/nach JS und restliche Landingmatrix noch nicht vollständig abgenommen.

## D. Blocker und nächste Freigabegrenze

Vor Rollout: konkreten CTA-Kontrast und Navigationsreihenfolge gezielt korrigieren, betroffene Kontrast-/Fokuszustände regressionsprüfen; alle42 Ansichten vollständig abnehmen und Pagination, Filter, Sortierung, Liste/Reload/History sowie Fehler-/Leerdatenzustände mit belastbaren Fixtures abschließen. Keine Reparatur in DESIGN-002. Keine pauschale Designausweitung erforderlich. Erst nach korrigiertem Kandidaten neue technische GO-Prüfung; keine Produktionsfreigabe dieses Berichts.

Security-Rotation und SEO-004/005 bleiben getrennt. Tages-SEO-Refresh weiterhin offen und P0-Folgeentwicklung; neutrales Design löst diese Architektur nicht.

## E. Git, Produktion und Dokumentation

Branch design/001-mobile-first, HEAD/Remote-main ef85d6da. Read-only DO-Abgleich01.11.15:39:41UTC: Deployment96f7f522-1724-41b5-82e5-be4935b331d5 ACTIVE, Backend/Frontend ef85, Health/Mongo ok, kein Deploy/Crawl, Lock frei, Publish final. Kein neuer Code veröffentlicht.

DESIGN-002 ergänzt ausschließlich Testwerkzeug, Evidence, diesen Bericht, DESIGN-001-Nachtrag und Kontext. Die sieben bestehenden tracked Designänderungen und untracked Designkomponenten/-styles/-tests bleiben erhalten; keine Produktcodekorrektur in diesem Auftrag. Vollständigen Scope später über `git status` und Diff gegen ef85 prüfen, nicht automatisch alle untracked Dateien übernehmen. Index leer; keine Commits, Pushes, Deployments oder Datenmutationen. Originaler Dirty-Worktree unverändert.

**Fazit: NO-GO.** Unit-/SEO-Prüfungen bestanden, Design nicht vollständig browserqualifiziert und ein gemessener Kontrastblocker vorhanden.
