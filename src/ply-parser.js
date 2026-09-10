// Minimaler PLY-Parser für 3D-Gaussian-Splat-Dateien.
// Extrahiert nur, was für das Voxel-Kollisionsgrid gebraucht wird:
// die Splat-Zentren (x, y, z) und, falls vorhanden, die Opacity
// (um sehr transparente "Floater"-Splats aus dem Kollisionsgrid
// herauszufiltern).
//
// Unterstützt: ASCII-PLY und binary_little_endian-PLY.
// (binary_big_endian wird bewusst nicht unterstützt – kommt bei
// 3DGS-Exports praktisch nicht vor.)

const TYPE_SIZES = {
    char: 1, uchar: 1, int8: 1, uint8: 1,
    short: 2, ushort: 2, int16: 2, uint16: 2,
    int: 4, uint: 4, int32: 4, uint32: 4,
    float: 4, float32: 4,
    double: 8, float64: 8
};

function readScalar(view, offset, type, littleEndian) {
    switch (type) {
        case 'char': case 'int8': return [view.getInt8(offset), 1];
        case 'uchar': case 'uint8': return [view.getUint8(offset), 1];
        case 'short': case 'int16': return [view.getInt16(offset, littleEndian), 2];
        case 'ushort': case 'uint16': return [view.getUint16(offset, littleEndian), 2];
        case 'int': case 'int32': return [view.getInt32(offset, littleEndian), 4];
        case 'uint': case 'uint32': return [view.getUint32(offset, littleEndian), 4];
        case 'float': case 'float32': return [view.getFloat32(offset, littleEndian), 4];
        case 'double': case 'float64': return [view.getFloat64(offset, littleEndian), 8];
        default:
            throw new Error(`Unbekannter PLY-Skalartyp: ${type}`);
    }
}

// Parst nur den Header (Text) eines PLY-Buffers und gibt Header-Infos
// plus den Byte-Offset zurück, an dem die Vertex-Daten beginnen.
function parseHeader(buffer) {
    const bytes = new Uint8Array(buffer);
    const headerBytes = [];
    let i = 0;
    const endMarker = 'end_header\n';
    const decoder = new TextDecoder('ascii');

    // Header ist reiner ASCII-Text, zeilenweise bis "end_header\n"
    let headerText = '';
    for (; i < bytes.length; i++) {
        headerBytes.push(bytes[i]);
        if (headerBytes.length >= endMarker.length) {
            const tail = decoder.decode(new Uint8Array(headerBytes.slice(-endMarker.length)));
            if (tail === endMarker) {
                headerText = decoder.decode(new Uint8Array(headerBytes));
                i += 1; // Position direkt nach dem Header
                break;
            }
        }
    }
    if (!headerText) {
        throw new Error('PLY-Header nicht gefunden (end_header fehlt) – ist das wirklich eine PLY-Datei?');
    }

    const lines = headerText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines[0] !== 'ply') {
        throw new Error('Keine gültige PLY-Datei (Magic "ply" fehlt).');
    }

    let format = 'ascii';
    const elements = [];
    let currentElement = null;

    for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts[0] === 'format') {
            format = parts[1]; // ascii | binary_little_endian | binary_big_endian
        } else if (parts[0] === 'element') {
            currentElement = { name: parts[1], count: parseInt(parts[2], 10), properties: [] };
            elements.push(currentElement);
        } else if (parts[0] === 'property' && currentElement) {
            if (parts[1] === 'list') {
                // Listen-Properties (z. B. Face-Indizes) werden für Splats nicht gebraucht.
                currentElement.properties.push({ name: parts[4], list: true });
            } else {
                currentElement.properties.push({ name: parts[2], type: parts[1] });
            }
        }
    }

    return { format, elements, dataOffset: i };
}

// Liest ein PLY-ArrayBuffer und liefert:
// { count, positions: Float32Array(count*3), opacities: Float32Array(count)|null }
export function parsePly(buffer) {
    const { format, elements, dataOffset } = parseHeader(buffer);
    const vertexEl = elements.find(e => e.name === 'vertex');
    if (!vertexEl) {
        throw new Error('PLY enthält kein "vertex"-Element – vermutlich keine Splat-Datei.');
    }

    // SuperSplats "Compressed Ply" hat ein zusätzliches "chunk"-Element und
    // im vertex-Element bit-gepackte uint-Properties statt x/y/z-Floats.
    const chunkEl = elements.find(e => e.name === 'chunk');
    const hasPackedPosition = vertexEl.properties.some(p => p.name === 'packed_position');
    if (chunkEl && hasPackedPosition) {
        return parseCompressedPly(buffer, format, chunkEl, vertexEl, dataOffset);
    }

    const props = vertexEl.properties;
    const xIdx = props.findIndex(p => p.name === 'x');
    const yIdx = props.findIndex(p => p.name === 'y');
    const zIdx = props.findIndex(p => p.name === 'z');
    if (xIdx < 0 || yIdx < 0 || zIdx < 0) {
        throw new Error('PLY-Vertex-Element hat keine x/y/z-Properties.');
    }
    const opacityIdx = props.findIndex(p => p.name === 'opacity');

    const count = vertexEl.count;
    const positions = new Float32Array(count * 3);
    const opacities = opacityIdx >= 0 ? new Float32Array(count) : null;

    if (format === 'ascii') {
        const text = new TextDecoder('utf8').decode(buffer.slice(dataOffset));
        const lines = text.split('\n');
        let li = 0;
        for (let v = 0; v < count; v++) {
            // Leerzeilen überspringen (robuster gegen Trailing-Newlines)
            while (li < lines.length && lines[li].trim() === '') li++;
            const vals = lines[li++].trim().split(/\s+/).map(Number);
            positions[v * 3 + 0] = vals[xIdx];
            positions[v * 3 + 1] = vals[yIdx];
            positions[v * 3 + 2] = vals[zIdx];
            if (opacities) opacities[v] = vals[opacityIdx];
        }
    } else if (format === 'binary_little_endian') {
        const view = new DataView(buffer, dataOffset);
        let offset = 0;
        // Feste Satzgröße annehmen (keine Listen im vertex-Element bei 3DGS-PLYs üblich)
        for (const p of props) {
            if (p.list) throw new Error('Listen-Properties im vertex-Element werden nicht unterstützt.');
        }
        const propSizes = props.map(p => TYPE_SIZES[p.type]);
        const stride = propSizes.reduce((a, b) => a + b, 0);

        for (let v = 0; v < count; v++) {
            let rowOffset = offset;
            for (let p = 0; p < props.length; p++) {
                const [val] = readScalar(view, rowOffset, props[p].type, true);
                if (p === xIdx) positions[v * 3 + 0] = val;
                else if (p === yIdx) positions[v * 3 + 1] = val;
                else if (p === zIdx) positions[v * 3 + 2] = val;
                else if (opacities && p === opacityIdx) opacities[v] = val;
                rowOffset += propSizes[p];
            }
            offset += stride;
        }
    } else {
        throw new Error(`PLY-Format "${format}" wird nicht unterstützt (nur ascii / binary_little_endian).`);
    }

    return { count, positions, opacities };
}

// Entpackt 3 quantisierte Werte (11/10/11 Bit) aus einem 32-Bit-Integer,
// je normiert auf 0..1. Standard-Bitlayout von SuperSplats Compressed Ply
// für packed_position und packed_scale.
function unpack111011(bits) {
    return [
        (bits >>> 21) / 2047,          // 11 Bit
        ((bits >>> 11) & 0x3FF) / 1023, // 10 Bit
        (bits & 0x7FF) / 2047           // 11 Bit
    ];
}

// SuperSplat "Compressed Ply": Splats sind in Chunks von je 256 organisiert.
// Jeder Chunk hat eigene min/max-Bounds (Position, Scale, ggf. Farbe); jeder
// Splat speichert nur einen bit-gepackten, auf den Chunk normierten Wert
// (packed_position: 11-10-11 Bit). Dequantisierung: min + normiert*(max-min).
// Details: https://blog.playcanvas.com/compressing-gaussian-splats/
function parseCompressedPly(buffer, format, chunkEl, vertexEl, dataOffset) {
    if (format !== 'binary_little_endian') {
        throw new Error('Komprimiertes PLY wird nur im binary_little_endian-Format unterstützt.');
    }
    const CHUNK_SIZE = 256;

    // Chunk-Element: alle Properties sind floats (min/max Position, Scale, ggf. Farbe)
    const chunkPropNames = chunkEl.properties.map(p => p.name);
    const chunkStride = chunkEl.properties.length * 4;
    const chunkCount = chunkEl.count;

    const view = new DataView(buffer, dataOffset);
    const chunks = new Array(chunkCount);
    let offset = 0;
    for (let c = 0; c < chunkCount; c++) {
        const vals = {};
        for (let p = 0; p < chunkPropNames.length; p++) {
            vals[chunkPropNames[p]] = view.getFloat32(offset + p * 4, true);
        }
        chunks[c] = vals;
        offset += chunkStride;
    }
    const requiredChunkProps = ['min_x', 'min_y', 'min_z', 'max_x', 'max_y', 'max_z'];
    for (const name of requiredChunkProps) {
        if (!(name in chunks[0])) {
            throw new Error(`Komprimiertes PLY: Chunk-Element hat keine "${name}"-Property.`);
        }
    }

    // Vertex-Element: uint-Properties (packed_position, ...), fest 4 Byte je Property
    const vertexPropNames = vertexEl.properties.map(p => p.name);
    const posIdx = vertexPropNames.indexOf('packed_position');
    const vertexStride = vertexEl.properties.length * 4;
    const count = vertexEl.count;
    const positions = new Float32Array(count * 3);
    const vertexDataStart = dataOffset + offset;
    const vertexView = new DataView(buffer, vertexDataStart);

    for (let i = 0; i < count; i++) {
        const base = i * vertexStride + posIdx * 4;
        const packed = vertexView.getUint32(base, true);
        const [nx, ny, nz] = unpack111011(packed);
        const chunk = chunks[Math.floor(i / CHUNK_SIZE)];
        positions[i * 3 + 0] = chunk.min_x + nx * (chunk.max_x - chunk.min_x);
        positions[i * 3 + 1] = chunk.min_y + ny * (chunk.max_y - chunk.min_y);
        positions[i * 3 + 2] = chunk.min_z + nz * (chunk.max_z - chunk.min_z);
    }

    // Opacity steckt im gepackten packed_color-Wert (nicht separat als Float
    // dekodiert) – für die Voxel-Kollision hier bewusst nicht ausgewertet,
    // d. h. bei komprimierten PLYs wird aktuell nicht nach Opacity gefiltert.
    return { count, positions, opacities: null };
}
