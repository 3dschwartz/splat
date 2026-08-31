// Einfaches, selbst gebautes Sparse-Voxel-Kollisionsgrid.
//
// Bewusst NICHT das offizielle SuperSplat/.voxel.json+.voxel.bin
// Sparse-Voxel-Octree-Format (Laine–Karras-Layout) – dessen genaues
// Bit-Layout ist in der öffentlichen Doku nicht vollständig
// spezifiziert. Stattdessen: ein simples, selbst kontrolliertes
// Occupancy-Grid direkt aus den Splat-Zentren der geladenen PLY-Datei.
// Für "ist hier fester Untergrund / eine Wand" reicht das für Walk-
// /Teleport-Kollision vollkommen aus.
//
// Späteres Upgrade möglich: echte .voxel.json/.voxel.bin-Dateien von
// `splat-transform` einlesen und parallel unterstützen (siehe README).

export class VoxelGrid {
    /**
     * @param {Float32Array} positions  Splat-Zentren, [x0,y0,z0, x1,y1,z1, ...]
     * @param {Float32Array|null} opacities  optionale Opacity pro Splat (0..1 oder roh)
     * @param {number} resolution  Kantenlänge eines Voxels in Weltmetern
     * @param {number} minOpacity  Splats unterhalb dieser Opacity ignorieren (Floater-Filter)
     */
    constructor(positions, opacities, resolution = 0.1, minOpacity = 0.15) {
        this.resolution = resolution;
        this.cells = new Set();
        this.min = [Infinity, Infinity, Infinity];
        this.max = [-Infinity, -Infinity, -Infinity];

        const count = positions.length / 3;
        const useOpacity = !!opacities;

        // Opacity in 3DGS-PLYs ist oft roh (inverse Sigmoid), nicht 0..1.
        // Wir normalisieren pragmatisch per Min/Max, falls Werte außerhalb [0,1] liegen.
        let opMin = Infinity, opMax = -Infinity;
        if (useOpacity) {
            for (let i = 0; i < count; i++) {
                if (opacities[i] < opMin) opMin = opacities[i];
                if (opacities[i] > opMax) opMax = opacities[i];
            }
        }
        const normOpacity = (raw) => {
            if (opMax <= 1.0001 && opMin >= -0.0001) return raw; // schon 0..1
            const sig = 1 / (1 + Math.exp(-raw)); // Sigmoid, falls "roh" gespeichert
            return sig;
        };

        for (let i = 0; i < count; i++) {
            if (useOpacity) {
                const o = normOpacity(opacities[i]);
                if (o < minOpacity) continue;
            }
            const x = positions[i * 3 + 0];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];

            if (x < this.min[0]) this.min[0] = x;
            if (y < this.min[1]) this.min[1] = y;
            if (z < this.min[2]) this.min[2] = z;
            if (x > this.max[0]) this.max[0] = x;
            if (y > this.max[1]) this.max[1] = y;
            if (z > this.max[2]) this.max[2] = z;

            this.cells.add(this._key(this._toVoxel(x, y, z)));
        }
    }

    _toVoxel(x, y, z) {
        return [
            Math.floor(x / this.resolution),
            Math.floor(y / this.resolution),
            Math.floor(z / this.resolution)
        ];
    }

    _key(v) {
        return `${v[0]}_${v[1]}_${v[2]}`;
    }

    /** Ist der Voxel an dieser Weltposition belegt ("fest")? */
    isSolid(x, y, z) {
        return this.cells.has(this._key(this._toVoxel(x, y, z)));
    }

    /**
     * Prüft, ob an (x,y,z) genug freie Kopfhöhe ist (für Teleport-Ziele).
     * @param {number} headHeight  benötigte freie Höhe in Metern über dem Punkt
     * @param {number} step  Abtastschritt in Metern (<= resolution empfohlen)
     */
    hasClearance(x, y, z, headHeight = 1.7, step = null) {
        // Mindestens ~8 Abtastpunkte über die geprüfte Höhe, unabhängig von
        // der (evtl. grob eingestellten) Voxelgröße – sonst können bei
        // großer Voxelgröße dünne Wände zwischen zwei Samples "durchrutschen".
        const s = step || Math.min(this.resolution, Math.max(headHeight / 8, 0.05));
        for (let h = 0; h <= headHeight; h += s) {
            if (this.isSolid(x, y + h, z)) return false;
        }
        return true;
    }

    /**
     * Sucht ab (x,y,z) senkrecht nach unten den obersten festen Voxel
     * ("Boden") innerhalb von maxDrop Metern. Gibt die Welt-Y-Höhe der
     * Standfläche zurück oder null, wenn nichts gefunden wurde.
     */
    findFloorBelow(x, y, z, maxDrop = 3.0, step = null) {
        const s = step || this.resolution;
        for (let h = 0; h <= maxDrop; h += s) {
            const testY = y - h;
            if (this.isSolid(x, testY, z)) {
                return testY + this.resolution; // Oberkante des festen Voxels
            }
        }
        return null;
    }
}
