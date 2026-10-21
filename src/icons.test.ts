// The icon modules (#143): each committed module is what scripts/make-icons.mjs writes from the
// pinned lucide-static package, so nothing in them is edited by hand.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICON_SETS, iconMarkup, iconModule, LUCIDE_VERSION } from '../scripts/lib/icons.mjs';
import { ICONS as PAGE_ICONS } from './page/icons';
import { ICONS as QUESTION_ICONS } from './lib/questions/icons';
import { ICONS as PANEL_ICONS } from './lib/painting-panel/icons';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const PACKAGE = JSON.parse(read('package.json'));

describe('the icon modules', () => {
  it('pin the package at the version the generator names', () => {
    expect(PACKAGE.devDependencies['lucide-static']).toBe(LUCIDE_VERSION);
  });

  for (const path of Object.keys(ICON_SETS)) {
    it(`${path} is what the generator writes`, async () => {
      const committed = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
      expect(committed).toBe(await iconModule(path));
    });
  }

  it('hold decorative SVG in currentColor, the names of their lists', () => {
    expect(Object.keys(QUESTION_ICONS)).toEqual(ICON_SETS['src/lib/questions/icons.ts']);
    expect(Object.keys(PAGE_ICONS)).toEqual(ICON_SETS['src/page/icons.ts']);
    expect(Object.keys(PANEL_ICONS)).toEqual(ICON_SETS['src/lib/painting-panel/icons.ts']);
    for (const svg of [
      ...Object.values(QUESTION_ICONS),
      ...Object.values(PAGE_ICONS),
      ...Object.values(PANEL_ICONS),
    ]) {
      expect(svg).toMatch(/^<svg class="icon" aria-hidden="true" focusable="false" /);
      expect(svg).toMatch(/<\/svg>$/);
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).not.toMatch(/\n|<!--|lucide-|#[0-9a-f]{3}|href|<script|style=/i);
    }
  });

  it('name in index.html only icons the page has', () => {
    const names = [...read('index.html').matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(Object.keys(PAGE_ICONS), name).toContain(name);
  });

  it('ship the package’s licence beside the theme', () => {
    expect(read('public/theme/LICENSE-Lucide.txt')).toBe(
      read('node_modules/lucide-static/LICENSE'),
    );
  });
});

describe('iconMarkup', () => {
  it('rewrites the package’s file to one line with the class icon', () => {
    const file = `<!-- @license lucide-static v1.53.0 - ISC -->
<svg
  class="lucide lucide-x"
  width="24"
  stroke="currentColor"
>
  <path d="M18 6 6 18" />
</svg>
`;
    expect(iconMarkup(file)).toBe(
      '<svg class="icon" aria-hidden="true" focusable="false" width="24" stroke="currentColor"><path d="M18 6 6 18"/></svg>',
    );
  });
});
