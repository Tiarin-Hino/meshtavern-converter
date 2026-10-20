import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // public/theme/ is the application's theme, copied byte for byte (#142, #143).
  {
    ignores: ['dist', 'out', 'playwright-report', 'test-results', '.claude', 'public/theme'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts that also pass functions into the browser through Playwright.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly',
        performance: 'readonly',
        document: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        requestAnimationFrame: 'readonly',
      },
    },
  },
  {
    // The page, the regression net and the e2e tests use the library like any other consumer:
    // through src/lib/index.ts, three.ts, dev.ts, questions.ts, painting.ts and painting-panel.ts,
    // never its inside (issues #50, #119, #127, #166).
    files: ['src/page/**', 'src/regression/**', 'e2e/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/lib/pipeline/*',
                '**/lib/worker/*',
                '**/lib/three/*',
                '**/lib/questions/*',
                '**/lib/painting/*',
                '**/lib/painting-panel/*',
                '**/lib/read-file',
              ],
              message:
                'import from src/lib/index.ts, three.ts, dev.ts, questions.ts, painting.ts or painting-panel.ts: the page uses the library like any other consumer',
            },
          ],
        },
      ],
    },
  },
);
