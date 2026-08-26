import * as pc from 'playcanvas';
import { parsePly } from './ply-parser.js';
import { VoxelGrid } from './voxel-grid.js';
import { TeleportController } from './teleport-controller.js';

const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const dropzone = document.getElementById('dropzone');
const resolutionInput = document.getElementById('voxel-resolution');

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
camera.setPosition(0, 1.7, 3);
app.root.addChild(camera);

const light = new pc.Entity('Light');
light.addComponent('light', { type: 'directional', intensity: 1.2 });
light.setEulerAngles(45, 30, 0);
app.root.addChild(light);

let splatEntity = null;
let teleportController = null;

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
    if (ext === 'ply') {
        try {
            setStatus('Baue Voxel-Kollisionsgrid …');
            const { positions, opacities, count } = parsePly(arrayBuffer);
            const resolution = parseFloat(resolutionInput.value) || 0.15;
            voxelGrid = new VoxelGrid(positions, opacities, resolution);
            setStatus(`Fertig: ${count.toLocaleString('de-DE')} Splats geladen, Voxelgrid mit ${voxelGrid.cells.size.toLocaleString('de-DE')} belegten Zellen (${resolution} m).`);
        } catch (err) {
            console.error(err);
            setStatus(`Splat geladen, aber Voxelgrid konnte nicht gebaut werden: ${err.message}`);
        }
    } else {
        setStatus(`"${file.name}" geladen. Hinweis: Voxel-Kollision wird aktuell nur für .ply-Dateien berechnet (siehe README).`);
    }

    // 3) Kamera zentrieren
    frameCamera();

    // 4) Teleport-Steuerung aktivieren
    teleportController = new TeleportController(app, camera, splatEntity, voxelGrid);
    teleportController.syncAnglesFromCamera();

    dropzone.classList.add('hidden');
}

function frameCamera() {
    if (!splatEntity || !splatEntity.gsplat) return;
    // Grobe Zentrierung: Kamera ein Stück vor den Ursprung des Splats setzen.
    // (Für exaktes Framing könnte man die AABB des gsplat-Assets auswerten;
    // hier bewusst einfach gehalten, Nutzer kann sich per Drag umsehen und
    // dann per Klick zum Startpunkt teleportieren.)
    camera.setPosition(0, 1.7, 3);
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
