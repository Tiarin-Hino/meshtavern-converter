import { MeshoptEncoder } from 'meshoptimizer';
import { vertexColours, type Look } from './look';
import { computeVertexNormals, type IndexedMesh } from './mesh';
import { GRID_SQUARE_MM, type Sizing } from './size';

/**
 * Writes one mesh as a binary glTF 2.0 file (GLB). Two variants:
 *
 * - plain: float positions and normals, no extensions. Opens everywhere (Blender, Windows
 *   3D Viewer, every engine).
 * - compact: quantised attributes (KHR_mesh_quantization) compressed with
 *   EXT_meshopt_compression. Several times smaller; needs a loader with meshopt support
 *   (three.js, Babylon.js, Godot 4 and others; not Blender).
 *
 * Both carry the look as COLOR_0 and the raw shading data as `_SHADING` (x = occlusion 0..1,
 * y = cavity mapped from -1..1 to 0..1, so 0.5 is flat), so an application can re-tint the
 * mini without the source mesh. glTF wants vertex data on 4-byte boundaries, hence one
 * padded two-component attribute instead of two single bytes. glTF is in metres and
 * our meshes are in millimetres; the node's scale converts, the vertex data stays in mm.
 */
export interface GlbOptions {
  /** Shown as the node and mesh name in other tools. */
  name: string;
  look: Look;
  compact: boolean;
  /**
   * The mini's size on the table. When given, `extras.meshtavern` carries what the table
   * needs to place it: grid square, creature size, footprint in squares, base diameter,
   * and the units and scale the file was read with.
   */
  sizing?: Sizing;
}

const MM_TO_M = 0.001;
const ROUGHNESS = 0.75;

const BYTE = 5120;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const FLOAT = 5126;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

type Json = Record<string, unknown>;

/** Collects binary chunks, each aligned to four bytes as glTF requires. */
class Bin {
  private readonly chunks: Uint8Array[] = [];
  length = 0;

  add(bytes: Uint8Array): { byteOffset: number; byteLength: number } {
    const byteOffset = this.length;
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
    const padding = (4 - (this.length % 4)) % 4;
    if (padding) {
      this.chunks.push(new Uint8Array(padding));
      this.length += padding;
    }
    return { byteOffset, byteLength: bytes.byteLength };
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

const asBytes = (array: ArrayBufferView): Uint8Array =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

const toByte = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 255);
const toSignedByte = (value: number): number => Math.round(Math.max(-1, Math.min(1, value)) * 127);

function bounds(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    if (positions[i]! < min[i % 3]!) min[i % 3] = positions[i]!;
    if (positions[i]! > max[i % 3]!) max[i % 3] = positions[i]!;
  }
  return { min, max };
}

/** Unit normals; a zero normal (degenerate neighbourhood) becomes "up" so validators accept it. */
function unitNormals(mesh: IndexedMesh): Float32Array {
  const normals = (mesh.normals ?? computeVertexNormals(mesh)).slice();
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!);
    if (length < 1e-6) {
      normals[i] = 0;
      normals[i + 1] = 1;
      normals[i + 2] = 0;
    } else {
      normals[i] = normals[i]! / length;
      normals[i + 1] = normals[i + 1]! / length;
      normals[i + 2] = normals[i + 2]! / length;
    }
  }
  return normals;
}

/** The mesh with its vertices renumbered; `remap[old]` is the new index. */
function reordered(mesh: IndexedMesh, remap: Uint32Array, vertexCount: number): IndexedMesh {
  const move = (values: Float32Array | undefined, width: number): Float32Array | undefined => {
    if (!values) return undefined;
    const out = new Float32Array(vertexCount * width);
    for (let old = 0; old < remap.length; old++) {
      const target = remap[old]!;
      if (target === 0xffffffff) continue;
      for (let k = 0; k < width; k++) out[target * width + k] = values[old * width + k]!;
    }
    return out;
  };
  return {
    positions: move(mesh.positions, 3)!,
    indices: mesh.indices,
    normals: move(mesh.normals, 3),
    cavity: move(mesh.cavity, 1),
    occlusion: move(mesh.occlusion, 1),
  };
}

function container(json: Json, bin: Uint8Array): ArrayBuffer {
  let text = JSON.stringify(json);
  while (new TextEncoder().encode(text).byteLength % 4 !== 0) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const total = 12 + 8 + jsonBytes.byteLength + 8 + bin.byteLength;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  new Uint8Array(out, 20).set(jsonBytes);
  const binStart = 20 + jsonBytes.byteLength;
  view.setUint32(binStart, bin.byteLength, true);
  view.setUint32(binStart + 4, 0x004e4942, true); // "BIN"
  new Uint8Array(out, binStart + 8).set(bin);
  return out;
}

function document(options: GlbOptions, mesh: IndexedMesh, node: Json, parts: Json): Json {
  const size = bounds(mesh.positions);
  return {
    asset: { version: '2.0', generator: 'MeshTavern Converter' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: options.name, mesh: 0, ...node }],
    materials: [
      {
        name: 'Mini',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: ROUGHNESS,
        },
      },
    ],
    extras: {
      units: 'Vertex data is in millimetres; the node scale converts to metres.',
      sizeMm: size.max.map((value, axis) => Number((value - size.min[axis]!).toFixed(3))),
      ...(options.sizing && {
        meshtavern: {
          gridSquareMm: GRID_SQUARE_MM,
          size: options.sizing.size,
          footprintSquares: options.sizing.footprintSquares,
          baseDiameterMm: Number(options.sizing.baseDiameterMm.toFixed(3)),
          units: options.sizing.units,
          scale: options.sizing.scale,
        },
      }),
    },
    ...parts,
  };
}

const primitive = (hasShading: boolean): Json => ({
  attributes: {
    POSITION: 1,
    NORMAL: 2,
    COLOR_0: 3,
    ...(hasShading ? { _SHADING: 4 } : {}),
  },
  indices: 0,
  material: 0,
  mode: 4,
});

/** Occlusion and cavity as two unsigned bytes per vertex, padded to four. */
function shadingBytes(mesh: IndexedMesh): Uint8Array {
  const vertexCount = mesh.positions.length / 3;
  const out = new Uint8Array(vertexCount * 4);
  for (let v = 0; v < vertexCount; v++) {
    out[v * 4] = toByte(mesh.occlusion![v]!);
    out[v * 4 + 1] = toByte(mesh.cavity![v]! * 0.5 + 0.5);
  }
  return out;
}

function colourBytes(mesh: IndexedMesh, look: Look): Uint8Array {
  const colours = vertexColours(mesh, look);
  const vertexCount = mesh.positions.length / 3;
  const out = new Uint8Array(vertexCount * 4);
  for (let v = 0; v < vertexCount; v++) {
    out[v * 4] = toByte(colours[v * 3]!);
    out[v * 4 + 1] = toByte(colours[v * 3 + 1]!);
    out[v * 4 + 2] = toByte(colours[v * 3 + 2]!);
    out[v * 4 + 3] = 255;
  }
  return out;
}

function encodePlain(mesh: IndexedMesh, options: GlbOptions): ArrayBuffer {
  const vertexCount = mesh.positions.length / 3;
  const hasShading = Boolean(mesh.occlusion && mesh.cavity);
  const bin = new Bin();
  const small = vertexCount <= 65535;

  const views: Json[] = [];
  const view = (bytes: Uint8Array, target: number): number => {
    views.push({ buffer: 0, ...bin.add(bytes), target });
    return views.length - 1;
  };
  const { min, max } = bounds(mesh.positions);
  const accessors: Json[] = [
    {
      bufferView: view(
        asBytes(small ? Uint16Array.from(mesh.indices) : mesh.indices),
        ELEMENT_ARRAY_BUFFER,
      ),
      componentType: small ? UNSIGNED_SHORT : UNSIGNED_INT,
      count: mesh.indices.length,
      type: 'SCALAR',
    },
    {
      bufferView: view(asBytes(mesh.positions), ARRAY_BUFFER),
      componentType: FLOAT,
      count: vertexCount,
      type: 'VEC3',
      min,
      max,
    },
    {
      bufferView: view(asBytes(unitNormals(mesh)), ARRAY_BUFFER),
      componentType: FLOAT,
      count: vertexCount,
      type: 'VEC3',
    },
    {
      bufferView: view(colourBytes(mesh, options.look), ARRAY_BUFFER),
      componentType: UNSIGNED_BYTE,
      normalized: true,
      count: vertexCount,
      type: 'VEC4',
    },
  ];
  if (hasShading) {
    const shadingView = view(shadingBytes(mesh), ARRAY_BUFFER);
    (views[shadingView] as Json).byteStride = 4;
    accessors.push({
      bufferView: shadingView,
      componentType: UNSIGNED_BYTE,
      normalized: true,
      count: vertexCount,
      type: 'VEC2',
    });
  }

  const json = document(
    options,
    mesh,
    { scale: [MM_TO_M, MM_TO_M, MM_TO_M] },
    {
      meshes: [{ name: options.name, primitives: [primitive(hasShading)] }],
      accessors,
      bufferViews: views,
      buffers: [{ byteLength: bin.length }],
    },
  );
  return container(json, bin.toBytes());
}

function encodeCompact(source: IndexedMesh, options: GlbOptions): ArrayBuffer {
  // Reordering for the GPU's vertex cache is also what makes the codec effective.
  const indices = source.indices.slice();
  const [remap, vertexCount] = MeshoptEncoder.reorderMesh(indices, true, true);
  const mesh = reordered({ ...source, indices }, remap, vertexCount);
  const hasShading = Boolean(mesh.occlusion && mesh.cavity);

  // Positions as 16-bit steps of the largest extent; the node transform undoes it.
  const { min, max } = bounds(mesh.positions);
  const extent = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) || 1;
  const step = extent / 65535;

  // View A, 8 bytes per vertex: position (3 × u16) and two padding bytes.
  const a = new ArrayBuffer(vertexCount * 8);
  const aView = new DataView(a);
  const qMax = [0, 0, 0];
  for (let v = 0; v < vertexCount; v++) {
    for (let axis = 0; axis < 3; axis++) {
      const q = Math.round((mesh.positions[v * 3 + axis]! - min[axis]!) / step);
      aView.setUint16(v * 8 + axis * 2, q, true);
      if (q > qMax[axis]!) qMax[axis] = q;
    }
  }
  // View B, 4 bytes per vertex: normal (3 × i8) and a padding byte.
  const normals = unitNormals(mesh);
  const b = new Int8Array(vertexCount * 4);
  for (let v = 0; v < vertexCount; v++) {
    for (let axis = 0; axis < 3; axis++) b[v * 4 + axis] = toSignedByte(normals[v * 3 + axis]!);
  }
  // View C, 4 bytes per vertex: colour.
  const c = colourBytes(mesh, options.look);

  const small = vertexCount <= 65535;
  const indexBytes = asBytes(small ? Uint16Array.from(indices) : indices);
  const indexSize = small ? 2 : 4;

  const bin = new Bin();
  let fallbackLength = 0;
  const views: Json[] = [];
  const view = (
    raw: Uint8Array,
    count: number,
    byteStride: number,
    mode: 'ATTRIBUTES' | 'TRIANGLES',
  ): number => {
    const packed = MeshoptEncoder.encodeGltfBuffer(raw, count, byteStride, mode);
    const compressed = { buffer: 0, ...bin.add(packed), byteStride, count, mode };
    const attributes = mode === 'ATTRIBUTES';
    views.push({
      buffer: 1,
      byteOffset: fallbackLength,
      byteLength: raw.byteLength,
      ...(attributes ? { byteStride } : {}),
      target: attributes ? ARRAY_BUFFER : ELEMENT_ARRAY_BUFFER,
      extensions: { EXT_meshopt_compression: compressed },
    });
    fallbackLength += raw.byteLength + ((4 - (raw.byteLength % 4)) % 4);
    return views.length - 1;
  };

  const indexView = view(indexBytes, indices.length, indexSize, 'TRIANGLES');
  const viewA = view(new Uint8Array(a), vertexCount, 8, 'ATTRIBUTES');
  const viewB = view(asBytes(b), vertexCount, 4, 'ATTRIBUTES');
  const viewC = view(c, vertexCount, 4, 'ATTRIBUTES');

  const accessors: Json[] = [
    {
      bufferView: indexView,
      componentType: small ? UNSIGNED_SHORT : UNSIGNED_INT,
      count: indices.length,
      type: 'SCALAR',
    },
    {
      bufferView: viewA,
      componentType: UNSIGNED_SHORT,
      count: vertexCount,
      type: 'VEC3',
      min: [0, 0, 0],
      max: qMax,
    },
    { bufferView: viewB, componentType: BYTE, normalized: true, count: vertexCount, type: 'VEC3' },
    {
      bufferView: viewC,
      componentType: UNSIGNED_BYTE,
      normalized: true,
      count: vertexCount,
      type: 'VEC4',
    },
  ];
  if (hasShading) {
    accessors.push({
      bufferView: view(shadingBytes(mesh), vertexCount, 4, 'ATTRIBUTES'),
      componentType: UNSIGNED_BYTE,
      normalized: true,
      count: vertexCount,
      type: 'VEC2',
    });
  }

  const extensions = ['KHR_mesh_quantization', 'EXT_meshopt_compression'];
  const json = document(
    options,
    mesh,
    {
      translation: min.map((value) => value * MM_TO_M),
      scale: [step * MM_TO_M, step * MM_TO_M, step * MM_TO_M],
    },
    {
      extensionsUsed: extensions,
      extensionsRequired: extensions,
      meshes: [{ name: options.name, primitives: [primitive(hasShading)] }],
      accessors,
      bufferViews: views,
      buffers: [
        { byteLength: bin.length },
        // Never stored: tells loaders without the extension how big the decoded data would be.
        { byteLength: fallbackLength, extensions: { EXT_meshopt_compression: { fallback: true } } },
      ],
    },
  );
  return container(json, bin.toBytes());
}

/** Resolves once the WebAssembly encoder is compiled. Must be awaited before a compact export. */
export const glbEncoderReady = (): Promise<void> => MeshoptEncoder.ready;

export function encodeGlb(mesh: IndexedMesh, options: GlbOptions): ArrayBuffer {
  if (mesh.positions.length === 0) throw new Error('Cannot export an empty mesh');
  return options.compact ? encodeCompact(mesh, options) : encodePlain(mesh, options);
}
