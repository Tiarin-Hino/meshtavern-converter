import { validateBytes } from 'gltf-validator';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateBumpySheet } from './generate';
import { encodeGlb, glbEncoderReady } from './glb';
import { DEFAULT_LOOK, LOOK_PRESETS, vertexColours, type Look } from './look';
import { computeVertexNormals, weldVertices, type IndexedMesh } from './mesh';
import { shade } from './shade';
import type { Orientation } from './orient';
import { AXIS_ROTATION, fromAxisAngle, multiply } from './rotation';
import type { Sizing } from './size';

// 40 × 40 quads: 3,200 triangles, 1,681 vertices, 50 mm wide, shaded like a converted mini.
const sheet: IndexedMesh = weldVertices(generateBumpySheet(40)).mesh;
sheet.normals = computeVertexNormals(sheet);
shade(sheet);

const options = { name: 'test mini', look: DEFAULT_LOOK };

interface Gltf {
  accessors: {
    bufferView: number;
    byteOffset?: number;
    count: number;
    max?: number[];
    componentType: number;
    type: string;
    normalized?: boolean;
  }[];
  bufferViews: {
    byteLength: number;
    byteStride?: number;
    extensions?: {
      EXT_meshopt_compression: {
        byteOffset: number;
        byteLength: number;
        byteStride: number;
        count: number;
        mode: string;
      };
    };
    byteOffset: number;
  }[];
  nodes: { scale: number[]; translation?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  extensionsRequired?: string[];
  extras: { sizeMm: number[]; meshtavern?: Record<string, unknown> };
}

function parse(glb: ArrayBuffer): { json: Gltf; bin: Uint8Array } {
  const view = new DataView(glb);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength))) as Gltf;
  const binLength = view.getUint32(20 + jsonLength, true);
  return { json, bin: new Uint8Array(glb, 20 + jsonLength + 8, binLength) };
}

async function validate(glb: ArrayBuffer): Promise<{ errors: number; messages: string[] }> {
  const report = await validateBytes(new Uint8Array(glb), { maxIssues: 50 });
  return {
    errors: report.issues.numErrors,
    messages: report.issues.messages
      .filter((message: { severity: number }) => message.severity === 0)
      .map((message: { code: string; pointer: string }) => `${message.code} ${message.pointer}`),
  };
}

beforeAll(async () => {
  await glbEncoderReady();
  await MeshoptDecoder.ready;
});

describe('encodeGlb, plain', () => {
  const glb = encodeGlb(sheet, { ...options, compact: false });
  const { json, bin } = parse(glb);

  it('passes the Khronos validator without errors', async () => {
    expect(await validate(glb)).toEqual({ errors: 0, messages: [] });
  });

  it('stores every triangle and vertex, in millimetres, with a node scale to metres', () => {
    expect(json.accessors[0]!.count).toBe(sheet.indices.length);
    expect(json.accessors[1]!.count).toBe(sheet.positions.length / 3);
    expect(json.nodes[0]!.scale).toEqual([0.001, 0.001, 0.001]);
    expect(json.extras.sizeMm[0]).toBeCloseTo(50);
    const view = json.bufferViews[json.accessors[1]!.bufferView]!;
    const stored = new Float32Array(
      bin.slice(view.byteOffset, view.byteOffset + view.byteLength).buffer,
    );
    expect(Array.from(stored)).toEqual(Array.from(sheet.positions));
  });

  it('bakes the look into COLOR_0 and keeps the raw shading data', () => {
    const attributes = json.meshes[0]!.primitives[0]!.attributes;
    expect(Object.keys(attributes).sort()).toEqual(
      ['COLOR_0', 'NORMAL', 'POSITION', '_SHADING'].sort(),
    );
    const view = json.bufferViews[json.accessors[attributes.COLOR_0!]!.bufferView]!;
    const expected = vertexColours(sheet, DEFAULT_LOOK);
    expect(bin[view.byteOffset]).toBe(Math.round(expected[0]! * 255));
    expect(bin[view.byteOffset + 3]).toBe(255);
  });

  it('uses 16-bit indices for small meshes', () => {
    expect(json.bufferViews[0]!.byteLength).toBe(sheet.indices.length * 2);
  });
});

describe('encodeGlb, with the sizing', () => {
  const sizing: Sizing = {
    units: 'in',
    unitsMethod: 'guessed',
    scale: 25.4,
    base: null,
    plainBase: { diameterMm: 50, heightMm: 3 },
    size: 'large',
    sizeMethod: 'manual',
    footprintSquares: 2,
    baseDiameterMm: 50,
    suggestedFrom: 'default',
    warnings: [],
  };

  it.each([false, true])(
    'records what the table needs in extras (compact: %s)',
    async (compact) => {
      const glb = encodeGlb(sheet, { ...options, compact, sizing });
      expect(parse(glb).json.extras.meshtavern).toEqual({
        gridSquareMm: 32,
        size: 'large',
        footprintSquares: 2,
        baseDiameterMm: 50,
        units: 'in',
        scale: 25.4,
        look: { preset: 'primer', ...DEFAULT_LOOK },
      });
      expect(await validate(glb)).toEqual({ errors: 0, messages: [] });
    },
  );

  it('records the rotation from the file, which the validator accepts', async () => {
    const orientation: Orientation = {
      up: '+z',
      method: 'manual',
      confidence: 1,
      rotation: multiply(fromAxisAngle([1, 0, 0], 12), AXIS_ROTATION['+z']),
      tiltDeg: 12,
      setDownDeg: 12,
    };
    const glb = encodeGlb(sheet, { ...options, compact: true, sizing, orientation });
    const block = parse(glb).json.extras.meshtavern!;
    expect(block.rotation).toEqual(orientation.rotation);
    expect(block).toMatchObject({ size: 'large', footprintSquares: 2 });
    expect(await validate(glb)).toEqual({ errors: 0, messages: [] });
  });

  it('records the look and the preset it is, or null for a look of its own', () => {
    const steel = LOOK_PRESETS.find((preset) => preset.id === 'steel')!.look;
    const block = (look: Look) =>
      parse(encodeGlb(sheet, { ...options, compact: false, sizing, look })).json.extras.meshtavern!;
    expect(block(steel).look).toEqual({ preset: 'steel', ...steel });
    const own = { ...steel, base: '#335577' };
    expect(block(own).look).toEqual({ preset: null, ...own });
  });

  it('writes no block without a sizing', () => {
    const glb = encodeGlb(sheet, { ...options, compact: false });
    expect(parse(glb).json.extras).not.toHaveProperty('meshtavern');
  });
});

describe('encodeGlb, compact', () => {
  const glb = encodeGlb(sheet, { ...options, compact: true });
  const { json, bin } = parse(glb);

  it('requires the two extensions it uses and is much smaller than the plain file', () => {
    expect(json.extensionsRequired).toEqual(['KHR_mesh_quantization', 'EXT_meshopt_compression']);
    const plain = encodeGlb(sheet, { ...options, compact: false });
    expect(glb.byteLength).toBeLessThan(plain.byteLength / 2.5);
  });

  it('has no validator errors', async () => {
    expect(await validate(glb)).toEqual({ errors: 0, messages: [] });
  });

  it('decodes back to the same surface within the quantisation step', () => {
    const decode = (viewIndex: number): Uint8Array => {
      const extension = json.bufferViews[viewIndex]!.extensions!.EXT_meshopt_compression;
      const out = new Uint8Array(extension.count * extension.byteStride);
      MeshoptDecoder.decodeGltfBuffer(
        out,
        extension.count,
        extension.byteStride,
        bin.subarray(extension.byteOffset, extension.byteOffset + extension.byteLength),
        extension.mode,
      );
      return out;
    };
    const node = json.nodes[0]!;
    const vertexData = new DataView(decode(json.accessors[1]!.bufferView).buffer);
    const indexData = new Uint16Array(decode(json.accessors[0]!.bufferView).buffer);
    expect(indexData.length).toBe(sheet.indices.length);

    // Same set of points, whatever the new vertex order: compare sorted x coordinates in mm.
    const decodedX: number[] = [];
    for (let v = 0; v < json.accessors[1]!.count; v++) {
      decodedX.push(
        (vertexData.getUint16(v * 8, true) * node.scale[0]! + node.translation![0]!) * 1000,
      );
    }
    const sourceX = Array.from(
      { length: sheet.positions.length / 3 },
      (_, v) => sheet.positions[v * 3]!,
    );
    decodedX.sort((p, q) => p - q);
    sourceX.sort((p, q) => p - q);
    const stepMm = node.scale[0]! * 1000;
    decodedX.forEach((x, i) => expect(Math.abs(x - sourceX[i]!)).toBeLessThanOrEqual(stepMm));
    expect(Math.max(...indexData)).toBe(json.accessors[1]!.count - 1);
  });
});

describe('encodeGlb, with texture coordinates', () => {
  // Texture coordinates that follow from the position, so a vertex can be checked after the
  // compact variant has renumbered it: u along x, v along the sheet's other long side.
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  sheet.positions.forEach((value, i) => {
    low[i % 3] = Math.min(low[i % 3]!, value);
    high[i % 3] = Math.max(high[i % 3]!, value);
  });
  const side = high[1]! - low[1]! > high[2]! - low[2]! ? 1 : 2;
  const uvOf = (x: number, other: number): [number, number] => [
    (x - low[0]!) / (high[0]! - low[0]!),
    (other - low[side]!) / (high[side]! - low[side]!),
  ];
  const vertexCount = sheet.positions.length / 3;
  const uvs = new Float32Array(vertexCount * 2);
  for (let v = 0; v < vertexCount; v++) {
    uvs.set(uvOf(sheet.positions[v * 3]!, sheet.positions[v * 3 + side]!), v * 2);
  }
  const unwrapped: IndexedMesh = { ...sheet, uvs };

  it.each([false, true])(
    'writes TEXCOORD_0 after the other attributes and passes the validator (compact: %s)',
    async (compact) => {
      const glb = encodeGlb(unwrapped, { ...options, compact });
      expect(parse(glb).json.meshes[0]!.primitives[0]!.attributes).toEqual({
        POSITION: 1,
        NORMAL: 2,
        COLOR_0: 3,
        _SHADING: 4,
        TEXCOORD_0: 5,
      });
      expect(await validate(glb)).toEqual({ errors: 0, messages: [] });
    },
  );

  it('stores them as floats in the plain variant, unchanged', () => {
    const { json, bin } = parse(encodeGlb(unwrapped, { ...options, compact: false }));
    const accessor = json.accessors[5]!;
    expect(accessor).toMatchObject({ componentType: 5126, type: 'VEC2', count: vertexCount });
    const view = json.bufferViews[accessor.bufferView]!;
    const stored = new Float32Array(
      bin.slice(view.byteOffset, view.byteOffset + view.byteLength).buffer,
    );
    expect(Array.from(stored)).toEqual(Array.from(uvs));
  });

  it('stores them as normalised 16-bit in the compact variant, each with its vertex', () => {
    const { json, bin } = parse(encodeGlb(unwrapped, { ...options, compact: true }));
    const decode = (accessorIndex: number): DataView => {
      const extension =
        json.bufferViews[json.accessors[accessorIndex]!.bufferView]!.extensions!
          .EXT_meshopt_compression;
      const out = new Uint8Array(extension.count * extension.byteStride);
      MeshoptDecoder.decodeGltfBuffer(
        out,
        extension.count,
        extension.byteStride,
        bin.subarray(extension.byteOffset, extension.byteOffset + extension.byteLength),
        extension.mode,
      );
      return new DataView(out.buffer);
    };
    expect(json.accessors[5]).toMatchObject({
      componentType: 5123,
      normalized: true,
      type: 'VEC2',
      count: vertexCount,
    });
    const node = json.nodes[0]!;
    const positions = decode(1);
    const coordinates = decode(5);
    const mm = (v: number, axis: number): number =>
      (positions.getUint16(v * 8 + axis * 2, true) * node.scale[axis]! + node.translation![axis]!) *
      1000;
    // The position is quantised too: allow its step, as a share of the sheet's side, and the
    // texture coordinate's own.
    const tolerance = (node.scale[0]! * 1000) / (high[0]! - low[0]!) + 1 / 65535;
    for (let v = 0; v < vertexCount; v++) {
      const [u, w] = uvOf(mm(v, 0), mm(v, side));
      expect(Math.abs(coordinates.getUint16(v * 4, true) / 65535 - u)).toBeLessThan(tolerance);
      expect(Math.abs(coordinates.getUint16(v * 4 + 2, true) / 65535 - w)).toBeLessThan(tolerance);
    }
  });

  it('takes the place of the shading data when the mesh has none', async () => {
    const bare = { positions: sheet.positions, indices: sheet.indices, uvs };
    for (const compact of [false, true]) {
      const glb = encodeGlb(bare, { ...options, compact });
      expect(parse(glb).json.meshes[0]!.primitives[0]!.attributes.TEXCOORD_0).toBe(4);
      expect(await validate(glb)).toEqual({ errors: 0, messages: [] });
    }
  });

  it('leaves a mesh without them as it was', () => {
    for (const compact of [false, true]) {
      const json = parse(encodeGlb(sheet, { ...options, compact })).json;
      expect(json.accessors).toHaveLength(5);
      expect(json.meshes[0]!.primitives[0]!.attributes).not.toHaveProperty('TEXCOORD_0');
    }
  });
});

describe('encodeGlb', () => {
  it('exports a mesh without normals or shading data', async () => {
    const bare = { positions: sheet.positions, indices: sheet.indices };
    const glb = encodeGlb(bare, { ...options, compact: false });
    const attributes = parse(glb).json.meshes[0]!.primitives[0]!.attributes;
    expect(Object.keys(attributes).sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION']);
    expect((await validate(glb)).errors).toBe(0);
  });

  it('refuses an empty mesh', () => {
    const empty = { positions: new Float32Array(0), indices: new Uint32Array(0) };
    expect(() => encodeGlb(empty, { ...options, compact: false })).toThrow();
  });
});
