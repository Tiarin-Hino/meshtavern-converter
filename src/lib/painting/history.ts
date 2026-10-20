import type { PaintStep } from '../pipeline/brush';

/**
 * Undo and redo (issue #127, design note `docs/design/painting-engine.md` §8): the steps applied, a
 * cursor, and keyframes of the paint, a copy after every KEYFRAME_EVERY steps and one of the paint
 * as opened. Undo goes back to the nearest keyframe at or before the step before and replays the
 * steps between, each exactly as it was applied; redo replays the next one. The paint itself lives
 * on the GPU: this is the schedule, over four operations a backend does, so Node can test it.
 *
 * A lift stroke (#137, design note `docs/design/lift-eraser.md` §6) needs the paint before the step
 * it takes away: `pin` keeps a keyframe there, off the schedule, for as long as a lift step in the
 * history points at it, so that undo and redo replay the lift from it.
 *
 * Undo reaches back through every step since the paint was opened, the steps a paint file replayed
 * at `open` included (#165): within the window of UNDO_STEPS an undo replays at most
 * KEYFRAME_EVERY − 1 steps; past it, the window moves back with the cursor, the paint as opened
 * (always kept) is restored and the steps up to the cursor replayed once, taking the window's
 * keyframes on the way. So the keyframes stay a window's, whatever the history's length.
 */

/** A keyframe of the paint after every this many steps (§8). _(proposal)_ */
export const KEYFRAME_EVERY = 10;
/**
 * Steps undone at most KEYFRAME_EVERY − 1 replays each (§8): the window the keyframes cover. Undo
 * reaches further, back to the paint as opened, replaying from it (#165). _(proposal)_
 */
export const UNDO_STEPS = 50;

/** What the history asks of the paint. `at` is a count of steps from the paint as opened. */
export interface HistoryBackend {
  /** Keeps a copy of the paint as it is now, after `at` steps (`TEMPORARY`: the paint while a pin is built). */
  snapshot(at: number): void;
  /** Makes the paint the copy kept after `at` steps. */
  restore(at: number): void;
  /** Applies a step to the paint, as it was applied the first time; `index` is its place in the history. */
  apply(step: PaintStep, index: number): void;
  /** Lets the copy kept after `at` steps go. */
  drop(at: number): void;
}

/** The key a backend keeps the paint under while `pin` replays to another step. */
export const TEMPORARY = -1;

/** The step a lift stroke takes away, or undefined for any other step. */
const liftedBy = (step: PaintStep): number | undefined =>
  step.kind === 'stroke' && step.tool === 'lift' ? step.lifts : undefined;

export class PaintHistory {
  private readonly steps: PaintStep[] = [];
  private cursor = 0;
  /** The step counts with a keyframe, ascending: the schedule's and the pinned ones. */
  private keyframes: number[] = [];
  /**
   * The window's oldest step count: a keyframe on the schedule (#137). Undo below it moves it back
   * (#165); a lift reaches no step below it.
   */
  private floor = 0;

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

  /** Steps undo can take back now: every one applied, back to the paint as opened (#165). */
  get undoable(): number {
    return this.cursor;
  }

  /** The oldest step count of the window: a lift may take away a step from there on (#137). */
  get oldest(): number {
    return this.floor;
  }

  /** The step counts that have a keyframe: for tests. */
  get kept(): readonly number[] {
    return this.keyframes;
  }

  /** The steps applied, oldest first: every one since the paint was opened. */
  record(): PaintStep[] {
    return this.steps.slice(0, this.cursor);
  }

  /**
   * A step was applied to the paint. Undone steps are dropped with their keyframes; a keyframe is
   * taken every `every` steps; the undo window moves on to the newest keyframe of the schedule
   * that still leaves `depth` steps to undo, and keyframes below it go unless a lift step that
   * undo may still replay needs one (#137).
   */
  push(step: PaintStep): void {
    if (this.cursor < this.steps.length) {
      this.steps.length = this.cursor;
      for (const at of this.keyframes) if (at > this.cursor) this.backend.drop(at);
      this.keyframes = this.keyframes.filter((at) => at <= this.cursor);
    }
    this.steps.push(step);
    this.cursor++;
    this.advance();
  }

  /**
   * Takes the last step back: the replays it took, or null when there was none to take. Below the
   * window, the window moves back to the cursor first (#165).
   */
  undo(): number | null {
    if (this.cursor === 0) return null;
    this.cursor--;
    if (this.cursor < this.floor) this.floor = this.windowFloor(this.cursor);
    const replays = this.replayTo(this.cursor);
    this.prune();
    return replays;
  }

  /** Puts the next undone step back: false when there was none. */
  redo(): boolean {
    if (this.undone === 0) return false;
    this.backend.apply(this.steps[this.cursor]!, this.cursor);
    this.cursor++;
    this.advance();
    return true;
  }

  /**
   * After a step was applied: a keyframe when the cursor is on the schedule, the window moved on
   * to the newest keyframe of the schedule that still leaves `depth` steps in it, and keyframes
   * below it let go unless a lift step that undo may still replay needs one (#137).
   */
  private advance(): void {
    this.keep();
    for (const at of this.keyframes)
      if (this.scheduled(at) && at > this.floor && this.cursor - at >= this.depth) this.floor = at;
    this.prune();
  }

  /** The window's oldest step count with the cursor at `at`, as `advance` moves it. */
  private windowFloor(at: number): number {
    return at < this.depth ? 0 : Math.floor((at - this.depth) / this.every) * this.every;
  }

  /**
   * Makes the paint the paint after `target` steps: the nearest keyframe restored, the steps up to
   * `target` replayed. On the way it takes the keyframes it lacks: the schedule's within the
   * window, and the paint before every step a lift on the way takes away, so that the lift replays
   * from it (below the window its pin may be gone, #165); it starts low enough to pass them all.
   * The replays it took.
   */
  private replayTo(target: number): number {
    let from = this.nearest(target);
    for (;;) {
      let lowest = from;
      for (let k = from; k < target; k++) {
        const lifted = liftedBy(this.steps[k]!);
        if (lifted !== undefined && lifted < lowest && !this.keyframes.includes(lifted))
          lowest = lifted;
      }
      if (lowest === from) break;
      from = this.nearest(lowest);
    }
    const needed = new Set<number>();
    for (let k = from; k < target; k++) {
      const lifted = liftedBy(this.steps[k]!);
      if (lifted !== undefined) needed.add(lifted);
    }
    this.backend.restore(from);
    for (let k = from; k < target; k++) {
      if (k > from && !this.keyframes.includes(k) && (this.inWindow(k) || needed.has(k)))
        this.add(k);
      this.backend.apply(this.steps[k]!, k);
    }
    return target - from;
  }

  /** On the schedule and within the window: a keyframe undo needs. */
  private inWindow(at: number): boolean {
    return this.scheduled(at) && at >= this.floor && at <= this.cursor;
  }

  /**
   * A keyframe of the paint after `at` steps, for a lift stroke starting now that takes away step
   * `at` (#137): false when undo no longer reaches there (painted too long ago), or `at` is no applied step. When none is kept
   * at `at`, it is made: the paint as it is kept aside, the nearest keyframe restored, the steps up
   * to `at` replayed, the keyframe taken, the paint put back. It stays while a lift step points at
   * it; until the stroke is pushed, `prune` lets it go.
   */
  pin(at: number): boolean {
    if (!Number.isInteger(at) || at < this.floor || at >= this.cursor) return false;
    if (this.keyframes.includes(at)) return true;
    this.backend.snapshot(TEMPORARY);
    this.replayTo(at);
    this.add(at);
    this.backend.restore(TEMPORARY);
    this.backend.drop(TEMPORARY);
    return true;
  }

  /**
   * Lets go of every keyframe nothing needs: off the schedule or outside the window (below it, or
   * past the cursor, where redo takes them again), and not the paint as opened (#165) or the one
   * a lift step from the window on (applied or undone) takes its paint from.
   */
  prune(): void {
    const pinned = new Set<number>();
    for (let k = this.floor; k < this.steps.length; k++) {
      const lifted = liftedBy(this.steps[k]!);
      if (lifted !== undefined) pinned.add(lifted);
    }
    const kept: number[] = [];
    for (const at of this.keyframes) {
      if (at === 0 || this.inWindow(at) || pinned.has(at)) kept.push(at);
      else this.backend.drop(at);
    }
    this.keyframes = kept;
  }

  /** Lets every keyframe go. */
  dispose(): void {
    for (const at of this.keyframes) this.backend.drop(at);
    this.keyframes = [];
  }

  /** On the schedule: the paint as opened and every `every` steps. */
  private scheduled(at: number): boolean {
    return at % this.every === 0;
  }

  /** The keyframe a replay to `at` starts from: the nearest kept at or before it; the paint as opened always is. */
  private nearest(at: number): number {
    let from = 0;
    for (const kept of this.keyframes) if (kept <= at) from = kept;
    return from;
  }

  /** A keyframe of the paint as it is now, at step count `at`. */
  private add(at: number): void {
    this.backend.snapshot(at);
    this.keyframes.push(at);
    this.keyframes.sort((a, b) => a - b);
  }

  /** A keyframe at the cursor when it falls on the schedule and has none. */
  private keep(): void {
    if (!this.scheduled(this.cursor) || this.keyframes.includes(this.cursor)) return;
    this.add(this.cursor);
  }
}
