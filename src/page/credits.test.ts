// The credits (#145, spec L3, design note look-and-feel.md §4.6 and §10): public/theme/NOTICE.txt
// lists what the page ships with the full licence texts, and the Credits dialog in index.html
// names every part of it. A part added to the page is added to both, or this fails.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COPY } from './page-state';

const REPO = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, REPO), 'utf8').replace(/\r\n/g, '\n');
const version = (pkg: string) =>
  (JSON.parse(read(`node_modules/${pkg}/package.json`)) as { version: string }).version;

const notice = read('public/theme/NOTICE.txt');
const [entries] = notice.split('\nLicence texts\n');
/** Every part NOTICE.txt credits: an unindented line followed by an indented one. */
const parts = [...entries!.matchAll(/^(\S[^\n]*)\n {2}\S/gm)].map((m) => m[1]!);
const html = read('index.html');
const dialog = html.slice(
  html.indexOf('<div id="credits"'),
  html.indexOf('<footer id="dev-tools"'),
);
const dialogTerms = [...dialog.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]!);

describe('the credits', () => {
  it('names in the dialog every part NOTICE.txt credits, and nothing else', () => {
    expect(parts).toContain(`three.js ${version('three')}`);
    expect(dialogTerms).toEqual(parts);
  });

  it('carries the full text of every licence it names "below"', () => {
    for (const file of [
      'node_modules/three/LICENSE',
      'node_modules/meshoptimizer/LICENSE.md',
      'wasm/xatlas/LICENSE',
      'wasm/basis-encoder/LICENSE',
      'wasm/basis-encoder/NOTICE',
      'wasm/basis-encoder/LICENSE-zstd',
      'wasm/basis-encoder/LICENSE-mit',
    ]) {
      expect(notice, file).toContain(read(file).trimEnd());
    }
    expect(notice).toContain('Copyright (c) 2019 Don McCurdy');
  });

  it('names the versions the page is built with', () => {
    expect(parts).toContain(`three.js ${version('three')}`);
    expect(parts).toContain(`meshoptimizer ${version('meshoptimizer')}`);
    expect(parts).toContain(`Lucide ${version('lucide-static')}`);
  });

  it('carries the SRD 5.1 attribution as the README does', () => {
    const attribution =
      'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC';
    const flat = (s: string) => s.replace(/\s+/g, ' ');
    expect(flat(notice)).toContain(attribution);
    expect(flat(read('README.md'))).toContain(attribution);
    expect(flat(dialog.replace(/<[^>]+>/g, ''))).toContain(attribution);
  });

  it('ends with the line that the page collects nothing', () => {
    expect(dialog).toContain('data-copy="collectsNothing"');
    expect(COPY.collectsNothing).toMatch(/collects nothing/);
    expect(COPY.collectsNothing).toMatch(/your own choices/);
    expect(notice).toMatch(/collects nothing/);
  });
});
