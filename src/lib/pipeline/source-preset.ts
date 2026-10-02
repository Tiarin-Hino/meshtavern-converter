import { UP_AXES, type OrientationOptions, type UpAxis } from './orient';
import type { SizingOptions, Units } from './size';
import { UNIT_FACTORS } from './units';

/**
 * Source presets (issue #100, design note `docs/design/source-presets.md`): what to take as given
 * about a file from a known export convention instead of guessing it. A preset lies under the
 * choices made by hand, field by field (§3), and its axis counts as a chosen one.
 */

/** A known export convention: what to take as given about a file instead of guessing it. */
export interface SourcePreset {
  /** Stable, lower-case, for the page's select and the records; the table may pass presets of its own, so this is a string. */
  id: string;
  /** What the person reads. Describes the convention, never names a product (design note §6). */
  label: string;
  units: Units;
  /** An extra factor on top of the units, for a tool whose unit is a multiple of one of ours (a centimetre tool: `mm` × 10). 1 for most. */
  scale: number;
  /** The file axis that is up in that tool. */
  up: UpAxis;
  /** Where the convention is from, in one sentence, for the PR and the README. Not shown on the page. */
  source: string;
}

/** The presets the page offers, in this order; the first entry of the select is "None (guess)". */
export const SOURCE_PRESETS: readonly SourcePreset[] = [
  {
    id: 'print-mm-z',
    label: 'Print file: millimetres, Z up',
    units: 'mm',
    scale: 1,
    up: '+z',
    source:
      'PrusaSlicer reads STL in millimetres ("The internal unit of PrusaSlicer is a millimeter", src/slic3r/GUI/Plater.cpp, 2.8.1) and Z is the height above its bed (the "Z offset" setting, src/libslic3r/PrintConfig.cpp).',
  },
  {
    id: 'scene-m-z',
    label: 'Scene units: metres, Z up',
    units: 'm',
    scale: 1,
    up: '+z',
    source:
      'Blender exports STL at Scale 1.0, Scene Unit off, Up Z (source/blender/editors/io/io_stl_ops.cc, 4.2.0), and a new scene is metric at unit scale 1, a metre per unit (source/blender/blenkernel/intern/scene.cc).',
  },
  {
    id: 'scene-m-y',
    label: 'Scene units: metres, Y up',
    units: 'm',
    scale: 1,
    up: '+y',
    source:
      'The glTF 2.0 specification, "Coordinate System and Units": "glTF defines +Y as up" and "The units for all linear distances are meters."',
  },
];

/** The preset with this id, or null. The page and the scripts resolve an id with it. */
export function findSourcePreset(id: string): SourcePreset | null {
  return SOURCE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** Checks a preset a consumer passes: units known, scale finite and > 0, up one of `UP_AXES`; throws a RangeError otherwise. */
export function checkSourcePreset(preset: SourcePreset): void {
  if (!Object.hasOwn(UNIT_FACTORS, preset.units))
    throw new RangeError(`Unknown units in source preset ${preset.id}: ${preset.units}`);
  if (!(preset.scale > 0 && Number.isFinite(preset.scale)))
    throw new RangeError(`Cannot scale by ${preset.scale} in source preset ${preset.id}`);
  if (!UP_AXES.includes(preset.up))
    throw new RangeError(`Unknown up axis in source preset ${preset.id}: ${preset.up}`);
}

/** The orientation under the preset: its axis where nothing is chosen by hand (an axis or a turn). */
export function orientationUnder(
  preset: SourcePreset | undefined,
  orientation: OrientationOptions,
): OrientationOptions {
  if (!preset || orientation.up !== undefined || orientation.rotation !== undefined)
    return orientation;
  return { ...orientation, up: preset.up };
}

/** The sizing under the preset: its units where none are chosen, its scale where neither a scale nor a base diameter is. */
export function sizingUnder(
  preset: SourcePreset | undefined,
  sizing: SizingOptions,
): SizingOptions {
  if (!preset) return sizing;
  const out = { ...sizing };
  out.units ??= preset.units;
  if (out.scale === undefined && out.scaleToBaseMm === undefined) out.scale = preset.scale;
  return out;
}

/**
 * Lays the preset under the choices: `up` where the orientation chooses nothing, `units` and
 * `scale` where the sizing says nothing. Returns new objects; the inputs are untouched.
 */
export function applyPreset(
  preset: SourcePreset,
  orientation: OrientationOptions,
  sizing: SizingOptions,
): { orientation: OrientationOptions; sizing: SizingOptions } {
  return {
    orientation: { ...orientationUnder(preset, orientation) },
    sizing: sizingUnder(preset, sizing),
  };
}

/** Whether two presets say the same, compared by value: an answer carries a copy. */
export function samePreset(a: SourcePreset | undefined, b: SourcePreset | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.id === b.id &&
    a.units === b.units &&
    Object.is(a.scale, b.scale) &&
    a.up === b.up &&
    a.label === b.label &&
    a.source === b.source
  );
}
