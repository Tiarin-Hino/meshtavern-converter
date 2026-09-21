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
);
