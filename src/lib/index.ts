/**
 * The converter as a library: what the table application's "add a mini" flow imports, and
 * what this page imports (issue #50). Re-exports only, free of three.js and the DOM; the
 * list is pinned by index.test.ts, so the API grows in a visible diff. Drawing a baked mini
 * with three.js: ./three.ts. Tests and tooling: ./dev.ts.
 */

// The converter: a worker that converts one STL at a time.
export { Converter, ConversionCancelled, type WorkerLike } from './worker/client';
export type { ConvertOptions } from './worker/protocol';
export {
  BAKED_LEVEL,
  STEPS,
  BAKE_STEPS,
  type ConversionResult,
  type ConversionStats,
  type Baked,
  type BakeFigures,
  type BakeSkipped,
  type Progress,
  type StepName,
  type StepTiming,
  type LodStats,
  type UpChoices,
} from './pipeline/run';
// The questions asked on the full-detail meshes before anything is reduced: which way is up
// (issue #92), how a figure's parts go together and where it meets its base (issue #93).
export type {
  Answer,
  AskUp,
  AskOptions,
  AskedUp,
  Box,
  MeetAction,
  MeetAnswer,
  MeetQuestion,
  Question,
  Shown,
  ShownPatch,
  Target,
  UpAnswer,
  UpQuestion,
  UpReason,
  UpRole,
} from './pipeline/ask';
// A figure in several files, and the pairs of patches where its parts meet (issue #93).
export {
  MAX_PARTS,
  type PairSummary,
  type PartResult,
  type PartsOptions,
} from './pipeline/assemble';
export type { Fit } from './pipeline/fit';
export {
  MAX_PAIRS,
  MAX_STROKES,
  pairsAllowed,
  type Hit,
  type Meeting,
  type MeetNote,
  type PartJoint,
  type PatchPair,
  type PatchPick,
  type PatchSummary,
  type Stroke,
} from './pipeline/marks';
// Why a file did not become a mini, with the sentence the user reads.
export {
  ConversionProblem,
  PROBLEM_MESSAGES,
  toProblem,
  type ProblemCode,
} from './pipeline/problems';
// Refusing a file before all of it is read: what the page does in its drop handler.
export { readStlFile, readStlFiles } from './read-file';
export { SNIFF_BYTES, sniffStl, type StlFormat } from './pipeline/stl';
export { checkFits, memoryBudgetBytes, estimateConversionBytes } from './pipeline/memory';
// The mesh the levels are made of.
export type { IndexedMesh } from './pipeline/mesh';
export type { Lod, LodSpec } from './pipeline/simplify';
export { LOD_SPECS } from './pipeline/simplify';
// Orientation: the detection's result and the user's correction (issue #72).
export { UP_AXES, type UpAxis, type Orientation, type OrientationOptions } from './pipeline/orient';
export {
  fromAxisAngle,
  IDENTITY,
  multiply,
  turnAngleDeg,
  type Rotation,
} from './pipeline/rotation';
// A figure with its base file: which is the base and where the figure was set (issue #70).
export type { Pairing, PairingOptions, PairWarning } from './pipeline/pair';
export type {
  MarkedMeeting,
  Placement,
  PlacementOptions,
  Spot,
  SpotKind,
  PairResult,
} from './pipeline/place';
// Size: units, creature size, base, footprint (issue #44).
export {
  CREATURE_SIZES,
  GRID_SQUARE_MM,
  SIZES,
  sizeLabel,
  footprintMm,
  type CreatureSize,
  type FootprintSquares,
  type Sizing,
  type SizingOptions,
  type SizingWarning,
  type Units,
  type BaseMeasurement,
} from './pipeline/size';
export { UNIT_FACTORS } from './pipeline/units';
// Character or prop: guessed from the base, or chosen (issue #99).
export {
  DISC_HEIGHT_MAX_MM,
  TOP_CONE_DEG,
  TOP_SHARE,
  type KindGuess,
  type MiniKind,
} from './pipeline/kind';
// Source presets: units, scale and up axis of a known export convention (issue #100).
export { SOURCE_PRESETS, findSourcePreset, type SourcePreset } from './pipeline/source-preset';
// The look: applied when drawing and exporting, never inside the conversion.
export {
  DEFAULT_LOOK,
  LOOK_PRESETS,
  presetOf,
  vertexColours,
  type Look,
  type LookPreset,
  type LookPresetId,
} from './pipeline/look';
// The detail texture.
export type { BakedMaps } from './pipeline/bake';
export { readKtx2Header, type Ktx2Header } from './pipeline/compress';
// Export.
export { encodeGlb, glbEncoderReady, type GlbOptions } from './pipeline/glb';
