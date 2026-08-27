import * as pc from 'playcanvas';

// Teleport-basierte Fortbewegung, wie in VR/Walk-Mode-Viewern üblich:
// - Klick/Tap auf den Boden -> kurzer Fade-to-black -> Kamera springt
//   SOFORT an die Zielposition (kein Gleiten/Fahren).
// - Ziel wird gegen das Voxelgrid geprüft: nur erlaubt, wenn dort
//   tatsächlich Boden ist UND genug Kopffreiheit besteht.
// - Umschauen per Maus-Drag (Desktop) bzw. Ein-Finger-Drag (Touch).
export class TeleportController {
    /**
     * @param {pc.Application} app
     * @param {pc.Entity} cameraEntity
     * @param {pc.Entity} sceneEntity  Entity mit dem gsplat-Component (Ziel des Pickings)
     * @param {import('./voxel-grid.js').VoxelGrid|null} voxelGrid
     */
    constructor(app, cameraEntity, sceneEntity, voxelGrid) {
        this.app = app;
        this.camera = cameraEntity;
        this.sceneEntity = sceneEntity;
        this.voxelGrid = voxelGrid;
        this.eyeHeight = 1.7;
        this.headClearance = 1.7;

        this.picker = new pc.Picker(app, app.graphicsDevice.width, app.graphicsDevice.height);

        this.yaw = 0;
        this.pitch = 0;
        this._dragging = false;
        this._lastX = 0;
        this._lastY = 0;

        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onDblClick = this._onDblClick.bind(this);
        this._onResize = this._onResize.bind(this);

        const canvas = app.graphicsDevice.canvas;
        canvas.addEventListener('pointerdown', this._onPointerDown);
        canvas.addEventListener('pointermove', this._onPointerMove);
        canvas.addEventListener('pointerup', this._onPointerUp);
        canvas.addEventListener('pointercancel', this._onPointerUp);
        canvas.addEventListener('dblclick', this._onDblClick);
        window.addEventListener('resize', this._onResize);

        this._fadeEl = document.getElementById('teleport-fade');

        // Ergänzendes WASD-Gehen (kollisionsgeprüft): falls der Teleport
        // allein nicht ausreicht, um z. B. durch eine Tür in einen Raum zu
        // gelangen (der Klick-Raycast trifft dann nur die Außenwand), kann
        // man sich damit selbst dorthin bewegen.
        this._keys = new Set();
        this._onKeyDown = (e) => this._keys.add(e.code);
        this._onKeyUp = (e) => this._keys.delete(e.code);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);

        this.walkSpeed = 1.6; // m/s
        this._onUpdate = this._onUpdate.bind(this);
        app.on('update', this._onUpdate);
    }

    destroy() {
        const canvas = this.app.graphicsDevice.canvas;
        canvas.removeEventListener('pointerdown', this._onPointerDown);
        canvas.removeEventListener('pointermove', this._onPointerMove);
        canvas.removeEventListener('pointerup', this._onPointerUp);
        canvas.removeEventListener('pointercancel', this._onPointerUp);
        canvas.removeEventListener('dblclick', this._onDblClick);
        window.removeEventListener('resize', this._onResize);
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        this.app.off('update', this._onUpdate);
    }

    _onUpdate(dt) {
        if (this._keys.size === 0) return;

        const forward = this.camera.forward.clone();
        forward.y = 0;
        if (forward.lengthSq() > 0.0001) forward.normalize();
        const right = this.camera.right.clone();
        right.y = 0;
        if (right.lengthSq() > 0.0001) right.normalize();

        const move = new pc.Vec3();
        if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) move.add(forward);
        if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) move.sub(forward);
        if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) move.add(right);
        if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) move.sub(right);
        if (move.lengthSq() === 0) return;

        move.normalize().mulScalar(this.walkSpeed * dt);
        const pos = this.camera.getPosition();
        const next = pos.clone().add(move);

        if (this.voxelGrid) {
            // Nur entlang der Achse bewegen, die frei ist (einfaches
            // Wand-Gleiten statt komplett zu blockieren).
            const tryPos = pos.clone();
            tryPos.x = next.x;
            if (this.voxelGrid.hasClearance(tryPos.x, tryPos.y - 1.6, tryPos.z, this.headClearance)) {
                pos.x = tryPos.x;
            }
            tryPos.x = pos.x;
            tryPos.z = next.z;
            if (this.voxelGrid.hasClearance(tryPos.x, tryPos.y - 1.6, tryPos.z, this.headClearance)) {
                pos.z = tryPos.z;
            }
            // An Boden andocken, falls vorhanden
            const floorY = this.voxelGrid.findFloorBelow(pos.x, pos.y + 0.3, pos.z, 1.0);
            if (floorY !== null) pos.y = floorY + this.eyeHeight;
            this.camera.setPosition(pos);
        } else {
            this.camera.setPosition(next);
        }
    }

    _onResize() {
        this.picker.resize(this.app.graphicsDevice.width, this.app.graphicsDevice.height);
    }

    _onPointerDown(e) {
        this._dragging = true;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        this._moved = false;
    }

    _onPointerMove(e) {
        if (!this._dragging) return;
        const dx = e.clientX - this._lastX;
        const dy = e.clientY - this._lastY;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this._moved = true;

        // Nur umschauen, wenn tatsächlich gezogen wurde (sonst würde jeder
        // Klick minimal "zittern" und als Drag statt als Teleport zählen).
        this.yaw -= dx * 0.2;
        this.pitch -= dy * 0.2;
        this.pitch = pc.math.clamp(this.pitch, -89, 89);
        this.camera.setEulerAngles(this.pitch, this.yaw, 0);
    }

    _onPointerUp(e) {
        const wasDrag = this._moved;
        this._dragging = false;
        if (!wasDrag) {
            // reiner Klick/Tap ohne Drag -> Teleport-Versuch
            this._tryTeleport(e.clientX, e.clientY);
        }
    }

    _onDblClick(e) {
        this._tryTeleport(e.clientX, e.clientY);
    }

    _tryTeleport(clientX, clientY) {
        const canvas = this.app.graphicsDevice.canvas;
        const rect = canvas.getBoundingClientRect();
        // screenToWorld() erwartet Koordinaten im Bereich 0..canvas.offsetWidth/
        // offsetHeight (CSS-Pixel), NICHT die interne Render-Auflösung
        // (canvas.width/height). Bei Retina/HiDPI-Displays oder PlayCanvas'
        // Auto-Resolution-Skalierung unterscheiden sich beide Werte -> falsch
        // skaliert zeigte der Klahlstrahl in eine völlig falsche Richtung.
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        this.picker.prepare(this.camera.camera, this.app.scene);
        // getSelection liefert an dieser Pixelposition getroffene Objekte;
        // für Splats reicht die Bounding-Box-Auflösung von Picker meist nicht
        // für den exakten Weltpunkt -> wir nutzen zusätzlich einen Raycast
        // gegen das Voxelgrid entlang des Kamerastrahls (robuster & unabhängig
        // vom Rendermodus des Splats).
        const target = this._raycastVoxelGrid(x, y, rect, canvas);
        if (!target) return;

        this._teleportTo(target);
    }

    // Wirft einen Strahl von der Kamera durch den Klickpunkt und marschiert
    // in kleinen Schritten durchs Voxelgrid (einfache DDA-ähnliche Suche),
    // bis der erste feste Voxel gefunden wird. Funktioniert unabhängig davon,
    // ob der GPU-Splat-Picker exakte Tiefenwerte liefert.
    _raycastVoxelGrid(pixelX, pixelY, rect, canvas) {
        if (!this.voxelGrid) {
            console.warn('[Teleport] Kein Voxelgrid vorhanden (z. B. .sog-Datei ohne PLY-Kollision) – Teleport deaktiviert.');
            return null;
        }

        const from = this.camera.getPosition().clone();
        const farPoint = this.camera.camera.screenToWorld(
            pixelX, pixelY, this.camera.camera.farClip
        );
        const dir = farPoint.clone().sub(from).normalize();

        const step = Math.max(this.voxelGrid.resolution * 0.5, 0.02);
        const maxDist = this.camera.camera.farClip;
        const pos = from.clone();

        for (let d = 0; d < maxDist; d += step) {
            pos.copy(from).add(dir.clone().mulScalar(d));
            if (this.voxelGrid.isSolid(pos.x, pos.y, pos.z)) {
                // einen Schritt zurück = Punkt knapp VOR der Wand/dem Boden
                const hit = from.clone().add(dir.clone().mulScalar(Math.max(d - step, 0)));
                return hit;
            }
        }
        console.warn('[Teleport] Kein fester Voxel entlang des Klickstrahls gefunden.', {
            from: from.toString(), dir: dir.toString(), maxDist, cellCount: this.voxelGrid.cells.size
        });
        return null;
    }

    _teleportTo(hitPoint) {
        let standY = hitPoint.y;
        if (this.voxelGrid) {
            const floorY = this.voxelGrid.findFloorBelow(hitPoint.x, hitPoint.y + 0.5, hitPoint.z, 1.0);
            if (floorY !== null) standY = floorY;

            const clear = this.voxelGrid.hasClearance(hitPoint.x, standY, hitPoint.z, this.headClearance);
            if (!clear) {
                // Ziel ist zugebaut (z. B. Wandtreffer statt Boden) -> ablehnen
                console.warn('[Teleport] Ziel abgelehnt: zu wenig Kopffreiheit.', {
                    hitPoint: hitPoint.toString(), standY, headClearance: this.headClearance
                });
                return;
            }
        }

        const dest = new pc.Vec3(hitPoint.x, standY + this.eyeHeight, hitPoint.z);
        this._fadeTeleport(dest);
    }

    _fadeTeleport(dest) {
        if (!this._fadeEl) {
            this.camera.setPosition(dest);
            return;
        }
        this._fadeEl.style.opacity = '1';
        setTimeout(() => {
            this.camera.setPosition(dest);
            setTimeout(() => {
                this._fadeEl.style.opacity = '0';
            }, 60);
        }, 90);
    }

    /** Setzt Start-Blickrichtung passend zur aktuellen Kamerarotation. */
    syncAnglesFromCamera() {
        const e = this.camera.getEulerAngles();
        this.pitch = e.x;
        this.yaw = e.y;
    }
}
