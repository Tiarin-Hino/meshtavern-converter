import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'out', 'playwright-report', 'test-results', '.claude'] },
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
        URLSearchParams: 'readonly',
      },
    },
  },
  {
    // The page, the regression net and the e2e tests use the library like any other consumer:
    // through src/lib/index.ts, three.ts and dev.ts, never its inside (issue #50).
    files: ['src/page/**', 'src/regression/**', 'e2e/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/pipeline/*', '**/lib/worker/*', '**/lib/three/*'],
              message:
                'import from src/lib/index.ts, three.ts or dev.ts: the page uses the library like any other consumer',
            },
          ],
        },
      ],
    },
  },
);
