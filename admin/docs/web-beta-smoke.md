# Web Beta Smoke

Kleiner, wiederverwendbarer Browser-Smoke fuer kaufklug.at Web/Admin. Der Check nutzt einen lokal vorhandenen Chrome
oder Edge per DevTools Protocol und fuehrt nur lesende Seitenaufrufe aus.

## Lokal ausfuehren

1. Admin-Abhaengigkeiten installieren, falls noch nicht vorhanden:
   ```sh
   npm install
   ```
2. Build und Preview starten:
   ```sh
   npm run build
   npm run preview -- --host 127.0.0.1 --port 4173
   ```
3. In einem zweiten Terminal den Smoke starten:
   ```sh
   npm run smoke:web-beta
   ```

Default Base URL: `http://127.0.0.1:4173`.

Wenn die lokale Preview keinen API-Proxy hat, kann der Smoke-Browser eine lesende API-Base injizieren:

```sh
KAUFKLUG_SMOKE_API_BASE_URL=https://www.kaufklug.at/api npm run smoke:web-beta
```

Falls Chrome/Edge nicht automatisch gefunden wird:

```sh
CHROME_PATH=/pfad/zu/chrome npm run smoke:web-beta
```

## Gegen Live ausfuehren

```sh
KAUFKLUG_SMOKE_BASE_URL=https://www.kaufklug.at npm run smoke:web-beta
```

Der Live-Modus oeffnet nur oeffentliche Web-Routen und loest nur normale GET-/Browser-Lesezugriffe aus. Es werden keine
Admin-Keys genutzt und keine Production-Daten mutiert.

## Geprueft

- `/` ist erreichbar.
- Hero enthaelt exakt `Angebote finden. Einfach sparen.`
- Trust-Hinweis ist sichtbar: `Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.`
- Android-Testdownload-/QR-Hinweise sind nicht sichtbar.
- Mobile Viewport mit ca. 390 px zeigt alle Hero-Haendler:
  BILLA, BILLA Plus, SPAR, EUROSPAR, INTERSPAR, HOFER, Lidl, dm, BIPA, PAGRO, PENNY.
- Mobile Startseite und Stoebern haben keinen offensichtlichen horizontalen Overflow.
- `/suche?q=kaffee` ist erreichbar und zeigt Karten oder einen plausiblen Ergebniszaehler.
- `/stoebern` ist erreichbar, zeigt Intro und Markt-Auswahl.
- Mobile Marktbuttons in Stoebern wirken nicht offensichtlich als endlose Einspaltenliste.
- `/einkaufsliste` und `/liste` sind erreichbar und zeigen einen leeren oder gefuellten Einkaufslistenbereich.
- Sichtbare Fehlerzustaende und Browser-/JavaScript-Fehler lassen den Smoke fehlschlagen.
- Sichtbare Trust-/Claim-Guards lassen den Smoke fehlschlagen, insbesondere:
  `bester Preis`, `garantiert sparen`, `immer günstigster Preis`, `Weitere Bedingung anzeigen`,
  `Android-Testversion laden` sowie erkennbare QR-/Android-Testdownload-Hinweise.

## Bewusst nicht geprueft

- Keine Crawls, Reindex-, Repair-, Upload-, APK- oder Version-JSON-Logik.
- Keine Admin-, Backend-, DB- oder Production-Datenmutation.
- Keine vollstaendige visuelle Regression und keine Pixelvergleiche.
- Keine Preisrichtigkeit, Angebotsvollstaendigkeit oder Datenqualitaetsbewertung.
- Keine App-/React-Native-Pruefung.
- Keine Google-Maps-, Routing-, Places- oder Directions-Pruefung.

## Hinweise

- Der Smoke ist absichtlich klein und ohne neue npm Browser-Abhaengigkeit gehalten.
- Fuer lokale Preview-Pruefungen muss die gebaute App die API erreichen koennen. Gegen Live ist das ueber
  `https://www.kaufklug.at/api` der normale oeffentliche Leseweg. Bei Bedarf kann
  `KAUFKLUG_SMOKE_API_BASE_URL` nur fuer den Smoke-Browser gesetzt werden. Falls die API Cross-Origin-Aufrufe von
  lokaler Preview nicht erlaubt, ist der Live-Smoke der belastbare Browser-Smoke.
- Der Timeout kann bei Bedarf erhoeht werden:
  ```sh
  KAUFKLUG_SMOKE_TIMEOUT_MS=60000 npm run smoke:web-beta
  ```
