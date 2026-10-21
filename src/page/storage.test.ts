import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOOK, paintFileOf } from '../lib';
import {
  isUnsaved,
  PALETTE_KEY,
  PALETTE_MAX,
  readPalette,
  readUnsaved,
  withColour,
  writePalette,
} from './storage';

describe('withColour (#167)', () => {
  it('puts the colour first, each colour once, in lower case', () => {
    expect(withColour(['#112233', '#445566'], '#445566')).toEqual(['#445566', '#112233']);
    expect(withColour(['#aabbcc'], '#AABBCC')).toEqual(['#aabbcc']);
    expect(withColour([], '#C03020')).toEqual(['#c03020']);
  });

  it('keeps at most PALETTE_MAX colours, the oldest dropped', () => {
    const full = Array.from(
      { length: PALETTE_MAX },
      (_, k) => `#0000${k.toString(16).padStart(2, '0')}`,
    );
    const next = withColour(full, '#ffffff');
    expect(next).toHaveLength(PALETTE_MAX);
    expect(next[0]).toBe('#ffffff');
    expect(next).not.toContain(full[PALETTE_MAX - 1]);
  });
});

describe('the unsaved record’s shape', () => {
  const file = paintFileOf({
    sources: [{ role: 'figure', bytes: 84, sha256: '0'.repeat(64) }],
    choices: { orientation: {} },
    look: DEFAULT_LOOK,
    steps: [],
  });

  it('takes a record of a paint file, its names and its day', () => {
    expect(isUnsaved({ file, names: ['hero.stl'], at: 1 })).toBe(true);
  });

  it('takes nothing else', () => {
    expect(isUnsaved(null)).toBe(false);
    expect(isUnsaved({ file, names: 'hero.stl', at: 1 })).toBe(false);
    expect(isUnsaved({ file: { steps: [] }, names: [], at: 1 })).toBe(false);
    expect(isUnsaved({ file, names: [], at: '1' })).toBe(false);
  });
});

describe('every read and write is guarded', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gives no palette and writes nothing where localStorage throws or is missing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    });
    expect(readPalette()).toEqual([]);
    expect(() => writePalette(['#ffffff'])).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(readPalette()).toEqual([]);
    expect(() => writePalette(['#ffffff'])).not.toThrow();
  });

  it('reads back what it wrote, and only hex colours', () => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
    });
    writePalette(['#c03020', '#2050a0']);
    expect(readPalette()).toEqual(['#c03020', '#2050a0']);
    items.set(PALETTE_KEY, JSON.stringify(['#c03020', 'red', 3, '#zzzzzz']));
    expect(readPalette()).toEqual(['#c03020']);
    items.set(PALETTE_KEY, '{not json');
    expect(readPalette()).toEqual([]);
  });

  it('gives no unsaved painting where IndexedDB is missing (Node has none)', async () => {
    expect(await readUnsaved()).toBeNull();
  });
});
