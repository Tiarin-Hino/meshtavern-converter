import { describe, expect, it } from 'vitest';
import {
  generatePuddleFigureParts,
  generateRecessBase,
  generateWingedFigure,
  movedSoup,
  WINGED_FIGURE,
} from '../../regression/shapes';
import { assembleFigure, EXPLODE_MM, MAX_PARTS, proposedJoints, pulledApart } from './assemble';
import type { Vec3 } from './base';
import type { PartJoint, PatchPair } from './marks';
import { weldVertices, type IndexedMesh } from './mesh';
import { PROBLEM_MESSAGES } from './problems';
import { IDENTITY } from './rotation';
import { runPipeline } from './run';
import { encodeBinaryStl } from './stl';

const welded = (soup: Float32Array): IndexedMesh => weldVertices(soup).mesh;

/** The largest distance between two meshes' vertices, which must be listed alike. */
function farthest(a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length);
  let most = 0;
  for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i]! - b[i]!));
  return most;
}

const WING_MOVE: Vec3 = [50, 0, 0];
const TIP_MOVE: Vec3 = [0, 60, -5];
const plus = (p: Vec3, by: Vec3): Vec3 => [p[0] + by[0], p[1] + by[1], p[2] + by[2]];
/** One tap on each side. */
const tapPair = (onFile: number, on: Vec3, ofFile: number, of: Vec3): PatchPair => ({
  on: { file: onFile, strokes: [{ tap: on }] },
  of: { file: ofFile, strokes: [{ tap: of }] },
});

describe('assembleFigure', { timeout: 60_000 }, () => {
  it('keeps parts where their files put them: the same bits as the one-piece mesh', () => {
    const { whole, body, wing, tip } = generateWingedFigure();
    const meshes = [body, wing, tip].map(welded);
    const { mesh, parts } = assembleFigure(meshes, [0, 1, 2], []);
    const one = welded(whole);
    expect(mesh.positions).toEqual(one.positions);
    expect(mesh.indices).toEqual(one.indices);
    expect(parts.map((part) => part.source)).toEqual(['body', 'files', 'files']);
    expect(parts.map((part) => part.triangles)).toEqual(meshes.map((m) => m.indices.length / 3));
  });

  it('puts a part exported apart back by a pair of taps, only moving it', () => {
    const { whole, body, wing, tip } = generateWingedFigure();
    const meshes = [body, movedSoup(wing, WING_MOVE), tip].map(welded);
    const joint: PartJoint = {
      part: 1,
      onto: 0,
      pairs: [tapPair(0, WINGED_FIGURE.joint, 1, plus(WINGED_FIGURE.joint, WING_MOVE))],
    };
    const { mesh, parts } = assembleFigure(meshes, [0, 1, 2], [joint]);
    expect(farthest(mesh.positions, welded(whole).positions)).toBeLessThan(0.01);
    expect(parts[1]).toMatchObject({ file: 1, source: 'marked', joint: { onto: 0, liftMm: 0 } });
    expect(parts[1]!.joint!.fit.kept).toBe('standing');
    expect(parts[1]!.rotation).toBe(IDENTITY);
    expect(parts[1]!.translation.map((t, k) => Math.round(t + WING_MOVE[k]!))).toEqual([0, 0, 0]);
  });

  it('turns a part exported a quarter turn away back by its pair', () => {
    const { body, wing } = generateWingedFigure();
    // A quarter turn about z, (x, y, z) → (-y, x, z), then 50 mm away.
    const quarter = (p: Vec3): Vec3 => plus([0 - p[1], p[0], p[2]], WING_MOVE);
    const turned = new Float32Array(wing.length);
    for (let i = 0; i < wing.length; i += 3) {
      turned.set(quarter([wing[i]!, wing[i + 1]!, wing[i + 2]!]), i);
    }
    const meshes = [body, turned].map(welded);
    const joint: PartJoint = {
      part: 1,
      onto: 0,
      pairs: [tapPair(0, WINGED_FIGURE.joint, 1, quarter(WINGED_FIGURE.joint))],
    };
    const { mesh, parts } = assembleFigure(meshes, [0, 1], [joint]);
    const one = welded(new Float32Array([...body, ...wing]));
    // Each part welded on its own lists its vertices as the one-piece mesh does.
    expect(farthest(mesh.positions, one.positions)).toBeLessThan(0.1);
    expect(parts[1]!.joint!.fit.kept).toBe('free');
  });

  it('resolves a joint onto a part that has its own joint after it, whatever the order', () => {
    const { whole, body, wing, tip } = generateWingedFigure();
    // The tip is the second file, joined onto the wing, the third file, joined onto the body.
    const meshes = [body, movedSoup(tip, TIP_MOVE), movedSoup(wing, WING_MOVE)].map(welded);
    const joints: PartJoint[] = [
      {
        part: 1,
        onto: 2,
        pairs: [
          tapPair(
            2,
            plus(WINGED_FIGURE.tipJoint, WING_MOVE),
            1,
            plus(WINGED_FIGURE.tipJoint, TIP_MOVE),
          ),
        ],
      },
      {
        part: 2,
        onto: 0,
        pairs: [tapPair(0, WINGED_FIGURE.joint, 2, plus(WINGED_FIGURE.joint, WING_MOVE))],
      },
    ];
    const { mesh } = assembleFigure(meshes, [0, 2, 1], joints);
    // Listed body, wing, tip: the order of `figureFiles`, the order of `whole`.
    expect(farthest(mesh.positions, welded(whole).positions)).toBeLessThan(0.01);
  });

  it('raises a part along the on patch normal and turns it about it', () => {
    const { body, wing } = generateWingedFigure();
    const meshes = [body, wing].map(welded);
    const joint = (more: Partial<PartJoint>): PartJoint => ({
      part: 1,
      onto: 0,
      pairs: [tapPair(0, WINGED_FIGURE.joint, 1, WINGED_FIGURE.joint)],
      ...more,
    });
    const raised = assembleFigure(meshes, [0, 1], [joint({ liftMm: 1 })]).parts[1]!;
    expect(raised.translation[0]).toBeCloseTo(1, 9);
    expect(raised.joint!.liftMm).toBe(1);
    const turned = assembleFigure(meshes, [0, 1], [joint({ turnDeg: 90 })]).parts[1]!;
    const [pair] = turned.joint!.pairs;
    for (let k = 0; k < 3; k++) expect(pair!.of.centre[k]).toBeCloseTo(pair!.on.centre[k]!, 9);
    expect(turned.joint!.turnDeg).toBe(90);
  });

  it('leaves a part where its file puts it when its pairs mark nothing', () => {
    const { body, wing } = generateWingedFigure();
    const meshes = [body, wing].map(welded);
    const joint: PartJoint = {
      part: 1,
      onto: 0,
      pairs: [{ on: { file: 0, strokes: [] }, of: { file: 1, strokes: [] } }],
    };
    expect(assembleFigure(meshes, [0, 1], [joint]).parts[1]!.source).toBe('files');
  });

  it('refuses a joint that goes round or names a file that is not a part', () => {
    const { body, wing, tip } = generateWingedFigure();
    const meshes = [body, wing, tip].map(welded);
    const joint = (part: number, onto: number): PartJoint => ({
      part,
      onto,
      pairs: [tapPair(onto, [0, 0, 0], part, [0, 0, 0])],
    });
    const detail = (joints: PartJoint[]): string | undefined => {
      try {
        assembleFigure(meshes, [0, 1, 2], joints);
      } catch (error) {
        return (error as { detail?: string }).detail;
      }
      return undefined;
    };
    expect(detail([joint(1, 2), joint(2, 1)])).toMatch(/go round/);
    expect(detail([joint(0, 1)])).toMatch(/a joint of file 0/);
    expect(detail([{ part: 1, onto: 0, pairs: [tapPair(2, [0, 0, 0], 1, [0, 0, 0])] }])).toMatch(
      /pairs on 2\/1/,
    );
  });
});

describe('proposedJoints', { timeout: 60_000 }, () => {
  it('proposes the pair where a part in place touches the body, and nothing for a part apart', () => {
    const { body, wing } = generateWingedFigure();
    const inPlace = [body, wing].map(welded);
    const [proposal, more] = proposedJoints(inPlace, [0, 1]);
    expect(more).toBeUndefined();
    expect(proposal).toMatchObject({ part: 1, onto: 0 });
    expect(proposal!.pairs).toHaveLength(1);
    // The wing's root lies on the shoulder plate's face, x = 8.5.
    expect(proposal!.pairs[0]!.of.centre[0]).toBeCloseTo(WINGED_FIGURE.joint[0], 4);
    expect(Math.abs(proposal!.pairs[0]!.on.centre[0] - WINGED_FIGURE.joint[0])).toBeLessThan(0.01);

    const apart = [body, movedSoup(wing, WING_MOVE)].map(welded);
    expect(proposedJoints(apart, [0, 1])).toEqual([]);
  });

  it('pulls the parts that touch away from the body, and leaves the others', () => {
    const { body, wing, tip } = generateWingedFigure();
    const meshes = [body, wing, movedSoup(tip, TIP_MOVE)].map(welded);
    const pulled = pulledApart(meshes, [0, 1, 2], new Set([0, 1]));
    expect(pulled[0]!.translation).toEqual([0, 0, 0]);
    expect(Math.hypot(...pulled[1]!.translation)).toBeCloseTo(EXPLODE_MM, 9);
    // The wing lies to the body's +x.
    expect(pulled[1]!.translation[0]).toBeGreaterThan(0);
    expect(pulled[2]!.translation).toEqual([0, 0, 0]);
  });
});

describe('a figure in several files (#93)', () => {
  const [body, arm] = generatePuddleFigureParts(12);

  it('converts body, arm and base like the figure of one file on the base', async () => {
    const base = encodeBinaryStl(generateRecessBase());
    const whole = encodeBinaryStl(new Float32Array([...body, ...arm]));
    const one = await runPipeline(whole, { bake: 0, secondStl: base });
    const parts = await runPipeline(encodeBinaryStl(body), {
      bake: 0,
      secondStl: base,
      moreStl: [encodeBinaryStl(arm)],
    });
    expect(parts.mesh.positions).toEqual(one.mesh.positions);
    expect(parts.lods.map((lod) => lod.triangles)).toEqual(one.lods.map((lod) => lod.triangles));
    expect(parts.pair!.placement).toEqual(one.pair!.placement);
    expect(parts.pair!.pairing.baseFile).toBe(1);
    expect(
      parts.pair!.parts.map(({ file, source, triangles }) => [file, source, triangles]),
    ).toEqual([
      [0, 'body', body.length / 9],
      [2, 'files', arm.length / 9],
    ]);
    expect(parts.stats.timings.map((t) => t.step)).toContain('assemble');
  }, 120_000);

  it('converts parts without a base file like the one file they make', async () => {
    const whole = await runPipeline(encodeBinaryStl(new Float32Array([...body, ...arm])), {
      bake: 0,
    });
    const parts = await runPipeline(encodeBinaryStl(body), {
      bake: 0,
      secondStl: encodeBinaryStl(arm),
      pairing: { baseFile: null },
    });
    expect(parts.mesh.positions).toEqual(whole.mesh.positions);
    expect(parts.orientation).toEqual(whole.orientation);
    expect(parts.sizing).toEqual(whole.sizing);
    expect(parts.pair).toMatchObject({ placement: null, baseOrientation: null });
    expect(parts.pair!.pairing.baseFile).toBeNull();
    expect(parts.stats.timings.map((t) => t.step)).not.toContain('place');
  }, 120_000);

  it(`refuses more than ${MAX_PARTS} files before reading any`, async () => {
    const empty = new ArrayBuffer(0);
    const files = Array.from({ length: MAX_PARTS }, () => empty);
    await expect(runPipeline(empty, { secondStl: empty, moreStl: files })).rejects.toMatchObject({
      code: 'too-many-files',
    });
    expect(PROBLEM_MESSAGES['too-many-files']).toContain(`${MAX_PARTS} files`);
  });
});
