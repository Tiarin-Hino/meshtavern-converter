import { CONVERTER_VERSION } from '../version';
import {
  FILL_TOOL_IDS,
  TOOL_IDS,
  type BrushSettings,
  type FillSeed,
  type PaintStep,
  type StepGroups,
  type StrokeCamera,
} from './brush';
import type { Look } from './look';
import { figureFiles, type Pairing } from './pair';
import { ConversionProblem, PAINT_SOURCE_MESSAGES } from './problems';
import type { PipelineOptions, UpChoices } from './run';
import type { SizingOptions } from './size';

/**
 * The paint file (issue #165, design note `docs/design/painting-engine.md` §17): a painting saved
 * as what made it, not as its pixels. The converter's version, a fingerprint of each file the
 * mini was converted from, the conversion's choices, the look and the steps as the painting view
 * records them (`history()`). No geometry, no texture, no file names. It reopens an unfinished
 * painting (the files converted again with its choices, without a question, and the steps
 * replayed: `MiniToPaint.steps`), is refused for files it was not painted on, and replays the same
 * painting in the table application from the same files. Pure: no DOM, no three.js; JSON, gzip
 * above PAINT_FILE_GZIP_ABOVE.
 */

/** What the file's `format` says, so that another JSON file is told apart. */
export const PAINT_FILE_FORMAT = 'meshtavern-paint';
/**
 * The file's own shape. A new step kind or field bumps it (#165): a converter reads every version
 * up to its own, and refuses a newer one (`paint-file-newer`).
 */
export const PAINT_FILE_VERSION = 1;
/**
 * What the brushes do (#165, decision 13 of the application's spec 10): a change to a brush that
 * would give an old painting other bytes bumps it and keeps the old behaviour for steps painted on
 * an older engine (`PaintFile.engines`; the view's `engineOf`). A file painted on an older engine
 * replays with a warning in one line (`PAINT_COPY.olderEngine`); one on a newer engine is refused.
 */
export const PAINT_ENGINE_VERSION = 1;
/** The paint file's extension. _(proposal)_ */
export const PAINT_FILE_EXTENSION = '.mtpaint';
/** Its media type, for a download or a file picker. */
export const PAINT_FILE_TYPE = 'application/vnd.meshtavern.paint+json';
/** A paint file larger than this is written gzip-compressed. _(proposal)_ */
export const PAINT_FILE_GZIP_ABOVE = 1024 * 1024;
/** A paint file is never read beyond this, compressed or not: a long session is a few hundred KiB. _(proposal)_ */
export const PAINT_FILE_MAX_BYTES = 64 * 1024 * 1024;

/** What a file was to the mini (#165): its figure (the body, of a figure in parts), a part, or the base. */
export type SourceRole = 'figure' | 'part' | 'base';
export const SOURCE_ROLES: readonly SourceRole[] = ['figure', 'part', 'base'];

/** One file the mini was converted from, by its contents. _(proposal: SHA-256, size and role)_ */
export interface SourceFingerprint {
  role: SourceRole;
  /** Its size in bytes. */
  bytes: number;
  /** SHA-256 of its bytes, lower-case hex. */
  sha256: string;
}

/** Steps painted on one engine version, in the order of `steps` (#165). */
export interface EngineRun {
  engine: number;
  steps: number;
}

/**
 * The conversion's choices: `result.choices` (up and turn, the base and its stance, how the parts
 * go together, the placement and its marks, the preset, the kind) and the sizing (units, creature
 * size, scale to a base, a plain base) as the person chose them.
 */
export type PaintChoices = UpChoices & { sizing?: SizingOptions };

export interface PaintFile {
  format: typeof PAINT_FILE_FORMAT;
  version: number;
  /** The converter that wrote it (`CONVERTER_VERSION`): for people, never checked. */
  converter: string;
  /** The engine each step was painted on, oldest first; together they cover `steps`. */
  engines: EngineRun[];
  /** The files in the order the conversion takes them: the first, `secondStl`, then `moreStl`. */
  sources: SourceFingerprint[];
  choices: PaintChoices;
  look: Look;
  /** The steps as `history()` gives them, oldest first. */
  steps: PaintStep[];
}

/** What a consumer gives to make a paint file: the rest is this converter's. */
export interface PaintFileContents {
  sources: SourceFingerprint[];
  choices: PaintChoices;
  look: Look;
  steps: PaintStep[];
  /** The view's `engines()`; left out, every step is this engine's. */
  engines?: EngineRun[];
}

/** A paint file of this converter, from what the consumer has. */
export function paintFileOf(contents: PaintFileContents): PaintFile {
  const steps = contents.steps;
  return {
    format: PAINT_FILE_FORMAT,
    version: PAINT_FILE_VERSION,
    converter: CONVERTER_VERSION,
    engines: contents.engines ?? [{ engine: PAINT_ENGINE_VERSION, steps: steps.length }],
    sources: contents.sources,
    choices: contents.choices,
    look: contents.look,
    steps,
  };
}

/**
 * The paint file's bytes: JSON as UTF-8, gzip-compressed when larger than `gzipAbove`. The file is
 * checked as `readPaintFile` checks it, so a file this writes is one it reads.
 */
export async function writePaintFile(
  file: PaintFile | PaintFileContents,
  gzipAbove = PAINT_FILE_GZIP_ABOVE,
): Promise<Uint8Array> {
  const whole = 'format' in file ? file : paintFileOf(file);
  checkPaintFile(whole);
  const text = new TextEncoder().encode(JSON.stringify(whole));
  return text.length > gzipAbove ? gzip(text) : text;
}

/**
 * A paint file from its bytes, gzip-compressed or not. Refused with a `ConversionProblem`:
 * `not-a-paint-file` for anything that is not one of a version this converter knows,
 * `paint-file-newer` for one of a newer file version or engine.
 */
export async function readPaintFile(bytes: ArrayBuffer | Uint8Array): Promise<PaintFile> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length > PAINT_FILE_MAX_BYTES)
    throw new ConversionProblem('not-a-paint-file', `${view.length} bytes`);
  let text: string;
  let value: unknown;
  try {
    const plain = isGzip(view) ? await gunzip(view, PAINT_FILE_MAX_BYTES) : view;
    text = new TextDecoder('utf-8', { fatal: true }).decode(plain);
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof ConversionProblem) throw error;
    throw new ConversionProblem('not-a-paint-file', error instanceof Error ? error.message : '');
  }
  const record = value as Partial<PaintFile> | null;
  if (!isObject(record) || record.format !== PAINT_FILE_FORMAT)
    throw new ConversionProblem('not-a-paint-file', 'no paint file format');
  if (!isCount(record.version) || record.version < 1)
    throw new ConversionProblem('not-a-paint-file', 'no version');
  if (record.version > PAINT_FILE_VERSION)
    throw new ConversionProblem('paint-file-newer', `file version ${record.version}`);
  const file = record as PaintFile;
  checkPaintFile(file);
  const newest = Math.max(0, ...file.engines.map((run) => run.engine));
  if (newest > PAINT_ENGINE_VERSION)
    throw new ConversionProblem('paint-file-newer', `engine ${newest}`);
  return file;
}

/** Whether some steps of the file were painted on an older engine: the page says so in a line. */
export const paintedOnOlderEngine = (file: Pick<PaintFile, 'engines'>): boolean =>
  file.engines.some((run) => run.steps > 0 && run.engine < PAINT_ENGINE_VERSION);

/** The engine step `index` of a run list was painted on; this engine's past the runs. */
export function engineOf(runs: readonly EngineRun[], index: number): number {
  let end = 0;
  for (const run of runs) {
    end += run.steps;
    if (index < end) return run.engine;
  }
  return PAINT_ENGINE_VERSION;
}

/**
 * The fingerprint of one file. Take it before the file goes to the converter: `convert`
 * transfers its buffer to the worker.
 */
export async function fingerprintOf(
  stl: ArrayBuffer | Uint8Array,
  role: SourceRole,
): Promise<SourceFingerprint> {
  return { role, ...(await digestOf(stl)) };
}

/** A file's size and SHA-256: what a fingerprint holds besides the role. */
async function digestOf(stl: ArrayBuffer | Uint8Array): Promise<Omit<SourceFingerprint, 'role'>> {
  const view = stl instanceof Uint8Array ? stl : new Uint8Array(stl);
  const digest = await crypto.subtle.digest('SHA-256', view as Uint8Array<ArrayBuffer>);
  return { bytes: view.length, sha256: hex(new Uint8Array(digest)) };
}

/**
 * The role of each of a conversion's files, in the order it took them: one file is the figure;
 * of several, the base file is the base, the body the figure and the rest its parts.
 */
export function sourceRoles(pair: { pairing: Pairing } | null, files = 1): SourceRole[] {
  if (!pair) return Array.from({ length: files }, (_, k) => (k === 0 ? 'figure' : 'part'));
  const { pairing } = pair;
  const body = figureFiles(pairing)[0];
  return pairing.files.map((_, file) =>
    file === pairing.baseFile ? 'base' : file === body ? 'figure' : 'part',
  );
}

/** The fingerprints of a conversion's files, in its order, with the roles `sourceRoles` gives. */
export async function fingerprintSources(
  stls: readonly (ArrayBuffer | Uint8Array)[],
  roles: readonly SourceRole[],
): Promise<SourceFingerprint[]> {
  if (roles.length !== stls.length)
    throw new RangeError(`${stls.length} files and ${roles.length} roles`);
  return Promise.all(stls.map((stl, k) => fingerprintOf(stl, roles[k]!)));
}

/**
 * The files given, in the order the paint file names them: what `convert` takes (the first,
 * `secondStl`, then `moreStl`), so the choices' file indices mean what they meant. Refused with a
 * `ConversionProblem` (`paint-file-sources`) whose message says which file is missing or
 * different, by its role, or that one is not the mini's: check before anything converts.
 */
export async function matchSources<T extends ArrayBuffer | Uint8Array>(
  file: Pick<PaintFile, 'sources'>,
  stls: readonly T[],
): Promise<T[]> {
  const given = await Promise.all(stls.map(digestOf));
  const free = new Set(given.map((_, k) => k));
  const ordered: (T | undefined)[] = file.sources.map((source) => {
    for (const k of free)
      if (given[k]!.sha256 === source.sha256 && given[k]!.bytes === source.bytes) {
        free.delete(k);
        return stls[k]!;
      }
    return undefined;
  });
  // The file's figure first, then its parts, then its base: the sentence names the one that
  // matters most. A file left over in its place is different; with none, the named one is missing.
  const order = (role: SourceRole): number => SOURCE_ROLES.indexOf(role);
  const unmatched = file.sources
    .map((source, k) => ({ source, k }))
    .filter(({ k }) => ordered[k] === undefined)
    .sort((a, b) => order(a.source.role) - order(b.source.role));
  const first = unmatched[0];
  if (first) {
    const which = free.size > 0 ? 'different' : 'missing';
    throw new ConversionProblem(
      'paint-file-sources',
      `${which} ${first.source.role} (file ${first.k})`,
      PAINT_SOURCE_MESSAGES[which][first.source.role],
    );
  }
  if (free.size > 0)
    throw new ConversionProblem(
      'paint-file-sources',
      `${free.size} file(s) not named`,
      PAINT_SOURCE_MESSAGES.extra,
    );
  return ordered as T[];
}

/**
 * The options that convert the files again as the paint file says, without a question (#165): its
 * choices as `convert` takes them. The files come from `matchSources`.
 */
export function convertOptionsOf(
  file: Pick<PaintFile, 'choices'>,
): Pick<
  PipelineOptions,
  | 'orientation'
  | 'sizing'
  | 'kind'
  | 'preset'
  | 'parts'
  | 'pairing'
  | 'placement'
  | 'baseOrientation'
> {
  const choices = structuredClone(file.choices);
  return {
    orientation: choices.orientation,
    ...(choices.sizing && { sizing: choices.sizing }),
    ...(choices.kind && { kind: choices.kind }),
    ...(choices.preset && { preset: choices.preset }),
    ...(choices.parts && { parts: choices.parts }),
    ...(choices.pairing && { pairing: choices.pairing }),
    ...(choices.placement && { placement: choices.placement }),
    ...(choices.baseOrientation && { baseOrientation: choices.baseOrientation }),
  };
}

// The shape check: what a reader relies on. Choices are checked as an object only: the conversion
// checks its own options, and refuses what it cannot use.

/** Throws `not-a-paint-file` with what is wrong, for a value that is not a paint file of a known version. */
function checkPaintFile(file: PaintFile): void {
  const wrong = (what: string): never => {
    throw new ConversionProblem('not-a-paint-file', what);
  };
  if (typeof file.converter !== 'string') wrong('converter');
  if (!Array.isArray(file.engines)) wrong('engines');
  let covered = 0;
  for (const run of file.engines) {
    if (!isObject(run) || !isCount(run.engine) || run.engine < 1 || !isCount(run.steps))
      wrong('engine run');
    covered += run.steps;
  }
  if (!Array.isArray(file.sources) || file.sources.length === 0) wrong('sources');
  for (const source of file.sources)
    if (
      !isObject(source) ||
      !SOURCE_ROLES.includes(source.role) ||
      !isCount(source.bytes) ||
      typeof source.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(source.sha256)
    )
      wrong('source');
  if (file.sources.filter((source) => source.role === 'figure').length !== 1) wrong('figure');
  if (file.sources.filter((source) => source.role === 'base').length > 1) wrong('bases');
  if (!isObject(file.choices) || !isObject(file.choices.orientation)) wrong('choices');
  const look = file.look;
  if (
    !isObject(look) ||
    typeof look.enabled !== 'boolean' ||
    typeof look.base !== 'string' ||
    ![look.occlusion, look.wash, look.edges].every(isNumber)
  )
    wrong('look');
  if (!Array.isArray(file.steps)) wrong('steps');
  if (covered !== file.steps.length) wrong('engine runs do not cover the steps');
  file.steps.forEach((step, k) => {
    if (!isStep(step, k)) wrong(`step ${k}`);
  });
}

const STROKE_TOOLS: readonly string[] = TOOL_IDS.filter(
  (tool) => !(FILL_TOOL_IDS as readonly string[]).includes(tool),
);

/** Whether `step` is a step of a known kind with every field it needs; `index` is its place. */
function isStep(step: PaintStep, index: number): boolean {
  if (!isObject(step)) return false;
  if (step.kind === 'mask') return step.change === 'clear' || step.change === 'invert';
  if (typeof step.colour !== 'string' || !isBrush(step.brush)) return false;
  if (step.groups !== undefined && !isStepGroups(step.groups)) return false;
  if (step.into !== undefined && !isCount(step.into)) return false;
  if (step.kind === 'stroke')
    return (
      STROKE_TOOLS.includes(step.tool) &&
      isCamera(step.camera) &&
      Array.isArray(step.dabs) &&
      step.dabs.length % 4 === 0 &&
      step.dabs.every(isNumber) &&
      (step.lifts === undefined || (isCount(step.lifts) && step.lifts < index))
    );
  if (step.kind === 'fill')
    return (FILL_TOOL_IDS as readonly string[]).includes(step.tool) && isSeed(step.seed);
  return false;
}

function isBrush(brush: BrushSettings): boolean {
  return (
    isObject(brush) &&
    [brush.sizeMm, brush.hardness, brush.opacity, brush.tolerance].every(isNumber) &&
    (brush.direction === null || isVec3(brush.direction))
  );
}

function isCamera(camera: StrokeCamera): boolean {
  return (
    isObject(camera) &&
    isVec3(camera.position) &&
    isVec3(camera.target) &&
    [camera.fovDeg, camera.near, camera.far].every(isNumber) &&
    Array.isArray(camera.viewport) &&
    camera.viewport.length === 2 &&
    camera.viewport.every((side) => isCount(side) && side > 0)
  );
}

function isSeed(seed: FillSeed): boolean {
  if (!isObject(seed)) return false;
  switch (seed.kind) {
    case 'picked':
      return isCount(seed.triangle) && isVec3(seed.point);
    case 'group':
      return isCount(seed.group);
    case 'base':
    case 'figure':
      return true;
    default:
      return false;
  }
}

function isStepGroups(groups: StepGroups): boolean {
  return (
    isObject(groups) &&
    Array.isArray(groups.hidden) &&
    groups.hidden.every(isCount) &&
    Array.isArray(groups.apart) &&
    groups.apart.every((entry) => isObject(entry) && isCount(entry.group) && isVec3(entry.offset))
  );
}

const isObject = <T>(value: T): value is T & object =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isCount = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;
const isVec3 = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 3 && value.every(isNumber);

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** The two bytes every gzip stream starts with. */
const isGzip = (bytes: Uint8Array): boolean =>
  bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Gunzips, refusing to give more than `max` bytes. */
async function gunzip(bytes: Uint8Array, max: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      throw new ConversionProblem('not-a-paint-file', `more than ${max} bytes unpacked`);
    }
    chunks.push(value);
  }
  const plain = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    plain.set(chunk, at);
    at += chunk.length;
  }
  return plain;
}
