# einfachsparen – PLAN

## Ziel
Ein lokales MERN-Projekt mit online angebundener MongoDB, das öffentlich sichtbare aktuelle Angebote ausgewählter Supermärkte in der Steiermark erfasst, strukturiert, klassifiziert, normalisiert und im lokalen Admin-Dashboard prüfbar macht.

## Phase-1-Händler
- Hofer
- Lidl
- Spar
- Billa
- Billa Plus
- Adeg

## Phase-1-Region
- Steiermark
- falls sinnvoll zuerst Großraum Graz

## Phase-1-Zielbild
Die erste belastbare Version ist erreicht, wenn:
1. MongoDB live online angebunden ist
2. das Backend lokal läuft
3. mindestens 1–2 Quellen sauber gecrawlt werden
4. Angebote in MongoDB gespeichert werden
5. Rohdaten und bereinigte Daten getrennt sichtbar sind
6. Kategorien zugewiesen werden
7. Gültigkeit, Preis, Händler, Quelle, Bedingungen gespeichert sind
8. Normalisierung auf sinnvolle Einheiten sichtbar ist
9. ein lokales Admin-Dashboard Datenqualität prüfbar macht

## Nicht Ziel von Version 1
- fertige Consumer-App
- perfekte Echtzeit-Navigation
- voll ausgebaute Mobile-App
- alle Händler auf einmal
- alle Rabattfälle zu 100% final implementiert

## Kernprinzip
Schnellstmögliche Verifikation statt maximaler Feature-Breite.

## Technische Reihenfolge
1. ENV-Konzept
2. Mongo-Connection
3. Collections/Schema/Indizes
4. Crawling-Jobs
5. Quelle 1 integrieren
6. Quelle 2 integrieren
7. Parsing- und Normalisierungsschicht
8. Klassifikationsschicht
9. Admin-Dashboard lokal
10. Preisvergleich
11. spätere Routing-Vorbereitung
12. Mobile später

## Entscheidungsprinzip
Immer zuerst:
- saubere Daten
- dann Sichtbarkeit
- dann Bewertung
- dann Optimierung