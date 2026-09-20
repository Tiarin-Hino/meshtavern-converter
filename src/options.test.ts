import { describe, expect, it } from 'vitest';
import { parsePageOptions } from './options';

describe('parsePageOptions', () => {
  it('reads nothing from an empty address', () => {
    expect(parsePageOptions('')).toEqual({ bake: 0, ktx: null, problems: [] });
  });

  it('reads the baking and compression options', () => {
    expect(parsePageOptions('?bake=auto&ktx=0')).toEqual({ bake: 'auto', ktx: 0, problems: [] });
    expect(parsePageOptions('?bake=1024')).toMatchObject({ bake: 1024, ktx: null });
    expect(parsePageOptions('?bake=512&ktx')).toMatchObject({ bake: 512, ktx: 1 });
  });

  it('rejects a mistyped separator instead of baking at a nonsense size', () => {
    const options = parsePageOptions('?bake=auto%ktx=0');
    expect(options.bake).toBe(0);
    expect(options.ktx).toBeNull();
    expect(options.problems.join(' ')).toContain('stray "%"');
    expect(options.problems.join(' ')).toContain('bake=');
  });

  it('rejects sizes and efforts that are not on offer, and unknown options', () => {
    expect(parsePageOptions('?bake=1000').problems).toHaveLength(1);
    expect(parsePageOptions('?bake=1024&ktx=9').problems).toHaveLength(1);
    expect(parsePageOptions('?bakee=auto').problems).toEqual(['unknown option "bakee" ignored']);
  });
});
