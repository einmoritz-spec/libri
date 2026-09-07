# Libri

Lesetracker als installierbare Web-App. Bücher per ISBN-Barcode scannen, Metadaten
automatisch holen, Bestand und Lesefortschritt verwalten. Alle Daten bleiben auf dem Gerät.

## Einrichten

1. Auf GitHub ein leeres Repository namens **libri** anlegen (öffentlich, ohne README).
2. Diesen Ordner hineinschieben:

```bash
cd libri
git init
git add .
git commit -m "Libri v1"
git branch -M main
git remote add origin https://github.com/DEIN-NAME/libri.git
git push -u origin main
```

3. Im Repository unter **Settings → Pages** bei *Source* **GitHub Actions** wählen.
4. Der erste Build läuft automatisch. Danach liegt die App unter
   `https://DEIN-NAME.github.io/libri/`.

Wenn du das Repository anders nennst, muss `base` in `vite.config.js`, `start_url` und
`scope` im Manifest sowie die Pfade in `index.html` entsprechend angepasst werden.

## Installieren

- **Android/Chrome:** Seite öffnen → Menü → „App installieren“.
- **iPhone/Safari:** Seite öffnen → Teilen → „Zum Home-Bildschirm“.

Auf dem iPhone ist das nicht optional. Safari löscht die Daten einer nur im Tab
besuchten Website nach sieben Tagen ohne Besuch; installiert bleiben sie erhalten.
Lade zusätzlich regelmäßig eine Sicherung herunter (Mehr → Sicherung).

## Lokal entwickeln

```bash
npm install
npm run dev
```

Der Kamerazugriff braucht HTTPS oder `localhost`. Um vom Handy aus zu testen:
`npm run build && npm run preview -- --host` und über einen HTTPS-Tunnel öffnen.

## Wie es gebaut ist

```
src/
  lib/db.js          Dexie-Schema, Fortschrittslogik, Export/Import
  lib/metadata.js    ISBN-Prüfung, Abruf bei Google Books + Open Library
  lib/scanner.js     Kamera, BarcodeDetector mit ZXing-Fallback
  components/        Bibliothek, Scannen, Detail, Formular, Statistik, Einstellungen
```

Der Scanner nimmt auf Chrome die native `BarcodeDetector`-API und lädt ZXing nur dann
nach, wenn der Browser sie nicht kennt — auf iOS also. Die 400 KB WebAssembly landen
deshalb nur dort im Speicher, wo sie gebraucht werden.

Metadaten kommen aus zwei Quellen, die feldweise zusammengeführt werden. Google Books
ist bei Seitenzahl und Sprache zuverlässiger, Open Library liefert Cover mit
CORS-Headern, weshalb nur die sich als Blob speichern und offline anzeigen lassen.
Findet keine Quelle etwas, öffnet sich das Formular mit vorausgefüllter ISBN.

## Geplant

Die Regal-Ansicht mit Buchrücken und Drag-and-drop. Die Felder `shelfRow`,
`shelfIndex` und `spineColor` liegen bereits in jedem Datensatz und werden beim Scannen
befüllt — die Ansicht lässt sich also ohne Datenmigration nachrüsten.
