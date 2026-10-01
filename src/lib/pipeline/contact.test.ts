import { describe, expect, it } from 'vitest';
import {
  addBox,
  generatePlate,
  generatePuddleFigure,
  generateRecessBase,
  generateWingedFigure,
  movedSoup,
} from '../../regression/shapes';
import { TriangleBvh } from './bvh';
import { contactPatches } from './contact';
import { MAX_PAIRS } from './marks';
import { weldVertices, type IndexedMesh } from './mesh';
import { placePairOnly } from './run';
import { encodeBinaryStl } from './stl';

const welded = (soup: Float32Array): IndexedMesh => weldVertices(soup).mesh;
const inPlaceOf = (file: number, mesh: IndexedMesh) => ({
  file,
  mesh,
  tree: new TriangleBvh(mesh),
});
const otherOf = (file: number, mesh: IndexedMesh) => ({ file, mesh, positions: mesh.positions });

describe('contactPatches', { timeout: 60_000 }, () => {
  it('finds the puddle seated in the recess base as one pair, the whole underside', () => {
    const placed = placePairOnly(
      encodeBinaryStl(generatePuddleFigure(12)),
      encodeBinaryStl(generateRecessBase()),
    );
    const { mesh, pair } = placed;
    const fv = pair.figureVertices;
    const ft = pair.figureTriangles;
    const figure: IndexedMesh = {
      positions: mesh.positions.slice(0, fv * 3),
      indices: mesh.indices.slice(0, ft * 3),
    };
    const base: IndexedMesh = {
      positions: mesh.positions.slice(fv * 3),
      indices: mesh.indices.slice(ft * 3).map((i) => i - fv),
    };
    const pairs = contactPatches(inPlaceOf(1, base), otherOf(0, figure));
    expect(pairs).toHaveLength(1);
    // A 16-sided disc 12 mm across.
    const underside = 8 * 36 * Math.sin(Math.PI / 8);
    expect(Math.abs(pairs[0]!.of.areaMm2 - underside) / underside).toBeLessThan(0.1);
    expect(pairs[0]!.of.file).toBe(0);
    expect(pairs[0]!.on.file).toBe(1);
    expect(pairs[0]!.on.normal[1]).toBeCloseTo(1, 6);
    expect(pairs[0]!.of.normal[1]).toBeCloseTo(-1, 6);
  });

  it('finds where a wing exported in place meets the body: one pair at the cut', () => {
    const { body, wing } = generateWingedFigure();
    const pairs = contactPatches(inPlaceOf(0, welded(body)), otherOf(1, welded(wing)));
    expect(pairs).toHaveLength(1);
    const [{ on, of }] = pairs as [(typeof pairs)[number]];
    // The wing's root, 3 × 3 mm at x = 8.5, against the shoulder plate's face, 4 × 4 mm (at 1 mm:
    // the plate's corners are 0.71 mm from the root).
    expect(of.areaMm2).toBeCloseTo(9, 6);
    expect(of.centre[0]).toBeCloseTo(8.5, 6);
    expect(of.normal).toEqual([-1, 0, 0]);
    // The plate's face, and a sliver of the body's surface within the gap of the wing's root.
    expect(on.areaMm2).toBeGreaterThanOrEqual(16);
    expect(on.areaMm2).toBeLessThan(16.5);
    expect(on.normal[0]).toBeGreaterThan(0.99);
  });

  it('finds nothing for a wing 50 mm away', () => {
    const { body, wing } = generateWingedFigure();
    const apart = welded(movedSoup(wing, [50, 0, 0]));
    expect(contactPatches(inPlaceOf(0, welded(body)), otherOf(1, apart))).toEqual([]);
  });

  it('finds a block hovering 0.8 mm above a plate at the 1 mm gap', () => {
    const plate = welded(generatePlate(20, 2, 0.5, () => false));
    const soup: number[] = [];
    addBox(soup, [-2, -2, 2.8], [2, 2, 6]);
    const block = welded(new Float32Array(soup));
    const pairs = contactPatches(inPlaceOf(0, plate), otherOf(1, block));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.of.areaMm2).toBeCloseTo(16, 6);
    // The plate's top under the block, grown by what lies within the gap of its edge.
    expect(pairs[0]!.on.areaMm2).toBeGreaterThanOrEqual(16);
    expect(pairs[0]!.on.centre[2]).toBe(2);
  });

  it(`keeps the ${MAX_PAIRS} largest of six pieces, largest first`, () => {
    const plate = welded(generatePlate(60, 2, 1, () => false));
    const soup: number[] = [];
    const sides = [1.5, 3, 2, 4, 2.5, 3.5];
    sides.forEach((side, k) => {
      const x = -25 + k * 10;
      addBox(soup, [x, -side / 2, 2.2], [x + side, side / 2, 4]);
    });
    const blocks = welded(new Float32Array(soup));
    const pairs = contactPatches(inPlaceOf(0, plate), otherOf(1, blocks));
    expect(pairs.map((pair) => pair.of.areaMm2)).toEqual(
      [4, 3.5, 3, 2.5].map((side) => expect.closeTo(side * side, 6)),
    );
  });
});
