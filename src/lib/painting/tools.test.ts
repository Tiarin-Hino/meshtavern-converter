import { describe, expect, it } from 'vitest';
import { DEFAULT_BRUSH, TOOL_IDS, toolMask, type BrushSettings } from '../pipeline/brush';
import { AIR_FLOW_GAIN, AIR_HARDNESS, DRY_OPACITY } from '../pipeline/look';
import { dabGain, strokeOpacity, TOOL_PASSES, toolPass } from './tools';

// The masks' GLSL and their CPU twin `toolMask` (design note §6). The GLSL is run as JavaScript:
// `float` becomes `let`, and the few GLSL functions it uses are given, so the shader's text and
// toolMask are compared value by value, as the material and `pointColour` are kept in step.

type V3 = [number, number, number];
const glsl = {
  clamp: (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x)),
  max: Math.max,
  smoothstep: (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  },
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  length: (a: V3) => Math.hypot(...a),
};

/** A tool's mask GLSL as a JavaScript function of the same inputs and uniforms. */
function maskAsJs(
  mask: string,
): (
  cavity: number,
  occlusion: number,
  normal: V3,
  brush: BrushSettings,
  reference: number,
) => number {
  const body = mask.replace(/\bfloat\b/g, 'let');
  const run = new Function(
    'cavity',
    'occlusion',
    'normal',
    'reference',
    'uPressure',
    'uDirection',
    ...Object.keys(glsl),
    body,
  ) as (...args: unknown[]) => number;
  return (cavity, occlusion, normal, brush, reference) => {
    const direction = brush.direction;
    const uDirection = direction ? { xyz: direction, w: 1 } : { xyz: [0, 0, 0], w: 0 };
    return run(
      cavity,
      occlusion,
      normal,
      reference,
      brush.opacity,
      uDirection,
      ...Object.values(glsl),
    );
  };
}

describe('the tools', () => {
  it('pairs every tool’s mask GLSL with toolMask, over the surface, the sliders and the reference', () => {
    const normals: V3[] = [
      [0, 1, 0],
      [0, -1, 0],
      [0.6, 0.8, 0],
      [0.1, 0.2, 0.9],
      [0.98, 0.15, 0],
      [0, 0.45, 0.02],
    ];
    for (const tool of TOOL_IDS) {
      const gpu = maskAsJs(TOOL_PASSES[tool].mask);
      // The reference is read by the tools that measure one (the dry brush, #133).
      const references = TOOL_PASSES[tool].reference ? [-1, 0, 0.0078, 0.05, 0.12, 0.4, 1] : [1];
      for (const cavity of [-1, -0.6, -0.1, 0, 0.05, 0.15, 0.3, 0.5, 0.75, 1])
        for (const occlusion of [0, 0.3, 0.7, 1])
          for (const normal of normals)
            for (const opacity of [0, 0.25, 0.5, 1])
              for (const direction of [null, [0, 1, 0], [0.6, 0, 0.8]] as (V3 | null)[])
                for (const reference of references) {
                  const brush = { ...DEFAULT_BRUSH, opacity, direction };
                  expect(gpu(cavity, occlusion, normal, brush, reference)).toBeCloseTo(
                    toolMask(tool, cavity, occlusion, normal, brush, reference),
                    12,
                  );
                }
    }
  });

  it('refuses a name that is no tool', () => {
    expect(toolPass('eraser').composite).toBe('erase');
    expect(toolPass('lift').composite).toBe('lift');
    expect(toolPass('flat').blend).toBe('max');
    expect(toolPass('unmask-fill').composite).toBe('unmask');
    expect(toolPass('group').composite).toBe('group');
    expect(toolPass('group-fill').composite).toBe('group');
    expect(() => toolPass('glaze' as never)).toThrow(RangeError);
  });

  it('measures a reference for the dry brush only (#133)', () => {
    for (const tool of TOOL_IDS) expect(toolPass(tool).reference === true).toBe(tool === 'dry');
  });

  it('adds up the airbrush, soft, with its flow in each dab; the dry brush at its own opacity', () => {
    for (const tool of TOOL_IDS)
      expect(toolPass(tool).blend).toBe(tool === 'airbrush' ? 'add' : 'max');
    expect(toolPass('airbrush').hardness).toBe(AIR_HARDNESS);
    const brush = { ...DEFAULT_BRUSH, opacity: 0.4 };
    expect(dabGain('airbrush', brush)).toBeCloseTo(AIR_FLOW_GAIN * 0.4, 12);
    expect(strokeOpacity('airbrush', brush)).toBe(1);
    expect(strokeOpacity('dry', brush)).toBe(DRY_OPACITY);
    for (const tool of ['flat', 'eraser', 'lift', 'fill', 'wash', 'ink'] as const) {
      expect(strokeOpacity(tool, brush)).toBe(0.4);
      expect(dabGain(tool, brush)).toBe(1);
    }
  });
});
