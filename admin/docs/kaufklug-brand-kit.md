# kaufklug Brand & UI Kit

## Zweck

Diese Referenz dokumentiert den freigegebenen Web-Stand von kaufklug.at als praktische Grundlage fuer spaetere App-Anpassungen. Sie ist kein Marketing-Manifest, sondern eine Engineering- und Design-Referenz fuer Web, React Native und kuenftige Codex-Prompts.

## Markenrichtung

kaufklug wirkt ruhig, modern, hochwertig, vertrauenswuerdig, alltagsnah und subtil. Die Oberflaeche soll nicht wie eine aggressive Coupon-App wirken, nicht generisch gruen werden und keine Garantie- oder Bestpreis-Claims verwenden.

## Farbpalette

| Rolle | Web Token / Wert | Verwendung | App-Hinweis |
| --- | --- | --- | --- |
| Brand Primary / Teal | `--kk-brand-primary: var(--kk-green) -> #1f5a4b` | Hauptaktionen, Fokus, aktive States | Als `brand.primary` uebernehmen |
| Brand Dark / Ink | `--kk-ink: #18201c`, `--kk-brand-primary-dark: var(--kk-green-dark) -> #123d34` | Text, aktive Navigation, starke Teal-Flaechen | `text.primary`, `brand.primaryDark` |
| Warm Background | `--kk-background-warm: var(--kk-bg-soft) -> #f7f4ee` | Seitenhintergrund und warme Grundstimmung | Screen-Background, keine kalten Grauwerte |
| Surface / Card | `--kk-surface: var(--kk-card) -> rgba(255, 252, 247, 0.94)` | Panels, Karten, Controls | Card-Background mit sehr leichter Transparenz simulieren |
| Elevated Surface | `--kk-surface-elevated: var(--kk-card-strong) -> rgba(255, 252, 247, 0.99)` | Hover/aktive Oberflaechen, modale Flaechen | Fuer Bottom Sheets und aktive Controls |
| Border | `--kk-border-subtle: var(--kk-border) -> rgba(128, 112, 88, 0.22)` | Karten, Panels, dezente Trennung | `border.subtle` |
| Muted Text | `--kk-text-muted: var(--kk-muted) -> #66706a`, `--kk-muted-2: #747c76` | Meta, Gueltigkeit, Hilfstexte | `text.muted`, `text.subtle` |
| Condition Background | `--kk-condition-bg: rgba(255, 241, 214, 0.94)` | Bedingungs-Pills direkt am Preis | `condition.bg` |
| Condition Border | `--kk-condition-border: rgba(226, 185, 111, 0.58)` | Bedingungs-Pills und Boxen | `condition.border` |
| Condition Text | `--kk-condition-text: #5b3b00`, `--kk-condition-text-strong: #4b3100` | Bedingungstext | `condition.text` |
| Savings / Value Accent | `--kk-value-bg: rgba(228, 240, 234, 0.9)`, `--kk-value-text: #2f6f4e` | Ersparnis, Grundpreis, Listen-Summary | Sichtbar, aber nie staerker als Preis und Condition |
| Error / Warning | `--kk-red: #922d2d`, `--kk-red-soft: #fff0ec` | Fehlerstatus, gefaehrliche Aktionen | Nur fuer echte Fehler oder destructive Actions |
| Retailer Orientation | `retailerColors.js` Werte, z. B. BILLA `#d63b2e`, SPAR `#19944a`, HOFER `#184a96` | Orientierung pro Haendler | Nicht als kaufklug-Hauptmarke verwenden |

Radius- und Interaktionswerte: `--kk-radius-xl: 1.65rem`, `--kk-radius-lg: 1.2rem`, `--kk-radius-md: 0.95rem`, `--kk-radius-sm: 0.72rem`, `--kk-touch: 48px`. Shadows bleiben warm und weich: `--kk-shadow-soft`, `--kk-shadow-card`, `--kk-shadow-hover`.

## Typografie

Basisfont ist `--kk-font`: Inter, System-UI und Fallbacks. Letter-spacing bleibt im Fliesstext und in kompakten UI-Elementen bei `0`; Eyebrows duerfen leicht gesperrt sein.

| Ebene | Web-Regel | App-Hinweis |
| --- | --- | --- |
| Hero Headline | `font-weight: 850`, kompakt, `line-height` ca. `1.0-1.08` | Hero mobil platzsparend halten |
| Hero Copy | `Angebote finden. Einfach sparen.` | Exakt als freigegebene Hero-Copy fuehren |
| Section Headings | ca. `1.22-2.35rem`, `font-weight` hoch, kurze Zeilen | Keine uebergrossen Dashboard-Headlines |
| Search Labels | Eyebrow/Label klein, `font-weight: 800+` | Suche bleibt Hauptfokus |
| Offer Card Title | ca. `1.03-1.16rem`, `line-height: 1.24-1.25` | 2-3 Zeilen mobil akzeptabel |
| Price | `clamp(1.72rem, 3.2vw, 2.2rem)`, `font-weight: 900` | Staerkster visueller Anker |
| Condition Text | `0.74-0.84rem`, `font-weight: 790-860` | Direkt sichtbar, nahe beim Preis |
| Meta / Gueltigkeit | `0.78-0.9rem`, muted | Sichtbar, aber ruhiger als Preis/Condition |
| Button Text | `font-weight: 780-850`, Touch-Ziel mindestens 48px | Keine zu kleinen Tap-Ziele |
| Mobile Navigation | kompakt, aktive Tabs stark, inaktive Tabs ruhig | In App als Bottom Tabs/Top Tabs angleichen |

## Komponentenregeln

- Header/Nav: Sticky, warmes Surface, Logo links, Hauptnavigation kompakt. Aktiver Zustand nutzt Deep Teal Gradient.
- Mobile Nav: drei Hauptziele `Suche`, `Stöbern`, `Liste`; aktive Seite muss eindeutig sein.
- Hero: platzsparend, Suche schnell erreichbar, keine Marketing-Schwere. Hauptcopy bleibt `Angebote finden. Einfach sparen.`
- Hero-Haendlerchips: alle sichtbaren Haendler mobil vollstaendig zeigen, zweizeilig statt horizontalem Overflow.
- Search Input: grosser Pill-Input, Fokus mit Teal-Ring, CTA als Primary Button.
- Trust Chips: kompakt, ruhig, keine Garantie. Trust-Hinweis bleibt: `Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.`
- Buttons: Primary = Teal Gradient, Ghost = warmes Surface mit Teal Text, Danger = red text auf warmem Rot-Soft.
- Retailer Chips: Haendlerfarbe dient Orientierung. Aktiv darf die Haendlerfarbe tragen, aber kaufklug bleibt Warm Neutral + Teal.
- Filter Chips: Pill-Form, aktive Chips Teal, partielle Auswahl soft Teal.
- Offer Card: zweispaltig auf Desktop, kompakt auf Mobile, Haendlerstreifen links, Preis/Condition im Entscheidungsbereich.
- Product Image Placeholder: warm-neutral, ruhig, Text `Bild folgt`; Bild ist hilfreich, aber nicht primaerer Informationsanker.
- Condition Pill/Box: Sand/Amber, direkt sichtbar, nahe beim Preis. Lange Conditions als Box, nicht versteckt.
- Shopping List Summary: bekannte Ersparnis prominent, aber mit Erklaerung. Summen nur aus belastbaren Savings-Daten.
- Shopping List Controls: weitere Angebote, Teilen, erledigte anzeigen/ausblenden, Liste leeren; destructive Actions ruhig, aber klar.
- Empty/Loading States: kurze praktische Hinweise, warme Panels, keine Garantieclaims.
- Footer/Legal: kompakte Bottom-Line, Rechtliches erreichbar, keine QR-/App-Prominenz solange deaktiviert.

## Angebotskarten-Hierarchie

1. Haendler / Marktformat
2. Titel
3. Aktueller Preis
4. Condition / Bedingung
5. Menge / Grundpreis
6. Gueltigkeit / Aktualitaet
7. Kategorie
8. Bild
9. Savings-Hinweis nur belastbar und nie dominanter als Preis oder Condition

## Conditions-Regel

Conditions sind Preiswahrheit. Wenn ein Angebot nur unter einer Bedingung gilt, muss diese Bedingung direkt sichtbar, nahe beim Preis und nicht hinter Accordion/Button versteckt sein. Die Darstellung bleibt warm Sand/Amber, sichtbar und ruhig, nicht grell.

## Einkaufsliste / Ersparnis

Die Einkaufsliste summiert bekannte Ersparnisse ueber denselben belastbaren Savings-Pfad wie die Karten-Badges. Mengen werden einmal auf Listenebene beruecksichtigt. Es werden keine Ersparnisse erfunden; Angebote ohne Vergleichspreis zaehlen nicht zur Ersparnis. Lokale Altlisteneintraege koennen ohne Savings-Felder gespeichert sein und duerfen die Summe nicht kuenstlich erhoehen.

## Do / Don't

Do:

- Ruhig, klar und kompakt bleiben.
- Trust sichtbar halten.
- Mobile first denken.
- Preis und Bedingung prominent zeigen.
- Haendler klar markieren.
- Suche als Hauptfokus behandeln.

Don't:

- Keine Garantieclaims.
- Keine aggressive Coupon-Sprache.
- Keine grellen Rabatt-Badges.
- Conditions nicht verstecken.
- Nicht wieder generisch gruen werden.
- Keine App-/QR-Prominenz, solange deaktiviert.

## App-Uebernahme-Hinweise

- Web Header/Nav entspricht spaeter App Tabs fuer `Suche`, `Stöbern`, `Liste`.
- Web Offer Card entspricht App Offer Card: Haendlerbadge, Titel, Preis, Condition, Grundpreis, Gueltigkeit, Listenaktion.
- Web Shopping List Summary entspricht App Listen-Kopf: bekannte Ersparnis, Artikelzahl, Maerkte, Trust-Hinweis.
- Web Search Flow entspricht App Suchscreen: Search Input zuerst, optionale Marktfilter, Sortierung ruhig.
- Web Browse Flow entspricht App Browse/Filter Screen: Haendler zuerst, Kategorien optional.
- Web Conditions-Darstellung direkt als RN `ConditionPill` und `ConditionBox` uebernehmen.
- Web Product Image Placeholder als App Placeholder uebernehmen: warm-neutral, `Bild folgt`, keine laute Illustration.
- Retailer Chips in der App mit denselben Haendlerfarben und derselben Gruppierungslogik uebernehmen.
- Tokens in React Native als semantische Rollen abbilden, nicht als lose Hex-Werte in Komponenten streuen.

## Offene Watchlist

- Tatsaechliche Bildabdeckung aus Datenquellen beobachten.
- Zufaellige Suchbeispiele spaeter nach Live-Abnahme pruefen.
- Weitere Typografie-Finishes nur nach Live-Abnahme starten.
- App-Anpassung spaeter planen, nicht in dieser Doku-Welle.
- QR-/Android-Testdownload bleibt deaktiviert, bis Produkt und Datenqualitaet dafuer bereit sind.
