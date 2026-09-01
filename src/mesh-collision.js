// Kollisions-Mesh statt/zusätzlich zum Voxelgrid: nutzt echte Geometrie
// (z. B. ein grobes, in Blender modelliertes Raum-Mesh als .glb) für
// Kollisionsabfragen. Bietet dieselbe raycast()-Schnittstelle wie
// VoxelGrid, sodass TeleportController beide Varianten identisch nutzen
// kann.
//
// Bewusst ohne Physik-Engine (kein ammo.js/WASM) – einfacher direkter
// Strahl-Dreieck-Test (Möller–Trumbore) gegen alle Dreiecke des Meshes.
// Für ein grobes, niedrig aufgelöstes Kollisions-Mesh (ein paar hundert
// bis wenige tausend Dreiecke) ist Brute-Force pro Frame unproblematisch.
// Bei sehr hochauflösenden Kollisions-Meshes (>~20.000 Dreiecke) würde
// sich eine räumliche Beschleunigungsstruktur (BVH) lohnen – aktuell
// nicht implementiert.

import * as pc from 'playcanvas';

const EPSILON = 1e-7;

// Möller–Trumbore Strahl-Dreieck-Schnitttest.
// Gibt die Distanz t entlang des Strahls zurück oder null.
function rayTriangleIntersect(ox, oy, oz, dx, dy, dz, v0, v1, v2) {
    const e1x = v1[0] - v0[0], e1y = v1[1] - v0[1], e1z = v1[2] - v0[2];
    const e2x = v2[0] - v0[0], e2y = v2[1] - v0[1], e2z = v2[2] - v0[2];

    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;

    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < EPSILON) return null;
    const invDet = 1 / det;

    const tx = ox - v0[0], ty = oy - v0[1], tz = oz - v0[2];
    const u = (tx * px + ty * py + tz * pz) * invDet;
    if (u < 0 || u > 1) return null;

    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;

    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < 0 || u + v > 1) return null;

    const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    if (t < EPSILON) return null;
    return t;
}

export class MeshCollider {
    /**
     * @param {pc.Entity} entity  Entity mit (ggf. mehreren) render-Components,
     *                            z. B. das Root-Entity eines geladenen .glb
     */
    constructor(entity) {
        this.triangles = []; // Array von [v0,v1,v2], je v = [x,y,z] in Weltkoordinaten
        this.min = [Infinity, Infinity, Infinity];
        this.max = [-Infinity, -Infinity, -Infinity];
        this._collectTriangles(entity);
    }

    _collectTriangles(root) {
        const renderComponents = root.findComponents('render');

        for (const renderComp of renderComponents) {
            const entity = renderComp.entity;
            const worldMat = entity.getWorldTransform();

            for (const meshInstance of renderComp.meshInstances) {
                const mesh = meshInstance.mesh;
                const positions = [];
                mesh.getPositions(positions);
                const indices = [];
                mesh.getIndices(indices);

                const vertCount = positions.length / 3;
                const worldVerts = new Array(vertCount);
                for (let i = 0; i < vertCount; i++) {
                    const v = new pc.Vec3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
                    worldMat.transformPoint(v, v);
                    worldVerts[i] = [v.x, v.y, v.z];

                    if (v.x < this.min[0]) this.min[0] = v.x;
                    if (v.y < this.min[1]) this.min[1] = v.y;
                    if (v.z < this.min[2]) this.min[2] = v.z;
                    if (v.x > this.max[0]) this.max[0] = v.x;
                    if (v.y > this.max[1]) this.max[1] = v.y;
                    if (v.z > this.max[2]) this.max[2] = v.z;
                }

                for (let i = 0; i < indices.length; i += 3) {
                    const a = worldVerts[indices[i]];
                    const b = worldVerts[indices[i + 1]];
                    const c = worldVerts[indices[i + 2]];
                    if (a && b && c) this.triangles.push([a, b, c]);
                }
            }
        }
    }

    /**
     * @param {pc.Vec3} origin
     * @param {pc.Vec3} dir  normalisierte Richtung
     * @param {number} maxDist
     * @returns {{point: {x,y,z}, distance: number}|null}
     */
    raycast(origin, dir, maxDist) {
        let closestT = maxDist;
        let hit = null;
        for (const [v0, v1, v2] of this.triangles) {
            const t = rayTriangleIntersect(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, v0, v1, v2);
            if (t !== null && t < closestT) {
                closestT = t;
                hit = t;
            }
        }
        if (hit === null) return null;
        return {
            point: {
                x: origin.x + dir.x * closestT,
                y: origin.y + dir.y * closestT,
                z: origin.z + dir.z * closestT
            },
            distance: closestT
        };
    }
}
