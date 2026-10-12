import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOOK,
  LOOK_PRESET_IDS,
  LOOK_PRESETS,
  paintFromBytes,
  paintedBase,
  parseHexColour,
  pointColour,
  presetOf,
  vertexColours,
} from './look';
import type { IndexedMesh } from './mesh';

describe('the look presets', () => {
  it('are four to six, each with its own name and values, the default first', () => {
    expect(LOOK_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(LOOK_PRESETS.length).toBeLessThanOrEqual(6);
    expect(LOOK_PRESETS.map((preset) => preset.id)).toEqual([...LOOK_PRESET_IDS]);
    expect(new Set(LOOK_PRESETS.map((preset) => preset.label)).size).toBe(LOOK_PRESETS.length);
    expect(LOOK_PRESETS[0]!.look).toEqual(DEFAULT_LOOK);
  });

  it('stay within what the controls can show', () => {
    for (const { look } of LOOK_PRESETS) {
      expect(look.enabled).toBe(true);
      // The colour input gives lower-case hex, and the sliders move in steps of 0.05.
      expect(look.base).toMatch(/^#[0-9a-f]{6}$/);
      expect(() => parseHexColour(look.base)).not.toThrow();
      for (const amount of [look.occlusion, look.wash, look.edges]) {
        expect(amount).toBeGreaterThanOrEqual(0);
        expect(amount).toBeLessThanOrEqual(1);
        expect(Math.abs(amount * 20 - Math.round(amount * 20))).toBeLessThan(1e-9);
      }
    }
  });

  it('are recognised from their values, and nothing else is', () => {
    for (const preset of LOOK_PRESETS) expect(presetOf({ ...preset.look })).toBe(preset.id);
    const bone = LOOK_PRESETS.find((preset) => preset.id === 'bone')!.look;
    expect(presetOf({ ...bone, base: bone.base.toUpperCase() })).toBe('bone');
    expect(presetOf({ ...bone, wash: 0.2 })).toBeNull();
    expect(presetOf({ ...bone, enabled: false })).toBeNull();
  });
});

describe('the paint under the look (#125)', () => {
  const base = parseHexColour(DEFAULT_LOOK.base);
  const red = [1, 0, 0];
  // A crease, an edge, a buried spot and an open flat one.
  const points: [number, number][] = [
    [1, -0.2],
    [1, 0.2],
    [0.3, 0],
    [1, 0],
  ];

  it('changes nothing where there is no paint or its alpha is zero', () => {
    for (const [occlusion, cavity] of points) {
      const plain = pointColour(base, DEFAULT_LOOK, occlusion, cavity);
      expect(pointColour(base, DEFAULT_LOOK, occlusion, cavity, null)).toEqual(plain);
      expect(pointColour(base, DEFAULT_LOOK, occlusion, cavity, [...red, 0])).toEqual(plain);
    }
  });

  it('replaces the base coat where its alpha is one, under the same wash and edges', () => {
    for (const [occlusion, cavity] of points)
      expect(pointColour(base, DEFAULT_LOOK, occlusion, cavity, [...red, 1])).toEqual(
        pointColour(red, DEFAULT_LOOK, occlusion, cavity),
      );
    // The wash still pools in a painted crease and the edge still catches the light.
    const flat = pointColour(base, DEFAULT_LOOK, 1, 0, [...red, 1]);
    const crease = pointColour(base, DEFAULT_LOOK, 1, -0.2, [...red, 1]);
    const edge = pointColour(base, DEFAULT_LOOK, 1, 0.2, [...red, 1]);
    expect(crease[0]).toBeLessThan(flat[0]);
    expect(edge[1]).toBeGreaterThan(flat[1]);
  });

  it('mixes the two by alpha in between, as a filtered edge of a painted area', () => {
    const half = paintedBase(base, [...red, 0.5]);
    for (const channel of [0, 1, 2])
      expect(half[channel]).toBeCloseTo((base[channel]! + red[channel]!) / 2, 12);
  });

  it('reads sRGB bytes as the GPU samples an sRGB texture', () => {
    const [r, g, b, a] = paintFromBytes([255, 0, 128, 51]);
    expect([r, g, a]).toEqual([1, 0, 0.2]);
    expect(b).toBeCloseTo(0.2158605, 6);
  });

  it('colours each vertex by its own paint, the others as before', () => {
    const mesh: IndexedMesh = {
      positions: new Float32Array(9),
      indices: new Uint32Array([0, 1, 2]),
      occlusion: new Float32Array([1, 0.5, 1]),
      cavity: new Float32Array([0, -0.2, 0.1]),
    };
    const plain = vertexColours(mesh, DEFAULT_LOOK);
    const paint = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255]);
    const painted = vertexColours(mesh, DEFAULT_LOOK, paint);
    expect([...painted.subarray(3, 6)]).toEqual([...plain.subarray(3, 6)]);
    expect([...painted.subarray(0, 3)]).toEqual(
      [...pointColour(red, DEFAULT_LOOK, 1, 0)].map(Math.fround),
    );
    expect([...painted.subarray(6, 9)]).toEqual(
      [...pointColour([0, 0, 1], DEFAULT_LOOK, 1, 0.1)].map(Math.fround),
    );
    // A look switched off shows the paint flat.
    const off = vertexColours(mesh, { ...DEFAULT_LOOK, enabled: false }, paint);
    expect([...off.subarray(0, 3)]).toEqual([1, 0, 0]);
    expect(() => vertexColours(mesh, DEFAULT_LOOK, new Uint8Array(4))).toThrow(RangeError);
  });
});
