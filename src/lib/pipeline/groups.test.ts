import { beforeAll, describe, expect, it } from 'vitest';
import {
  addBox,
  generateBoulder,
  generateFigure,
  generatePuddleFigure,
  generateRecessBase,
  generateSwarm,
  generateWingedFigure,
  RECESS_BASE,
} from '../../regression/shapes';
import type { GroupOrigin, PaintGroups } from './brush';
import { TriangleBvh, type SurfaceHit } from './bvh';
import { triangleAdjacency } from './fill';
import { groupsOf, SHELL_MIN_TRIANGLES } from './groups';
import { weldVertices, type IndexedMesh } from './mesh';
import { regionsOf } from './regions';
import { runPipeline, type ConversionResult } from './run';
import { encodeBinaryStl } from './stl';

// The automatic groups (#139, design note `docs/design/paint-groups.md` §4).

const convert = (stl: Float32Array, options: Parameters<typeof runPipeline>[1] = {}) =>
  runPipeline(encodeBinaryStl(stl), { bake: 256, compress: null, ...options });

const regionsOfResult = (result: ConversionResult) =>
  regionsOf(result.baked!.mesh, {
    source: result.mesh,
    figureTriangles: result.pair?.figureTriangles,
    sizing: result.sizing,
    kind: result.kind,
  });

/** A soup as one mesh, welded as the converter's read step welds it. */
const meshOf = (soup: Float32Array | number[]): IndexedMesh =>
  weldVertices(soup instanceof Float32Array ? soup : new Float32Array(soup)).mesh;

/** The triangles of each group. */
const counts = ({ of, made }: PaintGroups): number[] => {
  const out = made.map(() => 0);
  for (const group of of) out[group]!++;
  return out;
};

/** The group a group's triangles came from before the shells were split: itself, or the one a shell was split from. */
const rootOf = (made: readonly GroupOrigin[], group: number): number => {
  const origin = made[group]!;
  return origin.by === 'shell' ? origin.of : group;
};

/** Triangle t's middle. */
function middle({ positions, indices }: IndexedMesh, t: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let corner = 0; corner < 3; corner++)
    for (let axis = 0; axis < 3; axis++)
      out[axis] = out[axis]! + positions[indices[t * 3 + corner]! * 3 + axis]! / 3;
  return out;
}

/** Whether every triangle of each group is joined to the rest of its group by shared edges, and to no other group's. */
function expectConnectedApart(mesh: IndexedMesh, groups: PaintGroups): void {
  const { start, neighbours } = triangleAdjacency(mesh);
  const triangles = groups.of.length;
  const seen = new Uint8Array(triangles);
  const reached = groups.made.map(() => 0);
  let across = 0;
  for (let seed = 0; seed < triangles; seed++) {
    if (seen[seed]) continue;
    // One flood per group: from its first triangle, over every edge.
    const group = groups.of[seed]!;
    const queue = [seed];
    seen[seed] = 1;
    while (queue.length > 0) {
      const t = queue.pop()!;
      reached[group]!++;
      for (let k = start[t]!; k < start[t + 1]!; k++) {
        const n = neighbours[k]!;
        if (groups.of[n] !== group) across++;
        else if (!seen[n]) {
          seen[n] = 1;
          queue.push(n);
        }
      }
    }
  }
  expect(across).toBe(0);
  expect(reached).toEqual(counts(groups));
}

describe('groupsOf: the files of a figure in parts, and its base', () => {
  let kit: ConversionResult;
  beforeAll(async () => {
    const { body, wing, tip } = generateWingedFigure();
    kit = await convert(body, {
      secondStl: encodeBinaryStl(generateRecessBase()),
      moreStl: [encodeBinaryStl(wing), encodeBinaryStl(tip)],
      pairing: { baseFile: 1 },
    });
  }, 240_000);

  it('gives the body, a group per other file and the base, each triangle in the file nearest its middle', () => {
    const table = kit.baked!.mesh;
    const parts = kit.pair!.parts;
    expect(parts.map((part) => part.file)).toEqual([0, 2, 3]);
    const regions = regionsOfResult(kit)!;
    expect(regions.method).toBe('pair');
    const groups = groupsOf(table, {
      regions,
      source: kit.mesh,
      parts,
      figureTriangles: kit.pair!.figureTriangles,
    });
    expect(groups.of.length).toBe(table.indices.length / 3);
    expect(groups.made.slice(0, 4)).toEqual([
      { by: 'body' },
      { by: 'part', file: 2 },
      { by: 'part', file: 3 },
      { by: 'base' },
    ]);
    // The rest are shells, of the files' groups.
    for (const origin of groups.made.slice(4)) expect(origin.by).toBe('shell');
    const sizes = counts(groups);
    for (const group of [0, 1, 2, 3]) expect(sizes[group]).toBeGreaterThan(10);

    // A tree over each figure file's range of the merged mesh: the file nearest each middle.
    const trees: TriangleBvh[] = [];
    let first = 0;
    for (const part of parts) {
      trees.push(
        new TriangleBvh({
          positions: kit.mesh.positions,
          indices: kit.mesh.indices.subarray(first * 3, (first + part.triangles) * 3),
        }),
      );
      first += part.triangles;
    }
    const hit: SurfaceHit = { triangle: -1, u: 0, v: 0, w: 0, distanceSquared: Infinity };
    let checked = 0;
    let ties = 0;
    for (let t = 0; t < groups.of.length; t++) {
      // The base is the regions' (below); the figure's triangles are the files'.
      if (regions.base[t]) {
        expect(groups.of[t]).toBe(3);
        continue;
      }
      expect(groups.of[t]).not.toBe(3);
      const at = middle(table, t);
      const distances = trees.map((tree) => {
        tree.closest(hit, ...at, Infinity);
        return Math.sqrt(hit.distanceSquared);
      });
      const nearest = distances.indexOf(Math.min(...distances));
      const group = rootOf(groups.made, groups.of[t]!);
      checked++;
      if (group === nearest) continue;
      // Only where two files meet: the one it took is as near, to the levels' error.
      ties++;
      expect(distances[group]! - distances[nearest]!).toBeLessThan(0.25);
    }
    expect(checked).toBeGreaterThan(1000);
    expect(ties / checked).toBeLessThan(0.01);
  }, 60_000);

  it('finds the base by the base file when no regions are given', () => {
    const table = kit.baked!.mesh;
    const regions = regionsOfResult(kit)!;
    const groups = groupsOf(table, {
      source: kit.mesh,
      parts: kit.pair!.parts,
      figureTriangles: kit.pair!.figureTriangles,
    });
    expect(groups.made[3]).toEqual({ by: 'base' });
    // The regions' rule (three corners within REGION_REACH_MM of the base file) also takes the
    // figure's puddle in the recess, 0.8 mm above its floor; a middle nearest the figure's file
    // is the figure's. Every other triangle of the region is the base group's.
    const puddleTop = RECESS_BASE.heightMm - RECESS_BASE.recessDepthMm + 0.8;
    let base = 0;
    let puddle = 0;
    for (let t = 0; t < groups.of.length; t++) {
      if (!regions.base[t]) continue;
      base++;
      if (rootOf(groups.made, groups.of[t]!) === 3) continue;
      const [x, y, z] = middle(table, t);
      expect(Math.abs(y - puddleTop)).toBeLessThan(0.05);
      expect(Math.hypot(x, z)).toBeLessThan(RECESS_BASE.recessMm / 2);
      puddle++;
    }
    expect(base - puddle).toBeGreaterThan(500);
  });
});

describe('groupsOf: a figure with its base file', () => {
  it('gives a base group equal to the fill’s ready region, triangle for triangle', async () => {
    const pair = await convert(generatePuddleFigure(12), {
      secondStl: encodeBinaryStl(generateRecessBase()),
    });
    const table = pair.baked!.mesh;
    const regions = regionsOfResult(pair)!;
    const groups = groupsOf(table, {
      regions,
      source: pair.mesh,
      parts: pair.pair!.parts,
      figureTriangles: pair.pair!.figureTriangles,
    });
    expect(groups.made[1]).toEqual({ by: 'base' });
    let base = 0;
    for (let t = 0; t < groups.of.length; t++) {
      if (regions.base[t]) {
        expect(rootOf(groups.made, groups.of[t]!)).toBe(1);
        base++;
      } else expect(rootOf(groups.made, groups.of[t]!)).toBe(0);
    }
    expect(base).toBeGreaterThan(100);
  }, 240_000);
});

describe('groupsOf: the shells of one file', { timeout: 60_000 }, () => {
  it('gives the generated figure’s body and its head and arms as shells, each connected and apart', () => {
    const mesh = meshOf(generateFigure(false));
    const groups = groupsOf(mesh);
    expect(groups.made).toEqual([
      { by: 'body' },
      { by: 'shell', of: 0 },
      { by: 'shell', of: 0 },
      { by: 'shell', of: 0 },
    ]);
    const sizes = counts(groups);
    // The body keeps the largest piece; the shells largest first.
    expect(sizes[0]).toBeGreaterThan(sizes[1]!);
    expect(sizes[1]).toBeGreaterThanOrEqual(sizes[2]!);
    expect(sizes[2]).toBeGreaterThanOrEqual(sizes[3]!);
    expectConnectedApart(mesh, groups);
    // The head is above the shoulders: the first shell's middle is higher than the arms'.
    const highest = (group: number): number => {
      let top = -Infinity;
      for (let t = 0; t < groups.of.length; t++)
        if (groups.of[t] === group) top = Math.max(top, middle(mesh, t)[2]);
      return top;
    };
    expect(highest(1)).toBeGreaterThan(Math.max(highest(2), highest(3)));
  }, 60_000);

  it('leaves a shell under SHELL_MIN_TRIANGLES in its group', () => {
    const soup = Array.from(generateFigure(false));
    // A fleck of twelve triangles beside the foot.
    addBox(soup, [10, 10, 0], [10.5, 10.5, 0.5]);
    const mesh = meshOf(soup);
    const groups = groupsOf(mesh);
    expect(groups.made).toHaveLength(4);
    const triangles = mesh.indices.length / 3;
    for (let t = triangles - 12; t < triangles; t++) expect(groups.of[t]).toBe(0);
    expect(12).toBeLessThan(SHELL_MIN_TRIANGLES);
  });

  it('gives a fused sculpt one group', () => {
    const mesh = meshOf(generateBoulder());
    const groups = groupsOf(mesh);
    expect(groups.made).toEqual([{ by: 'body' }]);
    expect(groups.of.every((group) => group === 0)).toBe(true);
  });

  it('keeps the largest shells when there are more than the groups allowed', () => {
    const mesh = meshOf(generateSwarm());
    const all = groupsOf(mesh);
    // The base and twelve creatures: thirteen shells, every one big enough.
    expect(all.made).toHaveLength(13);
    const capped = groupsOf(mesh, { maxGroups: 5 });
    expect(capped.made).toHaveLength(5);
    const allSizes = counts(all);
    const cappedSizes = counts(capped);
    // The four largest shells are groups; the rest are the body's.
    expect(cappedSizes.slice(1)).toEqual(allSizes.slice(1, 5));
    expect(cappedSizes[0]).toBe(allSizes[0]! + allSizes.slice(5).reduce((a, b) => a + b, 0));
  });

  it('refuses regions that are not the mesh’s', () => {
    const mesh = meshOf(generateBoulder());
    expect(() => groupsOf(mesh, { regions: { base: new Uint8Array(3), method: 'plain' } })).toThrow(
      RangeError,
    );
  });
});
