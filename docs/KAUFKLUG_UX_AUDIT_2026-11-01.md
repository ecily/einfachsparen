# UX-001 – Frontend-/UX/UI-Audit kaufklug.at

Stand: 01.11.2026. Designentscheidung **B: umfassende Modernisierung bei Erhalt der Kaufklug-Marke**. Ergebnis ist eine Entscheidungsgrundlage, keine Umsetzungs- oder Produktionsfreigabe.

## Prüfgrundlage und Belegklassen

- **B – Browser:** tatsächliche produktive Darstellung, DOM-/Accessibility-Beobachtung und Interaktionen in Chrome am 01.11.2026. Responsive Viewports: 375 × 812, 768 × 1024 und 1440 × 1000 CSS-Pixel. Dies ersetzt kein physisches Mobilgerät.
- **K – Code/Konfiguration:** gelesener Release-Code, statische Routenregistrierung, API-Antworten und Deployment-Metadaten. Aussagen über nicht ausgelöste Fehlerfälle sind ausdrücklich Codebefunde.
- **H – Hypothese/Prüfbedarf:** erwartete Auswirkungen ohne Nutzungsstudie, Feldmessung oder reproduzierten Fehler. Verbesserungen von Sucherfolg, Bindung oder Reichweite sind keine belegten Ergebnisse.
- Zuerst vollständiger [Projektkontext](KAUFKLUG_CONTEXT.md), anschließend relevante SEO-, Reliability- und historische UX-/Performance-Abschnitte einschließlich [SEO-Prüfung vom 12.10.](KAUFKLUG_SEO_REVIEW_2026-10-12.md) abgeglichen. Alte Abnahmen sind keine aktuellen Messungen.
- Isolierter Worktree `C:\coding\einfachsparen-top-deals-002`, Branch `release/top-deals-002`: HEAD und per `ls-remote` bestätigtes Remote-main **a60b385ce64b14ca3e5bffdb96e874c23b540af0**. DigitalOcean-App `5c7b87c9-b22c-4d08-9a70-9e81c1b2590f`, Deployment **430fd209-d7a6-4a85-a84e-c7925edaadbe ACTIVE**, Backend und Static Site auf diesem Commit. Lokaler Code entspricht damit dem produktiven Ausgangsstand.
- Original-Worktree liegt auf älterem `14bce273` und enthält fremde Änderungen. Keine Übernahme, Synchronisierung oder Änderung dort. Der isolierte Kontext war bereits vor UX-001 uncommitted; dessen vorherige Konsolidierung bleibt erhalten.
- Keine Builds, Testsuiten, Crawls, Datenbankänderungen oder Releases ausgeführt. Reale Suche/Filter/Navigation getestet; keine Artikel hinzugefügt/entfernt, Liste geteilt, Feedback abgesendet oder Cookie-Präferenz geändert. Normale Seitenaufrufe können vorhandene Analytics auslösen. Screenshots wurden visuell geprüft, aber keine zusätzlichen Dateien angelegt.

## A. Gesamtampel und fünf wichtigste UX-Probleme

**Gesamt: GELB.** Kernaufgaben funktionieren und die gemeinsame Angebotskarte sowie konservative Preisguards bilden eine gute Grundlage. Die Modernisierung ist fachlich sinnvoll. Einzelne Kontrastbefunde sind **ROT**; eine vollständige WCAG-Konformitätsaussage ist nicht möglich. Kein Nachweis einer allgemeinen Top-20-Sperre in der Suche.

| Priorität | Wichtigstes Problem | Nachweis und Bedeutung |
|---|---|---|
| 1 / P1 | Navigation verliert Arbeitskontext | **B:** Suche → Stöbern → Suche öffnete eine leere Suche mit „Empfohlen“, zuvor gesetzte Suche/Sortierung waren weg. **K:** `App.jsx:424–435` verwendet `replaceState`; Suchzustand gehört der ausgehängten Keyword-Komponente. Browser-Zurück und teilbare Filterzustände sind kein durchgehender Navigationsvertrag. |
| 2 / P1 | Unterschiedliche Filter- und Ergebnisverträge | **B:** Suche filtert anders als Stöbern mit zusätzlichem „Angebote anzeigen“; SEO-Landings haben nochmals andere Ergebnisselemente. `/angebote/supermarkt/` zeigte 28 Treffer ohne Nachladen. **K:** `SeoOfferLandingPage.jsx:12–38` kombiniert begrenzte Startabfragen und setzt `hasMore:false`. Das ist eine Stichprobe, deren Vollständigkeit für Nutzer unklar bleibt; keine zulässige Top-Deals-Begrenzung für normale Listen. |
| 3 / P1 | Zu geringer Kontrast wichtiger kleiner Texte | **B:** „Sortieren“ in `#7e8b97`, 14,08 px, Gewicht 800 auf heller Fläche; ebenso Suchhinweis und „Beispiele“. Selbst auf Weiß nur **3,48:1**, auf `#f7f9fb` 3,30:1. Das unterschreitet 4,5:1 für normalen kleinen Text. Mobile Navigation mit etwa 9 px ist zusätzlich schwer lesbar; geringe Schriftgröße allein ist kein WCAG-Verstoß. |
| 4 / P2 | Dichte und Hierarchie erschweren die schnelle Entscheidung | **B:** 37 Startvorschläge als lange Chipfläche, zwei Suchfelder auf Desktop-Suchseite, große Hero-/Vergleichsblöcke vor Landing-Ergebnissen, teils dominante Produktbildflächen auf Tablet. **K/B:** Mehrere Preis-/Ersparnisinformationen und wiederholte Produktdaten konkurrieren in Karten. **H:** Eine kompaktere Hierarchie kann die Zeit bis zum passenden Angebot verkürzen. |
| 5 / P2 | Evidenz- und Statusdarstellung ist nicht durchgehend verlässlich | **B:** „Dipping Powder Espresso · 15 g“ verwendet den Platzhalter `coffee`. **K:** Titelregel „Espresso“ greift in `ProductImage.jsx:52` vor Pflegekategorie. Außerdem nur Datumsdarstellung ohne genaue Uhrzeit/Österreich-Zeitzone, einmaliger Top-Deals-Abruf und potenziell falsche Kopierbestätigung bei Clipboard-Fehlern. Dies sind Darstellungs-/Zustandsprobleme, keine erneute Bestandsdatenprüfung. |

Positiv: ehrliche Leermeldung, sichtbarer Fortschritt bei globaler Sortierung, Nachladen statt generellem Vollvorladen, strukturierte Referenzpreis-/Grundpreisguards, native aufklappbare Vergleiche und vorhandene Fokusstile. Diese Eigenschaften müssen erhalten bleiben.

## B. Vollständige Seiten- und Komponenteninventur

### Öffentliche Routen und Ansichten

Die Registry enthält 38 feste Policy-Seiten einschließlich einer internen Adminroute; zusätzlich existieren dynamische Listenlinks und Query-/Filterzustände. Nicht jede Kategorie ist eine eigene indexierbare URL.

| Seite/Route | Funktion und Komponenten | Auditbefund |
|---|---|---|
| `/` | Homepage, Produktsuche, Vorschlagslinks, Top-Deals-/Stöbern-Einstieg, Methodik und Footer | **B:** alle drei Breiten; starker Sucheinstieg, aber 37 Vorschläge und kleine Mobilnavigation. H1 vorhanden. |
| `/suche?q=…` | `KeywordSearchPage`, Marktfilter, drei Sortierungen, gruppierte `OfferCardConsumer`, Pagination | **B/K:** 60er-Seiten; mobile ein, Desktop zwei Suchfelder. Kein H1, Ergebnis-H2 vorhanden. Zustand beim Tabwechsel verloren. |
| `/stoebern` | `SearchPage`, Händlerwahl → optionale Kategorien → explizites Anwenden, Ergebnisse | **B/K:** andere Filterbedienung als Suche; Entwurf und angewandte Auswahl getrennt. Nach dm-Auswahl 60 von 203 Treffern. H1 vorhanden. |
| `/einkaufsliste`, Alias `/liste` | `ShoppingListPage`, lokal gespeicherte Angebote, Mengen, Abhaken, Händlersummen, Teilen | **B:** vorhandene Vier-Artikel-Liste nur angesehen. Befüllte Ansicht ohne H1, leere Ansicht laut Code mit H1. Alias kanonisiert nach `/einkaufsliste/`, noindex. |
| `/liste/:shareId` | `SharedShoppingListPage`, geteilter Snapshot, Übernehmen in lokale Liste | **K:** eigener Kartenaufbau und Gültigkeitstexte. Netzwerkfehler und nicht verfügbare Liste werden nicht sauber getrennt. Ohne freigegebene Testliste nicht live getestet. |
| `/top-deals/` | `TopDealsPage`, Markt-/Kategoriefilter, gemeinsame Angebotskarten | **B:** 20 Karten, drei Breiten. **K:** eigene Begrenzung 20 bleibt ausschließlich hier. Fehler verwirft Payload, kein expliziter Retry-Button; kein periodischer/Visibility-Refresh. |
| `/angebote/`, `/angebote/supermarkt/`, `/angebote/drogerie/` | Übersichts-/Gruppenlandings, Startabfragen, Vergleichshinweise und SEO-Inhalt | **B:** Supermarkt 28 ohne Nachladen. **K:** Mehrfachabfragen ergeben abgeschlossene Auswahl statt vollständigen paginierten Ergebnissen. Als Auswahl kennzeichnen und vollständige Ergebnisnavigation vorsehen; keine neue Begrenzung einführen. |
| Händlerlandings, siehe unten | `SeoOfferLandingPage`, Händlertexte, Vergleichshilfe, Angebote, Fallback | **B:** BILLA auf allen Breiten, Müller mobil als ehrlich nicht verfügbar. Andere Händler über gemeinsamen Code/Registry geprüft. |
| Produkt-/Kategorielandings, siehe unten | Gleiche Landing-Komponente, spezifische Vergleichshilfe | **B:** Bier auf allen Breiten; H1 und Karten vorhanden. Alle 13 Konfigurationen/Policy-Ziele geprüft, nicht alle 13 visuell in jedem Zustand. |
| `/preischeck/bier-literpreis-vergleich/` | `PriceCheckPage`, eingebetteter Build-Vergleich oder Fallback | **B:** Vergleich derzeit nicht verfügbar, noindex. **K:** Build-Daten sind kein dynamisches Live-Ergebnis. |
| `/so-funktioniert-kaufklug/` | `TrustPage`, Methodik, Quellen-/Vergleichsgrenzen | **B:** H1, indexierbar; wichtiger Vertrauensanker. Nicht in jede Karte vollständig kopieren. |
| `/feedback/` | `FeedbackPage`, Formular | **B:** Formular/H1, noindex. Absenden, Validierungsfehler und erfolgreiche Speicherung nur Codeanalyse, kein POST. |
| `/impressum/`, `/datenschutz/`, `/nutzungshinweise/`, `/cookies/` | `LegalPageShell`, Rechtstexte und Cookiehinweise | **B:** mobil erreichbar, H1/Canonical/index,follow. Inhaltliche Rechtsprüfung nicht Teil des Audits. |
| Unbekannte URL / 404 | statischer Catchall und React-Routing-Fallback | **B:** `/angebote/ux-audit-unbekannt/` zeigt „Seite nicht gefunden“ plus Stöbern-H1; kein Canonical, noindex,follow. **K:** unbekannte Pfade fallen auf Stöbern zurück. Verwirrende doppelte Ansicht, aber kein belegter neuer Indexierungsfehler. |
| `/ecily_web` | interne Diagnose/Adminroute | Kein öffentlicher Nutzerflow; nicht funktional auditiert. **K:** eagerly importiert und damit Performance-Kandidat, kein Nachweis eines Authentifizierungsfehlers. |

**Alle 24 registrierten Angebots-Landings:**

- Übersichten: `/angebote/`, `/angebote/supermarkt/`, `/angebote/drogerie/`.
- Händler: `/angebote/spar/`, `/angebote/billa/`, `/angebote/hofer/`, `/angebote/lidl/`, `/angebote/dm/`, `/angebote/bipa/`, `/angebote/mueller/`, `/angebote/penny/`. BILLA/BILLA Plus sind keine zwei unabhängigen Handelsgruppen und haben keine getrennten Landingrouten.
- Produktgruppen: `/angebote/kaffee/`, `/angebote/bier/`, `/angebote/softdrinks/`, `/angebote/deo/`, `/angebote/schokolade/`, `/angebote/windeln/`, `/angebote/duschgel/`, `/angebote/nudeln/`, `/angebote/chips/`, `/angebote/waschmittel/`, `/angebote/kaese/`, `/angebote/butter/`, `/angebote/wurst/`.

### Responsive-Prüfmatrix

| Ansicht | 375 px | 768 px | 1440 px | Stichprobe |
|---|---|---|---|---|
| Homepage | geprüft | geprüft | geprüft | 37 Vorschläge; ein Suchfeld |
| Suche Kaffee | geprüft | geprüft | geprüft | 60 initiale Karten; Desktop zwei Suchfelder |
| Stöbern | geprüft | geprüft | geprüft | Filter-/Anwenden-Flow; dm-Ergebnisse separat interaktiv |
| Einkaufsliste | geprüft | geprüft | geprüft | vier vorhandene Artikel, unverändert |
| Top Deals | geprüft | geprüft | geprüft | 20 Karten |
| BILLA-Landing | geprüft | geprüft | geprüft | 24 initiale Karten |
| Bier-Landing | geprüft | geprüft | geprüft | 27 Karten |

**B:** In diesen 21 Layoutfällen kein gemessener horizontaler Überlauf (`scrollWidth = clientWidth`). Das beweist wegen vorhandener Overflow-Regeln keine vollständige Reflow-/Clipping-Freiheit bei Zoom, längeren Übersetzungen oder 320 px. Mobiler Sticky-Rechtsfooter 68 px, ab Tablet 44 px; mobile Main-Unterkante etwa 115 px gepolstert. Keine belegte Überdeckung eines Bedienelements. Der Erstbesuch-Cookiehinweis war nicht sichtbar und wurde nicht neu erzwungen.

### Tatsächlich durchgespielte Interaktionen

1. **B:** Homepage bei 375 px: „waschmittel“ eingeben und Enter → Suche, Loading → 60 von 135. Marktfilter aktivieren ohne Markt → null ausgewählt mit Erklärung; dm wählen → 33 gefilterte Treffer; Reset funktioniert.
2. **B:** Sortierung „Märkte“ zeigt zunächst Fortschritt „60 von 135“, danach sortierte Ergebnisse. Vorhandene Reihenfolge bleibt während Vorbereitung sichtbar. Kein beobachteter API-Fehler.
3. **B:** Nachladen auf Desktop per Enter auf dem Button → **120 von 135**, 120 Karten im DOM. Pointer-Klickversuche führten in dieser Sitzung nicht zuverlässig zum erwarteten Übergang. Das bleibt ein kontrolliert zu reproduzierender Bedien-/Timingbefund, kein Nachweis einer harten Grenze oder ihrer Ursache. Vollständige dritte Seite nicht interaktiv abgenommen.
4. **B:** Stöbern öffnen, dm wählen und „Angebote anzeigen“ → 60 von 203. Danach Suche öffnen → Suchbegriff leer und Standardsortierung. Der Kontextverlust ist reproduziert.
5. **B:** Suche nach `zzzzuxauditkeinangebot` → „Dazu finden wir gerade kein sicheres Angebot“, Vorschläge und „Suche ändern“. Kein falsches Angebotsversprechen.
6. **B/K:** Loading-/Skeleton-/Fortschrittsanzeigen gesehen; API-Ausfall, Offline, Clipboard-Verweigerung, Teilen und Feedback nicht produktiv ausgelöst. Fehler-/Retry-Verhalten unten ist insoweit Codebefund.

### Komponenten und Wiederverwendung

| Baustein | Vorhandene Wiederverwendung | Bruch / Modernisierungsbedarf |
|---|---|---|
| `App.jsx`, Header, Navigation | gemeinsame Shell, Logo, Tabs, Header-Suche | App enthält Routing, Zustand, Effekte und Darstellung; Navigationsbuttons statt normaler Links; `replaceState`; zweite Desktop-Suche. |
| `RetailerSelectorBlock`, `CategorySelectorBlock`, `ActionBlock` | Stöbern verwendet gemeinsame Auswahlbausteine, native Buttons/Accordion | Keyword und Top Deals besitzen eigene Filterverträge; Auswahlentwurf, sofortiger Filter und angewandter Filter unterscheiden sich. |
| `ResultsBlockConsumer`, `ResultsSection`, `SectionCard` | Ergebnis-/Panelbausteine | Unterschiedliche Überschriften, Aufteilung und Fehlerdarstellung je Einstieg; ein gemeinsamer Ergebniskern fehlt. |
| `OfferCardConsumer` | Suche, Stöbern, Top Deals und Landings | Große Chance für konsistente Preis-/Bedingungs-/Listeninteraktion; Landing deaktiviert Angebotsfeedback, geteilte Liste nutzt anderen Aufbau. |
| `ProductImage` | Proxy-/Direktfallback, Fehlercache, IntersectionObserver, feste Bildrahmen | Gute Lazy-/Fallback-Basis; Titelheuristik kann falsche Kategorie illustrieren. Neutrale Platzhalter bei Zweifel statt erfundener Produktfotos. |
| `ShoppingListPage`, `SharedShoppingListPage` | lokale Persistenz, Mengen/Abhaken, Teilen/Übernehmen | Snapshot vs. aktuelles Angebot sichtbar trennen; Kopierbestätigung nur nach Erfolg; keine stillschweigende Aktualitätsgarantie. |
| `HeroLoaderModal`, Skeletons, Status-/Alerttexte | vorhandene Lade-/Fehlerbausteine | Blocking-Loader und Fokuswechsel uneinheitlich; Overlay-A11y muss separat geprüft werden. |
| `SeoFooterLinks`, `StickyBottomLine`, `CookieStorageNotice` | gemeinsame SEO-/Rechtsnavigation | Fixierter Rechtsbereich beansprucht mobil Platz; darf bei Umbau weder Fokus noch Inhalte verdecken. |
| `LegalPageShell`, `TrustPage`, `FeedbackPage`, `PriceCheckPage` | Spezialseiten auf gleicher Marke | unterschiedliche Inhaltsdichte; Verbrauchertext darf interne Indexierungsprüfung nicht als Erklärung einer leeren Liste benutzen. |
| `seo.js`, `apiBase.js`, `offers.js`, `keywordSearchSort.js`, `formatting.js`, Analytics | Policy, Requests, Zusammenführung, Sortierung, Darstellung | fachliche Guards erhalten; Request-/URL-/Statusvertrag bündeln statt Geschäftsfunktionen neu schreiben. |
| `HeroBlock`, `FaqSection`, `SavingsNotice`, `LegalInlineNotice` | im untersuchten öffentlichen Importgraphen keine aktive Verwendung gefunden | Kandidaten für spätere Bereinigung, keine Löschung im Audit und kein Beweis vollständiger Entbehrlichkeit. |

## C. Empfohlenes einheitliches Navigations- und Designkonzept

**Ein gemeinsamer Kaufklug-Rahmen mit einem Ergebnisvertrag und mehreren klaren Einstiegen.** Marke, Wortbild, vertraute Farbidentität und kostenlose Angebotssuche erhalten; Komponenten und Hierarchie umfassend modernisieren.

- Primäre Ziele bleiben **Suche, Stöbern, Top Deals, Liste**. Logo führt zur Homepage. Sichtbarer aktiver Zustand, echte Links mit korrekten URLs und normaler Browserhistorie; neue Tabs und Zurück funktionieren. Listenanzahl ohne permanente visuelle Konkurrenz zum Suchziel.
- Genau eine primäre Suche je Ansicht. Desktop in der Shell oder im Inhaltskopf, mobil kontextuell sichtbar. Wiederherstellung von Suchbegriff, Märkten, Kategorien und Sortierung aus dokumentiertem URL-/Ansichtszustand; keine privaten Listeninhalte in URLs oder Analytics.
- Einheitliche Filteroberfläche mit aktiven Chips, Trefferbezug, Reset und eindeutiger Anwendung. Mobile Filter als zugängliche kompakte Oberfläche; vor Umsetzung klären, ob sofort angewandt oder explizit bestätigt. Keine stillen Unterschiede zwischen Tabs. Häufige Produktsuche darf nicht eine Händlerauswahl erzwingen.
- Eine klare Seiten-H1, dann Suche/Filter, Trefferstatus und Karten. Auf Landings bleiben spezifische Vergleichshilfen sichtbar, nehmen aber nicht den gesamten ersten Bildschirm ein. Rechtliches dauerhaft erreichbar, weniger dominant; keine gleichzeitig konkurrierenden fixierten Leisten.
- Typografie: Inter/Manrope können erhalten bleiben; abgestufte Rollen für H1, Abschnitt, Preis, Produkt und Metadaten. Etwa 16 px als praktikable Basis und gut lesbare Navigation sind Designziele, keine pauschalen WCAG-Mindestgrößen. Weniger Versalien, starke Schatten und konkurrierende Pills; gemeinsames Abstandsraster und begrenzte Inhaltsbreite.
- Angebotskarte: Produkt und Menge → Händler/Bedingungen → Preis und sicherer Grundpreis → belegte Ersparnis → Gültigkeit/Datenstand → Listenaktion. Vergleichsdetails aufklappbar; Referenzart und Unsicherheit bleiben erreichbar. Keine künstlichen Rabatte, kein „bester Preis“ ohne Vergleichsgrundlage.
- Fehlende Bilder neutral mit Produkttext kennzeichnen. Kategorieillustration nur bei sicherer Zuordnung; niemals ein plausibel wirkendes, unbestätigtes Produktfoto erzeugen. Marken-/Quellenbadge darf nicht wie ein verifiziertes Produktfoto wirken.
- Projektziel für häufige Touchaktionen 44–48 px mit Abstand. **WCAG 2.2 AA verlangt grundsätzlich 24 × 24 CSS-Pixel oder die definierten Ausnahmen**, nicht generell 44 px. Gemessene 33 px hohe Navigationsbuttons sind daher nicht allein ein AA-Verstoß. [W3C: Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)

**H – Wirkungsmessung:** Sucherfolg über erste sinnvolle Ergebnisinteraktion, Nulltrefferquote, erfolgreiche Filteranpassung, Nachladen und Listennutzung untersuchen. Wiederkehrende Nutzung nur mit datenschutzgerechter, freigegebener Messung bewerten. Vorhandene Events belegen noch keinen vollständigen Conversion-/Retention-Funnel; keine Prozentverbesserung prognostizieren. Freiwillige Nutzertests mit typischen österreichischen Einkaufsaufgaben ergänzen.

## D. Fachlich belastbares Heatmap-Konzept

**Eine Kategorieübersicht, keine geografische Karte.** Sie beantwortet: „Wo gibt es in meinem gewählten Umfang aktuell belegbare Auswahl und wie gut ist die Evidenz?“ Sie verspricht weder Vollständigkeit des Marktes noch die höchsten Rabatte. Kein Google-Maps-/Geodienst erforderlich.

### Datenvertrag statt Rabattfarbe

Ein gemeinsamer, veröffentlichter Datenstand liefert pro kanonischer Kategorie folgende getrennte Größen. Grundlage sind ausschließlich öffentlich berechtigte, zum Bewertungszeitpunkt gültige Angebote nach dem bestehenden Public-Validity-/Snapshot-Vertrag; identische Angebote deduplizieren, BILLA/Plus nicht als unabhängige Handelsgruppen zählen.

| Dimension | Belegbarer Inhalt | Unsicherheit und Darstellung |
|---|---|---|
| Anzahl **N** | Zahl unterscheidbarer aktueller Public-Angebote im gewählten Scope | „Erfasste gültige Angebote“, niemals „alle Angebote Österreichs“. Null, unbekannt und API-Ausfall getrennt. |
| Referenzpreis **R/N** | Anteil mit passendem, nachvollziehbarem Referenzpreis gemäß bestehendem Typ-/Confidence-/Savings-Guard | Direkter Vorpreis, andere Referenzarten und fehlende Evidenz getrennt; keine pauschale Normalpreisbehauptung. |
| Vergleichbarkeit **C/N** | sichere Menge, Einheit, Produktgruppe und nutzbarer normalisierter Preis | Ein Literpreis macht unterschiedliche Produktarten nicht automatisch gleichwertig. Nicht vergleichbar und unbekannt getrennt. |
| Frische **F** | belegtes letztes Bestätigungsdatum, Gültigkeitsklasse und Ablaufgrenze; Anteil bekannter Datenstände | API-`generatedAt` ist keine Angebotsbestätigung. Vorhandene händlerspezifische TTL anwenden, keine neue universelle Frist erfinden. |
| Quellenvertrauen **T** | typisierte Quelle, erfolgreiche veröffentlichte Quellengeneration und überprüfbare Herkunft | Offizielle URL oder erfolgreicher Crawl allein beweist weder Preis noch Frist. Fehlender Vertrauensentscheid neutral. |

Keine willkürliche gewichtete 0–100-Gesamtnote. Für den Einstieg Auswahlumfang als zurückhaltende Intensität plus verständliche Evidenzmerkmale und Zähler verwenden. Fehlende Evidenz grau/neutral mit Erklärung, niemals als gute Qualität oder als nachgewiesener Fehler. Farbe immer mit Text/Icon ergänzen; Tastaturzugang, verständliche Linknamen und tabellarische/listenförmige Alternative. Klick öffnet die vollständige gefilterte Angebotsliste mit normaler Pagination.

### Was die heutige API tatsächlich trägt

**K/API-Stichprobe:** `GET /api/offers/ranking?q=kaffee&limit=1&offset=0&flat=true`, Antwortzeitstempel `generatedAt=2026-11-01T12:56:05.757Z`. Das ist eine Strukturstichprobe, keine vollständige Kategorieauswertung.

- Vorhanden: Kategorie-/Confidence-Felder, Menge und normalisierter Grundpreis, strukturierter `referencePrice` mit Typ/Quelle/Confidence/`allowsSavings`, `quality` mit Vergleichssicherheit/Issues, Quellen- und Evidence-URLs, Crawl-/Publish-IDs und Publishstatus.
- In der geprüften Public-Projektion nicht vorhanden bzw. nicht als belastbarer typisierter Entscheid verfügbar: `lastSeenAt`/`lastConfirmedAt`, `publicUntil`, Gültigkeitsklasse/-grund und vollständiger Source-Trust-/Quality-Entscheid. Vollständige Kategorieaggregate mit identischem Nenner fehlen ebenfalls.
- Deshalb keine seriöse vollständige Heatmap allein aus der ersten Suchseite, einem Ranking-Kandidatenfenster oder den 20 Top Deals ableiten. Vorhandene Qualitätsscores sind nicht automatisch ein kalibrierter Nutzerscore.

### Sicherer späterer Betrieb

Ein serverseitiges, nur lesendes Aggregat bzw. Readmodel soll vorhandene Public-Validity-, Klassifikations- und Quellenqualitätsentscheidungen wiederverwenden. Jede Antwort benötigt Scope, Auswertungszeit, Publish-/Generationskennung, Dimensionen samt Nennern und unbekannten Anteilen. Alle Kacheln stammen aus derselben Generation; keine Mischung alter und neuer Kategorien.

Cache nach erfolgreichem Publish invalidieren/erneuern und Laufzeit zusätzlich an relevante Ablaufgrenzen binden. Bei Fehlern letzten belegten Stand nur mit klarer Alters-/Fehlerkennzeichnung anzeigen; nach dessen erlaubter Frischegrenze keine „heute gültig“-Heatmap. Kein Angebot aus unbekannter Gültigkeit eigenständig freigeben. Nulltreffer bedeutet „keine belegten aktuellen Treffer im erfassten Bestand“, nicht „der Händler hat keine Angebote“.

Die Heatmap verändert weder Ranking, Public-Validity, Top-Deals-Limit noch SEO-Indexierungsschwellen. Ihre zukünftige Implementierung benötigt einen eigenen freigegebenen API-/Aggregatvertrag. Die offene TOP-DEALS-Bestandsdatenabnahme bleibt ein separater Auftrag, kein Bestandteil dieser Prüfung.

## E. Architektur-, Performance-, Accessibility- und SEO-Risiken

### Architektur und API-Verträge

**K:** `App.jsx` vereint Routing, Zustand und viele Effekte; etwa 880 Zeilen. `KeywordSearchPage.jsx` etwa 898 Zeilen; zentrale CSS-Datei 9.471 Zeilen. Das erhöht Änderungsfläche und CSS-Kopplung, ist für sich allein aber kein Fehler. Gemeinsame Layout-/Status-/Filterbausteine schrittweise extrahieren, keine neue Komplettarchitektur voraussetzen.

- Suche nutzt 60er-Seiten mit stabilem `resultSetToken`, Zusammenführung und Deduplizierung (`offers.js`, `keywordSearchSort.js`). Empfohlen lädt zuerst nur eine Seite. Globale Markt-/Ersparnissortierung sammelt alle Seiten, bevor sie das Ergebnis umsortiert. Das schützt Korrektheit, kostet aber zusätzliche Requests/Browserarbeit. Serverseitige globale Sortierung wäre ein gesonderter Vertragswechsel, kein stiller UX-Fix.
- Request-IDs verwerfen überholte Antworten; Requests werden damit nicht automatisch abgebrochen. Generische Fetchpfade ohne einheitlichen Abort-/Timeout-Vertrag bergen bei langsamen Netzen unnötige Arbeit. Cache-/Retry-Logik nicht in jede Ansicht erneut kopieren.
- Endpunkte für Ranking, Händler-/Kategoriefilter, Top Deals, Listensharing und Feedback haben verschiedene Zustandsverträge. Filter-/URL-Scope, Tokenwechsel, Deduplizierung, Ergebnisnenner und Fehlerzustände explizit festlegen. Share-/Feedback-POST wurden nicht getestet.
- **K:** Landing-Nachladefehler setzt auch den allgemeinen Fallback, obwohl alte Karten noch vorhanden sein können. Top-Deals-Fehler leert Daten korrekt, hat aber keinen expliziten Retry. Shared-List-Netzwerkfehler klingt wie abgelaufener Link. Clipboard-Fehler wird abgefangen, dennoch kann „Link wurde kopiert“ erscheinen. Gezielt mit Mocks prüfen, nicht durch produktive Schreiboperationen.
- `formatting.js:56` stellt Gültigkeit überwiegend als Datum ohne explizite Europe/Vienna-Zeitzone dar; ein belegtes Mittagsende wäre nicht sichtbar. Anzeigevertrag muss genaue Fristen erhalten und unbekannte Enddaten offenlassen. Keine gespeicherten Fristen in diesem Audit korrigiert.
- Top Deals wird bei Mount/Filterwechsel geladen; 45-Sekunden-Clientcache bewirkt keinen aktiven Refresh einer lange offenen Ansicht. **H:** „HEUTE VERIFIZIERT“ kann im Langzeittab überaltern. Bestehende Fehlerbehandlung zeigt nach fehlgeschlagenem Abruf keine alten Deals als neue erfolgreiche Antwort; Langzeittab-Ablauf wurde nicht zeitlich reproduziert.

### Performance

**K/Live:** Haupt-JavaScript `/assets/index-ByZN9DJV.js` 461.113 Bytes, CSS `/assets/index-BbkkJfK1.css` 154.523 Bytes, jeweils dekodierte Ressourcengröße und HTTP 200. Keine komprimierten Transfergrößen und keine LCP-/INP-/CLS-Werte. Die Quelldatei `index.css` hat 209.235 Bytes; diese Zahl nicht mit ausgeliefertem CSS gleichsetzen.

- Seiten einschließlich interner Diagnose werden eager importiert. Routebezogenes Lazy Loading und CSS-Abgrenzung sind plausible Optimierungen nach Profiling, keine belegte Einsparungszahl.
- Bild-Lazy-Loading mit 200-px-Vorlauf und feste Rahmen sind vorhanden. Tatsächliche Bildgewichte, LCP-Bildpriorität, Layoutverschiebungen, CPU-/Speicherkosten bei vielen Karten und Font-Ladeverhalten müssen gemessen werden. Externe Google-Fonts sind eine Netzwerkabhängigkeit.
- Kein kontrollierter Lighthouse-/WebPageTest-Lauf, keine gedrosselte Mobilfunkmessung und keine aktuellen CrUX-/Search-Console-CWV-Daten erhoben. Frühere Oktoberzeiten nicht als November-CWV ausgeben. Progressive Pagination erhalten; Virtualisierung erst bei belegtem Bedarf und unter SEO-/Fokusprüfung.

### Accessibility

**ROT, B + Berechnung:** kleine funktionale Texte mit `#7e8b97` unterschreiten 4,5:1 auch auf reinem Weiß. „Sortieren“, Suchhinweis und „Beispiele“ sind keine dekorativen Markenlogos. Kontrast aller Rollen und Zustände systematisch korrigieren. [W3C: Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)

**GELB:** Fehlende H1 in befüllter Liste und Suche, doppelte H1 im Unknown-Fallback, kein gefundener Skip-Link, kleine Mobilnavigation, unterschiedliche Fokusführung nach Filtern und mögliches Overlay-Zusammenspiel. Das sind konkrete Prüf-/Strukturpunkte; fehlende H1 oder ein fehlender Skip-Link allein beweisen nicht jeden denkbaren WCAG-Verstoß.

**Positiv, K/B:** beschriftete Suchfelder, `aria-pressed`-/Expanded-Zustände, native `details/summary`, Status-/Busy-/Alerttexte und vorhandene 2-/3-px-Fokusrahmen. Sichtbarkeit, Reihenfolge und Ansage wurden nicht vollständig mit Screenreader geprüft. Unbedingtes JavaScript-Smooth-Scrolling trotz Reduced-Motion-CSS separat prüfen.

Abnahme muss Tastatur, Screenreader, 200/400-%-Zoom, 320-CSS-px-Reflow, Textabstände, lange Produktnamen und Cookie-Erstbesuch umfassen. Fixierte Leisten dürfen fokussierte Elemente nicht vollständig verdecken; eine heutige Überdeckung ist nicht belegt. [W3C: Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum), [Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing). Keine vollständige WCAG-2.2-AA-Zertifizierung durch diesen Audit.

### SEO und Veröffentlichung

**K/Deployment:** Der November-Release hat SEO-Artefakte neu erzeugt. Ausgangspunkt sind laut dokumentierter TOP-DEALS-006-Abnahme 38 Policy-Seiten und 24 Sitemap-URLs; nicht der inzwischen überholte Oktober-Build. Die tägliche SEO-Refresh-Architektur ist weiterhin nicht umgesetzt. Neue UX-Frontend-Builds können unabhängig vom Layout eine neue datenabhängige Generation auslösen.

| Größere Änderung | Risiko | Erforderlicher Schutz |
|---|---|---|
| Shell/Navigation und Routing | bestehende Ziele verlieren crawlbare Links, History-/Canonical-Abweichung | echte Links, bestehende Pfade, einheitliche Canonicals und Build-/React-Policy; alte Aliasziele erhalten |
| Landing-Reihenfolge/Karten | spezifischer Inhalt oder Vergleichshilfe verschwindet aus Initial-HTML; dünne Seiten | spezifische Texte und nachvollziehbare Vergleichsgrenzen in Initial-HTML und React erhalten; keine nur clientseitige Ersatzseite |
| URL-basierte Filter/Sortierung | kombinatorischer Duplicate Content und Crawlbudget | Utilities/Parameter nicht unkontrolliert indexieren; Canonical-/Robots-Vertrag vor Änderung festhalten |
| Heatmap/interne Links | qualitätsgesperrte Landings werden als indexierbar beworben | SEO-Footer weiterhin nach derselben eingebetteten Generation filtern; Nutzersuchlink und SEO-Landing unterscheiden |
| Karten-/Bildmodernisierung | falsche Produktidentität, Schema weicht vom Sichtbaren ab | keine unbelegten Bilder/Preise/Verfügbarkeiten; strukturierte Daten und sichtbare Aussagen konsistent halten |
| Pagination/Virtualisierung | normale Ergebnisse verschwinden nach Startfenster | vollständiger Suchvertrag, keine Top-20-Übernahme; Zugänglichkeit und Auffindbarkeit separat prüfen |

Vor jedem späteren Release Initial-HTML, React, Robots-Policy, Sitemap, Canonicals, interne Links und vorhandene strukturierte Daten gegen dieselbe neue Generation prüfen. Aktuell beobachtet: Müller-/Preischeck-Fallback noindex, Utilityseiten noindex, Recht/Methodik indexierbar; `/liste/` kanonisiert zur Einkaufsliste. Unknown-Fallback bleibt fail-closed/noindex, obwohl seine Darstellung verbessert werden sollte. Keine Rankingwirkung und keine Google-Indexierung aus diesen Policies ableiten. Keine aktuellen GSC-Zahlen in diesem Audit verwendet.

## F. Priorisierte Roadmap UX-002 bis UX-005

Aufwand: grobe Entwicklungsschätzung in Personentagen einschließlich gezielter Tests, ohne neue Quellenanbindung, größere Backend-Neuarchitektur oder Wartezeiten auf Produktentscheidungen. Alle Schritte benötigen gesonderte Freigabe; kein paralleler großer Relaunch.

| Reihenfolge | Paket und Aufwand | Überprüfbare Abnahmekriterien |
|---|---|---|
| **UX-002** | **Gemeinsame Shell und stabile Navigation**, ca. **4–6 Tage**. Marken-/Layouttokens, eine Suche, echte Routelinks, History und Zustandswiederkehr; Kontrast und Fokus im gemeinsamen Rahmen. | Alle öffentlichen Routentypen bei 375/768/1440 bedienbar; zusätzlich 320 px/Zoom/Textabstände prüfen. Suche → Stöbern → Suche sowie Back/Forward erhalten vereinbarten Kontext. Kein doppeltes primäres Suchfeld. Kleine funktionale Texte ≥4,5:1, große ≥3:1; häufige Touchaktionen Projektziel 44–48 px, AA-Ausnahmen korrekt bewerten. Klare H1-Struktur, sichtbarer Fokus, keine verdeckten Aktionen. Liste/localStorage unverändert. SEO-Routen/Policy-Vertrag erhalten. |
| **UX-003** | **Einheitlicher Such-, Filter- und Ergebnisvertrag**, ca. **4–7 Tage**. Gemeinsame Filterzustände, URL-Wiederherstellung, Status/Retry, vollständige Pagination einschließlich Übersichts-Landings. | Normale Suche in deterministischen Fixtures 60 → 120 → Rest per Pointer, Tastatur und Touch, ohne Duplikate; niemals Top-20-Cap. Filter/Reset/Tokenwechsel und globale Sortierung über den vollständigen Bestand korrekt. Mehrfachabfrage-Landing ermöglicht vollständige Ergebnisnavigation und kennzeichnet Auswahl eindeutig. Empty ≠ Fehler ≠ Laden; alte Requestantwort überschreibt keine neue Suche, Nachladefehler erhält bestehende Treffer. |
| **UX-004** | **Vertrauenswürdige Angebotskarte und Liste**, ca. **4–6 Tage**. Einheitliche Informationshierarchie, sichere Bildfallbacks, genaue Gültigkeitsanzeige, Vergleichsdetails, Share-/Clipboard-Zustände. | Nagelpuder „Espresso“ erhält kein Kaffeebild; echte Lebensmittel behalten korrekte Zuordnung. Fehlende Bilder bleiben neutral. Unsichere Referenzpreise/Grundpreise erzeugen keine Ersparnisbehauptung. Belegte Uhrzeiten in Europe/Vienna einschließlich DST korrekt, unbekannte Frist unverändert unbekannt. Liste/Mengen/Abhaken bleiben erhalten. Clipboard-Verweigerung erzeugt keine Erfolgsmeldung; Share-/Fehlerzustände mit Fixtures statt Produktivmutationen testen. |
| **UX-005** | **Evidenzbasierte Kategorie-Heatmap und Erfolgsmessung**, ca. **5–9 Tage**, abhängig vom freigegebenen Readmodel/API-Vertrag. | N/R/C/F/T mit dokumentiertem Scope, Nenner und unbekannten Anteilen gegen vollständige Fixtures geprüft; nicht aus Top20/erster Seite berechnet. Ein Publish-Snapshot, sichere Ablauf-/Cachegrenzen; Ausfall und null unterscheidbar. Neutral bei fehlender Evidenz, ohne Rabatt-Gesamtscore. Tastatur-/Textalternative; Klick führt zur vollständig paginierten Liste. Messplan mit Datenschutz-/Einwilligungsgrenzen; keine erfundene Baseline. |

Gemeinsames Releasegate jedes Pakets: relevante Komponenten-/Vertragstests, Browserregressionen für Suche/Stöbern/Liste/Top Deals/Landings, Bilder und Preisguards, API-Fehlerfixtures, Meta-/Sitemap-/Link-/Schema-Abgleich und unveränderte fachliche Limits. Performance vor/nach unter gleicher Messkonfiguration vergleichen; erst dann konkrete Budgets beschließen. Kein UX-Auftrag ermächtigt einen Crawl, einen Datenpatch oder eine SEO-Schwellenänderung.

## G. Genau eine Empfehlung für die erste Implementierung

**UX-002: gemeinsame App-Shell und stabile Navigation zuerst freigeben.** Der reproduzierte Kontextverlust und die inkonsistente Suchführung liegen vor allen späteren Funktionen. Ein enger Umbau des gemeinsamen Rahmens samt Kontrast, Fokus und Browserhistorie schafft die Grundlage für konsistente Ergebnisse und Karten, ohne Ranking, Gültigkeit oder Quellen zu verändern. Die Heatmap folgt erst auf einen belastbaren Ergebnis- und Evidenzvertrag. Umsetzung erst nach ausdrücklicher Freigabe; keine automatische Produktionsfreigabe.

## H. Offene Evidenzlücken

- Nicht jede der 24 Landings wurde in allen drei Breiten und allen Datenzuständen interaktiv geprüft; vollständige Konfigurations-/Komponenteninventur ersetzt diese visuelle Einzelabnahme nicht. Geteilte Liste ohne verfügbare sichere Testfixture nur Codeanalyse.
- Pointer-Nachladen in dieser Browsersteuerung nicht zuverlässig bestätigt; Keyboard-Nachladen bis 120 dagegen belegt. Auf echtem Mobilgerät und mit kontrollierten Requests reproduzieren, bevor eine Ursache behauptet wird.
- Keine physische Touch-/iOS-/Android-/Safari-Prüfung, kein Screenreader, vollständiger Tastaturdurchlauf, Erstbesuch-Cookieoverlay, Zoom-/Reflow-/Textabstands-Kompletttest. Desktop-/Mobile-Viewport ist keine Geräteabnahme.
- Keine künstlich erzeugten produktiven API-Ausfälle, keine Share-/Feedback-Schreibtests und kein Clipboard-Fehlertest; Aussagen hierzu sind Codebefunde. Keine Zeitrafferprüfung eines über Mitternacht offenen Top-Deals-Tabs.
- Keine aktuellen Feld-CWV, reproduzierbaren Ladezeit-/Transfer-/CPU-Messreihen, Funnel-/Retention-Daten oder Nutzungsstudien. Kein Beleg, welcher UX-Eingriff wie viel Traffic oder Umsatz erzeugt.
- Public-API-Evidenz für Frische/Quellenvertrauen und vollständige Kategorieaggregate muss vor Heatmap-Implementierung fachlich spezifiziert werden. API-Generierungszeit allein genügt nicht.
- Offene reguläre TOP-DEALS-Bestandsdatenabnahme, SPAR-/Müller-Recovery, tägliche SEO-Refresh-Architektur und frische datierte GSC-Exporte bleiben getrennte Vorhaben. Dieser Bericht behauptet deren Abschluss nicht.

**Dokumentationsabschluss:** Nur dieser Bericht und der schlanke UX-Statusverweis im Kontext geändert. Produktcode und Produktionszustand unverändert; keine Implementierung begonnen.
