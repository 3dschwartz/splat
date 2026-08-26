# Gaussian Splat Teleport Viewer

Ein minimaler, quelloffener Web-Viewer für 3D Gaussian Splats mit
**Teleport-Bewegung** (Klick = sofortiger Sprung, kein Gleiten/Fahren)
und **voxelbasierter Kollisionserkennung**, gebaut auf der
[PlayCanvas Engine](https://github.com/playcanvas/engine) – derselben
Engine, auf der auch [SuperSplat](https://superspl.at) und der
offizielle [SuperSplat Viewer](https://github.com/playcanvas/supersplat-viewer)
laufen.

Keine Build-Tools nötig: einfach `index.html` öffnen (per lokalem
Server, s. u.) oder auf GitHub Pages deployen.

## Nutzung

```bash
# lokal starten (ES-Module brauchen einen Server, file:// reicht nicht)
npx serve .
# oder: python3 -m http.server
```

Dann im Browser eine `.ply`-Datei (Standard-3DGS-Export, ASCII oder
`binary_little_endian`) per Drag&Drop ins Fenster ziehen oder über den
Datei-Dialog auswählen.

- **Umschauen:** Maus/Finger gedrückt halten und ziehen
- **Teleport:** einfacher Klick/Tap auf eine Stelle im Splat

## Wie die Kollision funktioniert

Ein Gaussian Splat hat keine echte Geometrie – nur ein Punkt-/
Ellipsoid-Wolke. Für Kollision wird beim Laden ein **eigenes,
sparse Voxel-Occupancy-Grid** aus den Splat-Zentren der `.ply`-Datei
gebaut (`src/voxel-grid.js`):

1. `src/ply-parser.js` liest die rohen `x,y,z`- (und `opacity`-)
   Werte direkt aus der PLY-Datei.
2. Splats mit sehr niedriger Opacity werden herausgefiltert
   (Rauschen/Floater).
3. Jeder verbleibende Splat markiert seinen Voxel (Standard: 15 cm
   Kantenlänge, einstellbar in der UI) als "fest".
4. Beim Klick wird ein Strahl von der Kamera durch den Klickpunkt
   geschossen und Schritt für Schritt gegen dieses Voxelgrid getestet
   (einfache DDA-artige Suche). Der erste feste Voxel ist der
   Treffpunkt.
5. Vor dem Teleport wird geprüft, ob am Zielpunkt genug **Kopffreiheit**
   besteht (Standard 1,7 m) – Ziele "in der Wand" werden abgelehnt.

Das ist bewusst einfach gehalten und läuft komplett im Browser, ohne
Preprocessing-Schritt.

## Bezug zu SuperSplat / Ausbaupfad

PlayCanvas/SuperSplat haben mit
[`splat-transform`](https://github.com/playcanvas/splat-transform)
ein eigenes, sehr viel ausgefeilteres Voxel-Kollisionsformat
(`.voxel.json` + `.voxel.bin`, Sparse Voxel Octree im
Laine–Karras-Layout), das der offizielle
[SuperSplat Viewer](https://github.com/playcanvas/supersplat-viewer)
für seinen "Walk Mode" nutzt (inkl. Außenraum-Flutfüllung, Höhlen-
Carving, optionaler `.collision.glb`-Mesh-Export). Das Bit-Layout der
`.bin`-Datei ist in der öffentlichen Doku aktuell nicht vollständig
dokumentiert; es exakt nachzubauen wäre riskant (subtile Bugs bei
falscher Bit-Interpretation). Dieses Projekt nutzt daher bewusst ein
eigenes, einfacheres Grid.

**Für große/produktive Szenen** empfiehlt sich mittelfristig, statt
des eingebauten PLY-Voxelizers direkt auf das offizielle Format zu
wechseln:

```bash
npm install -g @playcanvas/splat-transform
splat-transform scene.ply \
  --seed-pos 0,1,0 \
  --voxel-params 0.1,0.2 \
  --voxel-floor-fill \
  scene.voxel.json
```

und entweder den offiziellen `@playcanvas/supersplat-viewer` direkt
einzusetzen (er unterstützt bereits Walk-/Fly-Modi mit Voxel-Kollision
per URL-Parameter `&collision=scene.voxel.json`), oder einen
JS-Parser für das `.voxel.bin`-Format zu ergänzen, sobald das exakte
Layout öffentlich vollständig spezifiziert ist.

## Bekannte Einschränkungen

- Voxel-Kollision wird aktuell **nur aus `.ply`-Dateien** berechnet
  (direkter Zugriff auf rohe Splat-Zentren). `.sog`/komprimierte
  Formate werden zwar gerendert, aber ohne Kollisionsgrid.
- Kein Gravity/Physik-Loop – Teleport-Ziele werden nur einmalig auf
  Boden + Kopffreiheit geprüft, kein "Fallen" zwischen Frames.
- Kamera-Framing beim Laden ist bewusst simpel (fester Startpunkt);
  kein automatisches Einpassen an die Splat-Bounding-Box.

## Lizenz

MIT – siehe `LICENSE`. Nutzt [PlayCanvas Engine](https://github.com/playcanvas/engine)
(MIT) per CDN.
