# einfachsparen – AGENTS.md

## Projektkontext
Dieses Projekt heißt vorerst **einfachsparen**.
Pfad lokal: `C:\coding\einfachsparen`

Ziel ist eine belastbare MERN-Architektur mit späterer React-Native-App für ein System, das aktuell gültige Angebote großer österreichischer Supermärkte/Nahversorger erfasst, klassifiziert, normalisiert, speichert und später für Nutzer optimiert.

## Harte Prioritäten
1. **MongoDB von Anfang an live online**
   - Datenbank nicht lokal
   - Backend lokal
   - Admin-Frontend lokal
   - Mobile später

2. **Backend zuerst**
   - Crawling
   - Klassifikation
   - Normalisierung
   - Speicherung in MongoDB

3. **Datenmodell zuerst sauber**
   Das Datenmodell muss von Anfang an alle relevanten Informationen tragen können:
   - Crawling-Rohdaten
   - Quelle
   - Händler
   - Angebotsdaten
   - Gültigkeit
   - Preise
   - Vergleichseinheiten
   - Rabattmechanik
   - Kundenkarten-/App-Bedingungen
   - Klassifikation
   - Admin-Prüfstatus
   - spätere Optimierungs- und Routingdaten

4. **Admin-Dashboard früh**
   Das Admin-Dashboard dient zuerst als Qualitäts- und Diagnosewerkzeug.
   Es muss früh sichtbar machen:
   - was gecrawlt wurde
   - welche Felder erkannt wurden
   - wie klassifiziert wurde
   - wie normalisiert wurde
   - was fehlt
   - was unklar ist
   - ob das Datenmodell richtig gewählt ist

5. **Frühe Verifikation**
   Die Architektur und Reihenfolge müssen so gewählt werden, dass möglichst schnell eine erste lokal prüfbare, fachlich belastbare Version testbar ist.

## Fachlicher Scope – Phase 1
### Region
- Zunächst Steiermark
- wenn sinnvoll zum Start: Großraum Graz

### Händler
Verbindlich in Phase 1:
- Hofer
- Lidl
- Spar
- Billa
- Billa Plus
- Adeg

Nicht in der ersten Version:
- Lagerhaus vorerst raus

### Kategorien
Phase 1 fokussiert auf typische Supermarkt-/Nahversorger-Kategorien:
- Lebensmittel
- Getränke
- Drogerie / Hygiene
- haushaltsnahe Kategorien, soweit sinnvoll

Keine unnötig breiten Spezialkategorien in Phase 1.
Das System muss aber später erweiterbar sein.

## Datenquellen / Crawling
Das System soll aggressiv, aber legal arbeiten.

Erlaubt:
- offizielle Händler-Webseiten
- öffentlich zugängliche Online-Prospekte
- PDF-Prospekte
- öffentlich sichtbare Angebotsseiten
- Prospekt-/Angebots-Aggregatoren
- sonstige öffentlich sichtbare, legal erfassbare Angebotsinformationen

Nicht erlaubt:
- Login-Umgehung
- Paywall-Umgehung
- geschützte Accounts

## Produktlogik
Das System soll perspektivisch:
- aktuell gültige Angebote zeigen
- diese realistischen Kategorien zuordnen
- Normalpreise und Angebotslogik verstehen
- monetär beste aktuelle Angebote je Kategorie erkennen
- Ersparnis transparent zeigen
- alternative Angebote anzeigen
- später Route / Reihenfolge / Navigation optimieren

### Arbeitslogik
- Primär Kategorieebene
- Nicht auf perfekter SKU-/EAN-Ebene starten
- Architektur muss spätere Verfeinerung erlauben

## Rabatt-Engine
Die Architektur muss folgende Angebotsformen abbilden können:
- 1+1 gratis
- 2 für 1
- 4 für 2
- ab x Stück Rabatt
- Prozentpickerl
- Rabattmarken
- Mindestkaufwerte
- nur mit Kundenkarte / App / Konto
- Ausschlüsse / Ausnahmen
- kombinierbar / nicht kombinierbar

Für Version 1 gilt:
- Die Datenstruktur muss das sauber speichern können.
- Die erste Implementierung muss die wichtigsten Angebotsformen sichtbar machen.
- Anbieterübergreifender Preisvergleich auf normalisierter Basis ist Ziel.

## Normalisierung / Vergleich
- Preise müssen auf sinnvolle Einheiten normalisiert werden:
  - €/kg
  - €/l
  - €/Stück
  - etc.
- Nur sichere Vergleiche
- Keine spekulativen Behauptungen
- Wenn Vergleich unsicher ist, Vergleich unterlassen oder Unsicherheit explizit machen

## Kundenprogramme
Das System muss speichern und anzeigen können:
- öffentlich gültiges Angebot
- nur mit Kundenkarte / App / Konto gültiges Angebot

Das muss später filterbar sein.
Personalisierte individuelle Rabatte sind nicht allgemeine Grundlage.
Optional später als User-Zusatzinput möglich.

## Zeitlogik
Priorität:
- jetzt gültig
- jetzt kaufbar
- jetzt relevant

Daher:
- Startdatum und Enddatum exakt speichern
- Öffnungszeiten später mitdenken
- keine abgelaufenen Angebote in aktiver Logik
- tägliches Crawling als Basis
- neue Prospekte erkennen und gezielt neu crawlen, wenn möglich

## Admin-Dashboard
Das Dashboard ist zuerst kein hübsches Consumer-Produkt, sondern ein Diagnosewerkzeug.

Es muss möglichst früh zeigen:
- Quellen
- Crawling-Jobs
- Crawl-Ergebnisse
- Angebotslisten
- Rohdaten
- Klassifikation
- Normalisierung
- fehlende Felder
- fehlerhafte Felder
- Prüfstatus
- Admin-Korrekturen

Im ersten Durchlauf hat der Admin volle Rechte.

Das Dashboard soll außerdem eine kompakte Zusammenfassung der Datenqualität erzeugen können, damit diese in ChatGPT zur Analyse verwendet werden kann.

## Google Maps / Navigation / Directions
Routing ist später wichtig.
Falls Google Maps, Directions API, Places API, Geocoding oder ähnliche externe Dienste konkret gebraucht werden:
- zuerst den User fragen
- nur vorhandene valide Zugangsdaten / API Keys verwenden
- keine Keys erfinden
- keine Fake-Konfigurationen anlegen

## Arbeitsweise für Codex
Bevor du Code erzeugst:
1. fasse zuerst klar zusammen, was du verstanden hast
2. nenne Kernziele, Prioritäten, Risiken, Annahmen
3. frage explizit, ob alles richtig verstanden wurde oder ob noch Fragen offen sind

Du darfst NICHT direkt mit Code starten, bevor diese Verständnisrückmeldung erfolgt ist.

## Implementierungsstil
- pragmatisch
- wenig Overengineering
- schnell verifizierbar
- lokale Testbarkeit früh
- klare Struktur
- kleine Schritte
- nach jedem größeren Schritt kurz begründen, warum dieser Schritt jetzt kommt

## Reihenfolge
Die Umsetzung soll in dieser Logik gedacht werden:
1. Mongo-Connection + ENV-Konzept
2. Datenmodell / Collections / Indizes
3. Crawling-Pipeline-Grundgerüst
4. erste Quelle(n) anbinden
5. Speicherung + Rohdaten
6. Klassifikation + Normalisierung
7. Admin-Sicht
8. Preisvergleich
9. Routing später
10. Mobile später

## Antwortformat
- klare Überschriften
- nummerierte Listen
- präzise
- kein unnötiger Text
- zuerst Verständnis, dann Rückfragen, dann Phasenplan