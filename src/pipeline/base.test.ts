import { describe, expect, it } from 'vitest';
import { generateFigure, generateSwarm } from '../regression/shapes';
import {
  convexHullArea,
  generatePlainBase,
  measureBase,
  PLAIN_BASE_HEIGHT_MM,
  standOnBase,
} from './base';
import { weldVertices, type IndexedMesh } from './mesh';
import { detectUpAxis, orientAndPlace } from './orient';

/** A Z-up soup as the pipeline places it: welded, oriented, standing on y = 0. */
function placed(soup: Float32Array): IndexedMesh {
  const mesh = weldVertices(soup).mesh;
  return orientAndPlace(mesh, detectUpAxis(mesh).up).mesh;
}

/** Outward-facing Z-up box as a triangle soup. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const soup: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    soup.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]); // underside, faces -z
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // top, faces +z
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // faces -y
  quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]); // faces +y
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // faces -x
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); // faces +x
  return soup;
}

describe('convexHullArea', () => {
  it('measures a square with points inside it', () => {
    const xz = new Float64Array([0, 0, 10, 0, 10, 10, 0, 10, 5, 5, 2, 7, 10, 5]);
    expect(convexHullArea(xz)).toBeCloseTo(100, 9);
  });

  it('is zero for fewer than three points or points on a line', () => {
    expect(convexHullArea(new Float64Array([0, 0, 1, 1]))).toBe(0);
    expect(convexHullArea(new Float64Array([0, 0, 1, 1, 2, 2]))).toBe(0);
  });
});

describe('measureBase', () => {
  it('measures the 25 mm round base of the generated figure', () => {
    const base = measureBase(placed(generateFigure(true)));
    expect(base).toMatchObject({ shape: 'round' });
    expect(base!.diameterMm).toBeCloseTo(25, 0);
    expect(Math.abs(base!.diameterMm - 25)).toBeLessThan(0.5);
    expect(base!.coverage).toBeGreaterThan(0.5);
  });

  it('measures the 50 mm round base of the generated swarm', () => {
    const base = measureBase(placed(generateSwarm()));
    expect(base).toMatchObject({ shape: 'round' });
    expect(Math.abs(base!.diameterMm - 50)).toBeLessThan(0.5);
  });

  it('calls a square plinth "other" and gives its longer side', () => {
    const plinth = [...box(0, 0, 0, 30, 30, 4), ...box(12, 12, 4, 18, 18, 40)];
    const base = measureBase(placed(new Float32Array(plinth)));
    expect(base).toMatchObject({ shape: 'other', diameterMm: 30, footprintMm: [30, 30] });
  });

  it('calls an oval base "other"', () => {
    const oval = [...box(0, 0, 0, 60, 35, 4), ...box(25, 12, 4, 35, 22, 40)];
    expect(measureBase(placed(new Float32Array(oval)))).toMatchObject({
      shape: 'other',
      diameterMm: 60,
    });
  });

  it('finds no base under a figure on bare feet', () => {
    expect(measureBase(placed(generateFigure(false)))).toBeNull();
  });

  it('finds nothing in an empty mesh', () => {
    expect(measureBase({ positions: new Float32Array(0), indices: new Uint32Array(0) })).toBeNull();
  });
});

describe('orientAndPlace with a base', () => {
  it('puts the origin at the centre of the base, not of the bounding box', () => {
    // A 30 mm plinth with an arm reaching 20 mm beyond it on one side.
    const soup = [
      ...box(0, 0, 0, 30, 30, 4),
      ...box(12, 12, 4, 18, 18, 40),
      ...box(18, 14, 30, 50, 16, 32),
    ];
    const mesh = weldVertices(new Float32Array(soup)).mesh;
    const result = orientAndPlace(mesh, '+z');
    expect(result.base).toMatchObject({ centre: [0, 0], diameterMm: 30 });
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < result.mesh.positions.length; i += 3) {
      minX = Math.min(minX, result.mesh.positions[i]!);
      maxX = Math.max(maxX, result.mesh.positions[i]!);
    }
    expect([minX, maxX]).toEqual([-15, 35]);
  });

  it('keeps the bounding-box centre for a mini without a base', () => {
    const result = orientAndPlace(weldVertices(generateFigure(false)).mesh, '+z');
    expect(result.base).toBeNull();
  });
});

describe('generatePlainBase', () => {
  it.each([25, 32, 50, 100])('makes a closed %d mm disc standing on y = 0', (diameter) => {
    const base = generatePlainBase(diameter);
    const measured = measureBase(base);
    expect(measured).toMatchObject({ shape: 'round', centre: [0, 0] });
    expect(Math.abs(measured!.diameterMm - diameter)).toBeLessThan(0.1);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < base.positions.length; i += 3) {
      minY = Math.min(minY, base.positions[i]!);
      maxY = Math.max(maxY, base.positions[i]!);
    }
    expect([minY, maxY]).toEqual([0, PLAIN_BASE_HEIGHT_MM]);
    // Faces outwards: a positive volume of about π r² h.
    const volume = signedVolume(base);
    expect(volume / (Math.PI * (diameter / 2) ** 2 * PLAIN_BASE_HEIGHT_MM)).toBeCloseTo(1, 1);
  });

  it('keeps the rim segments near 1 mm', () => {
    const base = generatePlainBase(100);
    // 4 × cells² + 8 × cells triangles with cells = ⌈π × 100 / 4⌉ = 79.
    expect(base.indices.length / 3).toBe(4 * 79 * 79 + 8 * 79);
  });
});

describe('standOnBase', () => {
  it('lifts the mini by the height and appends the base', () => {
    const mini = {
      positions: new Float32Array([0, 0, 0, 1, 5, 0, 0, 5, 1]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const base = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      indices: new Uint32Array([0, 2, 1]),
    };
    const stood = standOnBase(mini, base, 3);
    expect(Array.from(stood.positions.slice(0, 9))).toEqual([0, 3, 0, 1, 8, 0, 0, 8, 1]);
    expect(Array.from(stood.indices)).toEqual([0, 1, 2, 3, 5, 4]);
  });
});

/** Positive for outward-facing triangles. */
function signedVolume({ positions: p, indices }: IndexedMesh): number {
  let volume = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3;
    const b = indices[t + 1]! * 3;
    const c = indices[t + 2]! * 3;
    volume +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
      p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return volume / 6;
}
