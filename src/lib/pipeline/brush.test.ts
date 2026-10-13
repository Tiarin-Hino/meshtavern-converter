import { describe, expect, it } from 'vitest';
import {
  BORDER_TEXEL,
  DEFAULT_BRUSH,
  GUTTER_TEXEL,
  ISLAND_TEXEL,
  NO_OWNER,
  ownerMap,
  spaceDabs,
  TOOL_IDS,
  toolMask,
  unitDirection,
  type BrushSettings,
  type DabHit,
} from './brush';
import { DRY_SOFTNESS, DRY_THRESHOLD, INK_FLAT, WASH_FLAT, WASH_LIFT } from './look';

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
  it('paints every texel with the flat brush, the eraser and the fill', () => {
    for (const tool of ['flat', 'eraser', 'fill'] as const)
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

  it('dry-brushes only where the cavity is positive, and further down the edge with more pressure', () => {
    const dry = (cavity: number, pressure: number): number =>
      toolMask('dry', cavity, 1, UP, brush({ opacity: pressure }));
    for (const pressure of [0, 0.5, 1])
      for (const cavity of [-1, -0.3, 0]) expect(dry(cavity, pressure)).toBe(0);
    expect(dry(1, 1)).toBe(1);
    // At full pressure the threshold is 0: a slightly raised texel catches some.
    expect(dry(0.1, 1)).toBeGreaterThan(0);
    // At none it is DRY_THRESHOLD: that texel takes nothing, a sharper edge does.
    expect(dry(0.1, 0)).toBe(0);
    expect(dry(DRY_THRESHOLD, 0)).toBe(0);
    expect(dry(DRY_THRESHOLD + DRY_SOFTNESS, 0)).toBe(1);
    for (const cavity of [0.05, 0.2, 0.4, 0.6])
      expect(dry(cavity, 0.8)).toBeGreaterThanOrEqual(dry(cavity, 0.2));
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
