# DESIGN-006 – kontrollierter Produktionsrollout

02.11.2026. Ausdrückliche Betreiberfreigabe für genau einen geprüften Designrelease. Vorbereitungsstand, noch keine Live-Abnahme.

## A. Release und Scope

Isolierter Worktree C:\coding\einfachsparen-design-006-release, Branch release/design-006, Basis ef85d6da7ec5289104a4a940999ae54ca37b4c8d. Originaler Dirty-Worktree und Designquelle unangetastet. Ausschließlich Design-001/003-Kandidat, Tests, lokale Testwerkzeuge und ausgewählte Dokumentation/Nachweise. Keine Backend-, Dependency-, Lockfile-, Ingress-, SEO-004/005-Redirect- oder Security-Rotationsänderungen. Transfermanifest mit SHA256 unter evidence/design-006-2026-11-02.

## B. Preflight

Remote-main und beide DO-Komponenten ef85d6da, Deployment96f7f522-1724-41b5-82e5-be4935b331d5 ACTIVE; kein laufender Deploy. Health/Mongo gesund, kein aktiver Crawl, Lock released, Publish final/open=0. Heutiger regulärer Crawl6ae8217c88dec943afc9d2da success/publish-status-finished. Optionale Quelle wogibtswas-dm partial/unavailable-nonblocking, keine erforderlichen Quellenfehler.

117/117 Tests, Lint und Standardbuild bestanden. Frischer DESIGN-004-Smoke: zehn Ansichten390/1440, Pagination60→120, Liste/Reload/History, keine erfassten JS-Seitenfehler/API5xx. Erweiterte DESIGN-006-Abnahme vor Commit erforderlich. Erster erweiterter Versuch mit unhandled Fixture-Transportexception socket hang up fehlgeschlagen, kein Produktregressionsbeweis. Testtransport auf route.fetch mit begrenzten Retries und expliziter Fehlererfassung umgestellt; Abbruchfehler nur bei bereits geschlossenem Tab ausgenommen. Keine Produktkorrektur.

SEO:38 Policy-Einträge; einzige Abweichung zur alten Produktion Schokolade noindex→index. Unveränderte Qualitätsfunktion belegt heute15 Angebote/2 Handelsgruppen,15 mit Bild, quality-thresholds-met. Sitemap25 statt24, nur Schokolade ergänzt. Robots gleich; Unknown initial noindex ohne Canonical. Keine künstlichen Overrides, Heatmap-Scores oder Angebotszahlen.

Rollbackreferenz ist das gesunde aktive Deployment96f7f522. DO validate meldet bei diesem noch ACTIVE-Ziel incompatible_phase; nach Superseding erneut validieren. Vorheriges gesundes Deployment430fd209 als Kontrolle mit valid=true validiert; kein Rollback ausgeführt. [Offizielle API-Referenz](https://docs.digitalocean.com/reference/api/reference/apps/). Nur bei nachgewiesener kritischer Regression zum unmittelbaren gesunden Vorgänger zurückkehren, keine Datenbankrücksetzung.

Begrenztes Runtimefenster117 Zeilen mit sechs Error-Level-Zeilen, keine Mongo-Auth-/Verbindungsfehlermuster. Kein globaler Fehlerausschluss. Scope-/Staged-Diff und Secretprüfung vor Commit erforderlich. Ein versehentlich zu breiter erster DO-Statusoutput enthielt bestehende Konfigurationswerte; diese wurden nicht in Dateien übernommen. Weitere DO-Ausgaben auf sichere Felder begrenzt. Separate Security-Rotation bleibt außerhalb dieses Releases.

## C. Deployment und Live-Abnahme

Noch ausstehend. Bei grünem Preflight genau ein Releasecommit und Fast-forward-Push, ausschließlich DO-Auto-Deploy. Backend/Frontend ACTIVE auf neuem Commit sowie Health/Mongo/Logs/Crawl-/Publish-Sicherheit und Browser-/SEO-Abnahme erforderlich. Live-Nachtrag bleibt lokal/uncommitted, kein zweiter Dokumentationsdeploy.

## D. Grenzen

Chromium-Viewportemulation ersetzt keine physische Touch-/Safari-/Screenreader-/vollständige WCAG- oder Feld-CWV-Abnahme. Bekannte Datenqualitäts-, Security-Rotations- und tägliche SEO-Refresh-Aufgaben bleiben separat. Die globale Publish-Zusammenfassung enthält auch unbekannte nichtintermediäre Altstatus; open=0 ist kein vollständiges Datenqualitätszertifikat.

## E. Nachweise

Nachweise unter evidence/design-006-2026-11-02/, Basissmoke unter evidence/design-004-2026-11-01/design006-preflight/. Historische DESIGN-001 bis005 bleiben datierte lokale Prüfstände. Nicht referenzierte alte Screenshotbäume nicht pauschal übernommen.

## F. Endampel

Vorbereitung; finales Ergebnis nach Live-Abnahme lokal ergänzen.
Die erweiterte DESIGN-006-Abnahme ist vor Commit bei390 und1440 vollständig bestanden: Kategorie-Deep-Link, Pagination60→120, exakter Artikel in Liste/Reload/History, Entfernen mit Reload, Händlersortierung/Pagination/Reload, Marktfilter/Reload sowie Top-Deals-Limit und Unknown-SEO. Keine erfassten JS-Seitenfehler/API5xx;32 Schreibrequests lokal abgefangen. Produktdateien und geerbte Testwerkzeuge weiterhin bytegleich mit der geprüften Designquelle. Erster fehlgeschlagener Transportversuch bleibt oben dokumentiert.
Preflight vor Release abgeschlossen: alle genannten Browsergates bei390/1440 bestanden, 117/117 Tests sowie finales Lint und Standardbuild grün. Staged-Scope78 explizite Dateien, Diffprüfung ohne Whitespacefehler; Secretprüfung ohne Treffer. Letzter frischer Remote-/DO-/Crawl-/Publish-Abgleich weiterhin grün. GO für den ausdrücklich freigegebenen einzelnen Release; finale Produktionsampel erst nach Auto-Deploy und Live-Abnahme.
