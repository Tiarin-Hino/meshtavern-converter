#!/usr/bin/env node
// Fails on a colour literal outside the token stylesheet (#143, look-and-feel spec L1): every
// colour the page and the library's views show comes from a role of public/theme/tokens.css, the
// table application's, so the page looks like MeshTavern and a theme can change it. Scans the CSS
// and TypeScript under src/, the theme's other stylesheets and index.html, tests excluded. Copied
// from the application's scripts/check-colours.mjs (its main at 791425e) with this repo's roots.
// Usage: node scripts/check-colours.mjs (npm run check:colours). Exit 1 on a find.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { findColourLiterals } from './lib/colour-literals.mjs';

const ROOTS = ['src', 'public/theme', 'index.html'];

/** Where colours may be written as they are. */
const ALLOWED = [
  // The token stylesheet itself.
  'public/theme/tokens.css',
  // The look presets' coats: paint on the mini, not chrome.
  'src/lib/pipeline/look.ts',
  // The painter's default colour: paint, not chrome.
  'src/lib/pipeline/brush.ts',
  // The scenes' fallbacks, the pairs' colours, the lights and the clear colour (the scenes'
  // backdrop and grid come from --scene-*).
  'src/lib/three/scene-colours.ts',
  // The regression net's generated stand-ins for minis.
  'src/regression/',
];

/** The kind a file is read as, or null for one that is not scanned. */
const kindOf = (path) =>
  path.endsWith('.css')
    ? 'css'
    : path.endsWith('.html')
      ? 'html'
      : path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.d.ts')
        ? 'ts'
        : null;

async function* files(path) {
  if (!(await stat(path)).isDirectory()) {
    yield path;
    return;
  }
  for (const entry of await readdir(path, { withFileTypes: true })) {
    yield* files(join(path, entry.name));
  }
}

const finds = [];
let scanned = 0;
for (const root of ROOTS) {
  for await (const file of files(root)) {
    const path = relative('.', file).split('\\').join('/');
    const kind = kindOf(path);
    if (kind === null) continue;
    if (ALLOWED.some((allowed) => path === allowed || path.startsWith(allowed))) continue;
    scanned++;
    for (const { line, text } of findColourLiterals(await readFile(file, 'utf8'), kind)) {
      finds.push(`${path}:${line}: ${text}`);
    }
  }
}

for (const find of finds) console.log(find);
console.log(
  finds.length === 0
    ? `no colour literal outside the token stylesheet in ${scanned} files`
    : `${finds.length} colour literal(s) outside the token stylesheet: use a role of public/theme/tokens.css`,
);
process.exit(finds.length === 0 ? 0 : 1);
