import { beforeAll, describe, expect, it } from 'vitest';
import { surfaceAreaMm2 } from './bake-policy';
import { generateBumpySheet } from './generate';
import { weldVertices, type IndexedMesh } from './mesh';
import { connectedPieces, cutIntoSlabs, groupPieces, splitByGroup } from './parts';
import { seamLengthMm } from './seams';
import { unwrap, MAX_CHART_COST } from './unwrap';
import { findIslands, packParts, sharedTexelsPerUnit } from './unwrap-parts';

/** Two sheets side by side that share no vertex: 8 and 18 triangles. */
function twoSheets(): IndexedMesh {
  const small = generateBumpySheet(2, 10);
  const large = generateBumpySheet(3, 10).map((value, i) => (i % 3 === 0 ? value + 100 : value));
  const soup = new Float32Array(small.length + large.length);
  soup.set(small);
  soup.set(large, small.length);
  return weldVertices(soup).mesh;
}

describe('connectedPieces', () => {
  it('finds the pieces, largest first', () => {
    const { pieceOfTriangle, sizes } = connectedPieces(twoSheets());
    expect(sizes).toEqual([18, 8]);
    expect([...pieceOfTriangle.slice(0, 8)]).toEqual(new Array(8).fill(1));
    expect([...pieceOfTriangle.slice(8)]).toEqual(new Array(18).fill(0));
  });

  it('calls a welded sheet one piece', () => {
    expect(connectedPieces(weldVertices(generateBumpySheet(6)).mesh).sizes).toEqual([72]);
  });
});

describe('groupPieces', () => {
  it('fills the smallest group first and never cuts a piece', () => {
    const pieceOfTriangle = Uint32Array.from([0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 3]);
    const { groupOfTriangle, groupSizes } = groupPieces(pieceOfTriangle, [5, 3, 2, 1], 2);
    expect(groupSizes).toEqual([6, 5]);
    expect([...groupOfTriangle]).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0]);
  });

  it('uses no more groups than there are pieces', () => {
    expect(groupPieces(Uint32Array.from([0, 0, 1]), [2, 1], 8).groupSizes).toEqual([2, 1]);
  });
});

describe('splitByGroup', () => {
  it('gives every group its own mesh and the way back to the source', () => {
    const source = twoSheets();
    const { pieceOfTriangle, sizes } = connectedPieces(source);
    const parts = splitByGroup(source, pieceOfTriangle, sizes.length);
    expect(parts.map((part) => part.mesh.indices.length / 3)).toEqual([18, 8]);
    for (const part of parts) {
      part.sourceTriangle.forEach((from, t) => {
        for (let corner = 0; corner < 3; corner++) {
          const local = part.mesh.indices[t * 3 + corner]!;
          expect(part.sourceVertex[local]).toBe(source.indices[from * 3 + corner]);
          expect(part.mesh.positions[local * 3]).toBe(
            source.positions[part.sourceVertex[local]! * 3],
          );
        }
      });
    }
  });
});

describe('cutIntoSlabs', () => {
  it('cuts one piece into slabs of equal size along its longest side', () => {
    const sheet = weldVertices(generateBumpySheet(8, 40)).mesh;
    // Stretch x, so that the cut has to run across x.
    for (let i = 0; i < sheet.positions.length; i += 3) sheet.positions[i] = sheet.positions[i]! * 3;
    const { groupOfTriangle, groupSizes } = cutIntoSlabs(sheet, 4);
    expect(groupSizes).toEqual([32, 32, 32, 32]);
    const highestX = [0, 0, 0, 0];
    const lowestX = [Infinity, Infinity, Infinity, Infinity];
    groupOfTriangle.forEach((group, t) => {
      for (let corner = 0; corner < 3; corner++) {
        const x = sheet.positions[sheet.indices[t * 3 + corner]! * 3]!;
        highestX[group] = Math.max(highestX[group]!, x);
        lowestX[group] = Math.min(lowestX[group]!, x);
      }
    });
    for (let group = 1; group < 4; group++) {
      expect(lowestX[group]).toBeGreaterThanOrEqual(highestX[group - 1]! - 15.01);
      expect(highestX[group]).toBeGreaterThan(highestX[group - 1]!);
    }
  });
});

describe('seamLengthMm', () => {
  it('measures the border of a flat square once per side of the seam', () => {
    // One 10 mm square: its border is 40 mm, and a lone border has one side only.
    const positions = Float32Array.from([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]);
    const square = { positions, indices: Uint32Array.from([0, 1, 2, 0, 2, 3]) };
    expect(seamLengthMm(square)).toBeCloseTo(20);
  });
});

describe('the unwrap in parts', () => {
  const RESOLUTION = 512;
  let source: IndexedMesh;
  beforeAll(() => {
    source = weldVertices(generateBumpySheet(40)).mesh;
  });

  it('gives the islands of one part the same as the normal unwrap', async () => {
    const whole = await unwrap(source, RESOLUTION);
    const { groupOfTriangle } = cutIntoSlabs(source, 1);
    const parts = splitByGroup(source, groupOfTriangle, 1);
    const scale = sharedTexelsPerUnit(surfaceAreaMm2(source), RESOLUTION);
    const islands = [await findIslands(parts[0]!.mesh, { maxCost: MAX_CHART_COST }, scale)];
    const packed = await packParts(source, parts, islands, RESOLUTION);
    expect(packed.charts).toBe(whole.charts);
    expect(seamLengthMm(packed.mesh)).toBeCloseTo(seamLengthMm(whole.mesh), 3);
  });

  it('packs the islands of several parts into one texture without losing a triangle', async () => {
    const { groupOfTriangle, groupSizes } = cutIntoSlabs(source, 3);
    const parts = splitByGroup(source, groupOfTriangle, groupSizes.length);
    const scale = sharedTexelsPerUnit(surfaceAreaMm2(source), RESOLUTION);
    const islands = await Promise.all(
      parts.map((part) => findIslands(part.mesh, { maxCost: MAX_CHART_COST }, scale)),
    );
    const { mesh, charts, utilisation } = await packParts(source, parts, islands, RESOLUTION);

    expect(mesh.indices.length).toBe(source.indices.length);
    expect(surfaceAreaMm2(mesh)).toBeCloseTo(surfaceAreaMm2(source), 1);
    expect(charts).toBe(islands.reduce((sum, part) => sum + part.charts, 0));
    expect(utilisation).toBeGreaterThan(0.4);
    for (const uv of mesh.uvs!) {
      expect(uv).toBeGreaterThanOrEqual(0);
      expect(uv).toBeLessThanOrEqual(1);
    }
    // Islands of all parts share one scale: texture area per mm² is the same in every part.
    const density = (from: number, to: number): number => {
      let uvArea = 0;
      let area = 0;
      for (let t = from; t < to; t++) {
        const [a, b, c] = [0, 1, 2].map((corner) => mesh.indices[t * 3 + corner]!);
        const u = mesh.uvs!;
        uvArea += Math.abs(
          (u[b! * 2]! - u[a! * 2]!) * (u[c! * 2 + 1]! - u[a! * 2 + 1]!) -
            (u[c! * 2]! - u[a! * 2]!) * (u[b! * 2 + 1]! - u[a! * 2 + 1]!),
        );
        const p = mesh.positions;
        const e1 = [0, 1, 2].map((k) => p[b! * 3 + k]! - p[a! * 3 + k]!);
        const e2 = [0, 1, 2].map((k) => p[c! * 3 + k]! - p[a! * 3 + k]!);
        area += Math.hypot(
          e1[1]! * e2[2]! - e1[2]! * e2[1]!,
          e1[2]! * e2[0]! - e1[0]! * e2[2]!,
          e1[0]! * e2[1]! - e1[1]! * e2[0]!,
        );
      }
      return uvArea / area;
    };
    const first = density(0, groupSizes[0]!);
    const last = density(mesh.indices.length / 3 - groupSizes[2]!, mesh.indices.length / 3);
    expect(last / first).toBeGreaterThan(0.9);
    expect(last / first).toBeLessThan(1.1);
  });
});
