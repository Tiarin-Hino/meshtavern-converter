import type { ToolId } from '../pipeline/brush';

/**
 * What differs between the tools (issue #127, design note `docs/design/painting-engine.md` §6):
 * how a dab's coverage goes into the stroke layer, how the stroke goes onto the paint, and the
 * mask, a GLSL function of the texel's surface that `toolMask` in pipeline/brush.ts mirrors
 * (`tools.test.ts` keeps the two in step). The hobby brushes of #128 add their rows here.
 */
export interface ToolPass {
  /** Into the stroke layer: the largest coverage so far (a loaded brush), or added up (an airbrush). */
  blend: 'max' | 'add';
  /** Onto the paint: the colour over it, or alpha taken away. */
  composite: 'over' | 'erase';
  /**
   * The body of `float mtMask( float cavity, float occlusion, vec3 normal )`: cavity −1 crease …
   * +1 edge (the detail texture's, as the material decodes it), occlusion 0 buried … 1 open, the
   * object-space normal.
   */
  mask: string;
}

export const TOOL_PASSES: Partial<Record<ToolId, ToolPass>> = {
  flat: { blend: 'max', composite: 'over', mask: 'return 1.0;' },
  eraser: { blend: 'max', composite: 'erase', mask: 'return 1.0;' },
  fill: { blend: 'max', composite: 'over', mask: 'return 1.0;' },
};

/** The tools this build paints with; the others are #128's. */
export const BUILT_TOOLS = Object.keys(TOOL_PASSES) as ToolId[];

export function toolPass(tool: ToolId): ToolPass {
  const pass = TOOL_PASSES[tool];
  if (!pass) throw new RangeError(`The ${tool} tool is not built yet`);
  return pass;
}
