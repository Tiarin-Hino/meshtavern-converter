import { describe, expect, it } from 'vitest';
import {
  BORDER_TEXEL,
  DEFAULT_BRUSH,
  GUTTER_TEXEL,
  ISLAND_TEXEL,
  NO_OWNER,
  ownerMap,
  RECENT_COLOURS_MAX,
  recentColours,
  spaceDabs,
  TOOL_IDS,
  toolMask,
  unitDirection,
  type BrushSettings,
  type DabHit,
  type PaintStep,
  type ToolId,
} from './brush';
import {
  DRY_REFERENCE_MIN,
  DRY_SOFTNESS,
  DRY_THRESHOLD,
  FLAT_CAVITY,
  INK_FLAT,
  WASH_FLAT,
  WASH_LIFT,
} from './look';

const hit = (x: number, y = 0, z = 0, pressure = 0.5): DabHit => ({ point: [x, y, z], pressure });

/** The dabs' points, three numbers each, from four numbers a dab. */
const points = (dabs: number[]): [number, number, number][] =>
  Array.from({ length: dabs.length / 4 }, (_, k) => [
    dabs[k * 4]!,
    dabs[k * 4 + 1]!,
    dabs[k * 4 + 2]!,
  ]);

describe('spaceDabs', () => {
  it('lays one dab for one hit', () => {
    expect(spaceDabs([hit(1, 2, 3, 0.7)], 0.5)).toEqual([1, 2, 3, 0.7]);
  });

  it('lays dabs no further apart than the spacing, the first at the start', () => {
    // A path of 10 mm at a 2 mm brush: dabs every 0.5 mm at most.
    const spacing = 2 * 0.25;
    const path = [hit(0), hit(3), hit(3, 4), hit(3, 4, 3)];
    const dabs = points(spaceDabs(path, spacing));
    expect(dabs[0]).toEqual([0, 0, 0]);
    expect(dabs.at(-1)).toEqual([3, 4, 3]);
    for (let k = 1; k < dabs.length; k++) {
      const [ax, ay, az] = dabs[k - 1]!;
      const [bx, by, bz] = dabs[k]!;
      expect(Math.hypot(bx - ax, by - ay, bz - az)).toBeLessThanOrEqual(spacing + 1e-9);
    }
    // 3 + 4 + 3 mm at 0.5: 6 + 8 + 6 dabs after the first.
    expect(dabs.length).toBe(21);
  });

  it('lays nothing across a lift between two runs', () => {
    const dabs = points(spaceDabs([hit(0), hit(1), null, hit(5), hit(6)], 0.5));
    // 0, 0.5, 1 | 5, 5.5, 6: no dab between 1 and 5.
    expect(dabs.map(([x]) => x)).toEqual([0, 0.5, 1, 5, 5.5, 6]);
  });

  it('interpolates the pressure and continues a stroke from its last dab', () => {
    const dabs = spaceDabs([hit(1, 0, 0, 1)], 0.5, [0, 0, 0, 0]);
    expect(dabs).toEqual([0.5, 0, 0, 0.5, 1, 0, 0, 1]);
    // Whole or in two pieces: the same dabs.
    const whole = spaceDabs([hit(0), hit(2), hit(2, 3)], 0.4);
    const first = spaceDabs([hit(0), hit(2)], 0.4);
    const rest = spaceDabs([hit(2, 3)], 0.4, first.slice(-4));
    expect([...first, ...rest]).toEqual(whole);
  });

  it('lays even dabs exactly a spacing apart, however densely the pointer reports (#128)', () => {
    // A pointer that reports every 0.05 mm along 3 mm, at a 0.5 mm spacing: the dabs fall at
    // whole spacings from the first, not at the samples.
    const dense = Array.from({ length: 61 }, (_, k) => hit(k * 0.05));
    const xs = points(spaceDabs(dense, 0.5, null, true)).map(([x]) => x);
    expect(xs).toHaveLength(7);
    xs.forEach((x, k) => expect(x).toBeCloseTo(k * 0.5, 9));
    // The same path sampled sparsely: the same dabs.
    const sparse = [hit(0), hit(1.2), hit(3)];
    points(spaceDabs(sparse, 0.5, null, true)).forEach(([x], k) =>
      expect(x).toBeCloseTo(k * 0.5, 9),
    );
    // Nearer than a spacing: nothing yet; the pieces of a stroke lay what it would whole.
    expect(spaceDabs([hit(0.3)], 0.5, [0, 0, 0, 0.5], true)).toEqual([]);
    const whole = spaceDabs([hit(0), hit(0.3), hit(0.9), hit(2)], 0.5, null, true);
    const first = spaceDabs([hit(0), hit(0.3)], 0.5, null, true);
    const rest = spaceDabs([hit(0.9), hit(2)], 0.5, first.slice(-4), true);
    expect([...first, ...rest]).toEqual(whole);
    // A lift starts a new run at the next hit.
    expect(points(spaceDabs([hit(0), null, hit(0.2)], 0.5, null, true))).toEqual([
      [0, 0, 0],
      [0.2, 0, 0],
    ]);
  });

  it('refuses a spacing that is not positive', () => {
    expect(() => spaceDabs([hit(0)], 0)).toThrow(RangeError);
  });
});

describe('ownerMap', () => {
  const SIZE = 16;
  /**
   * Columns of a 16-texel square: islands of two texels with a border texel on each side, and
   * gutters of 1, 3 and 6 texels between them. I = island, B = border, . = gutter.
   */
  const ROW = 'IIB.BIIB...BIIB......BII'.slice(0, SIZE);
  const mask = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++)
      mask[y * SIZE + x] =
        ROW[x] === 'I' ? ISLAND_TEXEL : ROW[x] === 'B' ? BORDER_TEXEL : GUTTER_TEXEL;
  const owner = ownerMap(mask, SIZE, 2);
  const column = (x: number): number[] =>
    Array.from({ length: SIZE }, (_, y) => owner[y * SIZE + x]!);
  const ownerColumns = (x: number): number[] => [
    ...new Set(column(x).map((o) => (o < 0 ? o : o % SIZE))),
  ];

  it('gives every island and border texel itself', () => {
    for (let x = 0; x < SIZE; x++)
      if (ROW[x] !== '.')
        expect(column(x)).toEqual(Array.from({ length: SIZE }, (_, y) => y * SIZE + x));
  });

  it('gives each gutter texel the nearer island’s border texel, on its own row', () => {
    // A gutter of 1 (column 3): either side's border, both as near.
    expect([2, 4]).toContain(ownerColumns(3)[0]);
    // A gutter of 3 (columns 8–10): ring 1 on each side, ring 2 in the middle from a ring-1 owner.
    expect(ownerColumns(8)).toEqual([7]);
    expect(ownerColumns(10)).toEqual([11]);
    expect([7, 11]).toContain(ownerColumns(9)[0]);
    // The last column: ring 1 of the border at column 14.
    expect(ownerColumns(15)).toEqual([14]);
    // Every owner lies on the texel's own row: the rows are alike, so the four sides never cross them.
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) expect(Math.floor(owner[y * SIZE + x]! / SIZE)).toBe(y);
  });

  it('points no texel at a gutter texel, and none beyond two rings anywhere', () => {
    for (let texel = 0; texel < owner.length; texel++) {
      const o = owner[texel]!;
      if (o === NO_OWNER) continue;
      expect(mask[o]).not.toBe(GUTTER_TEXEL);
    }
    // A wider gutter: 6 texels between two islands, rows alike. Rings 1 and 2 from each side, the
    // middle two point nowhere.
    const wide = 'IB......BI';
    const size = wide.length;
    const wideMask = new Uint8Array(size * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        wideMask[y * size + x] =
          wide[x] === 'I' ? ISLAND_TEXEL : wide[x] === 'B' ? BORDER_TEXEL : GUTTER_TEXEL;
    const wideOwner = ownerMap(wideMask, size, 2);
    expect(Array.from(wideOwner.subarray(0, size))).toEqual([
      0,
      1,
      1,
      1,
      NO_OWNER,
      NO_OWNER,
      8,
      8,
      8,
      9,
    ]);
  });

  it('takes an island’s own texel before a border texel in ring 1', () => {
    // A gutter texel between a border texel (left) and an island texel (right).
    const m = new Uint8Array([BORDER_TEXEL, GUTTER_TEXEL, ISLAND_TEXEL, 0, 0, 0, 0, 0, 0]);
    expect(ownerMap(m, 3, 1)[1]).toBe(2);
  });

  it('refuses a mask of the wrong size', () => {
    expect(() => ownerMap(new Uint8Array(10), 4, 2)).toThrow(RangeError);
  });
});

describe('toolMask', () => {
  it('paints every texel with the flat brush, the eraser, the lift and the fill', () => {
    for (const tool of ['flat', 'eraser', 'lift', 'fill'] as const)
      for (const cavity of [-1, 0, 1])
        expect(toolMask(tool, cavity, 0.3, [0, 1, 0], DEFAULT_BRUSH)).toBe(1);
  });

  // The hobby brushes (#128, design note §6), one test per line of the issue.
  const brush = (changes: Partial<BrushSettings> = {}): BrushSettings => ({
    ...DEFAULT_BRUSH,
    ...changes,
  });
  const UP: [number, number, number] = [0, 1, 0];

  it('pools a wash in the creases and buried places, tints flat faintly and evenly, nearly leaves an edge', () => {
    const wash = (cavity: number, occlusion: number): number =>
      toolMask('wash', cavity, occlusion, UP, DEFAULT_BRUSH);
    // A flat, open surface: the faint tint, the same everywhere on it.
    expect(wash(0, 1)).toBeCloseTo(WASH_FLAT, 10);
    // A crease takes all of it; a buried place more than the open one.
    expect(wash(-1, 1)).toBe(1);
    expect(wash(0, 0)).toBeGreaterThan(wash(0, 1));
    expect(wash(-0.5, 1)).toBeGreaterThan(wash(0, 1));
    // A raised, open edge: under a tenth of what the crease takes.
    expect(wash(1, 1)).toBeLessThan(0.1 * wash(-1, 1));
    expect(wash(1, 1)).toBeCloseTo(WASH_FLAT * (1 - WASH_LIFT), 10);
  });

  it('stains the whole stroke with ink, the creases most', () => {
    const ink = (cavity: number): number => toolMask('ink', cavity, 1, UP, DEFAULT_BRUSH);
    for (const cavity of [-1, -0.5, 0, 0.5, 1])
      expect(ink(cavity)).toBeGreaterThanOrEqual(INK_FLAT);
    expect(ink(1)).toBe(INK_FLAT);
    expect(ink(-1)).toBe(1);
    expect(ink(-0.5)).toBeGreaterThan(ink(0));
  });

  // The dry brush relative to its stroke's reference (#133, design note `dry-brush-crests.md` §4).
  const dry = (cavity: number, pressure: number, reference = 1): number =>
    toolMask('dry', cavity, 1, UP, brush({ opacity: pressure }), reference);
  const PRESSURES = [0, 0.25, 0.5, 0.75, 1];
  const REFERENCES = [-1, -0.2, 0, FLAT_CAVITY, 0.03, 0.067, 0.11, 0.3, 0.6, 1];

  it('dry-brushes nothing flat or below, whatever the reference and the pressure', () => {
    for (const reference of REFERENCES)
      for (const pressure of PRESSURES)
        for (const cavity of [-1, -0.3, 0, FLAT_CAVITY])
          expect(dry(cavity, pressure, reference)).toBe(0);
    expect(FLAT_CAVITY).toBeCloseTo(2 / 255, 12);
  });

  it('dry-brushes the reference’s own height fully at every pressure', () => {
    for (const reference of [FLAT_CAVITY + DRY_REFERENCE_MIN, 0.3, 0.6, 1])
      for (const pressure of PRESSURES) expect(dry(reference, pressure, reference)).toBe(1);
    // Anything higher along the stroke too.
    expect(dry(0.9, 0, 0.3)).toBe(1);
  });

  it('reaches further down from the reference with more pressure, never taking less', () => {
    for (const reference of [0.067, 0.3, 1]) {
      // The lowest cavity that takes any paint, along the stroke and under its first dab.
      const lowest = PRESSURES.map((pressure) => {
        for (let k = 0; k <= 2000; k++) if (dry(-1 + k / 1000, pressure, reference) > 0) return k;
        return Infinity;
      });
      for (let k = 1; k < lowest.length; k++) expect(lowest[k]).toBeLessThan(lowest[k - 1]!);
      for (let cavity = -1; cavity <= 1; cavity += 0.01)
        for (let k = 1; k < PRESSURES.length; k++)
          expect(dry(cavity, PRESSURES[k]!, reference)).toBeGreaterThanOrEqual(
            dry(cavity, PRESSURES[k - 1]!, reference),
          );
    }
  });

  it('catches the crest of low detail where an absolute threshold leaves it bare', () => {
    // The ridged block of the e2e test: crests at 0.067, four of the texture's steps above flat,
    // under the floor. An absolute threshold gives them nothing below about 0.87 of the pressure,
    // and a faint quarter coat at full.
    const crest = 0.067;
    for (const pressure of [0.5, 0.75]) expect(dry(crest, pressure, 1)).toBe(0);
    expect(dry(crest, 1, 1)).toBeLessThan(0.3);
    // From half the pressure up they take paint, a full coat at full pressure.
    expect(dry(crest, 0.5, crest)).toBeGreaterThan(0);
    expect(dry(crest, 0.75, crest)).toBeGreaterThan(0.5);
    expect(dry(crest, 1, crest)).toBe(1);
    // Half their height takes nothing at half pressure, most of a coat at full.
    expect(dry(FLAT_CAVITY + (crest - FLAT_CAVITY) / 2, 0.5, crest)).toBe(0);
    expect(dry(FLAT_CAVITY + (crest - FLAT_CAVITY) / 2, 1, crest)).toBeGreaterThan(0.5);
  });

  it('takes a reference under DRY_REFERENCE_MIN above flat as that floor', () => {
    const floor = FLAT_CAVITY + DRY_REFERENCE_MIN;
    for (const reference of [-1, 0, FLAT_CAVITY, 0.03, floor])
      for (const pressure of PRESSURES)
        for (let cavity = -0.2; cavity <= 0.3; cavity += 0.01)
          expect(dry(cavity, pressure, reference)).toBe(dry(cavity, pressure, floor));
    // One step of the texture above flat, under a flat footprint: nothing below five sixths of the pressure.
    expect(dry(FLAT_CAVITY + 4 / 255, 0.8, 0.02)).toBe(0);
    expect(dry(FLAT_CAVITY + 4 / 255, 1, 0.02)).toBeGreaterThan(0);
  });

  it('dry-brushes as before #133 when a fully raised texel is under the first dab', () => {
    // The old threshold and softness, measured from flat and over the height from flat to 1.
    const at = (share: number): number => FLAT_CAVITY + share * (1 - FLAT_CAVITY);
    for (const pressure of PRESSURES) {
      const threshold = DRY_THRESHOLD * (1 - pressure);
      expect(dry(at(threshold), pressure)).toBe(0);
      expect(dry(at(threshold + DRY_SOFTNESS), pressure)).toBeCloseTo(1, 12);
    }
    expect(dry(0.1, 1)).toBeGreaterThan(0);
    expect(dry(0.1, 0)).toBe(0);
  });

  it('airbrushes everything without a direction, and from above nothing that faces down', () => {
    const air = (normal: [number, number, number], direction: [number, number, number] | null) =>
      toolMask('airbrush', 0, 1, normal, brush({ direction }));
    expect(air([0, -1, 0], null)).toBe(1);
    expect(air([0, 1, 0], UP)).toBe(1);
    // Facing down, or sideways: nothing.
    for (const normal of [
      [0, -1, 0],
      [0.6, -0.8, 0],
      [1, 0, 0],
      [0, 0, -1],
    ] as [number, number, number][])
      expect(air(normal, UP)).toBe(0);
    // A normal as the detail texture stores it, not quite of unit length: the angle decides.
    expect(air([0, 0.5, 0], UP)).toBe(1);
    expect(air([0.98, 0.2, 0], UP)).toBeGreaterThan(air([0.995, 0.1, 0], UP));
    expect(air([0.995, 0.1, 0], UP)).toBeGreaterThan(0);
  });

  it('keeps every mask within 0 and 1', () => {
    for (const tool of TOOL_IDS)
      for (const cavity of [-1, -0.4, 0, 0.4, 1])
        for (const occlusion of [0, 0.5, 1])
          for (const opacity of [0, 0.5, 1]) {
            const mask = toolMask(
              tool,
              cavity,
              occlusion,
              [0.3, 0.9, 0.1],
              brush({ opacity, direction: UP }),
            );
            expect(mask).toBeGreaterThanOrEqual(0);
            expect(mask).toBeLessThanOrEqual(1);
          }
  });
});

describe('unitDirection', () => {
  it('scales a direction to unit length, and gives none for a zero vector or none', () => {
    expect(unitDirection([0, 2, 0])).toEqual([0, 1, 0]);
    expect(unitDirection([3, 4, 0])).toEqual([0.6, 0.8, 0]);
    expect(unitDirection([0, 0, 0])).toBeNull();
    expect(unitDirection([Number.NaN, 1, 0])).toBeNull();
    expect(unitDirection(null)).toBeNull();
  });
});

describe('recentColours', () => {
  const camera = {
    position: [0, 0, 100] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
    fovDeg: 40,
    near: 1,
    far: 1000,
    viewport: [800, 600] as [number, number],
  };
  const stroke = (colour: string, tool: Exclude<ToolId, 'fill'> = 'flat'): PaintStep => ({
    kind: 'stroke',
    tool,
    colour,
    brush: DEFAULT_BRUSH,
    camera,
    dabs: [0, 0, 0, 0.5],
  });
  const fill = (colour: string): PaintStep => ({
    kind: 'fill',
    tool: 'fill',
    colour,
    brush: DEFAULT_BRUSH,
    seed: { kind: 'base' },
  });

  it('gives nothing for no steps', () => {
    expect(recentColours([])).toEqual([]);
  });

  it('gives the colours newest first, strokes and fills alike', () => {
    expect(recentColours([stroke('#111111'), fill('#222222'), stroke('#333333', 'wash')])).toEqual([
      '#333333',
      '#222222',
      '#111111',
    ]);
  });

  it('gives each colour once, where it was used last', () => {
    const steps = [stroke('#111111'), stroke('#222222'), stroke('#111111'), stroke('#222222')];
    expect(recentColours(steps)).toEqual(['#222222', '#111111']);
    expect(recentColours([stroke('#aabbcc'), stroke('#AABBCC')])).toEqual(['#aabbcc']);
  });

  it('leaves the eraser out: its colour is never shown', () => {
    const steps = [stroke('#111111'), stroke('#222222', 'eraser'), stroke('#333333', 'eraser')];
    expect(recentColours(steps)).toEqual(['#111111']);
    expect(recentColours([stroke('#222222', 'eraser')])).toEqual([]);
  });

  it('leaves the lift out too (#137): it brings back colours, it lays none', () => {
    expect(recentColours([stroke('#111111'), stroke('#222222', 'lift')])).toEqual(['#111111']);
  });

  it('stops at the limit, the newest kept', () => {
    const steps = Array.from({ length: 20 }, (_, k) =>
      stroke(`#0000${k.toString(16).padStart(2, '0')}`),
    );
    const colours = recentColours(steps);
    expect(colours).toHaveLength(RECENT_COLOURS_MAX);
    expect(colours[0]).toBe('#000013');
    expect(colours.at(-1)).toBe('#000008');
    expect(recentColours(steps, 3)).toEqual(['#000013', '#000012', '#000011']);
    expect(recentColours(steps, 0)).toEqual([]);
  });

  it('counts the limit in colours, not steps', () => {
    const steps = [stroke('#111111'), ...Array.from({ length: 30 }, () => stroke('#222222'))];
    expect(recentColours(steps, 2)).toEqual(['#222222', '#111111']);
  });
});
