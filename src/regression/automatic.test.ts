import { describe, expect, it } from 'vitest';
import {
  automaticRate,
  automaticReport,
  checkMini,
  type MiniFigures,
} from '../../scripts/lib/automatic.mjs';

const mini = (kind: string, up: string, units: string, size: string): MiniFigures => ({
  kind,
  up,
  orientation: { rotation: [0, 0, 0, 1] },
  sizing: { units, size },
});

describe('checkMini', () => {
  it('is right when up, units and size are the expected ones', () => {
    const row = checkMini(mini('humanoid', '+z', 'mm', 'medium'), { up: '+z', size: 'medium' });
    expect(row.right).toBe(true);
    expect(row.scale).toEqual({ ok: true, got: 'mm', expected: 'mm' });
  });

  it('fails on one wrong check and says which', () => {
    const entry = { up: '+z', size: 'medium' };
    expect(checkMini(mini('humanoid', '+y', 'mm', 'medium'), entry).up?.ok).toBe(false);
    expect(checkMini(mini('humanoid', '+z', 'in', 'medium'), entry).scale?.ok).toBe(false);
    const size = checkMini(mini('humanoid', '+z', 'mm', 'large'), entry);
    expect(size.size).toEqual({ ok: false, got: 'large', expected: 'medium' });
    expect(size.right).toBe(false);
  });

  it('takes the units from the index when it names them', () => {
    const row = checkMini(mini('terrain', '+z', 'in', 'huge'), {
      up: '+z',
      size: 'huge',
      units: 'in',
    });
    expect(row.right).toBe(true);
  });

  it('does not count a mini without an expected up direction or size', () => {
    const row = checkMini(mini('humanoid', '+z', 'mm', 'medium'), { up: '+z' });
    expect(row.size).toBeNull();
    expect(row.right).toBeNull();
  });

  it('compares a free turn as a rotation, either sign', () => {
    const turned: MiniFigures = { ...mini('flying', '+y', 'mm', 'large') };
    turned.orientation = { rotation: [0, -0.38268, 0, -0.92388] };
    const entry = { up: '+y', size: 'large', rotation: [0, 0.38268, 0, 0.92388] };
    expect(checkMini(turned, entry).right).toBe(true);
    expect(checkMini(mini('flying', '+y', 'mm', 'large'), entry).up?.ok).toBe(false);
  });

  it('counts a mini that did not convert as not right', () => {
    const row = checkMini({ kind: 'flying', error: 'not a pair' }, { up: '+y', size: 'large' });
    expect(row).toMatchObject({ right: false, converted: false });
  });
});

describe('automaticRate', () => {
  const minis = {
    'humanoid/a': mini('humanoid', '+z', 'mm', 'medium'),
    'humanoid/b': mini('humanoid', '+y', 'mm', 'large'),
    'flying/a': { kind: 'flying', error: 'not a pair' },
    'flying/b': mini('flying', '+y', 'mm', 'large'),
    'terrain/a': mini('terrain', '+y', 'mm', 'huge'),
  };
  const index = {
    'humanoid/a': { up: '+z', size: 'medium' },
    'humanoid/b': { up: '+z', size: 'medium', note: 'a note' },
    'flying/a': { up: '+y', size: 'large' },
    'flying/b': { up: '+y', size: 'large' },
    'terrain/a': { up: '+y' },
  };
  const rate = automaticRate(minis, index);

  it('counts the minis the index can judge', () => {
    expect(rate).toMatchObject({ right: 2, counted: 4, notCounted: ['terrain/a'] });
    expect(rate.checks).toEqual({
      up: { right: 3, counted: 4 },
      scale: { right: 4, counted: 4 },
      size: { right: 2, counted: 3 },
    });
  });

  it('lists the failures by kind', () => {
    expect(rate.byKind).toEqual({
      flying: { right: 1, counted: 2, failed: [{ key: 'flying/a', checks: ['converted'] }] },
      humanoid: { right: 1, counted: 2, failed: [{ key: 'humanoid/b', checks: ['up', 'size'] }] },
    });
  });

  it('reports the rate, the failures and what moved since the last run', () => {
    const before = automaticRate({ ...minis, 'humanoid/b': minis['humanoid/a'] }, index);
    const report = automaticReport(rate, before, { 'humanoid/b': 'a note' });
    expect(report).toContain('**2 of 4 (50 %) minis are right without a correction**');
    expect(report).toContain(
      'Last run: 3 of 4 (75 %). Changed: humanoid/b (now fails: up, base size).',
    );
    expect(report).toContain(
      '  - humanoid/b: up +y, expected +z; base size large, expected medium (a note)',
    );
    expect(report).toContain('  - flying/a: not converted');
    expect(report).toContain('| terrain/a | terrain | +y ✓ | mm ✓ | ? | not counted |');
  });
});
