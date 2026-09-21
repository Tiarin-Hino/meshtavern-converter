// Records the current figures of the generated meshes in src/regression/baseline.json.
// Run it when a pipeline change moves the figures on purpose, commit the file and explain
// the change in the pull request. Usage: npm run baseline:update
import { spawnSync } from 'node:child_process';

const { status } = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'src/regression/baseline.test.ts'],
  { stdio: 'inherit', env: { ...process.env, UPDATE_BASELINE: '1' } },
);
process.exit(status ?? 1);
