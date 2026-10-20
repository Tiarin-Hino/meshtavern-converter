import { describe, expect, it } from 'vitest';
import { DEFAULT_BRUSH, type PaintStep } from '../pipeline/brush';
import {
  KEYFRAME_EVERY,
  PaintHistory,
  TEMPORARY,
  UNDO_STEPS,
  type HistoryBackend,
} from './history';

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
/** A lift stroke (#137) taking away step `lifts`: on the fake paint, that step's number goes. */
const lift = (lifts: number): PaintStep => ({
  kind: 'stroke',
  tool: 'lift',
  colour: '#000000',
  brush: DEFAULT_BRUSH,
  camera: {
    position: [0, 0, 1],
    target: [0, 0, 0],
    fovDeg: 40,
    near: 1,
    far: 10,
    viewport: [4, 4],
  },
  dabs: [0, 0, 0, 0.5],
  lifts,
});
const liftedBy = (s: PaintStep): number | undefined =>
  s.kind === 'stroke' && s.tool === 'lift' ? s.lifts : undefined;

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
    this.paint = applied(this, s);
    this.replays++;
  }
  drop(at: number): void {
    this.copies.delete(at);
  }
}

/** The fake paint after a step: its number added, or for a lift the lifted step's number taken away, from the paint before that step kept. */
function applied(fake: FakePaint, s: PaintStep): number[] {
  const lifted = liftedBy(s);
  if (lifted === undefined) return [...fake.paint, numberOf(s)];
  if (!fake.copies.has(lifted)) throw new Error(`No keyframe before step ${lifted}`);
  return fake.paint.filter((n) => n !== lifted);
}

/** A step applied live, then pushed, as the view does. */
function live(fake: FakePaint, history: PaintHistory, s: PaintStep): void {
  fake.paint = applied(fake, s);
  history.push(s);
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

  it('undoes every step back to the paint as opened, with at most seven keyframes (#165)', () => {
    const most = Math.ceil(UNDO_STEPS / KEYFRAME_EVERY) + 2;
    for (const n of [UNDO_STEPS + 5, 60, 64, 65, 120]) {
      const { paint, history } = painted(n);
      expect(history.undoable).toBe(n);
      expect(paint.copies.size).toBeLessThanOrEqual(most);
      let undone = 0;
      let slow = 0;
      for (let replays = history.undo(); replays !== null; replays = history.undo()) {
        undone++;
        expect(paint.paint).toEqual(upTo(n - undone));
        if (replays >= KEYFRAME_EVERY) slow++;
        expect(paint.copies.size).toBeLessThanOrEqual(most);
      }
      expect(undone).toBe(n);
      expect(history.record()).toEqual([]);
      // Within the window every undo is cheap; past it, the window moves back once a window.
      expect(slow).toBeLessThanOrEqual(Math.ceil(n / UNDO_STEPS));
      for (let k = 0; k < n; k++) expect(history.redo()).toBe(true);
      expect(paint.paint).toEqual(upTo(n));
      expect(paint.copies.size).toBeLessThanOrEqual(most);
    }
  });

  it('replays from the paint as opened once when undo passes the window, then from the window again (#165)', () => {
    const { paint, history } = painted(120);
    expect(history.oldest).toBe(70);
    for (let k = 0; k < 50; k++) history.undo();
    expect(history.applied).toBe(70);
    // Step 70 to 69: below the window, from the paint as opened.
    expect(history.undo()).toBe(69);
    expect(paint.paint).toEqual(upTo(69));
    expect(history.oldest).toBe(10);
    expect(history.kept).toEqual([0, 10, 20, 30, 40, 50, 60]);
    // The next undo is from the window's keyframe again.
    expect(history.undo()).toBe(8);
    expect(paint.paint).toEqual(upTo(68));
  });
});

describe('PaintHistory and the lift (#137)', () => {
  it('pins a keyframe of the paint before a step, and puts the paint back', () => {
    const { paint, history } = painted(25);
    paint.replays = 0;
    expect(history.pin(13)).toBe(true);
    expect(paint.copies.get(13)).toEqual(upTo(13));
    expect(paint.paint).toEqual(upTo(25));
    // From keyframe 10: three replays, and the paint kept aside is let go.
    expect(paint.replays).toBe(3);
    expect(paint.copies.has(TEMPORARY)).toBe(false);
    expect(history.kept).toEqual([0, 10, 13, 20]);
    // A pin on the schedule is the keyframe there.
    paint.replays = 0;
    expect(history.pin(20)).toBe(true);
    expect(paint.replays).toBe(0);
  });

  it('refuses a step older than the window: painted too long ago', () => {
    const { history } = painted(65);
    expect(history.oldest).toBe(10);
    expect(history.pin(9)).toBe(false);
    expect(history.pin(10)).toBe(true);
    // Only an applied step can be lifted: the paint before it is never the paint as it is.
    expect(history.pin(65)).toBe(false);
  });

  it('lets a pin go that no lift stroke took: cancelled, or nothing laid', () => {
    const { paint, history } = painted(25);
    history.pin(13);
    history.prune();
    expect(history.kept).toEqual([0, 10, 20]);
    expect(paint.copies.has(13)).toBe(false);
  });

  it('replays a lift from its pin when undo and redo go across it', () => {
    const { paint, history } = painted(25);
    history.pin(13);
    live(paint, history, lift(13));
    live(paint, history, step(26));
    const expected = [...upTo(13), ...upTo(25).slice(14), 26];
    expect(paint.paint).toEqual(expected);
    expect(history.kept).toEqual([0, 10, 13, 20]);
    // Back over the step after the lift: from keyframe 20, the lift replayed from its pin.
    expect(history.undo()).toBe(6);
    expect(paint.paint).toEqual(expected.slice(0, -1));
    expect(history.undo()).toBe(5);
    expect(paint.paint).toEqual(upTo(25));
    expect(history.redo()).toBe(true);
    expect(history.redo()).toBe(true);
    expect(paint.paint).toEqual(expected);
  });

  it('drops the pin with the lift step a new step replaces', () => {
    const { paint, history } = painted(25);
    history.pin(13);
    live(paint, history, lift(13));
    history.undo();
    // Undone, the lift may be redone: its pin stays.
    expect(paint.copies.has(13)).toBe(true);
    live(paint, history, step(25));
    expect(paint.copies.has(13)).toBe(false);
    expect(history.kept).toEqual([0, 10, 20]);
  });

  it('keeps a pin below the undo window while the lift that needs it can be undone', () => {
    const { paint, history } = painted(25);
    history.pin(13);
    live(paint, history, lift(13));
    for (let k = 26; k < 70; k++) live(paint, history, step(k));
    expect(history.oldest).toBe(20);
    expect(history.kept).toEqual([0, 13, 20, 30, 40, 50, 60, 70]);
    const expected = paint.paint.slice();
    for (let k = 0; k < 50; k++) history.undo();
    expect(paint.paint).toEqual(upTo(20));
    for (let k = 0; k < 50; k++) history.redo();
    expect(paint.paint).toEqual(expected);
    // The window passes the lift: the pin goes.
    for (let k = 70; k < 80; k++) live(paint, history, step(k));
    expect(history.oldest).toBe(30);
    expect(paint.copies.has(13)).toBe(false);
    expect(history.kept).toEqual([0, 30, 40, 50, 60, 70, 80]);
    // Undo past the window replays the lift again, from a keyframe made on the way (#165).
    const late = paint.paint.slice();
    let undone = 0;
    while (history.applied > 26) {
      history.undo();
      undone++;
    }
    expect(paint.paint).toEqual(upTo(25).filter((n) => n !== 13));
    expect(paint.paint).not.toContain(13);
    for (let k = 0; k < undone; k++) history.redo();
    expect(paint.paint).toEqual(late);
  });

  it('replays every step a paint file gives, and undoes through all of them (#165)', () => {
    // As `open` replays a file: each step applied, pushed, a lift pinned first.
    const paint = new FakePaint();
    const history = new PaintHistory(paint);
    const steps = [...upTo(30).map(step), lift(12), ...upTo(80).slice(31).map(step)];
    steps.forEach((s, k) => {
      const lifted = liftedBy(s);
      if (lifted !== undefined) expect(history.pin(lifted)).toBe(true);
      paint.paint = applied(paint, s);
      history.push(s);
      expect(history.applied).toBe(k + 1);
    });
    const end = paint.paint.slice();
    expect(end).not.toContain(12);
    while (history.undo() !== null);
    expect(paint.paint).toEqual([]);
    while (history.redo());
    expect(paint.paint).toEqual(end);
  });

  it('pins one keyframe for every lift of the same step', () => {
    const { paint, history } = painted(25);
    for (let k = 0; k < 3; k++) {
      expect(history.pin(13)).toBe(true);
      live(paint, history, lift(13));
    }
    expect(history.kept).toEqual([0, 10, 13, 20]);
    expect(history.record().map(liftedBy)).toEqual([...Array(25).fill(undefined), 13, 13, 13]);
  });
});
