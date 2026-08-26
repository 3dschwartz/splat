import * as pc from 'playcanvas';
import { parsePly } from './ply-parser.js';
import { VoxelGrid } from './voxel-grid.js';
import { TeleportController } from './teleport-controller.js';

const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const dropzone = document.getElementById('dropzone');
const resolutionInput = document.getElementById('voxel-resolution');
const spawnXInput = document.getElementById('spawn-x');
const spawnYInput = document.getElementById('spawn-y');
const spawnZInput = document.getElementById('spawn-z');

function setStatus(text) {
    statusEl.textContent = text;
}

// --- PlayCanvas App -------------------------------------------------------

const app = new pc.Application(canvas, {
    graphicsDeviceOptions: { antialias: false, alpha: false }
});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.start();
window.addEventListener('resize', () => app.resizeCanvas());

const camera = new pc.Entity('Camera');
camera.addComponent('camera', {
    clearColor: new pc.Color(0.05, 0.05, 0.07),
    fov: 65,
    farClip: 500
});
camera.setPosition(0, 1.5, 0);
app.root.addChild(camera);

const light = new pc.Entity('Light');
light.addComponent('light', { type: 'directional', intensity: 1.2 });
light.setEulerAngles(45, 30, 0);
app.root.addChild(light);

let splatEntity = null;
let teleportController = null;
let rawPositions = null;
let rawOpacities = null;
let isFlipped = true; // SuperSplat-Exporte sind konsistent auf dem Kopf -> Standard-Korrektur an

const flipButton = document.getElementById('flip-button');

// PlayCanvas transformiert PLY-Splats beim Laden intern um 180° um die
// Z-Achse (Wechsel von der PLY-Quellkonvention in engine-eigenes Y-up).
// Unser eigener PLY-Parser liest die ROHEN Koordinaten – ohne diese
// Transformation würde das Voxelgrid nicht zur gerenderten Szene passen.
function toEngineSpace(x, y, z) {
    return [-x, -y, z];
}

// Manuelle Zusatzdrehung (180° um X) für den Fall, dass das Ausgangs-Tool
// eine andere Konvention nutzt als die, für die PlayCanvas' Standard-
// transformation gedacht ist (z. B. je nach Scan-/Rekonstruktions-Tool).
function toFlippedSpace([x, y, z]) {
    return [x, -y, -z];
}

function buildVoxelGrid(resolution) {
    if (!rawPositions) return null;
    const count = rawPositions.length / 3;
    const positions = new Float32Array(rawPositions.length);
    for (let i = 0; i < count; i++) {
        let p = toEngineSpace(rawPositions[i * 3], rawPositions[i * 3 + 1], rawPositions[i * 3 + 2]);
        if (isFlipped) p = toFlippedSpace(p);
        positions[i * 3] = p[0];
        positions[i * 3 + 1] = p[1];
        positions[i * 3 + 2] = p[2];
    }
    return new VoxelGrid(positions, rawOpacities, resolution);
}

function applyFlip() {
    if (splatEntity) {
        splatEntity.setEulerAngles(isFlipped ? 180 : 0, 0, 0);
    }
    const resolution = parseFloat(resolutionInput.value) || 0.15;
    const voxelGrid = buildVoxelGrid(resolution);
    frameCamera();
    if (teleportController) teleportController.destroy();
    teleportController = new TeleportController(app, camera, splatEntity, voxelGrid);
    teleportController.syncAnglesFromCamera();
    return voxelGrid;
}

flipButton.addEventListener('click', () => {
    isFlipped = !isFlipped;
    applyFlip();
});

[spawnXInput, spawnYInput, spawnZInput].forEach(input => {
    input.addEventListener('input', () => {
        if (splatEntity) frameCamera();
    });
});

// --- Splat-Datei laden -----------------------------------------------------

async function loadSplatFile(file) {
    setStatus(`Lade "${file.name}" …`);

    if (splatEntity) {
        splatEntity.destroy();
        splatEntity = null;
    }
    if (teleportController) {
        teleportController.destroy();
        teleportController = null;
    }

    const arrayBuffer = await file.arrayBuffer();
    const blobUrl = URL.createObjectURL(new Blob([arrayBuffer]));

    // 1) Splat rendern (PlayCanvas gsplat-Asset)
    const ext = file.name.toLowerCase().split('.').pop();
    const asset = new pc.Asset(file.name, 'gsplat', { url: blobUrl, filename: file.name });

    await new Promise((resolve, reject) => {
        asset.once('load', resolve);
        asset.once('error', reject);
        app.assets.add(asset);
        app.assets.load(asset);
    });

    splatEntity = new pc.Entity('Splat');
    splatEntity.addComponent('gsplat', { asset });
    app.root.addChild(splatEntity);

    // 2) Voxelgrid für Kollision bauen (nur aus .ply möglich, da wir dafür
    //    direkten Zugriff auf die rohen Splat-Zentren brauchen)
    let voxelGrid = null;
    rawPositions = null;
    rawOpacities = null;
    // isFlipped bewusst NICHT zurücksetzen: Standard bleibt "geflippt"
    // (SuperSplat-Exporte sind konsistent auf dem Kopf), Nutzer-Umschaltung
    // per Button bleibt über mehrere geladene Dateien hinweg erhalten.
    if (splatEntity) splatEntity.setEulerAngles(isFlipped ? 180 : 0, 0, 0);
    if (ext === 'ply') {
        try {
            setStatus('Baue Voxel-Kollisionsgrid …');
            const { positions, opacities, count } = parsePly(arrayBuffer);
            rawPositions = positions;
            rawOpacities = opacities;
            const resolution = parseFloat(resolutionInput.value) || 0.15;
            voxelGrid = buildVoxelGrid(resolution);
            setStatus(`Fertig: ${count.toLocaleString('de-DE')} Splats geladen, Voxelgrid mit ${voxelGrid.cells.size.toLocaleString('de-DE')} belegten Zellen (${resolution} m). Steht die Szene auf dem Kopf? -> Button "Ausrichtung umkehren".`);
        } catch (err) {
            console.error(err);
            setStatus(`Splat geladen, aber Voxelgrid konnte nicht gebaut werden: ${err.message}`);
        }
    } else {
        setStatus(`"${file.name}" geladen. Hinweis: Voxel-Kollision wird aktuell nur für .ply-Dateien berechnet (siehe README).`);
    }

    // 3) Kamera an den fest konfigurierten Spawn-Punkt setzen
    frameCamera();

    // 4) Teleport-Steuerung aktivieren
    teleportController = new TeleportController(app, camera, splatEntity, voxelGrid);
    teleportController.syncAnglesFromCamera();

    dropzone.classList.add('hidden');
}

function frameCamera() {
    if (!splatEntity || !splatEntity.gsplat) return;
    // Fester Spawn-Punkt statt automatisch berechneter Bounding-Box-Mitte:
    // bei verrauschten Scans mit Ausreißer-Splats liegt die BBox-Mitte oft
    // nicht im begehbaren Bereich. Stattdessen: fester, vom Nutzer
    // vorgegebener Punkt – die PLY-Datei wird dafür vorher (z. B. in
    // SuperSplat) so verschoben, dass die gewünschte Raummitte genau auf
    // diesen Punkt fällt.
    const parseOr = (str, fallback) => {
        const v = parseFloat(str);
        return Number.isNaN(v) ? fallback : v;
    };
    const sx = parseOr(spawnXInput.value, 0);
    const sy = parseOr(spawnYInput.value, 1.5);
    const sz = parseOr(spawnZInput.value, 0);
    camera.setPosition(sx, sy, sz);
    camera.setEulerAngles(0, 0, 0);
}

// --- Drag & Drop -------------------------------------------------------

['dragenter', 'dragover'].forEach(evt => {
    window.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove('hidden');
    });
});
window.addEventListener('dragleave', (e) => {
    if (e.target === dropzone) dropzone.classList.add('hidden');
});
window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadSplatFile(file);
});

const fileInput = document.getElementById('file-input');
fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadSplatFile(fileInput.files[0]);
});

setStatus('Bereit. Ziehe eine .ply / .compressed.ply / .sog-Datei ins Fenster oder wähle eine Datei aus.');