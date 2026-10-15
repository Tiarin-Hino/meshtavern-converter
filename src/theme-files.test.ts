// The theme the page serves (#143, design note look-and-feel.md §2.1 and §8): the table
// application's files under public/theme/, within the application's budgets, with the two font
// families and their licences, and nothing that makes the page ask another host for a font or an
// image. The application's own web/src/theme-files.test.ts checks the same of its copy.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const REPO = new URL('../', import.meta.url);
const THEME = new URL('public/theme/', REPO);
const read = (path: string, base = THEME) => readFileSync(new URL(path, base), 'utf8');

/** At most 120 KB of fonts (look-and-feel spec L1, the application's budget). */
const FONT_BUDGET_BYTES = 120_000;
/** At most 40 KB of CSS after gzip (look-and-feel spec L1, the application's budget). */
const CSS_BUDGET_GZIP_BYTES = 40_000;
/** Every stylesheet the page loads: the theme's two and the page's and the views' own. */
const STYLESHEETS = [
  'public/theme/tokens.css',
  'public/theme/components.css',
  'src/page/style.css',
  'src/lib/questions.css',
  'src/lib/painting.css',
];
/**
 * The copy: the application's files of these names, the README that names its commit, and the
 * page's own NOTICE.txt (#145: what the page ships, with the licences).
 */
const THEME_FILES = [
  'LICENSE-Lucide.txt',
  'NOTICE.txt',
  'README.md',
  'components.css',
  'fonts/OFL-Fraunces.txt',
  'fonts/OFL-Inter.txt',
  'fonts/fraunces-latin-variable.woff2',
  'fonts/inter-latin-variable.woff2',
  'theme.js',
  'tokens.css',
];

function listFiles(dir: URL, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

describe('the theme the page serves', () => {
  it('is the application’s files, the README naming their commit and the NOTICE, nothing else', () => {
    expect(listFiles(THEME).sort()).toEqual(THEME_FILES);
    expect(read('README.md')).toMatch(/its `main` at `[0-9a-f]{7,40}`/);
  });

  it('keeps its fonts within the budget, WOFF2 only', () => {
    const fonts = readdirSync(new URL('fonts/', THEME)).filter((f) => !f.endsWith('.txt'));
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((f) => f.endsWith('.woff2'))).toBe(true);
    const bytes = fonts.reduce((sum, f) => sum + statSync(new URL(`fonts/${f}`, THEME)).size, 0);
    expect(bytes).toBeLessThanOrEqual(FONT_BUDGET_BYTES);
  });

  it('keeps the stylesheets within the budget after gzip', () => {
    const bytes = STYLESHEETS.reduce(
      (sum, f) => sum + gzipSync(read(f, REPO), { level: 9 }).length,
      0,
    );
    expect(bytes).toBeLessThanOrEqual(CSS_BUDGET_GZIP_BYTES);
  });

  it('declares two families from its own files, each with its licence beside it', () => {
    const faces = [...read('tokens.css').matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    const families = new Set(faces.map((f) => /font-family:\s*'([^']+)'/.exec(f)![1]));
    expect([...families]).toEqual(['Inter', 'Fraunces']);
    for (const face of faces) {
      expect(face).toMatch(/src: url\('fonts\/[\w-]+\.woff2'\) format\('woff2'\);/);
    }
    for (const licence of ['fonts/OFL-Inter.txt', 'fonts/OFL-Fraunces.txt', 'LICENSE-Lucide.txt']) {
      expect(read(licence).length).toBeGreaterThan(500);
    }
  });

  it('points every url() of the stylesheets at the page’s own files', () => {
    for (const sheet of STYLESHEETS) {
      for (const m of read(sheet, REPO).matchAll(/url\(\s*['"]?([^'")]+)/g)) {
        // Its own path or inline data; never a scheme that fetches, nor //host.
        if (!m[1]!.startsWith('data:')) {
          expect(m[1], sheet).not.toMatch(/^[a-z][a-z0-9+.-]*:|^\/\//i);
        }
      }
      expect(read(sheet, REPO), sheet).not.toMatch(/@import/);
    }
  });
});
