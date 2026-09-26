import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateBumpySheet } from './generate';
import { weldVertices, type IndexedMesh } from './mesh';
import { loadXatlas, PROGRESS, type Atlas, type AtlasOptions, type Xatlas } from './xatlas';

const WASM = new URL('../../wasm/xatlas/xatlas.wasm', import.meta.url);

/** Everything the module may reach outside itself (design note, section 5). A new entry is a question for a human, not a stub. */
const ALLOWED_IMPORTS = [
  'env.mt_progress',
  'env.emscripten_notify_memory_growth',
  'wasi_snapshot_preview1.fd_write',
];

const SHIM_EXPORTS = [
  'mt_out_of_memory',
  'mt_atlas_create',
  'mt_atlas_destroy',
  'mt_add_mesh',
  'mt_add_mesh_error_string',
  'mt_generate',
  'mt_atlas_width',
  'mt_atlas_height',
  'mt_atlas_chart_count',
  'mt_atlas_utilization',
  'mt_mesh_vertex_count',
  'mt_mesh_index_count',
  'mt_mesh_vertices',
  'mt_mesh_indices',
  'mt_vertex_stride',
  'mt_vertex_uv_offset',
  'mt_vertex_xref_offset',
];

const OPTIONS: AtlasOptions = {
  maxCost: 8,
  resolution: 512,
  padding: 3,
  bilinear: true,
  blockAlign: true,
};

const sheet = (quadsPerSide: number): IndexedMesh =>
  weldVertices(generateBumpySheet(quadsPerSide)).mesh;

/** Checks what every unwrap must give: coordinates in the atlas, valid references and indices. */
function expectSound(atlas: Atlas, source: IndexedMesh): void {
  const out = atlas.mesh(0);
  expect(out.vertexCount).toBeGreaterThanOrEqual(source.positions.length / 3);
  expect(out.uvs.length).toBe(out.vertexCount * 2);
  expect(out.xref.length).toBe(out.vertexCount);
  expect(out.indices.length).toBe(source.indices.length);
  for (let v = 0; v < out.vertexCount; v++) {
    expect(out.uvs[v * 2]).toBeGreaterThanOrEqual(0);
    expect(out.uvs[v * 2]).toBeLessThanOrEqual(atlas.width);
    expect(out.uvs[v * 2 + 1]).toBeGreaterThanOrEqual(0);
    expect(out.uvs[v * 2 + 1]).toBeLessThanOrEqual(atlas.height);
    expect(out.xref[v]).toBeLessThan(source.positions.length / 3);
  }
  expect(Math.max(...out.indices)).toBeLessThan(out.vertexCount);
  expect(atlas.chartCount).toBeGreaterThanOrEqual(1);
  expect(atlas.utilisation(0)).toBeGreaterThan(0);
  expect(atlas.utilisation(0)).toBeLessThanOrEqual(1);
}

describe('the xatlas module', () => {
  const module = new WebAssembly.Module(readFileSync(WASM));

  it('reaches nothing outside itself but the pinned imports', () => {
    const imports = WebAssembly.Module.imports(module).map((i) => `${i.module}.${i.name}`);
    expect(imports.sort()).toEqual([...ALLOWED_IMPORTS].sort());
  });

  it('exports every function of the shim', () => {
    const exports = WebAssembly.Module.exports(module).map((e) => e.name);
    expect(exports).toEqual(expect.arrayContaining([...SHIM_EXPORTS, 'memory', 'malloc', 'free']));
  });
});

describe('the xatlas wrapper', () => {
  let xatlas: Xatlas;
  beforeAll(async () => {
    xatlas = await loadXatlas();
  });

  it('is loaded once', async () => {
    expect(await loadXatlas()).toBe(xatlas);
  });

  it('unwraps a bumpy sheet', () => {
    const mesh = sheet(24);
    const atlas = xatlas.createAtlas();
    try {
      atlas.addMesh(mesh, 1);
      atlas.generate(OPTIONS);
      expectSound(atlas, mesh);
    } finally {
      atlas.destroy();
    }
  });

  it("throws xatlas's own message when it refuses a mesh", () => {
    const mesh = sheet(4);
    const indices = mesh.indices.slice();
    indices[0] = mesh.positions.length / 3 + 5;
    const atlas = xatlas.createAtlas();
    try {
      expect(() => atlas.addMesh({ positions: mesh.positions, indices }, 1)).toThrow(
        /^Unwrap failed: .*index.*out of range/i,
      );
    } finally {
      atlas.destroy();
    }
  });

  it('reports the progress of finding the charts, and stops when asked to', () => {
    const mesh = sheet(24);
    const seen: [number, number][] = [];
    const atlas = xatlas.createAtlas();
    try {
      atlas.addMesh(mesh, 1);
      atlas.generate(OPTIONS, (category, percent) => {
        seen.push([category, percent]);
        return true;
      });
    } finally {
      atlas.destroy();
    }
    const charts = seen
      .filter(([category]) => category === PROGRESS.computeCharts)
      .map(([, p]) => p);
    expect(charts.length).toBeGreaterThan(1);
    for (let i = 1; i < charts.length; i++)
      expect(charts[i]).toBeGreaterThanOrEqual(charts[i - 1]!);

    // xatlas closes the stage it was cancelled in with a last 100 %, and starts no other.
    const afterCancel: [number, number][] = [];
    const cancelled = xatlas.createAtlas();
    try {
      cancelled.addMesh(mesh, 1);
      cancelled.generate(OPTIONS, (category, percent) => {
        afterCancel.push([category, percent]);
        return false;
      });
    } finally {
      cancelled.destroy();
    }
    expect(afterCancel).toEqual([
      [PROGRESS.computeCharts, 0],
      [PROGRESS.computeCharts, 100],
    ]);
  });

  it('reads the result correctly after the heap has grown', () => {
    const small = sheet(24);
    const atlas = xatlas.createAtlas();
    const big = xatlas.createAtlas();
    try {
      atlas.addMesh(small, 1);
      atlas.generate(OPTIONS);
      const before = atlas.mesh(0);
      const heap = (xatlas as unknown as { exports: { memory: WebAssembly.Memory } }).exports
        .memory;
      const grownFrom = heap.buffer.byteLength;
      // Adding a large mesh to a second atlas grows the heap past its initial 16 MB.
      big.addMesh(sheet(400), 1);
      expect(heap.buffer.byteLength).toBeGreaterThan(grownFrom);
      expectSound(atlas, small);
      expect(atlas.mesh(0)).toEqual(before);
    } finally {
      big.destroy();
      atlas.destroy();
    }
  });

  it('refuses an atlas after it was destroyed', () => {
    const atlas = xatlas.createAtlas();
    atlas.destroy();
    expect(() => atlas.width).toThrow(/^Unwrap failed: the atlas is gone/);
    atlas.destroy();
  });
});
