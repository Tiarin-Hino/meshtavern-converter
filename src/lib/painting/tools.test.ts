import { describe, expect, it } from 'vitest';
import { DEFAULT_BRUSH, TOOL_IDS, toolMask } from '../pipeline/brush';
import { BUILT_TOOLS, TOOL_PASSES, toolPass } from './tools';

// The masks' GLSL and their CPU twin `toolMask` (design note §6): a mask that paints every texel
// is `return 1.0;` and 1 on the CPU, whatever the surface.

describe('the tools', () => {
  it('pairs every built tool’s mask with toolMask', () => {
    for (const tool of BUILT_TOOLS) {
      const pass = TOOL_PASSES[tool]!;
      for (const [cavity, occlusion] of [
        [-1, 0],
        [0, 0.5],
        [1, 1],
      ] as const) {
        const cpu = toolMask(tool, cavity, occlusion, [0, 1, 0], DEFAULT_BRUSH);
        if (pass.mask === 'return 1.0;') expect(cpu).toBe(1);
        else throw new Error(`No CPU twin pinned for the ${tool} mask`);
      }
    }
  });

  it('builds the flat brush, the eraser and the fill, and refuses the rest', () => {
    expect(BUILT_TOOLS.sort()).toEqual(['eraser', 'fill', 'flat']);
    expect(toolPass('eraser').composite).toBe('erase');
    expect(toolPass('flat').blend).toBe('max');
    for (const tool of TOOL_IDS.filter((id) => !BUILT_TOOLS.includes(id)))
      expect(() => toolPass(tool)).toThrow(RangeError);
  });
});
