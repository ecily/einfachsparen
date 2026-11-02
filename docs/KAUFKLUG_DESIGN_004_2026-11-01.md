# DESIGN-004 – kontrollierter Rollout vor Commit gestoppt

01.11.2026. **ROT / NO-GO für diesen Releaseversuch. Produktion unverändert auf dem zuvor freigegebenen ef85d6da.** Betreiberfreigabe lag unter der Bedingung eines vollständig grünen frischen Preflights vor; diese Bedingung ist nicht erfüllt.

## A. Release- und Git-Stand

Neuer sauberer Worktree `C:\coding\einfachsparen-design-004-release`, Branch `release/design-004`, Basis **ef85d6da7ec5289104a4a940999ae54ca37b4c8d**, identisch mit frisch abgefragtem origin/main. Ausschließlich16 geprüfte Admin-Code-/Testdateien, Designkontext/-berichte und einzeln ausgewählte frühere Nachweise übertragen (86 Dateien im ursprünglichen Transfermanifest). Quelldateien stimmen per SHA256 mit dem DESIGN-003-Kandidaten überein. Kein Backend-/Ingress-/Security-/Dependency-/Lockfile-Diff. Musterprüfung der übertragenen Textdateien ohne Credentialtreffer; kein Secretwert ausgegeben.

Zusätzlich lokales Smoke-Werkzeug `admin/scripts/design004Smoke.cjs` vorbereitet. **Keine Dateien gestagt, kein Release-Commit erstellt, kein Push, kein Auto-Deploy ausgelöst.** Index leer. Ursprünglicher Dirty-Worktree unangetastet. Der Design-Arbeitsstand bleibt separat uncommitted erhalten; neuer Release-Worktree ebenfalls mit uncommittetem Kandidaten. Keine pauschale Übernahme anderer Worktrees.

## B. DigitalOcean und gesicherte Ausgangsbasis

Read-only am01.11.2026 **15:52:35 UTC**:

- App `5c7b87c9-b22c-4d08-9a70-9e81c1b2590f`.
- Deployment **96f7f522-1724-41b5-82e5-be4935b331d5 ACTIVE**, Backend und Frontend tatsächlich ef85d6da, kein laufender Deploy.
- Health/Mongo ok, Prozess unverändert seit14:19:15.231Z; kein aktiver Crawl, Lock frei, Public-Publish final/open0. Letzter regulärer Run6ae6cffcfb8541a106574e3c weiterhin final.
- Aktives gesundes Deployment in Deploymentliste bestätigt und als Rollbackreferenz für einen möglichen späteren Versuch notiert. Kein Rollback ausgeführt oder erforderlich, da Produktion nicht geändert wurde. Vor einem späteren Release dieses Ziel und dessen Zulässigkeit erneut prüfen.
- Begrenztes Backend-Runtimefenster52 Zeilen, sechs bereits bekannte Error-Level-Einträge, keine gefundenen Mongo-Verbindungs-/Authfehlermuster. Kein neuer Fehler durch einen Designdeploy möglich, weil keiner stattfand; kein globaler Fehlerausschluss aus diesem Logfenster.

## C. Frischer Preflight: bestanden und offen getrennt

**Bestanden:**

1. Vollständigen getrackten Designdiff und neue Kategoriekomponente/-utility/-styles/-tests erneut geprüft; Preise, Ranking, Public-Validity, Catchall-Policy und Backend unverändert. Testwerkzeuge binden nur lokale Fixtures; SEO-004/005 und Rotation ausgeschlossen.
2. Im sauberen Release-Worktree erneut **117/117 Frontend-/Routing-/SEO-Tests**, Lint und vollständiger Standardbuild bestanden. Keine Fixture-API in Buildassets.
3. Frische SEO-Generation gegen Produktion: alle38 eingebetteten Policy-Einträge identisch,24 Sitemapziele identisch, Robots inhaltlich identisch. Kein manueller Indexierungs-Override. [SEO-Nachweis](../evidence/design-004-2026-11-01/preflight-seo.json).
4. Unabhängiges Chromium auf dem finalen Standardbuild, lokale Preview4238 und Fixture4239. Jede API-GET-Anfrage ausdrücklich an lokale Fixture umgeleitet, externe Browserrequests gesperrt. Schreibmethoden lokal mit204 beantwortet, keine produktiven Analytics-/Share-/Feedbackmutationen. Frischer Browserkontext für lokale Liste.
5. **Zehn Ansichten** (Start, Suche, Top Deals, leere Liste, verschachteltes Unknown jeweils390/1440) ohne horizontalen Overflow, drei Navigationslinks, keine erfassten JS-Seitenfehler oder API5xx. Suche60 Karten; Top Deals20. Unknown noindex ohne Canonical, bekannte Routen mit korrekten Canonicals. Kategorie-Evidence ausschließlich unknown, keine erfundenen Scores/Zähler.
6. Normale Suche im selben frischen Smoke erfolgreich60→120 nachgeladen.

**Nicht bestanden / Releaseblocker:**

Anschließender echter Pointer-Klick auf `.shopping-list-button` nach dem Nachladen scheiterte nach20 Sekunden. Playwright fand den Button „Auf die Einkaufsliste“, wartete aber erfolglos auf den Zustand visible/enabled/stable. Dadurch wurden Listen-Navigation, Reload und Back/Forward **in diesem frischen Smoke nicht abgeschlossen**. Der frühere DESIGN-003-Flow bleibt ein historischer positiver Nachweis; er ersetzt dieses aktuelle Gate nicht.

[Vollständiges Smoke-Ergebnis](../evidence/design-004-2026-11-01/preflight/results.json). Keine erzwungenen Klicks, keine Umstellung auf Keyboard als Ersatznachweis und keine Produktkorrekturen im Releaseauftrag. Aus diesem einzelnen Timeout folgt **keine nachgewiesene neue Produktregression**; Ursache zwischen Pointer-/Scroll-/Stabilitätsverhalten und Testlauf ist offen. Es gibt dennoch keinen vollständig grünen Release-Preflight.

Screenshots mit synthetischen Daten: [390px](../evidence/design-004-2026-11-01/preflight/home-390.png), [1440px](../evidence/design-004-2026-11-01/preflight/home-1440.png). Diese sind lokale Vorabnahmen, ausdrücklich keine Live-Abnahme des Redesigns.

## D. Konsequenz und weitere Grenze

**Release gestoppt vor Staging/Commit/Push.** Kein neuer Commit, keine neue Deployment-ID, keine produktive Design-/UX-/SEO-Abnahme und kein Rollback. Die gesunde bestehende Produktion bleibt unverändert. Keine weiteren Workarounds oder Features in diesem Auftrag.

Für einen neuen Versuch muss der Pointer-/Stabilitäts-Timeout gezielt nachvollzogen werden. Erst nach bestandenem frischem Smoke einschließlich Liste/Reload/History, erneutem Diff-/Secretcheck und frischen Remote-/DO-/Crawl-/Publish-/Rollbackgates ist die Bedingung für einen kontrollierten Rollout erfüllt. Kein blindes Wiederholen des Pushs oder manueller Deploy.

## E. Dokumentationsstand

Dieser Bericht und ein schlanker Kontextnachtrag dokumentieren den tatsächlich gestoppten Ablauf. Frische Test-/Smoke-/SEO-Nachweise lokal unter `evidence/design-004-2026-11-01/`, Reproduktionswerkzeug im lokalen Release-Worktree und Designworktree. Keine Secrets übernommen. Historische DESIGN-001/002/003-Berichte unverändert; die bedingte lokale GO-Empfehlung ist nicht rückwirkend gelöscht, das aktuelle Releasegate steht jedoch ROT.

**Endampel: ROT für DESIGN-004-Rollout; bestehende Produktion im geprüften Umfang gesund.** Kein zweiter Dokumentationsdeploy, kein Commit oder Push.
