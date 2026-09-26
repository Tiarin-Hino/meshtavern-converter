import { describe, expect, it } from 'vitest';
import { parsePageOptions } from './options';
import { DETAIL_EFFORT } from './pipeline/compress';

describe('parsePageOptions', () => {
  it('bakes at the policy size and compresses when the address says nothing', () => {
    expect(parsePageOptions('')).toEqual({
      bake: 'auto',
      ktx: DETAIL_EFFORT,
      dev: false,
      problems: [],
    });
  });

  it('reads the development options for baking and compression', () => {
    expect(parsePageOptions('?bake=auto&ktx=2')).toMatchObject({
      bake: 'auto',
      ktx: 2,
      problems: [],
    });
    expect(parsePageOptions('?bake=1024')).toMatchObject({ bake: 1024, ktx: DETAIL_EFFORT });
    expect(parsePageOptions('?bake=512&ktx')).toMatchObject({ bake: 512, ktx: DETAIL_EFFORT });
    expect(parsePageOptions('?bake=off')).toMatchObject({
      bake: 0,
      ktx: DETAIL_EFFORT,
      problems: [],
    });
    expect(parsePageOptions('?ktx=off')).toMatchObject({ bake: 'auto', ktx: null, problems: [] });
  });

  it('rejects a mistyped separator instead of baking at a nonsense size', () => {
    const options = parsePageOptions('?bake=512%ktx=0');
    expect(options.bake).toBe('auto');
    expect(options.ktx).toBe(DETAIL_EFFORT);
    expect(options.problems.join(' ')).toContain('stray "%"');
    expect(options.problems.join(' ')).toContain('bake=');
  });

  it('rejects sizes and efforts that are not on offer, and unknown options', () => {
    expect(parsePageOptions('?bake=1000').problems).toHaveLength(1);
    expect(parsePageOptions('?bake=1024&ktx=9').problems).toHaveLength(1);
    expect(parsePageOptions('?bakee=auto').problems).toEqual(['unknown option "bakee" ignored']);
  });

  it('switches the development tools on with dev, whatever its value', () => {
    expect(parsePageOptions('?dev')).toMatchObject({ dev: true, problems: [] });
    expect(parsePageOptions('?dev=1')).toMatchObject({ dev: true, problems: [] });
    expect(parsePageOptions('?dev&bake=off')).toMatchObject({ dev: true, bake: 0, problems: [] });
    expect(parsePageOptions('?bake=off').dev).toBe(false);
  });
});
