import { describe, expect, it } from 'vitest';
import { TOOL_IDS } from '../index';
import { PAINT_COPY } from '../painting';
import {
  DIRECTIONS,
  directionOf,
  panelSwatches,
  SIZE_STEP_MM,
  SLIDERS,
  sliderValue,
  UNIT_STEP,
} from './controls';

// The painter's panel's tables and value strings (#166, design note
// `docs/design/painting-panel.md` §5 and §9).

describe('SLIDERS', () => {
  it('has an entry for every tool, each opacity slider a word of the copy', () => {
    expect(Object.keys(SLIDERS).sort()).toEqual([...TOOL_IDS].sort());
    for (const { show, opacity } of Object.values(SLIDERS)) {
      expect(PAINT_COPY.sliders[opacity]).toBeTruthy();
      for (const key of show) expect(PAINT_COPY.sliders[key]).toBeTruthy();
    }
  });

  it('gives the hobby brushes their own word for opacity, and the group fill no slider', () => {
    expect(SLIDERS.wash.opacity).toBe('strength');
    expect(SLIDERS.dry.opacity).toBe('pressure');
    expect(SLIDERS.airbrush.show).toContain('direction');
    expect(SLIDERS['group-fill'].show).toEqual([]);
  });
});

describe('DIRECTIONS', () => {
  it('finds the entry of a direction, and none for another', () => {
    expect(directionOf(null)).toBe('none');
    expect(directionOf([0, 1, 0])).toBe('above');
    expect(directionOf([0, 0, 1])).toBe('front');
    expect(directionOf([1, 0, 0])).toBeNull();
    expect(DIRECTIONS.above).toEqual([0, 1, 0]);
  });
});

describe('panelSwatches', () => {
  it('puts the mini’s colours first, then the consumer’s not among them', () => {
    expect(panelSwatches(['#b03030', '#2050a0'], ['#20a050', '#B03030', '#ffffff'])).toEqual([
      '#b03030',
      '#2050a0',
      '#20a050',
      '#ffffff',
    ]);
  });

  it('lower-cases every colour and keeps each once', () => {
    expect(panelSwatches(['#ABCDEF'], [' #abcdef ', '#123456', '#123456'])).toEqual([
      '#abcdef',
      '#123456',
    ]);
    expect(panelSwatches([], [])).toEqual([]);
    expect(panelSwatches(['#000000'])).toEqual(['#000000']);
  });
});

describe('sliderValue', () => {
  const copy = PAINT_COPY.panel;

  it('writes the size in mm, whole or with one decimal', () => {
    expect(sliderValue('sizeMm', 4, copy)).toBe('4 mm');
    expect(sliderValue('sizeMm', 0.5, copy)).toBe('0.5 mm');
    expect(sliderValue('sizeMm', 2 + SIZE_STEP_MM, copy)).toBe('2.5 mm');
  });

  it('writes the 0 to 1 values as a whole percentage with a thin space', () => {
    expect(sliderValue('opacity', 0.8, copy)).toBe('80 %');
    expect(sliderValue('hardness', 1, copy)).toBe('100 %');
    expect(sliderValue('wash', UNIT_STEP * 3, copy)).toBe('15 %');
  });

  it('says the units it is given', () => {
    expect(sliderValue('sizeMm', 3, { mm: 'Millimeter', percent: 'Prozent' })).toBe('3 Millimeter');
    expect(sliderValue('tolerance', 0.5, { mm: 'mm', percent: 'pct' })).toBe('50 pct');
  });
});
