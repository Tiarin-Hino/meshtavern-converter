import { describe, expect, it } from 'vitest';
import { DEFAULT_BRUSH, type PaintStep } from '../pipeline/brush';
import { KEYFRAME_EVERY, PaintHistory, UNDO_STEPS, type HistoryBackend } from './history';

/**
 * The history's schedule on a fake paint (design note §8): the paint is the list of step numbers
 * applied to it, a keyframe a copy of that list. What it pins: which keyframes exist after n steps,
 * how many replays an undo costs, what a new step after an undo drops, and that the paint after
 * undo and redo is the paint the steps make.
 */

const step = (n: number): PaintStep => ({
  kind: 'fill',
  tool: 'fill',
  colour: '#ffffff',
  brush: DEFAULT_BRUSH,
  seed: { kind: 'picked', triangle: n, point: [0, 0, 0] },
});
const numberOf = (s: PaintStep): number =>
  s.kind === 'fill' && s.seed.kind === 'picked' ? s.seed.triangle : -1;

class FakePaint implements HistoryBackend {
  paint: number[] = [];
  readonly copies = new Map<number, number[]>();
  replays = 0;
  snapshot(at: number): void {
    this.copies.set(at, [...this.paint]);
  }
  restore(at: number): void {
    this.paint = [...this.copies.get(at)!];
  }
  apply(s: PaintStep): void {
    this.paint.push(numberOf(s));
    this.replays++;
  }
  drop(at: number): void {
    this.copies.delete(at);
  }
}

const upTo = (n: number): number[] => Array.from({ length: n }, (_, k) => k);

/** A history with `n` steps applied live, as the view applies them. */
function painted(n: number): { paint: FakePaint; history: PaintHistory } {
  const paint = new FakePaint();
  const history = new PaintHistory(paint);
  for (let k = 0; k < n; k++) {
    paint.paint.push(k);
    history.push(step(k));
  }
  return { paint, history };
}

describe('PaintHistory', () => {
  it('keeps a keyframe of the paint as opened and one every KEYFRAME_EVERY steps', () => {
    const { paint, history } = painted(25);
    expect(history.kept).toEqual([0, 10, 20]);
    expect([...paint.copies.keys()].sort((a, b) => a - b)).toEqual([0, 10, 20]);
    expect(paint.copies.get(20)).toEqual(upTo(20));
  });

  it('undoes by replaying from the nearest keyframe, at most KEYFRAME_EVERY − 1 steps', () => {
    const { paint, history } = painted(25);
    expect(history.undo()).toBe(4);
    expect(paint.paint).toEqual(upTo(24));
    for (let k = 0; k < 4; k++) history.undo();
    expect(history.applied).toBe(20);
    // From step 20 to 19: back to keyframe 10, nine replays.
    expect(history.undo()).toBe(KEYFRAME_EVERY - 1);
    expect(paint.paint).toEqual(upTo(19));
  });

  it('redoes what was undone, and gives the same paint', () => {
    const { paint, history } = painted(13);
    for (let k = 0; k < 5; k++) history.undo();
    expect(history.undone).toBe(5);
    for (let k = 0; k < 5; k++) expect(history.redo()).toBe(true);
    expect(history.redo()).toBe(false);
    expect(paint.paint).toEqual(upTo(13));
    expect(history.kept).toEqual([0, 10]);
  });

  it('undoes back to the paint as opened, and no further', () => {
    const { paint, history } = painted(3);
    for (let k = 0; k < 3; k++) expect(history.undo()).not.toBeNull();
    expect(paint.paint).toEqual([]);
    expect(history.undo()).toBeNull();
    expect(history.applied).toBe(0);
  });

  it('drops the undone steps and their keyframes when a new step comes', () => {
    const { paint, history } = painted(23);
    for (let k = 0; k < 5; k++) history.undo();
    expect(history.applied).toBe(18);
    paint.paint.push(100);
    history.push(step(100));
    expect(history.undone).toBe(0);
    expect(history.kept).toEqual([0, 10]);
    expect(paint.copies.has(20)).toBe(false);
    expect(history.record().map(numberOf)).toEqual([...upTo(18), 100]);
  });

  it('keeps at least UNDO_STEPS steps to undo, and at most six keyframes', () => {
    for (const n of [UNDO_STEPS + 5, 60, 64, 65, 120]) {
      const { paint, history } = painted(n);
      expect(history.undoable).toBeGreaterThanOrEqual(UNDO_STEPS);
      expect(history.undoable).toBeLessThan(UNDO_STEPS + KEYFRAME_EVERY);
      expect(paint.copies.size).toBeLessThanOrEqual(Math.ceil(UNDO_STEPS / KEYFRAME_EVERY) + 1);
      let undone = 0;
      while (history.undo() !== null) undone++;
      expect(undone).toBe(history.undone);
      expect(paint.paint).toEqual(upTo(n - undone));
      // The record keeps every step applied, also those too far back to undo.
      expect(history.record().length).toBe(n - undone);
    }
  });
});
