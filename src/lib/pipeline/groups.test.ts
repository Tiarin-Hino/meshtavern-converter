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
import { APART_MIN_GAP_MM, APART_SHARE, pulledApart } from './assemble';
import type { Vec3 } from './base';
import type { GroupOrigin, PaintGroups } from './brush';
import { TriangleBvh, type SurfaceHit } from './bvh';
import { triangleAdjacency } from './fill';
import { groupsApart, groupsOf, SHELL_MIN_TRIANGLES } from './groups';
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

// Pulling groups apart (#180, design note `docs/design/paint-groups.md` §9): the apart rule of the
// parts question over the groups' boxes.

/** The box of a group's triangles, moved by `by`. */
function boxOfGroup(
  mesh: IndexedMesh,
  of: Uint8Array,
  group: number,
  by: Vec3 = [0, 0, 0],
): { min: Vec3; max: Vec3 } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (let t = 0; t < of.length; t++) {
    if (of[t] !== group) continue;
    any = true;
    for (let corner = 0; corner < 3; corner++) {
      const v = mesh.indices[t * 3 + corner]! * 3;
      for (let k = 0; k < 3; k++) {
        const value = mesh.positions[v + k]! + by[k]!;
        min[k] = Math.min(min[k]!, value);
        max[k] = Math.max(max[k]!, value);
      }
    }
  }
  return any ? { min, max } : null;
}

const clearOf = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }, gap: number): boolean =>
  [0, 1, 2].some((k) => a.min[k]! >= b.max[k]! + gap || b.min[k]! >= a.max[k]! + gap);

const middleOf = ({ min, max }: { min: Vec3; max: Vec3 }): Vec3 => [
  (min[0] + max[0]) / 2,
  (min[1] + max[1]) / 2,
  (min[2] + max[2]) / 2,
];

/** The gap the apart rule keeps around the body's box. */
function gapAround(body: { min: Vec3; max: Vec3 }): number {
  const side = Math.max(...[0, 1, 2].map((k) => body.max[k]! - body.min[k]!));
  return Math.max(APART_MIN_GAP_MM, APART_SHARE * side);
}

describe('groupsApart', () => {
  it('moves the groups as pulledApart moves the same shapes as files, bit for bit', () => {
    const { body, wing, tip } = generateWingedFigure();
    const meshes = [body, wing, tip].map(meshOf);
    // The three files as one mesh, each file's triangles a group.
    const positions = new Float32Array(meshes.reduce((n, m) => n + m.positions.length, 0));
    const indices = new Uint32Array(meshes.reduce((n, m) => n + m.indices.length, 0));
    const of = new Uint8Array(indices.length / 3);
    let vertex = 0;
    let index = 0;
    meshes.forEach((mesh, file) => {
      positions.set(mesh.positions, vertex * 3);
      for (let k = 0; k < mesh.indices.length; k++) indices[index + k] = mesh.indices[k]! + vertex;
      of.fill(file, index / 3, (index + mesh.indices.length) / 3);
      vertex += mesh.positions.length / 3;
      index += mesh.indices.length;
    });
    const merged: IndexedMesh = { positions, indices };
    const groups: PaintGroups = {
      of,
      made: [{ by: 'body' }, { by: 'part', file: 1 }, { by: 'part', file: 2 }],
    };
    const apart = groupsApart(merged, groups);
    const pulled = pulledApart(meshes, [0, 1, 2]);
    // The wing and the tip overlap the body's box within the gap: both move, the same way.
    expect(apart.map((entry) => entry.group)).toEqual([1, 2]);
    expect(apart.map((entry) => entry.offset)).toEqual(pulled.slice(1).map((p) => p.translation));
    expect(pulled[0]!.translation).toEqual([0, 0, 0]);
  });

  it('pulls every shell of the figure clear of the body and of one another, along the line from the body', () => {
    const mesh = meshOf(generateFigure(true));
    const groups = groupsOf(mesh);
    // The body, its base, the head and the two arms: separate shells, each buried in the body.
    expect(groups.made.length).toBeGreaterThanOrEqual(5);
    const apart = groupsApart(mesh, groups);
    expect(apart.map((entry) => entry.group)).toEqual(
      groups.made.map((_, group) => group).slice(1),
    );
    const body = boxOfGroup(mesh, groups.of, 0)!;
    const gap = gapAround(body);
    const placed = [body];
    for (const { group, offset } of apart) {
      expect(offset.some((value) => value !== 0)).toBe(true);
      const own = boxOfGroup(mesh, groups.of, group)!;
      const moved = boxOfGroup(mesh, groups.of, group, offset)!;
      // Clear of the body's box and of every box placed before it by the gap, within rounding.
      for (const other of placed) expect(clearOf(moved, other, gap - 1e-6)).toBe(true);
      placed.push(moved);
      // Along the line from the body's middle to its own: the cross product vanishes.
      const from = middleOf(body);
      const to = middleOf(own);
      const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const cross = [
        d[1]! * offset[2] - d[2]! * offset[1],
        d[2]! * offset[0] - d[0]! * offset[2],
        d[0]! * offset[1] - d[1]! * offset[0],
      ];
      expect(Math.hypot(...cross)).toBeLessThan(1e-6 * Math.hypot(...d) * Math.hypot(...offset));
      // And away from the body, not towards it.
      expect(d[0]! * offset[0] + d[1]! * offset[1] + d[2]! * offset[2]).toBeGreaterThan(0);
    }
  });

  it('pulls one group apart on its own with `only`, and never the body', () => {
    const mesh = meshOf(generateFigure(true));
    const groups = groupsOf(mesh);
    const all = groupsApart(mesh, groups);
    const last = groups.made.length - 1;
    const alone = groupsApart(mesh, groups, [last]);
    expect(alone.map((entry) => entry.group)).toEqual([last]);
    // Alone, nothing was moved before it: the least move that clears the body, never further
    // than with every group moved before it.
    const withAll = all.find((entry) => entry.group === last)!;
    expect(Math.hypot(...alone[0]!.offset)).toBeLessThanOrEqual(
      Math.hypot(...withAll.offset) + 1e-9,
    );
    const body = boxOfGroup(mesh, groups.of, 0)!;
    const moved = boxOfGroup(mesh, groups.of, last, alone[0]!.offset)!;
    expect(clearOf(moved, body, gapAround(body) - 1e-6)).toBe(true);
    expect(groupsApart(mesh, groups, [0])).toEqual([]);
    // Repeats and groups the mini does not have are ignored.
    expect(groupsApart(mesh, groups, [last, last, 99])).toEqual(alone);
  });

  it('pulls one more group apart clear of those already apart, which stay', () => {
    const mesh = meshOf(generateFigure(true));
    const groups = groupsOf(mesh);
    const all = groupsApart(mesh, groups);
    expect(all.length).toBeGreaterThan(1);
    const [first, ...rest] = all;
    // Every other group apart where the rule put it, then the first pulled on its own.
    const one = groupsApart(mesh, groups, [first!.group], rest);
    expect(one.map((entry) => entry.group)).toEqual([first!.group]);
    const body = boxOfGroup(mesh, groups.of, 0)!;
    const gap = gapAround(body) - 1e-6;
    const moved = boxOfGroup(mesh, groups.of, first!.group, one[0]!.offset)!;
    for (const { group, offset } of rest)
      expect(clearOf(moved, boxOfGroup(mesh, groups.of, group, offset)!, gap)).toBe(true);
    // Without `only` the list is ignored: every group is laid out afresh.
    expect(groupsApart(mesh, groups, undefined, rest)).toEqual(all);
  });

  it('leaves a fused sculpt and an empty group alone, and refuses another mesh’s groups', () => {
    const mesh = meshOf(generateBoulder());
    const groups = groupsOf(mesh);
    expect(groupsApart(mesh, groups)).toEqual([]);
    // A group emptied by later steps stays in `made` (#139): nothing to move.
    expect(groupsApart(mesh, { of: groups.of, made: [...groups.made, { by: 'hand' }] })).toEqual(
      [],
    );
    expect(() => groupsApart(mesh, { of: new Uint8Array(3), made: groups.made })).toThrow(
      RangeError,
    );
  });
});
