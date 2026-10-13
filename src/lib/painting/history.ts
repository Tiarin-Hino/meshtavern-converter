import type { PaintStep } from '../pipeline/brush';

/**
 * Undo and redo (issue #127, design note `docs/design/painting-engine.md` §8): the steps applied, a
 * cursor, and keyframes of the paint, a copy after every KEYFRAME_EVERY steps and one of the paint
 * as opened. Undo goes back to the nearest keyframe at or before the step before and replays the
 * steps between, each exactly as it was applied; redo replays the next one. The paint itself lives
 * on the GPU: this is the schedule, over four operations a backend does, so Node can test it.
 */

/** A keyframe of the paint after every this many steps (§8). _(proposal)_ */
export const KEYFRAME_EVERY = 10;
/** Steps that can be undone, at least (§8). _(proposal)_ */
export const UNDO_STEPS = 50;

/** What the history asks of the paint. `at` is a count of steps from the paint as opened. */
export interface HistoryBackend {
  /** Keeps a copy of the paint as it is now, after `at` steps. */
  snapshot(at: number): void;
  /** Makes the paint the copy kept after `at` steps. */
  restore(at: number): void;
  /** Applies a step to the paint, as it was applied the first time. */
  apply(step: PaintStep): void;
  /** Lets the copy kept after `at` steps go. */
  drop(at: number): void;
}

export class PaintHistory {
  private readonly steps: PaintStep[] = [];
  private cursor = 0;
  /** The step counts with a keyframe, ascending. */
  private keyframes: number[] = [];

  constructor(
    private readonly backend: HistoryBackend,
    private readonly every = KEYFRAME_EVERY,
    private readonly depth = UNDO_STEPS,
  ) {
    backend.snapshot(0);
    this.keyframes.push(0);
  }

  /** Steps applied. */
  get applied(): number {
    return this.cursor;
  }

  /** Steps undone that redo can put back. */
  get undone(): number {
    return this.steps.length - this.cursor;
  }

  /** Steps undo can take back now: back to the oldest keyframe kept. */
  get undoable(): number {
    return this.cursor - this.keyframes[0]!;
  }

  /** The step counts that have a keyframe: for tests. */
  get kept(): readonly number[] {
    return this.keyframes;
  }

  /** The steps applied, oldest first: every one since the paint was opened, also those too far back to undo. */
  record(): PaintStep[] {
    return this.steps.slice(0, this.cursor);
  }

  /**
   * A step was applied to the paint. Undone steps are dropped with their keyframes; a keyframe is
   * taken every `every` steps; the oldest keyframe goes once the next one still leaves `depth`
   * steps to undo.
   */
  push(step: PaintStep): void {
    if (this.cursor < this.steps.length) {
      this.steps.length = this.cursor;
      for (const at of this.keyframes) if (at > this.cursor) this.backend.drop(at);
      this.keyframes = this.keyframes.filter((at) => at <= this.cursor);
    }
    this.steps.push(step);
    this.cursor++;
    this.keep();
    while (this.keyframes.length >= 2 && this.cursor - this.keyframes[1]! >= this.depth)
      this.backend.drop(this.keyframes.shift()!);
  }

  /** Takes the last step back: the replays it took, or null when there was none to take. */
  undo(): number | null {
    if (this.undoable === 0) return null;
    this.cursor--;
    let from = this.keyframes[0]!;
    for (const at of this.keyframes) if (at <= this.cursor) from = at;
    this.backend.restore(from);
    for (let k = from; k < this.cursor; k++) this.backend.apply(this.steps[k]!);
    return this.cursor - from;
  }

  /** Puts the next undone step back: false when there was none. */
  redo(): boolean {
    if (this.undone === 0) return false;
    this.backend.apply(this.steps[this.cursor]!);
    this.cursor++;
    this.keep();
    return true;
  }

  /** Lets every keyframe go. */
  dispose(): void {
    for (const at of this.keyframes) this.backend.drop(at);
    this.keyframes = [];
  }

  /** A keyframe at the cursor when it falls on the schedule and has none. */
  private keep(): void {
    if (this.cursor % this.every !== 0 || this.keyframes.includes(this.cursor)) return;
    this.backend.snapshot(this.cursor);
    this.keyframes.push(this.cursor);
    this.keyframes.sort((a, b) => a - b);
  }
}
