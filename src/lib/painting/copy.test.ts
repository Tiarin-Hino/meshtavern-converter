import { describe, expect, it } from 'vitest';
import type { GroupOrigin } from '../pipeline/brush';
import { describeGroup, PAINT_COPY } from './copy';

// The painting view's words that are built, not written (#139, design note
// `docs/design/paint-groups.md` §7): a group's name from how it was made.

describe('describeGroup', () => {
  const made: GroupOrigin[] = [
    { by: 'body' },
    { by: 'part', file: 1 },
    { by: 'part', file: 2 },
    { by: 'base' },
    { by: 'shell', of: 0 },
    { by: 'shell', of: 0 },
    { by: 'shell', of: 1 },
    { by: 'hand' },
  ];

  it('names every kind of group', () => {
    expect(made.map((_, index) => describeGroup(made, index))).toEqual([
      'The body',
      'Part 2',
      'Part 3',
      'The base',
      'Shell 2 of the body',
      'Shell 3 of the body',
      'Shell 2 of Part 2',
      'Group 8',
    ]);
  });

  it('takes a file’s name for its part where the consumer gives one', () => {
    const names = [undefined, 'left-wing.stl'];
    expect(describeGroup(made, 1, names)).toBe('left-wing.stl');
    expect(describeGroup(made, 2, names)).toBe('Part 3');
    expect(describeGroup(made, 6, names)).toBe('Shell 2 of left-wing.stl');
  });

  it('says the words it is given', () => {
    const copy = { ...PAINT_COPY.groups, body: 'Der Körper', shell: 'Schale', of: 'von' };
    expect(describeGroup(made, 0, [], copy)).toBe('Der Körper');
    expect(describeGroup(made, 4, [], copy)).toBe('Schale 2 von der Körper');
  });

  it('refuses a group that was never made', () => {
    expect(() => describeGroup(made, made.length)).toThrow(RangeError);
  });
});
