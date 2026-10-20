import type { BrushSettings, ToolId } from '../index';
import type { PaintCopy } from '../painting';

/**
 * The painter's panel's tables and the functions it writes its values with (#166, design note
 * `docs/design/painting-panel.md` §5 and §9): pure, no DOM, Node-tested in `controls.test.ts`.
 */

type Vec3 = [number, number, number];

/** The size slider's step, in mm. _(proposal)_ */
export const SIZE_STEP_MM = 0.5;
/** The step of the sliders from 0 to 1 (hardness, opacity, tolerance, the look's). _(proposal)_ */
export const UNIT_STEP = 0.05;

/**
 * The sliders each tool has (painting-engine.md §6), and what its opacity slider is called: the
 * panel shows only those. The group fill has none, and its section is hidden.
 */
export const SLIDERS: Record<
  ToolId,
  { show: (keyof BrushSettings)[]; opacity: keyof PaintCopy['sliders'] }
> = {
  flat: { show: ['sizeMm', 'hardness', 'opacity'], opacity: 'opacity' },
  eraser: { show: ['sizeMm', 'hardness', 'opacity'], opacity: 'opacity' },
  lift: { show: ['sizeMm', 'hardness', 'opacity'], opacity: 'opacity' },
  fill: { show: ['opacity', 'tolerance'], opacity: 'opacity' },
  wash: { show: ['sizeMm', 'opacity'], opacity: 'strength' },
  ink: { show: ['sizeMm', 'opacity'], opacity: 'flow' },
  dry: { show: ['sizeMm', 'opacity'], opacity: 'pressure' },
  airbrush: { show: ['sizeMm', 'opacity', 'direction'], opacity: 'flow' },
  mask: { show: ['sizeMm', 'hardness', 'opacity'], opacity: 'opacity' },
  unmask: { show: ['sizeMm', 'hardness', 'opacity'], opacity: 'opacity' },
  'mask-fill': { show: ['opacity', 'tolerance'], opacity: 'opacity' },
  'unmask-fill': { show: ['opacity', 'tolerance'], opacity: 'opacity' },
  group: { show: ['sizeMm', 'hardness'], opacity: 'opacity' },
  'group-fill': { show: [], opacity: 'opacity' },
};

/** The airbrush's directions: minis stand Y-up, and face +z at the camera's first angle. */
export const DIRECTIONS: Record<'none' | 'above' | 'front', Vec3 | null> = {
  none: null,
  above: [0, 1, 0],
  front: [0, 0, 1],
};

/** The entry of DIRECTIONS whose vector is `direction`, or null when none is. */
export function directionOf(direction: Vec3 | null): keyof typeof DIRECTIONS | null {
  for (const [name, value] of Object.entries(DIRECTIONS) as [
    keyof typeof DIRECTIONS,
    Vec3 | null,
  ][])
    if (value === null ? direction === null : direction?.every((v, k) => v === value[k]))
      return name;
  return null;
}

/**
 * The swatches in order (§5.4): the mini's colours as given (newest first, `recentColours`), then
 * the consumer's palette in its order; each lower-case and once, a palette colour already among
 * the mini's in the mini's place.
 */
export function panelSwatches(mini: readonly string[], palette: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const swatches: string[] = [];
  for (const colour of [...mini, ...palette]) {
    const hex = colour.trim().toLowerCase();
    if (seen.has(hex)) continue;
    seen.add(hex);
    swatches.push(hex);
  }
  return swatches;
}

/**
 * A slider's value as its label shows it (§5.3): the size in mm, whole or with one decimal ("4 mm",
 * "0.5 mm"), the 0 to 1 values as a whole percentage ("80 %", a thin space before the sign).
 */
export function sliderValue(
  key: keyof BrushSettings | 'occlusion' | 'wash' | 'edges',
  value: number,
  copy: Pick<PaintCopy['panel'], 'mm' | 'percent'>,
): string {
  if (key === 'sizeMm') {
    const mm = Math.round(value * 10) / 10;
    return `${Number.isInteger(mm) ? mm : mm.toFixed(1)} ${copy.mm}`;
  }
  return `${Math.round(value * 100)} ${copy.percent}`;
}
