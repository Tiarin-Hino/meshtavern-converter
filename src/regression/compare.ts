/**
 * Compares measured figures with a recorded baseline and lists every change in words.
 * Counts, names and decisions must match exactly. Figures that come out of floating-point
 * sums or a compressor may drift by the share named here before they count as a change.
 */
export const RELATIVE_TOLERANCE: Readonly<Record<string, number>> = {
  errorMm: 0.01,
  sizeMm: 0.001,
  baseDiameterMm: 0.001,
  compactGlbBytes: 0.005,
  utilisation: 0.01,
  coverage: 0.01,
  fallback: 0.01,
};
/** Added to the relative tolerance, so that figures near zero can be compared at all. */
const ABSOLUTE_TOLERANCE = 1e-4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const show = (value: unknown): string =>
  typeof value === 'number' && !Number.isInteger(value)
    ? String(Number(value.toPrecision(5)))
    : JSON.stringify(value);

function describeChange(path: string, before: number, after: number): string {
  const percent =
    before === 0
      ? ''
      : ` (${after > before ? '+' : ''}${(((after - before) / Math.abs(before)) * 100).toFixed(1)} %)`;
  return `${path}: ${show(before)} → ${show(after)}${percent}`;
}

function walk(path: string, key: string, before: unknown, after: unknown, out: string[]): void {
  if (before === undefined) return void out.push(`${path}: new, ${show(after)}`);
  if (after === undefined) return void out.push(`${path}: gone, was ${show(before)}`);
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      walk(`${path}[${i}]`, key, before[i], after[i], out);
    }
  } else if (isRecord(before) && isRecord(after)) {
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      walk(path ? `${path}.${name}` : name, name, before[name], after[name], out);
    }
  } else if (typeof before === 'number' && typeof after === 'number') {
    const allowed =
      key in RELATIVE_TOLERANCE
        ? RELATIVE_TOLERANCE[key]! * Math.max(Math.abs(before), Math.abs(after)) +
          ABSOLUTE_TOLERANCE
        : 0;
    if (!(Math.abs(after - before) <= allowed)) out.push(describeChange(path, before, after));
  } else if (before !== after) {
    out.push(`${path}: ${show(before)} → ${show(after)}`);
  }
}

/** One line per figure that changed, appeared or disappeared; empty when nothing did. */
export function compareFigures(baseline: unknown, current: unknown): string[] {
  const changes: string[] = [];
  walk('', '', baseline, current, changes);
  return changes;
}
