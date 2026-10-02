import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, LOOK_PRESET_IDS, LOOK_PRESETS, parseHexColour, presetOf } from './look';

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
