import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareFigures } from './compare';
import { measureCase, REGRESSION_CASES, type Figures } from './measure';

/**
 * The regression net of issue #46: converts the generated meshes and compares triangles,
 * error and sizes per level with the committed baseline. A pipeline change that moves a
 * figure fails here until `npm run baseline:update` records the new figures; the changed
 * baseline.json then shows up in the pull request, where the change gets explained.
 */
const BASELINE = fileURLToPath(new URL('./baseline.json', import.meta.url));
const UPDATE = process.env.UPDATE_BASELINE === '1';
/** Unwrapping the baked case takes most of this on a slow CI runner. */
const TIMEOUT_MS = 300_000;

/** Six significant digits: enough to notice a change, short enough to read in a diff. */
const rounded = (_key: string, value: unknown): unknown =>
  typeof value === 'number' && !Number.isInteger(value) ? Number(value.toPrecision(6)) : value;

describe('regression baseline for generated meshes', () => {
  it(
    UPDATE ? 'records new figures' : 'has the figures recorded in baseline.json',
    async () => {
      const figures: Figures = {};
      for (const testCase of REGRESSION_CASES) figures[testCase.name] = await measureCase(testCase);
      const current: unknown = JSON.parse(JSON.stringify(figures, rounded));

      if (UPDATE) {
        writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
        return;
      }
      expect(existsSync(BASELINE), 'baseline.json is missing: run npm run baseline:update').toBe(
        true,
      );
      const changes = compareFigures(JSON.parse(readFileSync(BASELINE, 'utf8')), current);
      expect(
        changes,
        `The pipeline's figures moved away from src/regression/baseline.json:\n  ${changes.join('\n  ')}\n` +
          'If the change is intended, run "npm run baseline:update", commit baseline.json and explain the change in the pull request.\n',
      ).toEqual([]);
    },
    TIMEOUT_MS,
  );
});
