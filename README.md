# Topomapper

Topomapper ist eine browserbasierte Single-Page-Anwendung, die topografische Kartenmotive direkt im Browser erzeugt. Die App kombiniert Höhenlinien (Open‑Elevation), OSM‑Vektordaten (Overpass) und Basiskarten (OpenTopoMap) zu druck- und exportfähigen Designs.

## Überblick

- **Interaktiver Karten-Viewport** mit Viewfinder für das Ausgabeformat.
- **Formatwahl & Maße** (Rechteck, DIN, Quadrat, Kreis, Hexagon) inkl. Live‑Badge.
- **Mehrstufiger Workflow**: Schritt 1 (Frame wählen), Schritt 2 (Design anpassen), Schritt 3 (Export).
- **Layer-Editor** für Konturen, Wasserflächen, Flüsse, Straßen, Grünflächen und Labels.
- **Farb- und Stilsteuerung** inkl. Presets, Opazität, Linienbreite, Glättung.
- **Hypsometrische Flächenfüllung** (PNG‑Layer) mit Farbschema, Blend‑Mode und Gradientensteuerung.
- **Exports**: PNG (hochauflösend), DXF (Vektor/Laser), 3MF (3D‑Relief).

## Datenquellen & externe Dienste

Die Anwendung lädt Daten direkt aus öffentlichen APIs/CDNs:

- **OpenTopoMap Tiles** als Hintergrundkarte.
- **OpenStreetMap Nominatim** für die Ortssuche.
- **Overpass API** für Vektor‑Features (Straßen, Wasser, Grün, Labels).
- **Open‑Elevation API** für Höhenraster.
- **Leaflet** und **JSZip** via CDN.

## Nutzung

Da es sich um eine statische Anwendung handelt, genügt ein lokaler Webserver:

```bash
python -m http.server 8000
```

Anschließend im Browser öffnen:

```
http://localhost:8000/
```

> Hinweis: Direkte API‑Aufrufe benötigen eine aktive Internetverbindung.

## Workflow (Kurz)

1. **Ort suchen** und gewünschtes Format/Größe wählen.
2. **Generate Preview** erzeugt die Vorschau und lädt Höhen- und OSM‑Daten.
3. **Design anpassen** (Step 2) – Layer aktivieren, Farben/Opazität einstellen, Hypsometrie konfigurieren.
4. **Export** (Step 3) – PNG, DXF oder 3MF herunterladen.

## Exportformate

- **PNG**: Poster‑Export mit einstellbarer Kantenlänge; optional als „Layered Height Bands“ mit Hillshade.
- **DXF**: Vektor‑Export der Konturen und OSM‑Layer für Laser/CNC.
- **3MF**: Wasserdichtes Terrain‑Mesh für 3D‑Druck; Reliefhöhe konfigurierbar.

## Bedienungshinweise

- **Auto‑Preview** kann in der Vorschau deaktiviert werden, um Performance zu verbessern.
- **Reset Step 2 Defaults** stellt Design‑Defaults wieder her.
- **Layer‑Reihenfolge** lässt sich per Drag‑and‑Drop verändern.

## Projektstruktur

- `index.html` – Vollständige App (HTML/CSS/JS).
- `assets/` – Statische Assets (Logo etc.).
- `LICENSE` – Lizenztext.

## Letzte Änderungen (aktueller Stand)

- Verbesserte Aktualisierung des Vorschau‑Hintergrunds bei Designänderungen.
- Reset‑Funktion für Step‑2‑Defaults im Design‑Panel.

## Lizenz

Dieses Projekt steht unter der Lizenz aus der Datei [LICENSE](LICENSE).
