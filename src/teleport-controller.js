import * as pc from 'playcanvas';

// Teleport-basierte Fortbewegung, wie in VR/Walk-Mode-Viewern üblich:
// - Klick/Tap auf den Boden -> kurzer Fade-to-black -> Kamera springt
//   SOFORT an die Zielposition (kein Gleiten/Fahren).
// - Ziel wird gegen den Collider geprüft: nur erlaubt, wenn dort
//   tatsächlich Boden ist UND genug Kopffreiheit besteht.
// - Umschauen per Maus-Drag (Desktop) bzw. Ein-Finger-Drag (Touch).
// - WASD/Pfeiltasten: kollisionsgeprüftes Gehen als Ergänzung.
//
// Der "collider"-Parameter ist bewusst austauschbar: sowohl VoxelGrid
// als auch MeshCollider bieten dieselbe raycast(origin, dir, maxDist)
// -> {point, distance} | null - Schnittstelle. TeleportController weiß
// nicht, welcher der beiden es ist.
export class TeleportController {
    /**
     * @param {pc.Application} app
     * @param {pc.Entity} cameraEntity
     * @param {pc.Entity} sceneEntity  Entity mit dem gsplat-Component (aktuell nur informativ)
     * @param {{raycast: Function}|null} collider  VoxelGrid- oder MeshCollider-Instanz
     */
    constructor(app, cameraEntity, sceneEntity, collider) {
        this.app = app;
        this.camera = cameraEntity;
        this.sceneEntity = sceneEntity;
        this.collider = collider;
        this.eyeHeight = 1.7;
        this.headClearance = 1.7;

        this.yaw = 0;
        this.pitch = 0;
        this._dragging = false;
        this._lastX = 0;
        this._lastY = 0;

        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onDblClick = this._onDblClick.bind(this);

        const canvas = app.graphicsDevice.canvas;
        canvas.addEventListener('pointerdown', this._onPointerDown);
        canvas.addEventListener('pointermove', this._onPointerMove);
        canvas.addEventListener('pointerup', this._onPointerUp);
        canvas.addEventListener('pointercancel', this._onPointerUp);
        canvas.addEventListener('dblclick', this._onDblClick);

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
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        this.app.off('update', this._onUpdate);
    }

    // Kurzer Hilfs-Raycast: prüft, ob der Collider entlang (origin -> dir)
    // innerhalb von maxDist etwas trifft.
    _hit(origin, dir, maxDist) {
        if (!this.collider) return null;
        return this.collider.raycast(origin, dir, maxDist);
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
        const pos = this.camera.getPosition().clone();

        if (this.collider) {
            const skin = 0.3; // kleiner Sicherheitsabstand vor Wänden

            // X-Achse einzeln testen (Wand-Gleiten statt hartem Stopp)
            if (Math.abs(move.x) > 0) {
                const dirX = new pc.Vec3(Math.sign(move.x), 0, 0);
                const distX = Math.abs(move.x) + skin;
                const hitX = this._hit(pos, dirX, distX);
                if (!hitX || hitX.distance > distX - skin) pos.x += move.x;
            }
            // Z-Achse einzeln testen
            if (Math.abs(move.z) > 0) {
                const dirZ = new pc.Vec3(0, 0, Math.sign(move.z));
                const distZ = Math.abs(move.z) + skin;
                const hitZ = this._hit(pos, dirZ, distZ);
                if (!hitZ || hitZ.distance > distZ - skin) pos.z += move.z;
            }

            // Boden-Andockung: kurzer Strahl nach unten
            const down = new pc.Vec3(0, -1, 0);
            const floorHit = this._hit(new pc.Vec3(pos.x, pos.y + 0.3, pos.z), down, 1.0);
            if (floorHit) pos.y = floorHit.point.y + this.eyeHeight;

            this.camera.setPosition(pos);
        } else {
            this.camera.setPosition(pos.add(move));
        }
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
        if (!this.collider) {
            console.warn('[Teleport] Kein Collider (weder Voxelgrid noch Mesh) vorhanden – Teleport deaktiviert.');
            return;
        }
        const canvas = this.app.graphicsDevice.canvas;
        const rect = canvas.getBoundingClientRect();
        // screenToWorld() erwartet Koordinaten im Bereich 0..canvas.offsetWidth/
        // offsetHeight (CSS-Pixel), NICHT die interne Render-Auflösung.
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const from = this.camera.getPosition().clone();
        const farPoint = this.camera.camera.screenToWorld(x, y, this.camera.camera.farClip);
        const dir = farPoint.clone().sub(from).normalize();
        const maxDist = this.camera.camera.farClip;

        const result = this._hit(from, dir, maxDist);
        if (!result) {
            console.warn('[Teleport] Kein Treffer entlang des Klickstrahls gefunden.', {
                from: from.toString(), dir: dir.toString(), maxDist
            });
            return;
        }

        this._teleportTo(new pc.Vec3(result.point.x, result.point.y, result.point.z));
    }

    _teleportTo(hitPoint) {
        let standY = hitPoint.y;
        if (this.collider) {
            const down = new pc.Vec3(0, -1, 0);
            const floorHit = this._hit(new pc.Vec3(hitPoint.x, hitPoint.y + 0.5, hitPoint.z), down, 1.0);
            if (floorHit) standY = floorHit.point.y;

            const up = new pc.Vec3(0, 1, 0);
            const ceilHit = this._hit(new pc.Vec3(hitPoint.x, standY + 0.05, hitPoint.z), up, this.headClearance);
            if (ceilHit) {
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
