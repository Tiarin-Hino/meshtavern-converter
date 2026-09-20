import { copyFileSync, createReadStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const BASIS_DIR = 'node_modules/three/examples/jsm/libs/basis';
const BASIS_FILES = ['basis_transcoder.js', 'basis_transcoder.wasm'];

/** Serves the Basis transcoder that ships with three.js under /basis/ (spike, issue #30). */
function basisTranscoder(): Plugin {
  return {
    name: 'meshtavern-basis-transcoder',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = BASIS_FILES.find((name) => request.url === `/basis/${name}`);
        if (!file) return next();
        response.setHeader(
          'Content-Type',
          file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        );
        createReadStream(join(BASIS_DIR, file)).pipe(response);
      });
    },
    closeBundle() {
      mkdirSync('dist/basis', { recursive: true });
      for (const file of BASIS_FILES) copyFileSync(join(BASIS_DIR, file), join('dist/basis', file));
    },
  };
}

export default defineConfig({
  plugins: [basisTranscoder()],
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts'],
    benchmark: { include: ['src/**/*.bench.ts'] },
  },
});
