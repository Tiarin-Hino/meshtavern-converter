import type { BrushSettings, ToolId } from '../pipeline/brush';
import {
  AIR_DIR_EDGE,
  AIR_DIR_SOFTNESS,
  AIR_FLOW_GAIN,
  AIR_HARDNESS,
  DRY_OPACITY,
  DRY_REFERENCE_MIN,
  DRY_SOFTNESS,
  DRY_THRESHOLD,
  FLAT_CAVITY,
  INK_FLAT,
  WASH_FLAT,
  WASH_LIFT,
  WASH_OCCLUSION,
} from '../pipeline/look';

/**
 * What differs between the tools (issue #127, design note `docs/design/painting-engine.md` §6):
 * how a dab's coverage goes into the stroke layer, how the stroke goes onto the paint, and the
 * mask, a GLSL function of the texel's surface that `toolMask` in pipeline/brush.ts mirrors
 * (`tools.test.ts` runs the GLSL against it). The hobby brushes of #128 read the surface, with
 * their constants beside the look's (`look.ts`); the dry brush also its stroke's reference (#133).
 */
export interface ToolPass {
  /** Into the stroke layer: the largest coverage so far (a loaded brush), or added up (an airbrush). */
  blend: 'max' | 'add';
  /**
   * Onto the paint: the colour over it, alpha taken away, or the paint beneath a step brought back
   * where that step is on top (#137, `docs/design/lift-eraser.md`). Or onto the mask instead (#138,
   * `docs/design/paint-mask.md`): mask laid (`mask`) or taken away (`unmask`). Or nothing (`group`,
   * #139, `docs/design/paint-groups.md`): the group tools change which group a triangle is in,
   * read from the stroke layer at the commit, and neither the paint nor the mask.
   */
  composite: 'over' | 'erase' | 'lift' | 'mask' | 'unmask' | 'group';
  /**
   * The body of `float mtMask( float cavity, float occlusion, vec3 normal, float reference )`:
   * cavity −1 crease … +1 edge (the detail texture's, as the material decodes it), occlusion 0
   * buried … 1 open, the object-space normal (not necessarily of unit length), the stroke's
   * reference (the highest cavity under its first dab, for a tool with `reference`, #133). It may
   * read the uniforms `uPressure` (the brush's `opacity`) and `uDirection` (the brush's `direction`
   * in xyz, w 1, or w 0 for none). Written so that it is also JavaScript once `float` is `let`
   * (tools.test.ts).
   */
  mask: string;
  /** The dab's hardness when the tool has its own; else the brush's. */
  hardness?: number;
  /** The mask reads the stroke's reference: measured after the first dab (`PaintPasses.measureReference`, #133). */
  reference?: boolean;
}

/** A number as a GLSL float literal. */
const f = (value: number): string => (Number.isInteger(value) ? value.toFixed(1) : String(value));

export const TOOL_PASSES: Record<ToolId, ToolPass> = {
  flat: { blend: 'max', composite: 'over', mask: 'return 1.0;' },
  eraser: { blend: 'max', composite: 'erase', mask: 'return 1.0;' },
  lift: { blend: 'max', composite: 'lift', mask: 'return 1.0;' },
  fill: { blend: 'max', composite: 'over', mask: 'return 1.0;' },
  mask: { blend: 'max', composite: 'mask', mask: 'return 1.0;' },
  unmask: { blend: 'max', composite: 'unmask', mask: 'return 1.0;' },
  'mask-fill': { blend: 'max', composite: 'mask', mask: 'return 1.0;' },
  'unmask-fill': { blend: 'max', composite: 'unmask', mask: 'return 1.0;' },
  group: { blend: 'max', composite: 'group', mask: 'return 1.0;' },
  'group-fill': { blend: 'max', composite: 'group', mask: 'return 1.0;' },
  wash: {
    blend: 'max',
    composite: 'over',
    mask: `float pool = clamp( max( -cavity, 0.0 ) + ${f(WASH_OCCLUSION)} * ( 1.0 - occlusion ), 0.0, 1.0 );
  return ( ${f(WASH_FLAT)} + ${f(1 - WASH_FLAT)} * pool ) * ( 1.0 - ${f(WASH_LIFT)} * max( cavity, 0.0 ) );`,
  },
  ink: {
    blend: 'max',
    composite: 'over',
    mask: `return ${f(INK_FLAT)} + ${f(1 - INK_FLAT)} * clamp( -cavity, 0.0, 1.0 );`,
  },
  dry: {
    blend: 'max',
    composite: 'over',
    mask: `float scale = max( reference - ${f(FLAT_CAVITY)}, ${f(DRY_REFERENCE_MIN)} );
  float threshold = ${f(DRY_THRESHOLD)} * ( 1.0 - uPressure );
  return smoothstep( threshold, threshold + ${f(DRY_SOFTNESS)}, ( cavity - ${f(FLAT_CAVITY)} ) / scale );`,
    reference: true,
  },
  airbrush: {
    blend: 'add',
    composite: 'over',
    mask: `if ( uDirection.w == 0.0 ) return 1.0;
  float facing = dot( normal, uDirection.xyz ) / max( length( normal ), 0.000001 );
  return smoothstep( ${f(AIR_DIR_EDGE)}, ${f(AIR_DIR_EDGE + AIR_DIR_SOFTNESS)}, facing );`,
    hardness: AIR_HARDNESS,
  },
};

/** True for a pass onto the mask, not the paint (#138). */
export const ontoMask = (pass: ToolPass): boolean =>
  pass.composite === 'mask' || pass.composite === 'unmask';

/** True for a pass that changes the groups (#139): nothing is composited. */
export const ontoGroups = (pass: ToolPass): boolean => pass.composite === 'group';

/** A tool's pass; a name that is no tool (a string from a consumer's JavaScript) is refused. */
export function toolPass(tool: ToolId): ToolPass {
  const pass = Object.hasOwn(TOOL_PASSES, tool) ? TOOL_PASSES[tool] : undefined;
  if (!pass) throw new RangeError(`There is no ${String(tool)} tool`);
  return pass;
}

/**
 * The opacity the stroke goes onto the paint with (§6): the brush's, but the dry brush's slider
 * is its pressure (its opacity is `DRY_OPACITY`), and the airbrush's flow is in what each dab
 * adds (`dabGain`), so its stroke goes on whole.
 */
export function strokeOpacity(tool: ToolId, brush: BrushSettings): number {
  if (tool === 'dry') return DRY_OPACITY;
  if (tool === 'airbrush') return 1;
  return brush.opacity;
}

/** What one dab of an adding tool puts into the stroke layer at full coverage: the airbrush's `AIR_FLOW_GAIN × flow`. */
export function dabGain(tool: ToolId, brush: BrushSettings): number {
  return toolPass(tool).blend === 'add' ? AIR_FLOW_GAIN * brush.opacity : 1;
}
