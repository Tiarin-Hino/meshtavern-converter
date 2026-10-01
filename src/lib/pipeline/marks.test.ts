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
import { TriangleBvh } from './bvh';
import { generateBumpySheet } from './generate';
import {
  applyMeetAction,
  marksOf,
  MAX_PAIRS,
  MAX_STROKES,
  pairsAllowed,
  resolvePatch,
  strokesCovering,
  startMeeting,
  TAP_REACH_MM,
  type MarkingAction,
  type Meeting,
  type MeetContext,
  type MeetState,
  type PartJoint,
  type PatchPair,
  type Stroke,
} from './marks';
import { weldVertices, type IndexedMesh } from './mesh';
import { angleDeg, IDENTITY } from './rotation';
import { placePairOnly, runPipeline } from './run';
import { encodeBinaryStl } from './stl';

const welded = (soup: Float32Array): IndexedMesh => weldVertices(soup).mesh;
/** -0 becomes 0, so exact comparisons do not trip on the sign of zero. */
const plain = (v: Vec3): Vec3 => [v[0] + 0, v[1] + 0, v[2] + 0];

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

/** One tap on each side. */
const tapPair = (onFile: number, on: Vec3, ofFile: number, of: Vec3): PatchPair => ({
  on: { file: onFile, strokes: [{ tap: on }] },
  of: { file: ofFile, strokes: [{ tap: of }] },
});

/** The peg's end tapped, and the hole's floor. */
const holeMeeting = (more: Partial<Meeting> = {}): Meeting => ({
  pairs: [tapPair(1, [0, 0, HOLE_BASE.floorMm], 0, PEG_END)],
  ...more,
});

describe('the marked placement (#93, patches §5.5)', () => {
  it("sets the peg's end on the hole's floor, its axis on the hole's axis, only moved", () => {
    const soup = generatePegFigure(PEG_LENGTH_MM);
    const placed = placePairOnly(pegStl(), encodeBinaryStl(generateHoleBase()), {
      placement: { marks: holeMeeting() },
    });
    const placement = placed.pair.placement!;
    expect(placement.method).toBe('marked');
    expect(placement.spot.kind).toBe('marked');
    expect(placement.candidates).toEqual([]);
    const marks = placement.marks!;
    expect(marks.fit.kept).toBe('standing');
    expect(marks.rotation).toBe(IDENTITY);
    const [pair] = marks.pairs;
    expect(plain(pair!.on.normal)).toEqual([0, 1, 0]);
    expect(pair!.on.centre[1]).toBeCloseTo(HOLE_BASE.floorMm, 6);
    const end = landed(soup, placed.mesh, PEG_END);
    const top = landed(soup, placed.mesh, PEG_TOP);
    for (const p of [end, top]) {
      expect(Math.abs(p[0] - pair!.on.centre[0])).toBeLessThan(0.05);
      expect(Math.abs(p[2] - pair!.on.centre[2])).toBeLessThan(0.05);
    }
    expect(Math.abs(end[1] - HOLE_BASE.floorMm)).toBeLessThan(0.05);
    // A flat end met a flat floor: the figure stands as it did, and says so.
    expect(placed.orientation.method).not.toBe('marked');
    expect(placed.orientation.tiltDeg).toBe(0);
  }, 60_000);

  it('tilts a figure onto a sloped rock, raised along and turned about the normal', () => {
    const soup = generatePegFigure(PEG_LENGTH_MM);
    const base = encodeBinaryStl(generateSlopeBase());
    const meeting: Meeting = {
      pairs: [tapPair(1, SLOPE_BASE.topCentre, 0, PEG_END)],
    };
    const flat = placePairOnly(pegStl(), base, {
      placement: { marks: meeting },
    });
    const marks = flat.pair.placement!.marks!;
    // 36.87° is more than the slack: the least change that fits tilts it.
    expect(marks.fit.kept).toBe('free');
    expect(flat.orientation.method).toBe('marked');
    expect(flat.orientation.tiltDeg).toBeCloseTo(36.87, 2);
    const n = marks.pairs[0]!.on.normal;
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
    expect(angleDeg(axis(turned), n)).toBeLessThan(0.01);
    expect(turned.pair.placement!.yawDeg).toBe(90);

    // Kept upright when asked: the peg stands as it did, its end on the slope's patch.
    const upright = placePairOnly(pegStl(), base, {
      placement: { marks: { ...meeting, turn: 'keep' } },
    });
    expect(upright.pair.placement!.marks!.fit.kept).toBe('standing');
    expect(upright.orientation.method).not.toBe('marked');
  }, 60_000);

  it('places automatically when no pair marks anything', () => {
    const automatic = placePairOnly(pegStl(), encodeBinaryStl(generateHoleBase()));
    const empty = placePairOnly(pegStl(), encodeBinaryStl(generateHoleBase()), {
      placement: {
        marks: {
          pairs: [{ on: { file: 1, strokes: [] }, of: { file: 0, strokes: [] } }],
        },
      },
    });
    expect(empty.pair.placement).toEqual(automatic.pair.placement);
  }, 60_000);

  it('refuses pairs on the wrong files', () => {
    expect(() =>
      placePairOnly(pegStl(), encodeBinaryStl(generateHoleBase()), {
        placement: { marks: { pairs: [tapPair(0, [0, 0, 0], 1, [0, 0, 1])] } },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'unexpected',
        detail: expect.stringMatching(/pairs on files 0\/1/),
      }),
    );
  }, 60_000);

  it('converts again to the same bits with the choices it ended with', async () => {
    const options = {
      bake: 0,
      secondStl: encodeBinaryStl(generateHoleBase()),
    } as const;
    const first = await runPipeline(pegStl(), {
      ...options,
      placement: { marks: holeMeeting() },
    });
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

describe('applyMeetAction (§5.6)', () => {
  const base: MeetContext = { about: 'base', baseFile: 1, figureFiles: [0, 2] };
  const parts: MeetContext = {
    about: 'parts',
    baseFile: null,
    figureFiles: [0, 1, 2],
  };
  const fresh = (context: MeetContext): MeetState => startMeeting(null, {}, context);
  const tap = (file: number, pair = 0): MarkingAction => ({
    do: 'tap',
    hit: { file, point: [file, 0, 0] },
    pair,
  });
  /** Actions one after the other; the notes of each. */
  const run = (context: MeetContext, actions: MarkingAction[], from = fresh(context)) => {
    let state = from;
    const notes: (string | null)[] = [];
    for (const action of actions) {
      const out = applyMeetAction(state, action, context);
      state = out.state;
      notes.push(out.note);
    }
    return { state, notes };
  };
  const sides = (state: MeetState): [number | null, number | null][] =>
    state.draft!.pairs.map(({ on, of }) => [on?.file ?? null, of?.file ?? null]);

  it('puts the base on the on side and a figure part on the of side, whichever comes first', () => {
    expect(sides(run(base, [tap(0), tap(1)]).state)).toEqual([[1, 0]]);
    expect(sides(run(base, [tap(1), tap(2)]).state)).toEqual([[1, 2]]);
    // A second tap on a side's file adds a stroke to it.
    const twice = run(base, [tap(1), tap(1)]).state;
    expect(twice.draft!.pairs[0]!.on!.strokes).toHaveLength(2);
  });

  it('refuses a third file on a pair with both sides, and a file that is neither', () => {
    const { notes, state } = run(base, [tap(1), tap(0), tap(2)]);
    expect(notes).toEqual([null, null, 'full']);
    expect(sides(state)).toEqual([[1, 0]]);
    expect(run(base, [tap(5)]).notes).toEqual(['missed']);
    expect(run(base, [{ do: 'tap', hit: null, pair: 0 }]).notes).toEqual(['missed']);
  });

  it('starts a new pair at the next index, and no more than MAX_PAIRS', () => {
    const { state } = run(base, [tap(1, 0), tap(0, 0), tap(1, 1), tap(2, 1)]);
    expect(sides(state)).toEqual([
      [1, 0],
      [1, 2],
    ]);
    expect(run(base, [tap(1, MAX_PAIRS)]).notes).toEqual(['full']);
    // An index past the end is the next pair.
    expect(sides(run(base, [tap(1, 3)]).state)).toEqual([[1, null]]);
  });

  it('at the parts question puts a part in place on the on side', () => {
    // The body first: in place. A part tapped first is the part that goes there.
    expect(sides(run(parts, [tap(0), tap(1)]).state)).toEqual([[0, 1]]);
    expect(sides(run(parts, [tap(1), tap(0)]).state)).toEqual([[0, 1]]);
    // A part a joint already places is in place for the next pair.
    expect(sides(run(parts, [tap(0), tap(1), tap(1, 1), tap(2, 1)]).state)).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('refuses a pair that gives a part a second part to meet, or makes two parts hang on each other', () => {
    // 2 onto the body, 1 onto 2; then 1 onto the body as well.
    const second = run(parts, [tap(0), tap(2), tap(1, 1), tap(2, 1), tap(1, 2), tap(0, 2)]);
    expect(second.notes).toEqual([null, null, null, null, null, 'one-part']);
    // 1 onto 2, then 2 onto 1.
    const round = run(parts, [tap(1), tap(2), tap(2, 1), tap(1, 1)]);
    expect(round.notes.at(-1)).toBe('one-part');
  });

  it('takes erase only from a side already marked, and a drag on one part only', () => {
    const erase: MarkingAction = {
      do: 'brush',
      hits: [{ file: 1, point: [0, 0, 0] }],
      pair: 0,
      radiusMm: 1,
      erase: true,
    };
    expect(run(base, [erase]).notes).toEqual(['missed']);
    const drag: MarkingAction = {
      do: 'brush',
      hits: [
        { file: 1, point: [0, 0, 0] },
        null,
        { file: 0, point: [1, 0, 0] },
        { file: 1, point: [2, 0, 0] },
      ],
      pair: 0,
      radiusMm: 1,
    };
    const { state } = run(base, [drag]);
    expect(sides(state)).toEqual([[1, null]]);
    expect(state.draft!.pairs[0]!.on!.strokes).toEqual([
      { brush: [0, 0, 0], radiusMm: 1 },
      { brush: [2, 0, 0], radiusMm: 1 },
    ]);
  });

  it('clears a pair, starts over to the proposal, and undoes one action at a time', () => {
    const marked = run(base, [tap(1), tap(0), tap(1, 1)]).state;
    const cleared = run(base, [{ do: 'clear', pair: 0 }], marked).state;
    expect(sides(cleared)).toEqual([[1, null]]);
    const over = run(base, [{ do: 'clear' }], marked).state;
    expect(over.draft).toBeNull();
    const undone = run(base, [{ do: 'undo' }], over).state;
    expect(sides(undone)).toEqual(sides(marked));
    const back = run(base, [{ do: 'undo' }, { do: 'undo' }, { do: 'undo' }], marked).state;
    expect(back.draft).toBeNull();
    expect(run(base, [{ do: 'undo' }], back).state).toEqual(back);
  });

  it('records complete pairs only, with the nudges, and sets a record back', () => {
    const { state } = run(base, [
      tap(1),
      tap(0),
      tap(1, 1),
      { do: 'nudge', liftMm: 0.5 },
      { do: 'nudge', liftMm: 0.5, turnDeg: -15, turn: 'keep' },
    ]);
    const meeting = marksOf(state.draft, base) as Meeting;
    expect(meeting).toEqual({
      pairs: [tapPair(1, [1, 0, 0], 0, [0, 0, 0])],
      liftMm: 1,
      turnDeg: -15,
      turn: 'keep',
    });
    const set = run(base, [{ do: 'set', marks: meeting }]).state;
    expect(marksOf(set.draft, base)).toEqual(meeting);
    expect(run(base, [{ do: 'set', marks: null }], set).state.draft).toBeNull();
  });

  it('nudges the automatic placement while the proposal stands', () => {
    const { state } = run(
      base,
      [{ do: 'nudge', liftMm: 0.5, turnDeg: 15 }],
      startMeeting(null, { liftMm: 1 }, base),
    );
    expect(state.automatic).toEqual({ liftMm: 1.5, turnDeg: 15, nudged: true });
    expect(state.draft).toBeNull();
  });

  it('groups the parts pairs by part into joints, each with its own nudge', () => {
    const { state } = run(parts, [
      tap(0),
      tap(1),
      tap(0, 1),
      tap(1, 1),
      tap(1, 2),
      tap(2, 2),
      { do: 'nudge', part: 2, turnDeg: 90 },
    ]);
    const joints = marksOf(state.draft, parts) as PartJoint[];
    expect(
      joints.map(({ part, onto, pairs, turnDeg }) => [part, onto, pairs.length, turnDeg]),
    ).toEqual([
      [1, 0, 2, undefined],
      [2, 1, 1, 90],
    ]);
  });

  it(`keeps at most ${MAX_STROKES} strokes on a side`, () => {
    let state = fresh(base);
    for (let k = 0; k < MAX_STROKES + 5; k++) state = applyMeetAction(state, tap(1), base).state;
    expect(state.draft!.pairs[0]!.on!.strokes).toHaveLength(MAX_STROKES);
  });
});
describe('strokesCovering and pairsAllowed (a proposal made editable)', () => {
  it('covers a patch with brush dabs that resolve to at least it, and little more', () => {
    const mesh = welded(generatePlate(30, 2, 0.25, () => false));
    const tree = new TriangleBvh(mesh);
    const patch = resolvePatch(mesh, tree, {
      file: 2,
      strokes: [{ tap: [-4, 0, 2] }, { tap: [4, 0, 2] }],
    });
    const strokes = strokesCovering(mesh, tree, patch);
    expect(strokes.length).toBeGreaterThan(1);
    expect(strokes.length).toBeLessThanOrEqual(MAX_STROKES);
    expect(strokes.every((stroke) => 'brush' in stroke)).toBe(true);
    const again = resolvePatch(mesh, tree, { file: 2, strokes });
    expect([...again.triangles]).toEqual(expect.arrayContaining([...patch.triangles]));
    // A rim of one dab's radius at most around two 3 mm discs.
    expect(again.areaMm2).toBeLessThan(patch.areaMm2 * 1.8);
    expect(strokesCovering(mesh, tree, { ...patch, triangles: new Uint32Array(0) })).toEqual([]);
  });

  it(`takes ${MAX_PAIRS} pairs where the figure meets its base, and as many per part`, () => {
    expect(pairsAllowed('base', 3)).toBe(MAX_PAIRS);
    expect(pairsAllowed('parts', 2)).toBe(MAX_PAIRS);
    expect(pairsAllowed('parts', 6)).toBe(5 * MAX_PAIRS);
  });
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
