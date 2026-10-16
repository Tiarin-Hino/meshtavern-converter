/**
 * The painting engine as a view other code mounts (issue #127, design note
 * `docs/design/painting-engine.md`): a person paints on a baked mini, and the strokes are written
 * into a PAINT_SIZE colour texture over its unwrap, drawn through the material of #125. The fifth
 * entry, beside index.ts (no three.js; it holds the strokes' data and the fill), three.ts, dev.ts
 * and questions.ts. Its stylesheet is ./painting.css (package export
 * `meshtavern-converter/painting.css`), imported once by the consumer, for the reason
 * questions.ts gives, after the theme's tokens.css (its cursor ring is the --accent role, #143).
 */
export {
  mountPainting,
  type PaintingOptions,
  type PaintingView,
  type PaintingState,
  type MiniToPaint,
  type PaintPerf,
  type LiftOutcome,
  type PickMode,
  PICK_MODE,
  BRUSH_MIN_MM,
  BRUSH_MAX_MM,
  BRUSH_DEPTH_MM,
  BRUSH_DEPTH_SOFT_MM,
  DABS_PER_PASS,
  DEPTH_BIAS_MM,
  FACING_MIN_COS,
  MASK_CUT,
  MASK_SHOWN,
  MASK_TINT,
  MASK_TINT_STRENGTH,
  PAINT_DILATION_RINGS,
  KEYFRAME_EVERY,
  UNDO_STEPS,
  CURSOR_MIN_PX,
  FRAME_BUDGET_MS,
} from './painting/mount';
export type { PaintSurface } from './painting/passes';
export { PAINT_COPY, type PaintCopy } from './painting/copy';
