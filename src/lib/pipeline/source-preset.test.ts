import { describe, expect, it } from 'vitest';
import { UP_AXES } from './orient';
import {
  applyPreset,
  checkSourcePreset,
  findSourcePreset,
  SOURCE_PRESETS,
  type SourcePreset,
} from './source-preset';
import { UNIT_FACTORS } from './units';

const UNIT_WORDS = { mm: 'millimetres', in: 'inches', m: 'metres' } as const;
/** "+z" → "Z", "-y" → "-Y". */
const axisWord = (up: string): string => (up[0] === '-' ? '-' : '') + up.slice(1).toUpperCase();

describe('the source presets (#100)', () => {
  it('have unique lower-case ids, and a label and a source each', () => {
    expect(SOURCE_PRESETS.length).toBeGreaterThan(0);
    const ids = SOURCE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(SOURCE_PRESETS.map((preset) => preset.label)).size).toBe(ids.length);
    for (const preset of SOURCE_PRESETS) {
      expect(preset.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(preset.source.trim().length).toBeGreaterThan(20);
    }
  });

  // Each preset on its own line, so a new entry is tested by being added.
  describe.each(SOURCE_PRESETS.map((preset) => [preset.id, preset] as const))('%s', (_, preset) => {
    it('names the convention, never a product: "<kind>: <units>, <axis> up"', () => {
      const [kind, rest] = preset.label.split(': ');
      expect(kind).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
      expect(rest).toBe(`${UNIT_WORDS[preset.units]}, ${axisWord(preset.up)} up`);
    });

    it('has known units, a positive scale and one of the six axes', () => {
      expect(Object.keys(UNIT_FACTORS)).toContain(preset.units);
      expect(UP_AXES).toContain(preset.up);
      expect(Number.isFinite(preset.scale)).toBe(true);
      expect(preset.scale).toBeGreaterThan(0);
      expect(() => checkSourcePreset(preset)).not.toThrow();
    });

    it('is found by its id', () => {
      expect(findSourcePreset(preset.id)).toBe(preset);
    });

    it('fills what nothing chose, and leaves alone what something did, field by field', () => {
      const empty = applyPreset(preset, {}, {});
      expect(empty.orientation).toEqual({ up: preset.up });
      expect(empty.sizing).toEqual({ units: preset.units, scale: preset.scale });

      const other = preset.up === '+x' ? '-x' : '+x';
      const byHand = applyPreset(preset, { up: other, setDown: true }, { units: 'in', scale: 2 });
      expect(byHand.orientation).toEqual({ up: other, setDown: true });
      expect(byHand.sizing).toEqual({ units: 'in', scale: 2 });

      const turned = applyPreset(preset, { rotation: [0, 0, 0, 1] }, { scaleToBaseMm: 32 });
      expect(turned.orientation).toEqual({ rotation: [0, 0, 0, 1] });
      expect(turned.sizing).toEqual({ units: preset.units, scaleToBaseMm: 32 });

      // Only the units chosen: the preset's scale still applies; only Set down: its axis still does.
      expect(applyPreset(preset, { setDown: true }, { units: 'mm' })).toEqual({
        orientation: { setDown: true, up: preset.up },
        sizing: { units: 'mm', scale: preset.scale },
      });
    });
  });

  it('leaves its inputs untouched', () => {
    const preset = SOURCE_PRESETS[0]!;
    const orientation = {};
    const sizing = { size: 'large' as const };
    const applied = applyPreset(preset, orientation, sizing);
    expect(orientation).toEqual({});
    expect(sizing).toEqual({ size: 'large' });
    expect(applied.orientation).not.toBe(orientation);
    expect(applied.sizing).not.toBe(sizing);
  });

  it('finds nothing for an unknown id', () => {
    expect(findSourcePreset('none')).toBeNull();
    expect(findSourcePreset('')).toBeNull();
  });

  it('refuses a made-up unit, a scale that is not positive and an unknown axis', () => {
    const good: SourcePreset = {
      id: 'mine',
      label: 'Mine: millimetres, Z up',
      units: 'mm',
      scale: 1,
      up: '+z',
      source: 'A test.',
    };
    expect(() => checkSourcePreset(good)).not.toThrow();
    const bad = (change: object): SourcePreset => ({ ...good, ...change }) as SourcePreset;
    for (const change of [
      { units: 'cm' },
      { units: 'constructor' },
      { scale: 0 },
      { scale: -1 },
      { scale: Number.NaN },
      { scale: Number.POSITIVE_INFINITY },
      { up: 'up' },
      { up: 'z' },
    ])
      expect(() => checkSourcePreset(bad(change)), JSON.stringify(change)).toThrow(RangeError);
  });
});
