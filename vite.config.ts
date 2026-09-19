import { defineConfig } from 'vitest/config';

export default defineConfig({
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts'],
    benchmark: { include: ['src/**/*.bench.ts'] },
  },
});
