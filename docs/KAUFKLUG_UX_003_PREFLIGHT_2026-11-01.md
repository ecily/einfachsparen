# UX-003 – Produktionsrollout: Preflight gestoppt

Stand: 01.11.2026. **ROT / NO-GO.** Die ausdrückliche Betreiberfreigabe liegt vor. Der Release wurde wegen einer reproduzierten neuen Routing-/Canonical-Regression im UX-002-Kandidaten vor Brancherstellung, Staging, Commit und Push gestoppt. Keine eigenmächtige Korrektur.

## 1. Commit, Diff und Git-Status

- Isolierter Worktree `C:\coding\einfachsparen-top-deals-002`, weiterhin Branch `release/top-deals-002`. HEAD und tatsächlich per `ls-remote` abgefragtes Remote-main: **a60b385ce64b14ca3e5bffdb96e874c23b540af0**.
- Kein neuer Release-Branch, kein neuer Commit, kein Staging und kein Push. Der Index ist leer; UX-002 bleibt lokal/uncommitted.
- Geprüft wurden die sieben modifizierten Frontend-/Testdateien, die neuen Shell-/Navigationsmodule und Tests sowie der lokale Fixture-Server. Keine Backendänderung im isolierten Worktree: `git diff --exit-code a60b385c -- backend` erfolgreich. Die bereits produktiven TOP-DEALS-Fixes bleiben im Kandidaten erhalten.
- **Vorhandene Fremd-/Vorgängeränderungen:** Der Kontext enthält neben UX-002 auch uncommittete TOP-DEALS-006-/DOC-001-Konsolidierung; der UX-001-Audit ist bereits vorher untracked. Der vollständige Kontext-Diff wäre daher nicht automatisch ein ausschließlich UX-002-bezogener Release-Diff. Bei späterer Freigabe müssen Dokumentationsanteile explizit abgegrenzt werden. Nichts davon wurde gestaged oder überschrieben.
- Original-Worktree: lokales main `14bce273`, 26 modifizierte versionierte Dateien plus umfangreiche vorhandene untracked Arbeiten. Nur read-only geprüft, nicht angefasst. Kontext-SHA256 unverändert `8D1030340DBA0399105A0A9C8087D46A16FAEE600605D26F4A93C0FACA6C66E4`.

## 2. Ausgangsdeployment und Produktionssicherheit

DigitalOcean wurde authentifiziert read-only per vorhandenem `doctl`-Kontext geprüft; keine App-Konfiguration verändert und keine Zugangsdaten ausgegeben.

| Gate | Tatsächlich belegter Stand |
|---|---|
| App | `5c7b87c9-b22c-4d08-9a70-9e81c1b2590f` |
| Aktives Ausgangsdeployment | **430fd209-d7a6-4a85-a84e-c7925edaadbe – ACTIVE** |
| Backend `einfachsparen-backend` | tatsächlicher Source-Commit **a60b385c** |
| Frontend `einfachsparen-admin` | tatsächlicher Source-Commit **a60b385c** |
| Laufender Deploy | keiner laut `in_progress_deployment` |
| Auto-Deploy | beide Komponenten: GitHub `ecily/einfachsparen`, Branch main, `deploy_on_push=true`; kein garantiert frontendexklusiver Release |
| Frontend-Buildvertrag | `admin`, `npm install --include=dev && npm run build`, Output `dist`; `catchall_document=catchall.html` |
| Health/Mongo | `ok=true`, `database.connected=true`; Prozessstart `2026-11-01T12:25:19.575Z`, bereits länger als 900 Sekunden stabil |
| Crawl | kein aktiver Run; Lock `free` / `released` |
| Letzter regulärer Run | `6ae6cffcfb8541a106574e3c`, scheduled/full, success, `2026-11-01T05:37:00.050Z` bis `05:40:07.284Z` |
| Public-Publish | letzte Stage `publish-status-finished`, `publishStatusFinished=true`, 3.396 zum Run gematchte Angebote; globale Publish-Summary `final`, `openCount=0` |

Nachweis: [sanitisierter Produktions-Preflight](../evidence/ux-003-2026-11-01/production-preflight.json). Die aktive Deployment-ID ist die belegte unveränderte Ausgangsbasis. Keine Rückrollung erforderlich: Es wurde nichts veröffentlicht. Eine vollständige technische Rollback-Validierung und der finale unmittelbare Release-Check wurden nach dem Stop nicht mehr durchgeführt; daraus wird keine bereits abgeschlossene Rollbackfreigabe abgeleitet.

## 3. Tests und tatsächlicher Regressionsnachweis

### Erneut bestanden

- Frontend-/SEO-/Utilitytests: **107/107**, vom Repositoryroot ausgeführt. [Testprotokoll](../evidence/ux-003-2026-11-01/frontend-tests.log)
- `npm run lint`: bestanden.
- Vollständiger `npm run build` einschließlich vorhandenem SEO-Generator: bestanden, ohne Fixture-API-Override. Kein Upload dieser lokalen Buildausgabe.
- Diese grünen Prüfungen sind keine ausreichende Abnahme des nachfolgenden clientseitigen Catchall-Falls. Der bestehende Catchall-Test prüft statisches HTML; die neuen Komponentenfälle enthalten keinen vollständigen Browser-Mount einer unbekannten Route.

### Neuer Blocker: unbekannte Angebots-URL wird umgeschrieben

Reproduktions-URL: **`/angebote/ux-audit-unbekannt/`**, bereits im UX-001-Audit als unbekannte Route dokumentiert.

| Nach React-Ausführung | Produktive Baseline a60b385c | Lokaler UX-002-Kandidat |
|---|---|---|
| Pfad | `/angebote/ux-audit-unbekannt/` bleibt erhalten | wird ohne Nutzeraktion zu **`/stoebern`** |
| Canonical | **keiner** | **`https://www.kaufklug.at/stoebern/`** |
| Robots | `noindex,follow` | `noindex,follow` |
| Vorhandene Fallbacktexte | „Seite nicht gefunden“ und Stöbern | dieselben Fallbacktexte unter der umgeschriebenen URL |

**Wichtig:** Keine Freigabe zur Indexierung beobachtet; `noindex` bleibt erhalten. Die neue Regression ist die ungefragte URL-Umschreibung samt Canonical und damit die Verletzung des vorhandenen Unknown-Route-/No-Canonical-Vertrags. Die doppelte Fallbackdarstellung war bereits vorher vorhanden und wird nicht als neu verursacht ausgegeben.

Der Kandidat wurde zunächst über Vite Preview und anschließend zusätzlich mit dem **tatsächlich auf DigitalOcean konfigurierten Catchall-Vertrag** getestet: derselbe unveränderte lokale Build, reguläre Dateien aus `dist`, für unbekannte Pfade `dist/catchall.html`. Dieser ausschließlich lokale Diagnose-Server auf 127.0.0.1:4186 hatte keinen Produktions-API-Proxy; API-Aufrufe wurden lokal mit 503 beantwortet, Schreibmethoden abgelehnt. Das Routing-/Canonical-Ergebnis trat auch dort auf. Der Unterschied beruht damit nicht lediglich auf Vites SPA-Root-Fallback.

Belege: [Browservergleich als JSON](../evidence/ux-003-2026-11-01/unknown-route-regression.json), [produktive Fallbackansicht](../evidence/ux-003-2026-11-01/production-unknown-route.png), [lokale Fallbackansicht](../evidence/ux-003-2026-11-01/candidate-unknown-route.png). Im Browser wurden keine Angebote/Listen/Feedbackdaten geändert.

### Konkrete Ursache

1. Bestehendes `admin/src/utils/seo.js:297–320`: unbekannte Pfade fallen auf den internen Seitentyp `search` (Stöbern) zurück. Dieser Fallback allein ist nicht neu.
2. Neue URL-Synchronisierung in `admin/src/App.jsx:164–175` prüft nur `activePage === 'search'`, nicht, ob der aktuelle Pfad tatsächlich eine bekannte Stöbern-Route ist.
3. `admin/src/utils/navigationState.js:41` serialisiert diesen Zustand immer als `/stoebern`; `navigateUrl(..., { replace: true, ... })` überschreibt den unbekannten Pfad.
4. Die vorhandene Canonical-Schutzprüfung in `admin/src/utils/seo.js:182–215` sieht anschließend den veränderten Stöbern-Pfad und setzt dessen Canonical. Die Unknown-Route-Ausnahme kann nicht mehr greifen.

Die Kombination der neuen Synchronisierung mit dem alten Routing-Fallback verursacht die Regression. Weder Händlerdaten noch API-Verfügbarkeit oder TOP-DEALS-Klassifikation sind dafür verantwortlich.

## 4. Release-/Live-Abnahme und offene Risiken

- **Kein UX-003-Release, kein neues Deployment.** Deshalb keine Live-Abnahme neuer UX-Funktionen und keine produktive neue SEO-Generation. Die überprüfte Produktion bleibt auf a60b385c; es gibt keine durch UX-003 ausgelöste produktive Indexierungsänderung zu berichten.
- Kein Staged-Diff/Commit-Test, kein Auto-Deploy-Monitoring und keine nachgelagerte Produktionsabnahme durchgeführt: Diese Schritte sind erst nach bestandenem Preflight zulässig.
- Keine eigenmächtige Reparatur, kein zusätzlicher Crawl, keine Datenbankkorrektur, kein manueller Deploy und keine Datenbankrücksetzung. Kein Rollback ausgelöst.
- Der frühere lokale UX-002-GO-Status wird durch diesen Nachweis aufgehoben. Ein erfolgreicher Build und 107 grüne Tests schließen diesen Randfall nicht aus.
- Vor neuem Rollout ist eine eng begrenzte Korrektur der URL-Synchronisierung für **erkannte Stöbern-Routen** und ein Regressionstest des tatsächlich ausgeführten Catchall-Clients erforderlich. Bekannte Browse-Deep-Links, Back/Forward und Entwürfe müssen dabei erhalten bleiben. Diese Korrektur ist in UX-003 ausdrücklich **nicht** umgesetzt.

## 5. Endampel und Dokumentation

**Release: ROT / NO-GO. Bestehende Produktion: im geprüften Health-/Crawl-/Publish-Umfang grün und unverändert.**

In UX-003 nur Dokumentation ergänzt: dieser Bericht, schlanker Stop-Verweis im Kontext und Nachtrag im UX-002-Bericht; neue lokale Nachweise unter `evidence/ux-003-2026-11-01/`. Bestehende UX-002-Codeänderungen und fremde Dirty-/Untracked-Dateien bleiben unangetastet. Keine Veröffentlichung der Dokumentation per Zusatzcommit.

Nächster Schritt benötigt einen ausdrücklichen Auftrag zur gezielten Blockerkorrektur; bis dahin kein weiterer Releaseversuch.
