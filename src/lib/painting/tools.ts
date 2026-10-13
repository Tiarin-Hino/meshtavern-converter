import { TOOL_IDS, type BrushSettings, type ToolId } from '../pipeline/brush';
import {
  AIR_DIR_EDGE,
  AIR_DIR_SOFTNESS,
  AIR_FLOW_GAIN,
  AIR_HARDNESS,
  DRY_OPACITY,
  DRY_SOFTNESS,
  DRY_THRESHOLD,
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
 * their constants beside the look's (`look.ts`).
 */
export interface ToolPass {
  /** Into the stroke layer: the largest coverage so far (a loaded brush), or added up (an airbrush). */
  blend: 'max' | 'add';
  /** Onto the paint: the colour over it, or alpha taken away. */
  composite: 'over' | 'erase';
  /**
   * The body of `float mtMask( float cavity, float occlusion, vec3 normal )`: cavity −1 crease …
   * +1 edge (the detail texture's, as the material decodes it), occlusion 0 buried … 1 open, the
   * object-space normal (not necessarily of unit length). It may read the uniforms `uReach` (the
   * brush's `opacity`) and `uDirection` (the brush's `direction` in xyz, w 1, or w 0 for none).
   * Written so that it is also JavaScript once `float` is `let` (tools.test.ts).
   */
  mask: string;
  /** The dab's hardness when the tool has its own; else the brush's. */
  hardness?: number;
}

/** A number as a GLSL float literal. */
const f = (value: number): string => (Number.isInteger(value) ? value.toFixed(1) : String(value));

export const TOOL_PASSES: Record<ToolId, ToolPass> = {
  flat: { blend: 'max', composite: 'over', mask: 'return 1.0;' },
  eraser: { blend: 'max', composite: 'erase', mask: 'return 1.0;' },
  fill: { blend: 'max', composite: 'over', mask: 'return 1.0;' },
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
    mask: `float threshold = ${f(DRY_THRESHOLD)} * ( 1.0 - uReach );
  return smoothstep( threshold, threshold + ${f(DRY_SOFTNESS)}, cavity );`,
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

/** The tools this build paints with: all of them since #128. */
export const BUILT_TOOLS: readonly ToolId[] = TOOL_IDS.filter((tool) => tool in TOOL_PASSES);

export function toolPass(tool: ToolId): ToolPass {
  const pass = TOOL_PASSES[tool] as ToolPass | undefined;
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
