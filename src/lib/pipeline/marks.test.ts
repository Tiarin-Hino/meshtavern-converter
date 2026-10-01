import { describe, expect, it } from 'vitest';
import {
  generateHoleBase,
  generatePegFigure,
  generatePlate,
  generateRecessBase,
  generateSlopeBase,
  HOLE_BASE,
  RECESS_BASE,
  SLOPE_BASE,
} from '../../regression/shapes';
import type { Vec3 } from './base';
import { generateBumpySheet } from './generate';
import { TriangleBvh } from './bvh';
import {
  MAX_STROKES,
  meetingRotation,
  nearestTriangle,
  resolveMark,
  resolvePatch,
  TAP_REACH_MM,
  triangleCorners,
  type Meeting,
  type Stroke,
} from './marks';
import { weldVertices, type IndexedMesh } from './mesh';
import { angleDeg, apply, dot, normalise, turnAngleDeg } from './rotation';
import { placePairOnly, runPipeline } from './run';
import { encodeBinaryStl } from './stl';

const welded = (soup: Float32Array): IndexedMesh => weldVertices(soup).mesh;
/** -0 becomes 0, so exact comparisons do not trip on the sign of zero. */
const plain = (v: Vec3): Vec3 => [v[0] + 0, v[1] + 0, v[2] + 0];

/**
 * A flat grid on z = 0 whose vertices are nudged up by 0–0.04 mm in a fixed pattern: a surface
 * that points up with every small triangle pointing somewhere else.
 */
function roughSheet(quads: number, stepMm: number): Float32Array {
  const soup: number[] = [];
  const at = (i: number, j: number): Vec3 => [
    (i - quads / 2) * stepMm,
    (j - quads / 2) * stepMm,
    ((i * 7 + j * 13) % 5) * 0.01,
  ];
  for (let j = 0; j < quads; j++)
    for (let i = 0; i < quads; i++) {
      soup.push(...at(i, j), ...at(i + 1, j), ...at(i + 1, j + 1));
      soup.push(...at(i, j), ...at(i + 1, j + 1), ...at(i, j + 1));
    }
  return new Float32Array(soup);
}

describe('nearestTriangle', () => {
  it('finds a triangle the point lies on, and one of the two sharing an edge', () => {
    const mesh = welded(roughSheet(10, 1));
    // The diagonal of the quad at (0, 0): shared by triangles 0 and 1... in the soup's order.
    const onDiagonal: Vec3 = [-4.5, -4.5, 0.02];
    const { triangle } = nearestTriangle(mesh, onDiagonal);
    const corners = triangleCorners(mesh, triangle).map(([x, y]) => `${x},${y}`);
    expect(corners).toEqual(expect.arrayContaining(['-5,-5', '-4,-4']));
  });

  it('returns -1 for a mesh without triangles', () => {
    const empty = { positions: new Float32Array(0), indices: new Uint32Array(0) };
    expect(nearestTriangle(empty, [0, 0, 0]).triangle).toBe(-1);
    expect(resolveMark(empty, [0, 0, 0])).toBeNull();
  });
});

describe('resolveMark', () => {
  it("gives a recess floor's normal exactly and keeps the point as given", () => {
    const floor = RECESS_BASE.heightMm - RECESS_BASE.recessDepthMm;
    const point: Vec3 = [0.3, -0.2, floor];
    const mark = resolveMark(welded(generateRecessBase()), point)!;
    expect(plain(mark.normal)).toEqual([0, 0, 1]);
    expect(mark.point).toEqual(point);
  });

  it('takes the surface around the point, not the one triangle under it', () => {
    const mesh = welded(roughSheet(40, 0.1));
    const point: Vec3 = [0.03, 0.02, 0.02];
    const own = triangleCorners(mesh, nearestTriangle(mesh, point).triangle);
    const [a, b, c] = own;
    const ownNormal = normalise([
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ]);
    expect(angleDeg(ownNormal, [0, 0, 1])).toBeGreaterThan(10);
    expect(angleDeg(resolveMark(mesh, point)!.normal, [0, 0, 1])).toBeLessThan(5);
  });

  it("follows a bumpy sheet's surface around where it was marked", () => {
    const mesh = welded(generateBumpySheet(150));
    const step = 50 / 150;
    // The sheet's height is 2 sin(0.9 x) cos(0.7 y) + 3 at the grid's corners; its normal there
    // is (-dz/dx, -dz/dy, 1).
    const normalAt = (x: number, y: number): Vec3 =>
      normalise([
        -1.8 * Math.cos(x * 0.9) * Math.cos(y * 0.7),
        1.4 * Math.sin(x * 0.9) * Math.sin(y * 0.7),
        1,
      ]);
    for (const [x, y] of [
      [20, 20],
      [7, 31],
      [33, 12],
    ] as const) {
      const ix = Math.round(x / step);
      const iy = Math.round(y / step);
      const [px, py] = [ix * step, iy * step];
      const z = 2 * Math.sin(px * 0.9) * Math.cos(py * 0.7) + 3;
      // The sheet's mean normal over the disc of MARK_NORMAL_RADIUS_MM around the point.
      const mean: Vec3 = [0, 0, 0];
      for (let dx = -1; dx <= 1; dx += 0.1)
        for (let dy = -1; dy <= 1; dy += 0.1) {
          if (dx * dx + dy * dy > 1) continue;
          const n = normalAt(px + dx, py + dy);
          for (let k = 0; k < 3; k++) mean[k] = mean[k]! + n[k]!;
        }
      const mark = resolveMark(mesh, [px, py, z])!;
      expect(angleDeg(mark.normal, mean)).toBeLessThan(5);
    }
  });

  it('keeps the other wall of a thin recess out of the normal', () => {
    // On the recess floor right next to its wall: the wall faces sideways, 90° off the floor.
    const floor = RECESS_BASE.heightMm - RECESS_BASE.recessDepthMm;
    const edge = RECESS_BASE.recessMm / 2 - 0.2;
    const mark = resolveMark(welded(generateRecessBase()), [edge, 0, floor])!;
    expect(plain(mark.normal)).toEqual([0, 0, 1]);
  });
});

describe('meetingRotation', () => {
  it('is the identity for opposite normals and no turn', () => {
    expect(meetingRotation([0, -1, 0], [0, 1, 0]).map((v) => v + 0)).toEqual([0, 0, 0, 1]);
  });

  it('turns the contact normal against the spot normal, then about it', () => {
    const nSpot = normalise([0, 0.8, 0.6]);
    const q = meetingRotation([0, -1, 0], nSpot, 90);
    const turned = apply(q, [0, -1, 0]);
    expect(dot(turned, nSpot)).toBeCloseTo(-1, 12);
  });

  it('gives a half turn for equal normals, without an error', () => {
    const q = meetingRotation([0, 1, 0], [0, 1, 0]);
    expect(turnAngleDeg(q)).toBeCloseTo(180, 9);
    expect(apply(q, [0, 1, 0])[1]).toBeCloseTo(-1, 12);
  });
});

/** The peg figure's file: a 3 mm peg 3.5 mm long under the figure, its end centred on the origin. */
const PEG_LENGTH_MM = 3.5;
const pegStl = (): ArrayBuffer => encodeBinaryStl(generatePegFigure(PEG_LENGTH_MM));
/** The peg's end and the top of its axis, in the figure's file. */
const PEG_END: Vec3 = [0, 0, 0];
const PEG_TOP: Vec3 = [0, 0, PEG_LENGTH_MM];

/** Where a file point of the figure ended in a marked pair: the merged mesh lists the figure first. */
function landed(soup: Float32Array, mesh: IndexedMesh, point: Vec3): Vec3 {
  const own = welded(soup);
  for (let v = 0; v < own.positions.length / 3; v++) {
    if (
      own.positions[v * 3] === point[0] &&
      own.positions[v * 3 + 1] === point[1] &&
      own.positions[v * 3 + 2] === point[2]
    )
      return [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!];
  }
  throw new Error(`no vertex at ${point.join(', ')}`);
}

const holeMeeting = (more: Partial<Meeting> = {}): Meeting => ({
  spot: { file: 1, point: [0, 0, HOLE_BASE.floorMm] },
  contact: { file: 0, point: PEG_END },
  ...more,
});

describe('the marked placement (#93)', () => {
  it("sets the peg's end on the hole's floor, its axis on the hole's axis", () => {
    const soup = generatePegFigure(PEG_LENGTH_MM);
    const placed = placePairOnly(pegStl(), encodeBinaryStl(generateHoleBase()), {
      placement: { marks: holeMeeting() },
    });
    const placement = placed.pair.placement!;
    expect(placement.method).toBe('marked');
    expect(placement.spot.kind).toBe('marked');
    expect(placement.candidates).toEqual([]);
    const spot = placement.marks!.spot;
    expect(plain(spot.normal)).toEqual([0, 1, 0]);
    expect(spot.point[1]).toBeCloseTo(HOLE_BASE.floorMm, 6);
    const end = landed(soup, placed.mesh, PEG_END);
    const top = landed(soup, placed.mesh, PEG_TOP);
    for (const p of [end, top]) {
      expect(Math.abs(p[0] - spot.point[0])).toBeLessThan(0.01);
      expect(Math.abs(p[2] - spot.point[2])).toBeLessThan(0.01);
    }
    expect(Math.abs(end[1] - HOLE_BASE.floorMm)).toBeLessThan(0.01);
    // A flat end met a flat floor: the figure stands as it did, and says so.
    expect(placement.marks!.rotation.map((v) => v + 0)).toEqual([0, 0, 0, 1]);
    expect(placed.orientation.method).not.toBe('marked');
    expect(placed.orientation.tiltDeg).toBe(0);
  }, 60_000);

  it('stands a figure tilted on a sloped rock, raised along and turned about its normal', () => {
    const soup = generatePegFigure(PEG_LENGTH_MM);
    const base = encodeBinaryStl(generateSlopeBase());
    const meeting: Meeting = {
      spot: { file: 1, point: SLOPE_BASE.topCentre },
      contact: { file: 0, point: PEG_END },
    };
    const flat = placePairOnly(pegStl(), base, { placement: { marks: meeting } });
    const marks = flat.pair.placement!.marks!;
    expect(Math.abs(turnAngleDeg(marks.rotation) - 36.8699)).toBeLessThan(0.01);
    expect(flat.orientation.method).toBe('marked');
    expect(flat.orientation.tiltDeg).toBeCloseTo(36.87, 2);
    const n = marks.spot.normal;
    expect(angleDeg(n, [0, 0.8, 0.6])).toBeLessThan(0.01);
    // The peg's axis now runs along the slope's normal.
    const axis = (placed: typeof flat): Vec3 => {
      const end = landed(soup, placed.mesh, PEG_END);
      const top = landed(soup, placed.mesh, PEG_TOP);
      return [top[0] - end[0], top[1] - end[1], top[2] - end[2]];
    };
    expect(angleDeg(axis(flat), n)).toBeLessThan(0.01);

    const raised = placePairOnly(pegStl(), base, {
      placement: { marks: { ...meeting, liftMm: 1 } },
    });
    const from = landed(soup, flat.mesh, PEG_END);
    const to = landed(soup, raised.mesh, PEG_END);
    const moved: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    for (let k = 0; k < 3; k++) expect(Math.abs(moved[k]! - n[k]!)).toBeLessThan(1e-4);
    expect(raised.pair.placement!.marks!.liftMm).toBe(1);

    const turned = placePairOnly(pegStl(), base, {
      placement: { marks: { ...meeting, turnDeg: 90 } },
    });
    const end = landed(soup, turned.mesh, PEG_END);
    for (let k = 0; k < 3; k++) expect(Math.abs(end[k]! - from[k]!)).toBeLessThan(1e-4);
    expect(angleDeg(axis(turned), n)).toBeLessThan(0.01);
    expect(turned.pair.placement!.yawDeg).toBe(90);
  }, 60_000);

  it('turns the figure over for two marks with the same normal, without an error', () => {
    // The top of the peg, facing up inside the body, marked against the hole's floor, facing up.
    const placed = placePairOnly(pegStl(), encodeBinaryStl(generateHoleBase()), {
      placement: { marks: holeMeeting({ contact: { file: 0, point: PEG_TOP } }) },
    });
    expect(turnAngleDeg(placed.pair.placement!.marks!.rotation)).toBeGreaterThan(90);
    expect(placed.orientation.method).toBe('marked');
  }, 60_000);

  it('refuses marks on the wrong files', () => {
    expect(() =>
      placePairOnly(pegStl(), encodeBinaryStl(generateHoleBase()), {
        placement: {
          marks: { spot: { file: 0, point: [0, 0, 0] }, contact: { file: 1, point: [0, 0, 1] } },
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'unexpected',
        detail: expect.stringMatching(/marks on files/),
      }),
    );
  }, 60_000);

  it('converts again to the same bits with the choices it ended with', async () => {
    const options = { bake: 0, secondStl: encodeBinaryStl(generateHoleBase()) } as const;
    const first = await runPipeline(pegStl(), { ...options, placement: { marks: holeMeeting() } });
    expect(first.choices.placement?.marks).toEqual(holeMeeting());
    const again = await runPipeline(pegStl(), {
      ...options,
      orientation: first.choices.orientation,
      baseOrientation: first.choices.baseOrientation,
      pairing: first.choices.pairing,
      placement: first.choices.placement,
    });
    expect(again.mesh.positions).toEqual(first.mesh.positions);
    expect(again.pair).toEqual(first.pair);
  }, 120_000);
});

describe('patches (the rework, §5.1–5.2)', () => {
  const treeOf = (mesh: IndexedMesh): TriangleBvh => new TriangleBvh(mesh);
  const centroid = (mesh: IndexedMesh, t: number): Vec3 =>
    [0, 1, 2].map(
      (axis) =>
        (mesh.positions[mesh.indices[t * 3]! * 3 + axis]! +
          mesh.positions[mesh.indices[t * 3 + 1]! * 3 + axis]! +
          mesh.positions[mesh.indices[t * 3 + 2]! * 3 + axis]!) /
        3,
    ) as Vec3;
  const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  it('takes the recess floor around a tap and nothing of its walls or the top', () => {
    const mesh = welded(generateRecessBase());
    const floor = RECESS_BASE.heightMm - RECESS_BASE.recessDepthMm;
    const tap: Vec3 = [0.2, -0.1, floor];
    const patch = resolvePatch(mesh, treeOf(mesh), { file: 0, strokes: [{ tap }] });
    // Every floor triangle whose centroid lies within reach, and no other.
    const expected: number[] = [];
    for (let t = 0; t < mesh.indices.length / 3; t++) {
      const g = centroid(mesh, t);
      if (g[2] === floor && distance(g, tap) <= TAP_REACH_MM) expected.push(t);
    }
    expect([...patch.triangles]).toEqual(expected);
    expect(plain(patch.normal)).toEqual([0, 0, 1]);
    expect(patch.flatness).toBe(1);
    expect(patch.areaMm2).toBeGreaterThan(Math.PI * TAP_REACH_MM ** 2 * 0.8);
  });

  it('takes a disc of the reach on a plate larger than it, centred on the tap', () => {
    const mesh = welded(generatePlate(20, 2, 0.25, () => false));
    const tap: Vec3 = [1.3, -0.7, 2];
    const patch = resolvePatch(mesh, treeOf(mesh), { file: 3, strokes: [{ tap }] });
    expect(patch.file).toBe(3);
    expect(Math.hypot(patch.centre[0] - tap[0], patch.centre[1] - tap[1])).toBeLessThan(0.1);
    expect(patch.centre[2]).toBe(2);
    for (const t of patch.triangles)
      expect(distance(centroid(mesh, t), tap)).toBeLessThanOrEqual(TAP_REACH_MM);
    expect(patch.areaMm2).toBeCloseTo(Math.PI * TAP_REACH_MM ** 2, -0.5);
  });

  it('takes a curved surface around the tap, nearly flat and centred near it', () => {
    const mesh = welded(generateBumpySheet(200));
    // A crest of the sheet: sin(0.9 x) = 1 at x = π / 1.8, cos(0.7 y) = 1 at y = 0... on a vertex column.
    const tap: Vec3 = [1.75, 10 * (50 / 200), 0];
    tap[2] = 2 * Math.sin(tap[0] * 0.9) * Math.cos(tap[1] * 0.7) + 3;
    const patch = resolvePatch(mesh, treeOf(mesh), { file: 0, strokes: [{ tap }] });
    expect(patch.triangles.length).toBeGreaterThan(20);
    expect(patch.flatness).toBeGreaterThan(0.9);
    expect(distance(patch.centre, tap)).toBeLessThan(0.5);
  });

  it('adds a second tap, and resolves the same strokes to the same triangles every time', () => {
    const mesh = welded(generatePlate(20, 2, 0.25, () => false));
    const one = resolvePatch(mesh, treeOf(mesh), { file: 0, strokes: [{ tap: [-5, 0, 2] }] });
    const two = resolvePatch(mesh, treeOf(mesh), {
      file: 0,
      strokes: [{ tap: [-5, 0, 2] }, { tap: [5, 0, 2] }],
    });
    const again = resolvePatch(mesh, treeOf(mesh), {
      file: 0,
      strokes: [{ tap: [-5, 0, 2] }, { tap: [5, 0, 2] }],
    });
    expect(two.areaMm2).toBeCloseTo(2 * one.areaMm2, 6);
    expect([...two.triangles]).toEqual(expect.arrayContaining([...one.triangles]));
    expect([...again.triangles]).toEqual([...two.triangles]);
    expect(again.centre).toEqual(two.centre);
  });

  it('brushes the triangles in its radius and not the far side of a 1 mm wall; erases them again', () => {
    const mesh = welded(generatePlate(20, 1, 0.25, () => false));
    const tree = treeOf(mesh);
    const brushed = resolvePatch(mesh, tree, {
      file: 0,
      strokes: [{ brush: [0, 0, 1], radiusMm: 2 }],
    });
    expect(brushed.triangles.length).toBeGreaterThan(0);
    for (const t of brushed.triangles) {
      const g = centroid(mesh, t);
      expect(g[2]).toBe(1);
      expect(distance(g, [0, 0, 1])).toBeLessThanOrEqual(2);
    }
    expect(plain(brushed.normal)).toEqual([0, 0, 1]);
    const erased = resolvePatch(mesh, tree, {
      file: 0,
      strokes: [
        { brush: [0, 0, 1], radiusMm: 2 },
        { erase: [1, 0, 1], radiusMm: 1 },
      ],
    });
    expect(erased.areaMm2).toBeLessThan(brushed.areaMm2);
    for (const t of erased.triangles)
      expect(distance(centroid(mesh, t), [1, 0, 1])).toBeGreaterThan(1);
  });

  it(`ignores strokes after the first ${MAX_STROKES}`, () => {
    const mesh = welded(generatePlate(20, 2, 0.5, () => false));
    const strokes: Stroke[] = Array.from({ length: MAX_STROKES }, () => ({
      tap: [-5, 0, 2] as Vec3,
    }));
    const kept = resolvePatch(mesh, treeOf(mesh), { file: 0, strokes });
    const more = resolvePatch(mesh, treeOf(mesh), {
      file: 0,
      strokes: [...strokes, { tap: [5, 0, 2] }],
    });
    expect([...more.triangles]).toEqual([...kept.triangles]);
  });

  it('resolves no strokes, or a mesh without triangles, to an empty patch', () => {
    const empty = { positions: new Float32Array(0), indices: new Uint32Array(0) };
    const patch = resolvePatch(empty, treeOf(empty), { file: 0, strokes: [{ tap: [0, 0, 0] }] });
    expect(patch.triangles.length).toBe(0);
    expect(patch.areaMm2).toBe(0);
  });
});
